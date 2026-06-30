"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchH1Rhythm, type H1RhythmOverview } from "@/lib/admin/h1-client";
import { fetchD5WithdrawalParams, updateD5WithdrawalParam, type D5Params as D5ParamData } from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;

function pct(value: number) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function d5ErrorText(err: unknown) {
  const message = err instanceof Error ? err.message : "D5 参数保存失败";
  if (message === "COVERAGE_BELOW_REDLINE") {
    return "当前覆盖率低于红线，不能上调日限/上限或下调费率";
  }
  return message;
}

export function D5Params({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm } = ctx;
  const [params, setParams] = useState<D5ParamData | null>(null);
  const [rhythm, setRhythm] = useState<H1RhythmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextParams, nextRhythm] = await Promise.all([
        fetchD5WithdrawalParams(),
        fetchH1Rhythm().catch(() => null),
      ]);
      setParams(nextParams);
      setRhythm(nextRhythm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "D5 数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateParam = (
    key: "dailyLimitCount" | "balanceMaxRatio" | "networkFee",
    label: string,
    current: string,
    unit: string,
    amplifies: boolean,
  ) => {
    openActionConfirm({
      action: `提现参数调整 · ${label}`,
      detail: "保存后立即影响提现审核；放松资金流出限制时会先做覆盖率红线校验。",
      amplifies,
      coverage: params ? { coverageRatio: params.coverageRatio, redlinePct: params.redlinePct } : undefined,
      edit: { kind: "number", current, unit },
      run: (reason, value) => {
        if (!value?.trim()) {
          toast("请输入目标值");
          return;
        }
        void updateD5WithdrawalParam(key, value.trim(), reason, OPERATOR())
          .then((next) => {
            setParams(next);
            setError("");
            toast(`${label} 已更新`);
          })
          .catch((err) => {
            const message = d5ErrorText(err);
            setError(message);
            toast(message);
          });
      },
    });
  };

  if (loading && !params) {
    return <section className="l-card"><div className="l-b">D5 数据加载中...</div></section>;
  }

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D5 数据加载失败 · {error}</div>}

      <div className="f-stats">
        <div className="f-stat"><div className="k">每日提现次数</div><div className="v">{params?.dailyLimitCount ?? 0}</div><div className="sub">D2 放行实时使用</div></div>
        <div className="f-stat cyan"><div className="k">余额可提上限</div><div className="v">{pct(params?.maxBalancePct ?? 0)}</div><div className="sub">放行前校验上限</div></div>
        <div className="f-stat warn"><div className="k">提现费率</div><div className="v">{pct(params?.feeRatePct ?? 0)}</div><div className="sub">计费参数</div></div>
        <div className={`f-stat ${(params?.coverageRatio ?? 0) < (params?.redlinePct ?? 0) ? "danger" : "ok"}`}><div className="k">覆盖率红线</div><div className="v">{pct(params?.coverageRatio ?? 0)}</div><div className="sub">红线 {pct(params?.redlinePct ?? 0)}</div></div>
      </div>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">本页可调参数</span>
            <span className="sub">· 保存后实时生效</span>
            <div className="r"><button className="l-btn sm" onClick={() => void load()}>刷新</button></div>
          </div>
          <div className="l-b">
            <div className="p-row">
              <div className="txt"><div className="k">每日提现次数</div><div className="s">1-10 次；上调属于放松方向</div></div>
              <span className="v">{params?.dailyLimitCount ?? 0} 次</span>
              <button className="l-btn sm mc" onClick={() => updateParam("dailyLimitCount", "每日提现次数", String(params?.dailyLimitCount ?? 1), "次", true)}>调整</button>
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">余额可提上限</div><div className="s">50%-100%；上调属于放松方向</div></div>
              <span className="v">{pct(params?.maxBalancePct ?? 0)}</span>
              <button className="l-btn sm mc" onClick={() => updateParam("balanceMaxRatio", "余额可提上限", String(params?.maxBalancePct ?? 80), "%", true)}>调整</button>
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">提现费率</div><div className="s">0%-5%；下调属于放松方向</div></div>
              <span className="v">{pct(params?.feeRatePct ?? 0)}</span>
              <button className="l-btn sm mc" onClick={() => updateParam("networkFee", "提现费率", String(params?.feeRatePct ?? 2), "%", true)}>调整</button>
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">链路开关</div><div className="s">TRC20 / ERC20 当前从后端配置读取</div></div>
              <span className={`bdg ${params?.trc20Enabled ? "ok" : "bad"}`}>TRC20 {params?.trc20Enabled ? "开" : "关"}</span>
              <span className={`bdg ${params?.erc20Enabled ? "ok" : "bad"}`}>ERC20 {params?.erc20Enabled ? "开" : "关"}</span>
            </div>
            <div className="dtint" style={{ marginTop: 12 }}>最低提现额 {money(params?.minUsdt ?? 0)}。链路开关和最低额当前为只读展示。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">H1 节奏只读</span>
            <span className="sub">· 节奏配置不在 D5 调整</span>
            <div className="r"><Link href="/growth/phase" className="l-btn">去 H1 调整 →</Link></div>
          </div>
          <div className="l-b">
            <div className="p-row">
              <div className="txt"><div className="k">当前阶段</div><div className="s">H1 当前节奏</div></div>
              <span className="v">{rhythm?.currentPhase ?? "—"}</span>
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">当前月份</div><div className="s">总时长 {rhythm?.totalMonths ?? "—"} 月</div></div>
              <span className="v">{rhythm ? `${rhythm.currentMonth}/${rhythm.totalMonths}` : "—"}</span>
            </div>
            <div className="p-row">
              <div className="txt"><div className="k">阶段进度</div><div className="s">按当前节奏计算</div></div>
              <span className="v">{rhythm ? `${rhythm.phaseProgressPct}%` : "—"}</span>
            </div>
            <div className="dtint" style={{ marginTop: 12 }}>D5 只展示 H1 节奏；节奏配置请到 H1 调整。</div>
          </div>
        </section>
      </div>

      <p className="f-foot">D5 参数保存后会同步影响提现审核队列。</p>
    </>
  );
}
