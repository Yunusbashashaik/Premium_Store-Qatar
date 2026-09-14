import fs from "fs";
import {
  bindPersist,
  hydratePersistedAdminState,
  persistAdminState,
  withoutPersist,
  CATALOG_GENERATION,
} from "./persist.js";
import { SERVICE_UPLOADS_DIR } from "./connection.js";
import {
  getServiceImageBlob,
  listServices,
  replaceAllServices,
} from "../models/Service.js";
import {
  countSettings,
  getAllSettings,
  getSetting,
  replaceAllSettings,
  seedSettingsIfEmpty,
  setSetting,
} from "../models/Settings.js";

bindPersist({
  listServices,
  getAllSettings,
  countSettings,
  replaceAllServices,
  replaceAllSettings,
  getServiceImageBlob,
});

function clearServiceUploads() {
  try {
    fs.rmSync(SERVICE_UPLOADS_DIR, { recursive: true, force: true });
    fs.mkdirSync(SERVICE_UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to clear service uploads", err?.message || err);
  }
}

export function seedDatabase() {
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const hydrated = hydratePersistedAdminState();

  // Catalog is hardcoded in the client. Never keep leftover DB/snapshot services.
  withoutPersist(() => replaceAllServices([]));
  clearServiceUploads();
  setSetting("catalogGeneration", CATALOG_GENERATION);
  persistAdminState();

  const gen = Number(getSetting("catalogGeneration") || 0);
  return {
    servicesSeeded: false,
    settingsSeeded,
    hydrated,
    catalogReset: gen === CATALOG_GENERATION,
  };
}
