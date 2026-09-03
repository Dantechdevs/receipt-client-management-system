// Seeds the 3 borehole drilling quotations (Minaa, Kioko, Benjamin) as
// 'quotation' documents, using the app's own helpers so doc numbers,
// verification codes, and client records are created exactly the way the
// UI would create them.
//
// Run with:  node db/seed-quotations.js

const db = require('./db');
const { nextDocNumber, generateVerificationCode, findOrCreateClient } = require('../lib/helpers');

const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@example.com'").get();
const createdBy = admin ? admin.id : null;

// Shared line items for the 140m borehole job — identical across all three clients.
const ITEMS = [
  { description: 'Contractors Mobilization and Camp', quantity: 2, unit_price: 20000 },
  { description: 'Borehole Drilling (Works) — 140m, 200mm diameter', quantity: 140, unit_price: 3800 },
  { description: 'Samples — drill cuttings, every 2m', quantity: 1, unit_price: 5000 },
  { description: 'Supply and Installation of Screens and Casing — 152mm', quantity: 140, unit_price: 2500 },
  { description: 'Hydrogeological Survey', quantity: 1, unit_price: 45000 },
  { description: 'Surface Casing — 8 inch', quantity: 1, unit_price: 25000 },
  { description: 'EIA Report / NEMA Permit', quantity: 1, unit_price: 70000 },
  { description: 'Gravel Pack & Chemical Disinfection (2-4mm, incl. calcium hypochlorite)', quantity: 60, unit_price: 1000 },
  { description: 'Test Pumping / Chemical Analysis', quantity: 1, unit_price: 0 }
];

const CLIENTS = [
  { name: 'Minaa', address: 'Syokimau' },
  { name: 'Kioko', address: 'Mbumbuni' },
  { name: 'Benjamin', address: 'Kabaa' }
];

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

for (const client of CLIENTS) {
  const clientId = findOrCreateClient(client.name, null, client.address);

  const docNumber = nextDocNumber('quotation');
  const verificationCode = generateVerificationCode();

  const subtotal = ITEMS.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const total = subtotal; // tax_rate 0

  db.runInTransaction(() => {
    const info = db.prepare(`
      INSERT INTO documents
        (doc_type, doc_number, verification_code, client_id, customer_name, customer_address,
         status, subtotal, tax_rate, tax_label, tax_amount, total, valid_until, created_by)
      VALUES ('quotation', ?, ?, ?, ?, ?, 'final', ?, 0, 'VAT', 0, ?, ?, ?)
    `).run(docNumber, verificationCode, clientId, client.name, client.address, subtotal, total, daysFromNow(30), createdBy);

    const documentId = info.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO document_items (document_id, description, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of ITEMS) {
      insertItem.run(documentId, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price);
    }
  });

  console.log(`Seeded quotation ${docNumber} for ${client.name} (${client.address}) — total KES ${total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}, verification code ${verificationCode}`);
}
