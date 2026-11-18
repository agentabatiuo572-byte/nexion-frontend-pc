"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useState } from 'react';
import { promotionRead } from '@/lib/admin/promotion-client';
import type { Catalog, Promotion, RewardAdmin, RewardAdminPage, ResolveInput } from '@/lib/admin/promotion-types';
import { ConfirmCommand, DeviceRightsSummary, Dialog, Empty, Field, Loading, Notice, ReadError, Stats, Summary, Table, Tag, text, formatTime, labelState, rewardText, useRead } from './h4-promotion-ui';
import { Gift } from 'lucide-react';
import type { ReactNode } from 'react';
import { Amount } from './h4-promotion-board';
import { Button as RdButton, Cell, FilterBar, FilterField, Fold, Input, IrreversibleTag, Panel, Select, StatusTag, Steps, Table as RdTable, Td, Th, Tr } from '@/app/components/rd';
const REWARD_STATES = ['PENDING', 'READY', 'PROCESSING', 'ISSUED', 'RETRYABLE_FAILED', 'OUTCOME_UNKNOWN', 'REVERSAL_PENDING', 'REVERSED', 'CANCELLED', 'MANUAL_REVIEW'];
export default function PromotionRewards({ activity, can, onBack, onRefresh }: {
    activity: Promotion;
    catalog: Catalog;
    can: (v: string) => boolean;
    onBack: () => void;
    onRefresh: () => Promise<void>;
}) {
    const [filter, setFilter] = useState({ orderNo: '', type: '', state: '', beneficiaryId: '' }), [query, setQuery] = useState<Record<string, string | number>>({ activityId: activity.activityId, limit: 20 }), [previous, setPrevious] = useState<Array<Record<string, string | number>>>([]), [selected, setSelected] = useState<string | null>(null);
    const list = useRead(() => promotionRead<RewardAdminPage>('/promotion-rewards', query), [JSON.stringify(query)]), impact = activity.impact;
    const [refreshError, setRefreshError] = useState<unknown>(null);
    const refreshRewards = async () => { setRefreshError(null); list.reload(); await onRefresh(); };
    const queryRewards = (next: Record<string, string | number>) => {
        setPrevious([]); setQuery(next); void refreshRewards().catch(setRefreshError);
    };
    const closeDetail = () => { setSelected(null); void refreshRewards().catch(setRefreshError); };

    const rows = list.data ? [...list.data.items].sort((x, y) => PRIORITY(x.state) - PRIORITY(y.state)) : [];
    return <><Stats items={[['活动已确认发放', impact.issued, '资金或设备发放凭证'], ['活动待发 / 处理中', impact.pendingRewards, '等待原奖励处理'], ['活动需恢复或核账', impact.failedRewards + impact.unknownRewards, '失败与结果未知'], ['活动冲正 / 人工审阅', impact.reversingRewards + impact.manualReviewRewards, '保留原承诺与证据']]}/>
    <Panel title="奖励明细" icon={Gift} tone="role-2" sub={`${activity.name || activity.activityId}${list.data ? ` · 共 ${list.data.total} 项` : ''}`} explain="每一行是一笔奖励义务：从下单预留、付款后待发、发放到到账；失败、结果未知、追回和人工审阅排在这一页最前（只排这一页，不跨页）。取消、冲正需要关联且已确认的退款或批准依据，活动结束本身不构成依据。" actions={<RdButton size="sm" variant="ghost" onClick={onBack}>返回活动</RdButton>}>
    <FilterBar onSubmit={() => queryRewards({ activityId: activity.activityId, limit: 20, ...filter })} querying={list.loading}>
        <FilterField grow><Input aria-label="订单" placeholder="订单号" value={filter.orderNo} onChange={e => setFilter({ ...filter, orderNo: e.target.value })}/></FilterField>
        <FilterField><Select aria-label="资产类型" value={filter.type} onChange={v => setFilter({ ...filter, type: v })} options={[{ value: '', label: '全部类型' }, { value: 'DEVICE', label: '设备赠礼' }, { value: 'USDT', label: 'USDT' }, { value: 'UVT', label: 'UVT' }]}/></FilterField>
        <FilterField><Input aria-label="受益账户" placeholder="受益账户" type="number" min={1} value={filter.beneficiaryId} onChange={e => setFilter({ ...filter, beneficiaryId: e.target.value })}/></FilterField>
        <FilterField><Select aria-label="发放状态" value={filter.state} onChange={v => setFilter({ ...filter, state: v })} options={[{ value: '', label: '全部状态' }, ...REWARD_STATES.map(v => ({ value: v, label: labelState(v) }))]}/></FilterField>
    </FilterBar>
    {!!refreshError && <ReadError target="活动奖励统计" error={refreshError} retry={() => { void refreshRewards().catch(setRefreshError); }}/>} {!!list.error && <ReadError target="奖励台账" error={list.error} retry={() => { void refreshRewards().catch(setRefreshError); }}/>} {!!list.error && list.data && <Notice title="保留上次读取结果" kind="warn">刷新未成功，以下奖励内容不是最新确认状态。</Notice>} {list.loading && (list.data ? <Notice title="正在刷新奖励台账">当前保留上次读取内容，请等待最新结果。</Notice> : <Loading />)}
    {list.data && (!list.data.items.length ? <Empty title="没有符合条件的奖励">保留当前筛选，可调整条件后重新查询。</Empty> : <div className="h4-table"><RdTable label="奖励明细"><thead><tr><Th scope="col">订单 / 奖励项</Th><Th scope="col">受益人</Th><Th scope="col">原承诺</Th><Th scope="col">状态</Th><Th scope="col">发放凭证</Th><Th scope="col">操作</Th></tr></thead><tbody>{rows.map(r => <Tr key={r.obligationId} mark={['RETRYABLE_FAILED'].includes(r.state) ? 'danger' : undefined}><Td><Cell mono main={r.orderNo} sub={`购买行 ${r.orderLineId} · 第 ${r.unitSeq + 1} 组`}/></Td><Td><Cell main={labelState(r.beneficiaryRole)} sub={r.beneficiaryId}/></Td><Td>{rewardText(r.reward, r.disclosure.deviceName)}</Td><Td><Cell main={<Tag value={r.state}/>} sub={r.refundHold ? '售后挂起' : undefined}/></Td><Td>{r.assetReceipt ? <Cell main={r.assetReceipt.earningsEntryNo || r.assetReceipt.instanceNos.join('、') || r.assetReceipt.ledgerBizNo || '已有凭证'} sub={formatTime(r.assetReceipt.issuedAt)}/> : <span className="h4-dim">暂无发放凭证</span>}</Td><Td data-fit=""><span className="h4-row"><RdButton size="sm" onClick={() => setSelected(r.obligationId)}>查看与处置</RdButton><RdButton size="sm" variant="ghost" onClick={() => { setFilter({ ...filter, orderNo: r.orderNo }); queryRewards({ orderNo: r.orderNo, limit: 20 }); }}>整单奖励</RdButton></span></Td></Tr>)}</tbody></RdTable></div>)}
    {list.data && !list.loading && <div className="h4-pager"><span>共 <span className="h4-num">{list.data.total}</span> 项 · 读取时刻 <span className="h4-num">{formatTime(list.data.asOf)}</span>（日本时间）</span><span className="h4-row"><RdButton disabled={list.loading || !!list.error || !previous.length} onClick={() => { setQuery(previous.at(-1)!); setPrevious(previous.slice(0, -1)); }}>上一页</RdButton><RdButton disabled={list.loading || !!list.error || !list.data.hasMore} onClick={() => { setPrevious([...previous, query]); setQuery({ ...query, cursor: list.data!.nextCursor! }); }}>下一页</RdButton></span></div>}</Panel>
    {selected && <RewardDetail id={selected} can={can} onClose={closeDetail} onChanged={refreshRewards}/>}</>;
}
const PROBLEM = ['RETRYABLE_FAILED', 'OUTCOME_UNKNOWN', 'MANUAL_REVIEW', 'REVERSAL_PENDING'];
const PRIORITY = (state: string) => PROBLEM.includes(state) ? PROBLEM.indexOf(state) : PROBLEM.length;
/** 一笔奖励走到哪：预留 → 待发 → 发放 → 到账，或者停在失败、结果未知、人工审阅，或者取消、追回。 */
function rewardSteps(r: RewardAdmin) {
    const s = r.state, receipt = r.assetReceipt?.issuedAt ? formatTime(r.assetReceipt.issuedAt) : undefined;
    const issued = ['ISSUED', 'REVERSAL_PENDING', 'REVERSED'].includes(s);
    const steps: Array<{ label: string; sub?: string; state: 'done' | 'current' | 'todo' }> = [
        { label: '下单预留', state: 'done' },
        { label: '付款后待发', sub: s === 'PENDING' ? '等待成熟' : s === 'READY' ? '待执行' : undefined, state: ['PENDING', 'READY'].includes(s) ? 'current' : 'done' },
        { label: s === 'RETRYABLE_FAILED' ? '发放失败' : s === 'OUTCOME_UNKNOWN' ? '发放结果未知' : s === 'MANUAL_REVIEW' ? '人工审阅' : s === 'CANCELLED' ? '已取消' : '发放', sub: s === 'PROCESSING' ? '处理中' : s === 'RETRYABLE_FAILED' ? '可重试' : s === 'OUTCOME_UNKNOWN' ? '先核查原结果' : undefined, state: ['PROCESSING', 'RETRYABLE_FAILED', 'OUTCOME_UNKNOWN', 'MANUAL_REVIEW', 'CANCELLED', 'CANCELED'].includes(s) ? 'current' : issued ? 'done' : 'todo' },
        { label: '到账', sub: receipt, state: s === 'ISSUED' ? 'current' : issued ? 'done' : 'todo' },
    ];
    if (s === 'REVERSAL_PENDING' || s === 'REVERSED') steps.push({ label: s === 'REVERSED' ? '已冲正' : '追回待处理', state: 'current' });
    return steps;
}
function RewardDetail({ id, can, onClose, onChanged }: {
    id: string;
    can: (v: string) => boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
}) {
    const row = useRead(() => promotionRead<RewardAdmin>(`/promotion-rewards/${encodeURIComponent(id)}`), [id]), [action, setAction] = useState<string | null>(null), [decision, setDecision] = useState<ResolveInput['decision']>('KEEP_MANUAL_REVIEW'), [basisChoice, setBasisChoice] = useState('0');
    const r = row.data, labels: Record<string, string> = { retry: '重试原奖励项', reconcile: '核查原结果', cancel: '取消原奖励项', reverse: '发起冲正', resolve: '异常审阅' };
    const options = r?.dispositionOptions.filter(o => o.action === action?.toUpperCase()) || [];
    if (action && r)
        return <ConfirmCommand writeAllowed={can('growth_promotion_reward_'+action) && !row.loading && !row.error} title={labels[action]} confirmLabel={labels[action]} danger={['cancel', 'reverse'].includes(action)} sub={['cancel', 'reverse'].includes(action) ? <IrreversibleTag/> : <StatusTag tone="progress" filled>立即生效</StatusTag>} intent={{ operation: `${action}Reward`, targetId: r.obligationId, path: `/promotion-rewards/${encodeURIComponent(r.obligationId)}/${action}`, method: 'POST' }} body={{ expectedRevision: r.revision, evidenceRefs: [], ...(action === 'resolve' ? { decision } : ['cancel', 'reverse'].includes(action) ? { basis: options[Number(basisChoice)]?.basis } : {}) }} requireEvidence={['cancel', 'reverse', 'resolve'].includes(action)} onClose={() => setAction(null)} onSuccess={async (_result, isCurrent) => { await Promise.all([promotionRead<RewardAdmin>(`/promotion-rewards/${encodeURIComponent(r.obligationId)}`), onChanged()]); if (isCurrent()) setAction(null); row.reload(); }}><Summary rows={[['原订单', r.orderNo], ['受益人', `${labelState(r.beneficiaryRole)} · ${r.beneficiaryId}`], ['原奖励', rewardText(r.reward, r.disclosure.deviceName)], ['当前状态', labelState(r.state)], ['用户会怎样', action === 'reverse' ? REVERSE_EFFECT[`${options[Number(basisChoice)]?.basis.type === 'APPROVED_CORRECTION' ? 'correction' : 'refund'}-${r.reward.type === 'DEVICE' ? 'device' : 'wallet'}`] : EFFECT[action]], ['要不要证据', ['cancel', 'reverse', 'resolve'].includes(action) ? '要：选依据并上传至少一张证据图片' : '不用']]}/><Notice title="只处理原奖励义务">不改变受益人、金额、币种或奖励身份；失败后保留原输入，未知结果先回查。</Notice>{['cancel', 'reverse'].includes(action) && <Field label="已确认的处置依据"><select value={basisChoice} onChange={e => setBasisChoice(e.target.value)}>{options.map((o, i) => <option key={i} value={i}>{o.label.zh}</option>)}</select></Field>}{action === 'resolve' && <Field label="依据证据选择后续处理"><select value={decision} onChange={e => setDecision(e.target.value as ResolveInput['decision'])}><option value="KEEP_MANUAL_REVIEW">证据不足，继续人工审阅</option><option value="CONFIRM_ISSUED">已有发放凭证，核验已发放</option><option value="CONFIRM_NOT_ISSUED">证据确认未发，恢复原奖励</option><option value="CONFIRM_REVERSED">已有追回凭证，核验冲正</option></select></Field>}</ConfirmCommand>;
    const losses = r ? Object.entries(r.platformLoss) : [];
    // 已追回、未追回按原奖励的资产写单位：设备按台。
    const rewardUnit = r ? r.reward.type === 'DEVICE' ? '台' : r.reward.type === 'DISCOUNT_USDT' ? 'USDT' : nexGridBrandText(r.reward.type) : undefined;
    return <Dialog drawer title="原奖励承诺与发放凭证" sub={r ? <Tag value={r.state}/> : undefined} onClose={onClose} footer={r ? <div className="h4-row">
        {can('growth_promotion_reward_retry') && <RdButton disabledReason={r.state !== 'RETRYABLE_FAILED' ? '只有可重试失败的奖励能重试' : r.refundHold ? '售后挂起中，不能再次发放' : row.loading || !!row.error ? '奖励详情还没读到' : undefined} onClick={() => setAction('retry')}>重试原奖励项</RdButton>}
        {can('growth_promotion_reward_reconcile') && <RdButton disabledReason={!['PENDING','READY','PROCESSING','RETRYABLE_FAILED','OUTCOME_UNKNOWN','ISSUED'].includes(r.state) ? '这个状态不需要核查' : row.loading || !!row.error ? '奖励详情还没读到' : undefined} onClick={() => setAction('reconcile')}>核查原结果</RdButton>}
        {can('growth_promotion_reward_resolve') && <RdButton disabledReason={r.state !== 'MANUAL_REVIEW' ? '只有人工审阅中的奖励能审阅' : row.loading || !!row.error ? '奖励详情还没读到' : undefined} onClick={() => setAction('resolve')}>异常审阅</RdButton>}
        {can('growth_promotion_reward_cancel') && <RdButton variant="danger-outline" disabledReason={!r.dispositionOptions.some(o => o.action === 'CANCEL') ? '没有可用的取消依据（已确认退款或已批准纠正）' : row.loading || !!row.error ? '奖励详情还没读到' : undefined} onClick={() => { setBasisChoice('0'); setAction('cancel'); }}>取消原奖励项</RdButton>}
        {can('growth_promotion_reward_reverse') && <RdButton variant="danger-outline" disabledReason={!r.dispositionOptions.some(o => o.action === 'REVERSE') ? '没有可用的冲正依据（已确认退款或已批准纠正）' : row.loading || !!row.error ? '奖励详情还没读到' : undefined} onClick={() => { setBasisChoice('0'); setAction('reverse'); }}>发起冲正</RdButton>}
        <RdButton variant="ghost" onClick={onClose}>返回</RdButton>
    </div> : undefined}>{row.loading && <Loading />}{!!row.error && <ReadError target="原奖励承诺与发放凭证" error={row.error} retry={row.reload}/>} {r && <>
        <Steps label="这笔奖励走到哪" items={rewardSteps(r)}/>
        {r.state === 'REVERSED' ? <Notice title="已冲正结案">{losses.length ? '奖励已冲正，不能再发放；未追回的部分由平台承担，见下方损失。' : '奖励已冲正，不能再发放。'}</Notice> : r.refundHold && <Notice title="售后处理中" kind="warn">原奖励已挂起，不能再次发放。</Notice>}
        <Summary rows={[['原订单', r.orderNo], ['原活动版本', `v${r.version}`], ['受益人', `${labelState(r.beneficiaryRole)} · ${r.beneficiaryId}`], ['原承诺', rewardText(r.reward, r.disclosure.deviceName)], ['当前状态', <Tag value={r.state}/>], ['资金凭证', r.assetReceipt?.ledgerBizNo || '暂无'], ['原收益条目', r.assetReceipt?.earningsEntryNo || '暂无'], ['发放设备', r.assetReceipt?.instanceNos.join('、') || '暂无'], ['已追回', r.recoveredAmount == null ? '—' : <Amount value={r.recoveredAmount} unit={rewardUnit}/>], [r.state === 'REVERSED' ? '未追回奖励' : '未结追回', r.recoveryOutstanding == null ? '—' : <Amount value={r.recoveryOutstanding} unit={rewardUnit}/>], ...losses.map(([asset, amount]) => [`未追回损失（${asset === 'DEVICE' ? '设备' : nexGridBrandText(asset)}）`, <Amount value={amount} unit={asset === 'DEVICE' ? '台' : nexGridBrandText(asset)}/>] as [string, ReactNode])]}/>
        <Fold title="原权益与售后说明" summary={text(r.disclosure.title)}><dl className="h4-prose">{([['公开标题', text(r.disclosure.title)], ['活动规则', text(r.disclosure.terms)], ['资产或设备权益', text(r.disclosure.benefitDescription)], ['售后处理', text(r.disclosure.refundTerms)]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{r.disclosure.deviceRights && <DeviceRightsSummary rights={r.disclosure.deviceRights}/>}</Fold>
        <Fold title="处理记录" summary={`${r.attempts.length} 次`}>{r.attempts.length ? <ul className="h4-attempts" aria-label="处理记录">{r.attempts.map(a => <li key={a.attemptId}><Tag value={a.state}/><span className="h4-num">{formatTime(a.startedAt)} → {a.finishedAt ? formatTime(a.finishedAt) : '未结束'}</span><span className="h4-attempt-id">原操作编号 <span className="h4-mono" title={a.commandId}>{a.commandId}</span></span></li>)}</ul> : <span className="h4-dim">还没有处理记录</span>}</Fold>
        <p className="h4-lede">取消与冲正仅可选择关联的已确认退款或当前批准依据；没有候选依据时不可提交，执行前须再次核验。追回金额未确认时须先核账。</p>
    </>}</Dialog>;
}
const EFFECT: Record<string, string> = {
    retry: '按原奖励身份再发一次，不新建奖励、不换人、不改金额和币种；成功后用户收到这笔原奖励',
    reconcile: '只核对资产凭证：凭证和原发放一致记为已发放，没有凭证回到待执行，不一致转人工审阅；不会直接给用户发钱',
    cancel: '这笔奖励作废，用户不会收到；释放它占用的预算、库存和参与次数',
    resolve: '按所选结论和证据核验：证据不足继续人工审阅；确认已发、确认未发和确认已冲正都要和系统记录对得上才生效',
};
// 冲正的后果按所选依据和奖励类型分开：整单退款追不回由平台承担并结案；批准的纠正收不回的转人工审阅。
const REVERSE_EFFECT: Record<string, string> = {
    'refund-wallet': '从同币种可用余额追回，不扣成负数；追不回的由平台承担并结案',
    'refund-device': '收回赠机，停止没做完的任务；已到账收益保留，记为平台损失并结案',
    'correction-wallet': '只追回能确认还没花掉的部分；追不回的转人工审阅',
    'correction-device': '只收回没跑过任务、没有收益的赠机；收不回的转人工审阅',
};
