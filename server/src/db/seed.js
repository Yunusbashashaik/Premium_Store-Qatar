import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import {
  bindPersist,
  catalogMatchesDefaults,
  catalogWasInitialized,
  findNonDefaultAdminSnapshot,
  hydratePersistedAdminState,
  persistAdminState,
  withoutPersist,
} from "./persist.js";
import {
  countServices,
  getServiceImageBlob,
  insertService,
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
  getSetting,
  countSettings,
  countServices,
  replaceAllServices,
  replaceAllSettings,
  getServiceImageBlob,
});

let lastSeedResult = {
  servicesSeeded: false,
  settingsSeeded: false,
  catalogSeededThisBoot: false,
  hydrated: { restored: false },
  catalogReset: false,
  seedSkippedReason: null,
};

export function getLastSeedResult() {
  return lastSeedResult;
}

/**
 * Production boot (server/src/index.js): initDatabase() then seedDatabase().
 * initDatabase: resolveDataDir → migrate legacy → recover best backup
 *   (/local, /root, $HOME, DATA_DIR) → open store.
 * seedDatabase: bindPersist (module load) → settings seed → hydrate snapshot
 *   → factory seed ONLY on true first boot → persist (never over custom).
 * Self-wipe / factory reseed after init is removed.
 */
function seedDefaultCatalogIfEmpty() {
  if (countServices() > 0) {
    setSetting("catalogSeeded", true);
    return { seeded: false, reason: "catalog-not-empty" };
  }

  if (getSetting("catalogSeeded") === true) {
    return { seeded: false, reason: "catalog-seeded-flag" };
  }

  if (catalogWasInitialized()) {
    setSetting("catalogSeeded", true);
    return { seeded: false, reason: "initialized-elsewhere" };
  }

  const customSnapshot = findNonDefaultAdminSnapshot();
  if (customSnapshot) {
    console.error(
      "Skipping factory catalog seed; custom admin snapshot exists at",
      customSnapshot.path,
    );
    setSetting("catalogSeeded", true);
    return { seeded: false, reason: "custom-snapshot" };
  }

  withoutPersist(() => {
    DEFAULT_SERVICES.forEach((service, index) => {
      insertService(
        {
          ...service,
          sortOrder: service.sortOrder ?? index,
        },
        { persist: false },
      );
    });
  });
  setSetting("catalogSeeded", true);
  return { seeded: true, reason: "true-first-boot" };
}

function persistAfterBoot() {
  const custom = findNonDefaultAdminSnapshot();
  const live = listServices();
  const liveIsDefaultOrEmpty = live.length === 0 || catalogMatchesDefaults(live);
  if (custom && liveIsDefaultOrEmpty) {
    console.error(
      "Skipping persist of factory/empty catalog over custom snapshot at",
      custom.path,
    );
    return;
  }
  persistAdminState();
}

export function seedDatabase() {
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const hydrated = hydratePersistedAdminState();
  const seed = seedDefaultCatalogIfEmpty();
  persistAfterBoot();

  lastSeedResult = {
    servicesSeeded: seed.seeded,
    settingsSeeded,
    catalogSeededThisBoot: seed.seeded,
    hydrated,
    catalogReset: false,
    seedSkippedReason: seed.seeded ? null : seed.reason,
  };
  return lastSeedResult;
}
