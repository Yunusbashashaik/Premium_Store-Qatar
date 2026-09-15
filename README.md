---
published: false
---

# Premium Store Qatar

> **Open the website (iPad / phone):** [https://yunusbashashaik.github.io/Premium_Store-Qatar/](https://yunusbashashaik.github.io/Premium_Store-Qatar/)  
> Do **not** use `yunusbashashaik.github.io` alone — that is not your store URL.

Premium Store — bilingual digital subscription marketplace for Qatar (QAR).

## Development

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

- **Client:** http://localhost:5173 (Vite dev server; proxies `/api` to the backend)
- **API:** http://localhost:3001 (`GET /api/health`, `GET /api/services`, `GET /api/settings`, `POST /api/complaints`, `POST /api/admin/login`)

```bash
npm run lint
npm run test
npm run build
npm start   # serves built client + API on port 3001
```

### Live catalog (SQLite)

The public subscription list is served from **`GET /api/services`**. On first start only, `client/src/data/servicesCatalog.js` is inserted if the **durable** catalog is empty. Later Node / Passenger restarts **do not** overwrite prices, names, descriptions, images, or admin-added services.

Artwork for the seed catalog lives in **`client/public/services/`**. Admin uploads are stored in SQLite (`image_blob`) and `uploads/services/` under the durable data directory.

To change the live catalog: sign in to Admin → **Add Services** / **Edit Services**.

Default data directory is **`~/premium-store-qatar-data/`** (outside the application package). Optional env:

- `DATA_DIR` — persistent folder for SQLite, `admin-state.json`, and uploads (recommended on GoDaddy)
- `DATABASE_PATH` — custom SQLite file path
- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `Go$StQ821`)
- `ADMIN_SESSION_SECRET` — signs admin session tokens

### Admin panel

Click the **Admin** icon in the header. After login the dashboard includes:

- **Add Services** (JPEG, name EN/AR, description EN/AR, month/year prices)
- **Edit Services** (partial updates: image, prices, names, descriptions, or mix)
- **Complaint Email ID**
- **Contact Details** (WhatsApp)
- **About Us** / social links

Default credentials: `admin` / `Go$StQ821` (override with `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

Out-of-stock services use price `0`, show an **Out of Stock** note, and disable Add to Cart.

### Deploy on GoDaddy (Node.js)

Admin login needs a **running Node app**. If `https://YOUR-DOMAIN/api/health` does not return `{"ok":true}`, login cannot work.

**cPanel Application Manager (Passenger)**

1. Setup → Application Manager → Register Application  
2. Application root = this repo folder  
3. Application URL = your domain (or subdomain) **root**, not a `/public_html` static copy  
4. Application startup file: `app.js`  
5. Node.js version: 20+  
6. In the app directory:
   ```bash
   npm install
   npm run build
   ```
7. Restart the application  
8. In Application Manager, set environment variables if the host gives you a persistent volume:
   - `DATA_DIR` = that volume path (example: `/home/USER/premium-store-qatar-data`)
   - Optional: `DATABASE_PATH` = `$DATA_DIR/globalstore.db`
9. Republish / restart the application  
10. Visit `https://YOUR-DOMAIN/api/health` — JSON must include `ok: true`, `dataDir` outside the app folder, and `catalogSeededThisBoot`  
11. Sign in with `admin` / `Go$StQ821`, rename a service, then **Restart Published App**. Confirm `/api/services` still has the new name (`catalogSeededThisBoot` should be `false`).

Do **not** FTP only `client/dist` into `public_html`. That is static hosting and `/api/health` will 404.

If Apache serves static files and Node is on port 3001, proxy `/api` to the Node process (requires `mod_proxy`).

If the website and API use different URLs, edit `client/public/runtime-config.js` after build:

```js
window.__GLOBALSTORE_CONFIG__ = { apiUrl: "https://your-node-api-url" };
```

If `DATA_DIR` is not set, the API stores SQLite and snapshots in **`~/premium-store-qatar-data/`** (home directory, not the deploy tree). On first start it copies `server/data` into that folder when the durable store is empty. Restart Published App typically resets the app directory and would wipe `server/data`; the home-dir (or `DATA_DIR`) copy is what survives.

### Complaint email

Complaints are sent by **email only** (not WhatsApp). The destination address is stored in the database (default `global2stor2@gmail.com`) and can be changed from the admin panel.

- **Static hosting (GitHub Pages):** FormSubmit classic multipart POST fallback
- **Node API + SMTP:** screenshot embedded + attached

Optional env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `COMPLAINT_EMAIL` / `VITE_COMPLAINT_EMAIL`

See `Tech. Document` for full product requirements.

## Deployment (GitHub Pages) — free account OK

You **do not need a paid GitHub plan** for a **public** repository. GitHub Pages is included on free accounts. This repo is public.

Pushes to **`main`** build the site into the **repository root** on the same branch. This repo stays on **`main` only**.

### One-time setup (iPhone, iPad, or computer)

1. Open **https://github.com/Yunusbashashaik/Premium_Store-Qatar/settings/pages**
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**
3. **Branch:** `main` · **Folder:** `/ (root)` · **Save**
4. Wait 1–2 minutes, then open on your iPad:

   **https://yunusbashashaik.github.io/Premium_Store-Qatar/**

The homepage catalog is loaded from `/api/services` when Node is running. GitHub Pages has no API, so it falls back to the bundled seed catalog until you publish to a Node/Passenger host.
