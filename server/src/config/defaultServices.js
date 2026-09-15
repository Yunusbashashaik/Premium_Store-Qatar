import { SERVICES } from "../../../client/src/data/servicesCatalog.js";

/** Map the client seed catalog into DB service rows. Used only when the catalog is empty. */
export function toDbService(service, index = 0) {
  const image = service.image || service.imageUrl || "";
  let imageUrl = null;
  if (image) {
    if (/^(https?:|data:|blob:|\/)/i.test(image)) {
      imageUrl = image;
    } else {
      imageUrl = `/${String(image).replace(/^\//, "")}`;
    }
  }

  return {
    id: service.id,
    nameEn: service.nameEn,
    nameAr: service.nameAr,
    descriptionEn: service.descriptionEn || "",
    descriptionAr: service.descriptionAr || "",
    typeEn: service.typeEn || "Shared / Private",
    typeAr: service.typeAr || "مشترك / خاص",
    prices: {
      month: service.prices?.month ?? 0,
      year: service.prices?.year ?? 0,
    },
    outOfStock: Boolean(service.outOfStock),
    imageUrl,
    icon: service.icon || "✨",
    accent: service.accent || "#38bdf8",
    sortOrder: service.sortOrder ?? index,
  };
}

export const DEFAULT_SERVICES = SERVICES.map((service, index) =>
  toDbService(service, index),
);
