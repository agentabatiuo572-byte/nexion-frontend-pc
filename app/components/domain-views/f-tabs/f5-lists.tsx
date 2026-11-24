"use client";

/**
 * F5 的四个次要页签：等价格、异常样本、暂停名单、处置历史。都是后端一次读回来的整块，不分页。
 * 只排版；写入口（调整标准、恢复）调页面传进来的处理函数。
 */
import { Clock3, History, PauseCircle, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { Button, Cell, Fold, Panel, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import type { F5Anomaly, F5CommissionAuditOverview, F5LayerRatioComparison, F5OperationHistory, F5PendingCalculation } from "@/lib/admin/f1-client";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { KIND_LABELS, Money, deviceEarningSource, percentText, kindNames, operationLabel, timeText, userCode, zoneNote } from "./f5-shared";

/** 后端异常类型是机器码，页面写中文；不认识的原样写。证据里的奖励类型键换成中文名。 */
const ANOMALY_TYPES: Record<string, string> = { amount: "金额偏离", frequency: "出现太频繁", "layer-ratio": "层比例偏离" };
const kindCodes = new RegExp(`\\b(${Object.keys(KIND_LABELS).join("|")})\\b`, "g");
const evidenceText = (text: string) => text.replace(kindCodes, (key) => KIND_LABELS[key]);

type Suspension = F5CommissionAuditOverview["activeSuspensions"][number];

export function F5PendingList({ rows, count, statusFiltered }: { rows: readonly F5PendingCalculation[]; count: number; statusFiltered: boolean }) {
  return (
    <Panel flush icon={Clock3} tone="role-3" title="等价格的奖励" sub={statusFiltered ? "选了状态时不显示" : `${count} 组 · 最多 100 组 · 时间为${zoneNote()}`}
      explain={<>
        <p>好友购买和好友设备收益两类，要等 UVT 价格可用才能算出金额。算出来以前没有到账，也不能在这里处置；算出来的记录出现在「奖励流水」，也可能被拒或直接冻结。</p>
        <p>跟着「奖励流水」里的类型、用户编号、注册月份筛选；不看币种；选了状态时不显示这一项。</p>
      </>}>
      <Table label="等价格的奖励" className="f5-table f5-pending-table">
        <thead><tr>
          <Th>结算号</Th><Th>奖励类型</Th><Th>来源</Th><Th align="right">计价基数</Th><Th>奖励</Th><Th>发生 / 冷却到期</Th>
        </tr></thead>
        <tbody>
          {statusFiltered ? <TableMessage columns={6} role="status">选了状态时不显示等价格的奖励，把状态改回「全部状态」再查。</TableMessage>
            : rows.length === 0 ? <TableMessage columns={6} role="status">没有等价格的奖励</TableMessage>
              : rows.map((row) => (
                <Tr key={row.settlementNo}>
                  <Td><Cell mono full main={row.settlementNo} /></Td>
                  <Td><Cell main={KIND_LABELS[row.kind] ?? "未知奖励类型"} sub={row.kind === "direct_device_earning" ? deviceEarningSource(row.layer) : "直接邀请的好友"} /></Td>
                  <Td><Cell main={<span data-mono>{row.sourceRef}</span>} sub={operatorNicknameText(row.sourceUserName)} title={row.sourceRef} /></Td>
                  <Td align="right"><Cell num main={<Money value={row.basisUsdt} currency="USDT" />} /></Td>
                  <Td><Cell main={<StatusTag tone="neutral" icon={Clock3}>等价格</StatusTag>} sub="USDT、UVT 都还没算" /></Td>
                  <Td><Cell num main={timeText(row.ts)} sub={row.unlockAt ? `到期 ${timeText(row.unlockAt)}` : "没有到期时间"} /></Td>
                </Tr>
              ))}
        </tbody>
      </Table>
    </Panel>
  );
}

/** 层比例没法比较的原因：后端原因码换成运营可核对的说明。 */
const LAYER_UNAVAILABLE: Record<F5LayerRatioComparison["reason"] & string, string> = {
  F5_LAYER_RATIO_THEORY_UNAVAILABLE: "没有可比的设置比例",
  F5_LAYER_RATIO_LAYER_UNAVAILABLE: "有奖励缺层级，或那一层没设比例",
  F5_LAYER_RATIO_SAMPLE_UNAVAILABLE: "样本金额合计为 0，算不出占比",
  F5_LAYER_RATIO_SNAPSHOT_UNAVAILABLE: "样本缺少可匹配的订单结算快照",
};
const layerBasis = (item: Extract<F5LayerRatioComparison, { available: true }>) =>
  item.basis === "ORDER_SETTLEMENT_SNAPSHOT" ? "订单结算快照" : "当前七层 USDT 比例";
const over = (deviation: string, ratio: string) => Number(deviation) > Number(ratio);

/** 层比例核对：默认一行结论，点开看各层。没法比较、没读到比较结果都不当作正常。 */
function F5LayerCheck({ comparisons, ratio }: { comparisons: readonly F5LayerRatioComparison[] | undefined; ratio: string }) {
  const overCount = (item: F5LayerRatioComparison) => item.available ? item.layers.filter((layer) => over(layer.deviation, ratio)).length : 0;
  const deviating = (comparisons ?? []).some((item) => overCount(item) > 0);
  const summary = comparisons === undefined ? "没有读到比较结果"
    : comparisons.length === 0 ? "最近 200 条没有团队购买奖励，没比较"
      : comparisons.map((item) => !item.available ? `${item.currency} 没法比较`
        : overCount(item) ? `${item.currency} 有 ${overCount(item)} 层超过 ${ratio}%` : `${item.currency} 各层都在 ${ratio}% 以内`).join(" · ");
  return (
    <div className="f5-layer-check">
      <Fold inset title="层比例核对" summary={summary} alert={deviating}
        explain={<>
          <p>团队购买奖励各层的实际金额占比按币种比较。按订单结算快照比较时，缺少快照就无法比较。旧口径只按当前七层 USDT 比例比较。</p>
          <p>没法比较、没读到结果，都不等于层比例正常。</p>
        </>}>
        {comparisons === undefined ? <p className="f5-layer-note">系统这次没有给出层比例的比较结果。</p>
          : comparisons.length === 0 ? <p className="f5-layer-note">最近 200 条奖励里没有团队购买奖励，没有可比的。</p>
            : comparisons.map((item) => item.available ? (
              <Table key={item.currency} label={`${item.currency} 各层占比`} className="f5-table f5-layer-table">
                <thead><tr><Th>{item.currency}</Th><Th align="right">实际占比</Th><Th align="right">{layerBasis(item)}占比</Th><Th align="right">相差</Th><Th>结论</Th></tr></thead>
                <tbody>
                  {item.layers.map((layer) => (
                    <Tr key={layer.layer}>
                      <Td><Cell main={`L${layer.layer}`} /></Td>
                      <Td align="right"><Cell num main={`${percentText(layer.actualPct)}%`} /></Td>
                      <Td align="right"><Cell num main={`${percentText(layer.theoreticalPct)}%`} /></Td>
                      <Td align="right"><Cell num main={`${percentText(layer.deviation)}%`} /></Td>
                      <Td>{over(layer.deviation, ratio) ? <StatusTag tone="warn">超过 {ratio}%</StatusTag> : <StatusTag tone="ok">在 {ratio}% 以内</StatusTag>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p key={item.currency} className="f5-layer-row"><StatusTag tone="neutral">{item.currency} 没法比较</StatusTag><span>{LAYER_UNAVAILABLE[item.reason]}</span></p>
            ))}
      </Fold>
    </div>
  );
}

export function F5AnomalyList({ rows, comparisons, sigma, ratio, canWrite, onAdjust }: { rows: readonly F5Anomaly[]; comparisons: readonly F5LayerRatioComparison[] | undefined; sigma: string | undefined; ratio: string | undefined; canWrite: boolean; onAdjust: () => void }) {
  // 旧后端两样都没有：不加币种列，保持原来的表。
  const showCurrency = comparisons !== undefined || rows.some((item) => item.currency);
  const columns = showCurrency ? 6 : 5;
  const ratioText = ratio ?? "20";
  const notCompared = comparisons === undefined ? "层比例没有读到比较结果"
    : comparisons.length === 0 ? "最近 200 条没有团队购买奖励，层比例没比较"
      : comparisons.some((item) => !item.available) ? `${comparisons.filter((item) => !item.available).map((item) => item.currency).join("、")} 层比例没法比较` : "";
  return (
    <Panel flush icon={ShieldAlert} tone="role-4" title="异常样本" sub={`${rows.length} 条 · 金额偏离超过 ${sigma ?? "3"} 倍标准差 · 层比例偏离超过 ${ratioText}%`}
      explain={<>
        <p>从全部奖励里最近的 200 条挑出来，不跟筛选变。三种：同一类奖励里金额偏离平均太多的；同一用户在这 200 条里出现 10 次以上的；团队购买奖励某一层的金额占比，和「层比例核对」所列依据差太多的。</p>
        <p>金额偏离按奖励类型和币种分开算，两种币不放在一起比；出现太频繁按笔数算，不分币种。</p>
        <p>关联风险群只是文字说明，没有可以点进去的风险群编号。</p>
      </>}
      actions={canWrite ? <Button size="sm" icon={<SlidersHorizontal size={14} aria-hidden />} onClick={onAdjust}>调整标准</Button> : undefined}>
      <F5LayerCheck comparisons={comparisons} ratio={ratioText} />
      <Table label="异常样本" className="f5-table f5-anomaly-table">
        <thead><tr><Th>类型</Th>{showCurrency && <Th>币种</Th>}<Th>奖励</Th><Th>用户</Th><Th>依据</Th><Th>关联风险群</Th></tr></thead>
        <tbody>
          {rows.length === 0 ? <TableMessage columns={columns} role="status">{notCompared ? `没有挑出异常；${notCompared}，见上方` : "暂无异常"}</TableMessage>
            : rows.map((item) => {
              const comparison = item.type === "layer-ratio" ? comparisons?.find((entry) => entry.currency === item.currency) : undefined;
              const evidence = item.evidence ? evidenceText(item.evidence) : undefined;
              const evidenceWithBasis = evidence && comparison?.available ? `${evidence} · ${layerBasis(comparison)}` : evidence;
              return <Tr key={`${item.currency ?? ""}:${item.id}`}>
                <Td><Cell main={ANOMALY_TYPES[item.type] ?? item.type} /></Td>
                {showCurrency && <Td><Cell main={item.currency ?? (item.type === "frequency" ? <span className="f5-weak">不分币种</span> : "—")} /></Td>}
                <Td><Cell mono main={item.commissionId || "—"} /></Td>
                <Td><Cell mono main={item.userId ? userCode(item.userId) : "—"} /></Td>
                <Td grow><Cell main={evidenceWithBasis ?? "—"} title={evidenceWithBasis} /></Td>
                <Td><Cell main={item.relatedKCluster || "—"} title={item.relatedKCluster || undefined} /></Td>
              </Tr>;
            })}
        </tbody>
      </Table>
    </Panel>
  );
}

export function F5SuspensionList({ rows, canSuspend, onResume }: { rows: readonly Suspension[]; canSuspend: boolean; onResume: (item: Suspension) => void }) {
  return (
    <Panel flush icon={PauseCircle} tone="role-3" title="暂停名单" sub={`${rows.length} 条 · 最多 100 条 · 时间为${zoneNote()}`}
      explain={<>
        <p>暂停中的用户和奖励类型，一行一类，算全部用户，不跟筛选变。恢复也要提交审批。</p>
        <p>暂停批准后，这位用户这类奖励里未发完的记录被冻结（等价格、待追回的不动）；好友两类以后算出金额的也先冻结；其他类型以后不一定停发。</p>
        <p>恢复后，没有其他冻结条件的好友奖励回到冷却中；其他类型已冻结的记录不会自动解冻，要逐笔解冻；以前暂停时清掉了到期时间的旧记录不能解冻。</p>
      </>}>
      <Table label="暂停名单" className="f5-table f5-suspension-table">
        <thead><tr><Th>用户</Th><Th>暂停的奖励</Th><Th>原因</Th><Th>操作人</Th><Th>暂停时间</Th>{canSuspend && <Th sticky="end">操作</Th>}</tr></thead>
        <tbody>
          {rows.length === 0 ? <TableMessage columns={canSuspend ? 6 : 5} role="status">没有暂停中的奖励</TableMessage>
            : rows.map((item) => (
              <Tr key={`${item.userId}:${item.kind}`}>
                <Td><Cell mono main={userCode(item.userId)} /></Td>
                <Td><Cell main={KIND_LABELS[item.kind] ?? "未知奖励类型"} /></Td>
                <Td grow><Cell main={item.reason || "—"} title={item.reason || undefined} /></Td>
                <Td><Cell main={item.operator ? maskAuditActor(item.operator) : "—"} /></Td>
                <Td><Cell num main={timeText(item.updatedAt)} /></Td>
                {canSuspend && <Td sticky="end" data-fit=""><Button size="sm" onClick={() => onResume(item)}>恢复</Button></Td>}
              </Tr>
            ))}
        </tbody>
      </Table>
    </Panel>
  );
}

export function F5HistoryList({ rows }: { rows: readonly F5OperationHistory[] }) {
  return (
    <Panel flush icon={History} tone="role-other" title="处置历史" sub={`最近 ${rows.length} 条 · 最多 50 条 · 时间为${zoneNote()}`}
      explain="全部用户最近的处置记录，不跟筛选变：冲正、补发、暂停、恢复、调整异常标准，以及系统的到期自动解锁。谁批准的在「操作记录与审批」查。">
      <Table label="处置历史" className="f5-table f5-history-table">
        <thead><tr><Th>时间</Th><Th>动作</Th><Th>对象</Th><Th>凭证单号</Th><Th>原因</Th></tr></thead>
        <tbody>
          {rows.length === 0 ? <TableMessage columns={5} role="status">还没有处置记录</TableMessage>
            : rows.map((item) => {
              const records = item.sourceCommissionId || item.resultCommissionId
                ? `${item.sourceCommissionId || "—"} → ${item.resultCommissionId || "—"}` : undefined;
              const who = [item.userId ? userCode(item.userId) : "", item.kinds ? kindNames(item.kinds) : ""].filter(Boolean).join(" · ");
              return (
                <Tr key={item.operationNo}>
                  <Td><Cell num main={timeText(item.createdAt)} /></Td>
                  <Td><Cell main={operationLabel(item.operationType)} sub={<span data-mono>{item.operationNo}</span>} /></Td>
                  <Td><Cell main={records ? <span data-mono>{records}</span> : who || "—"} sub={records ? who || undefined : undefined} /></Td>
                  <Td><Cell mono main={item.evidenceRef || "—"} title={item.evidenceRef || undefined} /></Td>
                  <Td grow><Cell main={item.reason || "—"} sub={item.operator ? maskAuditActor(item.operator) : undefined} title={item.reason || undefined} /></Td>
                </Tr>
              );
            })}
        </tbody>
      </Table>
    </Panel>
  );
}
