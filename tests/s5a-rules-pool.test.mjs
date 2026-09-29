import { describe, expect, it, vi } from "vitest";
vi.mock("../app/components/domain-views/design-kit", () => ({ Modal: () => null }));
import { parseRuleDraft } from "../app/components/domain-views/m-tabs/m5-service-rules";
import { isAssignable } from "../app/components/domain-views/m-tabs/m1-supervisor-pool";

const blank = { dormantDays: "", maintenanceDays: "", activityWindowDays: "", inheritanceMode: "UNCONFIGURED", maxInheritanceDepth: "" };

describe("service rules draft", () => {
  it("accepts independent partial configuration and finite zero layers", () => {
    expect(parseRuleDraft({ ...blank, maintenanceDays: "7" })).toMatchObject({ dormantDays: null, maintenanceDays: 7, activityWindowDays: null, inheritanceMode: "UNCONFIGURED", maxInheritanceDepth: null });
    expect(parseRuleDraft({ ...blank, inheritanceMode: "LIMITED", maxInheritanceDepth: "0" })).toMatchObject({ inheritanceMode: "LIMITED", maxInheritanceDepth: 0 });
  });

  it("rejects invalid days, missing finite depth and W greater than configured D", () => {
    expect(parseRuleDraft({ ...blank, dormantDays: "-1" })).toBeNull();
    expect(parseRuleDraft({ ...blank, maintenanceDays: "1.5" })).toBeNull();
    expect(parseRuleDraft({ ...blank, inheritanceMode: "LIMITED" })).toBeNull();
    expect(parseRuleDraft({ ...blank, dormantDays: "7", activityWindowDays: "8" })).toBeNull();
    expect(parseRuleDraft({ ...blank, dormantDays: "", activityWindowDays: "8" })).not.toBeNull();
  });
});

describe("pool advisor candidate", () => {
  const agent = { adminId: 1, name: "G1", seatType: "DEDICATED", serviceTypes: ["advisor"], enabled: true, busy: true, assignedUserCount: 20, maxConcurrent: 2, version: 1 };
  it("retains a busy dedicated advisor but excludes ordinary and disabled seats", () => {
    expect(isAssignable(agent)).toBe(true);
    expect(isAssignable({ ...agent, seatType: "GENERAL" })).toBe(false);
    expect(isAssignable({ ...agent, enabled: false })).toBe(false);
    expect(isAssignable({ ...agent, serviceTypes: ["support"] })).toBe(false);
  });
});
