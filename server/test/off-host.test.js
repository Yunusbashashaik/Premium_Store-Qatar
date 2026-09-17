import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { closeDatabase, initDatabase } from "../src/db/connection.js";
import {
  flushOffHostBackup,
  resetOffHostBackupStatus,
  setOffHostFetch,
} from "../src/db/offHostBackup.js";
import { catalogMatchesDefaults } from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices, updateService } from "../src/models/Service.js";
import { customCatalog, disableFactorySeed } from "./helpers.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gs-offhost-"));
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function installGithubMock(initialSnapshot) {
  let stored = initialSnapshot;
  let sha = stored ? "sha-1" : null;
  const fetchFn = async (url, opts = {}) => {
    const method = String(opts.method || "GET").toUpperCase();
    const href = String(url);
    if (!href.includes("/contents/")) {
      throw new Error(`unexpected fetch ${href}`);
    }
    if (method === "GET") {
      if (!stored) return jsonResponse(404, { message: "Not Found" });
      return jsonResponse(200, {
        sha,
        encoding: "base64",
        content: Buffer.from(`${JSON.stringify(stored)}\n`, "utf8").toString("base64"),
      });
    }
    if (method === "PUT") {
      const payload = JSON.parse(opts.body);
      stored = JSON.parse(Buffer.from(payload.content, "base64").toString("utf8"));
      sha = "sha-2";
      return jsonResponse(200, { content: { sha } });
    }
    throw new Error(`unexpected method ${method}`);
  };
  setOffHostFetch(fetchFn);
  return {
    getStored: () => stored,
  };
}

afterEach(async () => {
  await flushOffHostBackup();
  closeDatabase();
  setOffHostFetch(null);
  resetOffHostBackupStatus();
  disableFactorySeed();
  delete process.env.CATALOG_BACKUP_TOKEN;
  delete process.env.CATALOG_BACKUP_URL;
  delete process.env.CATALOG_BACKUP_REPO;
  delete process.env.CATALOG_BACKUP_ENABLED;
  delete process.env.DURABLE_BACKUP_DIRS;
  delete process.env.DATA_DIR;
});

describe("off-host catalog backup", () => {
  it("restores a custom catalog from GitHub when local disks are empty, without factory names", async () => {
    const localDir = tempDir();
    process.env.DATA_DIR = localDir;
    process.env.DURABLE_BACKUP_DIRS = localDir;
    process.env.CATALOG_BACKUP_TOKEN = "test-token";
    process.env.CATALOG_BACKUP_REPO = "example/store";
    disableFactorySeed();

    const snapshot = {
      version: 1,
      generation: 5,
      savedAt: "2026-09-17T00:00:00.000Z",
      services: customCatalog("YouTube Premium"),
      settings: { catalogSeeded: true, complaintEmail: "ops@example.com" },
    };
    installGithubMock(snapshot);

    initDatabase();
    const seeded = await seedDatabase();
    assert.equal(seeded.catalogSeededThisBoot, false);
    assert.equal(seeded.offHost.restored, true);
    assert.equal(listServices().find((s) => s.id === "youtube-premium-personal").nameEn, "YouTube Premium");
    assert.equal(catalogMatchesDefaults(listServices()), false);
    const factoryYoutube = DEFAULT_SERVICES.find((s) => s.id === "youtube-premium-personal").nameEn;
    assert.notEqual(
      listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
      factoryYoutube,
    );

    const health = getHealthPayload();
    assert.equal(health.factorySeedDisabled, true);
    assert.equal(health.offHostBackupConfigured, true);
    assert.equal(health.offHostBackupRestoredThisBoot, true);
    assert.equal(health.catalogSeededThisBoot, false);
    assert.equal(health.catalogMatchesDefaults, false);
    assert.equal(health.hydrateReason, "off-host");
    fs.rmSync(localDir, { recursive: true, force: true });
  });

  it("auto-saves custom catalog to GitHub on persist and hydrates from CATALOG_BACKUP_URL", async () => {
    const localDir = tempDir();
    process.env.DATA_DIR = localDir;
    process.env.DURABLE_BACKUP_DIRS = localDir;
    process.env.ALLOW_FACTORY_SEED = "1";
    process.env.CATALOG_BACKUP_TOKEN = "test-token";
    process.env.CATALOG_BACKUP_REPO = "example/store";
    const github = installGithubMock(null);

    initDatabase();
    await seedDatabase();
    updateService("youtube-premium-personal", { nameEn: "YouTube Premium" });
    await flushOffHostBackup();
    assert.equal(
      github.getStored().services.find((s) => s.id === "youtube-premium-personal").nameEn,
      "YouTube Premium",
    );
    const healthAfterSave = getHealthPayload();
    assert.ok(healthAfterSave.offHostBackupSavedAt);

    closeDatabase();
    fs.rmSync(localDir, { recursive: true, force: true });
    fs.mkdirSync(localDir, { recursive: true });
    delete process.env.ALLOW_FACTORY_SEED;
    delete process.env.CATALOG_BACKUP_TOKEN;
    delete process.env.CATALOG_BACKUP_REPO;
    process.env.CATALOG_BACKUP_URL = "https://backup.example/admin-state.json";
    setOffHostFetch(async (url) => {
      assert.equal(String(url), "https://backup.example/admin-state.json");
      return jsonResponse(200, github.getStored());
    });

    initDatabase();
    const restored = await seedDatabase();
    assert.equal(restored.offHost.restored, true);
    assert.equal(restored.catalogSeededThisBoot, false);
    assert.equal(listServices().find((s) => s.id === "youtube-premium-personal").nameEn, "YouTube Premium");
    assert.equal(getHealthPayload().offHostBackupRestoredThisBoot, true);
    fs.rmSync(localDir, { recursive: true, force: true });
  });
});
