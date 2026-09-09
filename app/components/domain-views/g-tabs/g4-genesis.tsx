"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G4 Genesis 经济 — 数据来自后端 /api/admin/market/nex/genesis 及 Genesis 业务表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Drawer, PaginationExemption } from "../design-kit";
import {
  createG4GenesisTier,
  deleteG4GenesisTier,
  fetchG4GenesisOverview,
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
      toast(`G4 操作失败 · ${message}`);
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
        <div className="l-h"><span className="ttl">G4 Genesis 经济</span><span className="sub">· 正在读取真实接口数据</span></div>
        <div className="l-b"><div className="gtint">G4 数据加载中...</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G4 Genesis 经济</span><span className="sub">· 真实接口数据</span></div>
        <div className="l-b">
          <div className="gtint">G4 数据加载失败 · {error || "未收到本页数据，请重试；持续失败时请联系值班人员。"}</div>
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
      action: `Genesis 经济参数 · ${param.name}`,
      detail: <><b>{param.name}</b> · 当前 {param.displayValue} · {param.note}<br />B1 当前覆盖率 {cov}%，提交时后端重新预检增量负债。</>,
      amplifies: param.b1RedlineTriggered,
      edit: numeric ? { kind: "number", current: paramEditValue(param), ...bounds } : { kind: "text", current: paramEditValue(param) },
      businessForm: needsDecision ? { kind: "multi-field", title: "产品决议与负债依据", fields: [
        { key: "decisionRef", label: "PM/财务决议编号", current: "", inputKind: "text", required: true },
      ] } : undefined,
      run: async (reason, value, businessValue) => {
        if (!value) return;
        await mutate(`param:${param.key}`, () => updateG4GenesisParam(
          param.key, String(value), reason, OPERATOR(), businessValue?.decisionRef,
        ), `${param.name}已立即生效`);
      },
    });
  };

  const runMarketSwitch = () => {
    if (!marketOn || !allowed("finprod_g4_market_toggle")) return;
    openActionConfirm({
      action: "一二级市场熔断",
      detail: <>立即停止一级购买、挂单与内部 P2P 成交，联动 {overview.market.linkedDomain}。恢复只能前往 J1。</>,
      amplifies: false,
      businessForm: { kind: "multi-field", title: "熔断上下文", fields: [
        { key: "triggerBasis", label: "触发依据", current: "", inputKind: "text", required: true },
        { key: "dispositionPlan", label: "存量权益处置计划", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate("market:pause", () => updateG4GenesisMarketStatus(false, reason, OPERATOR(), {
          triggerBasis: businessValue?.triggerBasis, dispositionPlan: businessValue?.dispositionPlan,
        }), "Genesis 市场已立即熔断；恢复入口仅在 J1");
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
    openActionConfirm({
      action: next === "closed" ? "创世市场设为「暂未开放」" : "恢复创世市场开放",
      detail: next === "closed"
        // JSX 文本里的 ** 会原样渲染成星号(这是 React 不是 Markdown),要加粗用 <b>。
        ? <>前端<b>照常展示</b>创世节点介绍、档位与权益,仅锁购买与二级承接;已持有的节点、分红与权益不受影响。<br />不下架商城入口(那是另一个开关),也不显示倒计时或剩余名额。</>
        : <>恢复后用户下次进入或刷新即可正常认购,无需清缓存。<br />恢复销售会放大资金流出方向,故与关闭同样需要确认与理由。</>,
      amplifies: next === "open", // 恢复销售 = 放大流出方向,不豁免
      // 🔴 文案变体必须是**下拉**,不是自由输入(规格 ③/⑥ 明写「禁自由文本」)。
      //   上一版用了 inputKind:"text" —— 打错一个字符前端会静默回退到默认文案,
      //   运营以为切了「维护中」,用户看到的却是「暂未开放」(2026-08-05 独立验收 P1-9)。
      //   选项集合与前端 GENESIS_CLOSED_NOTICE_KEYS 白名单一一对应;仓内 select 能力现成
      //   (c2-actions.tsx 同款),不必新造。
      businessForm: next === "closed" ? { kind: "multi-field", title: "关闭说明", fields: [
        {
          key: "noticeKey",
          label: "用户端提示文案",
          inputKind: "select",
          required: true,
          current: overview.market.closedNoticeKey || "default",
          options: ["default", "maintenance", "phase_control", "compliance"],
          optionLabels: {
            default: "当前市场暂未开放",
            maintenance: "系统维护中,暂停认购",
            phase_control: "当前阶段暂不开放认购",
            compliance: "合规复核中,暂停认购",
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
          next === "closed" ? "创世市场已设为暂未开放;前端仍可浏览,购买已锁" : "创世市场已恢复开放",
        );
      },
    });
  };

  const runRerunBatch = () => {
    if (!allowed("finprod_g4_write")) return;
    openActionConfirm({
      action: `重跑今日排放批次 ${dividend.batchNo}`,
      detail: "批次按日期带持久防重号；已成功户不会重复发，只补失败项。服务端逐持有人写 D4 账单。",
      businessForm: { kind: "multi-field", title: "批次决议", fields: [
        { key: "decisionRef", label: "财务/PM 决议编号", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate(`batch:${dividend.batchNo}`, () => rerunG4GenesisDividendBatch(
          dividend.batchNo, reason, OPERATOR(), businessValue?.decisionRef,
        ), "排放批次已立即重跑，仅补失败项");
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
    if (!Number.isInteger(to) || !Number.isInteger(priceUSDT)) throw new Error("截止与单价须为整数");
    return { to, priceUSDT };
  };

  const editTier = (tier: G4Tier, index: number) => {
    if (!canPriceTiers || !tiers) return;
    const nextTier = tiers[index + 1];
    openActionConfirm({
      action: `编辑创世档位 · ${tier.id}`,
      detail: <><b>{tier.id}</b> 档 · 当前区间 [{fmtInt(tier.from)}, {fmtInt(tier.to)}) · 单价 ${fmtInt(tier.priceUSDT)}。起始由上档截止派生,不单独编辑;改截止时服务端顺移{nextTier ? <>下一档 <b>{nextTier.id}</b> 的起始</> : "总供应上界"}保持连续,并校验末档总量 ≥ 已售 {fmtNumber(stats.sold, 0)}。只影响未来供应与新购档价,在锁购买按开锁档价结算。</>,
      businessForm: { kind: "multi-field", title: `档位 ${tier.id}`, hint: "截止 = 本档累计售出上界(下一档起点);单价 = 落在本档区间的每张价格;均为整数。", fields: [
        { key: "to", label: "截止(累计售出上界)", current: String(tier.to), inputKind: "number", min: tier.from + 1, step: 1, required: true },
        { key: "priceUSDT", label: "单价(USDT)", current: String(tier.priceUSDT), inputKind: "number", min: 1, step: 1, required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        const { to, priceUSDT } = requireTierInts(businessValue);
        await mutate(`tier:update:${tier.id}`, () => updateG4GenesisTier(tier.id, to, priceUSDT, overview.tiersVersion, reason, OPERATOR()), `档位 ${tier.id} 已更新为 [${fmtInt(tier.from)}, ${fmtInt(to)}) · $${fmtInt(priceUSDT)}`);
      },
    });
  };

  const addTier = () => {
    if (!canPriceTiers || !tiers || tiers.length === 0) return;
    const lastTier = tiers[tiers.length - 1];
    openActionConfirm({
      action: "增开创世档位",
      detail: <>在末档 <b>{lastTier.id}</b>(截止 {fmtInt(lastTier.to)})之后追加新档:起始固定 = {fmtInt(lastTier.to)}(服务端派生保持连续),档号由服务端分配,扩大总供应。<b>扩大供应会放大远期排放负债</b>,服务端按 B1 覆盖率预检(当前 {cov}%),越线整单拒绝。新档单价通常应 ≥ 末档 ${fmtInt(lastTier.priceUSDT)}(售罄跳价方向);只影响未来供应。</>,
      amplifies: overview.coverage.redlineBreached,
      businessForm: { kind: "multi-field", title: "新档位", hint: `起始固定 = ${fmtInt(lastTier.to)}(上档截止);截止与单价均为整数。`, fields: [
        { key: "to", label: "截止(累计售出上界)", inputKind: "number", min: lastTier.to + 1, step: 1, required: true },
        { key: "priceUSDT", label: "单价(USDT)", inputKind: "number", min: 1, step: 1, required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        const { to, priceUSDT } = requireTierInts(businessValue);
        await mutate("tier:create", () => createG4GenesisTier(to, priceUSDT, overview.tiersVersion, reason, OPERATOR()), `已增开新档 · [${fmtInt(lastTier.to)}, ${fmtInt(to)}) · $${fmtInt(priceUSDT)}`);
      },
    });
  };

  const deleteTier = (tier: G4Tier, index: number) => {
    if (!canPriceTiers || !tiers || tiers.length <= 1) return;
    const prevTier = tiers[index - 1];
    const nextTier = tiers[index + 1];
    openActionConfirm({
      action: `删除创世档位 · ${tier.id}`,
      detail: <>从阶梯移除 <b>{tier.id}</b> 档([{fmtInt(tier.from)}, {fmtInt(tier.to)}))。服务端自动补齐区间保持连续({prevTier ? <>上一档 <b>{prevTier.id}</b> 截止顺延至 {fmtInt(tier.to)}</> : nextTier ? <>下一档 <b>{nextTier.id}</b> 起始归至 {fmtInt(tier.from)}</> : "唯一档不可删"}),至少保留一档;在锁购买按开锁档价结算,不追溯。</>,
      run: async (reason) => {
        await mutate(`tier:delete:${tier.id}`, () => deleteG4GenesisTier(tier.id, overview.tiersVersion, reason, OPERATOR()), `档位 ${tier.id} 已删除 · 区间已补齐`);
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
  const legacyPriceText = priceParam?.displayValue || (stats.unitPrice > 0 ? fmtUsd(stats.unitPrice, 0) : "旧策略单价未下发");
  const tierPriceText = overview.tierPrice.status === "active" ? fmtUsd(overview.tierPrice.tier.priceUSDT, 0)
    : overview.tierPrice.status === "legacy" ? legacyPriceText
      : overview.tierPrice.status === "soldout" ? "已售罄" : "无当前报价";
  const tierPriceNote = overview.tierPrice.status === "active"
    ? `当前档 ${overview.tierPrice.tier.id} [${fmtNumber(overview.tierPrice.tier.from, 0)}, ${fmtNumber(overview.tierPrice.tier.to, 0)}) · 距售罄 ${fmtNumber(stats.unsold, 0)} 张`
    : overview.tierPrice.status === "legacy" ? "未启用阶梯档位 · 沿用旧策略单价"
      : overview.tierPrice.status === "soldout" ? "所有阶梯档位已售罄，无当前认购档"
        : "阶梯档位数据无效，不能展示当前认购报价";

  const toggleShowcase = () => {
    if (!showcaseEnabledParam || !allowed(paramAuthority(showcaseEnabledParam.key))) return;
    const next = showcaseEnabledParam.value !== "true";
    openActionConfirm({
      action: next ? "展示 Genesis 商城入口" : "隐藏 Genesis 商城入口",
      detail: <>该操作只控制正式 App 的商城展示入口，不改变现有持仓、分红、市场状态、熔断状态或购买资格。</>,
      run: async (reason) => {
        await mutate("param:showcaseEnabled", () => updateG4GenesisParam(
          "showcaseEnabled", String(next), reason, OPERATOR(),
        ), next ? "Genesis 商城入口已展示" : "Genesis 商城入口已隐藏");
      },
    });
  };

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>G4 操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">一级售出</div><div className="v">{fmtNumber(stats.sold, 0)} / {fmtNumber(stats.totalSlots, 0)}</div><div className="sub">{tierPriceText}{overview.tierPrice.status === "active" ? " / 张 · " : " · "}{tierPriceNote}</div></div>
        <div className="f-stat"><div className="k">排放承诺预提</div><div className="v">{fmtUsdCompact(stats.genesisAccrualUsd)}</div><div className="sub">上所开阀后按真实策略计提</div></div>
        <div className="f-stat cyan"><div className="k">二级地板价</div><div className="v">{fmtUsdCompact(stats.secondary.floor)}</div><div className="sub">24h 量 {fmtUsdCompact(stats.secondary.vol24h)} · 在挂 {fmtNumber(stats.secondary.listed, 0)}</div></div>
        <div className="f-stat warn"><div className="k">市场熔断</div><div className="v">{marketOn ? "未启用" : "已熔断"}</div><div className="sub">联动 {overview.market.linkedDomain} · 恢复统一由 J1 执行</div></div>
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
                  ? "用户可浏览与查看持仓,购买与二级承接已锁"
                  : "市场关闭与熔断同时生效;用户端显示的是「暂未开放」(它优先级更高),恢复销售需两者都解除")
              : !marketOn
                ? "当前实际生效:市场熔断,恢复走 J1"
                : "购买链路正常"}
            {/* 🔴 规格 ②/⑤ 点名「当前状态 + 最近一次变更信息」两件都要;此前只有状态没有
                变更信息(独立验收 confirmed P1:J1/J2/A3 等同类高敏闸都实现了这一格,
                G4 是孤例缺失)。空 = 服务端尚无审计记录(如本地预览)。 */}
            <br />最近变更:{overview.market.lastChange || "暂无记录"}
          </div>
        </div>
      </div>

      <G4AdminOperations ctx={ctx} />


      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">节点经济参数</span>
            <span className="sub">· 来自服务端策略 + 创世系列业务表</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 2 }}>一级售出进度 {fmtNumber(stats.sold, 0)} / {fmtNumber(stats.totalSlots, 0)}</div>
              <div className="sold"><i style={{ width: `${soldPct}%` }} /></div>
            </div>
            {supplyParam && <div className="p-row"><div className="txt"><div className="k">节点总量</div><div className="s">{supplyParam.sub}</div></div><span className="v">{supplyParam.displayValue}</span>{allowed(paramAuthority(supplyParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(supplyParam)}>调整</button>}</div>}
            {priceParam && <div className="p-row"><div className="txt"><div className="k">一级单价{tiers && <span className="bdg ok" style={{ fontSize: 9, marginLeft: 6 }}>按阶梯派生</span>}</div><div className="s">{overview.tierPrice.status === "active" ? "阶梯档位在场:单价由累计售出所落档位派生,本参数不生效;调价走下方「阶梯档位定价」卡" : tierPriceNote}</div></div><span className="v">{tierPriceText}</span>{overview.tierPrice.status === "legacy" && allowed(paramAuthority(priceParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(priceParam)}>调整</button>}</div>}
            {dividendParam && <div className="p-row"><div className="txt"><div className="k">每日排放率 <span className="bdg ok" style={{ fontSize: 9 }}>基准 0.1%/日</span></div><div className="s">{dividendParam.sub}</div></div><span className="v">{dividendParam.displayValue}</span>{allowed(paramAuthority(dividendParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(dividendParam)}>调整</button>}</div>}
            {royaltyParam && <div className="p-row"><div className="txt"><div className="k">二级版税</div><div className="s">{royaltyParam.sub}</div></div><span className="v">{royaltyParam.displayValue}</span>{allowed(paramAuthority(royaltyParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(royaltyParam)}>调整</button>}</div>}
            <div className="p-row"><div className="txt"><div className="k">排放开阀 <span className="bdg ok" style={{ fontSize: 9 }}>H1 权威</span></div><div className="s">上所前关闭；由 H1 逐月节奏旋钮控制，本页只读</div></div><span className="v">{overview.emissionGate.open ? "已开放" : "未开放"}</span></div>
            {airdropPctParam && <div className="p-row"><div className="txt"><div className="k">空投占比</div><div className="s">{airdropPctParam.sub}</div></div><span className="v">{airdropPctParam.displayValue}</span>{allowed(paramAuthority(airdropPctParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(airdropPctParam)}>调整</button>}</div>}
            {emissionCurveParam && <div className="p-row"><div className="txt"><div className="k">排放曲线</div><div className="s">{emissionCurveParam.sub}</div></div><span className="v">{emissionCurveParam.displayValue}</span>{allowed(paramAuthority(emissionCurveParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(emissionCurveParam)}>调整</button>}</div>}
            {airdropLockDaysParam && <div className="p-row"><div className="txt"><div className="k">OG 倍率锁仓期</div><div className="s">{airdropLockDaysParam.sub}</div></div><span className="v">{airdropLockDaysParam.displayValue}</span>{allowed(paramAuthority(airdropLockDaysParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(airdropLockDaysParam)}>调整</button>}</div>}
            {showcaseEnabledParam && <div className="p-row"><div className="txt"><div className="k">App 商城展示</div><div className="s">{showcaseEnabledParam.sub}</div></div><span className="v">{showcaseEnabledParam.displayValue}</span>{allowed(paramAuthority(showcaseEnabledParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={toggleShowcase}>{showcaseEnabledParam.value === "true" ? "隐藏" : "展示"}</button>}</div>}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">一二级市场</span>
            <span className="sub">· 实时 stats · 排放跟随 NFT</span>
            <div className="r">
              {/* 市场状态开关(FEAT-GEN10b):双向可切,两个方向都走确认 + 理由 + 审计。
                  与右侧熔断按钮并列摆放,让运营看得出这是两个独立动作。 */}
              {allowed("finprod_g4_market_toggle") && (
                <button className="l-btn mc" disabled={busy} onClick={runMarketOpenState}>
                  {marketClosed ? "恢复市场开放" : "设为暂未开放"}
                </button>
              )}
              {marketOn && allowed("finprod_g4_market_toggle")
                ? <button className="l-btn mc" disabled={busy} onClick={runMarketSwitch}>市场熔断</button>
                : !marketOn ? <Link href="/emergency/kill-switch" className="l-btn">前往 J1 申请恢复</Link> : null}
              <Link href="/emergency/geo-block" className="l-btn">地域封锁(J2)→</Link>
            </div>
          </div>
          <div className="l-b">
            <div className="mk-tiles">
              <div className="t"><div className="k">地板价</div><div className="v">{fmtUsdCompact(stats.secondary.floor)}</div></div>
              <div className="t"><div className="k">24h 成交量</div><div className="v">{fmtUsdCompact(stats.secondary.vol24h)}</div></div>
              <div className="t"><div className="k">在挂</div><div className="v">{fmtNumber(stats.secondary.listed, 0)}</div></div>
              <div className="t"><div className="k">持有人</div><div className="v">{fmtNumber(stats.secondary.owners, 0)}</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>节点状态机</div>
            <div className="sm-strip">
              {overview.stateMachine.map((state, index) => (
                <span key={state} className={index <= 1 ? "st ok" : "st"}>{state}</span>
              ))}
            </div>
            <div className="gtint" style={{ marginTop: 12 }}><b>排放与负债</b> · 当前地域封锁:{geoBlocked}(J2 只读)。二级转让后排放权益跟随最新持有者，节点台账来自持有表。</div>
          </div>
        </section>
      </div>

      {/* 阶梯档位定价(合并底账 §二#1 恢复):累计售出落 [起始, 截止) 决定当前档单价,售罄硬跳价。 */}
      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h">
          <span className="ttl">阶梯档位定价</span>
          <span className="sub">· 累计售出落 [起始, 截止) 决定当前档单价 · 售罄硬跳价 · 服务端权威校验</span>
          {tiers && canPriceTiers && (
            <div className="r"><button className="l-btn sm mc" disabled={busy} onClick={addTier}>+ 增开档位</button></div>
          )}
        </div>
        {tiers ? (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 720 }}>
                <thead><tr><th>档位</th><th className="num">起始(含)</th><th className="num">截止(不含)</th><th className="num">单价 USDT</th>{canPriceTiers && <th style={{ textAlign: "right" }}>动作</th>}</tr></thead>
                <tbody>
                  {tiers.map((tier, index) => (
                    <tr key={tier.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{tier.id}{index === tiers.length - 1 && <span className="bdg ok" style={{ fontSize: 9, marginLeft: 6 }}>末档</span>}</td>
                      <td className="num mono">{fmtInt(tier.from)}</td>
                      <td className="num mono">{fmtInt(tier.to)}</td>
                      <td className="num mono" style={{ fontWeight: 700 }}>${fmtInt(tier.priceUSDT)}</td>
                      {canPriceTiers && (
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button className="l-btn sm mc" disabled={busy} onClick={() => editTier(tier, index)}>编辑</button>{" "}
                          {/* 唯一档不渲染删档入口(禁用态仍暗示「某些条件下可删」,GEN11 同款纪律)。 */}
                          {tiers.length > 1
                            ? <button className="l-btn sm mc" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => deleteTier(tier, index)}>删档</button>
                            : <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationExemption label="Genesis 阶梯档位表" maxRows={8} reason="阶梯档位数量少且需一屏纵向比较跳价关系,分页会破坏连续区间审核。" />
            </div>
            <div className="gtint" style={{ margin: "0 12px 12px" }}><b>档价随累计售出派生</b> · 改截止/单价、增档、删档只影响未来供应;在锁购买按开锁档价结算不追溯。区间连续性、末档总量 ≥ 已售 {fmtNumber(stats.sold, 0)}、至少保留一档由服务端强制,不满足的提交会被整单拒绝;提交携带档表版本,两人并发修改时后提交的会被拒绝并需重读。</div>
          </>
        ) : (
          <div className="l-b">
            <div className="gtint">服务端尚未下发阶梯档位数据(后端未升级或数据坏形)· 为避免在错误数据上操作,本卡不提供增开/编辑/删除入口。</div>
          </div>
        )}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">排放派发监控</span>
          <span className="sub">· H1 开阀后按服务端排放参数执行</span>
          <div className="r">
            {divBaseParam && allowed(paramAuthority(divBaseParam.key)) && <button className="l-btn mc" disabled={busy} onClick={() => adjustParam(divBaseParam)}>调整基数口径</button>}
            {allowed("finprod_g4_write") && <button className="l-btn" disabled={busy || !overview.emissionGate.open || !dividend.batchNo} onClick={runRerunBatch}>重跑今日批次{batchRerun ? "(已重跑)" : ""}</button>}
          </div>
        </div>
        <div className="l-b">
          <div className="mk-tiles">
            <div className="t"><div className="k">平台日交易量基数(今日)</div><div className="v">{fmtUsdCompact(dividend.dailyVolumeBase)}</div></div>
            <div className="t"><div className="k">今日排放池</div><div className="v" style={{ color: "var(--success)" }}>{fmtUsdCompact(dividend.poolToday)}</div></div>
            <div className="t"><div className="k">每 slot 均分</div><div className="v">{fmtUsd(dividend.perSlotPerDay)} / 天</div></div>
            <div className="t"><div className="k">今日批次 {dividend.batchNo || "—"}</div><div className="v" style={{ color: "var(--success)" }}>{overview.emissionGate.open ? `已派 ${fmtNumber(stats.sold, 0)} 户 · ${fmtUsdCompact(dividend.payoutToday)}` : "未开阀 · 未派发"}</div></div>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>两套口径</b> · 用户排放按服务端配置参数计算；财务预提按节点价 × 持有量 × 排放率保底。曲线字段是运营策略说明，当前批次金额仍按服务端基数与排放率计算。改排放率、曲线或基数口径会触发 B1 覆盖率预检，当前覆盖率 {cov}%。</div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">节点持有台账</span>
          <span className="sub">· 来自真实 Genesis 持仓 · 点击查看详情</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>节点</th><th>持有者(脱敏)</th><th>来源</th><th className="num">lifetime 排放</th><th>状态</th></tr></thead>
            <tbody>
              {overview.nodes.length === 0 ? (
                <tr><td colSpan={5} style={{ color: "var(--ink-3)", padding: 16 }}>暂无节点持有记录</td></tr>
              ) : overview.nodes.map((node) => (
                <tr key={node.id} className="click" onClick={() => setNodeDrawer(node.id)}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{node.id} <span className="more">详情›</span></td>
                  <td className="mono">{node.owner}</td>
                  <td>{node.source}</td>
                  <td className="num mono">{node.lifetimeDividend}</td>
                  <td><span className={`bdg ${toneClass(node.statusTone)}`}>{node.statusLabel}</span></td>
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
              aria-label="节点持有台账每页条数"
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

      <p className="f-foot"><b>持有、排放、二级成交全部以服务器为准</b>:节点序号、钱包和排放由权威台账统一核算，客户端伪造持有或排放无效。</p>

      {selectedNode && <NodeDrawer node={selectedNode} onClose={() => setNodeDrawer(null)} />}
    </>
  );
}

function NodeDrawer({ node, onClose }: { node: G4Node; onClose: () => void }) {
  return (
    <Drawer title={`Genesis 节点 · ${node.id}`} sub={`持有者 ${node.owner} · ${node.statusLabel} · 购入:${node.buy}`} onClose={onClose}
      footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>关闭</button>}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>排放</div>
      {node.dividends.map((item) => (
        <div className="kv2" key={item.label}><span className="k">{item.label}</span><span className="v">{item.value}</span></div>
      ))}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>二级流转记录</div>
      <table className="l-tbl">
        <thead><tr><th>时间</th><th>事件</th><th>版税</th></tr></thead>
        <tbody>{node.transfers.map((transfer, index) => (
          <tr key={`${transfer.time}-${index}`}><td className="mono">{transfer.time}</td><td style={{ fontSize: 12 }}>{transfer.event}</td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{transfer.royalty}</td></tr>
        ))}</tbody>
      </table>
      <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · 节点详情来自后端持有记录和排放口径计算。</div>
    </Drawer>
  );
}
