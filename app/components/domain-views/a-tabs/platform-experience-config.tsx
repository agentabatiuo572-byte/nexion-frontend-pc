"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchPlatformExperienceConfig,
  recommendedExperienceChannels,
  updatePlatformExperienceConfig,
  type PlatformExperienceConfig,
} from "@/lib/admin/platform-experience-client";
import { PublishedContentEditor } from "@/app/components/domain-views/published-content-editor";
import { PublishedHowContentEditor } from "@/app/components/domain-views/published-how-content-editor";

export function PlatformExperienceConfig() {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [config, setConfig] = useState<PlatformExperienceConfig | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    try { setConfig(await fetchPlatformExperienceConfig()); }
    catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!canRead) return null;

  const patchChannel = (index: number, patch: Record<string, unknown>) => {
    if (!config) return;
    setConfig({ ...config, channels: config.channels.map((channel, rowIndex) => rowIndex === index ? { ...channel, ...patch } : channel) });
  };

  const save = async () => {
    if (!config || !canWrite) return;
    if (reason.trim().length < 8) { setError("保存理由必须为 8–200 字。"); return; }
    setSaving(true); setError(null);
    try {
      setConfig(await updatePlatformExperienceConfig(config, reason, session?.operator ?? session?.username ?? ""));
      setReason("");
    } catch (cause) {
      setError(`${displayAdminError(cause)}；请刷新后重新读取 修改版本，禁止盲目重提。`);
    } finally { setSaving(false); }
  };

  return <><section className="l-card a3-experience" data-testid="platform-experience-config">
    <div className="l-h"><div><div className="ttl">应用体验配置</div><div className="sub">管理官方下载链接、分享渠道与首页开关；保存时检查修改冲突并记录操作</div></div><div className="r"><span className="bdg cyan">v{config?.version ?? "—"}</span><button className="l-btn sm" onClick={() => void refresh()} disabled={loading}>刷新</button></div></div>
    <div className="l-b">
      {error && <div className="atint warn" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && !config ? <div className="tiny">读取体验配置中…</div> : !config ? <div className="atint warn">体验配置不可用，页面保持只读。</div> : <>
        <div className="two-col" style={{ marginBottom: 12 }}>
          <div className="atint"><b>首页新手任务（只读展示）</b><br />{config.homeNewcomerTasksEnabled ? "已开启" : "已关闭"}<br /><Link href="/growth/quest">去 H3 用户任务管理 →</Link></div>
          <div className="atint"><b>首页周促销（只读投影）</b><br />{config.homeWeeklyPromoEnabled ? "已开启" : "已关闭"}<br /><Link href="/growth/quest">去 H3 周促销管理 →</Link></div>
        </div>
        <nav className="a3-experience-nav" aria-label="应用体验配置分区"><a href="#a3-sharing" onClick={(event) => { event.preventDefault(); document.getElementById("a3-sharing")?.scrollIntoView({ block: "start" }); }}>分享渠道</a><a href="#a3-installer" onClick={(event) => { event.preventDefault(); document.getElementById("a3-installer")?.scrollIntoView({ block: "start" }); }}>官方应用安装</a></nav>
        <h3 id="a3-sharing" className="a3-experience-heading">分享渠道与文案</h3>
        <label className="tiny">分享基础链接</label><input aria-label="分享基础链接" value={config.baseUrl} disabled={!canWrite} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} style={{ width: "100%", margin: "4px 0 12px" }} />
        {config.channels.length === 0 && <div className="atint warn" style={{ marginBottom: 10 }}>

          当前未配置分享渠道；应用会使用内置推荐渠道备用，但后台尚未形成可审计配置。
          {canWrite && <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => setConfig({ ...config, channels: recommendedExperienceChannels() })}>补齐推荐渠道</button>}
        </div>}
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>渠道</th><th>分享方式</th><th>启用</th><th>文案模板</th><th>链接模板</th></tr></thead><tbody>{config.channels.map((channel, index) => <tr key={channel.key}>
          <td className="mono">{({zalo:"Zalo",telegram:"Telegram",whatsapp:"WhatsApp",messenger:"Messenger",sms:"短信",copy:"复制链接",poster:"分享海报",system:"系统分享"} as Record<string,string>)[channel.key] ?? channel.key}</td><td>{({ scheme: "打开应用", web: "打开链接", copy: "复制链接", poster: "生成海报", system: "系统分享" } as Record<string,string>)[channel.intentType] ?? "未知方式"}</td><td><input type="checkbox" aria-label={`${channel.key} 启用`} checked={channel.enabled} disabled={!canWrite} onChange={(event) => patchChannel(index, { enabled: event.target.checked })} /></td>
          <td><input aria-label={`${channel.key} 文案模板`} value={channel.textTemplate ?? ""} disabled={!canWrite} onChange={(event) => patchChannel(index, { textTemplate: event.target.value })} /></td>
          <td><input aria-label={`${channel.key} 链接模板`} value={channel.urlTemplate ?? ""} disabled={!canWrite} onChange={(event) => patchChannel(index, { urlTemplate: event.target.value })} /></td>
        </tr>)}</tbody></table></div>
        <h3 id="a3-installer" className="a3-experience-heading">官方应用安装</h3>
        <div className="two-col" style={{ marginTop: 12, marginBottom: 0 }}><div>
          <label className="tiny">官方安装链接</label><input aria-label="官方安装链接" value={config.appDownload.officialUrl} disabled={!canWrite || config.appDownload.source === "unavailable"} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, officialUrl: event.target.value } })} style={{ width: "100%", marginTop: 4 }} />
          <label className="tiny" style={{ display: "block", marginTop: 8 }}>iOS 官方下载链接（可选）</label><input aria-label="iOS 官方下载链接" value={config.appDownload.iosUrl} disabled={!canWrite || config.appDownload.source === "unavailable"} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, iosUrl: event.target.value } })} style={{ width: "100%", marginTop: 4 }} />
          <label className="tiny" style={{ display: "block", marginTop: 8 }}>Android 官方下载链接（可选）</label><input aria-label="Android 官方下载链接" value={config.appDownload.androidUrl} disabled={!canWrite || config.appDownload.source === "unavailable"} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, androidUrl: event.target.value } })} style={{ width: "100%", marginTop: 4 }} />
          <label className="tiny" style={{ display: "block", marginTop: 8 }}>版本</label><input aria-label="安装包版本" value={config.appDownload.version} disabled={!canWrite || config.appDownload.source === "unavailable"} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, version: event.target.value } })} style={{ width: "100%", marginTop: 4 }} />
        </div><div><label className="tiny">来源（仅允许官方）</label><select aria-label="安装包来源" value={config.appDownload.source} disabled={!canWrite} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, source: event.target.value as PlatformExperienceConfig["appDownload"]["source"] } })} style={{ width: "100%", marginTop: 4 }}><option value="official">官方渠道</option><option value="unavailable">暂不提供</option></select>
          <label className="tiny" style={{ display: "block", marginTop: 8 }}>发布说明（中文 / 英文）</label><div className="row"><input aria-label="中文发布说明" value={config.appDownload.releaseNotes.zh} disabled={!canWrite || config.appDownload.source === "unavailable"} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, releaseNotes: { ...config.appDownload.releaseNotes, zh: event.target.value } } })} /><input aria-label="英文发布说明" value={config.appDownload.releaseNotes.en} disabled={!canWrite || config.appDownload.source === "unavailable"} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, releaseNotes: { ...config.appDownload.releaseNotes, en: event.target.value } } })} /></div>
          {config.appDownload.source === "unavailable" && <div className="tiny" style={{ marginTop: 6 }}>当前暂不提供官方安装包；安装链接、版本和发布说明不生效。确定官方发布地址后再切换来源。</div>}
        </div></div>
        {canWrite && <><label className="tiny" style={{ display: "block", marginTop: 12 }}>保存理由（8–200 字，记录在操作日志中）</label><textarea aria-label="体验配置保存理由" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} rows={2} style={{ width: "100%", marginTop: 4 }} /><button className="l-btn mc" style={{ marginTop: 8 }} disabled={saving || reason.trim().length < 8} onClick={() => void save()}>{saving ? "保存中…" : "保存并回读"}</button></>}
      </>}
    </div>
  </section><PublishedContentEditor kind="developerDocs" /><PublishedHowContentEditor /></>;
}
