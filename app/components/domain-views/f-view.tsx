"use client";

/**
 * F 分销与团队 — 设计稿 Team 内容视图(从 page-revenue.jsx 移植)。
 * 标签:F2 网络版税费率 / F3 双轨结算引擎 / F1 V-Rank 晋升 / F5 佣金事件审计 / F4 池·配额·大使·榜。
 * 路由 l2.id 折叠:F6/F7/F8→F4(池/配额/大使/榜聚合在 F4 内)。
 *
 * 真写落点:运营处置 / 调参统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
 * - 调参类(费率 / 门槛 / 比例 / 配额 / 倍率):MakerCheckerModal 自动出「目标新值」→ onConfirm 的 newVal 真写,派生显示 pget(key) ?? mock 原值。
 * - 处置类(大使批准 / 驳回 · 榜单取消资格 · 佣金冻结 / 驳回):setParam 固定状态值。
 */
import { useState } from "react";
import { Card, CardH, CodeTag, Badge, Btn, KV, MakerCheckerModal, useToast, useDomainNav, type EditSpec } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { REVENUE, fmtUsd, fmtM } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

const UNILEVEL = [
  { l: "L1", usdt: 10, nex: 50, ui: "直推 DIRECT" },
  { l: "L2", usdt: 5, nex: 20, ui: "扩展 EXTENDED" },
  { l: "L3", usdt: 3, nex: 10, ui: "扩展" },
  { l: "L4", usdt: 2, nex: 5, ui: "扩展" },
  { l: "L5", usdt: 1, nex: 2.5, ui: "扩展" },
  { l: "L6", usdt: 0.5, nex: 1, ui: "扩展" },
  { l: "L7", usdt: 0.5, nex: 1, ui: "扩展" },
];
const RATETIER: [string, string, string, string][] = [
  ["Standard", "$0+", "8%", "62%"],
  ["Verified", "$5,000+", "10%", "24%"],
  ["Premium", "$50,000+", "12%", "11%"],
  ["Diamond", "$500,000+", "15%", "3%"],
];
const BINARY = [
  { user: "usr_31E8", a: 84000, b: 62000, match: 6200, ok: true, today: 1500, state: "结算中" },
  { user: "usr_19C7", a: 38000, b: 41000, match: 3800, ok: true, today: 1500, state: "达封顶" },
  { user: "usr_02A9", a: 12000, b: 800, match: 0, ok: false, today: 0, state: "阻塞(B轨<$1k)" },
  { user: "usr_84F2", a: 5400, b: 4900, match: 490, ok: true, today: 490, state: "结算中" },
];
const COMMISSIONS = [
  { id: "CM-7781", kind: "network", user: "usr_19C7", amt: 420, cur: "USDT", cool: "冷却 18d", state: "计提" },
  { id: "CM-7780", kind: "binary", user: "usr_31E8", amt: 1500, cur: "USDT", cool: "已解锁", state: "可提" },
  { id: "CM-7779", kind: "cultivation", user: "usr_02A9", amt: 200, cur: "NEX", cool: "冷却 30d", state: "计提" },
  { id: "CM-7777", kind: "leadership", user: "usr_31E8", amt: 880, cur: "USDT", cool: "已解锁", state: "可提" },
  { id: "CM-7774", kind: "genesis", user: "usr_19C7", amt: 90, cur: "USDT", cool: "已解锁", state: "可提" },
  { id: "CM-7770", kind: "network", user: "usr_55B1", amt: 140, cur: "USDT", cool: "撤销", state: "异常回退" },
];

// 13 阶 V0–V12 镜像前端 v-rank.ts V_RANKS(门槛 / 实物奖品 / 培育奖 NEX / 当前人数=GLOBAL_V_DISTRIBUTION)。
// 原后台仅 6 阶(漏 V1/V2/V4/V7/V9/V10/V11),奖品/人数与前端对不上,已对齐。
const VRANK: [string, string, string, string, string][] = [
  ["V0", "—", "—", "—", "84,231"],
  ["V1", "自买 $299 · 直推 3", "Pilot 徽章", "500", "12,483"],
  ["V2", "团队 GV $5k", "操作员勋章", "2,000", "3,247"],
  ["V3", "团队 GV $20k · 2×V1", "Apple Watch SE", "10,000", "487"],
  ["V4", "团队 GV $50k · 3×V2", "iPhone 16 Pro", "50,000", "102"],
  ["V5", "团队 GV $150k · 4×V3", "Apple Vision Pro", "200,000", "21"],
  ["V6", "团队 GV $500k · 5×V4", "Rolex Submariner", "800,000", "3"],
  ["V7", "团队 GV $1M · 6×V5", "Tesla Model Y", "3,200,000", "1"],
  ["V8", "团队 GV $3M · 7×V6", "Porsche 911", "10,000,000", "0"],
  ["V9", "团队 GV $10M", "Lamborghini Urus", "—", "0"],
  ["V10", "团队 GV $30M", "私人飞机包月", "—", "0"],
  ["V11", "团队 GV $100M", "加勒比游艇度假", "—", "0"],
  ["V12", "团队 GV $500M", "上市公司股权", "—", "0"],
];
// V 级 → 领导池票数权重(镜像前端 leadership-pool.ts V_VOTES,指数翻倍 V3=1→V12=512)。修 registry 1/2/3 矛盾。
const V_VOTES_ROWS: [string, string][] = [
  ["V3", "1"], ["V4", "2"], ["V5", "4"], ["V6", "8"], ["V7", "16"],
  ["V8", "32"], ["V9", "64"], ["V10", "128"], ["V11", "256"], ["V12", "512"],
];

const FOLD: Record<string, string> = { F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F4", F7: "F4", F8: "F4" };

type Stat4Item = [string, string, string?, string?];
// 共享 mc state:op 区分纯文案 toast(undefined) / 调参(param)/ 处置(dispose);
// 调参用 newVal 真写,处置用固定 fixedVal 真写。edit/detail 透传给 MakerCheckerModal。
type Mc = {
  name: string;
  amplify?: boolean;
  op?: "param" | "dispose";
  paramKey?: string;
  fixedVal?: string;          // 处置类固定写入值(approved / rejected / disqualified / frozen / unlocked …)
  status?: string;            // 处置后即时反映用的展示状态
  edit?: EditSpec;            // 调参类目标新值编辑规格(current/unit/options)
  detail?: string;
} | null;

export function FDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const nav = useDomainNav();
  const [tab] = useState(FOLD[meta.l2Id] ?? "F2");
  const [mc, setMc] = useState<Mc>(null);
  // 真写落点:运营处置 / 调参统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  const stats: Stat4Item[] = [
    ["佣金支出(月)", fmtM(REVENUE.commission)],
    ["活跃 V3+ 用户", "2,140"],
    ["佣金触发率(#7)", "76%", "目标 80%", "var(--warning)"],
    ["冷却未解锁", fmtM(LEDGER.accounts.find((a) => a.key === "commission_cool")!.amount), "科目 #7"],
  ];

  // 处置态 → Badge 文案 / 色调(大使审批 · 榜单 · 佣金)
  const ambassadorState = pget("F.ambassador.q3-2025.status");        // approved / rejected
  const lbDisqualified = pget("F.leaderboard.period.status") === "disqualified";
  const commState = (c: (typeof COMMISSIONS)[number]): string => pget(`F.commission.${c.id}.status`) ?? c.state;

  return (
    <div className="dkpage">
      <DomainHeader {...meta} />

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {stats.map(([k, v, sub, col]) => (
          <Card key={k} style={{ padding: "15px 16px" }}>
            <div className="muted tiny">{k}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: col || "var(--ink)" }} className="tnum">{v}</div>
            {sub && <div className="muted tiny">{sub}</div>}
          </Card>
        ))}
      </div>

      {tab === "F2" && <div className="grid g-3">
        <Card className="span-2 pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">L1–L7 网络版税费率(Unilevel)</span><CodeTag>网络版税</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>用户侧仅展示 直推/扩展 二态</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>layer</th><th className="num">USDT 费率</th><th className="num">NEX 奖励 /$1</th><th>用户侧分类</th><th /></tr></thead>
            <tbody>{UNILEVEL.map((u) => { const eff = pget(`F.unilevel.${u.l}`) ?? `${u.usdt}%`; return (
              <tr key={u.l}><td><CodeTag tone="electric">{u.l}</CodeTag></td><td className="num t-strong tnum mono">{eff}</td><td className="num tnum mono">{(() => { const nv = pget(`F.unilevel.nex.${u.l}`) ?? String(u.nex); return <span className="row" style={{ gap: 6, alignItems: "center", justifyContent: "flex-end" }}><span>{nv}</span><Btn sm onClick={() => setMc({ name: `网络版税 ${u.l} NEX 奖励调整`, amplify: true, op: "param", paramKey: `F.unilevel.nex.${u.l}`, edit: { kind: "text", current: String(nv) }, detail: `${u.l} NEX 奖励/$1 当前 ${nv} · NEX 派发为资金流出,受 B1 覆盖率约束` })}>调</Btn></span>; })()}</td>
                <td>{u.ui.includes("DIRECT") ? <Badge tone="info">{u.ui}</Badge> : <span className="muted tiny">{u.ui}</span>}</td>
                <td><Btn sm onClick={() => setMc({ name: `网络版税 ${u.l} 费率调整`, amplify: true, op: "param", paramKey: `F.unilevel.${u.l}`, edit: { kind: "text", current: eff, unit: "%" }, detail: `${u.l} 当前 ${eff} · 改后对下一笔结算生效,不回溯已计提` })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>合并出口护栏:Direct Royalty(8–15%)+ Network L1(10%)叠加最大 25% · 上调费率须先核验 B1 覆盖率</AutoGloss></div></div>
        </Card>
        <Card><CardH title="Rate Tier 升档" sub="按 30d 网络活跃度" right={<CodeTag>费率升档</CodeTag>} />
          <table className="tbl"><thead><tr><th>tier</th><th>门槛</th><th>费率</th><th className="num">分布</th></tr></thead>
            <tbody>{RATETIER.map(([t, th, r, d]) => <tr key={t}><td className="t-strong">{t}</td><td className="tiny mono">{th}</td><td className="mono">{r}</td><td className="num tnum">{d}</td></tr>)}</tbody></table>
          <hr className="section-divider" />
          {(() => { const eff = pget("F.influence.clamp") ?? "1.0 – 5.0"; return (
            <KV k="影响分上下限" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "影响分上下限调整", op: "param", paramKey: "F.influence.clamp", edit: { kind: "text", current: eff }, detail: "影响分上下限 · 改后对下一笔结算生效" })}>调整</Btn></span>} />
          ); })()}
          {(() => { const eff = pget("F.cooldown") ?? "30d"; return (
            <KV k="佣金冷却" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "佣金冷却期调整", op: "param", paramKey: "F.cooldown", edit: { kind: "text", current: eff, unit: "天" }, detail: `当前 ${eff} · 改后对新计提佣金生效,不影响已解锁` })}>调整</Btn></span>} />
          ); })()}
          {(() => { const eff = pget("F.promo.weekMultiplier") ?? "1.0×"; return (
            <KV k="promo 周倍率" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "promo 周倍率调整", amplify: true, op: "param", paramKey: "F.promo.weekMultiplier", edit: { kind: "text", current: eff, unit: "×" }, detail: `当前 ${eff} · 放大佣金流出,受 B1 覆盖率约束` })}>调整</Btn></span>} />
          ); })()}
          {(() => { const eff = pget("F.royalty.minPayout") ?? "$10"; return (
            <KV k="版税支付阈值(最小可提)" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "版税支付阈值调整", op: "param", paramKey: "F.royalty.minPayout", edit: { kind: "text", current: eff }, detail: `版税最小可提阈值 · 当前 ${eff} · 调高=凑不够提不出(提现摩擦)` })}>调整</Btn></span>} />
          ); })()}
          {(() => { const eff = pget("F.peer.rate") ?? "5%"; return (
            <KV k="peer 平级比例(V3+)" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "peer 平级比例调整", amplify: true, op: "param", paramKey: "F.peer.rate", edit: { kind: "text", current: eff, unit: "%" }, detail: `同 V 级平级奖励比例(V3+)· 当前 ${eff} · 放大佣金流出,受 B1 覆盖率约束` })}>调整</Btn></span>} />
          ); })()}
        </Card>
      </div>}

      {tab === "F3" && <>
        <div className="grid g-3" style={{ marginBottom: 16 }}>
          <Card className="span-2"><CardH title="平衡匹配结算" sub="min(A,B) × 10% 较小侧" right={<CodeTag><AutoGloss>双轨结算</AutoGloss></CodeTag>} />
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>用户</th><th className="num">Track A GV</th><th className="num">Track B GV</th><th className="num">Balance Match</th><th className="num">当日已发</th><th>状态</th></tr></thead>
              <tbody>{BINARY.map((b) => (
                <tr key={b.user}><td className="mono t-mut">{b.user}</td><td className="num tnum mono">{fmtUsd(b.a)}</td><td className="num tnum mono">{fmtUsd(b.b)}</td>
                  <td className="num t-strong tnum">{b.match ? fmtUsd(b.match) : "—"}</td><td className="num tnum">{b.today ? fmtUsd(b.today) : "—"}</td>
                  <td><Badge tone={b.ok ? "ok" : "warn"}>{b.state}</Badge></td></tr>
              ))}</tbody>
            </table></div>
          </Card>
          <Card><CardH title="双轨日封顶" sub="左右两轨每日计酬上限" right={<CodeTag tone="electric" title="由「增长与节奏」派发，此处只读">节奏派发 · 只读</CodeTag>} />
            <div style={{ textAlign: "center", padding: "6px 0" }}><div style={{ fontSize: 34, fontWeight: 600, color: "var(--ink)" }} className="tnum">$5,000</div><div className="muted tiny">月 1-6 现值</div></div>
            <div className="tint warn tiny" style={{ margin: "8px 0" }}>下一拐点:<b>月 7</b><AutoGloss> → $2,000(权威归 H1,以月份为口径)</AutoGloss></div>
            <Btn style={{ width: "100%", justifyContent: "center" }} onClick={() => nav("H")}>前往 H1 调整 →</Btn>
          </Card>
        </div>
        <div className="grid g-3">
          <Card><CardH title="两轨门槛" />
            {(() => { const eff = pget("F.binary.threshold") ?? "$1,000 / 轨"; return (
              <KV k="两轨结算门槛" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "两轨结算门槛调整", op: "param", paramKey: "F.binary.threshold", edit: { kind: "text", current: eff }, detail: `两轨结算最低门槛 · 当前 ${eff} · 改后对下一周期结算生效` })}>调整</Btn></span>} />
            ); })()}
            {(() => { const eff = pget("F.binary.matchRate") ?? "10%"; return (
              <KV k="平衡匹配比例" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{eff}</span><Btn sm onClick={() => setMc({ name: "平衡匹配比例调整", amplify: true, op: "param", paramKey: "F.binary.matchRate", edit: { kind: "text", current: eff, unit: "%" }, detail: `min(A,B) × 该比例日结算 · 当前 ${eff} · 放大佣金流出,受 B1 覆盖率约束` })}>调整</Btn></span>} />
            ); })()}
            <KV k="沉淀池(未达门槛)" v={<span className="mono">{fmtM(1.2e6)}</span>} /></Card>
          <Card><CardH title="自动分配 (Auto-placement)" /><KV k="自动安置" v={<Badge tone="ok">已启用</Badge>} /><KV k="近 7d 自动分配" v="1,284 成员" /></Card>
          <Card><CardH title="月度 GV 归零" /><KV k="GV 归零周期" v="每月 1 日 00:00 UTC" /><KV k="未匹配处置" v={<span className="muted tiny">裁定前只读</span>} /></Card>
        </div>
      </>}

      {tab === "F1" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">V-Rank 晋升管理 · 13 阶 V0–V12</span><CodeTag><AutoGloss>V-Rank 晋升</AutoGloss></CodeTag></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>V 级</th><th>门槛</th><th>实物奖品</th><th>培育奖 NEX</th><th className="num">当前人数</th><th /></tr></thead>
          <tbody>{VRANK.map((r) => {
            const hasReward = r[2] !== "—";
            const hasNex = r[3] !== "—";
            const eff = pget(`F.vrank.${r[0]}`) ?? r[1];
            return (
            <tr key={r[0]}><td><CodeTag tone="electric">{r[0]}</CodeTag></td><td className="tiny">{eff}</td><td className="tiny t-mut">{r[2]}</td><td className="mono tiny">{r[3]}</td><td className="num tnum">{r[4]}</td>
              <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm onClick={() => setMc({ name: `V-Rank ${r[0]} 门槛调整`, amplify: hasNex, op: "param", paramKey: `F.vrank.${r[0]}`, edit: { kind: "text", current: eff }, detail: `${r[0]} 晋升门槛 · 当前 ${eff} · server 晋升判定改后对下一轮评估生效` })}>调整门槛</Btn>
                {hasReward && <Btn sm onClick={() => setMc({ name: `实物奖品发货队列:${r[0]}` })}>发货</Btn>}
              </div></td></tr>
            );
          })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint cyan tiny"><AutoGloss>server 晋升判定 · 实物奖品发货队列 + 培育奖 NEX 派发(放大 NEX 流出,受 B1 约束)</AutoGloss></div></div>
      </Card>}

      {tab === "F5" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">佣金事件审计 · 6 类佣金流水</span><CodeTag>佣金审计</CodeTag></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>佣金 ID</th><th>类型</th><th>用户</th><th className="num">金额</th><th>币种</th><th>冷却态</th><th>状态</th><th /></tr></thead>
          <tbody>{COMMISSIONS.map((c) => { const st = commState(c); const isFrozen = st === "frozen"; const isRejected = st === "rejected"; const isUnlocked = st === "unlocked"; const label = isFrozen ? "已冻结" : isRejected ? "已驳回" : isUnlocked ? "已解锁可提" : st; const tone = isUnlocked || st === "可提" ? "ok" : isFrozen || isRejected || st.includes("异常") ? "err" : "neutral"; return (
            <tr key={c.id} style={isRejected ? { opacity: 0.55 } : undefined}><td className="mono t-strong">{c.id}</td><td><CodeTag>{c.kind}</CodeTag></td><td className="mono t-mut">{c.user}</td>
              <td className="num t-strong tnum" style={isRejected ? { textDecoration: "line-through" } : undefined}>{c.amt.toLocaleString()}</td><td><CodeTag tone={c.cur === "NEX" ? "cyan" : "electric"}>{c.cur}</CodeTag></td>
              <td className="tiny">{c.cool}</td><td><Badge tone={tone}>{label}</Badge></td>
              <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                {st === "计提" && <Btn sm onClick={() => setMc({ name: "佣金冻结 " + c.id, op: "dispose", paramKey: `F.commission.${c.id}.status`, fixedVal: "frozen", status: "frozen", detail: `冻结佣金 ${c.id} · ${c.amt.toLocaleString()} ${c.cur} · 暂停其解锁与提现,写 A2 审计` })}>冻结</Btn>}
                {st === "计提" && <Btn sm onClick={() => setMc({ name: "佣金解锁 " + c.id, amplify: true, op: "dispose", paramKey: `F.commission.${c.id}.status`, fixedVal: "unlocked", status: "unlocked", detail: `提前解锁佣金 ${c.id} · ${c.amt.toLocaleString()} ${c.cur} · 放大资金流出,受 B1 约束` })}>解锁</Btn>}
                {st === "异常回退" && <Btn sm onClick={() => setMc({ name: "佣金驳回 " + c.id, op: "dispose", paramKey: `F.commission.${c.id}.status`, fixedVal: "rejected", status: "rejected", detail: `驳回异常佣金 ${c.id} · 红冲该笔计提(联动 D4),写 A2 审计` })}>驳回</Btn>}
              </div></td></tr>
          ); })}</tbody>
        </table></div>
      </Card>}

      {tab === "F4" && <div className="grid g-2">
        <Card><CardH title="领导奖池" sub="5% 周 GMV / V_VOTES" right={<CodeTag><AutoGloss>领导奖池</AutoGloss></CodeTag>} />
          <KV k="本周注入" v={<span className="mono">{fmtM(214000)}</span>} /><KV k="参与 V8+ 用户" v="45" /><KV k="周结算" v="周日 23:59 UTC" />
          {(() => { const eff = pget("F.pool.ratio") ?? "5%"; return (<>
            <KV k="奖池比例(周 GMV)" v={<span className="mono">{eff}</span>} />
            {(() => { const capEff = pget("F.pool.monthlyCap") ?? "$50,000"; return (
              <KV k="月度预留上限(cap)" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{capEff}</span><Btn sm onClick={() => setMc({ name: "领导奖月度预留上限调整", op: "param", paramKey: "F.pool.monthlyCap", edit: { kind: "text", current: capEff }, detail: `领导奖池月度预留封顶 · 当前 ${capEff} · 防预算超支(超额顺延次月)` })}>调整</Btn></span>} />
            ); })()}
            <hr className="section-divider" />
            <Btn style={{ width: "100%", justifyContent: "center" }} onClick={() => setMc({ name: "领导奖池比例调整(周 GMV)", amplify: true, op: "param", paramKey: "F.pool.ratio", edit: { kind: "text", current: eff, unit: "%" }, detail: `当前 ${eff} 周 GMV · 放大奖池流出,受 B1 覆盖率约束` })}>调整池比例</Btn>
          </>); })()}</Card>
        <Card><CardH title="硬件配额" sub="销售前置门" right={<CodeTag><AutoGloss>硬件配额</AutoGloss></CodeTag>} />
          {(() => { const proEff = pget("F.quota.proUnlock") ?? "直推 5 / 月业绩 $50k"; const rackEff = pget("F.quota.rackUnlock") ?? "直推 15"; const stockEff = pget("F.quota.monthlyStock") ?? "96 台"; return (<>
            <KV k="Pro 解锁" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="tiny">{proEff}</span><Btn sm onClick={() => setMc({ name: "硬件配额调整:Pro 解锁门槛", op: "param", paramKey: "F.quota.proUnlock", edit: { kind: "text", current: proEff }, detail: `Pro 销售前置门 · 当前 ${proEff}` })}>调整</Btn></span>} />
            <KV k="Rack 解锁" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="tiny">{rackEff}</span><Btn sm onClick={() => setMc({ name: "硬件配额调整:Rack 解锁门槛", op: "param", paramKey: "F.quota.rackUnlock", edit: { kind: "text", current: rackEff }, detail: `Rack 销售前置门 · 当前 ${rackEff}` })}>调整</Btn></span>} />
            <KV k="月库存上限" v={<span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{stockEff}</span><Btn sm onClick={() => setMc({ name: "硬件配额调整:月库存上限", op: "param", paramKey: "F.quota.monthlyStock", edit: { kind: "number", current: stockEff, unit: "台" }, detail: `月度硬件供给上限 · 当前 ${stockEff}` })}>调整</Btn></span>} />
          </>); })()}</Card>
        <Card><CardH title="区域大使审批" sub="V5+ · 4 类预算" right={<CodeTag><AutoGloss>区域大使</AutoGloss></CodeTag>} />
          <KV k="待审批申请" v={ambassadorState ? <Badge tone={ambassadorState === "approved" ? "ok" : "neutral"}>{ambassadorState === "approved" ? "已批准" : "已驳回"}</Badge> : <Badge tone="warn">7</Badge>} /><KV k="KOL 预算比" v="50%" />
          <hr className="section-divider" />
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!!ambassadorState} onClick={() => setMc({ name: "区域大使申请审批通过", amplify: true, op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "approved", status: "approved", detail: "批准区域大使申请 · 开通预算额度与权益,写 A2 审计" })}>审批</Btn>
            <Btn style={{ flex: 1, justifyContent: "center" }} disabled={!!ambassadorState} onClick={() => setMc({ name: "区域大使申请驳回", op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "rejected", status: "rejected", detail: "驳回区域大使申请 · 不开通预算,写 A2 审计" })}>驳回</Btn>
          </div></Card>
        <Card><CardH title="排行榜 & 反欺诈" sub="4 周期奖池 / Podium" right={<CodeTag>排行榜</CodeTag>} />
          {(() => { const poolEff = pget("F.leaderboard.poolUsd") ?? fmtM(48000); return (<>
            <KV k="本期奖池" v={<span className="mono">{poolEff}</span>} /><KV k="刷榜取消资格" v={lbDisqualified ? <Badge tone="neutral">已处置</Badge> : <Badge tone="err">3</Badge>} />
            <hr className="section-divider" />
            <div className="row" style={{ gap: 8 }}>
              <Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setMc({ name: "排行榜奖池调整(本期奖池)", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd", edit: { kind: "text", current: poolEff }, detail: `本期榜单奖池 · 当前 ${poolEff} · 放大奖池流出,受 B1 约束` })}>调整奖池</Btn>
              <Btn style={{ flex: 1, justifyContent: "center" }} disabled={lbDisqualified} onClick={() => setMc({ name: "排行榜取消资格(反欺诈)", op: "dispose", paramKey: "F.leaderboard.period.status", fixedVal: "disqualified", status: "disqualified", detail: "对刷榜账户取消本期资格 · 剔除其榜单名次与奖池分配,写 A2 审计" })}>取消资格</Btn>
            </div>
          </>); })()}</Card>
        <Card className="span-2 pad-0"><div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">V 级票数权重 · 领导池分配依据</span><CodeTag>票数权重</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>指数翻倍 V3=1 → V12=512 · 顶部 10 人吃池 80%</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>V 级</th><th className="num">票数权重</th><th /></tr></thead>
            <tbody>{V_VOTES_ROWS.map(([v, votes]) => { const eff = pget(`F.pool.votes.${v}`) ?? votes; return (
              <tr key={v}><td><CodeTag tone="electric">{v}</CodeTag></td><td className="num t-strong tnum mono">{eff}</td>
                <td><Btn sm onClick={() => setMc({ name: `领导池 ${v} 票数权重调整`, amplify: true, op: "param", paramKey: `F.pool.votes.${v}`, edit: { kind: "number", current: String(eff) }, detail: `${v} 领导池票数权重 · 当前 ${eff} · 改变池子分配权重,放大头部虹吸,受 B1 覆盖率约束` })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>票数权重决定领导奖池分红分配 · 调高高 V 级权重放大头部流出,受 B1 兑付覆盖率约束</AutoGloss></div></div>
        </Card>
      </div>}

      {mc && <MakerCheckerModal
        action={mc.name}
        detail={mc.detail ?? "server-canonical · 改后对下一笔结算生效,不回溯已计提"}
        amplifies={!!mc.amplify}
        edit={mc.edit}
        onClose={() => setMc(null)}
        onConfirm={(reason, newVal) => {
          if (mc.op === "param" && mc.paramKey) {
            // 调参类:写入操作员输入的目标新值
            if (!newVal) { setToast("请填写目标新值"); return; }
            setParam(mc.paramKey, newVal, { action: mc.name, reason });
            setToast(mc.name + " 已提交复核 · 新值 " + newVal);
          } else if (mc.op === "dispose" && mc.paramKey && mc.fixedVal) {
            // 处置类:写入固定状态值(无目标新值输入)
            setParam(mc.paramKey, mc.fixedVal, { action: mc.name, reason });
            setToast(mc.name + " 已提交复核");
          } else {
            setToast("已提交复核");
          }
          setMc(null);
        }} />}
      {toastNode}
    </div>
  );
}
