"use client";
import { getRequiredContentLanguages, OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileClock, GitCompare, History, ListChecks, Radio, Send, Settings2, ShieldCheck, Wallet } from 'lucide-react';
import { BlockState, Button as RdButton, IrreversibleTag, Panel, StatusTag, Steps, Table as RdTable, Td, Th, Timeline, Tr } from '@/app/components/rd';
import { BudgetBar, TimeWindow, VersionLine } from './h4-promotion-board';
import { H4SampleAccountSelect } from './h4-sample-account-select';
import { PROMOTION_RECEIPT_ADVANCED, PromotionApiError, acknowledgePromotionCommand, promotionCommand, promotionRead, promotionVersions, verifyPromotionLocalizedReceipt } from '@/lib/admin/promotion-client';
import { PromotionRecheck } from './h4-promotion-conflict';
import { promotionDraftChanges } from '@/lib/admin/promotion-conflict';
import type { AdminSimulation, Catalog, CommandReceipt, Item, Promotion, Version, VersionPage } from '@/lib/admin/promotion-types';
import { limitText, PROMOTION_LANGUAGE_LABELS, promotionPublicMissing, promotionPublicText } from '@/lib/admin/promotion-form';
import { businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from '@/lib/admin/business-time';
import { PromotionBannerPreview } from './h4-promotion-banner';
import { Button, Card, ConfirmCommand, Dialog, Field, Loading, Notice, ReadError, Stats, Summary, Table, Tag, amountText, formatTime, labelState, rewardText, promotionAssetText, text, zoneLabel } from './h4-promotion-ui';

/** 分钟显示，悬停看到秒（核对审批先后用）。 */
const Stamp = ({ at }: { at: string }) => <time dateTime={at} title={`${formatBusinessTimeFull(at)}（${businessZone().label}）`}>{formatBusinessTimeCompact(at)}</time>;
const ACTIONS: Record<string, {
    label: string;
    operation: string;
    authority: string;
    version: boolean;
    copy: string;
}> = {
    submit: { label: '提交审核', operation: 'submitPromotion', authority: 'submit', version: true, copy: '提交当前候选版本供审核。当前已发布版本继续运行。' },
    withdraw: { label: '撤回审核', operation: 'withdrawPromotion', authority: 'submit', version: true, copy: '撤回后恢复草稿并清除原批准；已发布版本和原订单保持原约定。' },
    approve: { label: '审核确认', operation: 'approvePromotion', authority: 'approve', version: true, copy: '审核只批准当前候选版本，不发布、不替换正在运行的版本。' },
    reject: { label: '驳回候选版本', operation: 'rejectPromotion', authority: 'approve', version: true, copy: '将候选退回草稿，保留驳回意见和完整审核记录。' },
    publish: { label: '发布确认', operation: 'publishPromotion', authority: 'publish', version: true, copy: '发布后新报价与预留使用该版本；旧订单保留原版本与付款截止。' },
    pause: { label: '暂停新预留', operation: 'pausePromotion', authority: 'pause', version: false, copy: '停止新的投放与预留。待支付订单和已成立奖励继续履行。' },
    resume: { label: '恢复新预留', operation: 'resumePromotion', authority: 'pause', version: false, copy: '重新核对原时窗、预算、目录与权限。不会延长活动或重置累计上限。' },
    end: { label: '终止活动', operation: 'endPromotion', authority: 'end', version: false, copy: '终止后不能直接恢复。已锁订单和已成立奖励继续按原承诺处理。' },
    archive: { label: '归档活动', operation: 'archivePromotion', authority: 'archive', version: false, copy: '须先确认没有在途预留和未完成奖励。归档保留完整历史。' },
    'draft-versions': { label: '创建改版草稿', operation: 'createDraftVersion', authority: 'edit', version: false, copy: '复制当前配置建立候选草稿；旧版本继续运行，历史参与上限不重置。' },
    copies: { label: '复制为新活动', operation: 'copyPromotion', authority: 'edit', version: false, copy: '只复制配置。新活动具有独立身份，不复制审批、使用量或历史订单。' },
};
export default function PromotionReview({ activity: requestedActivity, catalog, can, onRefresh, onReload, onCandidateConflict, onCopyCreated, onEdit, onRewards, onMetrics, onBack, review = false, detailActions, zoneSwitch, displayZone }: {
    activity: Promotion;
    catalog: Catalog;
    can: (v: string) => boolean;
    onRefresh: () => Promise<void>;
    onReload: (latest: Promotion) => void;
    onCandidateConflict: () => void;
    onCopyCreated: (receipt: CommandReceipt, isCurrent?: () => boolean) => Promise<void>;
    onEdit: () => void;
    onRewards: () => void;
    onMetrics: () => void;
    onBack: () => void;
    review?: boolean;
    /** 详情页身份行右侧的入口（试算与审核、奖励台账、删除活动），由父组件给。 */
    detailActions?: ReactNode;
    /** 时间按哪个时区看的切换和选中的时区，只改显示。 */
    zoneSwitch?: ReactNode;
    displayZone?: string;
}) {
    const [activity, setActivity] = useState(requestedActivity);
    const [requiredLanguages, setRequiredLanguages] = useState<readonly OperatingLanguageCode[]>(OPERATING_LANGUAGE_CODES);
    useEffect(() => { if (review) void getRequiredContentLanguages().then(setRequiredLanguages); }, [review]);
    const [history, setHistory] = useState<{data: VersionPage | null; error: unknown; loading: boolean}>({data: null, error: null, loading: true});
    const historyScope = `${activity.activityId}:${activity.revision}:${activity.current?.version}:${activity.current?.revision}`;
    const requestedHistoryScope = useRef('');
    const readVersions = async (target = activity) => {
        const scope = `${target.activityId}:${target.revision}:${target.current?.version}:${target.current?.revision}`;
        requestedHistoryScope.current = scope;
        setHistory(previous => ({...previous, error: null, loading: true}));
        try {
            const data = await promotionVersions(target.activityId);
            if (requestedHistoryScope.current === scope) setHistory({data, error: null, loading: false});
        } catch (error) {
            if (requestedHistoryScope.current === scope) setHistory(previous => ({...previous, error, loading: false}));
            throw error;
        }
    };
    useEffect(() => {
        if (requestedHistoryScope.current !== historyScope) void readVersions().catch(() => undefined);
    }, [historyScope]);
    const versions = {...history, reload: () => { void readVersions().catch(() => undefined); }};
    const [action, setAction] = useState<string | null>(null), [simulationResult, setSimulation] = useState<{ scope: string; result: AdminSimulation } | null>(null), [simOpen, setSimOpen] = useState(false), [reservations, setReservations] = useState(false);
    const [deletedError, setDeletedError] = useState<PromotionApiError | null>(null);
    const [conflict, setConflict] = useState<{ action: string; opened: Promotion; latest: Promotion | null; view: ReactNode; contentChanged: boolean; error: PromotionApiError } | null>(null);
    const recheck = conflict?.action === action && !!conflict?.latest && conflict.contentChanged;
    const deletedReview = deletedError && action ? { reloadNeeded: true, final: true, error: deletedError, view: <PromotionRecheck facts={[]} changes={[]} catalog={catalog} actionLabel={action === 'approve' ? '批准' : CONFIRM_LABELS[action]} confirmLabel={confirmLabel(action, false)} emphasize={false} blocked="这个活动已被删除。"/> } : undefined;
    // A rejection locks every action using the stale page. A reviewed snapshot belongs to its action.
    const blocked = conflict?.latest && action ? recheckBlocked(action, conflict.latest) : undefined;
    const conflictReview = deletedReview || (conflict && (!conflict.latest || conflict.action === action) ? { reloadNeeded: !conflict.latest || !!blocked, final: !!blocked, view: conflict.view, error: conflict.latest ? null : conflict.error } : undefined);
    // Settlement reads may update the page behind a confirmation, never its approved snapshot.
    useEffect(() => {
        if (action) return;
        setActivity(requestedActivity);
        const baseline = conflict?.latest ?? conflict?.opened;
        // Identity and both revision levels matter: approval changes the candidate revision alone.
        if (baseline && (requestedActivity.activityId !== baseline.activityId || requestedActivity.revision !== baseline.revision
            || requestedActivity.current?.version !== baseline.current?.version || requestedActivity.current?.revision !== baseline.current?.revision)) setConflict(null);
    }, [requestedActivity, action]);
    const current = activity.current;
    const active = versions.data?.items.find(v => v.version === activity.activeVersion);
    const candidateHistory = versions.data?.items.filter(v => v.activityId === activity.activityId && v.version === activity.draftVersion)
        .reduce<Version | undefined>((latest, item) => !latest || item.revision > latest.revision ? item : latest, undefined);
    const currentCandidate = current?.activityId === activity.activityId && current.version === activity.draftVersion ? current : undefined;
    const latestCandidate = currentCandidate && (!candidateHistory || currentCandidate.revision >= candidateHistory.revision) ? currentCandidate : candidateHistory;
    const candidate = latestCandidate?.state === 'PUBLISHED' ? undefined : latestCandidate;
    const candidateScope = candidate ? `${candidate.activityId}:${candidate.version}:${candidate.revision}:${candidate.contentHash}` : '';
    const simulation = simulationResult?.scope === candidateScope ? simulationResult.result : undefined;
    const missingPublic = promotionPublicMissing(candidate?.draft, requiredLanguages, true);
    const missingStored = promotionPublicMissing(candidate?.draft, OPERATING_LANGUAGE_CODES);
    const publicLanguageReason = (missing: readonly OperatingLanguageCode[]) =>
        `请补齐${missing.map(locale => PROMOTION_LANGUAGE_LABELS[locale]).join('、')}的展示标题和活动规则。选填语言请整组留空或填齐。`;
    const prepareReview = async (body: Record<string, unknown> & { reason: string }) => {
        if (!candidate) throw new Error('请刷新并核对当前候选草稿。');
        if (action !== 'submit') {
            if (missingStored.length) throw new Error(publicLanguageReason(missingStored));
            return body;
        }
        const required = await getRequiredContentLanguages();
        setRequiredLanguages(required);
        const missing = promotionPublicMissing(candidate.draft, required, true);
        if (missing.length) throw new Error(publicLanguageReason(missing));
        if (!can('growth_promotion_edit') || !missingStored.length) return body;
        const receipt = await promotionCommand({
            operation: 'saveDraft', targetId: activity.activityId, path: `/promotions/${encodeURIComponent(activity.activityId)}/draft`, method: 'PUT',
            body: { expectedVersion: candidate.version, expectedRevision: candidate.revision,
                draft: promotionPublicText(candidate.draft, required, 'submit'), reason: body.reason },
        });
        const { saved, advanced } = await verifyPromotionLocalizedReceipt(receipt);
        if (!saved?.current) throw new Error('尚未读到已补齐语言的候选草稿，请核查原操作。');
        acknowledgePromotionCommand(receipt);
        setActivity(saved);
        onReload(saved);
        if (advanced) throw new Error(PROMOTION_RECEIPT_ADVANCED);
        return { ...body, expectedRevision: saved.current.revision };
    };
    const blockers = candidate?.policyResolutionErrors || [], impact = activity.impact;
    const missingRanks=[candidate?.draft.buyerAudience,candidate?.draft.inviterAudience].some(a=>a?.rankIds?.some(id=>!catalog.ranks.some(r=>r.id===id)));
    const cannotPublish=blockers.length>0||missingRanks;
    const activityStateAction = !!action && ['pause', 'resume', 'end', 'archive'].includes(action);
    const reloadForConfirmation = async () => {
        const latest = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(activity.activityId)}`);
        const draftLine = (a: Promotion) => a.draftVersion ? `v${a.draftVersion} · ${labelState(a.current?.state ?? a.draftVersionState ?? 'DRAFT')}` : '没有';
        const facts = ([
            ['活动名称', activity.name || '未命名', latest.name || '未命名'],
            ['活动状态', labelState(activity.state), labelState(latest.state)],
            ['线上版本', activity.activeVersion ? `v${activity.activeVersion}` : '没有', latest.activeVersion ? `v${latest.activeVersion}` : '没有'],
            ['改版草稿', draftLine(activity), draftLine(latest)],
            ['未支付订单', activity.impact.unpaidOrders, latest.impact.unpaidOrders],
            ['未完成奖励', activity.impact.unfulfilledRewards, latest.impact.unfulfilledRewards],
        ] as Array<[string, ReactNode, ReactNode]>).filter(([, before, after]) => before !== after).map(([label, before, after]) => ({ label, before, after }));
        // Approval/publishing and copying must disclose configuration changes too, not just lifecycle counts.
        const contentChanges = activity.current && latest.current ? promotionDraftChanges(activity.current.draft, latest.current.draft).filter(change => change.changedByOther) : [];
        const shownFacts = contentChanges.some(change => change.field === 'name') ? facts.filter(fact => fact.label !== '活动名称') : facts;
        const key = action ?? '', label = key === 'approve' ? '批准' : CONFIRM_LABELS[key] ?? '';
        const blocked = recheckBlocked(key, latest);
        await readVersions(latest);
        setActivity(latest);
        setSimulation(null);
        onReload(latest);
        const view = <PromotionRecheck facts={shownFacts} changes={contentChanges} opened={activity.current?.draft} latest={latest.current?.draft} catalog={catalog} actionLabel={label} confirmLabel={confirmLabel(key, contentChanges.length > 0)} emphasize={key === 'approve' || key === 'publish'} blocked={blocked}/>;
        setConflict(previous => previous ? { ...previous, action: key, latest, view, contentChanged: contentChanges.length > 0 } : previous);
        return null;
    };
    const button = (key: string, disabled: boolean | string = false) => {
        const a = ACTIONS[key];
        if (!can(`growth_promotion_${a.authority}`)) return null;
        return <RdButton key={key} variant={['publish', 'approve', 'submit', 'resume'].includes(key) ? 'primary' : key === 'end' || key === 'reject' ? 'danger-outline' : 'secondary'} disabledReason={typeof disabled === 'string' ? disabled : disabled ? '当前状态不能做这一步' : undefined} onClick={() => setAction(key)}>{a.label}</RdButton>;
    };
    const zone = displayZone || activity.displayTimezone || 'UTC';
    const versionSummary = (v: Version | undefined | null) => v ? <><Summary rows={[['活动名称', v.draft.name || '未命名'], ['奖励规则', `${v.draft.rules?.length || 0} 个购买设备`], ['购买者活动上限', limitText(v.draft.perPersonLimit?.buyer)], ['活动截止', `${formatTime(v.draft.endsAt, v.draft.displayTimezone || 'UTC')}（${zoneLabel(v.draft.displayTimezone)}）`]]}/><PromotionBannerPreview assetId={v.draft.bannerAssetId}/><p className="h4-lede">{v.draft.rules?.map(r => rewardText(r.buyerReward)).join('；') || '奖励尚未配置'}</p></> : <BlockState state="empty" title="无此版本" detail="尚未创建或发布。"/>;
    const compare = compareVersions(active, candidate && activity.draftVersion ? candidate : null, catalog);
    const changed = compare.filter(r => r.changed).length;
    const versionPanels = <div className="h4-versions-grid">
        <Panel title={active ? `线上版本 v${active.version}` : '线上版本'} icon={Radio} tone="role-2" sub={active?.publishedAt ? `发布于 ${formatTime(active.publishedAt, zone)}` : undefined}>{versionSummary(active)}<p className="h4-lede">已锁订单保留原版本和付款截止；暂停与终止不改变原承诺。</p></Panel>
        <Panel title={activity.draftVersion ? `候选版本 v${activity.draftVersion}` : '历史与归档依据'} icon={FileClock} tone="role-3" actions={activity.draftVersion && candidate ? <Tag value={candidate.state}/> : undefined}>{activity.draftVersion ? versionSummary(candidate) : <Summary rows={[['活动状态', labelState(activity.state)], ['未完成义务', impact.unfulfilledRewards], ['未支付订单', impact.unpaidOrders], ['历史查询', '原版本、订单和奖励持续保留']]}/>}<div className="h4-row">{activity.draftVersion ? <RdButton disabledReason={!can('growth_promotion_edit') ? '没有编辑权限' : candidate?.state !== 'DRAFT' ? '候选已提交，撤回后才能编辑' : undefined} onClick={onEdit}>编辑草稿</RdButton> : button('draft-versions', ['ENDED', 'ARCHIVED'].includes(activity.state) ? '已结束或已归档的活动不能再改版' : false)}</div></Panel>
    </div>;
    const compareTable = <Panel title="线上版本和候选版本逐项对比" icon={GitCompare} tone="role-other" sub={activity.draftVersion ? `改了 ${changed} 项` : '没有候选版本'} explain="左列是用户现在看到的线上版本，右列是等审核或发布的候选版本；改动的行标出来。没有线上版本时左列写「—」。">
        {!activity.draftVersion ? <BlockState state="empty" title="没有候选版本" detail="在活动详情里「创建改版草稿」后，这里会逐项对比。"/> : versions.loading && !versions.data ? <Loading/> : <div className="h4-table"><RdTable label="线上版本和候选版本逐项对比"><thead><tr><Th scope="col">项目</Th><Th scope="col">{active ? `线上 v${active.version}` : '线上版本'}</Th><Th scope="col">{`候选 v${activity.draftVersion}`}</Th></tr></thead><tbody>{compare.map(r => <Tr key={r.label} mark={r.changed ? 'hit' : undefined}><Td>{r.label}{r.changed && <span className="h4-changed">已改</span>}</Td><Td>{r.before}</Td><Td>{r.after}</Td></Tr>)}</tbody></RdTable></div>}
    </Panel>;
    const lifecycleRows: Array<[string, string, ReactNode]> = [
        ['pause', '暂停新预留', 'App 列表和首页不再出现；已预留的订单和已成立的奖励照常处理。'],
        ['resume', '恢复新预留', '重新检查时间、政策、预算和库存，按原时间恢复，不延期。'],
        ['end', '终止活动', '不能直接恢复；已成立的承诺继续履行。'],
        ['archive', '归档活动', '已结束且没有在途预留和未完成奖励时，收进历史。'],
        ['copies', '复制为新活动', '只复制配置，新活动没有审批和累计使用量。'],
    ];
    const lifecycleAllowed: Record<string, boolean> = { pause: ['ACTIVE', 'SCHEDULED'].includes(activity.state), resume: activity.state === 'PAUSED', end: ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(activity.state), archive: activity.state === 'ENDED', copies: true };
    return <>{!review && <>
        <section className="h4-identity" aria-label="活动状态">
            <div className="h4-identity-main"><span className="h4-block-label">活动状态</span><Tag value={activity.state}/><VersionLine item={activity}/></div>
            <div className="h4-identity-time"><span className="h4-block-label">活动时间 · {zoneLabel(zone)}</span><TimeWindow item={activity} zone={zone}/>{zoneSwitch}</div>
            {detailActions && <div className="h4-identity-actions">{detailActions}</div>}
        </section>
        <Stats items={[['未支付预留', impact.unpaidOrders, '带这个活动预留、还没付款的订单；按各订单原付款截止处理。'], ['待发奖励', impact.pendingRewards, '等待原奖励处理的项数。'], ['失败 / 结果未知', `${impact.failedRewards} / ${impact.unknownRewards}`, '只恢复原奖励；结果未知先核查。'], ['未解决奖励', impact.unresolved, '暂停不能撤销原奖励。']]}/>
        <Panel title="预算" icon={Wallet} tone="role-1" sub={`更新于 ${formatTime(impact.asOf, zone)}`} explain="每项预算单独一条，不同资产不相加。已发出扣除了已冲正退回的部分；已预留包含已付款待发放的部分。发布时预算不能低于已占用。">
            {impact.budgets.length ? <div className="h4-budget-list">{impact.budgets.map(b => <BudgetBar key={`${b.asset}:${b.productNo ?? ''}`} budget={b} catalog={catalog}/>)}</div> : <BlockState state="empty" title="还没有配置预算"/>}
        </Panel>
        {versionPanels}
        {activity.draftVersion && compareTable}
        <Panel title="在途承诺与处置影响" icon={ListChecks} tone="role-other" sub={`包含所有版本 · 更新于 ${formatTime(impact.asOf, zone)}`}><Table headers={['义务范围', '数量', '暂停 / 结束后的处理', '操作']} rows={[['待支付订单', impact.unpaidOrders, '原截止前可按原版本支付', <Button kind="link" onClick={() => setReservations(true)}>查看预留</Button>], ['待发奖励', impact.pendingRewards, '继续按原承诺执行', <Button kind="link" onClick={onRewards}>查看奖励</Button>], ['发放失败 / 结果未知', `${impact.failedRewards} / ${impact.unknownRewards}`, '只恢复原奖励；先核查未知结果', <Button kind="link" onClick={onRewards}>查看异常项</Button>]]}/></Panel>
        <Panel title="活动操作" icon={Settings2} tone="role-other" explain="这些操作只控制新的投放与预留。既有订单与奖励继续履行，不因暂停或终止批量取消。">
            <ul className="h4-ops">{lifecycleRows.map(([key, label, effect]) => { const node = button(key, key === 'archive' && (impact.unpaidOrders > 0 || impact.unfulfilledRewards > 0) ? '还有待支付订单或未完成奖励，暂不可归档' : false); return lifecycleAllowed[key] && node ? <li key={key}><span className="h4-op-what"><b>{label}</b><span>{effect}</span></span>{node}</li> : null; })}
                <li><span className="h4-op-what"><b>查看效果</b><span>支付、退款、分设备销量和奖励成本。</span></span><RdButton disabledReason={can('growth_promotion_metrics_read') ? undefined : '没有查看效果的权限'} onClick={onMetrics}>查看效果</RdButton></li></ul>
        </Panel></>}
    {review && <div className="h4-review">
        <div className="h4-review-main">
            {compareTable}
            <Card title="试算结果" action={<Button disabled={!can('growth_promotion_simulate') || !candidate} onClick={() => setSimOpen(true)}>重新试算</Button>}>{simulation ? <><Summary rows={[['资格', labelState(simulation.eligibility)], ['试算时刻', formatTime(simulation.asOf, zone)], ['赠品成本', simulation.giftCostUsdt == null ? '未提供' : `${amountText(simulation.giftCostUsdt)} USDT`], ['占用资格 / 预算', '否']]}/><Table label="逐设备、逐受益人的试算结果" headers={['购买设备', '资格结果', '奖励承诺', '依据']} rows={simulation.ruleResults.flatMap(r => r.beneficiaries.map(b => [(text(catalog.skus.find(s => s.productNo === r.productNo)?.name)), <Tag value={b.status}/>, b.rewardUnits ?? '—', b.reasons.map(d => text(d.message)).join('；') || '已核对']))}/>{simulation.rewardUnits.length > 0 && <ul className="h4-units">{simulation.rewardUnits.map((r, i) => <li key={i}>{(text(catalog.skus.find(s => s.productNo === r.productNo)?.name))} 第 {r.purchaseUnitFrom}–{r.purchaseUnitTo} 台 · {labelState(r.beneficiaryRole)} · <b>{rewardText(r.reward)}</b></li>)}</ul>}{simulation.blockers.map((b, i) => <Notice key={i} title="试算阻断" kind="warn">{text(b.message)}</Notice>)}<Table label="资源够不够" headers={['资源', '所需', '可用', '结果']} rows={simulation.resources.map(r => [`${r.kind === 'INVENTORY' ? '商品库存' : r.asset === 'DEVICE' ? '设备赠礼预算' : promotionAssetText(r.asset)}${r.productNo ? ` · ${(text(catalog.skus.find(s => s.productNo === r.productNo)?.name))}` : ''}`, r.required == null ? '—' : amountText(r.required, r.asset === 'DEVICE' || r.kind === 'INVENTORY'), r.available == null ? '—' : amountText(r.available, r.asset === 'DEVICE' || r.kind === 'INVENTORY'), <Tag value={r.status}/>])}/><Table label="参与上限" headers={['上限范围', '已用及预留', '本次预计', '剩余', '状态']} rows={simulation.quotaImpact.map(q => [q.scope === 'ACTIVITY_ORDER' ? '全活动订单' : q.scope === 'PERSON_ORDER' ? '账户参与订单' : '账户规则组数', q.usedAndReserved ?? '—', q.required ?? '—', q.remaining ?? (q.limit === null && q.status !== 'UNKNOWN' ? '无限制' : '—'), <Tag value={q.status}/>])}/></> : <BlockState state="empty" title="尚未试算" detail="选择购买设备、数量及可选授权样本后查看试算结果。试算不创建订单，不占资格或预算。"/>}</Card>
            {simulation && <Card title="试算成交与公开预览">{simulation.pricing ? <Summary rows={[['商品小计（USDT）', amountText(simulation.pricing.subtotalUsdt)], ['优惠合计（USDT）', amountText(simulation.pricing.discountUsdt)], ['其中订单立减（USDT）', simulation.pricing.promotionDiscountUsdt == null ? '未提供' : amountText(simulation.pricing.promotionDiscountUsdt)], ['应付款（USDT）', amountText(simulation.pricing.amountUsdt)]]}/> : <Notice title="原报价暂不可用">当前不能确认应付款，请按阻断项处理。</Notice>}{simulation.publicPreview ? <Summary rows={[['展示标题', text(simulation.publicPreview.title)], ['活动规则', text(simulation.publicPreview.terms)], ['时区', simulation.publicPreview.displayTimezone]]}/> : <Notice title="公开预览暂不可用" kind="warn">活动权益暂无法确认，请处理上方阻断项后重试。</Notice>}</Card>}
            <Panel title="审核与发布记录" icon={History} tone="role-other">{versions.data ? <Timeline label="审核与发布记录" entries={versions.data.items.map(v => ({ id: String(v.version), at: v.publishedAt || v.approvedAt || '—', actor: v.publishedBy || v.approvedBy || '—', action: `v${v.version} · ${labelState(v.state)}`, detail: <>审核：{v.approvedAt ? <Stamp at={v.approvedAt}/> : '尚未批准'} · 发布：{v.publishedAt ? <Stamp at={v.publishedAt}/> : '尚未发布'}</>, tone: v.state === 'PENDING_APPROVAL' ? 'warn' as const : undefined }))}/> : <Loading/>}{versions.data?.hasMore && <Notice title="历史版本较多">当前显示首 100 个版本；最新候选使用活动详情返回。</Notice>}</Panel>
        </div>
        <aside className="h4-review-side">
            <Panel title="发布前检查" icon={ShieldCheck} tone={blockers.length || missingRanks ? 'warn' : 'role-other'}>{missingRanks&&<Notice title="原指定等级当前不可用" kind="warn">等级目录无法确认原选择。请返回参与资格重新核对；不限等级活动不受空目录限制。</Notice>}<Notice title={blockers.length ? '仍有配置或政策阻断' : '提交时将重新核验'} kind={blockers.length ? 'warn' : ''}>权益、资金、叠加、追回和权限必须来自当前可执行的批准政策。</Notice><Summary rows={[['候选状态', candidate ? labelState(candidate.state) : '无候选'], ['政策检查', blockers.length ? `${blockers.length} 项待处理` : '以最新提交校验为准'], ['当前有效版本', activity.activeVersion ? `v${activity.activeVersion} 继续执行` : '尚未发布'], ['公开语言', !candidate ? '—' : (candidate.state === 'DRAFT' ? missingPublic : missingStored).length ? '仍有语言缺失' : '必填语言完整' ]]}/>{blockers.length > 0 && <p className="h4-lede">请返回配置，核对缺失或已撤销的政策引用。</p>}</Panel>
            <Panel title="当前可用操作" icon={Send} tone="role-other" explain="审核与发布须分别操作，由两个人做：审核人不能是做过这个活动的人，发布人不能是审核人。版本冲突时请核对刷新后的候选并重新确认；结果未知时先查询原操作。">
                <Steps label="候选版本走到哪" items={[{ label: '草稿', state: candidate?.state === 'DRAFT' ? 'current' : candidate ? 'done' : 'todo' }, { label: '待审核', state: candidate?.state === 'PENDING_APPROVAL' ? 'current' : candidate?.state === 'APPROVED' ? 'done' : 'todo' }, { label: '待发布', state: candidate?.state === 'APPROVED' ? 'current' : 'todo' }, { label: '已发布', state: 'todo' }]}/>
                <div className="h4-row h4-review-actions">{candidate?.state === 'DRAFT' && button('submit', cannotPublish ? '还有政策或等级阻断，先处理' : missingPublic.length ? publicLanguageReason(missingPublic) : false)}{candidate?.state === 'PENDING_APPROVAL' && <>{button('withdraw')}{button('reject')}{button('approve', cannotPublish ? '还有政策或等级阻断，先处理' : missingStored.length ? publicLanguageReason(missingStored) : false)}</>}{candidate?.state === 'APPROVED' && <>{button('withdraw')}{button('publish', cannotPublish ? '还有政策或等级阻断，先处理' : missingStored.length ? publicLanguageReason(missingStored) : false)}</>}</div>
                <RdButton variant="ghost" onClick={onBack}>查看双版本</RdButton>
                <RdButton variant="ghost" onClick={onBack}>返回活动详情</RdButton>
            </Panel>
        </aside>
    </div>}
    {!!versions.error && <ReadError target="活动历史版本" error={versions.error} retry={versions.reload}/>}
    {action && <ConfirmCommand prepareBody={["submit", "approve", "publish"].includes(action) ? prepareReview : undefined} conflictReview={conflictReview} onVersionConflict={error => { if (error.reasonCode === 'PROMOTION_RESOURCE_NOT_FOUND') setDeletedError(error); else setConflict({ action, opened: activity, latest: null, view: null, contentChanged: false, error }); }} onReload={reloadForConfirmation} writeAllowed={can('growth_promotion_'+ACTIONS[action].authority) && !versions.loading && !versions.error && (!ACTIONS[action].version || !!candidate && activity.draftVersion === candidate.version && !['ENDED', 'ARCHIVED'].includes(activity.state) && ({ submit: ['DRAFT'], withdraw: ['PENDING_APPROVAL', 'APPROVED'], approve: ['PENDING_APPROVAL'], reject: ['PENDING_APPROVAL'], publish: ['APPROVED'] }[action] ?? []).includes(candidate.state)) && (action !== 'pause' || ['ACTIVE', 'SCHEDULED'].includes(activity.state)) && (action !== 'resume' || activity.state === 'PAUSED') && (action !== 'end' || ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(activity.state)) && (action !== 'archive' || activity.state === 'ENDED' && !impact.unpaidOrders && !impact.unfulfilledRewards) && (action !== 'draft-versions' || !activity.draftVersion && !['ENDED', 'ARCHIVED'].includes(activity.state))} title={ACTIONS[action].label} confirmLabel={confirmLabel(action, recheck)} danger={['end', 'reject'].includes(action)} sub={action === 'end' || action === 'archive' ? <IrreversibleTag/> : <StatusTag tone="progress" filled>立即生效</StatusTag>} intent={{ operation: ACTIONS[action].operation, targetId: activity.activityId, path: `/promotions/${activity.activityId}/${action}`, method: 'POST' }} body={{ expectedRevision: ACTIONS[action].version ? candidate?.revision : activity.revision, evidenceRefs: [], ...(action === 'copies' ? { expectedSourceVersion: activity.draftVersion ?? activity.activeVersion, expectedSourceRevision: current?.revision } : {}), ...(ACTIONS[action].version ? { version: candidate?.version } : {}) }} onClose={() => setAction(null)} onSuccess={async (result, isCurrent) => { if (action === 'copies') await onCopyCreated(result, isCurrent); else { await onRefresh(); versions.reload(); if (action === 'submit') setSimulation(null); } if (isCurrent()) setAction(null); }}><Summary rows={[['活动', activity.name || activity.activityId], ['活动状态', labelState(activity.state)], ['改版草稿', activity.draftVersion ? `v${activity.draftVersion}` : '无'], ['版本', ACTIONS[action].version ? `候选 v${candidate?.version}` : `有效 v${activity.activeVersion ?? '—'}`], ['未支付订单', impact.unpaidOrders], ['未完成奖励', impact.unfulfilledRewards]]}/>{actionFacts(action, activity, candidate, catalog)}<Notice title="确认影响范围">{ACTIONS[action].copy}</Notice></ConfirmCommand>}
    {simOpen && candidate && <SimulationDialog key={candidateScope} activity={activity} version={candidate} catalog={catalog} can={can} onClose={() => setSimOpen(false)} onResult={async result => {
        const latest = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(candidate.activityId)}`);
        const checked = latest.current;
        if (result.activityId !== candidate.activityId || result.version !== candidate.version || result.configHash !== candidate.contentHash
            || latest.activityId !== candidate.activityId || latest.draftVersion !== candidate.version || checked?.version !== candidate.version
            || checked.revision !== candidate.revision || checked.contentHash !== candidate.contentHash) {
            setSimulation(null); setSimOpen(false); onCandidateConflict(); return;
        }
        setSimulation({ scope: candidateScope, result }); setSimOpen(false);
    }}/>}
    {reservations && <Dialog title="原订单预留" wide onClose={() => setReservations(false)} sub={`${impact.reservedOrders.length} 单 · 关闭不释放订单`}><Table headers={['订单', '锁定版本', '原付款截止', '预留奖励']} rows={impact.reservedOrders.map(r => [<span className="h4-mono">{r.orderNo}</span>, `v${r.version}`, formatTime(r.payBy, zone), r.reservedRewards])}/>{!impact.reservedOrders.length && <BlockState state="empty" title="没有在途预留"/>}</Dialog>}
  </>;
}
const CONFIRM_LABELS: Record<string, string> = { submit: '提交审核', withdraw: '撤回审核', approve: '审核通过', reject: '驳回', publish: '发布', pause: '暂停新预留', resume: '恢复新预留', end: '终止活动', archive: '归档活动', 'draft-versions': '创建改版草稿', copies: '复制为新活动' };
/** 重新读取后内容变了：批准、发布的按钮写明确认的是新内容。 */
const confirmLabel = (action: string, contentChanged: boolean) => contentChanged && action === 'approve' ? '批准新内容' : contentChanged && action === 'publish' ? '发布新内容' : CONFIRM_LABELS[action];
const VERSION_STATES: Record<string, string[]> = { submit: ['DRAFT'], withdraw: ['PENDING_APPROVAL', 'APPROVED'], approve: ['PENDING_APPROVAL'], reject: ['PENDING_APPROVAL'], publish: ['APPROVED'] };
/** 只用来写「现在不能做」的原因；能不能提交仍由确认框的 writeAllowed 决定。 */
function recheckBlocked(action: string, latest: Promotion): string | undefined {
    if (latest.deleted) return '这个活动已被删除。';
    const c = latest.current;
    if (ACTIONS[action]?.version) {
        if (['ENDED', 'ARCHIVED'].includes(latest.state)) return `活动${labelState(latest.state)}。`;
        if (!c || latest.draftVersion !== c.version) return '这个活动现在没有改版草稿。';
        return VERSION_STATES[action]?.includes(c.state) ? undefined : `这一版现在是「${labelState(c.state)}」。`;
    }
    const state = `活动现在是「${labelState(latest.state)}」。`;
    if (action === 'pause') return ['ACTIVE', 'SCHEDULED'].includes(latest.state) ? undefined : state;
    if (action === 'resume') return latest.state === 'PAUSED' ? undefined : state;
    if (action === 'end') return ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(latest.state) ? undefined : state;
    if (action === 'archive') return latest.state !== 'ENDED' ? state : latest.impact.unpaidOrders || latest.impact.unfulfilledRewards ? '还有待支付订单或未完成奖励。' : undefined;
    if (action === 'draft-versions') return ['ENDED', 'ARCHIVED'].includes(latest.state) ? state : latest.draftVersion ? '已经有一个改版草稿。' : undefined;
    return undefined;
}
const REVIEWER = '另一位有「审核促销活动」权限的超级管理员';
const PUBLISHER = '另一位有「发布促销活动」权限的超级管理员';
/** 每个动作的后果写成事实行：从什么时候、对哪些人、钱从哪出、已预留的怎么办、用户还能不能看到（以后端事实为准）。 */
function actionFacts(action: string, activity: Promotion, candidate: Version | null | undefined, catalog: Catalog): ReactNode {
    const zone = activity.displayTimezone || 'UTC';
    const draft = candidate?.draft;
    const startsLater = draft?.startsAt && Date.parse(draft.startsAt) > Date.parse(activity.serverTime);
    const budgets = (draft?.budgets || []).filter(b => b.total != null).map(b => `${b.asset === 'DEVICE' ? `赠品 ${text(catalog.skus.find(s => s.productNo === b.productNo)?.name)}` : b.asset === 'DISCOUNT_USDT' ? '订单立减' : b.asset} ${amountText(b.total, b.asset === 'DEVICE')}${b.asset === 'DEVICE' ? ' 台' : b.asset === 'DISCOUNT_USDT' ? ' USDT' : ` ${b.asset}`}`).join('；') || '候选版本没有填预算';
    const audience = draft?.buyerAudience ? [draft.buyerAudience.purchaseHistory === 'NEVER_PAID' ? '从未付款购机' : draft.buyerAudience.purchaseHistory === 'HAS_VALID_PURCHASE' ? '有有效购机' : draft.buyerAudience.purchaseHistory === 'ANY' ? '不限购机历史' : '购机历史未配置', draft.buyerAudience.rankIds?.length ? `等级 ${draft.buyerAudience.rankIds.map(id => text(catalog.ranks.find(r => r.id === id)?.name)).join('、')}` : '不限等级', draft.buyerAudience.markets?.length ? `市场 ${draft.buyerAudience.markets.join('、')}` : '不限市场'].join('，') : '人群未配置';
    const rows: Record<string, Array<[string, ReactNode]>> = {
        submit: [['提交后', '候选不能再编辑，要改先撤回；线上版本照常运行'], ['谁来审核', `${REVIEWER}；创建、编辑、提交过这个活动的人不能审核`]],
        withdraw: [['撤回后', '候选回到草稿，原批准清除；线上版本和原订单不变']],
        approve: [['审核通过后', '候选变成「已审核待发布」，不发布、不替换线上版本'], ['谁来发布', `${PUBLISHER}；审核人不能发布`]],
        reject: [['驳回后', '候选退回草稿，驳回理由留在审核记录；线上版本不受影响']],
        publish: [['从什么时候生效', activity.state === 'PAUSED' ? '活动现在暂停中：发布后仍暂停，恢复后才投放新版本' : startsLater ? `到 ${formatTime(draft?.startsAt, zone)}（${zoneLabel(zone)}）开始，之前是待开始` : '确认后立即进行中'], ['对哪些人', `符合候选 v${candidate?.version ?? '—'} 人群条件的用户：${audience}`], ['预算从哪出', `这个活动自己的预算：${budgets}。预算不能低于已占用，否则发布被拒`], ['已有订单', '按下单时的版本和原付款截止履行，不改'], ['谁不能发布', '审核这个候选的人']],
        pause: [['用户看到的', 'App 活动列表和首页不再出现；已有详情链接仍能打开，但不能新领'], ['已预留的', '订单在原付款截止前仍可付款，已成立的奖励照常发放']],
        resume: [['恢复前检查', '原时间、政策、商品目录、预算、库存，以及和其他活动是否冲突'], ['通过后', '按原开始时间恢复为待开始或进行中；不延期，不清零累计'], ['不通过', '仍保持暂停，确认框写出原因']],
        end: [['用户看到的', 'App 列表和首页不再出现；已有详情链接打开显示已结束'], ['已预留的', '订单在原付款截止前仍可付款，已成立的奖励继续按原承诺发放'], ['之后', '不能直接恢复；要再办需要复制为新活动']],
        archive: [['前提', '已结束，没有待付款预留，奖励都已发放、取消或冲正'], ['用户看到的', '用户打不开这个活动页'], ['保留', '历史订单、奖励台账和效果报表都还能查']],
        'draft-versions': [['创建后', '复制线上配置成新的候选草稿；线上版本继续运行，累计使用量不重置']],
        copies: [['复制后', '得到一个新的草稿活动，只带配置；审批、累计使用量和订单不带过去']],
    };
    return <Summary rows={rows[action] || []}/>;
}
type CompareRow = { label: string; before: ReactNode; after: ReactNode; changed: boolean };
/** 两个版本逐项对比，只比运营关心的字段；没有线上版本时左列写「—」。 */
function compareVersions(active: Version | undefined, candidate: Version | null | undefined, catalog: Catalog): CompareRow[] {
    if (!candidate) return [];
    const zoneOf = (v?: Version) => v?.draft.displayTimezone || 'UTC';
    const budget = (v?: Version) => v ? (v.draft.budgets || []).map(b => `${b.asset === 'DEVICE' ? `赠品 ${text(catalog.skus.find(s => s.productNo === b.productNo)?.name)}` : b.asset === 'DISCOUNT_USDT' ? '订单立减' : b.asset} ${b.total == null ? '未填' : amountText(b.total, b.asset === 'DEVICE')}`).join('；') || '未配置' : '—';
    const rules = (v?: Version) => v ? (v.draft.rules || []).map(r => `${text(catalog.skus.find(s => s.productNo === r.productNo)?.name)}：${rewardText(r.buyerReward)}${r.inviterReward ? ` / 邀请人 ${rewardText(r.inviterReward)}` : ''}`).join('；') || '未配置' : '—';
    const fields: Array<[string, (v?: Version) => string]> = [
        ['活动名称', v => v ? v.draft.name || '未命名' : '—'],
        ['开始时间', v => v ? `${formatTime(v.draft.startsAt, zoneOf(v))}` : '—'],
        ['结束时间', v => v ? `${formatTime(v.draft.endsAt, zoneOf(v))}` : '—'],
        ['显示时区', v => v ? zoneLabel(v.draft.displayTimezone) : '—'],
        ['投放位置', v => v ? v.draft.placement ? '首页购机促销位' : '不投放' : '—'],
        ['公开标题（中文）', v => v ? v.draft.title?.zh || '未填写' : '—'],
        ['购买设备与奖励', rules],
        ['购买者每人上限', v => v ? limitText(v.draft.perPersonLimit?.buyer) : '—'],
        ['活动订单上限', v => v ? limitText(v.draft.activityLimit) : '—'],
        ['预算', budget],
        ['额度不足时', v => v ? v.draft.shortagePolicy === 'RULE_STOP' ? '停止对应规则' : v.draft.shortagePolicy === 'ACTIVITY_PAUSE' ? '暂停整个活动' : '未配置' : '—'],
        ['引用的政策', v => v ? JSON.stringify(v.draft.policies ?? null) === 'null' ? '未配置' : Object.entries(v.draft.policies || {}).filter(([, ref]) => ref).map(([key, ref]) => `${POLICY_SLOT[key] || key} v${(ref as { version: number }).version}`).join('；') : '—'],
    ];
    return fields.map(([label, read]) => { const before = active ? read(active) : '—', after = read(candidate); return { label, before, after, changed: !!active && before !== after }; });
}
const POLICY_SLOT: Record<string, string> = { settlement: '结算', stacking: '叠加', refund: '售后追回', quote: '报价期限', authorization: '审核发布授权' };

function SimulationDialog({ activity, version, catalog, can, onClose, onResult }: {
    activity: Promotion;
    version: Version;
    catalog: Catalog;
    can: (v: string) => boolean;
    onClose: () => void;
    onResult: (s: AdminSimulation) => Promise<void>;
}) {
    const [items, setItems] = useState<Item[]>([]), [sample, setSample] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    const failedRead = useRef<{target: string; retry: () => Promise<void>} | null>(null);
    const run = async () => { setBusy(true); setError(null); try {
        await onResult(await promotionRead<AdminSimulation>(`/promotions/${activity.activityId}/simulate`, undefined, { method: 'POST', body: JSON.stringify({ draft: version.draft, items, sampleAccountId: can('user_c1_read') && sample ? sample : null }) }));
    }
    catch (e) {
        failedRead.current = {target: '只读购买试算', retry: run};
        setError(e);
    }
    finally {
        setBusy(false);
    } };
    return <Dialog title="试算购买场景" wide onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button kind="primary" disabled={busy || !items.length || items.some(i => !i.productNo || i.quantity < 1) || !can('growth_promotion_simulate')} onClick={run}>{busy ? '正在试算…' : '运行试算'}</Button></>}><Notice title="只读试算">不创建订单，不占资格或预算。没有账户样本时，账户资格明确显示未知。</Notice><fieldset disabled={busy}>{items.map((item, i) => <div className="grid2" key={i}><Field label={`购买设备 ${i + 1}`}><select value={item.productNo} onChange={e => setItems(items.map((v, j) => j === i ? { ...v, productNo: e.target.value } : v))}><option value="">请选择</option>{catalog.skus.filter(s => s.available).map(s => <option key={s.productNo} value={s.productNo}>{(text(s.name))}</option>)}</select></Field><Field label="购买数量"><input type="number" min={1} step={1} value={item.quantity || ''} onChange={e => setItems(items.map((v, j) => j === i ? { ...v, quantity: Number(e.target.value) } : v))}/></Field><Button kind="link" onClick={() => setItems(items.filter((_, j) => j !== i))}>移除此购买项</Button></div>)}<Button onClick={() => setItems([...items, { productNo: '', quantity: 0 }])} disabled={items.length >= 8}>添加购买项</Button>{can('user_c1_read') ? <H4SampleAccountSelect value={sample} onChange={setSample} allowed={can('user_c1_read') && can('growth_promotion_simulate')} disabled={busy}/> : <p className="help">当前权限只允许汇总试算，不可查看或指定账户样本。</p>}</fieldset>{!!error && <ReadError target={failedRead.current?.target || "只读购买试算"} error={error} retry={() => {void failedRead.current?.retry();}}/>}</Dialog>;
}
