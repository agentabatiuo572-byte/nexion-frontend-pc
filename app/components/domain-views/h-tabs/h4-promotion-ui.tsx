"use client";
import { restoreH4Uploads, type H4UploadTarget } from "@/lib/admin/h4-mutations";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type DependencyList, type ReactNode, type ReactElement } from 'react';
import { displayAdminError } from '@/lib/admin/error-messages';
import { fetchA2ReasonPolicy } from '@/lib/admin/a2-client';
import { PromotionApiError, promotionFieldLabel, acknowledgePromotionCommand, pendingPromotionCommands, promotionCommand, recoverPromotionCommand, type PromotionCommandIntent } from '@/lib/admin/promotion-client';
import type { CommandReceipt, DraftRewardSpec, LocalizedText, RewardDisclosure, RewardSpec } from '@/lib/admin/promotion-types';
import { BusinessFormBlock } from '../design-kit';
import { Check } from 'lucide-react';
import { BlockState, Button as RdButton, Check as RdCheck, Drawer, Fact, Facts, Field as RdField, Modal, Notice as RdNotice, Panel, Stat, StatBand, StatusTag, Table as RdTable, Td, Textarea, Th, Tr, type ButtonVariant, type StateTone } from '@/app/components/rd';
export const text = (v: Partial<LocalizedText> | null | undefined) => v?.zh || v?.en || v?.vi || '未提供';
/** 日期时间按规范写到分钟：YYYY-MM-DD HH:mm；空值写「未配置」，不显示成 1970 年。 */
export const formatTime = (v: string | null | undefined, zone = 'Asia/Tokyo') => { if (!v)
    return '未配置'; try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(v)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
catch {
    return '时间不可用';
} };
/** 页面上标「现在按哪个时区」的写法，和时区下拉的选项一致。 */
export const zoneLabel = (zone: string | null | undefined) => ({ 'Asia/Tokyo': '日本时间 UTC+9', UTC: '协调世界时 UTC', 'Asia/Ho_Chi_Minh': '越南时间 UTC+7', 'Asia/Shanghai': '北京时间 UTC+8' } as Record<string, string>)[zone || 'UTC'] || zone || '协调世界时 UTC';
/** 后端金额固定补到 6 位小数：显示时去掉补的 0，至少留 2 位，不舍入；whole 给整台设备这类整数。 */
export function amountText(value: string | number | null | undefined, whole = false): string {
    if (value === null || value === undefined || value === '') return '—';
    const raw = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
    const [integer, fraction = ''] = raw.split('.');
    const trimmed = fraction.replace(/0+$/, '');
    if (whole && !trimmed) return integer;
    return `${integer}.${trimmed.padEnd(2, '0')}`;
}
export const TEMPLATE_LABELS = { SKU_GIFT: '单设备赠礼', FIRST_PURCHASE: '首购礼', DIRECT_REFERRAL: '直邀首购双向礼', MULTI_PRODUCT: '多型号组合', REPURCHASE: '复购召回' } as const;
const STATES: Record<string, string> = { DRAFT: '草稿', SCHEDULED: '待开始', ACTIVE: '进行中', PAUSED: '暂停新预留', ENDED: '已结束', ARCHIVED: '已归档', PENDING_APPROVAL: '待审核', APPROVED: '已审核待发布', PUBLISHED: '已发布', PENDING: '待发放', READY: '待执行', PROCESSING: '处理中', ISSUED: '已发放', RETRYABLE_FAILED: '可重试失败', OUTCOME_UNKNOWN: '结果未知', REVERSAL_PENDING: '追回待处理', REVERSED: '已冲正', CANCELED: '已取消', CANCELLED: '已取消', MANUAL_REVIEW: '人工审阅', MATCHED: '符合条件', REJECTED: '不符合', UNKNOWN: '未知', COMPLETE: '完整', UNAVAILABLE: '不可用', DELAYED: '延迟', ELIGIBLE: '符合条件', INELIGIBLE: '不符合', AVAILABLE: '可用', SHORTAGE: '不足', BUYER: '购买者', DIRECT_INVITER: '直接邀请人', SUCCEEDED: '成功', FAILED: '失败', NOT_FOUND: '未查到原操作', REVOKED: '已撤销' };
export const labelState = (value: string) => STATES[value] || '状态未知';
export const promotionAssetText = (asset: string) => asset === 'DISCOUNT_USDT' ? '订单立减（USDT）' : nexGridBrandText(asset);
export const rewardText = (r: DraftRewardSpec | RewardSpec | null | undefined, deviceName?: string | null) => !r ? '未配置' : r.type === 'DEVICE' ? `${(deviceName || '设备赠礼')} × ${r.quantity ?? '未配置'}` : r.type === 'DISCOUNT_USDT' ? `订单立减 ${r.amount == null ? '未配置' : amountText(r.amount)} USDT` : `${r.amount == null ? '未配置' : amountText(r.amount)} ${nexGridBrandText(r.type)}`;
const VARIANT: Record<string, ButtonVariant> = { primary: 'primary', danger: 'danger-outline', link: 'ghost', '': 'secondary' };
/** 旧调用方的 kind 映射到 rd 按钮：link 是行内的轻按钮，danger 是和主按钮并排的危险入口（实心危险只给最终确认）。 */
export function Button({ kind = '', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    kind?: '' | 'primary' | 'link' | 'danger';
}) { return <RdButton {...props} type={type} variant={VARIANT[kind]} size={kind === 'link' ? 'sm' : 'md'} className={className || undefined}/>; }
export function Card({ title, action, children }: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
    body?: boolean;
}) { return <Panel title={title} actions={action}>{children}</Panel>; }
const NATIVE = ['input', 'select', 'textarea'];
export function Field({ label, hint, wide, children }: {
    label: string;
    hint?: ReactNode;
    wide?: boolean;
    children: ReactNode;
}) {
  const id=useId();
  const native=isValidElement(children)&&typeof children.type==='string'&&NATIVE.includes(children.type);
  const props=native?(children as ReactElement<Record<string,unknown>>).props:null;
  const control=native&&props
    ? cloneElement(children as ReactElement<Record<string,unknown>>,{id:props.id??id,className:[props.type==='checkbox'||props.type==='radio'?'':'rd-input',children.type==='textarea'?'rd-textarea':'',props.className??''].filter(Boolean).join(' ')||undefined,'aria-describedby':hint?`${id}-hint`:undefined})
    : children;
  return <div className="rd-form-field h4-field" data-wide={wide ? '' : undefined}>{native ? <label className="rd-form-label" htmlFor={String(props?.id ?? id)}>{label}</label> : <span className="rd-form-label">{label}</span>}{control}{hint&&<div id={`${id}-hint`} className="rd-form-help">{hint}</div>}</div>;
}
const NOTICE_TONE: Record<string, StateTone> = { bad: 'danger', warn: 'warn', '': 'neutral' };
export function Notice({ title, children, kind = '' }: {
    title: string;
    children?: ReactNode;
    kind?: string;
}) { return <RdNotice tone={NOTICE_TONE[kind] ?? 'neutral'} title={title}>{children}</RdNotice>; }
export function Table({ headers, rows, label }: {
    headers: string[];
    rows: ReactNode[][];
    label?: string;
}) { return <div className="h4-table"><RdTable label={label ?? headers.join('、')}><thead><tr>{headers.map(h => <Th key={h} scope="col">{h}</Th>)}</tr></thead><tbody>{rows.map((row, i) => <Tr key={i}>{row.map((cell, j) => <Td key={j}>{cell}</Td>)}</Tr>)}</tbody></RdTable></div>; }
export function Stats({ items }: {
    items: Array<[
        string,
        ReactNode,
        string
    ]>;
}) { return <StatBand fit={items.length < 4}>{items.map(([label, value, hint]) => <Stat key={label} label={label} value={value} explain={hint}/>)}</StatBand>; }
export function Summary({ rows }: {
    rows: Array<[
        string,
        ReactNode
    ]>;
}) { return <Facts>{rows.map(([label, value]) => <Fact k={label} key={label}>{value}</Fact>)}</Facts>; }
export function DeviceRightsSummary({ rights }: {rights: RewardDisclosure['deviceRights']}) {
    const yesNo = (value: unknown) => value === true ? '是' : value === false ? '否' : '未确认';
    return <Summary rows={[
        ['激活方式', rights?.activationMode === 'AUTO' ? '自动激活' : rights?.activationMode === 'MANUAL' ? '手动激活' : '未确认'],
        ['生效起点', rights?.effectiveOn === 'ISSUED' ? '发放时' : rights?.effectiveOn === 'ACTIVATED' ? '激活时' : '未确认'],
        ['有效天数', rights?.durationDays === null ? '不限' : typeof rights?.durationDays === 'number' && Number.isFinite(rights.durationDays) ? rights.durationDays : '未确认'],
        ['参与任务', yesNo(rights?.taskEnabled)], ['计入设备持有', yesNo(rights?.countsAsDeviceHolding)],
        ['计入等级', yesNo(rights?.countsForRank)], ['可转让', yesNo(rights?.transferable)], ['可兑换', yesNo(rights?.exchangeable)],
        ['收回方式', rights?.revocationMode === 'REVOKE_IF_UNUSED' ? '未使用可收回' : rights?.revocationMode === 'MANUAL_IF_USED' ? '使用后人工处理' : '未确认']
    ]}/>;
}
/** 状态色：要人处理的（待审核、待发布、暂停、结果未知、人工审阅、追回待处理）用警示，失败用危险，自动过程用进行，结束类用灰。 */
const TAG_TONE: Record<string, StateTone> = { ACTIVE: 'ok', ISSUED: 'ok', SUCCEEDED: 'ok', COMPLETE: 'ok', PUBLISHED: 'ok', MATCHED: 'ok', ELIGIBLE: 'ok', AVAILABLE: 'ok',
    SCHEDULED: 'progress', PENDING: 'progress', READY: 'progress', PROCESSING: 'progress',
    PAUSED: 'warn', OUTCOME_UNKNOWN: 'warn', MANUAL_REVIEW: 'warn', REVERSAL_PENDING: 'warn', PENDING_APPROVAL: 'warn', APPROVED: 'warn', DELAYED: 'warn', UNKNOWN: 'warn', SHORTAGE: 'warn',
    RETRYABLE_FAILED: 'danger', FAILED: 'danger',
    ENDED: 'done', ARCHIVED: 'done', REVERSED: 'done', CANCELLED: 'done', CANCELED: 'done', REVOKED: 'done', UNAVAILABLE: 'done' };
export const stateTone = (value: string, label?: string): StateTone => value === 'APPROVED' && label === '已批准' ? 'ok' : TAG_TONE[value] ?? 'neutral';
export function Tag({ value, label }: {
    value: string;
    label?: string;
}) { return <StatusTag tone={stateTone(value, label)}>{label ?? labelState(value)}</StatusTag>; }
export function Empty({ title, children, action }: {
    title: string;
    children?: ReactNode;
    action?: ReactNode;
}) { return <div className="h4-empty"><BlockState state="empty" title={title} detail={children}/>{action && <div className="h4-empty-action">{action}</div>}</div>; }
export const PROMOTION_STEPS = ['基本信息', '参与资格', '购机赠奖', '预算与叠加'];
const STEP_SUBS = ['类别、时间与公开说明', '人群、设备与等级', '逐设备、逐受益人', '限额、预算与冲突'];
/** 四步：已过的步打勾，当前步实心，未到的步空心；每步都能点（未保存时由编辑器先拦）。 */
export function PromotionSteps({ step, onStep, disabled = false }: { step: number; onStep: (step: number) => void; disabled?: boolean }) {
    return <ol className="h4-steps" aria-label="活动配置四步">{PROMOTION_STEPS.map((name, i) => <li key={name} data-state={step === i ? 'current' : i < step ? 'done' : 'todo'}><button type="button" disabled={disabled} aria-current={step === i ? 'step' : undefined} onClick={() => onStep(i)}><i aria-hidden>{i < step ? <Check size={14} strokeWidth={2.4}/> : i + 1}</i><span>{name}<small>{STEP_SUBS[i]}</small></span></button></li>)}</ol>;
}
export function Loading() { return <BlockState state="loading" title="正在加载，请稍候。"/>; }
export function ReadError({ error, retry, target, retryLabel = '重试' }: {
    error: unknown;
    retry: () => void;
    target: string;
    retryLabel?: string;
}) { return <RdNotice tone="danger" title={`${target}没有读到`} action={<RdButton size="sm" onClick={retry}>{retryLabel}</RdButton>}>{displayAdminError(error)}</RdNotice>; }
export function PromotionReadPanel({ title, loading, errors = [] }: { title: string; loading: boolean; errors?: Array<{target: string; error: unknown; retry: () => void}> }) {
    return <Panel title={`${loading ? '正在加载' : '暂时无法加载'}${title}`}>{loading ? <><BlockState state="loading" title="正在加载，请稍候。" detail="加载完成前不能提交。"/><div className="h4-row"><RdButton disabled>处理进行中</RdButton></div></> : <><BlockState state="error" title="加载失败，已填写的内容还在" detail={<>当前读取未成功，不代表没有记录。依赖最新数据的动作已停用；重试不会再次创建活动或奖励。{errors.map(item => <span className="h4-read-failure" key={item.target}>{item.target}：{displayAdminError(item.error)}</span>)}</>}/><div className="h4-row">{errors.map(item => <RdButton key={item.target} variant="primary" onClick={item.retry}>重试读取<span> · {item.target}</span></RdButton>)}</div><RdNotice tone="warn" title="写入结果未知时">保留填写内容与原操作记录。先核查原操作结果，再决定是否重试；不要重复提交。</RdNotice></>}</Panel>;
}
export function useRead<T>(loader: () => Promise<T>, deps: DependencyList, enabled = true) {
    const ref = useRef(loader);
    ref.current = loader;
    const [data, setData] = useState<T | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [tick, setTick] = useState(0);
    useEffect(() => { const refresh = () => setTick(v => v + 1); window.addEventListener('admin-promotion-original-settled', refresh); return () => window.removeEventListener('admin-promotion-original-settled', refresh); }, []);
    useEffect(() => { if (!enabled) { setLoading(false); return; } let current = true; setLoading(true); setError(null); ref.current().then(v => { if (current)
        setData(v); }).catch(e => { if (current)
        setError(e); }).finally(() => { if (current)
        setLoading(false); }); return () => { current = false; }; }, [...deps, tick, enabled]);
    return { data, error, loading, reload: () => setTick(v => v + 1) };
}
/** 弹窗走 rd Modal；单条详情传 drawer 走右侧抽屉。关闭行为和原来一样：×、Esc、底栏「返回」都调 onClose。 */
export function Dialog({ title, children, onClose, footer, wide = false, drawer = false, sub, danger = false }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    footer?: ReactNode;
    wide?: boolean;
    drawer?: boolean;
    sub?: ReactNode;
    danger?: boolean;
}) {
    const foot = <div className="h4-dialog-foot">{footer || <Button onClick={onClose}>返回</Button>}</div>;
    if (drawer) return <Drawer open onClose={onClose} title={title} sub={sub} wide={wide} footer={foot}><div className="h4-dialog-body">{children}</div></Drawer>;
    return <Modal title={title} sub={sub} tone={danger ? 'danger' : 'neutral'} wide={wide} onClose={onClose} footer={foot}><div className="h4-dialog-body">{children}</div></Modal>;
}
export const PROMOTION_COMMAND_PERMISSIONS: Record<string, string> = {createPromotion: 'edit', saveDraft: 'edit', copyPromotion: 'edit', createDraftVersion: 'edit', submitPromotion: 'submit', withdrawPromotion: 'submit', approvePromotion: 'approve', rejectPromotion: 'approve', publishPromotion: 'publish', pausePromotion: 'pause', resumePromotion: 'pause', endPromotion: 'end', archivePromotion: 'archive', deletePromotion: 'archive', retryReward: 'reward_retry', reconcileReward: 'reward_reconcile', cancelReward: 'reward_cancel', reverseReward: 'reward_reverse', resolveReward: 'reward_resolve', createExport: 'metrics_export', createPolicy: 'policy_write', approvePolicy: 'policy_approve', revokePolicy: 'policy_approve'};
export function ConfirmCommand({ title, intent, body, children, onClose, onSettled, onSuccess, onReload, onVersionConflict, conflictReview, writeAllowed, evidenceOptions = [], requireEvidence = false, evidenceMode = 'upload', confirmLabel = '确认操作', danger = false, sub, evidenceNote, extraAction }: {
    title: string;
    intent: Omit<PromotionCommandIntent, 'body'>;
    body: Record<string, unknown>;
    children?: ReactNode;
    onClose: () => void;
    onSettled?: () => void;
    onSuccess: (result: CommandReceipt, isCurrent: () => boolean) => void | Promise<void>;
    /** 读到最新后返回给运营看的对比；编辑器的对比由 conflictReview.view 自己画，这里返回 null。 */
    onReload?: () => Promise<ReactNode>;
    onVersionConflict?: (error: PromotionApiError) => void;
    /** Editor-owned review survives closing and reopening this confirmation. */
    /** view 画核对前、核对后两种样子；final 表示读到的最新状态已经不能再提交，不再给「重新加载并核对」。 */
    conflictReview?: { reloadNeeded: boolean; view: ReactNode; final?: boolean; error: unknown };
    writeAllowed: boolean;
    evidenceOptions?: Array<{
        value: string;
        label: string;
    }>;
    requireEvidence?: boolean;
    evidenceMode?: 'upload' | 'select';
    /** 以下只管样子：确认按钮写动作名，危险操作用危险样式，标题下一行写生效方式，证据上传前的说明。 */
    confirmLabel?: string;
    danger?: boolean;
    sub?: ReactNode;
    evidenceNote?: ReactNode;
    /** 底栏「取消」右边的另一条出路（如冲突后不保存、返回活动）。 */
    extraAction?: ReactNode;
}) {
    const initial = pendingPromotionCommands().find(p => p.operation === intent.operation && p.targetId === intent.targetId)?.body as Record<string, unknown> | undefined;
    const policy = useRead(fetchA2ReasonPolicy, []), [reason, setReason] = useState(String(initial?.reason || '')), [evidence, setEvidence] = useState<string[]>(Array.isArray(initial?.evidenceRefs) ? initial.evidenceRefs : []), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [note, setNote] = useState(''), [version, setVersion] = useState(0), [upload, setUpload] = useState<Record<string, string>>({}), [uploadState, setUploadState] = useState<string>();
    const record = pendingPromotionCommands().find(p => p.operation === intent.operation && p.targetId === intent.targetId);
    const originalKey = useRef(record?.commandKey);
    if (record) originalKey.current = record.commandKey;
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    useEffect(() => {
        const settled = (event: Event) => {
            if ((event as CustomEvent<string>).detail === originalKey.current) { onSettled?.(); onClose(); }
        };
        window.addEventListener('admin-promotion-original-settled', settled);
        return () => window.removeEventListener('admin-promotion-original-settled', settled);
    }, [onClose, onSettled]);
    const restoredUploads = useRef(new Set<string>());
    const uploadTarget: H4UploadTarget = { kind: "evidence", objectId: intent.targetId, revision: Number(body.expectedRevision), position: "evidenceAssetId", operation: intent.operation };
    useEffect(() => {
        if (!requireEvidence || evidenceMode !== "upload") return;
        const restore = () => { void restoreH4Uploads(uploadTarget, writeAllowed && !record, assetId => { setUpload({ evidenceAssetId: assetId }); setEvidence([assetId]); }, restoredUploads.current); };
        restore(); window.addEventListener("admin-h4-pending-changed", restore);
        return () => window.removeEventListener("admin-h4-pending-changed", restore);
    }, [intent.targetId, intent.operation, body.expectedRevision, writeAllowed, record?.commandKey]);
    const [reloadNeeded, setReloadNeeded] = useState(false), [reviewed, setReviewed] = useState<ReactNode>(null), [reloadFailed, setReloadFailed] = useState(false);
    const needsReload = reloadNeeded || !!conflictReview?.reloadNeeded;
    const visibleError = error || (!record && conflictReview?.error);
    const visibleNote = record ? note : '';
    const payload = { ...body, reason, ...('evidenceRefs' in body ? { evidenceRefs: evidence } : {}) };
    const submit = async (retry = false) => { if (busy || !writeAllowed || !record && needsReload || record && isRetryExpired(record)) return; setBusy(true); setError(null); try {
        const result = record?.receipt || await promotionCommand(record && retry ? record : { ...intent, body: payload }, retry);
        // A normal success callback can close its own dialog; that is not a dismissed original.
        let notifyOriginal = !!record || !active.current;
        await onSuccess(result, () => {
            if (!active.current) notifyOriginal = true;
            return active.current;
        });
        if (notifyOriginal) window.dispatchEvent(new CustomEvent('admin-promotion-original-settled', { detail: result.idempotencyKey }));
        acknowledgePromotionCommand(result);
    }
    catch (e) {
        setError(e);
        if (record && !pendingPromotionCommands().some(r => r.commandKey === record.commandKey)) {
            window.dispatchEvent(new CustomEvent('admin-promotion-original-settled', { detail: record.commandKey }));
        }
        if (!record && e instanceof PromotionApiError && !e.unknownOutcome && !e.bodyUnreadable
            && ['PROMOTION_REVISION_CONFLICT', 'PROMOTION_CONCURRENT_CHANGE', 'PROMOTION_VERSION_NOT_CURRENT', 'PROMOTION_VERSION_STATE_INVALID', 'PROMOTION_RESOURCE_NOT_FOUND'].includes(e.reasonCode || '')) {
            // A rejection never authorizes a read-and-rebase or a second write.
            setReloadNeeded(true);
            setNote('');
            setReviewed(null);
            onVersionConflict?.(e);
        }
    }
    finally {
        setBusy(false);
        setVersion(v => v + 1);
    } };
    const reload = async () => {
        if (!onReload || busy || record) return;
        setBusy(true);
        setReloadFailed(false);
        try {
            setReviewed(await onReload());
            setError(null);
            setReloadNeeded(false);
        } catch (e) {
            setError(e);
            setReloadFailed(true);
        } finally {
            setBusy(false);
        }
    };
    const recover = async () => { if (!record)
        return; setBusy(true); setError(null); try {
        const result = record.receipt || await recoverPromotionCommand(record);
        if (result.status === 'SUCCEEDED') {
            await onSuccess(result, () => active.current);
            window.dispatchEvent(new CustomEvent('admin-promotion-original-settled', { detail: record.commandKey }));
            acknowledgePromotionCommand(result);
        }
        else if (result.status === 'FAILED') window.dispatchEvent(new CustomEvent('admin-promotion-original-settled', { detail: record.commandKey }));
        else
            setNote(result.status === 'NOT_FOUND' ? '未查到原操作，可按原参数和原操作编号重试。' : `原操作：${labelState(result.status)}。保留输入，继续核查。`);
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
        setVersion(v => v + 1);
    } };
    const invalid = !policy.data || policy.loading || !!policy.error || reason.trim().length < policy.data.minChars || reason.trim().length > policy.data.maxChars || (requireEvidence && !evidence.length) || !!uploadState;
    const reasonLength = reason.trim().length;
    // 冲突这一块放在框的最上面：核对前只说没执行、点哪里核对；核对后是对比；读取失败、已经不能提交各一句。
    const locked = !record && !!onReload && needsReload;
    const conflictBlock = record || !onReload ? null : conflictReview?.final ? conflictReview.view
        : locked && reloadFailed ? <RdNotice tone="danger" title="最新内容没读到">{displayAdminError(visibleError)}这一步还没做，填的内容都在；可以再点「重新加载并核对」。</RdNotice>
        : conflictReview ? conflictReview.view
        : locked ? <RdNotice tone="warn" title="这次没有执行：你打开后，别人改过这个活动">{`点「重新加载并核对」，看清变了什么再决定要不要${confirmLabel}。`}</RdNotice>
        : reviewed;
    const conflictExplains = !!conflictBlock && (locked || !!conflictReview?.final);
    return <Dialog title={title} sub={sub} danger={danger} onClose={onClose} wide={requireEvidence || !!conflictBlock} footer={<><Button onClick={onClose} disabled={busy}>取消</Button>{extraAction}{needsReload && onReload && !conflictReview?.final && <RdButton variant="primary" onClick={reload} disabled={busy || !!record}>{busy ? "正在加载…" : "重新加载并核对"}</RdButton>}{record ? <><Button onClick={recover} disabled={busy}>{record.receipt ? '读取已成功的结果' : '查询原结果'}</Button>{record.recoveryState === 'NOT_FOUND' && !isRetryExpired(record) && <Button kind="primary" onClick={() => submit(true)} disabled={busy || !writeAllowed || policy.loading || !!policy.error}>按原请求重试</Button>}</> : !locked && <RdButton variant={danger ? 'danger' : 'primary'} onClick={() => submit()} disabled={busy || needsReload || invalid || !writeAllowed}>{busy ? '正在提交…' : confirmLabel}</RdButton>}</>}>
    {conflictBlock}
    {record && <RdNotice tone="warn" title="结果未知">{record.receipt ? '原操作已经成功，当前只重读结果；不会再次提交。' : '原参数已锁定；查询前不会创建第二次操作。关闭后仍可在活动中心继续处理。'}</RdNotice>}
    <fieldset className="h4-fieldset" disabled={busy || !!record || !writeAllowed}>{children}</fieldset>
    <fieldset className="h4-fieldset" disabled={busy || !!record || !writeAllowed}><RdField label="操作理由" required hint={policy.data ? `${policy.data.minChars}–${policy.data.maxChars} 字，和操作一起留痕` : '正在读取理由要求'}>{control => <Textarea {...control} value={reason} onChange={e => setReason(e.target.value)} maxLength={policy.data?.maxChars} count={policy.data ? `${reasonLength}/${policy.data.maxChars}` : undefined}/>}</RdField>{evidenceOptions.length > 0 && <fieldset className="h4-fieldset h4-evidence"><legend className="rd-form-label">关联证据{requireEvidence ? <span className="rd-form-required" aria-hidden>*</span> : null}</legend>{evidenceOptions.map(option => <RdCheck key={option.value} label={option.label} checked={evidence.includes(option.value)} onChange={e => setEvidence(e.target.checked ? [...evidence, option.value] : evidence.filter(x => x !== option.value))}/>)}</fieldset>}</fieldset>
    {requireEvidence && evidenceMode === 'upload' && <fieldset className="h4-fieldset" disabled={busy || !!record || !writeAllowed}>{evidenceNote}<BusinessFormBlock spec={{ kind: 'multi-field', title: '上传处置证据', fields: [{ key: 'evidenceAssetId', label: '关联证据图片', inputKind: 'asset-upload', required: true, wide: true, uploadDomain: 'growth', uploadUsage: 'promotion-evidence', uploadTarget, help: '上传可核验的关联凭据，上传成功后才允许提交。' }] }} value={upload} onChange={v => { setUpload(v); setEvidence(v.evidenceAssetId ? [v.evidenceAssetId] : []); }} onUploadStateChange={(_, state) => setUploadState(state)}/></fieldset>}
    {!writeAllowed && !(conflictReview?.final || reviewed && !locked) && <RdNotice tone="warn" title="当前操作已停用">授权或依赖数据当前无法支持此操作。原输入与操作记录继续保留；查询原结果也要这项操作的权限，可能被拒。</RdNotice>}{!!policy.error && <ReadError target="操作理由要求" error={policy.error} retry={policy.reload}/>}{!!visibleError && !conflictExplains && <RdNotice tone="danger" title="操作尚未完成">{displayAdminError(visibleError)}{visibleError instanceof PromotionApiError&&visibleError.fieldErrors.map((f,i)=><p key={i} className="h4-input-error">{promotionFieldLabel(f.field)}：未填写完整或不符合当前约束。</p>)}</RdNotice>}{visibleNote && <RdNotice tone="neutral" title="查询结果">{visibleNote}</RdNotice>}<span hidden>{version}</span>
  </Dialog>;
}
