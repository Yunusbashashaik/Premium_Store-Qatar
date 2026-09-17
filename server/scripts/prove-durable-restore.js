#!/usr/bin/env node
/**
 * Production-like boot proof (same sequence as server/src/index.js):
 * initDatabase() → seedDatabase().
 *
 * 1. Empty local trio without ALLOW_FACTORY_SEED stays empty (no factory names).
 * 2. Custom catalog on a replica restores after primary wipe.
 * 3. Off-host GitHub backup restores custom names when every local dir is empty.
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { closeDatabase, getLastRecovery, initDatabase } from "../src/db/connection.js";
import { SNAPSHOT_BACKUP_NAME, SNAPSHOT_NAME } from "../src/db/durablePaths.js";
import {
  flushOffHostBackup,
  resetOffHostBackupStatus,
  setOffHostFetch,
} from "../src/db/offHostBackup.js";
import { catalogMatchesDefaults, writeAdminSnapshot } from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices, updateService } from "../src/models/Service.js";

const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-local-"));
const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-root-"));
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-home-"));
const prevDataDir = process.env.DATA_DIR;
const prevBackup = process.env.DURABLE_BACKUP_DIRS;
const prevFactory = process.env.ALLOW_FACTORY_SEED;

function wipe(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

try {
  process.env.DATA_DIR = localDir;
  process.env.DURABLE_BACKUP_DIRS = [localDir, rootDir, homeDir].join(path.delimiter);
  delete process.env.ALLOW_FACTORY_SEED;

  initDatabase();
  const emptyBoot = await seedDatabase();
  assert.equal(emptyBoot.catalogSeededThisBoot, false, "production must not factory-seed");
  assert.equal(emptyBoot.offHost.restored, true, "empty local should hydrate catalog-backup");
  assert.ok(listServices().length > 0);
  assert.equal(listServices().length, DEFAULT_SERVICES.length);

  process.env.ALLOW_FACTORY_SEED = "1";
  closeDatabase();
  initDatabase();
  await seedDatabase();
  delete process.env.ALLOW_FACTORY_SEED;
  updateService("youtube-premium-personal", { nameEn: "YouTube Premium" });
  for (const dir of [localDir, rootDir, homeDir]) {
    assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_NAME)), true, `replica missing ${dir}`);
    assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_BACKUP_NAME)), true);
  }

  closeDatabase();
  wipe(localDir);

  initDatabase();
  const recovery = getLastRecovery();
  assert.equal(recovery.recovered, true);
  const second = await seedDatabase();
  assert.equal(second.catalogSeededThisBoot, false);
  assert.equal(
    listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
    "YouTube Premium",
  );
  assert.equal(catalogMatchesDefaults(listServices()), false);

  writeAdminSnapshot({ services: DEFAULT_SERVICES, settings: {} });
  const homeSnap = JSON.parse(fs.readFileSync(path.join(homeDir, SNAPSHOT_NAME), "utf8"));
  assert.equal(
    homeSnap.services.find((s) => s.id === "youtube-premium-personal").nameEn,
    "YouTube Premium",
    "factory persist must not clobber custom snapshot",
  );

  const custom = JSON.parse(fs.readFileSync(path.join(homeDir, SNAPSHOT_NAME), "utf8"));
  process.env.CATALOG_BACKUP_TOKEN = "prove-token";
  process.env.CATALOG_BACKUP_REPO = "example/store";
  setOffHostFetch(async (url, opts = {}) => {
    const method = String(opts.method || "GET").toUpperCase();
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          sha: "sha-1",
          encoding: "base64",
          content: Buffer.from(`${JSON.stringify(custom)}\n`, "utf8").toString("base64"),
        }),
      };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({ content: { sha: "sha-2" } }) };
  });

  closeDatabase();
  wipe(localDir);
  wipe(rootDir);
  wipe(homeDir);
  initDatabase();
  const offHost = await seedDatabase();
  assert.equal(offHost.offHost.restored, true);
  assert.equal(offHost.catalogSeededThisBoot, false);
  assert.equal(
    listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
    "YouTube Premium",
  );
  assert.equal(catalogMatchesDefaults(listServices()), false);
  await flushOffHostBackup();

  const health = getHealthPayload();
  console.log(
    JSON.stringify(
      {
        ok: health.ok,
        dataDir: health.dataDir,
        factorySeedDisabled: health.factorySeedDisabled,
        catalogEmpty: health.catalogEmpty,
        replicas: health.replicas,
        hydrateReason: health.hydrateReason,
        catalogSeededThisBoot: health.catalogSeededThisBoot,
        catalogMatchesDefaults: health.catalogMatchesDefaults,
        offHostBackupConfigured: health.offHostBackupConfigured,
        offHostBackupRestoredThisBoot: health.offHostBackupRestoredThisBoot,
        seedSkippedReason: health.seedSkippedReason,
        recovery,
        youtube: listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
      },
      null,
      2,
    ),
  );
  console.log("prove-durable-restore: PASS");
} finally {
  closeDatabase();
  resetOffHostBackupStatus();
  setOffHostFetch(null);
  delete process.env.CATALOG_BACKUP_TOKEN;
  delete process.env.CATALOG_BACKUP_REPO;
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
