"use client";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type DependencyList, type ReactNode, type ReactElement } from 'react';
import { displayAdminError } from '@/lib/admin/error-messages';
import { fetchA2ReasonPolicy } from '@/lib/admin/a2-client';
import { PromotionApiError, promotionFieldLabel, acknowledgePromotionCommand, pendingPromotionCommands, promotionCommand, recoverPromotionCommand, type PromotionCommandIntent } from '@/lib/admin/promotion-client';
import type { CommandReceipt, DraftRewardSpec, LocalizedText, RewardDisclosure, RewardSpec } from '@/lib/admin/promotion-types';
import { BusinessFormBlock } from '../design-kit';
export const text = (v: Partial<LocalizedText> | null | undefined) => v?.zh || v?.en || v?.vi || '未提供';
export const formatTime = (v: string | null | undefined, zone = 'Asia/Tokyo') => { if (!v)
    return '未配置'; try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));
}
catch {
    return '时间不可用';
} };
export const TEMPLATE_LABELS = { SKU_GIFT: '单设备赠礼', FIRST_PURCHASE: '首购礼', DIRECT_REFERRAL: '直邀首购双向礼', MULTI_PRODUCT: '多型号组合', REPURCHASE: '复购召回' } as const;
const STATES: Record<string, string> = { DRAFT: '草稿', SCHEDULED: '待开始', ACTIVE: '进行中', PAUSED: '暂停新预留', ENDED: '已结束', ARCHIVED: '已归档', PENDING_APPROVAL: '待审核', APPROVED: '已审核待发布', PUBLISHED: '已发布', PENDING: '待发放', READY: '待执行', PROCESSING: '处理中', ISSUED: '已发放', RETRYABLE_FAILED: '可重试失败', OUTCOME_UNKNOWN: '结果未知', REVERSAL_PENDING: '追回待处理', REVERSED: '已冲正', CANCELED: '已取消', CANCELLED: '已取消', MANUAL_REVIEW: '人工审阅', MATCHED: '符合条件', REJECTED: '不符合', UNKNOWN: '未知', COMPLETE: '完整', UNAVAILABLE: '不可用', DELAYED: '延迟', ELIGIBLE: '符合条件', INELIGIBLE: '不符合', AVAILABLE: '可用', SHORTAGE: '不足', BUYER: '购买者', DIRECT_INVITER: '直接邀请人', SUCCEEDED: '成功', FAILED: '失败', NOT_FOUND: '未查到命令', REVOKED: '已撤销' };
export const labelState = (value: string) => STATES[value] || '待核实';
export const rewardText = (r: DraftRewardSpec | RewardSpec | null | undefined, deviceName?: string | null) => !r ? '未配置' : r.type === 'DEVICE' ? `${deviceName || '设备赠礼'} × ${r.quantity ?? '未配置'}` : `${r.amount ?? '未配置'} ${r.type}`;
export function Button({ kind = '', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    kind?: '' | 'primary' | 'link' | 'danger';
}) { return <button {...props} type={type} className={`btn ${kind} ${className}`}/>; }
export function Card({ title, action, children, body = false }: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
    body?: boolean;
}) { return <section className="card"><div className="card-h"><h2>{title}</h2>{action && <div className="right">{action}</div>}</div>{body ? <div className="card-body">{children}</div> : children}</section>; }
export function Field({ label, hint, wide, children }: {
    label: string;
    hint?: ReactNode;
    wide?: boolean;
    children: ReactNode;
}) {
  const id=useId();
  const control=isValidElement(children)&&typeof children.type==='string'&&['input','select','textarea'].includes(children.type)
    ? cloneElement(children as ReactElement<Record<string,unknown>>,{'aria-labelledby':id,'aria-describedby':hint?`${id}-hint`:undefined}) : children;
  return <label className={`field ${wide ? 'wide' : ''}`}><span id={id}>{label}</span>{control}{hint&&<small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function Notice({ title, children, kind = '' }: {
    title: string;
    children?: ReactNode;
    kind?: string;
}) { return <div className={`notice ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}><b>{title}</b>{children}</div>; }
export function Table({ headers, rows }: {
    headers: string[];
    rows: ReactNode[][];
}) { return <div className="table-wrap"><table><thead><tr>{headers.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>; }
export function Stats({ items }: {
    items: Array<[
        string,
        ReactNode,
        string
    ]>;
}) { return <div className="stats">{items.map(([label, value, hint], i) => <div className="stat" key={label}><span className="muted">{label}</span><div className={`value ${i === 0 ? 'accent' : ''}`}>{value}</div><small>{hint}</small></div>)}</div>; }
export function Summary({ rows }: {
    rows: Array<[
        string,
        ReactNode
    ]>;
}) { return <>{rows.map(([label, value]) => <div className="summary" key={label}><span>{label}</span><b>{value}</b></div>)}</>; }
export function DeviceRightsSummary({ rights }: {rights: RewardDisclosure['deviceRights']}) {
    const yesNo = (value: unknown) => value === true ? '是' : value === false ? '否' : '未确认';
    return <Summary rows={[
        ['激活方式', rights?.activationMode === 'AUTO' ? '自动激活' : rights?.activationMode === 'MANUAL' ? '手动激活' : '未确认'],
        ['生效起点', rights?.effectiveOn === 'ISSUED' ? '发放时' : rights?.effectiveOn === 'ACTIVATED' ? '激活时' : '未确认'],
        ['有效天数', rights?.durationDays === null ? '原合同未限定' : typeof rights?.durationDays === 'number' && Number.isFinite(rights.durationDays) ? rights.durationDays : '未确认'],
        ['参与任务', yesNo(rights?.taskEnabled)], ['计入设备持有', yesNo(rights?.countsAsDeviceHolding)],
        ['计入等级', yesNo(rights?.countsForRank)], ['可转让', yesNo(rights?.transferable)], ['可兑换', yesNo(rights?.exchangeable)],
        ['收回方式', rights?.revocationMode === 'REVOKE_IF_UNUSED' ? '未使用可收回' : rights?.revocationMode === 'MANUAL_IF_USED' ? '使用后人工处理' : '未确认']
    ]}/>;
}
export function Tag({ value }: {
    value: string;
}) { const kind = ['ACTIVE', 'ISSUED', 'SUCCEEDED', 'COMPLETE'].includes(value) ? 'ok' : ['OUTCOME_UNKNOWN', 'PAUSED', 'MANUAL_REVIEW', 'REVERSAL_PENDING'].includes(value) ? 'warn' : ['RETRYABLE_FAILED', 'FAILED'].includes(value) ? 'bad' : 'blue'; return <span className={`tag ${kind}`}>{labelState(value)}</span>; }
export function Empty({ title, children, action }: {
    title: string;
    children?: ReactNode;
    action?: ReactNode;
}) { return <div className="blank"><div className="emptyicon" aria-hidden>◇</div><h2>{title}</h2><p>{children}</p>{action}</div>; }
export const PROMOTION_STEPS = ['基本信息', '参与资格', '购机赠奖', '预算与叠加'];
export function PromotionSteps({ step, onStep, disabled = false }: { step: number; onStep: (step: number) => void; disabled?: boolean }) {
    return <div className="steps">{PROMOTION_STEPS.map((name, i) => <button key={name} className={`step ${step === i ? 'active' : ''}`} disabled={disabled} onClick={() => onStep(i)}><i>{i + 1}</i><span>{name}<small>{['类别、时间与公开说明', '人群、设备与等级', '逐设备、逐受益人', '限额、预算与冲突'][i]}</small></span></button>)}</div>;
}
export function Loading() { return <div role="status" aria-live="polite" aria-busy="true"><div className="loading-label">正在读取当前版本与授权数据，请稍候。未知数据不显示为 0。</div>{Array.from({length: 6}, (_, i) => <div className="skeleton-row" key={i}>{[0, 1, 2, 3, 4].map(j => <span className="skeleton" key={j}/>)}</div>)}</div>; }
export function ReadError({ error, retry, target, retryLabel = '重试读取' }: {
    error: unknown;
    retry: () => void;
    target: string;
    retryLabel?: string;
}) { return <Notice title="读取未完成" kind="bad"><p>{target}：{displayAdminError(error)}</p><div><Button onClick={retry}>{retryLabel}</Button><small className="read-target">{target}</small></div></Notice>; }
export function PromotionReadPanel({ title, loading, errors = [] }: { title: string; loading: boolean; errors?: Array<{target: string; error: unknown; retry: () => void}> }) {
    return <Card title={`${loading ? '正在读取' : '暂时无法确认'}${title}`}>{loading ? <><Loading/><div className="card-body"><Button disabled>处理进行中</Button><p className="help">读取结束前不允许提交或重复操作。</p></div></> : <><Empty title="读取失败，内容已保留" action={<div className="actions">{errors.map(item => <Button key={item.target} kind="primary" onClick={item.retry}>重试读取<span> · {item.target}</span></Button>)}</div>}>当前读取未成功，不代表没有记录。依赖最新数据的动作已停用；重试不会再次创建活动或奖励。{errors.map(item => <span className="read-failure" key={item.target}>{item.target}：{displayAdminError(item.error)}</span>)}</Empty><div className="card-body"><Notice title="写入结果未知时" kind="warn">保留填写内容与原命令。先查原命令结果，再决定是否重试；不能重新创建一条命令。</Notice></div></>}</Card>;
}
export function useRead<T>(loader: () => Promise<T>, deps: DependencyList) {
    const ref = useRef(loader);
    ref.current = loader;
    const [data, setData] = useState<T | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [tick, setTick] = useState(0);
    useEffect(() => { let current = true; setLoading(true); setError(null); ref.current().then(v => { if (current)
        setData(v); }).catch(e => { if (current)
        setError(e); }).finally(() => { if (current)
        setLoading(false); }); return () => { current = false; }; }, [...deps, tick]);
    return { data, error, loading, reload: () => setTick(v => v + 1) };
}
export function Dialog({ title, children, onClose, footer, wide = false }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    footer?: ReactNode;
    wide?: boolean;
}) {
    const ref = useRef<HTMLDialogElement>(null), id = useId();
    useEffect(() => { const node = ref.current; const previous = document.activeElement as HTMLElement | null; node?.showModal(); return () => { node?.close(); previous?.focus(); }; }, []);
    return <dialog ref={ref} className={wide ? 'wide-dialog' : ''} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }}><div className="dialog-head"><h2 id={id}>{title}</h2><button className="close" aria-label="关闭弹窗" onClick={onClose}>×</button></div><div className="dialog-body">{children}</div><div className="dialog-foot">{footer || <Button onClick={onClose}>返回</Button>}</div></dialog>;
}
export const PROMOTION_COMMAND_PERMISSIONS: Record<string, string> = {createPromotion: 'edit', saveDraft: 'edit', copyPromotion: 'edit', createDraftVersion: 'edit', submitPromotion: 'submit', withdrawPromotion: 'submit', approvePromotion: 'approve', rejectPromotion: 'approve', publishPromotion: 'publish', pausePromotion: 'pause', resumePromotion: 'pause', endPromotion: 'end', archivePromotion: 'archive', retryReward: 'reward_retry', reconcileReward: 'reward_reconcile', cancelReward: 'reward_cancel', reverseReward: 'reward_reverse', resolveReward: 'reward_resolve', createExport: 'metrics_export', createPolicy: 'policy_write', approvePolicy: 'policy_approve', revokePolicy: 'policy_approve'};
export function ConfirmCommand({ title, intent, body, children, onClose, onSuccess, writeAllowed, evidenceOptions = [], requireEvidence = false, evidenceMode = 'upload' }: {
    title: string;
    intent: Omit<PromotionCommandIntent, 'body'>;
    body: Record<string, unknown>;
    children?: ReactNode;
    onClose: () => void;
    onSuccess: (result: CommandReceipt) => void | Promise<void>;
    writeAllowed: boolean;
    evidenceOptions?: Array<{
        value: string;
        label: string;
    }>;
    requireEvidence?: boolean;
    evidenceMode?: 'upload' | 'select';
}) {
    const initial = pendingPromotionCommands().find(p => p.operation === intent.operation && p.targetId === intent.targetId)?.body as Record<string, unknown> | undefined;
    const policy = useRead(fetchA2ReasonPolicy, []), [reason, setReason] = useState(String(initial?.reason || '')), [evidence, setEvidence] = useState<string[]>(Array.isArray(initial?.evidenceRefs) ? initial.evidenceRefs : []), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [note, setNote] = useState(''), [version, setVersion] = useState(0), [upload, setUpload] = useState<Record<string, string>>({}), [uploadState, setUploadState] = useState<string>();
    const record = pendingPromotionCommands().find(p => p.operation === intent.operation && p.targetId === intent.targetId);
    const payload = { ...body, reason, ...('evidenceRefs' in body ? { evidenceRefs: evidence } : {}) };
    const submit = async (retry = false) => { if (!writeAllowed) return; setBusy(true); setError(null); try {
        const result = record?.receipt || await promotionCommand(record && retry ? record : { ...intent, body: payload }, retry);
        await onSuccess(result);
        acknowledgePromotionCommand(result);
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
        setVersion(v => v + 1);
    } };
    const recover = async () => { if (!record)
        return; setBusy(true); setError(null); try {
        const result = record.receipt || await recoverPromotionCommand(record);
        if (result.status === 'SUCCEEDED') {
            await onSuccess(result);
            acknowledgePromotionCommand(result);
        }
        else
            setNote(result.status === 'NOT_FOUND' ? '未查到原命令，可按原参数和原命令号重试。' : `原命令：${labelState(result.status)}。保留输入，继续核查。`);
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
        setVersion(v => v + 1);
    } };
    const invalid = !policy.data || policy.loading || !!policy.error || reason.trim().length < policy.data.minChars || reason.trim().length > policy.data.maxChars || (requireEvidence && !evidence.length) || !!uploadState;
    return <Dialog title={title} onClose={onClose} wide={requireEvidence} footer={<><Button onClick={onClose} disabled={busy}>取消</Button>{record ? <><Button onClick={recover} disabled={busy}>{record.receipt ? '读取已成功的结果' : '核查原命令'}</Button>{record.recoveryState === 'NOT_FOUND' && <Button kind="primary" onClick={() => submit(true)} disabled={busy || !writeAllowed || policy.loading || !!policy.error}>原样重试</Button>}</> : <Button kind="primary" onClick={() => submit()} disabled={busy || invalid || !writeAllowed}>{busy ? '正在提交…' : '确认操作'}</Button>}</>}>
    <fieldset disabled={busy || !!record || !writeAllowed}>{children}</fieldset><fieldset disabled={busy || !!record || !writeAllowed}><Field label="操作理由 *" hint={policy.data ? `至少 ${policy.data.minChars} 字，最多 ${policy.data.maxChars} 字；与操作一起留痕。` : '正在读取理由要求'}><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={policy.data?.maxChars}/></Field>{evidenceOptions.length > 0 && <fieldset className="form-section"><legend>关联证据{requireEvidence ? ' *' : ''}</legend>{evidenceOptions.map(option => <label className="evidence-choice" key={option.value}><input type="checkbox" checked={evidence.includes(option.value)} onChange={e => setEvidence(e.target.checked ? [...evidence, option.value] : evidence.filter(x => x !== option.value))}/>{option.label}</label>)}</fieldset>}</fieldset>
    {requireEvidence && evidenceMode === 'upload' && <fieldset disabled={busy || !!record || !writeAllowed}><BusinessFormBlock spec={{ kind: 'multi-field', title: '上传处置证据', fields: [{ key: 'evidenceAssetId', label: '关联证据图片', inputKind: 'asset-upload', required: true, wide: true, uploadDomain: 'growth', uploadUsage: 'promotion-evidence', help: '上传可核验的关联凭据，上传成功后才允许提交。' }] }} value={upload} onChange={v => { setUpload(v); setEvidence(v.evidenceAssetId ? [v.evidenceAssetId] : []); }} onUploadStateChange={(_, state) => setUploadState(state)}/></fieldset>}
    {!writeAllowed && <Notice title="当前操作已停用" kind="warn">授权或依赖数据当前无法支持此操作。原输入与命令继续保留，可读取核查原结果。</Notice>}{!!policy.error && <ReadError target="操作理由要求" error={policy.error} retry={policy.reload}/>}{!!error && <Notice title="操作尚未完成" kind="bad">{displayAdminError(error)}{error instanceof PromotionApiError&&error.fieldErrors.map((f,i)=><p key={i} className="input-error">{promotionFieldLabel(f.field)}：未填写完整或不符合当前约束。</p>)}</Notice>}{record && <Notice title="原命令待核实" kind="warn">{record.receipt ? '原操作已经成功，当前只重读结果；不会再次提交。' : '原参数已锁定；核查前不会创建第二次操作。关闭后仍可在活动中心恢复。'}</Notice>}{note && <Notice title="核查结果">{note}</Notice>}<span hidden>{version}</span>
  </Dialog>;
}
