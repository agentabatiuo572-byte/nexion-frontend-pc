"use client";

import { useEffect, useMemo, useState } from "react";
import { supportClient, isIndeterminateSupportError, type SupportRules } from "../../../../lib/admin/m-support-client";
import { Modal } from "../design-kit";
import { createPendingMutationStore } from "../../../../lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import "./m-support-admin.css";

export type MSupportPermission = "superadmin" | "supervisor" | "agent";
type RuleDraft = { dormantDays: string; maintenanceDays: string; activityWindowDays: string; inheritanceMode: SupportRules["inheritanceMode"]; maxInheritanceDepth: string };
type Field = keyof RuleDraft;
type RulePayload = Parameters<typeof supportClient.updateRules>[0];
type RulePendingRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; payload: RulePayload };
const ruleCommands = createPendingMutationStore<RulePendingRecord>({ storageKey: "nexion-admin-m-support-rules-v1", isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Number.isSafeInteger(row.payload.expectedVersion)) });
const LABELS: Record<Field, string> = {
  dormantDays: "沉睡判定天数", maintenanceDays: "主动维护间隔天数", activityWindowDays: "活跃统计窗口天数", inheritanceMode: "自动继承方式", maxInheritanceDepth: "最大自动继承层数",
};
const dayFields = ["dormantDays", "maintenanceDays", "activityWindowDays"] as const;
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };

function toDraft(rules: SupportRules): RuleDraft {
  return {
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
  return { dormantDays, maintenanceDays, activityWindowDays, inheritanceMode: draft.inheritanceMode, maxInheritanceDepth };
}

function changedFields(before: SupportRules, after: Omit<SupportRules, "version">): Field[] {
  return (Object.keys(LABELS) as Field[]).filter((key) => before[key] !== after[key]);
}

function labelValue(key: Field, value: SupportRules[Field]): string {
  if (key === "inheritanceMode") return value === "LIMITED" ? "有限层数" : value === "UNLIMITED" ? "不限制" : "未配置";
  return value == null ? "未配置" : `${value}${key === "maxInheritanceDepth" ? " 层" : " 天"}`;
}

function errorText(error: unknown): string {
  if (isIndeterminateSupportError(error)) return "操作结果待确认，请查询原命令或用原命令重试。";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号无权修改服务规则。";
  if (status === 409) return "规则已被其他管理员修改，请查看差异后重新确认。";
  if (status === 400 || status === 422) return "输入未通过校验，请检查天数、继承层数和修改理由后再提交。";
  return "服务规则暂不可用，请重试；当前输入已保留。";
}

export function M5ServiceRules({ permission }: { permission: MSupportPermission }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const [current, setCurrent] = useState<SupportRules | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [latest, setLatest] = useState<SupportRules | null>(null);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [retry, setRetry] = useState<{ key: string; payload: Parameters<typeof supportClient.updateRules>[0] } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (permission === "agent") return;
    const controller = new AbortController();
    setLoading(true);
    supportClient.rules(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const pending = ruleCommands.list().find((row) => row.actorId === adminId);
      const writablePending = permission === "superadmin" ? pending : null;
      setCurrent(value); setDraft(toDraft(writablePending ? { ...value, ...writablePending.payload } : value)); setError(""); setLatest(null); setReadUnavailable(false); setConflict(false);
      setRetry(writablePending ? { key: writablePending.commandKey, payload: writablePending.payload } : null);
      setReason(writablePending?.payload.reason ?? "");
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { setReadUnavailable(true); setError(errorText(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [permission, reload, adminId]);

  const parsed = useMemo(() => draft ? parseRuleDraft(draft) : null, [draft]);
  const changed = current && parsed ? changedFields(current, parsed) : [];
  const editable = permission === "superadmin" && Boolean(current) && !loading && !readUnavailable && !saving && !conflict && !retry;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canConfirm = editable && parsed && changed.length > 0 && reasonOk;
  const readOnlyPending = permission === "supervisor" && ruleCommands.list().some((row) => row.actorId === adminId);
  const setField = (field: Field, value: string) => setDraft((old) => old ? { ...old, [field]: value } : old);

  async function save() {
    if (permission !== "superadmin" || ((!canConfirm && !retry) || !current || !parsed || saving || !adminId)) return;
    const actor = actorStamp();
    const command = retry ?? {
      key: crypto.randomUUID(),
      payload: { ...parsed, expectedVersion: current.version, reason: reason.trim() },
    };
    const fingerprint = `support-rules:${command.payload.expectedVersion}`;
    if (!retry) ruleCommands.remember(fingerprint, command.key, { actorId: adminId, payload: command.payload });
    setSaving(true); setError("");
    try {
      const value = await supportClient.updateRules(command.payload, command.key);
      if (actor !== actorStamp()) return;
      ruleCommands.forget(fingerprint);
      setCurrent(value); setDraft(toDraft(value)); setReason(""); setConfirm(false); setRetry(null); setLatest(null);
    } catch (cause) {
      if (actor !== actorStamp()) return;
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      setError(errorText(cause));
      if (status === 409 && !isIndeterminateSupportError(cause)) {
        ruleCommands.forget(fingerprint);
        setRetry(null); setConflict(true); setConfirm(false);
        try { const latestRules = await supportClient.rules(); if (actor === actorStamp()) setLatest(latestRules); } catch { /* Keep the draft; retry loading latest explicitly. */ }
      } else if (![400, 401, 403, 422].includes(status)) {
        setRetry(command);
      } else { ruleCommands.forget(fingerprint); setRetry(null); }
    } finally { setSaving(false); }
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
    try { const latestRules = await supportClient.rules(); if (actor === actorStamp()) setLatest(latestRules); } catch (cause) { if (actor === actorStamp()) setError(errorText(cause)); }
  }

  async function checkPending() {
    if (!retry || saving) return;
    const actor = actorStamp();
    setSaving(true);
    try {
      const result = await supportClient.command(retry.key);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED") {
        const value = await supportClient.rules();
        if (actor !== actorStamp()) return;
        ruleCommands.forget(`support-rules:${retry.payload.expectedVersion}`);
        setCurrent(value); setDraft(toDraft(value)); setRetry(null); setReason(""); setConfirm(false); setError("");
      } else if (result.status === "FAILED") {
        ruleCommands.forget(`support-rules:${retry.payload.expectedVersion}`);
        setRetry(null); setError("原命令已失败，输入已保留；请检查后重新提交。");
      } else setError("原命令仍在处理中，请稍后查询或使用同一命令重试。");
    } catch { if (actor === actorStamp()) setError("暂时无法确认原命令结果；输入与命令已保留。"); }
    finally { setSaving(false); }
  }

  if (permission === "agent") return <div className="m-admin-error">当前账号无权查看服务规则。</div>;
  return (
    <section className="m-admin-grid" aria-label="服务规则">
      <div className="m-admin-panel">
        <h2>服务规则</h2>
        <div className="m-admin-muted">沉睡、维护与活跃统计分别配置。未配置的能力会显示不可用，不影响其他已配置规则。</div>
        {permission === "supervisor" && <div className="m-admin-error">仅超管可修改服务规则；当前为只读视图。</div>}
        {readOnlyPending && <div className="m-admin-error" role="status">此账号有一笔规则提交结果尚未确认；下方仅显示服务端已保存的规则。请恢复超管权限后查询原命令。</div>}
        {loading && <div className="m-admin-muted" role="status">正在读取规则…</div>}
        {error && <div className="m-admin-error" role="alert">{error} {readUnavailable && <button type="button" className="btn btn-sec btn-sm" disabled={Boolean(retry)} onClick={() => setReload((n) => n + 1)}>重试读取</button>}</div>}
        {!loading && !current && <div className="m-admin-muted">规则暂不可用，无法保存。</div>}
        {draft && current && <>
          {dayFields.map((field) => <div className="m-admin-row" key={field}>
            <div><label htmlFor={`m-rule-${field}`}>{LABELS[field]}</label><p>{field === "dormantDays" ? "有效账户活动超出设定天数且记录完整，才可判定沉睡。" : field === "maintenanceDays" ? "已到维护时间的客户会进入主动维护待办。" : "用于活跃客户统计，与当前沉睡状态分别计算。"}</p></div>
            <input id={`m-rule-${field}`} type="number" min="1" step="1" placeholder="未配置" value={draft[field]} disabled={!editable} onChange={(event) => setField(field, event.target.value)} />
          </div>)}
          <div className="m-admin-row">
            <div><label htmlFor="m-rule-inheritanceMode">自动继承方式</label><p>从人工分配的客户起点 0 层开始，其后续邀请注册可向下继承的最大层数。</p></div>
            <select id="m-rule-inheritanceMode" value={draft.inheritanceMode} disabled={!editable} onChange={(event) => setDraft((old) => old ? { ...old, inheritanceMode: event.target.value as RuleDraft["inheritanceMode"], maxInheritanceDepth: event.target.value === "LIMITED" ? old.maxInheritanceDepth : "" } : old)}>
              <option value="UNCONFIGURED">未配置</option><option value="LIMITED">有限层数</option><option value="UNLIMITED">不限制</option>
            </select>
          </div>
          {draft.inheritanceMode === "LIMITED" && <div className="m-admin-row">
            <div><label htmlFor="m-rule-maxInheritanceDepth">最大自动继承层数</label><p>0 层有效，表示仅人工分配的起点客户归属顾问。</p></div>
            <input id="m-rule-maxInheritanceDepth" type="number" min="0" step="1" placeholder="请输入层数" value={draft.maxInheritanceDepth} disabled={!editable} onChange={(event) => setField("maxInheritanceDepth", event.target.value)} />
          </div>}
          {!parsed && <div className="m-admin-error" role="alert">天数须为正整数，有限层数须为非负整数；同时设置沉睡与活跃天数时，活跃窗口不得大于沉睡天数。</div>}
          {conflict && <div className="m-admin-error" role="alert">规则版本已变化。{latest ? `新版本为 ${latest.version}，原版本为 ${current.version}。` : "尚未取得最新版本。"}输入已保留。{latest && <ul>{changedFields(current, latest).map((field) => <li key={field}>{LABELS[field]}：原值 {labelValue(field, current[field])} → 最新 {labelValue(field, latest[field])}</li>)}</ul>}{latest ? <button type="button" className="btn btn-sec btn-sm" onClick={reviewLatest} disabled={!parsed}>以最新规则重审</button> : <button type="button" className="btn btn-sec btn-sm" onClick={() => void refreshLatest()}>读取最新规则</button>}</div>}
          <div className="m-admin-toolbar"><span className="m-admin-muted">当前版本 {current.version} · {changed.length} 项变更</span><button type="button" className="btn btn-pri btn-sm" disabled={permission !== "superadmin" || (retry ? false : !editable || !parsed || changed.length === 0)} onClick={() => setConfirm(true)}>{retry ? "继续确认上次提交" : "预览并保存"}</button></div>
        </>}
      </div>
      <aside className="m-admin-panel">
        <h2>影响预览</h2>
        <div className="m-admin-muted">已配置的能力按新规则计算；未配置的能力保持不可用。</div>
        <div className="m-admin-stats"><div className="m-admin-stat">沉睡判定<strong>{parsed?.dormantDays == null ? "未配置" : "可用"}</strong></div><div className="m-admin-stat">维护待办<strong>{parsed?.maintenanceDays == null ? "未配置" : "可用"}</strong></div><div className="m-admin-stat">活跃统计<strong>{parsed?.activityWindowDays == null ? "未配置" : "可用"}</strong></div></div>
        <div className="m-admin-muted">继承规则只影响之后的新注册；现有客户归属和待绑定池不会自动重排。变更天数只重算对应标签，不生成维护执行或成功记录。</div>
      </aside>
      {confirm && current && parsed && permission === "superadmin" && <Modal title="确认保存服务规则" icon="gauge" onClose={() => { if (!saving) setConfirm(false); }} busy={saving} wide footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => setConfirm(false)}>返回</button><button type="button" className="btn btn-pri btn-sm" disabled={permission !== "superadmin" || (!canConfirm && !retry) || saving || Boolean(latest)} onClick={() => void save()}>{saving ? "保存中…" : retry ? "使用同一命令重试" : "确认保存"}</button></>}>
        <div className="m-admin-muted">仅保存下列实际修改；其余规则保留。更新后按新规则重新计算对应标签，继承只作用于未来注册。</div>
        <div className="m-admin-list">{changed.map((field) => <div key={field}>{LABELS[field]}：{labelValue(field, current[field])} → {labelValue(field, parsed[field])}</div>)}</div>
        <label className="field"><span>修改理由（8–200 字）</span><textarea value={reason} maxLength={200} disabled={saving || Boolean(retry)} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="m-admin-muted">已输入 {reason.trim().length}/200 字</div>
        {retry && <div className="m-admin-error">上次提交结果未确认。请先查询结果，或使用同一命令重试。<button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => void checkPending()}>查询上次结果</button></div>}
        {error && <div className="m-admin-error" role="alert">{error}</div>}
      </Modal>}
    </section>
  );
}
