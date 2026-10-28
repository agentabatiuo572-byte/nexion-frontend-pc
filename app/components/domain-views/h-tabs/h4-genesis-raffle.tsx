"use client";
import { useEffect, useRef, useState } from "react";
import type { HCtx } from "./types";
import { fetchAdminRaffles, saveAdminRaffle, raffleDraftError, type AdminRaffle, type RaffleDraft, type RafflePrize } from "@/lib/admin/genesis-raffle-client";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";

const empty = (): RaffleDraft => ({ id: "", titleZh: "", titleEn: "", titleVi: "", startsAt: "", drawAt: "", prizes: [] });
const dateInput = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 19) : "";
export default function H4GenesisRaffle({ ctx }: { ctx: HCtx }) {
  const [rows, setRows] = useState<AdminRaffle[]>([]), [base, setBase] = useState<AdminRaffle | null>(null), [draft, setDraft] = useState<RaffleDraft | null>(null);
  const [enabled, setEnabled] = useState(false), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), operator = currentAdminOperator();
  const read = ctx.can("growth_h4_read"), write = ctx.can("growth_h4_write"), locked = !!base && base.status !== "DRAFT";
  const load = async () => {
    const own = ++generation.current; setLoading(true); setError("");
    try { const values = await fetchAdminRaffles(); if (own === generation.current) setRows(values); }
    catch (cause) { if (own === generation.current) setError(displayAdminError(cause)); }
    finally { if (own === generation.current) setLoading(false); }
  };
  useEffect(() => { setSaving(false); setError(""); setRows([]); setDraft(null); setBase(null); if (read) void load(); else setLoading(false); return () => { generation.current += 1; }; }, [read, operator]);
  const choose = (row: AdminRaffle | null) => { setBase(row); setDraft(row ? { id: row.id, titleZh: row.titleZh, titleEn: row.titleEn, titleVi: row.titleVi, startsAt: row.startsAt, drawAt: row.drawAt, prizes: row.prizes.map(prize => ({ ...prize })) } : empty()); setEnabled(row?.status === "OPEN"); setError(""); };
  const prizePatch = (id: string, values: Partial<RafflePrize>) => setDraft(current => current ? { ...current, prizes: current.prizes.map(prize => prize.id === id ? { ...prize, ...values } : prize) } : null);
  const save = () => {
    if (!draft || !write || saving || (base && (base.status === "PROCESSING" || base.status === "DRAWN" || (base.status === "OPEN" && base.totalEntries > 0)))) return;
    const invalid = raffleDraftError(draft); if (invalid) { setError(invalid); return; }
    const savedDraft = draft, previous = base, nextEnabled = !!base && enabled;
    ctx.openActionConfirm({ action: `${nextEnabled ? "保存并开启" : "保存抽奖配置"} · ${draft.titleZh}`, amplifies: nextEnabled,
      detail: <>本期共 {draft.prizes.reduce((sum, prize) => sum + prize.quantity, 0)} 个中奖名额。{nextEnabled ? "开启后用户可按公布时段使用抽奖券报名；开奖时发放配置的奖品。奖项和时间在开启后固定。" : "新建轮次保存为草稿，不会对用户开放。"}</>,
      run: async reason => {
        if (operator !== currentAdminOperator() || !ctx.can("growth_h4_write")) throw new Error("登录身份或权限已变化，请重新打开配置。");
        const own = generation.current; setSaving(true); setError("");
        try {
          const result = await saveAdminRaffle(savedDraft, previous?.revision ?? null, nextEnabled, reason);
          if (own !== generation.current) return;
          setRows(current => current.some(row => row.id === result.id) ? current.map(row => row.id === result.id ? result : row) : [...current, result]); choose(result); ctx.toast("创世抽奖设置已保存");
        } catch (cause) { if (own === generation.current) setError(displayAdminError(cause)); throw cause; }
        finally { if (own === generation.current) setSaving(false); }
      },
    });
  };
  if (!read) return null;
  return <section className="l-card">
    <div className="l-h"><span className="ttl">创世抽奖</span><span className="sub">使用创世抽奖券报名，按配置时间开奖</span><div className="r"><button className="l-btn sm" disabled={loading || saving || !!draft} onClick={() => void load()}>刷新</button><button className="l-btn sm mc" disabled={!write || loading || saving || !!draft} onClick={() => choose(null)}>新建一期</button></div></div>
    <div className="l-b">{error && <p role="alert">{error}</p>}{loading ? <p role="status">正在加载抽奖设置…</p> : <>
      {!rows.length && !error && <p>暂无抽奖轮次。</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{rows.map(row => <button className="l-btn sm" key={row.id} disabled={!!draft || saving} onClick={() => choose(row)}>{row.titleZh || row.id} · {{ DRAFT: "草稿", OPEN: "已开放", PROCESSING: "发放中", DRAWN: "已开奖" }[row.status]} · 已报名 {row.totalEntries} 票</button>)}</div>
      {draft && <>
        <fieldset disabled={!write || saving} style={{ border: 0, padding: 0, marginTop: 16 }}>
          {base && <label className="field"><span>开放报名</span><select aria-label="开放创世抽奖报名" value={String(enabled)} disabled={base.status === "PROCESSING" || base.status === "DRAWN" || base.totalEntries > 0} onChange={event => setEnabled(event.target.value === "true")}><option value="false">关闭</option><option value="true">开启</option></select></label>}
          {locked && <p>本期已开放，奖品与时间固定。已有报名的轮次不能撤销。</p>}
          <fieldset disabled={locked} style={{ border: 0, margin: 0, padding: 0 }}>
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="field"><span>本期编号</span><input value={draft.id} disabled={!!base} onChange={event => setDraft({ ...draft, id: event.target.value })}/></label>
              {(["Zh", "En", "Vi"] as const).map((lang, index) => <label className="field" key={lang}><span>抽奖名称 · {["中文", "英文", "越南语"][index]}</span><input value={draft[`title${lang}`]} onChange={event => setDraft({ ...draft, [`title${lang}`]: event.target.value })}/></label>)}
              {(["startsAt", "drawAt"] as const).map((key, index) => <label className="field" key={key}><span>{index ? "开奖时间" : "报名开始"}（UTC）</span><input type="datetime-local" step={1} value={dateInput(draft[key])} onChange={event => setDraft({ ...draft, [key]: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : "" })}/></label>)}
            </div>
            {draft.prizes.map((prize, index) => <section key={prize.id} style={{ marginTop: 14, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}><b>奖项 {index + 1}</b><div className="grid g-2" style={{ gap: 12, marginTop: 10 }}>
              {(["Zh", "En", "Vi"] as const).map((lang, i) => <label className="field" key={lang}><span>奖项名称 · {["中文", "英文", "越南语"][i]}</span><input value={prize[`name${lang}`]} onChange={event => prizePatch(prize.id, { [`name${lang}`]: event.target.value })}/></label>)}
              <label className="field"><span>奖励类型</span><select value={prize.rewardType} onChange={event => prizePatch(prize.id, { rewardType: event.target.value as RafflePrize["rewardType"], ...(event.target.value === "DEVICE" ? { amount: 1 } : {}) })}><option value="UVT">UVT</option><option value="USDT">USDT</option><option value="DEVICE">设备</option></select></label>
              {prize.rewardType === "DEVICE" ? <label className="field"><span>设备商品编号</span><input value={prize.productNo ?? ""} onChange={event => prizePatch(prize.id, { productNo: event.target.value })}/><small>每个中奖名额发放一台。</small></label> : <label className="field"><span>每名奖励金额</span><input type="number" min="0.000001" step="any" value={prize.amount} onChange={event => prizePatch(prize.id, { amount: event.target.value })}/></label>}
              <label className="field"><span>中奖名额</span><input type="number" min={1} max={100} step={1} value={prize.quantity} onChange={event => prizePatch(prize.id, { quantity: Number(event.target.value) })}/></label>
            </div><button className="l-btn sm" onClick={() => setDraft({ ...draft, prizes: draft.prizes.filter(item => item.id !== prize.id) })}>移除此奖项</button></section>)}
            <button className="l-btn sm" style={{ marginTop: 10 }} disabled={draft.prizes.length >= 20} onClick={() => setDraft({ ...draft, prizes: [...draft.prizes, { id: `prize-${Date.now().toString(36)}-${draft.prizes.length}`, nameZh: "", nameEn: "", nameVi: "", rewardType: "UVT", amount: "", quantity: 1 }] })}>添加奖项</button>
            <p>本期总名额：{draft.prizes.reduce((sum, prize) => sum + prize.quantity, 0)} / 100</p>
          </fieldset>
          <button className="l-btn mc" disabled={base?.status === "PROCESSING" || base?.status === "DRAWN" || (!!base && base.status === "OPEN" && base.totalEntries > 0)} onClick={save}>{saving ? "正在保存…" : base ? "保存配置" : "保存草稿"}</button>
        </fieldset>
        <button className="l-btn" style={{ marginTop: 10 }} disabled={saving} onClick={() => { setDraft(null); setBase(null); setError(""); }}>关闭配置</button>
      </>}
    </>}</div>
  </section>;
}
