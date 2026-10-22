"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { displayAdminError } from "@/lib/admin/error-messages";
import { assignPlacement, readPlacements, PlacementError, type PlacementIntent, type PlacementPage, type PlacementStatus } from "@/lib/admin/f3-placements-client";
import { Modal } from "../design-kit";

const stamp = () => { const s = useAdminAuth.getState(); return adminShellSessionKey(s.session, s.authEpoch); };

export function F3Placements() {
  const identity = useAdminAuth(s => adminShellSessionKey(s.session, s.authEpoch));
  const canRead = useAdminAuth(s => s.session?.authorities.includes("network_f3_read") ?? false);
  const canWrite = useAdminAuth(s => s.session?.authorities.includes("network_f3_write") ?? false);
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<PlacementStatus>("ALL");
  const [data, setData] = useState<PlacementPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PlacementIntent | null>(null);
  const [pending, setPending] = useState<PlacementIntent | null>(null);
  const selectedRef = useRef<PlacementIntent | null>(null), pendingRef = useRef<PlacementIntent | null>(null);
  const selectIntent = (intent: PlacementIntent | null) => { selectedRef.current = intent; setSelected(intent); };
  const keepPending = (intent: PlacementIntent | null) => { pendingRef.current = intent; setPending(intent); };
  const active = useRef(true), working = useRef(false), generation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setData(null); selectIntent(null); keepPending(null); setError(""); setNotice(""); setOwner(""); setBusy(false); working.current = false; }, [identity]);
  const current = (key: string, version: number) => active.current && key === stamp() && version === generation.current;

  async function load(page = 1) {
    if (!canRead || working.current || stamp() !== identity) return;
    const ownerUserId = Number(owner.trim());
    if (!/^\d+$/.test(owner.trim()) || !Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) { setError("请输入有效的归属人用户编号。"); return; }
    const key = stamp(), version = ++generation.current;
    working.current = true; setBusy(true); setData(null); setError(""); setNotice("");
    try { const result = await readPlacements(ownerUserId, status, page); if (current(key, version)) setData(result); }
    catch (e) { if (current(key, version)) setError(displayAdminError(e)); }
    finally { if (current(key, version)) { working.current = false; setBusy(false); } }
  }

  async function recover(intent: PlacementIntent) {
    const result = await readPlacements(intent.ownerUserId, "ALL", 1, intent.memberUserId);
    const row = result.records.find(r => r.memberUserId === intent.memberUserId);
    if (row?.leg) return { resolved: true, message: row.leg === intent.leg
      ? `已确认成员 ${intent.memberUserId} 归属 ${intent.ownerUserId} 的 ${row.leg} 轨。`
      : `成员 ${intent.memberUserId} 已归属 ${intent.ownerUserId} 的 ${row.leg} 轨，不能改到 ${intent.leg} 轨。` };
    return { resolved: false, message: row
      ? "当前查询仍未安置，原提交结果尚未确认，请稍后查询原成员结果。"
      : "当前无法确认原成员的安置结果，请稍后查询原成员结果。" };
  }

  async function checkPending() {
    if (!pending || !canRead || working.current || stamp() !== identity) return;
    const key = stamp(), version = ++generation.current, intent = pending;
    working.current = true; setBusy(true); setError("");
    try {
      const result = await recover(intent);
      if (!current(key, version)) return;
      setNotice(result.message);
      if (result.resolved) { keepPending(null); setData(null); }
    } catch (e) { if (current(key, version)) setError(displayAdminError(e)); }
    finally { if (current(key, version)) { working.current = false; setBusy(false); } }
  }

  async function submit() {
    if (!selected || selectedRef.current !== selected || pendingRef.current || working.current || !canWrite || !canRead || stamp() !== identity) return;
    // Never act on a member outside the currently displayed owner and unassigned row.
    if (!data || selected.ownerUserId !== data.ownerUserId || !data.records.some(r => r.memberUserId === selected.memberUserId && r.leg === null)) return;
    const intent = { ...selected }, key = stamp(), version = ++generation.current;
    working.current = true; setBusy(true); setError(""); setNotice(""); keepPending(intent);
    try {
      const result = await assignPlacement(intent);
      if (!current(key, version)) return;
      setNotice(result.replayed ? "该成员已在所选轨道，无需重复安置。" : "成员安置成功。");
      selectIntent(null); keepPending(null); setData(null);
      try {
        const page = await readPlacements(intent.ownerUserId, status, data.page);
        if (current(key, version)) setData(page);
      } catch { if (current(key, version)) setError("安置已确认，列表刷新失败，请重新查询。"); }
    } catch (e) {
      if (!current(key, version)) return;
      selectIntent(null); setData(null); setError(displayAdminError(e));
      if (e instanceof PlacementError && e.outcome === "rejected" && e.status !== 409) keepPending(null);
      else {
        try {
          const result = await recover(intent);
          if (current(key, version)) { setNotice(result.message); if (result.resolved) { keepPending(null); setError(""); } }
        } catch { /* Keep the original owner/member and allow a read-only retry. */ }
      }
    } finally { if (current(key, version)) { working.current = false; setBusy(false); } }
  }

  if (!canRead) return null;
  return <section className="pane ui-placements" aria-label="成员安置">
    <div className="pane-h"><span className="ph-ttl">成员安置</span><span className="ph-sub">查询归属人的直推成员；已有 A/B 轨不能更改。</span></div>
    <div className="card-body">
      <form className="actions" onSubmit={event => { event.preventDefault(); void load(); }}>
        <label>归属人用户编号 <input className="fld" inputMode="numeric" value={owner} disabled={busy || !!pending} onChange={event => { setOwner(event.target.value); setData(null); selectIntent(null); setNotice(""); setError(""); }} /></label>
        <label>安置状态 <select className="fld" value={status} disabled={busy || !!pending} onChange={event => { setStatus(event.target.value as PlacementStatus); setData(null); selectIntent(null); }}><option value="ALL">全部直推成员</option><option value="ASSIGNED">已安置</option><option value="UNASSIGNED">未安置</option></select></label>
        <button className="fbtn primary" type="submit" disabled={busy || !!pending}>查询成员</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">正在处理…</p>}
      {pending && <div><p>待确认：归属人 {pending.ownerUserId} · 成员 {pending.memberUserId} · {pending.leg} 轨</p><button className="fbtn" disabled={busy} onClick={() => void checkPending()}>查询原成员结果</button></div>}
      {data && <>
        <p>归属人 {data.ownerUserId} · 共 {data.total} 名直推成员</p>
        <div className="ui-table-scroll"><table className="ctbl"><thead><tr><th>成员用户编号</th><th>轨道</th><th>安置来源</th><th>安置时间</th><th>操作人</th><th>操作</th></tr></thead><tbody>
          {data.records.map(row => <tr key={row.memberUserId}><td>{row.memberUserId}</td><td>{row.leg ? `${row.leg} 轨` : "未安置"}</td><td>{row.assignmentSource === "AUTO" ? "自动安置" : row.assignmentSource === "MANUAL" ? "人工安置" : "—"}</td><td>{row.assignedAt?.replace("T", " ") || "—"}</td><td>{row.assignedBy || "—"}</td><td>{row.leg ? "已安置" : canWrite ? <div className="actions">{(["A", "B"] as const).map(leg => <button key={leg} className="fbtn" disabled={busy || !!pending} onClick={() => selectIntent({ownerUserId: data.ownerUserId, memberUserId: row.memberUserId, leg})}>安置到 {leg} 轨</button>)}</div> : "只读"}</td></tr>)}
        </tbody></table></div>
        {data.records.length === 0 && <p>当前条件下没有直推成员。</p>}
        <div className="actions"><button className="fbtn" disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>上一页</button><span>第 {data.page} 页</span><button className="fbtn" disabled={busy || data.page * data.pageSize >= data.total} onClick={() => void load(data.page + 1)}>下一页</button></div>
      </>}
      {selected && <Modal title="人工安置确认" busy={busy} onClose={() => { if (!working.current) selectIntent(null); }} footer={<><button className="fbtn" disabled={busy} onClick={() => selectIntent(null)}>取消</button><button className="fbtn primary" disabled={busy || !canWrite || !!pending} onClick={() => void submit()}>确认安置</button></>}>
        <p>归属人用户编号：{selected.ownerUserId}</p><p>成员用户编号：{selected.memberUserId}</p><p>目标轨道：{selected.leg} 轨</p><p>安置后不能改到另一轨；本操作不执行结算。</p>
      </Modal>}
    </div>
  </section>;
}
