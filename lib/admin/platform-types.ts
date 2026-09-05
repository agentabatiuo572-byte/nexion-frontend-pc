export interface OpsTask {
  id: string;
  n: string;
  price: number;
  unit: string;
  req: string;
  sat: number | null;
  status: "active" | "paused" | "inactive";
  taskClass?: string;
  model?: string;
  minReward?: number;
  maxReward?: number;
  minVRAM?: string;
  killInit?: string;
}

export interface PurchaseGate {
  rankMin?: number;
  activeDirectMin?: number;
  teamVolumeMin?: number;
  mode: "all" | "either";
  quotaCap?: number;
  quotaSold?: number;
  /** Legacy `month` is retained only so old backend rows can be shown as HOLD. */
  quotaPeriod?: "month" | "lifetime";
  enforce: boolean;
}

export interface OpsSku {
  name: string;
  id: string;
  tier?: string;
  tagline?: string;
  badge?: string;
  gpu?: string;
  vram?: string;
  hashRate?: string;
  power?: string;
  datacenter?: string;
  uptime?: string;
  warranty?: string;
  phoneDailyEarn?: number;
  phoneDailyEarnNEX?: number;
  price: number;
  dailyEarn: number;
  dailyEarnNEX: number;
  shareYieldMin?: number;
  shareYieldMax?: number;
  baseRate?: string;
  sold?: number;
  /** 服务端权威商品形态；仅用于展示/约束，不能由库存模式反推。 */
  productType?: "SERVER" | "DEVICE" | "SHARE";
  /** FINITE 扣减实际库存；UNLIMITED 不扣库存且仅允许 SHARE。 */
  inventoryMode?: "FINITE" | "UNLIMITED";
  stock?: string | number;
  /** E1-owned opt-in; only marked physical products may be selected by H2. */
  trialEligible?: boolean;
  aiImageGenPerMin?: number;
  aiLlmTokensPerSec?: number;
  aiVideoMinPerHour?: number;
  aiFineTuneMins?: number;
  aiUnlocks?: string;
  features?: string[];
  generation?: number;
  lifecycle?: string;
  supersededBy?: string;
  tradeinDiscount?: number;
  unlock: string;
  purchaseGate?: PurchaseGate;
  imageAssetId?: string;
  imageObjectKey?: string;
  imagePreviewUrl?: string;
  tag: string;
  status: string;
  updatedAt?: string;
}

export interface OpsDataCenter {
  id: string;
  location: string;
  displayName: string;
}

export interface OpsVoucher {
  id: string;
  name: string;
  type: "fixed" | "percent";
  amountUSD?: number;
  percent?: number;
  minPurchaseUSD?: number;
  maxDiscountUSD?: number;
  applicableSkus: string[];
  audience: "new" | "all";
  startAt: number;
  endAt: number;
  claimSurfaces: string[];
  popupEnabled: boolean;
  stackWithTrial: boolean;
  stackWithOthers: boolean;
  splittable: boolean;
  status: "active" | "paused";
}

export type VRankRewardType = "usdt" | "nex" | "voucher" | "sku" | "custom";

export interface OpsVRankRewardItem {
  id: string;
  type: VRankRewardType;
  amount?: number;
  voucherId?: string;
  skuId?: string;
  custom?: string;
}

export type VRankRewardMap = Record<string, OpsVRankRewardItem[]>;

export interface OpsNova {
  key: string;
  name: string;
  tick: string;
  cd: string;
  ctr: number;
  on: boolean;
}

export type CredMethod = "invite" | "sso" | "temp";

export interface OpsAccount {
  id: string;
  acct: string;
  name: string;
  role: string;
  status: string;
  tfa: boolean;
  cred: CredMethod;
}

export interface OpsAuditEntry {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target?: string;
  before?: string;
  after?: string;
  reason?: string;
}
