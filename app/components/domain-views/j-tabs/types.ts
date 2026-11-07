/**
 * J 域视图层契约。ActionConfirmReq = 视图构造的操作确认请求(操作确认 显式 edit 契约:调参传 edit,处置/纯动作不传);
 * shell 只负责渲染 OperationConfirmModal 并回调 run(真写落点仍集中于各视图内的 ctx.setParam)。
 */
import type { ReactNode } from "react";
import type { OperatorBriefKind, EditSpec, BusinessFormSpec, BusinessFormValue, CoverageSnapshot } from "../design-kit";
import type { JEmergencyActions, JEmergencyData } from "@/lib/admin/j-client";
import type { ToastKind } from "@/lib/store/ui";

export type ActionConfirmReq = {
  /** 框上写的短标题，只写动作和对象；action 照旧是记进操作记录的名字（VS-101）。 */
  title?: ReactNode;
  briefKind: OperatorBriefKind;
  action: ReactNode;
  detail: ReactNode;
  completionCopy?: string;
  reasonMax?: number;
  amplifies?: boolean;
  coverage?: CoverageSnapshot;
  coverageCheck?: string;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  effect?: ReactNode;
  confirmLabel?: string;
  confirmTone?: "primary" | "danger";
  statedBrief?: { impact: string; check: string };
  facts?: ReactNode;
  reasonPlaceholder?: string;
  reasonPolicyOptional?: boolean;
  /** 框里写这项为什么现在不能提交，确认按钮禁用。 */
  blockedReason?: ReactNode;
  /** 换了就重开这个框：理由和输入回到初值。别人改过后读取最新时用（OP-97）。 */
  formKey?: number;
  /** 返回 false 时框留着。 */
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void | boolean | Promise<void | boolean>;
};

export type JCtx = {
  pget: (k: string) => string | undefined;
  /** 水合后的 store 参数全量(未水合时为空对象)— 供 J2 枚举 J.geo.* 派生 activeCountries。 */
  params: Record<string, unknown>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  toast: (s: string, kind?: ToastKind) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  emergency: JEmergencyData;
  actions: JEmergencyActions;
  contentLoading: boolean;
  contentError: string | null;
};
