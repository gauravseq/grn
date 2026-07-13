# GRN Desk — MERN

Multi-user Goods Received Note manager on the **MERN** stack: **MongoDB, Express, React, Node** — with live sync, role-based logins, an Excel catalog that fuzzy-matches vendor PDFs, and Expected-vs-Received reconciliation.

## Features

- **Logins + roles** — `dock` receive goods; `purchase` review/close/delete and edit the catalog; `admin` also manages users.
- **Shared, live** — several people on the same GRN at once; updates push over websockets (Socket.IO).
- **Excel catalog + PDF matching** — keep one workbook (Products + racks + aliases, Racks, Vendors). On import, each PDF/paste line is matched to a catalog product (exact, alias, or close spelling), pulling the clean name + rack. New items are flagged and can be added back to the catalog.
- **Add-to-quantity** — re-adding an item stacks onto its line (no duplicates); every partial unload is logged.
- **Expected vs Received** — imported list = expected; goods received = received; each line and the totals show short / over / matched.
- **Print + CSV** for the Purchase hand-off.

## Stack / layout

```
server/                 Express + Mongoose + Socket.IO
  index.js              app entry (also serves the built client)
  db.js                 mongoose connection
  models/               User, Counter, Vendor, Product (catalog), Grn (lines embedded)
  middleware/auth.js    JWT + role guards
  routes/               auth, grns, masters, users
  seed.js               first admin + sample data
  e2e-test.js           full API test on in-memory MongoDB
client/                 React (Vite)
  src/
    App.jsx             top-level state, socket, routing
    match.js            catalog matching, PDF/paste parsing, Excel read/write
    api.js              fetch wrapper + toasts
    components/         Login, Dashboard, Editor, ImportModal, MasterModal, UsersModal
```

pdf.js and SheetJS load from CDN in `client/index.html`, so the Vite bundle stays small.

## Requirements

- Node.js 18+
- MongoDB 6+ (a `docker-compose.yml` is included for local use)

## Run it locally (development)

Two processes — the API (:5000) and the Vite dev server (:5173, which proxies `/api` and the websocket to :5000).

```bash
npm run install:all        # installs server + client deps
docker compose up -d       # starts MongoDB (or point MONGODB_URI at your own)
cp .env.example .env        # then change JWT_SECRET
npm run seed               # creates the first admin (admin / admin123 by default)
npm run dev                # runs API + client together
```

Open http://localhost:5173. Log in as `admin` / `admin123`, change the password (top bar), then add dock/purchase users under **Users**, and load your catalog under **Master data**.

## Run it as one service (production)

```bash
npm run install:all
npm run build              # builds the React client into client/dist
cp .env.example .env        # set MONGODB_URI, JWT_SECRET, ADMIN_*
npm run seed
npm start                  # Express serves the API AND the built client on PORT (5000)
```

Open http://localhost:5000.

## Deploy

Any host that runs Node + MongoDB — Render, Railway, Fly.io, or a VM; use MongoDB Atlas for a managed database (free tier is plenty for a small team).

1. Create a MongoDB Atlas cluster; copy its connection string.
2. Deploy this repo as a web service with build `npm run install:all && npm run build` and start `npm start`.
3. Set env vars: `MONGODB_URI`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (`PORT` is usually provided).
4. Run `npm run seed` once against production (one-off job/console).

**LAN-only?** Run the production steps on a machine on your warehouse network and share its local IP (e.g. `http://192.168.1.50:5000`).

## The Excel catalog

Racks and vendors are **global pools** — any item can be received into any bin, from any vendor — so the workbook is three simple lists. Tabs and headers are auto-detected and case-insensitive:

- **Items** (or **Products**) — item names, one per row. Optional `Aliases` (other spellings a vendor uses, separated by `;`) and `Unit`. A single unlabelled column is taken as the name, so a plain list works.
- **Racks** — your bin locations, one per row (e.g. `A/01-01(A)`). A single-column list is the whole pool. (You *can* add a `Product Name` column to pin certain bins to an item, but it isn't required.)
- **Vendors** — vendor names, one per row.

Items don't carry a rack or vendor in the sheet; those are chosen at receiving time. As goods are received, each item quietly remembers the bins it's been placed in and the vendors it came from, so next time those float to the top of the suggestions — but you can always pick any bin from the full pool (handy when one is full). Newly-typed bins join the pool automatically.

The old layouts still import too: a linked `Product Name + Rack Number` racks tab, or a `Default Rack` / `Vendor` column on the Products tab.

In the app: **Master data → Download blank template** for a starter workbook, or just upload your existing sheet. **Export current** writes the pools back out (Items / Racks / Vendors) to keep your file in sync. Editing the catalog is limited to purchase/admin.

## Data model (MongoDB)

`users`, `counters` (GRN numbering), `vendors`, `products` (shared catalog / item master with `racks[]`, `vendors[]` + `aliases`), and `grns` — each GRN embeds its `items` (with `expected`, `received`, and a `log` of every addition). Embedding lines keeps a full GRN a single read/write.

## Tests

```bash
npm test          # boots the real server on an in-memory MongoDB and runs the API end to end
```

Covers login, roles, catalog bulk-load, GRN numbering, duplicate-merge import, received-stacking without duplicate lines, walk-in items learned into the catalog, short/over variance, quick-add, the unload log, and dashboard totals.

## Security notes

- Change `JWT_SECRET` and the default admin password before going live; serve over HTTPS in production.
- Tokens last 12 hours (adjust in `server/middleware/auth.js`).

## Where this can go next

Approval/lock steps before Purchase finalizes a GRN; order/PO tracking for the earlier part of your process; rack barcode labels; and an ERP push (Tally, Zoho, SAP) so received notes flow through automatically.
