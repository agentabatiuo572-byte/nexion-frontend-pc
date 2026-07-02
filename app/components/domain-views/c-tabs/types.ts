/**
 * C 域视图层契约 —— 复用 K 域三类弹窗原语 + D 域 logAudit 扩展(语义同 DCtx):
 *  - ActionConfirmReq = 操作确认(调参传 edit 显示「目标新值」,处置不传 —— 操作确认 显式 edit 契约同全域;
 *    凭据铁律:密码重置 / 关 2FA 绝不传 edit,杜绝任何可输密码的字段);
 *  - ConfirmReq = 普通确认(强制登出 / 踢线 / 触发复审 / 短锁解锁 / 挂起撤销 / 导出 —— 仍需操作确认但强制留痕,可带必填原因);
 *  - C 域处置统一走后端 user360/admin-users 接口,A2 留痕由接口链路负责。
 */
import type { DCtx } from "../d-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type CCtx = DCtx;
