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
    summary: "NexGridBox 商品目录和定价中枢(E1)—— 管商品清单(售价、日产、库存、上下架、促销)+ 新增机型。价格和日产基准以服务器为准;新增机型、改价、上下架都走操作确认并记入 A2 审计,会联动 E4 订单和 E2 收益引擎。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/tasks",
    summary: "收益与任务引擎(E2)—— 管设备的日产基准、NEX 配比和每日任务奖励,以服务器为准。改了费率从第二天起影响全网在线设备的计酬(改费率走操作确认),会牵动 B 域应付负债和 D 域提现压力。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/trade-in",
    summary: "设备生命周期 & 以旧换新(E3)—— 管设备任务产能随月龄递减的节奏与产出阶梯抵扣。折抵只能抵新机货款、不进可提余额,默认仅限升级更高价设备;抵扣和下单一笔完成(要么都成、要么都回滚)。改规则走操作确认,会联动 E1 商品与旧机置换流转。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/orders",
    summary: "购机订单台(E4)—— 全部订单的用户、机型、金额、支付方式和状态流转。订单按固定步骤推进:下单 → 已付 → 开通中 → 已激活,外加失败态;退款会核减累计入金,资金那边走 D1/D4,异常订单点开能看全部字段。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/ops",
    summary: "设备运维(E5)—— 在线设备的健康度、算力波动、告警和工单台。盯设备产出异常(掉线、算力骤降、计酬偏差),按级别处置告警;会动到钱或状态的运维(强制下线、补发收益)要确认并记入 A2 审计。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/devices/compute-config",
    summary: "算力与设备配置(E6)—— 集中管理四块配置:① 电脑算力入口开关(开/关用户自带 PC 算力接入);② 在线加成系数(在线设备的算力/收益加成倍率);③ 显卡映射表 G1-G6(显卡型号到算力档位的映射基准);④ 客户端下载配置(下载地址与中英文标题、引导文案)。这些项是全网算力计酬基准和客户端拉取源头,变更须填写理由并经 A2 操作确认,会联动 E2 收益引擎和 E5 设备运维。",
    content: PORTED_EMPTY_CONTENT,
  },
];
