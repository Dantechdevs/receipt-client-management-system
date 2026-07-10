const db = require('../db/db');
const { customAlphabet } = require('nanoid');

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const genCode = customAlphabet(codeAlphabet, 10);

const PREFIX_FIELD = {
  quotation: 'quotation_prefix',
  invoice: 'invoice_prefix',
  receipt: 'receipt_prefix',
  agreement: 'agreement_prefix'
};
const DEFAULT_PREFIX = { quotation: 'QT', invoice: 'INV', receipt: 'RCP', agreement: 'AGR' };

function nextDocNumber(docType) {
  const year = new Date().getFullYear();
  const company = db.prepare('SELECT * FROM company WHERE id = 1').get();
  const prefix = (company && company[PREFIX_FIELD[docType]]) || DEFAULT_PREFIX[docType];

  const seq = db.runInTransaction(() => {
    let row = db.prepare('SELECT seq FROM doc_counters WHERE doc_type = ? AND year = ?').get(docType, year);
    if (!row) {
      db.prepare('INSERT INTO doc_counters (doc_type, year, seq) VALUES (?, ?, 0)').run(docType, year);
      row = { seq: 0 };
    }
    const next = row.seq + 1;
    db.prepare('UPDATE doc_counters SET seq = ? WHERE doc_type = ? AND year = ?').run(next, docType, year);
    return next;
  });
  const padded = String(seq).padStart(6, '0');
  return `${prefix}-${year}-${padded}`;
}

function generateVerificationCode() {
  let code;
  const exists = db.prepare('SELECT id FROM documents WHERE verification_code = ?');
  do {
    code = genCode();
  } while (exists.get(code));
  return code;
}

function logActivity(userId, action, entity, entityId, details) {
  db.prepare(`INSERT INTO activity_logs (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)`)
    .run(userId || null, action, entity || null, entityId || null, details ? JSON.stringify(details) : null);
}

function findOrCreateClient(name, phone, address) {
  if (phone) {
    const existing = db.prepare('SELECT * FROM clients WHERE phone = ?').get(phone);
    if (existing) {
      if (name && (name !== existing.name || (address && address !== existing.address))) {
        db.prepare('UPDATE clients SET name = ?, address = COALESCE(?, address) WHERE id = ?')
          .run(name, address || null, existing.id);
      }
      return existing.id;
    }
  }
  const info = db.prepare('INSERT INTO clients (name, phone, address) VALUES (?,?,?)').run(name, phone || null, address || null);
  return info.lastInsertRowid;
}

function fmtMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { nextDocNumber, generateVerificationCode, logActivity, findOrCreateClient, fmtMoney };
