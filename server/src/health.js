import { getActiveStorePath, getDataDir, getDbEngine, getLastMigration, getLastRecovery } from "./db/connection.js";
import { isFactorySeedAllowed } from "./db/factorySeed.js";
import { getOffHostBackupStatus } from "./db/offHostBackup.js";
import { catalogMatchesDefaults, getPersistStatus } from "./db/persist.js";
import { getLastSeedResult } from "./db/seed.js";
import { countServices, listServices } from "./models/Service.js";
import { getSetting } from "./models/Settings.js";

export function getHealthPayload() {
  const persist = getPersistStatus();
  const seed = getLastSeedResult();
  const recovery = getLastRecovery();
  const live = listServices();
  const offHost = getOffHostBackupStatus();
  const catalogEmpty = countServices() === 0;
  return {
    ok: true,
    service: "premium-store-qatar-api",
    db: getDbEngine(),
    dataDir: getDataDir(),
    storePath: getActiveStorePath(),
    services: countServices(),
    catalogEmpty,
    catalogSeededThisBoot: Boolean(seed.catalogSeededThisBoot),
    catalogSeeded: getSetting("catalogSeeded") === true,
    catalogMatchesDefaults: catalogMatchesDefaults(live),
    factorySeedDisabled: !isFactorySeedAllowed(),
    seedSkippedReason: seed.seedSkippedReason || null,
    snapshotSavedAt: persist.snapshotSavedAt,
    snapshotServices: persist.snapshotServices,
    snapshotPaths: persist.snapshotPaths,
    snapshotWritePaths: persist.snapshotWritePaths,
    snapshotPath: persist.snapshotPath || null,
    snapshotChoice: persist.snapshotChoice || null,
    snapshotCatalogMatchesDefaults: persist.snapshotCatalogMatchesDefaults,
    backupDirs: persist.backupDirs,
    replicas: persist.replicas || [],
    hydrateReason: seed.hydrated?.reason || null,
    hydrateSnapshotPath: seed.hydrated?.snapshotPath || persist.snapshotPath || null,
    offHostBackupConfigured: Boolean(offHost.configured),
    offHostBackupRestoredThisBoot: Boolean(seed.offHost?.restored || offHost.restoredThisBoot),
    offHostBackupSavedAt: offHost.savedAt || seed.offHost?.savedAt || null,
    offHostBackupSource: seed.offHost?.source || offHost.restoredSource || null,
    recovery,
    migration: getLastMigration(),
    time: new Date().toISOString(),
  };
}
