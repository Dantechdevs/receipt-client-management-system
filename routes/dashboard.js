const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

// Note: "/" is now served by the marketing site's index.html (see the
// express.static mount for public/site in server.js), which is registered
// before this router. This route is kept only as a fallback in case that
// static mount is ever removed.
router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect('/dashboard');
});

router.get('/dashboard', requireAuth, (req, res) => {
  const totalClients = db.prepare('SELECT COUNT(*) c FROM clients').get().c;

  const docCounts = {};
  ['quotation', 'invoice', 'receipt', 'agreement'].forEach(t => {
    docCounts[t] = db.prepare('SELECT COUNT(*) c FROM documents WHERE doc_type = ?').get(t).c;
  });

  const totalRevenue = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM documents WHERE doc_type='receipt' AND status = 'final'`).get().s;
  const monthRevenue = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM documents WHERE doc_type='receipt' AND status='final' AND strftime('%Y-%m', issue_date) = strftime('%Y-%m', 'now')`).get().s;
  const outstandingInvoices = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM documents WHERE doc_type='invoice' AND payment_status != 'paid' AND status != 'void'`).get().s;

  const dailySummary = db.prepare(`
    SELECT date(issue_date) as day, COALESCE(SUM(total),0) as revenue, COUNT(*) as count
    FROM documents WHERE doc_type='receipt' AND status='final' AND issue_date >= date('now','-6 days')
    GROUP BY day ORDER BY day ASC`).all();

  const monthlySummary = db.prepare(`
    SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total),0) as revenue, COUNT(*) as count
    FROM documents WHERE doc_type='receipt' AND status='final' AND issue_date >= date('now','-5 months','start of month')
    GROUP BY month ORDER BY month ASC`).all();

  const recentDocuments = db.prepare('SELECT * FROM documents ORDER BY id DESC LIMIT 8').all();
  const recentClients = db.prepare('SELECT * FROM clients ORDER BY id DESC LIMIT 8').all();

  res.render('dashboard', {
    totalClients, docCounts, totalRevenue, monthRevenue, outstandingInvoices,
    dailySummary, monthlySummary, recentDocuments, recentClients
  });
});

module.exports = router;
