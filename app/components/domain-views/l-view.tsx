"use client";

/**
 * L 数据与分析 BI — 设计稿 BI 内容视图(从 page-breadth.jsx 移植)。
 * 标签:L1 KPI 看板(默认)/ L2 漏斗/cohort/留存 / L3 财务报表 / L4 设备/任务/网络报表 / L5 导出 & 监管报告。
 * 路由 l2.id 与设计稿 tab 一一对应(L1–L5)。
 */
import { useState } from "react";
import { Icon, Card, CardH, CodeTag, Chip, Badge, Btn, Meter, Sparkline, MakerCheckerModal, useToast } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KPIS, REVENUE, TREASURY, MATURITY, fmtM } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

const FOLD: Record<string, string> = { L1: "L1", L2: "L2", L3: "L3", L4: "L4", L5: "L5" };

type Kpi = (typeof KPIS)[number];

const REVENUE_ROWS: [string, number, string][] = [
  ["硬件 GMV", REVENUE.gmv, "var(--brand)"],
  ["团队分润佣金", REVENUE.commission, "var(--brand-2)"],
  ["代币经济", REVENUE.token, "var(--cyan)"],
  ["算力市场服务费", REVENUE.marketFee, "var(--success)"],
];
type CohortRow = [string, string, string, string, string, string];
const COHORT_ROWS: CohortRow[] = [
  ["W19", "22,104", "61%", "33%", "6.2%", "24%"],
  ["W20", "24,880", "59%", "34%", "6.6%", "26%"],
  ["W21", "26,420", "58%", "35%", "6.8%", "27%"],
  ["W22", "28,940", "57%", "34%", "6.9%", "25%"],
];
type OpsCard = [string, string, string];
const OPS_CARDS: OpsCard[] = [
  ["在线设备", "41,208", "heartbeat"],
  ["完成任务(24h)", "1.84M", "jobs"],
  ["网络吞吐", "+$215/s", "实时"],
  ["任务成功率", "99.2%", "SLA"],
  ["平均设备收益", "$3.42/d", "全网"],
  ["DC 区域", "3", "us/eu/ap"],
  ["队列饱和度", "63%", "队列水位"],
  ["Genesis 节点", "812", "在线分红"],
];
const DC_LOAD: [string, number, string][] = [
  ["us-east-2", 45, "var(--success)"],
  ["eu-west-1", 31, "var(--success)"],
  ["ap-southeast-1", 24, "var(--warning)"],
];
// [type(稳定 key · 真写 L.report.<type>.lastRun 用), 名称, 说明, 是否含 PII(决定 logAudit 留痕措辞)]
const EXPORT_ROWS: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ["bill_csv", "账单流水 CSV", "含 PII · 须脱敏策略", true],
  ["withdraw_compliance", "提现合规报表", "监管报送格式", true],
  ["kyc_ledger", "KYC 台账导出", "关联合规审查编号", true],
  ["commission_payout", "佣金支出报表", "6 类拆分", false],
];

// L5 监管报告动作:gen=生成 / download=下载 / rerun=重跑;均经 confirm → setParam(lastRun)+logAudit(PII 留痕)。
type ReportMc = { type: string; name: string; pii: boolean; mode: "gen" | "download" | "rerun"; action: string; detail: string };

// L-03 报送排程预设周期(真后台由报送日历配置端点下发;此处作可选项)。
const SCHEDULE_OPTS = ["每月 5 日", "每月 1 日", "每月 10 日", "每月 15 日", "每月最后一日", "每周一", "每季度首月 5 日"] as const;
const SCHEDULE_DEFAULT = "每月 5 日"; // store 无记录时回退(SSR/未水合一致)。
// L-03 控件:schedule=调整报送排程(select) / template=新建报表模板(text)。
type L3Mc =
  | { op: "schedule"; current: string }
  | { op: "template" };

function kpiPass(k: Kpi): boolean {
  if (k.dir === "gte") return k.value >= k.target;
  if (k.dir === "lte") return k.value <= k.target;
  const band = "band" in k ? k.band : undefined;
  return !!band && k.value >= band[0] && k.value <= band[1];
}

export function LDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "L1");
  // L5 监管报告真写落点:platform-config-store(setParam keyed 状态 + 审计)+ logAudit(含 PII 报告强制留痕),persist + 水合门。
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  const [mc, setMc] = useState<ReportMc | null>(null);
  // L-03 排程/模板:独立复核态(与 L-02 报告 mc 流程隔离,互不影响)。模板名称在复核弹窗 text 输入。
  const [l3Mc, setL3Mc] = useState<L3Mc | null>(null);

  const revenueTotal = REVENUE.gmv + REVENUE.commission + REVENUE.token + REVENUE.marketFee;

  // 派生:报告上次运行态(以 store 为准,缺省"未生成")。
  const reportRun = (type: string): string | undefined => pget(`L.report.${type}.lastRun`);
  const fmtRunTs = (): string => new Date().toLocaleString("zh-CN", { hour12: false });

  const onReportConfirm = (reason: string) => {
    if (!mc) return;
    const stamp = `${mc.mode === "rerun" ? "重跑" : "已生成"} · ${fmtRunTs()}`;
    setParam(`L.report.${mc.type}.lastRun`, stamp, { action: mc.action, reason });
    // 含 PII 报告 = 抗抵赖强留痕(谁、何时、生成/下载何报告);非 PII 报告统一留痕保持审计完整。
    logAudit({ actor: "总管理员", action: mc.action, target: `L.report.${mc.type}`, after: mc.pii ? `${stamp} · masking_policy 应用` : stamp, reason });
    setToast(`${mc.name} ${mc.mode === "download" ? "已下载" : mc.mode === "rerun" ? "已重跑" : "已生成"} · 写入 A2 审计${mc.pii ? "(含 PII · masking_policy)" : ""}`);
    setMc(null);
  };

  // L-03 派生:当前报送排程(以 store 为准,缺省默认)+ 已建报表模板清单(扫 L.report.template.* key)。
  const schedule = (): string => pget("L.report.schedule") ?? SCHEDULE_DEFAULT;
  const templates = (): string[] =>
    !hydrated || !params
      ? []
      : Object.keys(params)
          .filter((k) => k.startsWith("L.report.template.") && params[k] === "created")
          .map((k) => k.slice("L.report.template.".length));

  // L-03 复核确认:排程改周期 / 模板按名新建,均 setParam(内置审计 before→after)+ logAudit 双留痕。
  const onL3Confirm = (reason: string, newValue?: string) => {
    if (!l3Mc) return;
    if (l3Mc.op === "schedule") {
      const v = (newValue ?? "").trim();
      if (v) {
        setParam("L.report.schedule", v, { action: "调整监管报送排程", reason }); // 动作含「调整」→ 弹窗自动出输入框
        logAudit({ actor: "总管理员", action: "调整监管报送排程", target: "L.report.schedule", before: l3Mc.current, after: v, reason });
        setToast("报送排程已调整:" + l3Mc.current + " → " + v + " · 写入 A2 审计");
      }
    } else {
      const name = (newValue ?? "").trim();
      if (name) {
        setParam(`L.report.template.${name}`, "created", { action: "新建报表模板 " + name, reason });
        logAudit({ actor: "总管理员", action: "新建报表模板 " + name, target: `L.report.template.${name}`, after: "created", reason });
        setToast("报表模板已新建:" + name + " · 写入 A2 审计");
      }
    }
    setL3Mc(null);
  };

  return (
    <div className="dkpage">
      <DomainHeader {...meta} right={<Btn variant="primary" onClick={() => setMc({ type: "withdraw_compliance", name: "提现合规报表", pii: true, mode: "gen", action: "生成监管报告 提现合规报表", detail: "withdraw_compliance · 含 PII,按 masking_policy 脱敏 · 生成后写入 L.report.withdraw_compliance.lastRun + A2 审计" })}><Icon name="download" size={15} /> 导出报表</Btn>} />

      {tab === "L1" && <div className="grid g-4">
        {KPIS.map((k) => {
          const pass = kpiPass(k);
          const col = pass ? "var(--success)" : "var(--warning)";
          return <Card key={k.n} style={{ padding: "15px 16px" }}>
            <div className="row"><CodeTag tone="electric">#{k.n}</CodeTag><div className="spacer" /><Badge tone={pass ? "ok" : "warn"}>{pass ? "达标" : "未达标"}</Badge></div>
            <div className="muted tiny" style={{ minHeight: 30, marginTop: 8 }}>{k.name}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: col }} className="tnum">{k.value}{k.unit}</div>
            <Sparkline data={[...k.spark]} color={col} fill h={30} />
          </Card>;
        })}
      </div>}

      {tab === "L3" && <div className="grid g-2">
        <Card><CardH title="收入结构(月)" sub="四支柱" />
          {REVENUE_ROWS.map(([n, a, c]) => (
            <div key={n} style={{ marginBottom: 13 }}><div className="row tiny" style={{ marginBottom: 4 }}><span><AutoGloss>{n}</AutoGloss></span><div className="spacer" /><span className="mono">{fmtM(a)}</span></div><Meter pct={(a / revenueTotal) * 100} color={c} /></div>
          ))}
        </Card>
        <Card><CardH title="兑付 / 敞口 / 负债到期" />
          <div className="kv"><span className="k"><AutoGloss>兑付覆盖率</AutoGloss></span><span className="v"><b className="tnum" style={{ color: "var(--success)" }}>{TREASURY.coverageRatio}%</b></span></div>
          <div className="kv"><span className="k"><AutoGloss>净敞口</AutoGloss></span><span className="v"><span className="mono">+{fmtM(TREASURY.netExposure)}</span></span></div>
          <div className="kv"><span className="k">7d 到期兑付</span><span className="v"><span className="mono">{fmtM(MATURITY.reduce((s, m) => s + m.withdraw + m.interest + m.genesis, 0))}</span></span></div>
          <div className="kv"><span className="k">24h 净流入</span><span className="v"><span className="mono">+{fmtM(Math.abs(LEDGER.netFlow24hUsd))}</span></span></div>
          <Sparkline data={[...TREASURY.exposureSeries]} color="var(--success)" fill h={60} />
        </Card>
      </div>}

      {tab === "L2" && <div className="grid g-3">
        <Card className="span-2"><CardH title="漏斗 / cohort / 留存" sub="多维转化分析" right={<CodeTag>漏斗分析</CodeTag>} />
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}><span className="muted tiny">切片:</span><Chip sel><AutoGloss>cohort 2026-W22</AutoGloss></Chip><Chip tab>P3</Chip><Chip tab>ref NX-*</Chip></div>
          <table className="tbl"><thead><tr><th>cohort 周</th><th className="num">注册</th><th className="num">Day7 留存</th><th className="num">L2→L3</th><th className="num">L3→L4</th><th className="num">复投</th></tr></thead>
            <tbody>{COHORT_ROWS.map((r) => (
              <tr key={r[0]}><td className="mono t-strong">{r[0]}</td><td className="num tnum">{r[1]}</td><td className="num tnum" style={{ color: parseFloat(r[2]) < 60 ? "var(--warning)" : "var(--success)" }}>{r[2]}</td><td className="num tnum">{r[3]}</td><td className="num tnum">{r[4]}</td><td className="num tnum">{r[5]}</td></tr>
            ))}</tbody></table>
          <div className="tint cyan tiny" style={{ marginTop: 10 }}><AutoGloss>数据派生自 A4 五级漏斗事件 · cohort × phase × ref 任意下钻 · Phase 切换归因跳 B4/H1</AutoGloss></div>
        </Card>
        <Card><CardH title="Day7 留存趋势" sub="KPI #2" />
          <div style={{ fontSize: 30, fontWeight: 600, color: "var(--warning)" }} className="tnum">58.2%</div><div className="muted tiny" style={{ marginBottom: 10 }}>目标 &gt;60% · 连续下滑</div>
          <Sparkline data={[61, 60, 59, 58, 57, 59, 58.2]} color="var(--warning)" fill h={70} />
          <hr className="section-divider" />
          <div className="kv"><span className="k"><AutoGloss>最弱 cohort</AutoGloss></span><span className="v">W22 · 57%</span></div>
          <div className="kv"><span className="k"><AutoGloss>归因</AutoGloss></span><span className="v">P3 拉新放量、质量下降</span></div>
        </Card>
      </div>}

      {tab === "L4" && <div className="grid g-4">
        {OPS_CARDS.map(([k, v, s]) => (
          <Card key={k} style={{ padding: "15px 16px" }}><div className="muted tiny"><AutoGloss>{k}</AutoGloss></div><div style={{ fontSize: 21, fontWeight: 600, color: "var(--ink)" }} className="tnum">{v}</div><div className="muted tiny"><AutoGloss>{s}</AutoGloss></div></Card>
        ))}
        <Card className="span-2"><CardH title="任务吞吐 7d" sub="L4 运营报表" /><Sparkline data={[1.6, 1.7, 1.72, 1.8, 1.78, 1.82, 1.84].map((v) => v * 100)} color="var(--brand)" fill h={70} /></Card>
        <Card className="span-2"><CardH title="DC 负载分布" />
          {DC_LOAD.map(([n, p, c]) => (
            <div key={n} style={{ marginBottom: 12 }}><div className="row tiny" style={{ marginBottom: 4 }}><span>{n}</span><div className="spacer" /><span className="mono">{p}%</span></div><Meter pct={p} color={c} /></div>
          ))}
        </Card>
      </div>}

      {tab === "L5" && <><Card style={{ marginBottom: 16 }}><CardH title="导出 & 监管报告" sub="账单 CSV / 合规报表" right={<CodeTag>导出报告</CodeTag>} />
        {EXPORT_ROWS.map(([type, n, d, pii]) => { const run = reportRun(type); return (
          <div key={type} className="tint" style={{ marginBottom: 8 }}>
            <div className="row">
              <div><b style={{ fontSize: 13 }}><AutoGloss>{n}</AutoGloss></b>{pii && <CodeTag tone="orange" title="含个人身份信息 · 导出/下载强制 A2 留痕">PII</CodeTag>}<div className="muted tiny"><AutoGloss>{d}</AutoGloss></div></div>
              <div className="spacer" />
              <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm variant="primary" onClick={() => setMc({ type, name: n, pii, mode: "gen", action: `生成监管报告 ${n}`, detail: `${type}${pii ? " · 含 PII,按 masking_policy 脱敏" : ""} · 生成后写入 L.report.${type}.lastRun + A2 审计` })}><Icon name="doc" size={14} />生成</Btn>
                <Btn sm disabled={!run} onClick={() => setMc({ type, name: n, pii, mode: "download", action: `下载监管报告 ${n}`, detail: `${type}${pii ? " · 含 PII,下载强制 A2 留痕(谁/何时/masking_policy)" : ""} · 须先生成` })}><Icon name="download" size={14} />下载</Btn>
                <Btn sm disabled={!run} onClick={() => setMc({ type, name: n, pii, mode: "rerun", action: `重跑监管报告 ${n}`, detail: `${type} · 以最新口径重新生成,覆盖上次结果 · 写入 A2 审计` })}>重跑</Btn>
              </div>
            </div>
            <div className="muted tiny" style={{ marginTop: 6 }}>{run ? `上次运行:${run}` : "未生成 · 点「生成」产出报告"}</div>
          </div>
        ); })}
        <div className="tint warn tiny" style={{ marginTop: 6 }}><AutoGloss>含 PII 报告生成/下载经 Maker-Checker · admin.report_exported 留痕(masking_policy)</AutoGloss></div>
      </Card>
      <Card><CardH title="报送排程 & 报表模板" sub="监管报送周期 / 自定义模板" right={<CodeTag title="报送排程与报表模板">报送排程</CodeTag>} />
        <div className="kv"><span className="k">监管报送排程</span><span className="v"><span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{schedule()}</span><Btn sm onClick={() => setL3Mc({ op: "schedule", current: schedule() })}>调整排程</Btn></span></span></div>
        <div className="kv"><span className="k">下次报送窗口</span><span className="v"><span className="muted tiny">按当前排程「{schedule()}」自动触发生成</span></span></div>
        <hr className="section-divider" />
        <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
          <div><b style={{ fontSize: 13.5 }}>报表模板</b><div className="muted tiny">自定义报送口径模板,供 L5 报告复用</div></div>
          <div className="spacer" />
          <Btn sm variant="primary" onClick={() => setL3Mc({ op: "template" })}><Icon name="plus" size={13} /> 新建模板</Btn>
        </div>
        {templates().length > 0 ? (
          <div className="row wrap" style={{ gap: 6 }}>{templates().map((t) => <CodeTag key={t} tone="electric" title="已建报表模板">{t}</CodeTag>)}</div>
        ) : (
          <div className="muted tiny">暂无自定义模板 · 点「新建模板」创建报送口径</div>
        )}
        <div className="tint warn tiny" style={{ marginTop: 12 }}><AutoGloss>排程调整 / 新建模板影响监管报送口径 · 须 Maker-Checker 双人复核 + admin 审计留痕</AutoGloss></div>
      </Card>
      </>}

      {mc && <MakerCheckerModal action={mc.action} detail={mc.detail} amplifies={false} onClose={() => setMc(null)} onConfirm={onReportConfirm} />}
      {l3Mc && <MakerCheckerModal
        action={l3Mc.op === "schedule" ? "调整监管报送排程" : "新建报表模板"}
        detail={l3Mc.op === "schedule"
          ? `从「${l3Mc.current}」切换报送周期 · 改后按新周期自动触发生成 · 写入 L.report.schedule + A2 审计`
          : "输入模板名称创建自定义报送口径,供 L5 监管报告复用 · 写入 L.report.template.<名称> + A2 审计"}
        edit={l3Mc.op === "schedule" ? { kind: "select", current: l3Mc.current, options: [...SCHEDULE_OPTS] } : { kind: "text" }}
        amplifies={false}
        onClose={() => setL3Mc(null)}
        onConfirm={onL3Confirm} />}
      {toastNode}
    </div>
  );
}
