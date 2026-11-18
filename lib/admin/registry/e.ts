/**
 * 域 E 已 port 视图注册表。
 * 真渲染面在 e-view.tsx / e-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_E: ModuleEntry[] = [
  {
    path: "/devices/pricing",
    summary: "管理 UVELBox 商品：售价、每日收益、库存、上下架和促销，新增机型，设置各机型何时开放购买。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/tasks",
    summary: "管理任务等级，随机添加任务并批量启停；查看各等级平均时长和每日单量。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/trade-in",
    summary: "设置设备产出随使用时长递减的规则，以及旧机抵扣换新机的规则。抵扣额只能用来买更贵的新机，不能提现。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/orders",
    summary: "查看所有购机订单的用户、机型、金额、支付方式和进度（下单 → 已付款 → 开通中 → 已激活）。退款会相应扣减用户的累计充值。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/ops",
    summary: "查看用户设备的运行状态、来源、本月收益和当前任务，管理激活、停用与解绑。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/compute-config",
    summary: "集中管理手机任务、5 档收益、新用户引导对比、用户手机与校准规则。",
    content: PORTED_EMPTY_CONTENT,
  },
];
