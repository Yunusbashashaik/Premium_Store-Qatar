import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import { seedDatabase } from "../src/db/seed.js";
import { adminRouter } from "../src/routes/admin.js";
import { servicesRouter } from "../src/routes/services.js";
import { settingsRouter } from "../src/routes/settings.js";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-admin-"));
const jpeg = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101ffc0000b080001000101011100ffc40014100100000000000000000000000000000000ffda00080001000100003f00fbffd9",
  "hex",
);

describe("services + admin API", () => {
  let app;
  let token;
  let streamId;

  before(async () => {
    process.env.ALLOW_FACTORY_SEED = "1";
    initDatabase(path.join(testDir, "test.db"));
    await seedDatabase();
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use("/api/services", servicesRouter);
    app.use("/api/settings", settingsRouter);
    app.use("/api/admin", adminRouter);

    const login = await request(app)
      .post("/api/admin/login")
      .send({ username: "admin", password: "Go$StQ821" });
    token = login.body.token;
    const created = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Fixture Stream")
      .field("nameAr", "بث تجريبي")
      .field("descriptionEn", "EN desc")
      .field("descriptionAr", "AR desc")
      .field("priceMonth", "2.5")
      .field("priceYear", "18");
    streamId = created.body.service.id;
  });

  after(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("seeds the default catalog and still lists admin-created services", async () => {
    const res = await request(app).get("/api/services");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.services));
    assert.ok(res.body.services.length >= 2);
    const ids = res.body.services.map((s) => s.id);
    assert.ok(ids.includes(streamId));
  });

  it("keeps admin create/update after a second seedDatabase() restart", async () => {
    const created = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Restart Survivor")
      .field("nameAr", "ناجي إعادة التشغيل")
      .field("descriptionEn", "Must remain after seed")
      .field("descriptionAr", "يجب أن يبقى")
      .field("priceMonth", "12")
      .field("priceYear", "99");
    assert.equal(created.status, 201);
    const survivorId = created.body.service.id;

    const patch = await request(app)
      .put(`/api/admin/services/${streamId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ prices: { month: 44, year: 440 }, nameEn: "Patched Stream" });
    assert.equal(patch.status, 200);

    await seedDatabase();

    const listed = await request(app).get("/api/services");
    const survivor = listed.body.services.find((s) => s.id === survivorId);
    const patched = listed.body.services.find((s) => s.id === streamId);
    assert.ok(survivor);
    assert.equal(survivor.prices.month, 12);
    assert.equal(patched.prices.month, 44);
    assert.equal(patched.nameEn, "Patched Stream");
  });

  it("allows partial service updates (prices only)", async () => {
    const before = await request(app).get("/api/services");
    const original = before.body.services.find((s) => s.id === streamId);
    const update = await request(app)
      .put(`/api/admin/services/${streamId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ prices: { month: 6.5 } });
    assert.equal(update.status, 200);
    assert.equal(update.body.service.prices.month, 6.5);
    assert.equal(update.body.service.prices.year, original.prices.year);
    assert.equal(update.body.service.nameEn, original.nameEn);
    assert.equal(update.body.service.descriptionEn, original.descriptionEn);
  });

  it("lists public settings from the database", async () => {
    const res = await request(app).get("/api/settings");
    assert.equal(res.status, 200);
    assert.ok(res.body.settings.complaintEmail);
    assert.ok(Array.isArray(res.body.settings.whatsappNumbers));
  });

  it("rejects bad login", async () => {
    const res = await request(app)
      .post("/api/admin/login")
      .send({ username: "admin", password: "wrong" });
    assert.equal(res.status, 401);
  });

  it("logs in and updates a service price/description", async () => {
    const update = await request(app)
      .put(`/api/admin/services/${streamId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        prices: { month: 3, year: 20 },
        descriptionEn: "Updated EN desc",
        descriptionAr: "وصف محدث",
      });
    assert.equal(update.status, 200);
    assert.equal(update.body.service.prices.month, 3);
    assert.equal(update.body.service.prices.year, 20);
    assert.equal(update.body.service.descriptionEn, "Updated EN desc");

    const listed = await request(app).get("/api/services");
    const item = listed.body.services.find((s) => s.id === streamId);
    assert.equal(item.prices.month, 3);
    assert.equal(item.descriptionAr, "وصف محدث");
  });

  it("creates a new service that appears on the public list", async () => {
    const create = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Test Stream")
      .field("nameAr", "اختبار")
      .field("descriptionEn", "EN desc")
      .field("descriptionAr", "AR desc")
      .field("priceMonth", "2.5")
      .field("priceYear", "18");

    assert.equal(create.status, 201);
    assert.equal(create.body.service.nameEn, "Test Stream");
    assert.equal(create.body.service.prices.month, 2.5);

    const listed = await request(app).get("/api/services");
    const item = listed.body.services.find((s) => s.nameEn === "Test Stream");
    assert.ok(item);
    assert.equal(
      listed.body.services[0].nameEn,
      "Test Stream",
      "newly added services should appear at the top of the public list",
    );
  });

  it("marks zero-price services as out of stock", async () => {
    const update = await request(app)
      .put(`/api/admin/services/${streamId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ prices: { month: 0, year: 0 } });

    assert.equal(update.status, 200);
    assert.equal(update.body.service.outOfStock, true);
    assert.equal(update.body.service.prices.month, 0);
  });

  it("updates complaint email and WhatsApp numbers in settings", async () => {
    const update = await request(app)
      .put("/api/admin/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        complaintEmail: "ops@example.com",
        whatsappNumbers: ["96550001111", "96550002222"],
        aboutEn: "New about",
        socialLinks: { instagram: "https://instagram.com/example" },
      });

    assert.equal(update.status, 200);
    assert.equal(update.body.settings.complaintEmail, "ops@example.com");
    assert.deepEqual(update.body.settings.whatsappNumbers, [
      "96550001111",
      "96550002222",
    ]);
    assert.equal(update.body.settings.aboutEn, "New about");
    assert.equal(
      update.body.settings.socialLinks.instagram,
      "https://instagram.com/example",
    );

    const publicSettings = await request(app).get("/api/settings");
    assert.equal(publicSettings.body.settings.complaintEmail, "ops@example.com");
  });

  it("requires auth for updates", async () => {
    const res = await request(app)
      .put(`/api/admin/services/${streamId}`)
      .send({ prices: { month: 9 } });
    assert.equal(res.status, 401);
  });

  it("keeps a replaced service image after the upload file is removed", async () => {
    const update = await request(app)
      .put(`/api/admin/services/${streamId}`)
      .set("Authorization", `Bearer ${token}`)
      .attach("image", jpeg, "fixture.jpg");
    assert.equal(update.status, 200);
    assert.equal(update.body.service.hasCustomImage, true);
    assert.match(String(update.body.service.imageSrc || ""), /^data:image\//);
    const listed = await request(app).get("/api/services");
    const item = listed.body.services.find((s) => s.id === streamId);
    assert.match(String(item.imageSrc || ""), /^data:image\//);
    const imageUrl = update.body.service.imageUrl;
    assert.match(String(imageUrl), /\/api\/uploads\/services\//);

    const { SERVICE_UPLOADS_DIR } = await import("../src/db/connection.js");
    const filename = String(imageUrl).split("/").pop();
    fs.rmSync(path.join(SERVICE_UPLOADS_DIR, filename), { force: true });

    const img = await request(app).get(`/api/services/${streamId}/image`);
    assert.equal(img.status, 200);
    assert.ok(Buffer.byteLength(img.body) > 0);
  });

  it("deletes a service from the public catalog", async () => {
    const created = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Temp Delete Me")
      .field("descriptionEn", "EN")
      .field("descriptionAr", "AR")
      .field("priceMonth", "1")
      .field("priceYear", "8");
    assert.equal(created.status, 201);
    const id = created.body.service.id;

    const del = await request(app)
      .delete(`/api/admin/services/${id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(del.status, 200);

    const listed = await request(app).get("/api/services");
    assert.equal(
      listed.body.services.some((s) => s.id === id),
      false,
    );
  });

  it("returns and updates owner copy in public settings", async () => {
    const res = await request(app).get("/api/settings");
    assert.ok(res.body.settings.ownersEn);

    const put = await request(app)
      .put("/api/admin/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ ownersEn: "Owned by Test Owners" });
    assert.equal(put.status, 200);
    assert.equal(put.body.settings.ownersEn, "Owned by Test Owners");

    const again = await request(app).get("/api/settings");
    assert.equal(again.body.settings.ownersEn, "Owned by Test Owners");
  });

  it("rejects unauthenticated translate and delete", async () => {
    const translate = await request(app)
      .post("/api/admin/translate")
      .send({ text: "Hello" });
    assert.equal(translate.status, 401);

    const del = await request(app).delete("/api/admin/services/missing-id");
    assert.equal(del.status, 401);
  });

  it("creates an optional offer and hides it from public after expiry", async () => {
    const none = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Regular Add")
      .field("nameAr", "عادي")
      .field("descriptionEn", "EN")
      .field("descriptionAr", "AR")
      .field("priceMonth", "1")
      .field("priceYear", "8")
      .field("offerType", "none");
    assert.equal(none.status, 201);
    assert.equal(none.body.service.offerType, "none");
    assert.equal(none.body.service.offerExpiresAt, null);

    const expired = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Expired Eid")
      .field("nameAr", "عيد")
      .field("descriptionEn", "EN")
      .field("descriptionAr", "AR")
      .field("priceMonth", "1")
      .field("priceYear", "8")
      .field("offerType", "eid")
      .field("offerExpiresAt", new Date(Date.now() - 5000).toISOString());
    assert.equal(expired.status, 201);
    assert.equal(expired.body.service.offerType, "eid");

    const active = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${token}`)
      .field("nameEn", "Active Special")
      .field("nameAr", "خاص")
      .field("descriptionEn", "EN")
      .field("descriptionAr", "AR")
      .field("priceMonth", "2")
      .field("priceYear", "9")
      .field("offerType", "special")
      .field("offerExpiresAt", new Date(Date.now() + 60_000).toISOString());
    assert.equal(active.status, 201);
    assert.equal(active.body.service.offerType, "special");
    assert.ok(active.body.service.offerExpiresAt);

    const publicList = await request(app).get("/api/services");
    const adminList = await request(app)
      .get("/api/admin/services")
      .set("Authorization", `Bearer ${token}`);
    const publicNames = publicList.body.services.map((s) => s.nameEn);
    assert.equal(publicNames.includes("Expired Eid"), false);
    assert.equal(publicNames.includes("Active Special"), true);
    assert.equal(publicNames.includes("Regular Add"), true);
    const publicActive = publicList.body.services.find((s) => s.nameEn === "Active Special");
    assert.equal(publicActive.offerType, "special");
    assert.ok(publicActive.offerExpiresAt);
    const publicRegular = publicList.body.services.find((s) => s.nameEn === "Regular Add");
    assert.equal(publicRegular.offerType, "none");
    assert.equal(
      adminList.body.services.some((s) => s.nameEn === "Expired Eid"),
      true,
    );
  });

  it("exports and imports admin-state.json including offers", async () => {
    const exported = await request(app)
      .get("/api/admin/state")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(exported.status, 200);
    assert.ok(Array.isArray(exported.body.services));
    assert.ok(exported.body.services.some((s) => s.id === streamId));

    const snapshot = {
      version: 1,
      generation: 5,
      savedAt: new Date().toISOString(),
      services: [
        {
          id: "imported-special",
          nameEn: "Imported Special",
          nameAr: "مستورد",
          descriptionEn: "EN",
          descriptionAr: "AR",
          prices: { month: 5, year: 40 },
          offerType: "special",
          offerExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      settings: { catalogSeeded: true, complaintEmail: "import@example.com" },
    };
    const imported = await request(app)
      .post("/api/admin/state")
      .set("Authorization", `Bearer ${token}`)
      .send(snapshot);
    assert.equal(imported.status, 200);
    assert.equal(imported.body.ok, true);

    const listed = await request(app).get("/api/services");
    assert.equal(listed.body.services.length, 1);
    assert.equal(listed.body.services[0].nameEn, "Imported Special");
    assert.equal(listed.body.services[0].offerType, "special");
  });
});
