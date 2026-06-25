# Receipt & Client Management System

A full-stack receipt and client management web app: company branding, receipt creation with
auto-generated verification codes and QR codes, client tracking, a dashboard, reports, and
role-based user accounts. Built by **Dantechdevs Developers** ([dantechdevelopers.com](https://dantechdevelopers.com)).

## Features

- **Company Settings** — logo, stamp, signature upload; name, address, contact info, receipt footer
- **Receipt Creation** — auto-generated receipt number (`RCP-2026-000125`), unique verification code, line items with automatic totals, draft/final status
- **Receipt Printing** — professional A4 PDF layout with logo, stamp, signature, QR code; print preview and duplicate copies
- **Client Management** — clients are auto-created from receipts, searchable, with full transaction history and total spend
- **Receipt Management** — search by receipt number/verification code/client name, filter by date range, reprint, edit drafts, duplicate
- **Verification System** — public verification page + QR code that resolves to it, so anyone can confirm a receipt is genuine
- **Dashboard** — totals, daily/monthly revenue, recent receipts and clients
- **Reports** — daily/weekly/monthly/custom range, revenue and client reports, export to Excel and PDF
- **User Accounts & Roles** — Administrator vs Receptionist/Cashier, activity logs for logins, receipt creation/edits
- **Security** — hashed passwords, session-based auth, role-based access control, rate-limited public verification lookup, drafts-only editing (finalized receipts are locked)

## Tech Stack

- Node.js + Express
- SQLite (via `better-sqlite3`) — a single-file database, no separate DB server needed
- EJS server-rendered views
- `pdfkit` for PDF generation, `qrcode` for QR codes, `exceljs` for Excel exports

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Create the database and seed demo accounts
npm run seed

# 3. Start the server
npm start
```

The app runs at **http://localhost:3000**.

### Demo logins (created by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Administrator | admin@example.com | Admin@123 |
| Receptionist/Cashier | cashier@example.com | Cashier@123 |

**Change these passwords immediately in a real deployment**, or create your own admin user directly
in `db/seed.js` before running it.

## First steps after install

1. Log in as Administrator → **Company Settings** → upload your logo, stamp, and signature, and fill in your company details.
2. Go to **Receipts → New Receipt** to create your first receipt.
3. Open the receipt and click **Download PDF** to see the printable A4 layout with the QR verification code.
4. Scan the QR code (or visit `/verify` and enter the receipt number/code) to see the public verification page.

## Data & Backups

All data lives in a single SQLite file at `db/data.sqlite` (created on first run). To back up, simply
copy that file while the app is stopped (or use SQLite's online backup tooling for a hot backup).
Session data is stored separately in `db/sessions.sqlite`.

## Project Structure

```
receipt-system/
├── server.js              # Express app entry point
├── db/
│   ├── db.js               # SQLite schema + connection
│   └── seed.js             # Creates demo admin/cashier accounts
├── lib/
│   ├── helpers.js           # Receipt numbering, verification codes, activity logging
│   └── pdf.js                # A4 receipt PDF generation
├── middleware/
│   └── auth.js               # Session auth + role guards
├── routes/                    # auth, dashboard, receipts, clients, settings, verify, reports, users
├── views/                     # EJS templates
└── public/                    # CSS + uploaded logos/stamps/signatures
```

## Notes on scope

This is a complete, working MVP covering every module in the spec. A few things were intentionally
kept simple and are easy to extend:

- **Password reset** shows the reset link directly in the browser instead of emailing it (no mail
  server is configured). Wire up an email provider (e.g. SendGrid, SES) in `routes/auth.js` to send it for real.
- **Payment method / partial payments** were left out of this pass per your request to keep receipts simple — the schema (`receipts` table) can take a `payment_method` and `amount_paid` column later without breaking anything.
- **Backup/restore** is manual (copy the SQLite file) rather than a UI button — straightforward to add as a scheduled job.

---
Developed by [Dantechdevs Developers](https://dantechdevelopers.com)
