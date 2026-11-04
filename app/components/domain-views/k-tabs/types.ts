import type { ReactNode } from "react";
import type { K4PaginationQuery, KRiskActions, KRiskData, KRiskOverviewQuery, MultiAccountOverview, ScoringOverview } from "@/lib/admin/k-client";
import type { BusinessFormSpec, BusinessFormValue, CoverageSnapshot, EditSpec, OperatorBriefKind } from "../design-kit";

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
  /** 生效标签，只在 RdPage 里显示。 */
  effect?: ReactNode;
  /** 确认按钮写动作，比如「确认放行」，默认「确认提交」。 */
  confirmLabel?: string;
  /** 这次不能再提交的原因：写在框里，确认按钮禁用。比如提交时发现单据已被别人处理。 */
  blockedReason?: ReactNode;
  /** 这个操作自己声明的影响和提交前检查，传了就不按文字猜摘要（OP-51）。 */
  statedBrief?: { impact: string; check: string };
  /** 做决定要核对的事实，常显在业务字段上面，比如收款网络和完整地址。 */
  facts?: ReactNode;
  /** 不能撤销的操作传 danger，确认按钮用危险色。 */
  confirmTone?: "primary" | "danger";
  /** 放大方向提示的开头，默认「这项操作会让平台多付钱」。 */
  coverageLead?: ReactNode;
  /** 这项操作实际是什么；传了就不再按文字猜摘要。客服中心（M）的调用必须传。 */
  briefKind?: OperatorBriefKind;
  /**
   * 审计落点口径(缺省 "a2" = 既有文案不变)。"local-history" 供本地假数据面(如 D7)使用:
   * 弹窗上「写入 A2 审计」「后端实时校验覆盖率」类承诺会替换成如实的本地口径,不许假承诺。
   */
  auditSink?: "a2" | "local-history";
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
