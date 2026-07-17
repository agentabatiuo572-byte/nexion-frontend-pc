"use client";

/**
 * J3 · 篡改防御监控 — 处置只读可观测面(server 是防御本体)。
 * 趋势(24h/7d/30d)+ 11 类路径堆积 + 高频篡改账户告警;处置不在本页 —— 表内动作仅跨域真 Link
 * 到 C2(/users/actions 冻结)与 K1(/risk/multi-account 簇建档)。
 * 本页唯一写动作 = 告警阈值配置(操作确认 · J.tamper.alertConfig);导出报表为后端生成的脱敏 CSV。
 */
import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Btn, CodeTag, Modal } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { JCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isEmergencyOutcomeUncertain } from "@/lib/admin/j-client";
import type { TamperReport } from "@/lib/admin/j-client";
import { downloadJ3ReportFile } from "@/lib/admin/j3-report-download";

const W = 720;
const H = 200;

function j3ErrorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重新读取页面状态后重试。";
}

/** J3 页头 CTA(挂 DomainHeader 右槽):导出报表(无 操作确认)+ 告警阈值配置(操作确认)。 */
export function J3HeaderActions({ ctx }: { ctx: JCtx }) {
  const { toast, actions, emergency } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canExport = authorities.includes("emergency_j3_export");
  const canConfigure = authorities.includes("emergency_j3_alert_config");
  const alert = emergency.tamper?.alertConfig;
  const window = emergency.tamper?.window ?? "24h";
  const hasData = emergency.tamper?.hasData ?? false;
  const [configOpen, setConfigOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingReport, setPendingReport] = useState<TamperReport | null>(null);
  const exportAttempt = useRef<{ window: "24h" | "7d" | "30d"; key: string } | null>(null);
  const retryableReport = pendingReport?.window === window ? pendingReport : null;
  const abandonPendingReport = () => {
    setPendingReport(null);
    toast("已放弃本次浏览器下载；服务器已生成的报表和审计仍会保留。下一次点击导出将生成新报表。");
  };
  const downloadReport = async () => {
    if ((!hasData && !retryableReport) || exporting) return;
    setExporting(true);
    if (retryableReport) {
      try {
        downloadJ3ReportFile(retryableReport);
        setPendingReport(null);
        toast(`已重新下载 ${retryableReport.window} 脱敏报表 · 未重复生成报表或审计`);
      } catch (error) {
        toast(`报表已生成并写审计，但浏览器下载仍失败；可继续重试本地下载，或放弃本次报表后重新生成 · ${j3ErrorText(error)}`);
      } finally {
        setExporting(false);
      }
      return;
    }
    if (!exportAttempt.current || exportAttempt.current.window !== window) {
      exportAttempt.current = { window, key: `j3-report-${crypto.randomUUID()}` };
    }
    let report: TamperReport;
    try {
      report = await actions.createJ3Report(
        window, `导出 J3 ${window} 脱敏监控报表`, exportAttempt.current.key,
      );
    } catch (error) {
      if (isEmergencyOutcomeUncertain(error)) {
        toast("导出结果暂未确认。请再次点击导出以复用同一请求编号，或刷新后到审计记录核对。");
      } else {
        exportAttempt.current = null;
        toast(`导出失败 · ${j3ErrorText(error)}`);
      }
      setExporting(false);
      return;
    }
    // API 成功就是服务端提交边界；从这里开始只允许重试本地下载，不能再次生成报表或审计。
    exportAttempt.current = null;
    setPendingReport(report);
    try {
      downloadJ3ReportFile(report);
      setPendingReport(null);
      toast(`已导出 ${report.window} 脱敏报表 · ${report.eventCount} 起拦截 · 已写审计`);
    } catch (error) {
      toast(`报表已生成并写审计，但浏览器下载失败；可重试本地下载，或放弃本次报表后重新生成 · ${j3ErrorText(error)}`);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      {canExport && (
        <>
          <button className="f-cta neutral" disabled={exporting || (!hasData && !retryableReport)} onClick={() => void downloadReport()} title={retryableReport ? "仅重试下载已生成的报表，不会再次请求服务器" : !hasData ? "当前筛选结果为空，不能导出" : `导出 ${window} 脱敏报表`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            {exporting ? (retryableReport ? "下载中…" : "生成中…") : retryableReport ? `重试下载 ${window} 报表` : `导出 ${window} 报表`}
          </button>
          {retryableReport && (
            <button className="f-cta neutral" disabled={exporting} onClick={abandonPendingReport} title="原报表与审计仍保留；放弃后可重新生成">
              放弃本次报表
            </button>
          )}
        </>
      )}
      {canConfigure && alert && (
        <button className="f-cta" onClick={() => setConfigOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /><circle cx="12" cy="12" r="4" /></svg>
          告警阈值配置
        </button>
      )}
      {configOpen && alert && <J3ConfigModal ctx={ctx} onClose={() => setConfigOpen(false)} />}
    </>
  );
}

function J3ConfigModal({ ctx, onClose }: { ctx: JCtx; onClose: () => void }) {
  const current = ctx.emergency.tamper!.alertConfig;
  const sevenDayAlertAccounts = current.sevenDayAlertAccounts;
  const [threshold, setThreshold] = useState(current.threshold);
  const [feedK4, setFeedK4] = useState(current.feedK4);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const commandAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const changed = threshold !== current.threshold || feedK4 !== current.feedK4;
  const reasonLength = reason.trim().length;
  const targetSevenDayAccounts = current.sevenDayPreviewByThreshold[String(threshold)];
  const previewAvailable = Number.isInteger(targetSevenDayAccounts) && targetSevenDayAccounts >= 0;
  const valid = changed && Number.isInteger(threshold) && threshold >= 1 && threshold <= 100
    && previewAvailable && reasonLength >= 8 && reasonLength <= 200;
  const direction = threshold < current.threshold ? "更敏感" : threshold > current.threshold ? "更稀疏" : "阈值不变";
  const submit = async () => {
    if (!valid || submitting) return;
    const fingerprint = JSON.stringify({ threshold, feedK4, reason: reason.trim() });
    if (!commandAttempt.current || commandAttempt.current.fingerprint !== fingerprint) {
      commandAttempt.current = { fingerprint, key: `j3-config-${crypto.randomUUID()}` };
    }
    setSubmitting(true);
    try {
      await ctx.actions.updateJ3AlertConfig(
        threshold, feedK4, current.threshold, current.feedK4, reason.trim(), commandAttempt.current.key,
      );
    } catch (error) {
      if (isEmergencyOutcomeUncertain(error)) {
        ctx.toast("配置结果暂未确认。请再次点击确认变更以复用同一请求编号，或取消后刷新核对当前值和审计记录。");
      } else {
        commandAttempt.current = null;
        ctx.toast(`配置失败 · ${j3ErrorText(error)}`);
      }
      setSubmitting(false);
      return;
    }
    commandAttempt.current = null;
    try {
      await ctx.actions.reloadJEmergency();
      ctx.toast("监控配置已生效 · 已记审计");
    } catch {
      ctx.toast("监控配置已生效并已记审计，但页面刷新失败；请使用页面重试或手动刷新核对服务器当前值。");
    } finally {
      setSubmitting(false);
      onClose();
    }
  };
  const inputStyle = { width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 10px", background: "var(--surface)", color: "var(--ink)" } as const;
  return (
    <Modal title="篡改告警配置确认" icon="shield" onClose={() => { if (!submitting) onClose(); }} footer={<>
      <Btn disabled={submitting} onClick={onClose}>取消</Btn>
      <Btn variant="primary" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? "提交中…" : "确认变更"}</Btn>
    </>}>
      <div className="tint tiny" style={{ marginBottom: 12 }}>
        当前阈值 <b>{current.threshold} 次 / 24h</b> · K4 {current.feedK4 ? "开启" : "关闭"} · 近 7 天告警账户 {sevenDayAlertAccounts} 个
      </div>
      <div className="grid g-2" style={{ gap: 12 }}>
        <label className="field"><span>告警频次阈值</span><input type="number" min={1} max={100} step={1} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} style={inputStyle} /></label>
        <label className="field"><span>喂 K4 风险评分</span><span className="row" style={{ gap: 8, minHeight: 38 }}><input type="checkbox" role="switch" checked={feedK4} onChange={(event) => setFeedK4(event.target.checked)} />{feedK4 ? "开启" : "关闭"}</span></label>
      </div>
      <div className="tint tiny" style={{ margin: "10px 0" }}>
        影响预览：阈值 {current.threshold} → <b>{threshold}</b>，告警将{direction}；按服务器近 7 天分布估算，告警账户 {sevenDayAlertAccounts} → <b>{previewAvailable ? `${targetSevenDayAccounts} 个` : "预览不可用"}</b>；K4 {current.feedK4 ? "开启" : "关闭"} → <b>{feedK4 ? "开启" : "关闭"}</b>。
        {!previewAvailable && <span style={{ color: "var(--danger)" }}> 服务器未返回该阈值的完整影响预览，当前禁止提交。</span>}
        {!feedK4 && <span style={{ color: "var(--danger)" }}> 关闭后，新产生的篡改事件不再写入 K4 分值与贡献；B5 仍会接收服务器权威篡改信号。</span>}
      </div>
      <label className="field"><span>变更理由（8–200 字）</span><textarea value={reason} maxLength={200} rows={4} onChange={(event) => setReason(event.target.value)} style={inputStyle} /><span className="muted tiny">{reasonLength}/200</span></label>
    </Modal>
  );
}

export function J3Tamper({ ctx }: { ctx: JCtx }) {
  const [accountLoading, setAccountLoading] = useState(false);
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canViewK1 = authorities.includes("risk_k1_read");
  const canFreezeC2 = authorities.includes("user_c2_read") && authorities.includes("user_c2_account_freeze");
  const gradId = useId(); // SVG gradient id 实例唯一(防多实例/StrictMode 下 DOM id 冲突,同 risk-radar 先例)
  const data = ctx.emergency.tamper;
  const win = data?.window ?? "24h";
  const TAMPER_TREND = data?.trend;
  const TAMPER_PATHS = data?.paths ?? [];
  const TAMPER_ACCTS = data?.accounts ?? [];
  const d = TAMPER_TREND?.[win] ?? { pts: [0, 0], points: [0, 0], max: 1, labels: [] };

  const { linePath, areaPath, peak, peakX, peakY } = useMemo(() => {
    const pts = d.pts;
    const stepX = W / Math.max(1, pts.length - 1);
    let line = "";
    let area = "";
    if (!pts.length) {
      return { linePath: `M0,${H} L${W},${H}`, areaPath: `M0,${H} L${W},${H} Z`, peak: 0, peakX: 0, peakY: H };
    }
    const pk = Math.max(...pts);
    let px = 0;
    let py = 0;
    pts.forEach((p, i) => {
      const x = i * stepX;
      const y = H - (p / Math.max(1, d.max)) * H;
      line += (i === 0 ? "M" : "L") + x + "," + y;
      area += i === 0 ? `M${x},${H} L${x},${y}` : `L${x},${y}`;
      if (p === pk) { px = x; py = y; }
    });
    area += ` L${(pts.length - 1) * stepX},${H} Z`;
    return { linePath: line, areaPath: area, peak: pk, peakX: px, peakY: py };
  }, [d]);

  if (ctx.contentLoading && !data) {
    return <section className="trend-card"><div className="trend-h"><span className="ttl">J3 数据加载中</span><span className="sub">· 正在读取篡改防御接口</span></div></section>;
  }
  if (!data || !TAMPER_TREND) {
    return <section className="trend-card"><div className="trend-h"><span className="ttl">J3 暂无篡改防御数据</span><span className="sub">· 后端接口未返回数据</span></div></section>;
  }

  const totalPath = TAMPER_PATHS.reduce((s, p) => s + p.ct, 0);
  const total7d = TAMPER_TREND["7d"].pts.reduce((s, p) => s + p, 0);
  const accountPager = data.accountPage ?? { page: 1, pageSize: 5, total: TAMPER_ACCTS.length, pages: 1, hasPrev: false, hasNext: false };
  const accountTotal = Number(data.stats.highFrequencyAccounts ?? accountPager.total ?? TAMPER_ACCTS.length);
  const statNumber = (...keys: string[]) => {
    for (const key of keys) {
      const raw = data.stats[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const deltaPrevPct = statNumber("deltaPrevPct");
  const alertThreshold = data.alertConfig.effectiveThreshold;
  const loadAccountPage = (nextPage: number) => {
    if (accountLoading) return;
    const targetPage = Math.max(1, Math.min(nextPage, Math.max(1, accountPager.pages)));
    if (targetPage === accountPager.page) return;
    setAccountLoading(true);
    ctx.actions.loadJ3TamperPage(win, targetPage, accountPager.pageSize)
      .catch((error) => ctx.toast(`J3 高频账户分页加载失败 · ${j3ErrorText(error)}`))
      .finally(() => setAccountLoading(false));
  };
  const loadWindow = (nextWindow: "24h" | "7d" | "30d") => {
    if (accountLoading || nextWindow === win) return;
    setAccountLoading(true);
    ctx.actions.loadJ3TamperPage(nextWindow, 1, accountPager.pageSize)
      .catch((error) => ctx.toast(`J3 时间窗加载失败 · ${j3ErrorText(error)}`))
      .finally(() => setAccountLoading(false));
  };
  const fedCount = TAMPER_ACCTS.filter((account) => account.fedToK4).length;
  const b5Count = TAMPER_ACCTS.filter((account) => account.b5Triggered).length;
  const topPath = TAMPER_PATHS[0]?.nm || "暂无";
  const coverageComplete = data.coverage.status === "complete";

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">{win} 拦截</div><div className="v">{totalPath}</div><div className="sub">{deltaPrevPct == null ? "前一窗口为 0，无法计算百分比" : `较前一窗口 ${deltaPrevPct >= 0 ? "+" : ""}${deltaPrevPct}%`}</div></div>
        <div className="f-stat warn"><div className="k">高频篡改账户</div><div className="v">{accountTotal}</div><div className="sub">≥{alertThreshold} 起 / {win} · 基准 {data.alertConfig.threshold} 起 / 24h</div></div>
        <div className="f-stat cyan"><div className="k">近 7 天拦截</div><div className="v">{total7d.toLocaleString("en-US")}</div><div className="sub">日均 {Math.round(total7d / 7)} 起</div></div>
        <div className="f-stat ok"><div className="k">最高频篡改路径</div><div className="v" style={{ fontSize: 18 }}>{topPath}</div><div className="sub">当前窗口按拦截数排序</div></div>
      </div>

      {/* 只读 banner */}
      <div className="ro-banner">
        <span className="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>
        <div><b>账户处置只读，告警配置单独授权</b> · <AutoGloss>本页不会冻结账户或建立风险簇；当前角色模型尚未区分风控负责人，配置暂仅超级管理员可执行。</AutoGloss><b>实际的冻结 / 建档</b><AutoGloss>要到</AutoGloss> <b>账户处置页(C2)</b> <AutoGloss>或</AutoGloss> <b>风控批量页(K1)</b> <AutoGloss>完成。</AutoGloss></div>
      </div>

      <div
        className="tint tiny"
        role="status"
        style={{ margin: "0 0 12px", borderColor: coverageComplete ? "var(--success)" : "var(--warning)" }}
      >
        {coverageComplete ? (
          <><b>服务器拒绝入口已全部接入：</b>{data.coverage.activeCount}/{data.coverage.registeredCount} 类已登记攻击面均有服务端拦截边界；零事件表示当前窗口没有拒绝记录，不代表防御失效。</>
        ) : (
          <><b>监控接入未完成：</b>当前仅 {data.coverage.activeCount}/{data.coverage.registeredCount} 类服务器拒绝入口已接入。
          因此“暂无事件”只代表已接入入口未发现拦截，不能代表其余攻击面安全；未接入路径不会被本页统计。</>
        )}
      </div>

      {/* K4 / B5 喂送 strip */}
      <div className="feed-strip">
        <div className="it"><span className={TAMPER_ACCTS.length === 0 ? "led dim" : fedCount ? "led" : "led warn"} /><AutoGloss>K4 风险信号</AutoGloss> · <span style={{ color: "var(--ink-3)" }}>{TAMPER_ACCTS.length === 0 ? "本页暂无高频账户" : `${fedCount}/${TAMPER_ACCTS.length} 个本页账户已确认写入`}</span></div>
        <span className="sep">·</span>
        <div className="it"><span className={TAMPER_ACCTS.length === 0 ? "led dim" : b5Count ? "led" : "led warn"} /><AutoGloss>B5 风险雷达</AutoGloss> · <span style={{ color: "var(--ink-3)" }}>{TAMPER_ACCTS.length === 0 ? "本页暂无高频账户" : `${b5Count}/${TAMPER_ACCTS.length} 个本页账户已确认触发`}</span></div>
        <span className="sep">·</span>
        <div className="it"><span className="led" /><b>脱敏报表</b> · <span style={{ color: "var(--ink-3)" }}>按当前 {win} 筛选导出</span></div>
        <span className="sep" style={{ marginLeft: "auto" }}>·</span>
        <div className="it"><span style={{ color: "var(--ink-4)", fontSize: 11.5 }}>数据来源 · </span><b>服务器拦截事件流</b></div>
      </div>

      {/* 趋势 */}
      <section className="trend-card">
        <div className="trend-h">
          <span className="ttl">篡改拦截趋势</span>
          <span className="sub">· <AutoGloss>都是被服务器成功拦下的尝试 · 越多说明防御越活跃</AutoGloss></span>
          <div className="r"><div className="seg">
            {(["24h", "7d", "30d"] as const).map((w) => (
              <button key={w} disabled={accountLoading} className={win === w ? "on" : ""} onClick={() => loadWindow(w)}>{w}</button>
            ))}
          </div></div>
        </div>
        {!data.hasData ? (
          <div className="tint tiny" style={{ margin: 16 }}>
            当前窗口暂无服务器拦截事件。J3 不生成示例数据；服务器拒绝入口接入 {data.coverage.activeCount}/{data.coverage.registeredCount}，
            {coverageComplete ? "已登记攻击面均已接入，本窗口零事件不代表防御失效。" : "未接入路径不会进入本页统计。"}
          </div>
        ) : <div className="trend-chart">
          <div className="trend-y">
            <span>{d.max}</span><span>{Math.round(d.max * 0.75)}</span><span>{Math.round(d.max * 0.5)}</span><span>{Math.round(d.max * 0.25)}</span><span>0</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.6" />
                <stop offset="100%" stopColor="var(--danger)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 50, 100, 150, 200].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} className="trend-grid-line" />)}
            <path className="trend-area" fill={`url(#${gradId})`} d={areaPath} />
            <path className="trend-line" d={linePath} />
          </svg>
          {/* 峰值标记 HTML overlay(防 preserveAspectRatio=none 变形) */}
          <div className="trend-overlay">
            <div className="trend-marker" style={{ left: `${(peakX / W) * 100}%`, top: `${(peakY / H) * 100}%` }}>
              <div className="mdot" />
              <div className="mlabel">↑ {peak}</div>
            </div>
          </div>
          <div className="trend-x">{d.labels.map((l) => <span key={l}>{l}</span>)}</div>
        </div>}
      </section>

      {/* 路径分布 */}
      <section className="path-card">
        <div className="path-h">
          <span className="ttl">篡改路径分布 · 按攻击面合并</span>
          <span className="sub">· 按作弊手法分类统计</span>
          <div className="r">{win} 总计 <b style={{ color: "var(--danger)" }}>{totalPath}</b> 起</div>
        </div>
        {TAMPER_PATHS.length === 0 ? <div className="tint tiny" style={{ margin: 16 }}>当前窗口暂无篡改路径分布。</div> : <><div className="path-stack">
          {TAMPER_PATHS.map((p) => {
            const segPct = (p.ct / totalPath) * 100;
            return (
              <div key={p.id} className="pseg" style={{ width: `${segPct}%`, background: p.color }} title={`${p.nm} · ${p.ct} 起`}>
                {segPct >= 6 ? p.nm : ""}
              </div>
            );
          })}
        </div>
        <div className="path-list">
          {TAMPER_PATHS.map((p) => (
            <div className="path-it" key={p.id}>
              <span className="psw" style={{ background: p.color }} />
              <div className="nm"><AutoGloss>{p.nm}</AutoGloss><div className="desc"><AutoGloss>{p.desc}</AutoGloss></div></div>
              <div className="cnt">{p.ct}</div>
              <div className="acct">{p.acct} 账户</div>
            </div>
          ))}
        </div></>}
      </section>

      {/* 高频篡改账户告警 */}
      <section className="accts-card">
        <div className="accts-h">
          <span className="ttl">高频篡改账户告警 · ≥ {alertThreshold} 起 / {win}</span>
          <span className="sub">· 第 {accountPager.page}/{accountPager.pages} 页 · 共 {accountPager.total} 个账户</span>
          <div className="r">
            <div className="accts-page">
              <button type="button" disabled={accountLoading || !accountPager.hasPrev} onClick={() => loadAccountPage(accountPager.page - 1)}>上一页</button>
              <button type="button" disabled={accountLoading || !accountPager.hasNext} onClick={() => loadAccountPage(accountPager.page + 1)}>下一页</button>
            </div>
            <CodeTag tone="electric">A2 审计</CodeTag><CodeTag>服务器拦截事件流</CodeTag>
          </div>
        </div>
        <div className="accts-tblwrap"><div className="accts-tbl">
          <div className="hd">
            <div className="c">用户编码</div><div className="c">{win} 起数</div><div className="c">K4 / B5</div><div className="c">命中路径</div>
            <div className="c">最近拦截</div><div className="c">簇 ID</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作(跨域)</div>
          </div>
          {TAMPER_ACCTS.map((a) => {
            const k4Cls = a.alertState === "escalated" ? "high" : "mid";
            return (
              <div className="rw" key={a.userCode}>
                <div className="c uid">{a.userCode}</div>
                <div className="c cnt">{a.cnt}</div>
                <div className="c"><span className={"badge-k4 " + k4Cls}>{a.fedToK4 ? `K4 ${a.k4}` : "K4 未喂送"} · {a.b5Triggered ? "B5 已触发" : "B5 未触发"}</span></div>
                <div className="c"><div className="paths">{a.paths.map((p) => <span key={p} className="p">{p}</span>)}</div></div>
                <div className="c last">{a.last}</div>
                <div className="c">{a.cluster ? <span className="badge-cluster" title="K1 批量簇">{a.cluster}</span> : <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>—</span>}</div>
                <div className="c acts">
                  {a.cluster && canViewK1 && (a.alertState === "flagged" || a.alertState === "escalated") ? (
                    <Link className="k1" href={{ pathname: "/risk/multi-account", query: { focusClusterId: a.cluster, source: "J3" } }} title={`${a.cluster} · 簇处置在 K1 完成 操作确认`}>→ K1 簇查看</Link>
                  ) : (
                    <a className="off" aria-disabled>→ K1 簇查看</a>
                  )}
                  {canFreezeC2 && (a.alertState === "flagged" || a.alertState === "escalated") ? <Link className="c2" href={{ pathname: "/users/actions", query: { userCode: a.userCode, source: "J3" } }} title={`${a.userCode} · 冻结/解冻在 C2 完成 操作确认`}>→ C2 冻结</Link> : <a className="off" aria-disabled>→ C2 冻结</a>}
                </div>
              </div>
            );
          })}
          {TAMPER_ACCTS.length === 0 && <div className="tint tiny" style={{ margin: 16 }}>当前窗口没有达到阈值的账户告警。</div>}
        </div></div>
      </section>

      <p className="f-foot"><b>所有计数来自服务器权威拦截事件</b>：<AutoGloss>本页只展示已经被业务端点拒绝并成功写入事件流的尝试；K4 / B5 状态只按服务端返回结果显示，不把“配置开启”当成“已经喂送”。本页</AutoGloss><b>不直接处置账户</b>，<AutoGloss>实际冻结 / 建档要到账户处置页或风控批量页去做。</AutoGloss></p>
    </div>
  );
}
