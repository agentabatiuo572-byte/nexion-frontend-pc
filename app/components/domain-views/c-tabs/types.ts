/**
 * C 域视图层契约 —— 复用 K 域三类弹窗原语 + D 域 logAudit 扩展(语义同 DCtx):
 *  - ActionConfirmReq = 操作确认(调参传 edit 显示「目标新值」,处置不传 —— 操作确认 显式 edit 契约同全域;
 *    凭据铁律:密码重置 / 关 2FA 绝不传 edit,杜绝任何可输密码的字段);
 *  - ConfirmReq = 普通确认(强制登出 / 踢线 / 触发复审 / 短锁解锁 / 挂起撤销 / 导出 —— 仍需操作确认但强制留痕,可带必填原因);
 *  - 真写统一落 platform-config setParam(keyed 状态 + A2 审计 + persist 水合门)。
 * C 域在 D 契约上再扩 startMirror:C2 模拟登录确认通过后打开只读假镜像(ImpersonateMirror,
 * 目标 userId 命中 USERS 才有镜像数据;镜像状态由 c-view 持有)。
 */
import type { DCtx } from "../d-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type CCtx = Omit<DCtx, "logAudit"> & {
  /** A2 审计(platform-config logAudit 原生支持 reason,C 域处置类动作必带原因留痕)。 */
  logAudit: (e: { actor: string; action: string; target: string; reason?: string }) => void;
  /** C2 模拟登录:确认通过后载入目标用户的只读镜像(USERS 内用户才有镜像)。 */
  startMirror: (userId: string) => void;
};
