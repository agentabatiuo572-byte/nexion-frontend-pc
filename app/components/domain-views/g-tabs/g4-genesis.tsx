"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G4 创世节点销售与收益（改版，RdPage）— 数据来自后端 /api/admin/market/nex/genesis 及 Genesis 业务表。
 * 首屏回答：节点卖了多少、卖到哪一档；今天的分红发了没有；有没有压着的申请。下面按运营的任务分组：
 * 销售与价格、每日分红、市场与转让、空投与释放说明、认购与预售、模拟演练、持有记录。
 * 既有版式和请求合同保留；直接写与原申请恢复按G4命令记录接线。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowLeftRight, Banknote, CalendarClock, CircleHelp, Clock3, Coins, Database, Eye, Gift, Layers, ListOrdered, PauseCircle, Lock, CircleDot, Store, Users,
} from "lucide-react";
import {
  BlockState, Button, Cell, Change, KeepText, ConfigList, ConfigRow, Conclusion, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints, Notice,
  PageHeader, Pager, Panel, RdPage, ScaleBar, Stat, StatBand, StatusTag, StepBar, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import { OperationConfirmModal, PaginationExemption, useToast } from "../design-kit";
import {
  createG4GenesisTier,
  deleteG4GenesisTier,
  fetchG4DividendApprovalState,
  fetchG4GenesisOverview,
  fetchG4AdminOperations,
  retryG4DirectCommand,
  G4CatalogApprovalRequiredError,
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
import { useAdminAuth } from "@/lib/store/admin-auth";
import { configApprovalOriginalInput, pendingConfigApproval } from "@/lib/admin/withdrawal-config-approval";
import G4AdminOperations, { G4_CONFIGS, type G4ConfirmReq } from "./g4-admin-operations";
import { G4FirstDividendConfirm } from "./g4-first-dividend-confirm";
import { G4TierConfirm, hasPendingG4TierApproval, type G4TierChange } from "./g4-tier-confirm";
import { canRetryG4DirectCommand, g4DirectAuthority, g4DirectCommandExpired, g4DirectObject, listG4DirectCommands, subscribeG4DirectCommands, g4DirectCommandVersion, type G4DirectCommand } from "@/lib/admin/g4-direct-command";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { useGParamApproval } from "@/lib/admin/use-g-param-approval";
import { G4_PARAM_NAME, G4RecoveryNotice, g4Amount, g4ParamValueText, g4Plain, g4RecoveryTag, type G4ExtraRecovery } from "./g4-recovery";

const OPERATOR = currentAdminOperator;

function messageOf(error: unknown) {
  return displayAdminError(error);
}

function fmtNumber(value: number, max = 2) {
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

/** 后端拼好的金额文字里的 $：换成「数字 USDT」，不舍入。 */
function usdtText(value: string) {
  return operatorCopyText(value).replace(/\$(-?[\d,]*\d(?:\.\d+)?)/g, (_, num: string) => `${g4Amount(num.replace(/,/g, ""))} USDT`);
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

const STATE_LABEL: Record<string, string> = { minted: "已创建", held: "持有中", listed: "挂售中", sold: "已售出" };
const NOTICE_LABEL: Record<string, string> = {
  default: "当前市场暂未开放",
  maintenance: "系统维护中，暂停认购",
  phase_control: "当前阶段暂不开放认购",
  compliance: "合规审核中，暂停认购",
};

/** 每个参数的叫法、方向和后果。名字和旧页面参数行一致；方向和后端 G4ParamApproval / G4DividendPolicy 一致。 */
type ParamCopy = {
  what: string;
  loosen: string;
  tighten?: string;
  effect: string;
  money: string;
  hint?: string;
  unit?: string;
  /** 只保存说明，不执行。 */
  descriptive?: boolean;
};
const PARAM_COPY: Record<string, ParamCopy> = {
  supply: {
    what: "这个系列一共能卖多少张节点",
    loosen: "调高", tighten: "调低",
    effect: "最后一档的截止跟着改；不能低于已售数量，也要大于最后一档的起点。已下单的订单不变",
    money: "不直接付钱；调高后能多卖节点，之后每天要发的分红也会跟着多",
    unit: "张",
  },
  price: {
    what: "没有价格档位时用的旧单价",
    loosen: "调高", tighten: "调低",
    effect: "已持有的合格节点之后每天的分红按新单价算（分红 = 单价 × 每日收益比例）；已下单的订单价格不变",
    money: "不直接付钱；调高后存量节点每天要发的分红变多",
    hint: "0.01–1,000,000",
    unit: "USDT",
  },
  dividend: {
    what: "每个合格节点每天按「所属系列单价 × 这个比例」发收益",
    loosen: "调高", tighten: "调低",
    effect: "之后新建的分红批次按新比例算；已经建好的批次保留原比例和原金额",
    money: "不直接付钱；调高后之后每天要发的分红变多",
    hint: "0–5，单位 %/日",
    unit: "%/日",
  },
  royalty: {
    what: "用户之间转让节点成交时，从卖方金额里扣的手续费比例",
    loosen: "调低", tighten: "调高",
    effect: "只影响之后的转让成交，已成交的不重算；后端按整数基点（0.01%）比较方向",
    money: "不付钱；调低后平台少收手续费",
    hint: "0–20，单位 %",
    unit: "%",
  },
  airdropPct: {
    what: "给创世节点及其社区预留的释放份额",
    loosen: "改动",
    effect: "目前只保存这个说明，不会执行 UVT 发放或释放；已有权益不会因此到账",
    money: "不付钱",
    hint: "0–100，单位 %",
    unit: "%",
    descriptive: true,
  },
  emissionCurve: {
    what: "收益发放节奏的说明文字",
    loosen: "改动",
    effect: "目前只保存这段说明，不按它执行释放；每天的分红仍按「系列单价 × 每日收益比例」",
    money: "不付钱",
    hint: "160 字以内，不能写已退役的说法",
    descriptive: true,
  },
  airdropLockDays: {
    what: "早期持有人奖励的锁仓天数",
    loosen: "改动",
    effect: "目前只保存这个说明，不新建锁仓、不提前释放；调长调短都要批准",
    money: "不付钱",
    hint: "0–3,650 的整数",
    unit: "天",
    descriptive: true,
  },
  divBase: {
    what: "收益计算基数的说明文字",
    loosen: "改动",
    effect: "目前只保存这段说明，不按它计算；每天的分红仍按「系列单价 × 每日收益比例」，历史批次金额不变",
    money: "不付钱",
    hint: "160 字以内",
    descriptive: true,
  },
};

/** 只用于显示：按后端规则估这次是放宽、收紧还是不变。真正走哪条路由提交时的原逻辑和后端决定。 */
function paramDirection(key: string, current: string, value?: string): "loose" | "tight" | "same" | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (key === "divBase" || key === "emissionCurve") return value.trim() === current.trim() ? "same" : "loose";
  const scale = key === "supply" || key === "airdropLockDays" ? 0 : key === "price" ? 2 : 6;
  const normalize = (raw: string) => {
    const match = /^\+?(\d+)(?:\.(\d*))?$/.exec(raw.trim().replace(/[,%\s]/g, ""));
    if (!match) return undefined;
    const fraction = match[2] ?? "";
    return BigInt(match[1] + fraction.slice(0, scale).padEnd(scale, "0"))
      + (Number(fraction[scale] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
  };
  let next = normalize(value);
  let now = normalize(current);
  if (next === undefined || now === undefined) return undefined;
  if (key === "airdropPct" || key === "airdropLockDays") {
    const digits = next.toString().padStart(scale + 1, "0");
    const normalized = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits;
    return current.trim() === normalized ? "same" : "loose";
  }
  if (key === "royalty") { next = (next + BigInt(5000)) / BigInt(10000); now = (now + BigInt(5000)) / BigInt(10000); }
  if (next === now) return "same";
  if (key === "royalty") return next < now ? "loose" : "tight";
  return next > now ? "loose" : "tight";
}

export function G4Genesis() {
  return <RdPage className="g4x"><G4GenesisPage /></RdPage>;
}

function G4GenesisPage() {
  const reach = useReach();
  const [, toast] = useToast();
  const [mc, openActionConfirm] = useState<G4ConfirmReq | null>(null);
  const ctx = useMemo(() => ({ toast, openActionConfirm }), [toast]);
  const session = useAdminAuth((state) => state.session);
  const epoch = useAdminAuth((state) => state.authEpoch);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const paramAuthority = (key: string) => key === "price" ? "finprod_g4_price_write"
    : key === "dividend" ? "finprod_g4_dividend_rate_write"
      : key === "royalty" ? "finprod_g4_royalty_write"
        : key === "airdropPct" ? "finprod_g4_airdrop_pct_write"
          : key === "emissionCurve" ? "finprod_g4_emission_curve_write"
            : key === "airdropLockDays" ? "finprod_g4_airdrop_lock_days_write" : "finprod_g4_write";
  const canPropose = authorities.some((a) => a === "platform_a2_proposal_create" || a === "platform_a2_write");
  useSyncExternalStore(subscribeG4DirectCommands, g4DirectCommandVersion, () => 0);
  const directRecords = session ? listG4DirectCommands(session.adminId) : [];
  const directRecord = (object: string) => directRecords.find(row => g4DirectObject(row) === object);
  const [operationsRefresh, setOperationsRefresh] = useState(0);
  const [lockedParams, setLockedParams] = useState<Record<string, string>>({});
  const [overview, setOverview] = useState<G4Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  const paramApproval = useGParamApproval("G4", toast, setError, async () => { await readCurrentOverview(); }, invalidateOverview);
  const [refreshError, setRefreshError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [nodePageNo, setNodePageNo] = useState(1);
  const [nodePageSize, setNodePageSize] = useState(10);
  const [firstDividend, setFirstDividend] = useState<{ epoch: number; expectedRevision: string } | null>(null);
  const [tierConfirm, setTierConfirm] = useState<{ epoch: number; change?: G4TierChange } | null>(null);
  const latest = useRef({ overview, loading, busyKey, refreshError, readFailed });
  latest.current = { overview, loading, busyKey, refreshError, readFailed };
  function invalidateOverview() {
    latest.current.readFailed = true;
    setReadFailed(true);
    // Saved originals remain recoverable; confirmations built from the old read do not.
    openActionConfirm(current => current && (current.getPendingReason?.() !== undefined
      || session && listG4DirectCommands(session.adminId).some(row => g4DirectObject(row) === current.directObject)) ? current : null);
    setTierConfirm(current => session && (hasPendingG4TierApproval(session.adminId)
      || listG4DirectCommands(session.adminId).some(row => g4DirectObject(row) === "tiers")) ? current : null);
    setFirstDividend(current => session && pendingConfigApproval("G4", session.adminId) ? current : null);
  }
  async function readCurrentOverview() {
    invalidateOverview();
    openActionConfirm(null);
    try {
      const active = await fetchG4GenesisOverview(nodePageNo, nodePageSize);
      setOverview(active); setLockedParams({}); setReadFailed(false); setRefreshError("");
      return active;
    } catch (failure) {
      setRefreshError(messageOf(failure));
      throw failure;
    }
  }
  async function recoverRejectedApproval(failure: unknown) {
    const message = messageOf(failure);
    setError(message); toast(message);
    await Promise.allSettled([readCurrentOverview()]);
  }
  const canStartNew = (authority: string, openingKey?: string) => {
    const view = latest.current;
    const auth = useAdminAuth.getState();
    return !!view.overview && !view.loading && (!view.busyKey || view.busyKey === openingKey) && !view.refreshError && !view.readFailed
      && auth.isAuthenticated && !auth.logoutPending && auth.session?.adminId === session?.adminId
      && !!auth.session?.authorities.includes(authority);
  };

  const reload = useCallback(async (silent = false, page = nodePageNo, pageSize = nodePageSize) => {
    if (!silent) setLoading(true);
    setReadFailed(true);
    setError("");
    try {
      const next = await fetchG4GenesisOverview(page, pageSize);
      setOverview(next);
      setLockedParams({});
      setReadFailed(false);
      setRefreshError("");
      setNodePageNo(next.nodePage.page);
      setNodePageSize(next.nodePage.pageSize);
    } catch (err) {
      if (refreshError) setRefreshError(messageOf(err));
      else {
        setOverview(null);
        setError(messageOf(err));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [nodePageNo, nodePageSize, refreshError]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setReadFailed(true);
      setError("");
      try {
        const next = await fetchG4GenesisOverview(1, 10);
        if (!cancelled) {
          setOverview(next);
          setLockedParams({});
          setReadFailed(false);
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

  const mutate = useCallback(async (key: string, action: () => Promise<unknown>, success: string, approvalFallback = false) => {
    setBusyKey(key);
    setError("");
    try {
      await action();
      // 写入回执已确认，附加刷新失败不能再抛给写入确认框。
      if (success) toast(success);
      setReadFailed(true);
      const [result] = await Promise.allSettled([fetchG4GenesisOverview(nodePageNo, nodePageSize)]);
      if (result.status === "fulfilled") {
        setOverview(result.value);
        setLockedParams({});
        setReadFailed(false);
        setRefreshError("");
        setNodePageNo(result.value.nodePage.page);
        setNodePageSize(result.value.nodePage.pageSize);
      } else {
        setRefreshError(messageOf(result.reason));
      }
    } catch (err) {
      if (key.startsWith("param:") && ["OBJECT_LOCKED_BY_A2", "OBJECT_ALREADY_PENDING"].includes(String((err as { backendMessage?: string })?.backendMessage))) {
        setLockedParams(rows => ({ ...rows, [key.slice(6)]: messageOf(err) }));
      }
      if (!approvalFallback || !(err instanceof G4CatalogApprovalRequiredError)) {
        const message = messageOf(err);
        setError(message);
        toast(isA2OutcomeUncertainError(err) ? message : `操作失败 · ${message}`);
      }
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [nodePageNo, nodePageSize, toast]);

  const selectedNode = useMemo(() => {
    if (!overview || !nodeDrawer) return null;
    return overview.nodes.find((node) => node.id === nodeDrawer) || null;
  }, [overview, nodeDrawer]);

  const confirmModal = mc && (
    <OperationConfirmModal briefKind={mc.briefKind}
      action={mc.action}
      title={mc.title}
      detail={mc.detail}
      amplifies={mc.amplifies}
      coverage={mc.coverage}
      edit={mc.edit}
      businessForm={mc.businessForm}
      reasonMax={mc.reasonMax}
      getPendingReason={() => (mc.directObject && session ? listG4DirectCommands(session.adminId).find(row => g4DirectObject(row) === mc.directObject) : undefined)?.body ? JSON.parse(listG4DirectCommands(session!.adminId).find(row => g4DirectObject(row) === mc.directObject)!.body).reason : mc.getPendingReason?.()}
      getPendingBusinessValue={() => {
        const saved = mc.directObject && session ? listG4DirectCommands(session.adminId).find(row => g4DirectObject(row) === mc.directObject) : undefined;
        return saved ? Object.fromEntries(Object.entries(JSON.parse(saved.body)).map(([key, value]) => [key, String(value)])) : mc.getPendingBusinessValue?.();
      }}
      effect={mc.effect}
      facts={mc.facts}
      statedBrief={mc.statedBrief}
      confirmLabel={mc.confirmLabel}
      confirmTone={mc.confirmTone}
      coverageLead={mc.coverageLead}
      coverageCheck={mc.coverageCheck}
      reasonPlaceholder={mc.reasonPlaceholder}
      onClose={() => openActionConfirm(null)}
      onConfirm={async (reason, newValue, businessValue) => {
        const saved = mc.directObject && session ? listG4DirectCommands(session.adminId).find(row => g4DirectObject(row) === mc.directObject) : undefined;
        if (saved) { await recoverDirect(saved, true); return; }
        if (mc.directObject && !paramApproval.record(mc.directObject.replace(/^params\//, ""))
          && !canStartNew(g4DirectAuthority({ path: `/nex/genesis/${mc.directObject}`, method: "PATCH", body: "" }))) {
          openActionConfirm(null);
          throw new Error("页面要先重新读取成功并核对权限，才能发起新修改。");
        }
        await mc.run(reason, newValue, businessValue);
        openActionConfirm(null);
      }}
    />
  );

  const directName = (command: G4DirectCommand) => {
    const object = g4DirectObject(command);
    const body = JSON.parse(command.body) as Record<string, string>;
    if (object.startsWith("params/")) return G4_PARAM_NAME[decodeURIComponent(object.slice(7))] ?? object;
    if (object === "market-status") return "紧急暂停创世节点买卖";
    if (object === "market-open-state") return body.value === "open" ? "恢复创世市场开放" : "创世市场设为「暂未开放」";
    if (object === "tiers") return command.method === "DELETE" ? `删除价格档位 · ${command.path.split("/").at(-1)}` : command.method === "PATCH" ? `修改价格档位 · ${command.path.split("/").at(-1)}` : "新增价格档位";
    if (object === "series/initialize") return "发布创世节点系列";
    if (object.startsWith("operations/config/")) return G4_CONFIGS.find(row => row.key === decodeURIComponent(object.slice(18)))?.label ?? object;
    if (object === "operations/simulations") return "创建模拟成交";
    if (object.startsWith("operations/simulations/")) return `归档模拟成交 · ${command.path.split("/").at(-1)}`;
    return `重新发放收益 ${command.path.split("/").at(-2)}`;
  };
  async function recoverDirect(command: G4DirectCommand, retry: boolean) {
    setBusyKey(`original:${command.commandKey}`);
    // A replay receipt contains the original overview, never the current view.
    invalidateOverview();
    if (retry) { openActionConfirm(null); setTierConfirm(null); }
    let verdict = false;
    try {
      if (retry) {
        try { await retryG4DirectCommand(command); verdict = true; toast(`${directName(command)} · 原操作已确认成功`); }
        catch (failure) {
          verdict = !listG4DirectCommands(command.adminId).some(row => row.commandKey === command.commandKey);
          throw failure;
        }
      }
      await readCurrentOverview();
      if (command.path.includes("/operations/")) { await fetchG4AdminOperations(); setOperationsRefresh(value => value + 1); }
      if (!retry) toast("已读回当前数据；这不能确认原命令的结果，原记录继续保留。请到操作记录按原命令号核对。");
    } catch (failure) {
      if (verdict) {
        // Even an explicit rejection ends the original mode. Re-read before a new edit.
        await Promise.allSettled([readCurrentOverview()]);
        setOperationsRefresh(value => value + 1);
      }
      toast(messageOf(failure));
      throw failure;
    } finally { setBusyKey(null); }
  }
  const pendingFirstDividend = session && pendingConfigApproval("G4", session.adminId);
  const tierPending = !!session && hasPendingG4TierApproval(session.adminId);
  const originalDialogs = <>
      {tierConfirm && session && tierConfirm.epoch === epoch && <G4TierConfirm
        session={session} epoch={epoch} requested={tierConfirm.change}
        canStartNew={(version) => canStartNew("finprod_g4_price_write") && latest.current.overview!.tiersVersion === version
          && !listG4DirectCommands(session.adminId).some(row => g4DirectObject(row) === "tiers")}
        readActive={readCurrentOverview}
        onRecoveryStart={invalidateOverview}
        onRecoverDirect={command => recoverDirect(command, true)}
        onError={recoverRejectedApproval}
        onDirect={async (change, reason, to, priceUSDT) => {
          if (!canStartNew("finprod_g4_price_write") || latest.current.overview!.tiersVersion !== change.expectedTiersVersion) {
            setTierConfirm(null); throw new Error("价格档位已变化或页面尚未就绪，请重新读取后操作。");
          }
          if (change.operation === "delete") {
            await mutate(`tier:delete:${change.tierId}`, () => deleteG4GenesisTier(change.tierId!, change.expectedTiersVersion, reason, OPERATOR()), `档位 ${change.tierId} 已删除`, true);
            return;
          }
          await mutate(change.tierId ? `tier:update:${change.tierId}` : "tier:create", () => change.tierId
            ? updateG4GenesisTier(change.tierId, to, priceUSDT, change.expectedTiersVersion, reason, OPERATOR())
            : createG4GenesisTier(to, priceUSDT, change.expectedTiersVersion, reason, OPERATOR()),
          `${change.tierId ? `档位 ${change.tierId} 已更新` : "已新增一档"} · [${fmtNumber(change.from, 0)}, ${fmtNumber(to, 0)}) · ${fmtNumber(priceUSDT, 0)} USDT`, true);
        }}
        onClose={() => setTierConfirm(null)}
        onDone={(active, acknowledgement) => {
          setOverview(active);
          setLockedParams({}); setReadFailed(false); setRefreshError("");
          setTierConfirm(null);
          toast(acknowledgement);
        }}
      />}
      {firstDividend && session && firstDividend.epoch === epoch && <G4FirstDividendConfirm
        session={session} epoch={epoch} expectedRevision={firstDividend.expectedRevision}
        canStartNew={() => canStartNew("finprod_g4_dividend_rate_write")
          && Number(latest.current.overview!.params.find(row => row.key === "dividend")?.value) === 0}
        readActive={readCurrentOverview}
        onRecoveryStart={invalidateOverview}
        onError={recoverRejectedApproval}
        onClose={() => setFirstDividend(null)}
        onDone={(active, acknowledgement) => {
          setOverview(active);
          setLockedParams({}); setReadFailed(false); setRefreshError("");
          setFirstDividend(null);
          toast(acknowledgement);
        }}
      />}
  </>;
  const recoveryNotice = (extra: G4ExtraRecovery[] = []) => <G4RecoveryNotice approval={paramApproval} toast={toast} extra={[
    ...directRecords.map(command => ({
      key: command.commandKey, name: directName(command),
      change: <span data-mono>{Object.entries(JSON.parse(command.body)).filter(([key]) => !["operator"].includes(key)).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>,
      tag: <StatusTag tone="warn" icon={CircleHelp} explain={`原命令号 ${command.commandKey}。只读核对不会重发；24 小时后仅可核对。`}>{g4DirectCommandExpired(command) ? "已过期" : "结果未知"}</StatusTag>,
      action: <><Button size="sm" disabled={!!busyKey} onClick={() => { void recoverDirect(command, false).catch(() => undefined); }}>查询原提交结果</Button>{canRetryG4DirectCommand(command) && <Button size="sm" disabled={!!busyKey} onClick={() => { void recoverDirect(command, true).catch(() => undefined); }}>按原请求重试</Button>}</>,
    })), ...(!overview && tierPending ? [{
      key: "tiers", name: "价格档位", change: "档位修改的原申请（扩容或未售涨价）",
      tag: <StatusTag tone="warn" icon={Clock3}>待确认</StatusTag>,
      action: <Button size="sm" disabled={!!busyKey} onClick={() => setTierConfirm({ epoch })}>查询原提交结果</Button>,
    }] : []), ...(!overview && pendingFirstDividend ? [{
      key: "first-dividend", name: "每日收益比例", change: "首次配置的原申请",
      tag: <StatusTag tone="warn" icon={Clock3}>待确认</StatusTag>,
      action: <Button size="sm" disabled={!!busyKey} onClick={() => {
        const [original] = configApprovalOriginalInput("G4", pendingFirstDividend.input);
        setFirstDividend({ epoch, expectedRevision: original.expectedRevision });
      }}>查询原审批</Button>,
    }] : []), ...extra,
  ]} />;
  const anyWrite = ["finprod_g4_write", "finprod_g4_price_write", "finprod_g4_dividend_rate_write", "finprod_g4_royalty_write", "finprod_g4_airdrop_pct_write",
    "finprod_g4_emission_curve_write", "finprod_g4_airdrop_lock_days_write", "finprod_g4_market_toggle"].some(allowed);
  const marketOnForHeader = overview?.market.enabled;
  const headerAction = overview && (marketOnForHeader
    ? allowed("finprod_g4_market_toggle") && <Button variant="danger-outline" size="sm" icon={<PauseCircle size={14} aria-hidden />}
      disabledReason={busyKey || refreshError || readFailed || directRecord("market-status") ? "正在处理上一项或页面要重新读取，稍候再操作" : undefined}
      onClick={() => runMarketSwitch()}>紧急暂停</Button>
    : reach("/emergency/kill-switch") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>去「紧急停用开关」恢复</Link>);
  const header = (
    <PageHeader pageId="G4" title="创世节点销售与收益"
      summary="管创世节点的总量、档位价、每日分红和展示开关。"
      actions={headerAction || undefined}
      meta={overview ? "打开时读取，不自动刷新；改完重新读取" : undefined}
      readOnly={overview && !anyWrite ? "你只能查看，这个账号没有修改权限。" : undefined} />
  );

  if (loading && !overview) {
    return (
      <>
        {header}
        {recoveryNotice()}
        <BlockState state="loading" title="创世节点数据加载中…" />
        {confirmModal}
        {originalDialogs}
      </>
    );
  }

  if (!overview) {
    return (
      <>
        {header}
        {recoveryNotice()}
        <BlockState state="error" title="创世节点数据加载失败"
          detail={<>页面不显示任何旧数据。点「重新加载」；一直失败请联系值班同事。<Explain label="失败原因" content={error || "没有收到数据，请重试；一直失败请联系值班同事。"} /></>}
          retryLabel="重新加载" onRetry={() => void reload()} />
        {confirmModal}
        {originalDialogs}
      </>
    );
  }

  const busy = !!busyKey || !!refreshError || readFailed;
  const busyReason = busyKey ? "正在处理上一项，稍候再操作" : refreshError || readFailed ? "页面要先重新读取成功，才能再改" : undefined;
  const canAdjust = (key: string) => allowed(paramAuthority(key)) || !!paramApproval.record(key);
  const paramDisabled = (key: string) => {
    const original = paramApproval.record(key);
    return !!directRecord(`params/${encodeURIComponent(key)}`) || !!busyKey || ((!!refreshError || readFailed) && (!original || key === "dividend" && original.ticket?.status === "pending"));
  };
  const paramDisabledReason = (key: string) => !paramDisabled(key) ? undefined
    : busyKey ? "正在处理上一项，稍候再操作" : "页面要先重新读取成功，才能再改";
  const cov = overview.coverage.coverageRatio.toFixed(1);
  const marketOn = overview.market.enabled;
  const stats = overview.stats;
  const dividend = overview.dividend;
  const dividendParam = paramByKey(overview, "dividend");
  const showPaidEmission = overview.emissionGate.open || dividend.paidCount > 0;
  const geoBlockedList = overview.geoBlocked.filter((geo) => geo.status === "blocked");
  const geoBlocked = geoBlockedList.map((geo) => geo.cc).join(" / ") || "-";
  const batchRerun = dividend.batchStatus === "done";
  const nodePage = overview.nodePage;
  const canSetupDividend = authorities.includes("finprod_g4_dividend_rate_write");
  const firstDividendEntry = !!pendingFirstDividend
    || (!!dividendParam?.value.trim() && Number(dividendParam.value) === 0);

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

  const openFirstDividend = async () => {
    if (!session || !canSetupDividend) return;
    setError("");
    setBusyKey("param:dividend");
    try {
      if (pendingFirstDividend) {
        const [original] = configApprovalOriginalInput("G4", pendingFirstDividend.input);
        setFirstDividend({ epoch, expectedRevision: original.expectedRevision });
        return;
      }
      if (!canStartNew("finprod_g4_dividend_rate_write", "param:dividend")) return;
      const state = await fetchG4DividendApprovalState();
      if (useAdminAuth.getState().authEpoch !== epoch || !canStartNew("finprod_g4_dividend_rate_write", "param:dividend")) return;
      if (Number(state.dividend) !== 0) {
        await reload(true);
        toast("每日收益比例已配置，请核对当前值后再调整。");
        return;
      }
      setFirstDividend({ epoch, expectedRevision: state.expectedRevision });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusyKey(null);
    }
  };

  const adjustParam = async (param: G4Param) => {
    if (!allowed(paramAuthority(param.key)) && !paramApproval.record(param.key)) return;
    if (param.key === "dividend" && firstDividendEntry && !paramApproval.record(param.key)) {
      void openFirstDividend();
      return;
    }
    // 主人拍板(2026-08-06):阶梯档位在场时一级单价由档位派生、本参数只读,调价走档位卡
    // (OPS-G-07/G-13 仲裁)。入口已不渲染,这里是钱路径双保险。
    if (param.key === "price" && overview.tierPrice.status !== "legacy") return;
    const tighteningDividend = param.key === "dividend" && paramApproval.record(param.key)?.ticket?.status === "pending";
    if (tighteningDividend && !canStartNew(paramAuthority(param.key))) return;
    const original = tighteningDividend ? undefined : await paramApproval.open(param.key);
    if (original === false) return;
    const numeric = !["divBase", "emissionCurve"].includes(param.key);
    const bounds = param.key === "supply" ? { min: stats.sold, max: 100000, step: 1 }
      : param.key === "price" ? { min: 0.01, max: 1000000, step: 0.01 }
        : param.key === "royalty" ? { min: 0, max: 20, step: 0.01 }
          : param.key === "airdropPct" ? { min: 0, max: 100, step: 0.01 }
            : param.key === "airdropLockDays" ? { min: 0, max: 3650, step: 1 }
              : { min: 0, max: 5, step: 0.001 };
    const needsDecision = ["dividend", "divBase", "airdropPct", "emissionCurve"].includes(param.key);
    // ——以下只用于显示——
    const copy = PARAM_COPY[param.key];
    const name = G4_PARAM_NAME[param.key] ?? operatorCopyText(param.name);
    const currentRaw = original ? (original.request.command.params.expectedValue as string | undefined) ?? "" : paramEditValue(param);
    const currentText = g4ParamValueText(param.key, currentRaw);
    const pendingRaise = tighteningDividend ? paramApproval.record("dividend") : undefined;
    const pendingRaiseValue = pendingRaise?.request.command.params.value as string | undefined;
    const originalValue = original?.request.command.params.value as string | undefined;
    const directionTag = copy?.tighten ? `${copy.loosen}要批准 · ${copy.tighten}立即生效` : "改动都要批准";
    const supplyHint = `${fmtNumber(stats.sold, 0)}–100,000 的整数`;
    const facts = (value?: string) => {
      const dir = original || tighteningDividend ? undefined : paramDirection(param.key, currentRaw, value);
      const nextText = value ? g4ParamValueText(param.key, value) : undefined;
      return (
        <div data-proof="g4-param-preview">
          <Facts>
            <Fact k="改的是">{name}</Fact>
            {original && <Fact k="原申请"><Change from={currentText} to={originalValue === undefined ? "—" : g4ParamValueText(param.key, originalValue)} /></Fact>}
            {pendingRaise && <Fact k="原调高申请" tone="warn"><Change from={currentText} to={pendingRaiseValue === undefined ? "—" : g4ParamValueText("dividend", pendingRaiseValue)} /> 待审批{pendingRaise.ticket ? `（${pendingRaise.ticket.id}）` : ""}</Fact>}
            <Fact k="什么时候生效" tone={dir === "loose" ? "warn" : undefined}>{original
              ? original.ticket?.status === "pending"
                ? "审批单在等另一位在职超级管理员批准；批准前参数不变"
                : "原申请结果还没确认：有效期内按原内容、原命令号重试，后端不会重复建单"
              : tighteningDividend
                ? "这次只能调低或保持不变，确认后立即生效；原调高申请还在，但比例变了以后批准时后端会拒绝它，不会覆盖这次的值"
                : dir === "loose"
                  ? `${copy?.tighten ? "放宽" : "改动"}：提交审批，另一位在职超级管理员批准后才生效`
                  : dir === "tight"
                    ? "收紧：确认后立即生效"
                    : dir === "same"
                      ? "和现在一样：直接保存，参数不变"
                      : directionTag}</Fact>
            {dir === "loose" && <Fact k="谁来批">另一位在职超级管理员，要有审批批准权和这项参数的修改权限；你自己不能批</Fact>}
            {dir === "loose" && <Fact k="批准前">{param.key === "dividend"
              ? `仍是 ${currentText}；待审批期间你还可以把比例调低，调低立即生效，原调高申请随后会被后端拒绝`
              : `仍是 ${currentText}；这一项被审批锁住，调高调低都改不了`}</Fact>}
            {dir === "loose" && <Fact k="批准后">后端再核对一次原值{param.key === "dividend" ? "和当前比例版本" : "和当前系列"}、兑付覆盖率，通过后写入{nextText ? ` ${nextText}` : "新值"}</Fact>}
            {dir === "loose" && !canPropose && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，这个方向会被拦下；请有提案权和这项修改权限的同事发起</Fact>}
            {param.key === "divBase" && !param.value.trim() && !original && <Fact k="现在是空的" tone="warn">后端目前不接受把空的计算基数通过审批改成有内容（已提后端），这次审批会被拒</Fact>}
            <Fact k="改了会怎样"><KeepText text={copy?.effect ?? operatorCopyText(param.note)} /></Fact>
            <Fact k="付不付钱"><KeepText text={copy?.money ?? "—"} /></Fact>
            {dir === "loose" && <Fact k="兑付覆盖率（现在）" tone={overview.coverage.redlineBreached ? "danger" : undefined}>{g4Plain(cov)}%，红线 {g4Plain(String(overview.coverage.redlinePct))}%</Fact>}
          </Facts>
        </div>
      );
    };
    openActionConfirm({ briefKind: "config", directObject: `params/${encodeURIComponent(param.key)}`,
      action: `修改创世节点参数 · ${operatorCopyText(param.name)}`,
      title: original ? `${name}的原申请` : tighteningDividend ? "调低每日收益比例" : `调整${name}`,
      detail: <KeepText text={`${copy?.what ?? operatorCopyText(param.sub)}。`} />,
      effect: tighteningDividend
        ? <StatusTag tone="progress" filled explain="你提交的调高申请在等批准。比例只能调低或保持不变，调低立即生效；原调高申请批准时后端发现比例变了会拒绝，不会覆盖这次的值。">只能调低 · 立即生效</StatusTag>
        : <StatusTag tone="neutral" icon={ArrowLeftRight} explain={copy?.tighten
          ? <><p>{copy.loosen}是放宽：先提交审批，另一位在职超级管理员在「操作记录与审批」批准后才生效，你自己不能批。</p><p>{copy.tighten}是收紧：确认后立即生效。新旧值一样时直接保存，参数不变。</p></>
          : <p>这一项目前只保存说明。值有任何变化都要提交审批，另一位在职超级管理员批准后才写入；一样的值直接保存。</p>}>{directionTag}</StatusTag>,
      amplifies: false,
      facts,
      statedBrief: copy?.descriptive
        ? { impact: "只改这项说明的存值，不执行发放、释放或公式。", check: "核对新值；决策编号写产品或财务决议号，理由写清依据或工单号。" }
        : { impact: "改的是之后的销售和分红规则，已下单的订单和已建的分红批次不变。", check: "核对新值和方向；理由写清依据或工单号。" },
      coverageLead: param.key === "supply" ? "调高节点总量要另一位超管批准"
        : param.key === "price" ? "调高单价会让存量节点每天多发分红，要另一位超管批准"
          : param.key === "dividend" ? "调高每日收益比例会让平台每天多付 USDT，要另一位超管批准"
            : param.key === "royalty" ? "调低转让手续费要另一位超管批准"
              : `改${name}要另一位超管批准`,
      coverageCheck: param.key === "price" || param.key === "dividend"
        ? "提交审批时和批准时，后端各检查一次：原值和当前系列没被改过；把同系列节点每天多出来的分红算进应付款后，兑付覆盖率不低于红线。低于红线或算不准都拒绝。"
        : "提交审批时和批准时，后端各检查一次：原值和当前系列没被改过；兑付覆盖率不低于红线（这项改动本身不算新增应付款）。低于红线或算不准都拒绝。",
      edit: {
        ...(numeric ? { kind: "number", ...bounds } : { kind: "text" }),
        current: currentRaw,
        initialValue: original?.request.command.params.value as string | undefined,
        submitEditValue: needsDecision,
        unit: copy?.unit,
        hint: param.key === "supply" ? supplyHint : tighteningDividend ? `0–${g4Plain(currentRaw)}，单位 %/日，只能调低` : copy?.hint,
        amplifiesWhen: original || tighteningDividend ? undefined : (value: string) => paramDirection(param.key, currentRaw, value) === "loose",
      },
      businessForm: needsDecision ? { kind: "multi-field", title: "决策依据", fields: [
        { key: "decisionRef", label: "产品或财务决策编号", current: "", inputKind: "text", required: true, help: "3–128 字，写产品或财务决议的编号" },
      ] } : undefined,
      getPendingReason: tighteningDividend ? undefined : () => paramApproval.getPendingReason(param.key),
      getPendingBusinessValue: tighteningDividend ? undefined : () => paramApproval.getPendingBusinessValue(param.key),
      run: async (reason, value, businessValue) => {
        const saved = paramApproval.record(param.key);
        if (saved && !tighteningDividend) {
          try {
            await mutate(`param:${param.key}`, () => paramApproval.retry(saved.request.obj), "");
          } catch (error) {
            if (!paramApproval.record(saved.request.obj)) openActionConfirm(null);
            throw error;
          }
          return;
        }
        if (!canStartNew(paramAuthority(param.key))
          || !latest.current.overview?.params.some(row => row.key === param.key)
          || param.key === "price" && latest.current.overview.tierPrice.status !== "legacy"
          || tighteningDividend && saved?.ticket?.status !== "pending") {
          openActionConfirm(null);
          setError("当前创世参数暂不能修改，请重新读取当前状态后操作。");
          return;
        }
        if (!value) return;
        const state = param.key === "dividend" ? await fetchG4DividendApprovalState() : undefined;
        if (!canStartNew(paramAuthority(param.key))) {
          openActionConfirm(null);
          setError("当前创世参数暂不能修改，请重新读取当前状态后操作。");
          return;
        }
        const currentParam = latest.current.overview!.params.find(row => row.key === param.key)!;
        await mutate(`param:${param.key}`, async () => {
          const direct = () => updateG4GenesisParam(param.key, String(value), reason, OPERATOR(), businessValue?.decisionRef);
          const result = tighteningDividend
            ? { direct: await paramApproval.tightenDividend(state!.dividend, String(value), direct) }
            : await paramApproval.run({ key: param.key, current: state?.dividend ?? currentParam.value, value: String(value), reason,
            decisionRef: businessValue?.decisionRef, expectedRevision: state?.expectedRevision },
            direct);
          if ("direct" in result) {
            toast(`${operatorCopyText(param.name)}已立即生效`);
          }
        }, "");
      },
    });
  };

  function runMarketSwitch() {
    if (!marketOn || !allowed("finprod_g4_market_toggle")) return;
    openActionConfirm({ briefKind: "emergency", directObject: "market-status",
      action: "紧急暂停创世节点买卖",
      title: "紧急暂停创世节点买卖",
      detail: <>马上停止认购、挂售和用户之间的转让。恢复要去「紧急停用开关」页面操作。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmTone: "danger",
      confirmLabel: "确认暂停",
      facts: <Facts>
        <Fact k="停的是">认购、挂售和用户之间的转让，同步到「紧急停用开关」</Fact>
        <Fact k="已有持仓和收益">不受影响；用户仍能浏览和查看持仓。分红发不发看「运营阶段设置」里的开始发放收益</Fact>
        <Fact k="市场开放状态">不变；暂停和「暂未开放」是两个开关，两个都解除才可能恢复买卖</Fact>
        <Fact k="怎么恢复">只能在「紧急停用开关」页面恢复，这页没有恢复入口</Fact>
      </Facts>,
      statedBrief: { impact: "用户马上不能认购、挂售和转让，直到在「紧急停用开关」恢复。", check: "写清暂停原因和已有持有人的处理方案，理由写事件和工单号。" },
      reasonPlaceholder: "例如：事件编号、工单号",
      amplifies: false,
      businessForm: { kind: "multi-field", title: "暂停原因与处理方案", fields: [
        { key: "triggerBasis", label: "暂停原因", current: "", inputKind: "text", required: true, help: "8–200 字" },
        { key: "dispositionPlan", label: "已有持有人怎么处理", current: "", inputKind: "text", required: true, help: "8–500 字，例如持仓和收益照常、暂停期间不能转让" },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate("market:pause", () => updateG4GenesisMarketStatus(false, reason, OPERATOR(), {
          triggerBasis: businessValue?.triggerBasis, dispositionPlan: businessValue?.dispositionPlan,
        }), "创世节点买卖已紧急暂停，恢复请去「紧急停用开关」");
      },
    });
  }

  // ── 创世市场状态开关(规格 FEAT-GEN10b)────────────────────────────────────
  // 🔴 与上面的熔断**不是**一件事,不合并:熔断是止血(恢复只走 J1),这个是运营节奏
  //   (双向可切)。前端优先级 市场关闭 > 熔断,所以两者并存时要明示谁在生效。
  const marketClosed = overview.market.marketOpenState === "closed";
  const runMarketOpenState = () => {
    if (!allowed("finprod_g4_market_toggle")) return;
    const next: "open" | "closed" = marketClosed ? "open" : "closed";
    if (next === "open" && !overview.catalogAvailable) return;
    openActionConfirm({ briefKind: "config", directObject: "market-open-state",
      action: next === "closed" ? "创世市场设为「暂未开放」" : "恢复创世市场开放",
      title: next === "closed" ? "把创世市场设为暂未开放" : "恢复创世市场开放",
      detail: next === "closed"
        ? <KeepText text="App 照常显示介绍、档位和权益，只是不能购买和转让。" />
        : <>只把市场状态改回开放。用户能不能认购还要看紧急暂停、预售时间、购买资格和余额。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: next === "closed" ? "确认设为暂未开放" : "确认恢复开放",
      facts: next === "closed" ? <Facts>
        <Fact k="用户能做的">照常浏览介绍、档位和权益，查看自己的持仓；不能购买，也不能转让</Fact>
        <Fact k="已有持仓和收益">不受影响；分红发不发和市场开不开无关</Fact>
        <Fact k="商城入口">不变，是另一个开关（「App 商城入口」）</Fact>
        <Fact k="App 上">不显示倒计时和剩余名额，显示下面选的提示</Fact>
      </Facts> : <Facts>
        <Fact k="提交时后端检查">节点系列和价格档位设置完整；兑付覆盖率不低于红线（算不准也拒绝）</Fact>
        <Fact k="恢复以后">只是市场状态改回开放；紧急暂停、预售时间、购买资格、地区和余额仍各自限制，不保证用户马上能买</Fact>
        {!marketOn && <Fact k="现在" tone="warn">还在紧急暂停中，恢复开放后用户仍不能买卖，要在「紧急停用开关」解除暂停</Fact>}
        <Fact k="兑付覆盖率（现在）" tone={overview.coverage.redlineBreached ? "danger" : undefined}>{g4Plain(cov)}%，红线 {g4Plain(String(overview.coverage.redlinePct))}%</Fact>
      </Facts>,
      statedBrief: next === "closed"
        ? { impact: "用户马上不能购买和转让，浏览和持仓照常。", check: "选给用户看的提示，理由写清依据或工单号。" }
        : { impact: "市场状态改回开放；创世节点目前仅内部使用，恢复开放不等于正式开售授权。", check: "核对目录、紧急暂停和覆盖率，理由写清依据或工单号。" },
      amplifies: next === "open", // 恢复销售 = 放大流出方向,不豁免
      coverageLead: "恢复开放后用户可能继续认购",
      coverageCheck: "提交时后端检查：目录设置完整，兑付覆盖率不低于红线；不走审批。",
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
    const lastTo = overview.tiers?.length ? overview.tiers[overview.tiers.length - 1].to : undefined;
    const firstPrice = overview.tiers?.length ? overview.tiers[0].priceUSDT : undefined;
    openActionConfirm({ briefKind: "config", directObject: "series/initialize",
      action: "发布创世节点系列",
      title: "发布创世节点系列",
      detail: <>总量和起始价格按价格档位自动计算。转让手续费和每日收益比例先设为 0，收益计算基数为空，之后再单独修改。发布后市场仍是「暂未开放」，核对无误后再手动开放。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认发布",
      facts: <Facts>
        <Fact k="节点总量">{lastTo === undefined ? "按最后一档的截止" : `${fmtNumber(lastTo, 0)} 张（最后一档的截止）`}</Fact>
        <Fact k="起始价格">{firstPrice === undefined ? "按第一档的价格" : `${fmtNumber(firstPrice, 0)} USDT/张（第一档的价格）`}</Fact>
        <Fact k="其他参数">转让手续费 0%、每日收益比例 0%（未配置，不发分红）、收益计算基数为空</Fact>
        <Fact k="市场">发布后仍是暂未开放，要单独恢复开放；不会自动开售</Fact>
        <Fact k="付不付钱">不付钱</Fact>
      </Facts>,
      statedBrief: { impact: "建一个启用中的节点系列；已有用户持仓时后端会拒绝，不能用新系列替代原系列。", check: "核对系列编码和名称，理由写清依据或工单号。" },
      // Initializing the catalog does not start sales or create a payout. The
      // backend forces the market closed and requires a separate reviewed open.
      amplifies: false,
      businessForm: { kind: "multi-field", title: "节点系列信息", fields: [
        { key: "seriesCode", label: "系列编码", current: "", inputKind: "text", required: true, help: "3–64 位字母、数字、下划线或连字符，以字母或数字开头；用过的编码不能再用" },
        { key: "name", label: "系列名称", current: "", inputKind: "text", required: true, help: "2–128 字" },
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
    if (!allowed("finprod_g4_write") && !paramApproval.record(dividend.batchNo)) return;
    void openRerunBatch();
  };

  const openRerunBatch = async () => {
    const original = await paramApproval.open(dividend.batchNo);
    if (original === false) return;
    openActionConfirm({ briefKind: "funds", directObject: `dividend-batches/${encodeURIComponent(dividend.batchNo)}/rerun`,
      action: `重新发放今日收益 ${dividend.batchNo}`,
      title: original ? "补发收益的原申请" : "重新发放今日收益",
      detail: "按这一批的真实待付明细发放：没发成功的（待发、失败）按原用户、原金额补，已发的不重复发；今天还没有批次时按合格持仓新建这一批。",
      effect: <><StatusTag tone="warn" icon={Banknote} filled explain="提交时后端算这一批真实待付的金额：大于 0 就转成审批单，另一位在职超级管理员批准后才付款；没有待付或这一批已经完成时直接返回结果，不新付钱。">会真实付款</StatusTag><IrreversibleTag>付出后不能撤回</IrreversibleTag></>,
      confirmTone: "danger",
      confirmLabel: "确认发放",
      facts: <Facts>
        <Fact k="批次"><span data-mono>{dividend.batchNo || "—"}</span>{original ? "（原申请的批次）" : ""}</Fact>
        <Fact k="这一批现在">{dividend.paidCount > 0 ? `已发 ${fmtNumber(dividend.paidCount, 0)} 个节点 · ${g4Amount(dividend.paidAmountUsdt)} USDT` : batchRerun ? "这一批已完成" : "还没发"}</Fact>
        <Fact k="今日估算应发">{g4Amount(dividend.payoutToday)} USDT（估算，实际以后端按每个节点算的待付为准）</Fact>
        <Fact k="谁来批" tone="warn">有真实待付金额时，要另一位在职超级管理员在「操作记录与审批」批准，你自己不能批；批准前不付款</Fact>
        <Fact k="批准后">后端核对这一批的快照没变，给每个待付节点的持有人记 USDT 收益入账</Fact>
        <Fact k="前提">「运营阶段设置」里的开始发放收益是开的，创世节点没有紧急暂停；否则后端拒绝</Fact>
      </Facts>,
      statedBrief: { impact: "会给用户钱包记 USDT 收益；已发的不重复发。", check: "决策编号写财务或产品决议号，理由写清为什么要发、工单号。" },
      reasonPlaceholder: "例如：财务决议号、工单号",
      businessForm: { kind: "multi-field", title: "决策依据", fields: [
        { key: "decisionRef", label: "财务或产品决策编号", current: "", inputKind: "text", required: true, help: "3–128 字" },
      ] },
      getPendingReason: () => paramApproval.getPendingReason(dividend.batchNo),
      getPendingBusinessValue: () => paramApproval.getPendingBusinessValue(dividend.batchNo),
      run: async (reason, _value, businessValue) => {
        const saved = paramApproval.record(dividend.batchNo);
        if (saved) {
          try {
            await mutate(`batch:${dividend.batchNo}`, () => paramApproval.retry(saved.request.obj), "");
          } catch (error) {
            if (!paramApproval.record(saved.request.obj)) openActionConfirm(null);
            throw error;
          }
          return;
        }
        if (!canStartNew("finprod_g4_write") || !latest.current.overview!.emissionGate.open
          || latest.current.overview!.dividend.batchNo !== dividend.batchNo) {
          openActionConfirm(null);
          setError("当前收益批次暂不能发起新操作，请重新读取当前状态后操作。");
          return;
        }
        const state = await fetchG4DividendApprovalState(dividend.batchNo);
        if (!canStartNew("finprod_g4_write") || !latest.current.overview!.emissionGate.open
          || latest.current.overview!.dividend.batchNo !== dividend.batchNo) {
          openActionConfirm(null);
          setError("当前收益批次暂不能发起新操作，请重新读取当前状态后操作。");
          return;
        }
        await mutate(`batch:${dividend.batchNo}`, async () => {
          const result = await paramApproval.run({ key: dividend.batchNo, batchNo: dividend.batchNo, current: "", value: "rerun", reason,
            decisionRef: businessValue?.decisionRef, expectedRevision: state.expectedRevision,
            approvalRequired: !state.completed && Number(state.amountUsdt) > 0 },
          () => rerunG4GenesisDividendBatch(dividend.batchNo, reason, OPERATOR(), businessValue?.decisionRef));
          if ("direct" in result) toast("已重新发放，只补了没发成功的");
        }, "");
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
  const openTierConfirm = (tier?: G4Tier, index?: number, operation?: "delete") => {
    if (!session || !tiers || directRecord("tiers")) return;
    setTierConfirm({ epoch, change: {
      tierId: tier?.id, operation,
      nextTierId: index === undefined ? undefined : tiers[index + 1]?.id,
      previousTierId: index === undefined ? undefined : tiers[index - 1]?.id,
      from: tier?.from ?? tiers.at(-1)?.to ?? 0,
      currentTo: tier?.to ?? tiers.at(-1)?.to ?? 0, currentPrice: tier?.priceUSDT,
      totalSupply: stats.totalSlots, sold: stats.sold, seriesSetupRequired: overview.seriesSetupRequired,
      expectedTiersVersion: overview.tiersVersion,
    } });
  };

  const editTier = (tier: G4Tier, index: number) => {
    if (!canPriceTiers || !tiers) return;
    openTierConfirm(tier, index);
  };

  const addTier = () => {
    if (!canPriceTiers || !tiers || directRecord("tiers")) return;
    const firstTier = tiers.length === 0;
    if (!firstTier || !overview.seriesSetupRequired) { openTierConfirm(); return; }
    const lastTier = firstTier ? null : tiers[tiers.length - 1];
    const rangeFrom = lastTier?.to ?? 0;
    openActionConfirm({ briefKind: "config", directObject: "tiers",
      action: firstTier ? "创建第一个价格档位" : "新增价格档位",
      title: "创建第一个价格档位",
      detail: firstTier
        ? <>创建第一档（从 0 到截止）及价格，用来确定节点总量和起始价格。不会发布系列、不会开放市场。已有用户持仓时不能创建。</>
        : <>在最后一档 <b>{lastTier!.id}</b>（截止 {fmtInt(lastTier!.to)}）之后新增一档，起点自动为 {fmtInt(lastTier!.to)}。保存时同步调整已有系列的总供应量，不会自动开放销售；尚未发布系列时仍需单独发布。新增后需核对节点总量与档位范围，目录未就绪时不能销售。只影响以后的销售，已下单的按下单时价格结算。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认创建",
      facts: <Facts>
        <Fact k="起点">0（第一档从第 1 张开始）</Fact>
        <Fact k="创建以后">市场强制设为暂未开放；不会发布系列，也不会开售。还没有系列时，再点「发布系列」</Fact>
        <Fact k="不能创建的情况">已有用户持仓却没有档位时，后端会拒绝，要先恢复原系列</Fact>
        <Fact k="付不付钱">不付钱</Fact>
      </Facts>,
      statedBrief: { impact: "确定节点总量和起始价格的第一档，只影响以后的销售。", check: "截止和单价都填整数，理由写清依据或工单号。" },
      amplifies: false,
      businessForm: { kind: "multi-field", title: firstTier ? "第一个价格档位" : "新价格档位", hint: `起点 = ${fmtInt(rangeFrom)}${firstTier ? "" : "（上一档的截止）"}。截止和单价都填整数。`, fields: [
        { key: "to", label: "截止（卖到第几张）", inputKind: "number", min: rangeFrom + 1, step: 1, required: true },
        { key: "priceUSDT", label: "单价（USDT）", inputKind: "number", min: 1, step: 1, required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        const { to, priceUSDT } = requireTierInts(businessValue);
        await mutate("tier:create", () => createG4GenesisTier(to, priceUSDT, overview.tiersVersion, reason, OPERATOR()), `${firstTier ? "已创建第一档" : "已新增一档"} · [${fmtInt(rangeFrom)}, ${fmtInt(to)}) · ${fmtInt(priceUSDT)} USDT`);
      },
    });
  };

  const deleteTier = (tier: G4Tier, index: number) => {
    if (!canPriceTiers || !tiers || tiers.length <= 1) return;
    openTierConfirm(tier, index, "delete");
  };

  const supplyParam = paramByKey(overview, "supply");
  const priceParam = paramByKey(overview, "price");
  const royaltyParam = paramByKey(overview, "royalty");
  const divBaseParam = paramByKey(overview, "divBase");
  const airdropPctParam = paramByKey(overview, "airdropPct");
  const emissionCurveParam = paramByKey(overview, "emissionCurve");
  const airdropLockDaysParam = paramByKey(overview, "airdropLockDays");
  const showcaseEnabledParam = paramByKey(overview, "showcaseEnabled");
  const legacyPriceText = priceParam?.value ? g4ParamValueText("price", priceParam.value) : stats.unitPrice > 0 ? `${g4Amount(stats.unitPrice)} USDT` : "旧单价未设置";
  const tierPriceText = overview.tierPrice.status === "active" ? `${fmtInt(overview.tierPrice.tier.priceUSDT)} USDT`
    : overview.tierPrice.status === "legacy" ? legacyPriceText
      : overview.tierPrice.status === "soldout" ? "已售罄" : "暂无价格";
  const tierPriceNote = overview.tierPrice.status === "active"
    ? `当前档 ${overview.tierPrice.tier.id} · 这一档还剩 ${fmtInt(overview.tierPrice.tier.to - stats.sold)} 张`
    : overview.tierPrice.status === "legacy" ? "没有价格档位 · 使用旧单价"
      : overview.tierPrice.status === "soldout" ? "所有档位都已售罄"
        : "价格档位数据有误，暂时无法显示价格";

  const toggleShowcase = () => {
    if (!showcaseEnabledParam || !allowed(paramAuthority(showcaseEnabledParam.key))) return;
    const next = showcaseEnabledParam.value !== "true";
    openActionConfirm({ briefKind: "record", directObject: "params/showcaseEnabled",
      action: next ? "显示创世节点商城入口" : "隐藏创世节点商城入口",
      title: next ? "展示 App 商城入口" : "隐藏 App 商城入口",
      detail: <>只控制 App 商城里是否显示入口，不影响持仓、收益、市场状态、紧急暂停和购买资格。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: next ? "确认展示" : "确认隐藏",
      facts: <Facts>
        <Fact k="改的是">App 商城里的创世节点入口：<Change from={next ? "已隐藏" : "展示中"} to={next ? "展示中" : "已隐藏"} /></Fact>
        <Fact k="什么时候生效">确认后立即保存；App 下次读取时{next ? "显示" : "不再显示"}入口</Fact>
        <Fact k="不影响">已有持仓和收益、市场开放状态、紧急暂停、购买资格；{next ? "展示了也不保证用户能买" : "隐藏后已持有的用户仍能看到自己的持仓"}</Fact>
      </Facts>,
      statedBrief: { impact: "只改 App 商城入口显示，不改任何资产和规则。", check: "理由写清依据或工单号。" },
      run: async (reason) => {
        await mutate("param:showcaseEnabled", () => updateG4GenesisParam(
          "showcaseEnabled", String(next), reason, OPERATOR(),
        ), next ? "创世节点商城入口已显示" : "创世节点商城入口已隐藏");
      },
    });
  };

  // ——以下只用于显示——
  const records = paramApproval.list();
  const extraRecovery: G4ExtraRecovery[] = [
    ...(tierPending ? [{
      key: "tiers", name: "价格档位",
      change: "档位修改的原申请（扩容或未售涨价）",
      tag: <StatusTag tone="warn" icon={Clock3} explain="提交过一次档位修改，还没读到结论。点「查询原提交结果」按原命令号核对；查到待审批的保留，查到结论后读回当前档位并清掉。">待确认</StatusTag>,
      action: <Button size="sm" disabled={!!busyKey} onClick={() => setTierConfirm({ epoch })}>查询原提交结果</Button>,
    }] : []),
    ...(pendingFirstDividend ? [{
      key: "first-dividend", name: "每日收益比例",
      change: "首次配置的原申请",
      tag: <StatusTag tone="warn" icon={Clock3} explain="首次配置每日收益比例要另一位有权超管批准，批准前仍是 0%。点「查询原审批」按原命令号核对。">待确认</StatusTag>,
      action: <Button size="sm" disabled={!!busyKey} aria-label="查询原日分红审批" onClick={() => { const [original] = configApprovalOriginalInput("G4", pendingFirstDividend.input); setFirstDividend({ epoch, expectedRevision: original.expectedRevision }); }}>查询原审批</Button>,
    }] : []),
  ];
  const pendingCount = records.length + extraRecovery.length + directRecords.length;
  const batchRecord = records.find((record) => record.request.command.op === "g4_genesis_rerun_dividend" && record.request.obj === dividend.batchNo);
  const dividendRecord = paramApproval.record("dividend");
  const soldPctText = `${fmtNumber(Math.max(0, stats.soldPct), 2)}%`;
  const tierTicks = tiers && (overview.tierPrice.status === "active" || overview.tierPrice.status === "soldout")
    ? [{ value: 0, text: "0" }, ...tiers.map((tier) => ({ value: tier.to, text: fmtInt(tier.to) }))]
    : stats.totalSlots > 0 ? [{ value: 0, text: "0" }, { value: stats.totalSlots, text: fmtInt(stats.totalSlots) }] : [];
  const dividendRateText = dividendParam ? g4ParamValueText("dividend", dividendParam.value) : "—";
  const dividendUnset = !!dividendParam?.value.trim() && Number(dividendParam.value) === 0;

  // 今天的分红：先看有没有补发原申请，再看发了没有、收益门开没开。后端没有每天自动发放的任务（已提后端），不写成会自动发。
  const dividendState: { text: string; tone: "ok" | "warn" | "neutral" | "done"; sub: string; icon: typeof Coins } = batchRecord
    ? { text: batchRecord.status === "pending" ? "补发待审批" : batchRecord.status === "unknown" ? "补发结果未知" : "补发待确认", tone: "warn", sub: `批次 ${dividend.batchNo}`, icon: Clock3 }
    : dividend.paidCount > 0
      ? { text: "已发", tone: "ok", sub: `${fmtNumber(dividend.paidCount, 0)} 个节点 · ${g4Amount(dividend.paidAmountUsdt)} USDT`, icon: Coins }
      : !overview.emissionGate.open
        ? { text: "未开启", tone: "neutral", sub: "「开始发放收益」还没开", icon: PauseCircle }
        : dividendUnset
          ? { text: "未配置比例", tone: "warn", sub: "每日收益比例是 0%", icon: CircleHelp }
          : { text: "还没发", tone: "warn", sub: `批次 ${dividend.batchNo || "—"} · 要手动发放`, icon: CalendarClock };

  const conclusion = !overview.catalogAvailable
    ? <Conclusion state="warn" icon={Layers}
        hint={overview.seriesRecoveryRequired ? "已有用户持仓，不能重新发布系列；请联系数据负责人恢复原系列。" : overview.seriesInitializationAvailable ? "可以按现有价格档位发布系列，见下面的提示。" : "先按下面的提示补齐系列或档位。"}
        explain="后端判断节点系列和价格档位不完整时，用户不能认购、挂售或转让；市场开关这时也只能保持暂未开放。">
        创世节点设置不完整，目前不能交易：{catalogBlockText(overview.tradeBlockedReason)}</Conclusion>
    : !marketOn
      ? <Conclusion state="warn" icon={PauseCircle}
          hint={reach("/emergency/kill-switch") ? <>恢复要到 <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>紧急停用开关</Link>。</> : "恢复要请有「紧急停用开关」权限的同事操作。"}
          explain="暂停可能是有人在这页或「紧急停用开关」关了创世节点买卖，也可能是风险披露没有确认；页面读不到是哪一种。已有持仓和收益不受影响。">
          创世节点买卖已紧急暂停{marketClosed ? "，市场也设为暂未开放" : ""}</Conclusion>
      : marketClosed
        ? <Conclusion state="neutral" icon={Store}
            explain="暂未开放时 App 照常显示介绍、档位和权益，用户不能购买和转让；已持有的节点和收益不受影响。">
            创世市场暂未开放，已售 {fmtInt(stats.sold)} / {fmtInt(stats.totalSlots)} 张</Conclusion>
        : <Conclusion state="neutral" icon={Store}
            explain="创世节点目前仅内部使用。市场开放只说明这一个开关；用户能不能认购还要看预售时间、购买资格、地区和余额。">
            创世市场开放中，已售 {fmtInt(stats.sold)} / {fmtInt(stats.totalSlots)} 张</Conclusion>;

  const paramRow = (param: G4Param | undefined, options?: { dir?: string }) => {
    if (!param) return null;
    const copy = PARAM_COPY[param.key];
    const name = G4_PARAM_NAME[param.key] ?? operatorCopyText(param.name);
    const record = paramApproval.record(param.key);
    const recovery = record ? records.find((row) => row.commandKey === record.commandKey) : undefined;
    const dir = options?.dir ?? (copy ? copy.tighten ? `${copy.loosen}要批准` : "改动要批准" : undefined);
    return (
      <ConfigRow key={param.key} name={name}
        what={copy?.what ?? operatorCopyText(param.sub)}
        when={copy ? copy.tighten ? `${copy.loosen}是放宽，提交审批，另一位在职超级管理员批准后生效；${copy.tighten}是收紧，确认后立即生效` : "值有任何变化都要提交审批，另一位在职超级管理员批准后写入" : undefined}
        effect={copy?.effect}
        note={[
          copy?.money ? `付不付钱：${copy.money}` : undefined,
          allowed(paramAuthority(param.key)) && !canPropose && copy ? `这个账号没有发起审批的权限，${copy.tighten ? `只能${copy.tighten}` : "这一项改不了"}；${copy.loosen}请有提案权的同事发起。` : undefined,
        ].filter(Boolean).join(" ") || undefined}
        value={<span className="g4x-param">
          <span className="g4x-value">
            <span className="g4x-value-num">{g4ParamValueText(param.key, param.value)}</span>
            {recovery && g4RecoveryTag(recovery)}
            {!record && lockedParams[param.key] && <StatusTag tone="warn" icon={Lock} explain={lockedParams[param.key]}>审批锁定中</StatusTag>}
          </span>
          {dir && <span className="g4x-dir">{dir}</span>}
        </span>}
        action={canAdjust(param.key) ? (describedBy) => (
          <Button size="sm" aria-describedby={describedBy} aria-label={`调整 ${param.name}`}
            disabledReason={paramDisabledReason(param.key)} onClick={() => adjustParam(param)}>{record ? "查看原申请" : "调整"}</Button>
        ) : undefined} />
    );
  };

  const tierItems = tiers ? tiers.map((tier, index) => {
    const current = overview.tierPrice.status === "active" && overview.tierPrice.tier.id === tier.id;
    const state = stats.sold >= tier.to ? "已售完" : stats.sold >= tier.from ? `在卖 · 还剩 ${fmtInt(tier.to - stats.sold)} 张` : "未开售";
    return {
      key: tier.id,
      label: <>{tier.id}{index === tiers.length - 1 ? " · 最后一档" : ""}</>,
      name: `第 ${fmtInt(tier.from + 1)}–${fmtInt(tier.to)} 张`,
      value: tier.priceUSDT,
      valueText: fmtInt(tier.priceUSDT),
      secondary: state,
      mark: current ? "当前档" : undefined,
      actions: canPriceTiers ? <span className="g4x-tier-actions">
        <Button size="sm" disabledReason={busy ? busyReason : directRecord("tiers") ? "请先核对原操作" : undefined} aria-label={`编辑 ${tier.id}`} onClick={() => editTier(tier, index)}>编辑</Button>
        {/* 唯一档不渲染删档入口(禁用态仍暗示「某些条件下可删」,GEN11 同款纪律)。 */}
        {tiers.length > 1 && <Button size="sm" variant="danger-outline" disabledReason={busy ? busyReason : directRecord("tiers") ? "请先核对原操作" : undefined} aria-label={`删除 ${tier.id}`} onClick={() => deleteTier(tier, index)}>删除</Button>}
      </span> : undefined,
    };
  }) : [];

  const marketDisabledReason = busy ? busyReason : directRecord("market-open-state") ? "请先核对原操作" : marketClosed && !overview.catalogAvailable ? "节点系列和价格档位不完整，补齐后才能恢复开放" : undefined;
  const rerunDisabledReason = directRecord(`dividend-batches/${encodeURIComponent(dividend.batchNo)}/rerun`) ? "请先核对原操作" : busyKey ? "正在处理上一项，稍候再操作"
    : !paramApproval.record(dividend.batchNo) && refreshError ? "页面要先重新读取成功，才能再发"
      : !paramApproval.record(dividend.batchNo) && !overview.emissionGate.open ? "「运营阶段设置」里的开始发放收益还没开，不能发放"
        : !paramApproval.record(dividend.batchNo) && !dividend.batchNo ? "今天的批次号还没有，暂时不能发放" : undefined;

  return (
    <>
      {header}
      {originalDialogs}
      {confirmModal}
      {error && <Notice tone="warn" title="操作提示">{error}</Notice>}
      {refreshError && <Notice tone="warn" title="操作已成功，页面刷新失败"
        action={<Button size="sm" disabled={loading || !!busyKey} onClick={() => void reload()}>重试刷新</Button>}>
        <p>下面是刷新前的数据，重新读取成功前暂不能修改；不用再次提交原操作。</p>
      </Notice>}
      {conclusion}
      {!overview.catalogAvailable && (overview.seriesRecoveryRequired || overview.seriesInitializationAvailable
        || (overview.seriesSetupRequired && overview.tradeBlockedReason === "GENESIS_TIERS_UNAVAILABLE")) && (
        <Notice tone="warn" title={overview.seriesRecoveryRequired ? "要先恢复原系列" : overview.seriesInitializationAvailable ? "下一步：发布系列" : "下一步：创建第一档"}
          action={<>
            {overview.seriesInitializationAvailable && allowed("finprod_g4_write") && (
              <Button size="sm" variant="primary" disabledReason={busy ? busyReason : directRecord("series/initialize") ? "请先核对原操作" : undefined} onClick={initializeSeries}>发布系列</Button>
            )}
            {overview.seriesSetupRequired && !overview.seriesRecoveryRequired
              && overview.tradeBlockedReason === "GENESIS_TIERS_UNAVAILABLE" && canPriceTiers && tiers && (
              <Button size="sm" variant="primary" disabledReason={busy ? busyReason : directRecord("tiers") ? "请先核对原操作" : undefined} onClick={addTier}>创建第一档</Button>
            )}
          </>}>
          <p>{overview.seriesRecoveryRequired
            ? "已有用户持仓，不能重新发布系列。请联系数据负责人恢复原系列，核对无误后再开放市场。"
            : overview.seriesInitializationAvailable
              ? "还没有节点系列，可以按现有价格档位发布。发布后市场仍是暂未开放。"
              : "还没有价格档位，请先创建第一档，再发布系列。"}</p>
        </Notice>
      )}
      {recoveryNotice(extraRecovery)}

      <StatBand label="创世节点摘要">
        <Stat label="已售出" icon={Layers} tone="role-2" value={fmtInt(stats.sold)} unit={`/ ${fmtInt(stats.totalSlots)} 张`}
          sub={`售出 ${soldPctText} · 还剩 ${fmtInt(stats.unsold)} 张`}
          explain="所有用户名下还在的创世节点数（不分状态、不分系列），不等于能分红的节点数。总量取当前系列总量和已售里较大的那个。" />
        <Stat label="当前售价" icon={Banknote} tone="role-1"
          value={overview.tierPrice.status === "active" ? fmtInt(overview.tierPrice.tier.priceUSDT) : tierPriceText}
          unit={overview.tierPrice.status === "active" ? "USDT/张" : undefined} sub={tierPriceNote}
          explain="下一张节点按哪个价卖：累计售出数落在哪一档就按哪一档的价格。已下单的订单按下单时的价格，不跟着改。" />
        <Stat label="今日分红" icon={dividendState.icon} tone={dividendState.tone === "ok" ? "ok" : dividendState.tone === "warn" ? "warn" : "role-other"}
          value={dividendState.text} sub={dividendState.sub}
          explain="今天这一批（按后端业务日）真实发出去的节点数和金额。后端目前查不到每天自动发放的任务（已提后端），要发请在「每日分红」里手动发放。" />
        <Stat label="待确认的申请" icon={ListOrdered} tone={pendingCount > 0 ? "warn" : "role-3"} value={fmtInt(pendingCount)} unit="项"
          sub={pendingCount > 0 ? "见上面的提醒" : "没有压着的申请"}
          explain="你在这台电脑上提交过、还没处理完的申请：参数修改、每日收益比例、补发收益、价格档位。别人发起的审批在「操作记录与审批」里看。" />
      </StatBand>

      <Panel title="销售进度与价格档位" icon={Layers} tone="role-2"
        explain={<>
          <p>看条：卖到第几张、落在哪一档、离下一档还剩多少张。条下的刻度是每一档的截止。</p>
          <p>累计售出数落在 [起点, 截止) 时按这一档的价格卖：起点 0、截止 1,000 的档就是第 1 到第 1,000 张。改截止时下一档的起点跟着改；最后一档的截止就是节点总量。</p>
          <p>扩大已有系列的总量，或让还没卖出的节点涨价，要另一位在职超级管理员批准；其余档位修改确认后立即生效。只影响以后的销售，已下单的按下单时价格。</p>
        </>}
        actions={tiers && canPriceTiers ? <span className="g4x-tiers-actions">
          {tierPending && <Button size="sm" disabledReason={busy ? busyReason : undefined} onClick={() => setTierConfirm({ epoch })}>查询原提交结果</Button>}
          <Button size="sm" variant="primary" disabledReason={busy ? busyReason : directRecord("tiers") ? "请先核对原操作" : undefined} onClick={addTier}>{tiers.length === 0 ? "+ 创建第一档" : "+ 新增档位"}</Button>
        </span> : undefined}>
        <div className="g4x-sales">
          <div className="g4x-progress">
            <div className="g4x-progress-head">
              <span className="g4x-progress-name">售出进度</span>
              <span className="g4x-progress-pct">{stats.totalSlots > 0 ? soldPctText : "—"}</span>
            </div>
            <ScaleBar label="售出位置" fill value={stats.sold} max={Math.max(stats.totalSlots, 1)} ticks={tierTicks} tone="role-2"
              valueText={`已售 ${fmtInt(stats.sold)} 张，共 ${fmtInt(stats.totalSlots)} 张${tiers?.length ? `，档位截止 ${tiers.map((tier) => fmtInt(tier.to)).join("、")}` : ""}`}
              state={stats.totalSlots > 0 ? undefined : "empty"} emptyText="还没有节点总量，先设置价格档位"
              invalidText="已售数量超过了节点总量，请核对系列和档位设置" />
            <dl className="g4x-nums">
              <div><dt>已售</dt><dd>{fmtInt(stats.sold)} 张</dd></div>
              <div><dt>还剩</dt><dd>{fmtInt(stats.unsold)} 张</dd></div>
              <div><dt>持有人</dt><dd>{fmtInt(stats.secondary.owners)} 人</dd></div>
            </dl>
            <ConfigList label="供应参数">
              {paramRow(supplyParam)}
              {priceParam && overview.tierPrice.status === "legacy" && paramRow(priceParam)}
              {priceParam && overview.tierPrice.status !== "legacy" && (
                <ConfigRow key="price" name="单价"
                  what="已设置价格档位：单价按卖到第几张自动决定，这里的旧单价不生效"
                  effect="改价请改右边的价格档位"
                  value={<span className="g4x-param"><span className="g4x-value"><span className="g4x-value-num">{tierPriceText}</span></span><span className="g4x-dir">按价格档位</span></span>} />
              )}
            </ConfigList>
          </div>
          <div className="g4x-tiers">
            <div className="g4x-tiers-head">
              <span className="g4x-tiers-title">价格档位<Explain label="价格档位怎么看" content="柱高是这一档的单价。「当前档」是下一张节点的价格；后端不要求后面的档更贵。" /></span>
              {tiers && <span className="g4x-dir">共 {fmtInt(tiers.length)} 档 · 至少保留一档</span>}
            </div>
            {tiers === null
              ? <BlockState state="error" compact title="价格档位数据暂时无法加载" detail="为避免改错，这里暂不提供新增、修改和删除。" />
              : tiers.length === 0
                ? <BlockState state="empty" compact title="还没有价格档位" detail={canPriceTiers ? "点「+ 创建第一档」确定节点总量和起始价格。" : "请有价格档位权限的同事创建第一档。"} />
                : <StepBar label="价格档位" unit="USDT/张" items={tierItems} />}
            <PaginationExemption label="创世节点价格档位" maxRows={8} reason="档位很少，需要一屏对比各档价格。" />
          </div>
        </div>
      </Panel>

      <div className="rd-split" data-even="">
        <Panel title="每日分红" icon={Coins} tone="role-1"
          explain={<>
            <p>每个合格节点每天按「所属系列单价 × 每日收益比例」算，逐个节点算到 6 位小数再合计。收益计算基数和发放曲线目前只是说明，不参与计算。</p>
            <p>发不发由「运营阶段设置」里的开始发放收益控制，这里只能查看。后端目前查不到每天自动发放的任务（已提后端），要发请点「重新发放今日收益」。</p>
          </>}
          actions={(allowed("finprod_g4_write") || paramApproval.record(dividend.batchNo))
            ? <Button size="sm" variant="primary" disabledReason={rerunDisabledReason} onClick={runRerunBatch}>重新发放今日收益{batchRerun ? "（已重发）" : ""}</Button>
            : undefined}>
          <div className="g4x-block">
            <div className="g4x-block-head">
              <span className="g4x-block-name">今天这一批<span className="g4x-dir">批次 <span data-mono>{dividend.batchNo || "—"}</span></span></span>
              {batchRecord ? g4RecoveryTag(batchRecord, true) : dividend.paidCount > 0
                ? <StatusTag tone="ok">已发</StatusTag>
                : !overview.emissionGate.open ? <StatusTag tone="neutral" icon={PauseCircle}>未开启</StatusTag> : <StatusTag tone="warn" icon={CalendarClock}>还没发</StatusTag>}
            </div>
            <div className="g4x-block-big" data-zero={showPaidEmission && dividend.paidCount > 0 ? undefined : ""}>
              {showPaidEmission ? <>{g4Amount(dividend.paidAmountUsdt)}<small>USDT 已发 · {fmtNumber(dividend.paidCount, 0)} 个节点</small></> : <>未开始发放<small>「开始发放收益」还没开</small></>}
            </div>
            <dl className="g4x-nums">
              <div><dt>今日估算应发</dt><dd>{g4Amount(dividend.poolToday)} USDT</dd></div>
              <div><dt>每个节点每天</dt><dd>{g4Amount(dividend.perSlotPerDay)} USDT</dd></div>
            </dl>
          </div>
          <ConfigList label="分红设置">
            {dividendParam && (
              <ConfigRow key="dividend" name="每日收益比例"
                what={PARAM_COPY.dividend.what}
                when={dividendUnset ? "现在是 0%（未配置，不发分红）。首次配置要另一位有权超管批准，批准前仍是 0%" : "调高是放宽，提交审批，另一位在职超级管理员批准后生效；调低是收紧，确认后立即生效"}
                effect={PARAM_COPY.dividend.effect}
                note={dividendRecord?.ticket?.status === "pending"
                  ? "你提交的调高申请在等批准，期间仍可把比例调低（立即生效）；调低后原调高申请批准时会被后端拒绝，不会覆盖新值。"
                  : `付不付钱：${PARAM_COPY.dividend.money}`}
                value={<span className="g4x-param">
                  <span className="g4x-value">
                    <span className="g4x-value-num">{dividendRateText}</span>
                    {dividendRecord && (() => { const row = records.find((item) => item.commandKey === dividendRecord.commandKey); return row && g4RecoveryTag(row); })()}
                    {pendingFirstDividend && <StatusTag tone="warn" icon={Clock3}>首次配置待确认</StatusTag>}
                  </span>
                  <span className="g4x-dir">基准 0.1%/日</span>
                </span>}
                action={(paramApproval.record(dividendParam.key) || (firstDividendEntry ? canSetupDividend : allowed(paramAuthority(dividendParam.key)))) ? (describedBy) => (
                  <Button size="sm" aria-describedby={describedBy} disabledReason={paramDisabledReason(dividendParam.key)}
                    aria-label={pendingFirstDividend ? "查询原日分红审批" : firstDividendEntry ? "首次配置每日收益比例" : `调整 ${dividendParam.name}`}
                    onClick={() => adjustParam(dividendParam)}
                  >{pendingFirstDividend ? "查询原审批" : firstDividendEntry ? "首次配置" : dividendRecord?.ticket?.status === "pending" ? "调低" : dividendRecord ? "查看原申请" : "调整"}</Button>
                ) : undefined} />
            )}
            {paramRow(divBaseParam, { dir: "只是说明" })}
            <ConfigRow key="emissionGate" name="开始发放收益"
              what="开了才会发创世节点的每日分红；关着时今日估算都显示 0"
              when="在「运营阶段设置」里控制，这里只能查看"
              value={<span className="g4x-param"><span className="g4x-value"><span className="g4x-value-num">{overview.emissionGate.open ? "已开放" : "未开放"}</span></span><span className="g4x-dir">跟随运营阶段</span></span>} />
          </ConfigList>
          <div className="g4x-sub">
            <div className="g4x-sub-title">计算口径</div>
            <dl className="g4x-nums">
              <div><dt>计算基数<Explain label="计算基数怎么算" content="当前系列单价 × 已售节点数，单位 USDT。不是当天的平台交易量。" /></dt><dd>{g4Amount(dividend.dailyVolumeBase)} USDT</dd></div>
              <div><dt>累计已记收益<Explain label="累计已记收益怎么算" content="历史上所有创世节点收益入账（成功和处理中）的合计，不限今天；「开始发放收益」关着时显示 0。不是未来要发的预算。" /></dt><dd>{g4Amount(stats.genesisAccrualUsd)} USDT</dd></div>
            </dl>
          </div>
        </Panel>

        <Panel title="市场与转让" icon={Store} tone="role-3"
          explain={<>
            <p>三个开关各管各的：「创世市场」是运营节奏，两个方向都能在这页改；「紧急暂停」是止血，这页只能暂停，恢复要去「紧急停用开关」；「App 商城入口」只管入口显示。</p>
            <p>两者并存时 App 显示「暂未开放」；市场开放和没有暂停都满足，用户才可能买卖。</p>
            <p>封锁地区在「地区访问限制」修改。节点转让后，之后新建的分红批次发给新持有人。</p>
          </>}
          actions={reach("/emergency/geo-block", "emergency_j2_read") ? <Link className="rd-link" href="/emergency/geo-block" prefetch={false}>去「地区访问限制」</Link> : undefined}>
          <ConfigList label="市场开关">
            <ConfigRow key="marketOpen" name="创世市场"
              what="暂未开放时用户能浏览和查看持仓，不能购买和转让"
              when="确认后立即生效；恢复开放时后端检查目录完整和兑付覆盖率"
              value={<span className="g4x-param">
                <span className="g4x-value"><span className="g4x-value-num">{marketClosed ? "暂未开放" : "开放中"}</span></span>
                <span className="g4x-dir">{marketClosed ? `App 提示「${NOTICE_LABEL[overview.market.closedNoticeKey] ?? "当前市场暂未开放"}」` : "两个方向都在这页改"}</span>
              </span>}
              action={allowed("finprod_g4_market_toggle") ? (
                <Button size="sm" disabledReason={marketDisabledReason} onClick={runMarketOpenState}>{marketClosed ? "恢复市场开放" : "设为暂未开放"}</Button>
              ) : undefined} />
            <ConfigRow key="pause" name="紧急暂停"
              what="停认购、挂售和用户之间的转让，和「紧急停用开关」里的创世节点开关是同一个"
              when="这页只能暂停（页面右上角）；恢复要去「紧急停用开关」"
              value={<span className="g4x-param"><span className="g4x-value"><span className="g4x-value-num">{marketOn ? "未暂停" : "已暂停"}</span></span>
                <span className="g4x-dir">{marketOn ? "暂停在页面右上角" : <>恢复要去<span className="rd-keep">「紧急停用开关」</span></>}</span></span>} />
            {showcaseEnabledParam && (
              <ConfigRow key="showcase" name="App 商城入口"
                what="App 商城里显示不显示创世节点入口"
                when="确认后立即保存，App 下次读取时生效"
                effect="只管入口显示；不影响已有持仓和收益、市场状态、紧急暂停和购买资格"
                value={<span className="g4x-param"><span className="g4x-value"><span className="g4x-value-num">{g4ParamValueText("showcaseEnabled", showcaseEnabledParam.value)}</span></span><span className="g4x-dir">立即生效</span></span>}
                action={allowed(paramAuthority(showcaseEnabledParam.key)) ? (
                  <Button size="sm" disabledReason={busy ? busyReason : directRecord("params/showcaseEnabled") ? "请先核对原操作" : undefined} aria-label={`切换 ${showcaseEnabledParam.name}`} onClick={toggleShowcase}>{showcaseEnabledParam.value === "true" ? "隐藏" : "展示"}</Button>
                ) : undefined} />
            )}
            {paramRow(royaltyParam)}
          </ConfigList>
          <div className="g4x-sub">
            <div className="g4x-sub-title">转让市场</div>
            <dl className="g4x-nums">
              <div><dt>最低挂售价<Explain label="最低挂售价怎么算" content="挂售中的节点里，取得价最低的那个；没有挂售时是 0。不是挂单表里的报价。" /></dt><dd>{g4Amount(stats.secondary.floor)} USDT</dd></div>
              <div><dt>24 小时成交额<Explain label="24 小时成交额怎么算" content="过去 24 小时完成的创世节点订单金额合计，含首次认购，不只是转让。" /></dt><dd>{g4Amount(stats.secondary.vol24h)} USDT</dd></div>
              <div><dt>挂售中</dt><dd>{fmtInt(stats.secondary.listed)} 个</dd></div>
            </dl>
            <p className="g4x-sources-note">创世市场最近修改：<span className="g4x-wrap" data-mono>{overview.market.lastChange || "暂无记录"}</span></p>
            <p className="g4x-sources-note">封锁地区：{geoBlocked === "-" ? "—" : geoBlocked}</p>
          </div>
        </Panel>
      </div>

      <Fold title="空投与释放说明" icon={Gift} tone="role-4"
        summary={`${[airdropPctParam, emissionCurveParam, airdropLockDaysParam].filter(Boolean).length} 项 · 目前只保存说明，不执行发放或释放`}
        explain="这几项后端只保存说明，不会按它们发放 UVT、释放或锁仓。值有任何变化都要另一位在职超级管理员批准；空投占比和发放曲线还要填决策编号。">
        <ConfigList label="空投与释放说明">
          {paramRow(airdropPctParam, { dir: "只是说明" })}
          {paramRow(emissionCurveParam, { dir: "只是说明" })}
          {paramRow(airdropLockDaysParam, { dir: "只是说明" })}
        </ConfigList>
      </Fold>

      <G4AdminOperations ctx={ctx} refreshVersion={operationsRefresh} blocked={busy} />

      <Panel title="节点持有记录" icon={Users} tone="role-3"
        sub={`共 ${fmtInt(nodePage.total)} 条`}
        explain={<>
          <p>所有用户名下的创世节点，按节点编号排序。持有人只显示邀请码或用户编号后四位，不含手机号和姓名。</p>
          <p>累计产出是估算：按当前系列单价和每日比例乘持有天数，不是真实已付的累计；转让记录按来源和状态拼出一条，不是逐笔转让流水。这里只能查看。</p>
        </>}>
        <Table label="节点持有记录" className="g4x-node-table">
          <thead><tr><Th>节点</Th><Th>持有人</Th><Th>来源</Th><Th align="right">累计产出（估算）</Th><Th>状态</Th></tr></thead>
          <tbody>
            {overview.nodes.length === 0 && <TableMessage columns={5}>暂无节点持有记录</TableMessage>}
            {overview.nodes.map((node) => (
              <Tr key={node.id} selected={node.id === nodeDrawer} onOpen={() => setNodeDrawer(node.id)}>
                <Td><Cell main={<span data-mono>{node.id}</span>} title={node.id} /></Td>
                <Td><Cell main={<span data-mono>{node.owner}</span>} title={node.owner} /></Td>
                <Td><Cell main={operatorCopyText(node.source)} /></Td>
                <Td align="right"><Cell num main={usdtText(node.lifetimeDividend)} /></Td>
                <Td><StatusTag tone={node.statusTone === "danger" || node.statusTone === "bad" ? "danger" : node.statusTone === "warn" ? "warn" : node.statusTone === "ok" ? "ok" : "neutral"} icon={node.statusTone === "danger" || node.statusTone === "bad" || node.statusTone === "warn" || node.statusTone === "ok" ? undefined : CircleDot}>{operatorCopyText(node.statusLabel)}</StatusTag></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {nodePage.total > 0 && <Pager label="节点持有记录" sizeLabel="节点持有记录" total={nodePage.total} page={nodePage.page} pageSize={nodePage.pageSize} sizes={[10, 20, 50]}
          loading={loading || busy} onPage={(page) => loadNodePage(page)} onPageSize={(size) => { if (!loading && !busy) changeNodePageSize(String(size)); }} />}
      </Panel>

      <Fold title="技术信息（数据来源和状态）" icon={Database} tone="role-other" summary={`${fmtInt(overview.sources.length)} 个来源 · 节点状态 ${overview.stateMachine.length} 种`}>
        <p className="g4x-sources" data-mono>{overview.sources.join(" / ") || "—"}</p>
        <p className="g4x-sources-note">节点状态（固定的状态顺序，不是各状态的数量）：{overview.stateMachine.map((state) => STATE_LABEL[state] ?? "状态未知").join(" → ")}。节点持有、收益和转让记录都由系统统一记账。</p>
      </Fold>

      {selectedNode && <NodeDrawer node={selectedNode} nodes={overview.nodes} onSelect={setNodeDrawer} onClose={() => setNodeDrawer(null)} />}
    </>
  );
}

function NodeDrawer({ node, nodes, onSelect, onClose }: { node: G4Node; nodes: G4Node[]; onSelect: (id: string) => void; onClose: () => void }) {
  const index = nodes.findIndex((row) => row.id === node.id);
  const lifetime = node.dividends[0];
  return (
    <Drawer open onClose={onClose} title={`创世节点 · ${node.id}`} icon={Eye} tone="role-3"
      sub={<>持有人 <span data-mono>{node.owner}</span> · {operatorCopyText(node.statusLabel)}</>}
      explain="只能查看。收益和转让信息由系统按当前参数估算或按来源拼出，不是逐笔付款或转让流水。"
      nav={{ hasPrev: index > 0, hasNext: index >= 0 && index < nodes.length - 1, onPrev: () => onSelect(nodes[index - 1].id), onNext: () => onSelect(nodes[index + 1].id) }}
      footer={<Decision primary={<Button onClick={onClose}>关闭</Button>} />}>
      <JudgmentPoints rows={[
        { label: "购入", value: usdtText(node.buy) },
        { label: "累计产出", value: lifetime ? usdtText(lifetime.value) : "—", reason: "估算：当前每日收益 × 持有天数，不是真实已付的累计。" },
        { label: "来源", value: operatorCopyText(node.source) },
      ]} />
      <Facts>
        {node.dividends.map((item) => (
          <Fact key={item.label} k={operatorCopyText(item.label)}>{usdtText(item.value)}</Fact>
        ))}
        <Fact k="用户编号">{node.userNo || "—"}</Fact>
      </Facts>
      <Table label="转让记录（按来源拼出）">
        <thead><tr><Th>时间</Th><Th>事件</Th><Th>转让手续费</Th></tr></thead>
        <tbody>{node.transfers.map((transfer, i) => (
          <tr key={`${transfer.time}-${i}`}>
            <Td><Cell num main={transfer.time === "-" ? "—" : transfer.time} /></Td>
            <Td grow><Cell main={usdtText(transfer.event)} title={usdtText(transfer.event)} /></Td>
            <Td><Cell main={transfer.royalty === "-" ? "—" : operatorCopyText(transfer.royalty)} /></Td>
          </tr>
        ))}</tbody>
      </Table>
    </Drawer>
  );
}

