"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "../design-kit";
import type { F5CommissionEvent, F5CommissionQuery } from "@/lib/admin/f1-client";
import type { FViewCtx } from "./types";

const KINDS = ["network", "binary", "peer", "cultivation", "leadership", "genesis"];
const KIND_LABELS: Record<string, string> = {
  network: "网络版税",
  binary: "双轨匹配",
  peer: "平级奖",
  cultivation: "培育奖",
  leadership: "领导奖池",
  genesis: "创世排放",
};
const LINK_STYLE = {
  color: "var(--ink-4)",
  textDecoration: "none",
  fontSize: 11,
  marginRight: 8,
} as const;

function badge(status: string): { label: string; tone: "ok" | "warn" | "err" | "neutral" } {
  if (status === "unlocked") return { label: "已解锁可提", tone: "ok" };
  if (status === "withdrawn") return { label: "已提现", tone: "neutral" };
  if (status === "reversed") return { label: "已撤销", tone: "err" };
  if (status === "frozen") return { label: "已冻结", tone: "warn" };
  return { label: "冷却计提中", tone: "warn" };
}

export function F5Audit({ ctx }: { ctx: FViewCtx }) {
  const canWrite = ctx.can("network_f5_write");
  const canDispose = ctx.can("network_f5_commission_dispose");
  const canReject = ctx.can("network_f5_commission_reject");
  const [kind, setKind] = useState("");
  const [currency, setCurrency] = useState("");
  const [userId, setUserId] = useState("");
  const [cohort, setCohort] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const data = ctx.f5Overview;
  const events = data?.commissionEvents ?? [];
  const selectedRows = useMemo(
    () => events.filter((row) => selected.includes(row.id)),
    [events, selected],
  );

  const query = (): F5CommissionQuery => ({
    kind: kind || undefined,
    currency: currency || undefined,
    userId: userId.trim() || undefined,
    cohort: cohort.trim() || undefined,
    status: status || undefined,
    limit: "20",
  });

  // 单笔冻结/提前解锁/解冻(合并底账 §二#4 恢复):可逆的「先按住观察」,与不可逆冲正分层。
  // 走既有 dispose 管线:openActionConfirm(op:"dispose") → shell updateF5Config → proposeFConfig
  // → f_commission_status A2 票(幂等 + 服务端 CAS + 审计),paramKey 用行上现成的 auditKey。
  const dispose = (kind: "freeze" | "unlock" | "unfreeze", row: F5CommissionEvent) => {
    const amount = `${row.amt.toLocaleString("en-US")} ${row.cur}`;
    const map = {
      freeze: { name: `冻结佣金 ${row.id}`, amplify: false, fixedVal: "frozen", detail: `冻结 ${row.id} · ${amount} · 先按住观察:暂停该笔的解锁与提现,可随时解冻,与不可逆冲正分层。确认后进入 A2 执行链,服务端按状态 CAS 变更并落审计。` },
      unlock: { name: `佣金提前解锁 ${row.id}`, amplify: true, fixedVal: "unlocked", detail: `提前解锁 ${row.id} · ${amount} · 跳过剩余冷却直接进入可提余额,放大资金流出。确认后进入 A2 执行链,服务端按状态 CAS 变更并联动 D4 / B1 护栏。` },
      unfreeze: { name: `解冻佣金 ${row.id}`, amplify: true, fixedVal: "unlocked", detail: `解冻 ${row.id} · ${amount} · 恢复该笔的可提链路(等效提前解锁,放大资金流出)。确认后进入 A2 执行链,服务端按状态 CAS 变更并落审计。` },
    }[kind];
    ctx.openActionConfirm({ name: map.name, amplify: map.amplify, op: "dispose", paramKey: row.auditKey, fixedVal: map.fixedVal, detail: map.detail });
  };

  const reverse = (row: F5CommissionEvent) => {
    ctx.openActionConfirm({
      name: `冲正佣金 ${row.id}`,
      detail: `冲正 ${row.id} · ${row.amt} ${row.cur}。服务端校验退款单、V-Rank 派发单或工单证据，使用状态 CAS，并联动 D4、A2、A4。`,
      businessForm: {
        kind: "multi-field",
        title: "冲正证据",
        hint: "证据编号必须已存在且与该佣金事件相关；原因另在确认步骤填写。",
        fields: [
          { key: "refundRef", label: "退款 / 派发 / 工单编号", inputKind: "text", required: true, wide: true },
        ],
      },
      run: async (reason, value) => {
        const refundRef = value?.refundRef?.trim();
        if (!refundRef) throw new Error("请填写可验证的证据编号");
        await ctx.reverseF5Commission(row.id, refundRef, reason);
        ctx.toast(`${row.id} 已冲正 · D4/A2/A4 已联动`);
      },
    });
  };

  const reissue = () => {
    if (!selectedRows.length) {
      ctx.toast("请先勾选已撤销佣金");
      return;
    }
    ctx.openActionConfirm({
      name: `批量补发 ${selectedRows.length} 笔佣金`,
      amplify: true,
      detail: `仅补发已撤销/驳回记录：${selectedRows.map((row) => row.id).join("、")}。提交前实时校验 B1 覆盖率；低于红线或快照不可用时整批拒绝。`,
      run: async (reason) => {
        await ctx.reissueF5Commissions(selectedRows.map((row) => row.id), reason);
        setSelected([]);
        ctx.toast("批量补发成功 · B1/D4/A2/A4 已联动");
      },
    });
  };

  const suspend = (row: F5CommissionEvent) => {
    ctx.openActionConfirm({
      name: `暂停用户 ${row.userId} 的佣金`,
      detail: "按奖种暂停后，既有开放佣金立即冻结，后续所有佣金生产器也由数据库闸门阻断；恢复时仅解除闸门，不自动解冻历史记录。",
      businessForm: {
        kind: "multi-field",
        title: "用户佣金暂停",
        fields: [
          {
            key: "kinds",
            label: "暂停奖种",
            current: row.kind,
            inputKind: "multi-select",
            options: KINDS,
            optionLabels: KIND_LABELS,
            required: true,
            wide: true,
          },
        ],
      },
      run: async (reason, value) => {
        const kinds = (value?.kinds ?? "").split(",").map((item) => item.trim()).filter(Boolean);
        if (!kinds.length) throw new Error("至少选择一个奖种");
        await ctx.suspendF5UserCommissions(row.userId, kinds, true, reason);
        ctx.toast(`用户 ${row.userId} 的 ${kinds.join("、")} 已暂停`);
      },
    });
  };

  const editThreshold = () => {
    const sigma = data?.configValues.commissionAnomalySigma ?? "3";
    const ratio = data?.configValues.layerRatioAnomalyPct ?? "20";
    ctx.openActionConfirm({
      name: "调整 F5 异常阈值",
      detail: "金额异常阈值允许 2–5σ、步长 0.5；层比例偏离阈值允许 10%–50%。改后立即用于下一次服务端异常计算。",
      businessForm: {
        kind: "multi-field",
        title: "异常判定阈值",
        fields: [
          { key: "sigma", label: "金额偏离 σ", current: sigma, inputKind: "number", min: 2, max: 5, step: 0.5, required: true },
          { key: "ratio", label: "层比例偏离 %", current: ratio, inputKind: "number", min: 10, max: 50, step: 1, required: true },
        ],
      },
      run: async (reason, value) => {
        const nextSigma = Number(value?.sigma);
        const nextRatio = Number(value?.ratio);
        await ctx.updateF5AnomalyConfig(nextSigma, nextRatio, reason);
        ctx.toast("F5 异常阈值已更新 · A2/A4 已记录");
      },
    });
  };

  if (ctx.f5Loading && !data) {
    return <section className="pane"><div style={{ padding: 18 }}>F5 佣金事件审计加载中...</div></section>;
  }

  return (
    <>
      <section className="pane">
        <div className="pane-h">
          <span className="ph-ttl">F5 佣金事件审计</span>
          <span className="ph-sub">服务端游标 · 六类佣金真实账本</span>
        </div>
        {ctx.f5Error && <div style={{ padding: 12, color: "var(--danger)" }}>加载失败：{ctx.f5Error} <button className="fbtn" onClick={() => void ctx.refreshF5(query())}>重试</button></div>}
        <div className="filter-bar" style={{ gap: 8, flexWrap: "wrap" }}>
          <select aria-label="佣金类型" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">全部类型</option>
            {KINDS.map((item) => <option key={item} value={item}>{KIND_LABELS[item]}</option>)}
          </select>
          <select aria-label="全部币种" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">全部币种</option><option value="USDT">USDT</option><option value="NEX">NEX</option>
          </select>
          <input aria-label="用户 ID" placeholder="用户 ID" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))} />
          <input aria-label="用户群" placeholder="用户群 YYYY-MM" value={cohort} onChange={(e) => setCohort(e.target.value)} />
          <select aria-label="佣金状态" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="cooling">冷却计提</option><option value="unlocked">已解锁</option>
            <option value="withdrawn">已提现</option><option value="reversed">已撤销</option><option value="frozen">已冻结</option>
          </select>
          <button className="fbtn primary" onClick={() => void ctx.refreshF5(query())}>服务端筛选</button>
          {canDispose && <button className="fbtn" onClick={reissue}>批量补发 ({selected.length})</button>}
        </div>
      </section>

      {data && (
        <>
          <div className="f-stats">
            <div className="f-stat"><div className="k">佣金样本合计</div><div className="v">{data.summary.monthlyCommissionSpendLabel}</div><div className="sub">六类真实事件</div></div>
            <div className="f-stat warn"><div className="k">冷却中余额</div><div className="v">{data.summary.coolingBalanceLabel}</div><div className="sub">仅 network / binary</div></div>
            <div className="f-stat ok"><div className="k">可提佣金</div><div className="v">{data.summary.withdrawableThisMonthLabel}</div><div className="sub">其他四类即时入账</div></div>
            <div className="f-stat danger"><div className="k">异常 / 已冻结</div><div className="v">{data.summary.abnormalOrFrozenCount}</div><div className="sub">K 簇证据可追溯</div></div>
          </div>

          <section className="pane">
            <div className="pane-h"><span className="ph-ttl">佣金流水</span><span className="ph-sub">总计 {data.total} 笔 · 当前 {events.length} 笔</span></div>
            <table className="ctbl">
              <thead><tr><th>选择</th><th>佣金 ID</th><th>奖种</th><th>用户 / 来源</th><th>金额</th><th>层级 / 结算时间</th><th>冷却</th><th>状态</th><th>动作</th></tr></thead>
              <tbody>
                {!events.length && <tr className="empty-row"><td colSpan={9}>当前筛选无佣金事件；筛选器和处置入口仍可用</td></tr>}
                {events.map((row) => {
                  const state = badge(row.status);
                  const selectable = canDispose && row.status === "reversed";
                  return (
                    <tr key={row.id}>
                      <td><input aria-label={`选择 ${row.id}`} type="checkbox" disabled={!selectable} checked={selected.includes(row.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id))} /></td>
                      <td><span className="cid">{row.id}</span></td>
                      <td>{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td>{row.user} / {row.sourceUserId ? `U${row.sourceUserId}` : "--"}</td>
                      <td>{row.amt.toLocaleString()} {row.cur}</td>
                      <td>{row.layer ? `L${row.layer}` : "--"} / {row.settledAt}</td>
                      <td>{row.coolingDaysLeft > 0 ? `剩余 ${row.coolingDaysLeft} 天` : "无独立冷却"}</td>
                      <td><Badge tone={state.tone}>{state.label}</Badge></td>
                      <td>
                        <Link href={`/finance/ledger?bizNo=${encodeURIComponent(row.id)}`} style={LINK_STYLE}>D4</Link>
                        <Link href="/overview/dual-ledger" style={LINK_STYLE}>B1</Link>
                        <Link href="/analytics/operations" style={LINK_STYLE}>L4</Link>
                        {canDispose && row.status === "cooling" && <button className="fbtn" onClick={() => dispose("freeze", row)}>冻结</button>}
                        {canDispose && row.status === "cooling" && <button className="fbtn" onClick={() => dispose("unlock", row)}>提前解锁</button>}
                        {canDispose && row.status === "frozen" && <button className="fbtn" onClick={() => dispose("unfreeze", row)}>解冻</button>}
                        {canReject && row.status !== "reversed" && row.status !== "withdrawn" && <button className="fbtn" onClick={() => reverse(row)}>冲正</button>}
                        {canReject && <button className="fbtn" onClick={() => suspend(row)}>暂停奖种</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.nextCursor && <div style={{ padding: 10 }}><button className="fbtn" onClick={() => void ctx.refreshF5({ ...query(), cursor: data.nextCursor })}>下一批</button></div>}
          </section>

          <div className="f5-main">
            <section className="pane">
              <div className="pane-h"><span className="ph-ttl">异常预警列表</span>{canWrite && <button className="fbtn" onClick={editThreshold}>调整阈值</button>}</div>
              <table className="ctbl">
                <thead><tr><th>类型</th><th>佣金 / 用户</th><th>证据</th><th>K 簇</th></tr></thead>
                <tbody>
                  {!data.anomalies.length && <tr className="empty-row"><td colSpan={4}>当前样本未命中异常阈值</td></tr>}
                  {data.anomalies.map((item) => <tr key={item.id}><td>{item.type}</td><td>{item.commissionId || "--"} / {item.userId || "--"}</td><td>{item.evidence}</td><td>{item.relatedKCluster}</td></tr>)}
                </tbody>
              </table>
            </section>
            <aside className="rail">
              <div className="rail-card"><div className="rc-h">六类冷却口径</div>{data.coolingPolicy.map((item) => <div className="it" key={item.kind}>{KIND_LABELS[item.kind]} · {item.days ? `${item.days} 天` : "即时"} · {item.policy}</div>)}</div>
              <div className="rail-card"><div className="rc-h">跨域调用链</div>
                <Link href="/finance/ledger" style={LINK_STYLE}>D4 账本</Link>
                <Link href="/overview/dual-ledger" style={LINK_STYLE}>B1 覆盖率</Link>
                <Link href="/analytics/operations" style={LINK_STYLE}>L4 运营分析</Link>
                <Link href="/platform/audit" style={LINK_STYLE}>A2 审批审计</Link>
                <Link href="/platform/events" style={LINK_STYLE}>A4 事件中心</Link>
              </div>
            </aside>
          </div>

          <section className="pane">
            <div className="pane-h"><span className="ph-ttl">处置批次与历史</span><span className="ph-sub">冲正、补发、暂停、恢复、阈值变更</span></div>
            <table className="ctbl">
              <thead><tr><th>批次</th><th>动作</th><th>源 / 结果</th><th>用户 / 奖种</th><th>证据</th><th>原因 / 操作人</th><th>时间</th></tr></thead>
              <tbody>
                {!data.operationHistory.length && <tr className="empty-row"><td colSpan={7}>尚无 F5 处置批次；迁移完成后的动作会在此留痕</td></tr>}
                {data.operationHistory.map((item) => <tr key={item.operationNo}><td>{item.operationNo}</td><td>{item.operationType}</td><td>{item.sourceCommissionId || "--"} / {item.resultCommissionId || "--"}</td><td>{item.userId || "--"} / {item.kinds}</td><td>{item.evidenceRef || "--"}</td><td>{item.reason} / {item.operator}</td><td>{item.createdAt}</td></tr>)}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
