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
    cb(null, `gallery-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG/JPEG/WEBP images are allowed'), ok);
  }
});

router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/', (req, res) => {
  const photos = db.prepare('SELECT * FROM gallery_photos ORDER BY sort_order ASC, id ASC').all();
  res.render('gallery/list', { photos, error: req.query.error || null });
});

router.post('/', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.redirect('/gallery?error=' + encodeURIComponent('Please choose a photo to upload.'));
  }
  const { caption } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM gallery_photos').get().m;
  db.prepare('INSERT INTO gallery_photos (image_path, caption, sort_order) VALUES (?, ?, ?)')
    .run(`/uploads/${req.file.filename}`, (caption || '').trim(), maxOrder + 1);
  logActivity(req.session.user.id, 'gallery_photo_added', 'gallery_photos', null, { caption });
  res.redirect('/gallery');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM gallery_photos WHERE id = ?').run(req.params.id);
  logActivity(req.session.user.id, 'gallery_photo_deleted', 'gallery_photos', req.params.id, null);
  res.redirect('/gallery');
});

// Move a photo up (-1) or down (+1) in display order by swapping sort_order
// with its neighbor.
router.post('/:id/move', (req, res) => {
  const direction = req.body.direction === 'up' ? -1 : 1;
  const photos = db.prepare('SELECT * FROM gallery_photos ORDER BY sort_order ASC, id ASC').all();
  const index = photos.findIndex(p => p.id === Number(req.params.id));
  const swapIndex = index + direction;
  if (index === -1 || swapIndex < 0 || swapIndex >= photos.length) {
    return res.redirect('/gallery');
  }
  const a = photos[index], b = photos[swapIndex];
  db.runInTransaction(() => {
    db.prepare('UPDATE gallery_photos SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
    db.prepare('UPDATE gallery_photos SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  });
  res.redirect('/gallery');
});

module.exports = router;
