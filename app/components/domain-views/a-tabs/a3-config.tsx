"use client";

/**
 * A3 系统配置 — design_handoff_a_domain/A3 设计稿 port(204 行权威 + SPEC §7 三铁律)。
 *
 * 平台级横切配置面:服务器时钟单源 + 防重号策略 + feature flag 灰度台 + 熔断闸只读 + 系统健康面。
 *
 * A 域三铁律(A3 实装,server-canonical 镜像):
 *  ⑤-1 server time 单源 — client 钟仅显示;一切时间判定(试用倒计时 / 阶段月龄 / 提现冷却 / 锁仓到期)
 *      只认服务器,改本地无效。a3-clock useState + setInterval 1s 仅渲染,不参与任何判定。
 *  ⑤-2 killswitch 操作面已迁 J1/J2 — 本页表格只读(早期切换入口已退役),无切换按钮;
 *      头部两按钮路由跳转 J1(功能闸)/ J2(地区屏蔽);驾驶舱 B5 的状态灯也读这里(单一真值源)。
 *
 * 真写键(A.*):
 *  A.sys.ntpSource(NTP 同步源)· A.sys.idempotencyWindow(防重号去重窗口)·
 *  A.flag.<key>.status(feature flag 切换)。
 *
 * 操作确认 显式 edit 契约(2026-06 跨域硬化):
 *  - 调参(NTP 源 / 幂等窗口 / feature flag 切换)传 edit:{kind:"text",current,unit};
 *  - 本页无处置类动作(熔断闸只读;系统健康面只读)。
 *
 * amplifies:A3 全部动作 amplifies=false(本页不放大资金流出方向)。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PaginationExemptionList } from "../design-kit";
import {
  A3_STATS,
  NTP_SOURCE,
  FEATURE_FLAGS,
  SYSTEM_HEALTH,
  killSwitchReadonly,
} from "./data";
import type { ACtx } from "./types";

/* ────────────────── helpers ────────────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatServerClock(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

/* ────────────────── 组件 ────────────────── */

export function A3Config({ ctx }: { ctx: ACtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const router = useRouter();

  /* a3-clock:client 钟仅显示;一切判定走服务器(A 域三铁律 ⑤-1)。
   * useState 初值用固定字符串避免 SSR/CSR 文案不一致;mount 后 setInterval 每秒刷新。 */
  const [clock, setClock] = useState<string>("2026-06-11 10:42:08 UTC");
  useEffect(() => {
    setClock(formatServerClock(new Date()));
    const id = setInterval(() => setClock(formatServerClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  /* 7 闸只读派生(killSwitchReadonly 同源 design-data.KILLSWITCH + geo-block 行)。
   *「生效中」= enabled 或 「空列表 · 无封锁」(geo-block 列表非空才算「生效」,空列表 = 无封锁 = 通) */
  const gates = useMemo(() => killSwitchReadonly(), []);
  const upGates = gates.filter((g) => g.st === "enabled" || g.st.includes("空列表")).length;

  /* ────────────────── 调参动作:NTP 源 / 幂等窗口 / feature flag 切换 ────────────────── */

  const adjNtp = () => {
    const cur = (pget("A.sys.ntpSource") as string | undefined) ?? NTP_SOURCE.current;
    openActionConfirm({
      action: "切换 NTP 同步源",
      detail: (
        <>
          当前 <b>{cur}</b>(三源仲裁)。时钟是全平台时间判定的单源,换源期间锁定当前时刻继续走、
          新源稳定后切换;超管执行门槛:超管。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) {
          toast("拒绝:NTP 源不能为空");
          return;
        }
        setParam("A.sys.ntpSource", val, {
          action: `NTP 源切换 → ${val} · admin.system_param_changed`,
          reason,
        });
        toast(`NTP 源已更新为 ${val} · 理由留痕`);
      },
    });
  };

  const adjIdem = () => {
    const cur = (pget("A.sys.idempotencyWindow") as string | undefined) ?? "24 小时";
    openActionConfirm({
      action: "调整防重号去重窗口",
      detail: (
        <>
          当前 <b>{cur}</b> · 范围 1–72 小时 · 对新防重号生效。窗口调短会放过迟到的重试
          (重复入账风险),调长占存储——24h 是兜住「隔夜重试」的平衡点。超管执行门槛:超管。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "小时" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) {
          toast("拒绝:去重窗口不能为空");
          return;
        }
        setParam("A.sys.idempotencyWindow", val, {
          action: `防重号窗口 → ${val} · admin.system_param_changed`,
          reason,
        });
        toast(`去重窗口已更新为 ${val} · 理由留痕`);
      },
    });
  };

  const flagChg = (f: (typeof FEATURE_FLAGS)[number]) => {
    const cur = (pget(`A.flag.${f.key}.status`) as string | undefined) ?? f.st;
    openActionConfirm({
      action: `切换 feature flag · ${f.key}`,
      detail: (
        <>
          当前 <b>{cur}</b> · 范围 {f.scope}。切换即由服务器向命中范围派发新值(客户端只读结果,
          本地改无效);灰度百分比可分级拉升。<b>发起资格</b>:{f.resourceOwner};确认 = 超管。
          线上行为变更,审计记前后值。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "" },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!val) {
          toast("拒绝:flag 目标态不能为空");
          return;
        }
        setParam(`A.flag.${f.key}.status`, val, {
          action: `feature flag 切换 ${f.key} → ${val} · admin.feature_flag_changed`,
          reason,
        });
        toast(`${f.key} 已切换为 ${val} · 留痕`);
      },
    });
  };

  /* ────────────────── 渲染 ────────────────── */

  return (
    <>
      {/* 4 f-stat */}
      <div className="f-stats">
        <div className="f-stat ok">
          <div className="k">服务器时钟漂移</div>
          <div className="v">{A3_STATS.clockDrift}</div>
          <div className="sub">NTP 同步正常 · 阈值 {A3_STATS.driftThreshold}</div>
        </div>
        <div className="f-stat">
          <div className="k">防重号拦截(24h)</div>
          <div className="v">{A3_STATS.idempBlocked24h.toLocaleString("en-US")} 次</div>
          <div className="sub">重复请求被去重,零重复入账</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">feature flag</div>
          <div className="v">{A3_STATS.flagCount} 个</div>
          <div className="sub">{A3_STATS.flagGrayCount} 个灰度中 · 切换走操作确认</div>
        </div>
        <div className="f-stat ok">
          <div className="k">熔断闸</div>
          <div className="v">{upGates} / {gates.length} 开</div>
          <div className="sub">6 功能闸 + 地区屏蔽(空列表)</div>
        </div>
      </div>

      {/* two-col: (a) 服务器时钟 + (b) 防重号策略 */}
      <div className="two-col">
        {/* (a) 服务器时钟 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">服务器时钟(a)· 全平台时间单源</span>
            <span className="sub">· 用户端时钟只管显示,不参与任何判定</span>
          </div>
          <div className="l-b">
            <div className="a3-clock">{clock}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", margin: "4px 0 12px" }}>
              server time · 毫秒级 · 所有事件时间戳以服务器收到为准
            </div>
            <div className="a-vrow">
              <span className="nm">
                NTP 同步源(可调)
                <small>权威源切换走操作确认(超管 → 超管)</small>
              </span>
              <span className="v">{(pget("A.sys.ntpSource") as string | undefined) ?? NTP_SOURCE.current}</span>
              <button className="l-btn sm mc" onClick={adjNtp}>切换源</button>
            </div>
            <div className="a-vrow">
              <span className="nm">
                当前漂移 / 告警阈值
                <small>超阈值自动告警并标记受影响时间判定</small>
              </span>
              <span className="v">{A3_STATS.clockDrift} / {A3_STATS.driftThreshold}</span>
            </div>
            <div className="atint" style={{ marginTop: 10 }}>
              <b>为什么死咬服务器时钟</b> · 试用到期、阶段切换、提现冷却、锁仓到期全是时间判定——
              认了客户端时钟,改个手机时间就能提前解锁。所以判定只用这口钟,客户端那口只拿来显示。
            </div>
          </div>
        </section>

        {/* (b) 防重号策略 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">防重号策略(b)</span>
            <span className="sub">· 资金 / 资产写入必带防重号,窗口内重复请求只生效一次</span>
          </div>
          <div className="l-b">
            <div className="a-vrow">
              <span className="nm">
                去重窗口(可调)
                <small>窗口内同一防重号的请求返回首次结果,不再写入</small>
              </span>
              <span className="v">{(pget("A.sys.idempotencyWindow") as string | undefined) ?? "24 小时"}</span>
              <button className="l-btn sm mc" onClick={adjIdem}>调整</button>
            </div>
            <div className="a-vrow">
              <span className="nm">
                24h 拦截计数
                <small>命中重复号被拦的次数——突增说明端上有重试风暴</small>
              </span>
              <span className="v">{A3_STATS.idempBlocked24h.toLocaleString("en-US")} 次</span>
            </div>
            <div className="a-vrow">
              <span className="nm">
                强制范围
                <small>所有资金/资产写入接口 + 确认放行;漏带直接 400</small>
              </span>
              <span className="v">资金类全量</span>
              <span className="acode lock">🔒</span>
            </div>
            <div className="atint" style={{ marginTop: 10 }}>
              <b>它防什么</b> · 网络一抖,端上把「提现 $500」重发了三遍——没有防重号就是扣三次。
              有了它,三遍只生效一遍,后两遍原样返回第一遍的结果。操作确认中心(A2)的放行动作也走同一套。
            </div>
          </div>
        </section>
      </div>

      {/* (c) feature flag 平台 全宽 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">feature flag 平台(c)</span>
          <span className="sub">· 灰度和实验的值由服务器派发,客户端只读结果 · 切换操作确认</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>flag</th>
                <th>当前态</th>
                <th>适用范围</th>
                <th>最近变更</th>
                <th>发起资格</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_FLAGS.map((f) => {
                const cur = (pget(`A.flag.${f.key}.status`) as string | undefined) ?? f.st;
                const stCls = cur === "on" ? "ok" : cur === "off" ? "dim" : "warn";
                return (
                  <tr key={f.key}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{f.key}</td>
                    <td><span className={`bdg ${stCls}`}>{cur}</span></td>
                    <td style={{ fontSize: 12 }}>{f.scope}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{f.lastChange}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{f.resourceOwner}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={() => flagChg(f)}>切换</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint">
            <b>这里只放横切 flag</b> · 跨域通用的实验开关、灰度百分比、平台能力开关归这页;
            <b>有业务主的参数不进来</b>——阶段全表归节奏调度(H1)、试用扣款参数归试用引擎(H2)、
            各业务倍率归各业务域。增长角色只能发起增长类 flag(实验/活动相关),
            动资金或风控行为的 flag 仅风控或超管可提交;超管执行门槛统一拦截。
          </div>
        </div>
      </section>

      {/* two-col: (d) 熔断闸只读 + (e) 系统健康 */}
      <div className="two-col">
        {/* (d) 熔断闸状态存储 · 只读兼容视图 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">熔断闸状态存储(d)· 只读兼容视图</span>
            <span className="sub">· 开关本体存这里 · 操作面已迁应急域</span>
            <div className="r">
              <button className="l-btn sm" onClick={() => router.push("/emergency/kill-switch")}>
                去 J1 操作功能闸 →
              </button>
              <button className="l-btn sm" onClick={() => router.push("/emergency/geo-block")}>
                去 J2 配地区屏蔽 →
              </button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>闸</th>
                  <th>状态</th>
                  <th>最近变更</th>
                  <th>操作 / 留痕</th>
                </tr>
              </thead>
              <tbody>
                {gates.map((g) => {
                  const isUp = g.st === "enabled" || g.st.includes("空列表");
                  return (
                    <tr key={g.key}>
                      <td className="mono">{g.key}</td>
                      <td><span className={`a3-gate ${isUp ? "up" : "down"}`}>{g.st}</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{g.lastChange}</td>
                      <td style={{ fontSize: 11.5 }}>{g.chain}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="atint">
              <b>分工</b> · 闸状态存这里(单一真值源),驾驶舱风险雷达(B5)的状态灯也读这里;
              <b>切换操作在 J1(6 功能闸)/ J2(地区屏蔽)</b>,这页早期的切换入口已经退役成只读。
              地区屏蔽不是开关而是国家列表:列表非空才算「生效」。<b>注意</b>:
              披露重确认机制不是闸,不在这张表里——它归内容域(I4–I5 页)。
            </div>
          </div>
        </section>

        {/* (e) 系统健康 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">系统健康(e)</span>
            <span className="sub">· 服务端关键依赖 · 只读</span>
          </div>
          <div className="l-b">
            {SYSTEM_HEALTH.map((h) => (
              <div className="a3-hl" key={h.name}>
                <span
                  className="d"
                  style={{ background: h.tone === "ok" ? "var(--success)" : "var(--warning)" }}
                />
                <span style={{ flex: 1 }}>{h.name}</span>
                <span
                  className="mono"
                  style={{ fontSize: 11.5, color: h.tone === "ok" ? "var(--success)" : "var(--warning)" }}
                >
                  {h.metric}
                </span>
              </div>
            ))}
            <div className="atint" style={{ marginTop: 10 }}>
              <b>系统参数变更</b>(时钟源 / 去重窗口)= 超管执行门槛:超管;查看类全角色按裁剪只读。
              健康面异常只告警、不在这页处置——管道问题找技术值班,资金账异常走驾驶舱(B1/B2)。
            </div>
          </div>
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:feature flag 切换 = 增长(限增长类)/超管执行门槛:超管;
        系统参数(时钟源/去重窗口)= 超管 → 超管;熔断闸与地区屏蔽的操作面在 J1/J2
        (功能闸财务/风控可发起、地区屏蔽财务不能发起,确认都是超管)。
        <b>事件去向</b>:flag 切换、闸切换、系统参数变更都产 admin 审计事件,统一落审计中心(A2);
        闸状态变更同时点亮驾驶舱风险雷达(B5)的状态灯。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "feature flag 平台(c)",
            maxRows: 5,
            reason: "横切 flag V1 固定五项,切换靠筛选/操作确认而非翻页",
          },
          {
            label: "熔断闸状态存储(d)· 只读兼容视图",
            kind: "reference-catalog",
            maxRows: 8,
            reason: "七个熔断闸加地区屏蔽为固定目录,只读跳转到 J 域处置",
          },
        ]}
      />
    </>
  );
}
