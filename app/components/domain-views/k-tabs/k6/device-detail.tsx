"use client";

// K6 client-only；打开详情后独立读取服务端设备详情。

/**
 * K6 设备详情 modal(SPEC 1 · PRD §13)。
 * 基础 / 会话 / 成熟度 / 环境 / 判定轨迹(逐规则)/ 操作区。
 * 操作区:SPEC 1 仅读(复制 + 建议);处置动作(下发/挂起/过滤/禁止/重置)在 SPEC 2 手动修改闭环接入。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { fetchK6Device } from "@/lib/admin/k6-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isFresh, timeAgo } from "@/lib/admin/janus-c2/scoring";
import {
  ACTION_TYPE_LABEL,
  COMMAND_STATE_LABEL,
  ROLE_LABEL,
  STATUS_EXPLAIN,
  STATUS_LABEL,
  STATUS_SOURCE_LABEL,
  STATUS_TONE,
  SUGGESTED_ACTION,
  channelLabel,
  platformLabel,
  remoteTargetBindingLabel,
} from "@/lib/admin/janus-c2/labels";
import { allowedTransitions, gatedTransitions, type Transition } from "@/lib/admin/janus-c2/transitions";
import type { Device } from "@/lib/admin/janus-c2/types";
import { ManualOverrideModal } from "./manual-override-modal";
import { useK6Operator } from "./use-operator";

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="k6-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

const yn = (b: boolean): string => (b ? "是" : "否");

export function K6DeviceDetail({ device, onClose }: { device: Device; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const operator = useK6Operator();
  const [pending, setPending] = useState<Transition | null>(null);
  const [detail, setDetail] = useState<Device | null>(null);
  const [detailStatus, setDetailStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detailError, setDetailError] = useState<string | null>(null);
  const loadDetail = async () => {
    setDetailStatus("loading");
    setDetailError(null);
    setDetail(null);
    try {
      setDetail(await fetchK6Device(device.sid));
      setDetailStatus("ready");
    } catch (error) {
      setDetailStatus("error");
      setDetailError(error instanceof Error ? displayAdminError(error) : "详情读取失败");
    }
  };
  useEffect(() => { void loadDetail(); }, [device.sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { if (pending) setPending(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);
  const d = detail;
  const trace = d?.latestDecision;
  if (!d) {
    return <div className="k6-modal-overlay" onClick={onClose}><div className="k6c2 k6-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`设备详情 ${device.sid}`}>
      <div className="k6-modal-head"><code className="sid">{device.sid}</code><button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
      <div className={`k6-empty${detailStatus === "error" ? " k6-error" : ""}`}>{detailStatus === "loading" ? "正在读取服务端设备详情…" : <>详情加载失败，未展示队列摘要代替详情。{detailError} <button className="k6-pgbtn" onClick={() => void loadDetail()}>重试</button></>}</div>
    </div></div>;
  }
  const allowed = allowedTransitions(d.status, operator.role);
  const gated = gatedTransitions(d.status, operator.role);
  const m = d.maturity;
  const e = d.environment;

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(d.sid).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
    <div className="k6-modal-overlay" onClick={onClose}>
      <div className="k6c2 k6-modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label={`设备详情 ${d.sid}`}>
        <div className="k6-modal-head">
          <div className="ttl">
            <code className="sid">{d.sid}</code>
            <span className={`k6-bdg ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
            <span className="k6-srctag">来源 · {STATUS_SOURCE_LABEL[d.statusSource]}</span>
            {d.commandState && <span className="k6-bdg warning">{COMMAND_STATE_LABEL[d.commandState] ?? "设备命令处理中"}</span>}
          </div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>

        <div className="k6-modal-body">
          <div className="k6-explain" style={{ marginBottom: 18 }}>{STATUS_EXPLAIN[d.status]}</div>

          <div className="k6-dsec">
            <h4>基础信息</h4>
            <KV rows={[
              ["设备 ID", <span className="mono" key="d">{d.deviceId ?? "—"}</span>],
              ["首次上报", timeAgo(d.firstSeenAt)],
              ["最近上报", timeAgo(d.lastSeenAt)],
              ["安装天数", `${d.installDays} 天`],
              ["邀请码", d.inviteCode ?? "—"],
              ["渠道", channelLabel(d.channel)],
              ["批准目标", remoteTargetBindingLabel(
                d.remoteUrlKey,
                d.remoteTargetVersion,
                d.remoteTargetCatalogVersion,
              )],
              ["最近操作人", d.lastOperatorId ? `${d.lastOperatorId} · ${d.lastOperationReason ?? ""}` : "—"],
            ]} />
          </div>

          <div className="k6-dsec">
            <h4>会话信息</h4>
            <KV rows={[
              ["会话 ID", <span className="ua" key="s">{d.latestSession?.sessionId ?? "—"}</span>],
              ["会话开始", d.latestSession ? timeAgo(d.latestSession.startedAt) : "—"],
              ["会话更新", d.latestSession ? timeAgo(d.latestSession.lastSeenAt) : "—"],
              ["白壳阶段", d.latestSession?.appPhase === "finance" ? "真盘" : "审核态(白壳)"],
              ["模拟业务日", d.latestSession?.simDay != null ? `第 ${d.latestSession.simDay} 天` : "—"],
              ["前后台", isFresh(d.lastSeenAt) ? "前台活跃" : "后台 / 已离开"],
              ["设备型号", `${platformLabel(d.platform)} · ${d.model}`],
              ["系统", d.osName],
              ["浏览器", d.browser],
              ["环境风险摘要", `${e.environmentRiskScore} 分${e.riskReasons.length ? ` · ${e.riskReasons.join(" / ")}` : ""}`],
              ["UA", <span className="ua" key="ua">{d.ua ?? "—"}</span>],
            ]} />
          </div>

          <div className="k6-dsec">
            <h4>成熟度信息</h4>
            <KV rows={[
              ["成熟度分", `${d.maturityScore} / 100`],
              ["建议分", `${d.recommendationScore} / 100`],
              ["打开次数", `${m.appOpenCount} 次`],
              ["会话次数", `${m.sessionCount} 次`],
              ["连续活跃", `${m.repeatStreakDays} 天`],
              ["前台停留", `${Math.round(m.foregroundDurationSeconds / 60)} 分钟`],
              ["关键页面", [m.benchmarkViewed && "跑分", m.marketViewed && "市场", m.walletViewed && "资产"].filter(Boolean).join(" / ") || "未访问"],
              ["关键动作", m.optimizeDone ? "执行过优化" : "未执行"],
            ]} />
          </div>

          <div className="k6-dsec">
            <h4>环境信息</h4>
            <KV rows={[
              ["环境风险分", `${e.environmentRiskScore} / 100`],
              ["疑似无头浏览器", yn(e.isHeadless)],
              ["自动化信号", `${e.automationSignalCount} 个`],
              ["指纹黑名单", yn(e.fpBlocklistHit)],
              ["屏幕异常", yn(e.screenAnomaly)],
              ["时区 / 语言异常", `${yn(e.timezoneMismatch)} / ${yn(e.languageMismatch)}`],
            ]} />
            {e.riskReasons.length > 0 && (
              <div className="k6-chips" style={{ marginTop: 10 }}>
                {e.riskReasons.map((r) => <span key={r} className="k6-bdg warning">{r}</span>)}
              </div>
            )}
          </div>

          <div className="k6-dsec">
            <h4>判定轨迹</h4>
            {trace ? (
              <>
                <div className="k6-chips" style={{ marginBottom: 10 }}>
                  <span className="k6-bdg dim">策略 · {trace.strategyName ?? trace.strategyId ?? "无生效策略"}{trace.strategyVersion ? ` v${trace.strategyVersion}` : ""}</span>
                  <span className="k6-bdg good">动作 · {ACTION_TYPE_LABEL[trace.action]}</span>
                  <span className="k6-bdg dim">判定 · {timeAgo(trace.decidedAt)}</span>
                  {trace.conflicts?.map((c) => <span key={c} className="k6-bdg warning">冲突 · {c}</span>)}
                </div>
                <table className="k6-trace">
                  <thead><tr><th>规则</th><th style={{ width: 70 }}>结果</th><th style={{ width: 120 }}>说明</th></tr></thead>
                  <tbody>
                    {trace.ruleResults.map((r, i) => (
                      <tr key={i}>
                        <td>{r.label}</td>
                        <td><span className={r.passed ? "pass" : "fail"}>{r.passed ? "通过" : "未通过"}</span></td>
                        <td className="dt">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="k6-explain">服务端尚无判定轨迹，当前不做浏览器侧补算。</div>
            )}
          </div>

          <div className="k6-dsec" style={{ marginBottom: 0 }}>
            <h4>操作区</h4>
            <div className="k6-chips" style={{ marginBottom: 12 }}>
              <span className="k6-bdg good">建议 · {SUGGESTED_ACTION[d.status]}</span>
              <span className="k6-srctag">当前身份 · {ROLE_LABEL[operator.role]}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {allowed.map((t) => (
                <button key={t.to} className="k6-pgbtn" onClick={() => setPending(t)} title={t.note}
                  style={t.highRisk ? { color: "var(--danger)", borderColor: "var(--danger)" } : undefined}>
                  改为 {STATUS_LABEL[t.to]}{t.highRisk ? " · 强确认" : ""}
                </button>
              ))}
              {allowed.length === 0 && <span className="k6-explain" style={{ flex: 1 }}>当前状态在你的权限下无可执行的状态修改。</span>}
            </div>
            {gated.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {gated.map((t) => (
                  <button key={t.to} className="k6-pgbtn" disabled title={`需 ${ROLE_LABEL[t.role]} 权限`}>
                    {STATUS_LABEL[t.to]} · 需{ROLE_LABEL[t.role]}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="k6-pgbtn" onClick={copy}>{copied ? "已复制" : "复制会话 ID"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    {pending && <ManualOverrideModal device={d} transition={pending} operatorId={operator.id} onApplied={setDetail} onClose={() => setPending(null)} />}
    </>
  );
}
