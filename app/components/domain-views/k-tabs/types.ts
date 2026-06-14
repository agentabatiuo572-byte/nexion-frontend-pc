/**
 * K 域视图层契约。三类弹窗语义(SPEC §6):
 *  - ActionConfirmReq = 操作确认(调参传 edit 显示「目标新值」,处置/批量动作不传 —— 显式 edit 契约同全域);
 *  - ConfirmReq = 普通确认(标记类 / 拦截未发放新人礼 / 手动补触发 / 白名单 —— 强制留痕,可带必填原因 + 可选输入框);
 *  - 真写统一落 platform-config setParam(keyed 状态 + A2 审计 + persist 水合门)。
 */
import type { ReactNode } from "react";
import type { BusinessFormSpec, BusinessFormValue, EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  /** 放大资金流出方向才挂(B1 覆盖率预检):解除误判 / 复审通过解冻 / 调阈值放宽 / 停用规则;冻结 / 驳回 / 确认违规不挂。 */
  amplifies?: boolean;
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
  /** 可选输入框(如白名单网段 / 补触发 userId / 覆盖分)。 */
  input?: { label: string; placeholder?: string };
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
};
