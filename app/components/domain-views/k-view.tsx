"use client";

/**
 * K 风控与反作弊 — 设计稿内容视图(从 page-users-risk.jsx 移植)。
 * 标签:K2 套利&刷量检测 / K3 提现风控规则引擎 / K4 风险评分模型 / K5 大额 KYC 复审 / K1 反多账户引擎。
 * 路由 l2.id 折叠:各 l2.id 映射到自身 Tab。default = K2(套利&刷量)。
 */
import { useState } from "react";
import { Icon, Card, CardH, CodeTag, Badge, Btn, Meter, MakerCheckerModal, useToast } from "./design-kit";
import { AutoGloss, Gloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { CLUSTERS } from "@/lib/mock/admin/design-data";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

const riskBadge = (s: number) => (s >= 70 ? "err" : s >= 40 ? "warn" : "ok");

// [ruleKey, 名称, 默认规则文案, 色调] — ruleKey 稳定 ASCII,作 K.rule.${ruleKey} 落键(中文不入键路径)。
const WD_RULES: [string, string, string, string][] = [
  ["amount", "金额阈值", ">$1,000 → 转人工", "err"],
  ["velocity", "速度规则", "24h 内 ≥3 笔 → delay", "warn"],
  ["newAccount", "新账户", "注册 <7d + 大额 → freeze", "warn"],
  ["addressRep", "地址信誉", "黑地址命中 → freeze", "err"],
];
const WD_ROUTES: [string, number, string][] = [
  ["自动放行", 71, "var(--success)"],
  ["delay 24h", 14, "var(--warning)"],
  ["转人工", 9, "var(--brand)"],
  ["freeze", 6, "var(--danger)"],
];
// [dimKey, 维度名, 默认权重%] — dimKey 稳定 ASCII,作 K.score.weight.${dimKey} 落键。
const SCORE_FACTORS: [string, string, number][] = [
  ["multiAccount", "K1 多账户命中", 25],
  ["arbitrage", "K2 套利信号", 22],
  ["kycState", "C4 KYC 态", 18],
  ["withdrawSpeed", "提现速度", 15],
  ["accountAge", "账户年龄", 12],
  ["anomaly", "异常行为", 8],
];
const MULTI_DIMS: [string, number, string][] = [
  ["IP 维度", 34, "同 IP 段聚集"],
  ["设备指纹", 41, "同 fingerprint"],
  ["支付工具", 13, "同卡 BIN/钱包"],
];
const RW_TICKETS: [string, string, string, string, string, string, string][] = [
  ["RW-3081", "usr_31E8", "大额提现", "$12,500", "月累计 $48k", "待复审", "warn"],
  ["RW-3079", "usr_55B1", "大额兑换", "$10,200", "单笔超阈值", "待复审", "warn"],
  ["RW-3075", "usr_02A9", "累计阈值命中", "$8,800", "30d 累计 $26k", "复审中", "info"],
  ["RW-3070", "usr_84F2", "大额提现", "$4,200", "—", "已通过 → C4", "ok"],
];

const FOLD: Record<string, string> = { K1: "K1", K2: "K2", K3: "K3", K4: "K4", K5: "K5" };
const cmap: Record<string, string> = { 待处置: "warn", 监控中: "info", 已冻结: "err" };
// 页头「新建规则」按 Tab 对应不同规则实体;K4 评分模型 / K5 KYC 复审无「新建规则」语义。
// writeKind:"rule" → 新建即真写 K.rule.new.${目标新值}(仅 K3 在本批接真写,K1/K2 规则实体创建超出本次范围,保留留痕 toast)。
const K_CREATE: Record<string, { label: string; detail: string; writeKind?: "rule" } | null> = {
  K1: { label: "新建反多账户规则", detail: "新增一条反多账户规则(IP / 设备指纹 / 支付工具 维度 + 命中动作)· 提交后双人复核生效" },
  K2: { label: "新建套利检测规则", detail: "新增一条套利 / 刷量检测规则(行为链路阈值 + 命中动作)· 提交后双人复核生效" },
  K3: { label: "新建提现风控规则", detail: "新增一条提现风控规则(输入规则名 / 阈值表达式作目标新值,阈值 / 速率 / 命中动作)· 写入 admin.withdraw_rule_created · 提交后双人复核生效", writeKind: "rule" },
  K4: null,
  K5: null,
};

type ClusterRow = (typeof CLUSTERS)[number];
// write:真写落点(读复核理由 + 配置型调整的目标新值后调 setParam),缺省时退化为留痕 toast(非处置类动作,如「新建规则」)。
type Mc = { action: string; detail: string; amplifies?: boolean; write?: (reason: string, newVal?: string) => void };

// 处置态 → 徽标文案 / 色调(K1 关联簇 · K2 套利事件 · K5 KYC 复审)。
const CLUSTER_DISPOSITION: Record<string, { label: string; tone: string }> = {
  confirmed: { label: "已确认关联", tone: "info" },
  released: { label: "已解除关联", tone: "ok" },
  banned: { label: "已封禁全簇", tone: "err" },
};
const ARB_VERDICT: Record<string, { label: string; tone: string }> = {
  violation: { label: "已确认违规", tone: "err" },
  falsePositive: { label: "已标记误报", tone: "ok" },
  frozen: { label: "已批量冻结", tone: "err" },
};
const KYC_RESULT: Record<string, { label: string; tone: string }> = {
  passed: { label: "复审通过 → C4", tone: "ok" },
  rejected: { label: "已驳回 → 暂缓提现", tone: "err" },
  supplement: { label: "已要求补件", tone: "warn" },
};

export function KDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "K2");
  const [mc, setMc] = useState<Mc | null>(null);
  // 真写落点:风控处置统一进 platform-config-store(setParam keyed 状态 + A2 审计),persist + 水合门 → 即时反映 + 刷新不丢。
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  const onMcConfirm = (reason: string, newValue?: string) => {
    if (mc?.write) mc.write(reason, newValue);
    else setToast("已提交复核(A2 留痕)");
    setMc(null);
  };

  return (
    <div className="dkpage">
      <DomainHeader {...meta} right={K_CREATE[tab] ? <Btn variant="primary" onClick={() => setMc({ action: K_CREATE[tab]!.label, detail: K_CREATE[tab]!.detail, amplifies: K_CREATE[tab]!.writeKind === "rule", write: K_CREATE[tab]!.writeKind === "rule" ? (reason, newVal) => { if (!newVal) return; setParam(`K.rule.new.${newVal}`, "启用", { action: `新建提现风控规则 ${newVal}`, reason }); setToast(`已新建提现风控规则「${newVal}」`); } : undefined })}><Icon name="plus" size={15} /> {K_CREATE[tab]!.label}</Btn> : undefined} />

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny">高风险账户(≥70)</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--danger)" }} className="tnum">342</div><div className="muted tiny">K4 评分</div></Card>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny"><AutoGloss>套利簇(待处置)</AutoGloss></div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--warning)" }} className="tnum">{CLUSTERS.filter((c) => c.status === "待处置").length}</div><div className="muted tiny">K2</div></Card>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny">多账户簇</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)" }} className="tnum">88</div><div className="muted tiny">K1 三维去重</div></Card>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny">大额复审工单</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)" }} className="tnum">7</div><div className="muted tiny">K5</div></Card>
      </div>

      {tab === "K2" && (
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">套利与刷量检测</span><CodeTag title="闭环行为链路">套利/刷量检测</CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>簇 ID</th><th>类型</th><th className="num">账户数</th><th>命中信号</th><th>评分</th><th>状态</th><th /></tr></thead>
            <tbody>{CLUSTERS.map((c) => { const verdict = pget(`K.arb.${c.id}.verdict`); const vMeta = verdict ? ARB_VERDICT[verdict] : undefined; return (
              <tr key={c.id} style={vMeta ? { opacity: 0.62 } : undefined}><td className="mono t-strong">{c.id}</td><td>{c.type}</td><td className="num tnum">{c.accounts}</td>
                <td className="t-mut tiny">{c.signal}</td><td><Badge tone={riskBadge(c.score)}>{c.score}</Badge></td>
                <td><Badge tone={vMeta ? vMeta.tone : cmap[c.status]}>{vMeta ? vMeta.label : c.status}</Badge></td>
                <td>{vMeta ? <span className="muted tiny">已处置</span> : <span className="row" style={{ gap: 6 }}>
                  <Btn sm variant="danger" onClick={() => setMc({ action: `确认违规:${c.id}`, detail: `${c.accounts} 账户 · ${c.signal} · 判定套利/刷量违规,纳入处置名单 · 写入 admin.arb_violation_confirmed`, amplifies: true, write: (reason) => { setParam(`K.arb.${c.id}.verdict`, "violation", { action: `确认违规 ${c.id}`, reason }); setToast(`事件 ${c.id} 已确认违规`); } })}>确认违规</Btn>
                  <Btn sm onClick={() => setMc({ action: `标记误报:${c.id}`, detail: `${c.accounts} 账户 · 判定为误报,撤出处置队列 · 写入 admin.arb_false_positive`, write: (reason) => { setParam(`K.arb.${c.id}.verdict`, "falsePositive", { action: `标记误报 ${c.id}`, reason }); setToast(`事件 ${c.id} 已标记误报`); } })}>标记误报</Btn>
                  <Btn sm onClick={() => setMc({ action: `批量冻结:${c.id}`, detail: `${c.accounts} 账户 · 批量冻结整簇 → 联动 C2 · 写入 admin.arb_frozen`, amplifies: true, write: (reason) => { setParam(`K.arb.${c.id}.verdict`, "frozen", { action: `批量冻结 ${c.id}`, reason }); setToast(`事件 ${c.id} 已批量冻结(联动 C2)`); } })}>批量冻结</Btn>
                </span>}</td></tr>
            ); })}</tbody>
          </table></div>
        </Card>
      )}

      {tab === "K3" && (
        <div className="grid g-2">
          <Card>
            <CardH title="提现风控规则引擎" sub="四维 → 路由" right={<CodeTag>提现风控规则</CodeTag>} />
            {WD_RULES.map(([rk, n, d, t]) => { const cur = pget(`K.rule.${rk}`); const eff = cur ?? d; return (
              <div key={rk} className="tint" style={{ marginBottom: 8 }}>
                <div className="row"><b style={{ fontSize: 13 }}>{n}</b><div className="spacer" /><Badge tone={cur ? "info" : t}>{cur ? "已调整" : "启用"}</Badge>
                  <span style={{ marginLeft: 8 }}><Btn sm onClick={() => setMc({ action: `调整提现风控规则:${n}`, detail: `当前「${eff}」· 调整阈值/速率后对新提现生效 · 放宽方向放大资金流出,须先核验 B1 覆盖率 · 写入 admin.withdraw_rule_adjusted`, amplifies: true, write: (reason, newVal) => { if (!newVal) return; setParam(`K.rule.${rk}`, newVal, { action: `调整提现风控规则 ${n}`, reason }); setToast(`提现风控规则「${n}」已更新阈值`); } })}>调整</Btn></span>
                </div>
                <div className="muted tiny" style={{ marginTop: 3 }}>{eff}{cur ? <span className="t-mut"> · 原 {d}</span> : null}</div>
              </div>
            ); })}
          </Card>
          <Card>
            <CardH title="路由结论分布" sub="近 24h" />
            {WD_ROUTES.map(([n, p, c]) => (
              <div key={n} style={{ marginBottom: 13 }}><div className="row tiny" style={{ marginBottom: 4 }}><span>{n}</span><div className="spacer" /><span className="mono">{p}%</span></div><Meter pct={p} color={c} /></div>
            ))}
          </Card>
        </div>
      )}

      {tab === "K4" && (
        <Card>
          <CardH title="风险评分模型" sub="统一风险分口径 · 用户画像/提现审核/风险雷达共用" right={<CodeTag title="全平台风险分唯一权威源">风险分来源</CodeTag>} />
          <div className="grid g-2" style={{ gap: 16 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>评分因子权重</div>
              {SCORE_FACTORS.map(([dk, n, w]) => { const cur = pget(`K.score.weight.${dk}`); const eff = cur != null ? Number(cur) : w; const effPct = Number.isFinite(eff) ? eff : w; return (
                <div key={dk} style={{ marginBottom: 11 }}><div className="row tiny" style={{ marginBottom: 4 }}><span>{n}</span><div className="spacer" /><span className="mono">{effPct}%{cur != null ? <span className="t-mut"> · 原 {w}%</span> : null}</span><Btn sm onClick={() => setMc({ action: `调整风险评分权重:${n}`, detail: `当前权重 ${effPct}% · 调整后立即重算全平台风险分(K4 唯一权威源,联动用户画像 / 提现审核 / 风险雷达)· 写入 admin.risk_weight_adjusted`, amplifies: true, write: (reason, newVal) => { if (!newVal) return; setParam(`K.score.weight.${dk}`, newVal, { action: `调整风险评分权重 ${n}`, reason }); setToast(`风险评分权重「${n}」已更新 → 触发全平台重算`); } })}>调整权重</Btn></div><Meter pct={effPct} color="var(--brand)" /></div>
              ); })}
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>分数段分布</div>
              <div className="tint success" style={{ marginBottom: 8 }}><div className="row"><span>0–39 低风险</span><div className="spacer" /><b className="tnum">112,840</b></div></div>
              <div className="tint warn" style={{ marginBottom: 8 }}><div className="row"><span>40–69 中风险</span><div className="spacer" /><b className="tnum">15,218</b></div></div>
              <div className="tint danger"><div className="row"><span>70–100 高风险</span><div className="spacer" /><b className="tnum">342</b></div></div>
              <div className="tint cyan tiny" style={{ marginTop: 12 }}><AutoGloss>分数 server-authoritative,client 不可篡改 · risk.score_updated 事件喂 D2 路由</AutoGloss></div>
            </div>
          </div>
        </Card>
      )}

      {tab === "K5" && (
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">大额 KYC 复审 + 告警</span><CodeTag>大额 KYC 复审</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>复审仅触发,KYC 状态权威落 C4</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>工单</th><th>userId</th><th>触发类型</th><th className="num">触发金额</th><th>累计阈值</th><th>状态</th><th /></tr></thead>
            <tbody>{RW_TICKETS.map((r) => { const result = pget(`K.kyc.${r[0]}.result`); const rMeta = result ? KYC_RESULT[result] : undefined; const decided = !!rMeta; const escalated = pget(`K.kyc.${r[0]}.escalated`) === "true"; return (
              <tr key={r[0]} style={rMeta ? { opacity: 0.62 } : undefined}><td className="mono t-strong">{r[0]}</td><td className="mono t-mut">{r[1]}</td><td>{r[2]}</td>
                <td className="num t-strong tnum">{r[3]}</td><td className="tiny t-mut">{r[4]}</td>
                <td><Badge tone={rMeta ? rMeta.tone : r[6]}>{rMeta ? rMeta.label : r[5]}</Badge></td>
                <td>{decided ? <span className="muted tiny">已裁决</span> : r[6] !== "ok" && <span className="row" style={{ gap: 6 }}>
                  {escalated ? <Badge tone="info">已升级增强 KYC</Badge> : <Btn sm onClick={() => setMc({ action: `升级增强 KYC:${r[0]}`, detail: `${r[1]} · ${r[3]} · 升级为增强 KYC(K5)流程,要求更高等级证件与资金来源核验 · 写入 admin.kyc_escalated`, write: (reason) => { setParam(`K.kyc.${r[0]}.escalated`, "true", { action: `升级增强 KYC ${r[0]}`, reason }); setToast(`已升级增强 KYC ${r[0]}`); } })}>升级 <Gloss>KYC</Gloss></Btn>}
                  <Btn sm variant="primary" onClick={() => setMc({ action: `复审通过:${r[0]}`, detail: `${r[1]} · ${r[3]} · 复审通过 → 回写 C4 KYC 状态 · 写入 admin.kyc_review_passed`, write: (reason) => { setParam(`K.kyc.${r[0]}.result`, "passed", { action: `KYC 复审通过 ${r[0]}`, reason }); setToast(`复审通过 ${r[0]} → 回写 C4`); } })}>通过</Btn>
                  <Btn sm variant="danger" onClick={() => setMc({ action: `驳回复审:${r[0]}`, detail: `${r[1]} · ${r[3]} · 驳回 → 联动 K3 暂缓提现 + C 域账户限制 · 写入 admin.kyc_review_rejected`, amplifies: true, write: (reason) => { setParam(`K.kyc.${r[0]}.result`, "rejected", { action: `KYC 复审驳回 ${r[0]}`, reason }); setToast(`已驳回 ${r[0]} → 暂缓提现`); } })}>驳回</Btn>
                  <Btn sm onClick={() => setMc({ action: `要求补件:${r[0]}`, detail: `${r[1]} · ${r[3]} · 要求补充证件材料,超时自动转催办告警 · 写入 admin.kyc_review_supplement`, write: (reason) => { setParam(`K.kyc.${r[0]}.result`, "supplement", { action: `KYC 要求补件 ${r[0]}`, reason }); setToast(`已要求 ${r[0]} 补件`); } })}>要求补件</Btn>
                </span>}</td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>大额提现/兑换/累计阈值命中触发增强 KYC 复审 · 产出复审工单 + 异常告警(喂 B5 风险雷达)· 裁决回写 C4 KYC 状态</AutoGloss></div></div>
        </Card>
      )}

      {tab === "K1" && (
        <Card className="pad-0">
          <div style={{ padding: "0 18px" }}>
            <CardH title="反多账户引擎" sub="IP / 设备指纹 / 支付工具 三维去重" right={<CodeTag>反多账户</CodeTag>} />
            <div className="grid g-3" style={{ gap: 12, marginBottom: 16 }}>
              {MULTI_DIMS.map(([n, c, d]) => (
                <div key={n} className="tint"><div className="muted tiny"><AutoGloss>{n}</AutoGloss></div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)" }} className="tnum">{c}</div><div className="muted tiny"><AutoGloss>{d}</AutoGloss></div></div>
              ))}
            </div>
          </div>
          <div className="card-h" style={{ padding: "4px 18px 12px" }}><span className="ttl">关联簇 · 三维去重命中</span><CodeTag title="实体关联图谱">关联簇</CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>簇 ID</th><th>关联类型</th><th className="num">账户数</th><th>命中信号</th><th>评分</th><th>状态</th><th /></tr></thead>
            <tbody>{(CLUSTERS as ReadonlyArray<ClusterRow>).map((c) => { const disp = pget(`K.cluster.${c.id}.disposition`); const dispMeta = disp ? CLUSTER_DISPOSITION[disp] : undefined; return (
              <tr key={c.id} style={dispMeta ? { opacity: 0.62 } : undefined}><td className="mono t-strong">{c.id}</td><td>{c.type}</td><td className="num tnum">{c.accounts}</td>
                <td className="t-mut tiny">{c.signal}</td><td><Badge tone={riskBadge(c.score)}>{c.score}</Badge></td>
                <td><Badge tone={dispMeta ? dispMeta.tone : cmap[c.status]}>{dispMeta ? dispMeta.label : c.status}</Badge></td>
                <td>{dispMeta ? <span className="muted tiny">已处置</span> : <span className="row" style={{ gap: 6 }}>
                  <Btn sm onClick={() => setMc({ action: `确认关联:${c.id}`, detail: `${c.accounts} 账户 · ${c.signal} · 维持关联实体判定,纳入去重名单 · 写入 admin.cluster_link_confirmed`, write: (reason) => { setParam(`K.cluster.${c.id}.disposition`, "confirmed", { action: `确认关联 ${c.id}`, reason }); setToast(`关联簇 ${c.id} 已确认关联`); } })}>确认关联</Btn>
                  <Btn sm onClick={() => setMc({ action: `解除关联:${c.id}`, detail: `${c.accounts} 账户 · 解除关联实体判定 → 退出去重名单 · 写入 admin.cluster_link_released`, amplifies: true, write: (reason) => { setParam(`K.cluster.${c.id}.disposition`, "released", { action: `解除关联 ${c.id}`, reason }); setToast(`关联簇 ${c.id} 已解除关联`); } })}>解除关联</Btn>
                  <Btn sm variant="danger" onClick={() => setMc({ action: `封禁全簇:${c.id}`, detail: `${c.accounts} 账户 · 批量冻结整簇 → 联动 C2 · 写入 admin.cluster_banned`, amplifies: true, write: (reason) => { setParam(`K.cluster.${c.id}.disposition`, "banned", { action: `封禁全簇 ${c.id}`, reason }); setToast(`关联簇 ${c.id} 已封禁全簇(联动 C2)`); } })}>封禁全簇</Btn>
                </span>}</td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "12px 18px 16px" }}><div className="tint brand tiny"><AutoGloss>注册与 sponsor-bind 入口 server-side 阻断重复实体 · IP 维度白名单权威归 K1(账户级名单归 C2)</AutoGloss></div></div>
        </Card>
      )}

      {mc && <MakerCheckerModal action={mc.action} detail={mc.detail} amplifies={mc.amplifies} onClose={() => setMc(null)} onConfirm={(reason, newValue) => onMcConfirm(reason, newValue)} />}
      {toastNode}
    </div>
  );
}
