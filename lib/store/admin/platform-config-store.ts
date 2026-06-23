"use client";

/**
 * 运营后台 · 平台级配置可变 store(真状态 + persist)。
 * 与 user-ops-store(per-user)互补:此处放平台级、跨用户的运营配置增删改查(先落 E3 任务引擎,可扩展到 SKU/质押档等)。
 * 真后台对接:每个 action 对应平台配置端点(如 POST /api/admin/tasks),此处 mock state + 乐观更新 + persist(刷新不丢)。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface OpsTask {
  id: string;
  n: string;
  price: number;
  unit: string;
  req: string;
  sat: number;
}

// 购买门(per-user 购买限制)— 镜像前端 Product.purchaseGate(Nexion-uniapp/src/mock/products.ts)。
// 运营在「新增/编辑 SKU」抽屉配置;server-canonical:前端只读、server 二次校验为权威。
// 两个正交维度:① 等级/条件门(rankMin / activeDirectMin / teamVolumeMin + mode);② 锁额门(quotaCap / quotaSold / quotaPeriod)。
// 任一条件字段省略 = 不校验该项;整个 purchaseGate 为 undefined = 自由购买无门。
export interface PurchaseGate {
  rankMin?: number;           // 最低 V 级(0-12);eligible 需 myRank >= rankMin
  activeDirectMin?: number;   // 最少活跃直推数
  teamVolumeMin?: number;     // 最低团队业绩 USD
  mode: "all" | "either";     // 多条件 AND / OR
  quotaCap?: number;          // 锁额:本期可售上限
  quotaSold?: number;         // 已售(server 维护;remaining = cap - sold)
  quotaPeriod?: "month" | "lifetime";
  enforce: boolean;           // true=硬拦截售罄 / false=仅 FOMO 展示
}

// 商品 SKU(name 作唯一 id)— 字段为前端 Product 模型(Nexion-prototype/lib/mock/products.ts)的
// 结构化镜像超集:前端商品卡/详情页展示的每个参数都在此可运营。真后台对接时本结构 1:1 映射 Product。
// 两个正交的「状态」维度:lifecycle = active/legacy(代际生命周期,驱动前端 Legacy 角标);
// status = on/off/pending(后台上下架态,前端不可见)。baseRate 已拆为 dailyEarn + dailyEarnNEX(结构化双币)。
export interface OpsSku {
  // ── 标识 ──
  name: string;                 // 唯一 key + 商品名
  id?: string;                  // 对齐前端 product id(真后台主键)
  // ── 基本信息 ──
  tier?: string;                // Entry / Pro / Flagship / Share
  tagline?: string;             // 标语
  badge?: string;               // 营销角标(Best Seller / Trending / New Gen / Low Barrier ...)
  // ── 硬件规格 ──
  gpu?: string;                 // 如 4× RTX 4090
  vram?: string;                // 如 96GB VRAM
  hashRate?: string;            // 如 1,240 MH/s
  power?: string;               // 如 1,200W TDP
  datacenter?: string;          // 数据中心(前端原为硬编码 Singapore DC → 此处数据化)
  // ── 价格 ──
  price: number;                // 售价 USD
  // ── 收益(baseRate 拆结构化双币;dailyEarn/NEX 为真源,baseRate 仅派生兼容字符串)──
  dailyEarn: number;            // 日产 USDT
  dailyEarnNEX: number;         // 日产 NEX
  shareYieldMin?: number;       // Share 档年化下限 %
  shareYieldMax?: number;       // Share 档年化上限 %
  baseRate?: string;            // 派生展示字符串(由 dailyEarn + dailyEarnNEX 合成;旧代码兼容,勿作真源)
  // ── 营销 & 社会证明 ──
  sold?: number;                // 累计销量
  stock: string | number;      // 库存(数字或 ∞);前端用作「仅剩 N」稀缺钩子
  rating?: number;              // 评分(0-5)
  reviews?: number;             // 评论数
  // ── AI 性能(前端 ai.* 扁平化)──
  aiImageGenPerMin?: number;    // 图像生成 张/min
  aiLlmTokensPerSec?: number;   // LLM 推理 tok/s
  aiVideoMinPerHour?: number;   // 视频渲染 输出分钟/render hour
  aiFineTuneMins?: number;      // LoRA 微调 turnaround 分钟
  aiUnlocks?: string;           // 解锁算力池文案
  // ── 特性清单 ──
  features?: string[];          // 卖点列表(详情页)
  // ── 代际 & 生命周期 ──
  generation?: number;          // 代际 1 / 2
  lifecycle?: string;           // active / legacy(代际生命周期;独立于上下架 status)
  supersededBy?: string;        // 被替代为(下一代 product id / name)
  tradeinDiscount?: number;     // 以旧换新折扣 USD
  unlock: string;               // 解锁 Phase(= 前端 unlocksAtPhase)P1-P6
  // ── 购买门(per-user 购买限制 · 镜像前端 Product.purchaseGate;undefined = 自由购买无门)──
  purchaseGate?: PurchaseGate;  // 等级/条件门 + 锁额门(运营在 SKU 抽屉「⑦ 购买限制」配置)
  imageAssetId?: string;         // 后台媒体 assetId(商品主图或商品视频)
  imageObjectKey?: string;       // MinIO object key
  imagePreviewUrl?: string;      // 临时预览 URL(可由 assetId 刷新)
  // ── 后台运营态(后台特有,非前端展示)──
  tag: string;                  // 后台分类 tone(popular / limited / pro / legacy / "")
  status: string;               // on(在售)/ off(下架)/ pending(待上架确认)
}

// 数据中心(E5 运维可增删改的单源;SKU datacenter 下拉读 displayName,用户侧展示托管 DC 名)。
// backend-replaceable:真后台 1:1 映射数据中心资源(GET/POST/PUT/DELETE /api/admin/data-centers)。
export interface OpsDataCenter {
  id: string;            // 区域 id(如 ap-southeast-1)· 唯一 key
  location: string;      // 所在地(如 亚太 · 新加坡)
  displayName: string;   // 前端展示名称(如 Singapore DC)
}

// 代金券(voucher)— 运营配置的领券促销。本结构是前端 VoucherDef
// (Nexion-uniapp/src/mock/vouchers.ts)的**结构化超集**(满足字段级镜像门:
// 后台可编辑字段 ⊇ 前端展示字段);真后台对接时 1:1 映射同一资源:
//   list/get → GET /api/admin/vouchers[/:id](= 前端 GET /api/vouchers 同一资源,运营视角)
//   add/update/setStatus → POST /api/admin/vouchers · PUT /api/admin/vouchers/:id
//   remove → DELETE /api/admin/vouchers/:id(下架建议用 PUT status=paused 而非删)
// 两类:fixed=满减(amountUSD off,满 minPurchaseUSD 可用);percent=折扣
// (percent% off,封顶 maxDiscountUSD)。applicableSkus 空 = 全设备(领券 CTA
// 跳商城),单个 = 该 SKU 详情页。claimSurfaces = 关闭弹窗后展示领券 banner 的前端页面。
export interface OpsVoucher {
  id: string;                   // 唯一 key(真后台主键)
  name: string;                 // 代金券名称(运营配)
  type: "fixed" | "percent";    // 满减 / 折扣
  amountUSD?: number;           // 满减面值 USD(type=fixed)
  percent?: number;             // 折扣率 %(type=percent)
  minPurchaseUSD?: number;      // 满减门槛 USD(0 = 无门槛)
  maxDiscountUSD?: number;      // 折扣封顶 USD(0/缺省 = 不封顶)
  applicableSkus: string[];     // 适用 SKU id(空 = 全设备)
  audience: "new" | "all";      // 受众:新人 / 全部
  startAt: number;              // 有效期起 ms(0 = 即时生效)
  endAt: number;                // 有效期止 ms(0 = 长期有效)
  claimSurfaces: string[];      // 前端领取入口页面(home / store / me / earn 子集)
  popupEnabled: boolean;        // 是否参与首页弹窗自动弹出
  // ── 叠加 / 性质策略 ──
  stackWithTrial: boolean;      // 是否可与试用收益抵扣叠加(默认 false:二选一取最优)
  stackWithOthers: boolean;     // 是否可与其它优惠(套装折扣等)叠加(默认 false)
  splittable: boolean;          // 是否可拆分(默认 false:整张一次性用于一笔订单)
  // 不可提现是代金券固有性质(折扣只抵扣价格、永不入可提现余额),由前端设计保证、非可配开关。
  status: "active" | "paused";  // active=投放中 / paused=已暂停
}

// V-Rank 等级奖励项(F1)— 运营可配的「奖励清单」单项。每个 V 级 → 一组奖励项。
// 替代旧的硬编码「实物奖 prize + 培育奖 nex」两栏:奖励改为运营可加可删、类型可选。
// 五类:usdt / nex(填 amount)· voucher(引用 OpsVoucher.id)· sku(引用 OpsSku.id)· custom(自定义文本)。
// backend-replaceable:真后台对接 1:1 映射同一资源:
//   list/get → GET /api/admin/f/vrank-rewards[?level=V3]
//   add/update/remove → POST · PUT · DELETE /api/admin/f/vrank-rewards/:id
export type VRankRewardType = "usdt" | "nex" | "voucher" | "sku" | "custom";
export interface OpsVRankRewardItem {
  id: string;                // 唯一 key(真后台主键)
  type: VRankRewardType;
  amount?: number;           // usdt / nex 金额
  voucherId?: string;        // 引用 OpsVoucher.id(type=voucher)
  skuId?: string;            // 引用 OpsSku.id(type=sku)
  custom?: string;           // 自定义奖励文本(type=custom)
}
// 按 V 级聚合:{ V1: [...], V3: [...] };空数组 = 该等级暂无奖励。
export type VRankRewardMap = Record<string, OpsVRankRewardItem[]>;

// 运营账号 · 凭据下发方式:邀请链接(操作员自设密码,管理员永不知晓)/ SSO 企业单点 / 临时密码强制首登改。
// 注:管理员后台**永不存/设明文密码**(最小知悉 + 抗抵赖);密码 server 侧仅存 hash。
// 商品用户评价(镜像前端 Nexion-prototype/lib/mock/reviews.ts 的 Review)。status: published(展示)/ hidden(隐藏)。
export interface OpsReview {
  id: string;
  productId: string;   // 关联 SKU id;"*" = 通用
  author: string;      // 评价人显示名
  rating: number;      // 1-5
  content: string;     // 评价正文
  date: string;        // 相对时间文案
  status: string;      // published / hidden
}

// Nova 推送通道(运营推送 cadence 配置)。on = 启用(kill 为反向操作)。
export interface OpsNova {
  key: string;     // 唯一标识
  name: string;    // 通道名(welcome / market-event …)
  tick: string;    // 触发节奏
  cd: string;      // cooldown 冷却
  ctr: number;     // 点击率 %
  on: boolean;     // 启用(false = 已 kill)
}

export type CredMethod = "invite" | "sso" | "temp";
export interface OpsAccount {
  id: string;
  acct: string;
  name: string;
  role: string;
  status: string; // active / disabled / 待激活(邀请未接受) / 待改密(临时密码)
  tfa: boolean;
  cred: CredMethod;
}

// 统一审计原语:所有运营写动作 append 一条(append-only,backend-replaceable → server 侧落审计表)。
export interface OpsAuditEntry {
  id: string;
  ts: number;       // ms epoch
  actor: string;    // 操作员(mock:总管理员;真后台取 session)
  action: string;   // 动作描述
  target?: string;  // 作用对象 / 参数 key
  before?: string;  // 旧值(参数类动作)
  after?: string;   // 新值
  reason?: string;  // 操作确认 确认理由
}

interface PlatformConfigStore {
  tasks: OpsTask[] | null;
  accounts: OpsAccount[] | null;
  ensureTasks: (seed: OpsTask[]) => void;
  addTask: (t: OpsTask) => void;
  updateTask: (id: string, patch: Partial<OpsTask>) => void;
  removeTask: (id: string) => void;
  skus: OpsSku[] | null;
  ensureSkus: (seed: OpsSku[]) => void;
  addSku: (s: OpsSku) => void;
  updateSku: (name: string, patch: Partial<OpsSku>) => void;
  setSkuStatus: (name: string, status: string) => void;
  removeSku: (name: string) => void;
  dataCenters: OpsDataCenter[] | null;
  ensureDataCenters: (seed: OpsDataCenter[]) => void;
  addDataCenter: (dc: OpsDataCenter) => void;
  updateDataCenter: (id: string, patch: Partial<OpsDataCenter>) => void;
  removeDataCenter: (id: string) => void;
  reviews: OpsReview[] | null;
  ensureReviews: (seed: OpsReview[]) => void;
  addReview: (r: OpsReview) => void;
  updateReview: (id: string, patch: Partial<OpsReview>) => void;
  removeReview: (id: string) => void;
  novas: OpsNova[] | null;
  ensureNovas: (seed: OpsNova[]) => void;
  addNova: (n: OpsNova) => void;
  updateNova: (key: string, patch: Partial<OpsNova>) => void;
  removeNova: (key: string) => void;
  ensureAccounts: (seed: OpsAccount[]) => void;
  addAccount: (a: OpsAccount) => void;
  updateAccount: (id: string, patch: Partial<OpsAccount>) => void;
  vouchers: OpsVoucher[] | null;
  ensureVouchers: (seed: OpsVoucher[]) => void;
  addVoucher: (v: OpsVoucher) => void;
  updateVoucher: (id: string, patch: Partial<OpsVoucher>) => void;
  setVoucherStatus: (id: string, status: string) => void;
  removeVoucher: (id: string) => void;
  // ── V-Rank 等级奖励(F1)· 按 V 级聚合的奖励项清单 ──
  vRankRewards: VRankRewardMap | null;
  ensureVRankRewards: (seed: VRankRewardMap) => void;
  addVRankReward: (level: string, item: OpsVRankRewardItem) => void;
  updateVRankReward: (level: string, id: string, patch: Partial<OpsVRankRewardItem>) => void;
  removeVRankReward: (level: string, id: string) => void;
  // ── 地基原语:域级参数统一真写 + 审计(覆盖大量「调参数」类动作:费率 / APY / 阈值 / dial / 限额)──
  // key 命名约定:"<域>.<对象>.<参数>",如 "G.staking.apy.s1" / "D.withdraw.dailyCap" / "F.unilevel.L1"。
  params: Record<string, string | number | boolean>;
  audit: OpsAuditEntry[];
  setParam: (key: string, value: string | number | boolean, meta: { action: string; reason?: string; actor?: string }) => void;
  logAudit: (entry: Omit<OpsAuditEntry, "id" | "ts">) => void;
}

let AUDIT_SEQ = 0; // 跨 reload 防审计 id 碰撞(配合 audit.length)

export const usePlatformConfig = create<PlatformConfigStore>()(
  persist(
    (set) => ({
      tasks: null,
      accounts: null,
      ensureTasks: (seed) => set((s) => (s.tasks ? s : { tasks: seed })),
      addTask: (t) => set((s) => ({ tasks: [...(s.tasks ?? []), t] })),
      updateTask: (id, patch) => set((s) => ({ tasks: (s.tasks ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      removeTask: (id) => set((s) => ({ tasks: (s.tasks ?? []).filter((t) => t.id !== id) })),
      skus: null,
      ensureSkus: (seed) => set((s) => (s.skus ? s : { skus: seed })),
      addSku: (sk) => set((s) => ({ skus: [sk, ...(s.skus ?? [])] })),
      updateSku: (name, patch) => set((s) => ({ skus: (s.skus ?? []).map((x) => (x.name === name ? { ...x, ...patch } : x)) })),
      setSkuStatus: (name, status) => set((s) => ({ skus: (s.skus ?? []).map((x) => (x.name === name ? { ...x, status } : x)) })),
      removeSku: (name) => set((s) => ({ skus: (s.skus ?? []).filter((x) => x.name !== name) })),
      dataCenters: null,
      ensureDataCenters: (seed) => set((s) => (s.dataCenters ? s : { dataCenters: seed })),
      addDataCenter: (dc) => set((s) => ({ dataCenters: [...(s.dataCenters ?? []), dc] })),
      updateDataCenter: (id, patch) => set((s) => ({ dataCenters: (s.dataCenters ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeDataCenter: (id) => set((s) => ({ dataCenters: (s.dataCenters ?? []).filter((x) => x.id !== id) })),
      reviews: null,
      ensureReviews: (seed) => set((s) => (s.reviews ? s : { reviews: seed })),
      addReview: (r) => set((s) => ({ reviews: [r, ...(s.reviews ?? [])] })),
      updateReview: (id, patch) => set((s) => ({ reviews: (s.reviews ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeReview: (id) => set((s) => ({ reviews: (s.reviews ?? []).filter((x) => x.id !== id) })),
      novas: null,
      ensureNovas: (seed) => set((s) => (s.novas ? s : { novas: seed })),
      addNova: (n) => set((s) => ({ novas: [n, ...(s.novas ?? [])] })),
      updateNova: (key, patch) => set((s) => ({ novas: (s.novas ?? []).map((x) => (x.key === key ? { ...x, ...patch } : x)) })),
      removeNova: (key) => set((s) => ({ novas: (s.novas ?? []).filter((x) => x.key !== key) })),
      ensureAccounts: (seed) => set((s) => (s.accounts ? s : { accounts: seed })),
      addAccount: (a) => set((s) => ({ accounts: [a, ...(s.accounts ?? [])] })),
      updateAccount: (id, patch) => set((s) => ({ accounts: (s.accounts ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      vouchers: null,
      ensureVouchers: (seed) => set((s) => (s.vouchers ? s : { vouchers: seed })),
      addVoucher: (v) => set((s) => ({ vouchers: [v, ...(s.vouchers ?? [])] })),
      updateVoucher: (id, patch) => set((s) => ({ vouchers: (s.vouchers ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      setVoucherStatus: (id, status) => set((s) => ({ vouchers: (s.vouchers ?? []).map((x) => (x.id === id ? { ...x, status: status as OpsVoucher["status"] } : x)) })),
      removeVoucher: (id) => set((s) => ({ vouchers: (s.vouchers ?? []).filter((x) => x.id !== id) })),
      vRankRewards: null,
      ensureVRankRewards: (seed) => set((s) => (s.vRankRewards ? s : { vRankRewards: seed })),
      addVRankReward: (level, item) =>
        set((s) => {
          const map = s.vRankRewards ?? {};
          return { vRankRewards: { ...map, [level]: [...(map[level] ?? []), item] } };
        }),
      updateVRankReward: (level, id, patch) =>
        set((s) => {
          const map = s.vRankRewards ?? {};
          return { vRankRewards: { ...map, [level]: (map[level] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) } };
        }),
      removeVRankReward: (level, id) =>
        set((s) => {
          const map = s.vRankRewards ?? {};
          return { vRankRewards: { ...map, [level]: (map[level] ?? []).filter((x) => x.id !== id) } };
        }),
      params: {},
      audit: [],
      setParam: (key, value, meta) =>
        set((s) => {
          const params = s.params ?? {}; // 老 persist 记录可能无此字段
          const audit = s.audit ?? [];
          const before = params[key];
          const entry: OpsAuditEntry = {
            id: `AU-${audit.length}-${(AUDIT_SEQ = (AUDIT_SEQ + 1) % 1_000_000)}`,
            ts: Date.now(),
            actor: meta.actor ?? "总管理员",
            action: meta.action,
            target: key,
            before: before === undefined ? undefined : String(before),
            after: String(value),
            reason: meta.reason,
          };
          return { params: { ...params, [key]: value }, audit: [entry, ...audit] };
        }),
      logAudit: (e) =>
        set((s) => {
          const audit = s.audit ?? [];
          return { audit: [{ id: `AU-${audit.length}-${(AUDIT_SEQ = (AUDIT_SEQ + 1) % 1_000_000)}`, ts: Date.now(), ...e }, ...audit] };
        }),
    }),
    {
      name: "nexion-admin-platform-v1",
      version: 8, // v2:OpsSku 镜像前端 Product 超集;v3:评价改 per-product;v4:SKU 加 purchaseGate(购买门),清旧 SKU 重建带门 seed;v5:SKU 日产值对齐公布档(Pro v2 14/90·Cloud 3 NEX),清旧 SKU 重建;v6:新增 OpsVoucher(代金券);v7:新增 V-Rank 等级奖励(删实物/发货,奖励改可配清单);v8:新增 OpsDataCenter(E5 数据中心可增删改 + SKU datacenter 下拉单源)。
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<PlatformConfigStore>;
        if (version < 2) p.skus = null; // 丢弃旧结构 SKU,避免渲染时 dailyEarn 等新字段缺失
        if (version < 3) p.reviews = null; // 评价改 per-product(无通用"*"),清旧 seed 由 ensureReviews 按新 per-product seed 重建
        if (version < 4) p.skus = null; // SKU 新增 purchaseGate 字段 + Pro/Rack P1 默认门;清旧 seed 由 ensureSkus 按新 seed 重建
        if (version < 5) p.skus = null; // SKU 日产值对齐公布档(Pro v2 14.5→14 / 100→90 NEX · Cloud 1→3 NEX);清旧 stale seed 重建
        if (version < 6) p.vouchers = null; // 新增代金券字段,由 ensureVouchers 按 seed 重建
        if (version < 7) p.vRankRewards = null; // 新增 V-Rank 等级奖励,由 ensureVRankRewards 按 seed 重建
        if (version < 8) p.dataCenters = null; // 新增数据中心,由 ensureDataCenters 按 seed 重建
        return p as PlatformConfigStore;
      },
    },
  ),
);
