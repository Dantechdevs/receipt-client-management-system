const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { nextDocNumber, generateVerificationCode, logActivity, findOrCreateClient } = require('../lib/helpers');
const { buildDocumentPDF } = require('../lib/pdf');
const { DOC_CONFIG } = require('../lib/doc-config');

const docType = 'agreement';
const config = DOC_CONFIG[docType];

router.use(requireAuth);

function getCompany() {
  return db.prepare('SELECT * FROM company WHERE id = 1').get();
}

function getAgreementFull(idOrNumber) {
  let doc = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(idOrNumber, docType);
  if (!doc) doc = db.prepare('SELECT * FROM documents WHERE doc_number = ? AND doc_type = ?').get(idOrNumber, docType);
  if (!doc) return null;
  const items = db.prepare('SELECT * FROM document_items WHERE document_id = ?').all(doc.id);
  const clauses = db.prepare('SELECT * FROM document_clauses WHERE document_id = ? ORDER BY position ASC').all(doc.id);
  const parties = doc.parties ? JSON.parse(doc.parties) : [];
  return { doc, items, clauses, parties };
}

function parseItems(body) {
  const descArr = [].concat(body.item_descriptions || []);
  const qtyArr = [].concat(body.item_quantities || []);
  const priceArr = [].concat(body.item_unit_prices || []);
  const items = [];
  let total = 0;
  for (let i = 0; i < descArr.length; i++) {
    if (!descArr[i]) continue;
    const qty = parseFloat(qtyArr[i]) || 0;
    const price = parseFloat(priceArr[i]) || 0;
    const lineTotal = qty * price;
    total += lineTotal;
    items.push({ description: descArr[i], quantity: qty, unit_price: price, line_total: lineTotal });
  }
  return { items, total };
}

function parseClauses(body) {
  const titleArr = [].concat(body.clause_titles || []);
  const bodyArr = [].concat(body.clause_bodies || []);
  const clauses = [];
  for (let i = 0; i < titleArr.length; i++) {
    if (!titleArr[i] && !bodyArr[i]) continue;
    clauses.push({ title: titleArr[i] || `Clause ${i + 1}`, body: bodyArr[i] || '' });
  }
  return clauses;
}

function parseParties(body) {
  const roleArr = [].concat(body.party_roles || []);
  const nameArr = [].concat(body.party_names || []);
  const phoneArr = [].concat(body.party_phones || []);
  const parties = [];
  for (let i = 0; i < roleArr.length; i++) {
    if (!roleArr[i] && !nameArr[i]) continue;
    parties.push({ role: roleArr[i] || 'Party', name: nameArr[i] || '', phone: phoneArr[i] || '' });
  }
  return parties;
}

// LIST
router.get('/', (req, res) => {
  const { q, from, to, status } = req.query;
  let sql = 'SELECT * FROM documents WHERE doc_type = ?';
  const params = [docType];
  if (q) { sql += ' AND (doc_number LIKE ? OR verification_code LIKE ? OR customer_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (from) { sql += ' AND date(issue_date) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(issue_date) <= date(?)'; params.push(to); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC LIMIT 200';
  const documents = db.prepare(sql).all(...params);
  res.render('agreements/list', { documents, query: req.query, config });
});

// NEW
router.get('/new', (req, res) => {
  res.render('agreements/form', {
    doc: null, items: [], clauses: [{ title: '', body: '' }],
    parties: [{ role: 'Client', name: '', phone: '' }, { role: 'Contractor', name: '', phone: '' }],
    config
  });
});

// CREATE
router.post('/', (req, res) => {
  const { customer_name, customer_phone, customer_address, notes, status, effective_date } = req.body;
  const { items, total } = parseItems(req.body);
  const clauses = parseClauses(req.body);
  const parties = parseParties(req.body);
  const finalStatus = config.statuses.includes(status) ? status : config.defaultStatus;
  const clientId = findOrCreateClient(customer_name, customer_phone, customer_address);
  const docNumber = nextDocNumber(docType);
  const verificationCode = generateVerificationCode();

  const docId = db.runInTransaction(() => {
    const info = db.prepare(`INSERT INTO documents
      (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
       notes, status, total, effective_date, parties, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(docType, docNumber, verificationCode, clientId, customer_name, customer_phone || null, customer_address || null,
        notes || null, finalStatus, total, effective_date || null, JSON.stringify(parties), req.session.user.id);
    const id = info.lastInsertRowid;
    if (items.length) {
      const itemStmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
      for (const it of items) itemStmt.run(id, it.description, it.quantity, it.unit_price, it.line_total);
    }
    const clauseStmt = db.prepare('INSERT INTO document_clauses (document_id, position, title, body) VALUES (?,?,?,?)');
    clauses.forEach((c, idx) => clauseStmt.run(id, idx, c.title, c.body));
    return id;
  });

  logActivity(req.session.user.id, 'agreement_created', docType, docId, { docNumber, status: finalStatus });
  res.redirect(`/agreements/${docId}`);
});

// VIEW
router.get('/:id', (req, res) => {
  const data = getAgreementFull(req.params.id);
  if (!data) return res.status(404).render('error', { message: 'Agreement not found.' });
  res.render('agreements/show', { doc: data.doc, items: data.items, clauses: data.clauses, parties: data.parties, config });
});

// EDIT
router.get('/:id/edit', (req, res) => {
  const data = getAgreementFull(req.params.id);
  if (!data) return res.status(404).render('error', { message: 'Agreement not found.' });
  if (config.lockedStatuses.includes(data.doc.status)) {
    return res.status(403).render('error', { message: 'This agreement is locked and can no longer be edited.' });
  }
  res.render('agreements/form', {
    doc: data.doc,
    items: data.items.length ? data.items : [],
    clauses: data.clauses.length ? data.clauses : [{ title: '', body: '' }],
    parties: data.parties.length ? data.parties : [{ role: 'Client', name: '', phone: '' }, { role: 'Contractor', name: '', phone: '' }],
    config
  });
});

// UPDATE
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(req.params.id, docType);
  if (!existing) return res.status(404).render('error', { message: 'Agreement not found.' });
  if (config.lockedStatuses.includes(existing.status)) {
    return res.status(403).render('error', { message: 'This agreement can no longer be edited.' });
  }
  const { customer_name, customer_phone, customer_address, notes, status, effective_date } = req.body;
  const { items, total } = parseItems(req.body);
  const clauses = parseClauses(req.body);
  const parties = parseParties(req.body);
  const finalStatus = config.statuses.includes(status) ? status : existing.status;
  const clientId = findOrCreateClient(customer_name, customer_phone, customer_address);

  db.runInTransaction(() => {
    db.prepare(`UPDATE documents SET customer_name=?, customer_phone=?, customer_address=?, notes=?, status=?, total=?,
      client_id=?, effective_date=?, parties=?, updated_at=datetime('now') WHERE id=?`)
      .run(customer_name, customer_phone || null, customer_address || null, notes || null, finalStatus, total,
        clientId, effective_date || null, JSON.stringify(parties), req.params.id);
    db.prepare('DELETE FROM document_items WHERE document_id = ?').run(req.params.id);
    if (items.length) {
      const itemStmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
      for (const it of items) itemStmt.run(req.params.id, it.description, it.quantity, it.unit_price, it.line_total);
    }
    db.prepare('DELETE FROM document_clauses WHERE document_id = ?').run(req.params.id);
    const clauseStmt = db.prepare('INSERT INTO document_clauses (document_id, position, title, body) VALUES (?,?,?,?)');
    clauses.forEach((c, idx) => clauseStmt.run(req.params.id, idx, c.title, c.body));
  });

  logActivity(req.session.user.id, 'agreement_edited', docType, req.params.id, { status: finalStatus });
  res.redirect(`/agreements/${req.params.id}`);
});

// VOID
router.post('/:id/void', (req, res) => {
  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(req.params.id, docType);
  if (!existing) return res.status(404).render('error', { message: 'Agreement not found.' });
  db.prepare(`UPDATE documents SET status='void', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logActivity(req.session.user.id, 'agreement_voided', docType, req.params.id, null);
  res.redirect(`/agreements/${req.params.id}`);
});

// DUPLICATE
router.post('/:id/duplicate', (req, res) => {
  const data = getAgreementFull(req.params.id);
  if (!data) return res.status(404).render('error', { message: 'Agreement not found.' });
  const { doc, items, clauses } = data;
  const docNumber = nextDocNumber(docType);
  const verificationCode = generateVerificationCode();

  const newId = db.runInTransaction(() => {
    const info = db.prepare(`INSERT INTO documents
      (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
       notes, status, total, effective_date, parties, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(docType, docNumber, verificationCode, doc.client_id, doc.customer_name, doc.customer_phone, doc.customer_address,
        doc.notes, config.defaultStatus, doc.total, doc.effective_date, doc.parties, req.session.user.id);
    const id = info.lastInsertRowid;
    if (items.length) {
      const itemStmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
      for (const it of items) itemStmt.run(id, it.description, it.quantity, it.unit_price, it.line_total);
    }
    const clauseStmt = db.prepare('INSERT INTO document_clauses (document_id, position, title, body) VALUES (?,?,?,?)');
    clauses.forEach((c, idx) => clauseStmt.run(id, idx, c.title, c.body));
    return id;
  });

  logActivity(req.session.user.id, 'agreement_duplicated', docType, newId, { from: doc.doc_number });
  res.redirect(`/agreements/${newId}/edit`);
});

// PDF
router.get('/:id/pdf', async (req, res) => {
  const data = getAgreementFull(req.params.id);
  if (!data) return res.status(404).render('error', { message: 'Agreement not found.' });
  const company = getCompany();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const duplicate = req.query.duplicate === '1';
  if (duplicate) logActivity(req.session.user.id, 'agreement_reprinted', docType, data.doc.id, null);
  await buildDocumentPDF({
    res, company, doc: data.doc, items: data.items, baseUrl, duplicate,
    docType, config, clauses: data.clauses, parties: data.parties
  });
});

module.exports = router;
