import { growthRequest } from "./h-client";
import { createSlotAttemptStore } from "./pending-mutation-store";
import { currentAdminOperator } from "./current-operator";
import { blankCopiedContentLanguage, fillBlankContentLanguage } from "./content-language-rules";
import { OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "./platform-experience-client";

export interface RafflePrize { id: string; nameZh: string; nameEn: string; nameVi: string; rewardType: "UVT" | "USDT" | "DEVICE"; amount: number | string; quantity: number; productNo?: string; }
export interface RaffleDraft { id: string; titleZh: string; titleEn: string; titleVi: string; startsAt: string; drawAt: string; prizes: RafflePrize[]; }
export interface AdminRaffle extends RaffleDraft { status: "DRAFT" | "OPEN" | "PROCESSING" | "DRAWN"; revision: number; totalEntries: number; }
export const RAFFLE_LANGUAGES = { zh: { suffix: "Zh", label: "中文" }, en: { suffix: "En", label: "英文" }, vi: { suffix: "Vi", label: "越南语" } } as const;
export function raffleDraftError(value: RaffleDraft, requiredLanguages: readonly OperatingLanguageCode[] = OPERATING_LANGUAGE_CODES): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) return "本期编号需为 1–64 位字母、数字、下划线或短横线。";
  const missingTitles = requiredLanguages.filter(locale => !value[`title${RAFFLE_LANGUAGES[locale].suffix}`].trim());
  if (missingTitles.length) return `请填写抽奖的${missingTitles.map(locale => RAFFLE_LANGUAGES[locale].label).join("、")}名称。`;
  if (!Number.isFinite(Date.parse(value.startsAt)) || !Number.isFinite(Date.parse(value.drawAt)) || Date.parse(value.drawAt) <= Date.parse(value.startsAt)) return "开奖时间必须晚于报名开始时间。";
  if (!value.prizes.length || value.prizes.length > 20 || new Set(value.prizes.map(prize => prize.id)).size !== value.prizes.length) return "请配置 1–20 个不重复的奖项。";
  for (const prize of value.prizes) {
    const missingNames = requiredLanguages.filter(locale => !prize[`name${RAFFLE_LANGUAGES[locale].suffix}`].trim());
    if (missingNames.length) return `请填写每个奖项的${missingNames.map(locale => RAFFLE_LANGUAGES[locale].label).join("、")}名称。`;
    if (!Number.isSafeInteger(prize.quantity) || prize.quantity < 1) return "每个奖项名额必须为正整数。";
    if (!["UVT", "USDT", "DEVICE"].includes(prize.rewardType) || !Number.isFinite(Number(prize.amount)) || Number(prize.amount) <= 0) return "请填写有效的奖励金额。";
    if (prize.rewardType === "DEVICE" && (!prize.productNo?.trim() || Number(prize.amount) !== 1)) return "设备奖需选择商品，每个中奖名额发放一台设备。";
  }
  return value.prizes.reduce((sum, prize) => sum + prize.quantity, 0) > 100 ? "本期总中奖名额不能超过 100。" : "";
}

export function raffleLocalizedDraft(draft: RaffleDraft, requiredLanguages: readonly OperatingLanguageCode[], mode: "edit" | "submit"): RaffleDraft {
  const transform = mode === "edit" ? blankCopiedContentLanguage : fillBlankContentLanguage;
  const localized = (locale: "zh" | "vi", english: string, value: string) =>
    transform(requiredLanguages, locale, { value: english }, { value }).value;
  return {
    ...draft,
    titleZh: localized("zh", draft.titleEn, draft.titleZh),
    titleVi: localized("vi", draft.titleEn, draft.titleVi),
    prizes: draft.prizes.map(prize => ({ ...prize,
      nameZh: localized("zh", prize.nameEn, prize.nameZh),
      nameVi: localized("vi", prize.nameEn, prize.nameVi),
    })),
  };
}
export function parseAdminRaffle(value: unknown): AdminRaffle {
  const row = value as AdminRaffle | null;
  if (!row || !["DRAFT", "OPEN", "PROCESSING", "DRAWN"].includes(row.status) || !Number.isSafeInteger(row.revision) || !Number.isSafeInteger(row.totalEntries) || row.totalEntries < 0 || !Array.isArray(row.prizes)) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  // Drafts may be incomplete; only structural values are required on read.
  if (![row.id, row.titleZh, row.titleEn, row.titleVi, row.startsAt, row.drawAt].every(value => typeof value === "string")) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  return row;
}
export async function fetchAdminRaffles(): Promise<AdminRaffle[]> {
  const result = await growthRequest<{ draws: unknown[] }>("/genesis-raffle");
  if (!Array.isArray(result?.draws)) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  return result.draws.map(parseAdminRaffle);
}
const commands = createSlotAttemptStore({ storageKey: "uvel-admin-genesis-raffle-attempts-v1" });
export async function saveAdminRaffle(draft: RaffleDraft, revision: number | null, enabled: boolean, reason: string): Promise<AdminRaffle> {
  const body = JSON.stringify({ ...draft, ...(revision === null ? {} : { expectedRevision: revision, enabled }), reason });
  const slot = `${currentAdminOperator()}:${draft.id}`;
  const key = commands.resolve(slot, body, () => `genesis-raffle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  await growthRequest(`/genesis-raffle${revision === null ? "" : `/${encodeURIComponent(draft.id)}`}`, { method: revision === null ? "POST" : "PATCH", body, headers: { "Idempotency-Key": key } });
  const saved = (await fetchAdminRaffles()).find(draw => draw.id === draft.id);
  if (!saved || (revision !== null && saved.revision <= revision)
    || OPERATING_LANGUAGE_CODES.some(locale => {
      const suffix = RAFFLE_LANGUAGES[locale].suffix;
      return saved[`title${suffix}`] !== draft[`title${suffix}`]
        || draft.prizes.some(prize => saved.prizes.find(item => item.id === prize.id)?.[`name${suffix}`] !== prize[`name${suffix}`]);
    })) throw new Error("配置已提交，尚未读到匹配的结果，请刷新核对后重试。");
  commands.forget(slot); return saved;
}
