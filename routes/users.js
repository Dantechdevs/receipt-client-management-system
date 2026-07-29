const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../lib/helpers');

router.use(requireAuth, requireRole('admin'));

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY id ASC').all();
  res.render('users/list', { users, error: null });
});

router.get('/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT a.*, u.name as user_name FROM activity_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 300`).all();
  res.render('users/logs', { logs });
});

router.post('/', (req, res) => {
  const { name, email, password, role } = req.body;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    const users = db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY id ASC').all();
    return res.render('users/list', { users, error: 'A user with that email already exists.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(name, email, hash, role);
  logActivity(req.session.user.id, 'user_created', 'user', info.lastInsertRowid, { email, role });
  res.redirect('/users');
});

router.post('/:id/toggle-active', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).render('error', { message: 'User not found.' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(user.active ? 0 : 1, user.id);
  logActivity(req.session.user.id, user.active ? 'user_deactivated' : 'user_activated', 'user', user.id, null);
  res.redirect('/users');
});

router.post('/:id/role', (req, res) => {
  const { role } = req.body;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  logActivity(req.session.user.id, 'user_role_changed', 'user', req.params.id, { role });
  res.redirect('/users');
});

module.exports = router;
