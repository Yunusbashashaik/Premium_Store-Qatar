import os from "os";
import path from "path";

export const DEFAULT_DURABLE_DIRNAME = "premium-store-qatar-data";
export const SNAPSHOT_NAME = "admin-state.json";
export const SNAPSHOT_BACKUP_NAME = "admin-state.backup.json";
export const SNAPSHOT_FILES = [SNAPSHOT_NAME, SNAPSHOT_BACKUP_NAME];
export const STORE_NAMES = [
  "globalstore.db",
  "globalstore.json",
  SNAPSHOT_NAME,
  SNAPSHOT_BACKUP_NAME,
];

function uniqueResolved(dirs) {
  const seen = new Set();
  const out = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/** GoDaddy Restart Published App wipes the deploy tree under /app. */
export function isEphemeralAppPath(dir) {
  if (!dir) return false;
  const resolved = path.resolve(dir);
  if (resolved === "/app") return true;
  return resolved.startsWith(`${path.resolve("/app")}${path.sep}`);
}

export function isUnderTmp(dir) {
  if (!dir) return false;
  const tmp = path.resolve(os.tmpdir());
  const resolved = path.resolve(dir);
  return resolved === tmp || resolved.startsWith(`${tmp}${path.sep}`);
}

export function parseBackupDirsEnv() {
  const raw = process.env.DURABLE_BACKUP_DIRS;
  if (!raw || !String(raw).trim()) return null;
  return String(raw)
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getProductionBackupDirs() {
  const name = DEFAULT_DURABLE_DIRNAME;
  return uniqueResolved([
    path.join("/local", name),
    path.join("/root", name),
    path.join(os.homedir(), name),
  ]);
}

export function getDurableBackupDirs() {
  const fromEnv = parseBackupDirsEnv();
  const dirs = fromEnv || getProductionBackupDirs();
  return uniqueResolved(dirs).filter((dir) => !isEphemeralAppPath(dir));
}

/**
 * Extra replica dirs are skipped for tmp test stores unless DURABLE_BACKUP_DIRS is set.
 * Production always replicates to /local, /root, and $HOME plus DATA_DIR.
 */
export function extraDurableReplicationEnabled(activeDir) {
  if (parseBackupDirsEnv()) return true;
  if (activeDir && isUnderTmp(activeDir)) return false;
  return true;
}
