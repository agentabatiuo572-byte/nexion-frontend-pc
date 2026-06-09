"use client";

/**
 * D 资金与财务 — 设计稿 Finance 内容视图(从 page-finance.jsx 移植)。
 * 标签:D2 提现审核队列 / D1 充值对账 / D3 资金池水位 / D4 账本/账单审计 / D5 提现参数。
 * 路由 l2.id 折叠:D1→D1、D2→D2、D3→D3、D4→D4、D5→D5(5 个 tab 在源中一一对应)。
 */
import { useState, type ReactNode } from "react";
import { Icon, Card, CardH, CodeTag, Chip, Badge, Btn, Toggle, Meter, Drawer, KV, MakerCheckerModal, useToast } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { WITHDRAWALS, TOPUPS, LIABILITIES, TREASURY, fmtUsd, fmtM } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

const FOLD: Record<string, string> = { D1: "D1", D2: "D2", D3: "D3", D4: "D4", D5: "D5" };

type Withdrawal = (typeof WITHDRAWALS)[number];

const statusMap: Record<string, { tone: string; label: string }> = {
  auto: { tone: "ok", label: "自动放行" },
  review: { tone: "info", label: "转人工" },
  delay: { tone: "warn", label: "delay 24h" },
  frozen: { tone: "err", label: "冻结" },
  processing: { tone: "cyan", label: "处理中" },
};

const riskBadge = (s: number) => (s >= 70 ? "err" : s >= 40 ? "warn" : "ok");

const LIAB_SOURCES = ["earnings.credited", "staking.opened", "staking.opened", "genesis.purchased", "staking.opened", "withdraw.submitted", "commission.paid", "staking.*"];

type Param = { key: string; name: string; val: string; phase: boolean };
const WITHDRAW_PARAMS: Param[] = [
  { key: "withdrawDailyCapUSD", name: "提现日限", val: "$2,000", phase: true },
  { key: "withdrawMaxPct", name: "单次上限(余额 %)", val: "80%", phase: false },
  { key: "withdrawFeePct", name: "提现手续费", val: "2.0%", phase: false },
  { key: "withdrawCooldownDays", name: "提现冷却(天)", val: "30d", phase: true },
  { key: "withdrawPointsRatio", name: "提现积分门槛 /$100", val: "10", phase: true },
];

type Bill = { id: string; user: string; type: string; dir: string; amt: number; cur: string; bal: number; ts: string; mc?: string };
const BILLS: Bill[] = [
  { id: "BL-90233", user: "usr_19C7", type: "earning", dir: "+", amt: 142.4, cur: "USDT", bal: 24242.4, ts: "14:32:08" },
  { id: "BL-90232", user: "usr_84F2", type: "withdraw", dir: "-", amt: 4200.0, cur: "USDT", bal: 4220.0, ts: "14:30:55" },
  { id: "BL-90231", user: "usr_31E8", type: "commission", dir: "+", amt: 880.0, cur: "USDT", bal: 52080.0, ts: "14:29:11" },
  { id: "BL-90230", user: "usr_84F2", type: "adjust", dir: "+", amt: 1200.0, cur: "NEX", bal: 8420.0, ts: "13:40:22", mc: "C3→D4 冲正" },
  { id: "BL-90229", user: "usr_02A9", type: "swap", dir: "-", amt: 500.0, cur: "NEX", bal: 5130.0, ts: "13:22:40" },
  { id: "BL-90228", user: "usr_22A1", type: "topup", dir: "+", amt: 500.0, cur: "USDT", bal: 500.0, ts: "13:05:18" },
];
const billTone: Record<string, string> = { topup: "info", withdraw: "warn", earning: "cyan", commission: "electric", swap: "neutral", adjust: "orange" };
const billTotals: Record<string, string> = { earning: "12,840", commission: "3,210", topup: "8,902", withdraw: "2,104", swap: "5,618", adjust: "47" };

function Stat4({ items }: { items: [string, ReactNode, ReactNode, string?][] }) {
  return (
    <div className="grid g-4" style={{ marginBottom: 16 }}>
      {items.map(([k, v, sub, col]) => (
        <Card key={k} style={{ padding: "15px 16px" }}>
          <div className="muted tiny">{k}</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: col || "var(--ink)" }} className="tnum">{v}</div>
          {sub && <div className="muted tiny">{sub}</div>}
        </Card>
      ))}
    </div>
  );
}

export function DDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "D2");
  // 真写落点:运营处置/参数统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  // D2 提现审核队列
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState<Withdrawal | null>(null);
  const [wdMc, setWdMc] = useState<{ id: string; mode: "approve" | "freeze" } | null>(null);
  const rows = WITHDRAWALS as unknown as Withdrawal[];
  const effStatus = (w: Withdrawal): string => pget(`D.withdraw.${w.id}.status`) ?? w.status;
  const filtered = rows.filter((w) => filter === "all" || effStatus(w) === filter);
  const pending = rows.filter((w) => ["review", "delay", "frozen"].includes(effStatus(w))).length;
  const dispose = (reason: string) => {
    if (!wdMc) return;
    const next = wdMc.mode === "approve" ? "processing" : "frozen";
    setParam(`D.withdraw.${wdMc.id}.status`, next, { action: (wdMc.mode === "approve" ? "提现放行 " : "冻结提现 ") + wdMc.id, reason });
    setToast("提现 " + wdMc.id + (wdMc.mode === "approve" ? " 已复核放行 → 处理中" : " 已冻结"));
    setWdMc(null); setSel(null);
  };

  // D5 提现参数 — 当前值优先取 setParam 真写态(D.<key>),回落静态种子
  const [paramMc, setParamMc] = useState<Param | null>(null);
  const effParam = (p: Param): string => pget(`D.${p.key}`) ?? p.val;

  // D1 支付渠道 / PSP 配置(对应 H5 /me/wallet/cards · /me/wallet/topup 入金通道)
  // 启停态 / BIN 规则取 setParam 真写态(D.psp.<name>.on / .rule),回落静态种子。
  const PSPS = [
    { name: "MoonPay", method: "card", on: true, binRule: "标准", route: "主通道" },
    { name: "Banxa", method: "card", on: true, binRule: "标准", route: "备通道" },
    { name: "OnChain USDT", method: "usdt", on: true, binRule: "—", route: "链上直连" },
  ];
  type Psp = (typeof PSPS)[number];
  const pspOn = (p: Psp): boolean => { const v = pget(`D.psp.${p.name}.on`); return v === undefined ? p.on : v === "true"; };
  const pspRule = (p: Psp): string => pget(`D.psp.${p.name}.rule`) ?? p.binRule;
  const [pspMc, setPspMc] = useState<{ name: string; kind: "toggle" | "rule"; nextOn?: boolean; cur?: string; action: string; detail: string } | null>(null);
  const [reconMc, setReconMc] = useState<{ id: string } | null>(null);
  const [billMc, setBillMc] = useState<{ id: string } | null>(null);

  const total = LIABILITIES.reduce((s, l) => s + l.amount, 0);
  // 储备健康度(m7 扩张:净流入累积)——派生自 LEDGER 单源,与 D3 覆盖率/B1 口径一致
  const dailyInflow = Math.abs(LEDGER.netFlow24hUsd);

  return (
    <div className="dkpage">
      <DomainHeader {...meta} right={<Btn onClick={() => { logAudit({ actor: "总管理员", action: "导出账本/对账 CSV", target: "D4-ledger" }); setToast("已生成导出 · 写入 A2 审计"); }}><Icon name="download" size={15} /> 账本导出 CSV</Btn>} />

      {tab === "D2" && <>
        <Stat4 items={[
          ["在途提现 queue", fmtM(LEDGER.queueBacklogUsd), "科目 #6"],
          ["待人工处置", pending, "review/delay/frozen", "var(--warning)"],
          ["SLA 红线", <>48<small style={{ fontSize: 14 }}>h</small></>, ""],
          ["自动放行率", "71%", "K3 规则引擎", "var(--success)"],
        ]} />
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}>
            <span className="ttl">提现审核队列</span><CodeTag>提现申请</CodeTag>
            <div className="spacer" />
            {["all", "review", "delay", "frozen", "auto", "processing"].map((f) => (
              <Chip key={f} tab sel={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "全部" : statusMap[f].label}</Chip>
            ))}
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>提现 ID</th><th>用户</th><th className="num">金额</th><th>风险分(K4)</th><th>KYC(C4)</th><th>路由</th><th>冷却</th><th>状态</th><th>时长</th><th /></tr></thead>
            <tbody>{filtered.map((w) => (
              <tr key={w.id} style={{ cursor: "pointer" }} onClick={() => setSel(w)}>
                <td className="mono t-strong">{w.id}</td>
                <td className="mono t-mut">{w.user}</td>
                <td className="num t-strong tnum">{fmtUsd(w.amount)}</td>
                <td><span className="row" style={{ gap: 7 }}><Badge tone={riskBadge(w.risk)}>{w.risk}</Badge></span></td>
                <td><Badge tone={w.kyc === "verified" ? "ok" : "warn"}>{w.kyc}</Badge></td>
                <td className="t-mut tiny">{w.route}</td>
                <td className="tiny">{w.cooldown}</td>
                <td><Badge tone={statusMap[effStatus(w)].tone}>{statusMap[effStatus(w)].label}</Badge></td>
                <td className="t-mut tiny mono">{w.age}</td>
                <td><Icon name="chevron" size={15} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        {sel && <Drawer title={sel.id} sub={`${sel.user} · ${sel.chain}`} onClose={() => setSel(null)}
          footer={["review", "delay", "frozen"].includes(effStatus(sel)) ? <>
            <Btn variant="danger" onClick={() => setWdMc({ id: sel.id, mode: "freeze" })}><Icon name="lock" size={15} /><AutoGloss>冻结(Maker-Checker)</AutoGloss></Btn>
            <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setWdMc({ id: sel.id, mode: "approve" })}><Icon name="check" size={15} /><AutoGloss>放行(Maker-Checker)</AutoGloss></Btn>
          </> : <Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setSel(null)}>关闭</Btn>}>
          <div className="tint" style={{ marginBottom: 16, textAlign: "center" }}>
            <div className="muted tiny">提现金额</div>
            <div style={{ fontSize: 34, fontWeight: 600 }} className="tnum">{fmtUsd(sel.amount)}</div>
            <div className="row" style={{ justifyContent: "center", marginTop: 6 }}><Badge tone={statusMap[effStatus(sel)].tone}>{statusMap[effStatus(sel)].label}</Badge></div>
          </div>
          <KV k="目标地址" v={<span className="mono">{sel.addr}</span>} />
          <KV k="链 / 协议" v={sel.chain} />
          <KV k="风险分(K4 权威)" v={<Badge tone={riskBadge(sel.risk)}>{sel.risk} / 100</Badge>} />
          <KV k="KYC 状态(C4)" v={<Badge tone={sel.kyc === "verified" ? "ok" : "warn"}>{sel.kyc}</Badge>} />
          <KV k="提现冷却(Phase 派发)" v={sel.cooldown} />
          <KV k="K3 路由结论" v={sel.route} />
          <KV k="排队时长" v={sel.age} />
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "16px 0 8px" }}>K3 规则命中</div>
          <div className="col" style={{ gap: 6 }}>
            {sel.risk >= 70 && <div className="alertbar danger"><span className="ico"><Icon name="alert" size={14} /></span><div className="tiny">大额 + 新地址信誉低 → K5 大额复审触发</div></div>}
            {sel.risk >= 40 && sel.risk < 70 && <div className="alertbar"><span className="ico"><Icon name="clock" size={14} /></span><div className="tiny">速度异常 → delay 24h</div></div>}
            {sel.risk < 40 && <div className="tint success tiny"><b>四维规则全绿</b> · 金额/速度/账户年龄/地址信誉</div>}
          </div>
        </Drawer>}
        {wdMc && <MakerCheckerModal action={wdMc.mode === "approve" ? "提现放行" : "冻结提现"} detail={`${wdMc.id} · ${fmtUsd(sel?.amount || 0)} → ${sel?.addr}`} amplifies onClose={() => setWdMc(null)} onConfirm={(reason) => dispose(reason)} />}
      </>}

      {tab === "D1" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">充值对账中心</span><CodeTag>5 渠道 / 支付 / 银行卡风控</CodeTag></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>充值 ID</th><th>用户</th><th className="num">金额</th><th>PSP</th><th>方式</th><th>BIN 风控</th><th className="num">手续费缓冲</th><th>状态</th><th /></tr></thead>
          <tbody>{TOPUPS.map((t) => { const reconciled = pget(`D.recon.${t.id}`) === "reconciled"; const st = reconciled ? "confirmed" : t.status; return (
            <tr key={t.id}><td className="mono t-strong">{t.id}</td><td className="mono t-mut">{t.user}</td>
              <td className="num t-strong tnum">{fmtUsd(t.amount)}</td><td>{t.psp}</td>
              <td><CodeTag tone={t.method === "usdt" ? "cyan" : "electric"}>{t.method}</CodeTag></td>
              <td><Badge tone={t.bin.includes("高") ? "err" : t.bin === "—" ? "neutral" : "ok"}>{t.bin}</Badge></td>
              <td className="num mono t-mut">{t.fee ? "$" + t.fee : "—"}</td>
              <td><Badge tone={st === "confirmed" ? "ok" : st === "pending" ? "warn" : "info"}>{st}</Badge></td>
              <td>{st !== "confirmed" ? <Btn sm onClick={() => setReconMc({ id: t.id })}><AutoGloss>核销</AutoGloss></Btn> : reconciled ? <span className="muted tiny"><AutoGloss>已核销</AutoGloss></span> : null}</td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "4px 18px 18px" }}>
          <div className="card-h" style={{ marginTop: 8 }}><span className="ttl" style={{ fontSize: 13 }}>支付渠道 / PSP 配置</span><CodeTag tone="electric">入金通道</CodeTag><span className="muted tiny">启停通道 · BIN 风险规则 · 路由</span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>PSP 通道</th><th>方式</th><th>BIN 风险规则</th><th>路由</th><th>状态</th><th /></tr></thead>
            <tbody>{PSPS.map((p) => { const on = pspOn(p); return (
              <tr key={p.name}><td className="t-strong">{p.name}</td>
                <td><CodeTag tone={p.method === "usdt" ? "cyan" : "electric"}>{p.method}</CodeTag></td>
                <td className="tiny">{pspRule(p)}</td><td className="tiny t-mut">{p.route}</td>
                <td><span className="row" style={{ gap: 8 }}><Toggle on={on} onClick={() => setPspMc({ name: p.name, kind: "toggle", nextOn: !on, action: `PSP 通道${on ? "停用" : "启用"}:${p.name}`, detail: `${on ? "停用" : "启用"} H5 充值入金通道(/me/wallet/cards · /topup)· 影响入金成功率` })} /><Badge tone={on ? "ok" : "neutral"}>{on ? "启用" : "停用"}</Badge></span></td>
                <td><Btn sm onClick={() => setPspMc({ name: p.name, kind: "rule", cur: pspRule(p), action: `PSP 通道规则调整:${p.name}`, detail: `当前 BIN 规则 ${pspRule(p)} · 调整 BIN 风险规则 / 路由 / 单笔限额 · 影响 H5 充值入金成功率与风控` })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
          <div className="tint warn tiny" style={{ marginTop: 10 }}><AutoGloss>停用某 PSP → 关闭 H5 端对应入金方式(/me/wallet/cards · /topup);高风险 BIN 自动转人工复核。通道启停 / 规则调整走 Maker-Checker。</AutoGloss></div>
        </div>
      </Card>}

      {tab === "D3" && <div className="grid g-3">
        <Card className="span-2">
          <CardH title="资金池水位仪表盘" sub="储备 vs 负债 · 到期利息" right={<CodeTag title="资金池账本唯一权威源">账本来源</CodeTag>} />
          <div className="grid g-3" style={{ gap: 12, marginBottom: 16 }}>
            <div className="tint success"><div className="muted tiny">真实储备总额</div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--success)" }} className="tnum">{fmtM(TREASURY.reserveTotal)}</div></div>
            <div className="tint warn"><div className="muted tiny"><AutoGloss>应付负债总额</AutoGloss></div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--warning)" }} className="tnum">{fmtM(total)}</div></div>
            <div className="tint brand"><div className="muted tiny"><AutoGloss>覆盖率</AutoGloss></div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--brand)" }} className="tnum">{TREASURY.coverageRatio}%</div></div>
          </div>
          <table className="tbl"><thead><tr><th>负债科目</th><th>事件来源</th><th className="num">额(USDT)</th><th className="num">占比</th></tr></thead>
            <tbody>{LIABILITIES.map((l) => (
              <tr key={l.id}><td><span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: l.color }} />{l.name}</span></td>
                <td className="mono tiny t-mut">{LIAB_SOURCES[l.id - 1]}</td>
                <td className="num t-strong tnum">{fmtM(l.amount)}</td><td className="num tnum">{((l.amount / total) * 100).toFixed(1)}%</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card>
          <CardH title="储备健康度" sub="m7 扩张 · 净流入累积" />
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 46, fontWeight: 600, color: "var(--success)" }} className="tnum">{TREASURY.coverageRatio}<small style={{ fontSize: 20 }}>%</small></div>
            <div className="muted tiny">兑付覆盖率 · 绿区(健康线 {LEDGER.healthyPct}%)</div>
          </div>
          <hr className="section-divider" />
          <KV k="真实储备总额" v={<span className="mono">{fmtM(TREASURY.reserveTotal)}</span>} />
          <KV k="应付负债总额" v={<span className="mono">{fmtM(total)}</span>} />
          <KV k="24h 净流入" v={<span className="mono">+{fmtM(dailyInflow)}</span>} />
          <div className="tint cyan tiny" style={{ marginTop: 12 }}>m7 扩张:毛流入 ≫ payout,储备净流入累积;出金压力比 {(LEDGER.pressureRatio * 100).toFixed(0)}% 远低 70% 红线。staking 本金到期前不计入可兑付储备(与 B2 科目 #2/#3 不双计)。</div>
        </Card>
      </div>}

      {tab === "D4" && <div className="grid g-3">
        <Card className="span-2 pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">账本 / 账单审计</span><CodeTag>账单流水</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>server 唯一账本 · append-only</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>bill ID</th><th>用户</th><th>类型</th><th className="num">变动</th><th>币种</th><th className="num">结余</th><th>时间</th><th /></tr></thead>
            <tbody>{BILLS.map((b) => { const reversed = pget(`D.bill.${b.id}.reversed`) === "true"; return (
              <tr key={b.id} style={reversed ? { opacity: 0.55 } : undefined}><td className="mono t-strong">{b.id}</td><td className="mono t-mut">{b.user}</td>
                <td><CodeTag tone={billTone[b.type]}>{b.type}</CodeTag>{b.mc && <span className="muted tiny"> · <AutoGloss>{b.mc}</AutoGloss></span>}{reversed && <span className="muted tiny"> · <AutoGloss>已红冲</AutoGloss></span>}</td>
                <td className="num t-strong tnum" style={{ color: b.dir === "+" ? "var(--success)" : "var(--negative)", textDecoration: reversed ? "line-through" : undefined }}>{b.dir}{b.amt.toLocaleString()}</td>
                <td><CodeTag tone={b.cur === "NEX" ? "cyan" : "electric"}>{b.cur}</CodeTag></td>
                <td className="num tnum mono t-mut">{b.bal.toLocaleString()}</td><td className="mono tiny t-mut">{b.ts}</td>
                <td>{!reversed ? <Btn sm onClick={() => setBillMc({ id: b.id })}><AutoGloss>红冲</AutoGloss></Btn> : null}</td></tr>
            ); })}</tbody>
          </table></div>
        </Card>
        <Card><CardH title="账本对账" sub="6 类 bill type" />
          {([["earning", "收益入账", "var(--cyan)"], ["commission", "佣金", "var(--brand)"], ["topup", "充值", "var(--brand)"], ["withdraw", "提现", "var(--warning)"], ["swap", "兑换", "var(--ink-3)"], ["adjust", "人工调整冲正", "var(--brand-2)"]] as const).map(([k, n, c]) => (
            <div key={k} className="kv"><span className="k"><span className="dot" style={{ background: c, marginRight: 7, display: "inline-block" }} /><AutoGloss>{n}</AutoGloss> <span className="mono tiny muted">{k}</span></span><span className="v mono">{billTotals[k]}</span></div>
          ))}
          <hr className="section-divider" />
          <div className="tint cyan tiny">D4 是唯一记账层 · admin.bill_adjusted 与 C3 发起层 admin.balance_adjusted 以 billId 关联,避免 L3/A2 双计</div>
        </Card>
      </div>}

      {tab === "D5" && <Card>
        <CardH title="提现参数配置" sub="Phase 联动 · 放大流出须先核验覆盖率" right={<CodeTag>提现参数</CodeTag>} />
        <table className="tbl"><thead><tr><th>参数</th><th>当前值</th><th>Phase 联动</th><th /></tr></thead>
          <tbody>{WITHDRAW_PARAMS.map((p) => (
            <tr key={p.key}><td className="t-strong">{p.name}</td>
              <td className="t-strong tnum">{effParam(p)}</td>
              <td>{p.phase ? <CodeTag tone="electric" title="随「增长与节奏」节奏参数联动">节奏联动</CodeTag> : <span className="muted tiny">独立</span>}</td>
              <td><Btn sm onClick={() => setParamMc(p)}>调整</Btn></td></tr>
          ))}</tbody>
        </table>
        {paramMc && <MakerCheckerModal action={`提现参数调整:${paramMc.name}`} detail={`${paramMc.name} 当前 ${effParam(paramMc)} · 提交后双人复核生效`} amplifies edit={{ kind: "text", current: effParam(paramMc) }} onClose={() => setParamMc(null)} onConfirm={(reason, newVal) => { if (newVal) setParam(`D.${paramMc.key}`, newVal, { action: "提现参数调整 " + paramMc.name, reason }); setToast("参数 " + paramMc.name + " 已更新为 " + newVal); setParamMc(null); }} />}
      </Card>}

      {pspMc && <MakerCheckerModal action={pspMc.action} detail={pspMc.detail} edit={pspMc.kind === "rule" ? { kind: "text", current: pspMc.cur } : undefined} onClose={() => setPspMc(null)} onConfirm={(reason, newVal) => {
        if (pspMc.kind === "toggle") {
          setParam(`D.psp.${pspMc.name}.on`, pspMc.nextOn ? "true" : "false", { action: pspMc.action, reason });
          setToast(`${pspMc.name} 入金通道已${pspMc.nextOn ? "启用" : "停用"}`);
        } else if (newVal) {
          setParam(`D.psp.${pspMc.name}.rule`, newVal, { action: pspMc.action, reason });
          setToast(`${pspMc.name} BIN 风险规则已更新为 ${newVal}`);
        }
        setPspMc(null);
      }} />}
      {reconMc && <MakerCheckerModal action={`充值对账核销:${reconMc.id}`} detail="核销链上到账差异 · 标记为已对账(写 D4 账本 + A2 审计)" onClose={() => setReconMc(null)} onConfirm={(reason) => { setParam(`D.recon.${reconMc.id}`, "reconciled", { action: "充值对账核销 " + reconMc.id, reason }); setToast("充值 " + reconMc.id + " 已核销"); setReconMc(null); }} />}
      {billMc && <MakerCheckerModal action={`账本红冲:${billMc.id}`} detail="对该 bill 发起红冲冲正(append-only,原条保留 + 写反向分录)· 资产回退联动 C3" amplifies onClose={() => setBillMc(null)} onConfirm={(reason) => { setParam(`D.bill.${billMc.id}.reversed`, "true", { action: "账本红冲 " + billMc.id, reason }); setToast("账本 " + billMc.id + " 已红冲"); setBillMc(null); }} />}
      {toastNode}
    </div>
  );
}
