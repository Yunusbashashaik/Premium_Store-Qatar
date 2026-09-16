import fs from "fs";
import path from "path";
import {
  getActiveStorePath,
  getDataDir,
  LEGACY_APP_DATA_DIR,
} from "./connection.js";
import {
  catalogMatchesDefaults,
  catalogSignature,
  rankSnapshot,
  settingsMatchDefaults,
  settingsSignature,
  snapshotLooksInitialized,
} from "./catalogFingerprint.js";
import {
  extraDurableReplicationEnabled,
  getDurableBackupDirs,
  isEphemeralAppPath,
  SNAPSHOT_NAME,
} from "./durablePaths.js";

export {
  catalogMatchesDefaults,
  catalogSignature,
  settingsMatchDefaults,
  snapshotLooksInitialized,
} from "./catalogFingerprint.js";

/** Snapshot format version. Never used to wipe or replace a live catalog. */
export const CATALOG_GENERATION = 5;

let source = null;
let persistDisabled = 0;
let lastSnapshotChoice = { path: null, reason: "none" };

export function bindPersist(nextSource) {
  source = nextSource;
}

export function withoutPersist(fn) {
  persistDisabled += 1;
  try {
    return fn();
  } finally {
    persistDisabled -= 1;
  }
}

function replicaDirs() {
  if (!extraDurableReplicationEnabled(getDataDir())) return [];
  return getDurableBackupDirs();
}

export function getSnapshotWritePaths() {
  const dirs = new Set();
  const storePath = getActiveStorePath();
  if (storePath) dirs.add(path.dirname(path.resolve(storePath)));
  dirs.add(path.resolve(getDataDir()));
  if (process.env.DATA_DIR) dirs.add(path.resolve(process.env.DATA_DIR));
  for (const dir of replicaDirs()) dirs.add(dir);
  return [...dirs]
    .filter((dir) => !isEphemeralAppPath(dir))
    .map((dir) => path.join(dir, SNAPSHOT_NAME));
}

export function getSnapshotPaths() {
  const paths = new Set(getSnapshotWritePaths());
  paths.add(path.join(path.resolve(LEGACY_APP_DATA_DIR), SNAPSHOT_NAME));
  for (const dir of replicaDirs()) {
    paths.add(path.join(dir, SNAPSHOT_NAME));
  }
  return [...paths];
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function serializeServices() {
  if (!source?.listServices) return [];
  return source.listServices().map((service) => {
    const blob = source.getServiceImageBlob?.(service.id);
    const rest = { ...service };
    delete rest.imageSrc;
    return {
      ...rest,
      offerType: service.offerType || "none",
      offerExpiresAt: service.offerExpiresAt || null,
      imageBase64:
        blob && blob.length ? Buffer.from(blob).toString("base64") : undefined,
    };
  });
}

function existingSnapshotIsCustom(filePath) {
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const services = Array.isArray(existing?.services) ? existing.services : [];
    return services.length > 0 && !catalogMatchesDefaults(services);
  } catch {
    return false;
  }
}

function shouldRefuseSnapshotOverwrite(filePath, incomingServices) {
  if (!existingSnapshotIsCustom(filePath)) return false;
  if (!Array.isArray(incomingServices) || incomingServices.length === 0) return true;
  return catalogMatchesDefaults(incomingServices);
}

export function writeAdminSnapshot(state) {
  if (!state) return null;
  const payload = {
    version: 1,
    generation: CATALOG_GENERATION,
    savedAt: new Date().toISOString(),
    services: Array.isArray(state.services) ? state.services : [],
    settings: state.settings && typeof state.settings === "object" ? state.settings : {},
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const written = [];
  const skipped = [];
  for (const filePath of getSnapshotWritePaths()) {
    try {
      if (shouldRefuseSnapshotOverwrite(filePath, payload.services)) {
        console.error(
          "Refusing to overwrite custom admin snapshot with factory/empty catalog",
          filePath,
        );
        skipped.push(filePath);
        continue;
      }
      atomicWrite(filePath, body);
      written.push(filePath);
    } catch (err) {
      console.error("Failed to write admin snapshot", filePath, err?.message || err);
    }
  }
  lastSnapshotChoice = {
    ...lastSnapshotChoice,
    lastWritePaths: written,
    lastSkippedPaths: skipped,
  };
  return payload;
}

export function persistAdminState() {
  if (persistDisabled || !source) return null;
  try {
    const catalogSeeded =
      source.getSetting?.("catalogSeeded") === true ||
      (source.countServices?.() || 0) > 0;
    return writeAdminSnapshot({
      services: serializeServices(),
      settings: {
        ...source.getAllSettings(),
        catalogSeeded,
      },
    });
  } catch (err) {
    console.error("Failed to persist admin state", err?.message || err);
    return null;
  }
}

function readSnapshotFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object") return null;
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    /* ignore */
  }
  return { snapshot: parsed, path: filePath, mtimeMs };
}

export function listReadableSnapshots() {
  const found = [];
  for (const filePath of getSnapshotPaths()) {
    try {
      const entry = readSnapshotFile(filePath);
      if (entry) found.push(entry);
    } catch {
      /* missing or unreadable */
    }
  }
  return found;
}

export function findNonDefaultAdminSnapshot() {
  let best = null;
  let bestScore = -1;
  for (const entry of listReadableSnapshots()) {
    const rank = rankSnapshot(entry.snapshot, entry.mtimeMs);
    if (!rank.nonDefault) continue;
    if (rank.score > bestScore) {
      best = { ...entry, ...rank };
      bestScore = rank.score;
    }
  }
  return best;
}

export function readAdminSnapshot() {
  let best = null;
  let bestScore = -1;
  let bestPath = null;
  let reason = "no-snapshot";
  for (const entry of listReadableSnapshots()) {
    const rank = rankSnapshot(entry.snapshot, entry.mtimeMs);
    if (!best || rank.score > bestScore) {
      best = entry.snapshot;
      bestScore = rank.score;
      bestPath = entry.path;
      reason = rank.nonDefault ? "preferred-non-default" : "preferred-newest-default";
    }
  }
  lastSnapshotChoice = { path: bestPath, reason: best ? reason : "no-snapshot" };
  return best;
}

export function getLastSnapshotChoice() {
  return lastSnapshotChoice;
}

export function catalogWasInitialized() {
  if (source?.getSetting?.("catalogSeeded") === true) return true;
  if ((source?.countServices?.() || 0) > 0) return true;
  for (const entry of listReadableSnapshots()) {
    if (snapshotLooksInitialized(entry.snapshot)) return true;
  }
  return false;
}

export function hydratePersistedAdminState() {
  if (!source) return { restored: false, reason: "unbound" };
  const snapshot = readAdminSnapshot();
  if (!snapshot) return { restored: false, reason: "no-snapshot", snapshotPath: null };

  const currentSettings = source.getAllSettings();
  const snapSettings = snapshot.settings && typeof snapshot.settings === "object" ? snapshot.settings : null;
  const snapServices = Array.isArray(snapshot.services) ? snapshot.services : [];

  let restoredServices = false;
  let restoredSettings = false;
  let reason = "skipped-same-catalog";

  withoutPersist(() => {
    const currentServices = source.listServices();
    const emptyCatalog = currentServices.length === 0;
    const currentIsDefault = catalogMatchesDefaults(currentServices);
    const snapshotDiffers =
      catalogSignature(currentServices) !== catalogSignature(snapServices);
    const snapshotCanReplaceDefaults =
      snapServices.length >= currentServices.length && snapServices.length > 0;
    if (snapServices.length === 0) {
      reason = "skipped-snapshot-empty";
    } else if (
      emptyCatalog ||
      (currentIsDefault && snapshotDiffers && snapshotCanReplaceDefaults)
    ) {
      source.replaceAllServices(snapServices);
      restoredServices = true;
      reason = emptyCatalog ? "restored-empty-catalog" : "restored-over-defaults";
    } else if (!currentIsDefault && snapshotDiffers) {
      reason = "skipped-live-custom";
    }

    if (snapSettings) {
      const emptySettings = source.countSettings() === 0;
      const currentSettingsAreDefault = settingsMatchDefaults(currentSettings);
      const snapshotSettingsDiffer =
        settingsSignature(currentSettings) !== settingsSignature(snapSettings);
      if (emptySettings || (currentSettingsAreDefault && snapshotSettingsDiffer)) {
        source.replaceAllSettings(snapSettings);
        restoredSettings = true;
        if (!restoredServices) {
          reason = emptySettings ? "restored-empty-settings" : "restored-settings-over-defaults";
        }
      }
    }
  });

  if (restoredServices || restoredSettings) {
    console.log(
      `Restored admin data from snapshot (services=${restoredServices}, settings=${restoredSettings}, reason=${reason}).`,
    );
    persistAdminState();
  }

  return {
    restored: restoredServices || restoredSettings,
    restoredServices,
    restoredSettings,
    savedAt: snapshot.savedAt || null,
    reason,
    snapshotPath: lastSnapshotChoice.path,
  };
}

export function getPersistStatus() {
  const snapshot = readAdminSnapshot();
  return {
    snapshotSavedAt: snapshot?.savedAt || null,
    snapshotServices: Array.isArray(snapshot?.services) ? snapshot.services.length : 0,
    snapshotPaths: getSnapshotPaths(),
    snapshotWritePaths: getSnapshotWritePaths(),
    snapshotPath: lastSnapshotChoice.path,
    snapshotChoice: lastSnapshotChoice.reason,
    snapshotCatalogMatchesDefaults: catalogMatchesDefaults(snapshot?.services || []),
    lastWritePaths: lastSnapshotChoice.lastWritePaths || [],
    lastSkippedPaths: lastSnapshotChoice.lastSkippedPaths || [],
    backupDirs: extraDurableReplicationEnabled(getDataDir()) ? getDurableBackupDirs() : [],
  };
}
