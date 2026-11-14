import { growthRequest } from "./h-client";
import { h4CommandRequest, markH4Read, type H4ApprovalReceipt } from "./h4-mutations";

export interface RafflePrize { id: string; nameZh: string; nameEn: string; nameVi: string; rewardType: "UVT" | "USDT" | "DEVICE"; amount: number | string; quantity: number; productNo?: string; }
export interface RaffleDraft { id: string; titleZh: string; titleEn: string; titleVi: string; startsAt: string; drawAt: string; prizes: RafflePrize[]; }
export interface AdminRaffle extends RaffleDraft { status: "DRAFT" | "OPEN" | "PROCESSING" | "DRAWN"; revision: number; totalEntries: number; }
export function raffleDraftError(value: RaffleDraft): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) return "本期编号需为 1–64 位字母、数字、下划线或短横线。";
  if (![value.titleZh, value.titleEn, value.titleVi].every(text => text.trim())) return "请填写三种语言的抽奖名称。";
  if (!Number.isFinite(Date.parse(value.startsAt)) || !Number.isFinite(Date.parse(value.drawAt)) || Date.parse(value.drawAt) <= Date.parse(value.startsAt)) return "开奖时间必须晚于报名开始时间。";
  if (!value.prizes.length || value.prizes.length > 20 || new Set(value.prizes.map(prize => prize.id)).size !== value.prizes.length) return "请配置 1–20 个不重复的奖项。";
  for (const prize of value.prizes) {
    if (![prize.nameZh, prize.nameEn, prize.nameVi].every(text => text.trim())) return "请填写每个奖项的三语名称。";
    if (!Number.isSafeInteger(prize.quantity) || prize.quantity < 1) return "每个奖项名额必须为正整数。";
    if (!["UVT", "USDT", "DEVICE"].includes(prize.rewardType) || !Number.isFinite(Number(prize.amount)) || Number(prize.amount) <= 0) return "请填写有效的奖励金额。";
    if (prize.rewardType === "DEVICE" && (!prize.productNo?.trim() || Number(prize.amount) !== 1)) return "设备奖需选择商品，每个中奖名额发放一台设备。";
  }
  return value.prizes.reduce((sum, prize) => sum + prize.quantity, 0) > 100 ? "本期总中奖名额不能超过 100。" : "";
}
export function parseAdminRaffle(value: unknown): AdminRaffle {
  const row = value as AdminRaffle | null;
  if (!row || !["DRAFT", "OPEN", "PROCESSING", "DRAWN"].includes(row.status) || !Number.isSafeInteger(row.revision) || !Number.isSafeInteger(row.totalEntries) || row.totalEntries < 0 || !Array.isArray(row.prizes)) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  // Drafts may be incomplete; only structural values are required on read.
  if (![row.id, row.titleZh, row.titleEn, row.titleVi, row.startsAt, row.drawAt].every(value => typeof value === "string")) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  return row;
}
export async function fetchAdminRaffles(): Promise<AdminRaffle[]> {
  markH4Read("raffles", false);
  const result = await growthRequest<{ draws: unknown[] }>("/genesis-raffle");
  if (!Array.isArray(result?.draws)) throw new Error("创世抽奖配置读取失败，请刷新后重试。");
  const rows = result.draws.map(parseAdminRaffle);
  markH4Read("raffles", true);
  return rows;
}
export async function saveAdminRaffle(draft: RaffleDraft, revision: number | null, enabled: boolean, reason: string, opening = revision !== null && enabled): Promise<AdminRaffle | H4ApprovalReceipt> {
  return h4CommandRequest(`/genesis-raffle${revision === null ? "" : `/${encodeURIComponent(draft.id)}`}`, {
    method: revision === null ? "POST" : "PATCH",
    body: JSON.stringify({ ...draft, ...(revision === null ? {} : { expectedRevision: revision, enabled }), reason }),
  }, `保存抽奖配置 · ${draft.titleZh}`, opening) as Promise<AdminRaffle | H4ApprovalReceipt>;
}
