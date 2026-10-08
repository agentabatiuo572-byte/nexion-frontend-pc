"use client";
import { useState } from 'react';
import { promotionRead, promotionVersions } from '@/lib/admin/promotion-client';
import type { AdminSimulation, AudiencePreview, Catalog, Item, Promotion, Version, VersionPage } from '@/lib/admin/promotion-types';
import { limitText } from '@/lib/admin/promotion-form';
import { Button, Card, ConfirmCommand, Dialog, Field, Notice, ReadError, Stats, Summary, Table, Tag, formatTime, labelState, rewardText, text, useRead } from './h4-promotion-ui';
const ACTIONS: Record<string, {
    label: string;
    operation: string;
    authority: string;
    version: boolean;
    copy: string;
}> = {
    submit: { label: '提交审核', operation: 'submitPromotion', authority: 'submit', version: true, copy: '提交候选版本的不可变配置摘要。当前已发布版本继续运行。' },
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
export default function PromotionReview({ activity, catalog, can, onRefresh, onEdit, onRewards, onMetrics, onBack, review = false }: {
    activity: Promotion;
    catalog: Catalog;
    can: (v: string) => boolean;
    onRefresh: () => Promise<void>;
    onEdit: () => void;
    onRewards: () => void;
    onMetrics: () => void;
    onBack: () => void;
    review?: boolean;
}) {
    const versions = useRead(() => promotionVersions(activity.activityId), [activity.activityId, activity.revision, activity.current?.revision]);
    const [action, setAction] = useState<string | null>(null), [simulation, setSimulation] = useState<AdminSimulation | null>(null), [simOpen, setSimOpen] = useState(false), [reservations, setReservations] = useState(false);
    const current = activity.current, active = versions.data?.items.find(v => v.version === activity.activeVersion), candidate = versions.data?.items.find(v => v.version === activity.draftVersion) || current;
    const blockers = candidate?.policyResolutionErrors || [], impact = activity.impact;
    const missingRanks=[candidate?.draft.buyerAudience,candidate?.draft.inviterAudience].some(a=>a?.rankIds?.some(id=>!catalog.ranks.some(r=>r.id===id)));
    const cannotPublish=blockers.length>0||missingRanks;
    const button = (key: string, disabled = false) => { const a = ACTIONS[key], allowed = can(`growth_promotion_${a.authority}`); return <Button key={key} kind={['publish', 'approve', 'submit', 'resume'].includes(key) ? 'primary' : key === 'end' || key === 'reject' ? 'danger' : ''} disabled={!allowed || disabled} title={!allowed ? '当前账户没有此操作权限' : undefined} onClick={() => setAction(key)}>{a.label}</Button>; };
    const versionSummary = (v: Version | undefined | null) => v ? <><div className="version-heading"><Tag value={v.state}/><span>v{v.version}</span></div><Summary rows={[['活动名称', v.draft.name || '未命名'], ['奖励规则', `${v.draft.rules?.length || 0} 个购买设备`], ['购买者活动上限', limitText(v.draft.perPersonLimit?.buyer)], ['活动截止', formatTime(v.draft.endsAt, v.draft.displayTimezone || 'UTC')]]}/><p className="help">{v.draft.rules?.map(r => rewardText(r.buyerReward)).join('；') || '奖励尚未配置'}</p></> : <Notice title="无此版本">尚未创建或发布。</Notice>;
    return <>{!review && <><Stats items={[['活动状态', labelState(activity.state), activity.activeVersion ? `有效版本 v${activity.activeVersion}` : '尚无已发布版本'], ['改版草稿', activity.draftVersion ? `v${activity.draftVersion}` : '无', '不影响历史订单'], ['未支付预留', impact.unpaidOrders, '按各订单原截止处理'], ['未解决奖励', impact.unresolved, '暂停不能撤销原义务']]}/><div className="grid2"><Card title={`当前已发布${active ? ` · v${active.version}` : ''}`} body>{versionSummary(active)}<p className="help">已锁订单保留原版本和付款截止；暂停与终止不改变原承诺。</p></Card><Card title={activity.draftVersion ? `改版候选 · v${activity.draftVersion}` : '历史与归档依据'} body>{activity.draftVersion ? versionSummary(candidate) : <Summary rows={[['活动状态', labelState(activity.state)], ['未完成义务', impact.unfulfilledRewards], ['未支付订单', impact.unpaidOrders], ['历史查询', '原版本、订单和奖励持续保留']]}/>}<div className="actions" style={{ marginTop: 14 }}>{activity.draftVersion ? <Button onClick={onEdit} disabled={!can('growth_promotion_edit') || candidate?.state !== 'DRAFT'}>编辑草稿</Button> : button('draft-versions', ['ENDED', 'ARCHIVED'].includes(activity.state))}</div></Card></div><Card title="在途承诺与处置影响"><Table headers={['义务范围', '数量', '暂停 / 结束后的处理', '操作']} rows={[['待支付订单', impact.unpaidOrders, '原截止前可按原版本支付', <Button kind="link" onClick={() => setReservations(true)}>查看预留</Button>], ['待发奖励', impact.pendingRewards, '继续按原承诺执行', <Button kind="link" onClick={onRewards}>查看奖励</Button>], ['发放失败 / 结果未知', `${impact.failedRewards} / ${impact.unknownRewards}`, '只恢复原义务；先核查未知结果', <Button kind="link" onClick={onRewards}>查看异常项</Button>]]}/><div className="card-body"><small>事实读取：{formatTime(impact.asOf)}；覆盖同一活动全部版本。</small></div></Card><Card title="活动操作" body><Notice title="仅控制新的投放与预留">既有订单与奖励继续履行，不因暂停或终止批量取消。</Notice><div className="actions">{['ACTIVE', 'SCHEDULED'].includes(activity.state) && button('pause')}{activity.state === 'PAUSED' && button('resume')}{['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(activity.state) && button('end')}{activity.state === 'ENDED' && button('archive', impact.unpaidOrders > 0 || impact.unfulfilledRewards > 0)}{button('copies')}<Button onClick={onMetrics} disabled={!can('growth_promotion_metrics_read')}>查看效果</Button></div>{activity.state === 'ENDED' && (impact.unpaidOrders > 0 || impact.unfulfilledRewards > 0) && <p className="help">还有待支付订单或未完成奖励，暂不可归档。</p>}</Card></>}
    {review && <div className="cols"><div><Card title="待发布版本" body action={<Button onClick={onBack}>查看双版本</Button>}>{versionSummary(candidate)}<Summary rows={[['当前活动', labelState(activity.state)], ['有效版本', activity.activeVersion ? `v${activity.activeVersion}` : '无'], ['公开语言', candidate?.draft.title?.zh && candidate.draft.title.en && candidate.draft.title.vi ? '三种标题均已填写' : '仍有语言缺失']]}/></Card><Card title="试算结果" action={<Button disabled={!can('growth_promotion_simulate') || !candidate} onClick={() => setSimOpen(true)}>重新试算</Button>}>{simulation ? <><Table headers={['购买设备', '资格结果', '奖励承诺', '依据']} rows={simulation.ruleResults.flatMap(r => r.beneficiaries.map(b => [text(catalog.skus.find(s => s.productNo === r.productNo)?.name), labelState(b.status), b.rewardUnits ?? '未知', b.reasons.map(d => text(d.message)).join('；') || '已核对']))}/><div className="card-body"><Summary rows={[['资格', labelState(simulation.eligibility)], ['试算时刻', formatTime(simulation.asOf)], ['赠品成本', '未知'], ['占用真实资格 / 预算', '否']]}/>{simulation.rewardUnits.map((r, i) => <p className="help" key={i}>{text(catalog.skus.find(s => s.productNo === r.productNo)?.name)} 第 {r.purchaseUnitFrom}–{r.purchaseUnitTo} 台 · {labelState(r.beneficiaryRole)} · {rewardText(r.reward)}</p>)}{simulation.blockers.map((b, i) => <Notice key={i} title="试算阻断" kind="warn">{text(b.message)}</Notice>)}</div><Table headers={['资源', '所需', '可用', '结果']} rows={simulation.resources.map(r => [`${r.asset}${r.productNo ? ` · ${text(catalog.skus.find(s => s.productNo === r.productNo)?.name)}` : ''}`, r.required ?? '未知', r.available ?? '未知', labelState(r.status)])}/><Table headers={['上限范围', '已用及预留', '本次预计', '剩余', '状态']} rows={simulation.quotaImpact.map(q => [q.scope === 'ACTIVITY_ORDER' ? '全活动订单' : q.scope === 'PERSON_ORDER' ? '账户参与订单' : '账户规则组数', q.usedAndReserved ?? '未知', q.required ?? '未知', q.remaining ?? '无限制或未知', labelState(q.status)])}/></> : <div className="card-body"><Notice title="尚未试算">选择购买设备、数量及可选授权样本后读取服务端结果。</Notice></div>}</Card><Card title="审核与发布记录" body><div className="timeline">{versions.data?.items.map(v => <div key={v.version}><b>v{v.version} · {labelState(v.state)}</b><small>审核：{v.approvedAt ? formatTime(v.approvedAt) : '尚未批准'} · 发布：{v.publishedAt ? formatTime(v.publishedAt) : '尚未发布'}</small></div>)}</div>{versions.data?.hasMore && <Notice title="历史版本较多">当前显示首 100 个版本；最新候选使用活动详情返回。</Notice>}</Card></div><div><Card title="发布前检查" body>{missingRanks&&<Notice title="原指定等级当前不可用" kind="warn">等级目录无法确认原选择。请返回参与资格重新核对；不限等级活动不受空目录限制。</Notice>}<Notice title={blockers.length ? '仍有配置或政策阻断' : '提交时将重新核验'} kind={blockers.length ? 'warn' : ''}>权益、资金、叠加、追回和权限必须来自当前可执行的批准政策。</Notice><Summary rows={[['候选状态', candidate ? labelState(candidate.state) : '无候选'], ['政策检查', blockers.length ? `${blockers.length} 项待处理` : '以最新提交校验为准'], ['当前有效版本', activity.activeVersion ? `v${activity.activeVersion} 继续执行` : '尚未发布']]}/>{blockers.length > 0 && <p className="help">请返回配置，核对缺失或已撤销的政策引用。</p>}</Card><Card title="当前可用操作" body><p className="muted">审核与发布为独立动作，不能由同一响应代替。</p><div className="actions" style={{ marginTop: 16 }}>{candidate?.state === 'DRAFT' && button('submit', cannotPublish)}{candidate?.state === 'PENDING_APPROVAL' && <>{button('withdraw')}{button('reject')}{button('approve', cannotPublish)}</>}{candidate?.state === 'APPROVED' && <>{button('withdraw')}{button('publish', cannotPublish)}</>}</div><p className="help">写入冲突或拒绝保留输入；结果未知先查原命令。</p></Card><Button onClick={onBack}>返回活动详情</Button></div></div>}
    {simulation && review && <Card title="试算成交与公开预览" body>{simulation.pricing ? <Summary rows={[['商品小计（USDT）', simulation.pricing.subtotalUsdt], ['原组合优惠（USDT）', simulation.pricing.discountUsdt], ['应付款（USDT）', simulation.pricing.amountUsdt]]}/> : <Notice title="原报价暂不可用">当前不能确认应付款，请按阻断项处理。</Notice>}{simulation.publicPreview ? <Summary rows={[['展示标题', text(simulation.publicPreview.title)], ['活动规则', text(simulation.publicPreview.terms)], ['时区', simulation.publicPreview.displayTimezone]]}/> : <Notice title="公开预览暂不可用" kind="warn">批准政策当前无法解析，不展示推测权益；请处理上方阻断项。</Notice>}</Card>}
    {!!versions.error && <ReadError error={versions.error} retry={versions.reload}/>}
    {action && <ConfirmCommand title={ACTIONS[action].label} intent={{ operation: ACTIONS[action].operation, targetId: activity.activityId, path: `/promotions/${activity.activityId}/${action}`, method: 'POST' }} body={{ expectedRevision: ACTIONS[action].version ? candidate?.revision : activity.revision, evidenceRefs: [], ...(ACTIONS[action].version ? { version: candidate?.version } : {}) }} onClose={() => setAction(null)} onSuccess={async () => { await onRefresh(); versions.reload(); setAction(null); }}><Notice title="确认影响范围">{ACTIONS[action].copy}</Notice><Summary rows={[['活动', activity.name || activity.activityId], ['版本', ACTIONS[action].version ? `候选 v${candidate?.version}` : `有效 v${activity.activeVersion ?? '—'}`], ['未支付订单', impact.unpaidOrders], ['未完成奖励', impact.unfulfilledRewards]]}/></ConfirmCommand>}
    {simOpen && candidate && <SimulationDialog activity={activity} version={candidate} catalog={catalog} can={can} onClose={() => setSimOpen(false)} onResult={s => { setSimulation(s); setSimOpen(false); }}/>}
    {reservations && <Dialog title="原订单预留" wide onClose={() => setReservations(false)}><Table headers={['订单', '锁定版本', '原付款截止', '预留奖励']} rows={impact.reservedOrders.map(r => [r.orderNo, `v${r.version}`, formatTime(r.payBy), r.reservedRewards])}/></Dialog>}
  </>;
}
function SimulationDialog({ activity, version, catalog, can, onClose, onResult }: {
    activity: Promotion;
    version: Version;
    catalog: Catalog;
    can: (v: string) => boolean;
    onClose: () => void;
    onResult: (s: AdminSimulation) => void;
}) {
    const [items, setItems] = useState<Item[]>([]), [sample, setSample] = useState(''), [audience, setAudience] = useState<AudiencePreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    const samples = async () => { setBusy(true); try {
        setAudience(await promotionRead<AudiencePreview>(`/promotions/${activity.activityId}/audience-preview`, undefined, { method: 'POST', body: JSON.stringify({ draft: version.draft }) }));
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
    } };
    const run = async () => { setBusy(true); setError(null); try {
        onResult(await promotionRead<AdminSimulation>(`/promotions/${activity.activityId}/simulate`, undefined, { method: 'POST', body: JSON.stringify({ draft: version.draft, items, sampleAccountId: can('user_c1_read') && sample ? sample : null }) }));
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
    } };
    return <Dialog title="试算购买场景" wide onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button kind="primary" disabled={busy || !items.length || items.some(i => !i.productNo || i.quantity < 1) || !can('growth_promotion_simulate')} onClick={run}>{busy ? '正在试算…' : '运行试算'}</Button></>}><Notice title="只读试算">不创建订单，不占资格或预算。没有账户样本时，账户资格明确显示未知。</Notice><fieldset disabled={busy}>{items.map((item, i) => <div className="grid2" key={i}><Field label={`购买设备 ${i + 1}`}><select value={item.productNo} onChange={e => setItems(items.map((v, j) => j === i ? { ...v, productNo: e.target.value } : v))}><option value="">请选择</option>{catalog.skus.filter(s => s.available).map(s => <option key={s.productNo} value={s.productNo}>{text(s.name)}</option>)}</select></Field><Field label="购买数量"><input type="number" min={1} step={1} value={item.quantity || ''} onChange={e => setItems(items.map((v, j) => j === i ? { ...v, quantity: Number(e.target.value) } : v))}/></Field><Button kind="link" onClick={() => setItems(items.filter((_, j) => j !== i))}>移除此购买项</Button></div>)}<Button onClick={() => setItems([...items, { productNo: '', quantity: 0 }])} disabled={items.length >= 8}>添加购买项</Button>{can('user_c1_read') ? <><Button onClick={samples}>读取授权账户样本</Button><Field label="样本账户（可选）"><select value={sample} onChange={e => setSample(e.target.value)}><option value="">不选择，资格标未知</option>{audience?.samples.map(s => <option value={s.accountId} key={s.accountId}>{s.accountId} · {labelState(s.status)}</option>)}</select></Field></> : <p className="help">当前权限只允许汇总试算，不可查看或指定账户样本。</p>}</fieldset>{!!error && <ReadError error={error} retry={run}/>}</Dialog>;
}
