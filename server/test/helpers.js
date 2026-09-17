import assert from "node:assert/strict";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";

export function enableFactorySeed() {
  process.env.ALLOW_FACTORY_SEED = "1";
}

export function disableFactorySeed() {
  delete process.env.ALLOW_FACTORY_SEED;
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
