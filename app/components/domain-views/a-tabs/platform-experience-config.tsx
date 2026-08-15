"use client";

import { useCallback, useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchPlatformExperienceConfig,
  updatePlatformExperienceConfig,
  type PlatformExperienceConfig,
} from "@/lib/admin/platform-experience-client";

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
      setError(`${displayAdminError(cause)}；请刷新后重新读取 CAS 版本，禁止盲目重提。`);
    } finally { setSaving(false); }
  };

  return <section className="l-card" data-testid="platform-experience-config">
    <div className="l-h"><div><div className="ttl">App 体验配置</div><div className="sub">官方安装 URL、分享渠道/模板与首页开关 · 服务端版本 CAS · A3 审计</div></div><div className="r"><span className="bdg cyan">v{config?.version ?? "—"}</span><button className="l-btn sm" onClick={() => void refresh()} disabled={loading}>刷新</button></div></div>
    <div className="l-b">
      {error && <div className="atint warn" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && !config ? <div className="tiny">读取体验配置中…</div> : !config ? <div className="atint warn">体验配置不可用，页面保持只读。</div> : <>
        <div className="two-col" style={{ marginBottom: 12 }}>
          <label className="atint"><b>首页新手任务</b><br />{config.homeNewcomerTasksEnabled === undefined ? "由 H3 服务端投影，当前接口未返回" : <><input type="checkbox" aria-label="首页新手任务开关" checked={config.homeNewcomerTasksEnabled} disabled={!canWrite} onChange={(event) => setConfig({ ...config, homeNewcomerTasksEnabled: event.target.checked })} /> {config.homeNewcomerTasksEnabled ? "已开启" : "已关闭"}</>}</label>
          <label className="atint"><b>首页周活动</b><br />{config.homeWeeklyPromoEnabled === undefined ? "由 H3 服务端投影，当前接口未返回" : <><input type="checkbox" aria-label="首页周活动开关" checked={config.homeWeeklyPromoEnabled} disabled={!canWrite} onChange={(event) => setConfig({ ...config, homeWeeklyPromoEnabled: event.target.checked })} /> {config.homeWeeklyPromoEnabled ? "已开启" : "已关闭"}</>}</label>
        </div>
        <label className="tiny">分享基础 URL</label><input aria-label="分享基础 URL" value={config.baseUrl} disabled={!canWrite} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} style={{ width: "100%", margin: "4px 0 12px" }} />
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>渠道</th><th>意图</th><th>启用</th><th>文案模板</th><th>URL 模板</th></tr></thead><tbody>{config.channels.map((channel, index) => <tr key={channel.key}>
          <td className="mono">{channel.key}</td><td>{channel.intentType}</td><td><input type="checkbox" aria-label={`${channel.key} 启用`} checked={channel.enabled} disabled={!canWrite} onChange={(event) => patchChannel(index, { enabled: event.target.checked })} /></td>
          <td><input aria-label={`${channel.key} 文案模板`} value={channel.textTemplate ?? ""} disabled={!canWrite} onChange={(event) => patchChannel(index, { textTemplate: event.target.value })} /></td>
          <td><input aria-label={`${channel.key} URL 模板`} value={channel.urlTemplate ?? ""} disabled={!canWrite} onChange={(event) => patchChannel(index, { urlTemplate: event.target.value })} /></td>
        </tr>)}</tbody></table></div>
        <div className="two-col" style={{ marginTop: 12, marginBottom: 0 }}><div>
          <label className="tiny">官方安装 URL</label><input aria-label="官方安装 URL" value={config.appDownload.officialUrl} disabled={!canWrite} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, officialUrl: event.target.value } })} style={{ width: "100%", marginTop: 4 }} />
          <label className="tiny" style={{ display: "block", marginTop: 8 }}>版本</label><input aria-label="安装包版本" value={config.appDownload.version} disabled={!canWrite} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, version: event.target.value } })} style={{ width: "100%", marginTop: 4 }} />
        </div><div><label className="tiny">来源</label><select aria-label="安装包来源" value={config.appDownload.source} disabled={!canWrite} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, source: event.target.value as PlatformExperienceConfig["appDownload"]["source"] } })} style={{ width: "100%", marginTop: 4 }}><option value="official">official</option><option value="mock">mock</option><option value="unavailable">unavailable</option></select>
          <label className="tiny" style={{ display: "block", marginTop: 8 }}>发布说明（中文 / English）</label><div className="row"><input aria-label="中文发布说明" value={config.appDownload.releaseNotes.zh} disabled={!canWrite} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, releaseNotes: { ...config.appDownload.releaseNotes, zh: event.target.value } } })} /><input aria-label="English release notes" value={config.appDownload.releaseNotes.en} disabled={!canWrite} onChange={(event) => setConfig({ ...config, appDownload: { ...config.appDownload, releaseNotes: { ...config.appDownload.releaseNotes, en: event.target.value } } })} /></div>
        </div></div>
        {canWrite && <><label className="tiny" style={{ display: "block", marginTop: 12 }}>保存理由（8–200 字，写入 A3_PLATFORM_EXPERIENCE_CHANGED）</label><textarea aria-label="体验配置保存理由" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} rows={2} style={{ width: "100%", marginTop: 4 }} /><button className="l-btn mc" style={{ marginTop: 8 }} disabled={saving || reason.trim().length < 8} onClick={() => void save()}>{saving ? "保存中…" : "保存并回读"}</button></>}
      </>}
    </div>
  </section>;
}
