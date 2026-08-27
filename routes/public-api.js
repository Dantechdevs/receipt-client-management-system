const express = require('express');
const router = express.Router();
const db = require('../db/db');

// No auth — this powers the public marketing homepage's "Recent Work" gallery.
router.get('/gallery', (req, res) => {
  const photos = db.prepare('SELECT image_path, caption FROM gallery_photos ORDER BY sort_order ASC, id ASC').all();
  res.json(photos);
});

module.exports = router;
