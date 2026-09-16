#!/usr/bin/env node
/**
 * Proves GoDaddy-style recycle recovery:
 * 1. Custom catalog on a backup path is restored into an empty DATA_DIR without factory seed.
 * 2. writeAdminSnapshot refuses to clobber that custom snapshot with DEFAULT_SERVICES.
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";
import {
  closeDatabase,
  getLastRecovery,
  initDatabase,
} from "../src/db/connection.js";
import { SNAPSHOT_NAME } from "../src/db/durablePaths.js";
import {
  catalogMatchesDefaults,
  writeAdminSnapshot,
} from "../src/db/persist.js";
import { getHealthPayload } from "../src/health.js";
import { seedDatabase } from "../src/db/seed.js";
import { listServices } from "../src/models/Service.js";

const active = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-active-"));
const backup = fs.mkdtempSync(path.join(os.tmpdir(), "gs-prove-backup-"));
const prevDataDir = process.env.DATA_DIR;
const prevBackup = process.env.DURABLE_BACKUP_DIRS;

const customServices = DEFAULT_SERVICES.map((service) =>
  service.id === "youtube-premium-personal"
    ? { ...service, nameEn: "YouTube Premium" }
    : service,
);

fs.writeFileSync(
  path.join(backup, SNAPSHOT_NAME),
  `${JSON.stringify(
    {
      version: 1,
      generation: 5,
      savedAt: "2026-01-01T00:00:00.000Z",
      services: customServices,
      settings: { complaintEmail: "prove@example.com" },
    },
    null,
    2,
  )}\n`,
);

try {
  process.env.DATA_DIR = active;
  process.env.DURABLE_BACKUP_DIRS = backup;

  initDatabase(undefined, { skipMigrate: true });
  const recovery = getLastRecovery();
  assert.equal(recovery.recovered, true, "expected copy from backup dir");
  const seeded = seedDatabase();
  assert.equal(seeded.catalogSeededThisBoot, false);
  assert.equal(seeded.servicesSeeded, false);
  assert.equal(
    listServices().find((s) => s.id === "youtube-premium-personal").nameEn,
    "YouTube Premium",
  );
  assert.equal(catalogMatchesDefaults(listServices()), false);

  writeAdminSnapshot({ services: DEFAULT_SERVICES, settings: {} });
  const backupSnap = JSON.parse(fs.readFileSync(path.join(backup, SNAPSHOT_NAME), "utf8"));
  assert.equal(
    backupSnap.services.find((s) => s.id === "youtube-premium-personal").nameEn,
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
        hydrateReason: health.hydrateReason,
        catalogSeededThisBoot: health.catalogSeededThisBoot,
        catalogMatchesDefaults: health.catalogMatchesDefaults,
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
  fs.rmSync(active, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
}
