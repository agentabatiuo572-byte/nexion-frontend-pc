"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataListPager } from "../design-kit";
import {
  fetchH2Trials,
  killH2AutoPush,
  updateH2TrialParam,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import type { HCtx } from "./types";

type TrialParam = {
  key: string;
  name: string;
  sub?: string;
  cur: string;
  hot?: boolean;
  section?: "newonly" | "live";
  serverOnly?: boolean;
  readOnly?: boolean;
};

type TrialSession = {
  sid: string;
  state: string;
  shadow: string;
  cardTok?: string;
  cardToken?: string;
  cancelledAt?: string;
  chargedAt?: string;
};

type TrialState = { key: string; label: string; tone: string };

type TrialProduct = {
  productNo: string;
  name: string;
  priceUsdt?: number | string;
  stock?: number | string | null;
  status?: string;
  productType?: string;
  inventoryMode?: string;
  selectable?: boolean;
  unavailableReason?: string;
};

type H2Model = {
  stats?: Record<string, any>;
  params: TrialParam[];
  gates: Array<{ gate: string; note?: string }>;
  states: TrialState[];
  sessions: TrialSession[];
  trialProducts?: TrialProduct[];
  autoPushKilled?: boolean;
  modelA?: Record<string, any>;
  serverOnlyFields?: string[];
  sessionsPage?: { total: number; pageNum: number; pageSize: number };
};

function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function stateMap(states: TrialState[]) {
  return new Map(states.map((state) => [state.key, state]));
}

function nextStateLabel(states: Map<string, TrialState>, key: string) {
  const state = states.get(key);
  return state ? [state.label, state.tone] : [key, "dim"];
}

function isTrialDayParam(key: string) {
  return ["trialDays", "graceDays", "extensionDays", "cooldownDays"].includes(key);
}

function isTrialIntegerParam(key: string) {
  return isTrialDayParam(key) || key === "seatsLeftToday";
}

function dayLimitHint(key: string) {
  if (key === "trialDays") return "1-90 天";
  if (key === "graceDays" || key === "extensionDays") return "0-30 天";
  if (key === "cooldownDays") return "0-365 天";
  if (key === "seatsLeftToday") return "0-1000000 张";
  return "";
}

function trialProductReason(reason: string | undefined) {
  return formatAdminApiError(reason, "请到 E1 核对商品状态");
}

function ParamRow({
  ctx,
  param,
  trialProducts,
  onChanged,
}: {
  ctx: HCtx;
  param: TrialParam;
  trialProducts: TrialProduct[];
  onChanged: () => Promise<void>;
}) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canWrite = ctx.can("growth_h2_write");
  const current = text(param.cur);
  const isDay = isTrialDayParam(param.key);
  const isInteger = isTrialIntegerParam(param.key);
  const isQuota = param.key === "seatsLeftToday";
  const isProduct = param.key === "trialProductId";
  const currentProduct = isProduct ? trialProducts.find((product) => product.productNo === current) : undefined;
  const displayCurrent = isDay ? `${current} 天`
    : isQuota ? `${current} 张`
      : currentProduct ? `${currentProduct.name} · ${current}` : current;
  const readOnly = ["phaseOpen", "trialPriceUSD"].includes(param.key);
  const productOptions = trialProducts.map((product) => product.productNo);
  const disabledProductOptions = trialProducts
    .filter((product) => !product.selectable)
    .map((product) => product.productNo);
  const productOptionLabels = Object.fromEntries(trialProducts.map((product) => [
    product.productNo,
    `${product.name} · ${product.productNo} · 库存 ${product.stock ?? 0} · $${text(product.priceUsdt, "-")}${product.selectable ? "" : ` · 不可选：${trialProductReason(product.unavailableReason)}`}`,
  ]));
  // FEAT-TRIAL02 无卡化后自动扣款整链下线,后端不再下发 autoChargeAtEnd,该键的渲染分支随之移除。
  const options = ["autoPushEnabled"].includes(param.key)
    ? ["开", "关"]
    : param.key === "phaseOpen" ? ["开放", "关闭"]
      : isProduct ? productOptions : undefined;
  const detail = (
    <>
      <b>{param.name}</b> · 当前 <span className="mono">{displayCurrent}</span>。
      {param.serverOnly ? "该值仅服务端可见,接口返回仍保持遮罩。" : ""}
      {isInteger ? `请输入整数(${dayLimitHint(param.key)})。` : ""}
      {isProduct ? "目标商品只能从 E1 中明确开启“允许试用”的在售实物 SKU 选择；试用价格始终读取 E1 当前售价。" : ""}
      {isProduct && currentProduct && !currentProduct.selectable ? (
        <span style={{ display: "block", marginTop: 5, color: "var(--danger)", fontWeight: 700 }}>
          当前目标商品不可用 · 库存 {currentProduct.stock ?? 0} · {trialProductReason(currentProduct.unavailableReason)}
        </span>
      ) : null}
      {param.section === "newonly" ? "只影响新开试用。" : "实时生效。"}
    </>
  );

  const submit = async (reason: string, value?: string) => {
    if (!value || value.trim().length === 0) return;
    const normalizedValue = value.trim();
    if (isInteger && !/^\d+$/.test(normalizedValue)) {
      toast(`${param.name} 请输入整数`);
      return;
    }
    if (isQuota && Number(normalizedValue) > 1_000_000) {
      toast(`${param.name} 必须在 0-1000000 张之间`);
      return;
    }
    await updateH2TrialParam(param.key, normalizedValue, reason);
    await onChanged();
    toast(`H2 ${param.name} 已更新`);
  };

  return (
    <div className="p-row" key={param.key}>
      <div className="k">
        {param.name}
        {param.sub && <small>{param.sub}</small>}
      </div>
      <span className="v">{displayCurrent}</span>
      {isProduct ? <a className="l-btn sm" href={`/devices/pricing?sku=${encodeURIComponent(current)}`}>去 E1 查看商品</a> : null}
      <button
        className={`l-btn sm${param.hot ? " mc" : ""}`}
        disabled={readOnly || !canWrite}
        title={readOnly ? (param.key === "phaseOpen" ? "由 H1 当前阶段派发，只读" : "由 E1 目标商品售价同步，只读") : undefined}
        onClick={() => {
          if (param.hot || isInteger || isProduct) {
            openActionConfirm({
              action: `${param.hot ? "试用敏感参数" : "试用参数"} · ${param.name}`,
              detail,
              amplifies: false,
              edit: {
                kind: isProduct ? "select" : options ? "select" : isInteger ? "number" : "text",
                current,
                unit: isDay ? "天" : isQuota ? "张" : undefined,
                options,
                optionLabels: isProduct ? productOptionLabels : undefined,
                disabledOptions: isProduct ? disabledProductOptions : undefined,
              },
              run: submit,
            });
            return;
          }
          openConfirm({
            action: `试用参数 · ${param.name}`,
            detail,
            chips: [["写后端配置", "ready"], ["审计留痕", "done"]],
            reason: true,
            input: { label: "目标新值", placeholder: `当前 ${displayCurrent}`, options },
            okLabel: "确认修改",
            run: submit,
          });
        }}
      >
        {readOnly ? "只读" : canWrite ? "调整" : "无写权限"}
      </button>
    </div>
  );
}

export function H2Trial({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canWrite = ctx.can("growth_h2_write");
  const canCancel = ctx.can("growth_h2_session_cancel");
  const canCharge = ctx.can("growth_h2_session_charge");
  const propose = usePropose();
  const [model, setModel] = useState<H2Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(20);
  const reloadEpochRef = useRef(0);

  const reload = useCallback(async () => {
    const requestEpoch = ++reloadEpochRef.current;
    setLoading(true);
    try {
      const nextModel = (await fetchH2Trials(sessionPage, sessionPageSize)) as H2Model;
      if (requestEpoch !== reloadEpochRef.current) return;
      setModel(nextModel);
      setError(null);
    } catch (err) {
      if (requestEpoch !== reloadEpochRef.current) return;
      setError(displayAdminError(err));
    } finally {
      if (requestEpoch === reloadEpochRef.current) setLoading(false);
    }
  }, [sessionPage, sessionPageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const states = useMemo(() => stateMap(model?.states ?? []), [model?.states]);
  const newOnlyParams = (model?.params ?? []).filter((param) => param.section === "newonly");
  const liveParams = (model?.params ?? []).filter((param) => param.section !== "newonly");
  const stats = model?.stats ?? {};

  const openSessionCancel = (session: TrialSession) => {
    openActionConfirm({
      action: `强制取消试用 · ${session.sid}`,
      detail: <>会话会转为 <b>cancelled</b> 终态,由后端幂等处理并审计。</>,
      amplifies: false,
      run: (reason) => {
        const def = findHighOp("h2_trial_cancel")!;
        void propose(ctx.toast, {
          action: `强制取消试用 · ${session.sid}`,
          obj: session.sid,
          before: session.state,
          after: "cancelled",
          type: "sos",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H2",
          command: def.buildCommand({ sid: session.sid }),
          target: def.buildTarget({ sid: session.sid }),
        });
      },
    });
  };

  const openSessionCharge = (session: TrialSession) => {
    openActionConfirm({
      action: `强制触发扣款 · ${session.sid}`,
      detail: <>后端会按当前试用结算规则重算,重复请求由 Idempotency-Key 去重。直接动 USDT 台账,入 A2 待门槛者执行。</>,
      amplifies: true,
      run: (reason) => {
        const def = findHighOp("h2_trial_charge")!;
        void propose(ctx.toast, {
          action: `强制触发扣款 · ${session.sid}`,
          obj: session.sid,
          before: session.state,
          after: "redeemed(扣款)",
          type: "fund",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H2",
          command: def.buildCommand({ sid: session.sid }),
          target: def.buildTarget({ sid: session.sid }),
        });
      },
    });
  };

  const openPushKill = () => {
    openConfirm({
      action: "auto-push 急停",
      detail: <>立即关闭试用自动推送,后端写入配置并返回最新读模型。</>,
      chips: [["实时急停", "ready"], ["后端留痕", "done"]],
      reason: true,
      okLabel: "确认急停",
      run: async (reason) => {
        await killH2AutoPush(reason);
        await reload();
        toast("auto-push 已急停");
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">H2 数据加载中...</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">H2 数据加载失败</span></div>
        <div className="l-b">
          <div style={{ marginBottom: 12 }}>{error ?? "未收到本页数据，请重试；持续失败时请联系值班人员。"}</div>
          <button className="l-btn sm mc" onClick={() => void reload()}>重试</button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">进行中会话</div>
          <div className="v">{Number(stats.activeSessions ?? 0).toLocaleString()}</div>
          <div className="sub">试用中 {Number(stats.inTrial ?? 0).toLocaleString()} · 宽限 {Number(stats.inGrace ?? 0).toLocaleString()} · 延长 {Number(stats.inExtended ?? 0).toLocaleString()}</div>
        </div>
        <div className="f-stat ok">
          <div className="k">试用转购买率</div>
          <div className="v">{text(stats.trialBuyRate)}</div>
          <div className="sub">绑卡转化 {text(stats.bindCardRate)} · 提前购 {text(stats.earlyBuyRate)}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">抵扣上限</div>
          <div className="v">${text(model.params.find((param) => param.key === "trialOffsetCapUSD")?.cur)}</div>
          <div className="sub">Model A 抵扣由服务端重算</div>
        </div>
        <div className="f-stat danger">
          <div className="k">循环养号阻断(K2)</div>
          <div className="v">{text(stats.k2Blocked, "0")} 人</div>
          <div className="sub">资格由服务器关闭</div>
        </div>
      </div>

      <div className="htint cyan" style={{ marginBottom: 16 }}>
        <b>Model A</b> · 抵扣规则由后端返回: <span className="mono">{text(model.modelA?.offsetRule, "min(shadow, offsetCap)")}</span>。
        扣款失败概率等 server-only 字段不会以真实值下发。
      </div>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 只影响新开</span>
            <span className="sub">· 从后端 params 读取</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {newOnlyParams.map((param) => (
              <ParamRow ctx={ctx} param={param} trialProducts={model.trialProducts ?? []} key={param.key} onChanged={reload} />
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 实时生效</span>
            <span className="sub">· 每次结算读最新后端配置</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={openPushKill} disabled={!!model.autoPushKilled || !canWrite}>
                {model.autoPushKilled ? "auto-push 已急停" : "auto-push 急停"}
              </button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {liveParams.map((param) => (
              <ParamRow ctx={ctx} param={param} trialProducts={model.trialProducts ?? []} key={param.key} onChanged={reload} />
            ))}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">四道前置闸</span>
          <span className="sub">· 全部由服务器裁决</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {model.gates.map((gate) => (
            <div className="p-row" key={gate.gate}>
              <div className="k">
                {gate.gate}
                {gate.note && <small>{gate.note}</small>}
              </div>
              <span className="bdg cyan">已挂闸</span>
            </div>
          ))}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">7 态会话状态机</span>
          <span className="sub">· 状态只能服务器推进</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="sm-strip">
            {model.states.map((state, index) => (
              <span key={state.key} className={`st ${state.tone}`} style={index > 0 ? { marginLeft: 6 } : undefined}>
                {state.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">会话监控</span>
          <span className="sub">· 后端返回会话状态 · 处置接口幂等</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>账户</th>
                <th>状态</th>
                <th className="num">影子累计</th>
                <th>试用业务号</th>
                <th style={{ textAlign: "right" }}>强制介入</th>
              </tr>
            </thead>
            <tbody>
              {model.sessions.map((session) => {
                const [label, tone] = nextStateLabel(states, session.state);
                const terminal = ["cancelled", "redeemed", "failed"].includes(session.state);
                return (
                  <tr key={session.sid}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{session.sid}</td>
                    <td><span className={`bdg ${tone}`}>{label}</span></td>
                    <td className="num mono">{text(session.shadow)}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(session.cardTok ?? session.cardToken)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {terminal ? (
                        <span style={{ color: "var(--ink-4)" }}>-</span>
                      ) : (
                        <>
                          <button className="l-btn sm mc" onClick={() => openSessionCancel(session)} disabled={!canCancel} style={{ marginRight: 6 }}>
                            强制取消
                          </button>
                          <button className="l-btn sm mc" onClick={() => openSessionCharge(session)} disabled={!canCharge}>
                            强制扣款
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {model.sessions.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24 }}>
                    暂无试用会话；用户完成绑卡并开始试用后将在此出现
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="试用会话"
          page={model.sessionsPage?.pageNum ?? sessionPage}
          pageSize={model.sessionsPage?.pageSize ?? sessionPageSize}
          total={model.sessionsPage?.total ?? model.sessions.length}
          onPageChange={(next) => { reloadEpochRef.current += 1; setSessionPage(next); }}
          onPageSizeChange={(next) => { reloadEpochRef.current += 1; setSessionPage(1); setSessionPageSize(next); }}
        />
      </section>

      <div className="htint warn">
        <b>服务端权威</b> · H2 参数、会话处置和自动推送急停均由服务端执行；当前没有会话时保持明确空态，不生成示例用户。
      </div>

    </>
  );
}

export default H2Trial;
