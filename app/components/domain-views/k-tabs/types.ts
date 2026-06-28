import type { ReactNode } from "react";
import type { KRiskActions, KRiskData, KRiskOverviewQuery } from "@/lib/admin/k-client";
import type { BusinessFormSpec, BusinessFormValue, CoverageSnapshot, EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  /** 放大资金流出方向才挂(B1 覆盖率预检):解除误判 / 复审通过解冻 / 调阈值放宽 / 停用规则;冻结 / 驳回 / 确认违规不挂。 */
  amplifies?: boolean;
  coverage?: CoverageSnapshot;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void;
};

export type ConfirmChip = [text: string, tone: "done" | "ready"];

export type ConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  chips?: ConfirmChip[];
  /** true = 原因必填(标记类 / 白名单 / 手动补触发)。 */
  reason?: boolean;
  /** 可选输入框:传 options 时渲染 chips 勾选(枚举值不让手输,能勾选的不要手输铁律);不传则文本框(开放值如白名单网段 / 补触发 userId / 覆盖分)。 */
  input?: { label: string; placeholder?: string; options?: string[] };
  okLabel?: string;
  run: (reason: string, value?: string) => void;
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
  reloadKRisk: (query?: KRiskOverviewQuery) => Promise<void>;
};
