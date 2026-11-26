"use client";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { assignPlacement, checkPlacement, readPlacements, rememberPlacement, pendingPlacement, forgetPlacement, PlacementError, type PlacementIntent, type PlacementPage, type PlacementStatus } from "@/lib/admin/f3-placements-client";
import { CircleDashed, Eye, Users } from "lucide-react";
import { Button, Cell, Explain, Panel, Fact, Facts, FilterBar, FilterField, Input, IrreversibleTag, Modal, Notice, Select, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";

const stamp = () => { const s = useAdminAuth.getState(); return adminShellSessionKey(s.session, s.authEpoch); };

export async function recoverPlacement(adminId: number, intent: PlacementIntent) {
    const { row, resolved } = await checkPlacement(adminId);
    if (row?.leg) return { resolved, message: row.leg === intent.leg
      ? `已确认：成员 ${intent.memberUserId} 在用户 ${intent.ownerUserId} 的 ${row.leg} 组。`
      : `成员 ${intent.memberUserId} 已在用户 ${intent.ownerUserId} 的 ${row.leg} 组，不能改到 ${intent.leg} 组。` };
    return { resolved: false, message: row
      ? "该成员现在还没分组，提交结果未知，请稍后再查。"
      : "暂时无法确认分组结果，请稍后再查。" };
  }


export function F3Placements() {
  const identity = useAdminAuth(s => adminShellSessionKey(s.session, s.authEpoch));
  const canRead = useAdminAuth(s => s.session?.authorities.includes("network_f3_read") ?? false);
  const canWrite = useAdminAuth(s => s.session?.authorities.includes("network_f3_write") ?? false);
  const adminId = useAdminAuth(s => s.session?.adminId);
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
  useEffect(() => { generation.current++; setData(null); selectIntent(null); keepPending(adminId === undefined ? null : pendingPlacement(adminId)?.intent ?? null); setError(""); setNotice(""); setOwner(""); setBusy(false); working.current = false; }, [identity, adminId]);
  const current = (key: string, version: number) => active.current && key === stamp() && version === generation.current;

  async function load(page = 1) {
    if (!canRead || working.current || stamp() !== identity) return;
    const ownerUserId = Number(owner.trim());
    if (!/^\d+$/.test(owner.trim()) || !Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) { setError("请输入有效的邀请人用户编号。"); return; }
    const key = stamp(), version = ++generation.current;
    working.current = true; setBusy(true); setData(null); setError(""); setNotice("");
    try { const result = await readPlacements(ownerUserId, status, page); if (current(key, version)) setData(result); }
    catch (e) { if (current(key, version)) setError(displayAdminReadError(e)); }
    finally { if (current(key, version)) { working.current = false; setBusy(false); } }
  }

  async function checkPending() {
    if (!pending || !canRead || working.current || stamp() !== identity) return;
    const key = stamp(), version = ++generation.current, intent = pending;
    working.current = true; setBusy(true); setError("");
    try {
      const result = await recoverPlacement(adminId!, intent);
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
    try { rememberPlacement(adminId!, intent); }
    catch (error) { setError(displayAdminError(error)); return; }
    working.current = true; setBusy(true); setError(""); setNotice(""); keepPending(intent);
    try {
      const result = await assignPlacement(intent);
      if (!current(key, version)) return;
      setNotice(result.replayed ? "该成员已在这一组，不用重复分组。" : "成员分组成功。");
      selectIntent(null); forgetPlacement(adminId!); keepPending(null); setData(null);
      try {
        const page = await readPlacements(intent.ownerUserId, status, data.page);
        if (current(key, version)) setData(page);
      } catch { if (current(key, version)) setError("分组成功，但列表刷新失败，请重新查询。"); }
    } catch (e) {
      if (!current(key, version)) return;
      selectIntent(null); setData(null); setError(displayAdminError(e));
      if (e instanceof PlacementError && e.outcome === "rejected" && e.status !== 409) { forgetPlacement(adminId!); keepPending(null); }
      else {
        try {
          const result = await recoverPlacement(adminId!, intent);
          if (current(key, version)) { setNotice(result.message); if (result.resolved) { keepPending(null); setError(""); } }
        } catch (readError) { if (current(key, version)) setError(displayAdminError(readError)); }
      }
    } finally { if (current(key, version)) { working.current = false; setBusy(false); } }
  }

  if (!canRead) return null;
  const original = adminId === undefined ? undefined : pendingPlacement(adminId);
  const legTag = (leg: "A" | "B" | null) => leg
    ? <span className="f3-leg" data-leg={leg}>{leg} 组</span>
    : <StatusTag tone="neutral" icon={CircleDashed}>未分组</StatusTag>;
  const counts = data && data.total <= data.records.length && data.status === "ALL"
    ? { A: data.records.filter(r => r.leg === "A").length, B: data.records.filter(r => r.leg === "B").length, none: data.records.filter(r => !r.leg).length }
    : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <Panel title="成员分组" icon={Users} tone="role-3" className="f3-members" aria-label="成员分组"
    explain={<>
      <p>查一位邀请人的直接好友，看谁在 A 组、谁在 B 组、谁还没分组；把没分组的分到一边。</p>
      <p>分组直接写入，不走审批，也不会触发结算；分了就不能换到另一组。只列这位邀请人现在还有效的直接好友，一页 20 人。</p>
    </>}
    actions={!canWrite ? <StatusTag tone="neutral" icon={Eye}>只读</StatusTag> : undefined}>
    <FilterBar onSubmit={() => void load()} querying={busy} sort={<span className="rd-filter-result">一页 20 人，按成员编号排</span>}
      action={<Button type="submit" variant="primary" disabledReason={pending ? "有一条分组结果未知，先读取当前分组核对" : undefined} loading={busy} disabled={busy || !!pending}>查询成员</Button>}>
      <FilterField>
        <Input inputMode="numeric" value={owner} disabled={busy || !!pending} placeholder="邀请人用户编号" aria-label="邀请人用户编号" size={16}
          onChange={event => { setOwner(event.target.value); setData(null); selectIntent(null); setNotice(""); setError(""); }} />
      </FilterField>
      <FilterField>
        <Select aria-label="分组状态" value={status} disabled={busy || !!pending} onChange={value => { setStatus(value as PlacementStatus); setData(null); selectIntent(null); }}
          options={[{ value: "ALL", label: "全部成员" }, { value: "ASSIGNED", label: "已分组" }, { value: "UNASSIGNED", label: "未分组" }]} />
      </FilterField>
    </FilterBar>
    {pending && <Notice tone="warn" title={<>分组结果未知<Explain label="结果未知怎么处理" content="提交时没收到确定结果，可能已经分好了。点「读取当前分组」按原来的邀请人和成员读取现在的分组；读到已在原来那一组就算完成，读到在另一组说明不能换。仍没分组时保留这条，不会自动再提交一次。" /></>}
      action={<Button size="sm" disabled={busy} onClick={() => void checkPending()}>读取当前分组</Button>}>
      邀请人 {pending.ownerUserId} · 成员 {pending.memberUserId} → {pending.leg} 组
      {original && isRetryExpired(original) && <p>{RETRY_EXPIRED_TEXT}</p>}
    </Notice>}
    {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
    {notice && <div role="status"><Notice tone="neutral">{notice}</Notice></div>}
    {busy && !data && <p role="status" className="f3-members-busy">正在处理…</p>}
    {!data && !busy && !error && <p className="f3-members-empty">输入邀请人用户编号，查他的直接好友和分组。</p>}
    {data && <>
      <p className="f3-members-sum">
        <span>邀请人 <b>{data.ownerUserId}</b> · {data.status === "ALL" ? "直接好友" : data.status === "ASSIGNED" ? "已分组的直接好友" : "未分组的直接好友"} <b>{data.total.toLocaleString("en-US")}</b> 人</span>
        {counts && <span className="f3-members-legs"><span className="f3-leg" data-leg="A">A 组 {counts.A}</span><span className="f3-leg" data-leg="B">B 组 {counts.B}</span><span>未分组 {counts.none}</span></span>}
      </p>
      <Table label="直接好友的分组" className="f3-member-table">
        <thead><tr><Th>成员用户编号</Th><Th>所在组</Th><Th>分组方式</Th><Th>分组时间（{businessZone().label}）</Th><Th>操作人</Th><Th>操作</Th></tr></thead>
        <tbody>
          {data.records.map(row => <Tr key={row.memberUserId}>
            <Td><Cell main={<span data-mono>{row.memberUserId}</span>} /></Td>
            <Td>{legTag(row.leg)}</Td>
            <Td>{row.assignmentSource === "AUTO" ? "自动分组" : row.assignmentSource === "MANUAL" ? "人工分组" : "—"}</Td>
            <Td><Cell num main={formatBusinessTimeCompact(row.assignedAtIso ?? row.assignedAt, "—")} /></Td>
            <Td>{row.assignedBy || "—"}</Td>
            <Td data-fit="">{row.leg ? <span className="f3-weak">已分组</span> : canWrite ? <span className="f3-row-actions">{(["A", "B"] as const).map(leg => <Button key={leg} size="sm" disabled={busy || !!pending} onClick={() => selectIntent({ownerUserId: data.ownerUserId, memberUserId: row.memberUserId, leg})}>分到 {leg} 组</Button>)}</span> : <span className="f3-weak">只读</span>}</Td>
          </Tr>)}
          {data.records.length === 0 && <TableMessage columns={6}>没有符合条件的成员。</TableMessage>}
        </tbody>
      </Table>
      {data.total > data.pageSize && <div className="f3-members-pager">
        <Button size="sm" disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>上一页</Button>
        <span>第 {data.page} 页，共 {pages} 页</span>
        <Button size="sm" disabled={busy || data.page * data.pageSize >= data.total} onClick={() => void load(data.page + 1)}>下一页</Button>
      </div>}
    </>}
    {selected && <Modal title={`把成员分到 ${selected.leg} 组`} icon={Users} tone="danger" sub={<IrreversibleTag>归了就不能换</IrreversibleTag>} busy={busy}
      onClose={() => { if (!working.current) selectIntent(null); }}
      footer={<><Button disabled={busy} onClick={() => selectIntent(null)}>取消</Button><Button variant="danger" loading={busy} loadingText="提交中…" disabled={busy || !canWrite || !!pending} onClick={() => void submit()}>确认分组</Button></>}>
      <Facts>
        <Fact k="邀请人用户编号">{selected.ownerUserId}</Fact>
        <Fact k="这次要分的成员">成员 {selected.memberUserId} → <span className="f3-leg" data-leg={selected.leg}>{selected.leg} 组</span></Fact>
      </Facts>
      <Notice tone="warn" title="归了就不能换">分组后不能改到另一组，没有换组的入口。直接写入，不走审批，也不触发结算。</Notice>
    </Modal>}
  </Panel>;
}
