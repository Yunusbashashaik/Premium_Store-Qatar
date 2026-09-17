import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import { DEFAULT_SETTINGS } from "../config/defaults.js";

export const CATALOG_SNAPSHOT_VERSION = 1;
export const CATALOG_SNAPSHOT_GENERATION = 5;

export function servicesForCatalogBackup(services = DEFAULT_SERVICES) {
  return (services || []).map((service, index) => ({
    ...service,
    sortOrder: service.sortOrder ?? index,
    offerType: service.offerType || "none",
    offerExpiresAt: service.offerExpiresAt ?? null,
  }));
}

export function buildBootstrapCatalogSnapshot({ savedAt = new Date().toISOString() } = {}) {
  return {
    version: CATALOG_SNAPSHOT_VERSION,
    generation: CATALOG_SNAPSHOT_GENERATION,
    savedAt,
    services: servicesForCatalogBackup(),
    settings: {
      ...DEFAULT_SETTINGS,
      catalogSeeded: true,
    },
  };
}
