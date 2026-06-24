"use client";

/**
 * H1 Phase 调度器 — 12 月 × 8 旋钮节奏的逐值权威面(SPEC §4 H1)。
 *
 * 6 段(严格按设计稿 DOM 顺序 + 节奏骨架):
 *  (a) 顶部 4 张 f-stat KPI(本组件自渲染 H1_STATS · 与 H2/H3/H5 一致;沙盒预览按钮放此段右上);
 *  (a2) 节奏骨架(运营可配):节奏总时长(select 9/12/15/18/24)+ 当前节奏位置(multi-field:当前月 select + 阶段进度 %);
 *       真源 rhythmState(pget) ← H1.rhythm.{totalMonths,currentMonth,phaseProgressPct};B4 看板 / L1 / L4 / 首页 pulse 同源镜像,绝不抄快照;
 *  (b) 逐月 × 8 旋钮 dial 矩阵(.dial-tbl · 行数 = rs.totalMonths):
 *      - 当前月(rs.currentMonth,运营可配)整行 .cur 高亮;
 *      - 单元格 cur = dialValueAt(pget,key,N) 单源(逐月 override ?? DIAL_MATRIX,超 12 月回退末行);
 *      - 与上月不同值 chg 黄色高亮(参考上月也走 pget 单源,改值会真实流动);
 *      - 点击单元格弹 操作确认,放松方向(LOOSEN_DIR 命中 + 方向符合)挂 amplifies=true 过 B1 红线;
 *      - NEW_USER_ONLY(newUser/invite)detail 加注「仅新用户;存量不回溯」;
 *      - onConfirm 只写 `H1.dial.<k>.m<N>`;D5/F3 经 dialValueAt(@当前月)即时同源派生,无镜像双写(旧 H.phase.dial 2026-06-24 audit 废)。
 *  (c) Phase 切换控制 3 类(.p-row × 3):定时/pin/override 改三类走 操作确认 不挂 amplifies;
 *  (d) 生效中 override 台账(.p-row × N):每行带「撤销/解除」操作确认(不挂 amplifies,treated 作处置类);
 *      - 真写键 `H1.override.<id>.disabled` = "1",撤回带原因;
 *  (e) Phase 效果归因(.l-tbl):3 行只读 + 当前阶段 .cur 高亮(按 rs.currentPhase 匹配 code,非固定 P3)+ 链接到 B4(/risk/health-monitor)。
 *
 * 真写键(全部 H1.* 单源):
 *  H1.rhythm.{totalMonths,currentMonth,phaseProgressPct}(节奏骨架,运营可配 · 全站同源)·
 *  H1.dial.<key>.m<N>(逐月旋钮)· H1.ctl.{schedule,pin,override} · H1.override.<id>.disabled
 *
 * amplifies 触发(过 B1 100% 红线):
 *  - 矩阵格 + LOOSEN_DIR 命中(nexGate/cooldown/binaryCap)+ 方向符合(数值类比较)。
 *
 * 与 D5(/funds/withdraw-params)+ F3 同源(2026-06-24 audit 改派生):
 *  - D5 提现派发三项 / F3 双轨日封顶经 dialValueAt(pget, key, rs.currentMonth) 直接读逐月矩阵@当前月;
 *  - 改当前月 / 总时长 / 当前月格的值,D5/F3 即时同源跟随(不走旧 H.phase.dial 镜像快照,无键名错配)。
 */
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import {
  H1_STATS,
  DIAL_KEYS,
  DIAL_LABELS,
  LOOSEN_DIR,
  NEW_USER_ONLY,
  PHASE_CONTROLS,
  PHASE_LABELS,
  PHASE_OVERRIDES,
  PHASE_ATTRIBUTION,
  monthToPhase,
  dialValueAt,
  type DialKey,
} from "./data";
import { rhythmState, RHYTHM_TOTAL_OPTIONS } from "@/lib/mock/admin/command-center";

// Phase 切换控制可枚举项 → 勾选不手输:pin 钉到哪个阶段(P1..P6 有限集)。
// schedule 含可配置推进时刻(cron)/ override 为复合偏移(±N 月 + 批次),均保留自由 text。
const PHASE_CTL_OPTIONS: Record<string, string[]> = {
  pin: ["未钉住", ...PHASE_LABELS],
};
import type { HCtx } from "./types";
import { usePropose } from "@/lib/admin/use-propose";

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
  const propose = usePropose();
  // 节奏骨架 live 单源(运营可配 H1.rhythm.*;seed 回退)。当前月 / 总时长 / 当前阶段 / 阶段进度全由此派生。
  const rs = rhythmState(pget);

  // 单元格 cur 取值 = dialValueAt 单源(逐月 override ?? DIAL_MATRIX,超 12 月回退末 seed 行);D5/F3 当前派发值同走此源。
  const getCell = (m1: number, col: number): string => dialValueAt(pget, DIAL_KEYS[col], m1);

  /** 改单元格 = 真写 + 当前月同步 H.phase.dial.<k>(D5/F3 镜像)。 */
  const openCellMc = (m1: number, col: number) => {
    const key = DIAL_KEYS[col];
    const label = DIAL_LABELS[key];
    const cur = getCell(m1, col);
    const newOnly = NEW_USER_ONLY.includes(key);
    const dirHint = LOOSEN_DIR[key]; // 提案打开时还不知道改后值,先给出"该项放松方向 = X"提示
    const isCurrentMonth = m1 === rs.currentMonth;

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
          {" "}建议先沙盒预览下游影响(D5 提现 / F3 双轨)。
          {isCurrentMonth && (
            <>
              {" "}<b>当前月格:本月生效值即时刷新</b>,D5 提现派发(冷却 / 惩罚费率 / 合规)与 F3 双轨日封顶随之走
              —— 它们同源派生自本月矩阵(dialValueAt @ 当前月),非缓存镜像。
            </>
          )}
        </>
      ),
      // 放松方向命中 + 数值类项即挂 amplifies(B1 红线核验);非数值「是/否」类不挂(开闸属治理类,SPEC §4 走治理而非红线)。
      amplifies: !!dirHint,
      // compliance(合规留存)旋钮值是「是/否」二元枚举,勾选不手输;其余 7 旋钮为开放数值保留 text。
      edit: key === "compliance" ? { kind: "select", current: cur, options: ["是", "否"] } : { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        // 二次精算放松方向(用户实际输入后再判;比 amplifies 弹窗时的悲观假设更精确)。
        const trulyLoosen = isLoosenDirection(key, cur, v);
        // 逐月旋钮单源:只写 H1.dial.<key>.m<N>。当 N=当前月时,D5/F3 经 dialValueAt(@当前月)即时读到该值,
        // 无需再双写 H.phase.dial 镜像(旧镜像 2026-06-24 audit 已废:改当前月不跟 + D5 键名错配)。
        const mutations = [
          { key: `H1.dial.${key}.m${m1}`, value: v, action: `H1 dial 改值 · 月 ${m1} · ${label.name}` },
        ];
        // 按执行门槛分流:Phase dial 调整 = 增长 lead/超管;非授权身份发起则入 A2 pending 提案。
        propose(toast, {
          action: `Phase dial 调整 · 月 ${m1} · ${label.name}`,
          obj: `H1 · ${label.name} · 月 ${m1}${isCurrentMonth ? "(当月)" : ""}`,
          before: cur,
          after: v,
          type: "param",
          amplifies: trulyLoosen,
          gate: { roles: ["growth"], requireLead: true },
          gateLabel: "增长 lead / 超管",
          reason,
          mutations,
          sourceDomain: "H1",
        });
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
      edit: PHASE_CTL_OPTIONS[key] ? { kind: "select", current: cur, options: PHASE_CTL_OPTIONS[key] } : { kind: "text", current: cur },
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
      // 处置类(撤销 override):无「目标新值」可填(run 不消费 v),按 MC 显式 edit 契约不传 edit,避免强迫运营手输被忽略的「生效中」串。
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
          选一组旋钮改动,推演下游影响:提现冷却 / 提现惩罚费率(D5)、双轨封顶(F3)、
          受影响用户规模、资金流出方向变化。示例:<b>月 7 复投加成 1→2</b> → 预估复投率 +4pt、周流出 +$180K、命中 31,200 人。
          <b>预览结果可一键转为正式提案进操作确认</b>;本步骤不写真配置,仅展示推演。
        </>
      ),
      chips: [["只读推演 · 不写库", "done"], ["可转正式提案", "ready"]],
      okLabel: "运行预览",
      run: () => toast("· 沙盒预览完成(示例)· 可转提案"),
    });
  };

  /** 节奏总时长(月)——运营可配,写 H1.rhythm.totalMonths 单源。改后矩阵行数 + 阶段分布随之变。 */
  const openTotalMonthsMc = () => {
    openActionConfirm({
      action: "节奏总时长",
      detail: (
        <>
          当前 <b>{rs.totalMonths} 个月</b>运营节奏(P1 拉新 → P6 软退场)。改总时长后:逐月旋钮矩阵行数随之增减,
          6 个 Phase 按月数权重等比重重分布(默认 12 月 = P1·2 / P2·2 / P3·3 / P4·1 / P5·2 / P6·2)。
          {" "}<b>当前运营月超出新总时长会自动收到末月</b>。B4 节奏看板 / L 域 KPI / 首页脉搏同步刷新。
        </>
      ),
      amplifies: false,
      // 枚举档位,勾选不手输。
      edit: { kind: "select", current: String(rs.totalMonths), options: RHYTHM_TOTAL_OPTIONS.map(String) },
      run: (reason, v) => {
        if (!v) return;
        const next = Number(v);
        if (!Number.isFinite(next) || next <= 0) return;
        setParam("H1.rhythm.totalMonths", String(next), { action: "节奏总时长调整", reason });
        // 当前月超界 → clamp 到新末月,避免 currentMonth > total 的不一致。
        if (rs.currentMonth > next) {
          setParam("H1.rhythm.currentMonth", String(next), { action: "当前运营月随总时长 clamp", reason });
        }
        logAudit({ actor: "总管理员", action: "节奏总时长调整", target: "H1.rhythm.totalMonths", reason });
        toast(`· 节奏总时长已改为 ${next} 个月 · 已记审计`);
      },
    });
  };

  /** 当前节奏位置(当前月 + 本阶段进度)——一组相关值,多字段弹窗,各值独立写 H1.rhythm.* 单源。 */
  const openCurrentPosMc = () => {
    openActionConfirm({
      action: "当前节奏位置",
      detail: (
        <>
          设定平台当前走到第几月、本阶段进行到多少。当前 <b>第 {rs.currentMonth}/{rs.totalMonths} 月 · {rs.currentPhase} {rs.currentPhaseName}</b>,
          本阶段已进行 <b>{rs.phaseProgressPct}%</b>。月份与阶段由权重派生联动;改后 B4 看板 / H1 矩阵当前月高亮 / L 域 KPI / 首页脉搏全部跟随。
          {" "}(真后台由 cron 每月 1 日自动 +1 月;此处为手动设定 / 校准入口。)
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "multi-field",
        title: "当前节奏位置",
        hint: "当前运营月为有限集(勾选);本阶段进度为开放数值(0–100)。",
        fields: [
          {
            key: "currentMonth",
            label: "当前运营月",
            inputKind: "select",
            current: String(rs.currentMonth),
            options: Array.from({ length: rs.totalMonths }, (_, i) => String(i + 1)),
          },
          { key: "phaseProgressPct", label: "本阶段进度(%)", inputKind: "number", current: String(rs.phaseProgressPct), placeholder: "0–100" },
        ],
      },
      run: (reason, _v, bf) => {
        if (!bf) return;
        const m = Number(bf.currentMonth);
        if (Number.isFinite(m) && m > 0) {
          setParam("H1.rhythm.currentMonth", String(Math.max(1, Math.min(rs.totalMonths, Math.round(m)))), { action: "设定当前运营月", reason });
        }
        const p = Number(bf.phaseProgressPct);
        if (Number.isFinite(p)) {
          setParam("H1.rhythm.phaseProgressPct", String(Math.max(0, Math.min(100, Math.round(p)))), { action: "设定本阶段进度", reason });
        }
        logAudit({ actor: "总管理员", action: "设定当前节奏位置", target: "H1.rhythm.currentMonth", reason });
        toast("· 当前节奏位置已更新 · 已记审计");
      },
    });
  };

  return (
    <>
      {/* (a) 顶部 4 张 f-stat KPI(本组件自渲,与 H2/H3/H5 一致)。 */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">当前运营月 / 阶段</div>
          <div className="v">月 {rs.currentMonth} · {rs.currentPhase}</div>
          <div className="sub">{rs.totalMonths} 月节奏 · 定时推进每月 1 日 00:00 UTC</div>
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

      {/* 节奏骨架(运营可配):总时长 + 当前位置。B4 看板 / L 域 / 首页脉搏同源镜像,绝不抄快照。 */}
      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h">
          <span className="ttl">节奏骨架</span>
          <span className="sub">· 运营节奏的总时长与当前位置 · 操作确认可回滚 · 全站同源派生</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>节奏总时长</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>P1 拉新 → P6 软退场的总月数;矩阵行数与各阶段月数随之等比重分布</span>
            </span>
            <span className="bdg">{rs.totalMonths} 个月</span>
            <button className="l-btn sm mc" onClick={openTotalMonthsMc}>改总时长</button>
          </div>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>当前节奏位置</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>当前走到第几月 + 本阶段进度;阶段由月份派生(真后台 cron 自动推进,此处手动设定 / 校准)</span>
            </span>
            <span className="bdg">第 {rs.currentMonth}/{rs.totalMonths} 月 · {rs.currentPhase} · {rs.phaseProgressPct}%</span>
            <button className="l-btn sm mc" onClick={openCurrentPosMc}>设定位置</button>
          </div>
        </div>
      </section>

      {/* (b) 逐月 × 8 旋钮 dial 矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">逐月旋钮矩阵({rs.totalMonths} 月 × 8 项 · 逐值权威)</span>
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
              {Array.from({ length: rs.totalMonths }, (_, idx) => {
                const m1 = idx + 1;
                const isCur = m1 === rs.currentMonth;
                const phaseTag = monthToPhase(m1, rs.totalMonths);
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
                {PHASE_ATTRIBUTION.map((r) => {
                  const isCur = r.code === rs.currentPhase; // 当前阶段高亮随节奏单源流转,不固定 P3
                  return (
                  <tr
                    key={r.code}
                    style={isCur ? { background: "rgba(255,107,53,.08)" } : undefined}
                  >
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>{r.phase}{isCur ? " · 当前" : ""}</td>
                    <td className="num mono">{r.first}</td>
                    <td className="num mono">{r.reinvest}</td>
                    <td className="num mono">{r.weekly}</td>
                    <td className="num mono">{r.d7}</td>
                  </tr>
                  );
                })}
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
            label: `逐月旋钮矩阵(${rs.totalMonths} 月 × 8 项 · 逐值权威)`,
            kind: "fixed-matrix",
            maxRows: rs.totalMonths,
            reason: `${rs.totalMonths} 个月节奏矩阵必须同屏对比当前月和前后月,翻页会破坏横向校验`,
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
