"use client";

/**
 * J 紧急与合规控制 — 设计稿 Emergency 内容视图(从 page-emergency.jsx 移植)。
 * 标签:J1 Kill-Switch 矩阵 / J2 Geo-block / J3 篡改防御 & 应急 SOP。
 * 路由 l2.id 折叠:J4(应急 SOP)→J3(篡改防御 + SOP 合并在 J3 内,与设计稿一致)。
 */
import { useState } from "react";
import { Icon, Card, CardH, CodeTag, Badge, Btn, Toggle, KV, MakerCheckerModal, useToast } from "./design-kit";
import { AutoGloss, Gloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KILLSWITCH, GEOBLOCK } from "@/lib/mock/admin/design-data";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

type KillRow = (typeof KILLSWITCH)[number] & { lastChange: string };
type GeoRow = (typeof GEOBLOCK)[number];

// 篡改防御行:[id(稳定 · 真写 key 用), 名称, 起数, 颜色]
const TAMPER: ReadonlyArray<readonly [string, string, number, string]> = [
  ["client_version", "client 版本推进拦截", 0, "var(--success)"],
  ["ab_group", "A/B 分组篡改尝试", 3, "var(--warning)"],
  ["local_balance", "本地余额改写拦截", 12, "var(--brand)"],
  ["risk_tamper_detected", "风险篡改检出", 2, "var(--danger)"],
];
// 篡改处置结论 → 展示文案 + 色调
const TAMPER_VERDICT: Record<string, { label: string; tone: string }> = {
  confirmed: { label: "已确认拦截", tone: "ok" },
  falsePositive: { label: "已标记误报", tone: "warn" },
  banned: { label: "已封禁账户", tone: "err" },
};
const SOP_STEPS: ReadonlyArray<string> = [
  "1. 接监管点名 → 内容定位违规文案 key",
  "2. I2 per-channel kill 立即下架推送",
  "3. J1 相关功能闸熔断(双人复核)",
  "4. J2 geo-block 涉事地区",
  "5. I5 风险披露 re-ack 强制下发",
  "6. A2 全程留痕 → emergency_playbook_executed",
];

const FOLD: Record<string, string> = { J1: "J1", J2: "J2", J3: "J3", J4: "J3" };

type Mc =
  | { kind: "kill"; row: KillRow }
  | { kind: "geo"; row: GeoRow }
  | { kind: "tamper"; gate: string; verdict: "confirmed" | "falsePositive" | "banned"; action: string; detail: string; amplifies?: boolean }
  | { kind: "sop"; sopId: string; status: "drilling" | "done"; action: string; detail: string };

// J4 应急 SOP 步骤处置态(store 值 drilling/done)→ 展示。
const SOP_STATUS: Record<string, { label: string; tone: string }> = {
  drilling: { label: "演练中", tone: "warn" },
  done: { label: "已完成", tone: "ok" },
};

export function JDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState<string>(FOLD[meta.l2Id] ?? "J1");
  // 真写落点:Kill-Switch / Geo-block / 篡改处置统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);

  const rows: KillRow[] = KILLSWITCH.map((k) => ({ ...k }));
  const geo: GeoRow[] = GEOBLOCK.map((g) => ({ ...g }));
  const [mc, setMc] = useState<Mc | null>(null);

  // 派生:闸状态以 store 为准("on"/"off"),缺省回落 mock 的 on 字段(刷新后仍反映 + 即时变)。
  const effKillOn = (k: KillRow): boolean => { const v = pget(`J.killswitch.${k.key}`); return v ? v === "on" : k.on; };
  const effKillChange = (k: KillRow): string => (pget(`J.killswitch.${k.key}`) ? "刚刚 · 你" : k.lastChange);
  const effBlocked = (g: GeoRow): boolean => { const v = pget(`J.geo.${g.cc}`); return v ? v === "blocked" : g.blocked; };
  const tamperVerdict = (gate: string): string | undefined => pget(`J.tamper.${gate}.verdict`);
  // SOP 步骤处置态:以 store 为准("drilling"/"done"),缺省未启动(刷新后仍反映 + 即时变)。
  const sopStatus = (id: string): string | undefined => pget(`J.sop.${id}.status`);

  const live = rows.filter((k) => effKillOn(k)).length;

  const onMcConfirm = (reason: string) => {
    if (!mc) return;
    if (mc.kind === "kill") {
      const wasOn = effKillOn(mc.row);
      const next = wasOn ? "off" : "on"; // 熔断 on→off / 恢复 off→on 均走双签真写
      setParam(`J.killswitch.${mc.row.key}`, next, { action: (wasOn ? "熔断功能闸 " : "恢复功能闸 ") + mc.row.key, reason });
      setToast((wasOn ? "已熔断 " : "已恢复 ") + mc.row.key + "(A2 留痕)");
    } else if (mc.kind === "geo") {
      const wasBlocked = effBlocked(mc.row);
      const next = wasBlocked ? "allowed" : "blocked";
      setParam(`J.geo.${mc.row.cc}`, next, { action: (wasBlocked ? "解除地域屏蔽 " : "屏蔽地域准入 ") + mc.row.cc, reason });
      setToast((wasBlocked ? "已解除屏蔽 " : "已屏蔽 ") + mc.row.cc + " 准入(A2 留痕)");
    } else if (mc.kind === "tamper") {
      setParam(`J.tamper.${mc.gate}.verdict`, mc.verdict, { action: mc.action, reason });
      setToast(TAMPER_VERDICT[mc.verdict].label + "(A2 留痕)");
    } else if (mc.kind === "sop") {
      setParam(`J.sop.${mc.sopId}.status`, mc.status, { action: mc.action, reason });
      setToast((mc.status === "done" ? "已标记完成 · " : "已启动演练 · ") + mc.action + "(A2 留痕)");
    } else {
      setToast("已提交复核(A2 留痕)");
    }
    setMc(null);
  };

  return (
    <div className="dkpage">
      <DomainHeader {...meta} />

      {tab === "J1" && <div>
        <div className="alertbar danger" style={{ marginBottom: 16 }}>
          <span className="ico"><Icon name="power" size={16} /></span>
          <div className="tiny"><b><AutoGloss>Kill-Switch 是「不可单人即时执行」动作</AutoGloss></b> <AutoGloss>· 全部经 Maker-Checker 双人复核 · 解除放大流出类闸须先核验 B1 覆盖率。未采纳单人 break-glass(PM 决议)。</AutoGloss></div>
        </div>
        <div className="grid g-3" style={{ marginBottom: 16 }}>
          <Card style={{ padding: "15px 16px" }}><div className="muted tiny">在线功能闸</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--success)" }} className="tnum">{live} / {rows.length}</div></Card>
          <Card style={{ padding: "15px 16px" }}><div className="muted tiny">已熔断</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--danger)" }} className="tnum">{rows.length - live}</div></Card>
          <Card style={{ padding: "15px 16px" }}><div className="muted tiny">geo-block 国家</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--warning)" }} className="tnum">{geo.filter((g) => effBlocked(g)).length}</div><div className="muted tiny">J2</div></Card>
        </div>

        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl"><AutoGloss>{`Kill-Switch 矩阵 · ${rows.length} 个二元功能闸`}</AutoGloss></span><CodeTag tone="danger"><AutoGloss>紧急熔断开关</AutoGloss></CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>闸 key</th><th>功能</th><th>被控域</th><th><AutoGloss>放大流出</AutoGloss></th><th>状态</th><th>最近变更</th><th /></tr></thead>
            <tbody>{rows.map((k) => { const on = effKillOn(k); return (
              <tr key={k.key} style={{ background: on ? "" : "var(--danger-soft)" }}>
                <td className="mono t-strong">{k.key}</td>
                <td><AutoGloss>{k.name}</AutoGloss><div className="muted tiny"><AutoGloss>{k.desc}</AutoGloss></div></td>
                <td><CodeTag tone="electric">{k.domain}</CodeTag></td>
                <td>{k.amplifies ? <Badge tone="orange">是</Badge> : <span className="muted tiny">否</span>}</td>
                <td><span className="row" style={{ gap: 8 }}><span className={"dot " + (on ? "green pulse" : "red")} />{on ? <Badge tone="ok">在线</Badge> : <Badge tone="err">已熔断</Badge>}</span></td>
                <td className="t-mut tiny">{effKillChange(k)}</td>
                <td><Btn sm variant={on ? "danger" : "primary"} onClick={() => setMc({ kind: "kill", row: k })}><AutoGloss>{on ? "熔断" : "恢复"}</AutoGloss></Btn></td>
              </tr>
            ); })}</tbody>
          </table></div>
        </Card>
      </div>}

      {tab === "J2" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">Geo-block · 国家级屏蔽</span><CodeTag>按国家/地区屏蔽</CodeTag></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>国家 / 地区</th><th>code</th><th>屏蔽范围</th><th>原因</th><th>状态</th><th /></tr></thead>
          <tbody>{geo.map((g) => { const blocked = effBlocked(g); const scope = blocked ? (g.scope === "—" ? "全 endpoint" : g.scope) : (g.blocked ? "—" : g.scope); return (
            <tr key={g.cc} style={{ background: blocked ? "var(--danger-soft)" : "" }}>
              <td className="t-strong">{g.name}</td><td><CodeTag>{g.cc}</CodeTag></td>
              <td className="tiny">{scope}</td><td className="t-mut tiny"><AutoGloss>{g.reason}</AutoGloss></td>
              <td>{blocked ? <Badge tone="err">已屏蔽</Badge> : <Badge tone="ok">开放</Badge>}</td>
              <td><Toggle on={blocked} danger onClick={() => setMc({ kind: "geo", row: g })} /></td>
            </tr>
          ); })}</tbody>
        </table></div>
      </Card>}

      {tab === "J3" && <div className="grid g-2">
        <Card>
          <CardH title="篡改防御监控" sub="以服务端数据为准" right={<CodeTag>防篡改监控</CodeTag>} />
          {TAMPER.map(([id, n, c]) => { const verdict = tamperVerdict(id); const v = verdict ? TAMPER_VERDICT[verdict] : null; return (
            <div key={id} className="kv" style={{ alignItems: "flex-start" }}>
              <span className="k"><AutoGloss>{n}</AutoGloss></span>
              <span className="v col" style={{ alignItems: "flex-end", gap: 6 }}>
                <Badge tone={c === 0 ? "ok" : c < 5 ? "warn" : "info"}>{c} 起 / 24h</Badge>
                {v && <Badge tone={v.tone}>{v.label}</Badge>}
                {c > 0 && !verdict && <span className="row" style={{ gap: 6 }}>
                  <Btn sm onClick={() => setMc({ kind: "tamper", gate: id, verdict: "confirmed", action: `确认拦截:${n}`, detail: `${c} 起 / 24h · 维持拦截判定 · 写入 admin.tamper_intercept_confirmed(A2 留痕)` })}>确认拦截</Btn>
                  <Btn sm onClick={() => setMc({ kind: "tamper", gate: id, verdict: "falsePositive", action: `标记误报:${n}`, detail: `${c} 起 / 24h · 解除拦截判定 → 放行涉及账户 · 写入 admin.tamper_marked_false_positive`, amplifies: true })}>标记误报</Btn>
                  <Btn sm variant="danger" onClick={() => setMc({ kind: "tamper", gate: id, verdict: "banned", action: `封禁账户:${n}`, detail: `${c} 起 / 24h · 冻结命中账户 → 联动 C2 · 写入 admin.tamper_account_banned`, amplifies: true })}>封禁账户</Btn>
                </span>}
              </span>
            </div>
          ); })}
          <div className="tint cyan tiny" style={{ marginTop: 12 }}><AutoGloss>所有资金/状态事件以 server 权威为准 · client 事件可丢可重,不影响权威口径</AutoGloss></div>
        </Card>
        <Card>
          <CardH title="监管点名应急 SOP" sub="应急流程编排(纯运营内部)" right={<CodeTag>应急流程</CodeTag>} />
          <div className="col" style={{ gap: 8 }}>
            {SOP_STEPS.map((s, i) => { const id = `step.${i + 1}`; const st = sopStatus(id); const stView = st ? SOP_STATUS[st] : null; const done = st === "done"; return (
              <div key={i} className="tint tiny row" style={{ alignItems: "center", gap: 8 }}>
                <b style={{ flex: 1 }}><AutoGloss>{s}</AutoGloss></b>
                {stView && <Badge tone={stView.tone}>{stView.label}</Badge>}
                <Btn sm disabled={done} onClick={() => setMc({ kind: "sop", sopId: id, status: "drilling", action: `启动演练:第 ${i + 1} 步`, detail: `${s} · 进入应急演练编排 · 写入 admin.emergency_drill_started(A2 留痕)` })}>启动演练</Btn>
                <Btn sm variant="primary" disabled={done} onClick={() => setMc({ kind: "sop", sopId: id, status: "done", action: `标记完成:第 ${i + 1} 步`, detail: `${s} · 标记该步处置完成 · 写入 admin.emergency_step_completed(A2 留痕)` })}>标记完成</Btn>
              </div>
            ); })}
          </div>
        </Card>
      </div>}

      {mc && <MakerCheckerModal
        action={mc.kind === "kill" ? `Kill-Switch ${effKillOn(mc.row) ? "熔断" : "恢复"}:${mc.row.name}` : mc.kind === "geo" ? `Geo 准入${effBlocked(mc.row) ? "解除屏蔽" : "屏蔽"}:${mc.row.name}` : mc.action}
        detail={mc.kind === "kill" ? `${mc.row.key} ${effKillOn(mc.row) ? "enable→disable" : "disable→enable"} · 写入 admin.kill_switch_toggled` : mc.kind === "geo" ? `${mc.row.cc} ${effBlocked(mc.row) ? "屏蔽→开放" : "开放→屏蔽"} · 国家级准入变更 · 写入 admin.geo_block_changed` : mc.detail}
        amplifies={mc.kind === "kill" ? (!effKillOn(mc.row) && mc.row.amplifies) : mc.kind === "tamper" ? mc.amplifies : false}
        onClose={() => setMc(null)} onConfirm={onMcConfirm} />}
      {toastNode}
    </div>
  );
}
