"use client";

/**
 * H2 免费试用引擎 — 试用转化漏斗(绑卡 → 影子收益 → 自动扣款 / 提前购)的控制面。
 *
 * 7 段(按设计稿 DOM + 任务规格):
 *  (a) 顶部 4 张 f-stat KPI(active sessions / 试用→购买率 / 抵扣上限 / 试用开放态);
 *  (b) Model A 拆分注释(.htint.cyan):
 *      offset = min(shadow, $50) 抵实付价(折扣不是负债,不入余额、不算负债);
 *      超 $50 的零头购买后入余额(bonus 账单);NEX 全额购后入 NEX 余额。
 *      server-canonical computeTrialOffset 单源。
 *  (c) 19 参数两段(单源 TRIAL_CONFIG;.l-card × 2):
 *      - 影响新 trial 段(section==="newonly"):机价 🔥 / 影子 / 天数等 3 项;敏感(hot=true)操作确认,非敏感 openConfirm reason 必填;
 *      - 实时生效段(section==="live"):抵扣上限 / failRate 🔥(serverOnly 显示「•••(server only)」)/ 早购 / hq / 冷却 / auto-push / autoCharge 🔥 等 7 项;
 *      - auto-push 行尾带「急停」按钮(openConfirm 急停 + 真写 H2.autoPushKilled = "1")。
 *  (d) 4 道前置闸(.l-card · TRIAL_GATES);
 *  (e) 7 态会话状态机 strip(.sm-strip):idle → active → grace → extended → redeemed / cancelled,失败 active → failed;
 *  (f) TRIAL_SESSIONS 4 行演示(.l-card · .l-tbl):列 sid / state / shadow / cardTok;
 *      行尾「强制取消 / 强制扣款」按钮 操作确认 + 真写 H2.cancel.<sid> / H2.charge.<sid>;
 *      两按钮 amplifies 不挂(SPEC §0:试用收益是折扣不是负债);Idempotency-Key 24h dedup 写在 detail;
 *  (g) 底部 .htint.warn:server-only 强调(failRate 永不下发前端 · auto-push 急停实时)。
 *
 * 真写键(全部 H2.*):
 *  H2.<key>(19 参数 · key = days/price/shadow/offsetCap/disc/hq/failRate/cooldown/push/autoCharge);
 *  H2.cancel.<sid> · H2.charge.<sid> · H2.autoPushKilled。
 *
 * amplifies = false(SPEC §0 注:试用收益是折扣不是负债;失败概率为内部参数,不挂 B1)。
 */
import { H2_STATS, TRIAL_CONFIG, SS_STATE, TRIAL_SESSIONS, TRIAL_GATES, type TrialParam, type SsState } from "./data";
import { PaginationExemptionList } from "../design-kit";
import type { HCtx } from "./types";

/** 行尾「调整」按钮:hot=true → 操作确认;其余 → openConfirm 直改 + 原因必填。 */
function ParamRow({ ctx, p }: { ctx: HCtx; p: TrialParam }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm, logAudit } = ctx;
  const cur = pget(`H2.${p.key}`) ?? p.cur;
  const hotNote = p.serverOnly
    ? "该值为平台内部参数,永不下发到用户界面 —— UI 显示为遮罩,只走服务端裁决。"
    : p.key === "autoCharge"
      ? "关掉=停止自动扣款,直接影响资金,按敏感项操作确认。生效时机(实时 / 仅新试用)未确认,落地前找 PM 拍板。"
      : "敏感项直接影响资金或定价 · 操作确认。重复提交不会重复生效。";
  const liveNote = p.section === "live"
    ? "实时生效项,每次结算 / 渲染读最新值。"
    : "只影响新开试用,进行中会话按开始时锁定值结算,不回溯。";
  const editKind = p.key === "autoCharge" ? "select" : "text";
  const options = p.key === "autoCharge" ? ["开", "关"] : undefined;

  if (p.hot) {
    return (
      <div className="p-row" key={p.key}>
        <div className="k">
          {p.name}
          {p.sub && <small>{p.sub}</small>}
        </div>
        <span className="v">{cur}</span>
        <button
          className="l-btn sm mc"
          onClick={() => openActionConfirm({
            action: `试用敏感参数 · ${p.name}`,
            detail: (
              <>
                <b>{p.name}</b> · 当前 <span className="mono">{cur}</span> · {hotNote} {liveNote}
              </>
            ),
            amplifies: false,
            edit: { kind: editKind, current: cur, options },
            run: (reason, v) => {
              if (v != null) setParam(`H2.${p.key}`, v, { action: `H2 敏感参数 · ${p.name}`, reason });
              toast(`· ${p.name} 已提交操作确认${v ? ` · 新值 ${v}` : ""}`);
            },
          })}
        >调整</button>
      </div>
    );
  }
  return (
    <div className="p-row" key={p.key}>
      <div className="k">
        {p.name}
        {p.sub && <small>{p.sub}</small>}
      </div>
      <span className="v">{cur}</span>
      <button
        className="l-btn sm"
        onClick={() => openConfirm({
          action: `试用参数 · ${p.name}`,
          detail: (
            <>
              <b>{p.name}</b> · 当前 <span className="mono">{cur}</span> · 非敏感项,增长可直改但<b>修改原因必填</b>,落 admin.trial_config_changed 审计。{liveNote}
            </>
          ),
          chips: [["单人直改 · 原因必填", "ready"], ["落审计", "done"]],
          reason: true,
          input: { label: "目标新值", placeholder: `当前 ${cur}` },
          okLabel: "确认修改",
          run: (reason, v) => {
            if (v != null && v.trim().length > 0) {
              setParam(`H2.${p.key}`, v, { action: `H2 试用参数 · ${p.name}`, reason });
            }
            toast(`· ${p.name} 已改为 ${v && v.trim().length > 0 ? v : cur} · 原因留痕`);
          },
        })}
      >调整</button>
    </div>
  );
}

export function H2Trial({ ctx }: { ctx: HCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm, logAudit } = ctx;
  const pushKilled = pget("H2.autoPushKilled") === "1";

  const newonly = TRIAL_CONFIG.filter((p) => p.section === "newonly");
  const live = TRIAL_CONFIG.filter((p) => p.section === "live");

  /** 强制取消 / 强制扣款 — 单会话处置,操作确认 + 真写,amplifies 不挂(试用收益是折扣不是负债)。 */
  const openSessionCancel = (sid: string) => {
    openActionConfirm({
      action: `强制取消试用 · ${sid}`,
      detail: (
        <>
          风控介入场景(疑似养号 / 风险卡)。会话转 <b>cancelled</b> 终态、影子收益归零不入账,原因记 <span className="mono">forced_admin</span>(K2 自动联动记 <span className="mono">risk_auto</span>)。
          操作确认 + 留痕。<b>Idempotency-Key 24h dedup</b> · 重复提交不会重复生效。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        setParam(`H2.cancel.${sid}`, String(Date.now()), { action: `H2 强制取消试用 · ${sid}`, reason });
        logAudit({ actor: "总管理员", action: "强制取消试用会话", target: `H2.session.${sid}`, reason });
        toast(`· ${sid} 已强制取消 · 影子归零`);
      },
    });
  };

  const openSessionCharge = (sid: string) => {
    openActionConfirm({
      action: `强制触发扣款 · ${sid}`,
      detail: (
        <>
          用于测试扣款链路 / 应急结算。<b>Idempotency-Key 24h dedup</b> · 重复请求不会重复扣;结算按平台重算的拆分
          (全价 − 收益抵扣 min(shadow, $50),不打早购折扣),不收页面传的数。操作确认 + 留痕。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        setParam(`H2.charge.${sid}`, String(Date.now()), { action: `H2 强制触发扣款 · ${sid}`, reason });
        logAudit({ actor: "总管理员", action: "强制触发试用扣款", target: `H2.session.${sid}`, reason });
        toast(`· ${sid} 扣款已触发 · 重复请求不重复扣`);
      },
    });
  };

  /** auto-push 急停 — openConfirm 实时止血 + 真写 H2.autoPushKilled = "1"。 */
  const openPushKill = () => {
    openConfirm({
      action: "auto-push 急停",
      detail: (
        <>
          立即关停试用的自动推送(<span className="mono">autoPushEnabled = false</span>,实时生效),异常时快速止血用。
          写原因留痕,恢复时再开。
        </>
      ),
      chips: [["实时急停", "ready"], ["落审计", "done"]],
      reason: true,
      okLabel: "确认急停",
      run: (reason) => {
        setParam("H2.autoPushKilled", "1", { action: "H2 auto-push 急停", reason });
        logAudit({ actor: "总管理员", action: "auto-push 急停", target: "H2.autoPushKilled", reason });
        toast("· auto-push 已急停 · 留痕");
      },
    });
  };

  return (
    <>
      {/* (a) 顶部 4 张 f-stat KPI */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">进行中会话</div>
          <div className="v">{H2_STATS.activeSessions.toLocaleString()}</div>
          <div className="sub">
            试用中 {H2_STATS.inTrial.toLocaleString()} · 宽限 {H2_STATS.inGrace.toLocaleString()} · 延长 {H2_STATS.inExtended.toLocaleString()}
          </div>
        </div>
        <div className="f-stat ok">
          <div className="k">试用→购买率</div>
          <div className="v">{H2_STATS.trialBuyRate}</div>
          <div className="sub">喂 B3 漏斗子路径 · 不并入 KPI #4</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">抵扣上限 / 早购折扣</div>
          <div className="v">{pget("H2.offsetCap") ?? "$50"}</div>
          <div className="sub">
            绑卡转化 {H2_STATS.bindCardRate} · 提前购 {H2_STATS.earlyBuyRate} · 复活 {H2_STATS.reviveRate}
          </div>
        </div>
        <div className="f-stat danger">
          <div className="k">循环养号阻断(K2)</div>
          <div className="v">{H2_STATS.k2Blocked} 人</div>
          <div className="sub">资格被服务器关闭 · 簇联动</div>
        </div>
      </div>

      {/* (b) Model A 拆分注释 */}
      <div className="htint cyan" style={{ marginBottom: 16 }}>
        <b>Model A · 结算怎么拆</b> · 进入「已购买」终态时服务器把累计影子收益拆两半:
        <b> 抵扣部分 = min(累计 shadow, $50)</b> 直接抵实付价(<b>是折扣,不入余额、不算负债</b>);
        只有超出 $50 的零头购买后进余额(记 bonus 账单);<b>NEX 部分不抵美元标价</b>,购后全额进 NEX 余额。
        主动早购走二次确认弹窗(展示全价 / 促销 / 抵扣 / 实付拆解);到期自动扣款不打折、合规靠绑卡页披露 + 剩 1 小时推送。
        全程 <span className="mono">computeTrialOffset</span> 在服务端事务里重算,客户端不参与口径。
      </div>

      {/* (c) 19 参数两段 */}
      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 只影响新开</span>
            <span className="sub">· 进行中按开始时锁定 · 高敏 🔥 走操作确认 · 其余直改必填原因</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {newonly.map((p) => (
              <ParamRow ctx={ctx} p={p} key={p.key} />
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 实时生效</span>
            <span className="sub">· 每次结算 / 渲染读最新值 · 高敏 🔥 走操作确认</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={openPushKill} disabled={pushKilled}>
                {pushKilled ? "auto-push 已急停" : "auto-push 急停"}
              </button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {live.map((p) => (
              <ParamRow ctx={ctx} p={p} key={p.key} />
            ))}
          </div>
        </section>
      </div>

      {/* (d) 4 道前置闸 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">四道前置闸</span>
          <span className="sub">· 资格 / 冷却 / K2 / 幂等 · 全在服务器裁决,客户端绕不过</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {TRIAL_GATES.map((g) => (
            <div className="p-row" key={g.gate}>
              <div className="k">
                {g.gate}
                <small>{g.note}</small>
              </div>
              <span className="bdg cyan">已挂闸</span>
            </div>
          ))}
        </div>
      </section>

      {/* (e) 7 态会话状态机 strip */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">7 态会话状态机</span>
          <span className="sub">· 状态只能服务器推进 · 客户端不能写</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="sm-strip">
            <span className={`st ${SS_STATE.idle[1]}`}>{SS_STATE.idle[0]}</span>
            <span className="ar">绑卡 →</span>
            <span className={`st ${SS_STATE.active[1]}`}>{SS_STATE.active[0]} 累积中</span>
            <span className="ar">到期 →</span>
            <span className={`st ${SS_STATE.grace[1]}`}>{SS_STATE.grace[0]}(冻结)</span>
            <span className="ar">高质量 →</span>
            <span className={`st ${SS_STATE.extended[1]}`}>{SS_STATE.extended[0]}</span>
            <span className="ar">购买 →</span>
            <span className={`st ${SS_STATE.redeemed[1]}`}>{SS_STATE.redeemed[0]} · 终态拆分入账</span>
            <span className={`st ${SS_STATE.failed[1]}`} style={{ marginLeft: 8 }}>{SS_STATE.failed[0]}</span>
            <span className={`st ${SS_STATE.cancelled[1]}`} style={{ marginLeft: 4 }}>{SS_STATE.cancelled[0]} · 归零</span>
          </div>
        </div>
      </section>

      {/* (f) TRIAL_SESSIONS 4 行演示 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">会话监控(演示 4 行)</span>
          <span className="sub">· 点行强制介入 · 强制取消 / 扣款走 操作确认 + Idempotency-Key 24h dedup</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>账户</th>
                <th>状态</th>
                <th className="num">影子累计</th>
                <th>卡 token</th>
                <th style={{ textAlign: "right" }}>强制介入</th>
              </tr>
            </thead>
            <tbody>
              {TRIAL_SESSIONS.map((s) => {
                const st = SS_STATE[s.state as SsState];
                const cancelled = pget(`H2.cancel.${s.sid}`);
                const charged = pget(`H2.charge.${s.sid}`);
                const terminal = s.state === "cancelled" || s.state === "redeemed";
                return (
                  <tr key={s.sid}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{s.sid}</td>
                    <td><span className={`bdg ${st[1]}`}>{st[0]}</span></td>
                    <td className="num mono">{s.shadow}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{s.cardTok}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {terminal ? (
                        <span style={{ color: "var(--ink-4)" }}>—</span>
                      ) : (
                        <>
                          <button
                            className="l-btn sm mc"
                            disabled={!!cancelled}
                            onClick={() => openSessionCancel(s.sid)}
                            style={{ marginRight: 6 }}
                          >
                            {cancelled ? "已取消" : "强制取消"}
                          </button>
                          <button
                            className="l-btn sm mc"
                            disabled={!!charged}
                            onClick={() => openSessionCharge(s.sid)}
                          >
                            {charged ? "已扣款" : "强制扣款"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* (g) 底部 server-only 强调 */}
      <div className="htint warn">
        <b>server-canonical 三条铁线</b> · ① <b>扣款失败概率 failRate 永不下发前端</b>:
        UI 显示遮罩 <span className="mono">•••(server only)</span>,改值经 操作确认写入服务端,客户端响应永远拿不到这个数;
        ② <b>auto-push 急停实时</b>:写键 <span className="mono">H2.autoPushKilled = &quot;1&quot;</span> 后所有渲染回路下一拍即停;
        ③ <b>Idempotency-Key 24h dedup</b> 在所有 charge / cancel 入口生效,重复请求只生效一次。
      </div>

      <p className="f-foot">
        <b>四道闸 + Model A 拆分</b> · ① 资格统一裁决(冷却 / 阶段未开 / 养号都开不了);
        ② 30 天冷却不可绕(K2 簇命中跨号生效);③ 养号信号来自 K2;④ 扣款幂等(Idempotency-Key 24h dedup)。
        漏斗五项喂 B3。<b>试用收益是折扣不是负债</b>,所以本页两类处置(强制取消 / 强制扣款)<b>amplifies 不挂</b> B1 红线;
        敏感参数(机价 🔥 / failRate 🔥 / autoCharge 🔥)走 操作确认,其余非敏感参数直改但必填原因写审计。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "会话监控(演示 4 行)",
            maxRows: 4,
            reason: "试用会话监控仅保留四条状态机样本,完整漏斗进 B3/L2",
          },
        ]}
      />
    </>
  );
}

export default H2Trial;
