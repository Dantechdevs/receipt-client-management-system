// Adds a "Payment Terms" clause and Client/Contractor parties to the 3
// already-seeded quotations (Minaa, Kioko, Benjamin), matching the reference.
//
// Run with: node db/backfill-quotation-signatures.js

const db = require('./db');

const PAYMENT_TERMS_BODY = '50% deposit\n40% upon completion\n10% upon final testing\nValid 30 days';

const quotations = db.prepare("SELECT id, customer_name, customer_address FROM documents WHERE doc_type = 'quotation'").all();

for (const q of quotations) {
  db.runInTransaction(() => {
    const existingClause = db.prepare("SELECT id FROM document_clauses WHERE document_id = ? AND title = 'Payment Terms'").get(q.id);
    if (!existingClause) {
      db.prepare('INSERT INTO document_clauses (document_id, position, title, body) VALUES (?, 0, ?, ?)')
        .run(q.id, 'Payment Terms', PAYMENT_TERMS_BODY);
    }
    const parties = [
      { role: 'Client', name: `${q.customer_name} — ${q.customer_address || ''}`.trim(), phone: '' },
      { role: 'Contractor', name: 'JAMARIAN POWER SOLUTIONS\nJames Mutie', phone: '0742936711' }
    ];
    db.prepare('UPDATE documents SET parties = ? WHERE id = ?').run(JSON.stringify(parties), q.id);
  });
  console.log(`Updated quotation id=${q.id} (${q.customer_name})`);
}

console.log('Done.');
