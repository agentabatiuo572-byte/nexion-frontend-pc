import { trimStoredContent } from "./content-language-rules.ts";

// Keep this in step with AppProductCatalogService.badgeKind. The first alias is the stored preset.
const SKU_BADGE_PRESETS = {
  recommended: { label: "推荐", aliases: ["recommended", "推荐", "đề xuất", "рекомендуем", "ұсынылады", "tavsiya", "rekomendasi", "disyorkan", "mungkahi"] },
  bestSeller: { label: "热销", aliases: ["best seller", "热销", "bán chạy nhất", "bán chạy", "хит продаж", "хит", "xit", "terlaris", "pinakamabenta"] },
  trending: { label: "正热", aliases: ["trending", "上升", "正热", "xu hướng", "đang hot", "в тренде", "танымал", "ommabop", "naik daun", "sohor kini"] },
  upgradePick: { label: "升级首选", aliases: ["upgrade pick", "升级首选", "nên nâng cấp", "для улучшения", "жаңарту үшін", "yangilash uchun", "pilihan upgrade", "pilihan naik taraf", "pang-upgrade", "lựa chọn nâng cấp"] },
  flagship: { label: "旗舰", aliases: ["flagship", "旗舰", "hàng đầu", "флагман", "flagman", "unggulan", "perdana"] },
  lowBarrier: { label: "低门槛", aliases: ["low barrier", "低门槛", "rào cản thấp", "лёгкий старт", "төмен кіру шегі", "oson boshlash", "mudah mulai", "mudah dimulakan", "mababang entry"] },
};

const PRESET_KINDS = Object.keys(SKU_BADGE_PRESETS) as (keyof typeof SKU_BADGE_PRESETS)[];
export type SkuBadgeKind = (typeof PRESET_KINDS)[number] | "none" | "custom";

export const SKU_BADGE_OPTIONS = [
  { value: "none", label: "无" },
  ...PRESET_KINDS.map(value => ({ value, label: SKU_BADGE_PRESETS[value].label })),
  { value: "custom", label: "自定义" },
];

export function skuBadgeKind(badge?: string | null): SkuBadgeKind {
  const label = trimStoredContent((badge ?? "").normalize("NFKC").replace(/\p{White_Space}+/gu, " ")).toLowerCase();
  if (!label) return "none";
  return PRESET_KINDS.find(kind => SKU_BADGE_PRESETS[kind].aliases.includes(label)) ?? "custom";
}

export function skuBadgeValue(kind: SkuBadgeKind, custom: string): string | undefined {
  if (kind === "none") return undefined;
  if (kind === "custom") return trimStoredContent(custom) || undefined;
  return SKU_BADGE_PRESETS[kind].aliases[0];
}

export function skuBadgeReviewText(badge?: string | null): string | undefined {
  const kind = skuBadgeKind(badge);
  if (kind === "none") return undefined;
  const label = kind === "custom" ? "自定义" : SKU_BADGE_PRESETS[kind].label;
  return `${label} · ${badge}`;
}

export const SKU_CUSTOM_BADGE_MAX_LENGTH = 64;
export const SKU_TAGLINE_TRANSLATION_MAX_LENGTH = 255;
export const SKU_TAGLINE_VI_HAN_ERROR = "越南语标语不能包含中文，请改成越南语";
export const SKU_TAGLINE_LABELS = {
  zh: "中文标语",
  vi: "越南语标语",
  id: "印尼语标语",
  ms: "马来语标语",
  fil: "菲律宾语标语",
  ru: "俄语标语",
  kk: "哈萨克语标语",
  uz: "乌兹别克语标语",
};
export type SkuTaglineTranslations = Partial<Record<keyof typeof SKU_TAGLINE_LABELS, string>>;
const E1_EDITABLE_TAGLINE_FIELDS = { zh: "taglineZh", vi: "taglineVi" } as const;

export function isSkuTaglineTranslations(value: unknown): value is SkuTaglineTranslations {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([key, text]) => Object.hasOwn(SKU_TAGLINE_LABELS, key) && typeof text === "string");
}

/** Omission preserves stored translations. An explicit empty object clears them. */
export function skuTaglineTranslationUpdate(
  form: Record<(typeof E1_EDITABLE_TAGLINE_FIELDS)[keyof typeof E1_EDITABLE_TAGLINE_FIELDS], string>,
  previous?: SkuTaglineTranslations,
): SkuTaglineTranslations | undefined {
  const zh = form.taglineZh.trim();
  const vi = form.taglineVi.trim();
  if (zh === (previous?.zh ?? "") && vi === (previous?.vi ?? "")) return undefined;

  const next = { ...previous };
  if (zh) next.zh = zh;
  else delete next.zh;
  if (vi) next.vi = vi;
  else delete next.vi;
  return next;
}

export function skuTaglineReviewRows(before: SkuTaglineTranslations | undefined, after: SkuTaglineTranslations | undefined, creating: boolean) {
  return (["zh", "vi"] as const).map(language => ({
    key: E1_EDITABLE_TAGLINE_FIELDS[language],
    label: SKU_TAGLINE_LABELS[language],
    before: creating ? "未创建" : before?.[language] ?? "未设置",
    after: after?.[language] ?? "未设置",
    note: undefined,
  }));
}
