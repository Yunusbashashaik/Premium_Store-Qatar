import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import { isFactorySeedAllowed } from "./factorySeed.js";
import {
  restoreOffHostBackupToDirs,
  resetOffHostBackupStatus,
} from "./offHostBackup.js";
import {
  bindPersist,
  catalogMatchesDefaults,
  catalogWasInitialized,
  findNonDefaultAdminSnapshot,
  getSnapshotWriteDirs,
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
  offHost: { restored: false },
  factorySeedDisabled: true,
};

export function getLastSeedResult() {
  return lastSeedResult;
}

/**
 * Production boot: initDatabase() then seedDatabase().
 * Restore local replicas, then off-host backup, then factory-seed only if
 * ALLOW_FACTORY_SEED=1. Empty after restore stays empty.
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

  if (!isFactorySeedAllowed()) {
    return { seeded: false, reason: "factory-seed-disabled" };
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

export async function seedDatabase() {
  resetOffHostBackupStatus();
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  let hydrated = hydratePersistedAdminState();
  let offHost = { restored: false, reason: null };

  if (countServices() === 0) {
    offHost = await restoreOffHostBackupToDirs(getSnapshotWriteDirs());
    if (offHost.restored) {
      hydrated = hydratePersistedAdminState();
      hydrated = {
        ...hydrated,
        reason: hydrated.restored ? "off-host" : hydrated.reason,
        offHostSource: offHost.source,
      };
    }
  }

  const seed = seedDefaultCatalogIfEmpty();
  persistAfterBoot();

  lastSeedResult = {
    servicesSeeded: seed.seeded,
    settingsSeeded,
    catalogSeededThisBoot: seed.seeded,
    hydrated,
    catalogReset: false,
    seedSkippedReason: seed.seeded ? null : seed.reason,
    offHost,
    factorySeedDisabled: !isFactorySeedAllowed(),
  };
  return lastSeedResult;
}
