import type { EditSpec, BusinessFormSpec, BusinessFormValue } from "../design-kit";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type {
  F1Leadership,
  F1VRankRow,
  F2Metric,
  F2PolicyParam,
  F2RateTier,
  F2UnilevelRate,
  F3BinaryConfig,
  F3DailyCap,
  F3Formula,
  F3Metric,
  F3Settlement,
  F4LeadershipPoolOverview,
  F5CommissionAuditOverview,
} from "@/lib/admin/f1-client";

/**
 * F 域子视图共享类型。
 * Mc:操作确认弹窗规格(op 区分 调参 param / 处置 dispose);由 shell(f-view.tsx)持有 state + 渲染 OperationConfirmModal。
 * 子视图通过 ctx.openActionConfirm(spec) 打开弹窗 —— 真写落点统一在 shell 的 onConfirm,保证后端 client 接线单一来源。
 * businessForm + run:复杂业务表单(如 V-Rank 奖励编辑)走 businessForm 渲染 + run 回调真写(对齐 H 域 voucher-config 范式)。
 */
export interface McSpec {
  name: string;
  amplify?: boolean;             // 放大资金流出 → OperationConfirmModal amplifies={true} → B1 覆盖率护栏
  op?: "param" | "dispose" | "param-multi";
  paramKey?: string;
  paramKeys?: { key: string; paramKey: string }[];  // param-multi:businessForm 字段 key → 后端配置 key 映射
  fixedVal?: string;             // 处置类固定写入值(approved/rejected/disqualified/frozen/unlocked …)
  status?: string;
  edit?: EditSpec;               // 调参类目标新值编辑规格
  businessForm?: BusinessFormSpec; // 复杂业务表单规格(渲染 BusinessFormBlock)
  run?: (reason: string, businessValue?: BusinessFormValue, newValue?: string) => void | Promise<void>; // 业务表单真写回调(传则优先于 param/dispose)
  detail?: string;
}
export type Mc = McSpec | null;

/** 子视图上下文:打开 操作确认 / 跨域跳转 / toast。全部由 shell 注入,子视图无自有 store。 */
export interface FViewCtx {
  openActionConfirm: (m: McSpec) => void;
  nav: (domain: string) => void;
  toast: (msg: string) => void;
  // ── V-Rank 等级奖励(F1)· 读 + CRUD(写经 run 回调,内部 logAudit)+ 代金券/SKU 下拉选项 ──
  vrankRows: F1VRankRow[];
  leadership: F1Leadership | null;
  f1Loading: boolean;
  f1Error: string | null;
  refreshF1: () => Promise<void>;
  updateVRankThreshold: (rank: string, field: string, value: string, reason: string) => Promise<void>;
  rewards: Record<string, OpsVRankRewardItem[]>;
  addReward: (level: string, item: OpsVRankRewardItem, reason: string) => Promise<void>;
  updateReward: (level: string, id: string, patch: Partial<OpsVRankRewardItem>, reason: string) => Promise<void>;
  removeReward: (level: string, id: string, reason: string) => Promise<void>;
  voucherOptions: string[];
  voucherLabels: Record<string, string>;
  skuOptions: string[];
  skuLabels: Record<string, string>;
  // -- 网络版税费率(F2)· 读 + 配置写入 --
  f2Metrics: F2Metric[];
  f2Unilevel: F2UnilevelRate[];
  f2RateTiers: F2RateTier[];
  f2Params: F2PolicyParam[];
  f2CommissionPolicy: Record<string, unknown>;
  f2Guardrails: string[];
  f2Loading: boolean;
  f2Error: string | null;
  refreshF2: () => Promise<void>;
  updateF2Config: (key: string, value: string, reason: string) => Promise<void>;
  // -- 双轨结算引擎(F3)· 读 + 配置写入 --
  f3Metrics: F3Metric[];
  f3Formula: F3Formula | null;
  f3Settlements: F3Settlement[];
  f3MaxTrackGmv: number;
  f3Config: F3BinaryConfig | null;
  f3DailyCap: F3DailyCap | null;
  f3ParticipantCount: number;
  f3BlockedCount: number;
  f3MonthlyMatchedUsd: number;
  f3AutoPlacement7dCount: number;
  f3DailyMatchUsd: number;
  f3Loading: boolean;
  f3Error: string | null;
  refreshF3: () => Promise<void>;
  updateF3Config: (key: string, value: string, reason: string) => Promise<void>;
  // -- 领导奖池/硬件配额/大使/榜单(F4)· 读 + 配置写入 --
  f4Overview: F4LeadershipPoolOverview | null;
  f4Loading: boolean;
  f4Error: string | null;
  refreshF4: () => Promise<void>;
  updateF4Config: (key: string, value: string, reason: string) => Promise<void>;
  // -- 佣金事件审计(F5)· 读 + 处置状态写入 --
  f5Overview: F5CommissionAuditOverview | null;
  f5Loading: boolean;
  f5Error: string | null;
  refreshF5: () => Promise<void>;
  updateF5Config: (key: string, value: string, reason: string) => Promise<void>;
}
