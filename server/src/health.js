import { getActiveStorePath, getDataDir, getDbEngine } from "./db/connection.js";
import { getPersistStatus } from "./db/persist.js";
import { getLastSeedResult } from "./db/seed.js";
import { countServices } from "./models/Service.js";
import { getSetting } from "./models/Settings.js";

export function getHealthPayload() {
  const persist = getPersistStatus();
  const seed = getLastSeedResult();
  return {
    ok: true,
    service: "premium-store-qatar-api",
    db: getDbEngine(),
    dataDir: getDataDir(),
    storePath: getActiveStorePath(),
    services: countServices(),
    catalogSeededThisBoot: Boolean(seed.catalogSeededThisBoot),
    catalogSeeded: getSetting("catalogSeeded") === true,
    snapshotSavedAt: persist.snapshotSavedAt,
    snapshotServices: persist.snapshotServices,
    time: new Date().toISOString(),
  };
}
