"use client";

/**
 * K4 风险评分模型 — 六维权重滑杆(合计=1 前端禁提 + server 400 双校验)+ 分档/分布 +
 * 可解释单用户分 + 人工覆盖记录。
 * K4 = 全平台唯一评分源:D2 路由 / C1 画像 / B5 告警线只引用不重算;单用户分从 USERS/WITHDRAWALS 同分派生。
 * 操作确认升级:权重 / 分档 / 输入开关影响全域路由,执行门槛为平台管理员。
 */
import { useId, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import { REGISTERED_USERS, K_RISK } from "@/lib/mock/admin/design-data";
import { K4_DIMS, K4_DIST, K4_LOOKUP, K4_OVERRIDES, scoreColor } from "./data";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function K4HeaderActions() {
  return <span className="f-ro"><span className="d" />全平台唯一评分源 · 别处只引用不重算</span>;
}

function BandDonut() {
  const gid = useId();
  const C = 2 * Math.PI * 64, gap = 3;
  let off = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 168 168" aria-label="风险分档分布">
        <circle cx={84} cy={84} r={64} fill="none" stroke="var(--surface-3)" strokeWidth={17} />
        {K4_DIST.map((s) => {
          const len = Math.max((C * s.pct) / 100 - gap, 2);
          const el = (
            <circle key={`${gid}-${s.band}`} cx={84} cy={84} r={64} fill="none" stroke={s.color} strokeWidth={17}
              strokeDasharray={`${len.toFixed(1)} ${C.toFixed(1)}`} strokeDashoffset={(-off).toFixed(1)}>
              <title>{`${s.band} ${s.pct}%`}</title>
            </circle>
          );
          off += (C * s.pct) / 100;
          return el;
        })}
      </svg>
      <div className="c"><div><div className="n">{fmt(REGISTERED_USERS)}</div><div className="l">在册用户</div></div></div>
    </div>
  );
}

export function K4Scoring({ ctx }: { ctx: KCtx }) {
  // 滑杆本地态:生效值 = pget 覆盖 ?? PRD 默认;提交 = 批量 setParam(目标值即滑杆态,操作确认 处置式批量写)。
  const effW = (dimKey: string, def: number) => {
    const v = ctx.pget(`K.score.weight.${dimKey}`);
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n / 100 : def;
  };
  const [weights, setWeights] = useState<number[]>(() => K4_DIMS.map((d) => d.w));
  const [touched, setTouched] = useState(false);
  const liveWeights = touched ? weights : K4_DIMS.map((d) => effW(d.dimKey, d.w));
  const sum = liveWeights.reduce((a, b) => a + b, 0);
  const sumOk = Math.abs(sum - 1) <= 0.001;

  const [luId, setLuId] = useState("usr_55B1");
  const [luKey, setLuKey] = useState("usr_55B1");
  const lu = K4_LOOKUP[luKey];

  const submitWeights = () => {
    if (!sumOk) { ctx.toast(`合计 ${sum.toFixed(2)} ≠ 1.00,服务器会拒绝(400),请先调平`); return; }
    ctx.openActionConfirm({
      action: "评分模型权重变更",
      detail: `新权重:${K4_DIMS.map((d, i) => `${d.name} ${liveWeights[i].toFixed(2)}`).join(" / ")}。影响全平台:提现路由(D2)、画像展示(C1)、雷达告警(B5)都会跟着变。只对新评分生效,历史分留快照。执行门槛固定为平台管理员,执行前必须填写理由 · 写入 admin.risk_model_weights_changed`,
      run: (reason) => {
        K4_DIMS.forEach((d, i) => {
          const pctV = Math.round(liveWeights[i] * 100);
          if (pctV !== Math.round(d.w * 100) || ctx.pget(`K.score.weight.${d.dimKey}`) != null) {
            ctx.setParam(`K.score.weight.${d.dimKey}`, String(pctV), { action: `调整风险评分权重 ${d.name} → ${pctV}%`, reason });
          }
        });
        setTouched(false);
        ctx.toast("权重变更已执行 · 平台管理员留痕 · 新评分批生效");
      },
    });
  };

  const resetWeights = () => { setWeights(K4_DIMS.map((d) => d.w)); setTouched(false); ctx.toast("已还原为当前生效权重"); };

  const toggleSource = () => {
    const cur = ctx.pget("K.score.inputSource") ?? "全部启用";
    ctx.openActionConfirm({
      action: "评分维度开关切换",
      detail: "临时停用 / 启用某个输入维度(如实名状态数据源维护时停用 C4 维度)。停用后该维度不参与合成,下游分数随之变化 —— 影响全平台,平台管理员执行门槛 · 写入 admin.risk_model_source_toggled",
      edit: { kind: "select", current: cur, options: ["全部启用", "停用 C4 实名维度", "停用 K2 套利维度", "停用异常行为维度"] },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam("K.score.inputSource", newVal, { action: `评分维度开关 → ${newVal}`, reason });
        ctx.toast("维度开关变更已执行 · 平台管理员留痕");
      },
    });
  };

  const adjBand = () => {
    const cur = ctx.pget("K.score.band") ?? "40 / 70";
    ctx.openActionConfirm({
      action: "风险分档线调整",
      detail: "当前:低 < 40 / 中 40–69 / 高 ≥ 70(0–100 分制,必须低 < 中 < 高)。改了立即重判档色;风险雷达(B5)的「异常账户告警线」引用这套分档,会一起变。平台管理员执行门槛 · 写入 admin.risk_band_changed",
      edit: { kind: "text", current: cur },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam("K.score.band", newVal, { action: `调整风险分档线 → ${newVal}`, reason });
        ctx.toast("分档线调整已执行 · 平台管理员留痕(B5 告警线联动)");
      },
    });
  };

  const adjEscalate = () => {
    const cur = ctx.pget("K.score.escalate") ?? "85";
    ctx.openActionConfirm({
      action: "自动升级线调整",
      detail: "当前 ≥ 85 分自动建议提现转人工 + 点亮雷达。范围 70–100。只是「建议」,真正的处置仍在目标域走操作确认;K5 风险分触发线对接此值。与权重 / 分档同级:风控主管执行门槛:平台管理员 · 写入 admin.risk_escalate_changed",
      edit: { kind: "number", current: cur, unit: "分" },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam("K.score.escalate", newVal, { action: `调整自动升级线 → ${newVal} 分`, reason });
        ctx.toast("自动升级线调整已确认生效");
      },
    });
  };

  const overrideScore = (uid: string, modelScore: number) =>
    ctx.openConfirm({
      action: `人工覆盖评分 · ${uid}`,
      detail: `把这个用户的分数改成你指定的值(覆盖模型分 ${modelScore})。单人即可,但必须写清原因,全程留痕;随时可以「重算」一键回到模型分。这是给明确误判留的口子,长期问题请改模型权重(那个要操作确认)。`,
      chips: [["单人 · 强制原因", "ready"], ["落审计 · 可随时回模型分", "done"]],
      reason: true,
      input: { label: "覆盖分(0–100)", placeholder: "如 35" },
      okLabel: "确认覆盖",
      run: (reason, val) => {
        const n = Number(val);
        if (!val || !Number.isFinite(n) || n < 0 || n > 100) { ctx.toast("覆盖分须为 0–100 的数字(服务器同样校验)"); return; }
        const v = String(Math.round(n));
        ctx.setParam(`K.score.override.${uid}`, v, { action: `人工覆盖评分 ${uid}:${modelScore} → ${v}`, reason });
        ctx.toast(`${uid} 评分已人工覆盖 → ${v} · 原因留痕 · 产 risk.score_overridden`);
      },
    });

  const recompute = (uid: string) =>
    ctx.openConfirm({
      action: `重算回模型分 · ${uid}`,
      detail: "丢弃人工覆盖值,按当前模型权重重新算一遍。不改权重,只回归模型,所以不用操作确认。",
      chips: [["回归模型计算", "done"], ["重算前后分都留痕", "ready"]],
      okLabel: "确认重算",
      run: (reason) => {
        ctx.setParam(`K.score.override.${uid}`, "recomputed", { action: `重算回模型分 ${uid}`, reason: reason || "回归模型计算" });
        ctx.toast(`${uid} 已重算回模型分 · 前后分留痕`);
      },
    });

  const lookup = () => {
    const id = luId.trim() || "usr_55B1";
    if (!K4_LOOKUP[id]) { ctx.toast("原型内置样例:usr_55B1 / usr_84F2 / usr_19C7"); return; }
    setLuKey(id);
  };

  // 实时覆盖态:override 键存数字 = 覆盖中;"recomputed"/缺省 = 模型分。
  const ovRaw = ctx.pget(`K.score.override.${luKey}`);
  const ovNum = ovRaw != null && ovRaw !== "recomputed" ? Number(ovRaw) : NaN;
  const shown = Number.isFinite(ovNum) ? ovNum : lu.score;
  const col = scoreColor(shown);
  const bandLb = shown >= 70 ? ["高风险", "bad"] : shown >= 40 ? ["中风险", "warn"] : ["低风险", "ok"];
  const maxPt = Math.max(...lu.dims.map((d) => d[2]), 1);

  const sumLabel = sumOk
    ? `✓ 权重合计 = ${sum.toFixed(2)} · 可以提交`
    : `✕ 权重合计 = ${sum.toFixed(2)},必须等于 1.00 才能提交(服务器也会再拦一次)`;

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">低风险(&lt; 40 分)</div><div className="v">{K4_DIST[0].pct}%</div><div className="sub">{fmt(K4_DIST[0].n)} 人</div></div>
        <div className="f-stat warn"><div className="k">中风险(40–69)</div><div className="v">{K4_DIST[1].pct}%</div><div className="sub">{fmt(K4_DIST[1].n)} 人 · 提现多走延迟</div></div>
        <div className="f-stat danger"><div className="k">高风险(≥ 70)</div><div className="v">{K4_DIST[2].pct}%</div><div className="sub">{fmt(K4_DIST[2].n)} 人 · ≥{ctx.pget("K.score.escalate") ?? "85"} 自动建议转人工</div></div>
        <div className="f-stat cyan"><div className="k">人工覆盖中</div><div className="v">{K_RISK.overrideActive}</div><div className="sub">全部带原因留痕 · 可一键回模型分</div></div>
      </div>

      <div className="two-col r12">
        {/* 模型权重配置 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">评分权重</span>
            <span className="sub">· 六个维度的权重加起来必须等于 1,服务器会强制校验</span>
            <div className="r"><span className="kcode" style={{ background: "var(--warning-soft)", color: "var(--warning)" }} title="变更影响全平台路由,执行门槛为平台管理员">平台管理员</span></div>
          </div>
          <div className="l-b">
            {K4_DIMS.map((d, i) => (
              <div className="w-row" key={d.dimKey}>
                <span className="nm">{d.name}<span className="src">{d.src}</span></span>
                <input
                  type="range" min={0} max={100} value={Math.round(liveWeights[i] * 100)}
                  onChange={(e) => {
                    const next = [...liveWeights];
                    next[i] = Number(e.target.value) / 100;
                    setWeights(next); setTouched(true);
                  }}
                  aria-label={`${d.name} 权重`}
                />
                <span className="val">{liveWeights[i].toFixed(2)}</span>
              </div>
            ))}
            <div className={`w-sum ${sumOk ? "ok" : "bad"}`}>{sumLabel}</div>
            <div className="w-foot">
              <button className="l-btn mc" onClick={submitWeights}>提交权重变更(操作确认)</button>
              <button className="l-btn" onClick={resetWeights}>还原当前生效值</button>
              <span className="note">改后只对新评分生效,历史分留快照</span>
            </div>
            <div className="ktint" style={{ marginTop: 14, fontSize: 12 }}>
              <div><b>维度开关</b> · 临时停用某个维度(比如实名状态数据源维护时),它就不再参与合成,下游分数随之变化 —— 同样由平台管理员执行并填写理由。当前:{ctx.pget("K.score.inputSource") ?? "全部启用"}</div>
              <button className="l-btn sm mc" style={{ marginTop: 10 }} onClick={toggleSource}>切换维度开关</button>
            </div>
          </div>
        </section>

        {/* 分档 + 分布 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">分档与全平台分布</span>
            <span className="sub">· 风险雷达的告警线直接引用这套分档,不另设</span>
          </div>
          <div className="l-b">
            <div className="dist-wrap">
              <BandDonut />
              <div className="dist-rows">
                {K4_DIST.map((s) => (
                  <div className="r" key={s.band}>
                    <span className="dot2" style={{ background: s.color }} />
                    <span className="nm">{s.band} <small>{s.range}</small></span>
                    <span className="ct">{fmt(s.n)}</span>
                    <span className="pc">{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="band-tints">
              <div className="ktint" style={{ fontSize: 12 }}>
                <span className="tx"><b>分档线</b> · {ctx.pget("K.score.band") ? `已调整:${ctx.pget("K.score.band")}(原 40 / 70)` : "低 < 40 / 中 40–69 / 高 ≥ 70"}</span>
                <button className="l-btn sm mc" onClick={adjBand}>调整</button>
              </div>
              <div className="ktint warn" style={{ fontSize: 12 }}>
                <span className="tx"><b>自动升级线</b> · ≥ {ctx.pget("K.score.escalate") ?? "85"} 分自动建议提现转人工 + 点亮雷达(只是建议,处置仍走目标域操作确认)</span>
                <button className="l-btn sm mc" onClick={adjEscalate}>调整</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 单用户查询(可解释性) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">单用户风险分查询</span>
          <span className="sub">· 每一分都能说清来源:命中了什么、贡献了几分</span>
          <div className="r">
            <div className="lookup" style={{ width: 280 }}>
              <input value={luId} onChange={(e) => setLuId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} placeholder="输入 userId,如 usr_55B1" aria-label="userId 查询" />
              <button className="l-btn primary" onClick={lookup}>查询</button>
            </div>
          </div>
        </div>
        <div className="l-b">
          <div className="score-hero">
            <div className="score-ring" style={{ background: `conic-gradient(${col} ${shown}%, var(--surface-3) 0)` }}>
              <div className="in" style={{ color: col }}>{shown}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {luKey} <span className={`bdg ${bandLb[1]}`}>{bandLb[0]}</span>
                {shown >= Number(ctx.pget("K.score.escalate") ?? "85") && <span className="bdg warn">超过自动升级线 {ctx.pget("K.score.escalate") ?? "85"}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 5 }}>
                模型分 {lu.score} · {Number.isFinite(ovNum) ? `已被人工覆盖 → ${ovNum}` : "未被人工覆盖"} · 模型版本 v7 · 2 分钟前更新
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="l-btn" onClick={() => overrideScore(luKey, lu.score)}>人工覆盖评分(单人 · 强制原因)</button>
                <button className="l-btn" onClick={() => recompute(luKey)}>重算回模型分</button>
              </div>
            </div>
          </div>
          <div>
            {lu.dims.map((d) => (
              <div key={d[0]}>
                <div className="dim-row">
                  <span className="nm">{d[0]}</span>
                  <span>{d[2] > 0 ? <span className="bdg warn">命中</span> : <span className="bdg dim">未中</span>}</span>
                  <span className="track"><i style={{ width: `${(d[2] / maxPt) * 100}%` }} /></span>
                  <span className="pt">{d[2] > 0 ? `+${d[2]}` : "0"}</span>
                </div>
                {d[2] > 0 && <div className="dim-note">{d[1]}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 人工覆盖记录 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">人工覆盖记录</span>
          <span className="sub">· 谁、把谁的分、从多少改到多少、为什么 —— 全在这里</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 780 }}>
            <thead><tr><th>账户</th><th className="num">模型分</th><th className="num">覆盖分</th><th>原因</th><th>操作人</th><th>时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {K4_OVERRIDES.map((o) => {
                const recomputed = ctx.pget(`K.score.override.${o[0]}`) === "recomputed";
                return (
                  <tr key={o[0]} style={recomputed ? { opacity: 0.62 } : undefined}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{o[0]}</td>
                    <td className="num mono">{o[1]}</td>
                    <td className="num mono" style={{ fontWeight: 700, color: o[2] > o[1] ? "var(--danger)" : "var(--success)" }}>{o[2]}</td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{o[3]}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{o[4]}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{o[5]}</td>
                    <td style={{ textAlign: "right" }}>
                      {recomputed ? <span className="bdg dim">已回模型分</span> : <button className="l-btn sm" onClick={() => recompute(o[0])}>回模型分</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="f-foot">
        <b>为什么这里的执行门槛要升一级</b>:K3 改一条提现规则,影响的是提现这一个口;这里改权重,提现路由、画像展示、雷达告警全都跟着变 —— 所以规则级变更可由风控 lead 执行,<b>模型级变更必须平台管理员执行</b>,且执行前必须填写理由。<b>人工覆盖单个用户的分数不用操作确认</b>,但必须写原因、全程留痕,且随时可以一键回到模型分 —— 这是给「明知误判但模型一时改不过来」留的口子,不是绕过模型的后门。评分输入来自 K1 / K2 / C4 + 资金行为事件;分数变化产事件喂提现队列、用户画像和风险雷达。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "人工覆盖记录",
            maxRows: 3,
            reason: "人工覆盖仅展示三条最近样本,完整审计落 A2",
          },
        ]}
      />
    </div>
  );
}
