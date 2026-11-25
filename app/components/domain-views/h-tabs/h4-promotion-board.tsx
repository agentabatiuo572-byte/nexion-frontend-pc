"use client";
/**
 * H4 活动中心的首屏件：结果未知逐条提醒、「现在有什么在等我」、活动卡片、奖励台账入口。
 * 只读父组件已经读到的数据（列表一页、本机待确认记录），不发请求；动作全部回调父组件原有的处理函数。
 */
import type { ReactNode } from 'react';
import { AlarmClock, CalendarRange, CircleAlert, FileClock, Gift, ListChecks, Megaphone, Users, Wallet } from 'lucide-react';
import { Button, ChartLegend, Conclusion, Explain, MoreMenu, Notice, Panel, RatioBar, SegmentBar, Stat, StatBand, StatusTag, type MoreMenuItem } from '@/app/components/rd';
import type { AudiencePreview, Budget, Catalog, Draft, PromotionListItem, PromotionPage } from '@/lib/admin/promotion-types';
import type { PendingPromotion } from '@/lib/admin/promotion-client';
import { TEMPLATE_LABELS, amountText, formatTime, labelState, stateTone, text, zoneLabel } from './h4-promotion-ui';

export const OPERATION_LABELS: Record<string, string> = { createPromotion: '新建活动', saveDraft: '保存活动草稿', copyPromotion: '复制为新活动', createDraftVersion: '创建改版草稿', submitPromotion: '提交审核', withdrawPromotion: '撤回审核', approvePromotion: '审核确认', rejectPromotion: '驳回候选版本', publishPromotion: '发布', pausePromotion: '暂停新预留', resumePromotion: '恢复新预留', endPromotion: '终止活动', archivePromotion: '归档活动', deletePromotion: '删除活动', retryReward: '重试原奖励项', reconcileReward: '核查原结果', cancelReward: '取消原奖励项', reverseReward: '发起冲正', resolveReward: '异常审阅', createExport: '导出当前报表', createPolicy: '新建政策草稿', approvePolicy: '批准政策', revokePolicy: '撤销政策' };

export { amountText };
export const Amount = ({ value, unit }: { value: string | number | null | undefined; unit?: string }) => value === null || value === undefined || value === '' ? <span className="h4-dim">未提供</span> : <span className="h4-num" title={String(value)}>{amountText(value, unit === '台')}{unit ? ` ${unit}` : ''}</span>;

/** 预算的资产名：设备按商品名，立减写清是订单立减。 */
export const budgetName = (budget: Pick<Budget, 'asset' | 'productNo'>, catalog: Catalog | null) => budget.asset === 'DEVICE' ? `赠品 · ${text(catalog?.skus.find(s => s.productNo === budget.productNo)?.name) === '未提供' ? budget.productNo || '设备' : text(catalog?.skus.find(s => s.productNo === budget.productNo)?.name)}` : budget.asset === 'DISCOUNT_USDT' ? '订单立减' : budget.asset;
const budgetUnit = (asset: Budget['asset']) => asset === 'DEVICE' ? '台' : asset === 'DISCOUNT_USDT' ? 'USDT' : asset;

/** 一项预算画成一条：已发出（扣除已冲正）、已预留（含已付款待发）、剩余，三段合起来就是总额。 */
export function BudgetBar({ budget, catalog, compact = false }: { budget: Budget; catalog: Catalog | null; compact?: boolean }) {
    const unit = budgetUnit(budget.asset);
    const total = Number(budget.total), held = Number(budget.reserved) + Number(budget.committed), spent = Number(budget.issued) - Number(budget.reversed), left = Number(budget.available);
    const invalid = [total, held, spent, left].some(v => !Number.isFinite(v) || v < 0) || Math.abs(held + spent + left - total) > 1e-6 * Math.max(1, total);
    const name = budgetName(budget, catalog);
    return <div className="h4-budget" data-compact={compact ? '' : undefined}>
        <div className="h4-budget-head"><span className="h4-budget-name">{name}</span><span className="h4-budget-left">剩余 <Amount value={budget.available} unit={unit === '台' ? '台' : undefined}/> <span className="h4-dim">/ 总额 <Amount value={budget.total} unit={unit}/></span></span></div>
        {total === 0 ? <span className="h4-dim">总额为 0，不能再预留</span> : invalid ? <span className="rd-gfx-note" data-kind="problem">预算各项对不上总额，没有画图，请联系值班人员核对</span> : <SegmentBar label={`${name}预算`} legend={compact ? false : undefined} segments={[
            { key: 'spent', label: '已发出', value: spent * 100 / total, slot: 2, text: `已发出 ${amountText(budget.issued, budget.asset === 'DEVICE')}（已冲正 ${amountText(budget.reversed, budget.asset === 'DEVICE')} 退回预算）` },
            { key: 'held', label: '已预留', value: held * 100 / total, slot: 3, text: `已预留 ${amountText(budget.reserved, budget.asset === 'DEVICE')}，已付款待发 ${amountText(budget.committed, budget.asset === 'DEVICE')}` },
            { key: 'left', label: '剩余', value: left * 100 / total, slot: 'other', text: `剩余 ${amountText(budget.available, budget.asset === 'DEVICE')} ${unit}` },
        ]}/>}
    </div>;
}

/** 预算剩余不到一成算「快用完」：这是这页的提醒线，写在问号里，不是后端规则。 */
export const nearlyOut = (budget: Budget) => Number(budget.total) > 0 && Number(budget.available) / Number(budget.total) < 0.1;
const DAY = 86400000;
function windowInfo(item: Pick<PromotionListItem, 'startsAt' | 'endsAt' | 'serverTime'>) {
    if (!item.startsAt || !item.endsAt) return null;
    const start = Date.parse(item.startsAt), end = Date.parse(item.endsAt), now = Date.parse(item.serverTime);
    if (![start, end, now].every(Number.isFinite) || end <= start) return null;
    const days = (ms: number) => ms < DAY ? `${Math.max(1, Math.ceil(ms / 3600000))} 小时` : `${Math.ceil(ms / DAY)} 天`;
    if (now < start) return { elapsed: 0, total: end - start, text: `还有 ${days(start - now)}开始，共 ${days(end - start)}` };
    if (now >= end) return { elapsed: end - start, total: end - start, text: `时间已走完，共 ${days(end - start)}` };
    return { elapsed: now - start, total: end - start, text: `已过 ${days(now - start)}，还剩 ${days(end - now)}` };
}

export function TimeWindow({ item, zone: shown }: { item: Pick<PromotionListItem, 'startsAt' | 'endsAt' | 'serverTime' | 'displayTimezone'>; zone?: string }) {
    const zone = shown || item.displayTimezone || 'UTC', info = windowInfo(item);
    return <div className="h4-window">
        <div className="h4-window-dates"><span className="h4-num">{formatTime(item.startsAt, zone)}</span><span aria-hidden>→</span><span className="h4-num">{formatTime(item.endsAt, zone)}</span></div>
        {info ? <RatioBar label="活动时间走到哪" value={info.elapsed} total={info.total} valueText={info.text} tone="role-3" quiet/> : <span className="h4-dim">时间未配置</span>}
        {info && <span className="h4-window-text">{info.text}</span>}
    </div>;
}

/** 生命周期和候选版本的审核状态是两件事，分开画（V02）。 */
export function VersionLine({ item }: { item: Pick<PromotionListItem, 'activeVersion' | 'draftVersion' | 'draftVersionState'> }) {
    return <div className="h4-versions">
        <span className="h4-version">{item.activeVersion ? <>线上 <b className="h4-num">v{item.activeVersion}</b></> : <span className="h4-dim">还没有线上版本</span>}</span>
        {item.draftVersion ? <StatusTag tone={stateTone(item.draftVersionState || 'DRAFT')} icon={FileClock}>{`候选 v${item.draftVersion} · ${labelState(item.draftVersionState || 'DRAFT')}`}</StatusTag> : <span className="h4-dim">没有候选版本</span>}
    </div>;
}

export function PromotionCard({ item, catalog, onDetail, onEdit, onRewards, more, editDisabled, rewardsDisabled, zone }: {
    /** 页面上选了「按北京时间看」时传 Asia/Shanghai，只改显示。 */
    zone?: string;
    item: PromotionListItem;
    catalog: Catalog | null;
    onDetail: () => void;
    onEdit: () => void;
    onRewards: () => void;
    more: MoreMenuItem[];
    editDisabled?: ReactNode;
    rewardsDisabled?: ReactNode;
}) {
    const budgets = item.impact.budgets, shown = budgets.slice(0, 2);
    return <article className="h4-card" aria-label={item.name || '未命名草稿'}>
        <header className="h4-card-head">
            <div className="h4-card-title">
                <h3>{item.name || '未命名草稿'}</h3>
                <span className="h4-card-meta"><span className="h4-card-kind">{item.category === 'PROMOTION' ? '促销' : '邀请推广'} · {TEMPLATE_LABELS[item.template]}</span><span className="h4-mono" title={item.activityId}>{item.activityId}</span></span>
            </div>
            <StatusTag tone={stateTone(item.state)}>{labelState(item.state)}</StatusTag>
        </header>
        <VersionLine item={item}/>
        <section className="h4-card-block" aria-label="活动时间">
            <span className="h4-block-label"><CalendarRange size={14} aria-hidden/>活动时间 · {zoneLabel(zone || item.displayTimezone)}</span>
            <TimeWindow item={item} zone={zone}/>
        </section>
        <section className="h4-card-block" aria-label="预算">
            <span className="h4-block-label"><Wallet size={14} aria-hidden/>预算{budgets.length > 2 ? <span className="h4-dim"> · 另有 {budgets.length - 2} 项在详情里</span> : null}</span>
            {shown.length ? shown.map(b => <BudgetBar key={`${b.asset}:${b.productNo ?? ''}`} budget={b} catalog={catalog} compact/>) : <span className="h4-dim">还没有配置预算</span>}
            {shown.length > 0 && <ChartLegend items={[{ key: 'spent', label: '已发出', slot: 2 }, { key: 'held', label: '已预留', slot: 3 }, { key: 'left', label: '剩余', slot: 'other' }]}/>}
        </section>
        <footer className="h4-card-foot">
            <button type="button" className="h4-unresolved" data-tone={item.unresolved > 0 ? 'warn' : undefined} disabled={!!rewardsDisabled} title={typeof rewardsDisabled === 'string' ? rewardsDisabled : undefined} onClick={onRewards}>
                {item.unresolved > 0 ? <><CircleAlert size={14} aria-hidden/><b className="h4-num">{item.unresolved}</b> 项奖励待处理</> : <><ListChecks size={14} aria-hidden/>奖励没有待处理</>}
            </button>
            <span className="h4-card-actions">
                <Button size="sm" variant="ghost" disabledReason={editDisabled} onClick={onEdit}>编辑草稿</Button>
                <Button size="sm" onClick={onDetail}>详情</Button>
                <MoreMenu label={`${item.name || '未命名草稿'}的更多操作`} items={more}/>
            </span>
        </footer>
    </article>;
}

/** 新建活动、新建政策的原请求对象是集合名（promotions、promotion-policies），不是某个活动编号，不显示。 */
const COLLECTION_TARGETS = new Set(['promotions', 'promotion-policies']);
/** 结果未知逐条列：改的是什么、对哪个对象、什么时候提交的；按钮打开原确认框，只查询或按原操作重试。 */
export function PendingList({ items, onOpen }: { items: PendingPromotion[]; onOpen: (item: PendingPromotion) => void }) {
    if (!items.length) return null;
    return <Notice tone="warn" title={`有 ${items.length} 个操作结果未知`} actionBelow action={<ul className="h4-pending">{items.map(p => <li key={p.commandKey}>
        <span className="h4-pending-what"><b>{OPERATION_LABELS[p.operation] || '促销操作'}</b>{!COLLECTION_TARGETS.has(p.targetId) && <span className="h4-mono" title={p.targetId}>{p.targetId}</span>}</span>
        <span className="h4-pending-when">提交于 <span className="h4-num">{formatTime(new Date(p.createdAt).toISOString(), 'Asia/Shanghai')}</span>（北京时间）</span>
        <StatusTag tone="warn">{p.receipt ? '已成功，待读回' : '结果未知'}</StatusTag>
        <Button size="sm" onClick={() => onOpen(p)}>查询原结果</Button>
    </li>)}</ul>}>关闭或刷新页面不会重新提交。先查询原结果，查不到时才可以按原操作重试。</Notice>;
}

/** 首屏：一句结论 + 四个数 + 等我处理。数都来自列表接口的 summary 和这一页的活动。 */
export function PromotionOverview({ page, pendingCount, catalog, onOpenRewards, onOpenDetail, rewardsAllowed }: {
    page: PromotionPage;
    pendingCount: number;
    catalog: Catalog | null;
    onOpenRewards: (id: string) => void;
    onOpenDetail: (id: string) => void;
    rewardsAllowed: boolean;
}) {
    const s = page.summary;
    const reviewing = page.items.filter(p => p.draftVersionState === 'PENDING_APPROVAL' || p.draftVersionState === 'APPROVED');
    const troubled = page.items.filter(p => p.unresolved > 0).sort((a, b) => b.unresolved - a.unresolved);
    const short = page.items.filter(p => ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(p.state)).flatMap(p => p.impact.budgets.filter(nearlyOut).map(b => ({ item: p, budget: b })));
    // 结果未知的几条由上方的提醒逐条说，结论里不再数一遍；只剩它们时也不报绿。
    const waiting = reviewing.length + troubled.length + short.length;
    const sentence = waiting === 0 ? `${s.activeActivities} 个活动进行中${pendingCount > 0 ? '' : '，没有等你处理的事'}` : [s.unresolved > 0 && `${s.unresolved} 项奖励待处理`, reviewing.length > 0 && `${reviewing.length} 个候选版本待审`, short.length > 0 && `${short.length} 项预算快用完`].filter(Boolean).join('，');
    return <>
        <Conclusion state={waiting === 0 ? pendingCount > 0 ? 'neutral' : 'ok' : s.unresolved > 0 ? 'warn' : 'neutral'} lead={waiting > 0} explain={<><p>奖励待处理数是全部匹配活动的合计（失败、结果未知、待追回、人工审阅）。</p><p>候选版本和预算按当前列表这一页的活动统计。剩余不到总额一成算快用完，这是这页的提醒线。</p></>}>
            {sentence}
        </Conclusion>
        <StatBand label="促销活动概况">
            <Stat label="进行中活动" value={s.activeActivities} unit="个" icon={Megaphone} tone="role-3" explain="当前筛选下处于进行中的活动数。"/>
            <Stat label="待处理奖励" value={s.unresolved} unit="项" icon={CircleAlert} tone={s.unresolved > 0 ? 'warn' : undefined} explain="发放失败、结果未知、追回待处理和人工审阅的奖励合计。"/>
            <Stat label="已预留奖励" value={s.reserved} unit="项" icon={Gift} tone="role-2" explain="下单时锁定、等用户付款的奖励项数。"/>
            <Stat label="未付款订单" value={s.unpaidOrders} unit="单" icon={Users} tone="role-2" explain="带活动预留、还没付款的订单；超过原付款截止后释放。"/>
        </StatBand>
        {waiting > 0 && <Panel title="等你处理" icon={AlarmClock} tone="warn" sub={`${waiting} 件`} explain="点一行进入那个活动的详情或奖励台账。处理完回到列表会重新读取。">
            <ul className="h4-todo">
                {reviewing.map(p => <li key={`r-${p.activityId}`}><button type="button" onClick={() => onOpenDetail(p.activityId)}><StatusTag tone="warn" icon={FileClock}>{p.draftVersionState === 'APPROVED' ? '待发布' : '待审核'}</StatusTag><span className="h4-todo-title">{p.name || '未命名草稿'}</span><span className="h4-todo-sub">候选 v{p.draftVersion}{p.activeVersion ? `，线上 v${p.activeVersion} 照常运行` : '，还没有线上版本'}</span></button></li>)}
                {troubled.map(p => <li key={`u-${p.activityId}`}><button type="button" disabled={!rewardsAllowed} onClick={() => onOpenRewards(p.activityId)}><StatusTag tone={p.impact.failedRewards > 0 ? 'danger' : 'warn'}>{p.impact.failedRewards > 0 ? '发放失败' : '奖励待处理'}</StatusTag><span className="h4-todo-title">{p.name || '未命名草稿'}</span><span className="h4-todo-sub"><b className="h4-num">{p.unresolved}</b> 项：失败 {p.impact.failedRewards}、结果未知 {p.impact.unknownRewards}、追回 {p.impact.reversingRewards}、人工审阅 {p.impact.manualReviewRewards}{rewardsAllowed ? '' : '（没有查看奖励的权限）'}</span></button></li>)}
                {short.map(({ item, budget }) => <li key={`b-${item.activityId}-${budget.asset}-${budget.productNo ?? ''}`}><button type="button" onClick={() => onOpenDetail(item.activityId)}><StatusTag tone="warn" icon={Wallet}>预算快用完</StatusTag><span className="h4-todo-title">{item.name || '未命名草稿'}</span><span className="h4-todo-sub">{budgetName(budget, catalog)} 剩余 {amountText(budget.available, budget.asset === 'DEVICE')}，总额 {amountText(budget.total, budget.asset === 'DEVICE')} {budgetUnit(budget.asset)}</span></button></li>)}
            </ul>
        </Panel>}
        <p className="h4-asof">数据时间 <span className="h4-num">{formatTime(page.asOf, 'Asia/Shanghai')}</span>（北京时间）<Explain label="数据时间怎么算" content="列表、统计和这一页的活动来自同一次查询；翻页不重新查，点「查询」才更新。"/></p>
    </>;
}

/** 奖励台账页签：台账按活动看，这里列出每个活动的奖励情况，点进那个活动的台账处理。 */
export function RewardEntries({ items, allowed, onOpen }: { items: PromotionListItem[]; allowed: boolean; onOpen: (id: string) => void }) {
    const sorted = [...items].sort((a, b) => b.unresolved - a.unresolved || b.impact.obligations - a.impact.obligations);
    return <div className="h4-reward-entries">
        {sorted.map(p => <button type="button" key={p.activityId} className="h4-reward-entry" disabled={!allowed} onClick={() => onOpen(p.activityId)}>
            <span className="h4-reward-entry-name"><b>{p.name || '未命名草稿'}</b><StatusTag tone={stateTone(p.state)}>{labelState(p.state)}</StatusTag></span>
            <span className="h4-reward-entry-main" data-tone={p.unresolved > 0 ? 'warn' : undefined}><b className="h4-num">{p.unresolved}</b> 项待处理</span>
            <span className="h4-reward-entry-sub">失败 {p.impact.failedRewards} · 结果未知 {p.impact.unknownRewards} · 追回 {p.impact.reversingRewards} · 人工审阅 {p.impact.manualReviewRewards}</span>
            <span className="h4-reward-entry-sub">已发放 <span className="h4-num">{p.impact.issued}</span> · 已预留 <span className="h4-num">{p.impact.reserved}</span> · 待发 <span className="h4-num">{p.impact.pendingRewards}</span></span>
        </button>)}
    </div>;
}

/** 时间按哪个时区看：默认是每个活动自己的显示时区（编辑第一步选的，UTC／日本／越南），不是北京时间时给一个切换。只改显示，不改筛选和请求。 */
export function ZoneSwitch({ beijing, onChange, zones }: { beijing: boolean; onChange: (beijing: boolean) => void; zones: string[] }) {
    const own = [...new Set(zones)].map(zoneLabel).join('、') || '活动自己的时区';
    return <span className="h4-zone" data-off={beijing ? undefined : ''}>
        {beijing ? <>时间按 <b>北京时间 UTC+8</b> 显示</> : <>时间按活动时区显示（{own}），<b>不是北京时间</b></>}
        <RdButtonLink onClick={() => onChange(!beijing)}>{beijing ? '切回活动时区' : '切到北京时间'}</RdButtonLink>
    </span>;
}
function RdButtonLink({ onClick, children }: { onClick: () => void; children: ReactNode }) { return <button type="button" className="rd-link h4-zone-switch" onClick={onClick}>{children}</button>; }

/** 四步编辑顶上的只读汇总：只放页面已读到或已填的东西，跟着草稿变。 */
export function EditorSummary({ draft, preview, catalog, onPreview }: { draft: Draft; preview: AudiencePreview | null; catalog: Catalog; onPreview: () => void }) {
    const zone = draft.displayTimezone || undefined;
    const rules = draft.rules || [];
    const assets = [...new Set(rules.flatMap(r => [r.buyerReward?.type, r.inviterReward?.type]).filter(Boolean) as string[])].map(t => t === 'DEVICE' ? '赠品设备' : t === 'DISCOUNT_USDT' ? '订单立减' : t);
    const budgets = (draft.budgets || []).filter(b => b.total != null).map(b => `${b.asset === 'DEVICE' ? `赠品 ${text(catalog.skus.find(s => s.productNo === b.productNo)?.name)}` : b.asset === 'DISCOUNT_USDT' ? '订单立减' : b.asset} ${amountText(b.total, b.asset === 'DEVICE')}${b.asset === 'DEVICE' ? ' 台' : b.asset === 'DISCOUNT_USDT' ? ' USDT' : ''}`);
    const SLOTS = ['settlement', 'stacking', 'refund', 'quote', 'authorization'] as const;
    const refs = SLOTS.map(k => draft.policies?.[k] ?? null);
    const approved = refs.filter(ref => ref && catalog.policies.some(p => p.policyId === ref.policyId && p.version === ref.version && p.state === 'APPROVED')).length;
    const missing = refs.filter(ref => !ref).length;
    const people = preview ? (preview.estimatedAccounts ?? preview.matched) : null;
    return <dl className="h4-summary" aria-label="这个草稿现在是什么样">
        <div><dt>类别和时间</dt><dd>{draft.category === 'REFERRAL' ? '邀请推广' : '促销'} · {TEMPLATE_LABELS[draft.template]}<span>{draft.startsAt && draft.endsAt ? `${formatTime(draft.startsAt, zone)} → ${formatTime(draft.endsAt, zone)}（${zoneLabel(zone)}）` : '时间还没填'}</span></dd></div>
        <div><dt>人群</dt><dd>{preview ? <>{people == null ? '人数未提供' : `约 ${people} 人`}<span>预览于 {formatTime(preview.asOf, zone)}{preview.unknown ? `，${preview.unknown} 人无法判断` : ''}</span></> : <>还没预览<span><button type="button" className="rd-link" onClick={onPreview}>去第二步预览</button></span></>}</dd></div>
        <div><dt>每台设备的奖励</dt><dd>{rules.length ? `${rules.length} 条规则` : '还没加规则'}<span>{assets.length ? assets.join('、') : '奖励还没配'}</span></dd></div>
        <div><dt>预算</dt><dd>{budgets.length ? `${budgets.length} 项` : '还没填'}<span>{budgets.join('；') || '各资产分开填，不相加'}</span></dd></div>
        <div><dt>用到的政策</dt><dd>{`已批准 ${approved} 条`}<span>{missing ? `还缺 ${missing} 条` : refs.length - approved > 0 ? `${refs.length - approved} 条当前不可用` : '五条都已选'}</span></dd></div>
    </dl>;
}
