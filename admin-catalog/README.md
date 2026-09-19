# Admin catalog (Qatar)

This folder is the **source of truth** for the live Premium Store catalog at https://premiumstoreqar.com.

Edit files here in GitHub (this repo: `Premium_Store-Qatar`). The live Node app **pulls** this folder and **creates new services**, updates prices/names, and applies images. It does **not** push admin-panel edits back to GitHub.

After the first merge of this folder, **republish / restart the GoDaddy Node app once**. Later edits on `main` apply on boot, on a short pull interval (default 5 minutes), or immediately via Admin → **Sync GitHub catalog**.

## Files

| Path | What it is |
|------|------------|
| `services.json` | One row per subscription (names, prices, image filename, …) |
| `images/` | Artwork. Filename must match the `image` field and be unique (usually `{id}.jpg`) |

## Adding a NEW service (creates it on the live site)

Pull/apply **inserts** any `id` that does not already exist on the live store. Editing an existing row is not enough to add a product — you must add a **new row** and a **new image file**.

1. Copy an existing object inside the `services` array in `services.json`.
2. Give it a **new unique `id`** (lowercase letters, numbers, hyphens). Do not reuse an existing `id`.
3. Fill `nameEn`, `nameAr`, `prices.month`, `prices.year`, descriptions, and `sortOrder`.
4. Add a matching uniquely named file under `images/`, for example `images/starplus-premium.jpg`.
5. Set `"image"` on the new row to that **filename only** (`starplus-premium.jpg`).
6. Keep valid JSON (comma after the previous row, no trailing comma after the last row).
7. Commit to `main`. After the first GoDaddy republish, the live site **creates** that service: `id`, English/Arabic names, prices, and the image.

Example of a brand-new row (add it inside `"services": [ ... ]`):

```json
{
  "id": "starplus-premium",
  "nameEn": "Star+ Premium",
  "nameAr": "ستار بلس بريميوم",
  "descriptionEn": "Premium access",
  "descriptionAr": "وصول بريميوم",
  "typeEn": "Shared",
  "typeAr": "مشترك",
  "prices": { "month": 15, "year": 120 },
  "outOfStock": false,
  "image": "starplus-premium.jpg",
  "icon": "✨",
  "accent": "#38bdf8",
  "sortOrder": 43,
  "offerType": "none",
  "offerExpiresAt": null
}
```

Both pieces are required: **new JSON row + new image file**. A row without its image still creates the service, but the storefront will have no artwork until the file is added and synced.

The live catalog **updates matching ids and inserts new ids**. Extra services that exist only on the server (added in the Admin panel) are left in place. Removing a row here does **not** delete it from the live store.

## Field guide (`services.json`)

Each object in `services` uses:

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable unique key. Never change an existing id. New products need a **new** id. Example: `netflix-full` |
| `nameEn` / `nameAr` | yes | Storefront name (English / Arabic) |
| `descriptionEn` / `descriptionAr` | no | Storefront description (use `\n` for new lines) |
| `typeEn` / `typeAr` | no | Plan type, e.g. Shared / Private / Full Account |
| `prices.month` / `prices.year` | yes | QAR prices. Use `0` for both if out of stock |
| `outOfStock` | no | `true` / `false`. Price `0` also marks out of stock |
| `image` | yes | Unique filename **only** (not a URL). Must exist in `images/` |
| `icon` | no | Emoji shown if there is no image (default ✨) |
| `accent` | no | Accent color hex (default `#38bdf8`) |
| `sortOrder` | no | Lower numbers appear first |
| `offerType` | no | `none`, `eid`, or `special` |
| `offerExpiresAt` | no | ISO datetime when an offer ends; required if `offerType` is not `none` |
| `imageRev` | no | Bump this number (1, 2, 3…) after replacing an image **with the same filename** so the live site re-downloads it |

Do not delete the wrapping `{ "version": 1, "services": [ ... ] }` object. Keep valid JSON (commas between rows, no trailing comma).

## Everyday tasks

### Change a price

1. Open `services.json`.
2. Find the service `id`.
3. Edit `prices.month` and/or `prices.year`.
4. Commit to `main` (after this PR is merged).

### Replace an image

1. Keep the **same filename** (example: `images/netflix-full.jpg`).
2. Upload/replace the file in `images/`.
3. Optional but recommended: bump `imageRev` on that service in `services.json`.
4. Commit to `main`.

## What not to do

- Do not reuse an existing `id` when adding a product — that **updates** the old service instead of creating a new one.
- Do not rename an existing `id` (that creates a new service and leaves the old one).
- Do not put full website URLs in `image` — filename only, unique per service.
- Do not set `ALLOW_FACTORY_SEED=1` on GoDaddy.
- Do not expect the Admin panel **Add / Edit** screens to update this GitHub folder.
