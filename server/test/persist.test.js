import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import { readAdminSnapshot } from "../src/db/persist.js";
import { seedDatabase } from "../src/db/seed.js";
import {
  deleteService,
  insertService,
  listServices,
  updateService,
} from "../src/models/Service.js";
import { getAllSettings, getSetting, updateSettings } from "../src/models/Settings.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-persist-"));
}

function sqliteFiles(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

afterEach(() => {
  closeDatabase();
});

describe("admin catalog persistence", () => {
  it("seeds the default catalog once and keeps admin edits after a second seedDatabase()", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    const firstSeed = seedDatabase();
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
    const afterRestart = seedDatabase();
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

  it("does not re-insert defaults after admin deletes a seeded service", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    seedDatabase();
    const victim = DEFAULT_SERVICES[1].id;
    assert.equal(deleteService(victim), true);
    const remaining = listServices().length;

    closeDatabase();
    initDatabase(dbPath);
    const again = seedDatabase();
    assert.equal(again.servicesSeeded, false);
    assert.equal(listServices().length, remaining);
    assert.equal(
      listServices().some((s) => s.id === victim),
      false,
    );

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("restores catalog services from snapshot when the database file is replaced", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    seedDatabase();

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
    const seeded = seedDatabase();
    assert.equal(seeded.hydrated.restoredServices, true);
    assert.equal(listServices().length, expectedCount);
    assert.ok(listServices().some((s) => s.id === "admin-added-stream"));
    assert.equal(getAllSettings().complaintEmail, "snapshot@example.com");
    assert.equal(getAllSettings().aboutEn, "Kept about");
    assert.ok(readAdminSnapshot().services.length >= expectedCount);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never overwrites an existing DB catalog with leftover snapshot services", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    seedDatabase();
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

    const again = seedDatabase();
    assert.equal(again.hydrated.restoredServices, false);
    assert.equal(
      listServices().some((s) => s.id === "legacy-factory-item"),
      false,
    );
    assert.equal(listServices().find((s) => s.id === DEFAULT_SERVICES[0].id).prices.month, 77);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
