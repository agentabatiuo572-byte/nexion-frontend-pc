"use client";

// K6 client-only；挂载后从鉴权接口加载业务数据。

/**
 * K6 看板(总览)— Janus C2 控制台 v3 设计稿总览 port + PRD §5.2 / §20.2 漏斗。
 * 全部从后端设备与生效策略派生。
 */
import { useMemo, useState } from "react";
import { Boxes, Signal, Zap, Target, HeartPulse, ArrowRight, Download } from "lucide-react";
import { effectiveDevices, useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { primaryActiveStrategy } from "@/lib/admin/janus-c2/strategies";
import { summarize, timeAgo } from "@/lib/admin/janus-c2/scoring";
import { computeHealth } from "@/lib/admin/janus-c2/health";
import { recordK6Export } from "@/lib/admin/k6-client";
import { ACTION_TYPE_LABEL, HEALTH_LEVEL_LABEL, remoteUrlLabel } from "@/lib/admin/janus-c2/labels";
import type { Device, HealthLevel } from "@/lib/admin/janus-c2/types";
import { useK6Operator } from "./use-operator";

const AUDIT_TARGET: Record<string, string> = { device: "设备", strategy: "策略", config: "配置" };

const pct = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0);

const LEVEL_COLOR: Record<HealthLevel, string> = { HEALTHY: "var(--success)", WARNING: "var(--warning)", RISK: "var(--warning)", CRITICAL: "var(--danger)" };

function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

interface Seg {
  key: string;
  label: string;
  count: number;
  color: string;
}

function composition(devices: Device[]): Seg[] {
  const has = (pred: (d: Device) => boolean): number => devices.filter(pred).length;
  return [
    // 互斥分桶(12 态完整划分,无重叠 → 堆叠条不溢出 100%)。
    { key: "takeover", label: "已接管(命中 / 激活 / 手动)", count: has((d) => ["HIT", "ACTIVATED", "MANUAL_FORCED"].includes(d.status)), color: "var(--brand)" },
    { key: "recommend", label: "建议下发", count: has((d) => d.status === "RECOMMENDED"), color: "var(--warning)" },
    { key: "observe", label: "观察 / 新设备", count: has((d) => d.status === "OBSERVING" || d.status === "NEW"), color: "var(--cyan)" },
    { key: "filtered", label: "环境过滤", count: has((d) => d.status === "ENV_FILTERED"), color: "var(--danger)" },
    { key: "other", label: "挂起 / 禁止 / 其他", count: has((d) => ["MANUAL_HOLD", "BLOCKED", "STALE", "RESET", "ERROR"].includes(d.status)), color: "var(--ink-4)" },
  ].filter((s) => s.count > 0);
}

function Pipe({ audience, trigger, timing, target }: { audience: string; trigger: string; timing: string; target: string }) {
  return (
    <div className="k6-pipe" aria-label="当前策略管线">
      <div className="k6-pipe-cell"><span>对象</span><b>{audience}</b></div>
      <ArrowRight className="k6-pipe-arrow" size={16} aria-hidden />
      <div className="k6-pipe-cell"><span>触发</span><b>{trigger}</b></div>
      <ArrowRight className="k6-pipe-arrow" size={16} aria-hidden />
      <div className="k6-pipe-cell"><span>接管</span><b>{timing}</b></div>
      <ArrowRight className="k6-pipe-arrow" size={16} aria-hidden />
      <div className="k6-pipe-cell target"><span>目标</span><b>{target}</b></div>
    </div>
  );
}

export function K6Dashboard() {
  const overrides = useJanusC2Store((s) => s.overrides);
  const strategies = useJanusC2Store((s) => s.strategies);
  const devices = useMemo(() => effectiveDevices(overrides), [overrides]);
  const sum = useMemo(() => summarize(devices), [devices]);
  const segs = useMemo(() => composition(devices), [devices]);
  const strat = primaryActiveStrategy(strategies);
  const audit = useJanusC2Store((s) => s.audit);
  const serverHealth = useJanusC2Store((s) => s.health);
  const hydrate = useJanusC2Store((s) => s.hydrate);
  const operator = useK6Operator();
  const fallbackHealth = useMemo(() => computeHealth(devices, strategies, audit), [devices, strategies, audit]);
  const health = serverHealth ?? fallbackHealth;
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const total = devices.length || 1;
  const abnormalCount = health.indicators.filter((i) => i.level !== "HEALTHY").length;
  // 待处理动作队列(PRD §5.2):四类需运营介入的设备计数。
  const hitPending = devices.filter((d) => d.status === "HIT").length;
  const stalePending = devices.filter((d) => d.status === "STALE").length;

  const nextTitle = sum.recommended ? "下一步:处理建议下发队列" : "下一步:等待设备进入建议队列";
  const nextCopy = sum.recommended
    ? `当前有 ${sum.recommended} 台设备建议下发。优先处理优先级最高的设备,从设备队列进入详情确认接管。`
    : "暂无建议下发设备。保持当前策略,不要强行处理低成熟度会话,继续累计行为信号。";

  // 命中漏斗(PRD §20.2):总设备 → 在线 → 环境通过 → 成熟达标 → 建议 → 命中 → 激活;展示每层数量 + 占比。
  // 「环比变化」需要健康历史快照；当前只展示业务表中的最新上报态。
  const envPass = devices.filter((d) => d.status !== "ENV_FILTERED").length;
  const mature = devices.filter((d) => d.recommendationScore >= 60).length;
  const funnel = [
    { label: "总设备", n: sum.totalDevices },
    { label: "在线活跃", n: sum.activeDevices },
    { label: "环境通过", n: envPass },
    { label: "成熟达标", n: mature },
    { label: "建议下发", n: sum.recommended },
    { label: "已命中", n: sum.hit },
    { label: "已激活", n: sum.activated },
  ];
  const funnelMax = Math.max(...funnel.map((f) => f.n), 1);

  const exportHealth = async (format: "csv" | "json") => {
    setExporting(format);
    setExportError(null);
    try {
      const file = await recordK6Export("health", format, { devices: sum.totalDevices, healthLevel: health.level });
      const data = file.data as { indicators?: Array<{ label?: unknown; value?: unknown; level?: unknown; note?: unknown }> };
      const content = format === "json"
        ? JSON.stringify(file.data, null, 2)
        : [["指标", "数值", "分级", "说明"], ...(data.indicators ?? []).map((i) => [i.label, i.value, i.level, i.note])]
          .map((row) => row.map((cell) => csvCell(String(cell ?? ""))).join(",")).join("\n");
      downloadFile(file.fileName, content, format === "json" ? "application/json" : "text/csv;charset=utf-8");
      await hydrate();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  const exportFunnel = async (format: "csv" | "json") => {
    setExporting(format);
    setExportError(null);
    try {
      const file = await recordK6Export("funnel", format, { devices: sum.totalDevices });
      const rows = Array.isArray(file.data) ? file.data as Array<{ label?: unknown; count?: unknown; rate?: unknown }> : [];
      const content = format === "json"
        ? JSON.stringify(file.data, null, 2)
        : [["阶段", "数量", "占总设备比例"], ...rows.map((row) => [row.label, row.count, `${row.rate}%`])]
          .map((row) => row.map((cell) => csvCell(String(cell ?? ""))).join(",")).join("\n");
      downloadFile(file.fileName, content, format === "json" ? "application/json" : "text/csv;charset=utf-8");
      await hydrate();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      {/* 下一步动作 */}
      <div className="k6-command">
        <div className="k6-cmd-kicker">下一步 · 决策建议</div>
        <div className="k6-cmd-title">{nextTitle}</div>
        <div className="k6-cmd-copy">{nextCopy}</div>
        <div className="k6-pending" aria-label="待处理动作队列">
          <div className="k6-pending-chip"><b>{sum.recommended}</b><span>建议待确认</span></div>
          <div className="k6-pending-chip"><b>{hitPending}</b><span>命中未激活</span></div>
          <div className="k6-pending-chip"><b>{sum.envFiltered}</b><span>过滤待核查</span></div>
          <div className="k6-pending-chip"><b>{stalePending}</b><span>过期未上报</span></div>
        </div>
      </div>

      {/* 指标 */}
      <div className="k6-metrics">
        <div className="k6-metric">
          <div className="k6-metric-head"><span className="k6-metric-k">会话总数</span><span className="k6-metric-ico"><Boxes size={18} aria-hidden /></span></div>
          <div><div className="k6-metric-v">{sum.totalDevices}</div><div className="k6-metric-note">当前快照设备</div></div>
        </div>
        <div className="k6-metric">
          <div className="k6-metric-head"><span className="k6-metric-k">在线会话</span><span className="k6-metric-ico"><Signal size={18} aria-hidden /></span></div>
          <div><div className="k6-metric-v">{sum.activeDevices}</div><div className="k6-metric-note">5 分钟内上报</div></div>
        </div>
        <div className="k6-metric accent">
          <div className="k6-metric-head"><span className="k6-metric-k">建议下发</span><span className="k6-metric-ico"><Zap size={18} aria-hidden /></span></div>
          <div><div className="k6-metric-v">{sum.recommended}</div><div className="k6-metric-note">真实且未激活</div></div>
        </div>
        <div className="k6-metric">
          <div className="k6-metric-head"><span className="k6-metric-k">命中率</span><span className="k6-metric-ico"><Target size={18} aria-hidden /></span></div>
          <div><div className="k6-metric-v">{sum.hitRate}%</div><div className="k6-metric-note">已命中 + 已激活 / 总数</div></div>
        </div>
      </div>

      {/* 当前策略管线 */}
      {strat && (
        <div className="k6-panel">
          <div className="k6-sec-head">
            <div><div className="k6-kicker">当前生效策略</div><h3>{strat.name}</h3><p>{strat.description}</p></div>
            <span className="k6-bdg good">优先级 {strat.priority}</span>
          </div>
          <div className="k6-body">
            <Pipe
              audience={strat.action.type === "ENV_FILTER" ? "所有会话" : "真实设备"}
              trigger={strat.scope.inviteCodes?.length ? "邀请码命中" : strat.ruleTree.mode === "WEIGHTED_SCORE" ? "加权评分达标" : "成熟度达标"}
              timing={ACTION_TYPE_LABEL[strat.action.type]}
              target={strat.action.remoteUrlKey ? `远程地址 · ${remoteUrlLabel(strat.action.remoteUrlKey)}` : "—"}
            />
          </div>
        </div>
      )}

      {/* 决策构成 */}
      <div className="k6-panel">
        <div className="k6-sec-head"><div><div className="k6-kicker">决策构成</div><h3>设备状态分布</h3><p>接管、建议、观察、过滤与其他状态的占比。</p></div><span className="k6-bdg dim">{sum.totalDevices} 条</span></div>
        <div className="k6-body">
          <div className="k6-stacked">
            {segs.map((s) => (<span key={s.key} className="k6-seg" style={{ width: `${pct(s.count, total)}%`, background: s.color }} />))}
          </div>
          <div className="k6-legend">
            {segs.map((s) => (
              <div key={s.key} className="k6-bar-row">
                <span className="k6-leg"><i style={{ background: s.color }} />{s.label}</span>
                <span className="k6-bar-ct">{s.count}</span>
                <span className="k6-bar-pct">{pct(s.count, total)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 策略健康度分级(§12)+ 报表导出(§20) */}
      <div className="k6-panel">
        <div className="k6-sec-head">
          <div><div className="k6-kicker">策略健康度</div><h3>多维健康分级</h3><p>覆盖率、命中率、过滤率、人工干预、策略冲突、回滚率等指标综合评级与下钻。</p></div>
          {operator.role !== "viewer" && <div style={{ display: "flex", gap: 8 }}>
            <button className="k6-pgbtn" disabled={exporting !== null} onClick={() => void exportHealth("csv")}><Download size={14} aria-hidden style={{ marginRight: 4 }} />{exporting === "csv" ? "导出中…" : "导出 CSV"}</button>
            <button className="k6-pgbtn" disabled={exporting !== null} onClick={() => void exportHealth("json")}>{exporting === "json" ? "导出中…" : "导出 JSON"}</button>
          </div>}
        </div>
        {exportError && <div className="k6-empty k6-error">导出失败：{exportError}</div>}
        <div className="k6-body">
          <div className="k6-health-head">
            <span className="k6-health-dot" style={{ background: LEVEL_COLOR[health.level] }} />
            <div>
              <div className="k6-health-lv" style={{ color: LEVEL_COLOR[health.level] }}>{HEALTH_LEVEL_LABEL[health.level]}</div>
              <div className="k6-health-sub">{health.indicators.length} 项指标 · {abnormalCount ? `${abnormalCount} 项需关注` : "全部正常"}</div>
            </div>
            <HeartPulse size={18} aria-hidden style={{ color: "var(--ink-4)", marginLeft: "auto" }} />
          </div>
          <div className="k6-health-grid">
            {health.indicators.map((i) => (
              <div key={i.key} className="k6-health-cell">
                <div className="hk"><span className="k6-tone-dot" style={{ background: LEVEL_COLOR[i.level] }} />{i.label}</div>
                <div className="hv">{i.value}</div>
                <div className="hn">{i.note}</div>
              </div>
            ))}
          </div>
          {health.level !== "HEALTHY" && (
            <div className="k6-reasons">
              <h4>异常下钻与建议处理</h4>
              <ul>
                {health.reasons.map((r, idx) => <li key={`r${idx}`}>{r}</li>)}
                {health.suggestions.map((sug, idx) => <li key={`s${idx}`} className="sug">建议:{sug}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 命中漏斗 */}
      <div className="k6-panel">
        <div className="k6-sec-head">
          <div><div className="k6-kicker">转化漏斗</div><h3>命中漏斗</h3><p>从总设备到激活的逐层转化与占比。</p></div>
          {operator.role !== "viewer" && <div style={{ display: "flex", gap: 8 }}>
            <button className="k6-pgbtn" disabled={exporting !== null} onClick={() => void exportFunnel("csv")}><Download size={14} aria-hidden style={{ marginRight: 4 }} />导出 CSV</button>
            <button className="k6-pgbtn" disabled={exporting !== null} onClick={() => void exportFunnel("json")}>导出 JSON</button>
          </div>}
        </div>
        <div className="k6-body">
          <div className="k6-funnel">
            {funnel.map((f) => (
              <div key={f.label} className="k6-funnel-row">
                <span className="fl">{f.label}</span>
                <span className="ft" style={{ width: `${Math.max(8, pct(f.n, funnelMax))}%` }}>{f.n}</span>
                <span className="fp">{pct(f.n, sum.totalDevices)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 最近审计(§5.2):看板速览近期关键动作,完整见审计日志页 */}
      {audit.length > 0 && (
        <div className="k6-panel">
          <div className="k6-sec-head"><div><div className="k6-kicker">最近审计</div><h3>近期关键动作</h3><p>最近的策略发布、手动状态下发、回滚与导出动作。完整记录见「审计日志」页。</p></div></div>
          <div className="k6-body">
            <div className="k6-recent-audit">
              {audit.slice(0, 5).map((a) => (
                <div key={a.auditId} className="k6-recent-row">
                  <span className={`k6-bdg ${a.targetType === "strategy" ? "cyan" : a.targetType === "config" ? "dim" : "good"}`}>{AUDIT_TARGET[a.targetType] ?? a.targetType}</span>
                  <span className="k6-recent-action">{a.action}</span>
                  <span className="k6-recent-meta">{a.actorId} · {timeAgo(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
