"use client";

/**
 * B54 团队平衡奖励的两项发放控制：「自动发放」开关和「全平台封顶比例」。
 * 方向决定怎么生效：关闭、调低确认后立即生效；开启、调高提交审批，另一位超级管理员批准后生效。
 * 设置行和确认框只做样子，提交、查询、重试都调 F 域上下文现成的函数（submitF3PayoutControl、
 * recoverF3PayoutControl、recoverF3），方向用 planF3PayoutControl 判断，和提交时一致。
 */
import { fConfirmRecovery } from "./f-recovery-state";
import { ArrowLeftRight, CalendarClock, CalendarOff, CircleHelp, Clock3, Hourglass } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Change, ConfigRow, Fact, Facts, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import type { FViewCtx } from "./types";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { f3ProposalRecovery, f3ConfigSlot, listF3Proposals, type F3ConfirmationSnapshot } from "@/lib/admin/f3-approval";
import { f3DirectRecovery, pendingF3ConfigWrite } from "@/lib/admin/f3-config-write";
import { consumeFReconfirmation } from "@/lib/admin/f-reconfirmation";
import { F3_AUTO_SETTLE_KEY, F3_PLATFORM_CAP_PCT_KEY, f3PayoutControlAuthority, f3PlatformCapPct, planF3PayoutControl, type F3PayoutControlKey } from "@/lib/admin/f3-policy";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import { isF1OutcomeUncertainError, type FDirectAttempt } from "@/lib/admin/f1-stable-write";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { PERMISSION_DENIED_TEXT } from "@/lib/admin/operation-confirm-error";
import { useAdminAuth } from "@/lib/store/admin-auth";

export const F3_PAYOUT_KEYS: readonly F3PayoutControlKey[] = [F3_AUTO_SETTLE_KEY, F3_PLATFORM_CAP_PCT_KEY];
export const F3_PAYOUT_NAMES: Record<F3PayoutControlKey, string> = { [F3_AUTO_SETTLE_KEY]: "自动发放", [F3_PLATFORM_CAP_PCT_KEY]: "全平台封顶比例" };
const SUPER = "另一位超级管理员";

/** 后端给的百分数文字去掉末尾 0，不舍入：33.333300 → 33.3333%。 */
export const pctText = (raw: string) => `${raw.trim().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}%`;

/** 开关写「开」「关」，封顶写「x%」；认不出的照原文。 */
export function payoutValueText(key: F3PayoutControlKey, raw: string) {
  const value = raw.trim();
  if (key === F3_AUTO_SETTLE_KEY) return value.toLowerCase() === "on" ? "开" : value.toLowerCase() === "off" ? "关" : value || "—";
  const pct = f3PlatformCapPct(value);
  return pct === null ? value || "—" : `${pct}%`;
}

export type F3PayoutOpen = { draft?: FDomainAttempt | FDirectAttempt; key: F3PayoutControlKey; recoveredValue?: string; snapshot?: F3ConfirmationSnapshot; original?: FDomainAttempt; direct?: FDirectAttempt };

const unknownTag = (direct: FDirectAttempt) => isRetryExpired(direct)
  ? <StatusTag tone="neutral" icon={Hourglass} explain="原操作超过 24 小时，不能再重试，只能查询原结果。">已过期</StatusTag>
  : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效。先查询原结果；24 小时内也可以按原内容重试，不会重复执行。">结果未知</StatusTag>;

/** 把框里填的值交给外层，让标题下的生效标签跟着输入变。 */
function TypedSync({ value, onValue }: { value: string | undefined; onValue: (value: string | undefined) => void }) {
  useEffect(() => { onValue(value); }, [value, onValue]);
  return null;
}

/** 恢复列表里一条直接生效的原操作：名字、改成什么、状态。 */
export function payoutDirectLine(direct: FDirectAttempt) {
  const key = direct.f3Request!.key;
  return { name: F3_PAYOUT_NAMES[key], change: `改为 ${payoutValueText(key, direct.f3Request!.value)}`, tag: unknownTag(direct) };
}

/** 「结算设置」里的两行。 */
export function F3PayoutRows({ ctx, snapshot, onOpen }: { ctx: FViewCtx; snapshot?: F3ConfirmationSnapshot; onOpen: (open: F3PayoutOpen) => void }) {
  const cfg = ctx.f3Config;
  const unread = ctx.f3Loading || !!ctx.f3Error || !cfg;
  const row = (key: F3PayoutControlKey) => {
    const auto = key === F3_AUTO_SETTLE_KEY;
    const name = F3_PAYOUT_NAMES[key];
    const allowed = ctx.can(auto ? "network_f3_engine_pause" : "network_f3_match_rate");
    const pending = ctx.getF3PayoutControlPending(key);
    const direct = pending.directWrite;
    // 自己提交、还没确认建单的原申请；已建单在等批准的按待审批显示。
    const original = pending.originalProposal && pending.originalProposal.ticket?.status !== "pending" ? pending.originalProposal : undefined;
    const approval = pending.approval;
    const autoNow = cfg?.autoSettle;
    const capNow = cfg?.platformCapPct;
    const missing = unread || (auto ? autoNow == null : capNow == null);
      const valueTag = missing
      ? <span className="f3-cfg-value" data-empty="">—</span>
      : auto
        ? autoNow ? <StatusTag tone="ok" icon={CalendarClock}>已开启</StatusTag> : <StatusTag tone="neutral" icon={CalendarOff}>已关闭</StatusTag>
        : <span className="f3-cfg-value">{pctText(capNow!)}</span>;
    const pendingTag = direct ? unknownTag(direct)
      : original ? <StatusTag tone="warn" icon={CircleHelp} explain={isRetryExpired(original) ? RETRY_EXPIRED_TEXT : "提交审批时没收到确定结果，可能已经建了审批单。请查询原结果。"}>结果未知</StatusTag>
        : approval ? <StatusTag tone="warn" icon={Clock3}
            explain={`${auto ? "开启" : `调高到 ${payoutValueText(key, approval.after)}`}在等${SUPER}批准；批准前仍按现在的值。${auto ? "" : "现在调低会立即生效，之后这张调高不能再批准。"}`}>待审批</StatusTag>
          : null;
    const dir = missing ? "没读到，暂时不能改"
      : direct ? "先查清原操作再改"
        : original ? "先查清原申请再改"
        : approval ? auto ? "开启在等批准，批准或驳回前不能再提交" : `调高到 ${payoutValueText(key, approval.after)} 在等批准；调低仍立即生效`
        : auto ? autoNow ? "关闭立即生效，手动照常" : `开启要${SUPER}批准` : "调高可能多付钱 · 调低立即生效";
    const disabledReason = missing ? "这一项没读到，重新加载后再改"
      : auto && !autoNow && approval ? "开启已在等审批，批准或驳回前不能再提交" : undefined;
    const action = direct || original
      ? <Button size="sm" onClick={() => onOpen({ key, snapshot, original, direct })}>{direct ? "查看原操作" : "查看原申请"}</Button>
      : allowed ? <Button size="sm" disabledReason={disabledReason}
          onClick={() => onOpen({ key, snapshot })}>{auto && !missing ? autoNow ? "关闭" : "开启" : "调整"}</Button>
        : undefined;
    return auto
      ? <ConfigRow key={key} name={name}
          what="开启时，系统按结算周期自动结算到期的奖励。"
          when={`关闭确认后立即生效；开启要${SUPER}批准后生效。`}
          effect="关闭后仍可手动结算；重新开启不补发关闭期间的周期，要补的手动结算。"
          note="「发放状态」是已暂停时，自动和手动结算都停。"
          value={<span className="f3-cfg"><span className="f3-cfg-line">{valueTag}{pendingTag}</span><span className="f3-cfg-dir">{dir}</span></span>}
          action={action} />
      : <ConfigRow key={key} name={name}
          what="每期全平台发放总额最多是该期已付款订单额乘这个比例。"
          when={`调低确认后立即生效；调高要${SUPER}批准后生效。`}
          effect="还没开始结算的期按新比例；已结过一笔的期，剩下的人沿用原额度。超出时按比例缩减，缩减的不补发，每笔实际缩减见结算记录。"
          note="自动和手动结算共用同一期的额度。范围 0–100%。"
          value={<span className="f3-cfg"><span className="f3-cfg-line">{valueTag}{pendingTag}</span><span className="f3-cfg-dir">{dir}</span></span>}
          action={action} />;
  };
  return <>{F3_PAYOUT_KEYS.map(row)}</>;
}

/** 两项的确认框：新改动、直接生效结果未知的原操作、审批结果未知的原申请，三种共用一个框。 */
export function F3PayoutConfirm({ open, ctx, onClose }: { open: F3PayoutOpen; ctx: FViewCtx; onClose: () => void }) {
  const { key, snapshot, original, direct } = open;
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const mode = direct ? "direct" : original ? "proposal" : "new";
  const auto = key === F3_AUTO_SETTLE_KEY;
  const name = F3_PAYOUT_NAMES[key];
  const cfg = snapshot?.config ?? ctx.f3Config;
  const autoNow = cfg?.autoSettle === true;
  const capNow = cfg?.platformCapPct ?? "";
  const capText = capNow ? pctText(capNow) : "—";
  const { approval, originalProposal } = ctx.getF3PayoutControlPending(key);
  const canPropose = ctx.can("platform_a2_write") || ctx.can("platform_a2_proposal_create");
  const savedDirect = () => adminId === undefined ? undefined : pendingF3ConfigWrite(adminId, key);
  const savedProposal = () => adminId === undefined ? undefined : listF3Proposals(adminId).find((row) => row.fingerprint === f3ConfigSlot(key));
  // 新改动打开时已有的原记录（比如在等批准的调高）不算这次的，不让框锁成「按原请求重试」。
  const [existing] = useState(() => ({ direct: savedDirect()?.commandKey, proposal: savedProposal()?.commandKey }));
  const ownDirect = () => {
    const row = savedDirect();
    return row && (mode === "direct" ? row.commandKey === direct?.commandKey : mode === "new" && row.commandKey !== existing.direct) ? row : undefined;
  };
  const ownProposal = () => {
    const row = savedProposal();
    return row && (mode === "proposal" ? row.commandKey === original?.commandKey : mode === "new" && row.commandKey !== existing.proposal) ? row : undefined;
  };
  const direction = (value?: string) => {
    if (auto) return mode === "new" ? autoNow ? "direct" : "proposal" : undefined;
    const next = value === undefined ? null : f3PlatformCapPct(value);
    return next === null || !cfg || cfg.platformCapPct == null || mode !== "new" ? undefined : planF3PayoutControl(key, next, cfg).direction;
  };
  const originalValue = direct?.f3Request?.value ?? original?.spec?.after ?? "";
  const expired = direct ? isRetryExpired(direct) : !!original && isRetryExpired(original);
  const queryOnly = !!original && !!f3ProposalRecovery.state(original).replayBlock;
  const canWriteProposal = canPropose && ctx.can(f3PayoutControlAuthority(key));
  const recoveryText = direct
    ? expired ? "超过 24 小时，只能查询原结果" : "可能已经生效；先查询原结果"
    : original?.ticket?.status === "pending" ? `审批单在等${SUPER}批准；批准前不生效`
      : expired ? "超过 24 小时，只能查询原审批单"
        : queryOnly && !canWriteProposal ? PERMISSION_DENIED_TEXT
          : original?.received ? "原申请建过单，批没批准还没查到，请继续查询"
            : "可能已经建了审批单；先查询原结果";
  // 框里填的原样值：被挡下的调高也要写在事实里、按钮写「提交审批」。amplifiesWhen 每次渲染都拿到原值，先于事实和按钮。
  const rawTyped = useRef<string | undefined>(undefined);
  const [typed, setTyped] = useState<string>();
  const typedCap = (value?: string) => {
    const raw = value ?? rawTyped.current;
    return raw !== undefined && f3PlatformCapPct(raw) !== null ? raw : undefined;
  };
  const blockedRaise = !!approval || !!originalProposal;

  const title = mode === "direct" ? `${name}的原操作` : mode === "proposal" ? `${name}的原申请`
    : auto ? autoNow ? "关闭自动发放" : "开启自动发放" : "调整全平台封顶比例";
  const approveTag = <StatusTag tone="progress" filled explain={`${SUPER}在「操作记录与审批」批准后生效，你自己不能批；批准时查兑付覆盖率。`}>批准后生效</StatusTag>;
  const typedDir = direction(typed);
  const effect = mode !== "new"
    ? direct ? unknownTag(direct) : <StatusTag tone="warn" icon={CircleHelp}>{original?.ticket?.status === "pending" ? "待审批" : expired ? "已过期" : "结果未知"}</StatusTag>
    : auto
      ? autoNow ? <StatusTag tone="progress" filled>立即生效</StatusTag> : approveTag
      : typedDir === "proposal" ? approveTag
        : typedDir === "direct" ? <StatusTag tone="progress" filled>立即生效</StatusTag>
          : <StatusTag tone="neutral" icon={ArrowLeftRight} explain={<>
              <p>调高会让平台多付钱：提交审批，{SUPER}在「操作记录与审批」批准后生效，你自己不能批。</p>
              <p>调低确认后立即生效。</p>
            </>}>调高要批准 · 调低立即生效</StatusTag>;

  const facts = (value?: string) => {
    if (mode !== "new") return <Facts>
      <Fact k={mode === "direct" ? "原操作" : "原申请"}>{mode === "proposal" && original?.spec
        ? <Change from={payoutValueText(key, original.spec.before)} to={payoutValueText(key, original.spec.after)} />
        : `改为 ${payoutValueText(key, originalValue)}`}</Fact>
      <Fact k="现在">{recoveryText}</Fact>
    </Facts>;
    if (auto) return <Facts>
      <Fact k="自动发放"><Change from={autoNow ? "开" : "关"} to={autoNow ? "关" : "开"} /></Fact>
      {autoNow ? <>
        {approval && <Fact k="已有待批" tone="warn">这次收紧会让待批的放宽单失效。</Fact>}
        <Fact k="正在结算的这批">没结到的人也停下；已发的不收回</Fact>
        <Fact k="重新开启">要{SUPER}批准；关闭期间的周期不补发</Fact>
      </> : <>
        <Fact k="批准前">仍是关闭</Fact>
        <Fact k="关闭期间的周期">不补发，要补的手动结算</Fact>
        <Fact k="更早没结完的期">只影响有这种期的邀请人：手动补结后才自动结算</Fact>
        {!canPropose && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，提交会被拦下</Fact>}
      </>}
    </Facts>;
    const shownValue = typedCap(value);
    const dir = direction(shownValue);
    const next = shownValue === undefined ? null : f3PlatformCapPct(shownValue);
    return <>
      <TypedSync value={shownValue} onValue={setTyped} />
      <Facts>
        <Fact k="全平台封顶比例">{next === null || dir === undefined || dir === "unchanged" ? capText : <Change from={capText} to={`${next}%`} />}</Fact>
        {dir === "proposal" && !blockedRaise && <Fact k="批准前">仍按 {capText}</Fact>}
        {approval && <Fact k="已有待批" tone="warn">调高到 {payoutValueText(key, approval.after)} 在等批准。{dir === "direct" ? "这次收紧会让待批的放宽单失效。" : "同方向调高需等待这张单处理。"}</Fact>}
        {dir === "proposal" && !blockedRaise && !canPropose && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，调高会被拦下</Fact>}
        <Fact k="已开始结算的期">剩下的人沿用原额度</Fact>
      </Facts>
    </>;
  };

  return (
    <OperationConfirmModal
      briefKind="config"
      action={mode === "new" ? title : auto ? (originalValue.trim().toLowerCase() === "on" ? "开启自动发放" : "关闭自动发放") : "调整全平台封顶比例"}
      title={title}
      detail={auto ? "自动发放：系统按结算周期自动结算到期的团队平衡奖励。" : "全平台封顶：每期全平台发放最多是该期已付款订单额乘这个比例，自动和手动结算共用。"}
      effect={effect}
      facts={facts}
      statedBrief={auto
        ? (mode === "new" ? autoNow : originalValue.trim().toLowerCase() !== "on")
          ? { impact: "系统停止自动结算，手动结算照常可用。", check: "确认已安排手动结算，或确实要停掉自动部分。" }
          : { impact: "批准后系统按结算周期自动结算到期的奖励。", check: "开启前确认关闭期间要补的周期已手动结算或另有安排。" }
        : { impact: "还没开始结算的期按新比例封顶，已记账的不重算。", check: "核对新比例；调高可能多付钱，先看兑付覆盖率。" }}
      amplifies={mode === "new" && auto && !autoNow}
      coverage={snapshot?.coverage ?? ctx.f3Coverage}
      coverageLead={auto ? `开启后系统按周期自动发钱，要${SUPER}批准` : `调高封顶会让平台多付钱，要${SUPER}批准`}
      coverageCheck="批准时查兑付覆盖率，读不到或低于红线就不能批准。"
      confirmLabel={auto ? autoNow ? "立即生效" : "提交审批" : "立即生效"}
      confirmLabelForValue={auto ? undefined : (value) => direction(typedCap(value)) === "proposal" ? "提交审批" : "立即生效"}
      edit={auto ? undefined : {
        kind: "number", label: "改后的封顶比例", current: mode === "new" ? capNow : undefined, unit: "%", min: 0, max: 100, maxDecimals: 10, ignoreTrailingDecimalZeros: true,
        initialValue: (mode === "new" ? open.recoveredValue : originalValue)?.replace(/%$/, "").trim(),
        disallowCurrent: true, hint: "0–100，最多 10 位小数",
        // 只有能提交的调高才提示多付钱；已有调高在等或原申请未知时调高被挡下，不提示。
        amplifiesWhen: (value) => { rawTyped.current = value; return mode === "new" && !blockedRaise && direction(value) === "proposal"; },
        validate: (value) => f3PlatformCapPct(value) === null ? "填 0 到 100 的数，最多 10 位小数"
          : direction(value) !== "proposal" ? undefined
            : approval ? "已有调高在等审批，批准或驳回前只能调低"
              : originalProposal ? "原申请结果未知，请先查询原结果" : undefined,
      }}
      initialReason={direct?.f3Request?.reason ?? original?.spec?.reason}
      getPendingReason={() => ownDirect()?.f3Request?.reason ?? ownProposal()?.spec?.reason}
      getPendingRecovery={() => {
        const direct = ownDirect();
        if (direct) return fConfirmRecovery(f3DirectRecovery, direct, async () => {
          const reply = await ctx.recoverF3PayoutControl(key, "query");
          if (reply.kind !== "query") return;
          if (reply.result === "SUCCEEDED") { ctx.toast(`${name}的原操作已生效`); onClose(); }
          else if (reply.result === "REJECTED" || reply.result === "NOT_EXECUTED") {
            ctx.toast("原操作未执行，已保留草稿。");
            onClose();
          }
        });
        const proposal = ownProposal();
        return proposal && fConfirmRecovery(f3ProposalRecovery, proposal, async () => {
          const ticket = await ctx.recoverF3(proposal);
          if (!ticket) return;
          onClose();
        });
      }}
      onClose={onClose}
      onConfirm={async (reason, newValue) => {
        if (ownDirect()) { await ctx.recoverF3PayoutControl(key, "retry"); onClose(); return; }
        const ticket = ownProposal();
        if (ticket) { await ctx.recoverF3(ticket, "retry"); onClose(); return; }
        if (mode !== "new") throw new Error("PENDING_REPLAY_BLOCKED");
        const value = auto ? open.recoveredValue ?? (autoNow ? "off" : "on") : newValue ?? "";
        const result = await ctx.submitF3PayoutControl(key, value, reason, snapshot).catch((error: unknown) => {
          // 直接生效的结果未知：这页有自己的查询和重试，提示指向框里的按钮，不指去操作记录与审批。
          if (isF1OutcomeUncertainError(error)) Object.assign(error, { confirmCopy: "结果未知，可能已经生效。先点「查询原结果」核对。" });
          else if (isA2OutcomeUncertainError(error)) Object.assign(error, { confirmCopy: "结果未知，可能已建审批单。先点「查询原结果」；关框后在页面上方原操作列表也能查询。" });
          throw error;
        });
        if (open.draft) consumeFReconfirmation(open.draft);
        ctx.toast(result.kind === "unchanged" ? "和现在一样，没有提交"
          : result.kind === "direct" ? auto ? "自动发放已关闭，立即生效" : `全平台封顶比例已改为 ${payoutValueText(key, value)}，立即生效`
            : auto ? "开启自动发放已提交审批，批准前仍是关闭" : `调高全平台封顶比例已提交审批，批准前仍按 ${capText}`);
        onClose();
      }}
    />
  );
}
