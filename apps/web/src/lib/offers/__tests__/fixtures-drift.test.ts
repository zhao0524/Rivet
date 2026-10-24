import { describe, expect, it } from "vitest";
import sharedAdafruit from "../../../../../../fixtures/offers/adafruit-3801.json";
import sharedNotFound from "../../../../../../fixtures/offers/not-found-9999999.json";
import sharedRefused from "../../../../../../fixtures/offers/refused-synthetic-demo-part.json";
import sharedSparkfun from "../../../../../../fixtures/offers/sparkfun-rob-13301.json";
import sharedMultivendor from "../../../../../../fixtures/offers/synthetic-multivendor.json";
import { OFFER_FIXTURE_NAMES, RAW_OFFER_FIXTURES, offerFixtures } from "../fixtures";

describe("offer fixtures bundled with the app", () => {
  it("match the shared fixtures/offers/*.json exactly", () => {
    expect(RAW_OFFER_FIXTURES["adafruit-3801"]).toEqual(sharedAdafruit);
    expect(RAW_OFFER_FIXTURES["sparkfun-rob-13301"]).toEqual(sharedSparkfun);
    expect(RAW_OFFER_FIXTURES["not-found-9999999"]).toEqual(sharedNotFound);
    expect(RAW_OFFER_FIXTURES["synthetic-multivendor"]).toEqual(sharedMultivendor);
    expect(RAW_OFFER_FIXTURES["refused-synthetic-demo-part"]).toEqual(sharedRefused);
  });

  it("every fixture passes the client-side OfferSet validator", () => {
    const all = offerFixtures();
    for (const name of OFFER_FIXTURE_NAMES) expect(all[name].schema_version).toBe("1.0");
  });

  it("the synthetic set is labelled synthetic and the real ones are not", () => {
    const all = offerFixtures();
    expect(all["synthetic-multivendor"].synthetic).toBe(true);
    expect(all["synthetic-multivendor"].provider_mode).toBe("stub");
    expect(all["adafruit-3801"].synthetic).toBe(false);
    expect(all["refused-synthetic-demo-part"].outcome).toBe("refused");
    expect(all["not-found-9999999"].offers).toEqual([]);
  });
});
