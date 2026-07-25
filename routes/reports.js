const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { fmtMoney } = require('../lib/helpers');
const { DOC_CONFIG } = require('../lib/doc-config');

router.use(requireAuth);

function getDocsInRange(docType, period, from, to) {
  let sql = `SELECT d.* FROM documents d WHERE d.doc_type = ?`;
  const params = [docType];
  if (period === 'daily') {
    sql += ` AND date(d.issue_date) = date('now')`;
  } else if (period === 'weekly') {
    sql += ` AND d.issue_date >= date('now','-6 days')`;
  } else if (period === 'monthly') {
    sql += ` AND strftime('%Y-%m', d.issue_date) = strftime('%Y-%m','now')`;
  } else if (from || to) {
    if (from) { sql += ` AND date(d.issue_date) >= date(?)`; params.push(from); }
    if (to) { sql += ` AND date(d.issue_date) <= date(?)`; params.push(to); }
  }
  sql += ' ORDER BY d.issue_date DESC';
  return db.prepare(sql).all(...params);
}

router.get('/', (req, res) => {
  const { period, from, to } = req.query;
  const docType = ['quotation', 'invoice', 'receipt', 'agreement'].includes(req.query.docType) ? req.query.docType : 'receipt';
  const config = DOC_CONFIG[docType];
  const documents = (period || from || to) ? getDocsInRange(docType, period, from, to) : [];
  const finalStatuses = { quotation: 'accepted', invoice: 'paid', receipt: 'final', agreement: 'active' };
  const revenue = documents.filter(d => d.status === finalStatuses[docType]).reduce((s, d) => s + d.total, 0);

  const clientReport = db.prepare(`
    SELECT c.name, c.phone,
      COUNT(d.id) as doc_count,
      COALESCE(SUM(CASE WHEN d.doc_type='receipt' AND d.status='final' THEN d.total ELSE 0 END),0) as total_spent
    FROM clients c LEFT JOIN documents d ON d.client_id = c.id
    GROUP BY c.id ORDER BY total_spent DESC LIMIT 50`).all();

  const verificationStats = db.prepare(
    `SELECT status, COUNT(*) as count FROM documents WHERE doc_type = ? GROUP BY status`).all(docType);

  res.render('reports/index', {
    documents, revenue, period: period || '', from: from || '', to: to || '',
    clientReport, verificationStats, docType, config,
    docTypes: ['quotation', 'invoice', 'receipt', 'agreement'].map(t => ({ value: t, label: DOC_CONFIG[t].labelPlural }))
  });
});

router.get('/export/excel', (req, res) => {
  const { period, from, to } = req.query;
  const docType = ['quotation', 'invoice', 'receipt', 'agreement'].includes(req.query.docType) ? req.query.docType : 'receipt';
  const documents = getDocsInRange(docType, period, from, to);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(DOC_CONFIG[docType].labelPlural);
  sheet.columns = [
    { header: 'Doc No', key: 'doc_number', width: 20 },
    { header: 'Date', key: 'issue_date', width: 20 },
    { header: 'Client', key: 'customer_name', width: 25 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Verification Code', key: 'verification_code', width: 18 },
    { header: 'Total', key: 'total', width: 15 }
  ];
  documents.forEach(d => sheet.addRow(d));
  sheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${docType}s-report.xlsx"`);
  workbook.xlsx.write(res).then(() => res.end());
});

router.get('/export/pdf', (req, res) => {
  const { period, from, to } = req.query;
  const docType = ['quotation', 'invoice', 'receipt', 'agreement'].includes(req.query.docType) ? req.query.docType : 'receipt';
  const documents = getDocsInRange(docType, period, from, to);
  const finalStatuses = { quotation: 'accepted', invoice: 'paid', receipt: 'final', agreement: 'active' };
  const revenue = documents.filter(d => d.status === finalStatuses[docType]).reduce((s, d) => s + d.total, 0);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${docType}s-report.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).text(`${DOC_CONFIG[docType].labelPlural} Report`, { align: 'left' });
  doc.fontSize(10).fillColor('#475569').text(`Generated: ${new Date().toLocaleString('en-GB')}`);
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#0f172a').text(`Total Value: KES ${fmtMoney(revenue)}`);
  doc.text(`Total ${DOC_CONFIG[docType].labelPlural}: ${documents.length}`);
  doc.moveDown();

  doc.fontSize(9).fillColor('#0f172a');
  documents.forEach(d => {
    doc.text(`${d.doc_number}  |  ${new Date(d.issue_date).toLocaleDateString('en-GB')}  |  ${d.customer_name}  |  ${d.status.toUpperCase()}  |  KES ${fmtMoney(d.total)}`);
  });

  doc.end();
});

module.exports = router;
