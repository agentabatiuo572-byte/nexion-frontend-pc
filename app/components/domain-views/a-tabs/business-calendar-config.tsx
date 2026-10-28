"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { cancelBusinessZone, fetchBusinessCalendar, scheduleBusinessZone, zoneOptionLabel, type BusinessCalendarVersion, type BusinessCalendarView } from "@/lib/admin/business-calendar-client";
import { Modal } from "../design-kit";

/** "UTC+7" for a zone id, from the browser's tz data; the backend only offers zones without daylight saving. */
function offsetOf(zoneId: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zoneId, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "";
    return name === "GMT" ? "UTC+0" : name.replace("GMT", "UTC");
  } catch { return ""; }
}

const TRACK_LABEL: Record<BusinessCalendarVersion["track"], string> = { LEGACY: "其他模块", GROWTH_TEAM: "增长与团队", GLOBAL: "全部模块" };

function previousDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** R-1 / D-13–D-16: one business time zone for every period cut; changes apply from a future day and keep settled periods. */
export function BusinessCalendarConfig() {
  const session = useAdminAuth((state) => state.session);
  const canWrite = session?.role === "superadmin";
  const [view, setView] = useState<BusinessCalendarView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirming, setConfirming] = useState<{ key: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await fetchBusinessCalendar();
      setView(next);
      setEffectiveDate((value) => value && value >= next.earliestEffectiveDate ? value : next.earliestEffectiveDate);
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const zoneLabel = useCallback((id: string) => id === "Asia/Shanghai" ? "北京时间" : view?.options.find((option) => option.zoneId === id)?.label ?? id, [view]);
  const countries = useMemo(() => {
    const seen = new Map<string, string>();
    view?.options.forEach((option) => { const key = option.countryCode ?? "UTC"; if (!seen.has(key)) seen.set(key, option.countryName); });
    return [...seen.entries()];
  }, [view]);
  const zones = view?.options.filter((option) => (option.countryCode ?? "UTC") === country) ?? [];
  const selected = zones.find((option) => option.zoneId === zoneId);
  const reasonValid = reason.trim().length >= 8 && reason.trim().length <= 200;
  const formReady = Boolean(selected && view && effectiveDate >= view.earliestEffectiveDate && reasonValid);
  const growthZone = view?.trackZones.GROWTH_TEAM;

  const pickCountry = (code: string) => {
    setCountry(code);
    setZoneId(view?.options.find((option) => (option.countryCode ?? "UTC") === code)?.zoneId ?? "");
  };

  const submit = async () => {
    if (!confirming || !selected || saving) return;
    setSaving(true); setError(null);
    try {
      setView(await scheduleBusinessZone({ countryCode: selected.countryCode, zoneId: selected.zoneId, effectiveDate, reason }, confirming.key));
      setConfirming(null); setReason("");
      setSuccess(`已设置：${effectiveDate} 00:00（${selected.label}）起生效。生效前可以撤销。`);
    } catch (cause) { setError(displayAdminError(cause)); setConfirming(null); }
    finally { setSaving(false); }
  };

  const cancel = async (pending: BusinessCalendarVersion) => {
    if (saving) return;
    if (cancelReason.trim().length < 8 || cancelReason.trim().length > 200) { setError("撤销理由必须填写 8-200 个字符。"); return; }
    setSaving(true); setError(null);
    try {
      setView(await cancelBusinessZone(pending.id, cancelReason, `a3-business-zone-cancel-${crypto.randomUUID()}`));
      setCancelReason(""); setSuccess("已撤销待生效的时区设置。");
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setSaving(false); }
  };

  const pending = view?.pending ?? null;
  return <section className="l-card" data-testid="business-calendar-config" onChange={() => { setSuccess(null); }}>
    <div className="l-h"><div><div className="ttl">业务时区</div><div className="sub">所有按日 / 周 / 月统计、结算和榜单都按这个时区切分；后台时间也按它显示</div></div><div className="r"><button className="l-btn sm" type="button" disabled={loading} onClick={() => void refresh()}>刷新</button></div></div>
    <div className="l-b">
      {error && <div role="alert" className="atint warn" style={{ marginBottom: 10 }}>{error}</div>}
      {success && <div role="status" className="atint" style={{ marginBottom: 10 }}>{success}</div>}
      {!view ? <div className="tiny">{loading ? "正在加载…" : "业务时区暂不可用；后台按北京时间显示。"}</div> : <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
          <div className="atint"><span className="tiny">当前业务时区</span><br /><b>{view.currentZoneLabel} · {view.currentOffset}</b></div>
          {growthZone && <div className={view.unified ? "atint" : "atint warn"}><span className="tiny">增长与团队</span><br /><b>{zoneLabel(growthZone)} · {offsetOf(growthZone)}</b>{!view.unified && <><br /><span className="tiny">与其他模块不一致，设置后统一</span></>}</div>}
          <div className={pending ? "atint warn" : "atint"}><span className="tiny">待生效</span><br /><b>{pending ? `${zoneLabel(pending.zoneId)} · ${pending.offset}` : "无"}</b>{pending && <><br /><span className="tiny">{pending.effectiveDate} 00:00（{zoneLabel(pending.zoneId)}）起</span></>}</div>
        </div>

        {pending ? canWrite && <div className="atint warn" style={{ marginBottom: 14 }}>
          <b>已设置，等待生效</b><br /><span className="tiny">生效前可以撤销；生效后只能再设置新的时区，已结算的周期不会改变。同一时间只能有一个待生效设置。</span>
          <label className="tiny" style={{ display: "block", marginTop: 10 }}>撤销理由（8–200 字）</label>
          <textarea aria-label="撤销理由" value={cancelReason} maxLength={200} rows={2} onChange={(event) => setCancelReason(event.target.value)} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button className="l-btn sm" type="button" disabled={saving} onClick={() => void cancel(pending)}>撤销这次设置</button></div>
        </div> : canWrite && <div style={{ border: "1px solid var(--v5-border)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>设置新的业务时区</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label className="tiny">国家 / 地区（选择后自动带出时区）<select aria-label="国家或地区" value={country} onChange={(event) => pickCountry(event.target.value)} style={{ width: "100%", marginTop: 4 }}><option value="">请选择</option>{countries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
            <label className="tiny">时区<select aria-label="时区" value={zoneId} disabled={!country} onChange={(event) => setZoneId(event.target.value)} style={{ width: "100%", marginTop: 4 }}>{zones.length === 0 && <option value="">先选择国家</option>}{zones.map((option) => <option key={option.zoneId} value={option.zoneId}>{zoneOptionLabel(option, offsetOf(option.zoneId))}</option>)}</select></label>
            <label className="tiny">生效日期（最早 {view.earliestEffectiveDate}）<input aria-label="生效日期" type="date" min={view.earliestEffectiveDate} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} style={{ width: "100%", marginTop: 4 }} /></label>
          </div>
          {selected && effectiveDate && <div className="atint" style={{ marginTop: 12 }}>{effectiveDate} 00:00（{selected.label}）起，所有模块按{selected.label}切日。<br />{previousDay(effectiveDate)} 及以前已结算的日、周、月保持不变；切换当天，原时区的最后一天会相应变长或变短。</div>}
          <label className="tiny" style={{ display: "block", marginTop: 12 }}>修改理由（8–200 字）</label>
          <textarea aria-label="业务时区修改理由" value={reason} maxLength={200} rows={2} onChange={(event) => setReason(event.target.value)} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button className="l-btn sm primary" type="button" disabled={!formReady || saving} onClick={() => setConfirming({ key: `a3-business-zone-${crypto.randomUUID()}` })}>确认设置</button></div>
        </div>}

        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>版本记录</h3>
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>适用范围</th><th>时区</th><th>生效日</th><th>状态</th><th>操作人</th><th>理由</th></tr></thead><tbody>
          {[...view.history].reverse().map((row) => <tr key={row.id}><td>{TRACK_LABEL[row.track] ?? row.track}</td><td>{zoneLabel(row.zoneId)} · {row.offset}</td><td>{row.effectiveDate === "1970-01-01" ? "初始" : row.effectiveDate}</td><td>{row.pending ? "待生效" : "已生效"}</td><td>{row.operator === "migration:r1" ? "系统迁移" : row.operator}</td><td>{row.reason}</td></tr>)}
        </tbody></table></div>
      </>}
    </div>
    {confirming && selected && <Modal title="确认设置业务时区" busy={saving} onClose={() => setConfirming(null)} footer={<><button className="l-btn sm" type="button" disabled={saving} onClick={() => setConfirming(null)}>取消</button><button className="l-btn sm primary" type="button" disabled={saving} onClick={() => void submit()}>确认设置</button></>}>
      <p>新的业务时区：<b>{zoneOptionLabel(selected, offsetOf(selected.zoneId))}</b></p>
      <p>生效时间：<b>{effectiveDate} 00:00（{selected.label}）</b></p>
      <p className="tiny">生效后，所有日 / 周 / 月统计、每日结算、每周分红和月度榜单都按新时区切分；{previousDay(effectiveDate)} 及以前已结算的周期保持不变。生效前可以撤销。</p>
      <p className="tiny">理由：{reason.trim()}</p>
    </Modal>}
  </section>;
}
