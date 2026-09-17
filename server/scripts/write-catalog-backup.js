#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildBootstrapCatalogSnapshot } from "../src/db/catalogBackupSnapshot.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(root, "catalog-backup");
const snapshot = buildBootstrapCatalogSnapshot({ savedAt: new Date().toISOString() });
const body = `${JSON.stringify(snapshot, null, 2)}\n`;

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "admin-state.json"), body);
fs.writeFileSync(path.join(dir, "admin-state.backup.json"), body);
console.log(
  `Wrote ${snapshot.services.length} services to catalog-backup/admin-state.json (+ .backup.json)`,
);
