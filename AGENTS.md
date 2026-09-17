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

The storefront list comes from **`GET /api/services`** (SQLite). `client/src/data/servicesCatalog.js` is used **only** when `ALLOW_FACTORY_SEED=1` and the durable catalog is empty. Production must not set that flag: boot restores local replicas (`admin-state.json` + `admin-state.backup.json` under `/local`, `/root`, `$HOME`) then auto-fetches the off-host GitHub/`CATALOG_BACKUP_URL` backup (default public raw URL, no token required for read) and hydrates **before** any seed. An empty store after restore stays empty and never factory-fills. Factory/empty snapshots never overwrite a custom `admin-state.json`. On first boot, existing `server/data` is copied into the durable folder if the target is empty.

### Complaint email

Local dev works without SMTP: submissions are stored in SQLite (and appended to `complaints.jsonl` in the durable data directory) and screenshots land in `uploads/` there. Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (and optional `COMPLAINT_EMAIL`) for real delivery. The active inbox address is also editable in Admin → Edit Services → Complaint Email ID.

### Admin panel

Click the header Admin icon to open a **modal** (no separate `/admin` page). After login, the dashboard offers **Add Services**, **Edit Services**, **Complaint Email**, **Contact Details**, **About Us**, **Export catalog**, and **Import catalog**. Configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and optionally `ADMIN_SESSION_SECRET`. Session token is stored in `localStorage` key `globalstores_admin_token`.

**GoDaddy:** Admin requires the Node process (`npm run build && npm start`). Read restore uses the public `catalog-backup/admin-state.json` raw URL by default (no token). Set `CATALOG_BACKUP_TOKEN` or `CATALOG_BACKUP_ENABLED=1` plus `GITHUB_TOKEN`/`GH_TOKEN` only for write/push on admin save, and `DATA_DIR` if the host provides a volume. Verify `GET /api/health` (`factorySeedDisabled`, `offHostBackupConfigured`, `hydrateReason`, `replicas`). The dashboard **Export catalog** / **Import catalog** downloads and restores `admin-state.json`. If the API is on another host, set `apiUrl` in `client/public/runtime-config.js`.

### E2E notes

- WhatsApp buttons open `wa.me` in a new tab (external; no local WhatsApp service). Numbers come from the database settings.
- Arabic mode toggles `body.rtl` and persists language in `localStorage` key `globalstores_lang`.
- Services with price `0` / `outOfStock` show an Out of Stock badge and disable Add to Cart.
- Optional Eid/Special offers persist `offerType` + `offerExpiresAt`. Expired offers are hidden from `GET /api/services` and remain in Admin.
