"use client";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type DependencyList, type ReactNode, type ReactElement } from 'react';
import { displayAdminError } from '@/lib/admin/error-messages';
import { fetchA2ReasonPolicy } from '@/lib/admin/a2-client';
import { PromotionApiError, promotionFieldLabel, acknowledgePromotionCommand, pendingPromotionCommands, promotionCommand, recoverPromotionCommand, type PromotionCommandIntent } from '@/lib/admin/promotion-client';
import type { CommandReceipt, DraftRewardSpec, LocalizedText, RewardSpec } from '@/lib/admin/promotion-types';
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
export function Tag({ value }: {
    value: string;
}) { const kind = ['ACTIVE', 'ISSUED', 'SUCCEEDED', 'COMPLETE'].includes(value) ? 'ok' : ['OUTCOME_UNKNOWN', 'PAUSED', 'MANUAL_REVIEW', 'REVERSAL_PENDING'].includes(value) ? 'warn' : ['RETRYABLE_FAILED', 'FAILED'].includes(value) ? 'bad' : 'blue'; return <span className={`tag ${kind}`}>{labelState(value)}</span>; }
export function Empty({ title, children, action }: {
    title: string;
    children?: ReactNode;
    action?: ReactNode;
}) { return <div className="blank"><div className="emptyicon" aria-hidden>◇</div><h2>{title}</h2><p>{children}</p>{action}</div>; }
export function Loading() { return <div role="status" aria-live="polite"><div className="loading-label">正在读取，请稍候…</div>{[0, 1, 2].map(i => <div className="skeleton-row" key={i}>{[0, 1, 2, 3, 4].map(j => <span className="skeleton" key={j}/>)}</div>)}</div>; }
export function ReadError({ error, retry }: {
    error: unknown;
    retry: () => void;
}) { return <Notice title="读取未完成" kind="bad">{displayAdminError(error)}<div><Button onClick={retry}>重试读取</Button></div></Notice>; }
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
export function ConfirmCommand({ title, intent, body, children, onClose, onSuccess, evidenceOptions = [], requireEvidence = false, evidenceMode = 'upload' }: {
    title: string;
    intent: Omit<PromotionCommandIntent, 'body'>;
    body: Record<string, unknown>;
    children?: ReactNode;
    onClose: () => void;
    onSuccess: (result: CommandReceipt) => void | Promise<void>;
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
    const submit = async (retry = false) => { setBusy(true); setError(null); try {
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
    const invalid = !policy.data || reason.trim().length < policy.data.minChars || reason.trim().length > policy.data.maxChars || (requireEvidence && !evidence.length) || !!uploadState;
    return <Dialog title={title} onClose={onClose} wide={requireEvidence} footer={<><Button onClick={onClose} disabled={busy}>取消</Button>{record ? <><Button onClick={recover} disabled={busy}>{record.receipt ? '读取已成功的结果' : '核查原命令'}</Button>{record.recoveryState === 'NOT_FOUND' && <Button kind="primary" onClick={() => submit(true)} disabled={busy}>原样重试</Button>}</> : <Button kind="primary" onClick={() => submit()} disabled={busy || invalid}>{busy ? '正在提交…' : '确认操作'}</Button>}</>}>
    <fieldset disabled={busy || !!record}>{children}</fieldset><fieldset disabled={busy || !!record}><Field label="操作理由 *" hint={policy.data ? `至少 ${policy.data.minChars} 字，最多 ${policy.data.maxChars} 字；与操作一起留痕。` : '正在读取理由要求'}><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={policy.data?.maxChars}/></Field>{evidenceOptions.length > 0 && <fieldset className="form-section"><legend>关联证据{requireEvidence ? ' *' : ''}</legend>{evidenceOptions.map(option => <label className="evidence-choice" key={option.value}><input type="checkbox" checked={evidence.includes(option.value)} onChange={e => setEvidence(e.target.checked ? [...evidence, option.value] : evidence.filter(x => x !== option.value))}/>{option.label}</label>)}</fieldset>}</fieldset>
    {requireEvidence && evidenceMode === 'upload' && <fieldset disabled={busy || !!record}><BusinessFormBlock spec={{ kind: 'multi-field', title: '上传处置证据', fields: [{ key: 'evidenceAssetId', label: '关联证据图片', inputKind: 'asset-upload', required: true, wide: true, uploadDomain: 'growth', uploadUsage: 'promotion-evidence', help: '上传可核验的关联凭据，上传成功后才允许提交。' }] }} value={upload} onChange={v => { setUpload(v); setEvidence(v.evidenceAssetId ? [v.evidenceAssetId] : []); }} onUploadStateChange={(_, state) => setUploadState(state)}/></fieldset>}
    {!!policy.error && <ReadError error={policy.error} retry={policy.reload}/>}{!!error && <Notice title="操作尚未完成" kind="bad">{displayAdminError(error)}{error instanceof PromotionApiError&&error.fieldErrors.map((f,i)=><p key={i} className="input-error">{promotionFieldLabel(f.field)}：未填写完整或不符合当前约束。</p>)}</Notice>}{record && <Notice title="原命令待核实" kind="warn">{record.receipt ? '原操作已经成功，当前只重读结果；不会再次提交。' : '原参数已锁定；核查前不会创建第二次操作。关闭后仍可在活动中心恢复。'}</Notice>}{note && <Notice title="核查结果">{note}</Notice>}<span hidden>{version}</span>
  </Dialog>;
}
