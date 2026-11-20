import { growthRequest } from "./h-client";
import { confirmedH4RaffleSaves, confirmH4RaffleReadback, h4CommandRequest, markH4Read, type H4ApprovalReceipt } from "./h4-mutations";
import { blankCopiedContentLanguage, fillBlankContentLanguage } from "./content-language-rules";
import { OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "./platform-experience-client";

type RaffleTranslations = Record<string, string | null>;
export interface RafflePrize { id: string; nameZh: string; nameEn: string; nameVi: string; rewardType: "UVT" | "USDT" | "DEVICE"; amount: number | string; quantity: number; productNo?: string | null; nameTranslations?: RaffleTranslations | null; }
export interface RaffleDraft { id: string; titleZh: string; titleEn: string; titleVi: string; startsAt: string; drawAt: string; prizes: RafflePrize[]; }
export interface AdminRaffle extends RaffleDraft { status: "DRAFT" | "OPEN" | "PROCESSING" | "DRAWN"; revision: number; totalEntries: number; titleTranslations?: RaffleTranslations | null; }
export const RAFFLE_LANGUAGES = { zh: { suffix: "Zh", label: "中文" }, en: { suffix: "En", label: "英文" }, vi: { suffix: "Vi", label: "越南语" } } as const;
export const RAFFLE_READBACK_ADVANCED = "本次保存已成功，当前配置已被后续修改。请核对最新配置。";
export function raffleDraftError(value: RaffleDraft, requiredLanguages: readonly OperatingLanguageCode[] = OPERATING_LANGUAGE_CODES): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) return "本期编号需为 1–64 位字母、数字、下划线或短横线。";
  const missingTitles = requiredLanguages.filter(locale => !value[`title${RAFFLE_LANGUAGES[locale].suffix}`].trim());
  if (missingTitles.length) return `请填写抽奖的${missingTitles.map(locale => RAFFLE_LANGUAGES[locale].label).join("、")}名称。`;
  if (!Number.isFinite(Date.parse(value.startsAt)) || !Number.isFinite(Date.parse(value.drawAt)) || Date.parse(value.drawAt) <= Date.parse(value.startsAt)) return "开奖时间必须晚于报名开始时间。";
  if (!value.prizes.length || value.prizes.length > 20 || new Set(value.prizes.map(prize => prize.id)).size !== value.prizes.length) return "请配置 1–20 个不重复的奖项。";
  for (const locale of ["zh", "vi"] as const) {
    if (requiredLanguages.includes(locale)) continue;
    const { suffix, label } = RAFFLE_LANGUAGES[locale];
    const filled = [value[`title${suffix}`], ...value.prizes.map(prize => prize[`name${suffix}`])].map(name => name.trim() !== "");
    if (filled.some(Boolean) && !filled.every(Boolean)) return `${label}只填写了一部分，请填齐抽奖名称和所有奖项名称，或全部留空。`;
  }
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
  const english = { title: draft.titleEn, names: draft.prizes.map(prize => prize.nameEn) };
  const zh = transform(requiredLanguages, "zh", english, { title: draft.titleZh, names: draft.prizes.map(prize => prize.nameZh) });
  const vi = transform(requiredLanguages, "vi", english, { title: draft.titleVi, names: draft.prizes.map(prize => prize.nameVi) });
  return {
    ...draft,
    titleZh: zh.title,
    titleVi: vi.title,
    prizes: draft.prizes.map((prize, index) => ({ ...prize, nameZh: zh.names[index], nameVi: vi.names[index] })),
  };
}
export function parseAdminRaffle(value: unknown): AdminRaffle {
  const row = value as AdminRaffle | null;
  if (!row || !["DRAFT", "OPEN", "PROCESSING", "DRAWN"].includes(row.status) || !Number.isSafeInteger(row.revision) || !Number.isSafeInteger(row.totalEntries) || row.totalEntries < 0 || !Array.isArray(row.prizes)) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  // Drafts may be incomplete; only structural values are required on read.
  if (![row.id, row.titleZh, row.titleEn, row.titleVi, row.startsAt, row.drawAt].every(value => typeof value === "string")) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  if (row.prizes.some(prize => !prize || ![prize.id, prize.nameZh, prize.nameEn, prize.nameVi].every(value => typeof value === "string")
    || !["UVT", "USDT", "DEVICE"].includes(prize.rewardType) || !Number.isSafeInteger(prize.quantity)
    || (typeof prize.amount !== "number" && typeof prize.amount !== "string") || (prize.productNo != null && typeof prize.productNo !== "string"))) {
    throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  }
  if ([row.titleTranslations, ...row.prizes.map(prize => prize?.nameTranslations)].some(map => map != null
    && (typeof map !== "object" || Array.isArray(map) || Object.values(map).some(value => value !== null && typeof value !== "string")))) {
    throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  }
  return row;
}
async function fetchAdminRaffle(id: string): Promise<AdminRaffle | null> {
  try {
    const row = parseAdminRaffle(await growthRequest<unknown>(`/genesis-raffle/${encodeURIComponent(id)}`));
    if (row.id !== id) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
    return row;
  } catch (cause) {
    const failure = cause as { status?: number; reasonCode?: string } | null;
    if (failure?.status === 404 && failure.reasonCode === "RAFFLE_NOT_FOUND") return null;
    throw cause;
  }
}

export async function fetchAdminRaffles(isCurrent: () => boolean) {
  markH4Read("raffles", false);
  const records = confirmedH4RaffleSaves();
  const receipts = records.flatMap(record => record.raffleReceipt ? [record.raffleReceipt] : []);
  const result = await growthRequest<{ draws: unknown[] }>("/genesis-raffle");
  if (!isCurrent()) return null;
  if (!Array.isArray(result?.draws)) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  const rowsFromList = result.draws.map(parseAdminRaffle);
  const details = new Map(await Promise.all(receipts.map(async ({ id }) => [id, await fetchAdminRaffle(id)] as const)));
  if (!isCurrent()) return null;
  const rows = rowsFromList
    .filter(row => details.get(row.id) !== null)
    .map(row => details.get(row.id) ?? row);
  confirmH4RaffleReadback(records, details);
  markH4Read("raffles", true);
  const missing = receipts.filter(({ id }) => details.get(id) === null).map(({ id }) => id);
  const advanced = receipts.some(({ id, revision }) => (details.get(id)?.revision ?? 0) > revision);
  const saved = receipts.some(({ id }) => details.get(id) != null);
  return { rows, missing, advanced, saved };
}
export async function saveAdminRaffle(draft: RaffleDraft, revision: number | null, enabled: boolean, reason: string, opening = revision !== null && enabled): Promise<AdminRaffle | H4ApprovalReceipt> {
  return h4CommandRequest(`/genesis-raffle${revision === null ? "" : `/${encodeURIComponent(draft.id)}`}`, {
    method: revision === null ? "POST" : "PATCH",
    body: JSON.stringify({ ...draft, ...(revision === null ? {} : { expectedRevision: revision, enabled }), reason }),
  }, `保存抽奖配置 · ${draft.titleZh}`, opening) as Promise<AdminRaffle | H4ApprovalReceipt>;
}
