import type { TrustPublishedSnapshotView, TrustSectionVersionView } from "./i-client";

export type TrustField = { key: string; label: string; value: string };
export const APP_FIELD_LIMIT = 80;
export const APP_SECTION_ORDER = ["financials", "leadership", "nexNarrative", "complianceBadges", "auditsReserves", "listings"] as const;
const APP_FIELD_KEY = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const LANGUAGES = "zh|vi|en|id|ms|fil|ru|kk|uz";

/** Canonical public status before language derivation; no withheld content values are returned. */
export function parseI4PublishedSnapshot(value: unknown): TrustPublishedSnapshotView {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row || typeof row.sampledAt !== "string" || typeof row.available !== "boolean"
    || typeof row.sourceEnvironment !== "string"
    || ["reason", "source", "runId"].some(key => row[key] !== null && typeof row[key] !== "string")
    || !Array.isArray(row.sections) || !row.sections.every(section => section && typeof section === "object" && !Array.isArray(section)
      && typeof section.sectionKey === "string" && typeof section.available === "boolean"
      && (section.version === null || typeof section.version === "string")
      && (section.reason === null || typeof section.reason === "string")
      && Array.isArray(section.fields) && section.fields.every((field: unknown) => {
        if (!field || typeof field !== "object" || Array.isArray(field)) return false;
        const item = field as Record<string, unknown>;
        return typeof item.key === "string" && typeof item.cleared === "boolean"
          && (item.reason === null || typeof item.reason === "string");
      }))) {
    throw new Error("数据暂时读不出来，请刷新重试。");
  }
  return row as TrustPublishedSnapshotView;
}

/** Storage and HTTP responses enter here once; empty legacy fields and timestamps are legal. */
export function parseI4SectionVersion(value: unknown): TrustSectionVersionView {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row || !["sectionKey", "version", "description", "structure", "status", "operator", "updatedAt"].every(key => typeof row[key] === "string")
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !Array.isArray(row.fields)
    || !row.fields.every(field => field && typeof field === "object" && ["key", "label", "value"].every(key => typeof field[key] === "string"))) {
    throw new Error("数据暂时读不出来，请刷新重试。");
  }
  return row as TrustSectionVersionView;
}

/** App field contract; backend 19eb16f5 enforces it on new publish/rollback, drafts remain wider. */
export function i4AppFieldIssue(fields: readonly TrustField[]): string | undefined {
  if (!fields.length || fields.some(field => !field.label.trim())) return "请完整填写版本、说明、结构、字段和保存说明";
  if (fields.length > APP_FIELD_LIMIT) return "字段超过 80 个，App 会拒收整份内容，请先核对字段模板。";
  if (fields.some(field => !APP_FIELD_KEY.test(field.key.trim()))
    || new Set(fields.map(field => field.key.trim().toLowerCase())).size !== fields.length) {
    return "字段标识不符合 App 规则，请核对字段模板；不能包含连续或结尾的分隔符。";
  }
  return undefined;
}

/** Publication still replaces fields, including omitted translations. */
export function i4OmittedTranslations(current: readonly TrustField[], next: readonly TrustField[]): boolean {
  const keys = new Set(next.map(field => field.key.trim()));
  return current.some(field => /[._-](id|ms|fil|ru|kk|uz)$/i.test(field.key) && !keys.has(field.key.trim()));
}

/** 98a1aad7 retains omitted additional locales with an English family, draft before published. */
export function i4DraftOmittedTranslations(published: readonly TrustField[], draft: readonly TrustField[], next: readonly TrustField[]): boolean {
  const existing = new Map([...published, ...draft].map(field => [field.key.trim().toLowerCase(), field]));
  const supplied = new Set(next.map(field => field.key.trim().toLowerCase()));
  const known = [...existing.values(), ...next];
  return [...existing].some(([key, field]) => {
    const locale = /^(.+?)[._-](id|ms|fil|ru|kk|uz)$/i.exec(field.key.trim());
    return locale && !supplied.has(key) && !known.some(candidate => {
      const english = /^(.+?)[._-]en$/i.exec(candidate.key.trim());
      return english?.[1].toLowerCase() === locale[1].toLowerCase();
    });
  });
}

function i4LocalizedFieldFamilies(fields: readonly Pick<TrustField, "key" | "value">[]) {
  const families = new Map<string, Set<string>>();
  const localized = new RegExp(`^(.+?)[._-](${LANGUAGES})$`, "i");
  for (const field of fields) {
    const match = localized.exec(field.key.trim());
    if (!match) continue;
    const family = match[1].toLowerCase();
    const languages = families.get(family) ?? new Set<string>();
    if (field.value.trim()) languages.add(match[2].toLowerCase());
    families.set(family, languages);
  }
  return families;
}

export function i4HasEnglishFields(fields: readonly Pick<TrustField, "key" | "value">[]) {
  const families = i4LocalizedFieldFamilies(fields);
  return families.size > 0 && [...families.values()].every(languages => languages.has("en"));
}

export function i4TrilingualFields(fields: readonly Pick<TrustField, "key" | "value">[]) {
  const families = i4LocalizedFieldFamilies(fields);
  const missing = [...families].filter(([, languages]) => !["zh", "vi", "en"].every(lang => languages.has(lang))).map(([key]) => key);
  if (!families.size) missing.push("至少一组 .zh/.vi/.en 字段");
  return { valid: !missing.length, missing };
}

/** Mirror OpsTrustDisclosureService.isSafeTrustSectionLink:1586–1654 at 24972948.
 * Java URI does not normalize whitespace, percent escapes, host names or dot segments like URL does.
 * Page inference remains until the visual pass connects fetchI4PublishedSnapshot.
 */
function safeLink(value: string): boolean {
  if (!value || value !== value.trim() || value.length > 2048 || /[\\\x00-\x1f\x7f-\x9f]/.test(value)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|25)/i.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return false;
  if (value.startsWith("/")) {
    if (value.includes("//") || /%2f%2f/i.test(value) || /(?:^|\/)(?:(?:\.|%2e){1,2})(?:\/|$)/i.test(value)) return false;
    const [path, query] = value.split("?");
    if (!["/pages/trust/nex", "/pages/market/market"].includes(path) || value.includes("#")) return false;
    if (query === undefined) return true;
    const allowed = /^[A-Za-z0-9_.~!$&'()*+,;=:@%/?-]*$/;
    if (!allowed.test(value.slice(value.indexOf("?") + 1))) return false;
    return [...value.matchAll(/%([0-9a-f]{2})/gi)].every(match => {
      const code = parseInt(match[1], 16);
      return code <= 0x7f && allowed.test(String.fromCharCode(code));
    });
  }
  if (/[\s<>"{}|^`]/u.test(value)) return false;
  const match = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value);
  if (!match || match[1].includes("@") || !/^[\x00-\x7f]+$/.test(match[1])) return false;
  // Java URI.getHost accepts DNS/IPv4 and bracketed IPv6, not escaped or underscore hosts.
  const authority = match[1];
  if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.?|\[[0-9a-f:.]+\])(?::\d*)?$/i.test(authority)) return false;
  const host = authority.replace(/:\d*$/, "");
  const port = authority.slice(host.length + 1);
  // URI parses a port as a signed Java int, without URL's 65535 limit.
  if (port && BigInt(port) > BigInt(2147483647)) return false;
  if (!host.startsWith("[")) {
    const labels = host.replace(/\.$/, "").split(".");
    if (!labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) return false;
    if (labels.length > 1 && /^\d+$/.test(labels.at(-1)!)) {
      return labels.length === 4 && labels.every(label => /^\d+$/.test(label) && Number(label) <= 255);
    }
    return true;
  }
  try { return !!new URL(`https://${host}`).hostname; } catch { return false; }
}

const UNSUPPORTED_SUBHERO = new Set([
  "透明、可验证，并服务于真实使用场景。",
  "Transparent, verifiable and built for real utility.",
  "Minh bạch, có thể kiểm chứng và hướng đến tiện ích thực tế.",
]);

/** Inference from normal-runtime publishedSections:179–194, backend 24972948.
 * Admin overview alone does not expose the public projection; the page does not yet read the new snapshot.
 */
export function appBlanking(sectionKey: string, operator: string, fields: readonly TrustField[]): { all?: string; keys: Set<string> } {
  const keys = new Set<string>();
  if (["financials", "complianceBadges", "listings"].includes(sectionKey)) return { all: "正式环境不公开运营写的财务、徽章和上市文字。", keys };
  if (operator.trim().startsWith("migration") && ["leadership", "auditsReserves"].includes(sectionKey)) return { all: "这一版是系统迁移写入的，正式环境不公开。", keys };
  if (sectionKey === "auditsReserves") {
    if (!fields.some(field => field.key === "document1Url" && safeLink(field.value))) return { all: "报告地址没填或不是有效链接，整块文字不公开。", keys };
    fields.filter(field => field.key.startsWith("homepageProof.")).forEach(field => keys.add(field.key));
  }
  if (sectionKey === "nexNarrative") {
    const enClaim = fields.some(field => field.key === "subhero.en" && UNSUPPORTED_SUBHERO.has(field.value));
    fields.forEach(field => {
      if (field.key === "activeAiClients") keys.add(field.key);
      if (field.key.startsWith("subhero.") && (UNSUPPORTED_SUBHERO.has(field.value)
        || enClaim && ["id", "ms", "fil", "ru", "kk", "uz"].includes(field.key.slice(8)))) keys.add(field.key);
    });
  }
  return { keys };
}
