import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import { CATALOG_GENERATION, readAdminSnapshot } from "../src/db/persist.js";
import { seedDatabase } from "../src/db/seed.js";
import { insertService, listServices } from "../src/models/Service.js";
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
  it("starts with an empty catalog and clears DB services on restart", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
    initDatabase(dbPath);
    const firstSeed = seedDatabase();
    assert.equal(listServices().length, 0);
    assert.equal(getSetting("catalogGeneration"), CATALOG_GENERATION);
    assert.equal(firstSeed.catalogReset, true);

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
    assert.equal(listServices().length, 1);

    closeDatabase();
    initDatabase(dbPath);
    const afterRestart = seedDatabase();
    assert.equal(afterRestart.servicesSeeded, false);
    assert.equal(listServices().length, 0);
    const settings = getAllSettings();
    assert.equal(settings.complaintEmail, "persist-forever@example.com");
    assert.equal(settings.aboutEn, "Custom about text from admin");
    assert.equal(settings.ownersEn, "Test Owner One, Test Owner Two");
    assert.deepEqual(settings.whatsappNumbers, ["96811111111", "96822222222"]);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not restore services from a snapshot when the database is replaced", () => {
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

    closeDatabase();
    for (const file of sqliteFiles(dbPath)) {
      fs.rmSync(file, { force: true });
    }
    assert.equal(fs.existsSync(path.join(dir, "admin-state.json")), true);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, "admin-state.json"), "utf8"));
    assert.deepEqual(snap.services, []);

    initDatabase(dbPath);
    const seeded = seedDatabase();
    assert.equal(seeded.hydrated.restoredServices, false);
    assert.equal(listServices().length, 0);
    assert.equal(getAllSettings().complaintEmail, "snapshot@example.com");
    assert.equal(getAllSettings().aboutEn, "Kept about");
    assert.equal(readAdminSnapshot().services.length, 0);

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not restore a leftover factory catalog from a previous snapshot", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "store.db");
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
            descriptionEn: "should not return",
            descriptionAr: "يجب ألا يعود",
            prices: { month: 2.5, year: 18 },
          },
        ],
        settings: { complaintEmail: "legacy@example.com" },
      })}\n`,
    );
    initDatabase(dbPath);
    seedDatabase();
    assert.equal(listServices().length, 0);
    assert.equal(
      listServices().some((s) => s.id === "legacy-factory-item"),
      false,
    );
    assert.equal(getAllSettings().complaintEmail, "legacy@example.com");

    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
