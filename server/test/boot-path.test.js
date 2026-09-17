import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { closeDatabase, getLastRecovery, initDatabase } from "../src/db/connection.js";
import { SNAPSHOT_BACKUP_NAME, SNAPSHOT_NAME } from "../src/db/durablePaths.js";
import { catalogMatchesDefaults, writeAdminSnapshot } from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices, updateService } from "../src/models/Service.js";
import { getSetting } from "../src/models/Settings.js";
import { disableFactorySeed, enableFactorySeed } from "./helpers.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-boot-"));
}

function wipeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function readSnap(dir, name = SNAPSHOT_NAME) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
}

async function withDurableTrio(fn) {
  const localDir = tempDir();
  const rootDir = tempDir();
  const homeDir = tempDir();
  const prevDataDir = process.env.DATA_DIR;
  const prevBackup = process.env.DURABLE_BACKUP_DIRS;
  const prevFactory = process.env.ALLOW_FACTORY_SEED;
  process.env.DATA_DIR = localDir;
  process.env.DURABLE_BACKUP_DIRS = [localDir, rootDir, homeDir].join(path.delimiter);
  try {
    return await fn({ localDir, rootDir, homeDir });
  } finally {
    closeDatabase();
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevBackup === undefined) delete process.env.DURABLE_BACKUP_DIRS;
    else process.env.DURABLE_BACKUP_DIRS = prevBackup;
    if (prevFactory === undefined) delete process.env.ALLOW_FACTORY_SEED;
    else process.env.ALLOW_FACTORY_SEED = prevFactory;
    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

afterEach(() => {
  closeDatabase();
  delete process.env.DURABLE_BACKUP_DIRS;
  disableFactorySeed();
});

describe("production boot path (initDatabase → seedDatabase)", () => {
  it("does not factory-seed without ALLOW_FACTORY_SEED and writes snapshot pairs", async () => {
    await withDurableTrio(async ({ localDir, rootDir, homeDir }) => {
      disableFactorySeed();
      initDatabase();
      const first = await seedDatabase();
      assert.equal(first.catalogSeededThisBoot, false);
      assert.equal(first.seedSkippedReason, "factory-seed-disabled");
      assert.equal(listServices().length, 0);
      assert.equal(catalogMatchesDefaults(listServices()), false);

      const health = getHealthPayload();
      assert.equal(health.factorySeedDisabled, true);
      assert.equal(health.catalogEmpty, true);
      assert.equal(health.catalogSeededThisBoot, false);
      assert.ok(Array.isArray(health.replicas));
      assert.ok(health.hydrateReason);

      for (const dir of [localDir, rootDir, homeDir]) {
        assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_NAME)), true);
        assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_BACKUP_NAME)), true);
      }
    });
  });

  it("factory-seeds only when ALLOW_FACTORY_SEED=1, then keeps catalog on second boot", async () => {
    await withDurableTrio(async ({ localDir, rootDir, homeDir }) => {
      enableFactorySeed();
      initDatabase();
      const first = await seedDatabase();
      assert.equal(first.catalogSeededThisBoot, true);
      assert.equal(getSetting("catalogSeeded"), true);
      assert.equal(listServices().length, DEFAULT_SERVICES.length);
      for (const dir of [localDir, rootDir, homeDir]) {
        assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_NAME)), true);
        assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_BACKUP_NAME)), true);
      }

      closeDatabase();
      initDatabase();
      const second = await seedDatabase();
      assert.equal(second.catalogSeededThisBoot, false);
      assert.equal(second.servicesSeeded, false);
      assert.equal(listServices().length, DEFAULT_SERVICES.length);

      const health = getHealthPayload();
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.factorySeedDisabled, false);
      assert.ok(Array.isArray(health.snapshotPaths));
      assert.ok(Array.isArray(health.snapshotWritePaths));
      assert.ok(Array.isArray(health.backupDirs));
      assert.equal(health.dataDir, path.resolve(localDir));
    });
  });

  it("restores custom names from $HOME replica after /local is wiped, without factory seed", async () => {
    await withDurableTrio(async ({ localDir, rootDir, homeDir }) => {
      enableFactorySeed();
      initDatabase();
      await seedDatabase();
      disableFactorySeed();
      updateService("youtube-premium-personal", {
        nameEn: "YouTube Premium",
        offerType: "special",
        offerExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      assert.equal(
        readSnap(homeDir).services.find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
      assert.equal(
        readSnap(homeDir, SNAPSHOT_BACKUP_NAME).services.find((s) => s.id === "youtube-premium-personal")
          .offerType,
        "special",
      );
      assert.equal(
        readSnap(rootDir).services.find((s) => s.id === "youtube-premium-personal").offerType,
        "special",
      );

      closeDatabase();
      wipeDir(localDir);
      assert.equal(fs.existsSync(path.join(localDir, SNAPSHOT_NAME)), false);
      assert.equal(fs.existsSync(path.join(homeDir, SNAPSHOT_NAME)), true);

      initDatabase();
      const recovery = getLastRecovery();
      assert.equal(recovery.recovered, true);
      assert.equal(recovery.nonDefault, true);
      assert.ok([path.resolve(homeDir), path.resolve(rootDir)].includes(recovery.from));

      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(seeded.servicesSeeded, false);
      const youtube = listServices().find((s) => s.id === "youtube-premium-personal");
      assert.equal(youtube.nameEn, "YouTube Premium");
      assert.equal(youtube.offerType, "special");
      assert.ok(youtube.offerExpiresAt);
      assert.equal(catalogMatchesDefaults(listServices()), false);

      const health = getHealthPayload();
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.catalogMatchesDefaults, false);
      assert.equal(health.factorySeedDisabled, true);
      assert.ok(health.hydrateReason);
      assert.equal(health.recovery.recovered, true);
    });
  });

  it("leaves the catalog empty after a total replica wipe and never inserts factory names", async () => {
    await withDurableTrio(async ({ localDir, rootDir, homeDir }) => {
      enableFactorySeed();
      initDatabase();
      await seedDatabase();
      disableFactorySeed();
      closeDatabase();
      wipeDir(localDir);
      wipeDir(rootDir);
      wipeDir(homeDir);

      initDatabase();
      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(listServices().length, 0);
      assert.equal(catalogMatchesDefaults(listServices()), false);
      const factoryNames = new Set(DEFAULT_SERVICES.map((service) => service.nameEn));
      for (const service of listServices()) {
        assert.equal(factoryNames.has(service.nameEn), false);
      }

      const health = getHealthPayload();
      assert.equal(health.catalogEmpty, true);
      assert.equal(health.factorySeedDisabled, true);
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.catalogMatchesDefaults, false);
    });
  });

  it("does not factory-fill when primary is empty but catalogSeeded survives on a backup snapshot", async () => {
    await withDurableTrio(async ({ localDir, homeDir }) => {
      disableFactorySeed();
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, SNAPSHOT_NAME),
        `${JSON.stringify({
          version: 1,
          generation: 5,
          savedAt: "2026-01-01T00:00:00.000Z",
          services: [],
          settings: { catalogSeeded: true, complaintEmail: "kept@example.com" },
        })}\n`,
      );

      initDatabase();
      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(listServices().length, 0);
      assert.equal(catalogMatchesDefaults(listServices()), false);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(homeDir, SNAPSHOT_NAME), "utf8")).settings.catalogSeeded,
        true,
      );
      assert.equal(path.resolve(localDir), path.resolve(process.env.DATA_DIR));
    });
  });

  it("refuses to persist factory DEFAULT_SERVICES over a custom replica snapshot", async () => {
    await withDurableTrio(async ({ localDir, homeDir }) => {
      disableFactorySeed();
      const custom = DEFAULT_SERVICES.map((service) =>
        service.id === "canva-pro" ? { ...service, nameEn: "Canva Pro" } : service,
      );
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, SNAPSHOT_NAME),
        `${JSON.stringify({
          version: 1,
          generation: 5,
          savedAt: "2026-02-01T00:00:00.000Z",
          services: custom,
          settings: { catalogSeeded: true },
        })}\n`,
      );

      initDatabase();
      writeAdminSnapshot({ services: DEFAULT_SERVICES, settings: {} });
      assert.equal(
        readSnap(homeDir).services.find((s) => s.id === "canva-pro").nameEn,
        "Canva Pro",
      );

      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(listServices().find((s) => s.id === "canva-pro").nameEn, "Canva Pro");
      assert.equal(readSnap(homeDir).services.find((s) => s.id === "canva-pro").nameEn, "Canva Pro");
      assert.equal(getHealthPayload().catalogMatchesDefaults, false);
      assert.ok(localDir);
    });
  });
});
