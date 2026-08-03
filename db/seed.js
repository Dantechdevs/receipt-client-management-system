const db = require('./db');
const bcrypt = require('bcryptjs');

const existing = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@example.com');
if (!existing) {
  const hash = bcrypt.hashSync('Admin@123', 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run('Administrator', 'admin@example.com', hash, 'admin');
  console.log('Seeded admin user: admin@example.com / Admin@123');
} else {
  console.log('Admin user already exists.');
}

const cashier = db.prepare('SELECT * FROM users WHERE email = ?').get('cashier@example.com');
if (!cashier) {
  const hash = bcrypt.hashSync('Cashier@123', 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run('Front Desk Cashier', 'cashier@example.com', hash, 'cashier');
  console.log('Seeded cashier user: cashier@example.com / Cashier@123');
} else {
  console.log('Cashier user already exists.');
}
