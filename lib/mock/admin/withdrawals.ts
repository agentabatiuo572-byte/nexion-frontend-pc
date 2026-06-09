/** D2 提现审核队列 mock 种子(确定性,静态时间标签避免 hydration)。 */
import type { AdminRole } from "@/lib/nav/console-nav";
import type { AuditEntry } from "@/app/components/kit/audit-timeline";

export type WithdrawalState = "pending" | "in_review" | "approved" | "delayed" | "frozen";

export type KycStatus = "已认证" | "待认证" | "复审中";

export interface WithdrawalRequest {
  id: string;
  user: { id: string; nickname: string };
  amountUsd: number;
  channel: string;
  state: WithdrawalState;
  submittedAt: string;
  waitedLabel: string;
  waitedMins: number;
  riskScore: number;
  kyc: KycStatus;
  address: string;
  maker?: { name: string; role: AdminRole; at: string };
  checker?: { name: string; role: AdminRole; at: string };
  audit: AuditEntry[];
}

const intake = (id: string, who: string, role: AdminRole, at: string, detail: string): AuditEntry => ({
  id: `${id}-a1`,
  actor: who,
  role,
  action: "提交复核",
  detail,
  at,
  ip: "10.12.x.x",
});

export const WITHDRAWALS_SEED: WithdrawalRequest[] = [
  {
    id: "WD-2606-0142", user: { id: "U-88421", nickname: "minerJoe" }, amountUsd: 4820, channel: "USDT-TRC20",
    state: "in_review", submittedAt: "06-02 14:08", waitedLabel: "2h 14m", waitedMins: 134, riskScore: 32, kyc: "已认证",
    address: "TQx…9fK2", maker: { name: "周岚", role: "finance", at: "14:12" },
    audit: [intake("WD-2606-0142", "周岚", "finance", "06-02 14:12", "金额 < 日限,KYC 已认证,常规复核")],
  },
  {
    id: "WD-2606-0143", user: { id: "U-90233", nickname: "stella_w" }, amountUsd: 18640, channel: "USDT-ERC20",
    state: "in_review", submittedAt: "06-02 13:51", waitedLabel: "2h 31m", waitedMins: 151, riskScore: 64, kyc: "已认证",
    address: "0x7a…C1e9", maker: { name: "陈默", role: "risk", at: "13:58" },
    audit: [intake("WD-2606-0143", "陈默", "risk", "06-02 13:58", "大额触发风控规则 R3,转人工复核")],
  },
  {
    id: "WD-2606-0144", user: { id: "U-77810", nickname: "cryptoLily" }, amountUsd: 320, channel: "USDT-TRC20",
    state: "pending", submittedAt: "06-02 15:40", waitedLabel: "42m", waitedMins: 42, riskScore: 18, kyc: "已认证",
    address: "TBn…2xQ7", audit: [],
  },
  {
    id: "WD-2606-0145", user: { id: "U-66120", nickname: "newbie_8821" }, amountUsd: 9600, channel: "银行卡",
    state: "in_review", submittedAt: "06-02 12:20", waitedLabel: "4h 02m", waitedMins: 242, riskScore: 88, kyc: "复审中",
    address: "****6677", maker: { name: "陈默", role: "risk", at: "12:35" },
    audit: [intake("WD-2606-0145", "陈默", "risk", "06-02 12:35", "新账户 7 天内首提 + 大额,风险分 88,建议延迟")],
  },
  {
    id: "WD-2606-0146", user: { id: "U-51002", nickname: "hodler_max" }, amountUsd: 1240, channel: "USDT-TRC20",
    state: "approved", submittedAt: "06-02 11:05", waitedLabel: "—", waitedMins: 0, riskScore: 24, kyc: "已认证",
    address: "TLs…8kP1", maker: { name: "周岚", role: "finance", at: "11:10" }, checker: { name: "陈默", role: "risk", at: "11:24" },
    audit: [
      intake("WD-2606-0146", "周岚", "finance", "06-02 11:10", "常规复核"),
      { id: "WD-2606-0146-a2", actor: "陈默", role: "risk", action: "复核通过", detail: "风险分 24,放行", at: "06-02 11:24", ip: "10.12.x.x" },
    ],
  },
  {
    id: "WD-2606-0147", user: { id: "U-43391", nickname: "quietRiver" }, amountUsd: 26800, channel: "USDT-ERC20",
    state: "delayed", submittedAt: "06-02 10:12", waitedLabel: "5h 10m", waitedMins: 310, riskScore: 71, kyc: "已认证",
    address: "0x3d…A09f", maker: { name: "周岚", role: "finance", at: "10:20" },
    audit: [
      intake("WD-2606-0147", "周岚", "finance", "06-02 10:20", "大额复核"),
      { id: "WD-2606-0147-a2", actor: "陈默", role: "risk", action: "延迟放行", detail: "等待 48h 资金到位窗口", at: "06-02 10:48", ip: "10.12.x.x" },
    ],
  },
  {
    id: "WD-2606-0148", user: { id: "U-39922", nickname: "fastCash99" }, amountUsd: 47200, channel: "USDT-TRC20",
    state: "frozen", submittedAt: "06-02 09:30", waitedLabel: "—", waitedMins: 0, riskScore: 94, kyc: "复审中",
    address: "TZc…7yH4", maker: { name: "陈默", role: "risk", at: "09:36" },
    audit: [
      intake("WD-2606-0148", "陈默", "risk", "06-02 09:36", "命中多账户关联 + 套现模式"),
      { id: "WD-2606-0148-a2", actor: "陈默", role: "risk", action: "冻结审查", detail: "K1 反多账户命中,转合规核查", at: "06-02 09:40", ip: "10.12.x.x" },
    ],
  },
  {
    id: "WD-2606-0149", user: { id: "U-28457", nickname: "moonbase" }, amountUsd: 760, channel: "USDT-TRC20",
    state: "in_review", submittedAt: "06-02 15:02", waitedLabel: "1h 20m", waitedMins: 80, riskScore: 29, kyc: "已认证",
    address: "TKm…4dR8", maker: { name: "李薇", role: "finance", at: "15:08" },
    audit: [intake("WD-2606-0149", "李薇", "finance", "06-02 15:08", "常规复核")],
  },
  {
    id: "WD-2606-0150", user: { id: "U-11203", nickname: "earlybird" }, amountUsd: 13400, channel: "银行卡",
    state: "in_review", submittedAt: "06-02 14:45", waitedLabel: "1h 37m", waitedMins: 97, riskScore: 55, kyc: "待认证",
    address: "****1142", maker: { name: "周岚", role: "finance", at: "14:50" },
    audit: [intake("WD-2606-0150", "周岚", "finance", "06-02 14:50", "KYC 待认证,需补充材料后放行")],
  },
  {
    id: "WD-2606-0151", user: { id: "U-90871", nickname: "zenTrader" }, amountUsd: 2100, channel: "USDT-ERC20",
    state: "pending", submittedAt: "06-02 15:55", waitedLabel: "27m", waitedMins: 27, riskScore: 41, kyc: "已认证",
    address: "0x9f…Bb20", audit: [],
  },
  {
    id: "WD-2606-0152", user: { id: "U-62214", nickname: "silentNode" }, amountUsd: 6300, channel: "USDT-TRC20",
    state: "in_review", submittedAt: "06-02 13:18", waitedLabel: "3h 04m", waitedMins: 184, riskScore: 47, kyc: "已认证",
    address: "TPe…1nW6", maker: { name: "李薇", role: "finance", at: "13:25" },
    audit: [intake("WD-2606-0152", "李薇", "finance", "06-02 13:25", "常规复核")],
  },
  {
    id: "WD-2606-0153", user: { id: "U-50098", nickname: "vault_keeper" }, amountUsd: 33500, channel: "USDT-ERC20",
    state: "in_review", submittedAt: "06-02 12:50", waitedLabel: "3h 32m", waitedMins: 212, riskScore: 76, kyc: "已认证",
    address: "0x1c…Ef47", maker: { name: "陈默", role: "risk", at: "12:58" },
    audit: [intake("WD-2606-0153", "陈默", "risk", "06-02 12:58", "大额 + 风险分 76,优先复核兑付覆盖率")],
  },
];
