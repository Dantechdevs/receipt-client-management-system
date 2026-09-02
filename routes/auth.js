const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db/db');
const { logActivity } = require('../lib/helpers');
const mail = require('../lib/mail');

// In-memory brute-force guard: 5 failed attempts per email+IP locks for 15 min.
// Fine for a single-process/local deployment. If you ever scale to multiple
// instances behind a load balancer, swap this for express-rate-limit + Redis.
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Separate, looser limiter for forgot-password to slow down email enumeration
// and mass token-generation abuse.
const forgotAttempts = new Map();
const FORGOT_MAX = 5;
const FORGOT_WINDOW_MS = 15 * 60 * 1000;

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  const company = db.prepare('SELECT name, logo_path FROM company WHERE id = 1').get();
  res.render('login', { error: null, company });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const company = db.prepare('SELECT name, logo_path FROM company WHERE id = 1').get();
  const key = `${email}:${req.ip}`;
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (entry && entry.count >= MAX_ATTEMPTS && now < entry.resetAt) {
    return res.render('login', { error: 'Too many failed attempts. Try again in a few minutes.', company });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    loginAttempts.set(key, { count: (entry ? entry.count : 0) + 1, resetAt: now + LOCKOUT_MS });
    logActivity(user ? user.id : null, 'login_failed', 'user', user ? user.id : null, { email });
    return res.render('login', { error: 'Invalid email or password.', company });
  }

  loginAttempts.delete(key);
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };

  // "Remember me" â€” extend session cookie lifetime if the box was checked
  if (req.body.remember) {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  logActivity(user.id, 'login', 'user', user.id, null);
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  const userId = req.session.user ? req.session.user.id : null;
  logActivity(userId, 'logout', 'user', userId, null);
  req.session.destroy(() => res.redirect('/login'));
});


router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { message: null, error: null, resetLink: null });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const key = req.ip;
  const now = Date.now();
  const entry = forgotAttempts.get(key);
  const GENERIC_MESSAGE = 'If an account exists with that email, a reset link has been sent.';

  if (entry && entry.count >= FORGOT_MAX && now < entry.resetAt) {
    return res.render('forgot-password', { error: 'Too many requests. Try again in a few minutes.', message: null, resetLink: null });
  }
  forgotAttempts.set(key, { count: (entry ? entry.count : 0) + 1, resetAt: now + FORGOT_WINDOW_MS });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    // Same response whether or not the account exists — avoids confirming
    // registered emails to an attacker.
    return res.render('forgot-password', { message: GENERIC_MESSAGE, error: null, resetLink: null });
  }

  const token = crypto.randomBytes(20).toString('hex');
  const expires = Date.now() + 1000 * 60 * 30; // 30 min
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);

  const resetUrl = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/reset-password/${token}`;

  if (process.env.SENDGRID_API_KEY) {
    try {
      await mail.sendPasswordReset({ to: user.email, resetUrl, userName: user.name });
      return res.render('forgot-password', { message: GENERIC_MESSAGE, error: null, resetLink: null });
    } catch (err) {
      logActivity(user.id, 'password_reset_email_failed', 'user', user.id, { error: err.message });
    }
  }

  // Dev fallback only reached when SendGrid isn't configured, or the send
  // failed above. This still visibly confirms the account exists via the
  // link itself — acceptable for local dev, not for production.
  res.render('forgot-password', { message: GENERIC_MESSAGE + ' (Dev mode — no email configured, link shown below.)', error: null, resetLink: `/reset-password/${token}` });
});

router.get('/reset-password/:token', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(req.params.token);
  if (!user || !user.reset_token_expires || user.reset_token_expires < Date.now()) {
    return res.render('error', { message: 'This password reset link is invalid or has expired.' });
  }
  res.render('reset-password', { token: req.params.token, error: null });
});

router.post('/reset-password/:token', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(req.params.token);
  if (!user || !user.reset_token_expires || user.reset_token_expires < Date.now()) {
    return res.render('error', { message: 'This password reset link is invalid or has expired.' });
  }

  const { password, confirm } = req.body;
  if (!password || password.length < 8) {
    return res.render('reset-password', { token: req.params.token, error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirm) {
    return res.render('reset-password', { token: req.params.token, error: 'Passwords do not match.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(hash, user.id);
  logActivity(user.id, 'password_reset', 'user', user.id, null);
  res.redirect('/login');
});

module.exports = router;
