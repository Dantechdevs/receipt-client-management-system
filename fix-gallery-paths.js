// One-time fix: corrects gallery photo paths that were seeded with a stray
// "/site" prefix (e.g. "/site/assets/images/borehole.png" -> "/assets/images/borehole.png").
// Run with:  node fix-gallery-paths.js
// This only touches the gallery_photos table — nothing else in your database.

const db = require('./db/db');

const rows = db.prepare("SELECT id, image_path FROM gallery_photos WHERE image_path LIKE '/site/%'").all();

if (rows.length === 0) {
  console.log('Nothing to fix — no gallery photo paths start with /site/.');
} else {
  const update = db.prepare('UPDATE gallery_photos SET image_path = ? WHERE id = ?');
  rows.forEach((row) => {
    const fixed = row.image_path.replace(/^\/site/, '');
    update.run(fixed, row.id);
    console.log(row.image_path, '->', fixed);
  });
  console.log(`\nFixed ${rows.length} row(s). Restart your server and refresh the page.`);
}
