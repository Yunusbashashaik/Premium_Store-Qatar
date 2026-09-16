import { DEFAULT_SERVICES } from "../config/defaultServices.js";
import { DEFAULT_SETTINGS } from "../config/defaults.js";

function serviceSignature(service) {
  return [
    service.id,
    Number(service.prices?.month),
    Number(service.prices?.year),
    String(service.nameEn || ""),
    String(service.nameAr || ""),
    String(service.descriptionEn || ""),
    String(service.descriptionAr || ""),
    service.outOfStock ? 1 : 0,
  ].join("|");
}

export function catalogSignature(services) {
  return (services || [])
    .map(serviceSignature)
    .sort()
    .join("\n");
}

export function catalogMatchesDefaults(services) {
  return catalogSignature(services) === catalogSignature(DEFAULT_SERVICES);
}

export function settingsSignature(settings) {
  const value = settings || {};
  return JSON.stringify({
    complaintEmail: value.complaintEmail,
    whatsappNumbers: value.whatsappNumbers,
    aboutEn: value.aboutEn,
    aboutAr: value.aboutAr,
    ownersEn: value.ownersEn,
    ownersAr: value.ownersAr,
    socialLinks: value.socialLinks,
  });
}

export function settingsMatchDefaults(settings) {
  return settingsSignature(settings) === settingsSignature(DEFAULT_SETTINGS);
}

export function snapshotSavedAtMs(snapshot, fallbackMs = 0) {
  const parsed = Date.parse(snapshot?.savedAt || 0);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

/** Higher score wins. Non-default catalogs always beat factory defaults, even if older. */
export function rankSnapshot(snapshot, fileMtimeMs = 0) {
  const services = Array.isArray(snapshot?.services) ? snapshot.services : [];
  const savedAt = snapshotSavedAtMs(snapshot, fileMtimeMs);
  const nonDefault = services.length > 0 && !catalogMatchesDefaults(services);
  if (nonDefault) {
    return { nonDefault: true, score: 1e15 + savedAt };
  }
  if (services.length > 0) {
    return { nonDefault: false, score: 1e12 + savedAt };
  }
  return { nonDefault: false, score: savedAt };
}
