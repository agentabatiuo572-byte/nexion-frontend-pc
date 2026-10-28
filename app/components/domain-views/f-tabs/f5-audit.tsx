"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "../design-kit";
import type { F5CommissionEvent, F5CommissionQuery } from "@/lib/admin/f1-client";
import type { FViewCtx } from "./types";
import { F5_KINDS as KINDS, F5_KIND_LABELS as KIND_LABELS } from "@/lib/admin/f-overview-contract";

const STATUS_BY_LABEL: Record<string, string> = {
  已解锁可提: "unlocked",
  冷却计提中: "cooling",
  已提现: "withdrawn",
  已撤销: "reversed",
  已冻结: "frozen",
  已拒绝: "rejected",
  待追回: "recovery_pending",
};
const LINK_STYLE = {
  color: "var(--ink-4)",
  textDecoration: "none",
  fontSize: 11,
  marginRight: 8,
} as const;

function GatedLink({ allowed, href, label }: { allowed: boolean; href: string; label: string }) {
  return allowed
    ? <Link href={href} style={LINK_STYLE}>{label}</Link>
    : <span title={`你没有查看「${label}」的权限`} style={{ ...LINK_STYLE, cursor: "not-allowed" }}>{label} 无权限</span>;
}

function badge(status: string): { label: string; tone: "ok" | "warn" | "err" | "neutral" } {
  if (status === "unlocked") return { label: "已解锁", tone: "ok" };
  if (status === "withdrawn") return { label: "已提现", tone: "neutral" };
  if (status === "reversed") return { label: "已撤销", tone: "err" };
  if (status === "frozen") return { label: "已冻结", tone: "warn" };
  if (status === "rejected") return { label: "已拒绝", tone: "err" };
  if (status === "recovery_pending") return { label: "待追回", tone: "err" };
  if (status === "cooling") return { label: "奖励等待发放", tone: "warn" };
  return { label: "状态未知", tone: "warn" };
}

const directGroup = (row: F5CommissionEvent) => row.kind === "direct_purchase" || row.kind === "direct_device_earning";
const operationLabels: Record<string, string> = { REVERSE: "冲正", REISSUE: "补发", SUSPEND: "暂停", RESUME: "恢复" };
const kindNames = (value: string) => value.split(",").map((kind) => KIND_LABELS[kind.trim()] ?? "未知奖励类型").join("、");
const amountLabel = (row: F5CommissionEvent) => directGroup(row)
  ? `结算组 ${row.settlementNo} · ${row.amountUSDT} USDT + ${row.amountNEX} UVT（一起处理）`
  : `${row.amt.toLocaleString("en-US")} ${nexGridBrandText(row.cur)}`;

export function F5Audit({ ctx }: { ctx: FViewCtx }) {
  const canWrite = ctx.can("network_f5_write");
  const canFreeze = ctx.can("network_f5_commission_freeze");
  const canSuspend = ctx.can("network_f5_commission_suspend");
  const canRelease = ctx.can("network_f5_commission_release");
  const canReverse = ctx.can("network_f5_commission_reverse");
  const canReissue = ctx.can("network_f5_commission_reissue");
  const canReadD4 = ctx.can("finance_d4_read");
  const canReadB1 = ctx.can("overview_b1_read");
  const canReadL4 = ctx.can("bi_l4_read");
  const canReadA2 = ctx.can("platform_a2_read");
  const canReadA4 = ctx.can("platform_a4_read");
  const [kind, setKind] = useState("");
  const [currency, setCurrency] = useState("");
  const [userId, setUserId] = useState("");
  const [cohort, setCohort] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const data = ctx.f5Overview;
  const reissueAvailable = canReissue && !ctx.f5Error && !!data;
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

  const applyKindFilter = (selectedKind: string) => {
    const nextKind = kind === selectedKind ? "" : selectedKind;
    setKind(nextKind);
    setSelected([]);
    void ctx.refreshF5({ ...query(), kind: nextKind || undefined, cursor: undefined });
  };

  const applyStatusFilter = (selectedStatus: string) => {
    const nextStatus = status === selectedStatus ? "" : selectedStatus;
    setStatus(nextStatus);
    setSelected([]);
    void ctx.refreshF5({ ...query(), status: nextStatus || undefined, cursor: undefined });
  };

  // 单笔冻结/提前解锁/解冻(合并底账 §二#4 恢复):可逆的「先按住观察」,与不可逆冲正分层。
  // 走既有 dispose 管线:openActionConfirm(op:"dispose") → shell updateF5Config → proposeFConfig
  // → f_commission_status A2 票(防重复提交 + 服务端 CAS + 审计),paramKey 用行上现成的 auditKey。
  const dispose = (kind: "freeze" | "unlock" | "unfreeze", row: F5CommissionEvent) => {
    const amount = amountLabel(row);
    const map = {
      freeze: { name: `冻结佣金 ${row.id}`, amplify: false, fixedVal: "frozen", detail: `冻结 ${row.id} · ${amount} · 先按住观察：这笔暂时不能解锁和提现，随时可以解冻。和冲正不同，冻结可以撤回。` },
      unlock: { name: `佣金提前解锁 ${row.id}`, amplify: true, fixedVal: "unlocked", detail: `提前解锁 ${row.id} · ${amount} · 跳过剩余冷却期，马上可以提现。会让钱提前流出，先看兑付覆盖率。` },
      unfreeze: { name: `解冻佣金 ${row.id}`, amplify: false, fixedVal: "cooling", detail: `解冻 ${row.id} · ${amount} · 回到冻结前的冷却期，剩下的冷却天数照常计算。` },
    }[kind];
    ctx.openActionConfirm({ name: map.name, amplify: map.amplify, op: "dispose", paramKey: row.auditKey, fixedVal: map.fixedVal, expectedVersion: row.version, detail: map.detail });
  };

  const reverse = (row: F5CommissionEvent) => {
    ctx.openActionConfirm({
      name: `冲正佣金 ${row.id}`,
      detail: `冲正 ${row.id} · ${amountLabel(row)}。把这笔佣金收回，需要填写退款单、发放单或工单编号。用户余额不够时会标记为「待追回」，钱还没真正收回。`,
      businessForm: {
        kind: "multi-field",
        title: "冲正证据",
        hint: "填写与这笔佣金有关的退款单、发放单或工单编号。原因在下一步填写。",
        fields: [
          { key: "refundRef", label: "退款 / 发放 / 工单编号", inputKind: "text", required: true, wide: true },
        ],
      },
      run: async (reason, value) => {
        const refundRef = value?.refundRef?.trim();
        if (!refundRef) throw new Error("请填写有效的单号");
        await ctx.reverseF5Commission(row.id, refundRef, reason);
        ctx.toast(`${row.id} 冲正已提交，等待审批`);
      },
    });
  };

  const reissue = () => {
    if (selectedRows.some(row => directGroup(row) || row.reversalRecorded || row.status === "recovery_pending")) {
      ctx.toast("直属分成、已退款或待追回的记录不能补发。");
      return;
    }
    if (!selectedRows.length) {
      ctx.toast("请先勾选要补发的已撤销佣金");
      return;
    }
    ctx.openActionConfirm({
      name: `批量补发 ${selectedRows.length} 笔佣金`,
      amplify: true,
      detail: `只补发已撤销或已拒绝的记录：${selectedRows.map((row) => row.id).join("、")}。兑付覆盖率低于红线时整批不能提交。`,
      run: async (reason) => {
        await ctx.reissueF5Commissions(selectedRows.map((row) => row.id), reason);
        setSelected([]);
        ctx.toast("批量补发已提交，等待审批");
      },
    });
  };

  const suspend = (row: F5CommissionEvent) => {
    ctx.openActionConfirm({
      name: `暂停用户 ${row.userId} 的佣金`,
      detail: "暂停后，这位用户所选类型的佣金马上冻结，以后也不再产生。恢复只会让以后的佣金照常产生，已冻结的不会自动解冻。",
      businessForm: {
        kind: "multi-field",
        title: "用户佣金暂停",
        fields: [
          {
            key: "kinds",
            label: "暂停哪些奖励",
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
        if (!kinds.length) throw new Error("至少选择一种奖励");
        await ctx.suspendF5UserCommissions(row.userId, kinds, true, reason);
        ctx.toast(`用户 ${row.userId} 的 ${kinds.map((kind) => KIND_LABELS[kind] ?? "所选奖励").join("、")} 暂停已提交，等待审批`);
      },
    });
  };

  const editThreshold = () => {
    const sigma = data?.configValues.commissionAnomalySigma ?? "3";
    const ratio = data?.configValues.layerRatioAnomalyPct ?? "20";
    ctx.openActionConfirm({
      name: "调整异常预警标准",
      detail: "金额偏离可设 2–5 倍标准差（σ），每次加减 0.5；层级比例偏离可设 10%–50%。数字越小，预警越多。马上生效。",
      businessForm: {
        kind: "multi-field",
        title: "异常预警标准",
        fields: [
          { key: "sigma", label: "金额偏离（倍标准差 σ）", current: sigma, inputKind: "number", min: 2, max: 5, step: 0.5, required: true },
          { key: "ratio", label: "层级比例偏离（%）", current: ratio, inputKind: "number", min: 10, max: 50, step: 1, required: true },
        ],
      },
      run: async (reason, value) => {
        const nextSigma = Number(value?.sigma);
        const nextRatio = Number(value?.ratio);
        await ctx.updateF5AnomalyConfig(nextSigma, nextRatio, reason);
        ctx.toast("异常预警标准已更新");
      },
    });
  };

  const exportAllFiltered = () => {
    const filters = query();
    ctx.openActionConfirm({
      name: "导出当前筛选的全部佣金",
      detail: "按当前筛选条件导出全部记录，不只是这一页。敏感信息已隐藏。",
      run: async (reason) => {
        const receipt = await ctx.exportF5Commissions(filters, reason);
        ctx.toast(`已下载 ${receipt.filename} · 共 ${receipt.rowCount} 行`);
      },
    });
  };

  if (ctx.f5Loading && !data) {
    return <section className="pane"><div style={{ padding: 18 }}>佣金记录加载中…</div></section>;
  }

  return (
    <div className="f-section-stack">
      <section className="pane">
        <div className="pane-h">
          <span className="ph-ttl">佣金记录核对</span>
          <span className="ph-sub">8 类佣金的全部发放记录</span>
        </div>
        {ctx.f5Error && <div style={{ padding: 12, color: "var(--danger)" }}>加载失败：{ctx.f5Error}。数据不完整，批量补发已暂停。 <button className="fbtn" onClick={() => void ctx.refreshF5(query())}>重试</button></div>}
        <div className="filter-bar" style={{ gap: 8, flexWrap: "wrap" }}>
          <select aria-label="佣金类型" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">全部类型</option>
            {KINDS.map((item) => <option key={item} value={item}>{KIND_LABELS[item]}</option>)}
          </select>
          <select aria-label="全部币种" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">全部币种</option><option value="USDT">USDT</option><option value="NEX">UVT</option>
          </select>
          <input aria-label="用户编号" placeholder="用户编号" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))} />
          <input aria-label="用户群" type="month" title="按成员注册月份筛选" value={cohort} onChange={(e) => setCohort(e.target.value)} />
          <select aria-label="佣金状态" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="cooling">奖励等待发放</option><option value="unlocked">已解锁</option>
            <option value="withdrawn">已提现</option><option value="reversed">已撤销</option><option value="frozen">已冻结</option><option value="rejected">已拒绝</option><option value="recovery_pending">待追回</option>
          </select>
          <button className="fbtn primary" onClick={() => void ctx.refreshF5(query())}>筛选</button>
          <button className="fbtn" onClick={exportAllFiltered}>导出筛选结果（CSV）</button>
          {reissueAvailable && <button className="fbtn" onClick={reissue}>批量补发 ({selected.length})</button>}
        </div>
      </section>

      {data && (
        <>
          <div className="f-stats">
            <div className="f-stat"><div className="k">佣金合计</div><div className="v">{nexGridBrandText(data.summary.monthlyCommissionSpendLabel)}</div><div className="sub">8 类 · USDT / UVT 分开统计</div></div>
            <div className="f-stat warn"><div className="k">冷却中余额</div><div className="v">{nexGridBrandText(data.summary.coolingBalanceLabel)}</div><div className="sub">还在冷却期、暂不能提现</div></div>
            <div className="f-stat ok"><div className="k">已解锁佣金</div><div className="v">{nexGridBrandText(data.summary.withdrawableThisMonthLabel)}</div><div className="sub">实际可提现金额以用户钱包为准</div></div>
            <div className="f-stat danger"><div className="k">已冻结</div><div className="v">{data.summary.frozenCount}</div><div className="sub">笔数；异常记录见右侧预警</div></div>
          </div>

          <section className="pane" aria-label="佣金去向与状态">
            <div className="pane-h">
              <span className="ph-ttl">佣金去向与状态</span>
              <span className="ph-sub">点卡片可筛选下方记录，再点一次取消</span>
            </div>
            <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {data.commissionKinds.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  data-testid="f5-commission-kind-card"
                  data-kind={item.key}
                  aria-pressed={kind === item.key}
                  className="f-stat"
                  onClick={() => applyKindFilter(item.key)}
                  style={{ textAlign: "left", cursor: "pointer", borderColor: kind === item.key ? "var(--cyan)" : undefined }}
                >
                  <span className="k" style={{ display: "block" }}>{KIND_LABELS[item.key] ?? item.lbl}</span>
                  <strong className="v" style={{ color: item.amtColor || undefined, display: "block" }}>{nexGridBrandText(item.amt)}</strong>
                  <span className="sub" style={{ display: "block" }}>{item.ct}</span>
                </button>
              ))}
            </div>
            <div style={{ borderTop: "1px solid var(--border)", padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {data.statusDistribution.map((item) => {
                const statusKey = STATUS_BY_LABEL[item.nm];
                const active = !!statusKey && status === statusKey;
                return (
                  <button
                    key={item.nm}
                    type="button"
                    data-testid="f5-status-distribution-item"
                    data-status={statusKey ?? ""}
                    aria-pressed={active}
                    disabled={!statusKey}
                    onClick={() => statusKey && applyStatusFilter(statusKey)}
                    className="fbtn"
                    style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", alignItems: "center", gap: 8, padding: "12px 14px", borderColor: active ? "var(--cyan)" : undefined }}
                  >
                    <i aria-hidden style={{ width: 9, height: 9, borderRadius: 99, background: item.dot }} />
                    <span style={{ textAlign: "left" }}>{item.nm === "已解锁可提" ? "已解锁" : operatorCopyText(item.nm)}</span>
                    <b>{item.ct} 笔</b>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="pane" aria-label="待计算奖励">
            <div className="pane-h"><span className="ph-ttl">待计算奖励</span><span className="ph-sub">共 {data.pendingCalculationCount} 组 · 等 UVT 价格恢复后再计算，还没有到账</span></div>
            <div style={{ overflowX: "auto" }}>
              <table className="ctbl">
                <thead><tr><th>结算号</th><th>奖励类型</th><th>来源 / 成员</th><th>层级</th><th>计算基数（USDT）</th><th>奖励</th><th>冷却到期 / 发生时间</th><th>状态</th></tr></thead>
                <tbody>
                  {!data.pendingCalculations.length && <tr className="empty-row"><td colSpan={8}>没有待计算的奖励</td></tr>}
                  {data.pendingCalculations.map(row => <tr key={row.settlementNo}>
                    <td className="cid">{row.settlementNo}</td><td>{KIND_LABELS[row.kind]}</td><td>{row.sourceRef} / {operatorNicknameText(row.sourceUserName)}</td>
                    <td>{row.kind === "direct_purchase" ? `L${row.layer}` : "直属"}</td><td>{row.basisUsdt} USDT</td><td>USDT 待计算 · UVT 待计算</td>
                    <td>{row.unlockAt ? new Date(row.unlockAt).toLocaleString() : "待确认"} / {row.ts}</td><td><Badge tone="warn">等待价格</Badge></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <p style={{ padding: "12px 18px 16px", fontSize: 12, color: "var(--ink-3)" }}>最多显示 100 组，可按奖励类型筛选。这些奖励还没算出金额，不能在这里处理；已算出金额的记录在下方。</p>
          </section>

          <section className="pane">
            <div className="pane-h"><span className="ph-ttl">佣金流水</span><span className="ph-sub">共 {data.total} 笔 · 已显示 {events.length} 笔</span></div>
            <table className="ctbl">
              <thead><tr><th>选择</th><th>佣金 ID</th><th>奖励类型</th><th>用户 / 来源</th><th>金额</th><th>层级 / 结算时间</th><th>冷却</th><th>状态</th><th>动作</th></tr></thead>
              <tbody>
                {!events.length && <tr className="empty-row"><td colSpan={9}>没有符合条件的佣金记录</td></tr>}
                {events.map((row) => {
                  const state = badge(row.status);
                  const selectable = canReissue && row.status === "reversed" && !directGroup(row) && !row.reversalRecorded;
                  return (
                    <tr key={row.id}>
                      <td><input aria-label={`选择 ${row.id}`} type="checkbox" disabled={!selectable} title={directGroup(row) ? "直属分成不能补发" : row.reversalRecorded ? "已退款的记录不能补发" : undefined} checked={selected.includes(row.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id))} /></td>
                      <td><span className="cid">{row.id}</span>{(directGroup(row) || row.settlementNo) && <details style={{ marginTop: 6, maxWidth: 260 }}><summary>来源详情</summary><div style={{ display: "grid", gap: 5, padding: "8px 0", overflowWrap: "anywhere" }}>
                        <span>结算组：{row.settlementNo}</span><span>来源编号：{row.sourceRef}</span><span>设备：{row.sourceDeviceId || "不适用"}</span>
                        {directGroup(row) ? <>
                        <span>设置版本：{row.policyVersion}</span><span>计价基数：{row.basisUsdt} USDT</span><span>当笔 UVT 价格：{row.nexUsdtPrice} USDT</span>
                        <span>整组奖励：{row.amountUSDT} USDT + {row.amountNEX} UVT</span><span>待追回：{row.recoveryPendingUSDT} USDT + {row.recoveryPendingNEX} UVT</span>
                        <span>{row.reversalRecorded ? "来源已退款或冲正，不能补发" : "直属分成不能补发"}</span>
                        </> : <><span>当前账项：{row.amt} {nexGridBrandText(row.cur)} · {state.label}</span><span>同组的其他奖励只供参考，操作只影响这一笔。</span></>}
                      </div></details>}</td>
                      <td>{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td>{operatorNicknameText(row.user)} / {row.sourceUserId ? `U${row.sourceUserId}` : "--"}</td>
                      <td>{row.amt.toLocaleString()} {nexGridBrandText(row.cur)}</td>
                      <td>{directGroup(row) ? "直属" : row.layer ? `L${row.layer}` : "--"} / {row.settledAt}</td>
                      <td>{row.coolingDaysLeft > 0 ? `剩余 ${row.coolingDaysLeft} 天` : "无冷却"}</td>
                      <td><Badge tone={state.tone}>{state.label}</Badge></td>
                      <td>
                        {canReadD4 && row.ledgerBizNo ? (
                          <Link href={`/finance/ledger?bizNo=${encodeURIComponent(row.ledgerBizNo)}`} style={LINK_STYLE}>账本</Link>
                        ) : !canReadD4 ? (
                          <span title="你没有查看资金账本的权限" style={{ ...LINK_STYLE, cursor: "not-allowed" }}>账本无权限</span>
                        ) : (
                          <span title="这笔佣金还没有资金账本记录" style={{ ...LINK_STYLE, cursor: "not-allowed" }}>暂无账本</span>
                        )}
                        <GatedLink allowed={canReadB1} href="/overview/dual-ledger" label="覆盖率" />
                        <GatedLink allowed={canReadL4} href="/analytics/operations" label="L4" />
                        {canFreeze && row.status === "cooling" && <button className="fbtn" onClick={() => dispose("freeze", row)}>冻结</button>}
                        {canRelease && row.status === "cooling" && !directGroup(row) && <button className="fbtn" onClick={() => dispose("unlock", row)}>提前解锁</button>}
                        {canFreeze && row.status === "frozen" && <button className="fbtn" onClick={() => dispose("unfreeze", row)}>解冻</button>}
                        {canReverse && !["reversed", "withdrawn", "rejected", "recovery_pending"].includes(row.status) && <button className="fbtn" onClick={() => reverse(row)}>冲正</button>}
                        {canSuspend && <button className="fbtn" onClick={() => suspend(row)}>暂停此类奖励</button>}
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
              <div className="pane-h"><span className="ph-ttl">异常预警</span>{canWrite && <button className="fbtn" onClick={editThreshold}>调整标准</button>}</div>
              <table className="ctbl">
                <thead><tr><th>类型</th><th>佣金 / 用户</th><th>依据</th><th>关联风险群</th></tr></thead>
                <tbody>
                  {!data.anomalies.length && <tr className="empty-row"><td colSpan={4}>暂无异常</td></tr>}
                  {data.anomalies.map((item) => <tr key={item.id}><td>{item.type}</td><td>{item.commissionId || "--"} / {item.userId || "--"}</td><td>{item.evidence}</td><td>{item.relatedKCluster}</td></tr>)}
                </tbody>
              </table>
            </section>
            <aside className="rail">
              <div className="rail-card"><div className="rc-h">各类奖励的冷却期</div>{data.coolingPolicy.map((item) => <div className="it" key={item.kind}>{KIND_LABELS[item.kind]} · {item.days ? `${item.days} 天` : "即时"} · {operatorCopyText(item.policy)}</div>)}</div>
              <div className="rail-card"><div className="rc-h">相关页面</div>
                {canReadD4
                  ? <Link href="/finance/ledger" style={LINK_STYLE}>账本与账单核对</Link>
                  : <span title="你没有查看资金账本的权限" style={{ ...LINK_STYLE, cursor: "not-allowed" }}>资金账本（无权限）</span>}
                <GatedLink allowed={canReadB1} href="/overview/dual-ledger" label="兑付覆盖率" />
                <GatedLink allowed={canReadL4} href="/analytics/operations" label="设备/任务/网络报表" />
                <GatedLink allowed={canReadA2} href="/platform/audit" label="操作记录与审批" />
                <GatedLink allowed={canReadA4} href="/platform/events" label="用户行为事件" />
              </div>
            </aside>
          </div>

          <section className="pane">
            <div className="pane-h"><span className="ph-ttl">已暂停的奖励</span><span className="ph-sub">恢复后只影响以后的佣金，已冻结的不会自动解冻</span></div>
            <table className="ctbl">
              <thead><tr><th>用户</th><th>奖励类型</th><th>原因 / 操作人</th><th>更新时间</th><th>动作</th></tr></thead>
              <tbody>
                {!data.activeSuspensions.length && <tr className="empty-row"><td colSpan={5}>没有暂停中的奖励</td></tr>}
                {data.activeSuspensions.map((item) => <tr key={`${item.userId}:${item.kind}`}>
                  <td>{item.userId}</td><td>{KIND_LABELS[item.kind] ?? item.kind}</td>
                  <td>{item.reason} / {item.operator}</td><td>{item.updatedAt}</td>
                  <td>{canSuspend && <button className="fbtn primary" onClick={() => ctx.openActionConfirm({
                    name: `恢复奖励 · ${item.userId} / ${KIND_LABELS[item.kind] ?? "所选奖励"}`,
                    detail: "需要审批。批准后这类佣金以后照常产生，已冻结的不会自动解冻。",
                    run: async (reason) => {
                      const numericUserId = Number(String(item.userId).replace(/\D/g, ""));
                      if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) throw new Error("无效用户编号");
                      await ctx.suspendF5UserCommissions(numericUserId, [item.kind], false, reason);
                      ctx.toast(`用户 ${item.userId} 的 ${KIND_LABELS[item.kind] ?? "所选奖励"} 恢复已提交，等待审批`);
                    },
                  })}>恢复</button>}</td>
                </tr>)}
              </tbody>
            </table>
          </section>

          <section className="pane">
            <div className="pane-h"><span className="ph-ttl">处置批次与历史</span><span className="ph-sub">冲正、补发、暂停、恢复、预警标准修改</span></div>
            <table className="ctbl">
              <thead><tr><th>批次</th><th>动作</th><th>原记录 / 新记录</th><th>用户 / 奖励类型</th><th>单号</th><th>原因 / 操作人</th><th>时间</th></tr></thead>
              <tbody>
                {!data.operationHistory.length && <tr className="empty-row"><td colSpan={7}>还没有处理记录</td></tr>}
                {data.operationHistory.map((item) => <tr key={item.operationNo}><td>{item.operationNo}</td><td>{operationLabels[item.operationType] ?? "佣金处理"}</td><td>{item.sourceCommissionId || "--"} / {item.resultCommissionId || "--"}</td><td>{item.userId || "--"} / {item.kinds ? kindNames(item.kinds) : "--"}</td><td>{item.evidenceRef || "--"}</td><td>{item.reason} / {item.operator}</td><td>{item.createdAt}</td></tr>)}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
