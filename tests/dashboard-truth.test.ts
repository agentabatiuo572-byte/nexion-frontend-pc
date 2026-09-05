import { describe, it, expect } from "vitest";
import { finiteDashboardNumber } from "../lib/admin/dashboard-number";

describe("dashboard unknown values", () => {
  it("never treats missing values as successful zero-day KPI", () => {
    for (const value of [null, undefined, "", " ", false, [], {}, NaN, Infinity]) expect(finiteDashboardNumber(value)).toBeNull();
  });
  it("retains real zero and numeric values", () => {
    expect(finiteDashboardNumber(0)).toBe(0);
    expect(finiteDashboardNumber("14")).toBe(14);
  });
});
