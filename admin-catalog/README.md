# Admin catalog (Qatar)

This folder is the **source of truth** for the live Premium Store catalog at https://premiumstoreqar.com.

Edit files here in GitHub (this repo: `Premium_Store-Qatar`). The live Node app **pulls** this folder and applies prices, images, and new services. It does **not** push admin-panel edits back to GitHub.

After the first merge of this folder, **republish / restart the GoDaddy Node app once**. Later edits on `main` apply on boot, on a short pull interval (default 5 minutes), or immediately via Admin → **Sync GitHub catalog**.

## Files

| Path | What it is |
|------|------------|
| `services.json` | One row per subscription (names, prices, image filename, …) |
| `images/` | Artwork. Filename must match the `image` field (usually `{id}.jpg`) |

## Field guide (`services.json`)

Each object in `services` uses:

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable unique key. Never change an existing id. Example: `netflix-full` |
| `nameEn` / `nameAr` | yes | Storefront name (English / Arabic) |
| `descriptionEn` / `descriptionAr` | no | Storefront description (use `\n` for new lines) |
| `typeEn` / `typeAr` | no | Plan type, e.g. Shared / Private / Full Account |
| `prices.month` / `prices.year` | yes | QAR prices. Use `0` for both if out of stock |
| `outOfStock` | no | `true` / `false`. Price `0` also marks out of stock |
| `image` | yes | Filename **only** (not a URL). Must exist in `images/` |
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

### Add a new service

1. Copy an existing row in `services.json`.
2. Set a new unique `id` (lowercase letters, numbers, hyphens).
3. Fill names, descriptions, prices, `sortOrder`.
4. Add `images/{id}.jpg` (or `.png` / `.webp`) and set `"image"` to that filename.
5. Commit to `main`.

The live catalog **updates matching ids and inserts new ids**. Extra services that exist only on the server (added in the Admin panel) are left in place. Removing a row here does **not** delete it from the live store.

## What not to do

- Do not rename an existing `id` (that creates a new service and leaves the old one).
- Do not put full website URLs in `image` — filename only.
- Do not set `ALLOW_FACTORY_SEED=1` on GoDaddy.
- Do not expect the Admin panel **Add / Edit** screens to update this GitHub folder.
