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
    summary: "设置团队购买奖励、好友购买奖励的 USDT / UVT 比例和好友设备收益奖励。好友的两项奖励需一起提交审批。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/binary",
    summary: "团队平衡奖励：按 A 组、B 组中订单额较小的一组计奖，新成员自动分到较小的一组，每日有上限。可设结算周期和未匹配订单额的处理方式。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/leadership-pool",
    summary: "管理团队激励池、各等级的购机名额、区域大使和排行榜，可取消刷榜用户的资格。会多发钱的改动需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/network/commissions",
    summary: "核对八类奖励：好友购买奖励、好友设备收益奖励、团队购买奖励、团队平衡奖励、同级奖励、好友升级奖励、团队激励池和创世节点收益，可查看来源、邀请关系、退款和待追回情况。",
    content: PORTED_EMPTY_CONTENT,
  },
];
