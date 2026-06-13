"use client";

/**
 * H1 Phase 调度器 — 12 月 × 10 旋钮节奏的逐值权威面(SPEC §4 H1)。
 *
 * 5 段(严格按设计稿 DOM 顺序):
 *  (a) 顶部 4 张 f-stat KPI(本组件自渲染 H1_STATS · 与 H2/H3/H5 一致;沙盒预览按钮放此段右上);
 *  (b) 12 月 × 10 旋钮 dial 矩阵(.dial-tbl):
 *      - 当前月(H1_STATS.currentMonth = 7)整行 .cur 高亮;
 *      - 单元格 cur = pget(`H1.dial.<key>.m<N>`) ?? DIAL_MATRIX[N-1][col];
 *      - 与上月不同值 chg 黄色高亮(参考上月也走 pget 单源,改值会真实流动);
 *      - 点击单元格弹 操作确认,放松方向(LOOSEN_DIR 命中 + 方向符合)挂 amplifies=true 过 B1 红线;
 *      - NEW_USER_ONLY(newUser/invite)detail 加注「仅新用户;存量不回溯」;
 *      - onConfirm 写 `H1.dial.<k>.m<N>`,当 N === currentMonth 同时双写 `H.phase.dial.<k>`(D5/F3 实时镜像)。
 *  (c) Phase 切换控制 3 类(.p-row × 3):定时/pin/override 改三类走 操作确认 不挂 amplifies;
 *  (d) 生效中 override 台账(.p-row × N):每行带「撤销/解除」操作确认(不挂 amplifies,treated 作处置类);
 *      - 真写键 `H1.override.<id>.disabled` = "1",撤回带原因;
 *  (e) Phase 效果归因(.l-tbl):3 行只读 + 当前 P3 .cur 高亮 + 链接到 B4(/risk/health-monitor)。
 *
 * 真写键(全部 H1.* 单源):
 *  H1.dial.<key>.m<N> · H.phase.dial.<key>(currentMonth 镜像)·
 *  H1.ctl.{schedule,pin,override} · H1.override.<id>.disabled
 *
 * amplifies 触发(过 B1 100% 红线):
 *  - 矩阵格 + LOOSEN_DIR 命中(points/cooldown/binaryCap)+ 方向符合(数值类比较)。
 *
 * 与 D5(/funds/withdraw-params)+ F3 + G5/G6 同源:
 *  - 旧 h-view 沿用 H.phase.dial.<key>,D5 pget 同键(d5-params.tsx line 21);
 *  - 改 currentMonth 行的格会被 D5/F3 实时跟上(~60s 全网生效)。
 */
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import {
  H1_STATS,
  DIAL_KEYS,
  DIAL_LABELS,
  DIAL_MATRIX,
  LOOSEN_DIR,
  NEW_USER_ONLY,
  PHASE_CONTROLS,
  PHASE_OVERRIDES,
  PHASE_ATTRIBUTION,
  monthToPhase,
  type DialKey,
} from "./data";
import type { HCtx } from "./types";

/** 数值比较(放松方向需要数值上行/下行判定;非数值如「是/否」直接放行 amplifies)。 */
function isLoosenDirection(key: DialKey, before: string, after: string): boolean {
  const dir = LOOSEN_DIR[key];
  if (!dir) return false;
  const a = parseFloat(before);
  const b = parseFloat(after);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return dir === "down" ? b < a : b > a;
}

/** 与上月对比(同源 pget 链);用于 chg 高亮。 */
function isChanged(prev: string, cur: string): boolean {
  return String(prev) !== String(cur);
}

export default function H1Phase({ ctx }: { ctx: HCtx }) {
  const { pget, setParam, toast, openActionConfirm, logAudit } = ctx;

  // 单元格 cur 取值:优先 pget(`H1.dial.<k>.m<N>`),fallback 设计稿 DIAL_MATRIX。
  const getCell = (m1: number, col: number): string => {
    const key = DIAL_KEYS[col];
    const seed = String(DIAL_MATRIX[m1 - 1][col]);
    return pget(`H1.dial.${key}.m${m1}`) ?? seed;
  };

  /** 改单元格 = 真写 + 当前月同步 H.phase.dial.<k>(D5/F3 镜像)。 */
  const openCellMc = (m1: number, col: number) => {
    const key = DIAL_KEYS[col];
    const label = DIAL_LABELS[key];
    const cur = getCell(m1, col);
    const newOnly = NEW_USER_ONLY.includes(key);
    const dirHint = LOOSEN_DIR[key]; // 提案打开时还不知道改后值,先给出"该项放松方向 = X"提示
    const isCurrentMonth = m1 === H1_STATS.currentMonth;

    openActionConfirm({
      action: `改旋钮 · 月 ${m1} · ${label.name}`,
      detail: (
        <>
          <b>当前值 {cur}</b>{label.unit ? ` ${label.unit}` : ""} · 生效范围:
          <b>{newOnly ? "仅新用户(存量锁定基数不回溯)" : "实时全量"}</b>,提案与审计固化此范围。
          {dirHint && (
            <>
              {" "}<b>注意:往放松方向({dirHint === "down" ? "降值" : "升值"})改 = 放大资金流出</b>,
              提交时服务器核验备付金覆盖率(当前 {H1_STATS.coverageRatio}% &gt; 红线 {H1_STATS.redlinePct},可过);
              低于红线会被直接拒绝(422)。<b>实际方向 server 收到新值后二次精算</b> —
              若改成收紧方向(如冷却 30 → 45)则 B1 闸不挂、不阻拦;UI 弹窗这里展示的红线 banner 是
              悲观假设的合规预提示,不等同于真实拦截。
            </>
          )}
          {" "}建议先沙盒预览下游影响(D5 提现 / F3 双轨 / G5/G6 订阅锁仓)。
          {isCurrentMonth && (
            <>
              {" "}<b>当前月格:本月生效值同步刷新</b>,D5 提现页镜像 ~60s 内随之走。
              (F3/G5/G6 V3 接线前为声明意图,真消费由 D5 单家承担,见 d5-params.tsx pget。)
            </>
          )}
        </>
      ),
      // 放松方向命中 + 数值类项即挂 amplifies(B1 红线核验);非数值「是/否」类不挂(开闸属治理类,SPEC §4 走治理而非红线)。
      amplifies: !!dirHint,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        // 二次精算放松方向(用户实际输入后再判;比 amplifies 弹窗时的悲观假设更精确)。
        const trulyLoosen = isLoosenDirection(key, cur, v);
        setParam(`H1.dial.${key}.m${m1}`, v, {
          action: `H1 dial 改值 · 月 ${m1} · ${label.name}`,
          reason,
        });
        // 当前月格 = D5/F3 当下消费的派发现值,必须同步双写,否则下游展示与本表脱钩。
        if (isCurrentMonth) {
          setParam(`H.phase.dial.${key}`, v, {
            action: `H1 当月派发同步 · ${label.name}`,
            reason: `${reason}(当月格同步 D5/F3 镜像)`,
          });
        }
        toast(
          `· 月 ${m1} ${label.name} 已改为 ${v}${
            trulyLoosen ? " · 放松方向已过 B1 覆盖率核验" : ""
          }${isCurrentMonth ? " · 当月生效,~60s 全网" : " · 待该月推进后生效"}`,
        );
      },
    });
  };

  /** Phase 切换控制 3 类(定时/pin/override)+ override 台账撤销:统一走 操作确认,不挂 amplifies。 */
  const openCtlMc = (key: string, label: string, cur: string) => {
    openActionConfirm({
      action: `Phase 切换控制 · ${label}`,
      detail: (
        <>
          <b>{label}</b> · 当前:{cur}。钉住/偏移按注册周批次(YYYY-Www)生效,命中人群规模在提案里快照;
          全部保留前值可回滚。命中用户产 phase.transitioned(标注 cause:scheduled / pin / cohort_override)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (v != null) setParam(`H1.ctl.${key}`, v, { action: `H1 切换控制 ${label}`, reason });
        // 处置类 setParam 自动 log 仅记状态键写入,处置事件独立维度需显式 logAudit 二次留痕(D 域 R1 教训)。
        logAudit({ actor: "总管理员", action: `Phase 切换控制 · ${label}`, target: `H1.ctl.${key}`, reason });
        toast(`· ${label} 提案已提交 · 操作确认后生效`);
      },
    });
  };

  /** 撤销/解除 override:写 disabled 标记 + 不挂 amplifies(处置类)。 */
  const openOverrideRemoveMc = (id: string, cohort: string, desc: string) => {
    openActionConfirm({
      action: `撤销 override · ${cohort}`,
      detail: (
        <>
          <b>{cohort}</b> · {desc}。撤销后该批次回归全局阶段时间表(scheduled),
          phase.transitioned(cause: override_removed)留痕,可回滚至撤销前的 override 配置。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: "生效中" },
      run: (reason) => {
        setParam(`H1.override.${id}.disabled`, "1", { action: `撤销 override · ${cohort}`, reason });
        logAudit({ actor: "总管理员", action: "Phase override 撤销", target: `H1.override.${id}`, reason });
        toast(`· ${cohort} override 已撤销 · 批次回到 scheduled 时间表`);
      },
    });
  };

  /** (a) 沙盒预览(只读,不写库)— 设计稿顶部 CTA。 */
  const openSandbox = () => {
    ctx.openConfirm({
      action: "沙盒预览(只读 · 不写库)",
      detail: (
        <>
          选一组旋钮改动,推演下游影响:提现冷却 / 积分面(D5)、双轨封顶(F3)、Premium/NEXv2 开闸(G5/G6)、
          受影响用户规模、资金流出方向变化。示例:<b>月 7 复投加成 1→2</b> → 预估复投率 +4pt、周流出 +$180K、命中 31,200 人。
          <b>预览结果可一键转为正式提案进操作确认</b>;本步骤不写真配置,仅展示推演。
        </>
      ),
      chips: [["只读推演 · 不写库", "done"], ["可转正式提案", "ready"]],
      okLabel: "运行预览",
      run: () => toast("· 沙盒预览完成(示例)· 可转提案"),
    });
  };

  return (
    <>
      {/* (a) 顶部 4 张 f-stat KPI(本组件自渲,与 H2/H3/H5 一致)。 */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">当前运营月 / 阶段</div>
          <div className="v">月 {H1_STATS.currentMonth} · {H1_STATS.currentPhase}</div>
          <div className="sub">定时推进 · 每月 1 日 00:00 UTC</div>
        </div>
        <div className="f-stat">
          <div className="k">用户分布</div>
          <div className="v">{H1_STATS.globalRatio} 全局</div>
          <div className="sub">{H1_STATS.overrideRatio} 被批次覆盖 / 手动钉住</div>
        </div>
        <div className="f-stat ok">
          <div className="k">备付金红线核验</div>
          <div className="v">{H1_STATS.coverageRatio}%</div>
          <div className="sub">放松方向改动的前置门 · 红线 {H1_STATS.redlinePct}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">待确认提案</div>
          <div className="v">{H1_STATS.pendingProposals}</div>
          <div className="sub">放松方向需风控确认</div>
        </div>
      </div>

      {/* 顶部 CTA:沙盒预览(只读) */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="f-cta" onClick={openSandbox}>沙盒预览(只读)</button>
      </div>

      {/* (b) 12 月 × 10 旋钮 dial 矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">逐月旋钮矩阵(12 月 × 10 项 · 逐值权威)</span>
          <span className="sub">· 点任意单元格发起改值(操作确认)· 当前月高亮 · 黄色 = 与上月不同</span>
          <div className="r">
            <span className="bdg ok">约 60 秒内全网生效</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dial-tbl" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th>运营月</th>
                {DIAL_KEYS.map((k) => (
                  <th key={k} title={NEW_USER_ONLY.includes(k) ? "仅新用户" : undefined}>
                    {DIAL_LABELS[k].name}
                    {DIAL_LABELS[k].unit && DIAL_LABELS[k].unit !== "×" && (
                      <>
                        <br />
                        <span style={{ fontWeight: 400, fontSize: 10 }}>({DIAL_LABELS[k].unit})</span>
                      </>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIAL_MATRIX.map((_row, idx) => {
                const m1 = idx + 1;
                const isCur = m1 === H1_STATS.currentMonth;
                const phaseTag = monthToPhase(m1);
                return (
                  <tr key={m1} className={isCur ? "cur" : undefined}>
                    <td>
                      月 {m1}
                      {isCur && " · 当前"}{" "}
                      <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>{phaseTag}</span>
                    </td>
                    {DIAL_KEYS.map((key, col) => {
                      const cur = getCell(m1, col);
                      const prev = m1 > 1 ? getCell(m1 - 1, col) : cur;
                      const chg = m1 > 1 && isChanged(prev, cur);
                      return (
                        <td
                          key={key}
                          className={chg ? "chg" : undefined}
                          onClick={() => openCellMc(m1, col)}
                          title="点击改值(操作确认)"
                        >
                          {cur}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>¹ 生效范围</b> · 拉新/邀请加成只对改后新关系生效,存量按建立时锁定不回溯;其余 8 项实时全量生效。
            月 8 双拐点:冷却 35 天是 P4 末月细化,合规留存从 P5 起开启。
          </div>
        </div>
      </section>

      {/* (c)(d) 双列:Phase 切换控制 + 效果归因 */}
      <div className="two-col" style={{ marginBottom: 16 }}>
        {/* (c) Phase 切换控制 + (d) 生效中 override 台账 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">Phase 切换控制</span>
            <span className="sub">· 三种推进方式 · 全部操作确认可回滚</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {PHASE_CONTROLS.map((c) => {
              const cur = pget(`H1.ctl.${c.key}`) ?? c.current;
              return (
                <div className="p-row" key={c.key}>
                  <span style={{ flex: 1 }}>
                    <b>{c.name}</b>
                    <br />
                    <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{c.sub}</span>
                  </span>
                  <span className="bdg">{cur}</span>
                  <button
                    className="l-btn sm mc"
                    onClick={() => openCtlMc(c.key, c.name, cur)}
                  >
                    {c.key === "schedule" ? "改时间表" : c.key === "pin" ? "发起钉住" : "新增偏移"}
                  </button>
                </div>
              );
            })}

            {/* (d) 生效中 override 台账 */}
            <div style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 6px" }}>
              生效中的覆盖台账
            </div>
            {PHASE_OVERRIDES.map((o) => {
              const disabled = pget(`H1.override.${o.id}.disabled`) === "1";
              return (
                <div className="p-row" key={o.id}>
                  <span className="mono" style={{ fontSize: 12 }}>{o.cohort}</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--ink-3)" }}>
                    {o.desc}
                    {disabled && <span className="bdg dim" style={{ marginLeft: 8 }}>已撤销</span>}
                  </span>
                  <button
                    className="l-btn sm mc"
                    disabled={disabled}
                    onClick={() => openOverrideRemoveMc(o.id, o.cohort, o.desc)}
                  >
                    {disabled ? "已撤销" : o.id === "demo" ? "解除" : "撤销"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* (e) Phase 效果归因 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">Phase 效果归因</span>
            <span className="sub">· 漏斗与资金事件按阶段切片 · 喂节奏看板(B4)</span>
            <div className="r">
              <Link href="/risk/health-monitor" className="l-btn">
                去 B4 节奏看板 →
              </Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>阶段</th>
                  <th className="num">首购转化</th>
                  <th className="num">复投率</th>
                  <th className="num">周提现</th>
                  <th className="num">Day7 留存</th>
                </tr>
              </thead>
              <tbody>
                {PHASE_ATTRIBUTION.map((r) => (
                  <tr
                    key={r.phase}
                    style={r.cur ? { background: "rgba(255,107,53,.08)" } : undefined}
                  >
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>{r.phase}</td>
                    <td className="num mono">{r.first}</td>
                    <td className="num mono">{r.reinvest}</td>
                    <td className="num mono">{r.weekly}</td>
                    <td className="num mono">{r.d7}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            <div className="htint" style={{ fontSize: 12 }}>
              <b>读法</b> · 复投加成月 5–7(P3 整段) 开 2× 后复投率 21→26.9%;留存随收紧期下行,详见 I2/B4/L4。
            </div>
          </div>
        </section>
      </div>
      <PaginationExemptionList
        items={[
          {
            label: "逐月旋钮矩阵(12 月 × 10 项 · 逐值权威)",
            kind: "fixed-matrix",
            maxRows: 12,
            reason: "12 个月节奏矩阵必须同屏对比当前月和前后月,翻页会破坏横向校验",
          },
          {
            label: "Phase 效果归因",
            maxRows: 3,
            reason: "三阶段归因只读摘要,明细下钻到 B4/L4 报表",
          },
        ]}
      />
    </>
  );
}
