"use client";

/**
 * F1 全页的原操作恢复区：等级读取中、读取失败、还没建等级时也显示。
 * 三种原记录都只从本机保存的原内容拼：普通申请（ctx.f1Proposals）、门槛和奖励的修改（listF1PolicyOperations）、App 等级说明的保存（pendingF1RankHow）。
 * 按钮只调用已备好的恢复函数：查询只读，按原请求重试先开一个确认框，过期并且后端明确没有这张审批单时才给「解除待确认」。
 */
import { useState, type ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass, RotateCcw } from "lucide-react";
import { Button, Change, Decision, Fact, Facts, KeepText, Modal, Notice, StatusTag } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { f1ProposalAuthority } from "@/lib/admin/f1-approval";
import { f1ConditionLabels, formatF1ExactAmount, isF1PolicyInFlight, listF1PolicyOperations, queryF1PolicyOperation, releaseF1PolicyProposal, type F1PolicyEditor, type F1PolicyReward } from "@/lib/admin/f1-policy-change";
import { isF1RankHowInFlight, pendingF1RankHow, queryF1RankHow } from "@/lib/admin/f1-rank-how-save";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import { f1RewardPolicyLabel } from "./f1-policy-confirm";
import { FReleaseButton } from "./f-release";
import type { FViewCtx } from "./types";

type State = "unknown" | "received" | "pending" | "expired";
type Row = { key: string; name: string; change: ReactNode; submittedAt?: number; state: State; direct?: boolean; actions: ReactNode };

/** 等级说明所在页签的名字，和 f1-vrank 的页签一致。 */
const HOW_TAB = "App 等级说明";
const UNIT: Record<string, string> = { selfBuy: " 点", teamGv: " 点", directRefs: " 人", legCount: " 个", legRank: "" };
const thresholdText = (field: string, raw: string | undefined) => raw === undefined || raw === "" ? "—" : raw === "NONE" ? "未设置" : `${formatF1ExactAmount(raw)}${UNIT[field] ?? ""}`;

function stateTag(state: State, direct: boolean) {
  if (state === "pending") return <StatusTag tone="progress" icon={Clock3} explain="在「操作记录与审批」等批准；批准前不生效。">待审批</StatusTag>;
  if (state === "received") return <StatusTag tone="warn" icon={CircleHelp} explain="原申请建过单，批没批准还没查到。继续查询原结果，不要重新提交。">已建单，未查到</StatusTag>;
  if (state === "expired") return <StatusTag tone="neutral" icon={Hourglass} explain={direct
    ? "原请求超过 24 小时，不能再重试。查询只读回当前内容，证明不了原操作有没有执行，到「操作记录与审批」核对。"
    : "原请求超过 24 小时，不能再重试，只能查询原审批单。查询明确没有这张单时，可以解除待确认。"}>已过期</StatusTag>;
  return <StatusTag tone="warn" icon={CircleHelp} explain={direct
    ? "提交时没收到确定结果，可能已经保存。先查询原结果；有结论前不要换个办法重做。"
    : "提交时没收到确定结果，可能已经建了审批单。先查询原结果；24 小时内也可以按原请求重试，不会建第二张。"}>结果未知</StatusTag>;
}

/** 普通申请写成运营看得懂的名字和改动；配置键、原始 JSON 不上屏。 */
function ordinaryLabel(original: FDomainAttempt): { name: string; change: ReactNode } {
  const slot = original.fingerprint;
  const spec = original.spec;
  const id = slot.slice(slot.indexOf(":") + 1);
  if (slot === "f-config:F.vrank.permanent") return { name: "不降级保护", change: spec ? `改为${spec.after === "on" ? "开启" : spec.after === "off" ? "关闭" : spec.after}` : "原请求不完整，只能查询原结果" };
  if (slot === "f-config:F.prize.name") return { name: "奖品名称", change: spec ? `改为「${spec.after}」` : "原请求不完整，只能查询原结果" };
  if (slot === "f-config:F.vrank.titles") {
    let count = 0;
    try { count = Object.keys(JSON.parse(spec?.after ?? "{}") as object).length; } catch { /* 坏的原内容只显示不完整 */ }
    return { name: "各级头衔", change: spec && count ? `设置 ${count} 级头衔` : "原请求不完整，只能查询原结果" };
  }
  if (slot.startsWith("f-vrank-override:")) return { name: `人工调整等级 · 用户 ${id}`, change: spec ? `${spec.amplifies ? "升级" : "降级"}到 ${spec.after}` : "原请求不完整，只能查询原结果" };
  if (slot.startsWith("f-payout-action:")) {
    const reissue = spec ? spec.after === "REISSUED" : undefined;
    return { name: `${reissue === undefined ? "处理奖励" : reissue ? "重发奖励" : "冲正奖励"} · 发放单 ${id}`, change: reissue === undefined ? "原请求不完整，只能查询原结果" : <Change from={reissue ? "已冲正" : "现在的状态"} to={reissue ? "已重发" : "已冲正"} /> };
  }
  if (slot.startsWith("f-vrank-bootstrap:")) return { name: "首次配置九级", change: spec ? <Change from="还没有会员等级" to="九级门槛" /> : "原请求不完整，只能查询原结果" };
  return { name: "等级设置的原申请", change: "原请求不完整，只能查询原结果" };
}

function rewardLabel(reward: F1PolicyReward | undefined, ctx: FViewCtx) {
  if (!reward) return "奖励";
  return f1RewardPolicyLabel({ id: "", type: reward.type, amountText: reward.amount, voucherId: reward.voucherId, skuId: reward.skuId, custom: reward.custom }, ctx);
}

export function F1RecoveryNotice({ ctx, onOpenPolicy, onRankHowChecked }: { ctx: FViewCtx; onOpenPolicy: (editor: F1PolicyEditor) => void; onRankHowChecked: () => void }) {
  const session = useAdminAuth((state) => state.session);
  const [retrying, setRetrying] = useState<{ original: FDomainAttempt; name: string; change: ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  if (!session) return null;
  const owner = session.adminId;
  const toast = ctx.toast;
  const rows: Row[] = [];

  for (const original of ctx.f1Proposals) {
    const { name, change } = ordinaryLabel(original);
    const expired = isRetryExpired(original);
    const state: State = original.ticket?.status === "pending" ? "pending" : original.received ? "received" : expired ? "expired" : "unknown";
    const canRetry = !!original.spec && !!original.request && !original.received && !original.ticket && !expired;
    const retryBlock = original.spec && !(session.authorities.includes(f1ProposalAuthority(original.spec))
      && session.authorities.some((a) => a === "platform_a2_write" || a === "platform_a2_proposal_create")) ? "当前账号没有重发这项原申请的权限，仍可查询原结果。" : undefined;
    rows.push({
      key: original.commandKey, name, change, submittedAt: original.createdAt, state,
      actions: <>
        <Button size="sm" onClick={() => void ctx.recoverF1(original.fingerprint, "query").catch((error) => toast(displayAdminError(error)))}>查询原结果</Button>
        {canRetry && <Button size="sm" disabledReason={retryBlock} onClick={() => { setRetryError(null); setRetrying({ original, name, change }); }}>按原请求重试</Button>}
        {expired && original.absent && !original.ticket && <FReleaseButton label={name} toast={toast} onRelease={() => ctx.recoverF1(original.fingerprint, "release")} />}
      </>,
    });
  }

  let policyBroken = false;
  try {
    for (const record of listF1PolicyOperations(owner)) {
      if (isF1PolicyInFlight(record.commandKey)) continue;
      const { editor, form, values, approval } = record.original;
      const field = editor.field;
      const name = `${editor.row.v} · ${editor.action === "threshold" ? f1ConditionLabels[field!] : editor.action === "reward_add" ? "添加奖励" : editor.action === "reward_remove" ? "移除奖励" : "编辑奖励"}`;
      const oldReward = editor.reward ? f1RewardPolicyLabel(editor.reward, ctx) : "奖励";
      const change: ReactNode = editor.action === "threshold" ? <Change from={thresholdText(field!, editor.row[field!])} to={thresholdText(field!, form.value?.trim())} />
        : editor.action === "reward_add" ? `添加 ${rewardLabel(values.reward, ctx)}`
          : editor.action === "reward_remove" ? `移除 ${oldReward}`
            : <Change from={oldReward} to={rewardLabel(values.reward, ctx)} />;
      const expired = record.expiresAt <= Date.now();
      const state: State = record.ticket?.status === "pending" ? "pending" : approval && record.received ? "received" : expired ? "expired" : "unknown";
      rows.push({
        key: record.commandKey, name, change, submittedAt: record.createdAt, state, direct: !approval,
        actions: <>
          {record.ticket
            ? <Button size="sm" onClick={() => void queryF1PolicyOperation(owner, record.commandKey).then((result) => {
              if (result) toast(result.acknowledgement);
              if (result?.active) ctx.acceptF1PolicyOverview(result.active); else void ctx.refreshF1();
            }, (error) => toast(displayAdminError(error)))}>查询原结果</Button>
            : <Button size="sm" onClick={() => onOpenPolicy({ ...editor, recoveryCommandKey: record.commandKey })}>查看原操作</Button>}
          {approval && expired && record.absent && !record.ticket && <FReleaseButton label={name} toast={toast}
            onRelease={async () => { await releaseF1PolicyProposal(owner, record.commandKey); await ctx.refreshF1(); }} />}
        </>,
      });
    }
  } catch { policyBroken = true; }

  const howSave = pendingF1RankHow(owner);
  if (howSave && !isF1RankHowInFlight(owner)) rows.push({
    key: howSave.commandKey, name: `App 等级说明 · ${howSave.document.status === "PUBLISHED" ? "保存并发布" : "保存草稿"}`,
    // 1024 下这格窄：版本号和「· N 种语言」各自整段换行，不留两个字的孤行。
    change: <KeepText text={`版本号 ${howSave.document.version || "—"} · ${Object.keys(howSave.document.locales).length} 种语言`} phrases={[`版本号 ${howSave.document.version || "—"}`, `· ${Object.keys(howSave.document.locales).length} 种语言`]} />,
    submittedAt: howSave.createdAt, state: "unknown", direct: true,
    actions: <Button size="sm" onClick={() => void queryF1RankHow(owner).then((result) => {
      toast(result.matched ? "已核对：现在的等级说明就是原提交的内容" : `和原提交对不上，保存结果仍未知；到「${HOW_TAB}」核对后可以解除`);
      onRankHowChecked();
    }, (error) => toast(displayAdminError(error)))}>重新读取核对</Button>,
  });

  if (!rows.length && !policyBroken) return null;
  const open = rows.filter((row) => row.state !== "pending").length;
  const retry = async () => {
    if (!retrying) return;
    setBusy(true); setRetryError(null);
    try { await ctx.recoverF1(retrying.original.fingerprint, "retry"); setRetrying(null); }
    catch (error) { setRetryError(displayAdminError(error)); }
    finally { setBusy(false); }
  };
  return <>
    <div className="f1-recovery-wrap"><Notice tone={open ? "warn" : "progress"} title={open ? `逐条核对原操作（${rows.length} 项）` : `等批准的申请（${rows.length} 项）`}>
      {policyBroken && <p>有一条门槛或奖励的原操作内容不完整，请到「操作记录与审批」核对。</p>}
      {rows.length > 0 && <ul className="f1-recovery" aria-label="还没有结论的原操作">
        {rows.map((row) => <li key={row.key} data-recovery-state={row.state}>
          <span className="f1-recovery-name">{row.name}</span>
          <span className="f1-recovery-change">{row.change}</span>
          <span className="f1-recovery-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
          <span>{stateTag(row.state, !!row.direct)}</span>
          <span className="f1-recovery-actions">{row.actions}</span>
        </li>)}
      </ul>}
      {rows.some((row) => row.submittedAt !== undefined) && <p className="f1-recovery-zone">提交时间为{businessZone().label}</p>}
    </Notice></div>
    {retrying && <Modal title="按原请求重试" icon={RotateCcw} busy={busy} onClose={() => setRetrying(null)}
      footer={<Decision others={<Button disabled={busy} onClick={() => setRetrying(null)}>返回</Button>}
        primary={<Button variant="primary" loading={busy} onClick={() => void retry()}>按原请求重试</Button>} />}>
      <div className="rd-stack">
        <Facts>
          <Fact k="原操作">{retrying.name}</Fact>
          <Fact k="改动">{retrying.change}</Fact>
          <Fact k="理由">{retrying.original.request?.reason ?? "—"}</Fact>
          <Fact k="提交时间">{businessStamp(retrying.original.createdAt)}（{businessZone().label}）</Fact>
        </Facts>
        <p>用原内容和原理由再提交一次，不能改；后端认得出是同一次提交，不会建第二张审批单。</p>
        {retryError && <Notice tone="danger" title="重试没有成功">{retryError}</Notice>}
      </div>
    </Modal>}
  </>;
}
