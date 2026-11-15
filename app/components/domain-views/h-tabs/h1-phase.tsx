"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps
} from "react";
import Link from "next/link";
import {
  CalendarRange,
  ChartNoAxesCombined,
  Clock3,
  Flag,
  GitBranch,
  ListChecks,
  LockKeyhole,
  MapPin,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Users
} from "lucide-react";
import {
  BlockState,
  Button,
  Change,
  Conclusion,
  ConfigList,
  ConfigRow,
  Decision,
  Drawer,
  Explain,
  Fact,
  Facts,
  Fold,
  Notice,
  PageHeader,
  Panel,
  ReleaseModal,
  ScaleBar,
  SectionNav,
  StageLine,
  Stat,
  StatBand,
  StatusTag,
  Table,
  TableMessage,
  Td,
  Th,
  Tr,
  useSectionNav
} from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import {
  describeH1Schedule,
  fetchH1Phases,
  type H1Phases,
  type H1RhythmOverview
} from "@/lib/admin/h-client";
import { h1DialIssue } from "@/lib/admin/h1-dial-validation";
import {
  beginH1,
  executeH1,
  h1Pending,
  h1Request,
  lookupH1,
  type H1Pending,
  type H1Request
} from "@/lib/admin/h1-mutations";
import {
  displayAdminError,
  displayAdminReadError
} from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { formatBusinessTimeFull } from "@/lib/admin/business-time";
import {
  isRetryExpired,
  RETRY_EXPIRED_TEXT
} from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { roleLabel } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import type { HCtx } from "./types";

const DIALS = [
  {
    key: "newUserBonusMultiplier",
    label: "新用户加成",
    unit: "倍",
    min: 1,
    max: 4,
    what: "本月新用户相关奖励的倍率",
    effect: "调高是放大，要审批；已结算的奖励不保证补发。"
  },
  {
    key: "inviteRewardMultiplier",
    label: "邀请加成",
    unit: "倍",
    min: 1,
    max: 4,
    what: "本月邀请奖励的倍率",
    effect: "调高是放大，要审批；已结算的邀请奖励不重算。"
  },
  {
    key: "reinvestMultiplier",
    label: "锁定计划加成",
    unit: "倍",
    min: 1,
    max: 4,
    what: "参与锁定计划使用的阶段倍率",
    effect: "调高是放大，要审批；已参与的仍按参与时的倍率。"
  },
  {
    key: "withdrawCooldownDays",
    label: "到账审查窗口",
    unit: "天",
    min: 0,
    max: 90,
    what: "提现从提交起要等多少天才能放行",
    effect: "调低是放大，要审批。越南盾提现每笔都等；USDT 在加强合规审查开着，且超过 1,000\u00a0USDT 时才等；风控延迟、冻结的也按它算。"
  },
  {
    key: "binaryDailyCap",
    label: "团队平衡奖励每日上限",
    unit: "USD",
    min: 0,
    max: 50000,
    what: "每日团队平衡奖励的封顶额",
    effect: "调高是放大，要审批；可以设成 0。"
  },
  {
    key: "questBonusMultiplier",
    label: "任务加成",
    unit: "倍",
    min: 1,
    max: 4,
    what: "本月任务奖励的倍率",
    effect: "调高是放大，要审批；已结算的任务奖励不重算。"
  },
  {
    key: "complianceHoldEnabled",
    label: "加强合规审查",
    unit: "",
    min: 0,
    max: 1,
    what: "USDT 提现加强人工审查的开关",
    effect: "关闭是放大，要审批。开启时 USDT 三个网络的提现每笔人工审查，本金超过 1,000 USDT 的还要等到账审查窗口；关闭后也不保证自动通过。"
  },
] as const;
type Dial = typeof DIALS[number];
const SECTIONS = [{
  id: "arrangement",
  label: "总体安排"
},
{
  id: "monthly",
  label: "每月参数"
},
{
  id: "controls",
  label: "阶段切换"
},
{
  id: "overrides",
  label: "单独覆盖"
},
{
  id: "attribution",
  label: "阶段归因"
}];
const CONTROL_NAMES: Record<string,
  string> = {
  schedule: "排程",
  pin: "锁定当前阶段",
  override: "单独覆盖策略"
};
const LOCKED = "这项有一次提交结果未知或在等审批，先到页面上方处理";
const APPROVER = "另一位超级管理员，需有审批权限和这页的修改权限；不能自己批。";
const CONTROL_EFFECT = "批准后只保存设置，系统目前不会按它执行。";
type Confirm = Omit<ComponentProps<typeof OperationConfirmModal>,
  "onConfirm" | "onClose"> & {
    scope: string; run: (reason: string,
      value?: string,
      form?: Record<string,
        string>) => Promise<void>
  };

function text(value: unknown,
  fallback = "—") { return value == null || value === "" ? fallback : String(value); }
function number(value: string | number | null | undefined) { return value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null; }
function format(value: unknown,
  places?: number) {
  const raw = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return raw;
  const [whole,
    fractional = ""] = raw.split(".");
  const actual = fractional.replace(/0+$/, "");
  const width = places ?? Math.max(2, actual.length);
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,
    ",")}${width ? `.${actual.padEnd(width,
        "0")}` : ""}`;
}
function pendingValue(row: H1Pending, value: string) {
  const dial = DIALS.find((item) => row.scope.startsWith("dial:") && row.scope.endsWith(`:${item.key}`));
  return dial && dial.unit ? `${format(value, dial.key === "withdrawCooldownDays" ? 0 : undefined)} ${dial.unit}` : value;
}
function amplifies(key: string,
  before: string,
  after: string) {
  if (!after || h1DialIssue(key,
    after)) return false;
  if (key === "complianceHoldEnabled") return before === "是" && after === "否";
  return key === "withdrawCooldownDays" ? Number(after) < Number(before) : Number(after) > Number(before);
}

export default function H1Phase({ ctx,
  onRhythmChange }: { ctx: HCtx; onRhythmChange: (rhythm: H1RhythmOverview) => void }) {
  const session = useAdminAuth((state) => state.session);
  const can = (authority: string) => session?.authorities.includes(authority) === true;
  const canRead = can("growth_h1_read");
  const canWrite = can("growth_h1_write");
  const canControl = can("growth_h1_control_pin_write");
  const canRevoke = can("growth_h1_override_revoke");
  const canPropose = can("platform_a2_proposal_create") || can("platform_a2_write");
  const reach = useReach();
  const [model,
    setModel] = useState<H1Phases | null>(null);
  const [loading,
    setLoading] = useState(true);
  const [error,
    setError] = useState<string | null>(null);
  const [readAt,
    setReadAt] = useState<string>();
  const [pending,
    setPending] = useState<H1Pending[]>([]);
  const [confirm,
    setConfirm] = useState<Confirm | null>(null);
  const [detail,
    setDetail] = useState<H1Pending | null>(null);
  const [release,
    setRelease] = useState<H1Pending | null>(null);
  const [checked,
    setChecked] = useState<string>();
  const [sending,
    setSending] = useState<string>();
  const [busy,
    setBusy] = useState(false);
  const [feedback,
    setFeedback] = useState<string>();
  const [folds,
    setFolds] = useState<Record<string,
      boolean>>({});
  const [deepLink,
    setDeepLink] = useState<{ phase: string; dial: string } | null>(null);
  const sequence = useRef(0);
  const syncPending = useCallback(() => setPending(h1Pending.list().filter((row) => row.actorId === session?.adminId)),
    [session?.adminId]);
  const nav = useSectionNav(SECTIONS,
    {
      ready: !!model && !loading,
      onReveal: (id) => setFolds((value) => ({
        ...value,
        [id]: true
      }))
    });
  const applyReceipt = (receipt: Partial<H1Phases> & Pick<H1Phases,
    "rhythm">) => {
    setModel((current) => current ? {
      ...current,
      ...receipt
    } : null);
    onRhythmChange(receipt.rhythm);
  };
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const next = await fetchH1Phases();
      if (seq !== sequence.current) return false;
      setModel(next); onRhythmChange(next.rhythm); setError(null); setReadAt(new Date().toISOString());
      return true;
    } catch (failure) {
      if (seq === sequence.current) setError(displayAdminReadError(failure));
      return false;
    } finally { if (seq === sequence.current) setLoading(false); }
  },
    [onRhythmChange]);
  useEffect(() => { if (canRead) void reload(); else setLoading(false); return () => { sequence.current += 1; }; },
    [canRead,
      reload]);
  useEffect(syncPending,
    [syncPending]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phase = params.get("phase")?.toUpperCase() ?? "";
    const dial = params.get("dial") ?? "";
    if (params.get("from") === "B4" && (/^P[1-6]$/.test(phase) || dial)) setDeepLink({
      phase: /^P[1-6]$/.test(phase) ? phase : "",
      dial
    });
  },
    []);
  useEffect(() => {
    if (!model || loading || !deepLink) return;
    const target = deepLink.dial === "phaseAttribution" ? "attribution" : DIALS.some((dial) => dial.key === deepLink.dial) ? "monthly" : deepLink.phase ? "attribution" : null;
    if (target) nav.select(target);
    if (target === "attribution" && deepLink.phase) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const card = document.getElementById(`h1-attribution-${deepLink.phase}`);
        card?.scrollIntoView({ block: "start" });
        card?.focus({ preventScroll: true });
      }));
    }
    // Incoming B4 parameters locate once after the initial read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },
    [!!model,
      deepLink]);

  const rhythm = model?.rhythm;
  const rows = model?.monthlyDials ?? [];
  const currentRow = rows.find((row) => row.month === rhythm?.currentMonth);
  const stages = model?.attribution.map((row) => ({
    id: row.phase,
    label: row.name || row.phase,
    sub: row.phase
  })) ?? [];
  const phaseKnown = !!rhythm?.currentPhase && stages.some((stage) => stage.id === rhythm.currentPhase);
  const phaseLabel = phaseKnown ? `${rhythm!.currentPhase} ${model?.attribution.find((row) => row.phase === rhythm?.currentPhase)?.name}` : "当前阶段待核实";
  const totalValid = rhythm?.totalMonths != null && rhythm.options.includes(rhythm.totalMonths);
  const monthValid = totalValid && rhythm?.currentMonth != null && Number.isInteger(rhythm.currentMonth) && rhythm.currentMonth >= 1 && rhythm.currentMonth <= rhythm.totalMonths!;
  const progressValid = rhythm?.phaseProgressPct != null && Number.isInteger(rhythm.phaseProgressPct) && rhythm.phaseProgressPct >= 0 && rhythm.phaseProgressPct <= 100;
  const unavailable = [!totalValid && "运营总月数未配置或不合法",
  !monthValid && "当前月份不可用",
  !phaseKnown && "当前阶段没有设置或不在阶段列表里",
  monthValid && !currentRow && "缺本月参数"].filter(Boolean).join("；");
  const coverage = model?.coverage;
  const ratio = number(coverage?.coverageRatio);
  const redline = number(coverage?.redlinePct);
  const fundingBlocked = !coverage?.reliable || coverage.redlineBreached || ratio == null || ratio <= 0 || redline == null || redline <= 0;
  const freshBlock = loading ? "正在读取最新数据，请稍后操作" : error ? "数据没读到，请先刷新" : undefined;
  const scopeBlock = (scope: string) => freshBlock ?? (pending.some((row) => row.scope === scope) ? LOCKED : undefined);
  const precision = useMemo(() => Object.fromEntries(DIALS.map((dial) => [dial.key,
  dial.key === "withdrawCooldownDays" || dial.key === "complianceHoldEnabled" ? 0 : Math.max(2,
    ...rows.map((row) => text(row.dials[dial.key],
      "").split(".")[1]?.replace(/0+$/,
        "").length ?? 0))])),
    [rows]);
  const permitted = (row: H1Pending) => !(row.requests.some((request) => request.kind === "proposal") && !canPropose) && (row.scope === "rhythm" || row.scope.startsWith("dial:") ? canWrite : row.scope.startsWith("control:") ? canControl && canPropose : canRevoke && canPropose);

  const afterWrite = async (row: H1Pending,
    retry = false) => {
    setChecked(undefined);
    setFeedback(undefined);
    setSending(row.commandKey);
    try {
      const result = await executeH1(row,
        applyReceipt,
        retry);
      syncPending();
      if (result?.state === "approval") {
        ctx.toast("已提交，等待审批后执行",
          "success");
        setFolds((value) => ({
          ...value,
          [row.scope.startsWith("control:") ? "controls" : row.scope.startsWith("override:") ? "overrides" : "monthly"]: true
        }));
      } else if (await reload()) ctx.toast(`${row.label}已保存`,
        "success");
      else setFeedback(`${row.label}已保存，但刷新没成功；请刷新核对，不要再次提交。`);
      setConfirm(null);
    } catch (failure) { syncPending(); throw failure; }
    finally { setSending(undefined); }
  };
  const submit = async (scope: string,
    label: string,
    before: string,
    after: string,
    reason: string,
    requests: H1Request[]) => {
    if (!session) throw new Error("请先恢复登录状态");
    const previous = h1Pending.list().find((row) => row.actorId === session.adminId && row.scope === scope);
    if (previous) {
      await afterWrite(previous,
        true); return;
    }
    const row = beginH1({
      actorId: session.adminId,
      operator: currentAdminOperator(),
      scope,
      label,
      before,
      after,
      reason,
      requests
    });
    syncPending(); await afterWrite(row);
  };
  const patch = (key: string,
    value: string,
    reason: string,
    label: string,
    path = `/rhythm/${key}`) => h1Request("patch",
      path,
      {
        key,
        value,
        reason,
        operator: currentAdminOperator()
      },
      label);
  const proposal = (op: "h1_phase_dial" | "h1_phase_control" | "h1_phase_override",
    args: Record<string,
      unknown>,
    label: string,
    obj: string,
    before: string,
    after: string,
    reason: string) => {
    const def = findHighOp(op)!;
    return h1Request("proposal",
      "/platform/audit/operations",
      {
        action: label,
        obj,
        beforeValue: before,
        afterValue: after,
        operator: currentAdminOperator(),
        operatorRole: roleLabel(session!.role),
        type: "param",
        amplifies: op === "h1_phase_dial",
        sos: false,
        roleGate: def.gateLabel,
        reason,
        sourceDomain: "H1",
        command: def.buildCommand(args),
        target: def.buildTarget(args)
      },
      label);
  };
  const openTotal = () => {
    if (!rhythm || !canWrite) return;
    const scope = "rhythm";
    setConfirm({
      scope,
      briefKind: "config",
      action: "调整运营总月数",
      title: "修改运营总月数",
      statedBrief: {
        impact: "每月参数表按新的总月数重排。",
        check: "核对缩短的影响，理由写明依据或工单号。"
      },
      detail: "每月参数表按新的总月数重排。",
      facts: <Facts>
        <Fact k="影响">当前月超出新总月数时改成最后一个月并换参数；会多付钱时先查兑付覆盖率，低于红线会被拒。</Fact>
      </Facts>,
      effect: <StatusTag tone="progress" filled>保存后生效</StatusTag>,
      confirmLabel: "确认修改总月数",
      edit: {
        kind: "select",
        current: text(rhythm.totalMonths,
          ""),
        options: rhythm.options.map(String),
        disallowCurrent: true,
        unit: "个月",
        hint: "只能从这几个选项里选"
      },
      blockedReason: scopeBlock(scope),
      getPendingReason: () => h1Pending.list().find((row) => row.scope === scope)?.reason,
      run: async (reason,
        value) => {
        if (value) await submit(scope,
          "运营总月数",
          text(rhythm.totalMonths),
          value,
          reason,
          [patch("totalMonths",
            value,
            reason,
            "运营总月数")]);
      }
    });
  };
  const openPosition = () => {
    if (!rhythm || !canWrite || !totalValid) return;
    const scope = "rhythm";
    setConfirm({
      scope,
      briefKind: "config",
      action: "调整当前进度",
      title: "校准当前进度",
      statedBrief: {
        impact: "只保存改了的项：先存月份，再存进度。",
        check: "核对月份和进度，理由写明依据或工单号。"
      },
      detail: "只保存改了的项：先存月份，再存进度。",
      effect: <StatusTag tone="progress" filled>逐项保存后生效</StatusTag>,
      confirmLabel: "确认校准",
      blockedReason: scopeBlock(scope),
      getPendingReason: () => h1Pending.list().find((row) => row.scope === scope)?.reason,
      businessForm: {
        kind: "multi-field",
        requireAnyChange: true,
        feedback: (value) => {
          const invalid = !/^\d+$/.test(value.phaseProgressPct ?? "") || Number(value.phaseProgressPct) > 100;
          return { field: "phaseProgressPct", invalid, message: invalid ? "本阶段进度须为 0–100 的整数。" : "" };
        },
        fields: [
          {
            key: "currentMonth",
            label: "改后当前月份",
            inputKind: "select",
            current: text(rhythm.currentMonth,
              ""),
            options: Array.from({ length: rhythm.totalMonths! },
              (_,
                index) => String(index + 1)),
            optionLabels: Object.fromEntries(Array.from({ length: rhythm.totalMonths! }, (_, index) => [String(index + 1), `第 ${index + 1} 月`])),
            help: "改后换用那个月的参数；会多付钱时先查兑付覆盖率。"
          },
          {
            key: "phaseProgressPct",
            label: "改后本阶段进度",
            inputKind: "number",
            current: text(rhythm.phaseProgressPct,
              ""),
            min: 0,
            max: 100,
            step: 1,
            help: "0–100 整数，不自动推进月份。"
          },
        ]
      },
      run: async (reason,
        _value,
        form) => {
        if (!form) return;
        const requests = [];
        if (form.currentMonth && Number(form.currentMonth) !== rhythm.currentMonth) requests.push(patch("currentMonth",
          form.currentMonth,
          reason,
          "当前月份"));
        if (form.phaseProgressPct !== "" && Number(form.phaseProgressPct) !== rhythm.phaseProgressPct) requests.push(patch("phaseProgressPct",
          form.phaseProgressPct,
          reason,
          "本阶段进度"));
        if (!requests.length) throw new Error("月份和进度都没改，没有提交");
        await submit(scope,
          "当前进度",
          `第 ${text(rhythm.currentMonth)} 月，进度 ${text(rhythm.phaseProgressPct)}%`,
          `第 ${form.currentMonth || text(rhythm.currentMonth)} 月，进度 ${form.phaseProgressPct || text(rhythm.phaseProgressPct)}%`,
          reason,
          requests);
      }
    });
  };
  const openDial = (row: H1Phases["monthlyDials"][number],
    dial: Dial) => {
    if (!canWrite) return;
    const before = text(row.dials[dial.key]);
    const scope = `dial:${row.month}:${dial.key}`;
    const label = `调整第 ${row.month} 月 · ${dial.label}`;
    const missingValue = before === "—";
    const approvalBlock = !canPropose ? "你没有发起审批的权限，放大调整要审批" : fundingBlocked ? "兑付覆盖率低于红线或读不准，暂时不能放大调整" : undefined;
    const approvalFor = (value: string) => amplifies(dial.key,
      before,
      value) && !h1Pending.list().some((item) => item.scope === scope) ? {
      heading: "放大 · 提交审批",
      disabledReason: approvalBlock,
      coverageCheckCopy: "批准时会再查一次兑付覆盖率。"
    } : undefined;
    setConfirm({
      scope,
      briefKind: "config",
      action: label,
      title: `修改${dial.label}`,
      statedBrief: {
        impact: "只改这个月的这一项。",
        check: "核对月份和前后值，理由写明依据或工单号。"
      },
      detail: dial.effect,
      confirmLabel: "确认修改",
      facts: (value) => <Facts>
        <Fact k="月份">第 {row.month} 月{row.month === rhythm?.currentMonth ? "（当前月）" : "（其他月份）"}</Fact>
        {value && !h1DialIssue(dial.key, value) && value !== before && Number(value) !== Number(before) && !amplifies(dial.key, before, value) && <Fact k="修改方向"><StatusTag tone="neutral" icon={LockKeyhole}>收紧 · 确认后直接保存</StatusTag></Fact>}
        <Fact k="生效方式">{value && amplifies(dial.key,
          before,
          value) ? <>
            {row.month !== rhythm?.currentMonth ? "批准后保存，到这个月时生效；批准前保持原值。" : "批准后立即生效，批准前保持原值。"}
          </> : row.month !== rhythm?.currentMonth
            ? "保存后，到这个月时生效。"
            : "保存后立即生效。"}</Fact>
        {value && amplifies(dial.key,
          before,
          value) && <><Fact k="谁能批准">{APPROVER}</Fact><Fact k="资金核查">兑付覆盖率 {format(coverage?.coverageRatio)}% · 红线 {format(coverage?.redlinePct, 0)}%<br />批准时会再查一次。</Fact></>}</Facts>,
      coverageCheck: "批准时会再查一次兑付覆盖率。",
      blockedReason: scopeBlock(scope) ?? (unavailable ? "阶段配置不可用，请先核对总体安排" : missingValue ? "当前值没读到，判断不了是调高还是调低，请先刷新" : undefined),
      getPendingReason: () => h1Pending.list().find((item) => item.scope === scope && item.state !== "approval")?.reason,
      inlineApproval: {
        fieldLayout: "compact",
        dialogClassName: "h1-confirm",
        resolve: (_form,
          value) => approvalFor(value),
        recover: async () => {
          const original = h1Pending.list().find((item) => item.scope === scope);
          if (!original) return false;
          const ticket = await lookupH1(original); syncPending(); if (ticket) { setConfirm(null); return true; } return false;
        },
        retry: async () => {
          const original = h1Pending.list().find((item) => item.scope === scope); if (original) await afterWrite(original,
            true);
        }
      },
      edit: {
        kind: dial.key === "complianceHoldEnabled" ? "select" : "number",
        current: before,
        optionLabels: dial.unit ? { [before]: <span title={`完整值 ${before}`}>{format(before, dial.key === "withdrawCooldownDays" ? 0 : undefined)} <small className="h1-unit">{dial.unit}</small></span> } : undefined,
        unit: dial.unit,
        options: ["否",
          "是"],
        min: dial.min,
        max: dial.max,
        step: dial.key === "withdrawCooldownDays" ? 1 : 0.000001,
        maxDecimals: dial.key === "withdrawCooldownDays" ? 0 : 6,
        disallowCurrent: true,
        amplifiesWhen: (value) => amplifies(dial.key,
          before,
          value),
        validate: (value) => h1DialIssue(dial.key,
          value),
        hint: dial.key === "complianceHoldEnabled" ? "选否或是" : `${dial.min}–${dial.max.toLocaleString()} ${dial.unit}${dial.key === "withdrawCooldownDays" ? "，整数" : "，最多六位小数"}`,
        preview: (value) => dial.key === "complianceHoldEnabled" ? value === "是" ? "本次收紧：USDT 三个网络的提现每笔人工审查，本金超过 1,000 USDT 的还要等到账审查窗口。" : "本次放大：不再强制每笔人工审查和等待，也不保证自动通过。" : `${amplifies(dial.key, before, value) ? "本次放大" : "本次收紧"}：${dial.effect.replace(/^(调高是放大，要审批；|调低是放大，要审批。)/, "")}`
      },
      run: async (reason,
        value) => {
        if (!value) return;
        const issue = h1DialIssue(dial.key,
          value); if (issue) throw new Error(issue);
        const amplified = amplifies(dial.key,
          before,
          value);
        if (amplified && approvalBlock) throw new Error(approvalBlock);
        const request = amplified ? proposal("h1_phase_dial",
          {
            month: row.month,
            dialKey: dial.key,
            value
          },
          label,
          `${row.month}:${dial.key}`,
          before,
          value,
          reason)
          : patch(dial.key,
            value,
            reason,
            label,
            `/phases/months/${row.month}/dials/${dial.key}`);
        await submit(scope,
          label,
          before,
          value,
          reason,
          [request]);
      }
    });
  };
  const openControl = (control: H1Phases["controls"][number]) => {
    if (!canControl) return;
    const scope = `control:${control.key}`;
    const label = `阶段切换设置 · ${CONTROL_NAMES[control.key] ?? control.label}`;
    setConfirm({
      scope,
      briefKind: "config",
      action: label,
      title: `调整${CONTROL_NAMES[control.key] ?? control.label}`,
      statedBrief: {
        impact: CONTROL_EFFECT,
        check: "核对原值和新值，理由写明依据。"
      },
      detail: CONTROL_EFFECT,
      facts: !control.value ? <Facts><Fact k="当前配置">未配置</Fact></Facts> : undefined,
      completionCopy: "需另一位有审批权限和阶段切换修改权限的管理员批准，不能自己批。",
      approval: { disabledReason: !canPropose ? "没有发起审批的权限" : undefined },
      effect: <StatusTag tone="progress" filled>提交审批</StatusTag>,
      blockedReason: scopeBlock(scope),
      getPendingReason: () => h1Pending.list().find((row) => row.scope === scope && row.state !== "approval")?.reason,
      edit: {
        kind: control.key === "pin" ? "select" : "text",
        current: control.value,
        options: ["未钉住",
          "P1",
          "P2",
          "P3",
          "P4",
          "P5",
          "P6"],
        optionLabels: { "未钉住": "未锁定当前阶段" },
        disallowCurrent: true,
        hint: control.key === "pin" ? "不锁定也不会自动推进阶段" : "按填写的原文保存，系统不检查写得对不对"
      },
      run: async (reason,
        value) => {
        if (value) await submit(scope,
          label,
          text(control.value,
            "未配置"),
          value,
          reason,
          [proposal("h1_phase_control",
            {
              controlKey: control.key,
              value
            },
            label,
            control.key,
            text(control.value,
              "未配置"),
            value,
            reason)]);
      }
    });
  };
  const openRevoke = (row: H1Phases["overrides"][number]) => {
    if (!canRevoke || row.disabled) return;
    const scope = `override:${row.id}`;
    const label = `撤销该批用户的单独设置 · ${row.cohort}`;
    setConfirm({
      scope,
      briefKind: "config",
      action: label,
      title: "撤销单独覆盖",
      statedBrief: {
        impact: "提交撤销审批；批准前这批用户的单独设置不变。",
        check: "核对用户批次，理由写明依据或工单号。"
      },
      detail: "撤销是为了让这批用户改回按全局规则；批准前不变。",
      facts: <Facts>
        <Fact k="用户批次">{row.cohort}</Fact>
        <Fact k="当前状态">未撤销</Fact>
        <Fact k="影响">{row.description || "撤销是为了让这批用户改回按全局规则。"}</Fact>
        <Fact k="谁能批准">另一位有审批权限和阶段切换修改权限的管理员，不能自己批。</Fact>
      </Facts>,
      approval: { disabledReason: !canPropose ? "没有发起审批的权限" : undefined },
      blockedReason: scopeBlock(scope),
      getPendingReason: () => h1Pending.list().find((item) => item.scope === scope && item.state !== "approval")?.reason,
      run: async (reason) => submit(scope,
        label,
        "未撤销",
        "申请撤销",
        reason,
        [proposal("h1_phase_override",
          {
            overrideId: row.id,
            disabled: true
          },
          label,
          row.id,
          "生效中",
          "已撤销",
          reason)])
    });
  };
  const readOriginal = async (row: H1Pending) => {
    setBusy(true);
    try {
      const ticket = await lookupH1(row); syncPending();
      if (await reload()) {
        setChecked(row.commandKey); setFeedback(ticket ? `原审批单 ${ticket.id}：${({
          pending: "待审批",
          approved: "已批准",
          rejected: "已驳回",
          withdrawn: "已撤回",
          expired: "已过期"
        })[ticket.status]}` : "已刷新。查到的是现在的值，值相同也不能说明原提交成功，原记录继续保留。");
      }
    } catch (failure) {
      ctx.toast(displayAdminError(failure),
        "warn");
    }
    finally { setBusy(false); }
  };
  const confirmPending = confirm ? pending.find((row) => row.scope === confirm.scope && row.state !== "approval" && row.commandKey !== sending) : undefined;

  return <>
    <PageHeader pageId="H1" title="运营阶段设置" summary={`安排运营月份和每月生效的参数。${!canWrite && !canControl && !canRevoke ? "你只能查看。" : ""}`} meta={readAt ? `${formatBusinessTimeFull(readAt)} 读取` : undefined}
      actions={<>{reach("/overview/rhythm", "overview_b4_read") ? <Link className="rd-link" href="/overview/rhythm" prefetch={false}>去运营阶段状态 →</Link> : <span className="h1-access-note">运营阶段状态 · 无访问权限</span>}<Button icon={<RefreshCw size={14} />} loading={loading} onClick={async () => {
        if (await reload()) ctx.toast("已刷新",
          "success");
      }}>刷新数据</Button>
      </>} />
    {deepLink && <Notice tone="progress">
      <b>从「运营阶段状态」跳转而来</b> {deepLink.phase} {deepLink.dial === "phaseAttribution" ? "阶段归因" : DIALS.find((dial) => dial.key === deepLink.dial)?.label ?? deepLink.dial}{deepLink.dial && deepLink.dial !== "phaseAttribution" && !DIALS.some((dial) => dial.key === deepLink.dial) && " · 未找到对应参数"}</Notice>}
    {pending.filter((row) => row.commandKey !== sending).map((row) => <Notice key={row.commandKey} tone={row.state === "approval" ? "progress" : "warn"} actionBelow action={<>
      <Button size="sm" onClick={() => setDetail(row)}>原操作详情</Button>
      <Button size="sm" loading={busy} onClick={() => void readOriginal(row)}>查询原结果</Button>
      {row.state !== "approval" && <Button size="sm" disabledReason={!permitted(row) ? "你没有原操作的权限" : isRetryExpired(row) ? RETRY_EXPIRED_TEXT : undefined} loading={busy} onClick={async () => {
        setBusy(true); try {
          await afterWrite(row,
            true);
        } catch (failure) {
          ctx.toast(displayAdminError(failure),
            "warn");
        } finally { setBusy(false); }
      }}>按原请求重试</Button>}
      {row.retryRejected && row.state === "rejected" && checked === row.commandKey && <Button size="sm" onClick={() => setRelease(row)}>解除原操作记录</Button>}
    </>}>
      <b>{row.state === "approval" ? "已提交审批，等待批准" : row.state === "rejected" ? row.retryRejected ? "按原请求重试被拒绝" : "提交被拒绝" : "提交结果未知"}</b> · {row.label}{row.ticket && ` · 审批单 ${row.ticket.id}`}
      {row.state === "rejected" && <p>拒绝原因：{row.rejectionReason ?? "没有记下拒绝原因，请查询原结果核对。"}</p>}
      {row.requests.some((item) => item.acknowledged && item.kind === "patch") && <p>{row.requests.filter((item) => item.acknowledged).map((item) => `${item.label}已保存`).join("，")}；{row.requests.filter((item) => !item.acknowledged).map((item) => `${item.label}${row.state === "rejected" ? row.retryRejected ? "重试被拒绝" : "未保存" : "结果未知"}`).join("，")}。重试只会重发没确认的那一步。</p>}
      {row.state !== "approval" && isRetryExpired(row) && <p>{RETRY_EXPIRED_TEXT}；原记录继续保留，这项暂时不能再改。</p>}
      {feedback && checked === row.commandKey && <p>{feedback}</p>}
    </Notice>)}
    {feedback && !pending.some((row) => row.commandKey === checked && row.commandKey !== sending) && <Notice tone="warn">{feedback}</Notice>}
    {!canRead ? <BlockState state="denied" title="没有运营阶段读取权限" /> : loading && !model ? <BlockState state="loading" title="正在加载运营阶段…" /> : error && !model ? <BlockState state="error" title="运营阶段数据加载失败" detail={error} onRetry={() => void reload()} /> : model && rhythm && <>
      {error && <Notice tone="danger" action={<Button size="sm" onClick={() => void reload()}>重试</Button>}>运营阶段数据加载失败：{error} 下面是上次读到的值，刷新成功前不能修改。</Notice>}
      <Conclusion state={unavailable ? "warn" : "neutral"} icon={Flag} hint={unavailable ? `${unavailable}。请联系值班人员处理后刷新；这页不会自动补默认值。` : undefined}>{unavailable ? "阶段配置不可用" : `当前 ${phaseLabel}`} · {describeH1Schedule(rhythm.schedule)}</Conclusion>
      {fundingBlocked && <Notice tone="warn" action={reach("/finance/pool") ? <Link className="rd-link" href="/finance/pool" prefetch={false}>核对资金储备与应付款 →</Link> : undefined}>暂时不能放大调整：{!coverage?.reliable ? "兑付覆盖率读数不可靠。" : "兑付覆盖率低于红线或没读到。"}</Notice>}
      <div className="h1-navigation">
        <SectionNav row label="本页分组" items={SECTIONS} nav={nav} />
      </div>
      <div id={nav.anchor("arrangement")} className="h1-section">
        <Panel title={<span tabIndex={-1} data-section-focus="">总体安排</span>} icon={CalendarRange} tone="role-3" explain="阶段线只表示先后，不代表时长。当前阶段以系统记录为准，不按月份推算。">
          <StageLine label="运营阶段" stages={stages} currentId={phaseKnown ? rhythm.currentPhase : null} emptyText="没读到阶段列表，当前阶段待核实" />
          <div className="h1-arrangement">
            <div className="h1-month">
              <span className="h1-value-label">当前月份</span>
              <strong data-empty={monthValid ? undefined : ""}>{monthValid ? `第 ${rhythm.currentMonth} 月` : "—"} <small>/ 共 {totalValid ? rhythm.totalMonths : "—"} 月</small>
              </strong>
              {canWrite && <span className="h1-arrangement-actions">
                <Button size="sm" disabledReason={scopeBlock("rhythm")} onClick={openTotal}>修改总月数</Button>
                <Button size="sm" disabledReason={scopeBlock("rhythm") ?? (!totalValid ? "请先补齐合法运营总月数" : undefined)} onClick={openPosition}>校准</Button>
              </span>}</div>
            <div className="h1-progress">
              <span className="h1-value-label">本阶段进度 <Explain label="本阶段进度是什么" content="人工设置的 0–100% 进度，不是月份完成率，不会自动推进阶段。" />
              </span>
              <strong data-empty={progressValid && rhythm.phaseProgressPct !== 0 ? undefined : ""}>{progressValid ? rhythm.phaseProgressPct : "—"}<small>{progressValid ? "%" : " · 不可用"}</small>
              </strong>
              <ScaleBar label="本阶段进度" valueText={progressValid ? `本阶段进度 ${rhythm.phaseProgressPct}%` : "进度不可用"} max={100} value={rhythm.phaseProgressPct} state={progressValid ? "ready" : "empty"} emptyText="没有可用的进度" fill tone="role-3" ticks={[{
                value: 0,
                text: "0%"
              },
              {
                value: 100,
                text: "100%"
              }]} quiet />
            </div>
          </div>
          <div className="h1-catalog-note">和商品开放用的阶段还没统一 <Explain label="两边的阶段" content="两边的阶段还在统一中。这页只按运营阶段的数据显示，不推测商品开放到了哪个阶段。" />
          </div>
        </Panel>
      </div>
      <StatBand label="本月摘要">
        <Stat icon={ShieldCheck} label="兑付覆盖率" value={ratio == null ? "—" : format(coverage?.coverageRatio)} unit={ratio == null ? undefined : "%"} sub={`红线 ${redline == null ? "—" : text(coverage?.redlinePct)}${redline == null ? "" : "%"}`} tone={fundingBlocked ? "warn" : undefined} explain="没读到、不大于 0 或读数不可靠时，不能据此判断资金正常。" />
        <Stat icon={Users} label="当月邀请加成" value={format(currentRow?.dials.inviteRewardMultiplier)} unit={currentRow?.dials.inviteRewardMultiplier == null ? undefined : "倍"} tone="role-4" />
        <Stat icon={ListChecks} label="当月任务加成" value={format(currentRow?.dials.questBonusMultiplier)} unit={currentRow?.dials.questBonusMultiplier == null ? undefined : "倍"} tone="role-4" />
        <Stat icon={Clock3} label="当月到账审查窗口" value={format(currentRow?.dials.withdrawCooldownDays,
          0)} unit={currentRow?.dials.withdrawCooldownDays == null ? undefined : "天"} tone="role-3" explain={DIALS[3].effect} />
      </StatBand>
      <div id={nav.anchor("monthly")} className="h1-section">
        <Panel title={<span tabIndex={-1} data-section-focus="">每月参数</span>} sub={`${rows.length} 个月 × 7 项`} icon={SlidersHorizontal} tone="role-4" flush explain="收紧直接保存，放大要另一位超级管理员批准。其他月份的值到那个月才生效；圆点表示和上个月不同。">
          <Table label="每月七项参数" className="h1-matrix">
            <colgroup>
              <col className="h1-col-month" />{DIALS.map((dial) => <col key={dial.key} className={`h1-col-${dial.key}`} />)}</colgroup>
            <thead>
              <Tr>
                <Th>月份</Th>{DIALS.map((dial) => <Th key={dial.key} align="right">
                  <span>{dial.label}<small>{dial.unit}</small>
                  </span>
                </Th>)}</Tr>
            </thead>
            <tbody>
              {rows.map((row,
                index) => <Tr key={row.month} mark={row.month === rhythm.currentMonth ? "hit" : undefined} aria-current={row.month === rhythm.currentMonth ? "true" : undefined}>
                  <Td>
                    <span className="h1-month-cell">
                      <b>第 {row.month} 月</b>
                      <small>{row.phase}{row.month === rhythm.currentMonth && <b className="h1-current-label">当前</b>}</small>
                    </span>
                  </Td>{DIALS.map((dial) => {
                    const raw = text(row.dials[dial.key]); const changed = index > 0 && row.dials[dial.key] != null && rows[index - 1].dials[dial.key] != null && raw !== text(rows[index - 1].dials[dial.key]) && (dial.key === "complianceHoldEnabled" || Number(raw) !== Number(rows[index - 1].dials[dial.key]));
                    return <Td key={dial.key} align="right">
                      <span className="h1-dial-cell">{changed && <span className="h1-dial-change" title="和上个月不同" aria-label="和上个月不同">•</span>}{canWrite ? <Button size="sm" variant="ghost" className="h1-value-button" title={`完整值 ${raw}`} aria-label={`第 ${row.month} 月 ${dial.label}，当前 ${raw}${dial.unit ? ` ${dial.unit}` : ""}，修改`} disabledReason={scopeBlock(`dial:${row.month}:${dial.key}`)} onClick={() => openDial(row,
                        dial)}>{dial.key === "complianceHoldEnabled" ? raw : format(row.dials[dial.key],
                          precision[dial.key])}</Button> : <span title={`完整值 ${raw}`}>{dial.key === "complianceHoldEnabled" ? raw : format(row.dials[dial.key],
                            precision[dial.key])}</span>}</span>
                    </Td>;
                  })}</Tr>)}{!rows.length && <TableMessage columns={8}>没有读到每月参数，请先核对总体安排。</TableMessage>}
            </tbody>
          </Table>
        </Panel>
      </div>
      <div id={nav.anchor("controls")} className="h1-section">
        <Fold title="阶段切换设置" icon={GitBranch} tone="role-other" summary={`${describeH1Schedule(rhythm.schedule)} · ${model.controls.find((row) => row.key === "pin")?.value === "未钉住" ? "未锁定当前阶段" : model.controls.find((row) => row.key === "pin")?.value ? "已保存锁定设置" : "锁定当前阶段未设置"}`} open={!!folds.controls} onOpenChange={(open) => setFolds((value) => ({
          ...value,
          controls: open
        }))}>
          <div className="h1-controls-note"><Notice tone="progress">这三项只保存设置，系统目前不会执行。</Notice></div>
          <ConfigList label="阶段控制配置">{model.controls.map((control) => <ConfigRow key={control.key} name={CONTROL_NAMES[control.key] ?? control.label} what={control.key === "schedule" ? "存下的阶段排程" : control.key === "pin" ? "存下的锁定设置" : "存下的用户群阶段策略"} when="批准后保存，目前不执行" note={control.key === "pin" ? "不锁定也不会自动推进阶段" : "按原文显示，不代表已经生效"} value={control.key === "pin" && control.value === "未钉住" ? "未锁定当前阶段" : control.value ? control.value : <span className="h1-unset">未配置</span>} action={canControl ? <Button size="sm" aria-label={`调整${CONTROL_NAMES[control.key] ?? control.label}`} disabledReason={scopeBlock(`control:${control.key}`)} onClick={() => openControl(control)}>调整</Button> : undefined} />)}</ConfigList>
        </Fold>
      </div>
      <div id={nav.anchor("overrides")} className="h1-section">
        <Fold title="单独覆盖人群" icon={Users} tone="role-3" summary={model.overrides.length ? `${model.overrides.length} 条覆盖记录` : "名单暂时看不了"} open={!!folds.overrides} onOpenChange={(open) => setFolds((value) => ({
          ...value,
          overrides: open
        }))}>
          {!model.overrides.length ? <BlockState state="empty" title="系统暂未提供覆盖人群数据" detail="不代表没有人被单独覆盖；现在没有可撤销的记录。" /> : <ConfigList label="单独覆盖记录">{model.overrides.map((row) => <ConfigRow key={row.id} name={row.cohort} note={row.description} value={<StatusTag tone={row.disabled ? "done" : "neutral"}>{row.disabled ? "已撤销" : "未撤销"}</StatusTag>} action={canRevoke ? <Button size="sm" disabledReason={row.disabled ? "这条覆盖已撤销" : scopeBlock(`override:${row.id}`)} onClick={() => openRevoke(row)}>撤销</Button> : undefined} />)}</ConfigList>}
        </Fold>
      </div>
      <div id={nav.anchor("attribution")} className="h1-section">
        <Fold title="阶段归因" icon={ChartNoAxesCombined} tone="role-other" summary={`${model.attribution.length} 个阶段的参考资料`} open={!!folds.attribution} onOpenChange={(open) => setFolds((value) => ({
          ...value,
          attribution: open
        }))} explain="固定的参考资料，不是本月实际参数，也不是效果统计；实际数据看运营阶段状态和设备、任务与团队报表。">
          {!model.attribution.length ? <BlockState state="empty" title="没有阶段参考资料" /> : <div className="h1-attribution">{model.attribution.map((row) => <section key={row.phase} id={`h1-attribution-${row.phase}`} tabIndex={-1} className="h1-attribution-item" data-hit={deepLink?.phase === row.phase ? "" : undefined}>
            <h3>{row.phase} {row.name}{deepLink?.phase === row.phase && <StatusTag tone="progress" icon={MapPin}>跳转定位</StatusTag>}</h3>{["P5",
              "P6"].includes(row.phase) && <Notice tone="warn">这份资料含已停用的参数，不能当作现在的依据。</Notice>}
            <Facts>
              <Fact k="主要驱动">{row.driver.replaceAll("提现冷却",
                "到账审查窗口").replaceAll("增强合规审查",
                  "加强合规审查")}</Fact>
              <Fact k="阶段参数">{DIALS.find((dial) => dial.key === row.paramKey)?.label ?? row.paramKey}</Fact>
              <Fact k="参考值">{format(row.value, row.paramKey === "withdrawCooldownDays" ? 0 : undefined)}{DIALS.find((dial) => dial.key === row.paramKey)?.unit ? ` ${DIALS.find((dial) => dial.key === row.paramKey)?.unit}` : ""}</Fact>
              <Fact k="负责模块">{row.owner}</Fact>
            </Facts>
            <Fold inset title="原始资料" summary="系统里的原文">
              <Facts>
                <Fact k="原始阶段名称">{row.name}</Fact>
                <Fact k="原始驱动">{row.driver}</Fact>
                <Fact k="参数标识">{row.paramKey}</Fact>
              </Facts>
            </Fold>
          </section>)}</div>}
        </Fold>
      </div>
    </>}
    {confirm && <OperationConfirmModal {...confirm} facts={(value) => <div className="h1-confirm-facts" data-pending={confirmPending?.state}>
      {confirmPending && <div className="h1-pending-feedback"><Notice tone="warn" title={confirmPending.state === "rejected" ? confirmPending.retryRejected ? "按原请求重试被拒绝" : "提交被拒绝" : "提交结果未知"}>
        {confirmPending.requests.some((request) => request.acknowledged && request.kind === "patch") && <p>{confirmPending.requests.filter((request) => request.acknowledged && request.kind === "patch").map((request) => `${request.label}已保存`).join("，")}；{confirmPending.requests.filter((request) => !request.acknowledged).map((request) => `${request.label}${confirmPending.state === "rejected" ? confirmPending.retryRejected ? "重试被拒绝" : "未保存" : "结果未知"}`).join("，")}。</p>}
        <p>{confirmPending.state === "rejected" ? `拒绝原因：${confirmPending.rejectionReason ?? "没有记下拒绝原因，请查询原结果核对。"}` : confirmPending.requests.some((request) => request.kind === "proposal") ? "可能已经建了审批单，批准前参数不变。请先查询原结果。" : "原内容和理由已保留，可以按原请求重试，不会重复执行。"}</p>
      </Notice></div>}
      {confirm.businessForm && rhythm ? <Facts>
        <Fact k="现在">第 {text(rhythm.currentMonth)} 月，本阶段进度 {text(rhythm.phaseProgressPct)}%</Fact>
        <Fact k="当前阶段">{phaseLabel}</Fact>
        <Fact k="保存顺序">先存月份并换用那个月的参数，再存进度；进度没存上时月份不会退回。</Fact>
      </Facts> : typeof confirm.facts === "function" ? confirm.facts(value) : confirm.facts}
    </div>} onClose={() => setConfirm(null)} onConfirm={async (reason,
      value,
      form) => {
      await confirm.run(reason,
        value,
        form);
    }} />}
    <Drawer open={!!detail} onClose={() => setDetail(null)} title="原操作详情" footer={<Decision primary={<Button onClick={() => setDetail(null)}>关闭</Button>} />}>
      {detail && <>
        <Facts>
          <Fact k="操作">{detail.label}</Fact>
          <Fact k="前后值">
            <Change from={pendingValue(detail, detail.before)} to={pendingValue(detail, detail.after)} />
          </Fact>
          <Fact k="原操作理由">{detail.reason}</Fact>
          <Fact k="发起人">{detail.operator}</Fact>
          <Fact k="提交时间">{formatBusinessTimeFull(new Date(detail.createdAt).toISOString())}</Fact>
        </Facts>
        <Fold inset title="技术信息" summary={`${detail.requests.length} 个原请求`}>
          <div className="h1-request-list">{detail.requests.map((request) => <Facts key={request.commandKey}>
            <Fact k="命令号">
              <span data-mono>{request.commandKey}</span>
            </Fact>
            <Fact k="请求">{request.method} /api/admin{request.kind === "patch" ? "/growth" : ""}{request.path}</Fact>
            <Fact k="原始请求内容">
              <pre>{request.body}</pre>
            </Fact>
            <Fact k="结果">{request.acknowledged ? "已确认成功" : "未确认"}</Fact>
          </Facts>)}</div>
        </Fold>
      </>}
    </Drawer>
    {release && <ReleaseModal onCancel={() => setRelease(null)} label={<div className="h1-release-facts"><b>{release.label}</b><Change from={pendingValue(release, release.before)} to={pendingValue(release, release.after)} /><span className="h1-release-reason">拒绝原因：{release.rejectionReason ?? "没有记下拒绝原因，请先查询原结果。"}</span></div>} explain="只清掉本页这条记录，不撤销后台的操作，也不记操作记录；已保存的步骤不会退回。" onConfirm={() => {
      if (release?.retryRejected && release.state === "rejected" && checked === release.commandKey) {
        h1Pending.forget(release.fingerprint,
          release.commandKey); syncPending(); setRelease(null); setConfirm(null); setFeedback(undefined); setChecked(undefined);
      }
    }} />}
  </>;
}
