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
    summary: "推荐分销的版税费率体系。直推版税固定 10%(不可调);费率档(L1–L7)是合伙人身份对应的权益层级、不是在 10% 上再加成;佣金算出来后有 30 天冷却期。改费率走操作确认。",
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
    summary: "佣金事件审计流水。每笔佣金计提都按类型记一条(网络版税、平衡匹配、同级、培育、领导奖池、Genesis 排放、榜单奖金),含层级、金额、冷却、状态。冻结异常事件要风控确认 + A2 留痕。",
    content: PORTED_EMPTY_CONTENT,
  },
];
