/**
 * D 域视图层契约 —— 直接复用 K 域三类弹窗原语(SPEC §0/§6 同语义):
 *  - ActionConfirmReq = 操作确认(调参传 edit 显示「目标新值」,处置不传 —— 操作确认 显式 edit 契约同全域);
 *  - ConfirmReq = 普通确认(BIN 锁/解锁 · 快速放行 · 拒绝/延迟 · 批量小额 · 导出 —— 仍需操作确认但强制留痕,可带必填原因);
 *  - 真写统一落 platform-config setParam(keyed 状态 + A2 审计 + persist 水合门)。
 * KCtx 结构与 D 域完全同构,起别名 DCtx 以保持调用面语义。
 */
import type { KCtx } from "../k-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

/** D 域在 K 契约上扩展 logAudit:只读导出类动作普通确认但必须落 A2 审计(PRD D3/D4④)。 */
export type DCtx = KCtx & {
  logAudit: (e: { actor: string; action: string; target: string }) => void;
};
