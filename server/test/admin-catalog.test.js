import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import {
  applyAdminCatalogToStore,
  resetAdminCatalogStatus,
  setAdminCatalogFetch,
  syncAdminCatalog,
} from "../src/db/adminCatalog.js";
import { seedDatabase } from "../src/db/seed.js";
import { getHealthPayload } from "../src/health.js";
import { getServiceImageBlob, insertService, listServices, updateService } from "../src/models/Service.js";
import { adminRouter } from "../src/routes/admin.js";
import { servicesRouter } from "../src/routes/services.js";
import {
  disableFactorySeed,
  isolateOffHostBackup,
  restoreOffHostBackupEnv,
} from "./helpers.js";

const jpeg = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101ffc0000b080001000101011100ffc40014100100000000000000000000000000000000ffda00080001000100003f00fbffd9",
  "hex",
);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-admin-catalog-"));
}

function writeFixture(dir, services) {
  const images = path.join(dir, "admin-catalog", "images");
  fs.mkdirSync(images, { recursive: true });
  const rows = services.map((service) => {
    const image = service.image || `${service.id}.jpg`;
    fs.writeFileSync(path.join(images, image), jpeg);
    return { ...service, image };
  });
  const document = { version: 1, currency: "QAR", services: rows };
  fs.writeFileSync(
    path.join(dir, "admin-catalog", "services.json"),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  return document;
}

function enableFixtureCatalog(dir) {
  isolateOffHostBackup();
  delete process.env.ADMIN_CATALOG_DISABLED;
  process.env.ADMIN_CATALOG_DIR = dir;
  process.env.ADMIN_CATALOG_SKIP_PACKAGED = "1";
  process.env.ADMIN_CATALOG_URL = "https://127.0.0.1/disabled-admin-catalog.json";
  process.env.ADMIN_CATALOG_SYNC_MS = "0";
  setAdminCatalogFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => "disabled",
    json: async () => ({ message: "disabled" }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
}

const sample = [
  {
    id: "netflix-full",
    nameEn: "Netflix Full",
    nameAr: "نتفليكس كامل",
    descriptionEn: "Full account",
    descriptionAr: "حساب كامل",
    typeEn: "Full Account",
    typeAr: "حساب كامل",
    prices: { month: 60, year: 700 },
    outOfStock: false,
    sortOrder: 1,
  },
  {
    id: "prime-video-shared",
    nameEn: "Prime Shared",
    nameAr: "برايم مشترك",
    descriptionEn: "Shared",
    descriptionAr: "مشترك",
    typeEn: "Shared",
    typeAr: "مشترك",
    prices: { month: 10, year: 80 },
    outOfStock: false,
    sortOrder: 2,
  },
];

afterEach(() => {
  closeDatabase();
  resetAdminCatalogStatus();
  restoreOffHostBackupEnv();
  disableFactorySeed();
  delete process.env.DATA_DIR;
});

describe("apply-from-admin-catalog", () => {
  it("fills an empty store from the admin-catalog folder without factory seed", async () => {
    const dir = tempDir();
    writeFixture(dir, sample);
    enableFixtureCatalog(dir);
    disableFactorySeed();
    process.env.DATA_DIR = dir;
    initDatabase(path.join(dir, "store.db"));
    const seeded = await seedDatabase();
    assert.equal(seeded.catalogSeededThisBoot, false);
    assert.equal(seeded.factorySeedDisabled, true);
    assert.equal(listServices().length, 2);
    const netflix = listServices().find((s) => s.id === "netflix-full");
    assert.equal(netflix.prices.month, 60);
    assert.equal(netflix.prices.year, 700);
    assert.ok(netflix.hasCustomImage);
    assert.equal(seeded.adminCatalog.applied, true);
    assert.equal(seeded.adminCatalog.added.length, 2);
    const health = getHealthPayload();
    assert.equal(health.factorySeedDisabled, true);
    assert.equal(health.catalogEmpty, false);
    assert.equal(health.adminCatalogConfigured, true);
  });

  it("updates prices on existing services from admin-catalog", async () => {
    const dir = tempDir();
    enableFixtureCatalog(dir);
    disableFactorySeed();
    process.env.DATA_DIR = dir;
    initDatabase(path.join(dir, "store.db"));
    await seedDatabase();
    insertService({
      id: "netflix-full",
      nameEn: "Netflix Full",
      nameAr: "نتفليكس كامل",
      descriptionEn: "Full account",
      descriptionAr: "حساب كامل",
      typeEn: "Full Account",
      typeAr: "حساب كامل",
      prices: { month: 60, year: 700 },
    });
    assert.equal(listServices().find((s) => s.id === "netflix-full").prices.month, 60);

    const result = applyAdminCatalogToStore({
      services: [
        {
          ...sample[0],
          prices: { month: 75, year: 800 },
        },
      ],
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.updated, ["netflix-full"]);
    assert.equal(listServices().find((s) => s.id === "netflix-full").prices.month, 75);
    assert.equal(listServices().find((s) => s.id === "netflix-full").prices.year, 800);
  });

  it("creates a brand-new service from a new admin-catalog row and unique image", async () => {
    const dir = tempDir();
    writeFixture(dir, sample);
    enableFixtureCatalog(dir);
    disableFactorySeed();
    process.env.DATA_DIR = dir;
    initDatabase(path.join(dir, "store.db"));
    await seedDatabase();
    insertService({
      id: "panel-only-service",
      nameEn: "Panel Only",
      nameAr: "لوحة فقط",
      prices: { month: 5, year: 40 },
    });
    assert.equal(listServices().some((s) => s.id === "starplus-premium"), false);

    const brandNew = {
      id: "starplus-premium",
      nameEn: "Star+ Premium",
      nameAr: "ستار بلس بريميوم",
      descriptionEn: "Brand new catalog row",
      descriptionAr: "صف جديد",
      typeEn: "Shared",
      typeAr: "مشترك",
      prices: { month: 15, year: 120 },
      outOfStock: false,
      sortOrder: 43,
      image: "starplus-premium.jpg",
    };
    writeFixture(dir, [...sample, brandNew]);
    const synced = await syncAdminCatalog({ skipRemoteImages: true });
    assert.equal(synced.applied, true);
    assert.deepEqual(synced.added, ["starplus-premium"]);

    const created = listServices().find((s) => s.id === "starplus-premium");
    assert.ok(created, "new admin-catalog id must be inserted on the live store");
    assert.equal(created.nameEn, "Star+ Premium");
    assert.equal(created.nameAr, "ستار بلس بريميوم");
    assert.equal(created.prices.month, 15);
    assert.equal(created.prices.year, 120);
    assert.equal(created.imageUrl, "/api/uploads/services/starplus-premium.jpg");
    assert.equal(Buffer.compare(getServiceImageBlob("starplus-premium"), jpeg), 0);
    assert.equal(listServices().find((s) => s.id === "panel-only-service").nameEn, "Panel Only");

    const app = express();
    app.use("/api/services", servicesRouter);
    const publicList = await request(app).get("/api/services");
    assert.equal(publicList.status, 200);
    const publicRow = publicList.body.services.find((s) => s.id === "starplus-premium");
    assert.equal(publicRow.nameEn, "Star+ Premium");
    assert.equal(publicRow.prices.month, 15);
  });

  it("syncs from a packaged admin-catalog dir on demand", async () => {
    const dir = tempDir();
    writeFixture(dir, [
      { ...sample[0], prices: { month: 99, year: 900 } },
      sample[1],
    ]);
    enableFixtureCatalog(dir);
    disableFactorySeed();
    process.env.DATA_DIR = dir;
    initDatabase(path.join(dir, "store.db"));
    await seedDatabase();
    updateService("netflix-full", { prices: { month: 1, year: 2 } });
    const synced = await syncAdminCatalog({ skipRemoteImages: true });
    assert.equal(synced.applied, true);
    assert.ok(synced.updated.includes("netflix-full"));
    assert.equal(listServices().find((s) => s.id === "netflix-full").prices.month, 99);
  });

  it("admin POST /api/admin/catalog/sync applies the GitHub folder", async () => {
    const dir = tempDir();
    writeFixture(dir, sample);
    enableFixtureCatalog(dir);
    disableFactorySeed();
    process.env.DATA_DIR = dir;
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "Go$StQ821";
    initDatabase(path.join(dir, "store.db"));
    await seedDatabase();

    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminRouter);
    const login = await request(app)
      .post("/api/admin/login")
      .send({ username: "admin", password: "Go$StQ821" });
    const token = login.body.token;
    const res = await request(app)
      .post("/api/admin/catalog/sync")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(listServices().length, 2);
    assert.equal(listServices().find((s) => s.id === "prime-video-shared").prices.year, 80);
  });
});
