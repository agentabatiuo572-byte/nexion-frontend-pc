"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DataListPager, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import { K1OutcomeUncertainError, newK1CommandKey, type K5ManualResult, type K5Stats, type K5Ticket, type K5UserOption, type KRiskParam, type TicketSt } from "@/lib/admin/k-client";
import type { K5KycStatus } from "@/lib/admin/k5-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
/** 一个操作槽位(`decision:工单号` / `param:参数键` / …)同时只有一次在途尝试:
 *  输入指纹没变就复用命令号,变了铸新号并丢弃旧号。落 sessionStorage,刷新后重试仍去重。 */
const commandAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-k5-kyc-commands-v1",
});

const TICKET_ST: Record<TicketSt, [string, string]> = {
  triggered: ["已触发", "dim"],
  "in-review": ["复审中", "warn"],
  overdue: ["已超时", "bad"],
  passed: ["已通过", "ok"],
  rejected: ["已驳回", "bad"],
};

function slaColor(pct: number) {
  return pct >= 0.9 ? "var(--danger)" : pct >= 0.65 ? "var(--warning)" : "var(--success)";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export function K5HeaderActions() {
  return <span className="f-ro"><span className="d" />触发与裁决均保留审计 · 实名状态权威归用户域 C4</span>;
}

type Filter = "all" | "大额提现" | "大额兑换" | "累计过线" | "手动触发" | "风险分触发" | "overdue";
const FILTERS: [Filter, string][] = [["all", "全部"], ["大额提现", "大额提现"], ["大额兑换", "大额兑换"], ["累计过线", "累计过线"], ["手动触发", "手动触发"], ["风险分触发", "风险分触发"], ["overdue", "已超时"]];

const REJECT_REASON_CODES = ["KYC_MATERIAL_INVALID", "IDENTITY_MISMATCH", "SANCTIONS_LIST_MATCH", "OTHER"];
const REJECT_REASON_LABELS: Record<string, string> = {
  KYC_MATERIAL_INVALID: "材料不符",
  IDENTITY_MISMATCH: "身份存疑",
  SANCTIONS_LIST_MATCH: "制裁名单关联",
  OTHER: "其他",
};
const ALERT_TYPES = ["threshold-hit", "sla-breach", "large-withdraw-burst"];
const ALERT_TYPE_LABELS: Record<string, string> = { "threshold-hit": "新复审命中", "sla-breach": "复审超时", "large-withdraw-burst": "短时大额集中" };
const ALERT_CHANNELS = ["in-app"];
const ALERT_CHANNEL_LABELS: Record<string, string> = { "in-app": "站内通知" };
const K5_KYC_LABELS: Record<K5KycStatus, string> = {
  APPROVED: "已通过",
  PENDING: "复审中",
  NONE: "未认证",
  REJECTED: "已拒绝",
  USER_UNAVAILABLE: "用户不可用",
};
const K5_INFO_LABELS: Record<string, string> = {
  sourceDomain: "来源模块",
  sourceNo: "来源单号",
};
const K5_DECISION_CODE_LABELS: Record<string, string> = {
  KYC_REVIEW_PASSED: "复审通过",
  KYC_MATERIAL_INVALID: "材料不符",
  IDENTITY_MISMATCH: "身份存疑",
  SANCTIONS_LIST_MATCH: "制裁名单关联",
  OTHER: "其他",
};

function kycLabel(status: K5KycStatus) {
  return K5_KYC_LABELS[status];
}

function displayK5Info(label: string, value: string): [string, string] {
  const visibleLabel = K5_INFO_LABELS[label] ?? label;
  const visibleValue = label === "实名状态" && value in K5_KYC_LABELS
    ? kycLabel(value as K5KycStatus)
    : value;
  return [visibleLabel, visibleValue];
}

function authoritativeK5Info(ticket: K5Ticket): [string, string][] {
  return [
    ["实名状态(C4)", kycLabel(ticket.kyc)],
    ...ticket.info
      .filter(([label]) => label !== "实名状态")
      .map(([label, value]) => displayK5Info(label, value)),
  ];
}

function displayK5History(value: string) {
  return Object.entries(K5_DECISION_CODE_LABELS).reduce(
    (text, [code, label]) => text.replaceAll(code, label),
    value,
  );
}

type LargeWithdrawLine = { kind: "large"; operator: string; amount: string };
type CumulativeLine = { kind: "cumulative"; amount: string };
type SlaLine = { kind: "sla"; days: string };
type ScoreLine = { kind: "score"; operator: string; score: string };
type K5Line = LargeWithdrawLine | CumulativeLine | SlaLine | ScoreLine;

function moneyText(value: string | undefined, fallback: string) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits || fallback;
}

function moneyLabel(value: string | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "0";
}

function intValue(value: string | undefined, min: number, max: number): number | null {
  const parsed = Number(String(value ?? "").replace(/[^\d-]/g, ""));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseK5Line(key: string, value: string): K5Line | null {
  const text = value.trim();
  if (key === "largeWithdrawReviewUsdt") {
    const matched = text.match(/^(>=|>)\s*\$?([\d,]+)$/);
    return matched ? { kind: "large", operator: matched[1], amount: moneyText(matched[2], "1000") } : null;
  }
  if (key === "cumulativeKycThresholdUsdt") {
    const matched = text.match(/^\$?([\d,]+)$/);
    return matched ? { kind: "cumulative", amount: moneyText(matched[1], "100") } : null;
  }
  if (key === "reviewSlaDays") {
    const matched = text.match(/^(\d+)$/);
    return matched ? { kind: "sla", days: matched[1] } : null;
  }
  if (key === "reviewTriggerScore") {
    const matched = text.match(/^(>=|>)\s*(\d+)$/);
    return matched ? { kind: "score", operator: matched[1], score: matched[2] } : null;
  }
  return null;
}

function k5ParamBusinessForm(p: KRiskParam): BusinessFormSpec | null {
  const current = parseK5Line(p.key, p.value);
  if (!current) return null;
  if (current.kind === "large") {
    return {
      kind: "multi-field",
      title: "业务表单 · 大额提现复审线",
      hint: "提交值由字段生成,格式为“比较符 金额”。后端校验范围:$100-$50,000。",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
        { key: "amount", label: "单笔提现金额 USDT", current: current.amount, inputKind: "number", min: 100, max: 50000, step: 100 },
      ],
    };
  }
  if (current.kind === "cumulative") {
    return {
      kind: "multi-field",
      title: "业务表单 · 累计金额触发线",
      hint: "累计金额采用终身累计口径,提交值由金额字段生成。后端校验范围:$50-$1,000。",
      fields: [
        { key: "amount", label: "终身累计金额 USDT", current: current.amount, inputKind: "number", min: 50, max: 1000, step: 10 },
      ],
    };
  }
  if (current.kind === "sla") {
    return {
      kind: "multi-field",
      title: "业务表单 · 复审时限",
      hint: "复审 SLA 单独配置,后端校验范围:1-15 个工作日。",
      fields: [
        { key: "days", label: "复审时限(工作日)", current: current.days, inputKind: "number", min: 1, max: 15, step: 1 },
      ],
    };
  }
  return {
    kind: "multi-field",
    title: "业务表单 · 风险分触发线",
    hint: "K4 有效风险分达到该分值后自动生成 K5 复审工单。后端校验范围:70-100 分。",
    fields: [
      { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
      { key: "score", label: "K4 有效风险分", current: current.score, inputKind: "number", min: 70, max: 100, step: 1 },
    ],
  };
}

function decisionEvidence(ticket: K5Ticket) {
  const information = authoritativeK5Info(ticket).map(([label, value]) => `${label}：${value}`).join("；") || "后端未提供工单信息";
  const triggerReasons = ticket.info
    .filter(([label]) => label.includes("触发") || label === "来源")
    .map(([, value]) => value)
    .join("；") || ticket.type;
  const materials = ticket.info
    .filter(([label]) => label.includes("材料"))
    .map(([, value]) => value)
    .join("；") || "当前工单无单独材料引用";
  const withdrawals = ticket.info
    .filter(([label]) => label.includes("提现单") || label === "sourceNo")
    .map(([, value]) => value)
    .join("；") || "无关联记录（非提现触发）";
  const history = ticket.hist.map(([time, event]) => `${time} ${displayK5History(event)}`).join("；") || "暂无历史事件";
  return `工单 ID：${ticket.id}；账户：${ticket.user}；触发原因：${triggerReasons}；金额：${ticket.amt}；累计值：${ticket.cum}；C4 当前实名态：${kycLabel(ticket.kyc)}；提交材料：${materials}；SLA 剩余：${ticket.slaTxt}；关联 D2 提现单：${withdrawals}；完整工单信息：${information}；完整复审历史：${history}。`;
}

function buildK5ParamValue(key: string, value?: BusinessFormValue): string | null {
  if (!value) return null;
  if (key === "largeWithdrawReviewUsdt") {
    const amount = intValue(value.amount, 100, 50000);
    return amount == null ? null : `${value.operator === ">" ? ">" : ">="} $${amount.toLocaleString("en-US")}`;
  }
  if (key === "cumulativeKycThresholdUsdt") {
    const amount = intValue(value.amount, 50, 1000);
    return amount == null ? null : `$${amount.toLocaleString("en-US")}`;
  }
  if (key === "reviewSlaDays") {
    const days = intValue(value.days, 1, 15);
    return days == null ? null : String(days);
  }
  if (key === "reviewTriggerScore") {
    const score = intValue(value.score, 70, 100);
    return score == null ? null : `${value.operator === ">" ? ">" : ">="} ${score}`;
  }
  return null;
}

function K5ParamValue({ param }: { param: KRiskParam }) {
  const line = parseK5Line(param.key, param.value);
  if (!line) return <>{param.value}</>;
  if (line.kind === "large") {
    return (
      <span className="threshold-parts">
        <span className="seg op">{line.operator}</span>
        <span className="seg num">${moneyLabel(line.amount)}</span>
      </span>
    );
  }
  if (line.kind === "cumulative") {
    return (
      <span className="threshold-parts">
        <span className="seg num">${moneyLabel(line.amount)}</span>
        <span className="seg">终身累计</span>
      </span>
    );
  }
  if (line.kind === "sla") {
    return (
      <span className="threshold-parts">
        <span className="seg num">{line.days}</span>
        <span className="seg">工作日</span>
      </span>
    );
  }
  return (
    <span className="threshold-parts">
      <span className="seg op">{line.operator}</span>
      <span className="seg num">{line.score}</span>
      <span className="seg">分</span>
    </span>
  );
}

export function K5Kyc({ ctx }: { ctx: KCtx }) {
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canRead = authorities.includes("risk_k5_read");
  const canWrite = authorities.includes("risk_k5_write");
  const canManual = authorities.includes("risk_k5_ticket_manual");
  const canPass = authorities.includes("risk_k5_ticket_pass");
  const canReject = authorities.includes("risk_k5_ticket_reject");
  const overview = ctx.risk.kycReview;
  const stats: Partial<K5Stats> = overview?.stats ?? {};
  const params = overview?.params ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketPageSize, setTicketPageSize] = useState(5);
  const [manualUserSearch, setManualUserSearch] = useState("");
  const [manualUserOptions, setManualUserOptions] = useState<K5UserOption[]>([]);
  const [manualUserOpen, setManualUserOpen] = useState(false);
  const [manualUserLoading, setManualUserLoading] = useState(false);
  const [manualUserError, setManualUserError] = useState<string | null>(null);
  const [selectedManualUser, setSelectedManualUser] = useState<K5UserOption | null>(null);
  const [manualTriggering, setManualTriggering] = useState(false);
  const [lastManualResult, setLastManualResult] = useState<K5ManualResult | null>(null);
  const pendingManualTicket = useRef<string | null>(null);
  const manualUserOptionsId = useId();
  const ticketsPage = overview?.tickets;
  const tickets = ticketsPage?.records ?? [];
  const alerts = overview?.alerts ?? [];
  const subscription = overview?.subscription;
  const [draftAlertTypes, setDraftAlertTypes] = useState<string[]>([]);
  const [draftAlertChannels, setDraftAlertChannels] = useState<string[]>([]);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const [sel, setSel] = useState("");
  const pageQuery = useMemo(() => ({
    ticketPageNum: ticketPage,
    ticketPageSize,
    ticketFilter: filter === "all" ? undefined : filter,
  }), [filter, ticketPage, ticketPageSize]);
  const cur = tickets.find((t) => t.id === sel) ?? tickets[0];
  const stat = (key: keyof K5Stats) => Number(stats[key] ?? 0);

  useEffect(() => {
    if (canRead) void ctx.reloadKRisk({ kycReview: pageQuery }).catch(() => undefined);
  }, [canRead, ctx.reloadKRisk, pageQuery]);

  useEffect(() => {
    setSel("");
  }, [filter, ticketPage, ticketPageSize]);

  useEffect(() => {
    const target = pendingManualTicket.current;
    if (!target || !tickets.some((ticket) => ticket.id === target)) return;
    setSel(target);
    pendingManualTicket.current = null;
  }, [tickets]);

  useEffect(() => {
    if (!subscription) return;
    setDraftAlertTypes(subscription.alertTypes);
    setDraftAlertChannels(subscription.channels);
  }, [subscription?.version]);

  useEffect(() => {
    if (!canManual || !overview) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setManualUserLoading(true);
      setManualUserError(null);
      ctx.actions.searchK5Users(manualUserSearch)
        .then((options) => { if (alive) setManualUserOptions(options); })
        .catch((error) => {
          if (!alive) return;
          setManualUserOptions([]);
          setManualUserError(errorText(error));
        })
        .finally(() => { if (alive) setManualUserLoading(false); });
    }, 240);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [canManual, ctx.actions, manualUserSearch, overview]);

  const runAction = async (operation: string, fingerprint: string, work: (commandKey: string) => Promise<void>, ok: string) => {
    const commandKey = commandAttempts.resolve(operation, fingerprint, newK1CommandKey);
    let writeConfirmed = false;
    try {
      await work(commandKey);
      writeConfirmed = true;
      commandAttempts.forget(operation);
      try {
        await ctx.reloadKRisk({ kycReview: pageQuery });
      } catch (error) {
        ctx.toast(`操作已生效但最新状态读取失败，请勿重复提交；请仅重试 K5 读取 · ${errorText(error)}`);
        return;
      }
      ctx.toast(ok);
    } catch (error) {
      if (writeConfirmed) return;
      if (error instanceof K1OutcomeUncertainError) {
        ctx.toast(`K5 结果未知 · 请保留确认框并使用同一请求重试或先核对 · 请求号 ${commandKey}`);
      } else {
        commandAttempts.forget(operation);
        ctx.toast(`K5 操作失败 · ${errorText(error)}`);
      }
      throw error;
    }
  };

  const decide = (t: K5Ticket, pass: boolean) =>
    ctx.openActionConfirm({
      action: `${pass ? "通过" : "驳回"} KYC 复审 · ${t.id}`,
      detail: `${decisionEvidence(t)}${pass ? "通过后回写 C4，并将关联提现单回到 D2 人工审核队列、G2 兑换回到处理队列；不会直接放行资金。" : "驳回后回写 C4；关联 D2 提现单维持冻结并进入驳回路径，不自动冻结账户或改变 K3。"}当前工单版本 v${t.version}，裁决写入后端并保留审计。`,
      reasonMax: 200,
      businessForm: pass ? undefined : {
        kind: "multi-field",
        title: "业务表单 · 驳回原因",
        fields: [{
          key: "reasonCode",
          label: "驳回原因",
          current: REJECT_REASON_CODES[0],
          inputKind: "select",
          options: REJECT_REASON_CODES,
          optionLabels: REJECT_REASON_LABELS,
          required: true,
        }],
      },
      run: (reason, _newValue, businessValue) => {
        const reasonCode = pass ? undefined : businessValue?.reasonCode;
        if (!pass && !reasonCode) throw new Error("请选择驳回原因");
        const decision = pass ? "passed" : "rejected";
        return runAction(
          `decision:${t.id}`,
          `${decision}:${t.version}:${reasonCode ?? "PASS"}:${reason}`,
          (commandKey) => ctx.actions.decideK5Ticket(t.id, decision, t.version, reasonCode, reason, commandKey),
          `${t.id} 已${pass ? "通过" : "驳回"}`,
        );
      },
    });

  const directManualTrigger = async () => {
    const userNo = selectedManualUser?.userNo ?? "";
    if (!userNo) throw new Error("请先从真实用户候选中选择账户");
    const reason = "运营从 K5 队列选择真实用户并手动补触发复审";
    setManualTriggering(true);
    try {
      await runAction(
        `manual:${userNo}`,
        `${userNo}:${reason}`,
        async (commandKey) => {
          const result = await ctx.actions.createK5ManualTicket(userNo, reason, commandKey);
          setLastManualResult(result);
          pendingManualTicket.current = result.ticketId;
        },
        `${userNo} 已进入增强复审队列；已有开放工单时已合并原因`,
      );
      setFilter("all");
      setTicketPage(1);
      setTicketPageSize(50);
      setSelectedManualUser(null);
      setManualUserSearch("");
    } finally {
      setManualTriggering(false);
    }
  };

  const toggleSubscription = (value: string, selected: string[], setSelected: (next: string[]) => void) => {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const saveAlertSubscription = async () => {
    if (!subscription || !draftAlertTypes.length || !draftAlertChannels.length) {
      throw new Error("至少选择一个告警类型和接收渠道");
    }
    const reason = "运营在 K5 异常告警区更新个人告警订阅配置";
    setSubscriptionSaving(true);
    try {
      await runAction(
        "alert-subscription",
        `${draftAlertTypes.join(",")}:${draftAlertChannels.join(",")}:${subscription.version}:${reason}`,
        (commandKey) => ctx.actions.updateK5AlertSubscription(draftAlertTypes, draftAlertChannels, subscription.version, reason, commandKey),
        "告警订阅已保存到后端并按新选择生效",
      );
    } finally {
      setSubscriptionSaving(false);
    }
  };

  const adjParam = (p: KRiskParam) => {
    const businessForm = k5ParamBusinessForm(p);
    if (!businessForm) {
      ctx.toast("K5 参数暂不支持在此页面调整");
      return;
    }
    ctx.openActionConfirm({
      action: `触发线调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${p.value}${p.unit ? ` ${p.unit}` : ""}。${p.note}`,
      reasonMax: 200,
      businessForm,
      run: (reason, _newVal, businessValue) => {
        const value = buildK5ParamValue(p.key, businessValue);
        if (!value) {
          throw new Error("K5 触发线配置不完整");
        }
        return runAction(
          `param:${p.key}`,
          `${value}:${p.version}:${reason}`,
          (commandKey) => ctx.actions.updateK5Param(p.key, value, p.version, reason, commandKey),
          `${p.name} 已更新为 ${value}`,
        );
      },
    });
  };

  if (!canRead) {
    return <section className="l-card"><div className="l-h"><span className="ttl">无权查看 KYC 复审</span><span className="sub">· 需要 risk_k5_read 权限</span></div></section>;
  }
  if (ctx.contentLoading) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K5 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }
  if (ctx.contentError) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K5 数据加载失败</span><span className="sub">· {ctx.contentError} · 已隐藏旧数据与写操作，避免误处置</span><div className="r"><button className="l-btn" onClick={() => void ctx.reloadKRisk({ kycReview: pageQuery }).catch(() => undefined)}>仅重试 K5</button></div></div></section>;
  }
  if (!overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K5 暂无可展示数据</span><span className="sub">· 请重试读取</span></div></section>;
  }

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待复审工单</div><div className="v">{stat("openTickets")}</div><div className="sub">来自后端复审队列</div></div>
        <div className="f-stat danger"><div className="k">超时工单</div><div className="v">{stat("reviewOverdue")}</div><div className="sub">已自动告警 · 待人工处置</div></div>
        <div className="f-stat"><div className="k">本月已裁决</div><div className="v">{stat("reviewDecidedMonth")}</div><div className="sub">通过 {stat("reviewDecidedPass")} · 驳回 {stat("reviewDecidedMonth") - stat("reviewDecidedPass")}</div></div>
        <div className="f-stat cyan"><div className="k">复审期冻结金额</div><div className="v">${fmt(stat("reviewFrozenUsd"))}</div><div className="sub">对应提现单冻结中</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">触发线</span>
          <span className="sub">· 兑换相关阈值归兑换风控配置,这里只消费兑换事件</span>
          <div className="r"><span className="kcode lock">兑换阈值归 G2 · 只读</span></div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {params.map((p) => (
              <div className="p" key={p.key}>
                <div className="k">{p.name}</div>
                <div className="v">
                  <K5ParamValue param={p} />
                  {p.unit ? <span className="vu">{p.unit}</span> : null}
                  {p.adjustable && canWrite ? <button className="l-btn sm mc" onClick={() => adjParam(p)}>调整</button> : null}
                </div>
                <div className="s">{p.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">复审触发队列</span>
          <span className="sub">· 点任意一行看工单 · 时限条变红 = 快超时</span>
          <div className="r">
            <div className="chips">
              {FILTERS.map(([v, lb]) => (
                <button
                  key={v}
                  className={`chip${filter === v ? " sel" : ""}`}
                  onClick={() => {
                    setFilter(v);
                    setTicketPage(1);
                  }}
                >
                  {lb}
                </button>
              ))}
            </div>
            {canManual ? <>
              <div style={{ position: "relative", minWidth: 230 }}>
                <input
                  className="fld"
                  role="combobox"
                  aria-label="搜索真实用户"
                  aria-expanded={manualUserOpen}
                  aria-controls={manualUserOptionsId}
                  disabled={manualTriggering}
                  value={manualUserSearch}
                  placeholder="搜索真实用户，如 U00000052"
                  onFocus={() => setManualUserOpen(true)}
                  onChange={(event) => {
                    setManualUserSearch(event.target.value);
                    setSelectedManualUser(null);
                    setManualUserOpen(true);
                  }}
                />
                {manualUserOpen ? <div id={manualUserOptionsId} role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 20, display: "grid", gap: 5, padding: 8, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                  {manualUserLoading ? <div className="note" style={{ padding: 8 }}>正在查询真实用户…</div> : null}
                  {!manualUserLoading && manualUserError ? <div className="note" style={{ padding: 8, color: "var(--danger)" }}>{manualUserError}</div> : null}
                  {!manualUserLoading && !manualUserError && !manualUserOptions.length ? <div className="note" style={{ padding: 8 }}>暂无匹配的可复审用户</div> : null}
                  {!manualUserLoading && !manualUserError ? manualUserOptions.map((option) => <button
                    type="button"
                    role="option"
                    aria-selected={selectedManualUser?.userNo === option.userNo}
                    className="l-btn"
                    key={option.userNo}
                    style={{ justifyContent: "flex-start", textAlign: "left" }}
                    onClick={() => {
                      setSelectedManualUser(option);
                      setManualUserSearch(option.userNo);
                      setManualUserOpen(false);
                    }}
                  >{option.label} · {option.sub}</button>) : null}
                </div> : null}
              </div>
              <button className="l-btn" disabled={manualTriggering || !selectedManualUser} title={!selectedManualUser ? "请先从真实用户候选中选择账户" : "直接建立复审工单并留审计；已有开放工单会合并原因"} onClick={() => directManualTrigger().catch(() => undefined)}>{manualTriggering ? "触发中…" : "手动补触发"}</button>
              {lastManualResult ? <span className="sub" role="status">{lastManualResult.userNo} · {lastManualResult.merged ? "已并入工单" : "已新建工单"} {lastManualResult.ticketId}</span> : null}
            </> : null}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>工单</th><th>触发类型</th><th>账户</th><th className="num">金额 / 累计</th><th>实名状态(C4)</th><th>复审状态</th><th>时限</th></tr></thead>
            <tbody>
              {tickets.map((t) => {
                const [stLb, stTone] = TICKET_ST[t.st];
                return (
                  <tr key={t.id} className="click" onClick={() => setSel(t.id)} style={t.st === "overdue" ? { background: "var(--danger-soft)" } : undefined}>
                    <td className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{t.id}</td>
                    <td><span className="bdg dim">{t.type}</span></td>
                    <td className="mono">{t.user}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{t.amt !== "—" ? t.amt : t.cum}</td>
                    <td style={{ fontSize: 12 }}>{kycLabel(t.kyc)}</td>
                    <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                    <td>
                      <span className="sla">
                        <span className="track"><i style={{ width: `${t.slaPct * 100}%`, background: slaColor(t.slaPct) }} /></span>
                        <span className="t" style={{ color: slaColor(t.slaPct) }}>{t.slaTxt}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!tickets.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>暂无复审工单</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="复审触发队列"
          page={ticketsPage?.pageNum ?? ticketPage}
          pageSize={ticketsPage?.pageSize ?? ticketPageSize}
          total={ticketsPage?.total ?? tickets.length}
          onPageChange={setTicketPage}
          onPageSizeChange={(next) => {
            setTicketPageSize(next);
            setTicketPage(1);
          }}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>

      <div className="two-col r14">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">复审工单 · {cur?.id ?? "暂无"}</span>
            <span className="sub">· 材料引用自实名服务商 · 裁决回写用户域</span>
            <div className="r">
              {cur?.kyc === "USER_UNAVAILABLE" ? (
                <span className="sub">用户不存在，无法裁决；请先核对 C4 账户状态</span>
              ) : cur && (cur.st === "in-review" || cur.st === "overdue") && (canPass || canReject) ? (
                <>
                  {canPass ? <button className="l-btn mc" onClick={() => decide(cur, true)}>通过</button> : null}
                  {canReject ? <button className="l-btn mc" onClick={() => decide(cur, false)}>驳回</button> : null}
                </>
              ) : cur ? (
                <span className={`bdg ${TICKET_ST[cur.st][1]}`}>{TICKET_ST[cur.st][0]}</span>
              ) : null}
            </div>
          </div>
          <div className="tk-split">
            <div>
              {(cur ? authoritativeK5Info(cur) : []).map((kv, index) => (
                <div className="kv2" key={`${kv[0]}-${index}`}><span className="k">{kv[0]}</span><span className="v">{kv[1]}</span></div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--ink)" }}>复审历史</div>
              {(cur?.hist ?? []).map((h, i) => (
                <div className="alert-row" key={`${h[0]}-${i}`}>
                  <span className="d3" style={{ background: h[2] === "bad" ? "var(--danger)" : h[2] === "warn" ? "var(--warning)" : "var(--ink-4)" }} />
                  <div className="tx">{displayK5History(h[1])}</div>
                  <span className="ts">{h[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">异常告警</span>
            <span className="sub">· 新复审命中 / SLA 超时 / 短时大额集中</span>
          </div>
          <div className="l-b">
            {canWrite && subscription ? <div style={{ display: "grid", gap: 10, padding: "0 0 14px", borderBottom: "1px solid var(--line)", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <b style={{ fontSize: 12 }}>告警类型</b>
                {ALERT_TYPES.map((type) => <label key={type} className="chip" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={draftAlertTypes.includes(type)} onChange={() => toggleSubscription(type, draftAlertTypes, setDraftAlertTypes)} /> {ALERT_TYPE_LABELS[type]}
                </label>)}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <b style={{ fontSize: 12 }}>接收渠道</b>
                {ALERT_CHANNELS.map((channel) => <label key={channel} className="chip" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={draftAlertChannels.includes(channel)} onChange={() => toggleSubscription(channel, draftAlertChannels, setDraftAlertChannels)} /> {ALERT_CHANNEL_LABELS[channel]}
                </label>)}
                <button className="l-btn sm" disabled={subscriptionSaving || !draftAlertTypes.length || !draftAlertChannels.length} onClick={() => saveAlertSubscription().catch(() => undefined)}>{subscriptionSaving ? "保存中…" : "保存订阅"}</button>
                <span className="note">当前账号配置 · v{subscription.version} · 保存后直接生效并留审计</span>
              </div>
            </div> : null}
            {alerts.map((a) => (
              <div className="alert-row" key={a.eventKey}>
                <span className="d3" style={{ background: a.tone === "bad" ? "var(--danger)" : "var(--warning)" }} />
                <div className="tx"><b>{a.title}</b> · {a.body}</div>
                <span className="ts">{a.timeText}</span>
              </div>
            ))}
            {!alerts.length ? <div style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>暂无异常告警 · 新命中、超时或短时大额集中后会显示在这里</div> : null}
          </div>
        </section>
      </div>

    </div>
  );
}
