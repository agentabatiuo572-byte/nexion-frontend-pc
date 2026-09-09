import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isCurrentAccountDeletionListRead,
  isCurrentAccountDeletionSelection,
  syncSelectedAccountDeletion,
} from "../app/components/domain-views/c-tabs/account-deletion-queue-state";

type Request = { requestNo: string; userId: number; version: number; status: string };

const row = (requestNo: string, version: number, status = "REQUESTED"): Request => ({ requestNo, userId: 1, version, status });

describe("account-deletion queue selection lifecycle", () => {
  it("refreshes the current detail from its matching list row without replacing another selection", () => {
    const selected = row("DEL-A", 1);
    expect(syncSelectedAccountDeletion(selected, [row("DEL-A", 2)])).toEqual(row("DEL-A", 2));
    expect(syncSelectedAccountDeletion(selected, [row("DEL-B", 2)])).toBe(selected);
  });

  it("rejects a late A detail after B becomes the active selection", () => {
    expect(isCurrentAccountDeletionSelection("DEL-B", "DEL-A", 2, 1)).toBe(false);
    expect(isCurrentAccountDeletionSelection("DEL-B", "DEL-B", 2, 2)).toBe(true);
  });

  it("rejects a late detail success or failure after the drawer closes", () => {
    expect(isCurrentAccountDeletionSelection(null, "DEL-A", 3, 1)).toBe(false);
  });

  it("does not let a late mutation result replace a newly selected drawer", () => {
    expect(isCurrentAccountDeletionSelection("DEL-B", "DEL-A", 2, 1)).toBe(false);
  });

  it("publishes only the newest list response, including its failure/loading completion", () => {
    expect(isCurrentAccountDeletionListRead(2, 1)).toBe(false);
    expect(isCurrentAccountDeletionListRead(2, 2)).toBe(true);
  });

  it("uses a stable list refresh callback and the extracted selection transitions", () => {
    const source = readFileSync(new URL("../app/components/domain-views/c-tabs/account-deletion-queue.tsx", import.meta.url), "utf8");
    expect(source).toContain("}, [canRead, page, status]);");
    expect(source).toContain("syncSelectedAccountDeletion");
    expect(source).toContain("isCurrentAccountDeletionSelection");
    expect(source).toContain("isCurrentAccountDeletionListRead");
    expect(source).toContain("await refresh(true, currentQueryRef.current);");
    expect(source).toContain("const currentQueryRef = useRef<ListQuery>");
    expect(source).toContain("listLoadingRef.current && loadingListGenerationRef.current === generation");
  });
});
