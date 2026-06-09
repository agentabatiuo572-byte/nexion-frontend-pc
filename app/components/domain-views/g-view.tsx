"use client";

/**
 * G 金融产品 — 设计稿 FinProd 内容视图(从 page-revenue.jsx 移植)。
 * 标签:G1 Staking 池 / G2 兑换风控 / G3 NEX 行情引擎 / G4 Genesis 经济 / G5 Premium·NEXv2·复投。
 * 路由 l2.id 折叠:G6/G7→G5(Premium / NEX v2 Vault / 复投激励聚合在 G5 内)。
 */
import { useState } from "react";
import { Icon, Card, CardH, CodeTag, Badge, Btn, Toggle, Sparkline, KV, MakerCheckerModal, useToast, useDomainNav } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { REVENUE, fmtM } from "@/lib/mock/admin/design-data";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

// [label, apy, 提前赎回罚, 最小额, 在线, tier key slug(→ G.staking.apy.{tier} / G.staking.{tier}.killed)]
// USDT 4 档对齐前端权威源 lib/v3/staking.ts(STAKING_APY 12/35/80/180 · PENALTY 5/15/30/50 · MIN 100/500/1000/5000)。
// NEX 档为 NEX 锁仓池(lib/mock/staking-pools.ts)。消除原后台 8/12/18 与前端三套打架。
const STAKING: [string, string, string, string, boolean, string][] = [
  ["USDT · 30d", "12%", "5%", "$100", true, "usdt30d"],
  ["USDT · 90d", "35%", "15%", "$500", true, "usdt90d"],
  ["USDT · 180d", "80%", "30%", "$1,000", true, "usdt180d"],
  ["USDT · 365d", "180%", "50%", "$5,000", true, "usdt365d"],
  ["NEX · 30d", "5%", "—", "1,000 NEX", true, "nex30d"],
  ["NEX · 90d", "12%", "—", "5,000 NEX", true, "nex90d"],
  ["NEX · 180d", "20%", "—", "10,000 NEX", true, "nex180d"],
  ["NEX · 365d", "35%", "—", "20,000 NEX", true, "nex365d"],
];

const FOLD: Record<string, string> = { G1: "G1", G2: "G2", G3: "G3", G4: "G4", G5: "G5", G6: "G5", G7: "G5" };

type Stat4Item = [string, string, string?, string?];
// onApply:动作携带真写 store 的回调(复核放行后执行)。
//  - op:"param" + paramKey + paramVal(mock 当前值,供弹窗显示「当前 → 新」差异)→ onConfirm 收 newVal → setParam(paramKey, newVal)。
//  - 既有 pause 类(G-06/G-08)用 onApply 写固定值;未带 op/onApply 才走通用 toast 留痕。
type Mc = { name: string; amplify?: boolean; op?: "param"; paramKey?: string; paramVal?: string; onApply?: (reason: string) => void } | null;

export function GDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const nav = useDomainNav();
  const [tab] = useState(FOLD[meta.l2Id] ?? "G1");
  const [mc, setMc] = useState<Mc>(null);

  // ── 平台级配置真写(keyed + 审计 + persist)· 本 view 接 G-06 / G-08 两个 P0 pause 闸 ──
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  const nexPaused = pget("G.market.nexPaused") === "true";          // G-06 NEX 行情引擎紧急 pause
  const secondaryPaused = pget("G.genesis.secondaryPaused") === "true"; // G-08 Genesis 二级市场 pause
  const isKilled = (tier: string) => pget(`G.staking.${tier}.killed`) === "true"; // G1 单档 kill(处置类,经 J1 编排)

  const stats: Stat4Item[] = [
    ["代币经济收入(月)", fmtM(REVENUE.token)],
    ["Staking TVL", fmtM(11.82e6)],
    ["Genesis 已售", "847 / 1,000"],
    ["熔断功能闸", "1", "nexv2", "var(--danger)"],
  ];

  return (
    <div className="dkpage">
      <DomainHeader {...meta} />

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {stats.map(([k, v, sub, col]) => (
          <Card key={k} style={{ padding: "15px 16px" }}>
            <div className="muted tiny"><AutoGloss>{k}</AutoGloss></div>
            <div style={{ fontSize: 22, fontWeight: 600, color: col || "var(--ink)" }} className="tnum">{v}</div>
            {sub && <div className="muted tiny"><AutoGloss>{sub}</AutoGloss></div>}
          </Card>
        ))}
      </div>

      {tab === "G1" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl"><AutoGloss>Staking 池配置 · USDT + NEX 各 4 档</AutoGloss></span><CodeTag><AutoGloss>质押池</AutoGloss></CodeTag></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>池 / 期限</th><th>APY</th><th>提前赎回罚</th><th>最小额</th><th>单档 kill</th><th /></tr></thead>
          <tbody>{STAKING.map((r) => { const killed = isKilled(r[5]); const apy = pget(`G.staking.apy.${r[5]}`) ?? r[1]; return (
            <tr key={r[0]} style={killed ? { opacity: 0.55 } : undefined}><td className="t-strong">{r[0]}</td><td className="mono t-strong">{apy}</td><td className="mono t-mut">{(() => { const v = pget(`G.staking.penalty.${r[5]}`) ?? r[2]; return <span className="row" style={{ gap: 6, alignItems: "center" }}><span>{v}</span><Btn sm onClick={() => setMc({ name: "Staking 提前赎回罚调整:" + r[0], op: "param", paramKey: `G.staking.penalty.${r[5]}`, paramVal: v })}>调</Btn></span>; })()}</td><td className="mono tiny">{(() => { const v = pget(`G.staking.min.${r[5]}`) ?? r[3]; return <span className="row" style={{ gap: 6, alignItems: "center" }}><span>{v}</span><Btn sm onClick={() => setMc({ name: "Staking 最小额调整:" + r[0], op: "param", paramKey: `G.staking.min.${r[5]}`, paramVal: v })}>调</Btn></span>; })()}</td>
              <td><span className="row" style={{ gap: 6 }}><span className={"dot " + (killed ? "red" : "green")} /><Toggle on={!killed} danger onClick={() => setMc({ name: `Staking 单档${killed ? "恢复" : "kill"}:${r[0]}`, amplify: !killed, onApply: (reason) => { setParam(`G.staking.${r[5]}.killed`, killed ? "false" : "true", { action: `Staking 单档${killed ? "恢复" : "kill"} ${r[0]}`, reason }); setToast(`${r[0]} 单档${killed ? "已恢复" : "已 kill"}`); } })} /></span></td>
              <td><Btn sm onClick={() => setMc({ name: "Staking APY 调整:" + r[0], amplify: true, op: "param", paramKey: `G.staking.apy.${r[5]}`, paramVal: apy })}>调整</Btn></td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>上调 APY 放大利息应付负债(科目 #3)· 须先核验 B1 覆盖率 · 单档 kill 归 J1 staking 闸</AutoGloss></div></div>
      </Card>}

      {tab === "G2" && <div className="grid g-2">
        <Card><CardH title={<AutoGloss>兑换风控 · NEX↔USDT 三阈值</AutoGloss>} right={<CodeTag>兑换风控</CodeTag>} />
          <KV k="用户日兑换上限" v={(() => { const v = pget("G.exchange.userDailyCap") ?? "$50"; return <span className="row" style={{ gap: 8, alignItems: "center" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "兑换阈值调整:用户日兑换上限", amplify: true, op: "param", paramKey: "G.exchange.userDailyCap", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="平台日兑换上限" v={(() => { const v = pget("G.exchange.platformDailyCap") ?? "$20,000"; return <span className="row" style={{ gap: 8, alignItems: "center" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "兑换阈值调整:平台日兑换上限", amplify: true, op: "param", paramKey: "G.exchange.platformDailyCap", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="KYC 触发线" v={(() => { const v = pget("G.exchange.kycTrigger") ?? "$100"; return <span className="row" style={{ gap: 8, alignItems: "center" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "兑换阈值调整:KYC 触发线", op: "param", paramKey: "G.exchange.kycTrigger", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="兑换手续费" v={(() => { const v = pget("G.exchange.fee") ?? "Free"; return <span className="row" style={{ gap: 8, alignItems: "center" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "兑换费率调整:手续费", op: "param", paramKey: "G.exchange.fee", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="超阈值 gate" v="排队 + K5 复审" />
          <div className="tint warn tiny" style={{ marginTop: 10 }}><AutoGloss>代币经济资金从 NEX → USDT(可提现)形态的闸门 · 上调 cap 放大可提现流出,须经复核 · 累计阈值命中触发 KYC 复审</AutoGloss></div>
        </Card>
        <Card><CardH title="兑换队列态势" />
          <div className="grid g-2" style={{ gap: 10, marginBottom: 10 }}>
            <div className="tint"><div className="muted tiny">今日兑换量</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }} className="tnum">{fmtM(1.84e6)}</div></div>
            <div className="tint warn"><div className="muted tiny">排队中(超阈值)</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--warning)" }} className="tnum">38</div></div>
          </div>
          <Sparkline data={[1.2, 1.5, 1.4, 1.8, 1.6, 1.9, 1.84].map((v) => v * 1e6)} color="var(--brand)" fill h={60} />
        </Card>
      </div>}

      {tab === "G3" && <div className="grid g-3">
        <Card className="span-2"><CardH title={<AutoGloss>NEX 行情引擎</AutoGloss>} sub="price / pump 曲线 / oracle" right={<CodeTag>行情引擎</CodeTag>} />
          <div className="row" style={{ alignItems: "flex-end", gap: 14, marginBottom: 8 }}>
            <div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }} className="tnum">$0.171</div>
            <span className="delta up tiny" style={{ fontWeight: 600 }}>↑ +20.4% 24h</span>
          </div>
          <Sparkline data={[0.142, 0.145, 0.150, 0.148, 0.155, 0.160, 0.158, 0.165, 0.167, 0.169, 0.170, 0.171].map((v) => v * 100)} color="var(--success)" fill h={90} />
        </Card>
        <Card><CardH title="做市参数" />
          <KV k="pump 曲线" v={pget("G.market.pumpCurve") ?? "阶梯拉升"} /><KV k="做市波动" v={<span className="mono">{pget("G.market.volatility") ?? "±3%/h"}</span>} />
          <KV k="oracle 喂价源" v={pget("G.market.oracle") ?? "3 源中位"} /><KV k="价格 server 权威" v={<Badge tone="ok">是</Badge>} />
          <KV k="行情引擎状态" v={nexPaused ? <Badge tone="danger">已暂停</Badge> : <Badge tone="ok">运行中</Badge>} />
          <Btn style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={() => setMc({ name: "做市参数调整:做市波动上限", op: "param", paramKey: "G.market.volatility", paramVal: pget("G.market.volatility") ?? "±3%/h" })}>调整做市参数</Btn>
          {nexPaused
            ? <Btn style={{ width: "100%", justifyContent: "center", marginTop: 8 }} variant="primary" onClick={() => setMc({ name: "NEX 行情引擎 恢复运行", amplify: true, onApply: (reason) => { setParam("G.market.nexPaused", "false", { action: "NEX 行情引擎恢复运行", reason }); setToast("NEX 行情引擎已恢复运行"); } })}><Icon name="power" size={15} />恢复行情引擎</Btn>
            : <Btn style={{ width: "100%", justifyContent: "center", marginTop: 8 }} variant="danger" onClick={() => setMc({ name: "NEX 行情引擎 紧急暂停", amplify: true, onApply: (reason) => { setParam("G.market.nexPaused", "true", { action: "NEX 行情引擎紧急暂停", reason }); setToast("NEX 行情引擎已暂停"); } })}><Icon name="power" size={15} />紧急 pause(行情引擎)</Btn>}
        </Card>
      </div>}

      {tab === "G4" && <div className="grid g-2">
        <Card><CardH title={<AutoGloss>Genesis 经济 · 创世节点</AutoGloss>} right={<CodeTag><AutoGloss>创世节点</AutoGloss></CodeTag>} />
          <div className="grid g-2" style={{ gap: 10, marginBottom: 12 }}>
            <div className="tint"><div className="row"><div className="muted tiny">节点供给上限</div><div className="spacer" /><Btn sm onClick={() => setMc({ name: "Genesis 供给上限调整(增发节点)", amplify: true, op: "param", paramKey: "G.genesis.supply", paramVal: pget("G.genesis.supply") ?? "1,000" })}>调整</Btn></div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }} className="tnum">{pget("G.genesis.supply") ?? "1,000"}</div></div>
            <div className="tint"><div className="muted tiny">已售 / 剩余</div><div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }} className="tnum">847 / 153</div></div>
          </div>
          <KV k="一级单价" v={(() => { const v = pget("G.genesis.price") ?? "$9,999"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "Genesis 一级单价调整", op: "param", paramKey: "G.genesis.price", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="每日分红率" v={(() => { const v = pget("G.genesis.dividend") ?? "0.1%"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "Genesis 每日分红率调整", amplify: true, op: "param", paramKey: "G.genesis.dividend", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="二级版税" v={(() => { const v = pget("G.genesis.royalty") ?? "2.5%"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "Genesis 二级版税调整", op: "param", paramKey: "G.genesis.royalty", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="平台日交易量基数" v={(() => { const v = pget("G.genesis.dailyVolumeBase") ?? "$24,000,000"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "Genesis 平台日交易量基数调整", amplify: true, op: "param", paramKey: "G.genesis.dailyVolumeBase", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="二级地板价" v={(() => { const v = pget("G.genesis.secondaryFloor") ?? "$25,000"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "Genesis 二级地板价调整", op: "param", paramKey: "G.genesis.secondaryFloor", paramVal: v })}>调整</Btn></span>; })()} />
          <KV k="售罄速度(#8)" v={<Badge tone="ok">11 天</Badge>} />
          <div className="tint cyan tiny" style={{ marginTop: 10 }}><AutoGloss>单节点日分红 ≈ 平台日交易量基数 × 每日分红率(0.1%)÷ 供给上限 · server-canonical(改动经 Maker-Checker 复核)</AutoGloss></div>
        </Card>
        <Card><CardH title="一二级市场 / geo" />
          <KV k="一级市场" v={<Badge tone="ok">开放</Badge>} /><KV k="二级市场" v={secondaryPaused ? <Badge tone="danger">已暂停</Badge> : <Badge tone="ok">开放</Badge>} />
          <KV k="pause 状态" v={secondaryPaused ? <span className="tiny" style={{ color: "var(--danger)", fontWeight: 600 }}>二级市场已暂停</span> : <span className="muted tiny">未暂停</span>} /><KV k="geo 限制" v="CN/KP/IR 屏蔽(J2)" />
          {secondaryPaused
            ? <Btn style={{ width: "100%", justifyContent: "center", marginTop: 12 }} variant="primary" onClick={() => setMc({ name: "Genesis 二级市场 恢复开放", amplify: true, onApply: (reason) => { setParam("G.genesis.secondaryPaused", "false", { action: "Genesis 二级市场恢复开放", reason }); setToast("Genesis 二级市场已恢复开放"); } })}><Icon name="power" size={15} /><AutoGloss>恢复二级市场</AutoGloss></Btn>
            : <Btn style={{ width: "100%", justifyContent: "center", marginTop: 12 }} variant="danger" onClick={() => setMc({ name: "Genesis 二级市场 紧急暂停", amplify: true, onApply: (reason) => { setParam("G.genesis.secondaryPaused", "true", { action: "Genesis 二级市场紧急暂停", reason }); setToast("Genesis 二级市场已暂停"); } })}><Icon name="power" size={15} /><AutoGloss>紧急 pause(Maker-Checker)</AutoGloss></Btn>}
        </Card>
      </div>}

      {tab === "G5" && <div className="grid g-3">
        <Card><CardH title="Premium 订阅" sub="$99 / P4 gate" right={<CodeTag>Premium</CodeTag>} />
          <KV k="月价" v={(() => { const v = pget("G.premium.price") ?? "$99"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "Premium 月价调整", op: "param", paramKey: "G.premium.price", paramVal: v })}>调整</Btn></span>; })()} /><KV k="首月折扣" v="50%" /><KV k="解锁" v="P4(月 7+)" /><KV k="kill" v={<Badge tone="ok">在线</Badge>} /></Card>
        <Card><CardH title={<AutoGloss>NEX v2 Founders Vault</AutoGloss>} sub="250% APY" right={<CodeTag tone="danger"><AutoGloss>已熔断</AutoGloss></CodeTag>} />
          <KV k="APY" v={<span className="mono">250%</span>} /><KV k="锁期" v="24 月(P6)" /><KV k="最低额" v={<span className="mono">1,000 NEX</span>} />
          <Btn style={{ width: "100%", justifyContent: "center", marginTop: 10 }} variant="primary" onClick={() => nav("J")}>前往「紧急与合规」恢复 →</Btn></Card>
        <Card><CardH title={<AutoGloss>复投激励</AutoGloss>} sub="积分 / Genesis 券" right={<CodeTag><AutoGloss>复投激励</AutoGloss></CodeTag>} />
          <KV k="锁仓 APY" v={(() => { const v = pget("G.repurchase.apy") ?? "35%"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "复投锁仓 APY 调整", amplify: true, op: "param", paramKey: "G.repurchase.apy", paramVal: v })}>调整</Btn></span>; })()} /><KV k="积分倍率" v={(() => { const v = pget("G.repurchase.points") ?? "1.5×"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "复投积分倍率调整", op: "param", paramKey: "G.repurchase.points", paramVal: v })}>调整</Btn></span>; })()} /><KV k="培育奖倍率" v={(() => { const v = pget("G.repurchase.nurture") ?? "2×"; return <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{v}</span><Btn sm onClick={() => setMc({ name: "复投培育奖倍率调整", amplify: true, op: "param", paramKey: "G.repurchase.nurture", paramVal: v })}>调整</Btn></span>; })()} /><KV k="Genesis 抽奖券" v="每 $1k 1 张" /></Card>
      </div>}

      {mc && <MakerCheckerModal action={mc.name} detail="server-canonical · kill/pause 经 J 域编排 · 解除放大流出闸须核验 B1" amplifies={!!mc.amplify} edit={mc.op === "param" ? { current: mc.paramVal } : undefined} onClose={() => setMc(null)} onConfirm={(reason, newVal) => {
        if (mc.op === "param" && mc.paramKey) { setParam(mc.paramKey, (newVal ?? "").trim(), { action: mc.name, reason }); setToast(mc.name + " 已生效 · server-canonical"); }
        else if (mc.onApply) { mc.onApply(reason); }
        else { setToast("已提交复核"); }
        setMc(null);
      }} />}
      {toastNode}
    </div>
  );
}
