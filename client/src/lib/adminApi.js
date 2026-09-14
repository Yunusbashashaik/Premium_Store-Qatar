import { SERVICES } from "../data/catalog.js";

function trimSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function unique(list) {
  return [...new Set(list.filter((item) => item !== undefined && item !== null))];
}

function candidateBases() {
  const bases = [];
  if (typeof window !== "undefined") {
    const runtime = window.__GLOBALSTORE_CONFIG__?.apiUrl;
    if (runtime) bases.push(trimSlash(runtime));

    // Prefer the app base path (required for GitHub project Pages).
    const viteBase = trimSlash(import.meta.env.BASE_URL || "");
    if (viteBase && viteBase !== "/") {
      bases.push(trimSlash(`${window.location.origin}${viteBase.startsWith("/") ? viteBase : `/${viteBase}`}`));
    }

    const folder = trimSlash(window.location.pathname.replace(/\/[^/]*$/, ""));
    if (folder && folder !== "/") {
      bases.push(trimSlash(`${window.location.origin}${folder}`));
    }

    // Only probe site origin last; on project Pages this often 404s.
    bases.push(trimSlash(window.location.origin));
  }
  bases.push(trimSlash(import.meta.env.VITE_API_URL || ""));
  bases.push("");
  return unique(bases);
}

let resolvedBase;
let backendAvailable;

export function getApiBase() {
  if (resolvedBase !== undefined) return resolvedBase;
  if (typeof window !== "undefined") {
    const runtime = window.__GLOBALSTORE_CONFIG__?.apiUrl;
    if (runtime) return trimSlash(runtime);
  }
  return trimSlash(import.meta.env.VITE_API_URL || "");
}

export function apiUrl(path) {
  return `${getApiBase()}${path}`;
}

async function isLiveHealth(base) {
  try {
    const res = await fetch(`${trimSlash(base)}/api/health`, {
      method: "GET",
      // Static GitHub Pages has no API — fail fast, avoid noisy retries.
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data && data.ok === true);
  } catch {
    return false;
  }
}

export async function discoverApiBase() {
  if (backendAvailable === true && resolvedBase !== undefined) return resolvedBase;
  for (const base of candidateBases()) {
    try {
      if (await isLiveHealth(base)) {
        resolvedBase = base;
        backendAvailable = true;
        return base;
      }
    } catch {
      /* try next */
    }
  }
  backendAvailable = false;
  return getApiBase();
}

export async function hasBackendApi() {
  if (backendAvailable === true) return true;
  await discoverApiBase();
  return Boolean(backendAvailable);
}

export function resetBackendAvailability() {
  backendAvailable = undefined;
  resolvedBase = undefined;
}

function networkError(err) {
  const message = String(err?.message || err || "");
  if (err?.status === 405) {
    return new Error(
      "The web host blocked /api (HTTP 405). The Node app is not the public site. In GoDaddy cPanel use Application Manager, startup file app.js, then npm install && npm run build.",
    );
  }
  if (
    err instanceof TypeError ||
    /failed to fetch|load failed|networkerror|network request failed/i.test(
      message,
    )
  ) {
    return new Error(
      "Cannot reach /api/health on this domain. Open https://YOUR-DOMAIN/api/health — it must show {\"ok\":true}. If it 404s, Node is not serving the website yet.",
    );
  }
  return err instanceof Error ? err : new Error(message || "Request failed");
}

async function requestJson(path, { method = "GET", body, token, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !formData) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (err) {
    throw networkError(err);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw networkError(err);
  }
  return data;
}

export async function adminLogin(username, password) {
  resetBackendAvailability();
  await discoverApiBase();
  try {
    const data = await requestJson("/api/admin/login", {
      method: "POST",
      body: { username, password },
    });
    backendAvailable = true;
    return data.token;
  } catch (err) {
    throw networkError(err);
  }
}

export async function adminValidateSession(token) {
  if (!token) return false;
  try {
    await requestJson("/api/admin/me", { token });
    return true;
  } catch {
    return false;
  }
}

export async function adminFetchSettings(token) {
  const data = await requestJson("/api/admin/settings", { token });
  return data.settings;
}

export async function adminSaveSettings(token, patch) {
  const data = await requestJson("/api/admin/settings", {
    method: "PUT",
    token,
    body: patch,
  });
  window.dispatchEvent(new Event("gs:settings-updated"));
  rememberLiveSettings(data.settings);
  return data.settings;
}

export async function adminTranslate(token, text) {
  const data = await requestJson("/api/admin/translate", {
    method: "POST",
    token,
    body: { text },
  });
  return data.text;
}

const LIVE_SETTINGS_KEY = "gs_live_settings";

export function forgetCachedServices() {
  try {
    localStorage.removeItem("gs_live_services_v3");
    localStorage.removeItem("gs_live_services_v2");
    localStorage.removeItem("gs_live_services");
  } catch {
    /* private mode */
  }
}

function readLiveCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLiveCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function getCachedPublicSettings() {
  const cached = readLiveCache(LIVE_SETTINGS_KEY);
  if (cached && typeof cached === "object") return cached;
  return null;
}

export function getCachedPublicServices() {
  return SERVICES.map((service) => ({ ...service }));
}

export function rememberLiveServices() {
  forgetCachedServices();
}

export async function fetchPublicServices() {
  forgetCachedServices();
  return SERVICES.map((service) => ({ ...service }));
}

export function rememberLiveSettings(settings) {
  if (settings && typeof settings === "object") writeLiveCache(LIVE_SETTINGS_KEY, settings);
}

export async function fetchPublicSettings() {
  if (await hasBackendApi()) {
    try {
      const data = await requestJson("/api/settings");
      if (data.settings) {
        writeLiveCache(LIVE_SETTINGS_KEY, data.settings);
        return data.settings;
      }
    } catch {
      /* fall through */
    }
  }
  return readLiveCache(LIVE_SETTINGS_KEY);
}
