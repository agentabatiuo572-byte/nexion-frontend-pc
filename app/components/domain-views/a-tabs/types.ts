/**
 * A 域视图层契约 —— 复用 K 域三类弹窗原语 + D 域 logAudit 扩展(reason):
 *  - ActionConfirmReq = 操作确认(账号 CRUD / 改角色 / 重置 2FA / 矩阵授权变更 / 理由最短长度·保留期·
 *    schema 注册 / NTP 源 / 幂等窗口 / feature flag 切换 / 事件灰度·全量·停用 / 口径参数 / 扩展工单登记);
 *    显式 edit 契约:调参传 edit:{kind:"text",current};处置(停启/禁用/执行/取消)不传 edit。
 *  - ConfirmReq = 普通确认(强制登出 session / 脱敏导出 / 取消动作 — 仍需操作确认但强制留痕,必填原因)。
 *  - 真写统一 platform-config setParam(A.*)+ 共享 useAccount store(A1 沿用 OpsAccount,旧 a-view 已建)。
 * A 域三铁律 server-canonical 承诺(UI 不变量):
 *  ① 全员强制 2FA(不可关)— toggle 2FA 必拒;
 *  ② 新账号默认零写权(显式分配)— RBAC 矩阵起点全 "—";
 *  ③ 有效超管 ≥2(server 校验)— 禁用最后一个超管 / 降级最后一个超管时 UI 拒写 + toast 解释。
 *  ④ A2:append-only(无改删 endpoint,超管也不行)+ reason-required(server 强制 403)+
 *     放行原子+幂等(Idempotency-Key 24h dedup)+ 理由必填 + 审计留痕。
 *  ⑤ A3:server time 单源(client 钟仅显示)+ killswitch 操作面已迁 J1/J2(本页只读跳转)。
 *  ⑥ A4:资金/KPI 只认 is_server_authoritative=true(server 在状态机推进时 emit)+ PII 禁入。
 * A 域 amplifies:高敏资金动作(放大流出方向,e.g. 提现放行 / 课程奖励上调)单独挂;其余动作 false。
 */
import type { DCtx } from "../d-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type ACtx = Omit<DCtx, "logAudit"> & {
  logAudit: (e: { actor: string; action: string; target: string; reason?: string }) => void;
};
