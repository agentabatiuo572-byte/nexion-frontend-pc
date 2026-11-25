"use client";

/**
 * F2 整体结算：现在是未启用、运行中还是已暂停，三个动作（启用、暂停、恢复）各自的后果，
 * 启用前后端要检查的三条，以及这件事的待审批和结果未知。
 * 申请、恢复原申请的逻辑照旧：submitted、recovering 只在本页内存，原申请由外壳的专用存储保留。
 */
import { RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleHelp, Clock3, Hourglass, PauseCircle, Power, PowerOff, TriangleAlert } from "lucide-react";
import { Button, Explain, Notice, Panel, StatusTag } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { a2ActionText } from "@/lib/admin/operator-copy";
import { Change, Fact, Facts, LAYERS, f2Ranked, layerRate, num, type F2Confirm } from "./f2-shared";
import { stamp } from "./f2-shared";
import { F2_ACTIVATION_SLOT, F2_BOOTSTRAP_SLOT, F2_POLICY_SLOT, type F2Recovery } from "@/lib/admin/f2-approval";
import { f4Decimal } from "@/lib/admin/f4-money";
import { f2BootstrapUsesRank, f2PctSum, parseF2BootstrapAfter } from "./f2-bootstrap-ticket";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { F2_HISTORICAL_PARAM_NAMES } from "./f2-rates";
import { FReleaseButton, F_PROPOSAL_CREATED_LINE, fProposalEndText } from "./f-release";
import { useFreshFirst } from "../recovery-panel";
import type { FViewCtx } from "./types";


const ACTION_COPY = {
  ACTIVATE: {
    label: "启用团队购买奖励结算",
    impact: "批准后，新订单按七层比例计算团队奖励；启用前的订单仍按原来的规则，不补发。比例、冷却和好友拆分都不变。",
    check: "提交和批准时都会检查七层比例和系数是否配齐、第 1 层是否 10%；批准时还检查兑付覆盖率不低于红线。",
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
    check: "批准时检查兑付覆盖率，低于红线不会执行。",
    after: "运行中",
  },
} as const;

export function F2SevenLayerActivation({ ctx, openConfirm, recovering }: { ctx: FViewCtx; openConfirm: (spec: F2Confirm) => void; recovering: boolean }) {
  const policy = ctx.f2DirectPolicy;
  const submitted = !!ctx.f2ActivationPending;
  const busy = ctx.f2DirectPolicyLoading || ctx.f2ActivationPendingLoading;
  const allowed = ctx.can("network_f2_policy_amplify") && ctx.can("platform_a2_proposal_create");
  const canAudit = ctx.can("platform_a2_read");
  const supported = policy?.sevenLayerActivationContractVersion === 1;
  const action = !policy?.sevenLayerEnabled ? "ACTIVATE" : policy.sevenLayerPaused ? "RESUME" : "PAUSE";
  const ranked = f2Ranked(ctx);
  // 第 1、2 层按受益人等级后，启用时不再要求第 1 层是 10%（B83）；只改说法，检查在后端。
  const copy = action === "ACTIVATE" && ranked ? { ...ACTION_COPY.ACTIVATE, check: "提交和批准时都会检查七层比例和系数是否配齐；批准时还检查兑付覆盖率不低于红线。" } : ACTION_COPY[action];
  const label = copy.label;
  const writeBlocked = ctx.f2WriteBlocked("f-seven-layer-activation");
  const checks = activationCheckRows(ctx);
  const incomplete = action === "ACTIVATE" && checks.some(check => check.ok !== true);
  const checkedReason = incomplete ? ctx.f2Loading ? "七层规则读取中" : ctx.f2Error ? "七层规则没读到"
    : "配齐七层 USDT 比例和 UVT 系数并通过下方检查后才能启用" : undefined;
  const blocked = !!writeBlocked || incomplete || busy || !policy || !!ctx.f2DirectPolicyError || !!ctx.f2ActivationPendingError && canAudit || !supported || !!ctx.f2ActivationPending || !!ctx.f2ActivationAttempt || submitted || recovering;
  const blockedReason = writeBlocked ?? (busy ? "正在读取结算状态"
    : ctx.f2DirectPolicyError || !policy ? "结算状态没读到，刷新后再试"
      : ctx.f2ActivationPendingError && canAudit ? "审批进度没读到，刷新后再试"
        : !supported ? "后台页面和系统版本对不上，暂时只能查看；请刷新后再试"
          : ctx.f2ActivationPending ? "已有申请在等另一位超级管理员批准"
            : ctx.f2ActivationAttempt ? "上一次申请结果未知，先按原请求重试或去核对"
              : submitted ? "刚提交的申请在等另一位超级管理员批准"
                : recovering ? "正在按原请求重试" : checkedReason);
  const state = !policy ? null : !policy.sevenLayerEnabled ? "off" : policy.sevenLayerPaused ? "paused" : "running";
  const stateName = { off: "未启用", paused: "已暂停", running: "运行中" } as const;

  function submit() {
    if (!allowed || blocked || !policy || !state) return;
    const revision = policy.sevenLayerRevision, policyVersion = policy.policyVersion;
    openConfirm({
      slot: "f-seven-layer-activation",
      action: label, title: label, briefKind: action === "RESUME" ? "funds" : "config", amplify: action !== "PAUSE",
      effect: <StatusTag tone="progress" filled explain="另一位超级管理员在「操作记录与审批」批准后才生效；批准前结算状态不变。">批准后生效</StatusTag>,
      facts: <Facts>
        <Fact k="整体结算"><Change from={stateName[state]} to={copy.after} /></Fact>
        <Fact k="启用时间">{policy.cutoverAt ? `不变，仍是 ${stamp(policy.cutoverAt)}` : "批准时自动记下"}</Fact>
        <Fact k="谁来批">另一位超级管理员</Fact>
        <Fact k="需有权限">审批批准权限和团队奖励放大策略权限</Fact>
      </Facts>,
      statedBrief: { impact: copy.impact, check: copy.check },
      detail: copy.impact,
      coverageCheck: "批准时检查兑付覆盖率，低于红线不会执行。",
      coverageLead: action === "ACTIVATE" ? "启用后平台开始按七层比例付团队奖励" : "恢复后平台继续按七层比例付团队奖励",
      submit: async (reason) => { await ctx.changeF2SevenLayerActivation(action, revision, policyVersion, reason); },
      done: "已提交，等待审批后执行",
    });
  }

  const pending = ctx.f2ActivationPending;

  return (
    <Panel className="f2-settle" aria-label="团队购买奖励结算状态" title="整体结算" icon={state === "off" ? PowerOff : state === "paused" ? PauseCircle : Power} tone={state === "running" ? "ok" : state ? "warn" : "role-other"}
      sub={policy?.cutoverAt && state !== "running" ? <>启用于 <time dateTime={policy.cutoverAt}>{stamp(policy.cutoverAt)}</time></> : undefined}
      explain={<><p>整体结算管新订单要不要按七层规则算团队奖励。启用、暂停、恢复都要另一位超级管理员批准，都不改比例、冷却和好友拆分。</p><p>启用后不补发启用前的订单；暂停后新订单的奖励先不算，已在冷却的奖励、退款和解锁照常处理；恢复后只重新处理因这次暂停没算的订单；暂停和恢复不改启用时间。</p></>}
      actions={allowed ? <Button variant={action === "PAUSE" ? "secondary" : "primary"} disabledReason={blockedReason} onClick={submit}>{label}</Button> : undefined}>
      <div className="f2-settle-body">
        <div className="f2-settle-state" role="status" aria-live="polite">
          {busy ? <span className="f2-settle-name" data-state="loading">正在读取…</span>
            : !state ? <span className="f2-settle-name" data-state="failed">读不到</span>
              : <span className="f2-settle-name" data-state={state}>{stateName[state]}{state === "running" && policy?.cutoverAt && <span className="f2-settle-since"> · 启用于 <time dateTime={policy.cutoverAt}>{stamp(policy.cutoverAt)}</time></span>}</span>}
          {state !== "running" && <p className="f2-settle-what">
            {busy ? "结算状态读取中" : !state ? "结算状态读取失败，这部分没有判断。刷新后再看。"
              : state === "off" ? "七层结算还没启用：新订单按原来的规则结算，下表的比例启用后才生效。"
                : "新订单的奖励先不算；冷却、退款、解锁照常。"}
          </p>}
          {!allowed && <p className="f2-settle-note">只能查看：申请启用、暂停、恢复需有「团队奖励规则」和「发起审批」权限。</p>}
        </div>
        {state === "off" && <ActivationChecks ctx={ctx} rows={checks} />}
      </div>
      {(pending || submitted || ctx.f2ActivationPendingError || (policy && !supported)) && <ul className="f2-alerts" aria-label="整体结算的申请">
        {pending && <li><Notice tone="warn" title={<>{a2ActionText(pending.action)}<StatusTag tone="warn" icon={Clock3} explain="等另一位超级管理员在「操作记录与审批」批准；批准前结算状态不变，也不能再提交新的申请。">待审批</StatusTag></>}
          action={canAudit ? <Link className="rd-link" href="/platform/audit">去操作记录与审批查看</Link> : undefined}>
          <p>审批单 <span data-mono>{pending.id}</span>，等另一位超级管理员批准。</p>
        </Notice></li>}
        {!pending && submitted && <li><Notice tone="warn" title="申请已提交，等另一位超级管理员批准"
          action={canAudit ? <Link className="rd-link" href="/platform/audit">去操作记录与审批查看</Link> : undefined}>
          <p>批准前结算状态不变。批准后点页头「刷新」看最新状态。</p>
        </Notice></li>}
        {ctx.f2ActivationPendingError && <li><Notice tone="warn" title="审批进度没读到">{ctx.f2ActivationPendingError === "审批进度没读到" ? canAudit ? "点页头「刷新」重读；读到之前不能提交整体结算的申请。" : "这个账号没有查看审批的权限。" : <>{ctx.f2ActivationPendingError}{canAudit && "点页头「刷新」重读。"}</>}</Notice></li>}
        {policy && !supported && <li><Notice tone="warn" title="暂时只能查看">后台页面和系统版本对不上，刷新后再试；仍不行请联系值班人员。</Notice></li>}
      </ul>}
    </Panel>
  );
}

/** 原申请写成运营看得懂的名字和改动；配置键不上屏。 */
function attemptLabel(attempt: F2Recovery): { name: string; change: string } {
  const slot = attempt.fingerprint, spec = attempt.spec;
  const known = spec.before !== "—" || spec.after !== "—";
  const plain = known ? `${spec.before} → ${spec.after}` : "原请求不完整，只能查询原结果";
  if (slot === F2_ACTIVATION_SLOT) return { name: a2ActionText(spec.action), change: known ? plain : "原请求不完整，只能查询原结果" };
  if (slot === F2_POLICY_SLOT) return { name: "好友奖励政策", change: known ? "按原申请的政策内容" : plain };
  if (slot === F2_BOOTSTRAP_SLOT) {
    // 建单后用审批单上后端写的七层数；还没有审批单时用原请求里运营填的七层。
    const rows = parseF2BootstrapAfter(attempt.ticket?.after ?? spec.after);
    const layers: unknown = attempt.request?.command?.params?.layers;
    const sent = Array.isArray(layers) && layers.length === 7
      ? layers.map((layer) => f4Decimal(String((layer as { usdtPct?: unknown } | null)?.usdtPct ?? "").replace(/[%,]/g, ""))) : [];
    const valid = sent.filter((value): value is string => value !== null && !value.startsWith("-"));
    const rates = rows ? rows.map(row => row.usdtPct) : valid.length === 7 ? valid : null;
    const change = !rates ? "原请求不完整，只能查询原结果"
      : f2BootstrapUsesRank(rates[0], rates[1]) ? "第 1、2 层按受益人等级，区间未知" : `L1–L7 合计占订单 ${num(f2PctSum(rates))}%`;
    return { name: "首次配置七层规则", change };
  }
  const layer = /^f-config:F\.unilevel\.(nex\.)?(L[1-7])$/.exec(slot);
  if (layer) return { name: `${layer[2]} ${layer[1] ? "UVT 系数" : "USDT 比例"}`, change: plain };
  if (slot.startsWith("f-config-batch:")) {
    const pauses = spec.after.split(" / ").flatMap((item) => { const m = /^F\.unilevel\.(L[1-7])\.paused=(\w+)$/.exec(item.trim()); return m ? [`${m[1]} ${m[2] === "on" ? "暂停" : "发放"}`] : []; });
    return { name: "七层逐层暂停", change: pauses.length ? `改为 ${pauses.join("、")}` : "原请求不完整，只能查询原结果" };
  }
  const key = slot.replace(/^f-config:/, "");
  if (key === "F.partner.tiers") return { name: "合作伙伴权益门槛", change: known ? "按原申请的四档门槛" : plain };
  if (key === "F.cooldown") return { name: "购买与其他奖励冷却", change: known ? `${spec.before} → ${spec.after} 天` : plain };
  return { name: F2_HISTORICAL_PARAM_NAMES[key] ?? "团队奖励参数", change: plain };
}

/**
 * 页面最上方的原申请逐条提醒（全站-结果未知叫法）：费率读取失败时也在。只列本人保存的原申请；按钮调用已有的恢复入口。
 */
export function F2RecoveryNotice({ ctx, recovering, setRecovering }: { ctx: FViewCtx; recovering: boolean; setRecovering: (value: boolean) => void }) {
  const [error, setError] = useState<{ query: boolean; text: string } | null>(null);
  // 只让点的那个按钮转圈：查询时别的行和「按原请求重试」只灰着，不显示「正在重试…」。
  const [active, setActive] = useState<string | null>(null);
  // 查过的那一行原地写查到了什么；查到已结束的审批单时记录清掉，改用轻提示。
  const [notes, setNotes] = useState<Record<string, { tone: "warn" | "danger"; text: string }>>({});
  // 和资金页的面板一样默认露三条：刚发出的排最前，再是查询失败和过期的，等批准的放最后。
  const [all, setAll] = useState(false);
  const attempts = ctx.f2Proposals;
  const rank = (attempt: F2Recovery) => notes[attempt.commandKey]?.tone === "danger" ? 0 : attempt.ticket?.status === "pending" ? 2 : attempt.expiresAt <= Date.now() ? 0 : 1;
  const { ordered, box } = useFreshFirst([...attempts].sort((a, b) => rank(a) - rank(b)).map((attempt) => ({ attempt, key: attempt.commandKey, createdAt: attempt.createdAt })));
  if (!attempts.length && !error) return null;
  const canAudit = ctx.can("platform_a2_read");
  async function recover(attempt: F2Recovery, query: boolean) {
    if (recovering || (query ? !attempt.canQuery : !attempt.canRetry)) return;
    setRecovering(true); setError(null); setActive(`${attempt.commandKey}:${query ? "query" : "retry"}`);
    const note = (value?: { tone: "warn" | "danger"; text: string }) => setNotes(({ [attempt.commandKey]: _, ...rest }) => value ? { ...rest, [attempt.commandKey]: value } : rest);
    note();
    try {
      if (!query) { await ctx.retryF2Proposal(attempt.fingerprint); return; }
      const ticket = await ctx.queryF2Proposal(attempt.fingerprint);
      if (!ticket) note({ tone: "warn", text: attempt.expiresAt <= Date.now() ? RETRY_EXPIRED_TEXT : "没查到原审批单。可以稍后再查，或按原请求重试，不会建第二张。" });
      else if (ticket.status === "pending") note({ tone: "warn", text: "审批单已建，在等批准；批准前不生效。" });
      else ctx.toast(fProposalEndText(ticket.status));
    } catch (cause) {
      const text = cause instanceof Error && cause.name.endsWith("OutcomeUncertainError") ? displayAdminError("F2_PROPOSAL_OUTCOME_UNKNOWN") : displayAdminError(cause);
      if (!query) setError({ query, text });
      else note(cause instanceof Error && cause.message === "F2_PROPOSAL_STATUS_UNAVAILABLE" ? { tone: "warn", text: F_PROPOSAL_CREATED_LINE } : { tone: "danger", text: `查询没有成功：${text}` });
    } finally { setRecovering(false); setActive(null); }
  }
  const open = attempts.filter((attempt) => attempt.ticket?.status !== "pending").length;
  return (
    <div ref={box}><Notice tone="warn" title={<>{open ? `有 ${attempts.length} 项原申请还没有结论` : `${attempts.length} 项申请在等批准`}<Explain label="原申请怎么处理" content="原内容和理由保存在这台电脑上。先查询原结果；24 小时内可以按原请求重试，不会建第二张审批单。有结论前不要换个办法重做。" /></>}>
      <ul className="f2-recovery" aria-label="还没有结论的原申请">
        {(all ? ordered : ordered.slice(0, 3)).map(({ attempt }) => {
          const { name, change } = attemptLabel(attempt);
          const expired = attempt.expiresAt <= Date.now();
          return <li key={attempt.commandKey}>
            <span className="f2-recovery-name">{name}</span>
            <span className="f2-recovery-change">{change}{attempt.spec.reason !== "—" && <small title={attempt.spec.reason}>理由：{attempt.spec.reason}</small>}</span>
            <span className="f2-recovery-time">{businessStamp(attempt.createdAt)} 提交</span>
            <span>{attempt.ticket?.status === "pending"
              ? <StatusTag tone="warn" icon={Clock3} explain="等另一位超级管理员在「操作记录与审批」批准；批准前不生效。">待审批</StatusTag>
              : attempt.received ? <StatusTag tone="warn" icon={CircleHelp} explain="原申请建过单，批没批准还没查到。继续查询原结果，不要重新提交。">已建单，未查到</StatusTag>
                : expired ? <StatusTag tone="neutral" icon={Hourglass} explain={RETRY_EXPIRED_TEXT}>已过期</StatusTag>
                  : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。先查询原结果；24 小时内也可以按原请求重试，不会建第二张。">结果未知</StatusTag>}</span>
            <span className="f2-actions">
              {attempt.canQuery && <Button size="sm" loading={active === `${attempt.commandKey}:query`} disabled={recovering} onClick={() => void recover(attempt, true)}>查询原结果</Button>}
              {attempt.canRetry && !expired && <Button size="sm" loading={active === `${attempt.commandKey}:retry`} disabled={recovering} loadingText="正在重试…" onClick={() => void recover(attempt, false)}>按原请求重试</Button>}
              {attempt.canRelease && !attempt.ticket && <FReleaseButton label={name} toast={ctx.toast} onRelease={() => ctx.releaseF2Proposal(attempt.fingerprint)} />}
            </span>
            {expired && notes[attempt.commandKey]?.text !== RETRY_EXPIRED_TEXT && <span className="f2-recovery-line">{RETRY_EXPIRED_TEXT}</span>}
            {notes[attempt.commandKey] && <span className="f2-recovery-line" role="status" data-tone={notes[attempt.commandKey].tone}>{notes[attempt.commandKey].text}</span>}
          </li>;
        })}
      </ul>
      {attempts.length > 3 && <div className="fund-rows-foot"><Button size="sm" variant="ghost" onClick={() => setAll((value) => !value)}>{all ? "只看前 3 条" : `展开全部 ${attempts.length} 条`}</Button></div>}
      <p className="f2-recovery-zone">提交时间为{businessZone().label}{canAudit && <> · <Link className="rd-link" href="/platform/audit">去操作记录与审批核对</Link></>}</p>
      {error && <Notice tone="danger" title="按原请求重试没有成功">{error.text}</Notice>}
    </Notice></div>
  );
}

/** 启用入口和检查列表用同一组读回值。 */
function activationCheckRows(ctx: FViewCtx) {
  const rates = ctx.f2Unilevel;
  const l1 = layerRate(rates, "L1");
  const allUsdt = LAYERS.every(level => rates.some(row => row.l === level && row.usdt !== null && row.usdt >= 0 && row.usdt <= 100));
  const allNex = LAYERS.every(level => rates.some(row => row.l === level && row.nex !== null && row.nex >= 0));
  const unread = ctx.f2Loading ? "七层规则读取中" : ctx.f2Error ? "七层规则没读到" : ctx.f2PurchaseBaseRateSource === null ? "购买奖励比例来源没读到" : null;
  const ranked = f2Ranked(ctx);
  return unread ? [
    { key: "usdt", ok: null, label: "七层 USDT 比例都已配置", seen: unread },
    { key: "nex", ok: null, label: "七层 UVT 系数都已配置", seen: unread },
    ...(ranked ? [] : [{ key: "l1", ok: null, label: "第 1 层比例是 10%", seen: unread }]),
  ] : [
    { key: "usdt", ok: allUsdt, label: "七层 USDT 比例都已配置", seen: allUsdt ? "L1–L7 都有" : LAYERS.filter(level => !rates.some(row => row.l === level && row.usdt !== null && row.usdt >= 0 && row.usdt <= 100)).join("、") },
    { key: "nex", ok: allNex, label: "七层 UVT 系数都已配置", seen: allNex ? "L1–L7 都有" : LAYERS.filter(level => !rates.some(row => row.l === level && row.nex !== null && row.nex >= 0)).join("、") },
    ...(ranked ? [] : [{ key: "l1", ok: !!l1 && l1.usdt === 10, label: "第 1 层比例是 10%", seen: l1 ? `第 1 层是 ${num(l1.usdt)}%` : "没有第 1 层规则" }]),
  ];
}

function ActivationChecks({ ctx, rows }: { ctx: FViewCtx; rows: ReturnType<typeof activationCheckRows> }) {
  const rates = ctx.f2Unilevel;
  const ranked = f2Ranked(ctx);
  return (
    <div className="f2-checks">
      <p className="f2-checks-title">启用时会检查<Explain label={ranked ? "这两条怎么用" : "这三条怎么用"} content={<>
        <p>提交申请和另一位超级管理员批准时都会再查一遍，以那时的数据为准。这里只列现在读到的，不代表一定能启用。</p>
        <p>未配置和配置为 0 分开判断；以提交和批准时系统的检查为准。</p>
        {rates.length === 0 ? <p>七层都没规则时，先在「每层分多少」首次配置。</p>
          : LAYERS.some((level) => !layerRate(rates, level)) && <p>只缺几层时后台补不了，需要技术同事处理。</p>}
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
