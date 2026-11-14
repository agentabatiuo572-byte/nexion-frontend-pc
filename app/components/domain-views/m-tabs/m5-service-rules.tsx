"use client";

import { useReach } from "@/lib/nav/use-reach";
import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Save, Tags } from "lucide-react";
import { BlockState, Button, DiffList, Fact, Facts, Field, Modal, Notice, NumberInput, Panel, Segments, StatusTag, Textarea } from "@/app/components/rd";
import { supportClient, m5ManagementClient, SupportClientError, type SupportRules } from "../../../../lib/admin/m-support-client";
import { businessStamp, businessZone } from "../../../../lib/admin/business-time";
import { createPendingMutationStore, PENDING_MUTATION_TTL_MS } from "../../../../lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { isM5ManagementPayload } from "@/lib/admin/m5-management-record";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import "./m-support-admin.css";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { useM5ManagementCommand, type M5ManagementRecord } from "@/lib/admin/use-m5-management-command";
import { M5PendingWrites, type M5RulesSummary } from "./m5-views";

export type MSupportPermission = "superadmin" | "supervisor" | "agent";
type RuleDraft = { dormantDays: string; maintenanceDays: string; activityWindowDays: string; inheritanceMode: SupportRules["inheritanceMode"]; maxInheritanceDepth: string; unboundAssignmentMode?: SupportRules["unboundAssignmentMode"] };
type Field = keyof RuleDraft;
type RulePayload = Parameters<typeof supportClient.updateRules>[0];
type RulePendingRecord = M5ManagementRecord<RulePayload, SupportRules>;
const ruleCommands = createPendingMutationStore<RulePendingRecord>({ storageKey: "nexion-admin-m-support-rules-v1", retainExpiredRecords: true, isValidRecord: (row) => Number.isSafeInteger(row.actorId) && isM5ManagementPayload("rules", row.payload) && (row.before === undefined || isM5ManagementPayload("rules", row.before, true)) });
const LABELS: Record<Field, string> = {
  unboundAssignmentMode: "无专属客服客户分配方式",
  dormantDays: "沉睡判定天数", maintenanceDays: "主动维护间隔天数", activityWindowDays: "活跃统计窗口天数", inheritanceMode: "自动继承方式", maxInheritanceDepth: "自动继承的邀请次数上限",
};
const dayFields = ["dormantDays", "maintenanceDays", "activityWindowDays"] as const;
const RETRY_EXPIRED = "原请求已超过 24 小时，不能再重试，只能查询原结果；请核对最新规则。";
const isIndeterminateText = (text: string) => /结果未知|还在处理|查不到|读不到最新|24 小时/.test(text);
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };

function toDraft(rules: SupportRules): RuleDraft {
  return {
    unboundAssignmentMode: rules.unboundAssignmentMode ?? "SUPERVISOR",
    dormantDays: rules.dormantDays == null ? "" : String(rules.dormantDays),
    maintenanceDays: rules.maintenanceDays == null ? "" : String(rules.maintenanceDays),
    activityWindowDays: rules.activityWindowDays == null ? "" : String(rules.activityWindowDays),
    inheritanceMode: rules.inheritanceMode,
    maxInheritanceDepth: rules.maxInheritanceDepth == null ? "" : String(rules.maxInheritanceDepth),
  };
}

export function parseRuleDraft(draft: RuleDraft): Omit<SupportRules, "version"> | null {
  const parse = (value: string, allowZero = false): number | null | undefined => {
    if (value.trim() === "") return null;
    if (!/^\d+$/.test(value.trim())) return undefined;
    const number = Number(value.trim());
    return Number.isSafeInteger(number) && (allowZero ? number >= 0 : number > 0) ? number : undefined;
  };
  const dormantDays = parse(draft.dormantDays);
  const maintenanceDays = parse(draft.maintenanceDays);
  const activityWindowDays = parse(draft.activityWindowDays);
  const maxInheritanceDepth = draft.inheritanceMode === "LIMITED" ? parse(draft.maxInheritanceDepth, true) : null;
  if (dormantDays === undefined || maintenanceDays === undefined || activityWindowDays === undefined || maxInheritanceDepth === undefined) return null;
  if (draft.inheritanceMode === "LIMITED" && maxInheritanceDepth === null) return null;
  if (dormantDays !== null && activityWindowDays !== null && activityWindowDays > dormantDays) return null;
  return { dormantDays, maintenanceDays, activityWindowDays, inheritanceMode: draft.inheritanceMode, maxInheritanceDepth, unboundAssignmentMode: draft.unboundAssignmentMode ?? "SUPERVISOR" };
}

function changedFields(before: SupportRules, after: Omit<SupportRules, "version">): Field[] {
  return (Object.keys(LABELS) as Field[]).filter((key) => before[key] !== after[key]);
}

function labelValue(key: Field, value: SupportRules[Field]): string {
  if (key === "unboundAssignmentMode") return value === "AUTO_RANDOM" ? "按负载自动分配" : "客服主管分配";
  if (key === "inheritanceMode") return value === "LIMITED" ? "限定次数" : value === "UNLIMITED" ? "不限制" : "未配置";
  return value == null ? "未配置" : `${value}${key === "maxInheritanceDepth" ? " 次" : " 天"}`;
}

const errorText = displayAdminError;

export function M5ServiceRules({ permission, onSummary }: { permission: MSupportPermission; onSummary?: (summary: M5RulesSummary) => void }) {
  const reach = useReach();
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const canWrite = permission === "superadmin" && Boolean(authorities?.includes("service_m1_write"));
  const [current, setCurrent] = useState<SupportRules | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [latest, setLatest] = useState<SupportRules | null>(null);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [reload, setReload] = useState(0);
  const preserveDraft = useRef(false);
  const command = useM5ManagementCommand({
    store: ruleCommands, canQuery: Boolean(authorities?.includes("service_m1_read")), canWrite,
    fingerprint: (payload: RulePayload) => `support-rules:${payload.expectedVersion}`,
    write: m5ManagementClient.rules, query: m5ManagementClient.rulesCommand,
    onSuccess: () => { preserveDraft.current = false; setConfirm(false); setSaved(true); setLoading(true); setReadUnavailable(true); setReload(n => n + 1); setReason(""); },
    onRefusal: (cause, recovered, payload) => {
      setError(errorText(cause));
      if (recovered) { preserveDraft.current = true; setDraft(toDraft({ ...payload, version: payload.expectedVersion })); setConfirm(false); setLoading(true); setReadUnavailable(true); setReload(n => n + 1); }
      else if (cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "SUPPORT_RULES_VERSION_CONFLICT") {
        setConflict(true); setConfirm(false); void refreshLatest();
      }
    },
  });
  const saving = command.busy;
  const retry = command.pending ? { ...command.pending, key: command.pending.commandKey } : null;


  useEffect(() => {
    if (permission === "agent") return;
    const controller = new AbortController();
    setLoading(true);
    supportClient.rules(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const pending = ruleCommands.list().find(row => row.actorId === adminId);
      setCurrent(value); setDraft(old => pending ? toDraft({ ...value, ...pending.payload }) : preserveDraft.current && old ? old : toDraft(value)); setError(""); setLatest(null); setReadUnavailable(false); setConflict(false);
      setReason(pending?.payload.reason ?? "");
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { setReadUnavailable(true); setError(displayAdminReadError(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [permission, reload, adminId]);

  const parsed = useMemo(() => draft ? parseRuleDraft(draft) : null, [draft]);
  const changed = current && parsed ? changedFields(current, parsed) : [];
  const editable = canWrite && Boolean(current) && !loading && !readUnavailable && !saving && !conflict && !retry;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canConfirm = editable && parsed && changed.length > 0 && reasonOk;
  const retryExpired = Boolean(retry && Date.now() >= retry.expiresAt);
  const setField = (field: Field, value: string) => setDraft((old) => old ? { ...old, [field]: value } : old);

  async function save() {
    if (saving) return;
    if (retry) { await command.run("replay"); return; }
    if (!canConfirm || !current || !parsed) return;
    if (current.inheritanceMode !== "UNCONFIGURED" && parsed.inheritanceMode === "UNCONFIGURED") {
      setError(errorText(new SupportClientError(422, 422, "SUPPORT_RULES_INVALID"))); return;
    }
    setSaved(false);
    await command.run("submit", { ...parsed, expectedVersion: current.version, reason: reason.trim() }, current);
  }

  function reviewLatest() {
    if (!latest || !current || !draft) return;
    const previous = parseRuleDraft(draft);
    if (!previous) return;
    const edited = changedFields(current, previous);
    const updated = toDraft(latest);
    for (const field of edited) updated[field] = draft[field] as never;
    setCurrent(latest); setDraft(updated); setLatest(null); setConflict(false); setConfirm(false); setReason(""); setError("");
  }

  async function refreshLatest() {
    const actor = actorStamp();
    try { const latestRules = await supportClient.rules(); if (actor === actorStamp()) setLatest(latestRules); } catch (cause) { if (actor === actorStamp()) setError(displayAdminReadError(cause)); }
  }

  const checkPending = () => command.run("query");
  const restore = () => {
    if (!retry) return;
    setDraft(toDraft({ ...retry.payload, version: retry.payload.expectedVersion }));
    setReason(retry.payload.reason); setError(""); setConfirm(true);
  };
  const original = retry?.before ?? (retry ? { ...retry.payload, version: retry.payload.expectedVersion } : current);
  const confirmed = retry ? retry.payload : parsed;
  const confirmedChanges = retry && !retry.before ? Object.keys(LABELS) as Field[] : original && confirmed ? changedFields(original, confirmed) : [];
  const beforeLabel = (field: Field) => retry && !retry.before ? "—" : original ? labelValue(field, original[field]) : "—";

  const summaryMode = current?.unboundAssignmentMode ?? (current ? "SUPERVISOR" : undefined);
  useEffect(() => {
    onSummary?.({ state: loading ? "loading" : readUnavailable ? "failed" : current ? "ready" : "failed", mode: summaryMode, inheritance: current?.inheritanceMode, depth: current?.maxInheritanceDepth, pending: Boolean(retry) });
  }, [onSummary, current, loading, summaryMode, command.pending, readUnavailable]);

  if (permission === "agent") return <BlockState state="denied" title="当前账号不能查看服务规则" />;
  // 只显示用：每个框自己的问题写在框下；能不能保存仍只看 parsed（逻辑不变）。
  const dayProblem = (value: string) => {
    const text = value.trim();
    return text === "" || (/^\d+$/.test(text) && Number(text) > 0 && Number.isSafeInteger(Number(text))) ? "" : "要填正整数；留空表示不配置";
  };
  const dormantShown = draft && !dayProblem(draft.dormantDays) && draft.dormantDays.trim() ? Number(draft.dormantDays) : null;
  const windowProblem = draft && !dayProblem(draft.activityWindowDays) && draft.activityWindowDays.trim() && dormantShown !== null && Number(draft.activityWindowDays) > dormantShown ? `不能大于沉睡判定天数（${dormantShown} 天）` : "";
  const depthProblem = draft?.inheritanceMode !== "LIMITED" ? "" : draft.maxInheritanceDepth.trim() === "" ? "限定次数时要填次数，可以填 0" : /^\d+$/.test(draft.maxInheritanceDepth.trim()) ? "" : "要填 0 或正整数";
  const inheritItems = [
    { value: "UNLIMITED" as const, label: "不限制", disabled: !editable },
    { value: "LIMITED" as const, label: "限定次数", disabled: !editable },
    // F01：已经配置过的规则后端不让退回「未配置」，只给原本就是未配置的保留这一项。
    ...(current?.inheritanceMode === "UNCONFIGURED" ? [{ value: "UNCONFIGURED" as const, label: "未配置", disabled: !editable }] : []),
  ];
  const submittedAt = retry ? retry.expiresAt - PENDING_MUTATION_TTL_MS : 0;
  const DAY_HELP: Record<(typeof dayFields)[number], string> = {
    dormantDays: "有效账户活动超过这么多天、且活动记录完整，客户才算沉睡。留空表示不判定沉睡。",
    maintenanceDays: "距上次维护满这么多天，客户进专属客服的主动维护待办。改天数不会补记维护。",
    activityWindowDays: "统计活跃客户时往回看几天，和沉睡分开算，不能大于沉睡天数。",
  };
  const changeText = retry && original ? confirmedChanges.map((field) => `${LABELS[field]} ${beforeLabel(field)} → ${labelValue(field, retry.payload[field as keyof typeof retry.payload] as SupportRules[Field])}`).join("；") : "";

  return (
    <section className="m5-rules" aria-label="服务规则">
      {retry && <M5PendingWrites rows={[{
        key: retry.key, name: "服务规则", change: changeText || "规则保存", submittedAt, expired: retryExpired,
        actions: <>
          <Button size="sm" disabled={saving || !authorities?.includes("service_m1_read")} onClick={() => void checkPending()}>查询原结果</Button>
          {!retryExpired && <Button size="sm" variant="primary" disabled={saving || !canWrite} onClick={restore}>按原请求重试</Button>}
        </>,
      }]} />}
      <Panel icon={Route} tone="role-3" title="分配与继承规则" sub={current && !readUnavailable ? `第 ${current.version} 版` : undefined}
        explain="保存后立即生效。已有的绑定不会重排；继承只看之后注册的用户；还在等分配的客户按新的方式和时长继续处理。">
        {permission === "supervisor" && <Notice tone="neutral">只有超级管理员能改服务规则，你现在只能查看。</Notice>}
        {loading && !current && <BlockState state="loading" title="正在读取服务规则…" />}
        {saved && <Notice tone="ok">已保存。</Notice>}
        {!loading && (!current || readUnavailable) && <BlockState state="error" title="服务规则读不到，暂时不能查看和保存" detail={error || undefined} onRetry={() => setReload((n) => n + 1)} />}
        {(error || command.message) && !readUnavailable && !confirm && !conflict && <Notice tone={isIndeterminateText(command.message || error) ? "warn" : "danger"}>{command.message || error}</Notice>}
        {draft && current && !(readUnavailable && !retry) && <div className="m5-form">
          <Field label="新客户怎么分" help={draft.unboundAssignmentMode === "AUTO_RANDOM"
            ? "第一次发消息时，分给可接单的客服里负载最低的；没人可接就继续等。"
            : "主管手动分；超时没人分就按负载兜底。"}
            explain="邀请继承和专属邀请码优先：这类客户注册时就有专属客服，不走这里。可接单指没暂停接新单、绑定客户数没到上限。已有专属客服的客户不会重新分配。">
            <Segments label="新客户怎么分" value={draft.unboundAssignmentMode ?? "SUPERVISOR"} onChange={(value) => setField("unboundAssignmentMode", value)}
              items={[{ value: "AUTO_RANDOM", label: "首次咨询时按负载自动分配", disabled: !editable }, { value: "SUPERVISOR", label: "客服主管分配", disabled: !editable }]} />
          </Field>
          <div className="rd-form-grid" data-cols="2" data-dense="">
            <Field label="邀请来的用户归谁" help={draft.inheritanceMode === "UNLIMITED" ? "沿邀请关系一直归给同一位专属客服。" : draft.inheritanceMode === "LIMITED" ? "从第一位绑定的客户算起，最多往下继承这么多层。" : "历史未配置：邀请来的用户直接进待分配。"}
              explain="已有专属客服的客户邀请来的新用户，注册时归给同一位专属客服；超出层数或继承不到的进待分配。只影响之后注册的用户。">
              <Segments label="邀请来的用户归谁" value={draft.inheritanceMode} onChange={(value) => { if (editable) setDraft((old) => old ? { ...old, inheritanceMode: value, maxInheritanceDepth: value === "LIMITED" ? old.maxInheritanceDepth : "" } : old); }} items={inheritItems} />
            </Field>
            {draft.inheritanceMode === "LIMITED" && <Field label="最多继承几次" hint="0 或正整数" error={depthProblem || undefined}
              explain="填 0：只有已绑定的那位客户归这位客服，他邀请来的人不继承。">
              {(control) => <NumberInput {...control} unit="次" min={0} step={1} placeholder="填次数" value={draft.maxInheritanceDepth} disabled={!editable} onChange={(event) => setField("maxInheritanceDepth", event.target.value)} />}
            </Field>}
          </div>
          <div className="m5-subhead"><Tags size={14} aria-hidden />客户标签按几天算<span className="m5-subhead-note">留空表示不配置，这项标签不统计</span></div>
          <div className="rd-form-grid" data-cols="3" data-dense="">
            {dayFields.map((field) => (
              <Field key={field} label={LABELS[field]} explain={DAY_HELP[field]} error={dayProblem(draft[field]) || (field === "activityWindowDays" ? windowProblem : "") || undefined}>
                {(control) => <NumberInput {...control} id={`m-rule-${field}`} unit="天" min={1} step={1} placeholder="未配置" value={draft[field]} disabled={!editable} onChange={(event) => setField(field, event.target.value)} />}
              </Field>
            ))}
          </div>
          {conflict && <Notice tone="warn" title="规则已被别人改过" actionBelow
            action={latest ? <Button size="sm" onClick={reviewLatest} disabled={!parsed}>以最新规则重审</Button> : <Button size="sm" onClick={() => void refreshLatest()}>读取最新规则</Button>}>
            <p>{latest ? `现在是第 ${latest.version} 版，你改的是第 ${current.version} 版。` : "还没读到最新版本。"}你填的内容还在。</p>
            {latest && <ul className="m5-plain-list">{changedFields(current, latest).map((field) => <li key={field}>{LABELS[field]}：{labelValue(field, current[field])} → {labelValue(field, latest[field])}</li>)}</ul>}
          </Notice>}
          {permission === "superadmin" && <div className="rd-toolbar" data-end="">
            <span className="rd-toolbar-note">{retry ? "上次保存结果未知，先处理它" : changed.length > 0 ? `改了 ${changed.length} 项，还没保存` : "没有改动"}</span>
            <Button variant="primary" icon={<Save size={14} aria-hidden />} disabled={permission !== "superadmin" || (retry ? false : !editable || !parsed || changed.length === 0)}
              disabledReason={!retry && editable && changed.length === 0 ? "还没有改动" : !retry && editable && !parsed ? "有填写不对的项，先改正" : undefined}
              onClick={() => { if (retry) restore(); else setConfirm(true); }}>{retry ? "查看结果未知的保存" : "预览并保存"}</Button>
          </div>}
        </div>}
        {reach("/service/overview", "service_m1_read") && <p className="m5-link-line">手动处理等分配的客户：<a className="rd-link" href="/service/overview?view=pool">核对历史池并明确分配</a></p>}
      </Panel>
      {confirm && original && confirmed && permission === "superadmin" && <Modal title={confirmedChanges.length === 1 ? `修改${LABELS[confirmedChanges[0]]}` : "保存服务规则"} icon={Route} busy={saving} wide onClose={() => { if (!saving) setConfirm(false); }}
        sub={<><StatusTag tone="progress" filled>保存后立即生效</StatusTag><span className="m5-modal-id">第 {original.version} 版</span></>}
        footer={<>
          <Button disabled={saving} onClick={() => setConfirm(false)}>返回</Button>
          <Button variant="primary" loading={saving} disabled={!canWrite || (!canConfirm && !retry) || saving || (!retry && Boolean(latest)) || retryExpired}
            disabledReason={saving ? undefined : retryExpired ? "原请求超过 24 小时，只能查询原结果" : !retry && !reasonOk ? "操作理由要 8–200 字" : undefined} onClick={() => void save()}>{retry ? "按原请求重试" : "确认保存"}</Button>
        </>}>
        <DiffList rows={confirmedChanges.map((field) => ({ key: field, label: LABELS[field], before: beforeLabel(field), after: labelValue(field, confirmed[field]) }))} />
        <Facts>
          <Fact k="影响谁">之后注册的用户、之后发消息的客户、还在等分配的客户</Fact>
          <Fact k="不变的">已有的绑定；改天数不补记维护</Fact>
        </Facts>
        {retry && <Notice tone="warn" title="结果未知" action={<Button size="sm" disabled={saving || !authorities?.includes("service_m1_read")} onClick={() => void checkPending()}>查询原结果</Button>}>
          {retryExpired ? RETRY_EXPIRED : `上次保存在 ${businessStamp(submittedAt)}（${businessZone().label}）提交，可能已经生效。先查询原结果，或按原请求重试，不会重复执行。`}
        </Notice>}
        <Field label="操作理由" required hint="8–200 字">
          {(control) => <Textarea {...control} rows={3} value={reason} maxLength={200} disabled={saving || Boolean(retry)} count={`${reason.trim().length}/200`} placeholder="例如：客服人手调整，新客户改为主管分配" onChange={(event) => setReason(event.target.value)} />}
        </Field>
        {(error || command.message) && <Notice tone={isIndeterminateText(command.message || error) ? "warn" : "danger"}>{command.message || error}</Notice>}
      </Modal>}
    </section>
  );

}
