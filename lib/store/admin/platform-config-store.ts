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
  // ── 后台运营态(后台特有,非前端展示)──
  tag: string;                  // 后台分类 tone(popular / limited / pro / legacy / "")
  status: string;               // on(在售)/ off(下架)/ pending(待上架确认)
}

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
      version: 3, // v2:OpsSku 镜像前端 Product 超集;v3:评价改 per-product,清旧通用("*")seed 重建。
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<PlatformConfigStore>;
        if (version < 2) p.skus = null; // 丢弃旧结构 SKU,避免渲染时 dailyEarn 等新字段缺失
        if (version < 3) p.reviews = null; // 评价改 per-product(无通用"*"),清旧 seed 由 ensureReviews 按新 per-product seed 重建
        return p as PlatformConfigStore;
      },
    },
  ),
);
