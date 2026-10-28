"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH1Phases,
  updateH1MonthDial,
  updateH1RhythmParam,
  describeH1Schedule,
  type H1RhythmOverview,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
import { validateH1DialValue } from "@/lib/admin/h1-dial-validation";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { HCtx } from "./types";

type H1Model = {
  rhythm: H1RhythmOverview;
  monthlyDials: Array<{ month: number; phase: string; current?: boolean; dials: Record<string, unknown> }>;
  controls: Array<{ key: string; label: string; description?: string; value?: string }>;
  overrides: Array<{ id: string; cohort: string; description?: string; disabled?: boolean }>;
  attribution: Array<Record<string, unknown>>;
  coverage?: { coverageRatio?: number | string; redlinePct?: number | string };
  dialCount?: number;
};

const DIAL_COLUMNS = [
  ["newUserBonusMultiplier", "新用户加成", "x"],
  ["inviteRewardMultiplier", "邀请加成", "x"],
  ["reinvestMultiplier", "复投加成", "x"],
  // FEAT-WD01 改名:实际语义是「大额提现的到账等待天数」,不是「两笔提现的间隔」。字段键不动。
  ["withdrawCooldownDays", "提现审核期", "天"],
  // FEAT-WD02:「提现惩罚费率」旋钮已下线 —— 费用模型换为按网络固定确认费(D5 自有可写),
  // 逐月费率旋钮无对应语义;历史审计记录不删账。
  ["binaryDailyCap", "左右团队奖每日上限", "USD"],
  ["questBonusMultiplier", "任务加成", "x"],
  ["complianceHoldEnabled", "增强合规审查", ""],
] as const;

const RHYTHM_PHASE_NAME: Record<string, string> = {
  P1: "拉新",
  P2: "扩张",
  P3: "收紧",
  P4: "拐点",
  P5: "稳态",
  P6: "软退场",
};

const CONTROL_OPTIONS: Record<string, string[]> = {
  pin: ["未钉住", "P1", "P2", "P3", "P4", "P5", "P6"],
};

function text(value: unknown, fallback = "") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function phaseName(code?: string) {
  if (!code) return "—";
  return `${code} ${RHYTHM_PHASE_NAME[code] ?? ""}`.trim();
}

function rowValue(row: H1Model["monthlyDials"][number], key: string) {
  return text(row.dials?.[key], "-");
}

function dialAmplifies(key: string, before: string, after: string) {
  if (key === "complianceHoldEnabled") return before === "是" && after === "否";
  const current = Number(before.replace(/[^\d.-]/g, ""));
  const next = Number(after.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(current) || !Number.isFinite(next)) return true;
  if (key === "withdrawCooldownDays") return next < current;
  return next > current;
}

export default function H1Phase({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const canWrite = ctx.can("growth_h1_write");
  const canControlWrite = ctx.can("growth_h1_control_pin_write");
  const canOverrideRevoke = ctx.can("growth_h1_override_revoke");
  const propose = usePropose();
  const [model, setModel] = useState<H1Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<{ phase: string; dial: string } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const next = await fetchH1Phases();
      setModel(next as H1Model);
      setError(null);
    } catch (err) {
      setError(displayAdminError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPhase = params.get("phase")?.toUpperCase() ?? "";
    const requestedDial = params.get("dial") ?? "";
    if (params.get("from") === "B4" && (/^P[1-6]$/.test(requestedPhase) || requestedDial)) {
      setDeepLink({
        phase: /^P[1-6]$/.test(requestedPhase) ? requestedPhase : "",
        dial: requestedDial,
      });
    }
  }, []);

  const rhythm = model?.rhythm;
  const monthlyRows = model?.monthlyDials ?? [];
  const currentMonth = rhythm?.currentMonth ?? null;
  const currentPhase = rhythm?.currentPhase ?? "";
  const coverageRatio = text(model?.coverage?.coverageRatio, "-");
  const redlinePct = text(model?.coverage?.redlinePct, "-");
  const controlDescription = (control: H1Model["controls"][number]) =>
    control.key === "schedule" ? describeH1Schedule(rhythm?.schedule) : control.key === "override" ? "为指定用户批次单独设置运营阶段" : control.description;
  const controlValue = (control: H1Model["controls"][number]) => {
    if (control.key === "override") return "启用用户群单独设置";
    if (control.key !== "schedule") return control.key === "pin" && control.value === "未钉住" ? "自动切换阶段" : text(control.value, "未设置");
    const schedule = rhythm?.schedule;
    if (!schedule) return "自动切换状态未知";
    if (!schedule.configured) return "未设置";
    return schedule.automatic ? schedule.expression ?? "已配置" : "未开启自动切换";
  };

  const stats = useMemo(() => {
    const current = currentMonth == null ? undefined : monthlyRows.find((row) => row.month === currentMonth);
    return {
      invite: current ? rowValue(current, "inviteRewardMultiplier") : "-",
      quest: current ? rowValue(current, "questBonusMultiplier") : "-",
      // FEAT-WD02:惩罚费率旋钮下线,当月统计卡改展示到账审查窗口(仍是 H1 派发值)。
      cooldown: current ? rowValue(current, "withdrawCooldownDays") : "-",
    };
  }, [currentMonth, monthlyRows]);

  const applyPhaseResponse = (next: Record<string, unknown>) => {
    setModel(next as H1Model);
  };

  const openTotalMonths = () => {
    if (!rhythm) return;
    openActionConfirm({
      action: "调整运营总月数",
      detail: <>当前一共 <b>{rhythm.totalMonths} 个月</b>。修改后，下方每月参数表的行数会跟着变。</>,
      amplifies: false,
      edit: { kind: "select", current: String(rhythm.totalMonths), options: rhythm.options.map(String) },
      run: async (reason, value) => {
        if (!value) return;
        const next = await updateH1RhythmParam("totalMonths", value, reason, currentAdminOperator());
        const phases = await fetchH1Phases();
        setModel({ ...(phases as H1Model), rhythm: next });
        toast(`运营总月数已改为 ${next.totalMonths} 个月`);
      },
    });
  };

  const openCurrentPosition = () => {
    if (!rhythm) return;
    openActionConfirm({
      action: "调整当前进度",
      detail: <>现在是 <b>第 {rhythm.currentMonth}/{rhythm.totalMonths} 个月 · {phaseName(rhythm.currentPhase)}</b>，可以手动校准当前月份和阶段进度。</>,
      amplifies: false,
      businessForm: {
        kind: "multi-field",
        title: "当前进度",
        fields: [
          {
            key: "currentMonth",
            label: "当前第几个月",
            inputKind: "select",
            current: String(rhythm.currentMonth),
            options: Array.from({ length: rhythm.totalMonths }, (_, index) => String(index + 1)),
          },
          {
            key: "phaseProgressPct",
            label: "本阶段进度（%）",
            inputKind: "number",
            current: String(rhythm.phaseProgressPct),
            placeholder: "0-100",
          },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form) return;
        const currentMonthChanged = form.currentMonth !== "" && Number(form.currentMonth) !== rhythm.currentMonth;
        const progressChanged = form.phaseProgressPct !== "" && Number(form.phaseProgressPct) !== rhythm.phaseProgressPct;
        if (!currentMonthChanged && !progressChanged) {
          throw new Error("进度没有变化，本次没有提交");
        }
        let overview = rhythm;
        if (currentMonthChanged) {
          overview = await updateH1RhythmParam("currentMonth", form.currentMonth, reason, currentAdminOperator());
        }
        if (progressChanged) {
          overview = await updateH1RhythmParam("phaseProgressPct", form.phaseProgressPct, reason, currentAdminOperator());
        }
        const phases = await fetchH1Phases();
        setModel({ ...(phases as H1Model), rhythm: overview });
        toast("当前进度已更新");
      },
    });
  };

  const openDial = (row: H1Model["monthlyDials"][number], key: string, label: string) => {
    const current = rowValue(row, key);
    const isComplianceToggle = key === "complianceHoldEnabled";
    const amplifiesWhen: "decrease" | "increase" = key === "withdrawCooldownDays"
      ? "decrease"
      : "increase";
    openActionConfirm({
      action: `调整第 ${row.month} 个月 · ${label}`,
      detail: <>当前值 <b>{current}</b>。保存后马上生效。</>,
      amplifies: isComplianceToggle && current === "是",
      edit: isComplianceToggle
        ? { kind: "select", current, options: ["否", "是"] }
        : { kind: "text", current, amplifiesWhen },
      run: async (reason, value) => {
        if (!value) return;
        validateH1DialValue(key, value);
        if (dialAmplifies(key, current, value)) {
          const def = findHighOp("h1_phase_dial")!;
          void propose(ctx.toast, {
            action: `调整第 ${row.month} 个月 · ${label}`,
            obj: `${row.month}:${key}`,
            before: current,
            after: value,
            type: "param",
            amplifies: true,
            gate: { roles: ["superadmin"] },
            gateLabel: def.gateLabel,
            reason,
            sourceDomain: "H1",
            command: def.buildCommand({ month: row.month, dialKey: key, value }),
            target: def.buildTarget({ month: row.month, dialKey: key }),
          });
          return;
        }
        applyPhaseResponse(await updateH1MonthDial(row.month, key, value, reason));
        toast(`第 ${row.month} 个月 · ${label} 已更新`);
      },
    });
  };

  const openControl = (control: H1Model["controls"][number]) => {
    const current = text(control.value, control.key === "pin" ? "未钉住" : "");
    openActionConfirm({
      action: `阶段切换设置 · ${control.label}`,
      detail: <>{controlDescription(control) || "修改会记入操作记录。"} 当前值 <b>{control.key === "pin" && current === "未钉住" ? "自动切换阶段" : current || "未设置"}</b>。</>,
      amplifies: false,
      edit: CONTROL_OPTIONS[control.key]
        ? { kind: "select", current, options: CONTROL_OPTIONS[control.key], optionLabels: { "未钉住": "自动切换阶段" } }
        : { kind: "text", current },
      run: (reason, value) => {
        if (value == null) return;
        const def = findHighOp("h1_phase_control")!;
        void propose(ctx.toast, {
          action: `阶段切换设置 · ${control.label}`,
          obj: control.key,
          before: current || "未设置",
          after: String(value),
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H1",
          command: def.buildCommand({ controlKey: control.key, value }),
          target: def.buildTarget({ controlKey: control.key }),
        });
      },
    });
  };

  const openOverrideRemove = (override: H1Model["overrides"][number]) => {
    openActionConfirm({
      action: `撤销该批用户的单独设置 · ${override.cohort}`,
      detail: <>{override.description || "撤销后，这批用户会重新按全局运营阶段安排处理。"} 撤销会记入操作记录。</>,
      amplifies: false,
      run: (reason) => {
        const def = findHighOp("h1_phase_override")!;
        void propose(ctx.toast, {
          action: `撤销该批用户的单独设置 · ${override.cohort}`,
          obj: override.id,
          before: "生效中",
          after: "已撤销",
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H1",
          command: def.buildCommand({ overrideId: override.id, disabled: true }),
          target: def.buildTarget({ overrideId: override.id }),
        });
      },
    });
  };

  const refreshPreview = () => {
    openConfirm({
      action: "刷新数据",
      detail: <>重新加载本页数据，不会改任何设置。</>,
      chips: [["只读", "ready"]],
      okLabel: "刷新",
      run: async () => {
        await reload();
        toast("已刷新");
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">运营阶段数据加载中…</div></section>;
  }

  if (error || !model || !rhythm) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">运营阶段数据加载失败</span></div>
        <div className="l-b">
          {error ?? "没有收到数据，请重试；一直失败请联系值班同事。"}
          <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void reload()}>重试</button>
        </div>
      </section>
    );
  }

  return (
    <>
      {deepLink && (
        <section className="l-card" role="status" style={{ marginBottom: 16, borderColor: "var(--cyan)" }}>
          <div className="l-b">
            <b>从「运营阶段状态」跳转而来</b>
            <span style={{ marginLeft: 8, color: "var(--ink-3)" }}>
              {deepLink.phase ? `${phaseName(deepLink.phase)} · ` : ""}
              {deepLink.dial === "phaseAttribution" ? "运营阶段效果分析" : deepLink.dial || "运营阶段详情"}
            </span>
          </div>
        </section>
      )}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">当前月份 / 阶段</div>
          <div className="v">第 {currentMonth ?? "—"} 个月 · {currentPhase || "—"}</div>
          <div className="sub">共 {rhythm.totalMonths} 个月 · 本阶段进度 {rhythm.phaseProgressPct}%</div>
        </div>
        <div className="f-stat ok">
          <div className="k">兑付覆盖率</div>
          <div className="v">{coverageRatio}%</div>
          <div className="sub">红线 {redlinePct}% · 低于红线时，会多付钱的修改无法保存</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">当月邀请 / 任务加成</div>
          <div className="v">{stats.invite}x / {stats.quest}x</div>
          <div className="sub">本月设置</div>
        </div>
        <div className="f-stat warn">
          <div className="k">本月提现审核期</div>
          <div className="v">{stats.cooldown}{stats.cooldown === "-" || String(stats.cooldown).includes("天") ? "" : " 天"}</div>
          <div className="sub">本月设置</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="f-cta" onClick={refreshPreview}>刷新数据</button>
      </div>

      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h">
          <span className="ttl">总体安排</span>
          <span className="sub">· 一共几个月、现在走到哪</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>运营总月数</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>决定下方参数表有几行、各阶段占几个月</span>
            </span>
            <span className="bdg">{rhythm.totalMonths} 个月</span>
            <button className="l-btn sm mc" onClick={openTotalMonths} disabled={!canWrite}>修改</button>
          </div>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>当前进度</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>通常自动推进，必要时可手动校准</span>
            </span>
            <span className="bdg">第 {rhythm.currentMonth}/{rhythm.totalMonths} 月 · {phaseName(rhythm.currentPhase)} · {rhythm.phaseProgressPct}%</span>
            <button className="l-btn sm mc" onClick={openCurrentPosition} disabled={!canWrite}>校准</button>
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">每月参数表（{monthlyRows.length} 个月 × {model.dialCount ?? DIAL_COLUMNS.length} 项）</span>
          <span className="sub">· 点格子修改</span>
          <div className="r"><span className="bdg ok">修改后马上生效</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dial-tbl" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th>月份</th>
                {DIAL_COLUMNS.map(([key, label, unit]) => (
                  <th key={key}>{label}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>{unit}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((row, index) => (
                <tr key={row.month} className={row.month === currentMonth ? "cur" : undefined}>
                  <td>
                    第 {row.month} 个月{row.month === currentMonth ? " · 当前" : ""}{" "}
                    <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>{row.phase}</span>
                  </td>
                  {DIAL_COLUMNS.map(([key, label]) => {
                    const current = rowValue(row, key);
                    const previous = index > 0 ? rowValue(monthlyRows[index - 1], key) : current;
                    return (
                      <td
                        key={key}
                        className={String(current) !== String(previous) ? "chg" : undefined}
                        aria-label={canWrite
                          ? `第 ${row.month} 个月 ${label}，当前 ${current}，点击修改`
                          : `第 ${row.month} 个月 ${label}，当前 ${current}（只读）`}
                        onClick={canWrite ? () => openDial(row, key, label) : undefined}
                        title={canWrite ? "点击改值" : "只读"}
                      >
                        {current}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">阶段切换设置</span>
            <span className="sub">· 修改会记入操作记录</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {model.controls.map((control) => (
              <div className="p-row" key={control.key}>
                <span style={{ flex: 1 }}>
                  <b>{control.key === "override" ? "用户群单独设置" : control.label}</b>
                  <br />
                  <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{controlDescription(control)}</span>
                </span>
                <span className="bdg">{controlValue(control)}</span>
                <button className="l-btn sm mc" aria-label={`调整${control.label}`} onClick={() => openControl(control)} disabled={!canControlWrite}>调整</button>
              </div>
            ))}

            <div style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 6px" }}>正在生效的单独设置</div>
            {model.overrides.map((override) => (
              <div className="p-row" key={override.id}>
                <span className="mono" style={{ fontSize: 12 }}>{override.cohort}</span>
                <span style={{ flex: 1, fontSize: 12, color: "var(--ink-3)" }}>
                  {override.description}
                  {override.disabled && <span className="bdg dim" style={{ marginLeft: 8 }}>已撤销</span>}
                </span>
                <button className="l-btn sm mc" aria-label={`撤销单独设置 ${override.cohort}`} disabled={!!override.disabled || !canOverrideRevoke} onClick={() => openOverrideRemove(override)}>
                  {override.disabled ? "已撤销" : "撤销"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">运营阶段效果分析</span>
            <span className="sub">· 各阶段的主要驱动和参数</span>
            <div className="r">
              <Link href="/overview/rhythm" className="l-btn">去运营阶段状态 →</Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>阶段</th>
                  <th>阶段名称</th>
                  <th>主要驱动</th>
                  <th>阶段参数</th>
                  <th className="num">当前值</th>
                  <th>负责模块</th>
                </tr>
              </thead>
              <tbody>
                {model.attribution.map((row) => {
                  const phase = text(row.phase);
                  const deepLinked = !!deepLink?.phase && phase === deepLink.phase;
                  return (
                    <tr
                      key={phase}
                      id={`h1-attribution-${phase}`}
                      style={deepLinked
                        ? { background: "rgba(0,191,255,.14)", outline: "1px solid var(--cyan)" }
                        : currentPhase && phase === currentPhase
                          ? { background: "rgba(255,107,53,.08)" }
                          : undefined}
                    >
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>
                        {phase}{currentPhase && phase === currentPhase ? " · 当前" : ""}{deepLinked ? " · 跳转定位" : ""}
                      </td>
                      <td>{text(row.name, "—")}</td>
                      <td>{text(row.driver, "暂无说明")}</td>
                      <td className="mono">{DIAL_COLUMNS.find(([key]) => key === row.paramKey)?.[1] ?? "其他阶段参数"}</td>
                      <td className="num mono">{text(row.value, "—")}</td>
                      <td>{text(row.owner, "—")}</td>
                    </tr>
                  );
                })}
                {model.attribution.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>暂无阶段效果数据，有业务数据后会显示。可先看上方的每月参数表。</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <PaginationExemptionList
        items={[
          {
            label: `每月参数表（${monthlyRows.length} 个月 × ${model.dialCount ?? DIAL_COLUMNS.length} 项）`,
            kind: "fixed-matrix",
            maxRows: monthlyRows.length,
            reason: "需要一屏对比当前月和前后几个月",
          },
          {
            label: "运营阶段效果分析",
            maxRows: model.attribution.length,
            reason: "这里只显示摘要；详细数据见「运营阶段状态」和「设备/任务/网络报表」",
          },
        ]}
      />
    </>
  );
}
