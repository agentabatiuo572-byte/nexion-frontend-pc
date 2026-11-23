"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bot, History, Layers3, PackageCheck, RefreshCw, Smartphone } from "lucide-react";
import { BlockState, Button, Fact, Facts, Field, Input, Modal, Notice, PageHeader, Panel, Segments, Select, StatusTag, Steps, Table, Td, Th, Timeline, Tr } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { eligibleArtifacts, languages, livePolicies, platforms, requestUpdates, targetPolicies, type Action, type Language, type Platform, type PlatformUpdates, type Snapshot } from "@/lib/admin/app-updates-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { AppVersionCommand, PolicyChanges, ReleaseChanges, actionNames, languageOptions } from "./app-version-command";

const stageNames = { idle: "无待办", draft: "草稿", pending: "待独立审批", approved: "已批准待发布" };
const phoneCopy = {
  zh: { required: "需要更新才能继续", optional: "有新版本可用", current: "已是最新版本", update: "立即更新", later: "稍后再说" },
  en: { required: "Update required", optional: "An update is available", current: "You’re up to date", update: "Update now", later: "Not now" },
  vi: { required: "Cần cập nhật để tiếp tục", optional: "Đã có phiên bản mới", current: "Bạn đang dùng bản mới nhất", update: "Cập nhật ngay", later: "Để sau" },
};
const platformKeys = Object.keys(platforms) as Platform[];

function stage(state: Snapshot) {
  if (state.restoring) return `恢复策略 · ${stageNames[state.status]}`;
  return state.status === "idle" && state.live ? "已发布" : stageNames[state.status];
}

function Preview({ state, language }: { state: PlatformUpdates; language: Language }) {
  const [source, setSource] = useState("candidate");
  const [installed, setInstalled] = useState("1");
  const [installedResource, setInstalledResource] = useState("");
  const [open, setOpen] = useState(false);
  const hasCandidate = state.status !== "idle";
  const chosen = hasCandidate ? source : "live";
  const policies = chosen === "candidate" ? targetPolicies(state) : livePolicies(state);
  const build = Number(installed);
  const resourceBuild = Number(installedResource);
  const validHost = installed.trim() !== "" && Number.isSafeInteger(build) && build > 0;
  const validResource = installedResource === "" || (Number.isSafeInteger(resourceBuild) && resourceBuild > 0);
  const valid = validHost && (!policies.resource || validResource);
  const registered = (item: typeof policies.package) => item && state.artifacts.some(a =>
    a.artifactId === item.artifactId && a.sha256 === item.sha256 && a.downloadUrl === item.downloadUrl);
  const pkg = registered(policies.package) ? policies.package : null;
  const resource = registered(policies.resource) ? policies.resource : null;
  const compatible = resource && resource.minNativeBuild != null && resource.maxNativeBuild != null
    && build >= resource.minNativeBuild && build <= resource.maxNativeBuild && installedResource !== "";
  const packageUpdate = pkg && build < pkg.latestBuild;
  const policy = packageUpdate ? pkg : compatible ? resource : pkg;
  const decision = packageUpdate && build < pkg.minBuild ? "required"
    : packageUpdate || (compatible && resourceBuild < resource.latestBuild) ? "optional" : "current";
  const text = phoneCopy[language];
  return <Panel title="App 上的样子" icon={Smartphone} tone="role-2" sub={`${platforms[state.platform]} · ${languages[language]}`}>
    <div className="rd-form-stack">
      <Field label="预览策略">{control => <Select {...control} aria-label="预览策略" value={chosen} onChange={setSource} options={[
        ...(hasCandidate ? [{ value: "candidate", label: "待发布策略" }] : []), { value: "live", label: "当前线上策略" },
      ]} />}</Field>
      <Field label="手机已装构建号" error={validHost ? undefined : "请输入大于零的整数。"}>{control =>
        <Input {...control} type="number" min={1} step={1} value={installed} onChange={e => setInstalled(e.target.value)} />}</Field>
      {resource && <Field label="手机已装资源构建号" help="使用手机版本更新页里的资源构建号。留空时只检查整包。" error={validResource ? undefined : "请输入大于零的整数。"}>{control =>
        <Input {...control} type="number" min={1} step={1} value={installedResource} onChange={e => setInstalledResource(e.target.value)} />}</Field>}
      {valid && (policy ? <>
        <Notice tone={decision === "required" ? "warn" : decision === "optional" ? "progress" : "ok"} title={text[decision]}>
          {decision === "required" ? policy.reasons[language] : decision === "optional" ? policy.notes[language] : undefined}
        </Notice>
        <Facts>
          {policy.updateType === "package" ? <>
            <Fact k="必须更新">{policy.minBuild === 1 ? "无此区间" : `小于 ${policy.minBuild}`}</Fact>
            <Fact k="可以稍后更新">{policy.minBuild === policy.latestBuild ? "无此区间" : `${policy.minBuild} 至 ${policy.latestBuild - 1}`}</Fact>
            <Fact k="已是最新版本">{policy.latestBuild} 及以上</Fact></> : <>
            <Fact k="适用安装包构建号">{policy.minNativeBuild} 至 {policy.maxNativeBuild}</Fact>
            <Fact k="最新资源构建号">{policy.latestBuild}</Fact></>}
        </Facts>
        <Button onClick={() => setOpen(true)}>查看手机预览</Button>
      </> : <Notice tone="neutral" title="此策略不显示更新提示" />)}
    </div>
    {open && policy && <Modal title="手机提示预览" icon={Smartphone} onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭预览</Button>}>
      <div className="av-phone" lang={language}>
        <Smartphone size={26} aria-hidden /><h3>{text[decision]}</h3>
        <p>UVEL {policy.versionName}</p>
        {decision !== "current" && <><p>{decision === "required" ? policy.reasons[language] : policy.notes[language]}</p>
          <div className="av-phone-primary">{text.update}</div>{decision === "optional" && <span>{text.later}</span>}</>}
      </div>
    </Modal>}
  </Panel>;
}

function VersionDetails({ state, onSaved, refresh }: { state: PlatformUpdates; onSaved: (value: PlatformUpdates) => void; refresh: () => void }) {
  const [language, setLanguage] = useState<Language>("zh");
  const [action, setAction] = useState<Action | null>(null);
  const [allRecords, setAllRecords] = useState(false);
  const shown = state.status === "idle" ? state.live : state.candidate;
  const step = state.status === "draft" ? 0 : state.status === "pending" ? 1 : 2;
  const allowed = state.allowedActions;
  const title = state.restoring ? "待恢复策略" : state.status === "idle" ? "线上策略" : "待发布策略";
  const available = eligibleArtifacts(state).length > 0;
  const live = livePolicies(state);
  const history = allRecords ? state.history : state.history.slice(0, 2);
  const submitted = state.status === "pending" || state.status === "approved" ? state.history.find(event => event.action === "submit" || event.action === "restore") : null;
  const approved = state.status === "approved" ? state.history.find(event => event.action === "approve") : null;
  const actions = (["submit", "approve", "publish", "save", "withdraw", "reject"] as const).filter(key => allowed.includes(key));
  return <>
    <div className="av-grid"><div className="rd-tab-stack">
      <Panel title={`${platforms[state.platform]} · ${title}`} icon={PackageCheck} tone="role-3"
        actions={<StatusTag tone={state.status === "pending" ? "warn" : state.status === "approved" ? "progress" : "neutral"}>{stage(state)}</StatusTag>}>
        <div className="rd-form-stack">
          {shown ? <>
            <div className="av-metrics">{[["版本名称", shown.versionName], [shown.updateType === "package" ? "安装包构建号" : "资源构建号", shown.latestBuild],
              shown.updateType === "package" ? ["最低支持构建号", shown.minBuild] : ["适用安装包构建号", `${shown.minNativeBuild} 至 ${shown.maxNativeBuild}`]].map(([label, value]) =>
              <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            <div className="av-package"><PackageCheck size={16} aria-hidden />{shown.updateType === "package" ? "官方整包" : "已核实资源包"} · {platforms[state.platform]}</div>
          </> : <Notice tone="neutral" title={state.restoring ? "恢复后停止显示更新提示" : "尚未发布更新策略"} />}
          {state.status === "idle" && live.package && live.resource && <Facts>
            <Fact k="线上整包">{live.package.versionName} · {live.package.latestBuild} · 最低 {live.package.minBuild}</Fact>
            <Fact k="线上日常更新">{live.resource.versionName} · {live.resource.latestBuild}</Fact>
          </Facts>}
          <Segments label="预览语言" value={language} items={languageOptions} onChange={setLanguage} />
          {shown && <div className="av-notes"><h3>更新说明</h3><p lang={language}>{shown.notes[language]}</p>
            {shown.reasons[language] && <><h3>必须更新的原因</h3><p lang={language}>{shown.reasons[language]}</p></>}</div>}
          {state.status !== "idle" && <Steps label="发布步骤" items={(state.autoPublishOnApproval
            ? ["准备草稿", "超管审批后自动发布"] : ["准备草稿", "独立审批", "发布生效"]).map((label, index) =>
            ({ label, state: index < step ? "done" : index === step ? "current" : "todo" }))} />}
          {submitted && <p className="rd-note">发起人 {maskAuditActor(submitted.actor)}{approved && ` · 审批人 ${maskAuditActor(approved.actor)}`}</p>}
          {state.requestReason && <p className="rd-note">申请理由 · {state.requestReason}</p>}
          {state.status === "pending" && !allowed.includes("approve") && <p className="rd-note">等待未参与本次编辑或提交的{state.autoPublishOnApproval ? "超管" : "有权管理员"}审核。</p>}
          {allowed.includes("save") && !available && <Notice tone="warn" title="当前没有可用于新版本的已核实产物">请先完成该平台的构建和产物核实，再刷新版本记录。</Notice>}
          {actions.length > 0 && <div className="av-actions">{actions.map((key, index) =>
            <Button key={key} variant={index === 0 ? "primary" : "secondary"}
              disabledReason={key === "save" && !available ? "没有可用产物" : undefined}
              onClick={() => setAction(key)}>{key === "save" ? (state.status === "draft" ? "编辑草稿" : "创建版本草稿")
                : key === "publish" && state.restoring ? "发布恢复策略" : actionNames[key]}</Button>)}</div>}
        </div>
      </Panel>
      <Panel title="发布记录" icon={History} sub={`${state.history.length} 条`}
        actions={state.canRestore && allowed.includes("restore") && <Button size="sm" onClick={() => setAction("restore")}>恢复上一策略</Button>}>
        <Timeline entries={history.map((item, index) => {
          const autoPublished = item.action === "approve" && item.before.candidate != null
            && item.after.livePackage?.releaseId === item.before.candidate.releaseId;
          return {
          id: `${item.createdAt}-${index}`, action: autoPublished ? "已批准并自动发布"
            : item.action === "publish" && item.before.restoring ? "已发布恢复策略" : actionNames[item.action],
          actor: item.actor, at: item.createdAt, detail: <><p>{item.reason}</p><details><summary>查看变更</summary>
            <p>{stage(item.before)} → {stage(item.after)}</p>
            {item.action === "publish" || autoPublished ? <ReleaseChanges before={livePolicies(item.before)} after={livePolicies(item.after)} />
              : item.action === "restore" || item.before.restoring || item.after.restoring
                ? <ReleaseChanges before={livePolicies(item.before)} after={targetPolicies(item.after)} />
                : <PolicyChanges before={item.before.candidate} after={item.after.candidate} />}
          </details></>,
          };
        })} />
        {state.history.length > 2 && <Button size="sm" variant="ghost" onClick={() => setAllRecords(!allRecords)}>{allRecords ? "收起记录" : "查看全部记录"}</Button>}
      </Panel>
    </div><Preview state={state} language={language} /></div>
    {action && <AppVersionCommand state={state} action={action} language={language} onClose={() => setAction(null)}
      onReload={() => { setAction(null); refresh(); }} onSaved={value => { setAction(null); onSaved(value); }} />}
  </>;
}

export function AppVersionManager() {
  const session = useAdminAuth(s => s.session);
  const canRead = session?.role === "superadmin" || session?.authorities.includes("platform_a3_read");
  const [platform, setPlatform] = useState<Platform>("android");
  const [records, setRecords] = useState<Partial<Record<Platform, PlatformUpdates>>>({});
  const [errors, setErrors] = useState<Partial<Record<Platform, string>>>({});
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setLoading(true); setErrors({}); setRecords({});
    void Promise.allSettled(platformKeys.map(key => requestUpdates(key))).then(results => {
      if (!active) return;
      const data: typeof records = {}, failures: typeof errors = {};
      results.forEach((result, i) => {
        if (result.status === "fulfilled") data[platformKeys[i]] = result.value;
        else failures[platformKeys[i]] = displayAdminError(result.reason);
      });
      setRecords(data); setErrors(failures); setLoading(false);
    });
    return () => { active = false; };
  }, [canRead, reload]);
  const refresh = () => setReload(v => v + 1);
  const state = records[platform];
  return <div id="app-versions" className="rd-tab-stack av-manager">
    <PageHeader pageId="A3-app-versions" title="App 版本管理" summary="管理 Android 和 iOS 的更新提示与发布策略。"
      back={<a href="#a3-installer"><ArrowLeft size={14} aria-hidden />返回官方应用下载</a>}
      actions={canRead && <Button size="sm" icon={<RefreshCw size={14} />} loading={loading} onClick={refresh}>刷新版本记录</Button>} />
    {!canRead ? <BlockState state="denied" title="没有查看 App 版本策略的权限" /> : <>
      <Panel title="平台版本" icon={Layers3} tone="role-2" sub="2 个平台" flush>
        <Table label="平台版本"><thead><tr><Th>平台</Th><Th>线上版本</Th><Th align="right">线上构建号</Th><Th align="right">最低支持构建号</Th><Th>发布进度</Th><Th sticky="end">操作</Th></tr></thead>
          <tbody>{platformKeys.map(key => { const row = records[key], Icon = key === "android" ? Bot : Smartphone; return <Tr key={key} selected={key === platform}>
            <Td><span className="av-name"><Icon size={16} />{platforms[key]}</span></Td>
            <Td>{row ? row.live?.versionName ?? "无策略" : "—"}</Td><Td align="right">{row?.live?.latestBuild ?? "—"}</Td><Td align="right">{row ? livePolicies(row).package?.minBuild ?? "—" : "—"}</Td>
            <Td>{row ? stage(row) : errors[key] ? "读取失败" : "读取中"}</Td>
            <Td sticky="end"><Button size="sm" variant="ghost" aria-label={`查看 ${platforms[key]} 策略`} aria-pressed={platform === key} onClick={() => setPlatform(key)}>{platform === key ? "当前平台" : "查看策略"}</Button></Td>
          </Tr>; })}</tbody></Table>
      </Panel>
      {loading ? <BlockState state="loading" title="正在读取平台版本…" /> : state
        ? <VersionDetails key={platform} state={state} refresh={refresh} onSaved={value => setRecords(old => ({ ...old, [value.platform]: value }))} />
        : <BlockState state="error" title={`${platforms[platform]} 版本读取失败`} detail={errors[platform]} onRetry={refresh} />}
    </>}
  </div>;
}
