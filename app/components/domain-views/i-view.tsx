"use client";

/**
 * I 内容与合规 CMS — 设计稿 Content 内容视图(从 page-breadth.jsx 移植)。
 * 标签:I2 Nova 推送(默认)/ I1 转化文案 A/B / I3 通知 Campaign / I4 信任中心 / I5 风险披露 / I6 i18n 文案 / I7 教程中心。
 * 路由 l2.id 与设计稿 tab 一一对应(I1–I7)。
 *
 * 真写落点:全部内容发布 / 实验定版 / 启停 / 披露版本统一进 platform-config-store
 * (setParam keyed 状态 + append-only 审计),persist + 水合门(刷新保留)。派生值 `pget(key) ?? mock原态`。
 * 内容发布多是状态切换(发布/下架/胜出/停止)→ op:"status" 固定值;教程课程奖励是调参 → op:"param" 收 newVal。
 * 无「只改本地 useState / 仅 toast」的死控件。I 为内容域,运营语言保持中性(披露/合规文案不含套路词)。
 */
import { useState, useMemo, useEffect } from "react";
import { Icon, Card, CardH, CodeTag, Badge, Btn, Toggle, Drawer, MakerCheckerModal, useToast, type EditSpec } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { NOVA, fmtK } from "@/lib/mock/admin/design-data";
import { usePlatformConfig, type OpsNova } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { confirm } from "@/lib/store/ui";

// 统一复核动作描述:op=status → 内容发布/下架/胜出/停止/启停等固定值;op=param → 课程奖励调参(模态出「目标新值」输入)。
type Mc = {
  name: string;
  detail?: string;
  amplifies?: boolean;
  op: "status" | "param";
  paramKey: string;
  fixedVal?: string;   // status 类固定写入值(published/off/won/stopped/sent/active/archived/pending/true/false)
  current?: string;    // param 类回填到模态 spec.current
  unit?: string;       // 目标新值单位(可选)
  toast: string;       // 写入后 toast 文案
} | null;

const FOLD: Record<string, string> = { I1: "I1", I2: "I2", I3: "I3", I4: "I4", I5: "I5", I6: "I6", I7: "I7" };

let NOVA_SEQ = 100; // 客户端新增 Nova 通道 key 计数(SSR 安全)

// paramKey 用标题派生的 slug(稳定可读,避免 Date.now 等非确定值)。空标题回退 "untitled"。
const slug = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";

const TRUST_TIERS = ["合规", "超管"] as const;            // I4 复核级
const TUTORIAL_CATS = ["Basics", "Earn", "Team", "Wealth", "Security"] as const; // I7 分类
const CAMPAIGN_AUDIENCES = ["全部用户", "新用户(L0-L1)", "活跃持有者(L4+)", "休眠召回", "高净值"] as const; // I3 受众

type CopyRow = [string, string, string, string];
const COPY_ROWS: CopyRow[] = [
  ["home.conversionBanner", "v12", "EXP-204 (A/B/C)", "7.2%"],
  ["missedIncome", "v8", "—", "—"],
  ["store.upgradeNudge", "v5", "EXP-198 (A/B)", "5.8%"],
];
type NotifRow = [string, string, string];
const NOTIF_ROWS: NotifRow[] = [
  ["critical", "∞", "永不淘汰(合规 re-ack 不丢)"],
  ["high", "50", "tier 内 LIFO"],
  ["normal", "200", "通知中心上限"],
  ["low", "30", "24-48h TTL"],
];
type DisclosureRow = [string, string, string, string];
const DISCLOSURE_ROWS: DisclosureRow[] = [
  ["EU (MiCA)", "v4.2", "98.1%", "published"],
  ["US (FinCEN)", "v4.0", "96.4%", "published"],
  ["Global", "v3.9", "99.0%", "published"],
];
type TrustRow = [string, string, string, string];
const TRUST_ROWS: TrustRow[] = [
  ["Hero", "TVL $847M · Active nodes 287K", "合规", "published"],
  ["Q3 2026 financials", "MRR $4.87M +22% · audited by PwC", "超管", "published"],
  ["Leadership team", "5 行 C-suite · verified on LinkedIn", "超管", "published"],
  ["Compliance badges", "SOC2 / ISO27001 / GDPR / FinCEN MSB", "合规", "published"],
  ["Audits & reserves", "CertiK + Etherscan reserve proof", "合规", "published"],
  ["NEX backed by AI demand", "30% 手续费回购销毁 叙事", "合规", "published"],
  ["Investors", "a16z 领投 · Sequoia / Pantera 跟投 背书叙事(降决策门槛)", "超管", "published"],
];
type I18nRow = [string, number, string, string, string, string, string]; // ns, key数, en, zh, vi, 占位校验, 状态
const I18N_ROWS: I18nRow[] = [
  ["home.*", 128, "✓", "✓", "⚠ 译", "✓", "待补"],
  ["binaryHowItWorks.*", 30, "✓", "✓", "⚠ 译", "✓", "待补"],
  ["exchangeHowItWorks.*", 35, "✓", "✓", "⚠ 译", "✓", "待补"],
  ["premium.*", 18, "✓", "✓", "✗", "✓", "待补"],
  ["marketing.*", 64, "✓", "⚠ 3 漏译", "✗", "✓", "待补"],
  ["milestones.*", 7, "✓", "✓", "✗", "⚠ {n} 词序", "警告"],
];
type LearnCat = [string, number, string, string, boolean];
const LEARN_CATS: LearnCat[] = [
  ["Basics 🚀", 4, "What is Nexion · 5-min crash course", "+20", true],
  ["Earn ⚡", 4, "How compute earns · task pricing", "+30", false],
  ["Team 🧬", 2, "Influence network royalty explained", "+40", false],
  ["Wealth 💎", 2, "Staking & NEX vault strategy", "+50", false],
  ["Security 🛡", 3, "KYC-Express triggers / 2FA / Proof-of-Compute", "+30", false],
];

export function IDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "I2");
  const [mc, setMc] = useState<Mc>(null);
  // I3 通知 Campaign:名称 + 标题 + 正文 + tier/通道/受众 + 预算(可选)。
  const [addCampaign, setAddCampaign] = useState(false);
  const [campaignForm, setCampaignForm] = useState({ name: "", title: "", content: "", tier: "normal", channel: "in-app", audience: "全部用户", budget: "" });
  // I4 信任中心条目:section + 标题 + 正文 + 复核级。
  const [addTrust, setAddTrust] = useState(false);
  const [trustForm, setTrustForm] = useState({ section: "", title: "", content: "", tier: "合规" });
  // I7 教程:标题 + 分类 + 正文 + 完成奖励(NEX/课)。
  const [addTutorial, setAddTutorial] = useState(false);
  const [tutorialForm, setTutorialForm] = useState({ title: "", category: "Basics", content: "", reward: "" });

  // ── 平台级配置真写(keyed + 审计 + persist)· I 域全部内容发布/实验/披露动作落此 ──
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  const logAudit = usePlatformConfig((s) => s.logAudit);

  // I2 Nova 通道:真增删改查(平台级 persist)+ kill 启停 + append-only 审计。
  const seedNovas = useMemo<OpsNova[]>(() => NOVA as OpsNova[], []);
  const ensureNovas = usePlatformConfig((s) => s.ensureNovas);
  const storeNovas = usePlatformConfig((s) => s.novas);
  const addNovaStore = usePlatformConfig((s) => s.addNova);
  const updateNovaStore = usePlatformConfig((s) => s.updateNova);
  const removeNovaStore = usePlatformConfig((s) => s.removeNova);
  useEffect(() => { if (hydrated) ensureNovas(seedNovas); }, [hydrated, seedNovas, ensureNovas]);
  const novas = hydrated && storeNovas ? storeNovas : seedNovas;
  const [novaDrawer, setNovaDrawer] = useState(false);
  const [editNovaKey, setEditNovaKey] = useState<string | null>(null);
  const [novaForm, setNovaForm] = useState({ name: "", tick: "", cd: "", ctr: "" });
  const openAddNova = () => { setNovaForm({ name: "", tick: "", cd: "", ctr: "" }); setEditNovaKey(null); setNovaDrawer(true); };
  const openEditNova = (n: OpsNova) => { setNovaForm({ name: n.name, tick: n.tick, cd: n.cd, ctr: String(n.ctr) }); setEditNovaKey(n.key); setNovaDrawer(true); };
  const submitNova = () => {
    if (!novaForm.name.trim()) { setToast("请填写通道名"); return; }
    const ex = editNovaKey ? novas.find((x) => x.key === editNovaKey) : undefined;
    const n: OpsNova = { key: editNovaKey ?? (slug(novaForm.name) + "-" + ++NOVA_SEQ), name: novaForm.name.trim(), tick: novaForm.tick.trim() || "—", cd: novaForm.cd.trim() || "—", ctr: Number(novaForm.ctr) || 0, on: ex?.on ?? true };
    if (editNovaKey) { updateNovaStore(editNovaKey, n); logAudit({ actor: "总管理员", action: "编辑 Nova 通道 " + n.name, target: n.key }); setToast("Nova 通道已更新:" + n.name); }
    else { addNovaStore(n); logAudit({ actor: "总管理员", action: "新增 Nova 通道 " + n.name, target: n.key }); setToast("Nova 通道已新增:" + n.name); }
    setNovaDrawer(false); setEditNovaKey(null);
  };
  const delNova = async (n: OpsNova) => { const ok = await confirm({ title: "删除推送通道?", message: `删除「${n.name}」:从 Nova cadence 移除并停止投递。需审计留痕。`, confirmLabel: "确认删除", danger: true }); if (ok) { removeNovaStore(n.key); logAudit({ actor: "总管理员", action: "删除 Nova 通道 " + n.name, target: n.key }); setToast("Nova 通道已删除:" + n.name); } };
  const toggleNova = (n: OpsNova) => { updateNovaStore(n.key, { on: !n.on }); logAudit({ actor: "总管理员", action: (n.on ? "kill" : "恢复") + " Nova 通道 " + n.name, target: n.key, after: String(!n.on) }); setToast(n.name + " 通道" + (n.on ? "已 kill" : "已恢复")); };

  // 派生状态读取(无写入则回退 mock 原态)
  const abStatus = (id: string): string | undefined => pget(`I.ab.${id}.status`);          // won / stopped
  const trustStatus = (id: string, fallback: string): string => pget(`I.trust.${id}.status`) ?? fallback;       // published / off
  const disclosureStatus = (id: string, fallback: string): string => pget(`I.disclosure.${id}.status`) ?? fallback; // active / archived(原态 published 视为在用)
  const i18nStatus = (key: string, fallback: string): string => pget(`I.i18n.${key}.status`) ?? fallback;       // published / 原态
  const tutorialStatus = (id: string, fallback: string): string => pget(`I.tutorial.${id}.status`) ?? fallback; // published / off
  const tutorialReward = (id: string, fallback: string): string => pget(`I.tutorial.${id}.reward`) ?? fallback; // NEX/课 调参

  return (
    <div className="dkpage">
      <DomainHeader {...meta} />

      {tab === "I2" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">Nova 推送运营 · {novas.length} channel cadence</span><CodeTag tone="cyan" title="考核指标:点击率 >25%">推送点击率 &gt;25%</CodeTag><Btn sm variant="primary" style={{ marginLeft: "auto" }} onClick={openAddNova}><Icon name="plus" size={14} /> 新增通道</Btn></div>
        <div style={{ padding: "0 18px 10px" }}><div className="tint cyan tiny"><AutoGloss>通道增删改 + kill 启停 server 权威 · client 仅渲染当前态 · 真写 persist + append-only 审计</AutoGloss></div></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>channel</th><th>tick</th><th>cooldown</th><th>CTR</th><th>状态</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
          <tbody>{novas.map((n) => (
            <tr key={n.key} style={{ background: n.on ? "" : "var(--danger-soft)" }}><td className="mono t-strong">{n.name}</td>
              <td className="mono tiny">{n.tick}</td><td className="mono tiny">{n.cd}</td>
              <td><Badge tone={n.ctr >= 25 ? "ok" : "warn"}>{n.ctr}%</Badge></td>
              <td><Badge tone={n.on ? "ok" : "neutral"}>{n.on ? "投递中" : "已 kill"}</Badge></td>
              <td><span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                <Toggle on={n.on} danger onClick={() => toggleNova(n)} />
                <Btn sm onClick={() => openEditNova(n)}>编辑</Btn>
                <Btn sm onClick={() => delNova(n)}>删除</Btn>
              </span></td></tr>
          ))}</tbody>
        </table></div>
      </Card>}

      {tab === "I1" && <Card><CardH title="转化文案 A/B" sub="ConversionBanner / MissedIncome" right={<CodeTag>转化文案</CodeTag>} />
        <table className="tbl"><thead><tr><th>文案位</th><th>当前版本</th><th>进行中实验</th><th>CVR(获胜变体)</th><th>状态</th><th /></tr></thead>
          <tbody>{COPY_ROWS.map(([k, v, e, c]) => { const st = abStatus(k); return (
            <tr key={k}><td className="mono">{k}</td><td><CodeTag tone="electric">{v}</CodeTag></td><td className="tiny">{e}</td><td className="mono">{c}</td>
              <td>{st === "won" ? <Badge tone="ok">已定版</Badge> : st === "stopped" ? <Badge tone="neutral">已停止</Badge> : e !== "—" ? <Badge tone="info">运行中</Badge> : <span className="t-mut tiny">—</span>}</td>
              <td>{e !== "—" && !st && <span className="row" style={{ gap: 6 }}>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.ab.${k}.status`, fixedVal: "won", name: "设为胜出变体:" + k, detail: "实验 " + e + " 获胜变体定版发布 · server 权威分组 · client 仅渲染当前版", toast: k + " 获胜变体已定版" })}>设为胜出</Btn>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.ab.${k}.status`, fixedVal: "stopped", name: "停止实验:" + k, detail: "终止 " + e + " · 全量回退至基线变体 " + v + " · 曝光/转化停止喂 B3 漏斗", toast: k + " 实验已停止" })}>停止实验</Btn>
              </span>}</td></tr>
          ); })}</tbody></table>
        <div className="tint cyan tiny" style={{ marginTop: 10 }}><AutoGloss>A/B 分组 server 权威 · 曝光/转化喂 B3 漏斗 L3→L4</AutoGloss></div>
      </Card>}

      {tab === "I3" && <Card><CardH title="通知 Campaign · 优先级 CAP" sub="4 档保留策略" right={<Btn variant="primary" sm onClick={() => { setCampaignForm({ name: "", title: "", content: "", tier: "normal", channel: "in-app", audience: "全部用户", budget: "" }); setAddCampaign(true); }}><Icon name="plus" size={14} /> 新建 Campaign</Btn>} />
        <table className="tbl"><thead><tr><th>tier</th><th>CAP</th><th>淘汰规则</th><th>队列状态</th><th /></tr></thead>
          <tbody>{NOTIF_ROWS.map(([t, c, r]) => { const st = pget(`I.campaign.tier.${t}.status`); return (
            <tr key={t}><td><Badge tone={t === "critical" ? "err" : t === "high" ? "warn" : "neutral"}>{t}</Badge></td><td className="mono t-strong">{c}</td><td className="t-mut tiny"><AutoGloss>{r}</AutoGloss></td>
              <td>{st === "sent" ? <Badge tone="ok">已发送</Badge> : st === "stopped" ? <Badge tone="neutral">已停发</Badge> : <span className="t-mut tiny">就绪</span>}</td>
              <td><span className="row" style={{ gap: 6 }}>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.campaign.tier.${t}.status`, fixedVal: "sent", name: "发送 Campaign(" + t + " tier)", detail: "按 " + t + " 优先级入队 · CAP " + c + " · 淘汰规则:" + r, toast: t + " tier Campaign 已发送" })}>发送</Btn>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.campaign.tier.${t}.status`, fixedVal: "stopped", name: "停发 Campaign(" + t + " tier)", detail: "停止 " + t + " tier 待发队列投递 · 已投递不撤回", toast: t + " tier Campaign 已停发" })}>停发</Btn>
              </span></td></tr>
          ); })}</tbody></table></Card>}

      {tab === "I5" && <Card><CardH title="风险披露版本管理" sub="version × jurisdiction 双维 re-ack" right={<CodeTag tone="danger" title="纯风控审批">高敏·风控审批</CodeTag>} />
        <table className="tbl"><thead><tr><th>辖区</th><th>当前版本</th><th>re-ack 率</th><th>状态</th><th /></tr></thead>
          <tbody>{DISCLOSURE_ROWS.map(([j, v, r]) => { const st = disclosureStatus(j, "active"); const archived = st === "archived"; return (
            <tr key={j} style={archived ? { opacity: 0.55 } : undefined}><td className="t-strong">{j}</td><td><CodeTag tone="electric">{v}</CodeTag></td><td className="mono">{r}</td><td><Badge tone={archived ? "neutral" : "ok"}>{archived ? "archived" : "active"}</Badge></td>
              <td><span className="row" style={{ gap: 6 }}>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.disclosure.${j}.status`, fixedVal: "active", name: "发布新版披露:" + j, detail: "辖区 " + j + " · 当前 " + v + " · 触发 critical re-ack 通知(I3 通道)· Maker/Checker = 风控 lead / 超管", toast: j + " 披露新版已发布" })}>发布新版</Btn>
                {!archived && <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.disclosure.${j}.status`, fixedVal: "archived", name: "归档披露版本:" + j, detail: "辖区 " + j + " " + v + " 转历史归档 · re-ack 记录保留 · 不影响在用版本", toast: j + " 披露版本已归档" })}>归档</Btn>}
              </span></td></tr>
          ); })}</tbody></table>
        <div className="tint warn tiny" style={{ marginTop: 10 }}><AutoGloss>改版触发 critical re-ack 通知(I3 通道)· Maker/Checker = 风控 lead / 超管</AutoGloss></div>
      </Card>}

      {tab === "I4" && <div className="grid g-2">
        <Card className="span-2"><CardH title="信任中心 CMS" sub="/trust · 14 section · 财报数字 / leadership / NEX 叙事 / 徽章" right={<span className="row" style={{ gap: 8 }}><CodeTag tone="danger">高敏合规</CodeTag><Btn variant="primary" sm onClick={() => { setTrustForm({ section: "", title: "", content: "", tier: "合规" }); setAddTrust(true); }}><Icon name="plus" size={14} /> 新增条目</Btn></span>} />
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>section</th><th>当前内容</th><th>复核级</th><th>状态</th><th /></tr></thead>
            <tbody>{TRUST_ROWS.map((r) => { const st = trustStatus(r[0], r[3]); const off = st === "off"; const sup = r[2] === "超管"; return (
              <tr key={r[0]} style={off ? { opacity: 0.55 } : undefined}><td className="t-strong">{r[0]}</td><td className="tiny t-mut">{r[1]}</td><td><CodeTag tone={sup ? "danger" : ""}>{r[2]}</CodeTag></td><td><Badge tone={off ? "neutral" : "ok"}>{off ? "已下架" : "published"}</Badge></td>
                <td><span className="row" style={{ gap: 6 }}>
                  <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.trust.${r[0]}.status`, fixedVal: "published", name: "信任中心改版:" + r[0], detail: "section「" + r[0] + "」内容改版定版 · 复核级 " + r[2] + " · 通过后对用户可见", amplifies: sup, toast: r[0] + " 已发布至 /trust" })}>编辑</Btn>
                  <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.trust.${r[0]}.status`, fixedVal: "published", name: "发布:" + r[0], detail: "section「" + r[0] + "」当前内容定版发布至 /trust · 复核级 " + r[2], amplifies: sup, toast: r[0] + " 已发布至 /trust" })}>发布</Btn>
                  {!off && <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.trust.${r[0]}.status`, fixedVal: "off", name: "下架:" + r[0], detail: "section「" + r[0] + "」从 /trust 撤下 · 不删除内容 · 复核级 " + r[2], amplifies: sup, toast: r[0] + " 已从 /trust 下架" })}>下架</Btn>}
                </span></td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "12px 0 0" }}><div className="tint warn tiny"><AutoGloss>财务数字 / 储备证明为高敏合规内容 · Checker 升至合规/超管级 · 与用户侧 102.4% 超额抵押叙事一致(B1 内部口径独立)</AutoGloss></div></div>
        </Card>
      </div>}

      {tab === "I6" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">i18n 文案管理</span><CodeTag title="en/zh/vi 三语镜像">三语文案</CodeTag><div className="spacer" /><span className="muted tiny">vi 越南语翻译中 · 占位符三语一致性校验</span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>namespace</th><th className="num">key 数</th><th>en</th><th>zh</th><th>vi</th><th>占位符校验</th><th>状态</th><th /></tr></thead>
          <tbody>{I18N_ROWS.map((r) => { const st = i18nStatus(r[0], r[6]); const published = st === "published"; return (
            <tr key={r[0]}><td className="mono t-strong">{r[0]}</td><td className="num tnum">{r[1]}</td><td>{r[2]}</td><td className="tiny">{r[3]}</td><td className="tiny">{r[4]}</td>
              <td className="tiny">{r[5]}</td><td><Badge tone={published ? "ok" : st === "同步" ? "ok" : st === "警告" ? "warn" : "info"}>{published ? "已发布" : st}</Badge></td>
              <td><span className="row" style={{ gap: 6 }}>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.i18n.${r[0]}.status`, fixedVal: "published", name: "补全文案:" + r[0], detail: "namespace " + r[0] + " · 补齐 en/zh 缺失 key · 占位符两语言一致性校验后入待发布", toast: r[0] + " 文案已补全发布" })}>补全</Btn>
                <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.i18n.${r[0]}.status`, fixedVal: "published", name: "发布文案:" + r[0], detail: "namespace " + r[0] + " 双语镜像定版发布 · 占位符校验通过 · 与 I1 文案联动", toast: r[0] + " 文案已发布" })}>发布</Btn>
              </span></td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint cyan tiny">en/zh/vi 三语镜像(vi 为越南独营新增 · 翻译中)· 占位符 {"{n}"} {"{amount}"} 三语一致 · 改文案须保证三语同步(与 I1 联动)</div></div>
      </Card>}

      {tab === "I7" && <>
        <div className="grid g-4" style={{ marginBottom: 16 }}>
          {([["总课程", "15", "4-10 分钟"], ["完成奖励", "10-50", "NEX/课"], ["Learn-to-Earn 月发放", fmtK(86000), "NEX"], ["完成率", "42%", "均值"]] as [string, string, string][]).map(([k, v, s]) => (
            <Card key={k} style={{ padding: "15px 16px" }}><div className="muted tiny">{k}</div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)" }} className="tnum">{v}</div><div className="muted tiny">{s}</div></Card>
          ))}
        </div>
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">教程中心 · 6 分类 / 15 课</span><CodeTag title="/learn">教程中心</CodeTag><div className="spacer" /><Btn variant="primary" sm onClick={() => { setTutorialForm({ title: "", category: "Basics", content: "", reward: "" }); setAddTutorial(true); }}><Icon name="plus" size={14} /> 新建教程</Btn></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>分类</th><th className="num">课数</th><th>示例课程</th><th className="num">NEX 奖励</th><th>状态</th><th /></tr></thead>
            <tbody>{LEARN_CATS.map((r) => { const st = tutorialStatus(r[0], "published"); const off = st === "off"; const reward = tutorialReward(r[0], r[3]); return (
              <tr key={r[0]} style={off ? { opacity: 0.55 } : undefined}><td className="t-strong">{r[0]}</td><td className="num tnum">{r[1]}</td><td className="tiny t-mut">{r[2]}</td><td className="num mono" style={{ color: "var(--brand)" }}>{reward} NEX</td><td>{off ? <Badge tone="neutral">已下架</Badge> : r[4] ? <Badge tone="orange">FEATURED</Badge> : <Badge tone="ok">published</Badge>}</td>
                <td><span className="row" style={{ gap: 6 }}>
                  <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.tutorial.${r[0]}.status`, fixedVal: "published", name: "发布教程分类:" + r[0], detail: "分类「" + r[0] + "」" + r[1] + " 课定版发布至 /learn · 奖励 " + reward + " NEX/课 · 受 B1 红线约束", toast: r[0] + " 已发布至 /learn" })}>发布</Btn>
                  <Btn sm onClick={() => setMc({ op: "param", paramKey: `I.tutorial.${r[0]}.reward`, current: reward, unit: "NEX/课", amplifies: true, name: "课程奖励调整:" + r[0], detail: "分类「" + r[0] + "」完成 NEX 奖励调整 · 放大 NEX 流出 · 受 B1 兑付覆盖率红线约束", toast: r[0] + " 课程奖励已调整 · server-canonical" })}>调奖励</Btn>
                  {!off && <Btn sm onClick={() => setMc({ op: "status", paramKey: `I.tutorial.${r[0]}.status`, fixedVal: "off", name: "下架教程分类:" + r[0], detail: "分类「" + r[0] + "」从 /learn 撤下 · 停止发放完成奖励 · 不删除内容", toast: r[0] + " 已从 /learn 下架" })}>下架</Btn>}
                </span></td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>课程完成 NEX 奖励放大 NEX 流出 · 受 B1 兑付覆盖率红线约束</AutoGloss></div></div>
        </Card>
      </>}

      {novaDrawer && <Drawer title={editNovaKey ? "编辑推送通道" : "新增推送通道"} sub={<AutoGloss>Nova cadence 配置 · 增删改即时写 persist + 审计</AutoGloss>} onClose={() => { setNovaDrawer(false); setEditNovaKey(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setNovaDrawer(false); setEditNovaKey(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!novaForm.name.trim()} onClick={submitNova}>{editNovaKey ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">通道名 channel（内部标识，用户不可见）</span><input className="fld" value={novaForm.name} onChange={(e) => setNovaForm({ ...novaForm, name: e.target.value })} placeholder="如 market-event" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">触发节奏 tick</span><input className="fld" value={novaForm.tick} onChange={(e) => setNovaForm({ ...novaForm, tick: e.target.value })} placeholder="如 15 min / 注册 8s" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">冷却 cooldown</span><input className="fld" value={novaForm.cd} onChange={(e) => setNovaForm({ ...novaForm, cd: e.target.value })} placeholder="如 30 min / 24h" /></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">点击率 CTR（%，考核指标 &gt;25%）</span><input className="fld" type="number" min={0} value={novaForm.ctr} onChange={(e) => setNovaForm({ ...novaForm, ctr: e.target.value })} placeholder="如 25" /></label>
          <div className="tint warn tiny"><AutoGloss>通道 cadence 为运营动作 · 新增默认启用(投递中) · 列表用 kill 开关停投</AutoGloss></div>
        </div></Drawer>}

      {addCampaign && <Drawer title="新建通知 Campaign" sub={<AutoGloss>填写投放规格 · 提交后走双人复核</AutoGloss>} onClose={() => setAddCampaign(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddCampaign(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!campaignForm.name.trim() || !campaignForm.title.trim() || !campaignForm.content.trim()} onClick={() => {
          const nm = campaignForm.name.trim(); const ti = campaignForm.title.trim();
          const bud = campaignForm.budget.trim();
          setMc({ op: "status", paramKey: `I.campaign.new.${slug(nm)}.status`, fixedVal: "pending", name: "新建 Campaign:" + nm,
            detail: "标题「" + ti + "」· " + campaignForm.tier + " tier · " + campaignForm.channel + " 通道 · 受众 " + campaignForm.audience + (bud ? " · 预算 " + bud + " NEX" : " · 无预算上限") + " · 正文 " + campaignForm.content.trim().length + " 字 · 按优先级 CAP 入队投递",
            toast: "Campaign「" + nm + "」已创建 · 待投递复核" });
          setAddCampaign(false);
        }}>提交复核</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">Campaign 名称（内部标识）</span><input className="fld" value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} placeholder="如 Q3 节点上新通知" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">通知标题（用户可见）</span><input className="fld" value={campaignForm.title} onChange={(e) => setCampaignForm({ ...campaignForm, title: e.target.value })} placeholder="如 新一代 NexionBox Pro v3 现已开放" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">正文内容</span><textarea className="fld" rows={4} style={{ resize: "vertical", minHeight: 88, lineHeight: 1.5 }} value={campaignForm.content} onChange={(e) => setCampaignForm({ ...campaignForm, content: e.target.value })} placeholder="通知正文 · 中性运营语言 · 涉收益/披露按合规口径表述" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">优先级 tier</span><select className="fld" value={campaignForm.tier} onChange={(e) => setCampaignForm({ ...campaignForm, tier: e.target.value })}>{NOTIF_ROWS.map(([t]) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">投放通道</span><select className="fld" value={campaignForm.channel} onChange={(e) => setCampaignForm({ ...campaignForm, channel: e.target.value })}>{["in-app", "push", "email"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">投放受众</span><select className="fld" value={campaignForm.audience} onChange={(e) => setCampaignForm({ ...campaignForm, audience: e.target.value })}>{CAMPAIGN_AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">预算上限（NEX，可选）</span><input className="fld" type="number" min={0} value={campaignForm.budget} onChange={(e) => setCampaignForm({ ...campaignForm, budget: e.target.value })} placeholder="留空 = 不设上限" /></label>
          </div>
          <div className="tint warn tiny"><AutoGloss>投放规格为高敏运营动作 · 新建 Campaign 须双人复核后才入队投递</AutoGloss></div>
        </div>
      </Drawer>}

      {addTrust && <Drawer title="新增信任中心条目" sub={<AutoGloss>/trust · 财报数字 / 储备证明为高敏合规内容 · 提交后走双人复核</AutoGloss>} onClose={() => setAddTrust(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddTrust(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!trustForm.section.trim() || !trustForm.title.trim() || !trustForm.content.trim()} onClick={() => {
          const ti = trustForm.title.trim();
          setMc({ op: "status", paramKey: `I.trust.new.${slug(ti)}.status`, fixedVal: "pending", name: "新增信任中心条目:" + ti, amplifies: true,
            detail: "section " + trustForm.section.trim() + " · 复核级 " + trustForm.tier + " · 正文 " + trustForm.content.trim().length + " 字 · 财务/储备类高敏,Checker 升合规/超管 · 创建后入「待发布」队列,通过后对用户可见",
            toast: "信任中心条目「" + ti + "」已创建 · 待发布复核" });
          setAddTrust(false);
        }}>提交复核</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">section 名</span><input className="fld" value={trustForm.section} onChange={(e) => setTrustForm({ ...trustForm, section: e.target.value })} placeholder="如 Q4 2026 financials" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">标题</span><input className="fld" value={trustForm.title} onChange={(e) => setTrustForm({ ...trustForm, title: e.target.value })} placeholder="如 第四季度经审计财报" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">内容正文</span><textarea className="fld" rows={5} style={{ resize: "vertical", minHeight: 110, lineHeight: 1.5 }} value={trustForm.content} onChange={(e) => setTrustForm({ ...trustForm, content: e.target.value })} placeholder="条目正文 · 财务数字 / 储备证明须与公开披露口径一致 · 中性合规表述" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">复核级</span><select className="fld" value={trustForm.tier} onChange={(e) => setTrustForm({ ...trustForm, tier: e.target.value })}>{TRUST_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <div className="tint warn tiny"><AutoGloss>财务数字 / 储备证明为高敏合规内容 · Checker 升至合规 / 超管级,通过后才对 /trust 可见</AutoGloss></div>
        </div>
      </Drawer>}

      {addTutorial && <Drawer title="新建教程" sub={<AutoGloss>/learn · 完成 NEX 奖励受 B1 兑付覆盖率红线约束 · 提交后走双人复核</AutoGloss>} onClose={() => setAddTutorial(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddTutorial(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!tutorialForm.title.trim() || !tutorialForm.content.trim()} onClick={() => {
          const ti = tutorialForm.title.trim(); const rw = tutorialForm.reward.trim();
          setMc({ op: "status", paramKey: `I.tutorial.new.${slug(ti)}.status`, fixedVal: "pending", name: "新建教程:" + ti, amplifies: !!rw,
            detail: "分类 " + tutorialForm.category + " · 完成奖励 " + (rw ? rw + " NEX/课" : "0(无奖励)") + " · 正文 " + tutorialForm.content.trim().length + " 字 · 完成 NEX 奖励放大 NEX 流出,受 B1 兑付覆盖率红线约束 · 复核通过才对用户可见",
            toast: "教程「" + ti + "」已创建 · 待发布复核" });
          setAddTutorial(false);
        }}>提交复核</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">课程标题</span><input className="fld" value={tutorialForm.title} onChange={(e) => setTutorialForm({ ...tutorialForm, title: e.target.value })} placeholder="如 算力收益如何结算" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">分类</span><select className="fld" value={tutorialForm.category} onChange={(e) => setTutorialForm({ ...tutorialForm, category: e.target.value })}>{TUTORIAL_CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">完成奖励（NEX/课）</span><input className="fld" type="number" min={0} value={tutorialForm.reward} onChange={(e) => setTutorialForm({ ...tutorialForm, reward: e.target.value })} placeholder="如 20" /></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">内容正文</span><textarea className="fld" rows={5} style={{ resize: "vertical", minHeight: 110, lineHeight: 1.5 }} value={tutorialForm.content} onChange={(e) => setTutorialForm({ ...tutorialForm, content: e.target.value })} placeholder="课程正文 · 中性教学语言" /></label>
          <div className="tint warn tiny"><AutoGloss>完成 NEX 奖励放大 NEX 流出 · 受 B1 兑付覆盖率红线约束 · 须双人复核留痕</AutoGloss></div>
        </div>
      </Drawer>}

      {mc && <MakerCheckerModal action={mc.name} detail={mc.detail ?? "server 权威发布版 · client 仅渲染当前版 · 经 A2 双审批 + append-only 审计"} amplifies={!!mc.amplifies}
        edit={mc.op === "param" ? ({ current: mc.current, unit: mc.unit } as EditSpec) : undefined}
        onClose={() => setMc(null)}
        onConfirm={(reason, newVal) => {
          if (mc.op === "param") {
            // 真写:课程奖励目标新值入 platform-config-store(persist + 审计),派生即时反映,刷新保留。
            setParam(mc.paramKey, (newVal ?? "").trim(), { action: mc.name, reason });
          } else {
            // 内容发布 / 下架 / 胜出 / 停止 / 启停 / 披露版本:固定值写入。
            setParam(mc.paramKey, mc.fixedVal ?? "", { action: mc.name, reason });
          }
          setToast(mc.toast);
          setMc(null);
        }} />}
      {toastNode}
    </div>
  );
}
