const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db/db');
const { logActivity } = require('../lib/helpers');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  const company = db.prepare('SELECT name, logo_path FROM company WHERE id = 1').get();
  res.render('login', { error: null, company });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  const company = db.prepare('SELECT name, logo_path FROM company WHERE id = 1').get();
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    logActivity(user ? user.id : null, 'login_failed', 'user', user ? user.id : null, { email });
    return res.render('login', { error: 'Invalid email or password.', company });
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
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

router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.render('forgot-password', { error: 'No account with that email.', message: null, resetLink: null });
  }
  const token = crypto.randomBytes(20).toString('hex');
  const expires = Date.now() + 1000 * 60 * 30; // 30 min
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);
  // In a real system this would be emailed. We show the link directly since there's no mail server configured.
  const resetLink = `/reset-password/${token}`;
  res.render('forgot-password', { message: 'Reset link generated below (in production this would be emailed).', error: null, resetLink });
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
  if (!password || password.length < 6) {
    return res.render('reset-password', { token: req.params.token, error: 'Password must be at least 6 characters.' });
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
