import { useCallback, useEffect, useState } from "react";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { A3FeatureFlag, A3PlatformParam } from "@/lib/admin/a3-client";
import { parseBusinessCalendar, type BusinessCalendarView, type BusinessCalendarVersion, type BusinessZoneOption } from "@/lib/admin/business-calendar-client";
import { parsePlatformExperienceConfig, type PlatformExperienceConfig } from "@/lib/admin/platform-experience-client";
import { parseDeveloperDocs, parseHowContent, type PublishedContentDocument, type PublishedHowContentDocument } from "@/lib/admin/published-content-client";

export type A3Original =
  | { kind: "flag"; row: A3FeatureFlag; value: string }
  | { kind: "param"; row: A3PlatformParam; value: string }
  | { kind: "schedule"; view: BusinessCalendarView; option: BusinessZoneOption; effectiveDate: string }
  | { kind: "cancel"; view: BusinessCalendarView; target: BusinessCalendarVersion }
  | { kind: "experience"; config: PlatformExperienceConfig; baseline: PlatformExperienceConfig }
  | { kind: "docs"; document: PublishedContentDocument; baseline: PublishedContentDocument; mode: "DRAFT" | "PUBLISHED" }
  | { kind: "how"; document: PublishedHowContentDocument; baseline: PublishedHowContentDocument; mode: "DRAFT" | "PUBLISHED" };
export type A3Command = PendingMutationRecord & {
  original: A3Original;
  path: string;
  method: "PUT" | "POST";
  body: string;
  reason: string;
  name: string;
  change: string;
};
const PATHS: Record<A3Original["kind"], string> = {
  flag: "/api/admin/platform/config", param: "/api/admin/platform/config",
  schedule: "/api/admin/platform/business-calendar", cancel: "/api/admin/platform/business-calendar/cancel",
  experience: "/api/admin/platform/config/experience", docs: "/api/admin/developer/docs", how: "/api/admin/content/how-it-works",
};
export const a3Deduplicates = (record: Pick<A3Command, "original">) => record.original.kind !== "docs" && record.original.kind !== "how";
export const a3Slot = (original: A3Original) => original.kind === "flag" || original.kind === "param" ? `${original.kind}:${original.row.key}`
  : original.kind === "cancel" || original.kind === "schedule" ? "calendar" : original.kind;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function validOriginal(value: unknown): value is A3Original {
  if (!object(value)) return false;
  switch (value.kind) {
    case "flag":
    case "param": {
      const row = value.row;
      if (!object(row) || typeof row.key !== "string" || typeof row.name !== "string" || typeof row.lastChange !== "string"
        || typeof row.consumer !== "string" || typeof value.value !== "string") return false;
      return value.kind === "flag" ? typeof row.status === "string" && typeof row.scope === "string"
        && Array.isArray(row.allowedValues) && row.allowedValues.every(item => typeof item === "string")
        : typeof row.value === "string" && typeof row.unit === "string" && typeof row.min === "number" && typeof row.max === "number";
    }
    case "schedule":
      return !!parseBusinessCalendar(value.view) && object(value.option) && typeof value.option.zoneId === "string"
        && typeof value.option.label === "string" && (value.option.countryCode === null || typeof value.option.countryCode === "string")
        && typeof value.effectiveDate === "string";
    case "cancel":
      return object(value.view) && !!parseBusinessCalendar({ ...value.view, pending: value.target });
    case "experience": {
      // Drafts may contain invalid URLs or old download fields after choosing unavailable: the server validates/clears those on save.
      const form = (item: unknown): boolean => object(item) && Number.isSafeInteger(item.version) && typeof item.baseUrl === "string"
        && typeof item.homeNewcomerTasksEnabled === "boolean" && typeof item.homeWeeklyPromoEnabled === "boolean"
        && Array.isArray(item.channels) && item.channels.every(channel => object(channel) && typeof channel.key === "string"
          && typeof channel.intentType === "string" && typeof channel.enabled === "boolean"
          && ["textTemplate", "urlTemplate", "androidPackage", "iosScheme"].every(key => channel[key] == null || typeof channel[key] === "string"))
        && object(item.appDownload) && ["officialUrl", "iosUrl", "androidUrl", "apkUrl", "version", "source"].every(key => typeof (item.appDownload as Record<string, unknown>)[key] === "string")
        && object(item.appDownload.releaseNotes) && typeof item.appDownload.releaseNotes.zh === "string" && typeof item.appDownload.releaseNotes.en === "string"
        && (item.interfaceLanguages === undefined || Array.isArray(item.interfaceLanguages) && item.interfaceLanguages.every(code => typeof code === "string"));
      return form(value.config) && form(value.baseline);
    }
    case "docs": return !!parseDeveloperDocs(value.document) && !!parseDeveloperDocs(value.baseline) && ["DRAFT", "PUBLISHED"].includes(String(value.mode));
    case "how": return !!parseHowContent(value.document) && !!parseHowContent(value.baseline) && ["DRAFT", "PUBLISHED"].includes(String(value.mode));
    default: return false;
  }
}
/** One instance for the entire page; each object retains its exact wire body, including non-deduplicated writes. */
const commands = createPendingMutationStore<A3Command>({
  storageKey: "nexion-admin-a3-pending-commands-v1", retainExpiredRecords: true,
  isValidRecord: record => {
    try {
      return validOriginal(record.original) && record.path === PATHS[record.original.kind]
        && record.method === (record.original.kind === "cancel" ? "POST" : "PUT")
        && typeof record.body === "string" && object(JSON.parse(record.body)) && typeof record.reason === "string"
        && typeof record.name === "string" && typeof record.change === "string" && record.fingerprint === a3Slot(record.original);
    } catch { return false; }
  },
});

export function useA3Commands() {
  const [pending, setPending] = useState<A3Command[]>([]);
  const sync = useCallback(() => setPending(commands.list()), []);
  useEffect(sync, [sync]);
  // Expiration affects availability even when the operator leaves the page open.
  useEffect(() => {
    const next = pending.filter(record => !isRetryExpired(record)).reduce((at, record) => Math.min(at, record.expiresAt), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(sync, Math.max(1, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pending, sync]);
  const find = (slot: string) => commands.list().find(record => record.fingerprint === slot);
  const capture = (input: Omit<A3Command, keyof PendingMutationRecord>) => {
    const slot = a3Slot(input.original);
    if (find(slot)) throw new Error("A3_ORIGINAL_UNRESOLVED");
    const key = `a3-${input.original.kind}-${crypto.randomUUID()}`;
    commands.remember(slot, key, input);
    if (!commands.isDurablyStored(slot, key)) {
      commands.forget(slot, key); sync();
      throw new Error("A3_ORIGINAL_STORAGE_FAILED");
    }
    sync();
    return commands.list().find(record => record.commandKey === key)!;
  };
  const send = async (record: A3Command, retry = false) => {
    if (retry && (!a3Deduplicates(record) || isRetryExpired(record))) throw new Error("A3_ORIGINAL_QUERY_ONLY");
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("A3_ORIGINAL_STORAGE_FAILED");
    try {
      const response = await guardedFetch(record.path, {
        method: record.method, cache: "no-store",
        headers: { "Content-Type": "application/json", ...(a3Deduplicates(record) ? { "Idempotency-Key": record.commandKey } : {}) },
        body: record.body,
      });
      const result: unknown = await response.json().catch(() => null);
      const body = object(result) ? result : null;
      if (response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") throw new OutcomeUnknownError("A3_MUTATION_OUTCOME_UNCERTAIN");
      if (!response.ok || body?.code !== 0) {
        const reasonCode = typeof body?.message === "string" ? body.message : undefined;
        if (isAdminAuthFailure(response.status, reasonCode)) resetAdminSession();
        const error = Object.assign(new Error(formatAdminApiError(reasonCode, `A3_REQUEST_FAILED_${response.status}`)), {
          status: response.status, reasonCode, apiCode: typeof body?.code === "number" ? body.code : undefined,
        });
        // The schedule's date check precedes idempotency replay; time advancing cannot settle the original command.
        const rejected = retry ? isExplicitRejection(error) && reasonCode !== "BUSINESS_CALENDAR_EFFECTIVE_DATE_TOO_EARLY"
          : !isIdempotencyOutcomeOpen(reasonCode) && isDeterministicRejection(response.status, error.apiCode);
        if (rejected) { commands.forget(record.fingerprint, record.commandKey); sync(); throw error; }
        throw new OutcomeUnknownError(error.message);
      }
      // A code=0 envelope with missing/invalid data is still unknown. Never display a replay as current data.
      const data = body.data;
      switch (record.original.kind) {
        case "flag":
        case "param": {
          const key = record.original.kind === "flag" ? `feature.${record.original.row.key}` : record.original.row.key;
          if (!object(data) || data.configKey !== key || typeof data.configValue !== "string") throw new OutcomeUnknownError("A3_MUTATION_RESPONSE_UNREADABLE");
          break;
        }
        case "schedule": case "cancel": parseBusinessCalendar(data); break;
        case "experience": {
          const saved = parsePlatformExperienceConfig(data);
          if (saved.version !== record.original.config.version + 1 || record.original.config.interfaceLanguages
            && saved.interfaceLanguages?.join() !== record.original.config.interfaceLanguages.join()) throw new OutcomeUnknownError("A3_MUTATION_RESPONSE_UNREADABLE");
          break;
        }
        case "docs": case "how": {
          const saved = record.original.kind === "docs" ? parseDeveloperDocs(data) : parseHowContent(data);
          if (saved.revision !== record.original.document.revision + 1 || saved.status !== record.original.mode
            || saved.version !== record.original.document.version.trim()) throw new OutcomeUnknownError("A3_MUTATION_RESPONSE_UNREADABLE");
          break;
        }
      }
      commands.forget(record.fingerprint, record.commandKey); sync();
    } catch (error) {
      sync();
      if (!commands.list().some(item => item.commandKey === record.commandKey)) throw error;
      throw error instanceof OutcomeUnknownError ? error : new OutcomeUnknownError("A3_MUTATION_OUTCOME_UNCERTAIN", { cause: error });
    }
  };
  return { pending, find, capture, send, sync };
}
export type A3Commands = ReturnType<typeof useA3Commands>;
export type A3RecoveryProps = { commands: A3Commands; recovery: A3Command | null; onRecovered: () => void; nonce: number };
