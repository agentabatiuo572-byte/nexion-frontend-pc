"use client";

/**
 * A3 系统配置 — design_handoff_a_domain/A3 设计稿 port(SPEC §7)。
 *
 * 平台级横切配置面:feature flag 灰度台 + 熔断闸只读 + 系统健康面。
 * (服务器时钟·全平台时间单源卡 与 防重号策略卡 于 2026-06-24 按主人指令移除;
 *  server time 单源 / Idempotency-Key 仍是后端不变量,只是不再在本页设独立配置卡。)
 *
 * killswitch 操作面已迁 J1/J2 — 本页表格只读(早期切换入口已退役),无切换按钮;
 * 头部两按钮路由跳转 J1(功能闸)/ J2(地区屏蔽);驾驶舱 B5 的状态灯也读这里(单一真值源)。
 *
 * 真写键(A.*):A.flag.<key>.status(feature flag 切换)。
 *
 * 操作确认 显式 edit 契约:feature flag 切换传 edit:{kind:"select",current,options};
 * 本页无处置类动作(熔断闸只读;系统健康面只读)。
 *
 * amplifies:A3 全部动作 amplifies=false(本页不放大资金流出方向)。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaginationExemptionList } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchA3Overview, updateA3FeatureFlag, type A3FeatureFlag, type A3Overview } from "@/lib/admin/a3-client";
import type { ACtx } from "./types";

/* ────────────────── helpers ────────────────── */

// feature flag 合法目标态枚举(on / off / 灰度百分比)—— 杜绝自由文本误填(如 "abc")。
const FLAG_STATUS_OPTIONS = ["on", "off", "灰度 10%", "灰度 20%", "灰度 50%", "灰度 90%"];

/* ────────────────── 组件 ────────────────── */

export function A3Config({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const router = useRouter();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "superadmin");
  const [overview, setOverview] = useState<A3Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);

  const refreshOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      setOverview(await fetchA3Overview());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  /* 5 闸只读派生(killSwitchReadonly 同源 design-data.KILLSWITCH + geo-block 行)。
   *「生效中」= enabled 或 「空列表 · 无封锁」(geo-block 列表非空才算「生效」,空列表 = 无封锁 = 通) */
  const gates = overview?.killSwitches ?? [];
  const featureFlags = overview?.featureFlags ?? [];
  const systemHealth = overview?.systemHealth ?? [];
  const upGates = overview?.stats.killGatesUp ?? gates.filter((g) => g.up).length;

  /* ────────────────── 调参动作:feature flag 切换 ────────────────── */

  const flagChg = (f: A3FeatureFlag) => {
    const cur = f.status;
    openActionConfirm({
      action: `切换功能开关 · ${f.name}`,
      detail: (
        <>
          <b>{f.name}</b>(<span className="mono">{f.key}</span>)· {f.desc}。
          当前 <b>{cur}</b> · 范围 {f.scope}。切换即由服务器向命中范围派发新值(客户端只读结果,
          本地改无效);灰度百分比可分级拉升。<b>发起资格</b>:{f.resourceOwner};确认 = 超管。
          线上行为变更,审计记前后值。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: cur, options: FLAG_STATUS_OPTIONS },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!FLAG_STATUS_OPTIONS.includes(val)) {
          toast("拒绝:功能开关目标态须为 on / off / 灰度档,非法值未写入");
          return;
        }
        setMutating(f.key);
        updateA3FeatureFlag(f.key, val, reason, operator)
          .then((next) => {
            setOverview(next);
            toast(`「${f.name}」已切换为 ${val} · 后端留痕`);
          })
          .catch((error: unknown) => {
            toast(`提交失败:${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => setMutating(null));
      },
    });
  };

  /* ────────────────── 渲染 ────────────────── */

  return (
    <>
      {loadError && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint warn" style={{ fontSize: 12 }}>
              A3 接口读取失败:{loadError}
              <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void refreshOverview()}>重试</button>
            </div>
          </div>
        </section>
      )}
      {loading && !overview && (
        <section className="l-card">
          <div className="l-b">
            <div className="atint" style={{ fontSize: 12 }}>正在读取 /api/admin/platform/config/overview。</div>
          </div>
        </section>
      )}
      {/* 2 f-stat(服务器时钟 / 防重号 KPI 已随对应卡片移除 2026-06-24) */}
      <div className="f-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="f-stat cyan">
          <div className="k">功能开关</div>
          <div className="v">{overview?.stats.flagCount ?? featureFlags.length} 个</div>
          <div className="sub">{overview?.stats.flagGrayCount ?? featureFlags.filter((flag) => flag.status.includes("灰度")).length} 个灰度中 · 切换走操作确认</div>
        </div>
        <div className="f-stat ok">
          <div className="k">熔断闸</div>
          <div className="v">{upGates} / {gates.length} 开</div>
          <div className="sub">功能闸 + 地区屏蔽(空列表)</div>
        </div>
      </div>

      {/* (a) 功能开关平台 全宽 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">功能开关平台(a)</span>
          <span className="sub">· 灰度和实验的值由服务器派发,客户端只读结果 · 切换操作确认</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>功能开关</th>
                <th>当前态</th>
                <th>适用范围</th>
                <th>最近变更</th>
                <th>发起资格</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {featureFlags.map((f) => {
                const cur = f.status;
                const stCls = cur === "on" ? "ok" : cur === "off" ? "dim" : "warn";
                return (
                  <tr key={f.key}>
                    <td style={{ verticalAlign: "top" }}>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-4)", margin: "2px 0" }}>{f.desc}</div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{f.key}</span>
                    </td>
                    <td><span className={`bdg ${stCls}`}>{cur}</span></td>
                    <td style={{ fontSize: 12 }}>{f.scope}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{f.lastChange}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{f.resourceOwner}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={() => flagChg(f)} disabled={mutating === f.key}>{mutating === f.key ? "提交中" : "切换"}</button>
                    </td>
                  </tr>
                );
              })}
              {!featureFlags.length && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--ink-4)", textAlign: "center", padding: 24 }}>
                    后端暂无功能开关记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint">
            <b>这里只放横切开关</b> · 跨域通用的实验开关、灰度百分比、平台能力开关归这页;
            <b>有业务主的参数不进来</b>——阶段全表归节奏调度(H1)、试用扣款参数归试用引擎(H2)、
            各业务倍率归各业务域。增长角色只能发起增长类开关(实验/活动相关),
            动资金或风控行为的开关仅风控或超管可提交;超管执行门槛统一拦截。
          </div>
        </div>
      </section>

      {/* two-col: (b) 熔断闸只读 + (c) 系统健康 */}
      <div className="two-col">
        {/* (b) 熔断闸状态存储 · 只读兼容视图 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">熔断闸状态存储(b)· 只读兼容视图</span>
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
                  const isUp = g.up;
                  return (
                    <tr key={g.key}>
                      <td style={{ verticalAlign: "top" }}>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{g.name}</div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{g.key}</span>
                      </td>
                      <td><span className={`a3-gate ${isUp ? "up" : "down"}`}>{g.status}</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{g.lastChange}</td>
                      <td style={{ fontSize: 11.5 }}>{g.chain}</td>
                    </tr>
                  );
                })}
                {!gates.length && (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--ink-4)", textAlign: "center", padding: 24 }}>
                      后端暂无熔断闸记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="atint">
              <b>分工</b> · 闸状态存这里(单一真值源),驾驶舱风险雷达(B5)的状态灯也读这里;
              <b>切换操作在 J1(5 功能闸)/ J2(地区屏蔽)</b>,这页早期的切换入口已经退役成只读。
              地区屏蔽不是开关而是国家列表:列表非空才算「生效」。<b>注意</b>:
              披露重确认机制不是闸,不在这张表里——它归内容域(I4–I5 页)。
            </div>
          </div>
        </section>

        {/* (c) 系统健康 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">系统健康(c)</span>
            <span className="sub">· 服务端关键依赖 · 只读</span>
          </div>
          <div className="l-b">
            {systemHealth.map((h) => (
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
            {!systemHealth.length && (
              <div className="atint warn" style={{ fontSize: 12 }}>
                后端暂无系统健康记录
              </div>
            )}
            <div className="atint" style={{ marginTop: 10 }}>
              <b>系统健康只读</b> · 服务端关键依赖的实时状态,查看类全角色按裁剪可看。
              健康面异常只告警、不在这页处置——管道问题找技术值班,资金账异常走驾驶舱(B1/B2)。
            </div>
          </div>
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:功能开关切换 = 增长(限增长类)发起 / 超管确认;熔断闸与地区屏蔽的操作面在 J1/J2
        (功能闸财务/风控可发起、地区屏蔽财务不能发起,确认都是超管)。
        <b>事件去向</b>:开关切换、闸切换都产 admin 审计事件,统一落审计中心(A2);
        闸状态变更同时点亮驾驶舱风险雷达(B5)的状态灯。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "功能开关平台(a)",
            maxRows: 5,
            reason: "横切开关 V1 固定五项,切换靠筛选/操作确认而非翻页",
          },
          {
            label: "熔断闸状态存储(b)· 只读兼容视图",
            kind: "reference-catalog",
            maxRows: 8,
            reason: "五个熔断闸加地区屏蔽为固定目录,只读跳转到 J 域处置",
          },
        ]}
      />
    </>
  );
}
