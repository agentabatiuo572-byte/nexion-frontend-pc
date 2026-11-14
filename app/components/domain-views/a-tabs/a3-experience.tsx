"use client";

/**
 * A3 App 分享与下载（W05 整组保存）。读取、刷新、保存都沿用旧 platform-experience-config.tsx：
 * 刷新失败清掉表单（BUG-093），理由在点保存时才校验 8–200（不控制按钮灰不灰），请求体和命令号由 client 组装。
 * 新加的只有界面：分区、每块旁边的「App 上的样子」、保存前的确认框；推荐渠道只填进表单，保存了才生效。
 * App 的拼法照 App share.ts：链接 = 分享基础链接 + 邀请码；外链模板里 {link}、{text} 各换第一个，编码后代入。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleOff, Download, EyeOff, Globe, Home, Languages, Link2, Share2, Smartphone, type LucideIcon } from "lucide-react";
import { BlockState, Button, Cell, Check, Explain, KeepText, Fact, Facts, Field, Input, Modal, Notice, Panel, Segments, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr } from "@/app/components/rd";
import { useReach } from "@/lib/nav/use-reach";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import {
  fetchPlatformExperienceConfig,
  INTERFACE_LANGUAGES,
  recommendedExperienceChannels,
  updatePlatformExperienceConfig,
  type PlatformExperienceConfig,
} from "@/lib/admin/platform-experience-client";

const CHANNEL_NAME: Record<string, string> = { zalo: "Zalo", telegram: "Telegram", whatsapp: "WhatsApp", messenger: "Messenger", sms: "短信", x: "X", copy: "复制链接", poster: "分享海报", system: "系统分享" };
const INTENT_NAME: Record<string, string> = { scheme: "打开应用", web: "打开链接", copy: "复制链接", poster: "生成海报", system: "系统分享" };
/** App visibleChannels：scheme 类不显示；system 只有 H5 支持系统分享时显示；复制和海报是面板自带的。 */
const IN_APP: Record<string, { text: string; tone: "ok" | "neutral" | "warn"; icon?: LucideIcon; explain: string }> = {
  web: { text: "显示", tone: "ok", explain: "启用后出现在 App 分享面板里，点了用链接模板打开对应网页或短信。" },
  scheme: { text: "App 不显示", tone: "warn", icon: EyeOff, explain: "打开应用类渠道 App 目前不显示，启用了也看不到。" },
  system: { text: "仅 H5", tone: "neutral", icon: Globe, explain: "只在 H5 并且浏览器支持系统分享时显示，原生 App 里不显示。" },
  copy: { text: "面板自带", tone: "neutral", icon: Smartphone, explain: "App 分享面板固定有复制链接，这里关掉也还在。" },
  poster: { text: "面板自带", tone: "neutral", icon: Smartphone, explain: "App 分享面板固定有分享海报，这里关掉也还在。" },
};
const SAMPLE_CODE = "AB12CD";

/** App channelIntentUrl 的拼法：String.replace 只换第一个。 */
function assemble(textTemplate: string | null | undefined, urlTemplate: string | null | undefined, link: string) {
  const text = (textTemplate ?? "{link}").replace("{link}", link);
  const url = urlTemplate ? urlTemplate.replace("{link}", encodeURIComponent(link)).replace("{text}", encodeURIComponent(text)) : "";
  return { text, url };
}

export function A3Experience({ toast }: { toast: (text: string, kind?: "success" | "error" | "warn" | "info") => void }) {
  const session = useAdminAuth((state) => state.session);
  const reach = useReach();
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [config, setConfig] = useState<PlatformExperienceConfig | null>(null);
  const [baseline, setBaseline] = useState<PlatformExperienceConfig | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState("");

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null); setSuccess(null);
    try { const next = await fetchPlatformExperienceConfig(); setConfig(next); setBaseline(next); }
    catch (cause) { setConfig(null); setBaseline(null); setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);

  const changed = useMemo(() => {
    if (!config || !baseline) return [] as string[];
    const parts: string[] = [];
    if (config.baseUrl !== baseline.baseUrl) parts.push("分享基础链接");
    if (JSON.stringify(config.channels) !== JSON.stringify(baseline.channels)) parts.push("分享渠道");
    if (JSON.stringify(config.appDownload) !== JSON.stringify(baseline.appDownload)) parts.push("官方应用下载");
    if (JSON.stringify(config.interfaceLanguages) !== JSON.stringify(baseline.interfaceLanguages)) parts.push("界面语言");
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
    if (!config || !canWrite || saving || loading) return;
    setSuccess(null);
    if (reason.trim().length < 8 || reason.trim().length > 200) { setError("保存理由必须为 8–200 字，请补充后再保存。"); return; }
    setSaving(true); setError(null);
    try {
      const saved = await updatePlatformExperienceConfig(config, reason, session?.operator ?? session?.username ?? "");
      setConfig(saved);
      setBaseline(saved);
      setReason("");
      setConfirmOpen(false);
      setSuccess(`已保存，当前版本 v${saved.version}。`);
      toast(`App 分享与下载已保存，当前版本 v${saved.version}`, "success");
    } catch (cause) {
      setError(displayAdminError(cause));
    } finally { setSaving(false); }
  };

  const unavailable = config.appDownload.source === "unavailable";
  const fieldsLocked = !canWrite;
  const link = config.baseUrl ? `${config.baseUrl}${SAMPLE_CODE}` : "";
  const webChannels = config.channels.filter((channel) => channel.intentType === "web");
  const previewChannel = webChannels.find((channel) => channel.key === previewKey) ?? webChannels.find((channel) => channel.enabled) ?? webChannels[0];
  const assembled = previewChannel && link ? assemble(previewChannel.textTemplate, previewChannel.urlTemplate, link) : null;
  const visibleInApp = config.channels.filter((channel) => channel.enabled && channel.intentType === "web");
  const languages = config.interfaceLanguages;
  const onLanguages = INTERFACE_LANGUAGES.filter((language) => language.base || !languages || languages.includes(language.code));
  const h3 = reach("/growth/quest", "growth_h3_read");

  const preview = (title: string, children: ReactNode) => <aside className="a3-preview" aria-label={`App 上的样子：${title}`}>
    <span className="a3-preview-label"><Smartphone size={14} aria-hidden />App 上的样子</span>
    {children}
  </aside>;

  return <div className="rd-tab-stack" data-testid="platform-experience-config" onChange={() => { setSuccess(null); }}>
    <div className="rd-toolbar a3-savebar" data-end="">
      <span className="rd-toolbar-note" data-tone={changed.length ? "warn" : undefined}>
        {changed.length ? `有未保存的修改：${changed.join("、")}` : `版本 v${config.version}${config.updatedAt ? ` · ${formatBusinessTimeCompact(config.updatedAt, "—")} 读取` : ""}`}
      </span>
      <Button disabled={loading || saving} loading={loading} onClick={() => void refresh()}>刷新</Button>
      {canWrite && <Button variant="primary" disabledReason={loading ? "正在读取" : undefined} onClick={() => { setError(null); setConfirmOpen(true); }}>保存…</Button>}
    </div>
    {success && <Notice tone="ok">{success}</Notice>}
    {error && !confirmOpen && <Notice tone="danger" title="没有保存">{error}</Notice>}

    <Panel title="分享链接和渠道" icon={Share2} tone="role-2" sub={`${config.channels.length} 个渠道 · 启用 ${config.channels.filter((channel) => channel.enabled).length} 个`}
      explain="用户在 App 里点「邀请」「分享」时用这里的设置。外部渠道能不能打开还要看用户手机上有没有装对应应用。" >
      <div className="a3-with-preview">
        <div className="rd-form-stack">
          <div id="a3-sharing"><Field label="分享基础链接" help="App 把用户的邀请码直接接在后面，不自动补斜杠">
            {(control) => <Input {...control} aria-label="分享基础链接" placeholder="https://… 结尾通常是 / 或 =" value={config.baseUrl} disabled={fieldsLocked} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />}
          </Field></div>
          {config.channels.length === 0 ? <Notice tone="warn" title="还没有设置分享渠道" action={canWrite && <Button size="sm" onClick={() => setConfig({ ...config, channels: recommendedExperienceChannels() })}>填入推荐的 9 个渠道</Button>}>
            App 分享面板里只有自带的复制链接和海报。<KeepText text="填入推荐渠道后要保存才生效。" />
          </Notice> : <Table label="分享渠道">
            <thead><tr><Th>渠道</Th><Th>启用</Th><Th>在 App 里</Th><Th>文案模板</Th><Th>链接模板</Th></tr></thead>
            <tbody>
              {config.channels.map((channel, index) => {
                const inApp = !channel.enabled && (channel.intentType === "web" || channel.intentType === "system") ? { text: "没启用", tone: "neutral" as const, icon: CircleOff, explain: "没启用的渠道不出现在 App 分享面板里。" } : IN_APP[channel.intentType];
                const name = CHANNEL_NAME[channel.key] ?? channel.key;
                return <Tr key={channel.key} selected={previewChannel?.key === channel.key}>
                  <Td><Cell main={name} sub={INTENT_NAME[channel.intentType] ?? "未知方式"} /></Td>
                  <Td><Check label={<span className="rd-sr-only">{name} 启用</span>} aria-label={`${channel.key} 启用`} checked={channel.enabled} disabled={fieldsLocked} onChange={(event) => patchChannel(index, { enabled: event.target.checked })} /></Td>
                  <Td>{inApp ? <StatusTag tone={inApp.tone} icon={inApp.icon} explain={inApp.explain}>{inApp.text}</StatusTag> : "—"}</Td>
                  <Td><Input aria-label={`${channel.key} 文案模板`} placeholder="可以用 {link}" value={channel.textTemplate ?? ""} disabled={fieldsLocked} onChange={(event) => patchChannel(index, { textTemplate: event.target.value })} onFocus={() => channel.intentType === "web" && setPreviewKey(channel.key)} /></Td>
                  <Td>{channel.intentType === "web" || channel.urlTemplate
                    ? <Input aria-label={`${channel.key} 链接模板`} placeholder="https://…{link} 或 {text}" value={channel.urlTemplate ?? ""} disabled={fieldsLocked} onChange={(event) => patchChannel(index, { urlTemplate: event.target.value })} onFocus={() => channel.intentType === "web" && setPreviewKey(channel.key)} />
                    : <span className="rd-note">不用填<Explain label="为什么不用填" content="只有打开链接类渠道用链接模板；其他类型填了后端会拒绝保存。" /></span>}</Td>
                </Tr>;
              })}
            </tbody>
          </Table>}
        </div>
        {preview("分享", <>
          <dl className="a3-preview-rows">
            <div><dt>分享出去的链接</dt><dd>{link ? <span className="a3-preview-link">{config.baseUrl}<mark>{SAMPLE_CODE}</mark></span> : <span className="a3-preview-empty">没有链接，App 里分享按钮不可用</span>}</dd></div>
            <div><dt>分享面板里的外部渠道</dt><dd>{visibleInApp.length ? visibleInApp.map((channel) => CHANNEL_NAME[channel.key] ?? channel.key).join("、") : "没有"}<span className="a3-preview-sub">另外固定有复制链接、分享海报</span></dd></div>
          </dl>
          {webChannels.length > 0 && <>
            <Segments label="看哪个渠道" value={previewChannel?.key ?? ""} onChange={(value) => setPreviewKey(String(value))} items={webChannels.map((channel) => ({ value: channel.key, label: CHANNEL_NAME[channel.key] ?? channel.key }))} />
            {assembled ? <dl className="a3-preview-rows">
              <div><dt>发出去的文案</dt><dd className="a3-preview-text">{assembled.text}</dd></div>
              <div><dt>打开的网址</dt><dd className="a3-preview-link">{assembled.url || "—"}</dd></div>
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
          <p className="rd-note">APK 链接：{config.appDownload.apkUrl || "—"}（这里不能改，保存时原样带上）</p>
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

    <Panel title="界面语言" icon={Languages} tone="role-3" sub={languages ? `开启 ${onLanguages.length} 种，共 ${INTERFACE_LANGUAGES.length} 种` : "只能查看"}
      explain={<>
        <p>关闭后，用户在语言列表里看不到这种语言；正在用它的用户在 App 里改用英文显示。中文、英文、越南语始终开启。</p>
        <p>开启语言只管界面文字。印尼语、马来语、菲律宾语、俄语、哈萨克语、乌兹别克语的说明和文档内容，App 目前仍按英文读取。</p>
      </>}>
      <div className="a3-with-preview">
        <div id="a3-languages" className="a3-langs" role="group" aria-label="界面语言开关">
          {INTERFACE_LANGUAGES.map((language) => <Check key={language.code}
            label={<span className="a3-lang"><b>{language.nativeName}</b><small>{language.zhName} · {language.code}{language.base ? " · 始终开启" : ""}</small></span>}
            aria-label={`${language.zhName} 开启`}
            checked={language.base || !languages || languages.includes(language.code)}
            disabled={fieldsLocked || language.base || !languages}
            onChange={(event) => languages && setConfig({ ...config, interfaceLanguages: INTERFACE_LANGUAGES.map((item) => item.code).filter((code) => code === language.code ? event.target.checked : languages.includes(code)) })} />)}
          {!languages && <p className="rd-note">系统支持后，可以在这里开关界面语言，现在只能查看。</p>}
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


    {confirmOpen && <Modal title="保存 App 分享与下载" icon={Link2} busy={saving} dirty={Boolean(reason)} onClose={() => setConfirmOpen(false)}
      sub={<StatusTag tone="progress" filled>保存后 App 下次读取配置时生效</StatusTag>}
      footer={<>
        <Button disabled={saving} onClick={() => setConfirmOpen(false)}>取消</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()}>确认修改</Button>
      </>}>
      {error && <Notice tone="danger" title="没有保存">{error}</Notice>}
      <Facts>
        <Fact k="改了什么">{changed.length ? changed.join("、") : "没有改动，保存后版本号加一"}</Fact>
        <Fact k="版本">v{config.version} → v{config.version + 1}</Fact>
        <Fact k="官方下载">{unavailable ? "暂不提供（保存后清空安装链接、版本和说明）" : "官方渠道"}</Fact>
        <Fact k="一起保存">分享、下载、语言整组；首页开关不在这里</Fact>
        <Fact k="已有订单和奖励">不重算</Fact>
      </Facts>
      <Field label="保存理由" required hint="8–200 字">
        {(control) => <Textarea {...control} aria-label="体验配置保存理由" value={reason} maxLength={200} rows={2} count={`${reason.trim().length}/200`} placeholder="例如：上线 Telegram 分享，工单号" onChange={(event) => setReason(event.target.value)} />}
      </Field>
    </Modal>}
  </div>;
}
