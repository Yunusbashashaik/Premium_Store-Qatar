import fs from "fs";
import path from "path";
import { getActiveStorePath, getDataDir, LEGACY_APP_DATA_DIR } from "./connection.js";
import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import { DEFAULT_SETTINGS } from "../config/defaults.js";

const SNAPSHOT_NAME = "admin-state.json";
/** Snapshot format version. Never used to wipe or replace a live catalog. */
export const CATALOG_GENERATION = 5;

let source = null;
let persistDisabled = 0;

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

export function getSnapshotWritePaths() {
  const dirs = new Set();
  const storePath = getActiveStorePath();
  if (storePath) dirs.add(path.dirname(path.resolve(storePath)));
  dirs.add(path.resolve(getDataDir()));
  if (process.env.DATA_DIR) dirs.add(path.resolve(process.env.DATA_DIR));
  return [...dirs].map((dir) => path.join(dir, SNAPSHOT_NAME));
}

export function getSnapshotPaths() {
  const paths = new Set(getSnapshotWritePaths());
  paths.add(path.join(path.resolve(LEGACY_APP_DATA_DIR), SNAPSHOT_NAME));
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
      imageBase64:
        blob && blob.length ? Buffer.from(blob).toString("base64") : undefined,
    };
  });
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
  for (const filePath of getSnapshotWritePaths()) {
    try {
      atomicWrite(filePath, body);
    } catch (err) {
      console.error("Failed to write admin snapshot", filePath, err?.message || err);
    }
  }
  return payload;
}

export function persistAdminState() {
  if (persistDisabled || !source) return null;
  try {
    return writeAdminSnapshot({
      services: serializeServices(),
      settings: source.getAllSettings(),
    });
  } catch (err) {
    console.error("Failed to persist admin state", err?.message || err);
    return null;
  }
}

export function readAdminSnapshot() {
  let best = null;
  for (const filePath of getSnapshotPaths()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object") continue;
      if (!best || Date.parse(parsed.savedAt || 0) >= Date.parse(best.savedAt || 0)) {
        best = parsed;
      }
    } catch {
      /* missing or unreadable */
    }
  }
  return best;
}

function settingsSignature(settings) {
  const value = settings || {};
  return JSON.stringify({
    complaintEmail: value.complaintEmail,
    whatsappNumbers: value.whatsappNumbers,
    aboutEn: value.aboutEn,
    aboutAr: value.aboutAr,
    ownersEn: value.ownersEn,
    ownersAr: value.ownersAr,
    socialLinks: value.socialLinks,
  });
}

export function settingsMatchDefaults(settings) {
  return settingsSignature(settings) === settingsSignature(DEFAULT_SETTINGS);
}

function serviceSignature(service) {
  return [
    service.id,
    Number(service.prices?.month),
    Number(service.prices?.year),
    String(service.nameEn || ""),
    String(service.nameAr || ""),
    String(service.descriptionEn || ""),
    String(service.descriptionAr || ""),
    service.outOfStock ? 1 : 0,
  ].join("|");
}

function catalogSignature(services) {
  return (services || [])
    .map(serviceSignature)
    .sort()
    .join("\n");
}

export function catalogMatchesDefaults(services) {
  return catalogSignature(services) === catalogSignature(DEFAULT_SERVICES);
}

export function hydratePersistedAdminState() {
  if (!source) return { restored: false, reason: "unbound" };
  const snapshot = readAdminSnapshot();
  if (!snapshot) return { restored: false, reason: "no-snapshot" };

  const currentSettings = source.getAllSettings();
  const snapSettings = snapshot.settings && typeof snapshot.settings === "object" ? snapshot.settings : null;
  const snapServices = Array.isArray(snapshot.services) ? snapshot.services : [];

  let restoredServices = false;
  let restoredSettings = false;

  withoutPersist(() => {
    const currentServices = source.listServices();
    const emptyCatalog = currentServices.length === 0;
    const currentIsDefault = catalogMatchesDefaults(currentServices);
    const snapshotDiffers =
      catalogSignature(currentServices) !== catalogSignature(snapServices);
    const snapshotCanReplaceDefaults =
      snapServices.length >= currentServices.length && snapServices.length > 0;
    if (
      snapServices.length > 0 &&
      (emptyCatalog ||
        (currentIsDefault && snapshotDiffers && snapshotCanReplaceDefaults))
    ) {
      source.replaceAllServices(snapServices);
      restoredServices = true;
    }

    if (snapSettings) {
      const emptySettings = source.countSettings() === 0;
      const currentIsDefault = settingsMatchDefaults(currentSettings);
      const snapshotDiffers = settingsSignature(currentSettings) !== settingsSignature(snapSettings);
      if (emptySettings || (currentIsDefault && snapshotDiffers)) {
        source.replaceAllSettings(snapSettings);
        restoredSettings = true;
      }
    }
  });

  if (restoredServices || restoredSettings) {
    console.log(
      `Restored admin data from snapshot (services=${restoredServices}, settings=${restoredSettings}).`,
    );
    persistAdminState();
  }

  return {
    restored: restoredServices || restoredSettings,
    restoredServices,
    restoredSettings,
    savedAt: snapshot.savedAt || null,
  };
}

export function getPersistStatus() {
  const snapshot = readAdminSnapshot();
  return {
    snapshotSavedAt: snapshot?.savedAt || null,
    snapshotServices: Array.isArray(snapshot?.services) ? snapshot.services.length : 0,
    snapshotPaths: getSnapshotPaths(),
  };
}
