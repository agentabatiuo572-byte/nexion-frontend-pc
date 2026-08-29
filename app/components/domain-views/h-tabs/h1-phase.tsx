"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH1Phases,
  updateH1MonthDial,
  updateH1RhythmParam,
  type H1RhythmOverview,
} from "@/lib/admin/h-client";
import { usePropose } from "@/lib/admin/use-propose";
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
  ["withdrawCooldownDays", "到账审查窗口", "天"],
  // FEAT-WD02:「提现惩罚费率」旋钮已下线 —— 费用模型换为按网络固定确认费(D5 自有可写),
  // 逐月费率旋钮无对应语义;历史审计记录不删账。
  ["binaryDailyCap", "双轨日封顶", "USD"],
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
      action: "节奏总时长",
      detail: <>当前总时长 <b>{rhythm.totalMonths} 个月</b>,调整后后端会按配置返回新的月度矩阵。</>,
      amplifies: false,
      edit: { kind: "select", current: String(rhythm.totalMonths), options: rhythm.options.map(String) },
      run: async (reason, value) => {
        if (!value) return;
        const next = await updateH1RhythmParam("totalMonths", value, reason, currentAdminOperator());
        const phases = await fetchH1Phases();
        setModel({ ...(phases as H1Model), rhythm: next });
        toast(`H1 节奏总时长已更新为 ${next.totalMonths} 个月`);
      },
    });
  };

  const openCurrentPosition = () => {
    if (!rhythm) return;
    openActionConfirm({
      action: "当前节奏位置",
      detail: <>当前 <b>第 {rhythm.currentMonth}/{rhythm.totalMonths} 月 · {phaseName(rhythm.currentPhase)}</b>,可校准当前月和阶段进度。</>,
      amplifies: false,
      businessForm: {
        kind: "multi-field",
        title: "当前节奏位置",
        fields: [
          {
            key: "currentMonth",
            label: "当前运营月",
            inputKind: "select",
            current: String(rhythm.currentMonth),
            options: Array.from({ length: rhythm.totalMonths }, (_, index) => String(index + 1)),
          },
          {
            key: "phaseProgressPct",
            label: "本阶段进度(%)",
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
          throw new Error("当前节奏位置未变化，本次未提交");
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
        toast("H1 当前节奏位置已更新");
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
      action: `改旋钮 · 月 ${row.month} · ${label}`,
      detail: <>当前值 <b>{current}</b>。提交后写入后端配置并重新查询 H1 矩阵。</>,
      amplifies: isComplianceToggle && current === "是",
      edit: isComplianceToggle
        ? { kind: "select", current, options: ["否", "是"] }
        : { kind: "text", current, amplifiesWhen },
      run: async (reason, value) => {
        if (!value) return;
        if (dialAmplifies(key, current, value)) {
          const def = findHighOp("h1_phase_dial")!;
          void propose(ctx.toast, {
            action: `改旋钮 · 月 ${row.month} · ${label}`,
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
        toast(`H1 月 ${row.month} · ${label} 已更新`);
      },
    });
  };

  const openControl = (control: H1Model["controls"][number]) => {
    const current = text(control.value, control.key === "pin" ? "未钉住" : "");
    openActionConfirm({
      action: `Phase 切换控制 · ${control.label}`,
      detail: <>{control.description || "控制项变更会写入后端配置并留痕。"} 当前值 <b>{current || "未设置"}</b>。</>,
      amplifies: false,
      edit: CONTROL_OPTIONS[control.key]
        ? { kind: "select", current, options: CONTROL_OPTIONS[control.key] }
        : { kind: "text", current },
      run: (reason, value) => {
        if (value == null) return;
        const def = findHighOp("h1_phase_control")!;
        void propose(ctx.toast, {
          action: `Phase 切换控制 · ${control.label}`,
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
      action: `撤销 override · ${override.cohort}`,
      detail: <>{override.description || "撤销后该批次回归全局阶段时间表。"} 后端会写入 disabled 标记。</>,
      amplifies: false,
      run: (reason) => {
        const def = findHighOp("h1_phase_override")!;
        void propose(ctx.toast, {
          action: `撤销 override · ${override.cohort}`,
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
      action: "刷新预览(只读)",
      detail: <>刷新预览会重新读取开发环境 H1 读模型,不写配置。</>,
      chips: [["只读", "ready"], ["后端读取", "done"]],
      okLabel: "运行预览",
      run: async () => {
        await reload();
        toast("H1 预览已按开发环境后端数据刷新");
      },
    });
  };

  if (loading) {
    return <section className="l-card"><div className="l-b">H1 数据加载中...</div></section>;
  }

  if (error || !model || !rhythm) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">H1 数据加载失败</span></div>
        <div className="l-b">
          {error ?? "未收到本页数据，请重试；持续失败时请联系值班人员。"}
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
            <b>已从 B4 节奏看板定位</b>
            <span style={{ marginLeft: 8, color: "var(--ink-3)" }}>
              {deepLink.phase ? `${phaseName(deepLink.phase)} · ` : ""}
              {deepLink.dial === "phaseAttribution" ? "Phase 效果归因" : deepLink.dial || "H1 节奏详情"}
            </span>
          </div>
        </section>
      )}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">当前运营月 / 阶段</div>
          <div className="v">月 {currentMonth ?? "—"} · {currentPhase || "—"}</div>
          <div className="sub">{rhythm.totalMonths} 月节奏 · 阶段进度 {rhythm.phaseProgressPct}%</div>
        </div>
        <div className="f-stat ok">
          <div className="k">备付金红线核验</div>
          <div className="v">{coverageRatio}%</div>
          <div className="sub">红线 {redlinePct}% · 放大流出会由后端拒绝</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">当月邀请 / 任务加成</div>
          <div className="v">{stats.invite}x / {stats.quest}x</div>
          <div className="sub">来源: 服务端阶段节奏数据</div>
        </div>
        <div className="f-stat warn">
          <div className="k">当月到账审查窗口</div>
          <div className="v">{stats.cooldown}{stats.cooldown === "-" || String(stats.cooldown).includes("天") ? "" : " 天"}</div>
          <div className="sub">来源: 服务端当月阶段派发值</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="f-cta" onClick={refreshPreview}>刷新预览(只读)</button>
      </div>

      <section className="l-card" style={{ marginBottom: 16 }}>
        <div className="l-h">
          <span className="ttl">节奏骨架</span>
          <span className="sub">· 后端配置单源 · 自动插入默认配置后查询</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>节奏总时长</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>决定矩阵行数和阶段分布</span>
            </span>
            <span className="bdg">{rhythm.totalMonths} 个月</span>
            <button className="l-btn sm mc" onClick={openTotalMonths} disabled={!canWrite}>改总时长</button>
          </div>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>当前节奏位置</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>月度位置和阶段进度由后端裁决</span>
            </span>
            <span className="bdg">第 {rhythm.currentMonth}/{rhythm.totalMonths} 月 · {phaseName(rhythm.currentPhase)} · {rhythm.phaseProgressPct}%</span>
            <button className="l-btn sm mc" onClick={openCurrentPosition} disabled={!canWrite}>设定位置</button>
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">逐月旋钮矩阵({monthlyRows.length} 月 x {model.dialCount ?? DIAL_COLUMNS.length} 项)</span>
          <span className="sub">· 点击任意单元格调参 · 提交后从后端重新查询</span>
          <div className="r"><span className="bdg ok">后端配置生效</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dial-tbl" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th>运营月</th>
                {DIAL_COLUMNS.map(([key, label, unit]) => (
                  <th key={key}>{label}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>{unit}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((row, index) => (
                <tr key={row.month} className={row.month === currentMonth ? "cur" : undefined}>
                  <td>
                    月 {row.month}{row.month === currentMonth ? " · 当前" : ""}{" "}
                    <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>{row.phase}</span>
                  </td>
                  {DIAL_COLUMNS.map(([key, label]) => {
                    const current = rowValue(row, key);
                    const previous = index > 0 ? rowValue(monthlyRows[index - 1], key) : current;
                    return (
                      <td
                        key={key}
                        className={String(current) !== String(previous) ? "chg" : undefined}
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
            <span className="ttl">Phase 切换控制</span>
            <span className="sub">· 后端配置 + 审计</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {model.controls.map((control) => (
              <div className="p-row" key={control.key}>
                <span style={{ flex: 1 }}>
                  <b>{control.label}</b>
                  <br />
                  <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{control.description}</span>
                </span>
                <span className="bdg">{text(control.value, "未设置")}</span>
                <button className="l-btn sm mc" onClick={() => openControl(control)} disabled={!canControlWrite}>调整</button>
              </div>
            ))}

            <div style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 6px" }}>生效中的覆盖台账</div>
            {model.overrides.map((override) => (
              <div className="p-row" key={override.id}>
                <span className="mono" style={{ fontSize: 12 }}>{override.cohort}</span>
                <span style={{ flex: 1, fontSize: 12, color: "var(--ink-3)" }}>
                  {override.description}
                  {override.disabled && <span className="bdg dim" style={{ marginLeft: 8 }}>已撤销</span>}
                </span>
                <button className="l-btn sm mc" disabled={!!override.disabled || !canOverrideRevoke} onClick={() => openOverrideRemove(override)}>
                  {override.disabled ? "已撤销" : "撤销"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">Phase 效果归因</span>
            <span className="sub">· 从后端 H1 读模型返回</span>
            <div className="r">
              <Link href="/overview/rhythm" className="l-btn">去 B4 节奏看板 →</Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>阶段</th>
                  <th>阶段名称</th>
                  <th>主要驱动</th>
                  <th>权威旋钮</th>
                  <th className="num">当前值</th>
                  <th>责任域</th>
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
                        {phase}{currentPhase && phase === currentPhase ? " · 当前" : ""}{deepLinked ? " · B4 定位" : ""}
                      </td>
                      <td>{text(row.name, "—")}</td>
                      <td>{text(row.driver, "暂无归因说明")}</td>
                      <td className="mono">{text(row.paramKey, "—")}</td>
                      <td className="num mono">{text(row.value, "—")}</td>
                      <td>{text(row.owner, "—")}</td>
                    </tr>
                  );
                })}
                {model.attribution.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>暂无阶段归因数据；可先查看当前旋钮矩阵，归因指标将在产生业务样本后展示</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <PaginationExemptionList
        items={[
          {
            label: `逐月旋钮矩阵(${monthlyRows.length} 月 x ${model.dialCount ?? DIAL_COLUMNS.length} 项)`,
            kind: "fixed-matrix",
            maxRows: monthlyRows.length,
            reason: "节奏矩阵必须同屏对比当前月和前后月",
          },
          {
            label: "Phase 效果归因",
            maxRows: model.attribution.length,
            reason: "阶段归因只读摘要,明细下钻到 B4/L4 报表",
          },
        ]}
      />
    </>
  );
}
