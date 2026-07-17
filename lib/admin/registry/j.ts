/**
 * 域 J 已 port 视图注册表。
 * 真渲染面在 j-view.tsx / j-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_J: ModuleEntry[] = [
  {
    path: "/emergency/kill-switch",
    summary: "5 大业务的紧急熔断开关矩阵。一拉闸全站立即生效、客户端绕不过;拉闸和恢复都要确认并记入 A2,资金类恢复前先过 B1 备付金核验。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/emergency/geo-block",
    summary: "按国家 / 地区的准入控制:黑名单和受限名单两档;封锁按服务器入口判定。名单变更走 J2 真实接口与后端业务表。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/emergency/tamper",
    summary: "篡改防御监控只读查看页。余额、产出、节点归属、价格等关键值以服务器为唯一权威,真实页面从 J3 接口读取业务事件。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/emergency/sop",
    summary: "监管点名 / 突发事件的应急预案库。统一维护剧本、演练结果与逐步执行记录。",
    content: PORTED_EMPTY_CONTENT,
  },
];
