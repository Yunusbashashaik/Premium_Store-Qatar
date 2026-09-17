import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import {
  closeDatabase,
  getDataDir,
  getLastMigration,
  getLastRecovery,
  initDatabase,
} from "../src/db/connection.js";
import { SNAPSHOT_NAME } from "../src/db/durablePaths.js";
import {
  catalogMatchesDefaults,
  readAdminSnapshot,
  withoutPersist,
  writeAdminSnapshot,
} from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { disableFactorySeed, enableFactorySeed, isolateOffHostBackup, restoreOffHostBackupEnv } from "./helpers.js";
import {
  deleteService,
  insertService,
  listServices,
  replaceAllServices,
  updateService,
} from "../src/models/Service.js";
import { getAllSettings, getSetting, updateSettings } from "../src/models/Settings.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-persist-"));
}

function sqliteFiles(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function writeSnapshot(dir, payload) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, SNAPSHOT_NAME),
    `${JSON.stringify(
      {
        version: 1,
        generation: 5,
        savedAt: payload.savedAt || new Date().toISOString(),
        services: payload.services,
        settings: payload.settings || {},
      },
      null,
      2,
    )}\n`,
  );
}

function customCatalog(nameEn = "YouTube Premium") {
  return DEFAULT_SERVICES.map((service) =>
    service.id === "youtube-premium-personal"
      ? { ...service, nameEn }
      : service,
  );
}

afterEach(() => {
  closeDatabase();
  delete process.env.DURABLE_BACKUP_DIRS;
});

describe("admin catalog persistence", () => {
  before(() => {
    isolateOffHostBackup();
    enableFactorySeed();
  });
  after(() => {
    disableFactorySeed();
    restoreOffHostBackupEnv();
  });

  it("seeds the default catalog once and keeps admin edits after a second seedDatabase()", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    const firstSeed = await seedDatabase();
    assert.equal(firstSeed.servicesSeeded, true);
    assert.equal(listServices().length, DEFAULT_SERVICES.length);
    assert.equal(getSetting("catalogSeeded"), true);

    const targetId = DEFAULT_SERVICES[0].id;
    updateService(targetId, {
      prices: { month: 99, year: 900 },
      nameEn: "Admin Priced Service",
    });
    insertService({
      id: "admin-added-stream",
      nameEn: "Admin Stream",
      nameAr: "بث المشرف",
      descriptionEn: "Added by admin",
      descriptionAr: "أضيف من لوحة التحكم",
      prices: { month: 4, year: 30 },
    });
    updateSettings({
      complaintEmail: "persist-forever@example.com",
      aboutEn: "Custom about text from admin",
      ownersEn: "Test Owner One, Test Owner Two",
      whatsappNumbers: ["96811111111", "96822222222"],
    });
    assert.equal(listServices().length, DEFAULT_SERVICES.length + 1);

    closeDatabase();
    initDatabase(dbPath);
    const afterRestart = await seedDatabase();
    assert.equal(afterRestart.servicesSeeded, false);
    assert.equal(afterRestart.catalogReset, false);
    assert.equal(listServices().length, DEFAULT_SERVICES.length + 1);
    const edited = listServices().find((s) => s.id === targetId);
    assert.equal(edited.prices.month, 99);
    assert.equal(edited.prices.year, 900);
    assert.equal(edited.nameEn, "Admin Priced Service");
    assert.ok(listServices().some((s) => s.id === "admin-added-stream"));

    const settings = getAllSettings();
    assert.equal(settings.complaintEmail, "persist-forever@example.com");
    assert.equal(settings.aboutEn, "Custom about text from admin");
    assert.equal(settings.ownersEn, "Test Owner One, Test Owner Two");
    assert.deepEqual(settings.whatsappNumbers, ["96811111111", "96822222222"]);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not re-insert defaults after admin deletes a seeded service", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    await seedDatabase();
    const victim = DEFAULT_SERVICES[1].id;
    assert.equal(deleteService(victim), true);
    const remaining = listServices().length;

    closeDatabase();
    initDatabase(dbPath);
    const again = await seedDatabase();
    assert.equal(again.servicesSeeded, false);
    assert.equal(listServices().length, remaining);
    assert.equal(
      listServices().some((s) => s.id === victim),
      false,
    );

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("restores catalog services from snapshot when the database file is replaced", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    await seedDatabase();

    insertService({
      id: "admin-added-stream",
      nameEn: "Admin Stream",
      nameAr: "بث المشرف",
      descriptionEn: "Added by admin",
      descriptionAr: "أضيف من لوحة التحكم",
      prices: { month: 9, year: 55 },
    });
    updateSettings({ complaintEmail: "snapshot@example.com", aboutEn: "Kept about" });
    const expectedCount = listServices().length;

    closeDatabase();
    for (const file of sqliteFiles(dbPath)) {
      fs.rmSync(file, { force: true });
    }
    assert.equal(fs.existsSync(path.join(dir, "admin-state.json")), true);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, "admin-state.json"), "utf8"));
    assert.ok(snap.services.some((s) => s.id === "admin-added-stream"));

    initDatabase(dbPath);
    const seeded = await seedDatabase();
    assert.equal(seeded.hydrated.restoredServices, true);
    assert.equal(listServices().length, expectedCount);
    assert.ok(listServices().some((s) => s.id === "admin-added-stream"));
    assert.equal(getAllSettings().complaintEmail, "snapshot@example.com");
    assert.equal(getAllSettings().aboutEn, "Kept about");
    assert.ok(readAdminSnapshot().services.length >= expectedCount);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never overwrites an existing DB catalog with leftover snapshot services", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    await seedDatabase();
    updateService(DEFAULT_SERVICES[0].id, { prices: { month: 77, year: 770 } });

    fs.writeFileSync(
      path.join(dir, "admin-state.json"),
      `${JSON.stringify({
        version: 1,
        generation: 1,
        savedAt: new Date().toISOString(),
        services: [
          {
            id: "legacy-factory-item",
            nameEn: "Legacy Item",
            nameAr: "عنصر قديم",
            descriptionEn: "should not replace live catalog",
            descriptionAr: "يجب ألا يستبدل الكتالوج الحالي",
            prices: { month: 2.5, year: 18 },
          },
        ],
        settings: { complaintEmail: "legacy@example.com" },
      })}\n`,
    );

    const again = await seedDatabase();
    assert.equal(again.hydrated.restoredServices, false);
    assert.equal(
      listServices().some((s) => s.id === "legacy-factory-item"),
      false,
    );
    assert.equal(listServices().find((s) => s.id === DEFAULT_SERVICES[0].id).prices.month, 77);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps admin renames after ephemeral in-app data is wiped when durable DATA_DIR remains", async () => {
    const ephemeralAppData = tempDir();
    const durable = tempDir();
    const prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = durable;
    try {
      initDatabase(undefined, { skipMigrate: true, legacyDataDir: ephemeralAppData });
      const first = await seedDatabase();
      assert.equal(first.catalogSeededThisBoot, true);
      assert.equal(getDataDir(), path.resolve(durable));

      const youtube = listServices().find((s) => s.id === "youtube-premium-personal");
      const canva = listServices().find((s) => s.id === "canva-pro");
      assert.ok(youtube);
      assert.ok(canva);
      updateService("youtube-premium-personal", { nameEn: "YouTube Premium" });
      updateService("canva-pro", { nameEn: "Canva Pro" });

      closeDatabase();
      fs.rmSync(ephemeralAppData, { recursive: true, force: true });
      assert.equal(fs.existsSync(path.join(durable, "globalstore.db")), true);

      initDatabase(undefined, { skipMigrate: true, legacyDataDir: ephemeralAppData });
      const afterRestart = await seedDatabase();
      assert.equal(afterRestart.catalogSeededThisBoot, false);
      assert.equal(afterRestart.servicesSeeded, false);
      assert.equal(
        listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
      assert.equal(listServices().find((s) => s.id === "canva-pro").nameEn, "Canva Pro");

      const health = getHealthPayload();
      assert.equal(health.ok, true);
      assert.equal(health.dataDir, path.resolve(durable));
      assert.equal(health.services, listServices().length);
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.catalogSeeded, true);
      assert.equal(health.storePath, path.join(path.resolve(durable), "globalstore.db"));
    } finally {
      closeDatabase();
      if (prevDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevDataDir;
      fs.rmSync(durable, { recursive: true, force: true });
      fs.rmSync(ephemeralAppData, { recursive: true, force: true });
    }
  });

  it("seeds defaults only once on an empty durable store", async () => {
    const durable = tempDir();
    const prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = durable;
    try {
      initDatabase(undefined, { skipMigrate: true });
      const first = await seedDatabase();
      assert.equal(first.catalogSeededThisBoot, true);
      assert.equal(listServices().length, DEFAULT_SERVICES.length);
      const youtubeDefault = listServices().find((s) => s.id === "youtube-premium-personal");
      assert.ok(youtubeDefault.nameEn.includes("YouTube Premium"));

      closeDatabase();
      initDatabase(undefined, { skipMigrate: true });
      const second = await seedDatabase();
      assert.equal(second.catalogSeededThisBoot, false);
      assert.equal(second.servicesSeeded, false);
      assert.equal(listServices().length, DEFAULT_SERVICES.length);
      assert.equal(
        listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
        youtubeDefault.nameEn,
      );

      const health = getHealthPayload();
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.services, DEFAULT_SERVICES.length);
    } finally {
      closeDatabase();
      if (prevDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevDataDir;
      fs.rmSync(durable, { recursive: true, force: true });
    }
  });

  it("copies a legacy in-app store into an empty durable directory once", async () => {
    const legacy = tempDir();
    const durable = tempDir();
    try {
      initDatabase(path.join(legacy, "globalstore.db"));
      await seedDatabase();
      updateService("youtube-premium-personal", { nameEn: "YouTube Premium" });
      closeDatabase();

      initDatabase(undefined, { dataDir: durable, legacyDataDir: legacy });
      const migrated = getLastMigration();
      assert.equal(migrated.migrated, true);
      await seedDatabase();
      assert.equal(
        listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
      assert.equal(getDataDir(), path.resolve(durable));
    } finally {
      closeDatabase();
      fs.rmSync(legacy, { recursive: true, force: true });
      fs.rmSync(durable, { recursive: true, force: true });
    }
  });

  it("restores a durable snapshot over a re-seeded default catalog", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    await seedDatabase();
    updateService("youtube-premium-personal", { nameEn: "YouTube Premium" });
    updateService("canva-pro", { nameEn: "Canva Pro" });

    withoutPersist(() => replaceAllServices(DEFAULT_SERVICES));
    assert.ok(
      listServices().find((s) => s.id === "youtube-premium-personal").nameEn.includes(
        "Personal",
      ),
    );

    const restored = await seedDatabase();
    assert.equal(restored.hydrated.restoredServices, true);
    assert.equal(
      listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
      "YouTube Premium",
    );
    assert.equal(listServices().find((s) => s.id === "canva-pro").nameEn, "Canva Pro");

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("restores a custom catalog from a backup path without reseeding defaults", async () => {
    const active = tempDir();
    const backup = tempDir();
    const prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = active;
    process.env.DURABLE_BACKUP_DIRS = backup;
    try {
      writeSnapshot(backup, {
        savedAt: "2026-01-01T00:00:00.000Z",
        services: customCatalog("YouTube Premium"),
        settings: { complaintEmail: "kept@example.com" },
      });

      initDatabase(undefined, { skipMigrate: true });
      const recovered = getLastRecovery();
      assert.equal(recovered.recovered, true);
      assert.equal(recovered.reason, "copied-best");
      assert.equal(recovered.from, path.resolve(backup));

      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(seeded.servicesSeeded, false);
      assert.equal(seeded.hydrated.restoredServices, true);
      assert.equal(
        listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
      assert.equal(catalogMatchesDefaults(listServices()), false);

      const health = getHealthPayload();
      assert.equal(health.catalogSeededThisBoot, false);
      assert.equal(health.catalogMatchesDefaults, false);
      assert.ok(health.hydrateReason);
      assert.ok(Array.isArray(health.snapshotPaths));
      assert.equal(health.dataDir, path.resolve(active));
      assert.equal(getAllSettings().complaintEmail, "kept@example.com");
    } finally {
      closeDatabase();
      if (prevDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevDataDir;
      fs.rmSync(active, { recursive: true, force: true });
      fs.rmSync(backup, { recursive: true, force: true });
    }
  });

  it("prefers an older custom snapshot over a newer factory snapshot", async () => {
    const active = tempDir();
    const backup = tempDir();
    const prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = active;
    process.env.DURABLE_BACKUP_DIRS = backup;
    try {
      writeSnapshot(active, {
        savedAt: "2026-09-15T21:47:00.000Z",
        services: DEFAULT_SERVICES,
      });
      writeSnapshot(backup, {
        savedAt: "2026-01-02T00:00:00.000Z",
        services: customCatalog("YouTube Premium"),
      });

      initDatabase(undefined, { skipMigrate: true, backupDirs: [] });
      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(seeded.hydrated.restoredServices, true);
      assert.equal(
        listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
      assert.equal(getHealthPayload().catalogMatchesDefaults, false);
    } finally {
      closeDatabase();
      if (prevDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevDataDir;
      fs.rmSync(active, { recursive: true, force: true });
      fs.rmSync(backup, { recursive: true, force: true });
    }
  });

  it("does not overwrite a custom admin-state.json with a factory-seeded catalog", async () => {
    const active = tempDir();
    const backup = tempDir();
    const prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = active;
    process.env.DURABLE_BACKUP_DIRS = backup;
    try {
      writeSnapshot(backup, {
        savedAt: "2026-03-01T00:00:00.000Z",
        services: customCatalog("YouTube Premium"),
      });
      initDatabase(undefined, { skipMigrate: true, backupDirs: [] });

      const written = writeAdminSnapshot({
        services: DEFAULT_SERVICES,
        settings: {},
      });
      assert.ok(written);
      assert.equal(catalogMatchesDefaults(written.services), true);

      const backupSnap = JSON.parse(
        fs.readFileSync(path.join(backup, SNAPSHOT_NAME), "utf8"),
      );
      assert.equal(
        backupSnap.services.find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
      assert.equal(catalogMatchesDefaults(backupSnap.services), false);

      const seeded = await seedDatabase();
      assert.equal(seeded.catalogSeededThisBoot, false);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(backup, SNAPSHOT_NAME), "utf8"))
          .services.find((s) => s.id === "youtube-premium-personal").nameEn,
        "YouTube Premium",
      );
    } finally {
      closeDatabase();
      if (prevDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevDataDir;
      fs.rmSync(active, { recursive: true, force: true });
      fs.rmSync(backup, { recursive: true, force: true });
    }
  });
});
