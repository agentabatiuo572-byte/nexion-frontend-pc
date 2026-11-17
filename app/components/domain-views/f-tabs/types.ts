import type { F3ConfirmationSnapshot } from "@/lib/admin/f3-approval";
import type { F4ConfirmationSnapshot } from "@/lib/admin/f4-approval";
import type { F4VoteProjectionRead } from "@/lib/admin/f4-vote-projection";
import type { F5ConfirmationSnapshot } from "@/lib/admin/f5-approval";
import type { FDirectAttempt } from "@/lib/admin/f1-stable-write";
import type { FDomainAttempt, F2Recovery } from "@/lib/admin/f2-approval";
import type { F2UnilevelBootstrapLayer } from "@/lib/admin/f2-unilevel-bootstrap";
import type { ReactNode } from "react";
import type { OperatorBriefKind, EditSpec, BusinessFormSpec, BusinessFormValue, InlineOperationApproval } from "../design-kit";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { DirectReferralPolicy, DirectReferralUpdate } from "@/lib/admin/direct-referral-policy";
import type { A2OperationRow } from "@/lib/admin/a2-client";
import type { VRankBootstrapRow } from "@/lib/admin/vrank-bootstrap";
import type { TeamFundApprovalValues } from "@/lib/admin/withdrawal-config-approval";
import type { AdminSession } from "@/lib/store/admin-auth";
import type {
  F1Leadership,
  F1PayoutFilters,
  F1PromotionFilters,
  F1PromotionRecord,
  F1RewardPayout,
  F1VRankRow,
  F1VRankOverview,
  F2Metric,
  F2PayoutStatistic,
  F2PolicyParam,
  F2RateTier,
  F2UnilevelRate,
  F3BinaryConfig,
  F3DailyCap,
  F3Formula,
  F3Metric,
  F3RawAmounts,
  F3Statistics,
  F3Settlement,
  F4LeadershipPoolOverview,
  F4AmbassadorPolicy,
  F4AmbassadorPolicyUpdate,
  F5CommissionAuditOverview,
  F5CommissionQuery,
} from "@/lib/admin/f1-client";

/**
 * F 域子视图共享类型。
 * Mc:操作确认弹窗规格(op 区分 调参 param / 处置 dispose);由 shell(f-view.tsx)持有 state + 渲染 OperationConfirmModal。
 * 子视图通过 ctx.openActionConfirm(spec) 打开弹窗 —— 真写落点统一在 shell 的 onConfirm,保证后端 client 接线单一来源。
 * businessForm + run:复杂业务表单(如 V-Rank 奖励编辑)走 businessForm 渲染 + run 回调真写(对齐 H 域 voucher-config 范式)。
 */
export interface McSpec {
  briefKind: OperatorBriefKind | ((value: BusinessFormValue) => OperatorBriefKind);
  name: string;
  commandKey?: string;
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
  completionCopy?: string;       // 明确保存后的生效时点，避免统一“立即生效”文案误导周期性配置
  expectedVersion?: number;
  expectedMaterialRevision?: number;
  teamApproval?: Pick<InlineOperationApproval, "resolve" | "renderForm"> & { source: keyof TeamFundApprovalValues };
  f3Snapshot?: F3ConfirmationSnapshot;
  f4Snapshot?: F4ConfirmationSnapshot;
  f4Recovery?: { kind: "proposal"; original: FDomainAttempt } | { kind: "policy"; original: FDirectAttempt };
  /** 以下只管确认框怎么显示，原样交给 OperationConfirmModal 的同名参数；不传时和原来一样。 */
  title?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  statedBrief?: { impact: string; check: string };
  effect?: ReactNode;
  confirmLabel?: string;
  confirmTone?: "primary" | "danger";
  coverageLead?: ReactNode;
  coverageCheck?: string;
}
export type Mc = (McSpec & { teamApprovalOwner?: AdminSession["adminId"]; f4Owner?: AdminSession["adminId"] }) | null;

/** 子视图上下文:打开 操作确认 / 跨域跳转 / toast。全部由 shell 注入,子视图无自有 store。 */
export interface FViewCtx {
  openActionConfirm: (m: McSpec) => void;
  nav: (domain: string) => void;
  toast: (msg: string) => void;
  /** UI convenience only; backend authorization remains the final boundary. */
  can: (authority: string) => boolean;
  canSubmitTeamApproval: (source: keyof TeamFundApprovalValues) => boolean;
  submitTeamApproval: <S extends keyof TeamFundApprovalValues>(source: S, values: TeamFundApprovalValues[S], reason: string) => Promise<boolean>;
  // ── V-Rank 等级奖励(F1)· 读 + CRUD(写经 run 回调,内部 logAudit)+ 代金券/SKU 下拉选项 ──
  vrankRows: F1VRankRow[];
  leadership: F1Leadership | null;
  f1Loading: boolean;
  f1Error: string | null;
  f1ReadEpoch: number;
  f1ProposalEpoch: number;
  f1ApprovalRanks: string[];
  f1Proposals: FDomainAttempt[];
  recoverF1: (slot: string, mode: "query" | "retry" | "release") => Promise<boolean>;
  refreshF1Approvals: () => Promise<void>;
  invalidateF1: (message?: string) => void;
  refreshF1: () => Promise<void>;
  f1RewardValuation: string | null;
  f1Coverage: F1VRankOverview["coverage"];
  acceptF1PolicyOverview: (overview: F1VRankOverview) => void;
  updateVRankThreshold: (rank: string, field: string, value: string, reason: string) => Promise<void>;
  updateF1Config: (key: string, value: string, reason: string) => Promise<void>;
  rewards: Record<string, OpsVRankRewardItem[]>;
  addReward: (level: string, item: OpsVRankRewardItem, reason: string) => Promise<void>;
  updateReward: (level: string, id: string, patch: Partial<OpsVRankRewardItem>, reason: string) => Promise<void>;
  removeReward: (level: string, id: string, reason: string) => Promise<void>;
  voucherOptions: string[];
  voucherLabels: Record<string, string>;
  skuOptions: string[];
  skuLabels: Record<string, string>;
  // F1 展示文案类配置(头衔/奖品名)· 读后端 configValues map + 写经 updateF1Config(单 key PATCH)。
  f1ConfigValues: Record<string, string>;
  promotionRecords: F1PromotionRecord[];
  promotionTotal: number;
  monthlyPromotionCount: number | null;
  promotionNextCursor: string;
  payoutRecords: F1RewardPayout[];
  payoutTotal: number;
  payoutNextCursor: string;
  f1PromotionLoading: boolean;
  f1PromotionError: string | null;
  f1PayoutLoading: boolean;
  f1PayoutError: string | null;
  queryPromotions: (filters?: F1PromotionFilters, append?: boolean) => Promise<void>;
  queryPayouts: (filters?: F1PayoutFilters, append?: boolean) => Promise<void>;
  proposeVRankOverride: (userId: string, targetV: string, direction: "promote" | "rollback", reason: string) => Promise<void>;
  proposeVRankBootstrap: (ranks: VRankBootstrapRow[], reason: string) => Promise<void>;
  proposePayoutAction: (payoutId: string, action: "reissue" | "reverse", reason: string) => Promise<void>;
  // -- 网络版税费率(F2)· 读 + 配置写入 --
  f2Metrics: F2Metric[];
  f2PayoutStatistics?: F2PayoutStatistic[];
  f2DirectPolicy: DirectReferralPolicy | null;
  f2SevenLayerRevision: number | null;
  f2DirectPolicyLoading: boolean;
  f2DirectPolicyError: string | null;
  updateF2DirectPolicy: (policy: DirectReferralUpdate, reason: string) => Promise<void>;
  f2ActivationPending: A2OperationRow | null;
  /** 首次配置的待审批单（自己的或队列里别人的），F2 首次配置区域显示谁提的、什么时候、七层各是多少。 */
  f2BootstrapPending: A2OperationRow | null;
  f2ActivationPendingLoading: boolean;
  f2ActivationPendingError: string | null;
  f2ActivationAttempt: F2Recovery | null;
  f2Proposals: F2Recovery[];
  f2ReadEpoch: number;
  f2PendingFor: (key: string) => string | null;
  f2WriteBlocked: (slot: string) => string | undefined;
  f2ProposalRecord: (slot: string) => F2Recovery | undefined;
  retryF2Proposal: (slot: string) => Promise<void>;
  queryF2Proposal: (slot: string) => Promise<A2OperationRow | null>;
  releaseF2Proposal: (slot: string) => Promise<void>;
  recoverF2SevenLayerActivation: () => Promise<void>;
  changeF2SevenLayerActivation: (action: "ACTIVATE" | "PAUSE" | "RESUME", expectedSevenLayerRevision: number, expectedPolicyVersion: number, reason: string) => Promise<void>;
  bootstrapF2Unilevel: (layers: F2UnilevelBootstrapLayer[], reason: string) => Promise<void>;
  f2Unilevel: F2UnilevelRate[];
  f2RateTiers: F2RateTier[];
  f2Params: F2PolicyParam[];
  f2CommissionPolicy: Record<string, unknown>;
  f2Guardrails: string[];
  // F2 参数类配置(如 unilevel 层级深度)· 读后端 configValues map + 写经 updateF2Config(单 key PATCH)。
  f2ConfigValues: Record<string, string>;
  f2Loading: boolean;
  f2Error: string | null;
  refreshF2: () => Promise<DirectReferralPolicy | null>;
  updateF2Config: (key: string, value: string, reason: string) => Promise<void>;
  updateFConfigBatch: (sourceDomain: "F2" | "F3" | "F4", changes: Array<{ key: string; value: string }>, reason: string, snapshot?: F3ConfirmationSnapshot) => Promise<void>;
  // -- 双轨结算引擎(F3)· 读 + 配置写入 --
  f3Proposals: FDomainAttempt[];
  f3ApprovalRows: A2OperationRow[];
  f3ReadEpoch: number;
  recoverF3: (original: FDomainAttempt, mode?: "query" | "retry" | "release") => Promise<A2OperationRow | null>;
  f3Metrics: F3Metric[];
  f3Amounts?: F3RawAmounts;
  f3Statistics?: F3Statistics;
  f3Formula: F3Formula | null;
  f3Settlements: F3Settlement[];
  f3MaxTrackGmv: number;
  f3Config: F3BinaryConfig | null;
  // F3 参数类配置(如双轨暂停开关)· 读后端 configValues map + 写经 updateF3Config。
  f3ConfigValues: Record<string, string>;
  f3DailyCap: F3DailyCap | null;
  /** 兑付覆盖率快照，F3 自己开的确认框用来做放大方向的前端拦截（和外壳确认框同一个数）。 */
  f3Coverage?: { coverageRatio: number; redlinePct: number };
  f3ParticipantCount: number;
  f3BlockedCount: number;
  f3MonthlyMatchedUsd: number;
  f3AutoPlacement7dCount: number;
  f3DailyMatchUsd: number;
  f3Loading: boolean;
  f3Error: string | null;
  refreshF3: () => Promise<void>;
  updateF3Config: (key: string, value: string, reason: string, amplifies?: boolean, snapshot?: F3ConfirmationSnapshot) => Promise<void>;
  // -- 领导奖池/硬件配额/大使/榜单(F4)· 读 + 配置写入 --
  f4Overview: F4LeadershipPoolOverview | null;
  f4VoteProjection: F4VoteProjectionRead;
  f4AmbassadorPolicy: F4AmbassadorPolicy | null;
  refreshF4PolicyBaseline: () => Promise<F4AmbassadorPolicy>;
  f4Loading: boolean;
  f4Error: string | null;
  f4Proposals: FDomainAttempt[];
  /** 恢复区每一行最近一次查询原结果查到了什么，按原请求编号。 */
  f4QueryNotes: Record<string, { tone: "warn" | "danger"; text: string }>;
  f4PolicyWrites: FDirectAttempt[];
  f4ApprovalRows: A2OperationRow[];
  recoverF4: (record: NonNullable<McSpec["f4Recovery"]>, mode: "query" | "retry" | "release") => Promise<boolean>;
  refreshF4: () => Promise<void>;
  updateF4Config: (key: string, value: string, reason: string, expectedVersion?: number, expectedMaterialRevision?: number) => Promise<void>;
  updateF4AmbassadorPolicy: (policy: F4AmbassadorPolicyUpdate, reason: string) => Promise<boolean>;
  proposeF4Settlement: (reason: string) => Promise<void>;
  proposeF4LeaderboardPayout: (period: "today" | "week" | "month" | "allTime", reason: string) => Promise<void>;
  // -- 佣金事件审计(F5)· 读 + 处置状态写入 --
  f5Overview: F5CommissionAuditOverview | null;
  f5NextQuery: F5CommissionQuery | null;
  f5Loading: boolean;
  f5Error: string | null;
  f5Proposals: FDomainAttempt[];
  f5AnomalyWrites: FDirectAttempt[];
  f5ApprovalRows: A2OperationRow[];
  f5ApprovalReadError: string | null;
  f5ReadEpoch: number;
  prepareF5Confirmation: (snapshot: F5ConfirmationSnapshot | undefined) => void;
  getF5Operation: (snapshot: F5ConfirmationSnapshot) => F5Recovery | undefined;
  recoverF5: (record: F5Recovery, mode: "query" | "retry" | "release") => Promise<boolean>;
  refreshF5: (query?: F5CommissionQuery) => Promise<void>;
  exportF5Commissions: (
    query: F5CommissionQuery,
    reason: string,
  ) => Promise<{ rowCount: number; filename: string; sha256: string }>;
  updateF5Config: (key: string, value: string, reason: string, expectedVersion: number) => Promise<void>;
  reverseF5Commission: (commissionId: string, refundRef: string, reason: string) => Promise<void>;
  reissueF5Commissions: (commissionIds: string[], reason: string) => Promise<void>;
  suspendF5UserCommissions: (
    userId: number,
    kinds: string[],
    suspended: boolean,
    reason: string,
  ) => Promise<void>;
  updateF5AnomalyConfig: (
    commissionAnomalySigma: number,
    layerRatioAnomalyPct: number,
    reason: string,
  ) => Promise<void>;
}

export type F5Recovery = { kind: "proposal"; original: FDomainAttempt } | { kind: "anomaly"; original: FDirectAttempt };
