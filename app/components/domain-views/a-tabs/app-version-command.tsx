"use client";

import { useRef, useState } from "react";
import { PackageCheck, ShieldCheck } from "lucide-react";
import { Button, Change, Fact, Facts, Field, Fold, Input, Modal, Notice, Segments, Select, StatusTag, Textarea } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { languages, platforms, requestUpdates, UpdateError, type Action, type ActionBody, type Artifact, type Draft, type Language, type PlatformUpdates, type Policy } from "@/lib/admin/app-updates-client";
import { toast } from "@/lib/store/ui";

export const languageOptions = (Object.keys(languages) as Language[]).map(value => ({ value, label: languages[value] }));
export const actionNames: Record<Action, string> = {
  save: "保存草稿", submit: "提交审批", withdraw: "撤回申请", reject: "驳回申请", approve: "批准申请", publish: "发布已批准版本", restore: "恢复上一策略",
};
const outcomes: Record<Action, string> = {
  save: "已保存草稿", submit: "已提交独立审批", withdraw: "已撤回申请", reject: "已驳回申请", approve: "审批已通过，等待发布", publish: "策略已发布", restore: "已提交恢复审批",
};
const effects: Record<Exclude<Action, "save">, string> = {
  submit: "提交后冻结本次草稿，由未参与编辑或提交的另一位管理员审核。",
  withdraw: "撤回后退出待审，线上策略继续生效。",
  reject: "驳回后退回运营处理，本次理由保存在发布记录。",
  approve: "批准后等待有权管理员发布。对应平台的用户继续使用当前线上策略。",
  publish: "发布后，此平台的客户端在下次检查时读取这份策略。",
  restore: "恢复申请须由另一位管理员批准并发布。已安装的客户端会保留当前软件版本。",
};

export function PolicyChanges({ before, after }: { before: Policy | null; after: Policy | null }) {
  return <div className="av-changes"><Facts>
    <Fact k="版本名称"><Change from={before?.versionName ?? "无策略"} to={after?.versionName ?? "无策略"} /></Fact>
    <Fact k="最新构建号"><Change from={before?.latestBuild ?? "—"} to={after?.latestBuild ?? "—"} /></Fact>
    <Fact k="最低支持构建号"><Change from={before?.minBuild ?? "—"} to={after?.minBuild ?? "—"} /></Fact>
    <Fact k="下载目标"><Change from={before?.downloadUrl ?? "—"} to={after?.downloadUrl ?? "—"} /></Fact>
  </Facts><details><summary>产物与三语文案对照</summary><Facts>
    <Fact k="产物编号"><Change from={before?.artifactId ?? "—"} to={after?.artifactId ?? "—"} /></Fact>
    <Fact k="SHA-256"><Change from={before?.sha256 || "—"} to={after?.sha256 || "—"} /></Fact>
    {languageOptions.map(({ value, label }) => <Fact key={value} k={`${label} · 更新说明`}>
      <Change from={before?.notes[value] || "—"} to={after?.notes[value] || "—"} /></Fact>)}
    {languageOptions.map(({ value, label }) => <Fact key={value} k={`${label} · 强更原因`}>
      <Change from={before?.reasons[value] || "—"} to={after?.reasons[value] || "—"} /></Fact>)}
  </Facts></details></div>;
}

function artifactName(item: Artifact) {
  return `${item.versionName} · 构建 ${item.latestBuild} · ${item.updateType === "package" ? "官方整包" : "资源包"}`;
}

export function AppVersionCommand({ state, action, language, onClose, onReload, onSaved }: {
  state: PlatformUpdates; action: Action; language: Language; onClose: () => void; onReload: () => void; onSaved: (value: PlatformUpdates) => void;
}) {
  const editing = state.status === "draft" ? state.candidate : null;
  const base = editing ?? state.live;
  const artifacts = state.artifacts.filter(item => item.latestBuild > (state.live?.latestBuild ?? 0));
  const [artifactId, setArtifactId] = useState(editing?.artifactId ?? "");
  const [minimum, setMinimum] = useState(String(base?.minBuild ?? 1));
  const [notes, setNotes] = useState(editing?.notes ?? { zh: "", en: "", vi: "" });
  const [reasons, setReasons] = useState(base?.reasons ?? { zh: "", en: "", vi: "" });
  const [locale, setLocale] = useState(language);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const attempt = useRef<ActionBody | null>(null);
  const inFlight = useRef(false);
  const locked = busy || uncertain || conflict;
  const artifact = artifacts.find(item => item.artifactId === artifactId);
  const min = Number(minimum);
  const needsReasons = min > 1;
  const target = action === "restore" ? state.previous : state.candidate;
  const saving = action === "save";
  const title = saving ? editing ? "编辑版本草稿" : "创建版本草稿"
    : action === "restore" ? "申请恢复上一策略" : action === "publish" && state.restoring ? "发布恢复策略" : actionNames[action];
  const close = () => {
    if (busy) return;
    if (!uncertain && !conflict && dirty && !discard) setDiscard(true);
    else if (uncertain || conflict) onReload();
    else onClose();
  };

  async function send() {
    if (inFlight.current || conflict) return;
    let body = attempt.current;
    if (!body) {
      let policy: Draft | undefined;
      if (saving) {
        if (!artifact) { setError("请选择已核实的构建产物。"); return; }
        if (!Number.isSafeInteger(min) || min < 1 || min > artifact.latestBuild) { setError(`最低支持构建号须在 1 至 ${artifact.latestBuild} 之间。`); return; }
        for (const { value, label } of languageOptions) {
          if (!notes[value]?.trim() || (needsReasons && !reasons[value]?.trim())) {
            setLocale(value); setError(`请补全 ${label} ${notes[value]?.trim() ? "必须更新的原因" : "更新说明"}。`); return;
          }
        }
        policy = { artifactId, minBuild: min, notes, reasons };
      } else if (reason.trim().length < 8 || reason.trim().length > 200) {
        setError("请填写 8 至 200 字的操作理由。"); return;
      }
      body = { revision: state.revision, requestId: crypto.randomUUID(), reason: reason.trim(), ...(policy && { policy }) };
      attempt.current = body;
    }
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const saved = await requestUpdates(state.platform, { action, body });
      toast.success(outcomes[action]); onSaved(saved);
    } catch (cause) {
      const known = cause instanceof UpdateError && cause.status >= 400 && cause.status < 500;
      if (known) {
        attempt.current = null; setUncertain(false);
        setConflict(cause.status === 409 || cause.status === 403 || cause.status === 401);
      } else setUncertain(true);
      setError(displayAdminError(cause));
    } finally { inFlight.current = false; setBusy(false); }
  }

  const feedback = <>
    {error && <Notice tone="danger" title={error}>{uncertain ? "尚未确认结果。可以用同一请求重试，也可重新读取发布记录。" : conflict ? "请重新读取记录，核对当前状态和权限。" : undefined}</Notice>}
    {discard && <Notice tone="warn" title="修改尚未保存，是否放弃？" />}
  </>;
  const footer = discard ? <>
    <Button onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onClose}>放弃修改</Button>
  </> : <>
    <Button onClick={close} disabled={busy}>{uncertain || conflict ? "重新读取记录" : "取消"}</Button>
    {!conflict && <Button variant="primary" loading={busy} onClick={() => void send()}>{uncertain ? "按原请求重试" : saving ? "保存草稿" : action === "publish" ? "确认发布" : action === "restore" ? "提交恢复审批" : actionNames[action]}</Button>}
  </>;
  if (saving) return <Modal className="av-editor" title={title} icon={PackageCheck} sub={`${platforms[state.platform]} · 版本草稿`} onClose={close} dirty={dirty} busy={busy} footer={footer}>
    <div className="rd-form-stack" onChange={() => setDirty(true)}>
      <Field label="已核实的构建产物" required>{control =>
        <Select {...control} aria-label="已核实的构建产物" value={artifactId} placeholder="选择构建产物" disabled={locked}
          options={artifacts.map(item => ({ value: item.artifactId, label: artifactName(item) }))}
          onChange={value => { setArtifactId(value); setDirty(true); }} />}</Field>
      {artifact && <Fold inset defaultOpen title="产物资料" summary={artifactName(artifact)}><Facts>
        <Fact k="版本名称">{artifact.versionName}</Fact><Fact k="安装包构建号">{artifact.latestBuild}</Fact>
        <Fact k="更新方式">{artifact.updateType === "package" ? "官方整包" : "已核实资源包"}</Fact>
        <Fact k="下载目标">{artifact.downloadUrl}</Fact><Fact k="SHA-256">{artifact.sha256}</Fact>
        {artifact.updateType === "resource" && <Fact k="适用基座构建号">{artifact.minNativeBuild} 至 {artifact.maxNativeBuild}</Fact>}
      </Facts></Fold>}
      <Field label="最低支持构建号" required>{control =>
        <Input {...control} type="number" step={1} min={1} max={artifact?.latestBuild} value={minimum} disabled={locked} onChange={e => setMinimum(e.target.value)} />}</Field>
      <Segments label="编辑语言" items={languageOptions} value={locale} onChange={setLocale} />
      <Field label={`更新说明 · ${languages[locale]}`} required>{control =>
        <Textarea {...control} rows={4} maxLength={1000} disabled={locked} value={notes[locale] ?? ""} onChange={e => setNotes({ ...notes, [locale]: e.target.value })} />}</Field>
      {(needsReasons || reasons[locale]) && <Field label={`必须更新的原因 · ${languages[locale]}`} required={needsReasons}
        help={needsReasons ? "请分别填写三种语言的原因，低于门槛的用户会看到对应语言的提示。" : undefined}>{control =>
        <Textarea {...control} rows={3} maxLength={1000} disabled={locked} value={reasons[locale] ?? ""} onChange={e => setReasons({ ...reasons, [locale]: e.target.value })} />}</Field>}
      {feedback}
    </div>
  </Modal>;
  return <Modal title={title} icon={ShieldCheck} dirty={dirty} busy={busy} onClose={close} footer={footer}
    sub={<StatusTag tone={action === "publish" ? "warn" : "progress"}>{action === "publish" ? "确认后生效" : "线上策略继续生效"}</StatusTag>}>
    <div className="rd-form-stack">
      <p>{platforms[state.platform]} · {effects[action]}</p>
      <PolicyChanges before={state.live} after={target} />
      {state.requestReason && <p>申请理由 · {state.requestReason}</p>}
      {target && target.minBuild > (state.live?.minBuild ?? 1) && <Notice tone="warn" title={`构建号低于 ${target.minBuild} 的设备必须更新`}>{target.reasons[language]}</Notice>}
      <Field label="操作理由" hint="8 至 200 字" required>{control => <Textarea {...control} value={reason} rows={3} maxLength={200}
        disabled={locked} onChange={e => { setReason(e.target.value); setDirty(true); }} />}</Field>
      {feedback}
    </div>
  </Modal>;
}
