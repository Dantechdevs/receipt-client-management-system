const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { nextDocNumber, generateVerificationCode, logActivity, findOrCreateClient } = require('./helpers');
const { buildDocumentPDF } = require('./pdf');
const { DOC_CONFIG } = require('./doc-config');

function getCompany() {
  return db.prepare('SELECT * FROM company WHERE id = 1').get();
}

function getDocWithItems(docType, idOrNumber) {
  let doc = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(idOrNumber, docType);
  if (!doc) doc = db.prepare('SELECT * FROM documents WHERE doc_number = ? AND doc_type = ?').get(idOrNumber,docType);
  if (!doc) return null;
  const items = db.prepare('SELECT * FROM document_items WHERE document_id = ?').all(doc.id);
  return { doc, items };
}

function parseItemsFromBody(body) {
  const descArr = [].concat(body.descriptions || []);
  const qtyArr = [].concat(body.quantities || []);
  const priceArr = [].concat(body.unit_prices || []);
  const items = [];
  let subtotal = 0;
  for (let i = 0; i < descArr.length; i++) {
    if (!descArr[i]) continue;
    const qty = parseFloat(qtyArr[i]) || 0;
    const price = parseFloat(priceArr[i]) || 0;
    const lineTotal = qty * price;
    subtotal += lineTotal;
    items.push({ description: descArr[i], quantity: qty, unit_price: price, line_total: lineTotal });
  }

  const taxEnabled = body.apply_tax === 'on' || body.apply_tax === 'true';
  const taxRate = taxEnabled ? (parseFloat(body.tax_rate) || 0) : 0;
  const taxLabel = (body.tax_label || 'VAT').trim() || 'VAT';
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  return { items, subtotal, taxRate, taxLabel, taxAmount, total };
}

// Creates an Express router for a given document type (quotation | invoice | receipt).
// Agreements have a different enough shape (clauses, parties) that they get their own router.
function createDocumentRouter(docType) {
  const config = DOC_CONFIG[docType];
  const router = express.Router();
  router.use(requireAuth);

  // LIST + search/filter
  router.get('/', (req, res) => {
    const { q, from, to, status } = req.query;
    let sql = 'SELECT * FROM documents WHERE doc_type = ?';
    const params = [docType];
    if (q) {
      sql += ' AND (doc_number LIKE ? OR verification_code LIKE ? OR customer_name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (from) { sql += ' AND date(issue_date) >= date(?)'; params.push(from); }
    if (to) { sql += ' AND date(issue_date) <= date(?)'; params.push(to); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY id DESC LIMIT 200';
    const documents = db.prepare(sql).all(...params);
    res.render('documents/list', { documents, query: req.query, config, docType });
  });

  // NEW form
  router.get('/new', (req, res) => {
    const company = getCompany();
    res.render('documents/form', {
      doc: null, items: [{ description: '', quantity: 1, unit_price: 0 }],
      config, docType, company
    });
  });

  // CREATE
  router.post('/', (req, res) => {
    const { customer_name, customer_phone, customer_address, notes, status,
      valid_until, due_date, payment_status, payment_method } = req.body;
    const { items, subtotal, taxRate, taxLabel, taxAmount, total } = parseItemsFromBody(req.body);

    const finalStatus = config.statuses.includes(status) ? status : config.defaultStatus;
    const clientId = findOrCreateClient(customer_name, customer_phone, customer_address);
    const docNumber = nextDocNumber(docType);
    const verificationCode = generateVerificationCode();

    const docId = db.runInTransaction(() => {
      const info = db.prepare(`INSERT INTO documents
        (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
         notes, status, subtotal, tax_rate, tax_label, tax_amount, total, valid_until, due_date, payment_status, payment_method, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(docType, docNumber, verificationCode, clientId, customer_name, customer_phone || null, customer_address || null,
          notes || null, finalStatus, subtotal, taxRate, taxLabel, taxAmount, total,
          config.hasValidUntil ? (valid_until || null) : null,
          config.hasDueDate ? (due_date || null) : null,
          config.hasPaymentStatus ? (payment_status || 'unpaid') : null,
          config.hasPaymentMethod ? (payment_method || null) : null,
          req.session.user.id);
      const id = info.lastInsertRowid;
      const stmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
      for (const it of items) stmt.run(id, it.description, it.quantity, it.unit_price, it.line_total);
      return id;
    });

    logActivity(req.session.user.id, `${docType}_created`, docType, docId, { docNumber, status: finalStatus, total });
    res.redirect(`${config.basePath}/${docId}`);
  });

  // VIEW
  router.get('/:id', (req, res) => {
    const data = getDocWithItems(docType, req.params.id);
    if (!data) return res.status(404).render('error', { message: `${config.label} not found.` });
    let convertedFrom = null, convertedTo = null;
    if (data.doc.converted_from_id) convertedFrom = db.prepare('SELECT * FROM documents WHERE id = ?').get(data.doc.converted_from_id);
    if (data.doc.converted_to_id) convertedTo = db.prepare('SELECT * FROM documents WHERE id = ?').get(data.doc.converted_to_id);
    res.render('documents/show', { doc: data.doc, items: data.items, config, docType, convertedFrom, convertedTo });
  });

  // EDIT form (only if not locked)
  router.get('/:id/edit', (req, res) => {
    const data = getDocWithItems(docType, req.params.id);
    if (!data) return res.status(404).render('error', { message: `${config.label} not found.` });
    if (config.lockedStatuses.includes(data.doc.status)) {
      return res.status(403).render('error', { message: `This ${config.label.toLowerCase()} is ${data.doc.status} and can no longer be edited.` });
    }
    const company = getCompany();
    res.render('documents/form', {
      doc: data.doc, items: data.items.length ? data.items : [{ description: '', quantity: 1, unit_price: 0 }],
      config, docType, company
    });
  });

  // UPDATE
  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(req.params.id, docType);
    if (!existing) return res.status(404).render('error', { message: `${config.label} not found.` });
    if (config.lockedStatuses.includes(existing.status)) {
      return res.status(403).render('error', { message: `This ${config.label.toLowerCase()} can no longer be edited.` });
    }
    const { customer_name, customer_phone, customer_address, notes, status,
      valid_until, due_date, payment_status, payment_method } = req.body;
    const { items, subtotal, taxRate, taxLabel, taxAmount, total } = parseItemsFromBody(req.body);
    const finalStatus = config.statuses.includes(status) ? status : existing.status;
    const clientId = findOrCreateClient(customer_name, customer_phone, customer_address);

    db.runInTransaction(() => {
      db.prepare(`UPDATE documents SET customer_name=?, customer_phone=?, customer_address=?, notes=?, status=?,
        subtotal=?, tax_rate=?, tax_label=?, tax_amount=?, total=?,
        client_id=?, valid_until=?, due_date=?, payment_status=?, payment_method=?, updated_at=datetime('now') WHERE id=?`)
        .run(customer_name, customer_phone || null, customer_address || null, notes || null, finalStatus,
          subtotal, taxRate, taxLabel, taxAmount, total, clientId,
          config.hasValidUntil ? (valid_until || null) : null,
          config.hasDueDate ? (due_date || null) : null,
          config.hasPaymentStatus ? (payment_status || 'unpaid') : null,
          config.hasPaymentMethod ? (payment_method || null) : null,
          req.params.id);
      db.prepare('DELETE FROM document_items WHERE document_id = ?').run(req.params.id);
      const stmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
      for (const it of items) stmt.run(req.params.id, it.description, it.quantity, it.unit_price, it.line_total);
    });

    logActivity(req.session.user.id, `${docType}_edited`, docType, req.params.id, { status: finalStatus, total });
    res.redirect(`${config.basePath}/${req.params.id}`);
  });

  // VOID
  router.post('/:id/void', (req, res) => {
    const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(req.params.id, docType);
    if (!existing) return res.status(404).render('error', { message: `${config.label} not found.` });
    db.prepare(`UPDATE documents SET status='void', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
    logActivity(req.session.user.id, `${docType}_voided`, docType, req.params.id, null);
    res.redirect(`${config.basePath}/${req.params.id}`);
  });

  // DUPLICATE
  router.post('/:id/duplicate', (req, res) => {
    const data = getDocWithItems(docType, req.params.id);
    if (!data) return res.status(404).render('error', { message: `${config.label} not found.` });
    const { doc, items } = data;
    const docNumber = nextDocNumber(docType);
    const verificationCode = generateVerificationCode();

    const newId = db.runInTransaction(() => {
      const info = db.prepare(`INSERT INTO documents
        (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
         notes, status, subtotal, tax_rate, tax_label, tax_amount, total, valid_until, due_date, payment_status, payment_method, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(docType, docNumber, verificationCode, doc.client_id, doc.customer_name, doc.customer_phone, doc.customer_address,
          doc.notes, config.defaultStatus, doc.subtotal, doc.tax_rate, doc.tax_label, doc.tax_amount, doc.total,
          doc.valid_until, doc.due_date, doc.payment_status, doc.payment_method,
          req.session.user.id);
      const id = info.lastInsertRowid;
      const stmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
      for (const it of items) stmt.run(id, it.description, it.quantity, it.unit_price, it.line_total);
      return id;
    });

    logActivity(req.session.user.id, `${docType}_duplicated`, docType, newId, { from: doc.doc_number });
    res.redirect(`${config.basePath}/${newId}/edit`);
  });

  // CONVERT (e.g. quotation -> invoice, invoice -> receipt)
  if (config.convertsTo) {
    router.post('/:id/convert', (req, res) => {
      const data = getDocWithItems(docType, req.params.id);
      if (!data) return res.status(404).render('error', { message: `${config.label} not found.` });
      const { doc, items } = data;
      const targetType = config.convertsTo;
      const targetConfig = DOC_CONFIG[targetType];

      if (doc.converted_to_id) {
        return res.redirect(`${targetConfig.basePath}/${doc.converted_to_id}`);
      }

      const docNumber = nextDocNumber(targetType);
      const verificationCode = generateVerificationCode();

      const newId = db.runInTransaction(() => {
        const info = db.prepare(`INSERT INTO documents
          (doc_type, doc_number, verification_code, client_id, customer_name, customer_phone, customer_address,
           notes, status, subtotal, tax_rate, tax_label, tax_amount, total, converted_from_id, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(targetType, docNumber, verificationCode, doc.client_id, doc.customer_name, doc.customer_phone,doc.customer_address,
            doc.notes, targetConfig.defaultStatus, doc.subtotal, doc.tax_rate, doc.tax_label, doc.tax_amount,doc.total, doc.id, req.session.user.id);
        const id = info.lastInsertRowid;
        const stmt = db.prepare('INSERT INTO document_items (document_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?)');
        for (const it of items) stmt.run(id, it.description, it.quantity, it.unit_price, it.line_total);
        db.prepare('UPDATE documents SET converted_to_id = ? WHERE id = ?').run(id, doc.id);
        return id;
      });

      logActivity(req.session.user.id, `${docType}_converted_to_${targetType}`, targetType, newId, { from: doc.doc_number });
      res.redirect(`${targetConfig.basePath}/${newId}/edit`);
    });
  }

  // PDF
  router.get('/:id/pdf', async (req, res) => {
    const data = getDocWithItems(docType, req.params.id);
    if (!data) return res.status(404).render('error', { message: `${config.label} not found.` });
    const company = getCompany();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const duplicate = req.query.duplicate === '1';
    if (duplicate) logActivity(req.session.user.id, `${docType}_reprinted`, docType, data.doc.id, null);
    // Clauses (e.g. Payment Terms) and parties (Client/Contractor signature blocks) are
    // stored generically on document_clauses / documents.parties for any doc_type — not
    // agreement-only despite the schema comment — so quotations can use them too.
    const clauses = db.prepare('SELECT * FROM document_clauses WHERE document_id = ? ORDER BY position').all(data.doc.id);
    const parties = data.doc.parties ? JSON.parse(data.doc.parties) : [];
    await buildDocumentPDF({ res, company, doc: data.doc, items: data.items, baseUrl, duplicate, docType, config, clauses, parties });
  });

  return router;
}

module.exports = { createDocumentRouter, getDocWithItems, parseItemsFromBody, getCompany };
