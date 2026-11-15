import type { TrustSectionVersionView } from "./i-client";

export type TrustField = { key: string; label: string; value: string };
export const APP_FIELD_LIMIT = 80;
export const APP_SECTION_ORDER = ["financials", "leadership", "nexNarrative", "complianceBadges", "auditsReserves", "listings"] as const;
const APP_FIELD_KEY = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const LANGUAGES = "zh|vi|en|id|ms|fil|ru|kk|uz";

/** Storage and HTTP responses enter here once; empty legacy fields and timestamps are legal. */
export function parseI4SectionVersion(value: unknown): TrustSectionVersionView {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row || !["sectionKey", "version", "description", "structure", "status", "operator", "updatedAt"].every(key => typeof row[key] === "string")
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !Array.isArray(row.fields)
    || !row.fields.every(field => field && typeof field === "object" && ["key", "label", "value"].every(key => typeof field[key] === "string"))) {
    throw new Error("I4 返回数据格式异常，请刷新重试");
  }
  return row as TrustSectionVersionView;
}

/** App b52d3152 src/api/trust-section-api.ts:41–82; backend 24972948 allows 150 and looser keys. */
export function i4AppFieldIssue(fields: readonly TrustField[]): string | undefined {
  if (!fields.length) return "请完整填写版本、说明、结构、字段和保存说明";
  if (fields.length > APP_FIELD_LIMIT) return "字段超过 80 个，App 会拒收整份内容，请先核对字段模板。";
  if (fields.some(field => !APP_FIELD_KEY.test(field.key) || field.key.length > 64)
    || new Set(fields.map(field => field.key.toLowerCase())).size !== fields.length) {
    return "字段标识不符合 App 规则，请核对字段模板；不能包含连续或结尾的分隔符。";
  }
  return undefined;
}

/** I4-BE-05: replacing fields deletes omitted translations; never silently merge or discard them. */
export function i4OmittedTranslations(current: readonly TrustField[], next: readonly TrustField[]): boolean {
  const keys = new Set(next.map(field => field.key.trim()));
  return current.some(field => /[._-](id|ms|fil|ru|kk|uz)$/i.test(field.key) && !keys.has(field.key.trim()));
}

export function i4TrilingualFields(fields: readonly Pick<TrustField, "key" | "value">[]) {
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
  const missing = [...families].filter(([, languages]) => !["zh", "vi", "en"].every(lang => languages.has(lang))).map(([key]) => key);
  if (!families.size) missing.push("至少一组 .zh/.vi/.en 字段");
  return { valid: !missing.length, missing };
}

/** Mirror OpsTrustDisclosureService.isSafeTrustSectionLink:1586–1654 at 24972948.
 * Java URI does not normalize whitespace, percent escapes, host names or dot segments like URL does.
 * Keep this with the public blanking rule until I4-BE-06 supplies a canonical projection.
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
 * Admin overview does not expose runtime/public projection (I4-BE-06); this is not a public read receipt.
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
