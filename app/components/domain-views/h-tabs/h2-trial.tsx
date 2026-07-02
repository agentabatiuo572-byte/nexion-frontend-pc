"use client";

import { useEffect, useMemo, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import {
  cancelH2TrialSession,
  chargeH2TrialSession,
  fetchH2Trials,
  killH2AutoPush,
  updateH2TrialParam,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";

type TrialParam = {
  key: string;
  name: string;
  sub?: string;
  cur: string;
  hot?: boolean;
  section?: "newonly" | "live";
  serverOnly?: boolean;
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

type H2Model = {
  stats?: Record<string, any>;
  params: TrialParam[];
  gates: Array<{ gate: string; note?: string }>;
  states: TrialState[];
  sessions: TrialSession[];
  autoPushKilled?: boolean;
  modelA?: Record<string, any>;
  serverOnlyFields?: string[];
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
  return key === "trialDays" || key === "graceDays" || key === "extensionDays";
}

function dayLimitHint(key: string) {
  if (key === "trialDays") return "1-90 天";
  if (key === "graceDays" || key === "extensionDays") return "0-30 天";
  return "";
}

function ParamRow({
  ctx,
  param,
  onChanged,
}: {
  ctx: HCtx;
  param: TrialParam;
  onChanged: (next: H2Model) => void;
}) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const current = text(param.cur);
  const isDay = isTrialDayParam(param.key);
  const displayCurrent = isDay ? `${current} 天` : current;
  const options = param.key === "autoCharge" ? ["开", "关"] : param.key === "trialOpen" ? ["开放", "关闭"] : undefined;
  const detail = (
    <>
      <b>{param.name}</b> · 当前 <span className="mono">{displayCurrent}</span>。
      {param.serverOnly ? "该值仅服务端可见,接口返回仍保持遮罩。" : ""}
      {isDay ? `请输入整数天数(${dayLimitHint(param.key)})。` : ""}
      {param.section === "newonly" ? "只影响新开试用。" : "实时生效。"}
    </>
  );

  const submit = async (reason: string, value?: string) => {
    if (!value || value.trim().length === 0) return;
    const normalizedValue = value.trim();
    if (isDay && !/^\d+$/.test(normalizedValue)) {
      toast(`${param.name} 请输入整数天数`);
      return;
    }
    const next = await updateH2TrialParam(param.key, normalizedValue, reason);
    onChanged(next as H2Model);
    toast(`H2 ${param.name} 已更新`);
  };

  return (
    <div className="p-row" key={param.key}>
      <div className="k">
        {param.name}
        {param.sub && <small>{param.sub}</small>}
      </div>
      <span className="v">{displayCurrent}</span>
      <button
        className={`l-btn sm${param.hot ? " mc" : ""}`}
        onClick={() => {
          if (param.hot || isDay) {
            openActionConfirm({
              action: `${param.hot ? "试用敏感参数" : "试用参数"} · ${param.name}`,
              detail,
              amplifies: false,
              edit: { kind: options ? "select" : isDay ? "number" : "text", current, unit: isDay ? "天" : undefined, options },
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
        调整
      </button>
    </div>
  );
}

export function H2Trial({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [model, setModel] = useState<H2Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setModel((await fetchH2Trials()) as H2Model);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "UNKNOWN_ERROR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const states = useMemo(() => stateMap(model?.states ?? []), [model?.states]);
  const newOnlyParams = (model?.params ?? []).filter((param) => param.section === "newonly");
  const liveParams = (model?.params ?? []).filter((param) => param.section !== "newonly");
  const stats = model?.stats ?? {};

  const openSessionCancel = (session: TrialSession) => {
    openActionConfirm({
      action: `强制取消试用 · ${session.sid}`,
      detail: <>会话会转为 <b>cancelled</b> 终态,由后端幂等处理并审计。</>,
      amplifies: false,
      run: async (reason) => {
        setModel((await cancelH2TrialSession(session.sid, reason)) as H2Model);
        toast(`${session.sid} 已强制取消`);
      },
    });
  };

  const openSessionCharge = (session: TrialSession) => {
    openActionConfirm({
      action: `强制触发扣款 · ${session.sid}`,
      detail: <>后端会按当前试用结算规则重算,重复请求由 Idempotency-Key 去重。</>,
      amplifies: false,
      run: async (reason) => {
        setModel((await chargeH2TrialSession(session.sid, reason)) as H2Model);
        toast(`${session.sid} 扣款已触发`);
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
        setModel((await killH2AutoPush(reason)) as H2Model);
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
        <div className="l-b">{error ?? "UNKNOWN_ERROR"}</div>
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
          <div className="v">{text(model.params.find((param) => param.key === "offsetCap")?.cur)}</div>
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
              <ParamRow ctx={ctx} param={param} key={param.key} onChanged={setModel} />
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 实时生效</span>
            <span className="sub">· 每次结算读最新后端配置</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={openPushKill} disabled={!!model.autoPushKilled}>
                {model.autoPushKilled ? "auto-push 已急停" : "auto-push 急停"}
              </button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {liveParams.map((param) => (
              <ParamRow ctx={ctx} param={param} key={param.key} onChanged={setModel} />
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
                <th>卡 token</th>
                <th style={{ textAlign: "right" }}>强制介入</th>
              </tr>
            </thead>
            <tbody>
              {model.sessions.map((session) => {
                const [label, tone] = nextStateLabel(states, session.state);
                const terminal = ["cancelled", "redeemed"].includes(session.state);
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
                          <button className="l-btn sm mc" onClick={() => openSessionCancel(session)} style={{ marginRight: 6 }}>
                            强制取消
                          </button>
                          <button className="l-btn sm mc" onClick={() => openSessionCharge(session)}>
                            强制扣款
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

      <div className="htint warn">
        <b>server-canonical</b> · H2 参数、会话处置、auto-push 急停都通过后端接口写入;接口无数据时后端先插入默认配置再查询。
      </div>

      <PaginationExemptionList
        items={[
          {
            label: "会话监控",
            maxRows: model.sessions.length,
            reason: "试用会话监控为后端摘要,完整漏斗进 B3/L2",
          },
        ]}
      />
    </>
  );
}

export default H2Trial;
