const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const methodOverride = require('method-override');
const path = require('path');

require('./db/db'); // init db

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));
// Uploaded logos/stamps/signatures are stored with a bare "/uploads/..." path
// (matching the filesystem layout PDFs read directly from disk), so serve
// that same folder at the root "/uploads" URL for <img> tags in the browser.
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Public marketing site (jamarian-website), served at the domain root.
// Its pages/assets (index.html, about.html, /assets/css/style.css, etc.)
// live under public/site and don't collide with any app route below, since
// none of the app's routers register those paths. Requests to "/" resolve
// to public/site/index.html automatically. This must be mounted BEFORE the
// auth/dashboard routers so the marketing homepage wins at "/" instead of
// the app's login/dashboard redirect.
app.use(express.static(path.join(__dirname, 'public', 'site')));

app.use(session({
  store: new FileStore({ path: path.join(__dirname, 'db', 'sessions') }),
  secret: 'receipt-system-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));


app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.path = req.path;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/api', require('./routes/public-api'));
app.use('/gallery', require('./routes/gallery'));
app.use('/quotations', require('./routes/quotations'));
app.use('/invoices', require('./routes/invoices'));
app.use('/receipts', require('./routes/receipts'));
app.use('/agreements', require('./routes/agreements'));
app.use('/clients', require('./routes/clients'));
app.use('/settings', require('./routes/settings'));
app.use('/verify', require('./routes/verify'));
app.use('/reports', require('./routes/reports'));
app.use('/users', require('./routes/users'));

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`Receipt & Client Management System running on http://localhost:${PORT}`);
});
