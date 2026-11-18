/** H3 用户任务管理表单里任务类别、去完成页面的选项叫法和旧币种名的写法。H3 页和 A2 审批单共用，两页同一个说法。 */
import { nexGridBrandText } from "@/lib/admin/brand-copy";

export const TASK_CATEGORY_LABELS: Record<string, string> = {
  wallet: "钱包",
  explore: "探索",
  recommend: "推荐",
  identity: "身份",
  social: "社交",
};
export const TASK_ACTION_ROUTE_LABELS: Record<string, string> = {
  "/pages/missions/missions": "任务中心",
  "/pages/me/profile": "个人资料",
  "/pages/me/wallet-cards-new": "绑定银行卡",
  "/pages/me/wallet-topup": "钱包充值",
  "/pages/me/wallet-exchange": "UVT / USDT 兑换",
  "/pages/me/wallet-repurchase": "锁定计划",
  "/pages/me/devices": "我的设备",
  "/pages/earn/earn": "收益",
  "/pages/store/store": "商城",
  "/pages/store/detail?id=stellarbox-s1": "UVELBox S1 详情",
  "/pages/team/team": "团队",
  "/pages/team/commissions": "奖励明细",
  "/pages/learn/courses": "学习中心",
  "/pages/staking/staking": "Staking",
  "/pages/genesis/genesis": "创世节点",
  "/pages/genesis/marketplace": "创世节点 转让市场",
};

/** 后端旧名称里的 NEX 按真实类型写 UVT，并标出是旧名称。 */
export function legacyAssetText(value: string): { text: string; legacy: boolean } {
  const legacy = /\bNEX\b/i.test(value);
  return { text: nexGridBrandText(value.replace(/\bNEX\b/gi, "UVT")), legacy };
}
