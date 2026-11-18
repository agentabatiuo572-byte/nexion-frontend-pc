"use client";
import { a2ActionText } from "@/lib/admin/operator-copy";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useState, type ReactNode } from 'react';
import type { Catalog, NativeRef, Policy, PolicyContent, PolicyPage, RefundPolicyExecution } from '@/lib/admin/promotion-types';
import { promotionRead } from '@/lib/admin/promotion-client';
import { fetchA2Overview } from '@/lib/admin/a2-client';
import { Button, ConfirmCommand, DeviceRightsSummary, Dialog, Field, Loading, Notice, ReadError, Summary, Table, Tag, formatTime, labelState, text, useRead } from './h4-promotion-ui';
import { ScrollText } from 'lucide-react';
import { BlockState, Check, Fold, Panel, StatusTag } from '@/app/components/rd';
const KINDS: Record<PolicyContent['kind'], string> = { FIRST_PURCHASE: '首购认定', DEVICE_AUDIENCE: '设备参与资格', DEVICE_RIGHTS: '赠品设备权益', ASSET: '奖励到账与可用条件', SETTLEMENT: '订单结算', STACKING: '优惠叠加', REFUND: '售后追回', QUOTE: '报价期限', AUTHORIZATION: '审核发布授权' };
const FIXED: Record<PolicyContent['kind'], Record<string, unknown>> = { FIRST_PURCHASE: { executorCode: 'PROMOTION_FIRST_PURCHASE_V1' }, DEVICE_AUDIENCE: { executorCode: 'PROMOTION_DEVICE_AUDIENCE_V1', excludeExpired: true, excludePhoneAndTrial: true }, DEVICE_RIGHTS: { executorCode: 'COMMERCE_GIFT_FROM_PRODUCT_V1', taskEligibility: 'EXISTING_PRODUCT_RULES' }, ASSET: { executorCode: 'EXISTING_EARNINGS_RELEASE_V1', riskBucketRouting: true }, SETTLEMENT: { executorCode: 'EXISTING_ORDER_MATURITY_V1', requiresPaid: true, requiresNoRefundHold: true, requiresNoFreeze: true }, STACKING: { executorCode: 'PROMOTION_STACKING_V1', samePurchaseUnit: 'EXCLUSIVE' }, REFUND: { executorCode: 'PROMOTION_WALLET_REFUND_V1', principalChannel: 'WALLET', scope: 'WHOLE_ORDER', insufficientRecovery: 'MANUAL_REVIEW', negativeBalance: false, crossAssetDeduction: false }, QUOTE: { executorCode: 'PROMOTION_QUOTE_V1', payByRule: 'MIN_ORDER_DEADLINE_ACTIVITY_END' }, AUTHORIZATION: { executorCode: 'PROMOTION_AUTHORIZATION_V1', approvalCapability: 'growth_promotion_approve', publishCapability: 'growth_promotion_publish', scope: 'PROMOTION_ONLY' } };
export default function PromotionPolicies({ catalog, can, onClose, onChanged, inline = false }: {
    /** 放在「政策」页签里时整页显示列表，详情、新建和确认照旧开弹窗。 */
    inline?: boolean;
    catalog: Catalog;
    can: (v: string) => boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const [cursor, setCursor] = useState<string | null>(null), [selected, setSelected] = useState<Policy | null>(null), [creating, setCreating] = useState(false), [action, setAction] = useState<'approve' | 'revoke' | null>(null);
    const list = useRead(() => promotionRead<PolicyPage>('/promotion-policies', { limit: 20, cursor }), [cursor]);
    const overlay = creating ? <PolicyCreate catalog={catalog} can={can} onClose={() => setCreating(false)} onDone={isCurrent => { if (isCurrent()) setCreating(false); list.reload(); onChanged(); }}/> : action && selected ? <ConfirmCommand writeAllowed={can('growth_promotion_policy_approve') && !list.loading && !list.error} title={action === 'approve' ? '批准政策版本' : '撤销政策版本'} intent={{ operation: action === 'approve' ? 'approvePolicy' : 'revokePolicy', targetId: `${selected.policyId}:${selected.version}`, path: `/promotion-policies/${selected.policyId}/versions/${selected.version}/${action}`, method: 'POST' }} body={{ expectedRevision: selected.revision, evidenceRefs: [] }} onClose={() => setAction(null)} onSuccess={(_result, isCurrent) => { if (isCurrent()) { setAction(null); setSelected(null); } list.reload(); onChanged(); }}><Summary rows={[['政策类别', KINDS[selected.content.kind]], ['版本', `v${selected.version}`], ['影响', action === 'approve' ? '批准后可供活动引用；不自动发布活动。' : '原引用不可继续新发布，历史承诺按原业务协议处理。']]}/></ConfirmCommand> : selected ? <Dialog title={KINDS[selected.content.kind]} sub={`v${selected.version} · ${selected.state === 'APPROVED' ? '已批准' : labelState(selected.state)}`} wide onClose={() => setSelected(null)} footer={<><Button onClick={() => setSelected(null)}>返回政策列表</Button>{selected.state === 'DRAFT' && can('growth_promotion_policy_approve') && <Button kind="primary" onClick={() => setAction('approve')}>批准政策</Button>}{selected.state === 'APPROVED' && can('growth_promotion_policy_approve') && <Button kind="danger" onClick={() => setAction('revoke')}>撤销政策</Button>}</>}><PromotionPolicyDetails policy={selected} catalog={catalog}/></Dialog> : null;
    if (inline)
        return <><Panel title="活动政策" icon={ScrollText} tone="role-4" sub={list.data ? `本页 ${list.data.items.length} 条` : undefined} explain="活动引用的政策版本：首购认定、设备统计、赠品权益、奖励到账、结算、叠加、售后追回、报价期限、审核发布授权。批准政策只是允许活动引用它，不等于发布活动。" actions={can('growth_promotion_policy_write') ? <Button kind="primary" onClick={() => setCreating(true)}>新建政策草稿</Button> : undefined}>
            {list.loading ? <Loading /> : list.error ? <ReadError target="政策与原业务协议" error={list.error} retry={list.reload}/> : !list.data?.items.length ? <BlockState state="empty" title="还没有政策"/> : <div className="h4-policy-grid">{list.data.items.map(p => <button type="button" key={`${p.policyId}:${p.version}`} className="h4-policy" onClick={() => setSelected(p)}><span className="h4-policy-kind">{KINDS[p.content.kind]}</span><span className="h4-policy-version">v{p.version}</span><Tag value={p.state} label={p.state === 'APPROVED' ? '已批准' : undefined}/><span className="h4-policy-sub">{p.approvedAt ? `批准于 ${formatTime(p.approvedAt, 'Asia/Shanghai')}（北京时间）` : p.state === 'DRAFT' ? '尚未批准' : '没有记录批准时间'}{p.fixture ? ' · 仅限隔离范围' : ''}</span><span className="h4-policy-id h4-mono" title={p.policyId}>{p.policyId}</span></button>)}</div>}
            <div className="h4-pager"><span>每页 20 条</span><span className="h4-row"><Button disabled={!cursor} onClick={() => setCursor(null)}>回到首页</Button><Button disabled={!list.data?.hasMore} onClick={() => setCursor(list.data!.nextCursor)}>下一页</Button></span></div>
        </Panel>{overlay}</>;
    if (overlay) return overlay;
    return <Dialog title="活动政策" wide onClose={onClose} footer={<><Button onClick={onClose}>返回活动</Button>{can('growth_promotion_policy_write') && <Button kind="primary" onClick={() => setCreating(true)}>新建政策草稿</Button>}</>}><Notice title="批准与发布分开">只可选择适用的原业务协议版本。未批准政策不能执行活动。</Notice>{list.loading ? <Loading /> : list.error ? <ReadError target="政策与原业务协议" error={list.error} retry={list.reload}/> : <div className="h4-policy-grid">{(list.data?.items || []).map(p => <button type="button" key={`${p.policyId}:${p.version}`} className="h4-policy" aria-label={`查看${KINDS[p.content.kind]} v${p.version}`} onClick={() => setSelected(p)}><span className="h4-policy-kind">{KINDS[p.content.kind]}</span><span className="h4-policy-version">v{p.version}</span><Tag value={p.state} label={p.state === 'APPROVED' ? '已批准' : undefined}/><span className="h4-policy-sub">{p.approvedAt ? `批准于 ${formatTime(p.approvedAt, 'Asia/Shanghai')}（北京时间）` : p.state === 'DRAFT' ? '尚未批准' : '没有记录批准时间'}</span></button>)}</div>}<div className="actions"><Button disabled={!cursor} onClick={() => setCursor(null)}>回到首页</Button><Button disabled={!list.data?.hasMore} onClick={() => setCursor(list.data!.nextCursor)}>下一页</Button></div></Dialog>;
}
const FIELD_LABELS: Record<string, string> = { mode: '首购计算单位', restoreAfterRefund: '退款后恢复资格', sources: '设备来源', states: '设备状态', productNo: '适用设备', productContract: '原商品合同', taskEligibility: '任务参与方式', rightsDescription: '权益说明', asset: '奖励资产', nativeContract: '原执行合同', availabilityDescription: '成熟与可用说明', voucher: '优惠券叠加', bundleDiscount: '组合折扣叠加', existingH8: '新人礼叠加', existingReferral: '现有邀请奖励叠加', deviceRecoveryPolicy: '设备追回原政策', lossOwner: '损失责任归属', terms: '售后说明', ttlSeconds: '报价有效期（秒）', separateMakerChecker: '审核与发布分人执行', requiresPaid: '必须付款', requiresNoRefundHold: '必须没有售后挂起', requiresNoFreeze: '必须没有冻结', riskBucketRouting: '使用原风险资金分类', samePurchaseUnit: '同一购买单位', principalChannel: '购买金额退款渠道', scope: '适用范围', insufficientRecovery: '追回不足处理', negativeBalance: '允许负余额', crossAssetDeduction: '允许跨币扣款', payByRule: '付款截止规则', excludeExpired: '排除过期设备', excludePhoneAndTrial: '排除手机与试用设备' };
const VALUE_LABELS: Record<string, string> = { FIRST_ELIGIBLE_ORDER: '第一笔合格订单', FIRST_ELIGIBLE_UNIT: '第一个合格购买单位', EXISTING_PRODUCT_RULES: '沿原商品规则', DISABLED: '不参与任务（历史设置）', ALLOW: '允许叠加', DENY: '不允许叠加', ORDER: '购买设备', PROMOTION_GIFT: '促销赠品设备', ACTIVE: '已激活', ONLINE: '在线', EXCLUSIVE: '互斥', WALLET: '钱包', WHOLE_ORDER: '整单', MANUAL_REVIEW: '人工审阅', MIN_ORDER_DEADLINE_ACTIVITY_END: '订单截止与活动结束取较早', PROMOTION_ONLY: '仅促销活动' };
function PolicyCreate({ catalog, can, onClose, onDone }: {
    catalog: Catalog;
    can: (v: string) => boolean;
    onClose: () => void;
    onDone: (isCurrent: () => boolean) => void;
}) {
    const [kind, setKind] = useState<PolicyContent['kind']>('DEVICE_RIGHTS'), [content, setContent] = useState<Record<string, unknown>>({ kind: 'DEVICE_RIGHTS', ...FIXED.DEVICE_RIGHTS }), [confirm, setConfirm] = useState(false);
    const audit = useRead(fetchA2Overview, []), patch = (key: string, value: unknown) => setContent({ ...content, [key]: value });
    const choice = (key: string, values: string[], boolean = false) => <Field key={key} label={`${FIELD_LABELS[key]} *`}><select value={content[key] === undefined ? '' : String(content[key])} onChange={e => patch(key, e.target.value ? boolean ? e.target.value === 'true' : e.target.value : undefined)}><option value="">请选择</option>{values.map(v => <option key={v} value={v}>{VALUE_LABELS[v] || (v === 'true' ? '是' : v === 'false' ? '否' : nexGridBrandText(v))}</option>)}</select></Field>;
    const native = (key: string, system: string) => <Field key={key} label={`${FIELD_LABELS[key]} *`}><select value={(content[key] as {
        resourceId?: string;
    })?.resourceId || ''} onChange={e => { const n = catalog.nativeContracts.find(n => n.system === system && n.resourceId === e.target.value); patch(key, n?.reference); }}><option value="">请选择原业务协议</option>{catalog.nativeContracts.filter(n => n.system === system).map(n => <option key={n.resourceId} value={n.resourceId} disabled={!n.available || !n.reference}>{(text(n.title))}{!n.available ? ' · 当前不可用' : ''}</option>)}</select></Field>;
    const localized = (key: string) => <fieldset className="form-section wide" key={key}><legend>{FIELD_LABELS[key]} *</legend><div className="grid2">{(['zh', 'en', 'vi'] as const).map((lang, i) => <Field label={['中文', '英语', '越南语'][i]} key={lang}><textarea value={(content[key] as Record<string, string>)?.[lang] || ''} onChange={e => patch(key, { ...(content[key] as Record<string, string> || {}), [lang]: e.target.value })}/></Field>)}</div></fieldset>;
    const sku = <Field label="适用设备 *"><select value={String(content.productNo || '')} onChange={e => patch('productNo', e.target.value)}><option value="">请选择</option>{catalog.skus.filter(s => s.giftEligible && s.available).map(s => <option value={s.productNo} key={s.productNo}>{(text(s.name))}</option>)}</select></Field>;
    const evidence = [...(audit.data?.operationQueue || []).filter(t => t.status === 'approved').map(t => ({ value: t.id, label: `已批准操作 · ${a2ActionText(t.action)}` })), ...(audit.data?.recentLogs || []).map(t => ({ value: t.id, label: `审计记录 · ${t.action} · ${t.ts}` }))];
    if (confirm)
        return <ConfirmCommand writeAllowed={can('growth_promotion_policy_write') && !audit.loading && !audit.error} title="保存政策草稿" intent={{ operation: 'createPolicy', targetId: 'promotion-policies', path: '/promotion-policies', method: 'POST' }} body={{ content: kind === 'DEVICE_RIGHTS' ? { ...content, taskEligibility: 'EXISTING_PRODUCT_RULES' } : content, evidenceRefs: [] }} evidenceOptions={evidence} requireEvidence evidenceMode="select" onClose={() => setConfirm(false)} onSuccess={(_result, isCurrent) => onDone(isCurrent)}><Notice title="保存后仍需批准">批准前须核验所选原业务协议与证据。</Notice></ConfirmCommand>;
    return <Dialog title="新建政策草稿" wide onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!can('growth_promotion_policy_write') || audit.loading || !!audit.error || !evidence.length} onClick={() => setConfirm(true)}>保存前确认</Button></>}><Field label="政策类别"><select value={kind} onChange={e => { const next = e.target.value as PolicyContent['kind']; setKind(next); setContent({ kind: next, ...FIXED[next] }); }}>{Object.entries(KINDS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></Field><div className="grid2">{kind === 'FIRST_PURCHASE' && <>{choice('mode', ['FIRST_ELIGIBLE_ORDER', 'FIRST_ELIGIBLE_UNIT'])}{choice('restoreAfterRefund', ['true', 'false'], true)}</>}{kind === 'DEVICE_AUDIENCE' && <>{['sources', 'states'].map(key => <fieldset key={key} className="form-section"><legend>{FIELD_LABELS[key]}</legend>{(key === 'sources' ? ['ORDER', 'PROMOTION_GIFT'] : ['ACTIVE', 'ONLINE']).map(v => <label className="evidence-choice" key={v}><input type="checkbox" checked={(content[key] as string[] || []).includes(v)} onChange={e => patch(key, e.target.checked ? [...(content[key] as string[] || []), v] : (content[key] as string[] || []).filter(x => x !== v))}/>{VALUE_LABELS[v]}</label>)}</fieldset>)}</>}{kind === 'DEVICE_RIGHTS' && <>{sku}{native('productContract', 'E1_PRODUCT')}<Field key="taskEligibility" label={`${FIELD_LABELS.taskEligibility} *`}><Check label={VALUE_LABELS.EXISTING_PRODUCT_RULES} help="固定值，保存时总会带上" checked disabled onChange={() => undefined}/></Field>{localized('rightsDescription')}</>}{kind === 'ASSET' && <>{choice('asset', ['USDT', 'UVT'])}{native('nativeContract', 'EARNINGS_RELEASE')}{localized('availabilityDescription')}</>}{kind === 'SETTLEMENT' && native('nativeContract', 'ORDER_CONTRACT')}{kind === 'STACKING' && ['voucher', 'bundleDiscount', 'existingH8', 'existingReferral'].map(k => choice(k, ['ALLOW', 'DENY']))}{kind === 'REFUND' && <>{native('deviceRecoveryPolicy', 'ORDER_CONTRACT')}<Field label="损失责任归属 *"><input value={String(content.lossOwner || '')} onChange={e => patch('lossOwner', e.target.value)}/></Field>{localized('terms')}</>}{kind === 'QUOTE' && <Field label="报价有效期（秒） *"><input type="number" min={1} step={1} value={String(content.ttlSeconds || '')} onChange={e => patch('ttlSeconds', e.target.value ? Number(e.target.value) : undefined)}/></Field>}{kind === 'AUTHORIZATION' && <>{native('nativeContract', 'A2_POLICY')}{choice('separateMakerChecker', ['true', 'false'], true)}</>}</div><Notice title="执行规则">沿用已有资金分类、整单钱包退款和原业务协议；不允许负余额或跨币抵扣。具体内容在批准后才可用于活动。</Notice>{!!audit.error && <ReadError target="批准证据目录" error={audit.error} retry={audit.reload}/>} {!audit.loading && !evidence.length && <Notice title="没有可选择的批准证据" kind="warn">「操作记录与审批」里还没有可选的已批准操作或记录，有了再回来配置政策。</Notice>}</Dialog>;
}

// 退款政策的「实际怎么处理」：后端按现行做法给的规则说明（6f9a1a52），与这一版批准与否无关。
// 认不出的取值写「读不出」，原值进技术信息。
const EXECUTION_ROWS: Array<[keyof RefundPolicyExecution, string, Record<string, string>]> = [
    ['basis', '什么时候处理', { WHOLE_ORDER_REFUND_CONFIRMED: '整单退款确认之后' }],
    ['walletRecovery', '钱包奖励', { SAME_ASSET_AVAILABLE_BALANCE: '从同一币种的可用余额里追回' }],
    ['deviceRecovery', '赠送的设备', { REVOKE_GIFT_DEVICE_CANCEL_OPEN_TASKS_KEEP_POSTED_EARNINGS: '收回设备，取消没做完的任务；已到账的收益不追' }],
    ['insufficientRecovery', '追不回的部分', { PLATFORM_LOSS_AND_CLOSE: '记为平台损失，这笔直接结案' }],
    ['terminalState', '结案后的状态', { REVERSED: '已冲正' }],
    ['manualReviewAppliesTo', '转人工审阅', { APPROVED_CORRECTION: '只在批准的纠正追不回时' }],
    ['unknownEvidence', '发放情况核不清', { ORIGINAL_REFUND_CHECKS: '按原来的退款核对处理' }],
];
function RefundExecution({ execution }: { execution: RefundPolicyExecution }) {
    const unknown: string[] = [];
    const rows: Array<[string, ReactNode]> = EXECUTION_ROWS.map(([key, label, known]) => {
        const value = execution[key] as string;
        if (known[value]) return [label, known[value]];
        unknown.push(`${label}：${value}`);
        return [label, <span className="h4-dim" key={key}>读不出</span>];
    });
    rows.splice(2, 0, ['余额不够时', `${execution.negativeBalance ? '会扣成负数' : '不扣成负数'}，${execution.crossAssetDeduction ? '会扣别的币种' : '也不扣别的币种'}`]);
    return <section className="h4-policy-part" aria-label="整单退款实际怎么处理">
        <header><h3>整单退款实际怎么处理</h3><p>系统现行做法，和这一版批准与否无关；每笔结果看奖励台账。</p></header>
        <Summary rows={rows}/>
        {unknown.length > 0 && <Fold inset title="技术信息" summary={`${unknown.length} 项读不出`}><ul className="h4-tech">{unknown.map(line => <li key={line}>{line}</li>)}</ul></Fold>}
    </section>;
}
export function PromotionPolicyDetails({policy: selected, catalog}: {policy: Policy; catalog: Catalog}) {
    const contractTitle = (reference: NativeRef | null | undefined) => { const native = reference && catalog.nativeContracts.find(n => n.reference?.system === reference.system && n.reference.resourceId === reference.resourceId && n.reference.revision === reference.revision && n.reference.contentHash === reference.contentHash); return native ? (text(native.title)) : '未知'; };
    const execution = selected.execution;
    const content = <Summary rows={Object.entries(selected.content).filter(([k]) => !['executorCode', 'kind', 'approvalCapability', 'publishCapability'].includes(k)).map(([key, value]) => [FIELD_LABELS[key] || '合同约束', <>{typeof value === 'object' && value !== null ? 'zh' in value ? text(value as {
            zh: string;
        }) : 'resourceId' in value ? contractTitle(value as NativeRef) : Array.isArray(value) ? value.map(v => VALUE_LABELS[String(v)] || nexGridBrandText(String(v))).join('、') : '已绑定' : typeof value === 'boolean' ? value ? '是' : '否' : VALUE_LABELS[String(value)] || nexGridBrandText(String(value))}{execution && key === 'insufficientRecovery' && <span className="h4-dim">（存档写法，实际见上）</span>}</>] as [string, ReactNode])}/>;
    return <><Summary rows={[['批准状态', <Tag value={selected.state} label={selected.state === 'APPROVED' ? '已批准' : undefined}/>], ['批准人', selected.approvedByAdmin?.displayName || selected.approvedByAdmin?.username || (selected.approvedBy ? `管理员编号 ${selected.approvedBy}` : selected.state === 'DRAFT' ? '尚未批准' : '没有记录批准人')], ['批准依据', selected.approvalRef || (selected.state === 'DRAFT' ? '尚未批准' : '没有记录')]]}/>{execution ? <>
        <RefundExecution execution={execution}/>
        <section className="h4-policy-part" aria-label="政策原文">
            <header><h3>政策原文 <StatusTag tone="neutral">存档</StatusTag></h3><p>这一版存下的原文，批准和引用都按它核对。</p></header>
            {content}
        </section>
    </> : content}{selected.content.kind === 'DEVICE_RIGHTS' && <><DeviceRightsSummary rights={selected.resolvedDeviceRights}/><Summary rows={[
            ['任务参与依据', contractTitle(selected.resolvedDeviceRights?.taskRule)],
            ['收益执行依据', contractTitle(selected.resolvedDeviceRights?.earningsRule)]
        ]}/></>}</>;
}
export function PromotionRightsDialog({policy, catalog, onClose}: {policy: Policy; catalog: Catalog; onClose: () => void}) { return <Dialog title="赠品权益详情" onClose={onClose}><PromotionPolicyDetails policy={policy} catalog={catalog}/></Dialog>; }
