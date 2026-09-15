const assetBase = import.meta.env.BASE_URL || "/";

/** Hero wallpaper only — catalog artwork lives in `client/public/services/`. */
export function wallpaperUrl() {
  return `${assetBase}hero-wallpaper-hd.jpg`;
}

/** Resolve a catalog `image` path such as `services/netflix.jpg`. */
export function catalogImageUrl(image) {
  if (!image) return null;
  const raw = String(image);
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith("/api/") || raw.startsWith("api/")) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
  const rel = raw.replace(/^\//, "");
  const base = assetBase.endsWith("/") ? assetBase : `${assetBase}/`;
  return `${base}${rel}`;
}

export function serviceImageUrl() {
  return null;
}
