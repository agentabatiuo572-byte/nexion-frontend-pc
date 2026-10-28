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
    summary: "一键停用或恢复业务。恢复涉及资金的业务前，先确认兑付覆盖率。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/emergency/geo-block",
    summary: "按国家或地区限制访问，分为禁止访问和受限访问两档。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/emergency/tamper",
    summary: "查看用户篡改余额、收益、节点归属、价格等关键数据的记录。这些数据一律以系统记录为准，篡改不会生效。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/emergency/sop",
    summary: "监管点名或突发事件的应急预案：维护预案、记录演练和执行过程。",
    content: PORTED_EMPTY_CONTENT,
  },
];
