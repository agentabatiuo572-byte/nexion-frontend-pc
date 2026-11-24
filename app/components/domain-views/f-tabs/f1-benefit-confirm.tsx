"use client";

/**
 * F1 等级权益三项（好友购买奖励一级、二级比例，月薪）的修改框（画板 B1、B2、B4）。
 * 样子照门槛修改框 F1PolicyConfirm：标题写动作和对象，标题下的生效标签跟填的方向变，影响一句，相邻等级和人数，
 * 放大方向才出覆盖率提示，「现在 → 改后」，理由。
 * F1-RANK-WIRE：写入还没有后端请求形状。提交调 ctx.submitVRankBenefit；没接上时框里报「提交还没接上」，什么都不发。
 */
import { Clock3, Lock, LockOpen, Zap } from "lucide-react";
import { DiffField, Fact, Facts, NumberInput, StatusTag } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { amountDisplay } from "@/lib/format";
import { OperationConfirmModal, type BusinessFormValue } from "../design-kit";
import type { FViewCtx } from "./types";
import { SUPER_APPROVER } from "./f1-shared";
import { compareDecimal, ratePct, type F1BenefitField, type F1RankRowView } from "./f1-rank-types";

const NAME: Record<F1BenefitField, string> = {
  purchaseL1Rate: "好友购买奖励 · 一级",
  purchaseL2Rate: "好友购买奖励 · 二级",
  monthlySalaryUsdt: "月薪",
};

/** 现在的值，按填写的单位：比例是百分数，月薪是 USDT。 */
export function benefitValue(row: F1RankRowView, field: F1BenefitField): string | undefined {
  return field === "monthlySalaryUsdt" ? row.monthlySalaryUsdt?.trim() || undefined : ratePct(row[field]);
}

const isRate = (field: F1BenefitField) => field !== "monthlySalaryUsdt";
const unitOf = (field: F1BenefitField) => isRate(field) ? "%" : "USDT";
const shown = (field: F1BenefitField, value: string) => isRate(field) ? `${value}%` : `${amountDisplay(value)} USDT`;

/** 范围写全，填错时它就是错误文字（VS-103）。 */
function inputError(field: F1BenefitField, value: string): string | undefined {
  const text = value.trim();
  if (isRate(field)) {
    if (!/^\d+(\.\d{1,2})?$/.test(text) || compareDecimal(text, "100") === 1) return "要填 0–100 的数，最多 2 位小数";
    return undefined;
  }
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(text)) return "要填不小于 0 的数，最多 6 位小数";
  return undefined;
}

export function F1BenefitConfirm({ row, field, ctx, onClose }: { row: F1RankRowView; field: F1BenefitField; ctx: FViewCtx; onClose: () => void }) {
  const session = useAdminAuth((state) => state.session);
  const rows = ctx.vrankRows as F1RankRowView[];
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
    const up = direction(values.value ?? "");
    if (up === 1) return <StatusTag tone="progress" filled icon={Clock3}>批准后生效</StatusTag>;
    if (up === -1) return <StatusTag tone="progress" filled icon={Zap}>立即生效</StatusTag>;
    return <StatusTag tone="neutral" icon={LockOpen} explain={`调高是增加资金：提交审批，${SUPER_APPROVER}（需有审批批准权限）批准后才生效，你自己不能批。调低确认后立即生效。`}>调高要批准 · 调低立即生效</StatusTag>;
  };
  const impact = (values: BusinessFormValue) => {
    const up = direction(values.value ?? "") === 1;
    if (isRate(field)) return up
      ? `${SUPER_APPROVER}批准后，之后付款的订单按新比例算；批准前仍按 ${shown(field, current)}，已经算好的不变。`
      : "确认后，之后付款的订单按新比例算；已经算好的不变。";
    return up
      ? `${SUPER_APPROVER}批准后，这个月已经是 ${row.v} 的人仍按 ${shown(field, current)}，批准后升到 ${row.v} 的人这个月按新金额；下个月起所有 ${row.v} 按新金额。`
      : `这个月已经是 ${row.v} 的人仍按 ${shown(field, current)}，从现在起升到 ${row.v} 的人这个月就按新金额；下个月起所有 ${row.v} 按新金额。`;
  };
  const note = (value: string) => {
    const text = value.trim();
    if (direction(text) === undefined || direction(text) === 0) return undefined;
    if (isRate(field)) {
      const per100 = text.replace(/^0+(?=\d)/, "");
      return `改成 ${text}%：${field === "purchaseL1Rate" ? "一级好友" : "二级好友（好友的好友）"}每付款 100 USDT 买设备，${row.v} 用户的奖励从 ${current} 变成 ${per100} USDT 等值。`;
    }
    if (Number(text) === 0) return `改成 0：${row.v} 不发月薪，这一级的人领不了。`;
    if (prevSalary !== undefined && compareDecimal(text, prevSalary) === -1) {
      return `改成 ${amountDisplay(text)}：比 ${rows[index - 1].v} 的 ${amountDisplay(prevSalary)} 还低，这个月从 ${rows[index - 1].v} 升到 ${row.v} 的人按 ${row.v} 领 ${amountDisplay(text)} USDT。`;
    }
    return undefined;
  };
  const facts = (_value?: string, values?: BusinessFormValue) => {
    const next = values?.value ?? "";
    return <Facts>
      {neighbors && <Fact k="相邻等级">{neighbors}</Fact>}
      <Fact k="这一级人数">{row.v} {row.pop.toLocaleString("en-US")} 人</Fact>
      {field === "monthlySalaryUsdt" && direction(next) === -1 && <Fact k="能否改回" tone="warn">
        改回 {amountDisplay(current)} 要{SUPER_APPROVER}批准；批准前按 {amountDisplay(next.trim())} 锁定的不补
      </Fact>}
    </Facts>;
  };
  const disabledReason = ctx.f1Loading || ctx.f1Error ? "请先成功重新读取会员等级。"
    : !session?.authorities.includes("network_f1_write") ? "当前账号没有这项操作的权限，请关闭弹窗后重新核对。" : undefined;

  return <OperationConfirmModal
    icon="sliders"
    briefKind={(values) => direction(values.value ?? "") === 1 ? "funds" : "config"}
    action={`调整 ${row.v} 等级权益 · ${name}`}
    title={`调整 ${row.v} 的${name}`}
    effect={effect}
    facts={facts}
    statedBrief={(values) => ({ impact: impact(values), check: "核对新值和相邻等级；理由写清依据或工单号。" })}
    confirmLabel="确认修改"
    confirmLabelForValue={(_value, values) => direction(values?.value ?? "") === 1 ? "提交审批" : "确认修改"}
    detail={`当前${name}为 ${shown(field, current)}。`}
    coverage={ctx.f1Coverage}
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
      resolve: (values) => direction(values.value ?? "") === 1 ? {
        disabledReason: ctx.f1Coverage && ctx.f1Coverage.coverageRatio < ctx.f1Coverage.redlinePct ? "当前兑付覆盖率低于红线，暂时无法提交审批。" : undefined,
      } : undefined,
      recover: async () => false,
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
    onConfirm={async (reason, _edit, values) => {
      const value = (values?.value ?? "").trim();
      // F1-RANK-WIRE：后端写入接上前不发任何请求，框里如实说没有保存。
      if (!ctx.submitVRankBenefit) throw new Error("这项修改的提交还没接上，这次没有保存。");
      await ctx.submitVRankBenefit(row.v, field, value, reason);
      ctx.toast(direction(value) === 1 ? "已提交，等待审批后执行" : `${row.v} ${name}已改为 ${shown(field, value)}，立即生效`);
      onClose();
    }}
  />;
}
