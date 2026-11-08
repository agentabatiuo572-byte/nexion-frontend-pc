import type { ReactNode } from "react";
import type { K4PaginationQuery, KRiskActions, KRiskData, KRiskOverviewQuery, MultiAccountOverview, ScoringOverview } from "@/lib/admin/k-client";
import type { BusinessFormSpec, BusinessFormValue, CoverageSnapshot, EditSpec, OperationApproval, OperatorBriefKind } from "../design-kit";
import type { ToastKind } from "@/lib/store/ui";

export type ActionConfirmReq = {
  action: ReactNode;
  /** 框上写的短标题，只写动作和对象；action 照旧是记进操作记录的名字（VS-101）。 */
  title?: ReactNode;
  detail: ReactNode;
  content?: ReactNode;
  /** 放大资金流出方向才挂(B1 覆盖率预检):解除误判 / 复审通过解冻 / 调阈值放宽 / 停用规则;冻结 / 驳回 / 确认违规不挂。 */
  amplifies?: boolean;
  coverage?: CoverageSnapshot;
  /** 按该操作的真实路径说明覆盖率检查时机。 */
  coverageCheck?: string;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  /** 与服务端理由长度约束保持一致；未指定时沿用共享弹窗的领域默认值。 */
  reasonMin?: number;
  reasonMax?: number;
  /** 未确认的原操作理由；提交后重新查询，终态返回 undefined 解除锁定。 */
  getPendingReason?: () => string | undefined;
  getPendingBusinessValue?: () => BusinessFormValue | undefined;
  completionCopy?: string;
  approval?: OperationApproval;
  /** 生效标签，只在 RdPage 里显示。 */
  effect?: ReactNode;
  /** 确认按钮写动作，比如「确认放行」，默认「确认提交」。 */
  confirmLabel?: string;
  /** 这次不能再提交的原因：写在框里，确认按钮禁用。比如提交时发现单据已被别人处理。 */
  blockedReason?: ReactNode;
  /** 换了这个值，框按新内容重开，已填的理由清空（OP-97）。 */
  formKey?: number;
  /** 这个操作自己声明的影响和提交前检查，传了就不按文字猜摘要（OP-51）。影响随业务字段变时传函数，参数是现在填的值。 */
  statedBrief?: { impact: string; check: string } | ((value: BusinessFormValue) => { impact: string; check: string });
  /** 做决定要核对的事实，常显在业务字段上面，比如收款网络和完整地址。改一个值的框可以传函数，随输入变（参数是填好的新值，没填好是 undefined）。 */
  facts?: ReactNode | ((value?: string) => ReactNode);
  /** 不能撤销的操作传 danger，确认按钮用危险色。 */
  confirmTone?: "primary" | "danger";
  /** 放大方向提示的开头，默认「这项操作会让平台多付钱」。 */
  coverageLead?: ReactNode;
  /** 理由框的占位，按场景写（TX-11）。 */
  reasonPlaceholder?: string;
  /** 紧急关停不能被规则服务挡住：理由规则读不到时按 reasonMin 继续（Q-06）。 */
  reasonPolicyOptional?: boolean;
  /** 这项操作实际是什么；每个调用都必须声明，不按文字猜摘要。 */
  briefKind: OperatorBriefKind;
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
  briefKind: OperatorBriefKind;
  action: ReactNode;
  /** 框上写的短标题，不传就用 action（VS-101）。 */
  title?: ReactNode;
  detail: ReactNode;
  content?: ReactNode;
  chips?: ConfirmChip[];
  /** 这个操作自己声明的影响和提交前检查，传了就不按文字猜摘要（OP-51）。 */
  statedBrief?: { impact: string; check: string };
  /** 理由框的占位，按场景写（TX-11）；不传时用风控排查的那句。 */
  reasonPlaceholder?: string;
  /** 生效标签，只在 RdPage 里显示。 */
  effect?: ReactNode;
  /** true = 原因必填(标记类 / 白名单 / 手动补触发)。 */
  reason?: boolean;
  /** 可选输入框:传 options 时渲染 chips 勾选(枚举值不让手输,能勾选的不要手输铁律);不传则文本框(开放值如白名单网段 / 补触发 userId / 覆盖分)。 */
  input?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    options?: string[];
    optionLabels?: Record<string, string>;
    kind?: "text" | "number";
    min?: number;
    max?: number;
    step?: number;
    /** 输入不对时的原因：失焦或点过确认后用橙黄写在输入框下，确认按钮禁用（PCN-37）。不传时只查非空。 */
    validate?: (value: string) => string | undefined;
  };
  /** 备注框旁的说明，替换「选填，最多 200 字」。内容不写入命令时写「选填，不会保存」（EX-18）。 */
  remarkHint?: string;
  /** 调用方已展示错误时，共享确认不重复提示。 */
  errorHandled?: boolean | ((error: unknown) => boolean);
  okLabel?: string;
  /** 不能撤销的操作传 danger：确认按钮用危险色，标题用警告图标（VS-25）。 */
  confirmTone?: "primary" | "danger";
  run: (reason: string, value?: string) => unknown | Promise<unknown>;
};

export type KCtx = {
  pget: (k: string) => string | undefined;
  params: Record<string, unknown>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  toast: (s: string, kind?: ToastKind) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  openConfirm: (req: ConfirmReq) => void;
  risk: KRiskData;
  actions: KRiskActions;
  contentLoading: boolean;
  contentError: string | null;
  reloadKRisk: (query?: KRiskOverviewQuery) => Promise<MultiAccountOverview | void>;
  refreshK4Scoring: (query?: K4PaginationQuery) => Promise<ScoringOverview | void>;
};
