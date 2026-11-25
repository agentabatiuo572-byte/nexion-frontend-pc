"use client";

/**
 * F1 等级权益三项（好友购买奖励一级、二级比例，月薪）的修改框（画板 B1、B2、B4）。
 * 样子照门槛修改框 F1PolicyConfirm：标题写动作和对象，标题下的生效标签跟填的方向变，影响一句，相邻等级和人数，
 * 放大方向才出覆盖率提示，「现在 → 改后」，理由。
 */
import { fConfirmRecovery } from "./f-recovery-state";
import { useState } from "react";
import { CircleHelp, Clock3, Lock, LockOpen, Zap } from "lucide-react";
import { Change, DiffField, Fact, Facts, NumberInput, StatusTag } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { amountDisplay } from "@/lib/format";
import { OperationConfirmModal, type BusinessFormValue } from "../design-kit";
import type { FViewCtx } from "./types";
import { SUPER_APPROVER } from "./f1-shared";
import type { F1VRankRow } from "@/lib/admin/f1-client";
import { fetchF1VRankOverview } from "@/lib/admin/f1-client";
import { compareDecimal, ratePct, F1_BENEFIT_NAMES as NAME, f1BenefitInputError as inputError, type F1BenefitField } from "@/lib/admin/f1-rank-benefit";
import { canRetryF1PolicyProposal, f1PolicyRecovery, pendingF1Policy, type F1PolicyDraft, type F1PolicyEditor } from "@/lib/admin/f1-policy-change";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { A2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { F1_PROPOSAL_LOOKUP_FIRST } from "@/lib/admin/f1-approval";
import { h4ReadConflict } from "../h-tabs/h4-legacy-parts";

/** 现在的值，按填写的单位：比例是百分数，月薪是 USDT。 */
export function benefitValue(row: F1VRankRow, field: F1BenefitField): string | undefined {
  return field === "monthlySalaryUsdt" ? row.monthlySalaryUsdt?.trim() || undefined : ratePct(row[field]);
}

const isRate = (field: F1BenefitField) => field !== "monthlySalaryUsdt";
const unitOf = (field: F1BenefitField) => isRate(field) ? "%" : "USDT";
const shown = (field: F1BenefitField, value: string) => isRate(field) ? `${value}%` : `${amountDisplay(value)} USDT`;

export function F1BenefitConfirm({ editor: requested, field, ctx, onPendingChange, onClose, draft }: {
  editor: F1PolicyEditor; field: F1BenefitField; ctx: FViewCtx; draft?: F1PolicyDraft; onPendingChange: () => void; onClose: () => void;
}) {
  const session = useAdminAuth((state) => state.session);
  const [owner] = useState(session?.adminId);
  const [baseline, setBaseline] = useState(requested);
  const [revision, setRevision] = useState(0);
  const pending = () => owner === undefined ? undefined : pendingF1Policy(owner, baseline);
  const [original, setOriginal] = useState(pending);
  const canWrite = session?.adminId === owner && !!session?.authorities.includes("network_f1_write");
  const proposalQueryOnly = !!original?.original.approval && (!canWrite || !canRetryF1PolicyProposal(original));
  const editor = original ? { ...original.original.editor, recoveryCommandKey: original.commandKey } : baseline;
  const row = editor.row;
  const rows = ctx.vrankRows;
  const index = rows.findIndex((item) => item.v === row.v);
  const current = benefitValue(row, field) ?? "";
  const name = NAME[field];
  const direction = (value: string) => {
    const text = value.trim();
    if (!text || inputError(field, text)) return undefined;
    return compareDecimal(text, current);
  };
  const neighbor = (offset: number) => {
    const item = rows[index + offset];
    const value = item ? benefitValue(item, field) : undefined;
    return item && value !== undefined ? `${item.v} ${field === "monthlySalaryUsdt" && Number(value) === 0 ? "不发" : shown(field, value)}` : undefined;
  };
  const neighbors = [neighbor(-1), neighbor(1)].filter(Boolean).join(" · ");
  const prevSalary = field === "monthlySalaryUsdt" && index > 0 ? benefitValue(rows[index - 1], field) : undefined;

  const effect = (values: BusinessFormValue) => {
    if (original) return <StatusTag tone="warn" icon={CircleHelp} explain={original.original.approval
      ? proposalQueryOnly ? F1_PROPOSAL_LOOKUP_FIRST : "没查到原审批单，可以按原内容和理由重试。"
      : "提交时没收到确定结果，可能已经生效。可以查询原操作；24 小时内也可以按原操作重试，不会重复执行。"}>结果未知</StatusTag>;
    const up = direction(values.value ?? "");
    if (up === 1) return <StatusTag tone="progress" filled icon={Clock3}>批准后生效</StatusTag>;
    if (up === -1) return <StatusTag tone="progress" filled icon={Zap}>立即生效</StatusTag>;
    return <StatusTag tone="neutral" icon={LockOpen} explain={`调高是增加资金：提交审批，${SUPER_APPROVER}（需有审批批准权限）批准后才生效，你自己不能批。调低确认后立即生效。`}>调高要批准 · 调低立即生效</StatusTag>;
  };
  const impact = (values: BusinessFormValue) => {
    const up = direction(values.value ?? "") === 1;
    if (isRate(field)) return up
      ? `${SUPER_APPROVER}批准后，之后才算奖励的订单按新比例；批准前仍按 ${shown(field, current)}，已经算好的不变。`
      : "确认后，之后才算奖励的订单按新比例；已经算好的不变。";
    return up
      ? `${SUPER_APPROVER}批准后，之后本月首次升到 ${row.v}（且是本月最高等级）、还没领的人按新金额锁定；已经锁定的按锁定时的金额，下个月起全部 ${row.v} 按新金额。`
      : `确认后，之后本月首次升到 ${row.v}（且是本月最高等级）、还没领的人按新金额锁定；已经锁定的按锁定时的金额，下个月起全部 ${row.v} 按新金额。`;
  };
  const note = (value: string) => {
    const text = value.trim();
    if (direction(text) === undefined || direction(text) === 0) return undefined;
    if (isRate(field)) {
      const per100 = text.replace(/^0+(?=\d)/, "");
      return `改成 ${text}%：${field === "purchaseL1Rate" ? "一级好友" : "二级好友（好友的好友）"}每付款 100 USDT 买设备，${row.v} 用户按基础比例算的奖励从 ${current} 变成 ${per100} USDT 等值；实际发多少还看结算时的暂停、拆分和上限。`;
    }
    if (Number(text) === 0) return `改成 0：之后本月首次升到 ${row.v}（且是本月最高等级）、还没领的人，次日起按 ${row.v} 的 0 算，领不了（月末最后一天升到的，下月 1 日也不能补领）；先前已按本级金额锁定的人不受影响。`;
    if (prevSalary !== undefined && compareDecimal(text, prevSalary) === -1) {
      return `改成 ${amountDisplay(text)}：比 ${rows[index - 1].v} 的 ${amountDisplay(prevSalary)} 还低。之后本月首次从 ${rows[index - 1].v} 升到 ${row.v}（且是本月最高等级）、还没领的人，次日起按 ${amountDisplay(text)} USDT 领（月末最后一天升到的，下月 1 日补领也按这个）；先前已按本级金额锁定的人不受影响。`;
    }
    return undefined;
  };
  const facts = (_value?: string, values?: BusinessFormValue) => {
    const next = values?.value ?? "";
    const opened = benefitValue(requested.row, field);
    return <Facts>
      {revision > 0 && opened && direction(opened) !== 0 && <Fact k="刚被改过"><Change from={shown(field, opened)} to={shown(field, current)} /></Fact>}
      {neighbors && <Fact k="相邻等级">{neighbors}</Fact>}
      <Fact k="这一级人数">{row.v} {row.pop.toLocaleString("en-US")} 人</Fact>
      {field === "monthlySalaryUsdt" && direction(next) === -1 && <Fact k="能否改回" tone="warn">
        改回 {amountDisplay(current)} 要{SUPER_APPROVER}批准；在那之前按 {amountDisplay(next.trim())} 锁定的，改回后也不补差
      </Fact>}
    </Facts>;
  };
  const disabledReason = !canWrite
    ? "当前账号没有这项操作的权限，请关闭弹窗后重新核对。"
    : !original && (ctx.f1Loading || ctx.f1Error || !current || !row.policyRevision) ? "请先成功重新读取会员等级。"
    : !original && ctx.f1ApprovalRanks.includes(row.v) ? "等审批结果：批准、驳回或撤回后再改" : undefined;

  const submit = async (mode: "submit" | "lookup" | "retry-original", value = "", reason = "") => {
    const sent = original ?? pending();
    let result;
    try {
      result = await ctx.submitVRankBenefit(editor, value, reason, mode, draft?.record.commandKey);
    } catch (error) {
      const saved = pending();
      setOriginal(saved);
      const failure = error as { httpStatus?: number; apiCode?: number; backendMessage?: string };
      const code = failure.backendMessage;
      if (!saved && isDeterministicRejection(failure.httpStatus ?? 0, failure.apiCode)) {
        if (code === "OBJECT_ALREADY_PENDING" || code === "OBJECT_LOCKED_BY_A2") {
          await ctx.refreshF1Approvals();
          throw new Error("没有保存：这一级有申请在等审批，批准、驳回或撤回后再改。");
        }
        if (code === "VRANK_POLICY_VERSION_CONFLICT" || code === "A2_CONFIRMATION_REQUIRED" || code === "VRANK_POLICY_REVISION_REQUIRED") {
          throw h4ReadConflict(async () => {
            const active = await fetchF1VRankOverview();
            const latest = active.rows.find(item => item.v === row.v);
            if (!latest?.policyRevision || benefitValue(latest, field) === undefined) throw new Error("请先成功重新读取会员等级。");
            setBaseline({ ...requested, row: latest });
            setRevision(current => current + 1);
            ctx.acceptF1PolicyOverview(active);
            return true;
          });
        }
      }
      throw error;
    } finally {
      setOriginal(pending());
      onPendingChange();
    }
    if (!result) return false;
    if (!result.resolved) throw new A2OutcomeUncertainError(result.acknowledgement, sent!.commandKey);
    if (result.active) ctx.acceptF1PolicyOverview(result.active);
    else ctx.invalidateF1(`${result.acknowledgement}；当前配置暂时读不到，重新读取后再发起新修改。`);
    if ("restoreDraft" in result && result.restoreDraft) {
      ctx.toast(result.acknowledgement);
      onClose();
      return true;
    }
    if (mode === "submit") {
      const active = result.active?.rows.find(item => item.v === row.v);
      const saved = active && benefitValue(active, field);
      ctx.toast(direction(value) === 1 ? "已提交，等待审批后执行"
        : saved === undefined ? result.acknowledgement : `${row.v} ${name}已改为 ${shown(field, saved)}，立即生效`);
    } else ctx.toast(result.acknowledgement);
    onClose();
    return true;
  };

  return <OperationConfirmModal
    icon="sliders"
    briefKind={(values) => direction(values.value ?? "") === 1 ? "funds" : "config"}
    action={`调整 ${row.v} 等级权益 · ${name}`}
    title={`调整 ${row.v} 的${name.replace(/^好友购买奖励 · (.)级$/, "$1级好友购买奖励比例")}`}
    effect={effect}
    facts={facts}
    statedBrief={(values) => ({ impact: impact(values), check: "核对新值和相邻等级；理由写清依据或工单号。" })}
    confirmLabel="确认修改"
    confirmLabelForValue={(_value, values) => direction(values?.value ?? "") === 1 ? "提交审批" : "确认修改"}
    detail={`当前${name}为 ${shown(field, current)}。`}
    coverage={ctx.f1BenefitCoverage}
    getPendingReason={() => pending()?.original.reason}
    getPendingBusinessValue={() => pending()?.original.form ?? draft?.form}
    getPendingRecovery={() => { const record = pending(); return record && fConfirmRecovery(f1PolicyRecovery, record, () => submit("lookup")); }}
    businessFormRevision={revision}
    coverageLead={isRate(field) ? "调高会让平台多付好友购买奖励" : "调高会让平台多付月薪"}
    reasonPlaceholder="写清调整原因和依据"
    businessForm={{
      kind: "multi-field",
      // 新值留空，现在的值写在「现在」那一侧（OP-19）。
      fields: [{ key: "value", label: name, current: "", inputKind: "text" }],
      amplifies: (values) => direction(values.value ?? "") === 1,
      feedback: (values) => {
        const text = (values.value ?? "").trim();
        const error = !text ? undefined : inputError(field, text) ?? (direction(text) === 0 ? "新值和现在一样，改了才能保存。" : undefined);
        return { message: error ?? "", invalid: !text || !!error };
      },
    }}
    inlineApproval={{
      dialogClassName: "f1-policy-confirm",
      disabledReason,
      // 生效方式只写在标题下的标签里，不再加一条同义横幅（DT-12）；批准前按原值写在影响句里。
      resolve: () => undefined,
      recover: () => submit("lookup"),
      retry: async () => { await submit("retry-original"); },
      renderForm: (values, change, locked) => {
        const text = values.value ?? "";
        const up = direction(text);
        const error = text.trim() ? inputError(field, text) ?? (up === 0 ? "新值和现在一样，改了才能保存。" : undefined) : undefined;
        return <DiffField before={current} unit={unitOf(field)}
          hint={isRate(field) ? "填 0–100，最多 2 位小数" : "填不小于 0 的数，最多 6 位小数"}
          state={up === 1 ? <StatusTag tone="warn" icon={LockOpen}>调高</StatusTag> : up === -1 ? <StatusTag tone="neutral" icon={Lock}>调低</StatusTag> : undefined}
          note={error ? undefined : note(text)} error={error}>
          {(control) => <NumberInput {...control} unit={unitOf(field)} min={0} max={isRate(field) ? 100 : undefined} step={isRate(field) ? 0.01 : 0.000001}
            value={text} disabled={locked} onChange={(event) => change({ ...values, value: event.target.value })} />}
        </DiffField>;
      },
    }}
    onClose={onClose}
    onConfirm={async (reason, _edit, values) => { await submit(pending() ? "retry-original" : "submit", values?.value ?? "", reason); }}
  />;
}
