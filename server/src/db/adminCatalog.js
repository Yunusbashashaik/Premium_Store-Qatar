import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { persistAdminState, withoutPersist } from "./persist.js";
import {
  countServices,
  getServiceById,
  getServiceImageBlob,
  insertService,
  updateService,
} from "../models/Service.js";

export const DEFAULT_ADMIN_CATALOG_REPO = "Yunusbashashaik/Premium_Store-Qatar";
export const DEFAULT_ADMIN_CATALOG_PATH = "admin-catalog/services.json";
export const DEFAULT_ADMIN_CATALOG_IMAGES = "admin-catalog/images";
export const DEFAULT_ADMIN_CATALOG_BRANCH = "main";
export const DEFAULT_ADMIN_CATALOG_SYNC_MS = 5 * 60 * 1000;
const API_VERSION = "2022-11-28";
const MODULE_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let fetchImpl = (...args) => globalThis.fetch(...args);
let syncTimer = null;
let syncChain = Promise.resolve();

const lastStatus = {
  configured: false,
  lastSyncAt: null,
  lastSource: null,
  lastError: null,
  lastResult: null,
};

export function setAdminCatalogFetch(fn) {
  fetchImpl = fn || ((...args) => globalThis.fetch(...args));
}

export function resetAdminCatalogStatus() {
  lastStatus.configured = false;
  lastStatus.lastSyncAt = null;
  lastStatus.lastSource = null;
  lastStatus.lastError = null;
  lastStatus.lastResult = null;
}

export function getAdminCatalogStatus() {
  return {
    ...lastStatus,
    ...getAdminCatalogConfig(),
  };
}

function repoRootCandidates() {
  const roots = [MODULE_REPO_ROOT, process.cwd()];
  try {
    roots.push(path.resolve(process.cwd(), ".."));
  } catch {
    /* ignore */
  }
  const unique = [];
  const seen = new Set();
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function encodeGithubPath(filePath) {
  return String(filePath || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function getDefaultAdminCatalogUrl(
  repo = DEFAULT_ADMIN_CATALOG_REPO,
  filePath = DEFAULT_ADMIN_CATALOG_PATH,
  branch = DEFAULT_ADMIN_CATALOG_BRANCH,
) {
  return `https://raw.githubusercontent.com/${repo || DEFAULT_ADMIN_CATALOG_REPO}/${branch || DEFAULT_ADMIN_CATALOG_BRANCH}/${encodeGithubPath(filePath)}`;
}

export function getAdminCatalogConfig() {
  const disabled = process.env.ADMIN_CATALOG_DISABLED === "1";
  const repo = String(process.env.ADMIN_CATALOG_REPO || DEFAULT_ADMIN_CATALOG_REPO).trim();
  const filePath =
    String(process.env.ADMIN_CATALOG_PATH || DEFAULT_ADMIN_CATALOG_PATH).trim() ||
    DEFAULT_ADMIN_CATALOG_PATH;
  const imagesPath =
    String(process.env.ADMIN_CATALOG_IMAGES || DEFAULT_ADMIN_CATALOG_IMAGES).trim() ||
    DEFAULT_ADMIN_CATALOG_IMAGES;
  const branch =
    String(process.env.ADMIN_CATALOG_BRANCH || DEFAULT_ADMIN_CATALOG_BRANCH).trim() ||
    DEFAULT_ADMIN_CATALOG_BRANCH;
  const urlEnv = String(process.env.ADMIN_CATALOG_URL || "").trim();
  const dirEnv = String(process.env.ADMIN_CATALOG_DIR || "").trim();
  const skipPackaged = process.env.ADMIN_CATALOG_SKIP_PACKAGED === "1";
  const token = String(
    process.env.ADMIN_CATALOG_TOKEN ||
      process.env.CATALOG_BACKUP_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.GITHUB_TOKEN ||
      "",
  ).trim();
  const defaultUrl = getDefaultAdminCatalogUrl(repo, filePath, branch);
  const packagedRoot = dirEnv || findPackagedCatalogRoot(filePath, skipPackaged);
  const packagedAvailable = Boolean(packagedRoot && fs.existsSync(path.join(packagedRoot, filePath)));
  const syncMsRaw = process.env.ADMIN_CATALOG_SYNC_MS;
  const syncMs =
    syncMsRaw === undefined || syncMsRaw === ""
      ? DEFAULT_ADMIN_CATALOG_SYNC_MS
      : Number(syncMsRaw);
  const configured = !disabled && Boolean(urlEnv || packagedAvailable || defaultUrl);
  return {
    disabled,
    repo,
    filePath,
    imagesPath,
    branch,
    url: urlEnv || defaultUrl,
    urlEnv: urlEnv || null,
    defaultUrl,
    token,
    skipPackaged,
    packagedRoot,
    packagedAvailable,
    syncMs: Number.isFinite(syncMs) ? Math.max(0, syncMs) : 0,
    configured,
  };
}

function findPackagedCatalogRoot(filePath, skipPackaged) {
  if (skipPackaged) return null;
  for (const root of repoRootCandidates()) {
    if (fs.existsSync(path.join(root, filePath))) return root;
  }
  return null;
}

function githubHeaders(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "premium-store-qatar-admin-catalog",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function contentsUrl(repo, filePath, branch) {
  const base = `https://api.github.com/repos/${repo}/contents/${encodeGithubPath(filePath)}`;
  return branch ? `${base}?ref=${encodeURIComponent(branch)}` : base;
}

function parseCatalogDocument(raw) {
  if (Array.isArray(raw)) return { version: 1, services: raw };
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.services)) return null;
  return raw;
}

function decodeGithubJson(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.encoding === "base64" && payload.content) {
    const encoded = String(payload.content).replace(/\s/g, "");
    try {
      return parseCatalogDocument(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
    } catch {
      return null;
    }
  }
  if (payload.download_url) return null;
  return parseCatalogDocument(payload);
}

function sanitizeImageName(name) {
  const base = path.basename(String(name || "").replace(/\\/g, "/"));
  if (!base || base.includes("..") || base.length > 180) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return "";
  return base;
}

export function normalizeAdminCatalogService(row, index = 0) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "")
    .trim()
    .toLowerCase();
  if (!id || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) return null;
  const nameEn = String(row.nameEn || "").trim();
  if (!nameEn) return null;
  const image = sanitizeImageName(row.image || row.imageFile || `${id}.jpg`);
  const month = Number(row.prices?.month ?? row.priceMonth ?? 0);
  const year = Number(row.prices?.year ?? row.priceYear ?? 0);
  return {
    id,
    nameEn,
    nameAr: String(row.nameAr || nameEn).trim(),
    descriptionEn: String(row.descriptionEn || ""),
    descriptionAr: String(row.descriptionAr || ""),
    typeEn: String(row.typeEn || "Shared / Private"),
    typeAr: String(row.typeAr || "مشترك / خاص"),
    prices: {
      month: Number.isFinite(month) ? month : 0,
      year: Number.isFinite(year) ? year : 0,
    },
    outOfStock: Boolean(row.outOfStock),
    image,
    icon: String(row.icon || "✨"),
    accent: String(row.accent || "#38bdf8"),
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
    offerType: row.offerType || "none",
    offerExpiresAt: row.offerExpiresAt || null,
    imageRev: String(row.imageRev ?? ""),
  };
}

function blobHash(buf) {
  if (!buf || !buf.length) return "";
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function serviceFingerprint(service, imageSha) {
  return [
    service.id,
    Number(service.prices?.month),
    Number(service.prices?.year),
    service.nameEn,
    service.nameAr,
    service.descriptionEn,
    service.descriptionAr,
    service.typeEn,
    service.typeAr,
    service.outOfStock ? 1 : 0,
    service.offerType || "none",
    service.offerExpiresAt || "",
    service.image || "",
    service.imageRev || "",
    service.sortOrder ?? "",
    imageSha || "",
  ].join("\u001f");
}

function liveFingerprint(live, imageSha) {
  return serviceFingerprint(
    {
      id: live.id,
      prices: live.prices,
      nameEn: live.nameEn,
      nameAr: live.nameAr,
      descriptionEn: live.descriptionEn,
      descriptionAr: live.descriptionAr,
      typeEn: live.typeEn,
      typeAr: live.typeAr,
      outOfStock: live.outOfStock,
      offerType: live.offerType,
      offerExpiresAt: live.offerExpiresAt,
      image: path.basename(String(live.imageUrl || "")),
      imageRev: "",
      sortOrder: live.sortOrder,
    },
    imageSha,
  );
}

function readPackagedDocument(config) {
  if (!config.packagedRoot) return null;
  const filePath = path.join(config.packagedRoot, config.filePath);
  try {
    return parseCatalogDocument(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function readLocalImage(config, filename) {
  const name = sanitizeImageName(filename);
  if (!name || !config.packagedRoot) return null;
  const filePath = path.join(config.packagedRoot, config.imagesPath, name);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

async function fetchJson(url, headers = {}) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "premium-store-qatar-admin-catalog",
      ...headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Admin catalog fetch failed (${res.status}) ${url}`);
  }
  return res.json();
}

async function fetchBuffer(url, headers = {}) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      "User-Agent": "premium-store-qatar-admin-catalog",
      ...headers,
    },
  });
  if (!res.ok) return null;
  if (typeof res.arrayBuffer === "function") {
    return Buffer.from(await res.arrayBuffer());
  }
  if (typeof res.buffer === "function") {
    return Buffer.from(await res.buffer());
  }
  return null;
}

async function fetchRemoteDocument(config) {
  if (config.token && config.repo) {
    try {
      const body = await fetchJson(
        contentsUrl(config.repo, config.filePath, config.branch),
        githubHeaders(config.token),
      );
      const decoded = decodeGithubJson(body);
      if (decoded) return { document: decoded, source: "github" };
      if (body?.download_url) {
        const json = await fetchJson(body.download_url);
        const parsed = parseCatalogDocument(json);
        if (parsed) return { document: parsed, source: "github" };
      }
    } catch (err) {
      lastStatus.lastError = err?.message || String(err);
      console.error("Admin catalog GitHub Contents fetch failed", lastStatus.lastError);
    }
  }

  if (config.url) {
    try {
      const json = await fetchJson(config.url);
      const parsed = parseCatalogDocument(json);
      if (parsed) return { document: parsed, source: config.urlEnv ? "url" : "url" };
    } catch (err) {
      lastStatus.lastError = err?.message || String(err);
      console.error("Admin catalog raw URL fetch failed", lastStatus.lastError);
    }
  }

  return { document: null, source: null };
}

async function listRemoteImages(config) {
  const map = new Map();
  try {
    const body = await fetchJson(
      contentsUrl(config.repo, config.imagesPath, config.branch),
      githubHeaders(config.token || undefined),
    );
    const entries = Array.isArray(body) ? body : [];
    for (const entry of entries) {
      const name = sanitizeImageName(entry?.name);
      if (!name) continue;
      map.set(name, {
        sha: entry.sha || null,
        downloadUrl: entry.download_url || null,
      });
    }
  } catch (err) {
    lastStatus.lastError = err?.message || String(err);
  }
  return map;
}

export async function loadAdminCatalogDocument(options = {}) {
  const config = getAdminCatalogConfig();
  lastStatus.configured = config.configured;
  if (config.disabled || !config.configured) {
    return { document: null, source: null, reason: config.disabled ? "disabled" : "not-configured", config };
  }

  const preferRemote = options.preferRemote === true;
  const packaged = readPackagedDocument(config);

  if (!preferRemote && packaged) {
    return { document: packaged, source: "packaged", reason: "packaged", config };
  }

  const remote = await fetchRemoteDocument(config);
  if (remote.document) {
    return { document: remote.document, source: remote.source, reason: remote.source, config };
  }

  if (packaged) {
    return { document: packaged, source: "packaged", reason: "packaged", config };
  }

  return { document: null, source: null, reason: "no-admin-catalog", config };
}

function toInsertPayload(service, imageBlob) {
  const imageUrl = service.image ? `/api/uploads/services/${service.image}` : null;
  return {
    id: service.id,
    nameEn: service.nameEn,
    nameAr: service.nameAr,
    descriptionEn: service.descriptionEn,
    descriptionAr: service.descriptionAr,
    typeEn: service.typeEn,
    typeAr: service.typeAr,
    prices: service.prices,
    outOfStock: service.outOfStock,
    icon: service.icon,
    accent: service.accent,
    sortOrder: service.sortOrder,
    offerType: service.offerType,
    offerExpiresAt: service.offerExpiresAt,
    imageUrl,
    imageBlob: imageBlob || undefined,
  };
}

/**
 * Upsert services from a parsed admin-catalog document.
 * Empty store is filled. Existing ids get price/name/image updates. New ids are inserted.
 * Services that exist only on the live store are left in place.
 */
export function applyAdminCatalogToStore(document, options = {}) {
  const rows = Array.isArray(document?.services) ? document.services : [];
  const incoming = rows
    .map((row, index) => normalizeAdminCatalogService(row, index))
    .filter(Boolean);
  if (!incoming.length) {
    return { applied: false, reason: "empty-catalog", added: [], updated: [], unchanged: [] };
  }

  const getImage =
    options.getImage ||
    (() => null);
  const added = [];
  const updated = [];
  const unchanged = [];

  withoutPersist(() => {
    for (const service of incoming) {
      const imageBlob = getImage(service.image, service) || null;
      const imageSha = blobHash(imageBlob);
      const existing = getServiceById(service.id);
      const payload = toInsertPayload(service, imageBlob);
      if (!existing) {
        insertService(payload, { persist: false });
        added.push(service.id);
        continue;
      }
      const liveSha = blobHash(getServiceImageBlob(existing.id));
      const nextSha = imageSha || liveSha;
      const incomingFp = serviceFingerprint(
        { ...service, image: imageBlob ? service.image : path.basename(String(existing.imageUrl || "")) },
        nextSha,
      );
      const existingFp = liveFingerprint(existing, liveSha);
      if (incomingFp === existingFp) {
        unchanged.push(service.id);
        continue;
      }
      updateService(service.id, {
        ...payload,
        imageBlob: imageBlob || undefined,
        imageUrl: imageBlob ? payload.imageUrl : existing.imageUrl,
      });
      updated.push(service.id);
    }
  });

  if (added.length || updated.length) {
    persistAdminState();
  }

  return {
    applied: added.length + updated.length > 0,
    reason: countServices() === incoming.length && added.length === incoming.length ? "filled-empty" : "upsert",
    added,
    updated,
    unchanged,
    services: incoming.length,
  };
}

async function resolveImage(config, filename, remoteImages) {
  const local = readLocalImage(config, filename);
  const remote = remoteImages.get(filename);
  if (remote?.downloadUrl) {
    const buf = await fetchBuffer(remote.downloadUrl);
    if (buf && buf.length) return buf;
  }
  if (local) return local;
  const raw = `https://raw.githubusercontent.com/${config.repo}/${config.branch}/${encodeGithubPath(`${config.imagesPath}/${filename}`)}`;
  const buf = await fetchBuffer(raw);
  if (buf && buf.length) return buf;
  return local;
}

export async function syncAdminCatalog(options = {}) {
  const loaded = await loadAdminCatalogDocument(options);
  if (!loaded.document) {
    const result = {
      applied: false,
      reason: loaded.reason || "no-admin-catalog",
      added: [],
      updated: [],
      unchanged: [],
    };
    lastStatus.lastResult = result;
    lastStatus.lastSource = loaded.source;
    lastStatus.lastSyncAt = new Date().toISOString();
    return result;
  }

  const remoteImages =
    options.skipRemoteImages === true || options.preferRemote !== true
      ? new Map()
      : await listRemoteImages(loaded.config).catch(() => new Map());
  const incoming = (loaded.document.services || [])
    .map((row, index) => normalizeAdminCatalogService(row, index))
    .filter(Boolean);
  const imageCache = new Map();
  for (const service of incoming) {
    if (!service.image || imageCache.has(service.image)) continue;
    const live = getServiceById(service.id);
    const liveHasImage = Boolean(getServiceImageBlob(service.id)?.length);
    const shouldFetchRemote =
      options.preferRemote === true &&
      (!live ||
        !liveHasImage ||
        Boolean(service.imageRev) ||
        options.forceRemoteImages === true);
    if (shouldFetchRemote) {
      imageCache.set(
        service.image,
        await resolveImage(loaded.config, service.image, remoteImages),
      );
    } else {
      imageCache.set(service.image, readLocalImage(loaded.config, service.image));
    }
  }

  const result = applyAdminCatalogToStore(loaded.document, {
    getImage: (filename) => imageCache.get(sanitizeImageName(filename)) || null,
  });

  lastStatus.lastResult = result;
  lastStatus.lastSource = loaded.source;
  lastStatus.lastSyncAt = new Date().toISOString();
  lastStatus.lastError = null;
  lastStatus.configured = loaded.config.configured;
  if (result.applied) {
    console.log(
      `Applied admin-catalog (${loaded.source}): added=${result.added.length} updated=${result.updated.length}`,
    );
  }
  return result;
}

export function startAdminCatalogSyncLoop() {
  stopAdminCatalogSyncLoop();
  const config = getAdminCatalogConfig();
  if (config.disabled || !config.syncMs || process.env.NODE_ENV === "test") return;
  syncTimer = setInterval(() => {
    syncChain = syncChain
      .then(() => syncAdminCatalog({ preferRemote: true }))
      .catch((err) => {
        lastStatus.lastError = err?.message || String(err);
        console.error("Admin catalog interval sync failed", lastStatus.lastError);
      });
  }, config.syncMs);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
}

export function stopAdminCatalogSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export function queueAdminCatalogSync() {
  syncChain = syncChain
    .then(() => syncAdminCatalog({ preferRemote: true }))
    .catch((err) => {
      lastStatus.lastError = err?.message || String(err);
      return { applied: false, reason: "error", error: lastStatus.lastError };
    });
  return syncChain;
}
