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
    summary: "设置会员等级（V0–V8）的晋升条件和权益，等级由系统自动判定。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/royalty",
    summary: "设置七层购买奖励、直属购买奖励的 USDT / UVT 比例和直属设备收益分成。直属的两项政策需一起提交审批。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/binary",
    summary: "左右两队业绩对碰结算：按业绩较少的一队计奖，新成员自动补到弱的一侧，每日有封顶。可设结算周期和未匹配业绩的处理方式。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/leadership-pool",
    summary: "管理领导奖池、各等级的购机名额、区域大使和排行榜，可取消刷榜用户的资格。会多发钱的改动需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/commissions",
    summary: "核对八类佣金：直属购买分成、直属设备收益分成、七层购买奖励、左右团队奖、平级奖、培育奖、领导奖池和创世节点分红，可查看来源、层级、退款和待追回情况。",
    content: PORTED_EMPTY_CONTENT,
  },
];
