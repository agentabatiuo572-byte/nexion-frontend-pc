"use client";

/**
 * F3 团队平衡奖励（改版）。
 * 首屏回答：平衡奖励怎么算、各团队 A、B 两组差多少、最近一期发了多少、改哪一项会让平台多付钱。
 * 排法：一句结论 → 四个数 → 规则流程图 → 各团队两组对比（结算记录）→ 结算设置 → 成员分组 → 技术信息。
 * 请求仍使用原配置与结算合同；完整原请求、确认快照和恢复由 F 域上下文提供。
 * 筛选/分页保留，配置确认框从保存的原快照恢复，成员分组见 f3-placements。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeftRight, Ban, CalendarClock, CheckCircle2, CircleCheck, CircleHelp, Clock3, Hourglass, Layers3,
  Loader2, PauseCircle, PlayCircle, Scale, Settings2, Shuffle, Users,
} from "lucide-react";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, Field, FilterBar, FilterField, Fold, Input,
  KeyValues, Notice, PageHeader, Pager, Panel, SearchSelect, Segments, Select, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
  type StateTone,
} from "@/app/components/rd";
import type { LucideIcon } from "lucide-react";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { useDataListPager } from "../design-kit";
import { f3PauseState, f3SpilloverState, validF3Threshold } from "@/lib/admin/f3-policy";
import { F3_GV_RESET_PARAM_KEY, type F3Settlement } from "@/lib/admin/f1-client";
import { fetchBusinessCalendar } from "@/lib/admin/business-calendar-client";
import { F3_BATCH_SLOT, f3ConfigSlot, f3PendingFor, type F3ConfirmationSnapshot } from "@/lib/admin/f3-approval";
import { pendingPlacement, forgetPlacement } from "@/lib/admin/f3-placements-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { fBatchIssueText } from "./f-batch-names";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { FViewCtx } from "./types";
import { F3Placements, recoverPlacement } from "./f3-placements";
import { F3_MODE_EXPLAIN, F3BlockedAttempts, F3SettlementDrawer, f3ModeText } from "./f3-review";
import { F3PairBar, F3RuleFlow, PERIOD_TEXT, RESIDUAL_TEXT, residualLabel, type F3Rule } from "./f3-rule";
import { FReleaseButton } from "./f-release";
import { CONFIG_APPROVER, F3ConfirmHost, SETTLE_APPROVER, type F3Confirm } from "./f3-confirm";
import { F3PeriodOverview } from "./f3-period-overview";

const text = (value?: string | null) => operatorCopyText(value && value.trim() ? value.trim() : "—");
const fmtInt = (value: number | null) => value === null ? "—" : Math.round(value).toLocaleString("en-US");
/** 统计条上「被拦下」的说法：和「被拦下的结算」同一份最近记录（后端最多给 100 次）；结算表里的旧状态条数只在问号里说。 */
const blockedAttemptsText = (attempts: readonly unknown[] | null) => attempts === null ? "被拦下的结算读不到"
  : attempts.length === 0 ? "最近没有被拦下的结算"
    : attempts.length >= 100 ? "最近被拦下至少 100 次" : `最近被拦下 ${fmtInt(attempts.length)} 次`;
/** 后端原样的小数文字加千分位，不舍入、不补零。 */
const fmtDecimal = (raw: string) => {
  const match = /^(\d+)(\.\d+)?$/.exec(raw.trim());
  return match ? `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[2] ?? ""}` : raw.trim();
};
/** 逐笔金额：去掉后端补的末尾 0，至少两位，不舍入。 */
const fmtMoney = (raw: string) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(match[3] ?? "").replace(/0+$/, "").padEnd(2, "0")}` : raw.trim();
};
const amountText = (raw: string | null | undefined, legacy: number) => raw === undefined ? fmtInt(legacy) : raw === null ? "—" : fmtMoney(raw);
/**
 * 后端把金额先取整、再压成「$1.2k」这样的短写（OpsTeamService.moneyCompact）。不反算精确值：
 * 整数原样写，压缩过的按缩写换成整数写「约 48,200」，都带币种。
 */
function compactMoney(label: string): string | null {
  const value = label.trim();
  if (!value) return null;
  const plain = /^\$(-?\d+)$/.exec(value);
  if (plain) return `${fmtInt(Number(plain[1]))} USDT`;
  const short = /^\$(-?\d+(?:\.\d+)?)([kM])$/.exec(value);
  if (short) {
    // 按字面移小数点，不经过浮点乘法：48.2k → 48,200。
    const [whole, fraction = ""] = short[1].replace(/^-/, "").split(".");
    const places = short[2] === "k" ? 3 : 6;
    const digits = `${whole}${fraction.padEnd(places, "0").slice(0, places)}`.replace(/^0+(?=\d)/, "");
    return `约 ${short[1].startsWith("-") ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} USDT`;
  }
  return value.replace(/^\$/, "") + " USDT";
}

// Stored bare values and values ending in % both use percentage units.
function matchRatePercent(raw: string): string | null {
  const value = raw.trim().replace(/%$/, "").trim();
  const parsed = value.match(/^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!parsed) return null;
  const scale = (parsed[1] ?? parsed[2] ?? "").length - Number(parsed[3] ?? 0);
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 20 || scale > 10) return null;
  return percent.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
}

/** 结算记录的状态（TeamCommissionMapper.binarySettlements 归成的五种）。新结算写的是 PENDING：已记账、奖励在冷却。 */
const STATE: Record<string, { label: string; tone: StateTone; icon: LucideIcon; explain: string }> = {
  pending: { label: "已记账", tone: "progress", icon: Clock3, explain: "这一期的奖励已写进结算记录，记成邀请人的冷却奖励，冷却期满才能提现。这里是结算记录的状态，不随冷却进度变；每笔冷却和解锁在「奖励记录核对」看。" },
  paid: { label: "已结算", tone: "done", icon: CircleCheck, explain: "结算记录的状态是已付、已结算或已解锁。" },
  blocked: { label: "被拦下", tone: "warn", icon: Ban, explain: "结算记录的状态是被拦下、被拒、失败或冻结；只说明这条记录的状态，不能单凭它认定没发过钱。" },
  processing: { label: "结算中", tone: "progress", icon: Loader2, explain: "结算还在处理。" },
  failed: { label: "结算失败", tone: "danger", icon: AlertTriangle, explain: "这条结算记录失败；不能单凭它认定没发过钱。" },
};
const stateOf = (state: string) => STATE[state.toLowerCase()] ?? { label: operatorCopyText(state), tone: "neutral" as StateTone, icon: CircleHelp, explain: "这页不认识这个状态。" };

const SPILLOVER_VALUES = ["true", "1", "on", "已启用", "false", "0", "off", "已关闭"];

type View = "teams" | "dates";

export function F3Binary({ ctx }: { ctx: FViewCtx }) {
  const canSettle = ctx.canSubmitTeamApproval("F3");
  const canConfigure = ctx.can("network_f3_match_rate");
  const canPause = ctx.can("network_f3_engine_pause");
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const [growthZoneId, setGrowthZoneId] = useState<string | null>(null);
  const [lookupText, setLookupText] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cohortFilter, setCohortFilter] = useState("");
  const [view, setView] = useState<View>("teams");
  const [confirm, setConfirm] = useState<F3Confirm | null>(null);
  const [openRow, setOpenRow] = useState<F3Settlement | null>(null);
  const [placementChecking, setPlacementChecking] = useState(false);
  const [growthZoneLabel, setGrowthZoneLabel] = useState<string | null>(null);
  useEffect(() => {
    void fetchBusinessCalendar().then((calendar) => {
      const zone = calendar.trackZones.GROWTH_TEAM;
      setGrowthZoneId(zone);
      const label = zone === "Asia/Shanghai" ? "北京时间" : calendar.options.find((option) => option.zoneId === zone)?.label;
      if (!label) { setGrowthZoneLabel(null); return; }
      const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "";
      setGrowthZoneLabel(offset ? `${label} ${offset === "GMT" ? "UTC+0" : offset.replace("GMT", "UTC")}` : null);
    }).catch(() => setGrowthZoneLabel(null));
  }, []);
  const zone = growthZoneLabel || "业务时区尚未确认";
  const rows = ctx.f3Settlements;
  const lookupKw = lookupText.trim().toLowerCase();
  const userOptions = useMemo(() => {
    const source = lookupKw
      ? rows.filter((row) => `${row.user} ${stateOf(row.state).label} ${row.aRaw ?? row.a} ${row.bRaw ?? row.b} ${row.matchRaw ?? row.match} ${row.todayRaw ?? row.today}`.toLowerCase().includes(lookupKw))
      : rows;
    return source.slice(0, 12);
  }, [lookupKw, rows]);
  const cohorts = useMemo(
    () => Array.from(new Set(rows.map((row) => row.cohort).filter(Boolean))).sort().reverse(),
    [rows],
  );
  const filtered = rows.filter((row) =>
    (!selectedUser || row.user === selectedUser)
    && (!statusFilter || row.state === statusFilter)
    && (!cohortFilter || row.cohort === cohortFilter),
  );
  const pager = useDataListPager(filtered, {
    initialPageSize: 10,
    resetKey: `${selectedUser || "all"}:${statusFilter || "all"}:${cohortFilter || "all"}`,
  });
  const cfg = ctx.f3Config;
  const dailyCap = ctx.f3DailyCap;
  const thEff = cfg?.threshold ?? "";
  const thresholdCurrent = thEff.replace(/[$,]/g, "").trim();
  const thresholdNumber = thresholdCurrent && Number.isFinite(Number(thresholdCurrent)) ? Number(thresholdCurrent) : null;
  const thresholdText = thresholdCurrent ? `${fmtDecimal(thresholdCurrent)} USDT` : null;
  const ratePercent = matchRatePercent(cfg?.matchRate ?? "");
  const rateEff = ratePercent === null ? `比例尚未确认 · 已存值 ${text(cfg?.matchRate)}` : `${ratePercent}%`;
  const spillOn = f3SpilloverState(cfg?.spillover) === true;
  const resetEff = cfg?.gvResetCron ?? "";
  const periodEff = cfg?.settlePeriod ?? "";
  const residualEff = cfg?.residualPolicy ?? "";
  const pausedRaw = ctx.f3ConfigValues["F.binary.paused"];
  const pauseState = f3PauseState(pausedRaw, cfg?.paused);
  const binaryPaused = pauseState === true;
  const capText = dailyCap?.amountUsdt != null ? `${fmtDecimal(dailyCap.amountUsdt)} USDT` : null;
  const residualPool = ctx.f3Amounts?.residualPoolUsdRaw === undefined ? compactMoney(cfg?.residualPool ?? "")
    : ctx.f3Amounts.residualPoolUsdRaw === null ? null : `${fmtMoney(ctx.f3Amounts.residualPoolUsdRaw)} USDT`;
  // 新后端给原值；旧后端只有取整后的整数（和压缩过的残额）。
  const legacyAmounts = ctx.f3Amounts?.monthlyMatchedUsdRaw === undefined;
  const rule: F3Rule = { threshold: thresholdText, rate: ratePercent === null ? null : `${ratePercent}%`, cap: capText, period: periodEff, residual: residualEff };

  // 后端结算时逐项核对这些设置（BinarySettlementPolicyProvider.lockPolicy），不认就拦下整期结算。
  const issues = [
    !validF3Threshold(cfg?.threshold ?? "") ? "每组订单额门槛" : null,
    ratePercent === null ? "匹配比例" : null,
    !PERIOD_TEXT[periodEff] ? "结算周期" : null,
    !RESIDUAL_TEXT[residualEff] ? "没匹配上的订单额怎么处理" : null,
    !resetEff.trim() ? "归零说明" : null,
    pauseState === null ? "发放开关" : null,
    !SPILLOVER_VALUES.includes((cfg?.spillover ?? "").trim().toLowerCase()) ? "自动分组" : null,
    !capText || Number(dailyCap?.amountUsdt) <= 0 ? "每日上限（运营阶段设置）" : null,
  ].filter((item): item is string => !!item);

  // 最近一期：结算记录按结算日倒序，第一条的结算日就是最近一期（最多 100 条里）。
  const byDate = useMemo(() => {
    const groups = new Map<string, { date: string; owners: Set<string>; paid: number | null; matched: number | null; blocked: number; count: number }>();
    for (const row of rows) {
      const key = row.settlementDate || "—";
      const group = groups.get(key) ?? { date: key, owners: new Set<string>(), paid: 0, matched: 0, blocked: 0, count: 0 };
      group.owners.add(row.user);
      group.count += 1;
      if (row.state.toLowerCase() === "blocked") group.blocked += 1;
      // The new read has exact rows but no per-date monetary totals. Never sum a truncated list as an authoritative total.
      if (row.todayRaw !== undefined) group.paid = null;
      else if (row.state.toLowerCase() !== "blocked" && group.paid !== null) group.paid += row.today;
      if (row.matchRaw !== undefined) group.matched = null;
      else if (row.state.toLowerCase() !== "blocked" && group.matched !== null) group.matched += row.match;
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }, [rows]);
  const latest = byDate[0];
  const example = rows[0];

  const settlePending = ctx.f3Proposals.find(row => row.spec?.command.op === "f3_binary_settle");
  const settleOriginal = settlePending?.spec?.command.params.values as { ownerUserId: number; settlementDate: string } | undefined;
  const placementOriginal = adminId === undefined ? undefined : pendingPlacement(adminId);
  const showPlacementRecovery = !!placementOriginal && (ctx.f3Loading || !!ctx.f3Error);
  const checkPlacement = async () => {
    if (!placementOriginal || placementChecking || useAdminAuth.getState().session?.adminId !== adminId) return;
    setPlacementChecking(true);
    try {
      const result = await recoverPlacement(placementOriginal.intent);
      if (useAdminAuth.getState().session?.adminId !== adminId) return;
      if (result.resolved) forgetPlacement(adminId!);
      ctx.toast(result.message);
    } catch (error) { ctx.toast(displayAdminError(error)); }
    finally { setPlacementChecking(false); }
  };
  const configProposals = ctx.f3Proposals.filter(row => row.spec?.command.op !== "f3_binary_settle");
  const snapshot: F3ConfirmationSnapshot | undefined = cfg && dailyCap ? {
    config: cfg, configValues: ctx.f3ConfigValues, dailyCap, coverage: ctx.f3Coverage,
    zoneId: growthZoneId, zoneLabel: zone,
  } : undefined;
  useEffect(() => { setConfirm(current => current?.original ? current : null); }, [ctx.f3ReadEpoch]);
  useEffect(() => { setConfirm(null); }, [adminId]);
  useEffect(() => {
    setConfirm(current => {
      if (!current) return current;
      const record = ctx.f3Proposals.find(row => row.fingerprint === current.slot);
      if (current.original && !record) return null;
      return record && !current.original ? { ...current, original: record } : current;
    });
  }, [ctx.f3Proposals]);

  const selectUser = (user: string) => {
    setSelectedUser(user);
    setLookupText(user);
  };
  const updateLookup = (value: string) => {
    setLookupText(value);
    if (selectedUser && value !== selectedUser) setSelectedUser("");
  };
  const clearLookup = () => {
    setSelectedUser("");
    setLookupText("");
  };
  const openSettlement = () => {
    const originalSnapshot = settlePending?.f3Snapshot ?? snapshot;
    const capText = originalSnapshot?.dailyCap.amountUsdt != null ? `${fmtDecimal(originalSnapshot.dailyCap.amountUsdt)} USDT` : null;
    const periodEff = originalSnapshot?.config.settlePeriod ?? "";
    const zone = originalSnapshot?.zoneLabel ?? "业务时区尚未确认";
    const fields = [
      { key: "ownerUserId", label: "用户编号", inputKind: "number", min: 1, step: 1, pattern: "^[0-9]+$" },
      { key: "settlementDate", label: `结算日（${zone}）`, inputKind: "text", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", patternMessage: "结算日格式应为 YYYY-MM-DD", placeholder: "YYYY-MM-DD" },
    ] as const;
    ctx.openActionConfirm({ briefKind: "funds",
      name: "手动结算团队平衡奖励",
      f3Snapshot: originalSnapshot,
      businessForm: { kind: "multi-field", fields: [...fields] },
      teamApproval: {
        source: "F3",
        resolve: () => ({
          heading: `${SETTLE_APPROVER}批准后执行`,
          completionCopy: "批准前不记账、不发钱；申请登记了不等于已经发放。",
        }),
        renderForm: (value, change, locked) => <div className="f3-settle-form">
          <Facts>
            <Fact k="发给谁">只给填的这一位邀请人、这一个结算日结算（1 人）</Fact>
            <Fact k="发多少">批准时按当时的两组订单额、门槛、比例和每期上限算；提交时算不出来</Fact>
            <Fact k="钱从哪出">记成这位邀请人的团队平衡奖励，冷却期满才能提现；计入平台应付款，批准时按这笔实际金额查兑付覆盖率，低于红线就拦下</Fact>
            <Fact k="每期上限">每日上限 {capText ?? "—"}，{PERIOD_TEXT[periodEff]?.cap ?? "按结算周期算天数"}；这一天已记账的先扣掉，用完就拦下不发</Fact>
            <Fact k="已经结算过">查回原记录，不重复发，也不按新设置重算</Fact>
          </Facts>
          <Field id="ownerUserId" label="邀请人用户编号" required>
            <Input id="ownerUserId" name="ownerUserId" inputMode="numeric" autoComplete="off" disabled={locked} required value={value.ownerUserId ?? ""}
              onChange={(event) => change({ ...value, ownerUserId: event.target.value })} />
          </Field>
          <Field id="settlementDate" label="结算日" required
            help={`按${zone}已经结束的一天；不是周期结算日的，批准时会被拦下`}>
            <Input id="settlementDate" name="settlementDate" placeholder="YYYY-MM-DD" autoComplete="off" disabled={locked} required value={value.settlementDate ?? ""}
              onChange={(event) => change({ ...value, settlementDate: event.target.value })} />
          </Field>
        </div>,
      },
      run: async (reason, value) => {
        const ownerUserId = Number(value?.ownerUserId);
        const settlementDate = value?.settlementDate?.trim() ?? "";
        if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new Error("请输入有效用户编号");
        const utcDate = new Date(`${settlementDate}T00:00:00Z`);
        if (!Number.isFinite(utcDate.valueOf()) || utcDate.toISOString().slice(0, 10) !== settlementDate) {
          throw new Error("请输入有效的结算日");
        }
        await ctx.submitTeamApproval("F3", { ownerUserId, settlementDate }, reason);
      },
    });
  };

  const openConfig = (key: string, original?: FDomainAttempt) => {
    const saved = original ?? configProposals.find(row => row.fingerprint === (key === F3_BATCH_SLOT ? key : f3ConfigSlot(key)));
    const source = saved?.f3Snapshot ?? snapshot;
    if (!source || saved && !saved.f3Snapshot) {
      if (saved) void ctx.recoverF3(saved).catch(error => ctx.toast(displayAdminError(error)));
      return;
    }
    setConfirm({ ...f3ConfigurationConfirm(ctx, source, key), original: saved });
  };
  const openThreshold = () => openConfig("F.binary.threshold");
  const openRate = () => openConfig("F.binary.matchRate");
  const openSpillover = () => openConfig("F.binary.spillover");
  const openReset = () => openConfig(F3_GV_RESET_PARAM_KEY);
  const openPeriod = () => openConfig(F3_BATCH_SLOT);
  const openPause = () => openConfig("F.binary.paused");
  const whenText = "提交审批，批准后立即写入当前设置；之后每一次结算都按新值算，包括补结之前没结的日期。已经记账的奖励不重算。";
  const configBlocked = (key: string) => {
    const slot = key === F3_BATCH_SLOT ? key : f3ConfigSlot(key);
    if (configProposals.some(row => row.fingerprint === slot)) return undefined;
    if (ctx.f3Loading || ctx.f3Error || !cfg) return "团队平衡奖励读取失败，请重新读取后再操作。";
    const targets = key === F3_BATCH_SLOT ? ["F.binary.settlePeriod", "F.binary.residualPolicy"] : [key];
    const permissionIssue = key === F3_BATCH_SLOT ? fBatchIssueText(targets, useAdminAuth.getState().session?.authorities ?? []) : undefined;
    if (permissionIssue) return permissionIssue;
    return targets.some(target => f3PendingFor(ctx.f3ApprovalRows, target)) ? "这个对象已有待批单，请先到操作记录与审批核对。" : undefined;
  };

  const header = (
    <PageHeader pageId="F3" title="团队平衡奖励"
      summary="两组订单额都过门槛，按较小一组乘比例给邀请人发奖励。"
      readOnly={!canSettle && !canConfigure && !canPause ? "当前账号只能查看这页" : undefined}
      actions={<Button size="sm" onClick={() => ctx.nav("B")}>风险提醒</Button>} />
  );

  const proposalTag = (original: FDomainAttempt, approver: string) => original.ticket?.status === "pending"
    ? <StatusTag tone="warn" icon={Clock3} explain={`等${approver}在「操作记录与审批」批准；批准前不生效。`}>待审批</StatusTag>
    : original.received ? <StatusTag tone="warn" icon={CircleHelp} explain="原申请建过单，批没批准还没查到。继续查询原结果，不要重新提交。">已建单，未查到</StatusTag>
      : original.expiresAt <= Date.now()
        ? <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试，只能查询原审批单。查询明确没有这张单时，可以解除这条记录。">已过期</StatusTag>
        : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。先查询原结果；24 小时内也可以按原请求重试，不会建第二张。">结果未知</StatusTag>;
  const release = (original: FDomainAttempt, label: ReactNode) => original.expiresAt <= Date.now() && original.absent && !original.ticket && !original.received
    ? <FReleaseButton label={label} toast={ctx.toast} onRelease={() => ctx.recoverF3(original, "release")} /> : null;
  const recoveryCount = (settlePending ? 1 : 0) + configProposals.length + (showPlacementRecovery ? 1 : 0);
  const recoveryOpen = [...(settlePending ? [settlePending] : []), ...configProposals].some((row) => row.ticket?.status !== "pending") || showPlacementRecovery;
  const CONFIG_NAMES: Record<string, string> = { "F.binary.threshold": "每组订单额门槛", "F.binary.matchRate": "匹配比例", "F.binary.spillover": "自动分组", "F.binary.paused": "发放", [F3_GV_RESET_PARAM_KEY]: "归零说明", [F3_BATCH_SLOT]: "结算周期和残额处理" };
  const configName = (original: FDomainAttempt) => original.f3Snapshot && original.spec
    ? f3ConfigurationConfirm(ctx, original.f3Snapshot, original.fingerprint === F3_BATCH_SLOT ? F3_BATCH_SLOT : original.spec.obj).title
    : CONFIG_NAMES[original.fingerprint === F3_BATCH_SLOT ? F3_BATCH_SLOT : original.fingerprint.replace(/^f-config:/, "")] ?? "平衡奖励设置";
  const configChange = (original: FDomainAttempt) => {
    if (!original.spec) return "原申请内容不完整，请到「操作记录与审批」核对";
    if (original.fingerprint === "f-config:F.binary.threshold") return `${fmtDecimal(original.spec.before)} → ${fmtDecimal(original.spec.after)} USDT`;
    if (original.fingerprint !== F3_BATCH_SLOT) return `${original.spec.before} → ${original.spec.after}`;
    const value = (key: string) => /=(.*)$/.exec(original.spec!.after.split(" / ").find((item) => item.trim().startsWith(`${key}=`)) ?? "")?.[1]?.trim();
    const period = value("F.binary.settlePeriod"), residual = value("F.binary.residualPolicy");
    return period || residual ? `改为 ${[period, residual ? residualLabel(residual) : undefined].filter(Boolean).join(" · ")}` : "按原申请的结算周期和残额处理";
  };
  const recovery = recoveryCount > 0 && (
    <Notice tone="warn" title={<>{recoveryOpen ? `有 ${recoveryCount} 项原申请还没有结论` : `${recoveryCount} 项申请在等批准`}<Explain label="原申请怎么处理" content={<>
      <p>原内容和理由保存在这台电脑上。先查询原结果；24 小时内可以按原请求重试，不会建第二张审批单。</p>
      <p>查到审批单只说明申请登记了，不等于已经发钱。成员分组是直接保存，查询只读取现在的分组。</p>
    </>} /></>}>
      <ul className="f3-recovery" aria-label="还没有结论的原申请">
        {settlePending && <li>
          <span className="f3-recovery-name">手动结算</span>
          <span className="f3-recovery-change">{settleOriginal ? <>邀请人 {settleOriginal.ownerUserId} · <span className="rd-keep">结算日 {settleOriginal.settlementDate}</span></> : "原申请内容不完整，请到「操作记录与审批」核对"}</span>
          <span className="f3-recovery-time">{businessStamp(settlePending.createdAt)} 提交</span>
          <span className="f3-recovery-state">{proposalTag(settlePending, SETTLE_APPROVER)}</span>
          <span className="f3-recovery-actions"><Button size="sm" onClick={openSettlement}>查询原结果</Button>{release(settlePending, "手动结算")}</span>
        </li>}
        {configProposals.map(original => <li key={original.commandKey}>
          <span className="f3-recovery-name">{configName(original)}</span>
          <span className="f3-recovery-change">{configChange(original)}</span>
          <span className="f3-recovery-time">{businessStamp(original.createdAt)} 提交</span>
          <span className="f3-recovery-state">{proposalTag(original, CONFIG_APPROVER)}</span>
          <span className="f3-recovery-actions"><Button size="sm" onClick={() => openConfig(original.fingerprint === F3_BATCH_SLOT ? F3_BATCH_SLOT : original.spec?.obj ?? original.fingerprint.replace(/^f-config:/, ""), original)}>查询原结果</Button>{release(original, configName(original))}</span>
        </li>)}
        {showPlacementRecovery && placementOriginal && <li>
          <span className="f3-recovery-name">成员分组</span>
          <span className="f3-recovery-change">邀请人 {placementOriginal.intent.ownerUserId} · 成员 {placementOriginal.intent.memberUserId} → {placementOriginal.intent.leg} 组</span>
          <span className="f3-recovery-time">{businessStamp(placementOriginal.createdAt)} 提交</span>
          <span className="f3-recovery-state"><StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经分好组。查询只读取现在的分组，有结论前不要换个组重分。">结果未知</StatusTag></span>
          <span className="f3-recovery-actions"><Button size="sm" disabled={placementChecking} onClick={() => void checkPlacement()}>查询原结果</Button></span>
        </li>}
      </ul>
      <p className="f3-recovery-zone">提交时间为{businessZone().label}</p>
    </Notice>
  );

  if (ctx.f3Loading && rows.length === 0) {
    return <div className="f3-page">{header}{recovery}{confirm && <F3ConfirmHost confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}<BlockState state="loading" title="正在读取团队平衡奖励…" /></div>;
  }

  if (ctx.f3Error && rows.length === 0) {
    return <div className="f3-page">{header}{recovery}{confirm && <F3ConfirmHost confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}<BlockState state="error" title="团队平衡奖励数据加载失败" detail={ctx.f3Error} onRetry={() => void ctx.refreshF3()} retryLabel="重新加载" /></div>;
  }

  const conclusion = binaryPaused
    ? <Conclusion state="warn" icon={PauseCircle} hint={canPause ? "恢复要提交审批；恢复后不会自动补结暂停期间的周期。" : "恢复要有暂停权限的同事提交审批。"}
        explain="暂停后，之后每一次结算都被拦下、不发钱；已经记账的奖励不受影响。">团队平衡奖励已暂停，之后的结算都会被拦下</Conclusion>
    : issues.length > 0
      ? <Conclusion state="warn" icon={AlertTriangle} hint="在下面「结算设置」改成有效的值；每日上限在运营阶段设置。"
          explain="每次结算前逐项核对门槛、比例、周期、残额处理、归零说明、发放开关、自动分组和运营阶段的每日上限，有一项不认，这次结算就被拦下。">
          结算设置有 {issues.length} 项无效，结算会被拦下：{issues.join("、")}</Conclusion>
      : latest
        ? <Conclusion state="neutral" icon={Scale}
            explain={<><p>{latest.paid === null
              ? "最近一期是最近 100 条结算记录里最晚的结算日。这一期的金额合计系统没有算，每条记录的金额在下面「按邀请人」看。"
              : "最近一期是结算记录里最晚的结算日，按最近 100 条记录算；金额是取整后的整数，被拦下的不算。"}</p><p>这一期还没结算时，页面算不出会发多少：金额在结算时按当时的订单额、比例和上限算。</p></>}>
            最近一期 {latest.date}：{latest.owners.size} 位邀请人有结算记录{latest.paid === null ? "" : `，记账 ${fmtInt(latest.paid)} USDT`}</Conclusion>
        : <Conclusion state="neutral" icon={Scale} explain="结算记录在结算后才有；这一期会发多少，要到结算时按当时的订单额、比例和上限算。">
            团队平衡奖励在发放，{PERIOD_TEXT[periodEff]?.when ?? "按周期结算"}；还没有结算记录</Conclusion>;

  const capAction = <button type="button" className="rd-link f3-nowrap" onClick={() => ctx.nav("H")}>去运营阶段设置</button>;

  return (
    <div className="f3-page">
      {header}
      {conclusion}
      {recovery}
      {ctx.f3Error && <Notice tone="warn" title="团队平衡奖励数据刷新失败">{ctx.f3Error}</Notice>}

      <StatBand label="团队平衡奖励摘要">
        <Stat label="本月匹配订单额" icon={ArrowLeftRight} tone="role-2" value={amountText(ctx.f3Amounts?.monthlyMatchedUsdRaw, ctx.f3MonthlyMatchedUsd)} unit="USDT"
          sub={`今天 ${amountText(ctx.f3Amounts?.dailyMatchUsdRaw, ctx.f3DailyMatchUsd)} USDT`}
          explain={`本月（按业务日历从 1 日起）各种状态的结算记录里匹配订单额的合计，今天按业务日算${legacyAmounts ? "，已取整成整数" : ""}。这是两组匹配上的订单额，不是发出的奖励；奖励 = 匹配订单额 × 当时的比例。`} />
        <Stat label="没匹配上的订单额" icon={Layers3} tone="role-2" value={residualPool ? residualPool.replace(/ USDT$/, "") : "—"} unit={residualPool ? "USDT" : undefined}
          sub={residualPool ? residualLabel(residualEff) : legacyAmounts || !RESIDUAL_TEXT[residualEff] ? "残额处理无效，没有算" : "现在没有可算的订单额"}
          explain={`每位邀请人取 A、B 两组扣掉已匹配后剩得多的那一组，再加起来；按现在的残额处理算范围，不是两组差额。${legacyAmounts ? "先取整再缩写，不是精确值。" : "写「—」时不是 0：残额处理无效，或按现在的残额处理没有可算的订单额。"}`} />
        <Stat label="出过结算的邀请人" icon={Users} tone="role-3" value={fmtInt(ctx.f3ParticipantCount)} unit="人"
          sub={blockedAttemptsText(ctx.f3BlockedAttempts)}
          explain={<>
            <p>所有结算记录里出现过的邀请人人数，不限今天，也不是现在过门槛的人数。</p>
            <p>被拦下的次数和下面「被拦下的结算」是同一份，最多算最近 100 次。</p>
            {ctx.f3BlockedCount > 0 && <p>{`另有 ${fmtInt(ctx.f3BlockedCount)} 条旧结算记录是被拦下、被拒、失败或冻结，按结算日列在下面。`}</p>}
          </>} />
        <Stat label="近 7 天自动分组" icon={Shuffle} tone="role-3" value={fmtInt(ctx.f3AutoPlacement7dCount)} unit="人"
          sub={spillOn ? "自动分组已启用" : "自动分组已关闭"}
          explain="最近 7 天结算时自动补进 A 组或 B 组的成员数，按分组时间算；不含手动分组。" />
      </StatBand>

      <F3PeriodOverview ctx={ctx} />

      <Panel title="平衡奖励怎么算" icon={Scale} tone="role-4" sub="按现在的设置"
        explain="用现在的设置画：门槛、比例和周期在下面「结算设置」改，每日上限跟随运营阶段设置。改了只影响之后的结算，已经记账的不重算。">
        <F3RuleFlow rule={rule} capAction={capAction} />
        <p className="f3-example">
          {example
            ? <>最近一条：{example.user} 在 {example.settlementDate || "—"} 的结算，A 组 {amountText(example.aRaw, example.a)} USDT、B 组 {amountText(example.bRaw, example.b)} USDT，匹配 {amountText(example.matchRaw, example.match)} USDT，记账 {amountText(example.todayRaw, example.today)} USDT（{stateOf(example.state).label}{example.todayRaw === undefined ? "，整数" : ""}）</>
            : "还没有结算记录，第一笔结算后这里写出一条真实的例子。"}
          <Explain label="这条例子怎么来的" content={`取结算记录里最新的一条，金额是${example?.todayRaw === undefined ? "取整后的整数" : "这条记录的原值"}；这条记录用的是当时的门槛、比例和上限，不一定是现在的。`} />
        </p>
      </Panel>

      <Panel title="各团队 A、B 两组" icon={ArrowLeftRight} tone="role-2" sub={`最近 ${fmtInt(rows.length)} 条结算记录 · 新到旧${legacyAmounts ? " · 金额是整数" : ""}`}
        explain={<>
          <p>一条结算记录是一位邀请人在一个结算日的结算。最多列最近 100 条，按结算日从新到旧，不是全部邀请人；同一位邀请人可能有几天的记录。</p>
          <p>每一行 A 组往左、B 组往右，按这一行较大的一组定长度，看哪边小、差多少；实色是较小一组的订单额，灰色是较大一组多出来的；实际匹配额要扣掉已结算的部分、受每期上限限制，可能比实色少；刻线是现在的门槛（当时的门槛可能不同）。行和行之间看数字比大小。</p>
          <p>点一行看这一期结算后剩下的订单额、结算方式、发起人和批准人，审批单可以直接点过去。</p>
        </>}
        actions={<>
          <Link className="rd-link" href="/network/commissions" prefetch={false}>去补发 / 冲正</Link>
          {(canSettle || settlePending) && <Button size="sm" variant="primary" onClick={openSettlement}>{settlePending ? "查看原手动结算" : "手动结算"}</Button>}
        </>}>
        <FilterBar
          scope={<div className="rd-filter-scope-row"><Segments label="怎么看结算记录" value={view} onChange={setView} items={[{ value: "teams", label: "按邀请人" }, { value: "dates", label: "按结算日" }]} /></div>}
          onClear={view === "teams" ? () => { clearLookup(); setStatusFilter(""); setCohortFilter(""); } : undefined}
          canClear={view === "teams" && !!(lookupText || selectedUser || statusFilter || cohortFilter)}
          sort={<span className="rd-filter-result">{view === "teams" ? `${fmtInt(pager.total)} 条记录` : `${fmtInt(byDate.length)} 个结算日`}</span>}>
          {view === "teams" && <>
            <FilterField>
              <SearchSelect aria-label="搜索并选择用户编码" placeholder="搜索邀请人用户编码" value={lookupText} onChange={updateLookup} onSelect={selectUser}
                selected={selectedUser || undefined}
                options={Array.from(new Map(userOptions.map((row) => [row.user, row])).values()).map((row) => ({
                  value: row.user, label: row.user, extra: `A ${amountText(row.aRaw, row.a)} · B ${amountText(row.bRaw, row.b)} · ${stateOf(row.state).label}`,
                }))} empty="没有匹配的用户" />
            </FilterField>
            <FilterField>
              <Select aria-label="按结算状态筛选" value={statusFilter} onChange={setStatusFilter}
                options={[{ value: "", label: "全部状态" }, ...Array.from(new Set(rows.map((row) => row.state).filter(Boolean))).sort().map((state) => ({ value: state, label: stateOf(state).label }))]} />
            </FilterField>
            <FilterField>
              <Select aria-label="按用户群筛选" value={cohortFilter} onChange={setCohortFilter}
                options={[{ value: "", label: "全部注册月" }, ...cohorts.map((cohort) => ({ value: cohort, label: cohort }))]} />
            </FilterField>
          </>}
        </FilterBar>
        {view === "teams" ? <>
          <div className="f3-records-wrap"><Table label="各团队 A、B 两组" className="f3-records">
            <thead><tr>
              <Th>邀请人</Th>
              <Th className="f3-col-date">结算日</Th>
              <Th><span className="f3-pair-head"><span>A 组</span><span>B 组<Explain label="两组对比怎么看" side="bottom" content="每一行按这一行较大的一组定长度。实色是较小一组的订单额，灰色是较大一组多出来的；实际匹配额还要扣掉已结算的部分、受每期上限限制，可能更少；刻线和「过没过门槛」按现在的门槛判断，当时的门槛可能不同。" /></span></span></Th>
              <Th align="right">奖励 / 匹配</Th>
              <Th>状态{F3_MODE_EXPLAIN}</Th>
            </tr></thead>
            <tbody>
              {pager.pageRows.map((row, index) => <RecordRow key={`${row.user}:${row.settlementDate}:${pager.startIndex + index}`} row={row} threshold={thresholdNumber} selected={row === openRow} onOpen={() => setOpenRow(row)} />)}
              {pager.pageRows.length === 0 && <TableMessage columns={5}>{rows.length === 0 ? "还没有结算记录" : "没有符合筛选的记录"}</TableMessage>}
            </tbody>
          </Table></div>
          {pager.total > 0 && <Pager label="结算记录" total={pager.total} page={pager.page} pageSize={pager.pageSize} sizes={[10, 20, 50]}
            onPage={pager.setPage} onPageSize={pager.setPageSize} note={rows.length >= 100 ? "只列最近 100 条" : undefined} />}
        </> : (<>
          <Table label="按结算日汇总" className="f3-dates">
            <thead><tr>
              <Th>结算日</Th>
              <Th align="right">邀请人</Th>
              <Th align="right">记账奖励</Th>
              <Th align="right">匹配订单额</Th>
              <Th align="right">被拦下<Explain label="被拦下怎么算" side="bottom" content="这一天结算记录里状态是被拦下的旧记录条数。现在被拦下的结算不写结算记录，列在下面「被拦下的结算」。" /></Th>
            </tr></thead>
            <tbody>
              {byDate.map((group) => (
                <Tr key={group.date}>
                  <Td><Cell main={group.date} num /></Td>
                  <Td align="right"><Cell main={`${fmtInt(group.owners.size)} 人`} num /></Td>
                  <Td align="right"><Cell main={group.paid === null ? "—" : `${fmtInt(group.paid)} USDT`} num /></Td>
                  <Td align="right"><Cell main={group.matched === null ? "—" : `${fmtInt(group.matched)} USDT`} num /></Td>
                  <Td align="right"><Cell main={`${fmtInt(group.blocked)} 条`} num /></Td>
                </Tr>
              ))}
              {byDate.length === 0 && <TableMessage columns={5}>还没有结算记录</TableMessage>}
            </tbody>
          </Table>
          {byDate.some((group) => group.paid === null || group.matched === null) && <p className="f3-dates-note">按结算日的金额合计系统没有算，写「—」，不是 0；人数和条数照实。</p>}
        </>
        )}
      </Panel>

      <F3BlockedAttempts attempts={ctx.f3BlockedAttempts} />

      <Panel title="结算设置" icon={Settings2} tone="role-4"
        explain={`这里的修改都要提交审批，${CONFIG_APPROVER}批准后写入；批准后立即用于之后的结算，不是排到下一期。已经记账的奖励不重算。`}>
        <ConfigList label="结算设置">
          <ConfigRow name="每组订单额门槛"
            what="A、B 两组这一期的订单额都要到这个数，才参与结算。"
            when={whenText}
            effect="调低：更多团队能过门槛，平台可能多付钱；批准执行和实际结算时查兑付覆盖率。调高：更少团队能拿到奖励。"
            value={<span className="f3-cfg"><span className="f3-cfg-value">{thresholdText ?? "未配置"}</span><span className="f3-cfg-dir">调低可能多付钱</span></span>}
            action={canConfigure ? <Button size="sm" disabledReason={configBlocked("F.binary.threshold")} onClick={openThreshold}>调整</Button> : undefined} />
          <ConfigRow name="匹配比例"
            what="奖励 = 较小一组的订单额 × 这个比例，再受每期上限限制。按百分比存，1 就是 1%。"
            when={whenText}
            effect="调高：同样的订单额发更多奖励，平台可能多付钱；批准执行和实际结算时查兑付覆盖率。调低：发得更少。"
            note="App 目前读不了小于 0.00001% 的比例，已登记缺陷；后台允许保存更小的值。"
            value={<span className="f3-cfg"><span className="f3-cfg-value" data-warn={ratePercent === null ? "" : undefined}>{rateEff}</span><span className="f3-cfg-dir">调高可能多付钱</span></span>}
            action={canConfigure ? <Button size="sm" disabledReason={configBlocked("F.binary.matchRate")} onClick={openRate}>调整</Button> : undefined} />
          <ConfigRow name="结算周期和残额处理"
            what={`多久结算一次，以及两组匹配后没匹配上的订单额怎么处理。日子按业务日历（${zone}）划分。`}
            when="两项同一张审批单，批准时一起写入；之后每一次结算按新设置判断到没到结算日、怎么扣已匹配的订单额，不是从下一期才开始。已经记账的不重算。"
            effect={`改成转结：${RESIDUAL_TEXT.转结.what}`}
            note="两项各按单独修改的权限核；缺哪项的权限，「调整」上会写明。"
            value={<span className="f3-cfg"><span className="f3-cfg-value">{text(periodEff)} · {residualLabel(text(residualEff))}</span><span className="f3-cfg-dir">改成转结可能多付钱</span></span>}
            action={canConfigure ? <Button size="sm" disabledReason={configBlocked(F3_BATCH_SLOT)} onClick={openPeriod}>调整</Button> : undefined} />
          <ConfigRow name="自动分组"
            what="开启时，结算时把没分组的直接好友补到人数少的一组（一样多先分 A），已分的不动；按人数，不按订单额。"
            when="提交审批，批准后写入；开启不会马上给所有人分组，到结算时才补。"
            effect="关闭：有直接好友没分组的邀请人，结算会被拦下，要在下面「成员分组」手动分；已经分好的不撤销。"
            value={<span className="f3-cfg">{f3SpilloverState(cfg?.spillover) === null
              ? <StatusTag tone="danger" icon={Ban} explain="存的值认不出是开启还是关闭，结算时整期被拦下；重新开启或关闭一次。">配置无效</StatusTag>
              : <StatusTag tone={spillOn ? "ok" : "neutral"} icon={spillOn ? CheckCircle2 : Ban}>{spillOn ? "已启用" : "已关闭"}</StatusTag>}<span className="f3-cfg-dir">改了要批准</span></span>}
            sub={`近 7 天自动分了 ${fmtInt(ctx.f3AutoPlacement7dCount)} 人`}
            action={canConfigure ? <Button size="sm" disabledReason={configBlocked("F.binary.spillover")} onClick={openSpillover}>{spillOn ? "关闭" : "开启"}</Button> : undefined} />
          <ConfigRow name="归零说明"
            what="存着的一段说明文字，写每月什么时候归零。"
            when="提交审批，批准后只换掉这段文字。"
            effect={`不决定归零时点：每月清零时按业务日历每月 1 日 00:00（${zone}）归零，转结不归零；历史不重算。`}
            value={<span className="f3-cfg"><span className="f3-cfg-value f3-cfg-text">{text(resetEff)}</span><span className="f3-cfg-dir">实际按业务日历 · {zone}</span></span>}
            action={canConfigure ? <Button size="sm" disabledReason={configBlocked(F3_GV_RESET_PARAM_KEY)} onClick={openReset}>更新说明</Button> : undefined} />
          <ConfigRow name="发放"
            what="暂停时，全平台之后的团队平衡奖励结算都被拦下，不发钱。"
            when="暂停和恢复都要提交审批，批准后写入，之后的结算立即按新状态判断。"
            effect="暂停：已经记账的不收回。恢复：之后照常结算，仍要满足门槛、分组、上限和兑付覆盖率；暂停期间的周期不自动补结。"
            note={pauseState === null && pausedRaw !== undefined ? `存的值是「${pausedRaw}」，认不出是暂停还是发放。` : undefined}
            value={<span className="f3-cfg">{pauseState === null
              ? <StatusTag tone="danger" icon={Ban} explain="存的值认不出是暂停还是发放，结算时整期被拦下；重新选一次暂停或恢复。">配置无效</StatusTag>
              : binaryPaused ? <StatusTag tone="warn" icon={PauseCircle}>已暂停</StatusTag>
              : <StatusTag tone="ok" icon={PlayCircle}>发放中</StatusTag>}<span className="f3-cfg-dir">{binaryPaused ? "恢复会继续付钱" : "只在紧急情况下暂停"}</span></span>}
            action={canPause ? <Button size="sm" variant={binaryPaused ? "primary" : "danger-outline"} disabledReason={configBlocked("F.binary.paused")} onClick={openPause}>{binaryPaused ? "恢复发放" : "暂停发放"}</Button> : undefined} />
          <ConfigRow name="团队平衡奖励每日上限"
            what="每位邀请人每天最多记多少奖励；每期上限 = 每日上限 × 这一期的天数。"
            where="在「运营阶段设置」按运营月份设置，这里只读。"
            when="跟随运营阶段设置的当前月份；结算时读当时的值。"
            effect="这里显示的是精确值；要改去运营阶段设置。"
            value={<span className="f3-cfg"><span className="f3-cfg-value" data-proof="f3-cap-h1">{capText ?? "—"}</span><span className="f3-cfg-dir">第 {dailyCap?.currentMonth || "—"} 个月 · {text(dailyCap?.currentPhase)} · 只读</span></span>}
            action={capAction} />
        </ConfigList>
      </Panel>

      <F3Placements />

      <Fold title="技术信息（已存的原值）" icon={CalendarClock} tone="role-other" summary={`F.binary 下 ${Object.keys(ctx.f3ConfigValues).filter((key) => key.startsWith("F.binary.")).length} 项原值`}>
        <KeyValues rows={[
          ...Object.entries(ctx.f3ConfigValues).filter(([key]) => key.startsWith("F.binary.")).map(([key, value]) => ({ key, label: key, value: value || "—", mono: true })),
          { key: "window", label: "运营阶段窗口", value: text(dailyCap?.windowLabel) },
          { key: "cap", label: "每日上限原文", value: text(dailyCap?.currentLabel), mono: true },
          { key: "pool", label: "残额原文", value: text(cfg?.residualPool), sub: text(cfg?.residualSub), mono: true },
          ...ctx.f3Metrics.map((metric) => ({ key: `metric:${metric.id}`, label: `后端指标 ${metric.id}`, value: `${operatorCopyText(metric.name)} ${operatorCopyText(metric.value)}`, sub: operatorCopyText(metric.sub) })),
        ]} />
      </Fold>

      <F3SettlementDrawer row={openRow} state={openRow ? stateOf(openRow.state) : null} onClose={() => setOpenRow(null)} nav={{
        hasPrev: pager.pageRows.indexOf(openRow!) > 0,
        hasNext: openRow !== null && pager.pageRows.indexOf(openRow) >= 0 && pager.pageRows.indexOf(openRow) < pager.pageRows.length - 1,
        onPrev: () => { const i = pager.pageRows.indexOf(openRow!); if (i > 0) setOpenRow(pager.pageRows[i - 1]); },
        onNext: () => { const i = pager.pageRows.indexOf(openRow!); if (i >= 0 && i < pager.pageRows.length - 1) setOpenRow(pager.pageRows[i + 1]); },
      }} />
      {confirm && <F3ConfirmHost confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}
    </div>
  );
}

/** 一条结算记录：两组对比条、差多少、匹配和奖励、状态。 */
function RecordRow({ row, threshold, selected, onOpen }: { row: F3Settlement; threshold: number | null; selected: boolean; onOpen: () => void }) {
  const state = stateOf(row.state);
  const aText = row.aRaw === undefined ? String(row.a) : row.aRaw;
  const bText = row.bRaw === undefined ? String(row.b) : row.bRaw;
  let diff = "—", smaller: "A" | "B" | null = null;
  if (aText !== null && bText !== null) {
    const [aWhole, aFraction = ""] = aText.split("."), [bWhole, bFraction = ""] = bText.split(".");
    const scale = Math.max(aFraction.length, bFraction.length);
    const delta = BigInt(aWhole + aFraction.padEnd(scale, "0")) - BigInt(bWhole + bFraction.padEnd(scale, "0"));
    smaller = delta === BigInt(0) ? null : delta < BigInt(0) ? "A" : "B";
    const digits = (delta < BigInt(0) ? -delta : delta).toString().padStart(scale + 1, "0");
    const exact = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
    diff = row.aRaw === undefined ? fmtDecimal(exact) : fmtMoney(exact);
  }
  const a = aText === null ? null : Number(aText), b = bText === null ? null : Number(bText);
  const passA = threshold !== null && a !== null && a >= threshold, passB = threshold !== null && b !== null && b >= threshold;
  const pass = a === null || b === null ? "—" : threshold === null ? "门槛没读到" : passA && passB ? "都过门槛" : !passA && !passB ? "都没过门槛" : `${passA ? "B" : "A"} 组没过门槛`;
  return (
    <Tr selected={selected} onOpen={onOpen}>
      <Td><Cell main={<span data-mono>{row.user}</span>} sub={<>
        <span className="f3-sub-wide">{row.cohort ? `${row.cohort} 注册` : "注册月 —"}</span>
        <span className="f3-sub-narrow">{row.settlementDate || "—"}</span>
      </>} /></Td>
      <Td className="f3-col-date"><Cell main={row.settlementDate || "—"} num /></Td>
      <Td>
        <span className="f3-pair-cell">
          <span className="f3-pair-num" data-small={smaller === "A" ? "" : undefined}>{amountText(row.aRaw, row.a)}</span>
          {a === null || b === null
            ? <span className="f3-pair-missing" title="这条记录没有两组的订单额">—</span>
            : <F3PairBar a={a} b={b} max={Math.max(a, b)} threshold={threshold} label={`A 组 ${amountText(row.aRaw, row.a)} USDT，B 组 ${amountText(row.bRaw, row.b)} USDT`} />}
          <span className="f3-pair-num" data-small={smaller === "B" ? "" : undefined}>{amountText(row.bRaw, row.b)}</span>
          <span className="f3-pair-note">{a === null || b === null ? "—" : `${smaller ? `${smaller} 组少 ${diff}` : "两组一样"} · ${pass}`}</span>
        </span>
      </Td>
      <Td align="right"><Cell num main={`${amountText(row.todayRaw, row.today)} USDT`} sub={`匹配 ${amountText(row.matchRaw, row.match)} USDT`} /></Td>
      <Td><Cell main={<StatusTag tone={state.tone} icon={state.icon} explain={state.explain}>{state.label}</StatusTag>} sub={f3ModeText(row.settlementMode) ?? undefined} /></Td>
    </Tr>
  );
}

/** Render the existing confirmation from the original read, never a later toggle state. */
function f3ConfigurationConfirm(ctx: FViewCtx, snapshot: F3ConfirmationSnapshot, key: string): F3Confirm {
  const cfg = snapshot.config, zone = snapshot.zoneLabel;
  const thresholdCurrent = cfg.threshold.replace(/[$,]/g, "").trim();
  const thresholdNumber = thresholdCurrent && Number.isFinite(Number(thresholdCurrent)) ? Number(thresholdCurrent) : null;
  const thresholdText = thresholdCurrent ? `${fmtDecimal(thresholdCurrent)} USDT` : null;
  const ratePercent = matchRatePercent(cfg.matchRate);
  const rateEff = ratePercent === null ? `比例尚未确认 · 已存值 ${text(cfg.matchRate)}` : `${ratePercent}%`;
  const spillOn = f3SpilloverState(cfg.spillover) === true;
  const resetEff = cfg.gvResetCron, periodEff = cfg.settlePeriod, residualEff = cfg.residualPolicy;
  const binaryPaused = f3PauseState(snapshot.configValues["F.binary.paused"], cfg.paused) === true;
  const rule: F3Rule = { threshold: thresholdText, rate: ratePercent === null ? null : `${ratePercent}%`, cap: snapshot.dailyCap.amountUsdt != null ? `${fmtDecimal(snapshot.dailyCap.amountUsdt)} USDT` : null, period: periodEff, residual: residualEff };
  const approvalTag = (more: string) => (
    <StatusTag tone="progress" filled explain={`${CONFIG_APPROVER}（需有团队平衡奖励的${more}权限和审批批准权限）在「操作记录与审批」批准后写入；批准前仍按现在的设置结算。`}>批准后生效</StatusTag>
  );
  const whenFacts = <>
    <Fact k="什么时候生效">批准后立即写入，之后每次结算都按新值算</Fact>
    <Fact k="已经记账的">不重算；补结之前没结的日期也按新值</Fact>
  </>;

  const openThreshold = (): F3Confirm => ({
    action: "调整每组订单额门槛", title: "调整每组订单额门槛", briefKind: "config",
    effect: approvalTag("配置"),
    edit: { kind: "number", label: "改后的门槛", current: thresholdCurrent, unit: "USDT", min: 0.000001, max: 5000, maxDecimals: 6, amplifiesWhen: "decrease", hint: "大于 0、不超过 5,000，最多 6 位小数" },
    facts: (value) => <>
      <Facts>
        <Fact k="每组订单额门槛">{value === undefined ? text(thresholdText) : <Change from={text(thresholdText)} to={`${fmtDecimal(value)} USDT`} />}</Fact>
        {value !== undefined && thresholdNumber !== null && Number(value) !== thresholdNumber && <Fact k="方向" tone={Number(value) < thresholdNumber ? "warn" : undefined}>
          {Number(value) < thresholdNumber ? "调低：更多团队能过门槛，平台可能多付钱" : "调高：更少团队能过门槛，之后发的会变少"}
        </Fact>}
        {whenFacts}
      </Facts>
      <F3RuleFlow compact rule={rule} next={value === undefined ? undefined : { threshold: `${fmtDecimal(value)} USDT` }} changed={["threshold"]} />
    </>,
    coverageLead: "调低门槛会让更多团队拿到奖励，平台可能多付钱",
    coverageCheck: "批准执行时查兑付覆盖率；每一笔结算时还会按实际要付的金额再查一次。",
    detail: `每组订单额门槛 · 现在 ${text(thresholdText)}。`,
    statedBrief: { impact: "批准后，之后的结算按新门槛判断两组过没过；已经记账的奖励不变。", check: "核对新门槛和单位（USDT）；调低可能多付钱，先看兑付覆盖率。" },
    submit: async (reason, _fields, newValue) => {
      const value = (newValue ?? "").trim();
      if (!/^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(value)) throw new Error("门槛须填写普通数字，最多 6 位小数，不会自动取整。");
      await ctx.updateF3Config("F.binary.threshold", value, reason, thresholdCurrent === "" ? undefined : Number(value) < Number(thresholdCurrent), snapshot);
    },
    done: "门槛已提交审批，批准前仍按原设置结算",
  });

  const openRate = (): F3Confirm => ({
    action: "调整匹配比例", title: "调整匹配比例", briefKind: "config",
    effect: approvalTag("配置"),
    edit: { kind: "number", label: "改后的比例（填 1 就是 1%）", current: ratePercent ?? "", unit: "%", min: 0.0000000001, max: 20, maxDecimals: 10, amplifiesWhen: "increase", hint: "大于 0、不超过 20，最多 10 位小数" },
    facts: (value) => <>
      <Facts>
        <Fact k="匹配比例">{value === undefined ? rateEff : <Change from={rateEff} to={`${value}%`} />}</Fact>
        {value !== undefined && ratePercent !== null && Number(value) !== Number(ratePercent) && <Fact k="方向" tone={Number(value) > Number(ratePercent) ? "warn" : undefined}>
          {Number(value) > Number(ratePercent) ? "调高：同样的订单额发更多奖励，平台可能多付钱" : "调低：同样的订单额发更少奖励"}
        </Fact>}
        {value !== undefined && Number(value) > 0 && Number(value) < 0.00001 && <Fact k="App" tone="warn">App 目前读不了这么小的比例（小于 0.00001%），用户的团队页会读取失败；后台允许保存，已登记缺陷</Fact>}
        {whenFacts}
      </Facts>
      <F3RuleFlow compact rule={rule} next={value === undefined ? undefined : { rate: `${value}%` }} changed={["rate"]} />
    </>,
    coverageLead: "调高比例会让同样的订单额发更多奖励，平台可能多付钱",
    coverageCheck: "批准执行时查兑付覆盖率；每一笔结算时还会按实际要付的金额再查一次。",
    detail: `较小一组订单额 × 这个比例 = 奖励 · 现在 ${rateEff}。`,
    statedBrief: { impact: "批准后，之后的结算按新比例算奖励，还要受每期上限限制；已经记账的奖励按当时的比例，不变。", check: "按百分比填，1 就是 1%；调高可能多付钱，先看兑付覆盖率。" },
    submit: async (reason, _fields, newValue) => {
      const value = (newValue ?? "").trim();
      if (!/^(?:\d+(?:\.\d{1,10})?|\.\d{1,10})$/.test(value)) throw new Error("比例须填写普通数字，最多 10 位小数，不会自动四舍五入。");
      await ctx.updateF3Config("F.binary.matchRate", `${value}%`, reason, ratePercent === null ? undefined : Number(value) > Number(ratePercent), snapshot);
    },
    done: "匹配比例已提交审批，批准前仍按原设置结算",
  });

  const openSpillover = (): F3Confirm => ({
    action: "调整自动分组", title: spillOn ? "关闭自动分组" : "开启自动分组", briefKind: "config",
    effect: approvalTag("配置"),
    edit: { kind: "select", current: spillOn ? "已启用" : "已关闭", initialValue: spillOn ? "已关闭" : "已启用", options: ["已启用", "已关闭"] },
    facts: (value) => <Facts>
      <Fact k="自动分组">{value === undefined || value === (spillOn ? "已启用" : "已关闭") ? (spillOn ? "已启用" : "已关闭") : <Change from={spillOn ? "已启用" : "已关闭"} to={value} />}</Fact>
      {(value ?? (spillOn ? "已关闭" : "已启用")) === "已关闭"
        ? <><Fact k="关闭后" tone="warn">不再自动补齐，有人没分组的邀请人结算会被拦下</Fact><Fact k="要做的">在「成员分组」手动分；已经分好的不撤销</Fact></>
        : <Fact k="开启后">结算时把没分组的直接好友补到人数少的一组，一样多先分 A；按人数，不按订单额。不会马上给所有人分组</Fact>}
      <Fact k="什么时候生效">批准后写入，之后的结算按新设置判断要不要补齐</Fact>
    </Facts>,
    detail: "自动分组按两组人数补齐没分组的成员，在结算时进行。",
    statedBrief: { impact: "批准后，之后的结算按新设置决定要不要自动补齐分组；已经分好的组不变。", check: "关闭前确认有人手动分组，否则这些邀请人的结算会被拦下。" },
    submit: async (reason, _fields, newValue) => {
      if (!newValue) throw new Error("请填写新值");
      await ctx.updateF3Config("F.binary.spillover", newValue, reason, undefined, snapshot);
    },
    done: "自动分组已提交审批，批准前仍按原设置结算",
  });

  const resetOption = snapshot.zoneId ? `每月 1 日 00:00 ${snapshot.zoneId}` : "";
  const openReset = (): F3Confirm => ({
    action: "更新归零说明", title: "更新归零说明", briefKind: "config",
    effect: approvalTag("配置"),
    edit: { kind: "select", current: resetEff, options: resetOption ? [resetOption] : [], initialValue: resetOption, optionLabels: { [resetOption]: `每月 1 日 00:00 ${zone}` } },
    facts: <Facts>
      <Fact k="已存的说明">{text(resetEff)}</Fact>
      <Fact k="实际归零">每月清零时按业务日历每月 1 日 00:00（{zone}）；转结不归零。这段说明不决定归零时点</Fact>
      <Fact k="改了会怎样">只换存着的说明文字，不改日历、不重算历史</Fact>
    </Facts>,
    detail: `已存说明：${text(resetEff)}。只更新说明，实际归零按业务日历。`,
    statedBrief: { impact: "批准后只换掉存着的说明文字；归零时点、业务日历和历史结算都不变。", check: "核对要换成的说明文字。" },
    submit: async (reason, _fields, newValue) => {
      if (!newValue) throw new Error("请填写新值");
      await ctx.updateF3Config(F3_GV_RESET_PARAM_KEY, newValue, reason, undefined, snapshot);
    },
    done: "归零说明已提交审批",
  });

  const openPeriod = (): F3Confirm => ({
    action: "结算周期与未匹配订单额处理调整", title: "调整结算周期和残额处理", briefKind: "config",
    effect: approvalTag("配置"),
    amplify: true,
    coverageLead: "改成「转结」或缩短周期，之后可能多付奖励",
    coverageCheck: "这次提交不按这两项查兑付覆盖率；每一笔结算时按实际要付的金额查，低于红线就拦下。",
    businessForm: {
      kind: "multi-field",
      fields: [
        { key: "period", label: "结算周期", current: periodEff, inputKind: "select", options: ["每日", "每周", "每月"],
          explain: "每日：每天结算，上限 = 每日上限 × 1；每周：每周日结算，× 7；每月：每月最后一天结算，× 当月天数。", help: `日子按${zone} 划分` },
        { key: "residual", label: "没匹配上的订单额", current: residualEff, inputKind: "select", options: ["每月清零", "每次对碰清零", "转结"], optionLabels: { "每次对碰清零": "每次匹配后清零" },
          explain: `每月清零：${RESIDUAL_TEXT.每月清零.what} 每次匹配后清零：${RESIDUAL_TEXT.每次对碰清零.what} 转结：${RESIDUAL_TEXT.转结.what}`,
          warning: (value) => value.residual === "转结" && residualEff !== "转结" ? "转结会让没匹配上的订单额一直参与之后的匹配，之后多付奖励。" : undefined },
      ],
    },
    facts: <Facts>
      <Fact k="现在">{text(periodEff)}结算 · 没匹配上的订单额{residualLabel(text(residualEff))}</Fact>
      <Fact k="什么时候生效">两项同一张审批单，批准时一起写入，失败都不改</Fact>
      <Fact k="之后的结算">下一次结算就按新设置，不是排到下一期</Fact>
      <Fact k="已经记账的">不重算</Fact>
      <Fact k="权限">两项各按单独修改的权限核，缺一项就提交不了</Fact>
    </Facts>,
    detail: "结算周期和没匹配上的订单额怎么处理，同一张审批单。",
    statedBrief: (value) => ({
      impact: `批准后改成${value.period || periodEff}结算（${PERIOD_TEXT[value.period || periodEff]?.cap ?? "按周期算天数"}），没匹配上的订单额${residualLabel(value.residual || residualEff)}；已经记账的不重算。`,
      check: "转结会让之后多付奖励，先看兑付覆盖率。",
    }),
    submit: async (reason, businessValue) => {
      if (!businessValue) throw new Error("请填写新值");
      await ctx.updateFConfigBatch("F3", [
        { key: "F.binary.settlePeriod", value: String(businessValue.period ?? "").trim() },
        { key: "F.binary.residualPolicy", value: String(businessValue.residual ?? "").trim() },
      ], reason, snapshot);
    },
    done: "结算周期和残额处理已提交审批，批准前仍按原设置结算",
  });

  const openPause = (): F3Confirm => (binaryPaused ? {
    action: "恢复团队平衡奖励发放", title: "恢复发放", briefKind: "config",
    effect: <StatusTag tone="progress" filled explain={`${CONFIG_APPROVER}（需有团队平衡奖励暂停权限和审批批准权限）在「操作记录与审批」批准后写入；批准前仍是暂停。`}>批准后生效</StatusTag>,
    facts: <Facts>
      <Fact k="发放"><Change from="已暂停" to="发放中" /></Fact>
      <Fact k="之后的结算" tone="warn">恢复结算；仍要满足门槛、分组、每期上限和兑付覆盖率才发钱</Fact>
      <Fact k="暂停期间的周期">恢复后不自动补结</Fact>
      <Fact k="要补的话">按邀请人和结算日逐个手动结算</Fact>
    </Facts>,
    detail: "恢复团队平衡奖励发放。",
    statedBrief: { impact: "批准后，之后的结算不再被拦下；暂停期间没结的周期不自动补。", check: "确认暂停的原因已经处理完。" },
    submit: async (reason) => { await ctx.updateF3Config("F.binary.paused", "off", reason, undefined, snapshot); },
    done: "恢复发放已提交审批，批准前仍是暂停",
  } : {
    action: "暂停团队平衡奖励发放", title: "暂停发放", briefKind: "record", confirmTone: "danger",
    effect: <StatusTag tone="progress" filled explain={`${CONFIG_APPROVER}（需有团队平衡奖励暂停权限和审批批准权限）在「操作记录与审批」批准后写入；批准前照常发放。`}>批准后生效</StatusTag>,
    facts: <Facts>
      <Fact k="发放"><Change from="发放中" to="已暂停" /></Fact>
      <Fact k="影响范围" tone="warn">全平台所有邀请人之后的团队平衡奖励结算都被拦下，不发钱；只管这项奖励</Fact>
      <Fact k="已经记账的">不收回、不冲正</Fact>
      <Fact k="恢复以后">暂停期间到期的周期不自动补结</Fact>
      <Fact k="要补的话">按邀请人和结算日逐个手动结算</Fact>
    </Facts>,
    detail: "暂停后全平台的团队平衡奖励结算都会被拦下，只在紧急情况下使用。",
    statedBrief: { impact: "批准后，之后的结算全部被拦下；已经记账的奖励不受影响。提交本身不会马上停。", check: "只在紧急情况下用；理由写清原因和工单号。" },
    submit: async (reason) => { await ctx.updateF3Config("F.binary.paused", "on", reason, undefined, snapshot); },
    done: "暂停发放已提交审批，批准前照常发放",
  });


  const build: Record<string, () => F3Confirm> = {
    "F.binary.threshold": openThreshold, "F.binary.matchRate": openRate, "F.binary.spillover": openSpillover,
    [F3_GV_RESET_PARAM_KEY]: openReset, [F3_BATCH_SLOT]: openPeriod, "F.binary.paused": openPause,
  };
  return { ...build[key](), slot: key === F3_BATCH_SLOT ? key : f3ConfigSlot(key) };
}
