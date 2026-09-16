#!/usr/bin/env node
/**
 * Production-like boot proof (same sequence as server/src/index.js):
 * initDatabase() → seedDatabase().
 *
 * 1. First boot on empty trio (/local, /root, $HOME stand-ins) factory-seeds once
 *    and writes admin-state.json to every replica.
 * 2. Wipe primary (/local). Custom catalog remains only on $HOME/$ROOT.
 * 3. Reboot restores custom names; catalogSeededThisBoot is false.
 * 4. Factory persist cannot clobber the remaining custom snapshot.
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import { closeDatabase, getLastRecovery, initDatabase } from "../src/db/connection.js";
import { SNAPSHOT_NAME } from "../src/db/durablePaths.js";
import { catalogMatchesDefaults, writeAdminSnapshot } from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices, updateService } from "../src/models/Service.js";

const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-local-"));
const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-root-"));
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-home-"));
const prevDataDir = process.env.DATA_DIR;
const prevBackup = process.env.DURABLE_BACKUP_DIRS;

function wipe(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

try {
  process.env.DATA_DIR = localDir;
  process.env.DURABLE_BACKUP_DIRS = [localDir, rootDir, homeDir].join(path.delimiter);

  initDatabase();
  const first = seedDatabase();
  assert.equal(first.catalogSeededThisBoot, true, "true first boot may factory-seed");
  updateService("youtube-premium-personal", { nameEn: "YouTube Premium" });
  for (const dir of [localDir, rootDir, homeDir]) {
    assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_NAME)), true, `replica missing ${dir}`);
  }

  closeDatabase();
  wipe(localDir);

  initDatabase();
  const recovery = getLastRecovery();
  assert.equal(recovery.recovered, true);
  const second = seedDatabase();
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

  const health = getHealthPayload();
  console.log(
    JSON.stringify(
      {
        ok: health.ok,
        dataDir: health.dataDir,
        snapshotPaths: health.snapshotPaths,
        snapshotWritePaths: health.snapshotWritePaths,
        backupDirs: health.backupDirs,
        hydrateReason: health.hydrateReason,
        catalogSeededThisBoot: health.catalogSeededThisBoot,
        catalogMatchesDefaults: health.catalogMatchesDefaults,
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
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  if (prevBackup === undefined) delete process.env.DURABLE_BACKUP_DIRS;
  else process.env.DURABLE_BACKUP_DIRS = prevBackup;
  fs.rmSync(localDir, { recursive: true, force: true });
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
}
