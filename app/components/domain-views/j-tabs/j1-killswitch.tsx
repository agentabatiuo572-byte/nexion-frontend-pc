"use client";

/**
 * J1 紧急停用开关（应急控制页，PG-48）。五项业务：提现、质押、创世节点、兑换、试用。
 * 第一层：结论、待补录、统计、业务卡、批量关停。总表、参数、规则收起；有业务已关停时备付金检查展开。
 * 业务卡是控制区：关停和恢复入口不收进折叠组。关停不查覆盖率，恢复前查覆盖率（等于红线算通过），补录不恢复业务（OP-56）。
 * 恢复现在是确认后立即生效，文字按真实路径写（OP-25）。后端交付审批（BE-08）后，把 resumeGate 的命令和文字一起换成「批准后生效」。
 * 写操作先存原操作再发；结果未知时关框、转成上方待确认条，只能原样重试（OP-92～OP-94）。
 * 改参数被别人抢先时框不关：「读取最新」在框里换成最新值，拟改的新值留着，理由清空重填（OP-97）。
 */
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, Coins, Gem, Landmark, Layers, ListChecks, Power, RefreshCw, ScrollText, ShieldAlert, ShieldCheck, SlidersHorizontal, Siren, Ticket, type LucideIcon } from "lucide-react";
import { BatchBar, BlockState, Button, Cell, Change, Checkbox, Conclusion, ConfigList, ConfigRow, ControlCard, ControlGrid, Explain, Fact, Facts, Figure, Fold, Notice, PageHeader, Panel, ReleaseModal, Stat, StatBand, StatusTag, Table, Td, Th, ThresholdMeter, Tr } from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { createJEmergencyCommandKey, isEmergencyOutcomeUncertain } from "@/lib/admin/j-client";
import type { AutoConfirmationRow, AutoRuleRow, EmergencySlaRow, JGate, KillSwitchOverview } from "@/lib/admin/j-client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { createPendingMutationStore, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { ActionConfirmReq, JCtx } from "./types";

const IMPACT_LABEL: Record<string, string> = { immediate: "即时资金流出", delayed: "未来负债增加", none: "不直接影响兑付" };
const GATE_ICON: Record<string, LucideIcon> = { withdraw: Landmark, staking: Layers, genesis: Gem, exchange: ArrowLeftRight, trial: Ticket };
const TRIGGER_BASES = ["", "监管点名", "挤兑风险", "安全事件", "其他"];
const TRIGGER_LABELS = { "": "请选择触发依据" };
const AUTO_CONFIRM_DECISIONS = ["", "keep_disabled", "recommend_restore"];
const AUTO_CONFIRM_DECISION_LABELS = {
  "": "请选择复核结论",
  keep_disabled: "维持关停",
  recommend_restore: "建议超级管理员评估恢复",
};
const RULE_MODE_LABEL: Record<AutoRuleRow["mode"], string> = { automatic: "达到阈值自动关停", advisory: "只告警，人工判断后再关停", manual: "人工发起" };
/** 阈值在别的页设置，这里只引用（J1-S03）。 */
const RULE_SOURCE: Record<string, string> = { withdrawSurge: "/overview/risk-radar", tamperCluster: "/emergency/tamper" };
const EXPIRED = "已超过 24 小时，不能再重试，请到操作记录与审批核对";
const READING = "正在读取最新状态，读完再操作";
const LOCKED = "这项有结果未确认的操作，先处理页面上方的待确认";
const BLOCKED_RESUME = "兑付覆盖率低于红线，暂不能恢复。到「资金储备与应付款」补足储备，回到红线以上再恢复。";
const REASON_HINT = "例如：监管通知编号、工单号、事件编号";
const STALE = "这个值刚被别人改过，本次没有保存。";
const RETRY_DENIED = "这个账号现在没有这项操作的权限，不能重试。请联系超级管理员，或到操作记录与审批核对";
/** 这页有两条红线：R1 的挤兑红线比提现占储备，恢复门槛比覆盖率。通用词条只讲后一种，这里单独写。 */
const BANK_RUN_TIP = "挤兑红线：24 小时提现申请额占真实储备的比例。达到后系统自动暂停提现，和恢复业务的备付金红线不是一回事。";
/** 生效方式全站一个样子，蓝底（VS-106）。关停危险与否看红图标和红按钮，不看这个标签。 */
const IMMEDIATE = <StatusTag tone="progress" filled>立即生效</StatusTag>;

type J1Command =
  | { kind: "toggle"; gate: string; enabled: boolean; context?: { triggerBasis?: string; dispositionPlan?: string } }
  | { kind: "batch"; keys: string[]; context: { triggerBasis: string; regulatoryContext: string; dispositionPlan?: string } }
  | { kind: "sla"; id: string; value: string; expected: string }
  | { kind: "rule"; id: string; value: string; expected: string }
  | { kind: "backfill"; gate: string; incidentId: string; decision: "keep_disabled" | "recommend_restore" };

type J1Pending = PendingMutationRecord & {
  /** 待确认条上写的「做了什么」。 */
  label: string;
  /** 这次操作锁住的对象：业务 key、sla:{id}、rule:{id}。结果确认前不能再操作（OP-93）。 */
  locks: string[];
  reason: string;
  okText: string;
  command: J1Command;
};
type J1Extra = PendingMutationExtra<J1Pending>;

/**
 * 刷新后还能用同一命令号重试，原操作内容一起存，重试只能原样（OP-92、OP-94）。
 * 过期的记录留着：过了 24 小时不能再用原号重试，但没人核实过结果，不能算结束（OP-96）。
 */
const pendingKeys = createPendingMutationStore<J1Pending>({ storageKey: "nexion-admin-j1-kill-switch-commands-v1", retainExpiredRecords: true });

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

/** 差值不能把非零写成 0。 */
function pointsText(value: number) {
  return value < 0.05 ? "不到 0.1" : value.toFixed(1);
}

function unitText(value: string, unit: string) {
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

function ruleValue(rule: AutoRuleRow) {
  return rule.kind === "number" ? unitText(Number(rule.thr).toLocaleString(), rule.unit) : rule.thr;
}

/** 事件存下来的原值，只加千分位和单位，不舍入（TX-19、TX-20）。 */
function signalText(value: number, unit: string) {
  const [whole, fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return unitText(fraction ? `${grouped}.${fraction}` : grouped, unit);
}

function timeText(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function RuleCondition({ text }: { text: string }) {
  const [before, after] = text.split("挤兑红线");
  if (after === undefined) return <AutoGloss>{text}</AutoGloss>;
  return <><AutoGloss>{before}</AutoGloss><span className="gloss" data-tip={BANK_RUN_TIP} role="note" aria-label={BANK_RUN_TIP}>挤兑红线</span><AutoGloss>{after}</AutoGloss></>;
}

export function J1KillSwitch({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading, contentError } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = new Set(session?.authorities ?? []);
  const canKill = authorities.has("emergency_j1_gate_kill");
  const canResume = authorities.has("emergency_j1_gate_resume");
  const canBatchKill = authorities.has("emergency_j1_batch_kill");
  const canWrite = authorities.has("emergency_j1_write");
  const reach = useReach();
  const data = emergency.killSwitch;

  // 运营勾选要批量关停的业务。
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [readAt, setReadAt] = useState("");
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState("");
  const [pending, setPending] = useState<J1Pending[]>([]);
  /** 待确认条上最近一次读回或重试的结果，只是当下的事实，不影响待确认本身。 */
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  /** 最近一次重试被后端明确拒绝的命令号，只有它们才能人工解除。 */
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<J1Pending | null>(null);

  const syncPending = () => setPending(pendingKeys.list());
  useEffect(() => { syncPending(); }, []);
  useEffect(() => { if (data) setReadAt(businessClock(Date.now())); }, [data]);

  const reload = () => void actions.reloadJEmergency().catch(() => undefined);
  const notePending = (record: J1Pending, note: string) => setPendingNotes((current) => ({ ...current, [record.fingerprint]: `${businessClock(Date.now())} ${note}` }));

  const dispatch = (command: J1Command, reason: string, key: string) => {
    switch (command.kind) {
      case "toggle": return actions.toggleJ1KillSwitch(command.gate, command.enabled, reason, command.context, key);
      case "batch": return actions.emergencyDisableJ1(command.keys, reason, undefined, command.context, key);
      case "sla": return actions.updateJ1Sla(command.id, command.value, command.expected, reason, key);
      case "rule": return actions.updateJ1AutoRule(command.id, command.value, command.expected, reason, key);
      case "backfill": return actions.confirmJ1AutoTrigger(command.gate, command.incidentId, command.decision, reason, key);
    }
  };

  /**
   * 写操作共用一条路（D2 同款）：先把原操作存好再发。确定失败丢号、留在确认框；结果未知保号、关框，转成待确认条。
   * 重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留，只有成功才解除。
   */
  const sendCommand = async (scope: string, extra: J1Extra, after?: () => void) => {
    const retained = pendingKeys.get(scope);
    const key = retained ?? createJEmergencyCommandKey();
    pendingKeys.remember(scope, key, extra);
    if (!pendingKeys.isDurablyStored(scope, key)) {
      if (!retained) pendingKeys.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    setSubmitting(scope);
    try {
      try {
        await dispatch(extra.command, extra.reason, key);
      } catch (cause) {
        const unknown = isEmergencyOutcomeUncertain(cause);
        if (!unknown && !retained) pendingKeys.forget(scope);
        syncPending();
        await actions.reloadJEmergency().catch(() => undefined);
        if (unknown) {
          toast("结果未确认，不要重复操作。到页面上方读回核对或按原操作重试。");
          return;
        }
        // 确认框留着时原因写在框里，重试的原因写在待确认条上，都不再弹同一句；权限层的 403 由确认框提示并关框（OP-132）。
        throw cause;
      }
      pendingKeys.forget(scope);
      syncPending();
      after?.();
      try {
        await actions.reloadJEmergency();
        toast(extra.okText);
      } catch {
        toast(`${extra.okText}，但最新状态暂时无法读取，请刷新确认`);
      }
    } finally {
      setSubmitting("");
    }
  };

  /** 重试也要有原操作的权限：记录是之前留下的，账号的权限可能已经变了（OP-124）。 */
  const canRetry = ({ command }: J1Pending) => {
    if (command.kind === "toggle") return command.enabled ? canResume : canKill;
    if (command.kind === "batch") return canBatchKill;
    return command.kind === "backfill" ? canKill : canWrite;
  };

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。 */
  const retryPending = async (record: J1Pending) => {
    if (record.expiresAt <= Date.now()) {
      syncPending();
      return;
    }
    if (!pendingKeys.isDurablyStored(record.fingerprint, record.commandKey)) {
      notePending(record, "浏览器里读不到这条记录，这次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    const { fingerprint, commandKey, createdAt, expiresAt, ...extra } = record;
    try {
      await sendCommand(fingerprint, extra);
    } catch (cause) {
      notePending(record, `重试没有成功：${cause instanceof Error ? displayAdminError(cause) : "原因未知"} 这说明不了原操作的结果，原命令继续保留。`);
      setRetryRejected((current) => [...current, commandKey]);
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求。 */
  const releasePending = (record: J1Pending) => {
    pendingKeys.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast("已解除待确认，这项可以重新操作");
  };

  /** 读回只给现在的事实。状态变了可能是别人改的，不能当成原命令的回执（OP-95 丙档）。 */
  const verifyPending = async (record: J1Pending) => {
    try {
      await actions.reloadJEmergency();
      notePending(record, "已读回最新状态，看下面的业务卡核对。状态可能是别人改的，待确认继续保留。");
    } catch {
      notePending(record, "读回失败，暂时读不到。待确认继续保留。");
    }
  };

  const pendingNotices = pending.map((record) => {
    const expired = record.expiresAt <= Date.now();
    return (
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`}
        action={<>
          <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>读回核对</Button>
          <Button size="sm" disabled={!expired && !!submitting} disabledReason={expired ? EXPIRED : canRetry(record) ? undefined : RETRY_DENIED} onClick={() => void retryPending(record)}>按原操作重试</Button>
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>解除待确认</Button>}
        </>}>
        {expired ? formatBusinessTimeCompact(new Date(record.createdAt).toISOString()) : businessClock(record.createdAt)}（{businessZone().label}）发出，{expired ? `${EXPIRED}。` : "可能已经生效。重发原内容，已成功的不会重复执行。"}
        {reach("/platform/audit", "platform_a2_read") && <> <Link className="rd-link" href="/platform/audit?domain=J">到操作记录核查</Link></>}
        <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 理由 ${record.reason}`} />
        {pendingNotes[record.fingerprint] && <div>{pendingNotes[record.fingerprint]}</div>}
      </Notice>
    );
  });

  const releaseModal = releasing && (
    <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain="重试被拒说明不了原操作的结果，到操作记录确认过再解除。解除后原操作不再重试，系统仍按现在的状态校验。" />
  );

  const header = (
    <PageHeader pageId="J1" title="紧急停用开关"
      summary={<AutoGloss>一键停用或恢复业务。恢复资金业务前先看兑付覆盖率。</AutoGloss>}
      actions={<Button loading={contentLoading} onClick={reload}><RefreshCw size={15} aria-hidden />刷新</Button>}
      meta={readAt ? <>{readAt}（{businessZone().label}）读取 <Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动更新。自动关停发生时顶栏告警先提醒，这页要刷新才看到。" /></> : undefined}
      readOnly={!canKill && !canResume && !canBatchKill && !canWrite ? <>你只能查看 <Explain label="只读说明" content="关停、恢复和改参数需要紧急停用开关的操作权限，请联系超级管理员。" /></> : undefined}
      guideExtra={<p>这个账号：{canKill ? "能关停和补录" : "不能关停和补录"}，{canBatchKill ? "能批量关停" : "不能批量关停"}，{canResume ? "能恢复" : "不能恢复，要恢复请联系超级管理员"}，{canWrite ? "能改参数" : "不能改参数"}。</p>} />
  );

  if (contentError) {
    return <>
      {header}
      {pendingNotices}
      <BlockState state="error" title="当前无法确认最新状态" detail={`${contentError} 为避免误操作，控制项已隐藏。`} onRetry={reload} retrying={contentLoading} />
      {releaseModal}
    </>;
  }
  if (!data) {
    return <>
      {header}
      {pendingNotices}
      <BlockState state="loading" title="业务开关加载中" detail="正在确认各业务开关的最新状态" />
      {releaseModal}
    </>;
  }

  const gates = data.activeGates;
  const { coverageRatio: COV, redlinePct: RED } = data.coverage;
  const covPass = COV >= RED;
  // yellowLinePct 是红线加 25，不是资金总览的健康线（F03）。这页只和红线比，不下「正常」结论。
  // 恢复判据与后端同源：coverageRatio >= redlinePct 放行，等于红线是通过，文字要三分。
  const coverageGapText = COV > RED ? `高于红线 ${pointsText(COV - RED)} 个百分点` : COV === RED ? "等于红线，已达到恢复门槛" : `低于红线 ${pointsText(RED - COV)} 个百分点`;
  const killedGates = gates.filter((gate) => !gate.enabled);
  const killed = killedGates.length;
  const backfills = [...data.autoConfirmations.filter((row) => row.overdue), ...data.autoConfirmations.filter((row) => !row.overdue)];
  const overdue = backfills.filter((row) => row.overdue);
  const backfillOf = (key: string) => backfills.find((row) => row.key === key);
  const autoRuleName = (ruleId: string) => data.autoRules.find((rule) => rule.id === ruleId)?.nm ?? "未知自动规则";
  /** 比较的是什么量看规则：R1 是百分比，R2 是 USDT。阈值用事件存下的，不用现在的（R03）。 */
  const signalOf = (row: AutoConfirmationRow) => {
    const unit = data.autoRules.find((rule) => rule.id === row.ruleId)?.unit ?? "";
    return { value: signalText(row.signalValue, unit).trim(), threshold: signalText(row.threshold, unit).trim() };
  };

  const locks = new Set(pending.flatMap((record) => record.locks));
  const blockOf = (lock: string) => (contentLoading ? READING : locks.has(lock) ? LOCKED : undefined);
  const selectedGates = gates.filter((gate) => sel[gate.key] && gate.enabled && !locks.has(gate.key));
  const selOnCount = selectedGates.length;
  const liveCount = gates.length - killed;

  const killGate = (gate: JGate) => {
    const name = operatorCopyText(gate.name);
    openActionConfirm({ briefKind: "emergency",
      action: `关停业务开关 · ${name}`,
      title: `关停${name}`,
      facts: <Facts><Fact k="业务">{name}，控制{operatorCopyText(gate.cap)}</Fact><Fact k="状态变化"><Change from="在线" to="已关停" /></Fact></Facts>,
      detail: <><b>{name}</b>控制{operatorCopyText(gate.cap)}。确认后这项业务马上停止，并记入操作记录。关停不会多付钱，不需要先检查备付金。</>,
      effect: IMMEDIATE,
      statedBrief: { impact: `${name}控制的业务全站马上停止。恢复要回到这页操作。`, check: "核对业务和触发依据，理由写清监管通知、工单或事件编号。" },
      confirmTone: "danger",
      confirmLabel: "确认关停，立即生效",
      reasonPlaceholder: REASON_HINT,
      reasonPolicyOptional: true,
      businessForm: {
        kind: "multi-field",
        title: ["staking", "genesis"].includes(gate.key) ? "关停依据与后续处置" : "关停依据",
        fields: [
          { key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS },
          ...(["staking", "genesis"].includes(gate.key)
            ? [{ key: "dispositionPlan", label: "存量权益处置方案", current: "", inputKind: "text" as const, wide: true, placeholder: "说明锁仓中的资金、待释放收益和已有权益如何处理" }]
            : []),
        ],
      },
      run: (reason, _newValue, businessValue) => sendCommand(`toggle|${gate.key}`, {
        label: `关停 ${name}`, locks: [gate.key], reason, okText: `${name}已立即关停`,
        command: { kind: "toggle", gate: gate.key, enabled: false, context: { triggerBasis: businessValue?.triggerBasis, dispositionPlan: businessValue?.dispositionPlan } },
      }),
    });
  };

  const resumeGate = (gate: JGate) => {
    const name = operatorCopyText(gate.name);
    const cap = operatorCopyText(gate.cap);
    openActionConfirm({ briefKind: "emergency",
      action: `恢复业务开关 · ${name}`,
      title: `恢复${name}`,
      amplifies: gate.amplifies,
      coverage: gate.coveragePrecheckRequired ? { coverageRatio: COV, redlinePct: RED } : undefined,
      facts: <Facts>
        <Fact k="业务">{name}，重新开放{cap}</Fact>
        <Fact k="状态变化"><Change from="已关停" to="在线" /></Fact>
        {/* 要查覆盖率的业务，框里有覆盖率那一行，这里不再写一遍（VS-105）。 */}
        {!gate.coveragePrecheckRequired && <Fact k="备付金检查">不需要，试用不直接付钱</Fact>}
      </Facts>,
      detail: (
        <><b>{name}</b>将从已关停恢复为在线，重新开放{cap}。{gate.coveragePrecheckRequired
          ? <><b>恢复前检查备付金</b>：当前覆盖率 <b>{pct(COV)}</b>，恢复红线 <b>{RED}%</b>；{covPass ? <>检查通过，{coverageGapText}</> : <>检查不通过，暂不能恢复</>}。</>
          : <>该业务不会直接增加资金流出，可在填写理由后立即恢复。</>}确认后马上生效，并记入操作记录。</>
      ),
      effect: IMMEDIATE,
      statedBrief: gate.coveragePrecheckRequired
        ? { impact: `${cap}马上重新开放，资金影响：${IMPACT_LABEL[gate.coverageImpactCategory]}。`, check: "确认风险已解除。提交时系统再查一次覆盖率，低于红线会拒绝。" }
        : { impact: `${cap}马上重新开放，不直接增加资金流出。`, check: "确认风险已解除，理由写清依据或工单号。" },
      confirmLabel: "确认恢复，立即生效",
      reasonPlaceholder: "例如：风险已解除的依据、工单号",
      run: (reason) => sendCommand(`toggle|${gate.key}`, {
        label: `恢复 ${name}`, locks: [gate.key], reason, okText: `${name}已立即恢复`,
        command: { kind: "toggle", gate: gate.key, enabled: true },
      }),
    });
  };

  const launchBatch = () => {
    const targets = selectedGates;
    const names = targets.map((gate) => operatorCopyText(gate.name)).join(" / ");
    openActionConfirm({ briefKind: "emergency",
      action: "应急批量停用 · 监管点名场景",
      title: `批量关停 ${targets.length} 项业务`,
      facts: <Facts><Fact k={`关停 ${targets.length} 项业务`}>{names}</Fact><Fact k="状态变化"><Change from="在线" to="已关停" /></Fact></Facts>,
      detail: <>一次性立即关停<b>已选 {targets.length} 项业务</b>，用于监管点名、法务事件等重大场景。确认后全部马上关停，每一项都记入操作记录。<b>已选业务开关：{names}</b>。</>,
      effect: IMMEDIATE,
      statedBrief: { impact: `已选的 ${targets.length} 项业务全站马上停止。有一项不符合时整批不执行。恢复要回到这页逐项操作。`, check: "核对已选业务、触发依据和监管事由，理由写清依据或工单号。" },
      confirmTone: "danger",
      confirmLabel: `确认关停 ${targets.length} 项，立即生效`,
      reasonPlaceholder: "例如：为什么现在要关停、内部工单号",
      reasonPolicyOptional: true,
      businessForm: {
        kind: "multi-field",
        title: targets.some((gate) => ["staking", "genesis"].includes(gate.key)) ? "批量应急依据与处置" : "批量应急依据",
        hint: "以下内容都会记入操作记录。",
        fields: [
          { key: "triggerBasis", label: "触发依据", current: "", inputKind: "select", options: TRIGGER_BASES, optionLabels: TRIGGER_LABELS },
          { key: "regulatoryContext", label: "监管事由或文号", current: "", inputKind: "text", wide: true, placeholder: "例如监管通知编号、法务事件编号" },
          ...(targets.some((gate) => ["staking", "genesis"].includes(gate.key))
            ? [{ key: "dispositionPlan", label: "存量权益处置方案", current: "", inputKind: "text" as const, wide: true, placeholder: "说明锁仓中的资金、待释放收益和已有权益如何处理" }]
            : []),
        ],
      },
      run: (reason, _newValue, businessValue) => {
        const keys = targets.map((gate) => gate.key);
        return sendCommand(`batch|${keys.join(",")}`, {
          label: `批量关停 ${names}`, locks: keys, reason, okText: `已立即关停 ${targets.length} 个业务开关`,
          command: { kind: "batch", keys, context: { triggerBasis: businessValue?.triggerBasis ?? "", regulatoryContext: businessValue?.regulatoryContext ?? "", dispositionPlan: businessValue?.dispositionPlan } },
        }, () => setSel({}));
      },
    });
  };

  /**
   * 改参数被别人抢先时框不关，给「读取最新」。读到后用最新值重开这个框：新值留着，理由清空，再核对一次（OP-97）。
   * 读不到就留在框里再读，页面读取失败不影响这个框。
   */
  const staleAware = (request: ActionConfirmReq, reopen: (latest: KillSwitchOverview, draft: string) => void): ActionConfirmReq => {
    const guarded: ActionConfirmReq = {
      ...request,
      run: async (reason, newValue, businessValue) => {
        try {
          return await request.run(reason, newValue, businessValue);
        } catch (cause) {
          if (displayAdminError(cause) !== ADMIN_ERROR_MESSAGES.J1_CONFIG_STALE_VERSION) throw cause;
          const blockWith = (text: string, label: string) => openActionConfirm({ ...guarded, blockedReason: <>{text} <Button size="sm" onClick={() => void readLatest()}>{label}</Button></> });
          const readLatest = async () => {
            const latest = (await actions.reloadJEmergency().catch(() => undefined))?.killSwitch;
            if (latest) reopen(latest, newValue ?? "");
            else blockWith("最新值没读到，你填的内容还在，读到后再提交。", "再读一次");
          };
          blockWith(STALE, "读取最新");
          return false;
        }
      },
    };
    return guarded;
  };
  const changedByOther = (from: string, to: string) => <Facts><Fact k="别人刚改过"><Change from={from} to={to} /></Fact></Facts>;

  const adjEmer = (row: EmergencySlaRow, stale?: { draft: string; was: string; round: number }) => {
    openActionConfirm(staleAware({ briefKind: "config",
      formKey: stale?.round,
      action: `应急参数调整 · ${row.k}`,
      title: `调整${row.k}`,
      detail: <><b>{row.k}</b> · {operatorCopyText(row.d)}。自动关停马上生效；补录只是补写处理结论，不会自动恢复业务。</>,
      effect: IMMEDIATE,
      statedBrief: { impact: "只影响之后的自动关停，已经在等补录的事项截止时间不变。", check: "核对新值，理由写清依据或工单号。" },
      facts: stale && changedByOther(unitText(stale.was, row.unit), unitText(row.v, row.unit)),
      confirmLabel: "确认调整，立即生效",
      edit: { kind: row.kind, current: row.v, initialValue: stale?.draft, unit: row.unit, min: row.id === "autoConfirmMins" ? 10 : undefined, max: row.id === "autoConfirmMins" ? 120 : undefined, step: 1, disallowCurrent: true,
        hint: "10–120 的整数",
        preview: (value) => `改成 ${value} 分钟：之后自动关停时，要在 ${value} 分钟内补录，超过算逾期。` },
      run: (reason, newValue) => sendCommand(`sla|${row.id}`, {
        label: `调整 ${row.k}`, locks: [`sla:${row.id}`], reason, okText: `${row.k} 已调整`,
        command: { kind: "sla", id: row.id, value: newValue ?? row.v, expected: row.v },
      }),
    }, (latest, draft) => adjEmer(latest.emergencySla.find((item) => item.id === row.id) ?? row, { draft, was: row.v, round: (stale?.round ?? 0) + 1 })));
  };

  const adjRule = (rule: AutoRuleRow, stale?: { draft: string; was: string; round: number }) => {
    openActionConfirm(staleAware({ briefKind: "config",
      formKey: stale?.round,
      action: `自动触发规则调整 · ${rule.nm}`,
      title: `调整${rule.nm}`,
      detail: <><b>{rule.nm}</b>当前阈值为 {ruleValue(rule)}。保存后系统会定时检查实际数据，超过阈值就自动关停对应业务，并记入操作记录。</>,
      effect: IMMEDIATE,
      statedBrief: { impact: "阈值改小更容易自动关停，改大更不容易。", check: "核对新值和单位，理由写清依据或工单号。" },
      facts: stale && changedByOther(ruleValue({ ...rule, thr: stale.was }), ruleValue(rule)),
      confirmLabel: "确认调整，立即生效",
      edit: { kind: "number", current: rule.thr, initialValue: stale?.draft, unit: rule.unit, min: 1, max: 1_000_000_000, step: 1, disallowCurrent: true,
        hint: "1–1,000,000,000 的整数",
        preview: (value) => `改成 ${Number(value).toLocaleString()} ${rule.unit}：实际数据超过这个值时自动关停对应业务。` },
      run: (reason, newValue) => sendCommand(`rule|${rule.id}`, {
        label: `调整 ${rule.nm}`, locks: [`rule:${rule.id}`], reason, okText: `${rule.nm} 已生效`,
        command: { kind: "rule", id: rule.id, value: newValue ?? rule.thr, expected: rule.thr },
      }),
    }, (latest, draft) => adjRule(latest.autoRules.find((item) => item.id === rule.id) ?? rule, { draft, was: rule.thr, round: (stale?.round ?? 0) + 1 })));
  };

  const confirmAutoTrigger = (row: AutoConfirmationRow) => {
    const name = operatorCopyText(row.name);
    const signal = signalOf(row);
    openActionConfirm({ briefKind: "record",
      action: `补录自动关停结论 · ${name}`,
      title: `补录${name}的自动关停结论`,
      facts: <Facts>
        <Fact k="业务">{name}（已关停）</Fact>
        <Fact k="触发规则">{autoRuleName(row.ruleId)}</Fact>
        <Fact k="触发值 / 阈值">{signal.value} / {signal.threshold}</Fact>
        <Fact k="截止时间">{timeText(row.dueAt)}{row.overdue ? "，已逾期" : ""}</Fact>
      </Facts>,
      detail: <><b>{name}</b>由 {autoRuleName(row.ruleId)} 自动关停，触发值 {signal.value}，阈值 {signal.threshold}。本操作只补全处置结论，不会自动恢复业务；如建议恢复，仍需超级管理员单独发起恢复并通过备付金检查。</>,
      effect: <StatusTag tone="neutral" filled>业务继续关停</StatusTag>,
      statedBrief: { impact: "只写下处理结论，业务继续关停，不会恢复。", check: "核对触发值和阈值，理由写清判断依据。" },
      confirmLabel: "确认补录，业务仍关停",
      reasonPlaceholder: "例如：核实过的触发原因、工单号",
      businessForm: {
        kind: "multi-field",
        title: "自动关停复核",
        fields: [{ key: "decision", label: "复核结论", current: "", inputKind: "select", options: AUTO_CONFIRM_DECISIONS, optionLabels: AUTO_CONFIRM_DECISION_LABELS }],
      },
      run: (reason, _newValue, businessValue) => sendCommand(`backfill|${row.incidentId}`, {
        label: `补录 ${name}结论`, locks: [row.key], reason, okText: `${name}自动关停结论已补录`,
        command: { kind: "backfill", gate: row.key, incidentId: row.incidentId, decision: businessValue?.decision as "keep_disabled" | "recommend_restore" },
      }),
    });
  };

  /** 业务卡底部只有一个动作，后果收进名称旁的提示图标（DP-06）。 */
  const cardAction = (gate: JGate): ReactNode => {
    const block = blockOf(gate.key);
    if (gate.enabled) return canKill ? <Button variant="danger-outline" disabledReason={block} onClick={() => killGate(gate)}>关停</Button> : undefined;
    const backfill = backfillOf(gate.key);
    if (backfill) return canKill ? <Button disabledReason={block} onClick={() => confirmAutoTrigger(backfill)}>补录结论</Button> : undefined;
    if (!canResume) return undefined;
    if (gate.coveragePrecheckRequired && !covPass) return <Button disabledReason={BLOCKED_RESUME}>恢复受阻</Button>;
    return <Button disabledReason={block} onClick={() => resumeGate(gate)}>恢复</Button>;
  };

  const gateHelp = (gate: JGate) => {
    const backfill = backfillOf(gate.key);
    return [
      { k: "控制", v: operatorCopyText(gate.cap) },
      { k: "资金影响", v: IMPACT_LABEL[gate.coverageImpactCategory] },
      { k: "最近变更", v: gate.lastChange || "—" },
      { k: "操作后果", v: gate.enabled ? "关停不查覆盖率，确认后立即生效。"
        : backfill ? "先补录结论才能恢复，补录不会恢复业务。"
          : gate.coveragePrecheckRequired ? "恢复确认后立即生效，提交时再查一次覆盖率。" : "恢复确认后立即生效，不查覆盖率。" },
      { k: "谁能恢复", v: !gate.enabled && !canResume && canKill ? "这个账号不能恢复，请联系超级管理员。" : undefined },
    ];
  };

  const conclusionFacts = <>
    业务开关：已关停 <b>{killed}</b> 个业务{backfills.length > 0 && <>，{overdue.length > 0 ? <><b>{overdue.length}</b> 项待补录已逾期</> : <><b>{backfills.length}</b> 项待补录</>}</>}
  </>;
  const nextStepHelp = canResume ? "风险解除后，到业务卡上点「恢复」。系统不会自动恢复。" : canKill ? "风险解除后，请超级管理员恢复。系统不会自动恢复。" : "风险解除后由超级管理员恢复。系统不会自动恢复。";
  const resumeBlocked = !covPass && killedGates.some((gate) => gate.coveragePrecheckRequired);

  return (
    <>
      {header}
      {pendingNotices}

      {overdue.length > 0 ? (
        <div data-proof="j1-backfill-overdue-banner">
          <Conclusion state="danger" lead strong hint={<>
            {overdue.slice(0, 3).map((row, index) => <span key={row.incidentId}>{index > 0 && " · "}{operatorCopyText(row.name)}（截止 {timeText(row.dueAt)}）</span>)}
            {overdue.length > 3 && <span> · 另有 {overdue.length - 3} 项</span>}
          </>} explain="相关业务已停止，但还没写处理结论。逾期事项不会自动消失，请值班同事马上补录，或交给值班主管处理。">{conclusionFacts}</Conclusion>
        </div>
      ) : backfills.length > 0 ? (
        <Conclusion state="warn" lead explain="自动关停后要写清为什么关。到业务卡上点「补录结论」，补录不会恢复业务。">{conclusionFacts}</Conclusion>
      ) : killed > 0 ? (
        <Conclusion state="warn" lead hint={resumeBlocked ? "覆盖率低于红线，暂不能恢复。到「资金储备与应付款」补足储备后再恢复。" : undefined} explain={nextStepHelp}>{conclusionFacts}</Conclusion>
      ) : pending.length > 0 ? (
        <Conclusion state="warn" lead hint="到上方读回核对或按原操作重试。" explain="业务卡读到的是现在的状态，不能当成这次操作的结果。">业务开关：全部开启，<b>{pending.length}</b> 项操作结果未确认</Conclusion>
      ) : (
        <Conclusion state="ok">业务开关：全部开启，没有要处理的事</Conclusion>
      )}

      <StatBand label="业务开关摘要">
        <Stat tone="role-2" icon={Power} label="在线业务" value={`${liveCount} / ${gates.length}`} />
        <Stat tone={data.stats.emergencyGateCount > 0 ? "warn" : "role-other"} icon={Siren} label="应急关停业务" value={String(data.stats.emergencyGateCount)} unit="项" explain="由自动规则、批量应急或应急预案联动关停的业务。" />
        <Stat tone="role-other" icon={ShieldAlert} label="未能恢复" value={String(data.stats.coverageBlockedCount)} unit="次" explain="因备付金不足被系统拒绝的恢复次数，是累计数，不是现在受限的业务数。" />
        <Stat tone={covPass ? "role-1" : "danger"} icon={Coins} label="兑付覆盖率" value={pct(COV)} sub={`红线 ${RED}%`} explain={`储备除以应付款，${coverageGapText}。恢复提现、兑换、创世节点或质押时，系统都会记录当时的覆盖情况。`} />
      </StatBand>

      <ControlGrid label="业务开关">
        {gates.map((gate) => {
          const name = operatorCopyText(gate.name);
          const backfill = backfillOf(gate.key);
          return (
            <ControlCard key={gate.key} title={name} icon={GATE_ICON[gate.key] ?? Power} tone={gate.enabled ? "ok" : backfill?.overdue ? "danger" : "warn"} attention={!!backfill}
              explain={gateHelp(gate)}
              status={<>
                {gate.enabled ? <StatusTag tone="ok">在线</StatusTag> : <StatusTag tone="warn" icon={Power}>已关停</StatusTag>}
                {gate.emergency && <StatusTag tone="warn" icon={Siren}>应急</StatusTag>}
                {backfill && (backfill.overdue ? <StatusTag tone="danger">已逾期</StatusTag> : <StatusTag tone="warn">待补录</StatusTag>)}
              </>}
              select={gate.enabled && canBatchKill ? <Checkbox data-proof="j1-gate-select" checked={!!sel[gate.key]} disabled={locks.has(gate.key)} onChange={() => setSel((state) => ({ ...state, [gate.key]: !state[gate.key] }))} aria-label={`勾选${name}纳入批量关停`} title={`勾选${name}纳入批量关停`} /> : undefined}
              action={cardAction(gate)} />
          );
        })}
      </ControlGrid>

      {canBatchKill && (
        <div className="rd-control-batch">
          <BatchBar summary={<><b data-proof="j1-batch-count">已选 {selOnCount} 项业务</b>{liveCount === 0 && " · 所有业务都已关停"}</>}
            hint={<AutoGloss>遇监管点名、法务事件时，在业务卡右上角勾选多个业务，一次全部关停。立即生效，有一项不符合时整批不执行。</AutoGloss>}>
            <Button variant="danger-outline" disabledReason={contentLoading ? READING : selOnCount === 0 ? (liveCount === 0 ? "所有业务都已关停，没有可关停的业务。要再用批量关停，先在业务卡上恢复。" : "先在业务卡右上角勾选要关停的业务") : undefined} onClick={launchBatch}>立即应急关停</Button>
          </BatchBar>
        </div>
      )}

      {backfills.length > 0 && (
        <Panel title="自动关停待补录" explain="复核触发信号并补全处置结论，补录不会自行恢复业务。完成后从这里移除。" icon={ListChecks} tone={overdue.length > 0 ? "danger" : "warn"} flush>
          <Table label="自动关停待补录">
            <thead><tr><Th>业务 · 规则</Th><Th align="right">触发值 / 阈值</Th><Th>截止时间 · 触发时间</Th><Th>状态</Th>{canKill && <Th align="right">操作</Th>}</tr></thead>
            <tbody>
              {backfills.map((row) => (
                <Tr key={row.incidentId}>
                  <Td><Cell main={operatorCopyText(row.name)} sub={autoRuleName(row.ruleId)} /></Td>
                  <Td align="right"><Cell num main={`${signalOf(row).value} / ${signalOf(row).threshold}`} /></Td>
                  <Td><Cell num main={timeText(row.dueAt)} sub={`${timeText(row.triggeredAt)} 触发`} /></Td>
                  <Td>{row.overdue ? <StatusTag tone="danger">已逾期</StatusTag> : <StatusTag tone="warn">待补录</StatusTag>}</Td>
                  {canKill && <Td align="right"><Button size="sm" disabledReason={blockOf(row.key)} onClick={() => confirmAutoTrigger(row)}>补录结论</Button></Td>}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <Fold title="恢复业务前 · 备付金检查" explain="恢复会增加资金流出或未来负债的业务（提现、兑换、创世节点、质押）前，先检查平台备付金。提交时系统再查一次。"
        icon={ShieldCheck} tone={covPass ? "role-1" : "danger"}
        summary={covPass ? "可以恢复" : "低于红线，禁止恢复"}
        alert={!covPass} alertTone="danger"
        open={folds.coverage ?? (killed > 0 || !covPass)} onOpenChange={(open) => setFolds((state) => ({ ...state, coverage: open }))}>
        <Figure width={560} stack="wide" graphic={
          <ThresholdMeter label="兑付覆盖率和恢复红线" rows={[{ key: "coverage", label: "当前", value: COV, text: pct(COV), tone: covPass ? "ok" : "danger" }]}
            marks={[{ key: "red", text: `恢复红线 ${RED}%`, value: RED, tone: "danger" }]} />
        }>
          <Facts>
            <Fact k="检查结果">{covPass ? "通过" : "不通过"} · {coverageGapText}</Fact>
          </Facts>
        </Figure>
      </Fold>

      <Fold title="功能开关总表" explain="关停和恢复都是确认后立即执行，全站马上生效，App 无法绕过，都要填写理由并记入操作记录。"
        icon={ScrollText} tone="role-other" summary={`${gates.length} 个业务开关`}
        actions={reach("/platform/audit", "platform_a2_read") ? <Link className="rd-link" href="/platform/audit?domain=J">查看操作记录</Link> : undefined}
        open={!!folds.table} onOpenChange={(open) => setFolds((state) => ({ ...state, table: open }))}>
        <Table label="功能开关总表">
          <thead><tr><Th>业务开关</Th><Th>控制的能力</Th><Th>状态</Th><Th>资金影响</Th><Th>恢复需备付金</Th><Th>最近变更</Th></tr></thead>
          <tbody>
            {gates.map((gate) => (
              <Tr key={gate.key}>
                <Td><Cell main={operatorCopyText(gate.name)} /></Td>
                <Td>{operatorCopyText(gate.cap)} <Explain label={`${operatorCopyText(gate.name)}控制范围`} content={<AutoGloss>{operatorCopyText(gate.desc)}</AutoGloss>} /></Td>
                <Td><Cell main={gate.enabled ? <StatusTag tone="ok">在线</StatusTag> : <StatusTag tone="warn" icon={Power}>已关停</StatusTag>} sub={gate.emergency ? "应急" : undefined} /></Td>
                <Td>{IMPACT_LABEL[gate.coverageImpactCategory]}</Td>
                <Td>{gate.coveragePrecheckRequired ? <AutoGloss>需核备付金</AutoGloss> : "不需"}</Td>
                <Td><Cell num main={gate.lastChange.split(" · ")[0] || "—"} sub={gate.lastChange.split(" · ").slice(1).join(" · ") || undefined} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Fold>

      <Fold title="应急处置参数" icon={SlidersHorizontal} tone="role-4" summary={`${data.emergencySla.length} 项`}
        open={!!folds.sla} onOpenChange={(open) => setFolds((state) => ({ ...state, sla: open }))}>
        <ConfigList label="应急处置参数">
          {data.emergencySla.map((row) => (
            <ConfigRow key={row.id} name={row.k} what={<AutoGloss>{operatorCopyText(row.d)}</AutoGloss>}
              when={row.id === "recoverGate" ? "只读，跟随备付金红线" : "保存后立即生效，只影响之后的自动关停"}
              value={row.id === "recoverGate" ? "跟随红线" : unitText(row.v, row.unit)}
              action={row.id === "recoverGate"
                ? (reach("/overview/dual-ledger") ? <Link className="rd-link" href="/overview/dual-ledger" prefetch={false} title="恢复门槛跟随备付金红线，如需调整请前往备付金页面">去看红线</Link> : undefined)
                : canWrite ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={blockOf(`sla:${row.id}`)} onClick={() => adjEmer(row)}>调整</Button> : undefined} />
          ))}
        </ConfigList>
      </Fold>

      <Fold title="应急判定与自动关停规则" icon={CalendarClock} tone="role-3"
        summary={backfills.length === 0 ? `${data.autoRules.length} 条规则，当前没有待补录事项` : `${data.autoRules.length} 条规则`}
        open={!!folds.rules} onOpenChange={(open) => setFolds((state) => ({ ...state, rules: open }))}>
        <ConfigList label="应急判定与自动关停规则">
          {data.autoRules.map((rule) => {
            const source = RULE_SOURCE[rule.id];
            return (
              <ConfigRow key={rule.id} name={`${rule.nm} · ${rule.tag}`}
                what={rule.cond.map((part, index) => {
                  if (!part) return null;
                  // R2、R3 的阈值可变，条件文字跟当前值走，后端给的是固定文字（F04）。
                  const text = index !== 1 ? part : rule.id === "tamperCluster" ? `${rule.thr} ${rule.unit}` : rule.id === "maturityGap" ? ruleValue(rule) : part;
                  return index % 2 ? <b key={index}>{operatorCopyText(text)}</b> : <RuleCondition key={index} text={operatorCopyText(text)} />;
                })}
                when={`${RULE_MODE_LABEL[rule.mode]}${rule.adjustable ? "，保存后立即生效" : ""}`}
                note={rule.refNote || undefined}
                value={ruleValue(rule)}
                action={rule.adjustable && canWrite
                  ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={blockOf(`rule:${rule.id}`)} onClick={() => adjRule(rule)}>调整</Button>
                  : source && reach(source) ? <Link className="rd-link" href={source} prefetch={false} title={rule.refTitle}>去设置</Link> : undefined} />
            );
          })}
        </ConfigList>
      </Fold>

      {releaseModal}
    </>
  );
}
