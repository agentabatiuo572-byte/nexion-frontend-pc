import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("home funnel authority", () => {
  it("reads the B3 user funnel, not treasury transaction row counts", () => {
    const source = readFileSync("app/components/dashboard/funnel-bars.tsx", "utf8");
    expect(source).toContain("useB3Funnel");
    expect(source).toContain("distinctUsers");
    expect(source).not.toContain("stages[0]?.count || 1");
    expect(source).not.toContain("较昨日");
  });
});
