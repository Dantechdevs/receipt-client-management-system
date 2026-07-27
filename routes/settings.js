const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../lib/helpers');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG/JPEG/WEBP images are allowed'), ok);
  }
});

router.use(requireAuth);

router.get('/', requireRole('admin'), (req, res) => {
  const company = db.prepare('SELECT * FROM company WHERE id = 1').get();
  res.render('settings/index', { company, error: null, saved: req.query.saved === '1' });
});

router.post('/', requireRole('admin'), upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'stamp', maxCount: 1 },
  { name: 'signature', maxCount: 1 }
]), (req, res) => {
  const { name, address, phone, email, footer_message, currency,
    quotation_prefix, invoice_prefix, receipt_prefix, agreement_prefix,
    default_tax_rate, default_tax_label } = req.body;
  const company = db.prepare('SELECT * FROM company WHERE id = 1').get();

  const logoPath = req.files['logo'] ? `/uploads/${req.files['logo'][0].filename}` : company.logo_path;
  const stampPath = req.files['stamp'] ? `/uploads/${req.files['stamp'][0].filename}` : company.stamp_path;
  const signaturePath = req.files['signature'] ? `/uploads/${req.files['signature'][0].filename}` : company.signature_path;

  db.prepare(`UPDATE company SET name=?, address=?, phone=?, email=?, footer_message=?, currency=?,
    quotation_prefix=?, invoice_prefix=?, receipt_prefix=?, agreement_prefix=?,
    default_tax_rate=?, default_tax_label=?,
    logo_path=?, stamp_path=?, signature_path=? WHERE id = 1`)
    .run(name, address || null, phone || null, email || null, footer_message || null, currency || 'KES',
      quotation_prefix || 'QT', invoice_prefix || 'INV', receipt_prefix || 'RCP', agreement_prefix || 'AGR',
      parseFloat(default_tax_rate) || 0, (default_tax_label || 'VAT').trim() || 'VAT',
      logoPath, stampPath, signaturePath);

  logActivity(req.session.user.id, 'settings_updated', 'company', 1, null);
  res.redirect('/settings?saved=1');
});

module.exports = router;
