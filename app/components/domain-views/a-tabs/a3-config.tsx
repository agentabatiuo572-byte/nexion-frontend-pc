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
import { displayAdminError } from "@/lib/admin/error-messages";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import {
  fetchA3Overview,
  isA3OutcomeUncertainError,
  isA3ReadbackFailedError,
  updateA3FeatureFlag,
  updateA3Parameter,
  type A3FeatureFlag,
  type A3Overview,
  type A3SystemHealth,
} from "@/lib/admin/a3-client";
import type { ACtx } from "./types";
import { PlatformExperienceConfig } from "./platform-experience-config";

const a3ParamCommands = createSlotAttemptStore({ storageKey: "nexion-admin-a3-param-commands-v1" });

/* ────────────────── 组件 ────────────────── */

function healthToneColor(tone: A3SystemHealth["tone"]) {
  if (tone === "ok") return "var(--success)";
  if (tone === "warn") return "var(--warning)";
  return "var(--danger)";
}

function healthToneLabel(tone: A3SystemHealth["tone"]) {
  if (tone === "ok") return "正常";
  if (tone === "warn") return "警告";
  return "严重异常";
}

export function A3Config({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const router = useRouter();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
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
      if (!quiet) setOverview(null);
      setLoadError(displayAdminError(error));
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
  const platformParams = overview?.platformParams ?? [];
  const upGates = overview?.stats.killGatesUp ?? gates.filter((g) => g.up).length;

  /* ────────────────── 调参动作:feature flag 切换 ────────────────── */

  const flagChg = (f: A3FeatureFlag) => {
    const cur = f.status;
    openActionConfirm({
      action: `切换功能开关 · ${f.name}`,
      detail: (
        <>
          <b>{f.name}</b>(<span className="mono">{f.key}</span>)· {f.desc}。
          当前 <b>{cur}</b> · 范围 {f.scope} · 运行时消费者 <b>{f.consumer}</b>。
          服务端允许值为 {f.allowedValues.join(" / ")}；<b>写入资格</b>:{f.resourceOwner}。
          生效后会立即刷新后台外壳，审计记录保留前后值。
        </>
      ),
      amplifies: false,
      reasonMax: 200,
      edit: { kind: "select", current: cur, options: f.allowedValues, disallowCurrent: true },
      run: (reason, v) => {
        const val = (v || "").trim();
        if (!f.allowedValues.includes(val)) {
          const copy = "目标状态不在服务端允许范围内，请刷新页面后重试。";
          toast(copy);
          throw new Error(copy);
        }
        setMutating(f.key);
        return updateA3FeatureFlag(f.key, val, cur, reason, operator)
          .then((next) => {
            setOverview(next);
            window.dispatchEvent(new CustomEvent("a3:runtime-flags-changed"));
            toast(`「${f.name}」已切换为 ${val}，审计记录已写入。`);
          })
          .catch((error: unknown) => {
            if (isA3ReadbackFailedError(error)) {
              toast(`写入已成功，但权威状态刷新失败；页面将重新读取，请勿重复提交。`);
              void refreshOverview(true);
              return;
            }
            if (isA3OutcomeUncertainError(error)) {
              toast(`提交结果未知（命令号 ${error.commandKey}）；请先刷新并核对 A2 审计，禁止重复提交。`);
              throw error;
            }
            toast(`提交失败:${displayAdminError(error)}`);
            throw error;
          })
          .finally(() => setMutating(null));
      },
    });
  };

  const paramChg = (param: typeof platformParams[number]) => openActionConfirm({
    action: `调整平台参数 · ${param.name}`,
    detail: <>{param.desc} · 运行时消费者 <b>{param.consumer}</b> · 服务端以当前值 <b>{param.value}</b> 做 CAS。</>,
    amplifies: false, reasonMin: 8, reasonMax: 200,
    edit: { kind: "number", current: param.value, min: param.min, max: param.max, unit: param.unit },
    run: async (reason, value) => {
      const normalizedValue = (value || "").trim();
      const slot = `param:${param.key}`;
      const fingerprint = JSON.stringify([param.key, normalizedValue, param.value, reason, operator]);
      const commandKey = a3ParamCommands.resolve(slot, fingerprint, () => `a3-param-${crypto.randomUUID()}`);
      setMutating(param.key);
      try {
        setOverview(await updateA3Parameter(param.key, normalizedValue, param.value, reason, operator, commandKey));
        a3ParamCommands.forget(slot);
        toast(`${param.name} 已更新并回读`);
      } catch (error) {
        if (isA3OutcomeUncertainError(error)) {
          toast(`提交结果未知（命令号 ${error.commandKey}）；保持输入不变再次确认会复用同一命令号。`);
        } else {
          a3ParamCommands.forget(slot);
          toast(`提交失败:${displayAdminError(error)}`);
        }
        throw error;
      }
      finally { setMutating(null); }
    },
  });

  /* ────────────────── 渲染 ────────────────── */

  return (
    <>
      <PlatformExperienceConfig />
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
            <div className="atint" style={{ fontSize: 12 }}>正在读取系统配置与应急状态。</div>
          </div>
        </section>
      )}
      {/* 2 f-stat(服务器时钟 / 防重号 KPI 已随对应卡片移除 2026-06-24) */}
      <div className="f-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="f-stat cyan">
          <div className="k">功能开关</div>
          <div className="v">{overview?.stats.flagCount ?? featureFlags.length} 个</div>
          <div className="sub">{overview?.stats.flagOnCount ?? featureFlags.filter((flag) => flag.status === "on").length} 个已开启 · 切换走操作确认</div>
        </div>
        <div className="f-stat ok">
          <div className="k">熔断闸</div>
          <div className="v">{upGates} / {gates.length} 正常</div>
          <div className="sub">J1 功能闸 + J2 地区屏蔽</div>
        </div>
      </div>

      {/* (a) 功能开关平台 全宽 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">功能开关平台(a)</span>
          <span className="sub">· 仅展示已有真实消费者的服务端开关 · 切换需要操作确认</span>
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
                      {f.writable && (
                        <button className="l-btn sm mc" onClick={() => flagChg(f)} disabled={mutating === f.key}>
                          {mutating === f.key ? "提交中" : "切换"}
                        </button>
                      )}
                      {!f.writable && <span style={{ color: "var(--ink-4)", fontSize: 11.5 }}>只读</span>}
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
            <b>这里只放有真实消费者的横切开关</b> · 每一行都声明允许值、消费者和写入角色；
            没有运行时消费方的实验或参数不会在此伪装成可用开关。有业务主的参数仍归各业务域维护。
          </div>
        </div>
      </section>

      {/* two-col: (b) 熔断闸只读 + (c) 系统健康 */}
      <div className="two-col">
        {/* (b) 熔断闸状态存储 · 只读兼容视图 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">应急状态(b)· 只读兼容视图</span>
            <span className="sub">· 状态真值来自 J1 / J2 · 操作仍在应急域</span>
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
              <b>分工</b> · 本表直接读取 J1 的五个功能闸和 J2 的地区策略，不保存第二份状态；
              <b>切换操作仍在 J1 / J2</b>，这页只负责跨域核对和跳转。
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
                  style={{ background: healthToneColor(h.tone) }}
                />
                <span style={{ flex: 1 }}>{h.name}</span>
                <span className={`bdg ${h.tone === "ok" ? "ok" : h.tone === "warn" ? "warn" : "bad"}`}>
                  {healthToneLabel(h.tone)}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11.5, color: healthToneColor(h.tone) }}
                >
                  {h.metric}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--ink-4)" }} title={h.source}>
                  {h.stale ? "状态不可确认" : `采样 ${h.observedAt}`}
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

      <section className="l-card" data-capability="a3-authoritative-params" data-restored-capability="a3-global-rate-limit"><div className="l-h"><span className="ttl">平台权威参数 · 全球限流上限 / 提现强审阈值</span><span className="sub">· CAS · 幂等 · 审计 · 运行时真实消费</span></div><div className="l-b" data-restored-capability="a3-withdraw-strong-review-threshold">
        {platformParams.map((param) => <div className="a-vrow" key={param.key}><span className="nm">{param.name}<small>{param.desc}</small></span><span className="v">{param.value} {param.unit}</span>{param.writable && <button className="l-btn sm mc" disabled={!!mutating} onClick={() => paramChg(param)}>调整</button>}</div>)}
      </div></section>

      <p className="f-foot">
        <b>执行门槛</b>:当前登记的平台维护开关仅超管可切换；其他角色只读。熔断闸与地区屏蔽的操作权限由 J1 / J2 独立控制。
        <b>事件去向</b>:A3 开关切换写入 A2 审计；J1 / J2 继续维护自己的状态与操作留痕。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "功能开关平台(a)",
            maxRows: 5,
            reason: "仅展示后端登记且已有真实运行时消费者的少量横切开关",
          },
          {
            label: "应急状态(b)· 只读兼容视图",
            kind: "reference-catalog",
            maxRows: 8,
            reason: "五个熔断闸加地区屏蔽为固定目录,只读跳转到 J 域处置",
          },
        ]}
      />
    </>
  );
}
