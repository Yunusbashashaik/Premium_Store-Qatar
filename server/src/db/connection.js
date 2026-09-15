import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { JsonDatabase } from "./jsonDb.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** In-app folder used by older deploys. Wiped by GoDaddy Restart Published App. */
export const LEGACY_APP_DATA_DIR = path.join(__dirname, "..", "..", "data");
export const DEFAULT_DURABLE_DIRNAME = "premium-store-qatar-data";

export let DATA_DIR = LEGACY_APP_DATA_DIR;
export let UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export let SERVICE_UPLOADS_DIR = path.join(UPLOADS_DIR, "services");

const STORE_NAMES = ["globalstore.db", "globalstore.json", "admin-state.json"];

const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT '',
      accent TEXT NOT NULL DEFAULT '#38bdf8',
      type_en TEXT NOT NULL DEFAULT 'Shared / Private',
      type_ar TEXT NOT NULL DEFAULT 'مشترك / خاص',
      name_en TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      description_en TEXT NOT NULL DEFAULT '',
      description_ar TEXT NOT NULL DEFAULT '',
      price_month REAL NOT NULL DEFAULT 0,
      price_year REAL NOT NULL DEFAULT 0,
      image_url TEXT,
      image_blob BLOB,
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      offer_type TEXT NOT NULL DEFAULT 'none',
      offer_expires_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      details TEXT NOT NULL,
      screenshot_path TEXT,
      original_filename TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`;

let db;
let activeDbPath;
let dbEngine = "none";
let lastMigration = { migrated: false, reason: "not-run" };

export function getDefaultDurableDataDir() {
  return path.resolve(
    process.env.DATA_DIR || path.join(os.homedir(), DEFAULT_DURABLE_DIRNAME),
  );
}

export function getDataDir() {
  return DATA_DIR;
}

export function getUploadsDir() {
  return UPLOADS_DIR;
}

export function getServiceUploadsDir() {
  return SERVICE_UPLOADS_DIR;
}

export function getLastMigration() {
  return lastMigration;
}

function applyDataDir(dir) {
  DATA_DIR = path.resolve(dir);
  UPLOADS_DIR = path.join(DATA_DIR, "uploads");
  SERVICE_UPLOADS_DIR = path.join(UPLOADS_DIR, "services");
  fs.mkdirSync(SERVICE_UPLOADS_DIR, { recursive: true });
}

function storeArtifactsPresent(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return STORE_NAMES.some((name) => fs.existsSync(path.join(dir, name)));
}

export function migrateLegacyDataIfNeeded(
  targetDir,
  legacyDir = LEGACY_APP_DATA_DIR,
) {
  const target = path.resolve(targetDir);
  const legacy = path.resolve(legacyDir);
  if (target === legacy) {
    lastMigration = { migrated: false, reason: "same-dir" };
    return lastMigration;
  }
  if (!storeArtifactsPresent(legacy)) {
    lastMigration = { migrated: false, reason: "no-legacy" };
    return lastMigration;
  }
  if (storeArtifactsPresent(target)) {
    lastMigration = { migrated: false, reason: "target-has-store" };
    return lastMigration;
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(legacy, target, { recursive: true });
  lastMigration = { migrated: true, reason: "copied-legacy", from: legacy, to: target };
  console.log(`Migrated store data from ${legacy} to ${target}`);
  return lastMigration;
}

export function resolveDataDir(options = {}) {
  if (options.dataDir) return path.resolve(options.dataDir);
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (options.dbPath) return path.dirname(path.resolve(options.dbPath));
  if (options.jsonPath) return path.dirname(path.resolve(options.jsonPath));
  if (process.env.DATABASE_PATH) {
    return path.dirname(path.resolve(process.env.DATABASE_PATH));
  }
  if (process.env.JSON_DATABASE_PATH) {
    return path.dirname(path.resolve(process.env.JSON_DATABASE_PATH));
  }
  return getDefaultDurableDataDir();
}

export function getDbPath() {
  return process.env.DATABASE_PATH || path.join(DATA_DIR, "globalstore.db");
}

export function getDbEngine() {
  return dbEngine;
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

function openSqlite(dbPath) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_SQL);
  migrateSqlite(sqlite);
  return sqlite;
}

function migrateSqlite(sqlite) {
  const cols = sqlite.prepare("PRAGMA table_info(services)").all().map((col) => col.name);
  if (!cols.includes("image_blob")) {
    sqlite.exec("ALTER TABLE services ADD COLUMN image_blob BLOB");
  }
  if (!cols.includes("offer_type")) {
    sqlite.exec("ALTER TABLE services ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'none'");
  }
  if (!cols.includes("offer_expires_at")) {
    sqlite.exec("ALTER TABLE services ADD COLUMN offer_expires_at TEXT");
  }
}

export function initDatabase(dbPath, options = {}) {
  const resolvedDir = resolveDataDir({ ...options, dbPath });
  const explicitStore = Boolean(dbPath || options.jsonPath);
  if (!explicitStore && !options.skipMigrate) {
    migrateLegacyDataIfNeeded(resolvedDir, options.legacyDataDir || LEGACY_APP_DATA_DIR);
  } else {
    lastMigration = { migrated: false, reason: explicitStore ? "explicit-store" : "skipped" };
  }
  applyDataDir(resolvedDir);

  const sqlitePath = dbPath || getDbPath();
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = undefined;
  }

  const engine = options.engine || process.env.DATABASE_ENGINE;
  const forceJson = engine === "json";
  if (!forceJson) {
    try {
      db = openSqlite(sqlitePath);
      dbEngine = "sqlite";
      activeDbPath = sqlitePath;
      return db;
    } catch (err) {
      console.error(
        "SQLite native module failed; using JSON file store instead.",
        err?.message || err,
      );
    }
  }

  const jsonPath =
    options.jsonPath ||
    process.env.JSON_DATABASE_PATH ||
    path.join(DATA_DIR, "globalstore.json");
  db = new JsonDatabase(jsonPath);
  dbEngine = "json";
  activeDbPath = jsonPath;
  return db;
}

export function getActiveStorePath() {
  return activeDbPath || getDbPath();
}

export function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = undefined;
  }
  activeDbPath = undefined;
  dbEngine = "none";
}

export { activeDbPath };
