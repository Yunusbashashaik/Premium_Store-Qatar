import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import {
  bindPersist,
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
};

export function getLastSeedResult() {
  return lastSeedResult;
}

function seedDefaultCatalogIfEmpty() {
  if (countServices() > 0) {
    setSetting("catalogSeeded", true);
    return false;
  }

  // Catalog was already initialized (admin deleted every row). Do not re-insert defaults.
  if (getSetting("catalogSeeded") === true) {
    return false;
  }

  const customSnapshot = findNonDefaultAdminSnapshot();
  if (customSnapshot) {
    console.error(
      "Skipping factory catalog seed; custom admin snapshot exists at",
      customSnapshot.path,
    );
    return false;
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
  return true;
}

export function seedDatabase() {
  const settingsSeeded = withoutPersist(() => seedSettingsIfEmpty());
  const hydrated = hydratePersistedAdminState();
  const servicesSeeded = seedDefaultCatalogIfEmpty();
  if (servicesSeeded && findNonDefaultAdminSnapshot()) {
    // Factory rows stay in-memory/DB for this empty volume, but must not clobber a custom replica.
    console.error("Factory seed completed; custom snapshot replicas left unchanged.");
  } else {
    persistAdminState();
  }

  lastSeedResult = {
    servicesSeeded,
    settingsSeeded,
    catalogSeededThisBoot: servicesSeeded,
    hydrated,
    catalogReset: false,
  };
  return lastSeedResult;
}
