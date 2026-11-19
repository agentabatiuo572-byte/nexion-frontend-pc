"use client";
import { useState } from "react";
import { ArrowLeftRight, Smartphone } from "lucide-react";
import { Button, Cell, Change, Conclusion, Fact, Facts, Fold, Modal, Notice, Panel, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { e6AmountPrecision, formatE6Amount } from "@/lib/admin/e6-decimal";
import { buildE6OnboardingYieldSkuProposal } from "@/lib/admin/high-ops-registry";
import { skuSeriesText } from "@/lib/admin/device-monthly-target";
import type { E2YieldComparison } from "@/lib/admin/e2-client";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { EViewCtx } from "./types";
import { E6ConfirmModal } from "./e6-confirm-modal";
import { useE6Mutations } from "./e6-mutations";
import { E6Amount } from "./e6-amount";
import "./e6-yield-comparison.css";

/** 对比位的名字只说它在 App 引导里的位置，不限制能选哪个系列的商品。 */
const SLOT_NAMES: Record<string, string> = { phone: "手机", s1: "S1 位", pro: "Pro 位", rack: "Rack 位" };
const slotName = (key: string) => SLOT_NAMES[key] ?? key;
const scopeOf = (row: E2YieldComparison) => `comparison:${row.configKey}`;
const TERMINAL_NAMES: Record<string, string> = { approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };

/** 引导对比：手机行来自 T3，商品行各绑一件在售实物商品，换绑走审批。 */
export function E6YieldComparisonPanel({ ctx, ready }: { ctx: EViewCtx; ready: boolean }) {
  const m = useE6Mutations();
  const [pick, setPick] = useState<{ row: E2YieldComparison; skuId: string } | null>(null);
  const [confirm, setConfirm] = useState<{ row: E2YieldComparison; sku: OpsSku } | null>(null);
  const canBind = m.canBindYieldSku;
  const candidates = ctx.e6SkuCandidates;
  const rows = [...ctx.yieldComparisons].sort((a, b) => Number(b.configKey === "phone") - Number(a.configKey === "phone") || a.sortOrder - b.sortOrder);
  // 不可用行两币都是空，只按可用行定位数。
  const usable = rows.filter(r => r.available);
  const usdtPrecision = e6AmountPrecision(usable.map(r => r.dailyUsdtText)), uvtPrecision = e6AmountPrecision(usable.map(r => r.dailyNexText));
  const others = (row: E2YieldComparison) => candidates.status === "ready" ? candidates.skus.filter(sku => sku.id !== row.productNo) : [];
  const blockReason = (row: E2YieldComparison) => m.pending.find(p => p.scope === scopeOf(row))?.terminal ? "原审批已有结论，先在上方点「准备新变更」"
    : m.locked(scopeOf(row)) ? "这一位有待审批或结果未知的更换"
    : row.bindingRevision == null ? "这一位暂时不能更换，请刷新后核对"
      : candidates.status === "forbidden" ? "需要商品目录的查看权限"
        : candidates.status === "loading" ? "正在加载可选商品"
          : candidates.status === "error" ? "可选商品加载失败，请先重试"
            : !others(row).length ? "没有可替换的在售商品" : undefined;
  const columns = canBind ? 5 : 4;
  const candidatePrecision = (skus: OpsSku[]) => ({ usdt: e6AmountPrecision(skus.map(s => String(s.dailyEarn))), uvt: e6AmountPrecision(skus.map(s => String(s.dailyEarnNEX ?? ""))) });

  return <>
    <Panel title="新用户引导收益对比" icon={Smartphone} tone="role-2" flush explain="App 新用户引导里和手机对比的几行。手机行来自 T3 档位；其他每一位绑一件在售商品，名称和收益随商品读取。实际校准结果优先使用用户当前档位，不代表所有用户都领取 T3 收益。">
      {ready && rows.length !== 4 && <Notice tone="warn">数据不全，请核对在售商品与手机 T3 档位。</Notice>}
      {ready && canBind && candidates.status === "error" && <Notice tone="warn" title="可选商品加载失败，暂时不能更换选品" action={<Button size="sm" onClick={() => void ctx.refreshE6SkuCandidates()}>重试</Button>}>{candidates.error}</Notice>}
      <Table label="新用户引导收益对比" className="e6-yield-table"><thead><tr><Th>对比位</Th><Th>当前商品</Th><Th align="right">USDT/天</Th><Th align="right">UVT/天</Th>{canBind && <Th sticky="end">操作</Th>}</tr></thead><tbody>
        {ctx.e2Loading ? <TableLoading columns={columns} /> : !ready ? <TableMessage columns={columns}>等档位收益读取成功后可用</TableMessage> : rows.map(r => {
          const phone = r.configKey === "phone";
          const pending = m.pending.find(p => p.scope === scopeOf(r));
          return <Tr key={r.configKey}>
            <Td><Cell main={slotName(r.configKey)} sub={phone ? "当前引导档" : undefined} /></Td>
            <Td grow><div className="e6-yield-product">
              <Cell full main={phone ? "手机 T3 档位" : r.available ? nexGridBrandText(r.label) : r.productNo ? <span data-mono="">{r.productNo}</span> : "未选商品"} sub={!phone && r.available && r.productNo ? <span data-mono="">{r.productNo}</span> : undefined} />
              {pending && (pending.terminal
                ? <StatusTag tone={pending.terminal === "approved" ? "ok" : "done"} explain="在上方记录里点「准备新变更」后，才能再次更换。">{`原审批${TERMINAL_NAMES[pending.terminal] ?? "已结束"}`}</StatusTag>
                : <StatusTag tone={pending.ticketId ? "progress" : "warn"} explain={pending.ticketId ? "另一位管理员批准后才换成新商品。" : "原操作已保存，到上方记录里查询结果。"}>{pending.ticketId ? "待审批，原商品仍生效" : "更换结果未知"}</StatusTag>)}
            </div></Td>
            {phone || r.available
              ? <><Td align="right" data-num=""><E6Amount raw={r.dailyUsdtText} precision={usdtPrecision} currency="USDT" /></Td><Td align="right" data-num=""><E6Amount raw={r.dailyNexText} precision={uvtPrecision} currency="UVT" /></Td></>
              : <Td colSpan={2} className="e6-yield-off"><Conclusion state="warn" explainTitle="为什么不显示" explain={r.productNo ? "绑定的商品已下架、商城里看不到，或 USDT、UVT 日收益不完整。可点「更换选品」换一件在售商品。" : "这一位还没有绑定商品。可点「更换选品」选一件在售商品。"}>{r.productNo ? "商品不可用，App 引导暂不显示" : "未选商品，App 引导暂不显示"}</Conclusion></Td>}
            {canBind && <Td sticky="end">{!phone && <Button size="sm" disabledReason={blockReason(r)} onClick={() => setPick({ row: r, skuId: "" })}>更换选品</Button>}</Td>}
          </Tr>;
        })}
      </tbody></Table>
    </Panel>
    {pick && (() => {
      const list = others(pick.row), precision = candidatePrecision(list), chosen = list.find(s => s.id === pick.skuId);
      return <Modal title={`更换选品 · ${slotName(pick.row.configKey)}`} icon={ArrowLeftRight} onClose={() => setPick(null)} footer={<>
        <Button onClick={() => setPick(null)}>取消</Button>
        <Button variant="primary" disabledReason={chosen ? undefined : "先选一件商品"} onClick={() => { if (chosen) { setPick(null); setConfirm({ row: pick.row, sku: chosen }); } }}>下一步</Button>
      </>}>
        <Facts><Fact k="当前商品">{pick.row.available ? `${nexGridBrandText(pick.row.label)} · ${pick.row.productNo}` : pick.row.productNo ? `${pick.row.productNo} · 已下架或收益不完整` : "未选商品"}</Fact></Facts>
        <div className="e6-yield-picks" role="radiogroup" aria-label="选择新商品">
          {list.map(sku => <label key={sku.id} className="e6-yield-pick" data-on={pick.skuId === sku.id ? "" : undefined}>
            <input type="radio" name="e6-yield-pick" checked={pick.skuId === sku.id} onChange={() => setPick({ ...pick, skuId: sku.id })} />
            <span className="e6-yield-pick-name"><strong>{nexGridBrandText(sku.name)}</strong><span>{skuSeriesText(sku.seriesCode)}</span></span>
            <span className="e6-yield-pick-id" data-mono="">{sku.id}</span>
            <span className="e6-yield-pick-earn" data-num="">{formatE6Amount(String(sku.dailyEarn), precision.usdt)} USDT/天 · {formatE6Amount(String(sku.dailyEarnNEX), precision.uvt)} UVT/天</span>
          </label>)}
        </div>
      </Modal>;
    })()}
    {confirm && (() => {
      const { row, sku } = confirm, scope = scopeOf(row), slot = slotName(row.configKey);
      const before = row.available ? `${nexGridBrandText(row.label)} · ${row.productNo}` : row.productNo ? `${row.productNo} · 已下架或收益不完整` : "未选商品";
      const usdt = e6AmountPrecision([String(sku.dailyEarn), ...row.available ? [row.dailyUsdtText] : []]), uvt = e6AmountPrecision([String(sku.dailyEarnNEX), ...row.available ? [row.dailyNexText] : []]);
      return <E6ConfirmModal scope={scope} briefKind="config" action={`更换引导对比商品 · ${slot}`} confirmLabel="提交审批" reasonMin={8} reasonMax={200}
        statedBrief={{ impact: "批准后 App 新用户引导的这一位改显示新商品和它的收益；批准前原商品照常显示。", check: "核对新商品名称和两种日收益。" }}
        detail="批准后生效；批准前原商品照常显示。"
        completionCopy="提交后请另一位有批准权限和手机算力配置查看权限的管理员在「操作记录与审批」中批准。"
        facts={<Facts>
          <Fact k="对比位">{slot}</Fact>
          <Fact k="商品"><Change from={before} to={`${nexGridBrandText(sku.name)} · ${sku.id}`} /></Fact>
          <Fact k="USDT/天"><Change from={row.available ? formatE6Amount(row.dailyUsdtText, usdt) : "—"} to={formatE6Amount(String(sku.dailyEarn), usdt)} /></Fact>
          <Fact k="UVT/天"><Change from={row.available ? formatE6Amount(row.dailyNexText, uvt) : "—"} to={formatE6Amount(String(sku.dailyEarnNEX), uvt)} /></Fact>
        </Facts>}
        content={<Fold inset title="技术信息" summary="提交时核对有没有被别人改过"><Facts><Fact k="修改序号">{String(row.bindingRevision ?? "—")}</Fact></Facts></Fold>}
        getPendingReason={() => m.pendingReason(scope)} onClose={() => setConfirm(null)}
        onConfirm={async reason => {
          const original = m.pending.find(r => r.scope === scope);
          if (original) await m.send(original, true);
          else {
            const spec = buildE6OnboardingYieldSkuProposal(row, sku.id);
            if (!spec) throw new Error("这一位暂时不能更换，请刷新后核对。");
            if (!ready || ctx.yieldComparisons.find(current => current.configKey === row.configKey)?.bindingRevision !== row.bindingRevision) {
              throw new Error("ONBOARDING_COMPARISON_VERSION_CONFLICT");
            }
            await m.proposal(scope, "tiers", { ...spec, action: `更换引导对比商品 · ${slot}`, beforeValue: before, afterValue: `${sku.name} (${sku.id}) · ${sku.dailyEarn} USDT / ${sku.dailyEarnNEX} UVT 每日`, reason });
          }
          setConfirm(null); ctx.toast("已提交审批，批准前原商品照常显示"); await ctx.refreshE2();
        }} />;
    })()}
  </>;
}
