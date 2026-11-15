"use client";
import { H4DateTimeField } from './h4-date-time-field';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import type { HCtx } from './types';
import type { Catalog, CommandReceipt, Promotion, PromotionListItem, PromotionPage, Template } from '@/lib/admin/promotion-types';
import { pendingPromotionCommands, promotionRead, type PendingPromotion } from '@/lib/admin/promotion-client';
import { isDeletablePromotion, promotionDeleteBody } from '@/lib/admin/activity-delete';
import { pendingH4Commands, h4CommandHasPendingTicket, recoveredH4Uploads, acknowledgeH4Upload, type H4Command } from '@/lib/admin/h4-mutations';
import { displayAdminError } from '@/lib/admin/error-messages';
import { emptyDraft, dateInput, utcInput } from '@/lib/admin/promotion-form';
import PromotionEditor from './h4-promotion-editor';
import PromotionReview from './h4-promotion-review';
import PromotionRewards from './h4-promotion-rewards';
import PromotionMetrics from './h4-promotion-metrics';
import PromotionPolicies from './h4-promotion-policies';
import { ConfirmCommand, Dialog, Empty, Loading, Notice as OldNotice, PROMOTION_COMMAND_PERMISSIONS, PromotionReadPanel, PromotionSteps, ReadError, Summary, TEMPLATE_LABELS, formatTime, labelState, useRead, zoneLabel } from './h4-promotion-ui';
import { OPERATION_LABELS, PendingList, PromotionCard, PromotionOverview, RewardEntries, ZoneSwitch } from './h4-promotion-board';
import { ArrowLeft, Gift, Megaphone, Plus } from 'lucide-react';
import { BlockState, Button, FilterBar, FilterField, Input, IrreversibleTag, Notice, PageHeader, PageTabs, Panel, Select, StatusTag, useTabIds, type MoreMenuItem, type PageTabItem } from '@/app/components/rd';
import './h4-promotions.css';
type Screen = 'list' | 'edit' | 'review' | 'detail' | 'rewards' | 'metrics';
const SCREENS: Screen[] = ['list', 'edit', 'review', 'detail', 'rewards', 'metrics'];
type LegacySection = 'events' | 'plays' | 'wheel';
type ListTab = 'promotions' | 'rewards' | 'policies' | `legacy-${LegacySection}`;
/** 恢复出来的处置证据属于哪个确认框。 */
const EVIDENCE_OP: Record<string, string> = { cancelReward: '取消原奖励项', reverseReward: '发起冲正', resolveReward: '异常审阅' };
/** 放不回原处的原因写成运营的话；没见过的原因原样显示。 */
function restoreReason(reason: string, kind: 'banner' | 'evidence') {
    const known: Record<string, string> = {
        '原对象当前不允许修改': kind === 'banner' ? '这个草稿现在不能改' : '这笔奖励现在不能处置',
        '原对象的版本或操作已变化': kind === 'banner' ? '原草稿已改过' : '这笔奖励或处置方式已变',
        '原活动草稿已不存在或状态已变化': '原草稿已删除、送审或改过',
        '原奖励义务已变化': '这笔奖励已被处理或改过',
        '无法确认原对象是否仍存在且允许修改': '没读到原处的现状，下次打开时再试',
    };
    return known[reason] ?? reason;
}
export default function H4Promotions({ ctx, legacy }: {
    ctx: HCtx;
    legacy: (section: LegacySection, go: (section: LegacySection) => void) => ReactNode;
}) {
    const routeSearch = useSearchParams().toString();
    const [,pendingChanged]=useState(0);
    useEffect(()=>{const refreshPending=()=>pendingChanged(v=>v+1);window.addEventListener('admin-promotion-pending-changed',refreshPending);window.addEventListener('admin-h4-pending-changed',refreshPending);return()=>{window.removeEventListener('admin-promotion-pending-changed',refreshPending);window.removeEventListener('admin-h4-pending-changed',refreshPending);};},[]);
    const [editStep, setEditStep] = useState(0), [old, setOld] = useState(false), [screen, setScreen] = useState<Screen>('list'), [id, setId] = useState(''), [activity, setActivity] = useState<Promotion | null>(null), [activityError, setActivityError] = useState<unknown>(null), [activityBusy, setActivityBusy] = useState(false), [creating, setCreating] = useState(false), [template, setTemplate] = useState<Template | null>(null), [copy, setCopy] = useState<PromotionListItem | null>(null), [pending, setPending] = useState<PendingPromotion | null>(null), [notice, setNotice] = useState(''), [policiesOpen, setPoliciesOpen] = useState(false);
    const [filters, setFilters] = useState({ query: '', category: '', template: '', state: '', from: '', to: '', timezone: 'Asia/Tokyo', sort: 'UPDATED_DESC' }), [query, setQuery] = useState<Record<string, string | number>>({ limit: 20 }), [previous, setPrevious] = useState<Array<Record<string, string | number>>>([]);
    const [routeReady, setRouteReady] = useState(false);
    const [tab, setTab] = useState<'promotions' | 'rewards' | 'policies'>('promotions'), [legacySection, setLegacySection] = useState<LegacySection>('events'), tabIds = useTabIds();
    const [beijing, setBeijing] = useState(false), displayZone = beijing ? 'Asia/Shanghai' : undefined;
    const [recoveredExport, setRecoveredExport] = useState<{ activityId: string; exportId: string } | null>(null);
    const [deleting, setDeleting] = useState<Promotion | null>(null), [deleteLoading, setDeleteLoading] = useState(false), [deletedId, setDeletedId] = useState('');
    const ongoing = useRef({ creating, template, copy, deleting, policiesOpen, screen, id });
    ongoing.current = { creating, template, copy, deleting, policiesOpen, screen, id };
    const catalog = useRead(() => ctx.can('growth_promotion_read') ? promotionRead<Catalog>('/promotion-catalog') : Promise.reject(new Error('你没有查看促销活动的权限。')), [ctx.can]);
    const list = useRead(() => ctx.can('growth_promotion_read') ? promotionRead<PromotionPage>('/promotions', query) : Promise.reject(new Error('你没有查看促销活动的权限。')), [JSON.stringify(query), ctx.can], routeReady && screen === 'list' && !old);
    const reloadList = () => {
        setPrevious([]);
        setQuery(current => { const next = { ...current }; delete next.querySnapshot; delete next.cursor; return next; });
        list.reload();
    };
    useEffect(() => {
        const settled = (event: Event) => {
            const commandKey = (event as CustomEvent<string>).detail;
            setPending(current => current?.commandKey === commandKey ? null : current);
            if (pendingPromotionCommands().some(record => record.commandKey === commandKey && record.receipt)) ctx.toast('原操作已确认成功，正在更新活动资料。');
            catalog.reload(); reloadList(); if (id) retryActivity();
        };
        window.addEventListener('admin-promotion-original-settled', settled);
        return () => window.removeEventListener('admin-promotion-original-settled', settled);
    }, [id]);
    const pageReady = screen === 'list' ? !!list.data && !!catalog.data : !!catalog.data && activity?.activityId === id;
    const pageLoading = !routeReady || (!pageReady && (catalog.loading || (screen === 'list' ? list.loading : activityBusy)));
    const retryActivity = () => { setActivityBusy(true); setActivityError(null); void refresh().catch(setActivityError).finally(() => setActivityBusy(false)); };
    const readErrors = [catalog.error ? { target: '活动目录与批准政策', error: catalog.error, retry: catalog.reload } : null,
        screen === 'list' && list.error ? { target: '活动列表', error: list.error, retry: reloadList } : null,
        screen !== 'list' && activityError ? { target: '当前活动版本', error: activityError, retry: retryActivity } : null].filter((item): item is NonNullable<typeof item> => item !== null);
    const can = useCallback((capability: string) => ctx.can(capability) && (screen === 'list' || !activity?.deleted || capability.endsWith('_read') || capability.startsWith('growth_promotion_reward_') || capability === 'growth_promotion_metrics_export') && (capability.endsWith('_read') || (!catalog.loading && !catalog.error && (screen === 'list' ? !list.loading && !list.error : !activityBusy && !activityError))), [ctx.can, activity?.deleted, catalog.loading, catalog.error, activityBusy, activityError, screen, list.loading, list.error]);
    const navigate = (next: Screen, target = id) => { setScreen(next); setId(target); const url = new URL(location.href); if (next === 'list') {
        url.searchParams.delete('promotion');
        url.searchParams.delete('activity');
    }
    else {
        url.searchParams.set('promotion', next);
        url.searchParams.set('activity', target);
    } history.pushState({}, '', url); };
    useEffect(() => { const restore = () => { const p = new URLSearchParams(location.search), s = p.get('promotion'); setScreen(SCREENS.includes(s as Screen) ? s as Screen : 'list'); setId(p.get('activity') || '');setEditStep(Math.max(0,Math.min(3,Number(p.get('step'))||0)));setRouteReady(true);  }; if (screen !== 'edit' || !pageReady) restore(); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, [routeSearch]);
    useEffect(() => { if (!id) {
        setActivity(null);
        return;
    } let current = true; setActivityBusy(true); setActivityError(null); promotionRead<Promotion>(`/promotions/${encodeURIComponent(id)}`).then(p => { if (current)
        setActivity(p); }).catch(e => { if (current)
        setActivityError(e); }).finally(() => { if (current)
        setActivityBusy(false); }); return () => { current = false; }; }, [id]);
    const changeStep=useCallback((step:number)=>{setEditStep(step);const url=new URL(location.href);url.searchParams.set('step',String(step));history.replaceState({},'',url);},[]);
    const refresh = async (nextStep?: number) => { if (!id)
        return; const latest = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(id)}`); if (ongoing.current.id === id) { if(nextStep!==undefined)changeStep(nextStep); setActivity(latest); } reloadList(); return latest; };
    const afterCreate = async (result: CommandReceipt, isCurrent: () => boolean = () => true) => { if (!result.resource)
        throw new Error('创建结果暂无法确认，请核查原操作。'); const target = result.resource.type === 'VERSION' ? result.resource.id.slice(0, result.resource.id.lastIndexOf(':')) : result.resource.id; const saved = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(target)}`); reloadList(); if (!isCurrent()) return; setActivity(saved); setTemplate(null); setCreating(false); setCopy(null); setNotice(''); setDeletedId(''); reloadList(); navigate('edit', target); };
    const openDelete = async (target: string) => {
        if (!can('growth_promotion_archive') || deleteLoading) return;
        setDeleteLoading(true); setNotice(''); setDeletedId('');
        try {
            const latest = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(target)}`);
            promotionDeleteBody(latest);
            setDeleting(latest);
        } catch (error) { setNotice(error instanceof Error ? error.message : '活动资料读取失败，请刷新后重试。'); }
        finally { setDeleteLoading(false); }
    };
    const afterDelete = (result: CommandReceipt, isCurrent: () => boolean) => { setDeletedId(result.targetId); setNotice('活动已删除，历史订单、奖励与操作记录保留。'); reloadList(); if (!isCurrent()) return; setDeleting(null); setActivity(null); setActivityError(null); navigate('list', ''); };
    const pendingItems = pendingPromotionCommands();
    const legacyUnknown = pendingH4Commands().filter(r => !r.asset && (!r.acknowledged || "proposal" in r.request) && !h4CommandHasPendingTicket(r.commandKey)).length;
    const uploadUnknown = pendingH4Commands().filter(r => !r.asset && r.scope.includes('/h4_media/')).length;
    const recoveredUploads = recoveredH4Uploads();
    const uploadFile = (record: H4Command) => { try { const b = JSON.parse('body' in record.request ? record.request.body : '{}'); return { name: String(b.fileName ?? '—'), size: typeof b.size === 'number' ? `${(b.size / 1048576).toFixed(2)} MB` : '' }; } catch { return { name: '—', size: '' }; } };
    const activityName = (activityId: string) => list.data?.items.find(item => item.activityId === activityId)?.name || (activity?.activityId === activityId ? activity.name : '') || '原活动';
    const acknowledgeUpload = (record: H4Command) => { void acknowledgeH4Upload(record).catch(cause => setNotice(displayAdminError(cause))); };
    const heading = screen === 'list' ? ['活动中心', '管理促销与邀请推广活动，跟进配置、投放及未完成奖励。'] : screen === 'edit' ? [`配置活动 · ${['基本信息', '参与资格', '购机赠奖', '预算与叠加'][editStep]}`, '设置参与条件、逐设备奖励与预算政策。'] : screen === 'review' ? ['试算、审核与发布', '先试算确认没有问题，再分别审核和发布。'] : screen === 'detail' ? [activity?.name || '活动详情', '已发布规则与改版草稿分开呈现，旧订单继续按原版本履行。'] : screen === 'rewards' ? ['奖励台账', '逐项核对奖励承诺与发放凭证；结果未知时先核账。'] : ['活动效果', '查看同一次统计的成交、退款与奖励成本。'];
    const listTab: ListTab = old ? `legacy-${legacySection}` : tab;
    const chooseTab = (next: ListTab) => { if (next.startsWith('legacy-')) { setLegacySection(next.slice(7) as LegacySection); setOld(true); return; } setTab(next as typeof tab); setOld(false); };
    const tabItems: PageTabItem<ListTab>[] = [
        { value: 'promotions', label: '促销活动', count: list.data ? list.data.total : undefined },
        { value: 'rewards', label: '奖励台账', count: list.data ? list.data.summary.unresolved : undefined },
        { value: 'policies', label: '政策' },
        { value: 'legacy-events', label: '既有活动' },
        { value: 'legacy-plays', label: '玩法与抽奖' },
        { value: 'legacy-wheel', label: '转盘奖池' },
    ];
    const submitFilters = () => { const q: Record<string, string | number> = { limit: 20, query: filters.query, category: filters.category, template: filters.template, state: filters.state, sort: filters.sort }; if (filters.from && filters.to)
        Object.assign(q, { from: filters.from, to: filters.to, timezone: filters.timezone }); setQuery(q); setPrevious([]); };
    const editReason = (p: PromotionListItem) => !can('growth_promotion_edit') ? '没有编辑权限' : p.draftVersionState !== 'DRAFT' ? (p.draftVersion ? `候选 v${p.draftVersion} ${labelState(p.draftVersionState || 'DRAFT')}，撤回后才能编辑` : '没有候选草稿，先在详情里创建改版草稿') : undefined;
    const rewardsReason = can('growth_promotion_reward_read') ? undefined : '没有查看奖励的权限';
    const moreItems = (p: PromotionListItem): MoreMenuItem[] => [
        { key: 'rewards', label: '奖励台账', disabledReason: rewardsReason, onSelect: () => navigate('rewards', p.activityId) },
        { key: 'copy', label: '复制', disabledReason: can('growth_promotion_edit') ? undefined : '没有编辑权限', onSelect: () => setCopy(p) },
        ...(can('growth_promotion_archive') ? [{ key: 'delete', label: '删除', danger: true, disabledReason: deleteLoading ? '正在读取活动状态' : !isDeletablePromotion(p) ? '只有草稿或已结束的活动可以删除' : undefined, onSelect: () => void openDelete(p.activityId) }] : []),
    ];
    const filterCount = [filters.from && filters.to, filters.sort !== 'UPDATED_DESC'].filter(Boolean).length;
    const promotionsPanel = <Panel title="促销活动" icon={Megaphone} tone="role-3" sub={list.data ? `共 ${list.data.total} 个` : undefined} explain="每张卡是一个活动：上面是线上版本和候选版本，中间是时间走到哪、预算用了多少，底部是待处理的奖励和操作。">
        <FilterBar onSubmit={submitFilters} querying={list.loading} moreCount={filterCount}
            sort={<span className="h4-filter-zone">筛选时间按 {zoneLabel(filters.timezone)}</span>}
            more={<>
                <FilterField label="时区"><Select aria-label="时区" value={filters.timezone} onChange={v => setFilters({ ...filters, timezone: v })} options={[{ value: 'Asia/Tokyo', label: '日本时间 · UTC+9' }, { value: 'UTC', label: '协调世界时 · UTC' }, { value: 'Asia/Ho_Chi_Minh', label: '越南时间 · UTC+7' }]}/></FilterField>
                <FilterField label="排序"><Select aria-label="排序" value={filters.sort} onChange={v => setFilters({ ...filters, sort: v })} options={[{ value: 'UPDATED_DESC', label: '最近更新' }, { value: 'NAME_ASC', label: '活动名称' }, { value: 'STARTS_ASC', label: '开始时间' }]}/></FilterField>
                <FilterField wide label="活动时间（两端都填才生效）"><span className="rd-filter-range">{(['from', 'to'] as const).map((key, i) => <H4DateTimeField key={key} label={i ? '窗口结束' : '窗口开始'} timeZone={filters.timezone} value={dateInput(filters[key], filters.timezone)} onChange={value => { try {
                    setFilters({ ...filters, [key]: utcInput(value, filters.timezone) || '' });
                }
                catch (e) {
                    setNotice(e instanceof Error ? e.message : '日期选择无效');
                } }}/>)}</span></FilterField>
            </>}>
            <FilterField grow><Input aria-label="名称 / 活动编号" placeholder="名称 / 活动编号" value={filters.query} maxLength={200} onChange={e => setFilters({ ...filters, query: e.target.value })}/></FilterField>
            <FilterField><Select aria-label="类别" value={filters.category} onChange={v => setFilters({ ...filters, category: v })} options={[{ value: '', label: '全部类别' }, { value: 'PROMOTION', label: '促销' }, { value: 'REFERRAL', label: '邀请推广' }]}/></FilterField>
            <FilterField><Select aria-label="模板" value={filters.template} onChange={v => setFilters({ ...filters, template: v })} options={[{ value: '', label: '全部模板' }, ...Object.entries(TEMPLATE_LABELS).map(([v, label]) => ({ value: v, label }))]}/></FilterField>
            <FilterField><Select aria-label="活动状态" value={filters.state} onChange={v => setFilters({ ...filters, state: v })} options={[{ value: '', label: '全部状态' }, ...['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'].map(v => ({ value: v, label: labelState(v) }))]}/></FilterField>
        </FilterBar>
        {list.loading ? <Loading /> : list.error ? <ReadError target="活动列表" error={list.error} retry={reloadList}/> : !list.data?.items.length ? <Empty title="还没有匹配的活动" action={<Button disabled={!can('growth_promotion_edit') || !catalog.data} onClick={() => setCreating(true)}>新建活动</Button>}>从五种模板开始，逐步保存配置；未批准政策不能发布。</Empty> : <><ZoneSwitch beijing={beijing} onChange={setBeijing} zones={list.data.items.map(i => i.displayTimezone || 'UTC')}/><div className="h4-cards">{list.data.items.map(p => <PromotionCard key={p.activityId} zone={displayZone} item={p} catalog={catalog.data} onDetail={() => navigate('detail', p.activityId)} onEdit={() => navigate('edit', p.activityId)} onRewards={() => navigate('rewards', p.activityId)} editDisabled={editReason(p)} rewardsDisabled={rewardsReason} more={moreItems(p)}/>)}</div></>}
        {list.data && !list.loading && <div className="h4-pager"><span>共 <span className="h4-num">{list.data.total}</span> 个 · 每页 20 个 · 数据时间 <span className="h4-num">{formatTime(list.data.asOf, 'Asia/Shanghai')}</span>（北京时间）</span><span className="h4-row"><Button disabled={!previous.length} onClick={() => { setQuery(previous.at(-1)!); setPrevious(previous.slice(0, -1)); }}>上一页</Button><Button disabled={!list.data.hasMore} onClick={() => { setPrevious([...previous, { ...query, querySnapshot: list.data!.querySnapshot }]); setQuery({ ...query, querySnapshot: list.data!.querySnapshot, cursor: list.data!.nextCursor! }); }}>下一页</Button></span></div>}
    </Panel>;
    const rewardsPanel = <Panel title="奖励台账" icon={Gift} tone="role-2" sub={list.data ? `本页 ${list.data.items.length} 个活动` : undefined} explain="奖励台账按活动查看：点一个活动进入它的台账，按订单、资产、受益账户和状态筛选，逐笔处置。台账里「整单奖励」能看同一订单在所有活动下的奖励。">
        {list.loading ? <Loading /> : list.error ? <ReadError target="活动列表" error={list.error} retry={reloadList}/> : !list.data?.items.length ? <Empty title="还没有活动，也就没有奖励"/> : <RewardEntries items={list.data.items} allowed={can('growth_promotion_reward_read')} onOpen={id => navigate('rewards', id)}/>}
    </Panel>;
    const policiesPanel = !can('growth_promotion_policy_read') ? <BlockState state="denied" title="没有查看政策的权限" detail="政策列表需要「促销政策查看」权限。"/> : catalog.error ? <ReadError target="活动目录与批准政策" error={catalog.error} retry={catalog.reload}/> : !catalog.data ? <Loading/> : <PromotionPolicies inline catalog={catalog.data} can={can} onClose={() => chooseTab('promotions')} onChanged={catalog.reload}/>;
    const listScreen = <>
        {!old && list.data && pageReady && <PromotionOverview page={list.data} pendingCount={pendingItems.length} catalog={catalog.data} rewardsAllowed={can('growth_promotion_reward_read')} onOpenRewards={id => navigate('rewards', id)} onOpenDetail={id => navigate('detail', id)}/>}
        <PageTabs label="活动中心分区" value={listTab} items={tabItems} onChange={chooseTab} ids={tabIds}/>
        <div role="tabpanel" id={tabIds.panelId(listTab)} aria-labelledby={tabIds.tab(listTab)} className="h4-tabpanel">
            {old ? legacy(legacySection, (next: LegacySection) => setLegacySection(next))
                : listTab === 'policies' ? policiesPanel
                : !pageReady && (pageLoading || readErrors.length > 0) ? <PromotionReadPanel title="活动中心" loading={readErrors.length === 0} errors={readErrors}/>
                : listTab === 'rewards' ? rewardsPanel : promotionsPanel}
        </div>
    </>;
    return <div className="h4-page" data-promotion-screen={screen}>
    <PageHeader pageId="H4" title={heading[0]} summary={heading[1]} back={screen !== 'list' && (screen !== 'edit' || !pageReady) ? <button type="button" className="rd-link h4-back" onClick={() => navigate('list')}><ArrowLeft size={14} aria-hidden/>返回活动列表</button> : undefined}
        actions={<>{screen !== 'list' && can('growth_promotion_policy_read') && catalog.data && <Button onClick={() => setPoliciesOpen(true)}>政策与原业务协议</Button>}{screen === 'list' && listTab === 'promotions' && <Button variant="primary" icon={<Plus size={14} aria-hidden/>} disabledReason={!can('growth_promotion_edit') ? '没有新建活动的权限' : !catalog.data ? '活动目录还没读到' : undefined} onClick={() => setCreating(true)}>新建活动</Button>}</>}/>
    {screen !== 'list' && activity?.deleted && <Notice tone="warn" title="活动已删除">活动配置仅供历史查阅，不能编辑、复制、试算或重新发布。历史订单和奖励继续履行，仍可查看奖励台账与活动效果。</Notice>}
    <PendingList items={pendingItems} onOpen={setPending}/>
    {recoveredUploads.length > 0 && <Notice tone="neutral" title={`${recoveredUploads.length} 张图片已经上传成功，还没保存`} actionBelow action={<ul className="h4-pending">{recoveredUploads.map(record => {
        const file = uploadFile(record), target = record.uploadTarget, state = record.restoration;
        const place = !target ? '' : target.kind === 'banner' ? `「${activityName(target.objectId)}」v${target.version} 草稿的宣传图` : `奖励「${EVIDENCE_OP[target.operation] ?? '处置'}」的证据`;
        const tag = !target ? <StatusTag tone="neutral">要重新选</StatusTag> : state.restored ? <StatusTag tone="ok">已填回草稿</StatusTag> : state.canAutoRestore ? <StatusTag tone="progress">等你打开</StatusTag> : <StatusTag tone="warn">没能填回</StatusTag>;
        const line = !target ? '旧记录没记下用在哪，回原处重新选这个文件。'
            : state.restored ? (target.kind === 'banner' ? '已填回，还没保存；去草稿里保存后再移除这条。' : '已填回，还没提交；提交后再移除这条。')
            : state.canAutoRestore ? (target.kind === 'banner' ? '打开这个草稿时自动填回，填回后要保存。' : '打开这个确认框、选上传证据时自动填回。')
            : `${restoreReason(state.reason, target.kind)}；需要的话回原处重新选这个文件。`;
        return <li key={record.commandKey}>
        <span className="h4-pending-what"><b>{record.action}{place && ` · ${place}`}</b><span className="h4-pending-change">{file.name}{file.size && ` · ${file.size}`}</span><span className="h4-pending-change">{line}</span></span>
        <span className="h4-pending-when">提交于 <span className="h4-num">{formatTime(new Date(record.createdAt).toISOString(), 'Asia/Shanghai')}</span>（北京时间）</span>
        {tag}
        <span className="h4-pending-actions">{target?.kind === 'banner' && (state.restored || state.canAutoRestore) && <Button size="sm" onClick={() => { changeStep(0); navigate('edit', target.objectId); }}>{state.restored ? '去保存' : '去填回'}</Button>}<Button size="sm" variant={target?.kind === 'banner' && (state.restored || state.canAutoRestore) ? 'ghost' : undefined} onClick={() => acknowledgeUpload(record)}>{state.restored ? '已保存，移除' : !target || !state.canAutoRestore ? '已重新选好，移除' : '不用了，移除'}</Button></span>
    </li>; })}</ul>}>填回只进草稿，保存后才算用上。</Notice>}
    {screen === 'list' && !old && legacyUnknown > 0 && <Notice tone="warn" title={uploadUnknown === legacyUnknown ? `${legacyUnknown} 张图片上传结果未知` : uploadUnknown > 0 ? `${legacyUnknown} 个操作结果未知（含 ${uploadUnknown} 张图片上传）` : `既有活动和转盘有 ${legacyUnknown} 个操作结果未知`} action={<Button size="sm" onClick={() => chooseTab('legacy-events')}>去查询原结果</Button>}>原操作和查询入口在「既有活动」页签顶部。</Notice>}
    {notice && <Notice tone="neutral" title="操作反馈" action={deletedId ? <Button size="sm" onClick={() => navigate('detail', deletedId)}>查看历史记录</Button> : undefined}>{notice}</Notice>}
    {screen === 'list' ? listScreen : !pageReady && (pageLoading || readErrors.length > 0) ? <>{screen === 'edit' && <PromotionSteps step={editStep} onStep={changeStep} disabled/>}<PromotionReadPanel title={screen === 'edit' ? ['基本信息', '参与资格', '购机赠奖', '预算与叠加'][editStep] : heading[0]} loading={readErrors.length === 0} errors={readErrors}/></> : <>
    {pageReady && readErrors.map(item => <ReadError key={item.target} {...item}/>)}
    {!activity || activity.activityId !== id || !catalog.data ? <Empty title="活动资料尚未就绪" action={<Button onClick={() => navigate('list')}>返回列表</Button>}/> : <>{screen === 'edit' && activity.current && <PromotionEditor key={activity.activityId} activity={activity} catalog={catalog.data} can={can} onSaved={refresh} initialStep={editStep} onStep={changeStep} onBack={() => navigate('detail')} onReview={() => navigate('review')}/>}{(screen === 'detail' || screen === 'review') && <PromotionReview key={`${id}:${screen}`} activity={activity} catalog={catalog.data} can={can} onRefresh={async () => { await refresh(); }} onReload={setActivity} onCandidateConflict={() => { setNotice('内容已变化，本次未执行。请核对刷新后的候选内容，再重新打开确认。'); retryActivity(); }} onCopyCreated={afterCreate} onEdit={() => navigate('edit')} onRewards={() => navigate('rewards')} onMetrics={() => navigate('metrics')} onBack={() => navigate('detail')} review={screen === 'review'} displayZone={displayZone} zoneSwitch={<ZoneSwitch beijing={beijing} onChange={setBeijing} zones={[activity.displayTimezone || 'UTC']}/>} detailActions={screen === 'detail' ? <><Button variant="primary" disabledReason={activity.deleted ? '活动已删除' : !activity.draftVersion ? '没有候选版本，先创建改版草稿' : undefined} onClick={() => navigate('review')}>试算与审核</Button><Button disabledReason={rewardsReason} onClick={() => navigate('rewards')}>奖励台账</Button>{can('growth_promotion_archive') && <Button variant="danger-outline" disabledReason={deleteLoading ? '正在读取活动状态' : !isDeletablePromotion(activity) ? '只有草稿或已结束的活动可以删除' : undefined} onClick={() => void openDelete(activity.activityId)}>删除活动</Button>}</> : undefined}/>}{screen === 'rewards' && (can('growth_promotion_reward_read') ? <PromotionRewards activity={activity} catalog={catalog.data} can={can} onRefresh={async () => { await refresh(); }} onBack={() => navigate('detail')}/> : <BlockState state="denied" title="无奖励查看权限" detail="请返回活动详情。"/>)}{screen === 'metrics' && (can('growth_promotion_metrics_read') ? <PromotionMetrics activity={activity} catalog={catalog.data} can={can} onBack={() => navigate('detail')} recoveredExportId={recoveredExport?.activityId === activity.activityId ? recoveredExport.exportId : undefined} onRecoveredExportRead={() => setRecoveredExport(null)}/> : <BlockState state="denied" title="无报表查看权限" detail="请返回活动详情。"/>)}</>}
    </>}
    {policiesOpen && catalog.data && <PromotionPolicies catalog={catalog.data} can={can} onClose={() => setPoliciesOpen(false)} onChanged={catalog.reload}/>}
    {creating && !template && <Dialog title="选择活动模板" wide onClose={() => setCreating(false)} footer={<Button onClick={() => setCreating(false)}>取消</Button>}><p className="h4-lede">模板只创建配置结构，业务金额、资格、预算与政策均由运营明确填写。</p><div className="h4-templates">{Object.entries(TEMPLATE_LABELS).map(([v, label]) => <button type="button" key={v} className="h4-template" onClick={() => setTemplate(v as Template)}><b>{label}</b><span>{TEMPLATE_HINTS[v as Template]}</span></button>)}</div></Dialog>}
    {template && <ConfirmCommand writeAllowed={can('growth_promotion_edit')} title={`新建${TEMPLATE_LABELS[template]}`} confirmLabel="创建草稿" sub={<StatusTag tone="progress" filled>立即创建草稿</StatusTag>} intent={{ operation: 'createPromotion', targetId: 'promotions', path: '/promotions', method: 'POST' }} body={{ draft: emptyDraft(template) }} onClose={() => setTemplate(null)} onSettled={() => setCreating(false)} onSuccess={afterCreate}><Summary rows={[['模板', TEMPLATE_LABELS[template]], ['类别', template === 'DIRECT_REFERRAL' ? '邀请推广' : '促销'], ['创建后', '进入四步填写的第一步']]}/><OldNotice title="创建部分草稿">先创建可继续配置的活动，尚未提交审核或对外开放。</OldNotice></ConfirmCommand>}
    {deleting && <ConfirmCommand writeAllowed={can('growth_promotion_archive') && isDeletablePromotion(deleting)} danger confirmLabel="删除活动" sub={<IrreversibleTag/>} title={`删除活动 · ${deleting.name || deleting.activityId}`} intent={{ operation: 'deletePromotion', targetId: deleting.activityId, path: `/promotions/${encodeURIComponent(deleting.activityId)}/delete`, method: 'POST' }} body={promotionDeleteBody(deleting)} onClose={() => setDeleting(null)} onSuccess={afterDelete}><Summary rows={[['活动', deleting.name || deleting.activityId], ['当前状态', labelState(deleting.state)], ['候选版本', deleting.draftVersion ? `v${deleting.draftVersion}` : '无'], ['未完成奖励', deleting.impact.unfulfilledRewards]]}/><OldNotice title="删除后移出活动中心" kind="warn">仅草稿或已结束活动可以删除。历史订单、奖励权益和操作记录继续保留；系统内置的五种模板不受影响。删除后仍可通过历史活动详情处理奖励与查看效果。</OldNotice><p className="h4-lede">和「归档」不同：归档要求没有在途奖励、留在列表里可查；删除后列表里不再出现，也不能再编辑、复制或发布。</p></ConfirmCommand>}
    {copy && <ConfirmCommand writeAllowed={can('growth_promotion_edit')} title="复制为新活动" confirmLabel="复制为新活动" sub={<StatusTag tone="progress" filled>立即创建草稿</StatusTag>} intent={{ operation: 'copyPromotion', targetId: copy.activityId, path: `/promotions/${copy.activityId}/copies`, method: 'POST' }} body={{ expectedRevision: copy.revision, evidenceRefs: [] }} onClose={() => setCopy(null)} onSuccess={afterCreate}><Summary rows={[['原活动', copy.name || copy.activityId], ['复制内容', '当前配置'], ['不复制', '审批、累计使用量、订单']]}/><OldNotice title="仅复制配置">原活动 {copy.name || copy.activityId} 的审批、累计使用量与订单不会转到新活动。</OldNotice></ConfirmCommand>}
    {pending && <ConfirmCommand writeAllowed={!!PROMOTION_COMMAND_PERMISSIONS[pending.operation] && ctx.can('growth_promotion_'+PROMOTION_COMMAND_PERMISSIONS[pending.operation])} title="查询原结果" intent={pending} body={pending.body as Record<string, unknown>} onClose={() => setPending(null)} onSuccess={async (result, isCurrent) => { setNotice('原操作已确认成功，正在更新活动资料。');
        const hasOtherOperation = () => { const current = ongoing.current; return !!(current.creating || current.template || current.copy || current.deleting || current.policiesOpen || current.screen === 'edit'); };
        if ((pending.operation === 'createPromotion' || pending.operation === 'copyPromotion') && !hasOtherOperation()) {
            await afterCreate(result, () => isCurrent() && !hasOtherOperation());
            return;
        }
        if (pending.operation === 'deletePromotion' && !hasOtherOperation() && (!ongoing.current.id || ongoing.current.id === pending.targetId)) { afterDelete(result, isCurrent); return; }
        if (pending.operation === 'createExport') {
            if (result.resource?.type !== 'EXPORT') throw new Error('导出结果暂无法确认，请核查原操作。');
            setRecoveredExport({ activityId: pending.targetId, exportId: result.resource.id });
        }
        if (id) await refresh();
        else reloadList();
    }}><Summary rows={[['原操作', OPERATION_LABELS[pending.operation] || '促销操作'], ['对象', pending.targetId], ['提交时间', `${formatTime(new Date(pending.createdAt).toISOString(), 'Asia/Shanghai')}（北京时间）`]]}/><OldNotice title="原参数保留">本操作只核查或原样恢复之前的操作记录，不修改目标与原始参数。</OldNotice></ConfirmCommand>}
  </div>;
}
const TEMPLATE_HINTS: Record<Template, string> = { SKU_GIFT: '买指定设备，送设备或奖励', FIRST_PURCHASE: '第一次购机的用户得奖励', DIRECT_REFERRAL: '被直接邀请的人首购，双方都得奖励', MULTI_PRODUCT: '同一单买齐几种型号才给奖励', REPURCHASE: '上次购机后隔一段时间再买' };
