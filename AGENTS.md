# AGENTS.md

## Cursor Cloud specific instructions

This repository implements **Premium Store** from `Tech. Document` as an npm workspace (`client` + `server`).

### Services

| Service | Dev command | URL |
|---------|-------------|-----|
| Vite frontend | `npm run dev` (workspace root) | http://localhost:5173 |
| Express API | started with `npm run dev` | http://localhost:3001 (`/api/*`) |

Vite proxies `/api` to port **3001** during development. For production-style serving, run `npm run build` then `npm start` (API serves `client/dist` on port 3001).

### Standard commands (root)

- **Install:** `npm install`
- **Dev:** `npm run dev`
- **Lint:** `npm run lint`
- **Test:** `npm run test` (server API tests only)
- **Build:** `npm run build`

### Catalog (live database)

The storefront list comes from **`GET /api/services`** (SQLite). `client/src/data/servicesCatalog.js` is used **only as a first-time seed** when the durable catalog is empty. Seed/startup never wipes or overwrites existing services.

Site settings, complaints, and the catalog persist under **`~/premium-store-qatar-data/`** by default (outside the app package so GoDaddy Restart Published App does not wipe them). Override with `DATA_DIR` and/or `DATABASE_PATH`. On first boot, existing `server/data` is copied into that durable folder if the target is empty.

### Complaint email

Local dev works without SMTP: submissions are stored in SQLite (and appended to `complaints.jsonl` in the durable data directory) and screenshots land in `uploads/` there. Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (and optional `COMPLAINT_EMAIL`) for real delivery. The active inbox address is also editable in Admin → Edit Services → Complaint Email ID.

### Admin panel

Click the header Admin icon to open a **modal** (no separate `/admin` page). After login, the dashboard offers **Add Services**, **Edit Services**, **Complaint Email**, **Contact Details**, and **About Us**. Configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and optionally `ADMIN_SESSION_SECRET`. Session token is stored in `localStorage` key `globalstores_admin_token`.

**GoDaddy:** Admin requires the Node process (`npm run build && npm start`). Static FTP uploads cannot serve `/api/admin/login` and will show “Load failed”. Verify `GET /api/health` on the live domain (`dataDir`, `services`, `catalogSeededThisBoot`). After deploy, set `DATA_DIR` to a persistent volume if the host provides one (otherwise the process home directory `~/premium-store-qatar-data` is used), republish, then retest an admin rename + Restart Published App. If the API is on another host, set `apiUrl` in `client/public/runtime-config.js`.

### E2E notes

- WhatsApp buttons open `wa.me` in a new tab (external; no local WhatsApp service). Numbers come from the database settings.
- Arabic mode toggles `body.rtl` and persists language in `localStorage` key `globalstores_lang`.
- Services with price `0` / `outOfStock` show an Out of Stock badge and disable Add to Cart.
- Optional Eid/Special offers persist `offerType` + `offerExpiresAt`. Expired offers are hidden from `GET /api/services` and remain in Admin.
