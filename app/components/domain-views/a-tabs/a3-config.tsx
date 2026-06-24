"use client";

/**
 * A3 系统配置。
 *
 * 平台级横切配置面:feature flag 灰度台 + 熔断闸只读 + 系统健康面。
 * 删除旧配置域后,本组件只通过后端 A3 config overview 读取真实数据;
 * 当后端配置表为空时,后端负责把保留的默认数据写入 MySQL 后再返回。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchA3Overview,
  updateA3FeatureFlag,
  type A3FeatureFlag,
  type A3Overview,
} from "@/lib/admin/a3-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { ACtx } from "./types";

const FLAG_STATUS_OPTIONS = ["on", "off", "灰度 10%", "灰度 20%", "灰度 50%", "灰度 90%"];

const EMPTY_OVERVIEW: A3Overview = {
  featureFlags: [],
  killSwitches: [],
  systemHealth: [],
  stats: {
    flagCount: 0,
    flagGrayCount: 0,
    killGates: 0,
    killGatesUp: 0,
  },
};

function featureTone(status: string) {
  if (status === "on") return "ok";
  if (status === "off") return "dim";
  return "warn";
}

function healthCounts(rows: A3Overview["systemHealth"]) {
  const ok = rows.filter((row) => row.tone === "ok").length;
  return {
    ok,
    total: rows.length,
    warn: rows.length - ok,
  };
}

export function A3Config({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const router = useRouter();
  const operator = useAdminAuth((state) => state.operator || state.session?.operator || state.session?.username || "superadmin");
  const [overview, setOverview] = useState<A3Overview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshOverview = useCallback(async () => {
    setLoadError(null);
    try {
      setOverview(await fetchA3Overview());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "A3_CONFIG_OVERVIEW_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const { featureFlags, killSwitches, systemHealth, stats } = overview;
  const health = healthCounts(systemHealth);

  const flagChg = (flag: A3FeatureFlag) => {
    openActionConfirm({
      action: `切换功能开关 · ${flag.name}`,
      detail: (
        <>
          <b>{flag.name}</b>(<span className="mono">{flag.key}</span>)· {flag.desc}。
          当前 <b>{flag.status}</b> · 范围 {flag.scope}。切换即由服务器向命中范围派发新值,客户端只读结果。
          <b>发起资格</b>:{flag.resourceOwner};确认 = 超管。线上行为变更,审计记前后值。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: flag.status, options: FLAG_STATUS_OPTIONS },
      run: async (reason, value) => {
        const nextStatus = (value || "").trim();
        if (!FLAG_STATUS_OPTIONS.includes(nextStatus)) {
          toast("拒绝:功能开关目标态须为 on / off / 灰度档,非法值未写入");
          return;
        }
        try {
          const latest = await updateA3FeatureFlag(flag.key, nextStatus, reason, operator);
          setOverview(latest);
          toast(`「${flag.name}」已切换为 ${nextStatus} · 后端留痕`);
        } catch (error) {
          toast(`功能开关切换失败:${error instanceof Error ? error.message : "A3_UPDATE_FAILED"}`);
        }
      },
    });
  };

  return (
    <>
      <div className="f-stats">
        <div className="f-stat cyan">
          <div className="k">功能开关</div>
          <div className="v">{stats.flagCount} 个</div>
          <div className="sub">{stats.flagGrayCount} 个灰度中 · 切换走后端接口</div>
        </div>
        <div className="f-stat ok">
          <div className="k">熔断闸</div>
          <div className="v">{stats.killGatesUp} / {stats.killGates} 开</div>
          <div className="sub">功能闸 + 地区屏蔽 · 只读同步</div>
        </div>
        <div className={health.warn > 0 ? "f-stat warn" : "f-stat ok"}>
          <div className="k">系统健康</div>
          <div className="v">{health.ok} / {health.total} 正常</div>
          <div className="sub">{health.warn > 0 ? `${health.warn} 项需关注` : "关键依赖正常"}</div>
        </div>
        <div className="f-stat">
          <div className="k">数据来源</div>
          <div className="v">{loading ? "读取中" : loadError ? "失败" : "接口"}</div>
          <div className="sub">/api/admin/platform/config/overview</div>
        </div>
      </div>

      {(loading || loadError) && (
        <div className="atint" style={{ marginBottom: 12 }}>
          {loading ? "正在读取 A3 后端配置接口。" : `A3 接口读取失败:${loadError}`}
        </div>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">功能开关平台(c)</span>
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
              {featureFlags.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--ink-4)", textAlign: "center" }}>
                    暂无功能开关配置
                  </td>
                </tr>
              ) : (
                featureFlags.map((flag) => (
                  <tr key={flag.key}>
                    <td style={{ verticalAlign: "top" }}>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{flag.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-4)", margin: "2px 0" }}>{flag.desc}</div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{flag.key}</span>
                    </td>
                    <td><span className={`bdg ${featureTone(flag.status)}`}>{flag.status}</span></td>
                    <td style={{ fontSize: 12 }}>{flag.scope}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{flag.lastChange}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{flag.resourceOwner}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={() => flagChg(flag)}>切换</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint">
            <b>这里只放横切开关</b> · 跨域通用的实验开关、灰度百分比、平台能力开关归这页;
            <b>有业务主的参数不进来</b>——阶段全表归节奏调度(H1)、试用扣款参数归试用引擎(H2)、
            各业务倍率归各业务域。增长角色只能发起增长类开关,动资金或风控行为的开关仅风控或超管可提交。
          </div>
        </div>
      </section>

      <div className="two-col">
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
                {killSwitches.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--ink-4)", textAlign: "center" }}>
                      暂无熔断闸配置
                    </td>
                  </tr>
                ) : (
                  killSwitches.map((gate) => (
                    <tr key={gate.key}>
                      <td style={{ verticalAlign: "top" }}>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{gate.name}</div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{gate.key}</span>
                      </td>
                      <td><span className={`a3-gate ${gate.up ? "up" : "down"}`}>{gate.status}</span></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{gate.lastChange}</td>
                      <td style={{ fontSize: 11.5 }}>{gate.chain}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="atint">
              <b>分工</b> · 闸状态存这里(单一真值源),驾驶舱风险雷达(B5)的状态灯也读这里;
              <b>切换操作在 J1(功能闸)/ J2(地区屏蔽)</b>,这页保留只读兼容视图。
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">系统健康(e)</span>
            <span className="sub">· 服务端关键依赖 · 只读</span>
          </div>
          <div className="l-b">
            {systemHealth.length === 0 ? (
              <div className="a3-hl" style={{ color: "var(--ink-4)" }}>暂无系统健康数据</div>
            ) : (
              systemHealth.map((row) => (
                <div className="a3-hl" key={row.name}>
                  <span
                    className="d"
                    style={{ background: row.tone === "ok" ? "var(--success)" : "var(--warning)" }}
                  />
                  <span style={{ flex: 1 }}>{row.name}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 11.5, color: row.tone === "ok" ? "var(--success)" : "var(--warning)" }}
                  >
                    {row.metric}
                  </span>
                </div>
              ))
            )}
            <div className="atint" style={{ marginTop: 10 }}>
              <b>健康面异常只告警</b> · 管道问题找技术值班,资金账异常走驾驶舱(B1/B2)。
              这些指标由后端接口返回,页面不再保留本地 mock。
            </div>
          </div>
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:功能开关切换 = 增长(限增长类)/超管执行门槛:超管;
        熔断闸与地区屏蔽的操作面在 J1/J2。
        <b>事件去向</b>:开关切换、闸切换都产 admin 审计事件,统一落审计中心(A2);
        闸状态变更同时点亮驾驶舱风险雷达(B5)的状态灯。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "功能开关平台(c)",
            maxRows: 5,
            reason: "横切开关 V1 固定五项,切换靠筛选/操作确认而非翻页",
          },
          {
            label: "熔断闸状态存储(d)· 只读兼容视图",
            kind: "reference-catalog",
            maxRows: 8,
            reason: "固定闸目录,只读跳转到 J 域处置",
          },
        ]}
      />
    </>
  );
}
