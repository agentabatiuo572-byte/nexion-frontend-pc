"use client";
import { useEffect, useRef, useState } from "react";
import type { HCtx } from "./types";
import { fetchEventRules, fetchEventVouchers, updateEventRule, type EventRuleView, type EventRuleChange, type EventVoucherOption } from "@/lib/admin/event-rules-client";
import { EVENT_KIND_LABELS, eventRuleDraftRules, eventRuleFields, eventRuleReadinessText, eventRegionText, parseEventRegions } from "@/lib/admin/event-rule-form";
import { displayAdminError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";

export default function H4EventRules({ ctx }: { ctx: HCtx }) {
  const [rows, setRows] = useState<EventRuleView[]>([]), [selected, setSelected] = useState<EventRuleView | null>(null);
  const [draft, setDraft] = useState<EventRuleChange | null>(null), [regions, setRegions] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [vouchers, setVouchers] = useState<EventVoucherOption[]>([]), [voucherLoading, setVoucherLoading] = useState(false), [voucherError, setVoucherError] = useState(""), [voucherRetry, setVoucherRetry] = useState(0);
  const generation = useRef(0);
  const canRead = ctx.can("growth_h4_read"), canWrite = ctx.can("growth_h4_write");
  const canReadVouchers = ctx.can("growth_h7_read");
  const operator = currentAdminOperator();
  const choose = (row: EventRuleView) => { setSelected(row); setDraft({ enabled: row.enabled, startsAt: row.startsAt, endsAt: row.endsAt, rules: eventRuleDraftRules(row) }); setRegions(eventRegionText(row.rules.regions)); setError(""); };
  const load = async () => {
    const own = ++generation.current; setLoading(true); setError("");
    try { const values = await fetchEventRules(); if (own === generation.current) { setRows(values); setSelected(null); setDraft(null); } }
    catch (cause) { if (own === generation.current) setError(displayAdminError(cause)); }
    finally { if (own === generation.current) setLoading(false); }
  };
  useEffect(() => { setSaving(false); setError(""); setRows([]); setSelected(null); setDraft(null); if (canRead) void load(); else setLoading(false); return () => { generation.current += 1; }; }, [canRead, operator]);
  useEffect(() => {
    let alive = true; setVouchers([]); setVoucherError(""); setVoucherLoading(false);
    if (selected?.kind !== "seasonal" || !canRead || !canReadVouchers) return;
    setVoucherLoading(true);
    fetchEventVouchers().then(values => { if (alive) setVouchers(values); })
      .catch(cause => { if (alive) setVoucherError(displayAdminError(cause)); })
      .finally(() => { if (alive) setVoucherLoading(false); });
    return () => { alive = false; };
  }, [selected?.eventCode, selected?.kind, canRead, canReadVouchers, operator, voucherRetry]);
  const patchRule = (key: string, value: unknown) => setDraft(current => current ? { ...current, rules: { ...current.rules, [key]: value } } : current);
  const save = () => {
    if (!selected || !draft || saving || !canWrite) return;
    const next = { ...draft, rules: { ...draft.rules } };
    try { if (selected.kind === "regional") next.rules.regions = parseEventRegions(regions); }
    catch (cause) { setError(displayAdminError(cause)); return; }
    const base = selected;
    ctx.openActionConfirm({ action: `${next.enabled ? "保存并启用" : "保存关闭状态"} · ${base.eventCode}`,
      detail: <>更新本活动的参与条件、奖励及有效期。{next.enabled ? "启用后符合条件的用户可参与；保存时会检查配置与奖励预算。" : "保存后活动保持关闭，不发放新奖励。"}</>,
      amplifies: next.enabled,
      run: async reason => {
        if (operator !== currentAdminOperator() || !ctx.can("growth_h4_write")) throw new Error("登录身份或权限已变化，请重新打开活动配置。");
        const own = generation.current; setSaving(true); setError("");
        try {
          const saved = await updateEventRule(base.eventCode, next, base.revision, reason);
          if (own !== generation.current) return;
          setRows(current => current.map(row => row.eventCode === saved.eventCode ? saved : row)); choose(saved); ctx.toast("活动规则已保存并回读");
        } catch (cause) { if (own === generation.current) setError(displayAdminError(cause)); throw cause; }
        finally { if (own === generation.current) setSaving(false); }
      },
    });
  };
  if (!canRead) return null;
  return <section className="l-card">
    <div className="l-h"><span className="ttl">活动玩法与开放设置</span><span className="sub">先保存完整配置，再开启活动</span><div className="r"><button className="l-btn sm" disabled={loading || saving || !!draft} onClick={() => void load()}>刷新</button></div></div>
    <div className="l-b">
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">正在读取活动规则…</p> : <>
        {!rows.length && !error && <p>暂无活动规则。</p>}
        {!rows.length && error && <button className="l-btn" onClick={() => void load()}>重试</button>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{rows.map(row => <button className="l-btn sm" key={row.eventCode} disabled={saving || !!selected} aria-pressed={selected?.eventCode === row.eventCode} onClick={() => choose(row)}>{EVENT_KIND_LABELS[row.kind] ?? "活动"} · {row.eventCode} · {row.enabled ? "已开启" : "已关闭"}</button>)}</div>
        {selected && draft && <><fieldset disabled={!canWrite || saving} style={{ marginTop: 16, border: 0, padding: 0 }}>
          <p>{eventRuleReadinessText(selected)}</p>
          <p>{selected.rulesLocked ? "活动玩法和有效期已固定，只可关闭活动；关闭后不能重新开启。" : "活动首次开放后，玩法和有效期固定；关闭后不能重新开启。"}</p>
          <label className="field"><span>活动开放</span><select value={String(draft.enabled)} onChange={event => setDraft({ ...draft, enabled: event.target.value === "true" })}><option value="false">关闭</option><option value="true" disabled={!selected.readiness.ready || (selected.rulesLocked && !selected.enabled)}>开启</option></select></label>
          <fieldset disabled={selected.rulesLocked} className="grid g-2" style={{ gap: 12, border: 0, margin: 0, padding: 0 }}>
            {(["startsAt", "endsAt"] as const).map((key, index) => <label className="field" key={key}><span>{index ? "结束时间" : "开始时间"}（UTC）</span><input type="datetime-local" step={1} value={draft[key] ? new Date(draft[key]!).toISOString().slice(0, 19) : ""} onChange={event => setDraft({ ...draft, [key]: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : null })}/></label>)}
            {selected.kind === "boost" && <div className="field"><span>加成玩法</span><span>{draft.rules.action === "CHECKIN_MULTIPLIER" ? "周末签到加倍" : "复投加抽奖券"}</span></div>}
            {eventRuleFields({ kind: selected.kind, rules: draft.rules }).map(field => <div className="field" key={field.key}><span>{field.label}</span>
              {field.type === "voucher" ? <><select aria-label={field.label} disabled={!canReadVouchers || voucherLoading || !!voucherError} value={String(draft.rules[field.key] ?? "")} onChange={event => patchRule(field.key, event.target.value)}><option value="">请选择全场八折券</option>{!!draft.rules[field.key] && !vouchers.some(v => v.id === draft.rules[field.key]) && <option value={String(draft.rules[field.key])} disabled>{String(draft.rules[field.key])} · 当前目录未提供</option>}{vouchers.map(v => <option key={v.id} value={v.id} disabled={v.status !== "active"}>{v.name} · {v.id} · 减免 {v.percent}%{v.status !== "active" ? " · 已停用" : ""}</option>)}</select><small>选择覆盖活动期限的全场八折券；券状态和使用条件在 H7 维护，每账号领取一次、单笔使用。</small>{!canReadVouchers ? <small>需要 H7 查看权限才能选择优惠券。</small> : voucherLoading ? <small role="status">正在读取优惠券…</small> : voucherError ? <><small role="alert">{voucherError}</small><button type="button" className="l-btn sm" onClick={() => setVoucherRetry(value => value + 1)}>重试读取优惠券</button></> : !vouchers.length ? <small>暂无百分比券，请先在 H7 配置。</small> : null}</>
                : field.type === "regions" ? <><textarea aria-label={field.label} rows={4} value={regions} onChange={event => setRegions(event.target.value)} placeholder={"东南亚: VN, TH\n欧洲: DE, FR"}/><small>每行一个地区，国家使用两位代码；同一国家只能属于一个地区。用户加入时按已验证手机号归属国家确定地区。</small></>
                : field.type === "weekdays" ? <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{["一", "二", "三", "四", "五", "六", "日"].map((day, index) => <label key={day}><input type="checkbox" checked={Array.isArray(draft.rules.weekdays) && draft.rules.weekdays.includes(index + 1)} onChange={event => { const days = Array.isArray(draft.rules.weekdays) ? draft.rules.weekdays as number[] : []; patchRule("weekdays", event.target.checked ? [...days, index + 1].sort() : days.filter(day => day !== index + 1)); }}/>周{day}</label>)}</div>
                : <input aria-label={field.label} type={field.type === "text" ? "text" : "number"} min={field.type === "text" ? undefined : 0} step={field.integer ? 1 : "any"} value={String(draft.rules[field.key] ?? "")} onChange={event => patchRule(field.key, field.type === "text" || event.target.value === "" ? event.target.value : Number(event.target.value))}/>}</div>)}
          </fieldset>
          {selected.kind === "boost" && draft.rules.action === "CHECKIN_MULTIPLIER" && <p>加成预算耗尽后恢复原有签到奖励，不影响用户继续签到。</p>}
          {selected.kind === "wheel" && <p>抽奖奖项、概率和奖池限制在下方转盘配置维护。</p>}
          {selected.kind === "holding" && <p>总奖池由达成连续持有条件的用户平均分配。</p>}
          {selected.kind === "regional" && <p>排名按加入活动后的有效支付订单金额统计；获胜地区内按个人有效支付金额比例分配奖池，并列第一的地区共同分享总奖池。</p>}
          <div style={{ marginTop: 14 }}><button className="l-btn mc" onClick={save}>{saving ? "正在保存…" : "保存配置"}</button></div>
        </fieldset><button className="l-btn" style={{ marginTop: 10 }} disabled={saving} onClick={() => { setSelected(null); setDraft(null); setError(""); }}>关闭配置</button></>}
      </>}
    </div>
  </section>;
}
