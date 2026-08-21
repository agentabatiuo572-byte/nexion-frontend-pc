import { describe, expect, it } from "vitest";
import type { OpsSku } from "../lib/admin/platform-types";
import { EMPTY_SKU_FORM, formToSku, skuToForm } from "../app/components/domain-views/e-tabs/data";

describe("E1 product specification round trip", () => {
  it("keeps server specs through editor form and payload", () => {
    const source: OpsSku = {
      ...formToSku(EMPTY_SKU_FORM),
      id: "sku-pro", name: "Pro", price: 100, dailyEarn: 1, dailyEarnNEX: 2,
      uptime: "99.9%", warranty: "24 months", phoneDailyEarn: 0.06, phoneDailyEarnNEX: 10,
    };
    const form = skuToForm(source);
    const roundTrip = formToSku(form, source);
    expect(roundTrip).toMatchObject({ uptime: "99.9%", warranty: "24 months", phoneDailyEarn: 0.06, phoneDailyEarnNEX: 10 });
  });

  it("does not invent a local value for missing remote specs", () => {
    const source = formToSku(EMPTY_SKU_FORM);
    expect(source.uptime).toBeUndefined();
    expect(source.warranty).toBeUndefined();
    expect(source.phoneDailyEarn).toBeUndefined();
    expect(source.phoneDailyEarnNEX).toBeUndefined();
  });
});
