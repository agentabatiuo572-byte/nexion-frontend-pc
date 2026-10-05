/**
 * 域 F 已 port 视图注册表。
 * 真渲染面在 f-view.tsx / f-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_F: ModuleEntry[] = [
  {
    path: "/network/v-rank",
    summary: "V-Rank 会员等级体系(V0–V12)的晋升门槛和权益。等级由服务器判定;改门槛或权益走操作确认并记入 A2 审计。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/royalty",
    summary: "分别设置直属购买与直属设备收益分成的总比例、USDT/NEX 拆分与冷却期，两组规则一次提交审批。平台额外支付，成员原收益不减少；其他独立奖励保持各自规则。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/binary",
    summary: "平衡匹配结算引擎。把团队分成 A、B 两路,按业绩较小的一路来匹配计酬;新成员自动归位补到弱的一侧,并设每日封顶。结算周期(每日/每周/每月)与沉淀处置(每月清零/每次对碰清零/转结)可配,改封顶 / 匹配比例 / 结算周期走操作确认。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/leadership-pool",
    summary: "奖池 / 配额 / 大使 / 榜单 的聚合操盘台 —— 领导奖池(按每周交易额提取入池、按票数权重分配)、硬件配额(按会员等级分配可购额度并回收)、区域大使资质确认、排行榜和反作弊(联动 K1/K2 取消刷榜资格)。改奖池比例、权重、配额、授予大使、取消资格等都要确认并记入 A2 审计;会往外多发钱的项要先过 B1 覆盖率核验。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/commissions",
    summary: "八类佣金事件审计：直属购买、直属设备收益、历史网络版税、双轨、平级、培育、领导池和创世。直属双币按结算组核对和处置，保留来源、政策、退款及待追回记录；高敏操作经 A2。",
    content: PORTED_EMPTY_CONTENT,
  },
];
