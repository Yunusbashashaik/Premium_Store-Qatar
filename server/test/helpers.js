import assert from "node:assert/strict";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { setOffHostFetch } from "../src/db/offHostBackup.js";
import { setAdminCatalogFetch } from "../src/db/adminCatalog.js";

export function enableFactorySeed() {
  process.env.ALLOW_FACTORY_SEED = "1";
}

export function disableFactorySeed() {
  delete process.env.ALLOW_FACTORY_SEED;
}

export function isolateOffHostBackup() {
  process.env.CATALOG_BACKUP_SKIP_PACKAGED = "1";
  process.env.CATALOG_BACKUP_URL = "https://127.0.0.1/disabled-catalog-backup.json";
  process.env.CATALOG_BACKUP_PATH = "__no_catalog_backup__/admin-state.json";
  process.env.ADMIN_CATALOG_DISABLED = "1";
  process.env.ADMIN_CATALOG_SKIP_PACKAGED = "1";
  process.env.ADMIN_CATALOG_SYNC_MS = "0";
  setOffHostFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => "disabled",
    json: async () => ({ message: "disabled" }),
  }));
}

export function restoreOffHostBackupEnv() {
  delete process.env.CATALOG_BACKUP_SKIP_PACKAGED;
  delete process.env.CATALOG_BACKUP_URL;
  delete process.env.CATALOG_BACKUP_PATH;
  delete process.env.ADMIN_CATALOG_DISABLED;
  delete process.env.ADMIN_CATALOG_SKIP_PACKAGED;
  delete process.env.ADMIN_CATALOG_SYNC_MS;
  delete process.env.ADMIN_CATALOG_URL;
  delete process.env.ADMIN_CATALOG_DIR;
  setOffHostFetch(null);
  setAdminCatalogFetch(null);
}

export function assertNoFactoryNames(services) {
  const names = new Set(DEFAULT_SERVICES.map((service) => service.nameEn));
  const ids = new Set(DEFAULT_SERVICES.map((service) => service.id));
  for (const service of services || []) {
    assert.equal(
      names.has(service.nameEn),
      false,
      `factory name must not appear: ${service.nameEn}`,
    );
  }
  if ((services || []).length === 0) return;
  const liveIds = (services || []).map((s) => s.id).sort().join(",");
  const factoryIds = [...ids].sort().join(",");
  assert.notEqual(liveIds, factoryIds, "live catalog must not be factory DEFAULT_SERVICES");
}

export function customCatalog(nameEn = "YouTube Premium") {
  return DEFAULT_SERVICES.map((service) =>
    service.id === "youtube-premium-personal" ? { ...service, nameEn } : service,
  );
}
