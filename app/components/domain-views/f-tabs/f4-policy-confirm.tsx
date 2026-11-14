"use client";

import { Field, Fold, Input, Notice, Table, Th, Tr, Td, Cell } from "@/app/components/rd";
import { formatF4AmbassadorBucketTitle } from "@/lib/admin/f4-ambassador-display";
import type { F4AmbassadorPolicy, F4AmbassadorPolicyUpdate } from "@/lib/admin/f1-client";
import { isF1OutcomeUncertainError } from "@/lib/admin/f1-stable-write";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import { decimalText } from "./f4-shared";
import type { FViewCtx, McSpec } from "./types";

export function f4PolicyConfirmation(ctx: FViewCtx, policy: F4AmbassadorPolicy): McSpec {
  let baseline = policy;
  let baselineReady = true;
  type Field = Extract<BusinessFormSpec, { kind: "multi-field" }>["fields"][number];
  const budget = { inputKind: "number", min: 100, max: 10_000, pattern: "^[0-9]+(?:\\.[0-9]+)?$", patternMessage: "预算须填写十进制金额" } as const;
  const mainFields: Field[] = [
    { key: "policyVersion", label: "规则版本", current: policy.policyVersion, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$" },
    { key: "defaultBudgetUsdt", label: "默认预算(USDT)", current: String(policy.defaultBudgetUsdt), ...budget },
  ];
  const bucketRows = policy.buckets.map((bucket) => {
    const name = formatF4AmbassadorBucketTitle(bucket.id, bucket.title);
    const fields: Field[] = [
      { key: `${bucket.id}.title`, label: `${name} 名称`, current: bucket.title, maxLength: 80 },
      { key: `${bucket.id}.rule`, label: `${name} 申请条件`, current: bucket.rule, maxLength: 500 },
      { key: `${bucket.id}.range`, label: `${name} 显示的金额范围`, current: bucket.range, maxLength: 80 },
      { key: `${bucket.id}.min`, label: `${name} 最低预算`, current: String(bucket.minBudgetUsdt), ...budget },
      { key: `${bucket.id}.max`, label: `${name} 最高预算`, current: String(bucket.maxBudgetUsdt), ...budget },
    ];
    return { bucket, name, fields };
  });
  const limits = () => [
    { key: "defaultBudgetUsdt", label: "默认预算", before: baseline.defaultBudgetUsdt },
    ...baseline.buckets.map(bucket => ({ key: `${bucket.id}.max`, label: `${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} · 最高预算`, before: bucket.maxBudgetUsdt })),
  ];
  const changedLimits = (values: BusinessFormValue) => limits().flatMap((limit) => {
    const after = values[limit.key]?.trim();
    return after && Number.isFinite(Number(after)) && Number(after) !== limit.before ? [{ ...limit, after }] : [];
  });
  const requiresApproval = (changes: ReturnType<typeof changedLimits>) => changes.some(({ before, after }) => Number(after) > before);
  const formatAmount = (value: string | number) => `${decimalText(value)} USDT`;
  // 版本冲突后 baseline 换成最新内容：逐项列出最新内容和草稿不同的地方。
  const latestValue = (key: string): string => {
    if (key === "policyVersion") return baseline.policyVersion;
    if (key === "defaultBudgetUsdt") return String(baseline.defaultBudgetUsdt);
    const [id, part] = key.split(".");
    const bucket = baseline.buckets.find((item) => String(item.id) === id);
    if (!bucket) return "";
    return part === "title" ? bucket.title : part === "rule" ? bucket.rule : part === "range" ? bucket.range : String(part === "min" ? bucket.minBudgetUsdt : bucket.maxBudgetUsdt);
  };
  const allFields = [...mainFields, ...bucketRows.flatMap(({ fields }) => fields)];
  const isAmount = (key: string) => key === "defaultBudgetUsdt" || /\.(min|max)$/.test(key);
  const show = (key: string, value: string) => value === "" ? "—" : isAmount(key) ? formatAmount(value) : value;
  const conflictNotice = (values: BusinessFormValue) => {
    if (baseline.revision === policy.revision) return null;
    const diff = allFields.filter((field) => (values[field.key] ?? "").trim() !== latestValue(field.key).trim()
      && !(isAmount(field.key) && Number(values[field.key]) === Number(latestValue(field.key))));
    return <Notice tone="warn" title="版本已变化，草稿已保留">
      <p>{diff.length ? "有人先改了规则。下面是最新内容和你的草稿不同的项；保存会用草稿替换最新内容。" : "有人先改了规则，最新内容和你的草稿相同。"}</p>
      {diff.length > 0 && <Table label="最新内容和草稿对比">
        <thead><tr><Th>项目</Th><Th>最新</Th><Th>你的草稿</Th></tr></thead>
        <tbody>{diff.map((field) => <Tr key={field.key}>
          <Td>{field.label}</Td><Td><Cell num={isAmount(field.key)} main={show(field.key, latestValue(field.key))} /></Td><Td><Cell num={isAmount(field.key)} main={show(field.key, (values[field.key] ?? "").trim())} /></Td>
        </Tr>)}</tbody>
      </Table>}
    </Notice>;
  };

  return { briefKind: "config",
    name: "调整区域大使申请规则",
    title: "调整大使申请规则",
    businessForm: { kind: "multi-field", fields: [...mainFields, ...bucketRows.flatMap(({ fields }) => fields)] },
    statedBrief: {
      impact: "保存后 App 的大使申请页下次打开或刷新就用新规则；已经提交的申请不按新规则改金额。",
      check: "只改文字、调低预算或调高最低预算时直接保存；调高默认预算或任一类的最高预算要另一位超级管理员批准。",
    },
    detail: "四类的编号固定不能改。已知的四类在 PC 和 App 上显示内置的中文名称和条件，自定义的名称和条件文字不一定显示给用户。",
    completionCopy: "填写理由后即时保存，不经审批。",
    teamApproval: {
      source: "F4",
      resolve: (values) => {
        const changes = changedLimits(values);
        if (!requiresApproval(changes)) return undefined;
        return {
          heading: "提高预算 · 另一位超级管理员批准后生效",
          completionCopy: "批准前 App 继续用现在的规则。提交和批准时都会检查兑付覆盖率，批准人需有大使规则资金权限和审批权限，不能是你自己。",
          comparison: <div className="f4-policy-diff">
            <Table label="预算变更对比">
              <thead><tr><Th>预算</Th><Th align="right">现在</Th><Th align="right">改后</Th></tr></thead>
              <tbody>{changes.map(({ key, label, before, after }) => <Tr key={key}>
                <Td>{label}</Td><Td align="right"><Cell num main={formatAmount(before)} /></Td><Td align="right"><Cell num main={formatAmount(after)} /></Td>
              </Tr>)}</tbody>
            </Table>
          </div>,
        };
      },
      renderForm: (values, change, locked) => {
        const input = (field: Field) => <Input id={`f4-policy-${field.key}`} name={field.key}
          aria-label={field.label} type={field.inputKind ?? "text"} min={field.min} max={field.max}
          step={field.inputKind === "number" ? "any" : undefined} maxLength={field.maxLength}
          title={field.inputKind !== "number" ? values[field.key] : undefined}
          value={values[field.key] ?? ""} disabled={locked} required
          onChange={(event) => change({ ...values, [field.key]: event.target.value })} />;
        return <div className="f4-policy-form">
          {conflictNotice(values)}
          <div className="f4-policy-main">
            <Field id={`f4-policy-${mainFields[0].key}`} label="规则版本" explain="3–64 位，可用字母、数字、点、横线和下划线。">{input(mainFields[0])}</Field>
            <Field id={`f4-policy-${mainFields[1].key}`} label="默认预算（USDT）" explain="100–10,000 USDT，要落在某一类的预算范围里。">{input(mainFields[1])}</Field>
          </div>
          {bucketRows.map(({ bucket, name, fields }) => <Fold key={bucket.id} inset title={name} summary={`${decimalText(values[`${bucket.id}.min`] ?? "")}–${decimalText(values[`${bucket.id}.max`] ?? "")} USDT`}>
            <fieldset className="f4-policy-bucket" aria-label={`${name}（${bucket.id}）`}>
            <Field id={`f4-policy-${fields[0].key}`} label="名称" hint="≤ 80 字">{input(fields[0])}</Field>
            <Field id={`f4-policy-${fields[2].key}`} label="显示范围" hint="≤ 80 字">{input(fields[2])}</Field>
            <Field id={`f4-policy-${fields[3].key}`} label="最低预算（USDT）">{input(fields[3])}</Field>
            <Field id={`f4-policy-${fields[4].key}`} label="最高预算（USDT）">{input(fields[4])}</Field>
            <div className="f4-policy-rule"><Field id={`f4-policy-${fields[1].key}`} label="申请条件" hint="≤ 500 字">{input(fields[1])}</Field></div>
            </fieldset>
          </Fold>)}
        </div>;
      },
    },
    run: async (reason, values) => {
      if (!values) throw new Error("请填写完整");
      if (!baselineReady) {
        baseline = await ctx.refreshF4PolicyBaseline();
        baselineReady = true;
        throw new Error("版本已变化，草稿已保留，请核对后再保存。");
      }
      const payload: F4AmbassadorPolicyUpdate = {
        policyVersion: values.policyVersion.trim(),
        expectedRevision: baseline.revision,
        defaultBudgetUsdt: values.defaultBudgetUsdt.trim(),
        buckets: baseline.buckets.map(({ id }) => ({
          id,
          title: values[`${id}.title`].trim(),
          rule: values[`${id}.rule`].trim(),
          range: values[`${id}.range`].trim(),
          minBudgetUsdt: values[`${id}.min`].trim(),
          maxBudgetUsdt: values[`${id}.max`].trim(),
        })),
      };
      const requestedDefault = Number(payload.defaultBudgetUsdt);
      if (payload.buckets.some(({ minBudgetUsdt, maxBudgetUsdt }) => Number(minBudgetUsdt) > Number(maxBudgetUsdt))) {
        throw new Error("最低预算不能高于最高预算");
      }
      if (!payload.buckets.some(({ minBudgetUsdt, maxBudgetUsdt }) => requestedDefault >= Number(minBudgetUsdt) && requestedDefault <= Number(maxBudgetUsdt))) {
        throw new Error("默认预算须落在至少一个分类的预算范围内");
      }
      try {
        if (requiresApproval(changedLimits(values))) {
          await ctx.submitTeamApproval("F4", payload, reason);
        } else {
          if (await ctx.updateF4AmbassadorPolicy(payload, reason)) ctx.toast("区域大使申请规则已更新");
        }
      } catch (error) {
        if (!isF1OutcomeUncertainError(error) && !isA2OutcomeUncertainError(error)
          && (error as { backendMessage?: string }).backendMessage === "AMBASSADOR_POLICY_VERSION_CONFLICT") {
          baselineReady = false;
          baseline = await ctx.refreshF4PolicyBaseline();
          baselineReady = true;
        }
        throw error;
      }
    },
  };
}
