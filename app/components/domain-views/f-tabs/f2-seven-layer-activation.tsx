"use client";

/**
 * F2 整体结算：现在是未启用、运行中还是已暂停，三个动作（启用、暂停、恢复）各自的后果，
 * 启用前后端要检查的三条，以及这件事的待审批和结果未知。
 * 申请、恢复原申请的逻辑照旧：submitted、recovering 只在本页内存，原申请由外壳的专用存储保留。
 */
import { useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleHelp, Clock3, Hourglass, PauseCircle, Power, PowerOff, TriangleAlert } from "lucide-react";
import { Button, Explain, Notice, Panel, StatusTag } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { a2ActionText } from "@/lib/admin/operator-copy";
import { Change, Fact, Facts, LAYERS, layerRate, num, type F2Confirm } from "./f2-shared";
import { stamp } from "./f2-shared";
import type { F2Recovery } from "@/lib/admin/f2-approval";
import type { FViewCtx } from "./types";


const ACTION_COPY = {
  ACTIVATE: {
    label: "启用团队购买奖励结算",
    impact: "批准后，新订单按七层比例计算团队奖励；启用前的订单仍按原来的规则，不补发。比例、冷却和好友拆分都不变。",
    check: "提交和批准时，后端都会检查七层比例和系数是否配齐、第 1 层是否 10%；批准时还检查兑付覆盖率不低于红线。",
    after: "运行中",
  },
  PAUSE: {
    label: "暂停团队购买奖励结算",
    impact: "批准后，新订单的团队奖励先不计算；已经算好、在冷却中的奖励，以及退款和解锁照常处理。启用时间不变。",
    check: "暂停不检查比例，也不检查兑付覆盖率。",
    after: "已暂停",
  },
  RESUME: {
    label: "恢复团队购买奖励结算",
    impact: "批准后，新订单照常计算；因这次暂停没算的订单会重新处理，其他历史订单不补算。比例和冷却不变。",
    check: "批准时后端检查兑付覆盖率不低于红线，低于红线不会执行。",
    after: "运行中",
  },
} as const;

export function F2SevenLayerActivation({ ctx, openConfirm }: { ctx: FViewCtx; openConfirm: (spec: F2Confirm) => void }) {
  const policy = ctx.f2DirectPolicy;
  const submitted = !!ctx.f2ActivationPending;
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const busy = ctx.f2DirectPolicyLoading || ctx.f2ActivationPendingLoading;
  const allowed = ctx.can("network_f2_policy_amplify") && ctx.can("platform_a2_proposal_create");
  const canAudit = ctx.can("platform_a2_read");
  const supported = policy?.sevenLayerActivationContractVersion === 1;
  const action = !policy?.sevenLayerEnabled ? "ACTIVATE" : policy.sevenLayerPaused ? "RESUME" : "PAUSE";
  const copy = ACTION_COPY[action];
  const label = copy.label;
  const writeBlocked = ctx.f2WriteBlocked("f-seven-layer-activation");
  const blocked = !!writeBlocked || busy || !policy || !!ctx.f2DirectPolicyError || !!ctx.f2ActivationPendingError && canAudit || !supported || !!ctx.f2ActivationPending || !!ctx.f2ActivationAttempt || submitted || recovering;
  const blockedReason = writeBlocked ?? (busy ? "正在读取结算状态"
    : ctx.f2DirectPolicyError || !policy ? "结算状态没读到，刷新后再试"
      : ctx.f2ActivationPendingError && canAudit ? "审批进度没读到，刷新后再试"
        : !supported ? "后台版本和后端对不上，暂时只能查看；请刷新后再试"
          : ctx.f2ActivationPending ? "已有申请在等另一位管理员批准"
            : ctx.f2ActivationAttempt ? "上一次申请结果未知，先按原请求重试或去核对"
              : submitted ? "刚提交的申请在等另一位管理员批准"
                : recovering ? "正在按原请求重试" : undefined);
  const state = !policy ? null : !policy.sevenLayerEnabled ? "off" : policy.sevenLayerPaused ? "paused" : "running";
  const stateName = { off: "未启用", paused: "已暂停", running: "运行中" } as const;

  async function recover(attempt: F2Recovery, query = false) {
    if (recovering || (query ? !attempt.canQuery : !attempt.canRetry)) return;
    setRecovering(true); setRecoveryError(null);
    try { if (query) await ctx.queryF2Proposal(attempt.fingerprint); else await ctx.retryF2Proposal(attempt.fingerprint); }
    catch (error) { setRecoveryError(error instanceof Error && error.name.endsWith("OutcomeUncertainError") ? displayAdminError("F2_PROPOSAL_OUTCOME_UNKNOWN") : displayAdminError(error)); }
    finally { setRecovering(false); }
  }
  function submit() {
    if (!allowed || blocked || !policy || !state) return;
    const revision = policy.sevenLayerRevision, policyVersion = policy.policyVersion;
    openConfirm({
      slot: "f-seven-layer-activation",
      action: label, title: label, briefKind: action === "RESUME" ? "funds" : "config", amplify: action !== "PAUSE",
      effect: <StatusTag tone="progress" filled explain="另一位管理员在「操作记录与审批」批准后才生效；批准前结算状态不变。">批准后生效</StatusTag>,
      facts: <Facts>
        <Fact k="整体结算"><Change from={stateName[state]} to={copy.after} /></Fact>
        <Fact k="启用时间">{policy.cutoverAt ? `不变，仍是 ${stamp(policy.cutoverAt)}` : "批准时由后端记下"}</Fact>
      </Facts>,
      statedBrief: { impact: copy.impact, check: copy.check },
      detail: copy.impact,
      completionCopy: "批准人要是另一位管理员，需有审批批准权限和「团队奖励规则」权限；批准前结算状态不变。",
      coverageCheck: "批准时后端检查兑付覆盖率，低于红线不会执行。",
      coverageLead: action === "ACTIVATE" ? "启用后平台开始按七层比例付团队奖励" : "恢复后平台继续按七层比例付团队奖励",
      submit: async (reason) => { await ctx.changeF2SevenLayerActivation(action, revision, policyVersion, reason); },
      done: "已提交审批，等另一位管理员批准",
    });
  }

  const attempts = ctx.f2Proposals;
  const pending = ctx.f2ActivationPending;

  return (
    <Panel className="f2-settle" aria-label="团队购买奖励结算状态" title="整体结算" icon={state === "off" ? PowerOff : state === "paused" ? PauseCircle : Power} tone={state === "running" ? "ok" : state ? "warn" : "role-other"}
      sub={policy?.cutoverAt ? <>启用于 <time dateTime={policy.cutoverAt}>{stamp(policy.cutoverAt)}</time></> : undefined}
      explain="整体结算管新订单要不要按七层规则算团队奖励。启用、暂停、恢复都要另一位管理员批准，都不改比例、冷却和好友拆分。启用后不补发启用前的订单；暂停期间已在冷却的奖励、退款和解锁照常处理，恢复后只重新处理因这次暂停没算的订单；暂停和恢复不改启用时间。"
      actions={allowed ? <Button variant={action === "PAUSE" ? "secondary" : "primary"} disabledReason={blockedReason} onClick={submit}>{label}</Button> : undefined}>
      <div className="f2-settle-body">
        <div className="f2-settle-state" role="status" aria-live="polite">
          {busy ? <span className="f2-settle-name" data-state="loading">正在读取…</span>
            : !state ? <span className="f2-settle-name" data-state="failed">读不到</span>
              : <span className="f2-settle-name" data-state={state}>{stateName[state]}</span>}
          <p className="f2-settle-what">
            {busy ? "结算状态读取中" : !state ? "结算状态读取失败，这部分没有判断。刷新后再看。"
              : state === "off" ? "七层结算还没启用，按原来的规则结算。"
                : state === "paused" ? "新订单的奖励先不算；冷却、退款、解锁照常。"
                  : "新订单按下面「每层分多少」的比例计算团队奖励。"}
          </p>
          {!allowed && <p className="f2-settle-note">只能查看：申请启用、暂停、恢复需有「团队奖励规则」和「发起审批」权限。</p>}
        </div>
        {state === "off" && <ActivationChecks ctx={ctx} />}
      </div>
      {(pending || submitted || attempts.length > 0 || recoveryError || ctx.f2ActivationPendingError || (policy && !supported)) && <ul className="f2-alerts" aria-label="整体结算的申请">
        {pending && <li><Notice tone="warn" title={<>{a2ActionText(pending.action)}<StatusTag tone="warn" icon={Clock3} explain="等另一位管理员在「操作记录与审批」批准；批准前结算状态不变，也不能再提交新的申请。">待审批</StatusTag></>}
          action={canAudit ? <Link className="rd-link" href="/platform/audit">去操作记录与审批查看</Link> : undefined}>
          <p>审批单 <span data-mono>{pending.id}</span>，等另一位管理员批准。</p>
        </Notice></li>}
        {!pending && submitted && <li><Notice tone="progress" title="申请已提交，等另一位管理员批准"
          action={canAudit ? <Link className="rd-link" href="/platform/audit">去操作记录与审批查看</Link> : undefined}>
          <p>批准前结算状态不变。批准后点页头「刷新」看最新状态。</p>
        </Notice></li>}
        {attempts.map(attempt => { const attemptExpired = attempt.expiresAt <= Date.now(); return <li key={attempt.commandKey}><Notice tone="warn" actionBelow title={<>{a2ActionText(attempt.spec.action)}{attempt.ticket?.status === "pending"
          ? <StatusTag tone="warn" icon={Clock3}>待审批</StatusTag>
          : attempt.received ? <StatusTag tone="warn" icon={CircleHelp}>原申请建过单，批没批准还没查到</StatusTag>
          : attemptExpired
          ? <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试。到「操作记录与审批」核对有没有这张审批单；查不到也不能据此认定没提交。">已过期</StatusTag>
          : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。24 小时内可以按原请求重试，后端认得出是同一次提交，不会建第二张。">结果未知</StatusTag>}</>}
          action={<span className="f2-actions">
            {attempt.canRetry && !attemptExpired && <Button size="sm" loading={recovering} loadingText="正在重试…" onClick={() => void recover(attempt)}>按原请求重试</Button>}
            {attempt.canQuery && <Button size="sm" loading={recovering} onClick={() => void recover(attempt, true)}>查询原结果</Button>}
            {canAudit && <Link className="rd-link" href="/platform/audit">去操作记录与审批核对</Link>}
          </span>}>
          <p>{attempt.spec.before} → {attempt.spec.after} · {stamp(new Date(attempt.createdAt).toISOString())}</p>
          <p>提交时填的理由：{attempt.spec.reason}</p>
        </Notice></li>; })}
        {recoveryError && <li><Notice tone="danger" title="按原请求重试没有成功">{recoveryError}</Notice></li>}
        {ctx.f2ActivationPendingError && <li><Notice tone="warn" title="审批进度没读到">{ctx.f2ActivationPendingError}</Notice></li>}
        {policy && !supported && <li><Notice tone="warn" title="暂时只能查看">后台版本和后端的结算接口对不上，刷新后再试；仍不行请联系值班人员。</Notice></li>}
      </ul>}
    </Panel>
  );
}

/** 启用时后端检查的三条（D01）：只列现在读到的，不替后端下「能启用」的结论。 */
function ActivationChecks({ ctx }: { ctx: FViewCtx }) {
  const rates = ctx.f2Unilevel;
  const l1 = layerRate(rates, "L1");
  const allUsdt = LAYERS.every(level => rates.some(row => row.l === level && row.usdt !== null && row.usdt >= 0 && row.usdt <= 100));
  const allNex = LAYERS.every(level => rates.some(row => row.l === level && row.nex !== null && row.nex >= 0));
  const unread = ctx.f2Loading ? "七层规则读取中" : ctx.f2Error ? "七层规则没读到" : null;
  const rows = unread ? [
    { key: "usdt", ok: null, label: "七层 USDT 比例都已配置", seen: unread },
    { key: "nex", ok: null, label: "七层 UVT 系数都已配置", seen: unread },
    { key: "l1", ok: null, label: "第 1 层比例是 10%", seen: unread },
  ] : [
    { key: "usdt", ok: allUsdt, label: "七层 USDT 比例都已配置", seen: allUsdt ? "L1–L7 都有" : LAYERS.filter(level => !rates.some(row => row.l === level && row.usdt !== null && row.usdt >= 0 && row.usdt <= 100)).join("、") },
    { key: "nex", ok: allNex, label: "七层 UVT 系数都已配置", seen: allNex ? "L1–L7 都有" : LAYERS.filter(level => !rates.some(row => row.l === level && row.nex !== null && row.nex >= 0)).join("、") },
    { key: "l1", ok: !!l1 && l1.usdt === 10, label: "第 1 层比例是 10%", seen: l1 ? `第 1 层是 ${num(l1.usdt)}%` : "没有第 1 层规则" },
  ];
  return (
    <div className="f2-checks">
      <p className="f2-checks-title">启用时后端会检查<Explain label="这三条怎么用" content={<>
        <p>提交申请和另一位管理员批准时，后端都会再查一遍，以那时的数据为准。这里只列现在读到的，不代表一定能启用。</p>
        <p>后端把没填的系数也显示成 0，这里分不出「没填」和「填了 0」，以后端检查为准。</p>
        <p>缺的层目前没有后台入口补齐，要由后端初始化。</p>
      </>} /></p>
      <ul className="f2-checks-list">
        {rows.map((row) => (
          <li key={row.key} data-ok={row.ok === null ? undefined : String(row.ok)}>
            {row.ok === null ? <CircleHelp size={16} aria-hidden /> : row.ok ? <CircleCheck size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
            <span className="f2-checks-label">{row.label}</span>
            <span className="f2-checks-seen">{row.ok === false ? `缺：${row.seen}` : row.seen}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
