// Adds bank-details and signatory-name columns to `company` (if not already
// present), then sets the confirmed company details.
//
// Run with:  node db/seed-company.js

const db = require('./db');

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some(c => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Added column ${table}.${column}`);
  } else {
    console.log(`Column ${table}.${column} already exists — skipped`);
  }
}

ensureColumn('company', 'bank_account_name', 'TEXT');
ensureColumn('company', 'bank_account_number', 'TEXT');
ensureColumn('company', 'signatory_name', 'TEXT');

db.prepare(`
  UPDATE company SET
    name = ?,
    address = ?,
    phone = ?,
    email = ?,
    footer_message = ?,
    bank_account_name = ?,
    bank_account_number = ?,
    signatory_name = ?
  WHERE id = 1
`).run(
  'Jamarian Power Solution',
  'Nairobi, Kenya',
  '0742936711',
  'info@jamarianpowersolution.com',
  'Thank you for choosing JAMARIAN POWER SOLUTION - Reliable, Professional & Safe Borehole Services',
  'Homeland Irrigation Center',
  '1294825224',
  'James Mutie'
);

console.log('Company row updated:');
console.log(db.prepare('SELECT * FROM company WHERE id = 1').get());
