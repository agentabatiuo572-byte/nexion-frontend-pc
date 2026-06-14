"use client";

/**
 * K5 大额 KYC 复审 + 告警 — 触发线(含 PRD 第 4 参数 reviewTriggerScore;兑换阈值归 G2 只读)+
 * 复审队列(SLA 倒计时)+ 工单裁决(操作确认,回写 C4)+ 异常告警(advisory)。
 * 状态机:triggered → in-review(提现单联动 D2 frozen)→ passed(操作确认 · 解冻,放行方向挂 B1)/ rejected(操作确认 · 维持冻结)。
 * K5 只触发 + 裁决,KYC 状态权威归 C4;手动补触发仍需操作确认(K.kyc.manual.<uid> 真写入列)。
 */
import { useMemo, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import { K_RISK } from "@/lib/mock/admin/design-data";
import { K5_PARAMS, K5_TICKETS, K5_ALERTS, TICKET_ST, slaColor, type K5Ticket, type TicketSt } from "./data";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function K5HeaderActions() {
  return <span className="f-ro"><span className="d" />只触发复审 · 实名状态本身归用户域 C4 管</span>;
}

type Filter = "all" | "大额提现" | "大额兑换" | "累计过线" | "overdue";

export function K5Kyc({ ctx }: { ctx: KCtx }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState("KR-7741");

  // 手动补触发的工单派生(K.kyc.manual.<uid> = 原因)。
  const manualTickets: K5Ticket[] = useMemo(
    () =>
      Object.entries(ctx.params)
        .filter(([k]) => k.startsWith("K.kyc.manual."))
        .map(([k, v]) => {
          const uid = k.slice("K.kyc.manual.".length);
          return {
            id: `KR-M-${uid.replace(/^usr_/, "")}`, type: "手动触发" as const, user: uid, amt: "—", cum: "—",
            kyc: "待确认(手动补触发)", st: "triggered" as const, slaPct: 0.02, slaTxt: "剩 7 天",
            info: [["触发原因", `手动补触发:${String(v)}`], ["触发方式", "风控人工 · 仍需操作确认(裁决照样操作确认)"], ["实名材料", "待调取"]],
            hist: [["刚刚", "手动补触发 · 进入队列", ""]] as [string, string, "" | "warn" | "bad"][],
          };
        }),
    [ctx.params],
  );
  const allTickets = [...manualTickets, ...K5_TICKETS];

  const liveSt = (t: K5Ticket): TicketSt => {
    const d = ctx.pget(`K.kyc.${t.id}.decision`);
    return d === "passed" || d === "rejected" ? d : t.st;
  };

  const decide = (t: K5Ticket, pass: boolean) =>
    ctx.openActionConfirm({
      action: `${pass ? "通过" : "驳回"} KYC 复审 · ${t.id}`,
      detail: `${t.user} · ${t.type} · ${t.amt !== "—" ? t.amt : t.cum}。${
        pass
          ? "通过后:实名状态回写用户域(C4),对应提现单解冻回正常流(解冻 = 放大资金流出,先核 B1 覆盖率)。"
          : "驳回后:实名状态回写用户域(C4),提现单维持冻结,走退回 / 驳回路径;如需账户级持续限制,另发起 C2 冻结(独立操作确认)。"
      }裁决请求自带防重号(Idempotency-Key),不会重复回写;风控运营执行门槛:风控主管,执行前必须填写理由 · 写入 admin.kyc_review_${pass ? "passed" : "rejected"}`,
      amplifies: pass, // 通过 = 解冻放行 → B1 预检;驳回 = 维持冻结不挂
      run: (reason) => {
        ctx.setParam(`K.kyc.${t.id}.decision`, pass ? "passed" : "rejected", { action: `KYC 复审${pass ? "通过" : "驳回"} ${t.id}(${t.user})`, reason });
        // 「回写 C4」真落地(audit P1 修:此前只写 K.kyc 工单键,声明≠实现):
        // 实名升级类工单(累计过线 / 手动触发)裁决直接改 C4 权威键 C.kyc.<uid>.st ——
        // 通过 = verified(D2/G2 门放开);驳回 = none(增强实名未过,门重新卡住)。
        // 大额提现/兑换类复审的裁决对象是单据(D2 hold 链),不动实名态。
        if (t.type === "累计过线" || t.type === "手动触发")
          ctx.setParam(`C.kyc.${t.user}.st`, pass ? "verified" : "none", { action: `K5 裁决回写 C4:${t.user} → ${pass ? "verified" : "none"} · admin.kyc_status_changed(source: k5_review)`, reason });
        ctx.toast(`${t.id} ${pass ? "已通过 · 状态回写 C4 · 提现解冻" : "已驳回 · 维持冻结"} · 理由留痕`);
      },
    });

  const manualTrigger = () =>
    ctx.openConfirm({
      action: "手动补触发复审",
      detail: "对没踩到自动线但有可疑迹象的账户,手动拉一单增强复审。只是触发,不改实名状态,所以单人即可;后面的裁决照样操作确认。",
      chips: [["仅触发 · 不改状态", "done"], ["落审计 · 产 risk.kyc_review_triggered", "ready"]],
      reason: true,
      input: { label: "userId", placeholder: "如 usr_9921" },
      okLabel: "确认触发",
      run: (reason, uid) => {
        if (!uid) return;
        ctx.setParam(`K.kyc.manual.${uid}`, reason, { action: `手动补触发 KYC 复审 ${uid}`, reason });
        ctx.toast(`已手动触发复审工单(${uid})· 进入队列`);
      },
    });

  const subAlert = () =>
    ctx.openConfirm({
      action: "告警订阅配置",
      detail: "选择接收哪些告警(大额命中 / 累计过线 / 复审超时 / 批量集中)和接收渠道。只影响你自己的通知,不动业务。",
      chips: [["个人订阅 · 不动业务", "done"]],
      okLabel: "保存订阅",
      run: () => ctx.toast("告警订阅已保存(个人设置,不落业务台账)"),
    });

  const adjParam = (p: (typeof K5_PARAMS)[number]) => {
    const cur = ctx.pget(`K.k5.${p.key}`) ?? p.val;
    ctx.openActionConfirm({
      action: `触发线调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${cur}${p.unit ? ` ${p.unit}` : ""} · ${p.note}。改后下一笔触发判定生效;放宽方向(上调触发线)= 少冻结多放行,先核 B1 覆盖率 · 写入 admin.kyc_trigger_adjusted`,
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam(`K.k5.${p.key}`, newVal, { action: `调整 KYC 触发线 ${p.name}`, reason });
        ctx.toast(`${p.name} 调整已确认生效`);
      },
    });
  };

  const visible = allTickets.filter((t) => {
    if (filter === "all") return true;
    if (filter === "overdue") return liveSt(t) === "overdue";
    return t.type === filter;
  });

  const cur = allTickets.find((t) => t.id === sel) ?? allTickets[0];
  const curSt = liveSt(cur);
  const openCount = K_RISK.reviewOpenBase + allTickets.filter((t) => liveSt(t) !== "passed" && liveSt(t) !== "rejected").length;

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待复审工单</div><div className="v">{openCount}</div><div className="sub">3 个临近时限</div></div>
        <div className="f-stat danger"><div className="k">超时工单</div><div className="v">{K_RISK.reviewOverdue}</div><div className="sub">已自动告警 + 升级</div></div>
        <div className="f-stat"><div className="k">本月已裁决</div><div className="v">{K_RISK.reviewDecidedMonth}</div><div className="sub">通过 {K_RISK.reviewDecidedPass} · 驳回 {K_RISK.reviewDecidedMonth - K_RISK.reviewDecidedPass}</div></div>
        <div className="f-stat cyan"><div className="k">复审期冻结金额</div><div className="v">${fmt(K_RISK.reviewFrozenUsd / 1000)}K</div><div className="sub">对应提现单在 D2 冻结中</div></div>
      </div>

      {/* 触发线(PRD K5③ 四参数) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">触发线</span>
          <span className="sub">· 兑换相关的触发线归兑换风控(G2)配置,这里只消费兑换事件</span>
          <div className="r"><span className="kcode lock" title="兑换三阈值配置权威:G2(用户日 $50 / 平台日 $20K / 累计 $100)">🔒 兑换阈值归 G2 · 只读</span></div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {K5_PARAMS.map((p) => {
              const curV = ctx.pget(`K.k5.${p.key}`);
              return (
                <div className="p" key={p.key}>
                  <div className="k">{p.name}</div>
                  <div className="v">
                    {curV ?? p.val}
                    {p.unit ? <span className="vu">{p.unit}</span> : null}
                    {curV ? <span className="vu">· 原 {p.val}</span> : null}
                    <button className="l-btn sm mc" onClick={() => adjParam(p)} title={`PRD K5③ ${p.key}`}>调整</button>
                  </div>
                  <div className="s">{p.sub}</div>
                </div>
              );
            })}
          </div>
          <div className="ktint" style={{ marginTop: 12, fontSize: 12 }} title="PRD K5③:regionEscalationEnabled 不纳入 V1 可控参数表">
            <b>暂不上线的触发项</b> · 「按地区升级触发」目前只是用户端说明页的文案,服务端没有对应规格 —— 没有规格背书的参数不进生产,等规格确认后再补进这张表。
          </div>
        </div>
      </section>

      {/* 复审触发队列 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">复审触发队列</span>
          <span className="sub">· 点任意一行看工单 · 时限条变红 = 快超时</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["大额提现", "大额提现"], ["大额兑换", "大额兑换"], ["累计过线", "累计过线"], ["overdue", "已超时"]] as const).map(([v, lb]) => (
                <button key={v} className={`chip${filter === v ? " sel" : ""}`} onClick={() => setFilter(v as Filter)}>{lb}</button>
              ))}
            </div>
            <button className="l-btn" onClick={manualTrigger}>手动补触发</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>工单</th><th>触发类型</th><th>账户</th><th className="num">金额 / 累计</th><th>实名状态(C4)</th><th>复审状态</th><th>时限</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {visible.map((t) => {
                const st = liveSt(t);
                const [stLb, stTone] = TICKET_ST[st];
                const open = st !== "passed" && st !== "rejected";
                return (
                  <tr key={t.id} className="click" onClick={() => setSel(t.id)} style={st === "overdue" ? { background: "var(--danger-soft)" } : undefined}>
                    <td className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{t.id}</td>
                    <td><span className="bdg dim">{t.type}</span></td>
                    <td className="mono">{t.user}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{t.amt !== "—" ? t.amt : t.cum}</td>
                    <td style={{ fontSize: 12 }}>{t.kyc}</td>
                    <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                    <td>
                      <span className="sla">
                        <span className="track"><i style={{ width: `${t.slaPct * 100}%`, background: slaColor(t.slaPct) }} /></span>
                        <span className="t" style={{ color: slaColor(t.slaPct) }}>{t.slaTxt}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {open ? (
                        <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          <button className="l-btn sm mc" onClick={() => decide(t, true)}>通过</button>
                          <button className="l-btn sm mc" onClick={() => decide(t, false)}>驳回</button>
                        </span>
                      ) : (
                        <span className="bdg dim">已裁决</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="sm-strip">
            <span className="st">triggered 已触发</span><span className="ar">→</span>
            <span className="st warn">in-review 复审中(提现单同步冻结)</span><span className="ar">操作确认 →</span>
            <span className="st ok">passed 通过(解冻)</span>
            <span className="ar" style={{ marginLeft: 10 }}>操作确认 →</span>
            <span className="st bad">rejected 驳回(维持冻结 · 走退回流程)</span>
          </div>
        </div>
      </section>

      {/* 工单详情 + 告警 */}
      <div className="two-col r14">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">复审工单 · {cur.id}</span>
            <span className="sub">· 材料引用自实名服务商 · 裁决回写用户域</span>
            <div className="r">
              {curSt !== "passed" && curSt !== "rejected" ? (
                <>
                  <button className="l-btn mc" onClick={() => decide(cur, true)}>通过(操作确认)</button>
                  <button className="l-btn mc" onClick={() => decide(cur, false)}>驳回(操作确认)</button>
                </>
              ) : (
                <span className={`bdg ${TICKET_ST[curSt][1]}`}>{TICKET_ST[curSt][0]}</span>
              )}
            </div>
          </div>
          <div className="tk-split">
            <div>
              {cur.info.map((kv) => (
                <div className="kv2" key={kv[0]}><span className="k">{kv[0]}</span><span className="v">{kv[1]}</span></div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--ink)" }}>复审历史</div>
              {cur.hist.map((h, i) => (
                <div className="alert-row" key={i}>
                  <span className="d3" style={{ background: h[2] === "bad" ? "var(--danger)" : h[2] === "warn" ? "var(--warning)" : "var(--ink-4)" }} />
                  <div className="tx">{h[1]}</div>
                  <span className="ts">{h[0]}</span>
                </div>
              ))}
              {(curSt === "passed" || curSt === "rejected") && (
                <div className="alert-row">
                  <span className="d3" style={{ background: curSt === "passed" ? "var(--success)" : "var(--danger)" }} />
                  <div className="tx"><b>{curSt === "passed" ? "复审通过 · 回写 C4 · 提现解冻" : "复审驳回 · 回写 C4 · 维持冻结"}</b></div>
                  <span className="ts">刚刚</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">异常告警</span>
            <span className="sub">· 命中 / 超时 / 批量集中</span>
            <div className="r"><button className="l-btn sm" onClick={subAlert}>订阅配置</button></div>
          </div>
          <div className="l-b">
            {K5_ALERTS.map((a) => (
              <div className="alert-row" key={a[1] + a[3]}>
                <span className="d3" style={{ background: a[0] === "bad" ? "var(--danger)" : "var(--warning)" }} />
                <div className="tx"><b>{a[1]}</b> · {a[2]}</div>
                <span className="ts">{a[3]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="f-foot">
        <b>裁决怎么生效</b>:通过 → 实名状态回写用户域(C4),对应提现单解冻回到正常流;驳回 → 维持冻结,走退回 / 驳回路径。裁决请求自带防重号,网络抖动不会重复回写。<b>执行门槛</b>:风控 lead / 平台管理员可执行裁决,执行前必须填写理由;风控成员只能补材料和提交建议。实名材料、钱包配对这些真值全在服务器,客户端改本地状态没用。触发事件喂提现队列(D2 冻结闭环)和用户域(C4 复审升级)。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "复审触发队列",
            maxRows: 4,
            reason: "复审触发队列当前四条样本,裁决动作进入 C4/K5 同源状态",
          },
        ]}
      />
    </div>
  );
}
