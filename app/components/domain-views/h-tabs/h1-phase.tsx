"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import {
  fetchH1Phases,
  updateH1Control,
  updateH1MonthDial,
  updateH1Override,
  updateH1RhythmParam,
  type H1RhythmOverview,
} from "@/lib/admin/h-client";
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
  ["inviteRewardMultiplier", "邀请加成", "x"],
  ["questRewardMultiplier", "任务加成", "x"],
  ["trialOffsetCapUsdt", "试用抵扣上限", "USDT"],
  ["deviceReleasePacingPct", "设备放量", "%"],
  ["commissionTighteningPct", "佣金收紧", "%"],
  ["campaignRewardNex", "活动奖励", "NEX"],
  ["withdrawNexMinBalance", "提现 NEX 门槛", "NEX"],
  ["withdrawNexHoldDays", "提现持有天数", "天"],
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

export default function H1Phase({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [model, setModel] = useState<H1Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const next = await fetchH1Phases();
      setModel(next as H1Model);
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
      quest: current ? rowValue(current, "questRewardMultiplier") : "-",
      withdraw: current ? rowValue(current, "withdrawNexMinBalance") : "-",
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
        let overview = rhythm;
        if (form.currentMonth) {
          overview = await updateH1RhythmParam("currentMonth", form.currentMonth, reason, currentAdminOperator());
        }
        if (form.phaseProgressPct) {
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
    openActionConfirm({
      action: `改旋钮 · 月 ${row.month} · ${label}`,
      detail: <>当前值 <b>{current}</b>。提交后写入后端配置并重新查询 H1 矩阵。</>,
      amplifies: ["trialOffsetCapUsdt", "campaignRewardNex", "withdrawNexMinBalance"].includes(key),
      edit: { kind: "text", current },
      run: async (reason, value) => {
        if (!value) return;
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
      run: async (reason, value) => {
        if (value == null) return;
        applyPhaseResponse(await updateH1Control(control.key, value, reason));
        toast(`H1 ${control.label} 已更新`);
      },
    });
  };

  const openOverrideRemove = (override: H1Model["overrides"][number]) => {
    openActionConfirm({
      action: `撤销 override · ${override.cohort}`,
      detail: <>{override.description || "撤销后该批次回归全局阶段时间表。"} 后端会写入 disabled 标记。</>,
      amplifies: false,
      run: async (reason) => {
        applyPhaseResponse(await updateH1Override(override.id, true, reason));
        toast(`${override.cohort} override 已撤销`);
      },
    });
  };

  const openSandbox = () => {
    openConfirm({
      action: "沙盒预览(只读)",
      detail: <>沙盒预览会重新读取后端 H1 读模型,不写配置。</>,
      chips: [["只读", "ready"], ["后端读取", "done"]],
      okLabel: "运行预览",
      run: async () => {
        await reload();
        toast("H1 沙盒预览已按后端数据刷新");
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
        <div className="l-b">{error ?? "UNKNOWN_ERROR"}</div>
      </section>
    );
  }

  return (
    <>
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
          <div className="k">当月提现 NEX 门槛</div>
          <div className="v">{stats.withdraw}</div>
          <div className="sub">同步 D5 提现参数镜像</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="f-cta" onClick={openSandbox}>沙盒预览(只读)</button>
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
            <button className="l-btn sm mc" onClick={openTotalMonths}>改总时长</button>
          </div>
          <div className="p-row">
            <span style={{ flex: 1 }}>
              <b>当前节奏位置</b>
              <br />
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>月度位置和阶段进度由后端裁决</span>
            </span>
            <span className="bdg">第 {rhythm.currentMonth}/{rhythm.totalMonths} 月 · {phaseName(rhythm.currentPhase)} · {rhythm.phaseProgressPct}%</span>
            <button className="l-btn sm mc" onClick={openCurrentPosition}>设定位置</button>
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
                        onClick={() => openDial(row, key, label)}
                        title="点击改值"
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
                <button className="l-btn sm mc" onClick={() => openControl(control)}>调整</button>
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
                <button className="l-btn sm mc" disabled={!!override.disabled} onClick={() => openOverrideRemove(override)}>
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
              <Link href="/risk/health-monitor" className="l-btn">去 B4 节奏看板 →</Link>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>阶段</th>
                  <th className="num">首购转化</th>
                  <th className="num">复投率</th>
                  <th className="num">周提现</th>
                  <th className="num">Day7 留存</th>
                </tr>
              </thead>
              <tbody>
                {model.attribution.map((row) => {
                  const phase = text(row.phase);
                  return (
                    <tr key={phase} style={currentPhase && phase.includes(currentPhase) ? { background: "rgba(255,107,53,.08)" } : undefined}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{phase}{currentPhase && phase.includes(currentPhase) ? " · 当前" : ""}</td>
                      <td className="num mono">{text(row.first)}</td>
                      <td className="num mono">{text(row.reinvest)}</td>
                      <td className="num mono">{text(row.weekly)}</td>
                      <td className="num mono">{text(row.d7)}</td>
                    </tr>
                  );
                })}
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
