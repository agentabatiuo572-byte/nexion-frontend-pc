"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataListPager } from "../design-kit";
import {
  fetchH2Trials,
  killH2AutoPush,
  updateH2TrialParam,
} from "@/lib/admin/h-client";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { H2_TRIAL_ACTIONS, pendingH2TrialApprovals, submitH2TrialApproval, type H2TrialApprovalInput, type H2TrialApprovalMode } from "@/lib/admin/h2-trial-approval";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
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
  businessDate?: string;
};

type TrialSession = {
  sid: string;
  userId?: number;
  displayName?: string | null;
  state: string;
  shadow: string;
  cardTok?: string;
  cardToken?: string;
  cancelledAt?: string;
  chargedAt?: string;
  pendingApproval?: { action?: string | null; submittedBy?: string | null; submittedAt?: string | null } | null;
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

function knownTrialOwner(session: TrialSession): boolean {
  return typeof session.userId === "number" && Number.isSafeInteger(session.userId) && session.userId > 0;
}

function trialOwnerLabel(session: TrialSession): string {
  if (!knownTrialOwner(session)) return "用户信息暂不可用";
  const name = typeof session.displayName === "string" ? operatorNicknameText(session.displayName.trim()) : "";
  return `用户编号 ${session.userId}${name ? ` · ${name}` : ""}`;
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
  return formatAdminApiError(reason, "请到「商品管理与上架条件」核对商品状态");
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
  const isOffsetCap = param.key === "trialOffsetCapUSD";
  const isDiscountRate = param.key === "discountRate";
  const current = text(param.cur);
  const isDay = isTrialDayParam(param.key);
  const isInteger = isTrialIntegerParam(param.key);
  const isQuota = param.key === "seatsLeftToday";
  const isActualQuota = param.key === "actualSeatsLeftToday";
  const isProduct = param.key === "trialProductId";
  const currentProduct = isProduct ? trialProducts.find((product) => product.productNo === current) : undefined;
  const displayCurrent = isOffsetCap && (param.cur == null || String(param.cur).trim() === "") ? "不设上限" : isDay ? `${current} 天`
    : isQuota || isActualQuota ? (current === "UNKNOWN" ? "-" : `${current} 张`)
      : isDiscountRate && current !== "-" ? `${current}%`
        : currentProduct ? `${(currentProduct.name)} · ${current}` : param.serverOnly ? operatorCopyText(current) : current;
  const readOnly = !!param.readOnly || isActualQuota || ["phaseOpen", "trialPriceUSD"].includes(param.key);
  const productOptions = trialProducts.map((product) => product.productNo);
  const disabledProductOptions = trialProducts
    .filter((product) => !product.selectable)
    .map((product) => product.productNo);
  const productOptionLabels = Object.fromEntries(trialProducts.map((product) => [
    product.productNo,
    `${(product.name)} · ${product.productNo} · 库存 ${product.stock ?? 0} · $${text(product.priceUsdt, "-")}${product.selectable ? "" : ` · 不可选：${trialProductReason(product.unavailableReason)}`}`,
  ]));
  const options = ["autoPushEnabled"].includes(param.key)
    ? ["开", "关"]
    : param.key === "phaseOpen" ? ["开放", "关闭"]
      : isProduct ? productOptions : undefined;
  const detail = (
    <>
      <b>{operatorCopyText(param.name)}</b> · 当前 <span className="mono">{displayCurrent}</span>。
      {param.serverOnly ? "这个值只在系统内部使用，页面不显示真实值。" : ""}
      {isInteger ? `请输入整数（${dayLimitHint(param.key)}）。` : ""}
      {isProduct ? "只能选「商品管理与上架条件」里开启了「允许试用」的在售实物商品；试用价格就是该商品的当前售价。" : ""}
      {isProduct && currentProduct && !currentProduct.selectable ? (
        <span style={{ display: "block", marginTop: 5, color: "var(--danger)", fontWeight: 700 }}>
          当前目标商品不可用 · 库存 {currentProduct.stock ?? 0} · {trialProductReason(currentProduct.unavailableReason)}
        </span>
      ) : null}
      {param.section === "newonly" ? "只影响新开始的试用。" : "马上生效。"}
    </>
  );

  const submit = async (reason: string, value?: string) => {
    if (readOnly || !canWrite || param.key === "autoChargeAtEnd") return;
    if (value === undefined || (!isOffsetCap && value.trim().length === 0)) return;
    const normalizedValue = value.trim();
    if (isInteger && !/^\d+$/.test(normalizedValue)) {
      toast(`${operatorCopyText(param.name)} 请输入整数`);
      return;
    }
    if (isQuota && Number(normalizedValue) > 1_000_000) {
      toast(`${operatorCopyText(param.name)} 必须在 0-1000000 张之间`);
      return;
    }
    await updateH2TrialParam(param.key, normalizedValue, reason);
    await onChanged();
    toast(`${operatorCopyText(param.name)} 已更新`);
  };

  if (param.key === "autoChargeAtEnd") return null;

  return (
    <div className="p-row" key={param.key}>
      <div className="k">
        {operatorCopyText(param.name)}
        {param.sub && <small>{operatorCopyText(param.sub)}</small>}
        {isActualQuota && param.businessDate && param.businessDate !== "UNKNOWN" && <small>日期 {param.businessDate}</small>}
      </div>
      <span className="v">{displayCurrent}</span>
      {isProduct ? <a className="l-btn sm" href={`/devices/pricing?sku=${encodeURIComponent(current)}`}>去商品管理查看</a> : null}
      <button
        className={`l-btn sm${param.hot ? " mc" : ""}`}
        disabled={readOnly || !canWrite}
        aria-label={readOnly ? `只读 · ${operatorCopyText(param.name)}` : canWrite ? `调整 ${operatorCopyText(param.name)}` : `没有修改权限 · ${operatorCopyText(param.name)}`}
        title={readOnly ? (operatorCopyText(param.sub || "") || (param.key === "phaseOpen" ? "跟随「运营阶段设置」，只能查看"
          : param.key === "trialPriceUSD" ? "跟随商品售价，只能查看" : "只能查看")) : undefined}
        onClick={() => {
          if (readOnly || !canWrite) return;
          if (param.hot || isInteger || isProduct) {
            openActionConfirm({ briefKind: "config",
              action: `调整试用参数 · ${operatorCopyText(param.name)}`,
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
          openConfirm({ briefKind: "config",
            action: `调整试用参数 · ${operatorCopyText(param.name)}`,
            detail,
            content: isDiscountRate ? <p className="muted">请输入 0 至 100，可填写小数。填 1 表示 1%。</p> : undefined,
            chips: [["记入操作记录", "done"]],
            reason: true,
            input: {
              label: isOffsetCap ? "新值（可选，留空即不设上限）" : isDiscountRate ? "新值（%）" : "新值",
              placeholder: isOffsetCap ? "留空即不设上限；0 表示上限为 0" : `当前 ${displayCurrent}`,
              options,
              required: !isOffsetCap,
            },
            okLabel: "确认修改",
            run: submit,
          });
        }}
      >
        {readOnly ? "只读" : canWrite ? "调整" : "无权限"}
      </button>
    </div>
  );
}

export function H2Trial({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canWrite = ctx.can("growth_h2_write");
  const canCancel = ctx.can("growth_h2_session_cancel");
  const canCharge = ctx.can("growth_h2_session_charge");
  const adminSession = useAdminAuth((state) => state.session);
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
  const newOnlyParams = (model?.params ?? []).filter((param) => param.key !== "autoChargeAtEnd" && param.section === "newonly");
  const liveParams = (model?.params ?? []).filter((param) => param.key !== "autoChargeAtEnd" && param.section !== "newonly");
  const stats = model?.stats ?? {};

  const pendingBySession = new Map(adminSession ? pendingH2TrialApprovals(adminSession.adminId).map((attempt) => [attempt.sid, attempt]) : []);
  const canPropose = (op: H2TrialApprovalInput["op"]) => op === "h2_trial_cancel" ? canCancel : canCharge;

  const openSessionApproval = (session: TrialSession, requestedOp: H2TrialApprovalInput["op"], recovery = false) => {
    if (!adminSession || !canPropose(requestedOp)) return;
    const original = () => pendingH2TrialApprovals(adminSession.adminId).find((record) => record.sid === session.sid);
    const previous = original();
    if (recovery ? !previous : previous || session.pendingApproval || !knownTrialOwner(session)) return;
    const input = previous ?? { op: requestedOp, sid: session.sid, obj: `${trialOwnerLabel(session)} · ${session.sid}`, before: session.state };
    const charge = input.op === "h2_trial_charge";
    const detail = charge ? "批准后按当前试用规则重新计算并扣用户的 USDT。" : "批准后结束这次试用，并标记为已取消。";
    const run = async (reason: string, mode: H2TrialApprovalMode = "submit") => {
      if (useAdminAuth.getState().session?.adminId !== adminSession.adminId) {
        throw new Error("登录账号已变化，请关闭弹窗后重新操作。");
      }
      const ticket = await submitH2TrialApproval(adminSession, input, reason, mode);
      if (!ticket) return false;
      toast(ticket.status === "pending"
        ? `已提交审批 · 审批单 ${ticket.id} · 等待另一位有权限的管理员批准`
        : `已找到原审批单 ${ticket.id}，请在操作记录查看处理结果`);
      openActionConfirm(null);
      void reload();
      return true;
    };
    openActionConfirm({
      briefKind: charge ? "funds" : "record",
      action: `${H2_TRIAL_ACTIONS[input.op]} · ${session.sid}`,
      detail: <>{input.obj}。{detail}</>,
      amplifies: charge,
      getPendingReason: () => original()?.reason,
      inlineApproval: {
        pending: !!previous,
        expired: !!previous && previous.expiresAt <= Date.now(),
        resolve: () => ({
          heading: "需另一位有权限的管理员批准",
          completionCopy: `${input.obj}。提交后等待审批，待审期间试用记录保持原样。${detail}`,
        }),
        recover: () => run("", "lookup"),
        retry: async () => { await run("", "retry"); },
      },
      run: async (reason) => { await run(reason); },
    });
  };

  const openPushKill = () => {
    openConfirm({ briefKind: "record",
      action: "紧急关闭试用邀请弹窗",
      detail: <>马上停止给用户自动弹出试用邀请。</>,
      chips: [["马上生效", "ready"], ["记入操作记录", "done"]],
      reason: true,
      okLabel: "确认关闭",
      run: async (reason) => {
        await killH2AutoPush(reason);
        await reload();
        toast("试用邀请弹窗已关闭");
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">试用数据加载中…</div></section>;
  }

  if (error || !model) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">试用数据加载失败</span></div>
        <div className="l-b">
          <div style={{ marginBottom: 12 }}>{error ?? "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
          <button className="l-btn sm mc" onClick={() => void reload()}>重试</button>
        </div>
      </section>
    );
  }

  const offsetCap = model.params.find((param) => param.key === "trialOffsetCapUSD")?.cur;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">进行中的试用</div>
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
          <div className="v">{offsetCap == null || String(offsetCap).trim() === "" ? "不设上限" : `$${text(offsetCap)}`}</div>
          <div className="sub">每笔抵扣额由系统自动计算</div>
        </div>
        <div className="f-stat danger">
          <div className="k">拦截反复薅试用</div>
          <div className="v">{text(stats.k2Blocked, "0")} 人</div>
          <div className="sub">这些用户已不能再试用</div>
        </div>
      </div>

      <div className="htint cyan" style={{ marginBottom: 16 }}>
        <b>试用收益怎么抵扣</b> · <span>抵扣额 = 试用期累计收益和抵扣上限中较小的那个</span>。
        扣款失败概率等内部数据不在页面显示。
      </div>

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 只影响新开始的试用</span>
            <span className="sub">· 已在进行的试用不受影响</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {newOnlyParams.map((param) => (
              <ParamRow ctx={ctx} param={param} trialProducts={model.trialProducts ?? []} key={param.key} onChanged={reload} />
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">试用参数 · 马上生效</span>
            <span className="sub">· 每次结算都用最新设置</span>
            <div className="r">
              <button className="l-btn sm mc" onClick={openPushKill} disabled={!!model.autoPushKilled || !canWrite}>
                {model.autoPushKilled ? "试用邀请弹窗已关闭" : "紧急关闭试用邀请弹窗"}
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
          <span className="ttl">开始试用前的四项检查</span>
          <span className="sub">· 全部通过才能开始试用</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {model.gates.map((gate) => (
            <div className="p-row" key={gate.gate}>
              <div className="k">
                {gate.gate}
                {gate.note && <small>{gate.note}</small>}
              </div>
              <span className="bdg cyan">已启用</span>
            </div>
          ))}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">试用流程的七种状态</span>
          <span className="sub">· 状态由系统自动更新</span>
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
          <span className="ttl">试用记录</span>
          <span className="sub">· 可以强制取消</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>账户</th>
                <th>状态</th>
                <th className="num">试用期累计收益</th>
                <th>试用编号</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {model.sessions.map((session) => {
                const [label, tone] = nextStateLabel(states, session.state);
                const terminal = ["cancelled", "redeemed", "failed"].includes(session.state);
                const approval = session.pendingApproval;
                const previous = pendingBySession.get(session.sid);
                const blocked = Boolean(approval || previous) || !knownTrialOwner(session);
                return (
                  <tr key={session.sid}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{trialOwnerLabel(session)}</td>
                    <td>
                      <span className={`bdg ${tone}`}>{label}</span>
                      {approval && <div>
                        <span className="bdg warn">待审批</span>
                        <span className="tiny">{[approval.action, approval.submittedBy, approval.submittedAt && formatBusinessTimeCompact(approval.submittedAt)].filter(Boolean).join(" · ")}</span>
                      </div>}
                    </td>
                    <td className="num mono">{operatorCopyText(text(session.shadow))}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(session.cardTok ?? session.cardToken)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {terminal ? (
                        <span style={{ color: "var(--ink-4)" }}>-</span>
                      ) : (
                        <>
                          <button className="l-btn sm mc" onClick={() => openSessionApproval(session, "h2_trial_cancel")} disabled={!canCancel || blocked} style={{ marginRight: 6 }}>
                            强制取消
                          </button>
                        </>
                      )}
                      {previous && canPropose(previous.op) && <button className="l-btn sm" onClick={() => openSessionApproval(session, previous.op, true)}>查询原操作</button>}
                    </td>
                  </tr>
                );
              })}
              {model.sessions.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24 }}>
                    暂无试用记录；用户绑卡并开始试用后会显示在这里
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="试用记录"
          page={model.sessionsPage?.pageNum ?? sessionPage}
          pageSize={model.sessionsPage?.pageSize ?? sessionPageSize}
          total={model.sessionsPage?.total ?? model.sessions.length}
          onPageChange={(next) => { reloadEpochRef.current += 1; setSessionPage(next); }}
          onPageSizeChange={(next) => { reloadEpochRef.current += 1; setSessionPage(1); setSessionPageSize(next); }}
        />
      </section>

      <div className="htint warn">
        试用参数、强制取消、关闭邀请弹窗都会记入操作记录。
      </div>

    </>
  );
}

export default H2Trial;
