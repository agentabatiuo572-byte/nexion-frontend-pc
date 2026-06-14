/**
 * J 域视图层契约。ActionConfirmReq = 视图构造的操作确认请求(操作确认 显式 edit 契约:调参传 edit,处置/纯动作不传);
 * shell 只负责渲染 OperationConfirmModal 并回调 run(真写落点仍集中于各视图内的 ctx.setParam)。
 */
import type { ReactNode } from "react";
import type { EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  amplifies?: boolean;
  edit?: EditSpec;
  run: (reason: string, newValue?: string) => void;
};

export type JCtx = {
  pget: (k: string) => string | undefined;
  /** 水合后的 store 参数全量(未水合时为空对象)— 供 J2 枚举 J.geo.* 派生 activeCountries。 */
  params: Record<string, unknown>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  toast: (s: string) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
};
