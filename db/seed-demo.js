const db = require('./db');
const { nextDocNumber, generateVerificationCode, findOrCreateClient } = require('../lib/helpers');

// ---- 1. Company profile (Jamarian Power Solution) ----
db.prepare(`UPDATE company SET name=?, address=?, phone=?, email=?, footer_message=?, currency=?,
  quotation_prefix=?, invoice_prefix=?, receipt_prefix=?, agreement_prefix=?, logo_path=? WHERE id = 1`)
  .run(
    'Jamarian Power Solution',
    'Power • Energy • Engineering — Electrical, Solar, Plumbing & Construction Solutions',
    '0742936711',
    'info@jamarianpowersolution.com',
    'Thank you for choosing JAMARIAN POWER SOLUTION — Reliable, Professional & Safe Borehole Services',
    'KES',
    'QT', 'INV', 'RCP', 'AGR',
    '/uploads/logo-jamarian.jpeg'
  );

const clientId = findOrCreateClient('Adam', '0711223344', 'Bangale');
const admin = db.prepare(`SELECT id FROM users WHERE email = 'admin@example.com'`).get();
const createdBy = admin ? admin.id : null;

const items = [
  { description: 'Contractors Mobilization and Camp — mobilizing staff and equipment to site, temporary facilities, demobilization after completion', quantity: 2, unit_price: 20000 },
  { description: 'Borehole Drilling (Works) — 200mm diameter, approx. 200m depth through all strata, includes drill logging', quantity: 200, unit_price: 3800 },
  { description: 'Samples — taking of drill cutting samples at 2-metre intervals', quantity: 1, unit_price: 5000 },
  { description: 'Supply & Installation of Screens and Casing — 152mm internal diameter steel casing', quantity: 200, unit_price: 2500 },
  { description: 'Hydrogeological Survey — determine most suitable borehole location and water-bearing zones', quantity: 1, unit_price: 35000 },
  { description: 'Surface Casing — 8 inch', quantity: 1, unit_price: 25000 },
  { description: 'Gravel Pack Supply & Installation — 2-4mm rounded gravel with calcium hypochlorite disinfection', quantity: 60, unit_price: 1000 },
  { description: 'EIA Report / NEMA Permit', quantity: 1, unit_price: 70000 },
  { description: 'Test Pumping & Chemical Analysis — yield, drawdown and specific capacity assessment', quantity: 1, unit_price: 20000 }
];
const total = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
const projectNotes = 'Project: 200 Metres Borehole Drilling Works — RE: Borehole Drilling. Payment terms: 50% deposit, 40% on completion, 10% on final testing.';

function insertDoc(docType, status, extra = {}) {
  const docNumber = nextDocNumber(docType);
  const verificationCode = generateVerificationCode();
  const taxRate = extra.taxRate || 0;
  const taxLabel = extra.taxLabel || 'VAT';
  const subtotal = total;
  const taxAmount = subtotal * (taxRate / 100);
  const grandTotal = subtotal + taxAmount;
  const id = db.runInTransaction(() => {
    const info = db.prepare(`INSERT INTO documents
      (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
       notes, status, subtotal, tax_rate, tax_label, tax_amount, total, valid_until, due_date, payment_status, payment_method, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(docType, docNumber, verificationCode, clientId, 'Adam', '0711223344', 'Bangale',
        projectNotes, status, subtotal, taxRate, taxLabel, taxAmount, grandTotal,
        extra.valid_until || null, extra.due_date || null, extra.payment_status || null, extra.payment_method || null,
        createdBy);
    const id = info.lastInsertRowid;
    const stmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
    for (const it of items) stmt.run(id, it.description, it.quantity, it.unit_price, it.quantity * it.unit_price);
    return id;
  });
  return { id, docNumber, verificationCode };
}

// ---- Quotation (with 16% VAT applied, to demonstrate the tax breakdown) ----
const quotation = insertDoc('quotation', 'sent', {
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10),
  taxRate: 16, taxLabel: 'VAT'
});
console.log(`Quotation created: ${quotation.docNumber} (id ${quotation.id}) — with 16% VAT applied`);

// ---- Invoice ----
const invoice = insertDoc('invoice', 'sent', { due_date: new Date(Date.now() + 14 * 86400000).toISOString().substring(0, 10), payment_status: 'unpaid' });
console.log(`Invoice created: ${invoice.docNumber} (id ${invoice.id})`);

// ---- Receipt ----
const receipt = insertDoc('receipt', 'final', { payment_method: 'M-Pesa' });
console.log(`Receipt created: ${receipt.docNumber} (id ${receipt.id})`);

// ---- Agreement (with clauses + parties, no pricing schedule) ----
const agreementDocNumber = nextDocNumber('agreement');
const agreementCode = generateVerificationCode();
const parties = [
  { role: 'Client', name: 'Adam', phone: '0711223344' },
  { role: 'Contractor', name: 'James Mutie — Jamarian Power Solution', phone: '0742936711' }
];
const clauses = [
  { title: 'Scope of Work', body: 'The Contractor agrees to carry out 200-metre borehole drilling works at the Client\'s site in Bangale, including mobilization, drilling, casing, gravel packing, and test pumping as detailed in the accompanying quotation.' },
  { title: 'Payment Terms', body: '50% deposit payable before mobilization, 40% payable on completion of drilling works, and the remaining 10% payable upon successful final testing.' },
  { title: 'Timeline', body: 'Works shall commence within 7 days of deposit payment and are expected to be completed within 14 working days, weather and geology permitting.' },
  { title: 'Warranty', body: 'The Contractor warrants all casing and screen installation work for a period of 12 months from the date of completion, covering defects in workmanship.' }
];
const agreementId = db.runInTransaction(() => {
  const info = db.prepare(`INSERT INTO documents
    (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
     notes, status, total, effective_date, parties, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('agreement', agreementDocNumber, agreementCode, clientId, 'Adam', '0711223344', 'Bangale',
      'Borehole drilling services agreement.', 'active', 0, new Date().toISOString().substring(0, 10), JSON.stringify(parties), createdBy);
  const id = info.lastInsertRowid;
  const clauseStmt = db.prepare('INSERT INTO document_clauses (document_id, position, title, body) VALUES (?,?,?,?)');
  clauses.forEach((c, idx) => clauseStmt.run(id, idx, c.title, c.body));
  return id;
});
console.log(`Agreement created: ${agreementDocNumber} (id ${agreementId})`);

console.log('\nDemo data seeded. Log in and visit /dashboard to explore.');
