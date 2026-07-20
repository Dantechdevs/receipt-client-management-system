const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../lib/helpers');

router.use(requireAuth);

router.get('/', (req, res) => {
  const { q } = req.query;
  let sql = `SELECT c.*,
    (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id AND d.doc_type = 'receipt' AND d.status != 'void') AS receipt_count,
    (SELECT COALESCE(SUM(total),0) FROM documents d WHERE d.client_id = c.id AND d.doc_type = 'receipt' AND d.status = 'final') AS total_spent,
    (SELECT MAX(issue_date) FROM documents d WHERE d.client_id = c.id) AS last_activity
    FROM clients c WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ' AND (c.name LIKE ? OR c.phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY c.created_at DESC LIMIT 200';
  const clients = db.prepare(sql).all(...params);
  res.render('clients/list', { clients, query: req.query });
});

router.get('/:id', (req, res) => {
  const clientRecord = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!clientRecord) return res.status(404).render('error', { message: 'Client not found.' });
  const documents = db.prepare('SELECT * FROM documents WHERE client_id = ? ORDER BY id DESC').all(req.params.id);
  const totalSpent = documents.filter(d => d.doc_type === 'receipt' && d.status === 'final').reduce((s, d) => s + d.total, 0);
  const counts = {
    quotation: documents.filter(d => d.doc_type === 'quotation').length,
    invoice: documents.filter(d => d.doc_type === 'invoice').length,
    receipt: documents.filter(d => d.doc_type === 'receipt').length,
    agreement: documents.filter(d => d.doc_type === 'agreement').length
  };
  res.render('clients/show', { clientRecord, documents, totalSpent, counts });
});

router.get('/:id/edit', (req, res) => {
  const clientRecord = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!clientRecord) return res.status(404).render('error', { message: 'Client not found.' });
  res.render('clients/form', { clientRecord });
});

router.put('/:id', (req, res) => {
  const { name, phone, address } = req.body;
  db.prepare('UPDATE clients SET name = ?, phone = ?, address = ? WHERE id = ?').run(name, phone || null, address || null, req.params.id);
  logActivity(req.session.user.id, 'client_edited', 'client', req.params.id, null);
  res.redirect(`/clients/${req.params.id}`);
});

module.exports = router;
