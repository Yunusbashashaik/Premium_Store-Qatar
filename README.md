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

### Hardcoded catalog

The public subscription list is **`client/src/data/catalog.js`** (`SERVICES`). Put artwork in **`client/public/services/`**. Those entries ship with the built site. They are **not** loaded from SQLite, `admin-state.json`, or browser cache, so they will not disappear on restart and old backups cannot bring deleted services back.

To add a service: append an object to `SERVICES` and add its image file, then rebuild/publish. To remove one: delete that object (and its image).

### Site settings (SQLite)

Complaint email, WhatsApp numbers, About Us, social links, and complaints persist in **`server/data/globalstore.db`**. Optional env:

- `DATABASE_PATH` — custom SQLite file path
- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `Go$StQ821`)
- `ADMIN_SESSION_SECRET` — signs admin session tokens

### Admin panel

Click the **Admin** icon in the header. A modal prompts for credentials, then opens settings only:

- **Complaint Email ID**
- **Contact Details** (WhatsApp)
- **About Us** / social links

The catalog is not edited in Admin. Default credentials: `admin` / `Go$StQ821` (override with `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

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
8. Visit `https://YOUR-DOMAIN/api/health` — you must see JSON `ok: true`  
9. Then sign in with `admin` / `Go$StQ821`

Do **not** FTP only `client/dist` into `public_html`. That is static hosting and `/api/health` will 404.

If Apache serves static files and Node is on port 3001, proxy `/api` to the Node process (requires `mod_proxy`).

If the website and API use different URLs, edit `client/public/runtime-config.js` after build:

```js
window.__GLOBALSTORE_CONFIG__ = { apiUrl: "https://your-node-api-url" };
```

Keep `server/data/` on a persistent disk so SQLite and uploads survive restarts.

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

The homepage catalog is the `SERVICES` array in `client/src/data/catalog.js`. Edit that file (and files under `client/public/services/`) then push/`npm run build`. GitHub Pages has no Node API; the catalog still appears because it is bundled in the client.
