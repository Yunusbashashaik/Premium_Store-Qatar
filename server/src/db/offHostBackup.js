import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { catalogMatchesDefaults } from "./catalogFingerprint.js";
import { isFactorySeedAllowed } from "./factorySeed.js";
import {
  SNAPSHOT_BACKUP_NAME,
  SNAPSHOT_NAME,
} from "./durablePaths.js";

export const DEFAULT_BACKUP_REPO = "Yunusbashashaik/Premium_Store-Qatar";
export const DEFAULT_BACKUP_PATH = "catalog-backup/admin-state.json";
export const DEFAULT_BACKUP_BRANCH = "main";
const API_VERSION = "2022-11-28";
const MODULE_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let fetchImpl = (...args) => globalThis.fetch(...args);
let saveChain = Promise.resolve();

const lastStatus = {
  configured: false,
  restoredThisBoot: false,
  restoredSource: null,
  restoredSavedAt: null,
  savedAt: null,
  lastError: null,
  lastSaveOk: null,
};

export function setOffHostFetch(fn) {
  fetchImpl = fn || ((...args) => globalThis.fetch(...args));
}

export function resetOffHostBackupStatus() {
  lastStatus.configured = false;
  lastStatus.restoredThisBoot = false;
  lastStatus.restoredSource = null;
  lastStatus.restoredSavedAt = null;
  lastStatus.savedAt = null;
  lastStatus.lastError = null;
  lastStatus.lastSaveOk = null;
  saveChain = Promise.resolve();
}

export function getDefaultCatalogBackupUrl(
  repo = DEFAULT_BACKUP_REPO,
  filePath = DEFAULT_BACKUP_PATH,
  branch = DEFAULT_BACKUP_BRANCH,
) {
  const encodedPath = String(filePath || DEFAULT_BACKUP_PATH)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://raw.githubusercontent.com/${repo || DEFAULT_BACKUP_REPO}/${branch || DEFAULT_BACKUP_BRANCH}/${encodedPath}`;
}

export function getOffHostBackupConfig() {
  const catalogToken = String(process.env.CATALOG_BACKUP_TOKEN || "").trim();
  const githubToken = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  const enabled = process.env.CATALOG_BACKUP_ENABLED === "1";
  const repoEnv = String(process.env.CATALOG_BACKUP_REPO || "").trim();
  const repo = repoEnv || DEFAULT_BACKUP_REPO;
  const filePath = String(process.env.CATALOG_BACKUP_PATH || DEFAULT_BACKUP_PATH).trim() || DEFAULT_BACKUP_PATH;
  const branch = String(process.env.CATALOG_BACKUP_BRANCH || "").trim() || DEFAULT_BACKUP_BRANCH;
  const urlEnv = String(process.env.CATALOG_BACKUP_URL || "").trim();
  const defaultUrl = getDefaultCatalogBackupUrl(repo, DEFAULT_BACKUP_PATH, branch);
  const url = urlEnv || defaultUrl;
  const token = catalogToken || ((enabled || repoEnv) ? githubToken : "");
  const skipPackaged = process.env.CATALOG_BACKUP_SKIP_PACKAGED === "1";
  const packagedPaths = skipPackaged ? [] : listPackagedBackupPaths(filePath);
  const packagedAvailable = packagedPaths.some((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
  const configured = Boolean(token || url || packagedAvailable);
  return {
    token,
    repo,
    filePath,
    branch,
    url,
    urlEnv: urlEnv || null,
    defaultUrl,
    packagedPaths,
    packagedAvailable,
    configured,
  };
}

export function getOffHostBackupStatus() {
  const config = getOffHostBackupConfig();
  return {
    ...lastStatus,
    configured: config.configured,
    repo: config.repo,
    path: config.filePath,
    url: config.url || config.defaultUrl || null,
    defaultUrl: config.defaultUrl,
  };
}

function githubHeaders(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "premium-store-qatar-catalog-backup",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function contentsUrl(config) {
  const encodedPath = config.filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const base = `https://api.github.com/repos/${config.repo}/contents/${encodedPath}`;
  if (config.branch) {
    return `${base}?ref=${encodeURIComponent(config.branch)}`;
  }
  return base;
}

function parseSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.services)) return null;
  return raw;
}

function decodeGithubContent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const encoded = String(payload.content || "").replace(/\s/g, "");
  if (!encoded) return null;
  try {
    return parseSnapshot(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  } catch {
    return null;
  }
}

function snapshotUsableForRestore(snapshot) {
  const services = Array.isArray(snapshot?.services) ? snapshot.services : [];
  return services.length > 0;
}

function repoRootCandidates() {
  const roots = [MODULE_REPO_ROOT, process.cwd()];
  try {
    const cwdParent = path.resolve(process.cwd(), "..");
    roots.push(cwdParent);
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

function siblingBackupPath(filePath) {
  if (!filePath.endsWith(".json") || filePath.endsWith(".backup.json")) return null;
  return filePath.replace(/\.json$/, ".backup.json");
}

function listPackagedBackupPaths(filePath = DEFAULT_BACKUP_PATH) {
  if (process.env.CATALOG_BACKUP_SKIP_PACKAGED === "1") return [];
  const relative = [filePath, siblingBackupPath(filePath), DEFAULT_BACKUP_PATH, siblingBackupPath(DEFAULT_BACKUP_PATH)]
    .filter(Boolean);
  const paths = [];
  const seen = new Set();
  for (const root of repoRootCandidates()) {
    for (const name of relative) {
      const full = path.join(root, name);
      if (seen.has(full)) continue;
      seen.add(full);
      paths.push(full);
    }
  }
  return paths;
}

function readPackagedSnapshot(config) {
  for (const filePath of listPackagedBackupPaths(config.filePath)) {
    try {
      const snapshot = parseSnapshot(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (snapshot) {
        return { snapshot, path: filePath };
      }
    } catch {
      /* missing or unreadable */
    }
  }
  return { snapshot: null, path: null };
}

async function githubGet(config) {
  if (!config.token || !config.repo) return { snapshot: null, sha: null, status: 0 };
  const res = await fetchImpl(contentsUrl(config), {
    method: "GET",
    headers: githubHeaders(config.token),
  });
  if (res.status === 404) return { snapshot: null, sha: null, status: 404 };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub backup GET failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return {
    snapshot: decodeGithubContent(body),
    sha: body.sha || null,
    status: res.status,
  };
}

async function fetchFromBackupUrl(url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "premium-store-qatar-catalog-backup" },
  });
  if (!res.ok) {
    throw new Error(`CATALOG_BACKUP_URL fetch failed (${res.status})`);
  }
  return parseSnapshot(await res.json());
}

export async function fetchOffHostSnapshot() {
  const config = getOffHostBackupConfig();
  lastStatus.configured = config.configured;
  if (!config.configured) {
    return { snapshot: null, source: null, reason: "not-configured" };
  }

  if (config.token) {
    try {
      const got = await githubGet(config);
      if (got.snapshot) {
        return { snapshot: got.snapshot, source: "github", sha: got.sha, reason: "github" };
      }
    } catch (err) {
      lastStatus.lastError = err?.message || String(err);
      console.error("Off-host GitHub backup fetch failed", lastStatus.lastError);
    }
  }

  if (config.urlEnv) {
    try {
      const snapshot = await fetchFromBackupUrl(config.urlEnv);
      if (snapshot) {
        return { snapshot, source: "url", sha: null, reason: "url" };
      }
    } catch (err) {
      lastStatus.lastError = err?.message || String(err);
      console.error("Off-host CATALOG_BACKUP_URL fetch failed", lastStatus.lastError);
    }
  }

  const packaged = readPackagedSnapshot(config);
  if (packaged.snapshot) {
    return {
      snapshot: packaged.snapshot,
      source: "packaged",
      sha: null,
      reason: "packaged",
      path: packaged.path,
    };
  }

  if (config.defaultUrl) {
    try {
      const snapshot = await fetchFromBackupUrl(config.defaultUrl);
      if (snapshot) {
        return { snapshot, source: "url", sha: null, reason: "url" };
      }
    } catch (err) {
      lastStatus.lastError = err?.message || String(err);
      console.error("Off-host default raw backup fetch failed", lastStatus.lastError);
    }
  }

  return { snapshot: null, source: null, reason: "no-off-host-snapshot" };
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function dirHasCustomSnapshot(dir) {
  for (const name of [SNAPSHOT_NAME, SNAPSHOT_BACKUP_NAME]) {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const services = Array.isArray(existing?.services) ? existing.services : [];
      if (services.length > 0 && !catalogMatchesDefaults(services)) return true;
    } catch {
      /* missing */
    }
  }
  return false;
}

export function writeSnapshotPair(dir, snapshot) {
  if (!dir || !snapshot) return [];
  const incoming = Array.isArray(snapshot.services) ? snapshot.services : [];
  if (dirHasCustomSnapshot(dir) && (incoming.length === 0 || catalogMatchesDefaults(incoming))) {
    console.error(
      "Refusing to overwrite custom admin snapshot with factory/empty off-host catalog",
      dir,
    );
    return [];
  }
  const payload = {
    version: snapshot.version || 1,
    generation: snapshot.generation || 5,
    savedAt: snapshot.savedAt || new Date().toISOString(),
    services: incoming,
    settings: snapshot.settings && typeof snapshot.settings === "object" ? snapshot.settings : {},
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const written = [];
  for (const name of [SNAPSHOT_NAME, SNAPSHOT_BACKUP_NAME]) {
    const filePath = path.join(dir, name);
    atomicWrite(filePath, body);
    written.push(filePath);
  }
  return written;
}

export async function restoreOffHostBackupToDirs(dirs) {
  const fetched = await fetchOffHostSnapshot();
  if (!fetched.snapshot) {
    return { restored: false, reason: fetched.reason || "no-off-host-snapshot", snapshot: null };
  }
  if (!snapshotUsableForRestore(fetched.snapshot)) {
    return { restored: false, reason: "off-host-factory-or-empty", snapshot: fetched.snapshot };
  }
  const targets = (dirs || []).filter(Boolean);
  const written = [];
  for (const dir of targets) {
    try {
      written.push(...writeSnapshotPair(dir, fetched.snapshot));
    } catch (err) {
      console.error("Failed to materialize off-host snapshot", dir, err?.message || err);
    }
  }
  if (!written.length) {
    return { restored: false, reason: "off-host-not-materialized", snapshot: fetched.snapshot };
  }
  lastStatus.restoredThisBoot = true;
  lastStatus.restoredSource = fetched.source;
  lastStatus.restoredSavedAt = fetched.snapshot.savedAt || null;
  console.log(
    `Restored catalog from off-host backup (${fetched.source}) into ${written.length} snapshot files.`,
  );
  return {
    restored: true,
    reason: "off-host",
    source: fetched.source,
    snapshot: fetched.snapshot,
    savedAt: fetched.snapshot.savedAt || null,
    written,
  };
}

async function githubPut(config, snapshot, sha) {
  const content = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8").toString(
    "base64",
  );
  const payload = {
    message: `chore: sync store catalog backup (${snapshot.savedAt || "now"})`,
    content,
    ...(sha ? { sha } : {}),
    ...(config.branch ? { branch: config.branch } : {}),
  };
  const res = await fetchImpl(contentsUrl(config).replace(/\?ref=.*$/, ""), {
    method: "PUT",
    headers: githubHeaders(config.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub backup PUT failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = await res.json().catch(() => ({}));
  return body;
}

export async function saveOffHostBackup(snapshot) {
  const config = getOffHostBackupConfig();
  lastStatus.configured = config.configured;
  if (!config.token) {
    return { saved: false, reason: "no-token" };
  }
  const services = Array.isArray(snapshot?.services) ? snapshot.services : [];
  if (!services.length) {
    return { saved: false, reason: "empty-catalog" };
  }
  if (catalogMatchesDefaults(services) && !isFactorySeedAllowed()) {
    return { saved: false, reason: "factory-catalog" };
  }

  try {
    const existing = await githubGet(config);
    const remoteServices = Array.isArray(existing.snapshot?.services)
      ? existing.snapshot.services
      : [];
    const remoteCustom =
      remoteServices.length > 0 && !catalogMatchesDefaults(remoteServices);
    const incomingWeak =
      services.length === 0 || catalogMatchesDefaults(services);
    if (remoteCustom && incomingWeak) {
      return { saved: false, reason: "refuse-overwrite-custom-remote" };
    }
    await githubPut(config, snapshot, existing.sha);
    lastStatus.savedAt = snapshot.savedAt || new Date().toISOString();
    lastStatus.lastSaveOk = true;
    lastStatus.lastError = null;
    return { saved: true, reason: "github", savedAt: lastStatus.savedAt };
  } catch (err) {
    lastStatus.lastSaveOk = false;
    lastStatus.lastError = err?.message || String(err);
    console.error("Off-host catalog backup save failed", lastStatus.lastError);
    return { saved: false, reason: "error", error: lastStatus.lastError };
  }
}

export function queueOffHostSave(snapshot) {
  saveChain = saveChain
    .then(() => saveOffHostBackup(snapshot))
    .catch((err) => {
      lastStatus.lastError = err?.message || String(err);
      return { saved: false, reason: "error" };
    });
  return saveChain;
}

export function flushOffHostBackup() {
  return saveChain;
}
