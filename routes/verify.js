const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { DOC_CONFIG } = require('../lib/doc-config');

// Simple in-memory rate limiter per IP for the verification search
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxAttempts = 20;
  const rec = attempts.get(ip) || { count: 0, start: now };
  if (now - rec.start > windowMs) {
    attempts.set(ip, { count: 1, start: now });
    return false;
  }
  rec.count += 1;
  attempts.set(ip, rec);
  return rec.count > maxAttempts;
}

router.get('/', (req, res) => {
  const { q, code } = req.query;
  const searchTerm = q || code;
  let doc = null;
  let searched = false;

  if (searchTerm) {
    searched = true;
    const ip = req.ip;
    if (rateLimited(ip)) {
      return res.status(429).render('verify', { doc: null, config: null, searched: true, error: 'Too many search attempts. Please try again in a minute.', searchTerm });
    }
    doc = db.prepare('SELECT * FROM documents WHERE doc_number = ? OR verification_code = ?').get(searchTerm.trim(), searchTerm.trim());
  }

  const config = doc ? DOC_CONFIG[doc.doc_type] : null;
  const company = db.prepare('SELECT name, logo_path FROM company WHERE id = 1').get();

  res.render('verify', { doc, config, company, searched, searchTerm: searchTerm || '', error: null });
});

module.exports = router;
