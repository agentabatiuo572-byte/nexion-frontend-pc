"use client";

/**
 * A3 App 分享与下载（W05 整组保存），保留原请求字段及验证：
 * 刷新失败清掉表单（BUG-093），理由在点保存时校验8–200；原body由共用store保存，未知后只原样恢复。
 * 新加的只有界面：分区、每块旁边的「App 上的样子」、保存前的确认框；推荐渠道只填进表单，保存了才生效。
 * App 的拼法照 App share.ts：链接 = 分享基础链接 + 邀请码；外链模板里 {link}、{text} 各换第一个，编码后代入。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleOff, Download, FilePen, Globe, Home, Languages, Link2, Share2, Smartphone, type LucideIcon } from "lucide-react";
import { BlockState, Button, Cell, Change, Check, DiffList, Explain, Fold, KeepText, Fact, Facts, Field, Input, Modal, Notice, Panel, Segments, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr, type DiffRow } from "@/app/components/rd";
import { useReach } from "@/lib/nav/use-reach";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { type A3RecoveryProps } from "@/lib/admin/a3-mutations";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import {
  changedOperatingLanguages,
  fetchPlatformExperienceConfig,
  INTERFACE_LANGUAGES,
  OPERATING_LANGUAGE_CODES,
  recommendedExperienceChannels,
  platformExperienceBody,
  type PlatformExperienceConfig,
} from "@/lib/admin/platform-experience-client";

const CHANNEL_NAME: Record<string, string> = { zalo: "Zalo", telegram: "Telegram", whatsapp: "WhatsApp", messenger: "Messenger", sms: "短信", x: "X", copy: "复制链接", poster: "分享海报", system: "系统分享" };
const INTENT_NAME: Record<string, string> = { scheme: "打开应用", web: "打开链接", copy: "复制链接", poster: "生成海报", system: "系统分享" };
/**
 * App（origin/test 3359a77e）：团队页邀请卡固定有「分享海报」「复制链接」；外部渠道只在分享海报里出现，
 * 打开链接和打开应用两类合计取前 4 个（share-poster-sheet linkChannels），系统分享排在最后叫「更多」，
 * 网页版要浏览器支持、原生 App 照常显示（share.ts visibleChannels）。scheme 点了复制文案并引导去该 App 粘贴。
 */
const IN_APP: Record<string, { text: string; tone: "ok" | "neutral" | "warn"; icon?: LucideIcon; explain: string }> = {
  web: { text: "显示", tone: "ok", explain: "启用后出现在 App 的分享海报里，点了用链接模板打开对应网页或短信。打开链接和打开应用两类合计只显示前 4 个。" },
  scheme: { text: "显示", tone: "ok", explain: "启用后出现在 App 的分享海报里。点了复制邀请文案，提示用户去这个 App 粘贴；不计入分享次数。打开链接和打开应用两类合计只显示前 4 个。" },
  system: { text: "显示", tone: "ok", icon: Globe, explain: "启用后排在分享海报渠道的最后，叫「更多」，点了调起手机自带的分享。网页版要浏览器支持才显示。" },
  copy: { text: "App 固定有", tone: "neutral", icon: Smartphone, explain: "App 团队页和分享海报里固定有「复制链接」，这里关掉也还在。" },
  poster: { text: "App 固定有", tone: "neutral", icon: Smartphone, explain: "App 团队页固定有「分享海报」按钮，这里关掉也还在。" },
};
const SAMPLE_CODE = "AB12CD";
/** 发布必填语言的叫法（英语、中文、越南语），按九语目录里的中文名。 */
const operatingNames = (value: readonly string[]) => INTERFACE_LANGUAGES.filter((language) => value.includes(language.code)).sort((a, b) => a.code === "en" ? -1 : b.code === "en" ? 1 : 0).map((language) => language.zhName).join("、");

/** 版本冲突后：你留着的修改和刚读到的最新值逐项对照（现在 = 最新值，改后 = 你填的）。 */
function draftVsLatest(draft: PlatformExperienceConfig, latest: PlatformExperienceConfig): DiffRow[] {
  const rows: DiffRow[] = [];
  const add = (key: string, label: string, before: string | null | undefined, after: string | null | undefined) => {
    if ((before ?? "") !== (after ?? "")) rows.push({ key, label, before: before || "空", after: after || "空" });
  };
  const on = (value: boolean) => value ? "启用" : "不启用";
  add("baseUrl", "分享基础链接", latest.baseUrl, draft.baseUrl);
  for (const key of [...new Set([...latest.channels, ...draft.channels].map((channel) => channel.key))]) {
    const was = latest.channels.find((channel) => channel.key === key), mine = draft.channels.find((channel) => channel.key === key);
    const name = CHANNEL_NAME[key] ?? key;
    if (!was || !mine) { add(`channel-${key}`, name, was ? "有这个渠道" : "没有", mine ? "有这个渠道" : "没有"); continue; }
    add(`channel-${key}-on`, `${name} · 启用`, on(was.enabled), on(mine.enabled));
    add(`channel-${key}-text`, `${name} · 文案模板`, was.textTemplate, mine.textTemplate);
    add(`channel-${key}-url`, `${name} · 链接模板`, was.urlTemplate, mine.urlTemplate);
  }
  const source = (value: string) => value === "unavailable" ? "暂不提供" : "官方渠道";
  add("source", "官方下载 · 来源", source(latest.appDownload.source), source(draft.appDownload.source));
  add("officialUrl", "官方安装页", latest.appDownload.officialUrl, draft.appDownload.officialUrl);
  add("version", "安装包版本", latest.appDownload.version, draft.appDownload.version);
  add("iosUrl", "iOS 下载链接", latest.appDownload.iosUrl, draft.appDownload.iosUrl);
  add("androidUrl", "Android 下载链接", latest.appDownload.androidUrl, draft.appDownload.androidUrl);
  add("notesZh", "更新说明（中文）", latest.appDownload.releaseNotes.zh, draft.appDownload.releaseNotes.zh);
  add("notesEn", "更新说明（英文）", latest.appDownload.releaseNotes.en, draft.appDownload.releaseNotes.en);
  const langs = (value: PlatformExperienceConfig["interfaceLanguages"]) => value ? INTERFACE_LANGUAGES.filter((language) => language.base || value.includes(language.code)).map((language) => language.zhName).join("、") : "只能查看";
  add("languages", "界面语言", langs(latest.interfaceLanguages), langs(draft.interfaceLanguages));
  if (latest.operatingLanguages && draft.operatingLanguages) add("operatingLanguages", "发布必填", operatingNames(latest.operatingLanguages), operatingNames(draft.operatingLanguages));
  return rows;
}

/** App channelIntentUrl 的拼法：String.replace 只换第一个。 */
function assemble(textTemplate: string | null | undefined, urlTemplate: string | null | undefined, link: string) {
  const text = (textTemplate ?? "{link}").replace("{link}", link);
  const url = urlTemplate ? urlTemplate.replace("{link}", encodeURIComponent(link)).replace("{text}", encodeURIComponent(text)) : "";
  return { text, url };
}

export function A3Experience({ commands, recovery, onRecovered, nonce, toast }: A3RecoveryProps & { toast: (text: string, kind?: "success" | "error" | "warn" | "info") => void }) {
  const session = useAdminAuth((state) => state.session);
  const reach = useReach();
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [loadedForm, setLoadedForm] = useState<{ config: PlatformExperienceConfig; baseline: PlatformExperienceConfig } | null>(null);
  const setConfig = (config: PlatformExperienceConfig) => setLoadedForm(current => current && { ...current, config });
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState("");
  const [readReady, setReadReady] = useState(false);
  const conflictDraft = useRef(false);
  const original = commands.find("experience");
  const savedForm = original?.original.kind === "experience" ? original.original : null;
  const config = confirmOpen && savedForm ? savedForm.config : loadedForm?.config ?? null;
  const baseline = confirmOpen && savedForm ? savedForm.baseline : loadedForm?.baseline ?? null;
  useEffect(() => {
    if (recovery?.original.kind !== "experience") return;
    setReason(recovery.reason); if (!conflictDraft.current) setError(null); setConfirmOpen(true); onRecovered();
  }, [recovery, onRecovered]);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setReadReady(false); setLoading(true); setSuccess(null);
    if (!conflictDraft.current) setError(null);
    try {
      const next = await fetchPlatformExperienceConfig();
      setLoadedForm(current => ({
        config: conflictDraft.current && current ? {
          ...current.config,
          version: next.version,
          operatingLanguages: next.operatingLanguages && (
            changedOperatingLanguages(current.config.operatingLanguages, current.baseline.operatingLanguages) ?? next.operatingLanguages
          ),
        } : next,
        baseline: next,
      }));
      setReadReady(true); return next;
    }
    catch (cause) {
      if (!conflictDraft.current) setLoadedForm(null);
      setError(previous => conflictDraft.current && previous ? `${previous}；${displayAdminError(cause)}` : displayAdminError(cause));
      return null;
    }
    finally { setLoading(false); }
  }, [canRead]);
  useEffect(() => {
    if (!commands.find("experience")) {
      setReadReady(false); setConfirmOpen(false); setReason(""); conflictDraft.current = false;
    }
    void refresh();
    // The parent changes nonce after original-result queries; the command store is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, nonce]);

  const changed = useMemo(() => {
    if (!config || !baseline) return [] as string[];
    const parts: string[] = [];
    if (config.baseUrl !== baseline.baseUrl) parts.push("分享基础链接");
    if (JSON.stringify(config.channels) !== JSON.stringify(baseline.channels)) parts.push("分享渠道");
    if (JSON.stringify(config.appDownload) !== JSON.stringify(baseline.appDownload)) parts.push("官方应用下载");
    if (JSON.stringify(config.interfaceLanguages) !== JSON.stringify(baseline.interfaceLanguages)) parts.push("界面语言");
    if (changedOperatingLanguages(config.operatingLanguages, baseline.operatingLanguages)) parts.push("发布必填语言");
    return parts;
  }, [config, baseline]);

  if (!canRead) return <BlockState state="denied" title="没有查看 App 分享与下载的权限" />;
  if (loading && !config) return <BlockState state="loading" title="正在读取 App 分享与下载…" />;
  if (!config) return <BlockState state="error" title="App 分享与下载读取失败" detail={<>{error} 读不到时不显示旧表单，免得按旧值保存。</>} onRetry={() => void refresh()} />;

  const patchChannel = (index: number, patch: Record<string, unknown>) => {
    setConfig({ ...config, channels: config.channels.map((channel, rowIndex) => rowIndex === index ? { ...channel, ...patch } : channel) });
  };
  const patchDownload = (patch: Partial<PlatformExperienceConfig["appDownload"]>) => setConfig({ ...config, appDownload: { ...config.appDownload, ...patch } });

  const save = async () => {
    if (!config || !canWrite || saving || loading || (!original && !readReady)) return;
    setSuccess(null);
    if (reason.trim().length < 8 || reason.trim().length > 200) { setError("保存理由必须为 8–200 字，请补充后再保存。"); return; }
    setSaving(true); setError(null);
    try {
      const record = original ?? commands.capture({ original: { kind: "experience", config, baseline: baseline! },
        path: "/api/admin/platform/config/experience", method: "PUT",
        body: JSON.stringify(platformExperienceBody(config, reason, session?.operator ?? session?.username ?? "",
          changedOperatingLanguages(config.operatingLanguages, baseline?.operatingLanguages))),
        reason: reason.trim(), name: "App 分享与下载", change: `v${config.version} → v${config.version + 1} · ${changed.join("、")}` });
      await commands.send(record, Boolean(original));
      conflictDraft.current = false;
      setReadReady(false); setConfirmOpen(false); setReason("");
      const saved = await refresh();
      if (saved) { setSuccess(`已保存，当前版本 v${saved.version}。`); toast(`App 分享与下载已保存，当前版本 v${saved.version}`, "success"); }
      else toast(`已保存，但页面刷新失败，正在重新加载。请不要重复提交。`, "warn");
    } catch (cause) {
      setError(displayAdminError(cause));
      if (!original && (cause as { reasonCode?: string }).reasonCode === "PLATFORM_EXPERIENCE_VERSION_CONFLICT" && !commands.find("experience")) {
        // Keep the intended values and reason; only a successful GET supplies a new CAS baseline.
        conflictDraft.current = true; setReadReady(false); setConfirmOpen(false);
        await refresh();
      } else if (original && !commands.find("experience")) { toast(displayAdminError(cause), "error"); setConfirmOpen(false); await refresh(); }
    } finally { setSaving(false); }
  };

  const unavailable = config.appDownload.source === "unavailable";
  const fieldsLocked = !canWrite || loading || saving || Boolean(original) || !readReady;
  const link = config.baseUrl ? `${config.baseUrl}${SAMPLE_CODE}` : "";
  const webChannels = config.channels.filter((channel) => channel.intentType === "web" || channel.intentType === "scheme");
  const previewChannel = webChannels.find((channel) => channel.key === previewKey) ?? webChannels.find((channel) => channel.enabled) ?? webChannels[0];
  const assembled = previewChannel && link ? assemble(previewChannel.textTemplate, previewChannel.urlTemplate, link) : null;
  const visibleInApp = config.channels.filter((channel) => channel.enabled && (channel.intentType === "web" || channel.intentType === "scheme"));
  const systemInApp = config.channels.some((channel) => channel.enabled && channel.intentType === "system");
  // App 分享海报只取前 4 个打开链接、打开应用类渠道（share-poster-sheet linkChannels），排在后面的启用了也不显示。
  const hiddenInApp = visibleInApp.slice(4);
  // 预览里按 App 的顺序列名字，最后两个连在一起换行，不让「更多」单独掉一行。
  const posterChannels = [...visibleInApp.slice(0, 4).map((channel) => CHANNEL_NAME[channel.key] ?? channel.key), ...(systemInApp ? ["更多"] : [])];
  const languages = config.interfaceLanguages;
  const onLanguages = INTERFACE_LANGUAGES.filter((language) => language.base || !languages || languages.includes(language.code));
  // 发布必填：读不到这一项（旧系统）时编辑器按英文、中文、越南语都必填，这里照那个显示，只读。
  const operating = config.operatingLanguages;
  const requiredNow: readonly string[] = operating ?? OPERATING_LANGUAGE_CODES;
  const operatingChanged = changed.includes("发布必填语言");
  const onlyOperating = operatingChanged && changed.length === 1;
  const h3 = reach("/growth/quest", "growth_h3_read");
  const conflictRows = conflictDraft.current && baseline ? draftVsLatest(config, baseline) : [];

  const preview = (title: string, children: ReactNode) => <aside className="a3-preview" aria-label={`App 上的样子：${title}`}>
    <span className="a3-preview-label"><Smartphone size={14} aria-hidden />App 上的样子</span>
    {children}
  </aside>;

  return <div className="rd-tab-stack" data-testid="platform-experience-config" onChange={() => { setSuccess(null); }}>
    <div className="rd-toolbar a3-savebar" data-end="">
      <span className="rd-toolbar-note" data-tone={changed.length ? "warn" : undefined}>
        {changed.length ? `有未保存的修改：${changed.join("、")}` : `版本 v${config.version}${config.updatedAt ? ` · ${formatBusinessTimeCompact(config.updatedAt, "—")} 读取（${businessZone().label}）` : ""}`}
      </span>
      <Button disabled={loading || saving} loading={loading} onClick={() => void refresh()}>刷新</Button>
      {canWrite && <Button variant="primary" disabledReason={original ? "结果未知" : loading || !readReady ? "正在读取" : saving ? "正在提交" : undefined} onClick={() => { if (original || !readReady || !canWrite) return; setError(null); setConfirmOpen(true); }}>保存…</Button>}
    </div>
    {success && <Notice tone="ok">{success}</Notice>}
    {conflictDraft.current && !confirmOpen ? <Notice tone="warn" title="别人刚保存过这组配置，你的修改没有保存"
      action={<Button size="sm" loading={loading} disabled={saving} onClick={() => void refresh()}>重新读取</Button>}>
      {readReady && baseline
        ? <>已读到最新版本 v{baseline.version}，你填的都还在。{conflictRows.length ? `和最新值不同的${conflictRows.length === 1 ? `是「${conflictRows[0].label}」` : `有 ${conflictRows.length} 处`}（左边最新、右边你的），核对后点上方「保存…」重新提交：` : "你填的和最新值一样，不用再保存。"}{conflictRows.length > 0 && <div className="a3-conflict-diff"><DiffList rows={conflictRows} /></div>}</>
        : loading ? "正在读取最新值，你填的都还在。"
          : <>最新值没读到，你填的都还在；先重新读取再核对。{error?.includes("；") ? <span className="rd-note"> {error.split("；").slice(1).join("；")}</span> : null}</>}
    </Notice>
      : error && !confirmOpen && <Notice tone="danger" title={original ? undefined : "没有保存"}>{error}</Notice>}

    <Panel title="分享链接和渠道" icon={Share2} tone="role-2" sub={`${config.channels.length} 个渠道 · 启用 ${config.channels.filter((channel) => channel.enabled).length} 个`}
      explain="App 团队页的「复制链接」「分享海报」都用这里的分享链接；分享海报里的外部渠道按这里的设置显示，能不能打开还要看用户手机上有没有装对应应用。" >
      <div className="a3-with-preview">
        <div className="rd-form-stack">
          <div id="a3-sharing"><Field label="分享基础链接" help="App 把用户的邀请码直接接在后面，不自动补斜杠">
            {(control) => <Input {...control} aria-label="分享基础链接" placeholder="https://… 结尾通常是 / 或 =" value={config.baseUrl} disabled={fieldsLocked} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />}
          </Field></div>
          {config.channels.length === 0 ? <Notice tone="warn" title="还没有设置分享渠道" action={canWrite && <Button size="sm" disabled={fieldsLocked} onClick={() => setConfig({ ...config, channels: recommendedExperienceChannels() })}>填入推荐的 9 个渠道</Button>}>
            App 里只有固定的复制链接和分享海报，海报里没有外部渠道。<KeepText text="填入推荐渠道后要保存才生效。" />
          </Notice> : <Table label="分享渠道">
            <thead><tr><Th>渠道</Th><Th>启用</Th><Th>在 App 里</Th><Th>文案模板</Th><Th>链接模板</Th></tr></thead>
            <tbody>
              {config.channels.map((channel, index) => {
                const inApp = !channel.enabled && (channel.intentType === "web" || channel.intentType === "scheme" || channel.intentType === "system") ? { text: "没启用", tone: "neutral" as const, icon: CircleOff, explain: "没启用的渠道不出现在 App 的分享海报里。" }
                  : hiddenInApp.includes(channel) ? { text: "不显示", tone: "warn" as const, icon: CircleOff, explain: "分享海报里打开链接和打开应用两类合计只显示前 4 个，这个排在后面。要显示，先关掉前面的一个。" } : IN_APP[channel.intentType];
                const name = CHANNEL_NAME[channel.key] ?? channel.key;
                return <Tr key={channel.key} selected={previewChannel?.key === channel.key}>
                  <Td><Cell main={name} sub={INTENT_NAME[channel.intentType] ?? "未知方式"} /></Td>
                  <Td><Check label={<span className="rd-sr-only">{name} 启用</span>} aria-label={`${channel.key} 启用`} checked={channel.enabled} disabled={fieldsLocked} onChange={(event) => patchChannel(index, { enabled: event.target.checked })} /></Td>
                  <Td>{inApp ? <StatusTag tone={inApp.tone} icon={inApp.icon} explain={inApp.explain}>{inApp.text}</StatusTag> : "—"}</Td>
                  <Td><Input aria-label={`${channel.key} 文案模板`} placeholder="可以用 {link}" value={channel.textTemplate ?? ""} disabled={fieldsLocked} onChange={(event) => patchChannel(index, { textTemplate: event.target.value })} onFocus={() => (channel.intentType === "web" || channel.intentType === "scheme") && setPreviewKey(channel.key)} /></Td>
                  <Td>{channel.intentType === "web" || channel.urlTemplate
                    ? <Input aria-label={`${channel.key} 链接模板`} placeholder="https://…{link} 或 {text}" value={channel.urlTemplate ?? ""} disabled={fieldsLocked} onChange={(event) => patchChannel(index, { urlTemplate: event.target.value })} onFocus={() => channel.intentType === "web" && setPreviewKey(channel.key)} />
                    : <span className="rd-note">不用填<Explain label="为什么不用填" content="只有打开链接类渠道用链接模板；其他类型填了会保存不了。" /></span>}</Td>
                </Tr>;
              })}
            </tbody>
          </Table>}
        </div>
        {preview("分享", <>
          <dl className="a3-preview-rows">
            <div><dt>分享出去的链接</dt><dd>{link ? <span className="a3-preview-link">{config.baseUrl}<mark>{SAMPLE_CODE}</mark></span> : <span className="a3-preview-empty">没有链接，App 里分享按钮不可用</span>}</dd></div>
            <div><dt>分享海报里的外部渠道</dt><dd>{posterChannels.length ? <>{posterChannels.slice(0, -2).map((name) => `${name}、`).join("")}<span className="rd-keep">{posterChannels.slice(-2).join("、")}</span></> : "没有"}<span className="a3-preview-sub">{hiddenInApp.length > 0 && <span className="rd-keep">{hiddenInApp.map((channel) => CHANNEL_NAME[channel.key] ?? channel.key).join("、")} 排在第 4 个之后，不显示；</span>}<span className="rd-keep">固定有保存图片、复制链接</span></span></dd></div>
          </dl>
          {webChannels.length > 0 && <>
            <Segments label="看哪个渠道" value={previewChannel?.key ?? ""} onChange={(value) => setPreviewKey(String(value))} items={webChannels.map((channel) => ({ value: channel.key, label: CHANNEL_NAME[channel.key] ?? channel.key }))} />
            {assembled ? <dl className="a3-preview-rows">
              <div><dt>发出去的文案</dt><dd className="a3-preview-text">{assembled.text}</dd></div>
              {previewChannel?.intentType === "scheme"
                ? <div><dt>点了之后</dt><dd>复制上面的文案，提示去 {CHANNEL_NAME[previewChannel.key] ?? previewChannel.key} 粘贴</dd></div>
                : <div><dt>打开的网址</dt><dd className="a3-preview-link">{assembled.url || "—"}</dd></div>}
            </dl> : <p className="rd-note">填了分享基础链接才拼得出来</p>}
          </>}
          <p className="a3-preview-note">{SAMPLE_CODE} 是示例邀请码，每个用户换成自己的。<Explain label="文案模板什么时候不用" content="推荐奖励关着时，App 不用这里的文案模板，改用 App 自带的一句话。" /></p>
        </>)}
      </div>
    </Panel>

    <Panel title="官方应用下载" icon={Download} tone="role-2" sub={unavailable ? "暂不提供" : `官方渠道 · 版本 ${config.appDownload.version || "—"}`}
      explain="用户在注册成功页和下载入口看到的官方安装信息。这里只登记链接和说明，不上传安装包，也不强制用户更新。">
      <div className="a3-with-preview">
        <div className="rd-form-stack">
          <Field label="来源" explain="选「暂不提供」并保存后，安装链接、版本和说明会被清空，App 显示暂不可用。">
            {() => <Segments label="安装包来源" value={config.appDownload.source} onChange={(value) => !fieldsLocked && patchDownload({ source: value as PlatformExperienceConfig["appDownload"]["source"] })}
              items={[{ value: "official", label: "官方渠道", disabled: fieldsLocked }, { value: "unavailable", label: "暂不提供", disabled: fieldsLocked }]} />}
          </Field>
          <div id="a3-installer" className="rd-form-grid" data-cols="2">
            <Field label="官方安装页" required={!unavailable} help="HTTPS，可以带 #download 这类页面锚点">
              {(control) => <Input {...control} aria-label="官方安装链接" value={config.appDownload.officialUrl} disabled={fieldsLocked || unavailable} onChange={(event) => patchDownload({ officialUrl: event.target.value })} />}
            </Field>
            <Field label="版本" required={!unavailable}>
              {(control) => <Input {...control} aria-label="安装包版本" value={config.appDownload.version} disabled={fieldsLocked || unavailable} onChange={(event) => patchDownload({ version: event.target.value })} />}
            </Field>
            <Field label="iOS 下载链接" help="可不填；HTTPS，不能带锚点">
              {(control) => <Input {...control} aria-label="iOS 官方下载链接" value={config.appDownload.iosUrl} disabled={fieldsLocked || unavailable} onChange={(event) => patchDownload({ iosUrl: event.target.value })} />}
            </Field>
            <Field label="Android 下载链接" help="可不填；HTTPS，不能带锚点">
              {(control) => <Input {...control} aria-label="Android 官方下载链接" value={config.appDownload.androidUrl} disabled={fieldsLocked || unavailable} onChange={(event) => patchDownload({ androidUrl: event.target.value })} />}
            </Field>
            <Field label="更新说明（中文）" required={!unavailable}>
              {(control) => <Textarea {...control} aria-label="中文发布说明" rows={2} value={config.appDownload.releaseNotes.zh} disabled={fieldsLocked || unavailable} onChange={(event) => patchDownload({ releaseNotes: { ...config.appDownload.releaseNotes, zh: event.target.value } })} />}
            </Field>
            <Field label="更新说明（英文）" required={!unavailable}>
              {(control) => <Textarea {...control} aria-label="英文发布说明" rows={2} value={config.appDownload.releaseNotes.en} disabled={fieldsLocked || unavailable} onChange={(event) => patchDownload({ releaseNotes: { ...config.appDownload.releaseNotes, en: event.target.value } })} />}
            </Field>
          </div>
          <p className="rd-note">APK 链接：{config.appDownload.apkUrl || "—"}（这里不能改，保存时不变）</p>
        </div>
        {preview("下载", unavailable
          ? <div className="a3-download" data-empty=""><b>暂不提供官方安装包</b><span>用户看到下载暂不可用，没有可点的链接</span></div>
          : <div className="a3-download">
            <b>UVEL {config.appDownload.version || "—"}</b>
            <span className="a3-preview-text">{config.appDownload.releaseNotes.zh || "—"}</span>
            <span className="a3-preview-link">{config.appDownload.officialUrl || "官方安装页还没填"}</span>
            <span className="a3-preview-sub">iOS {config.appDownload.iosUrl ? "有直链" : "没有直链"} · Android {config.appDownload.androidUrl ? "有直链" : "没有直链"}</span>
          </div>)}
      </div>
    </Panel>

    <Panel title="界面语言" icon={Languages} tone="role-3" sub={`${languages ? `开启 ${onLanguages.length} 种，共 ${INTERFACE_LANGUAGES.length} 种` : "开关只能查看"} · 发布必填 ${operatingNames(requiredNow)}`}
      explain={<>
        <p>关闭后，用户在语言列表里看不到这种语言；正在用它的用户改用账号或手机系统的语言，都没开启时用英文。英文始终开启。</p>
        <p>App 下次读到配置后才变；重新开启后，用户原来选的语言会恢复。</p>
        <p>印尼语、马来语、菲律宾语、俄语、哈萨克语、乌兹别克语开启后，App 的说明和文档内容目前仍按英文读取。</p>
      </>}>
      <div className="a3-with-preview">
        <div id="a3-languages" className="rd-form-stack">
          <Table label="界面语言和发布必填">
            <thead><tr>
              <Th>语言</Th>
              <Th icon={Smartphone}>App 里可选<Explain label="App 里可选是什么" content="开着的语言出现在 App 的语言列表里，用户可以选。" /></Th>
              <Th icon={FilePen}>发布时必填<Explain label="发布时必填是什么" content={<><p>后台发布活动、课程、公告等内容时，勾上的语言必须填。没勾的语言可以不填，App 在这种语言下显示英文。</p><p>改了以后，下次打开内容编辑器时按新的检查；已发布的内容不变。</p></>} /></Th>
            </tr></thead>
            <tbody>
              {INTERFACE_LANGUAGES.map((language) => {
                const operatingCode = OPERATING_LANGUAGE_CODES.find((code) => code === language.code);
                return <Tr key={language.code}>
                  <Td><Cell main={language.nativeName} sub={`${language.zhName} · ${language.code}`} /></Td>
                  <Td>
                    <Check label={<><span className="rd-sr-only">{language.zhName} App 里可选</span>{language.base && <span className="rd-note">始终开启</span>}</>} aria-label={`${language.zhName} 开启`}
                      checked={language.base || !languages || languages.includes(language.code)}
                      disabled={fieldsLocked || language.base || !languages}
                      onChange={(event) => languages && setConfig({ ...config, interfaceLanguages: INTERFACE_LANGUAGES.map((item) => item.code).filter((code) => code === language.code ? event.target.checked : languages.includes(code)) })} />
                  </Td>
                  <Td>{operatingCode
                    ? <Check label={<><span className="rd-sr-only">{language.zhName} 发布时必填</span>{operatingCode === "en" && <span className="rd-note">始终必填</span>}</>} aria-label={`${language.zhName} 发布必填`}
                      checked={requiredNow.includes(operatingCode)}
                      disabled={fieldsLocked || operatingCode === "en" || !operating}
                      onChange={(event) => operating && setConfig({ ...config, operatingLanguages: OPERATING_LANGUAGE_CODES.filter((code) => code === operatingCode ? event.target.checked : operating.includes(code)) })} />
                    : <span className="rd-note">暂不支持<Explain label={`${language.zhName}为什么不能设为必填`} content="不能设为必填。App 在这种语言下显示英文。" /></span>}</Td>
                </Tr>;
              })}
            </tbody>
          </Table>
          {(!languages || !operating) && <p className="rd-note">{!languages && !operating ? "系统支持后才能在这里开关界面语言、设置发布必填；现在英文、中文、越南语都必填。"
            : !languages ? "系统支持后，可以在这里开关界面语言，现在只能查看。"
            : "系统支持后才能设置发布必填，现在英文、中文、越南语都必填。"}</p>}
        </div>
        {preview("语言", <ul className="a3-preview-langs" aria-label="App 语言列表">
          {onLanguages.map((language) => <li key={language.code}>{language.nativeName}</li>)}
        </ul>)}
      </div>
    </Panel>

    <Panel title="首页开关" icon={Home} tone="role-other" sub="只读 · 在用户任务管理里改"
      explain="App 首页的新手任务和周促销入口。这里只显示，开关在「用户任务管理」里；开着也要有进行中的任务才会显示。">
      <dl className="a3-readonly">
        <div><dt>首页新手任务</dt><dd><StatusTag tone={config.homeNewcomerTasksEnabled ? "ok" : "neutral"} icon={config.homeNewcomerTasksEnabled ? undefined : CircleOff}>{config.homeNewcomerTasksEnabled ? "已开启" : "已关闭"}</StatusTag></dd></div>
        <div><dt>首页周促销</dt><dd><StatusTag tone={config.homeWeeklyPromoEnabled ? "ok" : "neutral"} icon={config.homeWeeklyPromoEnabled ? undefined : CircleOff}>{config.homeWeeklyPromoEnabled ? "已开启" : "已关闭"}</StatusTag></dd></div>
        {h3 && <div><dt>去修改</dt><dd><Link className="rd-link" href="/growth/quest" prefetch={false}>去「用户任务管理」修改</Link></dd></div>}
      </dl>
    </Panel>


    {confirmOpen && <Modal title={onlyOperating ? "修改发布必填语言" : "保存 App 分享与下载"} icon={onlyOperating ? Languages : Link2} busy={saving} dirty={Boolean(reason)} onClose={() => setConfirmOpen(false)}
      sub={<>{!onlyOperating && <StatusTag tone="progress" filled>保存后 App 下次读取配置时生效</StatusTag>}{operatingChanged && <StatusTag tone="progress" filled={onlyOperating}>{onlyOperating ? "保存后" : "发布必填："}下次打开内容编辑器时生效</StatusTag>}</>}
      footer={<>
        <Button disabled={saving} onClick={() => setConfirmOpen(false)}>取消</Button>
        <Button variant="primary" loading={saving} disabledReason={original && isRetryExpired(original) ? "已过期" : !canWrite ? "你只能查看" : undefined} onClick={() => void save()}>确认修改</Button>
      </>}>
      {error && <Notice tone="danger" title={original ? undefined : "没有保存"}>{error}</Notice>}
      <Facts>
        {!onlyOperating && <Fact k="改了什么">{changed.length ? changed.join("、") : "没有改动，保存后版本号加一"}</Fact>}
        {operatingChanged && baseline?.operatingLanguages && config.operatingLanguages && <Fact k="发布必填"><Change from={operatingNames(baseline.operatingLanguages)} to={operatingNames(config.operatingLanguages)} /></Fact>}
        <Fact k="版本">v{config.version} → v{config.version + 1}</Fact>
        {!onlyOperating && <Fact k="官方下载">{unavailable ? "暂不提供（保存后清空安装链接、版本和说明）" : "官方渠道"}</Fact>}
        <Fact k="一起保存">分享、下载、语言整组；首页开关不在这里</Fact>
        {operatingChanged && <Fact k="已发布的内容">不变；以后发布按新的必填语言检查</Fact>}
        {!onlyOperating && <Fact k="已有订单和奖励">不重算</Fact>}
      </Facts>
      {conflictDraft.current && conflictRows.length > 0 && <Fold inset title="和最新版本不同的地方" summary={`${conflictRows.length === 1 ? conflictRows[0].label : `${conflictRows.length} 处`} · 保存后按你填的覆盖`}><DiffList rows={conflictRows} /></Fold>}
      <Field label="保存理由" required help="8–200 字">
        {(control) => <Textarea {...control} aria-label="体验配置保存理由" value={original?.reason ?? reason} disabled={Boolean(original) || saving} maxLength={200} rows={2} count={`${reason.trim().length}/200`} placeholder={onlyOperating ? "例如：越南语内容改为必填，工单号" : "例如：上线 Telegram 分享，工单号"} onChange={(event) => setReason(event.target.value)} />}
      </Field>
    </Modal>}
  </div>;
}
