"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G4 创世节点销售与收益 — 数据来自后端 /api/admin/market/nex/genesis 及 Genesis 业务表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Drawer, PaginationExemption } from "../design-kit";
import {
  createG4GenesisTier,
  deleteG4GenesisTier,
  fetchG4GenesisOverview,
  initializeG4GenesisSeries,
  rerunG4GenesisDividendBatch,
  updateG4GenesisMarketStatus,
  updateG4GenesisMarketOpenState,
  updateG4GenesisParam,
  updateG4GenesisTier,
  type G4Node,
  type G4Overview,
  type G4Param,
  type G4Tier,
} from "@/lib/admin/g4-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import G4AdminOperations from "./g4-admin-operations";

const OPERATOR = currentAdminOperator;

function messageOf(error: unknown) {
  return displayAdminError(error);
}

function fmtNumber(value: number, max = 2) {
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

function fmtUsd(value: number, max = 2) {
  return `$${fmtNumber(value, max)}`;
}

function fmtUsdCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return fmtUsd(value);
}

function toneClass(tone: string) {
  if (tone === "danger" || tone === "bad") return "bad";
  if (tone === "warn" || tone === "ok" || tone === "dim") return tone;
  return "dim";
}

function paramEditValue(param: G4Param) {
  return param.value || param.displayValue;
}

function paramByKey(overview: G4Overview, key: string) {
  return overview.params.find((param) => param.key === key);
}

function catalogBlockText(reason: string) {
  const labels: Record<string, string> = {
    GENESIS_CATALOG_UNAVAILABLE: "创世节点设置暂时无法加载",
    GENESIS_SERIES_UNAVAILABLE: "还没有可用的节点系列",
    GENESIS_SERIES_RECOVERY_REQUIRED: "已有用户持仓，但找不到对应的节点系列",
    GENESIS_ACTIVE_SERIES_AMBIGUOUS: "同时有多个启用中的节点系列",
    GENESIS_SERIES_INVALID: "节点系列的总量或基础价格有误",
    GENESIS_TIERS_UNAVAILABLE: "还没有设置价格档位",
    GENESIS_TIERS_INVALID: "价格档位不连续或价格有误",
    GENESIS_TIERS_BELOW_SOLD: "价格档位总量少于已售数量",
    GENESIS_TIERS_SUPPLY_MISMATCH: "价格档位总量和节点系列总量对不上",
    GENESIS_TIER_QUOTE_UNAVAILABLE: "当前售出位置没有对应的价格档位",
  };
  return labels[reason] ?? "创世节点系列或价格设置有误";
}

export function G4Genesis({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const paramAuthority = (key: string) => key === "price" ? "finprod_g4_price_write"
    : key === "dividend" ? "finprod_g4_dividend_rate_write"
      : key === "royalty" ? "finprod_g4_royalty_write"
        : key === "airdropPct" ? "finprod_g4_airdrop_pct_write"
          : key === "emissionCurve" ? "finprod_g4_emission_curve_write"
            : key === "airdropLockDays" ? "finprod_g4_airdrop_lock_days_write" : "finprod_g4_write";
  const [overview, setOverview] = useState<G4Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [nodePageNo, setNodePageNo] = useState(1);
  const [nodePageSize, setNodePageSize] = useState(10);

  const reload = useCallback(async (silent = false, page = nodePageNo, pageSize = nodePageSize) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const next = await fetchG4GenesisOverview(page, pageSize);
      setOverview(next);
      setNodePageNo(next.nodePage.page);
      setNodePageSize(next.nodePage.pageSize);
    } catch (err) {
      setOverview(null);
      setError(messageOf(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [nodePageNo, nodePageSize]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchG4GenesisOverview(1, 10);
        if (!cancelled) {
          setOverview(next);
          setNodePageNo(next.nodePage.page);
          setNodePageSize(next.nodePage.pageSize);
        }
      } catch (err) {
        if (!cancelled) {
          setOverview(null);
          setError(messageOf(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (key: string, action: () => Promise<G4Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      await action();
      const next = await fetchG4GenesisOverview(nodePageNo, nodePageSize);
      setOverview(next);
      setNodePageNo(next.nodePage.page);
      setNodePageSize(next.nodePage.pageSize);
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [nodePageNo, nodePageSize, toast]);

  const selectedNode = useMemo(() => {
    if (!overview || !nodeDrawer) return null;
    return overview.nodes.find((node) => node.id === nodeDrawer) || null;
  }, [overview, nodeDrawer]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">创世节点销售与收益</span><span className="sub">· 加载中</span></div>
        <div className="l-b"><div className="gtint">创世节点数据加载中…</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">创世节点销售与收益</span></div>
        <div className="l-b">
          <div className="gtint">创世节点数据加载失败 · {error || "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const busy = !!busyKey;
  const cov = overview.coverage.coverageRatio.toFixed(1);
  const marketOn = overview.market.enabled;
  const stats = overview.stats;
  const dividend = overview.dividend;
  const geoBlocked = overview.geoBlocked.filter((geo) => geo.status === "blocked").map((geo) => geo.cc).join(" / ") || "-";
  const batchRerun = dividend.batchStatus === "done";
  const soldPct = Math.max(0, Math.min(100, stats.soldPct));
  const nodePage = overview.nodePage;

  const loadNodePage = (page: number, pageSize = nodePage.pageSize) => {
    void reload(false, page, pageSize);
  };

  const changeNodePageSize = (value: string) => {
    const nextPageSize = Number(value);
    if (!Number.isFinite(nextPageSize)) return;
    setNodePageNo(1);
    setNodePageSize(nextPageSize);
    void reload(false, 1, nextPageSize);
  };

  const adjustParam = (param: G4Param) => {
    if (!allowed(paramAuthority(param.key))) return;
    // 主人拍板(2026-08-06):阶梯档位在场时一级单价由档位派生、本参数只读,调价走档位卡
    // (OPS-G-07/G-13 仲裁)。入口已不渲染,这里是钱路径双保险。
    if (param.key === "price" && overview.tierPrice.status !== "legacy") return;
    const numeric = !["divBase", "emissionCurve"].includes(param.key);
    const bounds = param.key === "supply" ? { min: stats.sold, max: 100000, step: 1 }
      : param.key === "price" ? { min: 0.01, max: 1000000, step: 0.01 }
        : param.key === "royalty" ? { min: 0, max: 20, step: 0.01 }
          : param.key === "airdropPct" ? { min: 0, max: 100, step: 0.01 }
            : param.key === "airdropLockDays" ? { min: 0, max: 3650, step: 1 }
              : { min: 0, max: 5, step: 0.001 };
    const needsDecision = ["dividend", "divBase", "airdropPct", "emissionCurve"].includes(param.key);
    openActionConfirm({
      action: `修改创世节点参数 · ${operatorCopyText(param.name)}`,
      detail: <><b>{operatorCopyText(param.name)}</b> · 当前 {operatorCopyText(param.displayValue)} · {operatorCopyText(param.note)}<br />当前兑付覆盖率 {cov}%，会多付钱的修改在覆盖率不足时无法保存。</>,
      amplifies: param.b1RedlineTriggered,
      edit: numeric ? { kind: "number", current: paramEditValue(param), ...bounds } : { kind: "text", current: paramEditValue(param) },
      businessForm: needsDecision ? { kind: "multi-field", title: "决策依据", fields: [
        { key: "decisionRef", label: "产品或财务决策编号", current: "", inputKind: "text", required: true },
      ] } : undefined,
      run: async (reason, value, businessValue) => {
        if (!value) return;
        await mutate(`param:${param.key}`, () => updateG4GenesisParam(
          param.key, String(value), reason, OPERATOR(), businessValue?.decisionRef,
        ), `${operatorCopyText(param.name)}已立即生效`);
      },
    });
  };

  const runMarketSwitch = () => {
    if (!marketOn || !allowed("finprod_g4_market_toggle")) return;
    openActionConfirm({
      action: "紧急暂停创世节点买卖",
      detail: <>马上停止认购、挂售和用户之间的转让。恢复要去「紧急停用开关」页面操作。</>,
      amplifies: false,
      businessForm: { kind: "multi-field", title: "暂停原因与处理方案", fields: [
        { key: "triggerBasis", label: "暂停原因", current: "", inputKind: "text", required: true },
        { key: "dispositionPlan", label: "已有持有人怎么处理", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate("market:pause", () => updateG4GenesisMarketStatus(false, reason, OPERATOR(), {
          triggerBasis: businessValue?.triggerBasis, dispositionPlan: businessValue?.dispositionPlan,
        }), "创世节点买卖已紧急暂停，恢复请去「紧急停用开关」");
      },
    });
  };

  // ── 创世市场状态开关(规格 FEAT-GEN10b)────────────────────────────────────
  // 🔴 与上面的熔断**不是**一件事,不合并:熔断是止血(恢复只走 J1),这个是运营节奏
  //   (双向可切)。前端优先级 市场关闭 > 熔断,所以两者并存时要明示谁在生效。
  const marketClosed = overview.market.marketOpenState === "closed";
  const runMarketOpenState = () => {
    if (!allowed("finprod_g4_market_toggle")) return;
    const next: "open" | "closed" = marketClosed ? "open" : "closed";
    if (next === "open" && !overview.catalogAvailable) return;
    openActionConfirm({
      action: next === "closed" ? "创世市场设为「暂未开放」" : "恢复创世市场开放",
      detail: next === "closed"
        // JSX 文本里的 ** 会原样渲染成星号(这是 React 不是 Markdown),要加粗用 <b>。
        ? <>App <b>照常显示</b>创世节点介绍、档位和权益，只是不能购买和转让；已持有的节点和收益不受影响。<br />商城入口不会隐藏（那是另一个开关），也不显示倒计时和剩余名额。</>
        : <>恢复后用户下次打开或刷新就能正常认购。</>,
      amplifies: next === "open", // 恢复销售 = 放大流出方向,不豁免
      // 🔴 文案变体必须是**下拉**,不是自由输入(规格 ③/⑥ 明写「禁自由文本」)。
      //   上一版用了 inputKind:"text" —— 打错一个字符前端会静默回退到默认文案,
      //   运营以为切了「维护中」,用户看到的却是「暂未开放」(2026-08-05 独立验收 P1-9)。
      //   选项集合与前端 GENESIS_CLOSED_NOTICE_KEYS 白名单一一对应;仓内 select 能力现成
      //   (c2-actions.tsx 同款),不必新造。
      businessForm: next === "closed" ? { kind: "multi-field", title: "给用户的提示", fields: [
        {
          key: "noticeKey",
          label: "App 显示的提示",
          inputKind: "select",
          required: true,
          current: overview.market.closedNoticeKey || "default",
          options: ["default", "maintenance", "phase_control", "compliance"],
          optionLabels: {
            default: "当前市场暂未开放",
            maintenance: "系统维护中，暂停认购",
            phase_control: "当前阶段暂不开放认购",
            compliance: "合规审核中，暂停认购",
          },
        },
      ] } : undefined,
      reasonMax: 200,
      run: async (reason, _value, businessValue) => {
        await mutate(
          "market:open-state",
          () => updateG4GenesisMarketOpenState(
            next,
            reason,
            OPERATOR(),
            businessValue?.noticeKey,
            overview.market.marketOpenStateVersion,
          ),
          next === "closed" ? "创世市场已设为暂未开放，用户仍可浏览，但不能购买" : "创世市场已恢复开放",
        );
      },
    });
  };

  const initializeSeries = () => {
    if (!overview.seriesInitializationAvailable || !allowed("finprod_g4_write")) return;
    openActionConfirm({
      action: "发布创世节点系列",
      detail: <>总量和起始价格按价格档位自动计算。版税、每日收益率和收益公式先设为 0，之后再单独修改（需要决策编号）。发布后市场仍是「暂未开放」，核对无误后再手动开放。</>,
      // Initializing the catalog does not start sales or create a payout. The
      // backend forces the market closed and requires a separate reviewed open.
      amplifies: false,
      businessForm: { kind: "multi-field", title: "节点系列信息", fields: [
        { key: "seriesCode", label: "系列编码", current: "", inputKind: "text", required: true },
        { key: "name", label: "系列名称", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        const seriesCode = businessValue?.seriesCode?.trim() ?? "";
        const name = businessValue?.name?.trim() ?? "";
        if (!seriesCode || !name) throw new Error("系列编码和名称不能为空");
        await mutate("series:initialize", () => initializeG4GenesisSeries({
          seriesCode,
          name,
          reason,
          operator: OPERATOR(),
        }), "节点系列已发布；市场仍是暂未开放，核对后请手动开放");
      },
    });
  };

  const runRerunBatch = () => {
    if (!allowed("finprod_g4_write")) return;
    openActionConfirm({
      action: `重新发放今日收益 ${dividend.batchNo}`,
      detail: "只补发失败的，已经发成功的不会重复发。",
      businessForm: { kind: "multi-field", title: "决策依据", fields: [
        { key: "decisionRef", label: "财务或产品决策编号", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate(`batch:${dividend.batchNo}`, () => rerunG4GenesisDividendBatch(
          dividend.batchNo, reason, OPERATOR(), businessValue?.decisionRef,
        ), "已重新发放，只补了失败的");
      },
    });
  };

  // ── 阶梯档位定价(合并底账 §二#1 恢复)────────────────────────────────────
  // 区间连续性(本档起始 = 上档截止)、末档总量 ≥ 已售、至少保留一档、在锁购买按开锁
  // 档价结算 —— 全部由服务端权威校验与执行,本页只提交命令与理由,客户端仅做整数下界
  // 的输入形态约束。tiers === null(未下发或坏形)时卡片 fail-closed,不渲染任何增删改
  // 入口:档位是编辑对象本身,在坏数据上增删会写出错档,宁缺勿假。
  const tiers = overview.tiers;
  const canPriceTiers = allowed("finprod_g4_price_write");
  const fmtInt = (value: number) => fmtNumber(value, 0);
  const requireTierInts = (businessValue: Record<string, string> | undefined) => {
    const to = Number(businessValue?.to);
    const priceUSDT = Number(businessValue?.priceUSDT);
    if (!Number.isInteger(to) || !Number.isInteger(priceUSDT)) throw new Error("截止数量和单价要填整数");
    return { to, priceUSDT };
  };

  const editTier = (tier: G4Tier, index: number) => {
    if (!canPriceTiers || !tiers) return;
    const nextTier = tiers[index + 1];
    openActionConfirm({
      action: `修改价格档位 · ${tier.id}`,
      detail: <><b>{tier.id}</b> 档 · 当前区间 [{fmtInt(tier.from)}, {fmtInt(tier.to)}) · 单价 ${fmtInt(tier.priceUSDT)}。起点等于上一档的截止，不能单独改；改截止时{nextTier ? <>下一档 <b>{nextTier.id}</b> 的起点</> : "总供应量"}会跟着调整，最后一档总量不能少于已售的 {fmtNumber(stats.sold, 0)} 张。只影响以后的销售，已下单的按下单时价格结算。</>,
      businessForm: { kind: "multi-field", title: `档位 ${tier.id}`, hint: "截止 = 卖到第几张换下一档；单价 = 这一档每张多少钱。都填整数。", fields: [
        { key: "to", label: "截止（卖到第几张）", current: String(tier.to), inputKind: "number", min: tier.from + 1, step: 1, required: true },
        { key: "priceUSDT", label: "单价（USDT）", current: String(tier.priceUSDT), inputKind: "number", min: 1, step: 1, required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        const { to, priceUSDT } = requireTierInts(businessValue);
        await mutate(`tier:update:${tier.id}`, () => updateG4GenesisTier(tier.id, to, priceUSDT, overview.tiersVersion, reason, OPERATOR()), `档位 ${tier.id} 已更新为 [${fmtInt(tier.from)}, ${fmtInt(to)}) · $${fmtInt(priceUSDT)}`);
      },
    });
  };

  const addTier = () => {
    if (!canPriceTiers || !tiers) return;
    const firstTier = tiers.length === 0;
    const lastTier = firstTier ? null : tiers[tiers.length - 1];
    const rangeFrom = lastTier?.to ?? 0;
    openActionConfirm({
      action: firstTier ? "创建第一个价格档位" : "新增价格档位",
      detail: firstTier
        ? <>创建第一档（从 0 到截止）及价格，用来确定节点总量和起始价格。不会发布系列、不会开放市场。已有用户持仓时不能创建。</>
        : <>在最后一档 <b>{lastTier!.id}</b>（截止 {fmtInt(lastTier!.to)}）之后新增一档，起点自动为 {fmtInt(lastTier!.to)}，总供应量随之增加。<b>多卖节点意味着以后要多发收益</b>，覆盖率低于红线时无法新增（当前 {cov}%）。新档单价一般不低于上一档的 ${fmtInt(lastTier!.priceUSDT)}。只影响以后的销售。</>,
      amplifies: firstTier ? false : overview.coverage.redlineBreached,
      businessForm: { kind: "multi-field", title: firstTier ? "第一个价格档位" : "新价格档位", hint: `起点 = ${fmtInt(rangeFrom)}${firstTier ? "" : "（上一档的截止）"}。截止和单价都填整数。`, fields: [
        { key: "to", label: "截止（卖到第几张）", inputKind: "number", min: rangeFrom + 1, step: 1, required: true },
        { key: "priceUSDT", label: "单价（USDT）", inputKind: "number", min: 1, step: 1, required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        const { to, priceUSDT } = requireTierInts(businessValue);
        await mutate("tier:create", () => createG4GenesisTier(to, priceUSDT, overview.tiersVersion, reason, OPERATOR()), `${firstTier ? "已创建第一档" : "已新增一档"} · [${fmtInt(rangeFrom)}, ${fmtInt(to)}) · $${fmtInt(priceUSDT)}`);
      },
    });
  };

  const deleteTier = (tier: G4Tier, index: number) => {
    if (!canPriceTiers || !tiers || tiers.length <= 1) return;
    const prevTier = tiers[index - 1];
    const nextTier = tiers[index + 1];
    openActionConfirm({
      action: `删除价格档位 · ${tier.id}`,
      detail: <>删除 <b>{tier.id}</b> 档（{fmtInt(tier.from)}–{fmtInt(tier.to)}）。空出来的区间会自动补上（{prevTier ? <>上一档 <b>{prevTier.id}</b> 的截止延长到 {fmtInt(tier.to)}</> : nextTier ? <>下一档 <b>{nextTier.id}</b> 的起点提前到 {fmtInt(tier.from)}</> : "只剩一档时不能删"}），至少保留一档。已下单的按下单时价格结算。</>,
      run: async (reason) => {
        await mutate(`tier:delete:${tier.id}`, () => deleteG4GenesisTier(tier.id, overview.tiersVersion, reason, OPERATOR()), `档位 ${tier.id} 已删除`);
      },
    });
  };

  const supplyParam = paramByKey(overview, "supply");
  const priceParam = paramByKey(overview, "price");
  const dividendParam = paramByKey(overview, "dividend");
  const royaltyParam = paramByKey(overview, "royalty");
  const divBaseParam = paramByKey(overview, "divBase");
  const airdropPctParam = paramByKey(overview, "airdropPct");
  const emissionCurveParam = paramByKey(overview, "emissionCurve");
  const airdropLockDaysParam = paramByKey(overview, "airdropLockDays");
  const showcaseEnabledParam = paramByKey(overview, "showcaseEnabled");
  const legacyPriceText = priceParam?.displayValue || (stats.unitPrice > 0 ? fmtUsd(stats.unitPrice, 0) : "旧单价未设置");
  const tierPriceText = overview.tierPrice.status === "active" ? fmtUsd(overview.tierPrice.tier.priceUSDT, 0)
    : overview.tierPrice.status === "legacy" ? legacyPriceText
      : overview.tierPrice.status === "soldout" ? "已售罄" : "暂无价格";
  const tierPriceNote = overview.tierPrice.status === "active"
    ? `当前档 ${overview.tierPrice.tier.id}（${fmtNumber(overview.tierPrice.tier.from, 0)}–${fmtNumber(overview.tierPrice.tier.to, 0)}）· 还剩 ${fmtNumber(stats.unsold, 0)} 张`
    : overview.tierPrice.status === "legacy" ? "没有价格档位 · 使用旧单价"
      : overview.tierPrice.status === "soldout" ? "所有档位都已售罄"
        : "价格档位数据有误，暂时无法显示价格";

  const toggleShowcase = () => {
    if (!showcaseEnabledParam || !allowed(paramAuthority(showcaseEnabledParam.key))) return;
    const next = showcaseEnabledParam.value !== "true";
    openActionConfirm({
      action: next ? "显示创世节点商城入口" : "隐藏创世节点商城入口",
      detail: <>只控制 App 商城里是否显示入口，不影响持仓、收益、市场状态、紧急暂停和购买资格。</>,
      run: async (reason) => {
        await mutate("param:showcaseEnabled", () => updateG4GenesisParam(
          "showcaseEnabled", String(next), reason, OPERATOR(),
        ), next ? "创世节点商城入口已显示" : "创世节点商城入口已隐藏");
      },
    });
  };

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>操作提示 · {error}</div>}
      {!overview.catalogAvailable && <div className="gtint" role="status" style={{ marginBottom: 12 }}>
        <b>创世节点设置不完整</b>：{catalogBlockText(overview.tradeBlockedReason)}。目前不能交易；
        {overview.seriesRecoveryRequired
          ? " 已有用户持仓，不能重新发布系列。请联系数据负责人恢复原系列，核对无误后再开放市场。"
          : overview.seriesInitializationAvailable
            ? " 还没有节点系列，可以按现有价格档位发布。"
            : overview.seriesSetupRequired && overview.tradeBlockedReason === "GENESIS_TIERS_UNAVAILABLE"
              ? " 还没有价格档位，请先创建第一档，再发布系列。"
              : " 节点系列和价格档位对不上，请先修正。"}
        {overview.seriesInitializationAvailable && allowed("finprod_g4_write") && (
          <button className="l-btn sm mc" style={{ marginLeft: 10 }} disabled={busy} onClick={initializeSeries}>发布系列</button>
        )}
        {overview.seriesSetupRequired && !overview.seriesRecoveryRequired
          && overview.tradeBlockedReason === "GENESIS_TIERS_UNAVAILABLE" && canPriceTiers && tiers && (
          <button className="l-btn sm mc" style={{ marginLeft: 10 }} disabled={busy} onClick={addTier}>创建第一档</button>
        )}
      </div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">已售出</div><div className="v">{fmtNumber(stats.sold, 0)} / {fmtNumber(stats.totalSlots, 0)}</div><div className="sub">{tierPriceText}{overview.tierPrice.status === "active" ? " / 张 · " : " · "}{tierPriceNote}</div></div>
        <div className="f-stat"><div className="k">预计要发的收益</div><div className="v">{fmtUsdCompact(stats.genesisAccrualUsd)}</div><div className="sub">开始发放收益后按实际规则计算</div></div>
        <div className="f-stat cyan"><div className="k">转让最低价</div><div className="v">{fmtUsdCompact(stats.secondary.floor)}</div><div className="sub">24 小时成交 {fmtUsdCompact(stats.secondary.vol24h)} · 挂售中 {fmtNumber(stats.secondary.listed, 0)}</div></div>
        <div className="f-stat warn"><div className="k">紧急暂停</div><div className="v">{marketOn ? "未暂停" : "已暂停"}</div><div className="sub">恢复请去「紧急停用开关」</div></div>
        {/* 🔴 与熔断分成两格,不合并(规格 FEAT-GEN10b ④)。sub 行明示**当前真正在生效的
            是哪一道限制** —— 两者可并存,运营把市场切回开放却仍卖不动时,得一眼看出是熔断。 */}
        <div className={`f-stat${marketClosed ? " warn" : ""}`}>
          <div className="k">创世市场状态</div>
          <div className="v">{marketClosed ? "暂未开放" : "开放中"}</div>
          {/* 🔴 优先级必须与前端 `genesisPurchaseBlock` 的链**一致**:市场关闭 > 熔断。
              上一版这里写反了(写成熔断优先),两者并存时用户实际看到的是「暂未开放」,
              运营照着这行字会误判(2026-08-05 独立验收 P1-8)。同仓 g4-client.ts 的注释
              当时是对的 —— 页面与自己的注释矛盾,更该改页面。 */}
          <div className="sub">
            {marketClosed
              ? (marketOn
                  ? "用户能浏览和查看持仓，但不能购买和转让"
                  : "市场关闭和紧急暂停同时生效；App 显示「暂未开放」。两个都解除才能恢复销售")
              : !marketOn
                ? "目前处于紧急暂停，恢复请去「紧急停用开关」"
                : !(stats.totalSlots > 0)
                  ? "市场已开放，但节点系列设置不完整，用户可能买不了"
                  : "市场已开放；用户能否认购还要看系列、预售、资格和余额"}
            {/* 🔴 规格 ②/⑤ 点名「当前状态 + 最近一次变更信息」两件都要;此前只有状态没有
                变更信息(独立验收 confirmed P1:J1/J2/A3 等同类高敏闸都实现了这一格,
                G4 是孤例缺失)。空 = 服务端尚无审计记录(如本地预览)。 */}
            <br />最近修改：{overview.market.lastChange || "暂无记录"}
          </div>
        </div>
      </div>

      <G4AdminOperations ctx={ctx} />


      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">节点经济参数</span>
            <span className="sub">· 节点数量、价格和收益设置</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 2 }}>售出进度 {fmtNumber(stats.sold, 0)} / {fmtNumber(stats.totalSlots, 0)}</div>
              <div className="sold"><i style={{ width: `${soldPct}%` }} /></div>
            </div>
            {supplyParam && <div className="p-row"><div className="txt"><div className="k">节点总量</div><div className="s">{operatorCopyText(supplyParam.sub)}</div></div><span className="v">{operatorCopyText(supplyParam.displayValue)}</span>{allowed(paramAuthority(supplyParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${supplyParam.name}`} onClick={() => adjustParam(supplyParam)}>调整</button>}</div>}
            {priceParam && <div className="p-row"><div className="txt"><div className="k">单价{tiers && <span className="bdg ok" style={{ fontSize: 9, marginLeft: 6 }}>按价格档位</span>}</div><div className="s">{overview.tierPrice.status === "active" ? "已设置价格档位，单价按卖到第几张自动决定，这里的值不生效。改价请用下方「价格档位」" : tierPriceNote}</div></div><span className="v">{tierPriceText}</span>{overview.tierPrice.status === "legacy" && allowed(paramAuthority(priceParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${priceParam.name}`} onClick={() => adjustParam(priceParam)}>调整</button>}</div>}
            {dividendParam && <div className="p-row"><div className="txt"><div className="k">每日收益率 <span className="bdg ok" style={{ fontSize: 9 }}>基准 0.1%/日</span></div><div className="s">{operatorCopyText(dividendParam.sub)}</div></div><span className="v">{operatorCopyText(dividendParam.displayValue)}</span>{allowed(paramAuthority(dividendParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${dividendParam.name}`} onClick={() => adjustParam(dividendParam)}>调整</button>}</div>}
            {royaltyParam && <div className="p-row"><div className="txt"><div className="k">转让版税</div><div className="s">{operatorCopyText(royaltyParam.sub)}</div></div><span className="v">{operatorCopyText(royaltyParam.displayValue)}</span>{allowed(paramAuthority(royaltyParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${royaltyParam.name}`} onClick={() => adjustParam(royaltyParam)}>调整</button>}</div>}
            <div className="p-row"><div className="txt"><div className="k">开始发放收益 <span className="bdg ok" style={{ fontSize: 9 }}>跟随运营阶段</span></div><div className="s">上交易所前不发放；在「运营阶段设置」里控制，这里只能查看</div></div><span className="v">{overview.emissionGate.open ? "已开放" : "未开放"}</span></div>
            {airdropPctParam && <div className="p-row"><div className="txt"><div className="k">空投占比</div><div className="s">{operatorCopyText(airdropPctParam.sub)}</div></div><span className="v">{operatorCopyText(airdropPctParam.displayValue)}</span>{allowed(paramAuthority(airdropPctParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${airdropPctParam.name}`} onClick={() => adjustParam(airdropPctParam)}>调整</button>}</div>}
            {emissionCurveParam && <div className="p-row"><div className="txt"><div className="k">收益发放曲线</div><div className="s">{operatorCopyText(emissionCurveParam.sub)}</div></div><span className="v">{operatorCopyText(emissionCurveParam.displayValue).replace("TGE 10% · halve every 6 months", "初始发放 10%，每 6 个月减半")}</span>{allowed(paramAuthority(emissionCurveParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${emissionCurveParam.name}`} onClick={() => adjustParam(emissionCurveParam)}>调整</button>}</div>}
            {airdropLockDaysParam && <div className="p-row"><div className="txt"><div className="k">早期持有人奖励锁仓期</div><div className="s">{operatorCopyText(airdropLockDaysParam.sub)}</div></div><span className="v">{operatorCopyText(airdropLockDaysParam.displayValue)}</span>{allowed(paramAuthority(airdropLockDaysParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`调整 ${airdropLockDaysParam.name}`} onClick={() => adjustParam(airdropLockDaysParam)}>调整</button>}</div>}
            {showcaseEnabledParam && <div className="p-row"><div className="txt"><div className="k">App 商城入口</div><div className="s">{operatorCopyText(showcaseEnabledParam.sub)}</div></div><span className="v">{operatorCopyText(showcaseEnabledParam.displayValue)}</span>{allowed(paramAuthority(showcaseEnabledParam.key)) && <button className="l-btn sm mc" disabled={busy} aria-label={`切换 ${showcaseEnabledParam.name}`} onClick={toggleShowcase}>{showcaseEnabledParam.value === "true" ? "隐藏" : "展示"}</button>}</div>}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">认购与转让</span>
            <span className="sub">· 实时统计 · 节点转让后收益归新持有人</span>
            <div className="r">
              {/* 市场状态开关(FEAT-GEN10b):双向可切,两个方向都走确认 + 理由 + 审计。
                  与右侧熔断按钮并列摆放,让运营看得出这是两个独立动作。 */}
              {allowed("finprod_g4_market_toggle") && (
                <button className="l-btn mc" disabled={busy || (marketClosed && !overview.catalogAvailable)} onClick={runMarketOpenState}>
                  {marketClosed ? "恢复市场开放" : "设为暂未开放"}
                </button>
              )}
              {marketOn && allowed("finprod_g4_market_toggle")
                ? <button className="l-btn mc" disabled={busy} onClick={runMarketSwitch}>紧急暂停</button>
                : !marketOn ? <Link href="/emergency/kill-switch" className="l-btn">去「紧急停用开关」恢复</Link> : null}
              <Link href="/emergency/geo-block" className="l-btn">地区访问限制 →</Link>
            </div>
          </div>
          <div className="l-b">
            <div className="mk-tiles">
              <div className="t"><div className="k">最低挂售价</div><div className="v">{fmtUsdCompact(stats.secondary.floor)}</div></div>
              <div className="t"><div className="k">24 小时成交量</div><div className="v">{fmtUsdCompact(stats.secondary.vol24h)}</div></div>
              <div className="t"><div className="k">挂售中</div><div className="v">{fmtNumber(stats.secondary.listed, 0)}</div></div>
              <div className="t"><div className="k">持有人</div><div className="v">{fmtNumber(stats.secondary.owners, 0)}</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>节点状态</div>
            <div className="sm-strip">
              {overview.stateMachine.map((state, index) => (
                <span key={state} className={index <= 1 ? "st ok" : "st"}>{({minted:"已创建",held:"持有中",listed:"挂售中",sold:"已售出"} as Record<string,string>)[state] ?? "状态未知"}</span>
              ))}
            </div>
            <div className="gtint" style={{ marginTop: 12 }}><b>收益归属</b> · 当前封锁地区：{geoBlocked}（在「地区访问限制」修改）。节点转让后，收益归新持有人。</div>
          </div>
        </section>
      </div>

      {/* 阶梯档位定价(合并底账 §二#1 恢复):累计售出落 [起始, 截止) 决定当前档单价,售罄硬跳价。 */}
      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h">
          <span className="ttl">价格档位</span>
          <span className="sub">· 卖到哪一档就按哪一档的价格 · 一档卖完自动涨到下一档</span>
          {tiers && canPriceTiers && (
            <div className="r"><button className="l-btn sm mc" disabled={busy} onClick={addTier}>{tiers.length === 0 ? "+ 创建第一档" : "+ 新增档位"}</button></div>
          )}
        </div>
        {tiers ? (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 720 }}>
                <thead><tr><th>档位</th><th className="num">从第几张（含）</th><th className="num">到第几张（不含）</th><th className="num">单价 USDT</th>{canPriceTiers && <th style={{ textAlign: "right" }}>动作</th>}</tr></thead>
                <tbody>
                  {tiers.map((tier, index) => (
                    <tr key={tier.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{tier.id}{index === tiers.length - 1 && <span className="bdg ok" style={{ fontSize: 9, marginLeft: 6 }}>最后一档</span>}</td>
                      <td className="num mono">{fmtInt(tier.from)}</td>
                      <td className="num mono">{fmtInt(tier.to)}</td>
                      <td className="num mono" style={{ fontWeight: 700 }}>${fmtInt(tier.priceUSDT)}</td>
                      {canPriceTiers && (
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button className="l-btn sm mc" disabled={busy} aria-label={`编辑 ${tier.id}`} onClick={() => editTier(tier, index)}>编辑</button>{" "}
                          {/* 唯一档不渲染删档入口(禁用态仍暗示「某些条件下可删」,GEN11 同款纪律)。 */}
                          {tiers.length > 1
                            ? <button className="l-btn sm mc" style={{ color: "var(--danger)" }} disabled={busy} aria-label={`删除 ${tier.id}`} onClick={() => deleteTier(tier, index)}>删除</button>
                            : <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationExemption label="创世节点价格档位" maxRows={8} reason="档位很少，需要一屏对比各档价格。" />
            </div>
            <div className="gtint" style={{ margin: "0 12px 12px" }}><b>说明</b> · 改截止或单价、新增或删除档位，只影响以后的销售，已下单的按下单时价格结算。各档必须连续，最后一档总量不能少于已售的 {fmtNumber(stats.sold, 0)} 张，至少保留一档。两人同时修改时，后提交的人需要刷新后重改。</div>
          </>
        ) : (
          <div className="l-b">
            <div className="gtint">价格档位数据暂时无法加载，为避免改错，这里暂不提供新增、修改和删除。</div>
          </div>
        )}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">收益发放监控</span>
          <span className="sub">· 「运营阶段设置」开启后每天自动发放</span>
          <div className="r">
            {divBaseParam && allowed(paramAuthority(divBaseParam.key)) && <button className="l-btn mc" disabled={busy} onClick={() => adjustParam(divBaseParam)}>调整收益计算基数</button>}
            {allowed("finprod_g4_write") && <button className="l-btn" disabled={busy || !overview.emissionGate.open || !dividend.batchNo} onClick={runRerunBatch}>重新发放今日收益{batchRerun ? "（已重发）" : ""}</button>}
          </div>
        </div>
        <div className="l-b">
          <div className="mk-tiles">
            <div className="t"><div className="k">今日平台交易量（计算基数）</div><div className="v">{fmtUsdCompact(dividend.dailyVolumeBase)}</div></div>
            <div className="t"><div className="k">今日收益总额</div><div className="v" style={{ color: "var(--success)" }}>{fmtUsdCompact(dividend.poolToday)}</div></div>
            <div className="t"><div className="k">每个节点分到</div><div className="v">{fmtUsd(dividend.perSlotPerDay)} / 天</div></div>
            <div className="t"><div className="k">今日发放 {dividend.batchNo || "—"}</div><div className="v" style={{ color: "var(--success)" }}>{overview.emissionGate.open ? `已发 ${fmtNumber(stats.sold, 0)} 个节点 · ${fmtUsdCompact(dividend.payoutToday)}` : "未开始发放"}</div></div>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>两种算法</b> · 用户实际收益按当前参数计算；财务预估按「节点价 × 持有量 × 收益率」保底。曲线只是策略说明，每天实际发多少仍按计算基数和收益率。修改收益率、曲线或计算基数时，覆盖率不足会无法保存（当前 {cov}%）。</div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">节点持有记录</span>
          <span className="sub">· 点击查看详情</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>节点</th><th>持有人（已隐藏敏感信息）</th><th>来源</th><th className="num">累计产出</th><th>状态</th></tr></thead>
            <tbody>
              {overview.nodes.length === 0 ? (
                <tr><td colSpan={5} style={{ color: "var(--ink-3)", padding: 16 }}>暂无节点持有记录</td></tr>
              ) : overview.nodes.map((node) => (
                <tr key={node.id} className="click" onClick={() => setNodeDrawer(node.id)}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{node.id} <span className="more">详情›</span></td>
                  <td className="mono">{node.owner}</td>
                  <td>{operatorCopyText(node.source)}</td>
                  <td className="num mono">{node.lifetimeDividend}</td>
                  <td><span className={`bdg ${toneClass(node.statusTone)}`}>{operatorCopyText(node.statusLabel)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px 14px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            第 {fmtNumber(nodePage.page, 0)} / {fmtNumber(nodePage.totalPages, 0)} 页 · 共 {fmtNumber(nodePage.total, 0)} 条
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              aria-label="节点持有记录每页条数"
              value={nodePage.pageSize}
              disabled={loading || busy}
              onChange={(event) => changeNodePageSize(event.target.value)}
              style={{ height: 30, borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", padding: "0 8px", fontSize: 12 }}
            >
              {[10, 20, 50].map((size) => (
                <option value={size} key={size}>{size} 条 / 页</option>
              ))}
            </select>
            <button className="l-btn sm" disabled={loading || busy || !nodePage.hasPrev} onClick={() => loadNodePage(nodePage.page - 1)}>上一页</button>
            <button className="l-btn sm" disabled={loading || busy || !nodePage.hasNext} onClick={() => loadNodePage(nodePage.page + 1)}>下一页</button>
          </div>
        </div>
      </section>

      <p className="f-foot">节点持有、收益和转让记录都由系统统一记账。</p>

      {selectedNode && <NodeDrawer node={selectedNode} onClose={() => setNodeDrawer(null)} />}
    </>
  );
}

function NodeDrawer({ node, onClose }: { node: G4Node; onClose: () => void }) {
  return (
    <Drawer title={`创世节点 · ${node.id}`} sub={`持有人 ${node.owner} · ${operatorCopyText(node.statusLabel)} · 购入:${operatorCopyText(node.buy)}`} onClose={onClose}
      footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>关闭</button>}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>收益</div>
      {node.dividends.map((item) => (
        <div className="kv2" key={item.label}><span className="k">{operatorCopyText(item.label)}</span><span className="v">{operatorCopyText(item.value)}</span></div>
      ))}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>转让记录</div>
      <table className="l-tbl">
        <thead><tr><th>时间</th><th>事件</th><th>版税</th></tr></thead>
        <tbody>{node.transfers.map((transfer, index) => (
          <tr key={`${transfer.time}-${index}`}><td className="mono">{transfer.time}</td><td style={{ fontSize: 12 }}>{operatorCopyText(transfer.event)}</td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{operatorCopyText(transfer.royalty)}</td></tr>
        ))}</tbody>
      </table>
      <div className="gtint" style={{ marginTop: 12 }}><b>只能查看</b> · 节点信息和收益由系统自动计算。</div>
    </Drawer>
  );
}
