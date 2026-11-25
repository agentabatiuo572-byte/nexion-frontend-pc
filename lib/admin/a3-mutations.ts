import { useCallback, useEffect, useState } from "react";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, createPendingRecovery, isPendingCommandOwnedBy, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { A3FeatureFlag, A3PlatformParam } from "@/lib/admin/a3-client";
import { parseBusinessCalendar, type BusinessCalendarView, type BusinessCalendarVersion, type BusinessZoneOption } from "@/lib/admin/business-calendar-client";
import { isOperatingLanguageList, matchesSavedDownload, parsePlatformExperienceConfig, type PlatformExperienceConfig } from "@/lib/admin/platform-experience-client";
import { fetchDeveloperDocsAdmin, fetchHowContentAdmin, parseDeveloperDocs, parseHowContent, type PublishedContentDocument, type PublishedHowContentDocument } from "@/lib/admin/published-content-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { FundCommandOrigin, FundCommandEvidence } from "./fund-command-investigation";
import { a3ParamCommandOrigin, a3ParamCommandRoutes, queryA3ParamCommand, queryA3ConfigCommand } from "./a3-command-query";
import { isOriginalCommandOrigin } from "./original-command-query";
import { currentRecoveryActor } from "./abe-recovery-access";

export type A3Original =
  | { kind: "flag"; row: A3FeatureFlag; value: string }
  | { kind: "param"; row: A3PlatformParam; value: string }
  | { kind: "schedule"; view: BusinessCalendarView; option: BusinessZoneOption; effectiveDate: string }
  | { kind: "cancel"; view: BusinessCalendarView; target: BusinessCalendarVersion }
  | { kind: "experience"; config: PlatformExperienceConfig; baseline: PlatformExperienceConfig }
  | { kind: "docs"; document: PublishedContentDocument; baseline: PublishedContentDocument; mode: "DRAFT" | "PUBLISHED" }
  | { kind: "how"; document: PublishedHowContentDocument; baseline: PublishedHowContentDocument; mode: "DRAFT" | "PUBLISHED" };
export type A3Command = PendingMutationRecord & {
  commandOrigin?: FundCommandOrigin;
  original: A3Original;
  path: string;
  method: "PUT" | "POST";
  body: string;
  reason: string;
  name: string;
  change: string;
  /** Present only when this content request actually sends its explicit command key. */
  contentCommandActor?: number;
};
const PATHS: Record<A3Original["kind"], string> = {
  flag: "/api/admin/platform/config", param: "/api/admin/platform/config",
  schedule: "/api/admin/platform/business-calendar", cancel: "/api/admin/platform/business-calendar/cancel",
  experience: "/api/admin/platform/config/experience", docs: "/api/admin/developer/docs", how: "/api/admin/content/how-it-works",
};
export const a3Deduplicates = (record: Pick<A3Command, "original" | "contentCommandActor">) => record.original.kind !== "docs" && record.original.kind !== "how"
  || record.contentCommandActor !== undefined;
export const a3HasOriginalReceipt = (record: A3Command) => ["param", "flag", "experience"].includes(record.original.kind);
export type A3ContentComparison = {
  revision: { submitted: number; expected: number; current: number; matches: boolean };
  version: { submitted: string; current: string; matches: boolean };
  status: { submitted: "DRAFT" | "PUBLISHED"; current: PublishedContentDocument["status"]; matches: boolean };
  contentMatches: boolean;
};
// JSON object key order is immaterial; array order and submitted values are not.
function contentJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(contentJSON).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${contentJSON(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
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
      // Drafts retain text entered before switching the download source.
      const form = (item: unknown): boolean => object(item) && Number.isSafeInteger(item.version) && typeof item.baseUrl === "string"
        && typeof item.homeNewcomerTasksEnabled === "boolean" && typeof item.homeWeeklyPromoEnabled === "boolean"
        && Array.isArray(item.channels) && item.channels.every(channel => object(channel) && typeof channel.key === "string"
          && typeof channel.intentType === "string" && typeof channel.enabled === "boolean"
          && ["textTemplate", "urlTemplate", "androidPackage", "iosScheme"].every(key => channel[key] == null || typeof channel[key] === "string"))
        && object(item.appDownload) && ["officialUrl", "iosUrl", "androidUrl", "apkUrl", "version", "source"].every(key => typeof (item.appDownload as Record<string, unknown>)[key] === "string")
        && object(item.appDownload.releaseNotes) && typeof item.appDownload.releaseNotes.zh === "string" && typeof item.appDownload.releaseNotes.en === "string"
        && (item.appDownload.releaseNotes.vi === undefined || typeof item.appDownload.releaseNotes.vi === "string")
        && (item.interfaceLanguages == null || Array.isArray(item.interfaceLanguages) && item.interfaceLanguages.every(code => typeof code === "string"))
        && (item.operatingLanguages == null || isOperatingLanguageList(item.operatingLanguages));
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
        && (record.contentCommandActor === undefined || ["docs", "how"].includes(record.original.kind)
          && Number.isSafeInteger(record.contentCommandActor) && record.contentCommandActor > 0)
        && record.method === (record.original.kind === "cancel" ? "POST" : "PUT")
        && typeof record.body === "string" && object(JSON.parse(record.body)) && typeof record.reason === "string"
        && typeof record.name === "string" && typeof record.change === "string"
        && (record.commandOrigin === undefined || record.original.kind === "param" && isOriginalCommandOrigin(record.commandOrigin, a3ParamCommandRoutes.A3))
        && record.fingerprint === (record.commandOrigin ? `${record.commandOrigin.originalAdminId}:${a3Slot(record.original)}`
          : record.contentCommandActor === undefined ? a3Slot(record.original) : `${record.contentCommandActor}:${a3Slot(record.original)}`);
    } catch { return false; }
  },
});

const recovery = createPendingRecovery(commands, {
  capability: record => a3HasOriginalReceipt(record) ? "receipt" : a3Deduplicates(record) ? "replay" : "readback",
  canReplay: record => {
    const actor = currentRecoveryActor(record.commandOwnerId);
    return !!actor && actor.authorities.includes("platform_a3_write")
      && (record.original.kind !== "param" && record.original.kind !== "flag" || actor.role === "superadmin");
  },
  explicitRejectionCode: error => {
    const code = explicitRejectionCode(error);
    return code !== "BUSINESS_CALENDAR_EFFECTIVE_DATE_TOO_EARLY" ? code : undefined;
  },
});

export function useA3Commands() {
  const actorId = useAdminAuth(state => state.session?.adminId);
  const [pending, setPending] = useState<A3Command[]>([]);
  const sync = useCallback(() => setPending(commands.list()), [actorId]);
  useEffect(sync, [sync]);
  // Expiration affects availability even when the operator leaves the page open.
  useEffect(() => {
    const next = pending.filter(record => !isRetryExpired(record)).reduce((at, record) => Math.min(at, record.expiresAt), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(sync, Math.max(1, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pending, sync]);
  const find = (slot: string) => commands.list().find(record => record.fingerprint === slot || record.fingerprint === `${actorId}:${slot}`);
  const capture = (input: Omit<A3Command, keyof PendingMutationRecord>) => {
    const slot = a3Slot(input.original);
    if (find(slot)) throw new Error("A3_ORIGINAL_UNRESOLVED");
    const contentSave = input.original.kind === "docs" || input.original.kind === "how";
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !auth.session
      || auth.session.passwordChangeRequired) throw new Error("ADMIN_PERMISSION_DENIED");
    if ((contentSave || input.original.kind === "param") && !auth.session.authorities.includes("platform_a3_write")) throw new Error("ADMIN_PERMISSION_DENIED");
    const key = `a3-${input.original.kind}-${crypto.randomUUID()}`;
    const fingerprint = contentSave || input.original.kind === "param" ? `${auth.session!.adminId}:${slot}` : slot;
    commands.remember(fingerprint, key, { ...input, ...(contentSave ? { contentCommandActor: auth.session!.adminId } : {}),
      ...(input.original.kind === "param" ? { commandOrigin: a3ParamCommandOrigin("A3") } : {}) });
    if (!commands.isDurablyStored(fingerprint, key)) {
      commands.forget(fingerprint, key); sync();
      throw new Error("A3_ORIGINAL_STORAGE_FAILED");
    }
    sync();
    return commands.list().find(record => record.commandKey === key)!;
  };
  const queryOriginal = async (record: A3Command, evidence?: FundCommandEvidence) => {
    const original = record.original;
    if (original.kind !== "param" && original.kind !== "flag" && original.kind !== "experience"
      || find(record.fingerprint)?.commandKey !== record.commandKey) throw new Error("A3_ORIGINAL_UNRESOLVED");
    const read = async () => {
      const result = original.kind === "param"
        ? await queryA3ParamCommand(record, "A3", String(actorId), original.row.key, evidence)
        : await queryA3ConfigCommand(record, original, String(actorId), evidence);
      return { ...result, conclusion: result.receipt ? "unknown" : "not-found" } as const;
    };
    const result = evidence ? await read() : await recovery.query(record, read);
    if (!result) throw new Error("A3_ORIGINAL_UNRESOLVED");
    if (result.settled) { commands.forget(record.fingerprint, record.commandKey); sync(); }
    return result;
  };
  const queryContent = async (record: A3Command) => {
    const original = record.original;
    if (original.kind !== "docs" && original.kind !== "how" || find(record.fingerprint)?.commandKey !== record.commandKey)
      throw new Error("A3_ORIGINAL_UNRESOLVED");
    const current = original.kind === "docs" ? await fetchDeveloperDocsAdmin() : await fetchHowContentAdmin();
    if (find(record.fingerprint)?.commandKey !== record.commandKey) throw new Error("A3_ORIGINAL_UNRESOLVED");
    const comparison: A3ContentComparison = {
      revision: { submitted: original.document.revision, expected: original.document.revision + 1, current: current.revision, matches: current.revision === original.document.revision + 1 },
      version: { submitted: original.document.version.trim(), current: current.version, matches: current.version === original.document.version.trim() },
      status: { submitted: original.mode, current: current.status, matches: current.status === original.mode },
      contentMatches: contentJSON("locales" in current ? current.locales : current.contents)
        === contentJSON(original.kind === "docs" ? original.document.locales : original.document.contents),
    };
    // An expired record needs evidence about the original operation, beyond a current-value comparison.
    const matched = !isRetryExpired(record) && comparison.revision.matches && comparison.version.matches && comparison.status.matches && comparison.contentMatches;
    if (matched) { commands.forget(record.fingerprint, record.commandKey); sync(); }
    return { current, comparison, matched };
  };
  const send = async (record: A3Command, retry = false) => {
    try {
      return retry ? await recovery.replay(record, saved => submit(saved, true)) : await submit(record, false);
    } finally { sync(); }
  };
  const submit = async (record: A3Command, retry: boolean) => {
    if (!isPendingCommandOwnedBy(record)) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
    if (record.commandOrigin && record.commandOrigin.originalAdminId !== String(useAdminAuth.getState().session?.adminId)) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
    if (record.original.kind === "param" && find(record.fingerprint)?.commandKey !== record.commandKey) throw new Error("A3_ORIGINAL_UNRESOLVED");
    if (retry && (!a3Deduplicates(record) || isRetryExpired(record))) throw new Error("A3_ORIGINAL_QUERY_ONLY");
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("A3_ORIGINAL_STORAGE_FAILED");
    if (record.contentCommandActor !== undefined) {
      const auth = useAdminAuth.getState();
      if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || auth.session?.passwordChangeRequired
        || auth.session?.adminId !== record.contentCommandActor || !auth.session.authorities.includes("platform_a3_write")) throw new Error("ADMIN_PERMISSION_DENIED");
    }
    try {
      const response = await guardedFetch(record.path, {
        method: record.method, cache: "no-store",
        headers: { "Content-Type": "application/json", ...(a3Deduplicates(record) ? { "Idempotency-Key": record.commandKey } : {}) },
        body: record.body,
      });
      const result: unknown = await response.json().catch(() => null);
      const body = object(result) ? result : null;
      if (!isPendingCommandOwnedBy(record)) throw new OutcomeUnknownError("A3_MUTATION_OUTCOME_UNCERTAIN");
      if (response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") throw new OutcomeUnknownError("A3_MUTATION_OUTCOME_UNCERTAIN");
      if (!response.ok || body?.code !== 0) {
        const reasonCode = typeof body?.message === "string" ? body.message : undefined;
        if (isAdminAuthFailure(response.status, reasonCode)) resetAdminSession();
        const apiCode = typeof body?.code === "number" ? body.code : undefined;
        const status = response.ok && apiCode !== undefined && apiCode >= 400 && apiCode < 500 ? apiCode : response.status;
        const error = Object.assign(new Error(formatAdminApiError(reasonCode, `A3_REQUEST_FAILED_${response.status}`)), { status, reasonCode, apiCode });
        if (retry && explicitRejectionCode(error)) throw error;
        if (!retry && !isIdempotencyOutcomeOpen(reasonCode) && isDeterministicRejection(response.status, error.apiCode)) {
          commands.forget(record.fingerprint, record.commandKey);
          throw error;
        }
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
          const { interfaceLanguages, operatingLanguages, appDownload } = JSON.parse(record.body) as {
            interfaceLanguages?: unknown; operatingLanguages?: unknown; appDownload: PlatformExperienceConfig["appDownload"];
          };
          if (!matchesSavedDownload(appDownload, saved.appDownload)) {
            throw new OutcomeUnknownError("PLATFORM_EXPERIENCE_DOWNLOAD_NOT_CONFIRMED");
          }
          if (saved.version !== record.original.config.version + 1
            || interfaceLanguages !== undefined && JSON.stringify(saved.interfaceLanguages) !== JSON.stringify(interfaceLanguages)
            || operatingLanguages !== undefined && JSON.stringify(saved.operatingLanguages) !== JSON.stringify(operatingLanguages)) {
            throw new OutcomeUnknownError("A3_MUTATION_RESPONSE_UNREADABLE");
          }
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
      if ((retry && explicitRejectionCode(error)) || !commands.list().some(item => item.commandKey === record.commandKey)) throw error;
      throw error instanceof OutcomeUnknownError ? error : new OutcomeUnknownError("A3_MUTATION_OUTCOME_UNCERTAIN", { cause: error });
    }
  };
  return { pending, find, capture, send, queryOriginal, queryContent, sync, recoveryState: recovery.state, releaseSnapshot: recovery.releaseSnapshot,
    releaseRejected: (record: A3Command) => !!currentRecoveryActor(record.commandOwnerId) && recovery.releaseRejectedReplay(record) };
}
export type A3Commands = ReturnType<typeof useA3Commands>;
export type A3RecoveryProps = { commands: A3Commands; recovery: A3Command | null; onRecovered: () => void; nonce: number };
