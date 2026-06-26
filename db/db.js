const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node:sqlite doesn't ship a built-in transaction helper (unlike better-sqlite3),
// so this provides the same call pattern used throughout the app: runInTransaction(() => { ... })
db.runInTransaction = function (fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'My Company',
  address TEXT,
  phone TEXT,
  email TEXT,
  footer_message TEXT,
  logo_path TEXT,
  stamp_path TEXT,
  signature_path TEXT,
  currency TEXT DEFAULT 'KES',
  quotation_prefix TEXT DEFAULT 'QT',
  invoice_prefix TEXT DEFAULT 'INV',
  receipt_prefix TEXT DEFAULT 'RCP',
  agreement_prefix TEXT DEFAULT 'AGR'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  reset_token TEXT,
  reset_token_expires INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(phone)
);

-- Unified document model: quotations, invoices, receipts, and agreements
-- all live here, distinguished by doc_type. This lets them share client
-- records, line items, PDF rendering, verification codes, and — most
-- importantly — convert into each other (quotation -> invoice -> receipt).
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('quotation','invoice','receipt','agreement')),
  doc_number TEXT UNIQUE NOT NULL,
  verification_code TEXT UNIQUE NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total REAL NOT NULL DEFAULT 0,
  issue_date TEXT DEFAULT (datetime('now')),

  -- Quotation-specific
  valid_until TEXT,

  -- Invoice-specific
  due_date TEXT,
  payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid') OR payment_status IS NULL),

  -- Receipt-specific
  payment_method TEXT,

  -- Agreement-specific
  effective_date TEXT,
  parties TEXT, -- JSON array of {role, name, phone}

  -- Conversion chain: quotation -> invoice -> receipt
  converted_from_id INTEGER REFERENCES documents(id),
  converted_to_id INTEGER REFERENCES documents(id),

  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

-- Agreement-only: numbered clauses/terms sections
CREATE TABLE IF NOT EXISTS document_clauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  body TEXT
);

-- Per-type, per-year sequential numbering (QT-2026-000001, INV-2026-000001, ...)
CREATE TABLE IF NOT EXISTS doc_counters (
  doc_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

-- Photos shown in the "Recent Work" gallery on the public marketing homepage.
-- Managed from /gallery in the admin panel — no code changes needed to add
-- or remove a photo.
CREATE TABLE IF NOT EXISTS gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// seed default company row
const companyRow = db.prepare('SELECT * FROM company WHERE id = 1').get();
if (!companyRow) {
  db.prepare(`INSERT INTO company (id, name, address, phone, email, footer_message, currency, quotation_prefix, invoice_prefix, receipt_prefix, agreement_prefix)
    VALUES (1, 'Your Company Name', 'Your Address', '+254 700 000000', 'info@example.com', 'Thank you for your business!', 'KES', 'QT', 'INV', 'RCP', 'AGR')`).run();
}

// ---- Lightweight schema migration ----
// CREATE TABLE IF NOT EXISTS only helps brand-new tables. Existing installs
// (an existing data.sqlite from before a feature was added) need columns
// added to their already-existing tables. This checks each table's actual
// columns and adds any that are missing, so upgrading never requires
// deleting the database.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some(c => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Company: prefix columns (for installs from before quotations/invoices/agreements existed)
ensureColumn('company', 'quotation_prefix', "TEXT DEFAULT 'QT'");
ensureColumn('company', 'invoice_prefix', "TEXT DEFAULT 'INV'");
ensureColumn('company', 'agreement_prefix', "TEXT DEFAULT 'AGR'");
// Company: tax defaults
ensureColumn('company', 'default_tax_rate', 'REAL DEFAULT 0');
ensureColumn('company', 'default_tax_label', "TEXT DEFAULT 'VAT'");

// Documents: tax breakdown (for installs from before tax support existed)
ensureColumn('documents', 'subtotal', 'REAL DEFAULT 0');
ensureColumn('documents', 'tax_rate', 'REAL DEFAULT 0');
ensureColumn('documents', 'tax_label', "TEXT DEFAULT 'VAT'");
ensureColumn('documents', 'tax_amount', 'REAL DEFAULT 0');

fs.mkdirSync(path.join(__dirname, '..', 'public', 'uploads'), { recursive: true });

// Seed the gallery with the photos already on the homepage, only on a
// brand-new install (table empty) — so this never overwrites photos an
// owner has already added or removed via /gallery.
const galleryCount = db.prepare('SELECT COUNT(*) c FROM gallery_photos').get().c;
if (galleryCount === 0) {
  const starterPhotos = [
    ['/site/assets/images/borehole.png', 'Borehole drilling in progress'],
    ['/site/assets/images/solar.png', 'Solar pumping equipment'],
    ['/site/assets/images/cctv.png', 'CCTV installation'],
    ['/site/assets/images/electrical-panel.png', 'Electrical panel wiring'],
    ['/site/assets/images/plumbing-electrical.png', 'Plumbing & electrical works'],
    ['/site/assets/images/foundation-slab.png', 'Foundation slab construction'],
    ['/site/assets/images/roof-construction.png', 'Roof slab reinforcement']
  ];
  const insertPhoto = db.prepare('INSERT INTO gallery_photos (image_path, caption, sort_order) VALUES (?, ?, ?)');
  starterPhotos.forEach(([imagePath, caption], i) => insertPhoto.run(imagePath, caption, i));
}

module.exports = db;
