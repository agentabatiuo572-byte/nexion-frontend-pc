export type PreparationKind = "COLLECTION" | "SUPPLIER_PAYMENT";
export type PreparationConfig = {
  platformAddress: string; counterpartyAddress: string; network: "BSC"; asset: "USDT";
  projectId: string; executionEnabled: false; mode: "PREPARATION_ONLY";
  sources: Array<{ address: string; userId: string }>;
};
export const isEvmAddress = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
export function preparationConfig(value: unknown): PreparationConfig {
  const row = value as PreparationConfig | null;
  if (!row || row.network !== "BSC" || row.asset !== "USDT" || row.executionEnabled !== false
      || row.mode !== "PREPARATION_ONLY" || typeof row.projectId !== "string" || !/^[1-9][0-9]*$/.test(row.projectId)
      || !isEvmAddress(row.platformAddress) || !isEvmAddress(row.counterpartyAddress)
      || !Array.isArray(row.sources) || row.sources.some(source => !source || !isEvmAddress(source.address)
        || typeof source.userId !== "string" || !/^[1-9][0-9]*$/.test(source.userId))) throw new Error("资金准备配置读取失败，请刷新核对");
  return row;
}
export function preparationAmount(value: string): string {
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(value) || !/[1-9]/.test(value))
    throw new Error("金额须大于零，最多十二位整数和六位小数");
  return value;
}
export const PREPARATION_STATE: Record<string,string> = { DRAFT: "待复核 · 未转账", REVIEWED: "准备已复核 · 未转账", CANCELLED: "准备已取消" };
export const PREPARATION_BLOCKER: Record<string,string> = {
  PROVIDER_NOT_CONFIGURED: "供应商连接尚未就绪", PROJECT_ASSET_UNAVAILABLE: "项目暂不支持该币种操作",
  SOURCE_OWNERSHIP_UNVERIFIED: "无法确认来源地址归属", PROVIDER_READ_UNAVAILABLE: "暂时无法读取供应商状态",
  USDT_BALANCE_INSUFFICIENT: "来源 USDT 余额不足", BNB_BALANCE_ZERO: "来源 BNB 余额为零，须核对手续费安排",
  CHAIN_BALANCE_UNAVAILABLE: "暂时无法核实链上余额", EXISTING_PAYOUT_NOT_READY: "当前出款资格、风险或对账条件未满足",
  RISK_STATUS_UNAVAILABLE: "暂时无法核实资金风险状态",
};
