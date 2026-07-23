import type { ReactNode } from "react";
import type { K4PaginationQuery, KRiskActions, KRiskData, KRiskOverviewQuery, MultiAccountOverview, ScoringOverview } from "@/lib/admin/k-client";
import type { BusinessFormSpec, BusinessFormValue, CoverageSnapshot, EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  /** 放大资金流出方向才挂(B1 覆盖率预检):解除误判 / 复审通过解冻 / 调阈值放宽 / 停用规则;冻结 / 驳回 / 确认违规不挂。 */
  amplifies?: boolean;
  coverage?: CoverageSnapshot;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  /** 与服务端理由长度约束保持一致；未指定时沿用共享弹窗的领域默认值。 */
  reasonMin?: number;
  reasonMax?: number;
  completionCopy?: string;
  onBusinessSelectionChange?: (next: BusinessFormValue) => Promise<BusinessFormSpec | undefined>;
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => unknown | Promise<unknown>;
};

export type ConfirmChip = [text: string, tone: "done" | "ready"];

export type ConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  chips?: ConfirmChip[];
  /** true = 原因必填(标记类 / 白名单 / 手动补触发)。 */
  reason?: boolean;
  /** 可选输入框:传 options 时渲染 chips 勾选(枚举值不让手输,能勾选的不要手输铁律);不传则文本框(开放值如白名单网段 / 补触发 userId / 覆盖分)。 */
  input?: {
    label: string;
    placeholder?: string;
    options?: string[];
    kind?: "text" | "number";
    min?: number;
    max?: number;
    step?: number;
  };
  okLabel?: string;
  run: (reason: string, value?: string) => unknown | Promise<unknown>;
};

export type KCtx = {
  pget: (k: string) => string | undefined;
  params: Record<string, unknown>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  toast: (s: string) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  openConfirm: (req: ConfirmReq) => void;
  risk: KRiskData;
  actions: KRiskActions;
  contentLoading: boolean;
  contentError: string | null;
  reloadKRisk: (query?: KRiskOverviewQuery) => Promise<MultiAccountOverview | void>;
  refreshK4Scoring: (query?: K4PaginationQuery) => Promise<ScoringOverview | void>;
};
