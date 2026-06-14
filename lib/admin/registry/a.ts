/**
 * 域 A 平台基础 — 注册表。accent=--admin-domain-a。
 * ⚠️ A1-A4 ∈ PORTED_DOMAINS:本文件 A1-A4 条目 content 为死代码(真渲染面 = a-view.tsx + a-tabs/),
 * 仅 summary 经 DomainHeader 渲染(design_handoff_a_domain f-desc 压缩版,2026-06-11)。
 * A5 平台参数寄存器有独立旗舰页(/platform/params-registry/page.tsx)覆盖 catch-all,不入 a-view FOLD。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = { kind: "dashboard" as const };

export const DOMAIN_A: ModuleEntry[] = [
  {
    path: "/platform/rbac",
    summary: "运营账号与权限矩阵(A1):这页定义「谁能做什么」(A2 记「谁做了什么」)。三条底线:全员双因子(不可关)、新账号零权限(显式分配)、有效超管 ≥2(server 校验,防权限死锁)。账号建/停/启/改角色/重置 2FA = 仅超管可执行,操作确认理由必填;强制登出 session = 仅超管、普通确认即时、必填原因;授权矩阵变更 = 操作确认发布(server 校验最小权限基线,越权组合直接拒)。",
    content: placeholder,
  },
  {
    path: "/platform/audit",
    summary: "审计 & 操作确认中心(A2):全后台操作确认高敏动作都在这里留痕,执行前必须填写理由;审计日志只追加,谁都改不了删不了(超管也不行),保留 13 个月起。三铁律:append-only(无改删 endpoint)+ reason-required(server 强制)+ 确认即执行+幂等(Idempotency-Key 24h dedup,失败时目标域零副作用)。理由最短 8 字,确认后立即写目标域与 A2 审计。",
    content: placeholder,
  },
  {
    path: "/platform/config",
    summary: "系统配置(A3):平台级横切配置。server time 单源(试用倒计时 / 阶段月龄 / 提现冷却 / 锁仓到期 — 一切时间判定只认服务器,用户改本地时钟套不了利)+ 防重号策略(资金/资产写入 24h 去重窗口,网络重试不会重复扣款)+ feature flag 灰度台(实验和灰度的值由服务器派发,客户端只读结果)+ 熔断闸状态存储(开关本体存这里,操作面已迁应急域 J1/J2,这页只读)+ 系统健康面。",
    content: placeholder,
  },
  {
    path: "/platform/events",
    summary: "埋点事件中台(A4):全后台数据地基。驾驶舱 / 资金对账 / 风控信号 / BI 看板和八项 KPI 每个数字都从这条事件流派生 — 不存在临时拍脑袋查询。资金和 KPI 口径只认服务器发的事件(is_server_authoritative=true);界面交互事件可丢可重,不影响资金账。事件名和属性里禁放 PII 明文,一律 hash 或 ID。schema 注册 / 口径参数(Day0 90s / 留存 D1·D7·D30 🔒 / 留存 13 月 / 采样 view 10%·资金 100%)/ domain 扩展批次(V3 已落 / V4 内容批进行中 / J 域 schema 待注册 / V4 收口核对)= 超管执行操作确认。",
    content: placeholder,
  },
  {
    path: "/platform/params-registry",
    summary: "平台参数寄存器(A5):全平台运营面字段级控制索引 · 88 平台参数回源真值,A1-A4 / 各业务域 setParam 写入的真写键都能在这里反查 + 跳源页 + 操作确认发起。本页有独立旗舰渲染面(/platform/params-registry/page.tsx),不走 a-view 切 tab。",
    content: placeholder,
  },
];

export default DOMAIN_A;
