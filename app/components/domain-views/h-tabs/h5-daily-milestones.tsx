"use client";

/**
 * H5 签到与里程碑(H5 + H6 合页 · design_handoff_h_domain port).
 *
 * 8 段(严格按设计稿 DOM 顺序):
 *  (a) 顶部 4 张 f-stat KPI(H5_STATS · 今日签到 / 幸运实测 / 复活卡消耗 / 里程碑触发);
 *  (b) 签到 6 规则(.l-card · CHECKIN_RULES · .p-row):
 *      - p15 / p2 改值 操作确认 + amplifies=true(升概率 = 放大流出 → B1 红线 422);
 *      - 两幸运档和 ≤ 100% 服务器硬约束(超出 422);本页前置告警(.htint danger);
 *      - baseline / bonus7 / broken / saver 改值 操作确认 不挂 amplifies(非放大流出);
 *      - 真写键 H5.<key>(baseline / bonus7 / p15 / p2 / broken / saver)。
 *  (c) 连胜里程碑 7 阶(.l-card · STREAK_MS · .l-tbl):
 *      - 每行尾「调整」操作确认 + amplifies=true(升奖励 = 放大流出过 B1);
 *      - 真写键 H5.ms.<id>.reward(id 0..6);spin/badge 档备注归属(H4 转盘 / 徽章触发);
 *      - 100 天 ⭐ 徽章档:detail 注明「徽章发放归 I 域,本档只发资格」。
 *  (d) 连胜分布 5 段柱图(.l-card · STREAK_DIST · .dist):
 *      - 只读监控;.htint cyan「连胜大师 100 天解锁 ⭐」尾注。
 *  (e) Power-Ups 4 档(.l-card · POWER_UPS · .l-tbl):
 *      - 每行尾「调整」操作确认 + amplifies=true(升 PU 阈值 = 放松流出过 B1);
 *      - 真写键 H5.pu.<id>.day(7/14/30/60)+ H5.pu.<id>.note(下游兑现注释);
 *      - .htint warn 「V3 接线前仅触点价值 · 不另立兑付逻辑」尾注;
 *      - 下游 chip F2/G5/G1/G4(.bdg dim)对应 downstream 字段。
 *  (f) H6 5 档保序表(.l-card · EARN_MS · .l-tbl):
 *      - 每行尾「调整」操作确认 + amplifies=true(升奖励 / 降门槛过 B1;阈值严格保序违反 422);
 *      - 真写键 H6.<key>.threshold + H6.<key>.nex(key = earn-100/500/1000/5000/10000);
 *      - 改任一即过 B1 红线;in-flight 不追溯,只对新跨档生效。
 *  (g) 三规矩说明(.l-card · .htint cyan · 3 行):
 *      - 触发口径 = 累计入账(含当日);标记与入账原子 fire+credit+bill;cascade 配置快照。
 *  (h) 触发间隔 cascade 检查(.l-card · TICK_INTERVAL · .p-row):
 *      - 「调整」操作确认 不挂 amplifies(内部参数 · 超管确认 · 1-60s);
 *      - 真写键 H6.tick。
 *
 * 真写键(全部 H5.* / H6.* 单源):
 *  H5.{baseline,bonus7,p15,p2,broken,saver} · H5.ms.<id>.reward ·
 *  H5.pu.<id>.{day,note} · H6.<key>.{threshold,nex} · H6.tick.
 *
 * amplifies 触发(过 B1 100% 红线):
 *  幸运 p15/p2 升概率 / 7 阶里程碑升奖励 / Power-Ups 升阈值 / H6 升 NEX 或降门槛.
 *
 * SPEC §4 H5+H6 服务器铁律:
 *  ① 概率公示 + 抽签 server RNG 永不外泄;
 *  ② 两幸运档和 ≤ 100%(超 422);
 *  ③ H6 门槛严格保序(乱序 422);
 *  ④ 标记触发与 NEX 入账一体完成(单事务原子);
 *  ⑤ 一次跨多档按当时配置串行(快照锁定,中途改配置不影响在途连发).
 */
import {
  H5_STATS,
  CHECKIN_RULES,
  STREAK_MS,
  STREAK_DIST,
  POWER_UPS,
  EARN_MS,
  TICK_INTERVAL,
} from "./data";
import { PaginationExemptionList } from "../design-kit";
import type { HCtx } from "./types";

/** 解析「15%」「+5 分」「48 小时」这类带后缀的字符串里第一段数字。 */
function parseLeadingNum(s: string): number {
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/** 把可能含 $/, 的纯金额字符串解析为数字(如「$1,000」→ 1000)。 */
function parseMoney(s: string): number {
  const m = s.replace(/[$,\s]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/** Power-Ups 下游域 bdg 色彩(F2/G5/G1/G4 一律 dim,与设计稿 mute 一致)。 */
const PU_DOWNSTREAM_LABEL: Record<string, string> = {
  F2: "F2 · 团队费率",
  G5: "G5 · 会员订阅",
  G1: "G1 · 质押",
  G4: "G4 · Genesis",
};

export default function H5DailyMilestones({ ctx }: { ctx: HCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;

  /* ============ (a) 顶部 4 张 f-stat KPI(H5_STATS) ============ */
  const todaySignFmt = H5_STATS.todaySign.toLocaleString();
  const weekReviveFmt = H5_STATS.weekRevive.toLocaleString();
  const weekTriggerFmt = H5_STATS.weekMsTrigger.toLocaleString();

  /* ============ (b) 两幸运档和 ≤ 100% 前置告警 ============ */
  const p15Cur = pget("H5.p15") ?? "15";
  const p2Cur = pget("H5.p2") ?? "5";
  const p15Num = parseLeadingNum(p15Cur);
  const p2Num = parseLeadingNum(p2Cur);
  const luckySum = (Number.isNaN(p15Num) ? 0 : p15Num) + (Number.isNaN(p2Num) ? 0 : p2Num);
  const luckyOverflow = luckySum > 100;

  /** 签到 6 规则:hot=true(p15/p2)挂 amplifies;其余不挂。 */
  const openCheckinRuleMc = (key: string, name: string, cur: string, hot: boolean, sub?: string) => {
    openActionConfirm({
      action: `签到规则 · ${name}`,
      detail: (
        <>
          <b>{name}</b> · 当前 <b>{cur}</b>。
          {sub && <> {sub}.</>}
          {hot ? (
            <>
              {" "}<b>升概率 = 放大流出,提交即过 B1 覆盖率红线</b>;
              服务器同时校验两幸运档概率合计 ≤ 100%(超出直接拒,422)。
              改完立即用新概率结算;概率值在用户界面公示,所有抽签裁决由平台 server 统一掌握(RNG 永不外泄)。
              执行门槛 = 财务主管 / 超管。
            </>
          ) : (
            <>
              {" "}实时生效(下次签到按新值);<b>非概率类:不放大流出</b>,
              不挂红线核验。增长执行门槛:增长主管。
            </>
          )}
        </>
      ),
      amplifies: hot,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H5.${key}`, v, { action: `签到规则 ${name}`, reason });
        toast(
          `· ${name} 已改为 ${v}${hot ? " · 已过 B1 覆盖率核验 + 两档和校验" : " · 实时生效"}`,
        );
      },
    });
  };

  /* ============ (c) 连胜里程碑 7 阶 操作确认 ============ */
  const openStreakMsMc = (id: number, day: string, reward: string, kind: string) => {
    const isSpin = kind === "spin";
    const isBadge = kind === "badge";
    openActionConfirm({
      action: `连胜里程碑 · ${day}`,
      detail: (
        <>
          <b>当前奖励 {reward}</b> · 阶梯可增删改;
          <b>升 NEX/USDT 奖励 = 放大流出</b>,提交过备付金红线(覆盖率不足拒,422)。
          已到可领状态按当前值结算,只对新达成生效。
          {isSpin && (
            <>
              {" "}<b>这一档只发「转盘票」;票兑什么奖、概率多少归活动页(H4)的奖池管</b>,
              本档改的是阶梯门槛,不改奖池。
            </>
          )}
          {isBadge && (
            <>
              {" "}<b>100 天 ⭐ 连胜大师徽章的发放归 I 域</b>,本档只发资格事件,徽章下发由 I 域消费。
            </>
          )}
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: reward },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H5.ms.${id}.reward`, v, {
          action: `连胜里程碑 ${day}`,
          reason,
        });
        toast(`· 里程碑 ${day} 已改为 ${v} · 已过 B1 覆盖率核验`);
      },
    });
  };

  /* ============ (e) Power-Ups 4 档 操作确认 ============ */
  const openPowerUpMc = (id: number, day: number, label: string, downstream: string, sub: string) => {
    const dsName = PU_DOWNSTREAM_LABEL[downstream] ?? downstream;
    const dayCur = pget(`H5.pu.${id}.day`) ?? String(day);
    openActionConfirm({
      action: `连胜增益 · ${label}`,
      detail: (
        <>
          <b>{label}</b> · 当前阈值 <b>{dayCur} 天</b> · 兑现归下游 <b>{dsName}</b>。
          {sub && <> {sub}.</>}
          {" "}<b>增益放大下游({downstream})流出</b>,提交过备付金红线(不足拒,422),
          审计会同步记下游域引用。
          <b>下游兑现接线落地前,这档只产生触点价值(跳转引导 + 徽章解锁)</b>,
          +5% 费率 / +2% 年化等增益不实际兑付。
          执行门槛 = 财务主管。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: dayCur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`H5.pu.${id}.day`, v, {
          action: `连胜增益 ${label} 阈值`,
          reason: `${reason}(下游 ${downstream})`,
        });
        setParam(`H5.pu.${id}.note`, `下游 ${downstream} 兑现 · V3 接线前仅触点价值`, {
          action: `连胜增益 ${label} 下游注释`,
          reason,
        });
        toast(`· ${label} 阈值已改为 ${v} 天 · 已记下游域 ${downstream} · 已过 B1 核验`);
      },
    });
  };

  /* ============ (f) H6 5 档 操作确认(amplifies + 保序提示 + 幂等条款)============
   * 2026-06-12 audit R1 修:原实现把一个 input 的 v 同时写入 H6.<key>.threshold 和 H6.<key>.nex 两个
   * 不同语义键(字段污染,违反 feedback_field_level_gate)。改双输入解析:用户填 "$N / +M NEX" 格式,
   * run 内 parse 分别写入两键 + 加 Idempotency-Key 24h dedup 幂等条款(SPEC §0 H6 落库 Checklist 第 6 项)。 */
  const openEarnMsMc = (id: number, key: string, threshold: number, nex: number) => {
    const curThr = pget(`H6.${key}.threshold`) ?? String(threshold);
    const curNex = pget(`H6.${key}.nex`) ?? String(nex);
    const curSummary = `$${parseMoney(curThr).toLocaleString()} / +${parseLeadingNum(curNex).toLocaleString()} NEX`;
    openActionConfirm({
      action: `收益里程碑 · ${key}`,
      detail: (
        <>
          当前 <b>门槛 ${parseMoney(curThr).toLocaleString()}</b> ·{" "}
          <b>奖励 +{parseLeadingNum(curNex).toLocaleString()} NEX</b>。
          <b>新值格式</b>:<span className="mono">$门槛 / +奖励 NEX</span>(示例:<span className="mono">$500 / +250 NEX</span>);
          server 解析两段后<b>分别</b>写 H6.&lt;key&gt;.threshold + H6.&lt;key&gt;.nex,不混写单值。
          四道校验:
          ① <b>门槛保序</b>(高档必须大于低档,乱序服务器直接拒,422);
          ② <b>升奖励 / 降门槛 = 放大流出</b>,过备付金红线(不足拒);
          ③ 已触发的不追溯,只对新跨档生效;
          ④ <b>幂等</b>(milestoneId × userId Idempotency-Key 24h dedup),
          fire + credit + bill 单事务原子,失败下周期重发,cascade 按提交时配置逐档发(快照串行)。
          执行门槛 = 财务主管 / 超管。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: curSummary },
      run: (reason, v) => {
        if (!v) return;
        // 解析两段格式 "$N / +M NEX";解析失败则两键各自落回旧值,不污染单源。
        const thrMatch = v.match(/\$?([\d,.]+)/);
        const nexMatch = v.match(/\+?([\d,.]+)\s*NEX/i);
        const newThr = thrMatch ? thrMatch[1].replace(/,/g, "") : curThr;
        const newNex = nexMatch ? nexMatch[1].replace(/,/g, "") : curNex;
        setParam(`H6.${key}.threshold`, newThr, {
          action: `收益里程碑 ${key} 门槛`,
          reason,
        });
        setParam(`H6.${key}.nex`, newNex, {
          action: `收益里程碑 ${key} NEX 奖励`,
          reason,
        });
        toast(`· 收益里程碑 ${key} 已提交 · 门槛 $${newThr} / +${newNex} NEX · 保序 + 幂等校验`);
      },
    });
  };

  /* ============ (h) 触发间隔 操作确认(内部参数,不挂 amplifies)============ */
  const openTickMc = () => {
    const cur = pget("H6.tick") ?? TICK_INTERVAL.value;
    openActionConfirm({
      action: "触发检查间隔",
      detail: (
        <>
          <b>当前 {cur}</b> · 范围 {TICK_INTERVAL.min}-{TICK_INTERVAL.max} 秒。
          {TICK_INTERVAL.note}。
          <b>内部参数 · 超管确认</b>(技术角色未建前由超管代理操作 / 留痕);
          过密会拉高平台负载,过疏会延后跨档庆祝。不挂 B1 红线(非流出方向)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam("H6.tick", v, { action: "H6 触发检查间隔", reason });
        toast(`· 触发检查间隔已改为 ${v} · 内部参数 · 已留痕`);
      },
    });
  };

  return (
    <>
      {/* ===================== (a) 顶部 4 张 f-stat KPI ===================== */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">今日签到</div>
          <div className="v">{todaySignFmt}</div>
          <div className="sub">签到率 {H5_STATS.signRate} · 喂日活回访</div>
        </div>
        <div className="f-stat ok">
          <div className="k">幸运倍率实测命中</div>
          <div className="v">{H5_STATS.lucky15Actual} / {H5_STATS.lucky2Actual}</div>
          <div className="sub">
            1.5× / 2× · 配置 {H5_STATS.lucky15Config} / {H5_STATS.lucky2Config},在差内
          </div>
        </div>
        <div className="f-stat warn">
          <div className="k">复活卡消耗(本周)</div>
          <div className="v">{weekReviveFmt} 张</div>
          <div className="sub">断签 &gt; 48h 后用卡恢复</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">里程碑触发(本周)</div>
          <div className="v">{weekTriggerFmt} 次</div>
          <div className="sub">派发 {H5_STATS.weekMsNex} · 喂流出口径</div>
        </div>
      </div>

      {/* ===================== (b) 签到 6 规则 ===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">签到规则(H5)</span>
          <span className="sub">
            · 幸运概率写在界面上是转化文案,故意公开;但抽签只在服务器
          </span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {luckyOverflow && (
            <div className="htint danger" style={{ marginBottom: 10, fontSize: 12 }}>
              <b>两幸运档概率和超 100%</b> · 当前 1.5×({p15Cur}%)+ 2×({p2Cur}%)={luckySum}%。
              服务器会在提交时直接拒(422);请先把任一档下调到合计 ≤ 100% 再发起 操作确认。
            </div>
          )}
          {CHECKIN_RULES.map((r) => {
            const cur = pget(`H5.${r.key}`) ?? r.cur;
            return (
              <div className="p-row" key={r.key}>
                <span className="k">
                  {r.name}
                  {r.sub && <small>{r.sub}</small>}
                </span>
                <span className="v">{cur}</span>
                <button
                  className="l-btn sm mc"
                  onClick={() => openCheckinRuleMc(r.key, r.name, cur, r.hot, r.sub)}
                >
                  调整
                </button>
              </div>
            );
          })}
          <div className="htint" style={{ marginTop: 10, fontSize: 12 }}>
            <b>状态机</b> · 今日已签 → 待签 → 签到;&gt; 48h 未签连胜归零,可用复活卡恢复。
            同天重复签到拒;抽签单次裁决,不可重抽。
          </div>
        </div>
      </section>

      {/* ===================== (c) 连胜里程碑 7 阶 ===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">连胜里程碑(7 阶)</span>
          <span className="sub">
            · 满 30 天发一张转盘票——票在这发,奖池归活动页(H4)管
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>连胜</th>
                <th>奖励</th>
                <th>类型</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {STREAK_MS.map((m) => {
                const cur = pget(`H5.ms.${m.id}.reward`) ?? m.reward;
                return (
                  <tr key={m.id}>
                    <td
                      className="mono"
                      style={{ fontWeight: 600, color: "var(--ink)" }}
                    >
                      {m.day}
                    </td>
                    <td className="mono">{cur}</td>
                    <td>
                      <span className="bdg dim">{m.kind}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="l-btn sm mc"
                        onClick={() => openStreakMsMc(m.id, m.day, cur, m.kind)}
                      >
                        调整
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===================== (d) 连胜分布 5 段柱图 ===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">连胜分布(人数)</span>
          <span className="sub">· 服务器台账只读 · 喂留存 BI(L 域)</span>
        </div>
        <div className="l-b" style={{ paddingTop: 6 }}>
          <div className="dist">
            {STREAK_DIST.map((d) => (
              <div className="b" key={d.day}>
                <span className="ct">{d.count}</span>
                <i style={{ height: `${d.height}%` }} />
                <span className="lb">{d.day}</span>
              </div>
            ))}
          </div>
          <div className="htint cyan" style={{ marginTop: 10, fontSize: 12 }}>
            <b>连胜大师 100 天解锁 ⭐ 徽章</b> · 7 阶最终档触达后由 I 域消费资格事件,
            徽章下发与展示走 I 域,本页只看分布。
          </div>
        </div>
      </section>

      {/* ===================== (e) Power-Ups 4 档(连胜增益)===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">连胜增益 · Power-Ups(4 档)</span>
          <span className="sub">
            · 跨域兑现 · 这页只是触发面 · 兑现归下游 F2 / G5 / G1 / G4
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>阈值</th>
                <th>增益</th>
                <th>下游兑现</th>
                <th>说明</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {POWER_UPS.map((p) => {
                const dayCur = pget(`H5.pu.${p.id}.day`) ?? String(p.day);
                return (
                  <tr key={p.id}>
                    <td
                      className="mono"
                      style={{ fontWeight: 600, color: "var(--ink)" }}
                    >
                      {dayCur} 天
                    </td>
                    <td>{p.label}</td>
                    <td>
                      <span className="bdg dim">{p.downstream}</span>
                    </td>
                    <td
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-4)",
                        lineHeight: 1.5,
                      }}
                    >
                      {p.sub}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="l-btn sm mc"
                        onClick={() =>
                          openPowerUpMc(p.id, p.day, p.label, p.downstream, p.sub)
                        }
                      >
                        调整
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 8 }}>
          <div className="htint warn" style={{ fontSize: 12 }}>
            <b>调参别误判</b> · 下游四个域(F2 / G5 / G1 / G4)的「真实兑现」接线 V3 落地前,
            当前增益只产生跳转引导 + 徽章解锁的<b>触点价值</b>;+5% 费率 / +2% 年化等暂不实际兑付。
            <b>这页只是触发面 · 不另立兑付逻辑</b>,评估留存效果按「触点引导」算,
            别按「增益兑付」算。
          </div>
        </div>
      </section>

      {/* ===================== (f) H6 5 档保序表 ===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">收益里程碑(H6 · 5 档)</span>
          <span className="sub">
            · 跨档自动触发庆祝 + 自动发 NEX · 门槛必须从低到高保序(乱序 422)
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>档位</th>
                <th className="num">累计入账门槛</th>
                <th className="num">NEX 奖励</th>
                <th className="num">本周触发</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {EARN_MS.map((e) => {
                const curThr = pget(`H6.${e.key}.threshold`) ?? String(e.threshold);
                const curNex = pget(`H6.${e.key}.nex`) ?? String(e.nex);
                const thrNum = parseMoney(curThr);
                const nexNum = parseLeadingNum(curNex);
                return (
                  <tr key={e.id}>
                    <td
                      className="mono"
                      style={{ fontWeight: 600, color: "var(--ink)" }}
                    >
                      {e.key}
                    </td>
                    <td className="num mono">
                      ${Number.isNaN(thrNum) ? curThr : thrNum.toLocaleString()}
                    </td>
                    <td className="num mono" style={{ fontWeight: 700 }}>
                      +{Number.isNaN(nexNum) ? curNex : nexNum.toLocaleString()} NEX
                    </td>
                    <td className="num mono">{e.weekTrigger.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="l-btn sm mc"
                        onClick={() => openEarnMsMc(e.id, e.key, e.threshold, e.nex)}
                      >
                        调整
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===================== (g) 三规矩说明 ===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">收益里程碑 · 三条规矩</span>
          <span className="sub">· cascade 串行 + 单事务原子 + 累计入账口径</span>
        </div>
        <div className="l-b" style={{ paddingTop: 6 }}>
          <div className="htint cyan" style={{ fontSize: 12, marginBottom: 8 }}>
            <b>① 触发口径 = 累计入账(含当日)</b> · 不算未结算 / in-flight 收益;
            含当日已入账的合并入累计基数,跨档判定以基数 ≥ 门槛为准。
          </div>
          <div className="htint cyan" style={{ fontSize: 12, marginBottom: 8 }}>
            <b>② 标记触发与 NEX 入账一体完成</b> · fire + credit + bill 单事务原子,
            失败下周期重发(不会出现「标记了但 NEX 没到」或「NEX 到了但没标」中间态)。
          </div>
          <div className="htint cyan" style={{ fontSize: 12 }}>
            <b>③ 一次跨多档按当时配置串行</b> · 单次入账跨越多档时按提交时配置逐档发,
            中途改配置不影响在途连发(快照锁定)。
          </div>
        </div>
      </section>

      {/* ===================== (h) 触发间隔 cascade 检查 ===================== */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">cascade 触发检查间隔(H6)</span>
          <span className="sub">· 内部参数 · 超管确认 · 1-60 秒</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span className="k">
              触发检查间隔
              <small>
                过密会拉高平台负载,过疏延后跨档庆祝 · 内部参数,超管确认 · 1-60s
              </small>
            </span>
            <span className="v">{pget("H6.tick") ?? TICK_INTERVAL.value}</span>
            <button className="l-btn sm mc" onClick={openTickMc}>
              调整
            </button>
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>确认</b>:基础签到规则 = 增长 → 增长主管;
        <b>动概率 / 动钱</b>(幸运概率 / 里程碑奖励阶梯 / Power-Ups 阈值 / H6 5 档)= 增长 → 财务主管 / 超管,
        过 B1 红线;触发间隔 = 超管。监管点名概率奖励走 J1;徽章发放与文案归 I 域;
        收益里程碑触发事件喂代币流出监控(B1)与留存 BI(L 域)。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "连胜里程碑(7 阶)",
            kind: "reference-catalog",
            maxRows: 7,
            reason: "连胜里程碑固定七阶,需要同屏检查奖励阶梯",
          },
          {
            label: "连胜增益 · Power-Ups(4 档)",
            maxRows: 4,
            reason: "Power-Ups 固定四档,下游兑现归 F/G 域",
          },
          {
            label: "收益里程碑(H6 · 5 档)",
            maxRows: 5,
            reason: "收益里程碑固定五档,保序校验需要同屏展示",
          },
        ]}
      />
    </>
  );
}
