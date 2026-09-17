/**
 * Factory DEFAULT_SERVICES are inserted only when ALLOW_FACTORY_SEED=1 (local/dev).
 * Production must leave this unset so a wiped store never refills factory names.
 */
export function isFactorySeedAllowed() {
  return process.env.ALLOW_FACTORY_SEED === "1";
}
