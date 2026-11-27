/** H3 用户任务管理表单里任务类别、去完成页面的选项叫法和旧币种名的写法。H3 页和 A2 审批单共用，两页同一个说法。 */
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { H3_PRODUCT_DETAIL_ROUTE_PREFIX, type H3ProductActionTarget } from "../h3-contract";

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
  "/pages/team/team": "团队",
  "/pages/team/commissions": "奖励明细",
  "/pages/learn/courses": "学习中心",
  "/pages/staking/staking": "Staking",
  "/pages/genesis/genesis": "创世节点",
  "/pages/genesis/marketplace": "创世节点 转让市场",
};

const TASK_ACTION_ROUTES = [
  "/pages/missions/missions",
  "/pages/me/profile",
  "/pages/me/wallet-cards-new",
  "/pages/me/wallet-topup",
  "/pages/me/wallet-exchange",
  "/pages/me/wallet-repurchase",
  "/pages/me/devices",
  "/pages/earn/earn",
  "/pages/store/store",
  "/pages/team/team",
  "/pages/team/commissions",
  "/pages/learn/courses",
  "/pages/genesis/marketplace",
];

export function isH3RoiMission(missionCode: string) {
  return missionCode.trim().toLowerCase() === "view_product_roi";
}

export function h3RouteNeedsProductTargets(missionCode: string, actionRoute: string) {
  return isH3RoiMission(missionCode) || actionRoute.startsWith(H3_PRODUCT_DETAIL_ROUTE_PREFIX);
}

export function h3ActionRoutes(missionCode: string, targets?: readonly H3ProductActionTarget[] | null): string[] {
  const requiresRoi = isH3RoiMission(missionCode);
  const productRoutes = (targets ?? [])
    .filter(target => target.openable && (!requiresRoi || target.roiEligible))
    .map(target => target.actionRoute);
  return requiresRoi ? productRoutes : [...TASK_ACTION_ROUTES, ...productRoutes];
}

export function h3ActionRouteLabels(targets?: readonly H3ProductActionTarget[] | null): Record<string, string> {
  if (!targets?.length) return TASK_ACTION_ROUTE_LABELS;
  const nameCounts = new Map<string, number>();
  for (const { name } of targets) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const labels = { ...TASK_ACTION_ROUTE_LABELS };
  for (const { name, productNo, actionRoute } of targets) {
    labels[actionRoute] = nameCounts.get(name)! > 1 ? `${name} 详情（${productNo}）` : `${name} 详情`;
  }
  return labels;
}

/** 后端旧名称里的 NEX 按真实类型写 UVT，并标出是旧名称。 */
export function legacyAssetText(value: string): { text: string; legacy: boolean } {
  const legacy = /\bNEX\b/i.test(value);
  return { text: nexGridBrandText(value.replace(/\bNEX\b/gi, "UVT")), legacy };
}
