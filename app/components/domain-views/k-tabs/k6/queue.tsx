"use client";

// K6 client-only；数据由挂载后的鉴权 API 请求加载。

/**
 * K6 设备队列(SPEC 1 · PRD §7 / §8 / §11)。
 * 全列(状态/来源/建议动作/优先级/成熟度/环境风险/安装天数/打开次数/最近上报/邀请码渠道/命中策略)
 * + 筛选(状态/风险/渠道/策略 + 搜索)+ 排序 + 分页 25/50/100;行点开 §13 详情。
 */
import { useMemo, useState } from "react";
import { effectiveDevices, useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { timeAgo } from "@/lib/admin/janus-c2/scoring";
import { STATUS_LABEL, STATUS_SOURCE_LABEL, STATUS_TONE, SUGGESTED_ACTION, channelLabel } from "@/lib/admin/janus-c2/labels";
import type { Device, DeviceStatus } from "@/lib/admin/janus-c2/types";
import { K6DeviceDetail } from "./device-detail";

const STATUS_FILTERS: (DeviceStatus | "ALL")[] = [
  "ALL", "NEW", "OBSERVING", "RECOMMENDED", "HIT", "ACTIVATED", "ENV_FILTERED", "MANUAL_HOLD", "MANUAL_FORCED", "BLOCKED", "STALE", "RESET", "ERROR",
];
type RiskFilter = "all" | "low" | "mid" | "high";
const RISK_FILTERS: [RiskFilter, string][] = [["all", "全部风险"], ["low", "低风险"], ["mid", "中风险"], ["high", "高风险"]];
type TimeFilter = "all" | "today" | "24h" | "7d";
const TIME_FILTERS: [TimeFilter, string][] = [["all", "全部时间"], ["today", "今日"], ["24h", "近 24 小时"], ["7d", "近 7 天"]];
type OpFilter = "all" | "pending" | "handled";
const OP_FILTERS: [OpFilter, string][] = [["all", "全部"], ["pending", "未处理"], ["handled", "人工处理过"]];
const SORTS: [string, string][] = [
  ["priority", "优先级分 ↓"], ["recent", "最近上报"], ["maturity", "成熟度分"], ["risk", "环境风险分"], ["install", "安装天数"], ["open", "打开次数"],
];
const PAGE_SIZES = [25, 50, 100];
const DAY_MS = 86_400_000;

function riskBand(score: number): RiskFilter {
  if (score >= 60) return "high";
  if (score >= 40) return "mid";
  return "low";
}

function ScoreBar({ value, kind }: { value: number; kind: "good" | "risk" }) {
  const pctW = Math.max(0, Math.min(100, value));
  const color =
    kind === "risk"
      ? value >= 60 ? "var(--danger)" : value >= 40 ? "var(--warning)" : "var(--brand)"
      : value >= 60 ? "var(--brand)" : value >= 30 ? "var(--warning)" : "var(--ink-4)";
  return (
    <span className="k6-scorebar">
      <span className="track"><i style={{ width: `${pctW}%`, background: color }} /></span>
      <span className="n" style={{ color }}>{value}</span>
    </span>
  );
}

export function K6Queue() {
  const [status, setStatus] = useState<DeviceStatus | "ALL">("ALL");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [time, setTime] = useState<TimeFilter>("all");
  const [op, setOp] = useState<OpFilter>("all");
  const [channel, setChannel] = useState("all");
  const [strategy, setStrategy] = useState("all");
  const [sort, setSort] = useState("priority");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string | null>(null);

  const overrides = useJanusC2Store((s) => s.overrides);
  const devices = useMemo(() => effectiveDevices(overrides), [overrides]);
  const channels = useMemo(() => [...new Set(devices.map((d) => d.channel).filter(Boolean))] as string[], [devices]);
  const strategies = useMemo(() => [...new Set(devices.map((d) => d.hitStrategy).filter(Boolean))] as string[], [devices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const rows = devices.filter((d) => {
      if (status !== "ALL" && d.status !== status) return false;
      if (risk !== "all" && riskBand(d.environmentRiskScore) !== risk) return false;
      if (time === "today" && d.lastSeenAt < now - (now % DAY_MS)) return false;
      if (time === "24h" && now - d.lastSeenAt > DAY_MS) return false;
      if (time === "7d" && now - d.lastSeenAt > 7 * DAY_MS) return false;
      if (op !== "all") {
        const handled = d.statusSource === "manual" || !!d.lastOperatorId;
        if (op === "pending" && handled) return false;
        if (op === "handled" && !handled) return false;
      }
      if (channel !== "all" && d.channel !== channel) return false;
      if (strategy !== "all" && d.hitStrategy !== strategy) return false;
      if (q) {
        const hay = [d.sid, d.inviteCode, d.channel, d.model, d.ua, d.hitStrategy].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorters: Record<string, (a: Device, b: Device) => number> = {
      priority: (a, b) => b.priorityScore - a.priorityScore,
      recent: (a, b) => b.lastSeenAt - a.lastSeenAt,
      maturity: (a, b) => b.maturityScore - a.maturityScore,
      risk: (a, b) => b.environmentRiskScore - a.environmentRiskScore,
      install: (a, b) => b.installDays - a.installDays,
      open: (a, b) => b.maturity.appOpenCount - a.maturity.appOpenCount,
    };
    return [...rows].sort(sorters[sort] ?? sorters.priority);
  }, [devices, status, risk, time, op, channel, strategy, sort, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const start = (curPage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const selectedDevice = selected ? devices.find((d) => d.sid === selected) : undefined;

  const reset = () => setPage(1);

  return (
    <div className="k6-panel">
      <div className="k6-sec-head">
        <div><div className="k6-kicker">设备队列</div><h3>按优先级处理设备</h3><p>状态机驱动的处置工作台:筛选、排序、分页,点开任意设备查看判定轨迹与上下文。</p></div>
        <span className="k6-bdg dim">{filtered.length} 台</span>
      </div>
      <div className="k6-body">
        <div className="k6-toolbar">
          <div className="k6-filters">
            {STATUS_FILTERS.map((s) => (
              <button key={s} className={`k6-filter${status === s ? " active" : ""}`} onClick={() => { setStatus(s); reset(); }}>
                {s === "ALL" ? "全部" : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="k6-toolbar-row">
            <input className="k6-field k6-search" placeholder="搜索 会话 / 邀请码 / 渠道 / 型号 / UA" value={search} onChange={(ev) => { setSearch(ev.target.value); reset(); }} />
            <span className="k6-toolbar-label">风险</span>
            <div className="k6-filters">
              {RISK_FILTERS.map(([v, l]) => (
                <button key={v} className={`k6-filter${risk === v ? " active" : ""}`} onClick={() => { setRisk(v); reset(); }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="k6-toolbar-row">
            <span className="k6-toolbar-label">时间</span>
            <div className="k6-filters">
              {TIME_FILTERS.map(([v, l]) => (
                <button key={v} className={`k6-filter${time === v ? " active" : ""}`} onClick={() => { setTime(v); reset(); }}>{l}</button>
              ))}
            </div>
            <span className="k6-toolbar-label">操作</span>
            <div className="k6-filters">
              {OP_FILTERS.map(([v, l]) => (
                <button key={v} className={`k6-filter${op === v ? " active" : ""}`} onClick={() => { setOp(v); reset(); }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="k6-toolbar-row">
            <span className="k6-toolbar-label">渠道</span>
            <select className="k6-field" value={channel} onChange={(ev) => { setChannel(ev.target.value); reset(); }} aria-label="渠道筛选">
              <option value="all">全部渠道</option>
              {channels.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
            </select>
            <span className="k6-toolbar-label">命中策略</span>
            <select className="k6-field" value={strategy} onChange={(ev) => { setStrategy(ev.target.value); reset(); }} aria-label="策略筛选">
              <option value="all">全部策略</option>
              {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="k6-toolbar-label" style={{ marginLeft: "auto" }}>排序</span>
            <select className="k6-field" value={sort} onChange={(ev) => setSort(ev.target.value)} aria-label="排序方式">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="k6-tbl-wrap">
          <table className="k6-tbl">
            <thead>
              <tr>
                <th>设备</th><th>状态</th><th>来源</th><th>建议动作</th>
                <th className="num">优先级</th><th className="num">成熟度</th><th className="num">环境风险</th>
                <th className="num">安装天数</th><th className="num">打开次数</th><th>最近上报</th><th>邀请码 / 渠道</th><th>命中策略</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={12} className="k6-empty-row">没有匹配的设备,试试放宽筛选条件。</td></tr>
              ) : pageRows.map((d) => (
                <tr key={d.sid} className={`click${selected === d.sid ? " sel" : ""}`} onClick={() => setSelected(d.sid)}>
                  <td><code className="sid">{d.sid}</code><div className="mono dim">{d.platform} · {d.model}</div></td>
                  <td>
                    <span className={`k6-bdg ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                    {d.desiredStatus && d.desiredStatus !== d.status && (
                      <div className="mono dim">待确认 → {STATUS_LABEL[d.desiredStatus]}</div>
                    )}
                  </td>
                  <td><span className="k6-srctag">{STATUS_SOURCE_LABEL[d.statusSource]}</span></td>
                  <td>{SUGGESTED_ACTION[d.status]}</td>
                  <td className="num"><span className="mono">{d.priorityScore}</span></td>
                  <td><ScoreBar value={d.maturityScore} kind="good" /></td>
                  <td><ScoreBar value={d.environmentRiskScore} kind="risk" /></td>
                  <td className="num mono">{d.installDays}</td>
                  <td className="num mono">{d.maturity.appOpenCount}</td>
                  <td className="mono dim">{timeAgo(d.lastSeenAt)}</td>
                  <td className="mono">{d.inviteCode ?? channelLabel(d.channel)}</td>
                  <td className="mono dim">{d.hitStrategy ? `${d.hitStrategy} v${d.hitStrategyVersion}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="k6-pager">
            <span className="k6-pager-info">显示 {start + 1}-{Math.min(start + pageSize, filtered.length)} / 共 {filtered.length} 台</span>
            <div className="k6-pager-actions">
              {PAGE_SIZES.map((sz) => (
                <button key={sz} className={`k6-pgbtn${pageSize === sz ? " active" : ""}`} onClick={() => { setPageSize(sz); setPage(1); }}>每页 {sz}</button>
              ))}
              <button className="k6-pgbtn" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>上一页</button>
              <span className="k6-pgnow">第 {curPage} / {totalPages} 页</span>
              <button className="k6-pgbtn" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>下一页</button>
            </div>
          </div>
        )}
      </div>

      {selectedDevice && <K6DeviceDetail device={selectedDevice} onClose={() => setSelected(null)} />}
    </div>
  );
}
