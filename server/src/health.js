import { getActiveStorePath, getDataDir, getDbEngine, getLastRecovery } from "./db/connection.js";
import { catalogMatchesDefaults, getPersistStatus } from "./db/persist.js";
import { getLastSeedResult } from "./db/seed.js";
import { countServices, listServices } from "./models/Service.js";
import { getSetting } from "./models/Settings.js";

export function getHealthPayload() {
  const persist = getPersistStatus();
  const seed = getLastSeedResult();
  const recovery = getLastRecovery();
  return {
    ok: true,
    service: "premium-store-qatar-api",
    db: getDbEngine(),
    dataDir: getDataDir(),
    storePath: getActiveStorePath(),
    services: countServices(),
    catalogSeededThisBoot: Boolean(seed.catalogSeededThisBoot),
    catalogSeeded: getSetting("catalogSeeded") === true,
    catalogMatchesDefaults: catalogMatchesDefaults(listServices()),
    snapshotSavedAt: persist.snapshotSavedAt,
    snapshotServices: persist.snapshotServices,
    snapshotPaths: persist.snapshotPaths,
    snapshotPath: persist.snapshotPath || null,
    hydrateReason: seed.hydrated?.reason || null,
    recovery,
    time: new Date().toISOString(),
  };
}
