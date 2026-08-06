"use client";

/**
 * G4 创世邀请码 — 发码 / 追溯 / 作废(规格 FEAT-GEN11)。
 * 数据与动作走 lib/admin/g4-invite-client.ts(mock 数据源,结构按真后台写)。
 * 视觉沿用 G 域既有身份(l-card / l-tbl / l-btn),不新造。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { DataListPager, useDataListPager } from "../design-kit";
import {
  G4_INVITE_MAX_BATCH,
  G4_INVITE_NOTE_MAX,
  G4_INVITE_REASON_MAX,
  G4_INVITE_REASON_MIN,
  G4_INVITE_STATUS_LABEL,
  G4_INVITE_STATUS_TONE,
  fetchG4InviteCodes,
  issueG4InviteCodes,
  voidG4InviteCode,
  type G4InviteCode,
  type G4InviteRegistry,
  type G4InviteStatus,
} from "@/lib/admin/g4-invite-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

type StatusFilter = G4InviteStatus | "all";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "unused", label: G4_INVITE_STATUS_LABEL.unused },
  { key: "used", label: G4_INVITE_STATUS_LABEL.used },
  { key: "void", label: G4_INVITE_STATUS_LABEL.void },
];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fmtTime(ts: number | null) {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

export default function G4InviteCodes({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const canWrite = session?.role === "super" || session?.role === "superadmin"
    || !!session?.authorities.includes("finprod_g4_write");

  const [registry, setRegistry] = useState<G4InviteRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [issueCount, setIssueCount] = useState("3");
  const [issueNote, setIssueNote] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setRegistry(await fetchG4InviteCodes());
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const all = registry?.codes ?? [];
    return filter === "all" ? all : all.filter((row) => row.status === filter);
  }, [registry, filter]);
  const pager = useDataListPager(rows, { resetKey: filter });

  const countOf = (key: StatusFilter) => registry?.counts[key] ?? 0;
  const issueCountNumber = Number(issueCount);
  const issueCountOk = Number.isInteger(issueCountNumber)
    && issueCountNumber >= 1 && issueCountNumber <= G4_INVITE_MAX_BATCH;

  const runIssue = () => openActionConfirm({
    action: "生成创世邀请码",
    detail: <>
      本次生成 <b>{issueCountOk ? issueCountNumber : 0}</b> 个互不重复的邀请码,状态为「{G4_INVITE_STATUS_LABEL.unused}」,
      发放人与发放时间随码留痕。码值由系统生成,不接受手输。
      {issueNote.trim() ? <><br />发放备注:{issueNote.trim()}</> : null}
    </>,
    amplifies: false,
    run: async (reason) => {
      if (!issueCountOk) throw new Error(`单次生成数量需为 1-${G4_INVITE_MAX_BATCH} 的整数`);
      setBusy(true);
      try {
        const result = await issueG4InviteCodes(issueCountNumber, issueNote, currentAdminOperator());
        setRegistry(result.registry);
        setError("");
        setIssueNote("");
        setFilter("unused");
        toast(`已生成 ${result.issued.length} 个邀请码 · 操作理由已留痕(${reason.slice(0, 12)}…)`);
      } catch (cause) {
        setError(messageOf(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
  });

  const runVoid = (row: G4InviteCode) => openActionConfirm({
    action: `作废创世邀请码 · ${row.code}`,
    detail: <>
      作废后该码永久不可再被核销,且<b>不可撤回</b>。当前状态「{G4_INVITE_STATUS_LABEL[row.status]}」
      {row.note ? ` · 发放备注 ${row.note}` : ""} · 发放人 {row.issuedBy}。
      已核销的邀请码不提供作废入口,收回资格请改走取消资格流程。
    </>,
    amplifies: false,
    reasonMax: G4_INVITE_REASON_MAX,
    businessForm: {
      kind: "destructive-reason",
      target: row.code,
      impact: "该码将转为「已作废」终态,持码用户再提交会被拒绝;作废人、时刻与理由随码留痕。",
    },
    run: async (reason) => {
      setBusy(true);
      try {
        const result = await voidG4InviteCode(row.code, reason, currentAdminOperator());
        setRegistry(result.registry);
        setError("");
        toast(`${row.code} 已作废`);
      } catch (cause) {
        setError(messageOf(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
  });

  if (loading) {
    return (
      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h"><span className="ttl">创世邀请码</span><span className="sub">· 正在读取码表</span></div>
        <div className="l-b"><div className="gtint">邀请码码表加载中...</div></div>
      </section>
    );
  }

  if (!registry) {
    return (
      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h"><span className="ttl">创世邀请码</span><span className="sub">· 码表</span></div>
        <div className="l-b">
          <div className="gtint">邀请码码表读取失败 · {error || "UNKNOWN_ERROR"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void load()}>重新加载</button>
        </div>
      </section>
    );
  }

  return (
    <section className="l-card" style={{ marginBottom: 16 }}>
      <div className="l-h">
        <span className="ttl">创世邀请码</span>
        <span className="sub">· 一码一用 · 每个账号限用一次</span>
      </div>
      <div className="l-b">
        {error && (
          <div className="gtint" style={{ marginBottom: 12 }}>
            上一步操作未完成 · {error}
            <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void load()}>重试</button>
          </div>
        )}

        <div className="grid g-3" style={{ gap: 10, marginBottom: 12 }}>
          <input
            className="fld"
            type="number"
            min={1}
            max={G4_INVITE_MAX_BATCH}
            step={1}
            value={issueCount}
            aria-label="生成数量"
            onChange={(event) => setIssueCount(event.target.value)}
            placeholder={`生成数量(1-${G4_INVITE_MAX_BATCH})`}
          />
          <input
            className="fld"
            type="text"
            maxLength={G4_INVITE_NOTE_MAX}
            value={issueNote}
            aria-label="发放备注"
            onChange={(event) => setIssueNote(event.target.value)}
            placeholder="发放备注(选填,如渠道或对接人)"
          />
          {canWrite && (
            <button className="l-btn mc" disabled={busy || !issueCountOk} onClick={runIssue}>
              {busy ? "处理中…" : "生成邀请码"}
            </button>
          )}
        </div>
        {!issueCountOk && (
          <div className="tiny" style={{ marginBottom: 10, color: "var(--danger)" }}>
            生成数量需为 <span className="nowrap">1-{G4_INVITE_MAX_BATCH}</span> 的整数,填对后按钮才会启用。
          </div>
        )}

        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {FILTERS.map((item) => (
            <button
              key={item.key}
              className={`l-btn sm${filter === item.key ? " mc" : ""}`}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {item.label} <span className="nowrap">{countOf(item.key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="l-tbl" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>邀请码</th>
              <th>状态</th>
              <th>发放备注</th>
              <th>发放人 · 发放时间</th>
              <th>去向留痕</th>
              {canWrite && <th>动作</th>}
            </tr>
          </thead>
          <tbody>
            {pager.pageRows.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 6 : 5} style={{ padding: 18, color: "var(--ink-3)" }}>
                  {registry.counts.all === 0
                    ? "还没有发过创世邀请码。填好数量与备注后点「生成邀请码」,系统会铸出互不重复的码。"
                    : `当前筛选「${FILTERS.find((item) => item.key === filter)?.label}」下没有邀请码,换个筛选看看。`}
                </td>
              </tr>
            ) : pager.pageRows.map((row) => (
              <tr key={row.code}>
                <td className="mono" style={{ color: "var(--ink)" }}>{row.code}</td>
                <td><span className={`bdg ${G4_INVITE_STATUS_TONE[row.status]}`}>{G4_INVITE_STATUS_LABEL[row.status]}</span></td>
                <td style={{ fontSize: 12 }}>{row.note || "—"}</td>
                <td style={{ fontSize: 12 }}>{row.issuedBy} · <span className="mono">{fmtTime(row.issuedAt)}</span></td>
                <td style={{ fontSize: 12 }}>
                  {row.status === "used" ? (
                    <>
                      <Link href={`/users/search?q=${encodeURIComponent(row.redeemedBy ?? "")}`} className="mono">{row.redeemedBy ?? "—"}</Link>
                      {" · "}<span className="mono">{fmtTime(row.redeemedAt)}</span>
                    </>
                  ) : row.status === "void" ? (
                    <>{row.voidedBy} · <span className="mono">{fmtTime(row.voidedAt)}</span><br />理由:{row.voidReason}</>
                  ) : "—"}
                </td>
                {canWrite && (
                  <td>
                    {/* 🔴 规格 ④:已核销 / 已作废的码**不渲染**作废入口(禁用态仍暗示「某些条件下可作废」)。 */}
                    {row.status === "unused"
                      ? <button className="l-btn sm" disabled={busy} onClick={() => runVoid(row)}>作废</button>
                      : <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DataListPager
        label="创世邀请码"
        page={pager.page}
        pageSize={pager.pageSize}
        total={pager.total}
        rawTotal={registry.counts.all}
        onPageChange={pager.setPage}
        onPageSizeChange={pager.setPageSize}
      />

      <div className="l-b" style={{ paddingTop: 0 }}>
        <div className="gtint">
          <b>一码一用</b> · 码由系统生成,核销一次即转「{G4_INVITE_STATUS_LABEL.used}」终态;每个账号至多持有一个码。
          作废仅对「{G4_INVITE_STATUS_LABEL.unused}」的码开放,须填 <span className="nowrap">{G4_INVITE_REASON_MIN}-{G4_INVITE_REASON_MAX} 字</span>理由并留痕。
        </div>
      </div>
    </section>
  );
}
