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
    summary: "设置设备每日收益、UVT 发放比例和每日任务奖励。改收益从次日起对所有在线设备生效，会直接增加平台应付款。",
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
    summary: "监控在线设备的状态、算力波动和告警，处理掉线、算力骤降和收益异常。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/compute-config",
    summary: "设置手机绑定与换机规则、App 在线加成和收益估算参数。H5 手机算力奖励已停用，已购设备不受影响。",
    content: PORTED_EMPTY_CONTENT,
  },
];
