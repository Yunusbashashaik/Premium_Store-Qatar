import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterPublicServices,
  isActiveOffer,
  isExpiredOffer,
  normalizeOfferType,
} from "../../shared/offers.js";

describe("limited-time offers", () => {
  it("treats missing offer type as none", () => {
    assert.equal(normalizeOfferType(undefined), "none");
    assert.equal(isActiveOffer({}), false);
    assert.equal(isExpiredOffer({}), false);
  });

  it("keeps regular services in the public list", () => {
    const services = [
      { id: "a", nameEn: "Regular", offerType: "none" },
      {
        id: "b",
        nameEn: "Active",
        offerType: "eid",
        offerExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        id: "c",
        nameEn: "Expired",
        offerType: "special",
        offerExpiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    const publicList = filterPublicServices(services);
    assert.deepEqual(
      publicList.map((s) => s.id),
      ["a", "b"],
    );
  });
});
