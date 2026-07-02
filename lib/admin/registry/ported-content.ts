import type { ModuleEntry } from "@/lib/admin/module-content";

// Ported domains render their real UI from domain-views/*.
// Keep registry content empty so ModulePage cannot revive stale business data.
export const PORTED_EMPTY_CONTENT: ModuleEntry["content"] = { kind: "dashboard" };
