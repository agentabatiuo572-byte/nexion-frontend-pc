import type { OpsVoucher } from "@/lib/store/admin/platform-config-store";

/**
 * 代金券 seed —— 与前端 Nexion-uniapp/src/mock/vouchers.ts 的 VOUCHERS **同契约同值**
 * (id / 类型 / 面值 / 适用 SKU / 领取入口一致),真后台对接时两端 1:1 映射同一资源。
 * 改这里的种子需同步前端 seed(两端是同一份后台配置的镜像)。
 */
export const VOUCHER_SEED: OpsVoucher[] = [
  {
    id: "vc-newuser-50",
    name: "New User Gift",
    type: "fixed",
    amountUSD: 50,
    minPurchaseUSD: 600,
    applicableSkus: ["stellarbox-s1"],
    audience: "new",
    startAt: 0,
    endAt: 0,
    claimSurfaces: ["home", "store"],
    popupEnabled: true,
    stackWithTrial: false,
    stackWithOthers: false,
    splittable: false,
    status: "active",
  },
  {
    id: "vc-activity-8pct",
    name: "Summer Activity",
    type: "percent",
    percent: 8,
    maxDiscountUSD: 200,
    applicableSkus: [],
    audience: "all",
    startAt: 0,
    endAt: Date.UTC(2026, 11, 31), // 2026-12-31
    claimSurfaces: ["home", "store", "me", "earn"],
    popupEnabled: true,
    stackWithTrial: true,
    stackWithOthers: false,
    splittable: false,
    status: "active",
  },
];
