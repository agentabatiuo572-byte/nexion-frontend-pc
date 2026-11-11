"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Inbox, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { BlockState, Button, Cell, Check, CheckGroup, Decision, Drawer, Fact, Facts, Field, Fold, IconButton, Input, Modal, Notice, Panel, Segments, Select, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr } from "@/app/components/rd";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { PhoneApiError, fetchPhoneOverview, fetchPhoneRequests, fetchPhoneHistory, fetchPhoneOperation, pendingPhoneCommands, preparePhoneCommand, submitPhoneCommand, recoverPhoneCommand, type PendingPhoneCommand } from "@/lib/admin/phone-replacement-client";
import { PHONE_GRANT, PHONE_REVOKE, phoneLabel, phoneCommandAllowed, record, type PhoneCommand, type PhoneOverview, type PhonePage, type PhoneRequest, type PhoneReceipt, type PhoneVerification } from "@/lib/admin/phone-replacement-contract";
import { PhoneFacts, PhoneIdentifier, PhoneReceiptView, phoneTimeCompact as phoneTime } from "../phone-replacement-receipt";

const historyReceiptTypes = ["PHONE_GRANT_ISSUE", "PHONE_REQUEST_CLOSE", "PHONE_GRANT_REVOKE"];
import { PhoneModelLockSection } from "./phone-model-lock-section";
export function PhoneReplacementPanel({ userId, userLabel, userCode, active = true, onPendingChange, onBusyChange }: {
    onPendingChange?: () => void; onBusyChange?: (busy: boolean) => void;
    active?: boolean;
    userCode: string;
    userId: string | null;
    userLabel: string;
}) {
    const session = useAdminAuth(s => s.session);
    const epoch = useAdminAuth(s => s.authEpoch);
    if (!session?.authorities.includes("user_c5_read")) return null;
    if (!userId) return <Panel title="手机绑定与换机特批" icon={Smartphone}><BlockState state="empty" title="先选择用户，再查看手机绑定与换机申请" /></Panel>;
    return <AccountPhonePanel key={`${session.adminId}:${epoch}:${userId}`} active={active} userId={userId} userLabel={userLabel} userCode={userCode} owner={session.adminId} rights={session.authorities} onPendingChange={onPendingChange} onBusyChange={onBusyChange} />;
}
function AccountPhonePanel({ userId, userLabel, userCode, active, owner, rights, onPendingChange, onBusyChange }: {
    onPendingChange?: () => void; onBusyChange?: (busy: boolean) => void;
    userCode: string;
    active: boolean;
    userId: string;
    userLabel: string;
    owner: number;
    rights: string[];
}) {
    const canGrant = rights.includes(PHONE_GRANT), canRevoke = rights.includes(PHONE_REVOKE);
    const [overview, setOverview] = useState<PhoneOverview | null>(null);
    const [requests, setRequests] = useState<PhonePage<PhoneRequest> | null>(null);
    const [requestPage, setRequestPage] = useState(1);
    const [selected, setSelected] = useState<string>("");
    const [kind, setKind] = useState<"SUCCESS" | "REQUEST" | "GRANT">("SUCCESS");
    const [page, setPage] = useState(1);
    const [history, setHistory] = useState<PhonePage<Record<string, unknown>> | null>(null);
    const [historyError, setHistoryError] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [denied, setDenied] = useState(false);
    const [verification, setVerification] = useState<PhoneVerification | null>(null);
    const [waiveCount, setWaiveCount] = useState(false);
    const [waiveInterval, setWaiveInterval] = useState(false);
    const [reason, setReason] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [confirm, setConfirm] = useState<{
        type: PhoneCommand;
        target: string;
        label: string;
    } | null>(null);
    const [receiptIndependent, setReceiptIndependent] = useState(false);
    const [receipt, setReceipt] = useState<PhoneReceipt | null>(null);
    const [pendingRows, setPendingRows] = useState<PendingPhoneCommand[]>([]);
    const [lookup, setLookup] = useState("");
    const [lookupType, setLookupType] = useState<PhoneCommand>(canGrant ? "PHONE_GRANT_ISSUE" : "PHONE_GRANT_REVOKE");
    const [lookupMode, setLookupMode] = useState("id");
    const live = useRef(true), mutation = useRef(false), generation = useRef(0), historyGeneration = useRef(0);
    const [detail, setDetail] = useState<"" | "requests" | "models" | "history">("");
    const [historyRow, setHistoryRow] = useState<Record<string, unknown> | null>(null);
    const selection = requests?.items.find(row => row.requestId === selected) ?? (overview?.pendingRequest?.request.requestId === selected ? overview.pendingRequest.request : undefined);
    useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
    const syncPending = useCallback(() => { setPendingRows(pendingPhoneCommands(owner, userId)); onPendingChange?.(); }, [owner, userId, onPendingChange]);
    const fail = useCallback((failure: unknown, accountRead = false) => {
        if (!live.current)
            return;
        const accountUnavailable = accountRead && failure instanceof PhoneApiError && failure.status === 404;
        if (accountUnavailable || failure instanceof PhoneApiError && [401, 403].includes(failure.status)) {
            generation.current++;
            historyGeneration.current++;
            if (failure instanceof PhoneApiError && failure.status === 403) announcePermissionDenied();
            setDenied(true);
            setLoading(false);
            setHistoryLoading(false);
            setOverview(null);
            setRequests(null);
            setHistory(null);
            setReceipt(null);
            setVerification(null);
            setConfirm(null);
            setPendingRows([]);
            setMessage("");
            setHistoryError("");
        }
        setError(accountUnavailable ? "当前账号不存在或不在可访问范围，请重新选择账号。" : failure instanceof Error ? failure.message : "请求未完成，请重新查询。");
    }, []);
    const load = useCallback(async () => {
        const id = ++generation.current;
        setLoading(true);
        setError("");
        setOverview(null);
        setRequests(null);
        setVerification(null);
        try {
            const [summary, rows] = await Promise.all([fetchPhoneOverview(userId), fetchPhoneRequests(userId, requestPage)]);
            if (!live.current || id !== generation.current)
                return;
            setOverview(summary);
            setRequests(rows);
            setSelected(current => rows.items.some(r => r.requestId === current) ? current : summary.pendingRequest?.request.requestId ?? "");
            syncPending();
        }
        catch (failure) {
            if (id === generation.current)
                fail(failure, true);
        }
        finally {
            if (live.current && id === generation.current)
                setLoading(false);
        }
    }, [userId, requestPage, syncPending, fail]);
    const loadHistory = useCallback(async () => {
        const id = ++historyGeneration.current;
        setHistoryLoading(true);
        setHistory(null);
        setHistoryError("");
        try {
            const data = await fetchPhoneHistory(userId, kind, page);
            if (live.current && id === historyGeneration.current)
                setHistory(data);
        }
        catch (failure) {
            if (live.current && id === historyGeneration.current) {
                setHistoryError(failure instanceof Error ? failure.message : "历史读取失败。");
                if (failure instanceof PhoneApiError && [401, 403, 404].includes(failure.status))
                    fail(failure, true);
            }
        }
        finally {
            if (live.current && id === historyGeneration.current)
                setHistoryLoading(false);
        }
    }, [userId, kind, page, fail]);
    useEffect(() => { live.current = true; syncPending(); void load(); return () => { live.current = false; generation.current++; }; }, [load]);
    useEffect(() => { void loadHistory(); return () => { historyGeneration.current++; }; }, [loadHistory]);
    function acceptResult(result: PhoneReceipt | PhoneVerification | null, independent = false) {
        setReceipt(null);
        if (!result) {
            setMessage("暂未查到原操作，结果仍待核实。请保留原记录，稍后继续查询；不要重新提交。");
            return;
        }
        if ("evidenceRef" in result) {
            setVerification(result);
            setMessage("原核实记录已确认。请核对豁免项，再明确签发。");
        }
        else {
            setReceiptIndependent(independent);
            setReceipt(result);
            setMessage(result.status === "PENDING" ? "原操作仍在处理中，请稍后查询。" : "已取得原操作结果，请分别核对当前状态。");
        }
    }
    async function recover(row: PendingPhoneCommand) {
        if (mutation.current || !phoneCommandAllowed(row.type, rights))
            return;
        mutation.current = true;
        setBusy(true);
        setError("");
        setReceipt(null);
        setMessage("");
        try {
            const result = await recoverPhoneCommand(row);
            if (live.current) {
                acceptResult(result);
                syncPending();
                if (result && "status" in result) {
                    void load();
                    void loadHistory();
                }
            }
        }
        catch (failure) {
            fail(failure);
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    function begin(type: PhoneCommand, target: string, label: string) {
        if (!phoneCommandAllowed(type, rights) || busy || loading || pendingRows.length || !overview)
            return;
        setConfirm({ type, target, label });
        setConfirmed(false);
        setError("");
    }
    async function submit() {
        if (mutation.current || !confirm || !confirmed || reason.trim().length < 8 || reason.trim().length > 200 || !overview || !phoneCommandAllowed(confirm.type, rights))
            return;
        if (confirm.type === "PHONE_GRANT_ISSUE" && (!selection || !verification || verification.requestId !== selection.requestId || !(waiveCount || waiveInterval) || !overview.eligibility.historyComplete && !waiveCount || overview.eligibility.binding?.changedAt == null && !waiveInterval))
            return;
        mutation.current = true;
        setBusy(true);
        setError("");
        setReceipt(null);
        setMessage("");
        const body: Record<string, unknown> = { reason: reason.trim(), confirmed: true };
        if (confirm.type === "PHONE_GRANT_ISSUE")
            Object.assign(body, { requestId: selection!.requestId, expectedBindingVersion: selection!.bindingVersion, waiveCount, waiveInterval, evidenceRef: verification!.evidenceRef });
        try {
            const attempt = preparePhoneCommand(owner, userId, confirm.type, confirm.target, body, { label: userLabel, userNo: userCode, supportRef: selection?.supportRef ?? undefined });
            syncPending();
            const result = await submitPhoneCommand(attempt);
            if (!live.current)
                return;
            setConfirm(null);
            setReason("");
            acceptResult(result);
            syncPending();
            if (!("evidenceRef" in result)) {
                void load();
                void loadHistory();
            }
        }
        catch (failure) {
            fail(failure);
            if (live.current) {
                syncPending();
                setConfirm(null);
            }
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    async function query(input?: string) {
        if (mutation.current || !(canGrant || canRevoke) || (!input && !lookup.trim()))
            return;
        mutation.current = true;
        setBusy(true);
        setError("");
        setReceipt(null);
        setMessage("");
        try {
            const result = await fetchPhoneOperation(input || lookupMode === "id" ? { operationId: input || lookup.trim() } : { commandType: lookupType, idempotencyKey: lookup.trim() });
            if (live.current) {
                acceptResult(result, !input);
            }
        }
        catch (failure) {
            fail(failure);
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    const blocked = busy || loading || denied || !!confirm || pendingRows.length > 0;
    const usableRequest = !!selection && selection.status === "PENDING" && !!overview && selection.expiresAt > overview.eligibility.serverNow;
    const activeGrant = overview?.eligibility.grant ?? overview?.pendingRequest?.grant;
    const grantBlock = blocked ? "先完成当前操作或查询待确认结果" : !usableRequest ? "请选择有效的待处理申请" : verification?.requestId !== selected ? "先核实本申请的关联客服记录" : !(waiveCount || waiveInterval) ? "至少选择一项豁免" : !overview?.eligibility.historyComplete && !waiveCount ? "历史次数未知，须选择次数豁免" : overview.eligibility.binding?.changedAt == null && !waiveInterval ? "绑定时间未知，须选择间隔豁免" : activeGrant?.status === "ACTIVE" ? "已有有效特批，不能叠加" : undefined;
    const confirmLabel = confirm?.type === "PHONE_VERIFY" ? "确认核实关联记录" : confirm?.type === "PHONE_REQUEST_CLOSE" ? "不予授予并关闭申请" : confirm?.type === "PHONE_GRANT_REVOKE" ? "确认撤销授权" : "确认一次授权";
    return <div className="c5-phone-workspace" data-proof="c5-phone-replacement" aria-label="手机绑定与一次性特批">
      {error && <Notice tone="warn">{error}</Notice>}
      {message && !denied && <Notice tone="progress">{message}</Notice>}
      {pendingRows.length > 0 && <Notice tone="warn" title="提交结果待核实" actionBelow action={pendingRows.filter(row => phoneCommandAllowed(row.type, rights)).map(row => <Button key={row.commandKey} size="sm" loading={busy} onClick={() => void recover(row)}>查询原操作结果</Button>)}>
        {pendingRows.filter(row => phoneCommandAllowed(row.type, rights)).map(row => <Fold key={row.commandKey} title={phoneLabel(row.type)} summary={`${row.label ?? userLabel} · ${phoneTime(row.createdAt)}`}><Facts><Fact k="原确认对象">{row.target}</Fact><Fact k="原操作标识">{row.commandKey}</Fact><Fact k="恢复方式">{row.expiresAt <= Date.now() ? "已过 24 小时，保留记录，仅查询" : "只查询原操作，不重新提交"}</Fact></Facts><PhoneFacts time={phoneTime} value={row.body} /></Fold>)}
        {pendingRows.some(row => !phoneCommandAllowed(row.type, rights)) && <span>恢复原处置权限后查询，原记录继续保留。</span>}
      </Notice>}
      <Panel title="手机绑定与换机条件" icon={Smartphone} explain="处理更换手机设备的申请，与更改登录手机号分开统计。特批只放宽次数或间隔，仍由用户回 App 主动确认。" actions={<IconButton aria-label="刷新手机绑定与换机申请" disabled={busy || loading || !!confirm || denied} onClick={() => { void load(); void loadHistory(); }}><RefreshCw size={16} /></IconButton>}>
        {denied ? <BlockState state="denied" title="暂时无法查看此用户" detail="请重新选择用户或登录后再试。" /> : loading ? <BlockState state="loading" title="正在读取手机与申请状态" /> : !overview ? <BlockState state="error" title="手机信息未能加载" onRetry={() => void load()} retryLabel="刷新" /> : <>
          <div className="c5-phone-summary">
            <Facts><Fact k="手机绑定">{overview.eligibility.binding ? "已绑定" : "未绑定"}</Fact><Fact k="绑定安装"><span data-mono>{overview.eligibility.binding?.installationId ?? "尚未绑定手机"}</span></Fact><Fact k="最近绑定时间">{phoneTime(overview.eligibility.binding?.changedAt)}</Fact></Facts>
            <Facts><Fact k="换机资格"><StatusTag tone={overview.eligibility.canReplace ? "ok" : "warn"}>{overview.eligibility.canReplace ? "可更换" : "暂不能更换"}</StatusTag></Fact><Fact k="统计期内已换机">{overview.eligibility.usedCount ?? "待核实"} 次</Fact><Fact k="剩余可换次数">{overview.eligibility.remainingCount ?? "待核实"} 次</Fact><Fact k="最早可更换时间">{phoneTime(overview.eligibility.nextAllowedAt)}</Fact></Facts>
          </div>
          {overview.eligibility.binding && <Fold title="绑定技术详情" summary={`绑定版本 ${overview.eligibility.binding.bindingVersion}`}><PhoneFacts time={phoneTime} value={overview.eligibility.binding} /></Fold>}
          {!overview.eligibility.historyComplete && <Notice tone="warn">历史次数待核实，不按零次计算。</Notice>}
          {overview.executionPauseReason && <Notice tone="warn" title="手机执行已暂停">{phoneLabel(overview.executionPauseReason)}</Notice>}
          {!overview.eligibility.canReplace && <Notice tone="warn" title="暂不能更换手机">{overview.eligibility.blockedReasons.length ? <ul className="c5-blocked-reasons">{overview.eligibility.blockedReasons.map((value, index) => <li key={`${value}:${index}`}>{phoneLabel(value)}</li>)}</ul> : "请核对当前绑定状态和换机条件。"}</Notice>}
          {overview.eligibility.canReplace && <Notice tone="ok">已满足换机条件，需由用户在 App 中确认更换。</Notice>}
        </>}
      </Panel>
      {!denied && overview && <>
        <Panel aria-label="待处理换机申请" title="当前换机申请" icon={Inbox} sub={selection?.requestNo} actions={<Button size="sm" disabled={busy || loading || !!confirm} onClick={() => setDetail(detail === "requests" ? "" : "requests")}>选择换机申请</Button>}>
          {!selection ? <BlockState state="empty" title="暂无选中的换机申请" detail="可从申请记录选择一条，核对后再处置。" /> : <>
            <Facts><Fact k="目标安装"><span data-mono>{selection.targetInstallationId}</span></Fact><Fact k="申请状态"><StatusTag tone={selection.status === "PENDING" ? "warn" : "done"}>{phoneLabel(selection.status)}</StatusTag></Fact><Fact k="客服关联">{phoneLabel(selection.supportLinkStatus)}</Fact><Fact k="客服会话引用">{selection.supportRef ?? "未关联"}</Fact><Fact k="申请到期">{phoneTime(selection.expiresAt)}</Fact></Facts>
            {canGrant && <>
              <CheckGroup legend="本次特批范围" explain="特批有效 24 小时，仅可使用一次。不会直接绑定或激活手机；不能解除禁换、账户限制、风险暂停、校准或条款要求。"><Check checked={waiveCount} disabled={blocked || !usableRequest} onChange={event => setWaiveCount(event.target.checked)} label="豁免次数限制" /><Check checked={waiveInterval} disabled={blocked || !usableRequest} onChange={event => setWaiveInterval(event.target.checked)} label="豁免间隔限制" /></CheckGroup>
              {!overview.eligibility.historyComplete && <Notice tone="warn">历史次数未知，须勾选次数豁免；未知标记继续保留。</Notice>}
              {overview.eligibility.binding?.changedAt == null && <Notice tone="warn">原绑定时间未知，须勾选间隔豁免。</Notice>}
              <div className="rd-toolbar" data-end=""><span className="rd-toolbar-note">{verification?.requestId === selected ? `已核实 · ${phoneTime(verification.verifiedAt)}` : "签发前先核实关联客服记录"}</span><Button variant="danger-outline" disabledReason={blocked ? "先核对当前操作" : !usableRequest ? "仅有效待处理申请可以关闭" : undefined} onClick={() => begin("PHONE_REQUEST_CLOSE", selection.requestId, "不予授予并关闭申请")}>不予授予</Button><Button disabledReason={blocked ? "先核对当前操作" : !usableRequest ? "申请已到期或不在待处理状态" : selection.supportLinkStatus !== "LINKED" ? "先关联客服记录" : undefined} onClick={() => begin("PHONE_VERIFY", selection.requestId, "核实关联记录")}>核实关联记录</Button><Button variant="primary" disabledReason={grantBlock} onClick={() => begin("PHONE_GRANT_ISSUE", selected, "授予一次换机特批")}>确认一次授权</Button></div>
            </>}
            <Fold title="申请技术详情" summary="理由、版本与核实记录"><PhoneFacts time={phoneTime} value={selection} />{verification && <PhoneFacts time={phoneTime} value={verification} />}</Fold>
          </>}
        </Panel>
        {!activeGrant && <div className="c5-context-line">暂无有效特批</div>}
        {activeGrant && <Panel aria-label="当前换机特批" title="当前换机特批" icon={ShieldCheck} actions={canRevoke && <Button variant="danger-outline" size="sm" disabledReason={blocked ? "先核对当前操作" : activeGrant.status !== "ACTIVE" ? "只有仍有效的特批可以撤销" : undefined} onClick={() => begin("PHONE_GRANT_REVOKE", activeGrant.grantId, "撤销一次换机特批")}>撤销授权</Button>}>
          <Facts><Fact k="授权状态"><StatusTag tone={activeGrant.status === "ACTIVE" ? "ok" : "done"}>{phoneLabel(activeGrant.status)}</StatusTag></Fact><Fact k="有效期至">{phoneTime(activeGrant.expiresAt)}</Fact><Fact k="剩余使用次数">{activeGrant.remainingUses ?? "待核实"} 次</Fact><Fact k="次数豁免">{activeGrant.waiveCount ? "是" : "否"}</Fact><Fact k="间隔豁免">{activeGrant.waiveInterval ? "是" : "否"}</Fact></Facts><Fold title="查看特批详情" summary={activeGrant.grantId}><PhoneFacts time={phoneTime} value={activeGrant} /></Fold>
        </Panel>}
        {overview.pendingOperations.map(row => <Notice key={row.operationId} tone="warn" title="正在处理的操作" action={(canGrant || canRevoke) && <Button size="sm" disabled={busy} onClick={() => void query(row.operationId)}>查询原操作</Button>}>{phoneLabel(row.commandType)} · {phoneTime(row.submittedAt)}</Notice>)}
      </>}
      {!denied && <>
        <div className="c5-detail-switch" aria-label="手机明细"><Button aria-pressed={detail === "requests"} onClick={() => setDetail(detail === "requests" ? "" : "requests")}>申请记录</Button><Button aria-pressed={detail === "models"} onClick={() => setDetail(detail === "models" ? "" : "models")}>手机机型锁</Button><Button aria-pressed={detail === "history"} onClick={() => setDetail(detail === "history" ? "" : "history")}>成功换机与特批历史</Button></div>
        {detail === "requests" && <Panel title="申请记录" sub={`第 ${requestPage} 页 · 每页 10 条`} flush><Table aria-label="换机申请" label="换机申请" className="c5-phone-requests"><thead><tr><Th>申请</Th><Th>目标安装</Th><Th>状态</Th><Th sticky="end">操作</Th></tr></thead><tbody>{loading ? <TableLoading columns={4} /> : requests?.items.map(row => <Tr key={row.requestId} selected={row.requestId === selected}><Td><Cell main={<PhoneIdentifier value={row.requestNo} />} sub={phoneTime(row.createdAt)} title={row.requestNo} /></Td><Td><Cell mono main={<PhoneIdentifier value={row.targetInstallationId} />} title={row.targetInstallationId} /></Td><Td><StatusTag tone={row.status === "PENDING" ? "warn" : "done"}>{phoneLabel(row.status)}</StatusTag></Td><Td sticky="end"><Button size="sm" disabled={blocked} onClick={() => { setSelected(row.requestId); setVerification(null); setWaiveCount(false); setWaiveInterval(false); setDetail(""); }}>选择申请</Button></Td></Tr>)}{!loading && !requests?.items.length && <TableMessage columns={4}>{error ? "申请尚未确认，请刷新" : "本页暂无换机申请"}</TableMessage>}</tbody></Table>{(requestPage > 1 || requests?.hasMore) && <div className="c5-pager"><span>第 {requestPage} 页</span><Button size="sm" disabled={blocked || requestPage === 1} onClick={() => setRequestPage(value => value - 1)}>上一页申请</Button><Button size="sm" disabled={blocked || !requests?.hasMore} onClick={() => setRequestPage(value => value + 1)}>下一页申请</Button></div>}</Panel>}
        {detail === "models" && <PhoneModelLockSection active={active} userId={userId} userCode={userCode} userLabel={userLabel} rights={rights} onPendingChange={onPendingChange} onBusyChange={onBusyChange} />}
        {detail === "history" && <Panel aria-label="换机与处置历史" title="换机与处置历史" icon={Clock3} actions={<Segments label="记录类型" value={kind} onChange={value => { setKind(value); setPage(1); }} items={[{ value: "SUCCESS", label: "成功换机" }, { value: "REQUEST", label: "申请记录" }, { value: "GRANT", label: "特批记录" }]} />} flush>
          {historyError && <BlockState state="error" title="历史记录未能读取" detail={historyError} onRetry={() => void loadHistory()} retryLabel="重试历史查询" />}
          <Table aria-label="换机历史" label="换机历史" className="c5-phone-history"><thead><tr><Th>记录</Th><Th>对象</Th><Th>状态</Th><Th sticky="end">操作</Th></tr></thead><tbody>{historyLoading ? <TableLoading columns={4} /> : history?.items.map((row, index) => { const objectId = kind === "SUCCESS" ? row.sourceId : row.targetInstallationId; return <Tr key={index} selected={historyRow === row} onOpen={() => setHistoryRow(row)}><Td><Cell main={<PhoneIdentifier value={String(row.requestNo ?? row.grantId ?? row.operationId ?? row.requestId ?? "换机记录")} />} sub={phoneTime(row.createdAt ?? row.issuedAt ?? row.committedAt)} title={String(row.requestNo ?? row.grantId ?? row.operationId ?? row.requestId ?? "")} /></Td><Td>{objectId != null && <Cell mono main={<PhoneIdentifier value={String(objectId)} />} title={String(objectId)} />}</Td><Td><StatusTag tone={row.status === "PENDING" ? "warn" : row.status === "ACTIVE" ? "ok" : "done"}>{row.status ? phoneLabel(row.status) : kind === "SUCCESS" ? "换机成功" : "未记录"}</StatusTag></Td><Td sticky="end"><Button size="sm" onClick={() => setHistoryRow(row)}>查看详情</Button></Td></Tr>; })}{!historyLoading && !history?.items.length && <TableMessage columns={4}>{historyError ? "历史记录尚未确认" : "本页暂无此类记录"}</TableMessage>}</tbody></Table>{(page > 1 || history?.hasMore) && <div className="c5-pager"><span>第 {page} 页 · 每页 10 条</span><Button size="sm" disabled={historyLoading || page === 1} onClick={() => setPage(value => value - 1)}>上一页历史</Button><Button size="sm" disabled={historyLoading || !history?.hasMore} onClick={() => setPage(value => value + 1)}>下一页历史</Button></div>}
        </Panel>}
        {overview && <Fold title="换机规则与登录设备" summary={`策略版本 ${overview.eligibility.policy.policyVersion ?? "待核实"}`}><Panel plain title="当前换机规则"><PhoneFacts time={phoneTime} value={overview.eligibility.policy} /></Panel><Panel plain title="登录设备">{overview.sessions.length ? overview.sessions.map((row, index) => <Fold key={index} title={row.sessionGroup === "APP" ? "手机应用" : "网页版"} summary={`${row.sessionCount} 条登录记录`}><Facts><Fact k="设备标识">{row.installationId || "未提供"}</Fact><Fact k="最近活跃">{formatBusinessTimeCompact(row.lastActiveAt)}</Fact><Fact k="应用版本">{row.appSessionVersion ?? "不适用"}</Fact><Fact k="手机执行">{row.executionSupported ? "支持" : "不支持"}</Fact></Facts></Fold>) : <BlockState state="empty" title="暂无有效登录记录" />}</Panel></Fold>}
        {(canGrant || canRevoke) && <Fold title="查询此前操作结果" summary="操作号或原操作标识" explain="只读查询，不会重新提交。可能返回其他用户的结果，须按申请号或特批号核对。"><div className="c5-query-grid"><Field label="查询方式"><Select aria-label="查询方式" value={lookupMode} onChange={setLookupMode} options={[{ value: "id", label: "操作号" }, { value: "key", label: "原操作标识" }]} /></Field>{lookupMode === "key" && <Field label="操作类型"><Select aria-label="操作类型" value={lookupType} onChange={value => setLookupType(value as PhoneCommand)} options={(["PHONE_GRANT_ISSUE", "PHONE_REQUEST_CLOSE", "PHONE_GRANT_REVOKE"] as PhoneCommand[]).filter(value => phoneCommandAllowed(value, rights)).map(value => ({ value, label: phoneLabel(value) }))} /></Field>}<Field label={lookupMode === "id" ? "原操作号" : "当前操作者的原操作标识"}><Input aria-label="原操作查询标识" value={lookup} maxLength={128} onChange={event => setLookup(event.target.value)} /></Field></div><div className="rd-toolbar" data-end=""><Button disabledReason={busy ? "正在查询" : !lookup.trim() ? "填写原操作号或原操作标识" : undefined} onClick={() => void query()}>只读查询</Button></div></Fold>}
      </>}
      {active && confirm && <Modal title={confirm.label} icon={ShieldCheck} tone={confirm.type === "PHONE_REQUEST_CLOSE" || confirm.type === "PHONE_GRANT_REVOKE" ? "danger" : "neutral"} sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} busy={busy} onClose={() => setConfirm(null)} footer={<Decision others={<Button disabled={busy} onClick={() => setConfirm(null)}>取消</Button>} primary={<Button variant={confirm.type === "PHONE_REQUEST_CLOSE" || confirm.type === "PHONE_GRANT_REVOKE" ? "danger" : "primary"} loading={busy} disabledReason={reason.trim().length < 8 || reason.trim().length > 200 ? "填写 8–200 字的理由" : !confirmed ? "先核对对象与操作影响" : undefined} onClick={() => void submit()}>{confirmLabel}</Button>} />}>
        <Facts><Fact k="用户">{userLabel}</Fact><Fact k="确认对象">{confirm.target}</Fact>{confirm.type === "PHONE_GRANT_ISSUE" && <><Fact k="目标安装">{selection?.targetInstallationId}</Fact><Fact k="绑定版本">{selection?.bindingVersion}</Fact><Fact k="次数豁免">{waiveCount ? "是" : "否"}</Fact><Fact k="间隔豁免">{waiveInterval ? "是" : "否"}</Fact><Fact k="有效范围">24 小时、一次使用，须用户回 App 主动确认</Fact></>}{confirm.type === "PHONE_VERIFY" && <Fact k="客服会话引用">{selection?.supportRef}</Fact>}</Facts>
        <Notice tone="warn">{confirm.type === "PHONE_VERIFY" ? "请人工核对申请与关联客服会话。核实不会发送客服消息。" : confirm.type === "PHONE_REQUEST_CLOSE" ? "关闭申请后，不向此申请签发特批。" : confirm.type === "PHONE_GRANT_REVOKE" ? "仅撤销仍有效且未使用的授权，不能撤回已完成的换机。" : "仅豁免所选次数或间隔限制，不直接绑定或激活手机。"}</Notice>
        <Field label="操作理由" required hint="8–200 字" error={reason && (reason.trim().length < 8 || reason.trim().length > 200) ? "请填写 8–200 字的理由" : undefined}><Textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)} rows={3} count={`${reason.trim().length}/200`} /></Field><Check checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} label="我已核对用户、对象及上述影响，明确确认此操作" />
      </Modal>}
      {active && historyRow && <Drawer open onClose={() => setHistoryRow(null)} title="换机历史详情" icon={Clock3}><PhoneFacts time={phoneTime} value={historyRow} />{Array.isArray(historyRow.operations) && historyRow.operations.filter(record).map((operation, index) => <Fold key={index} title="关联原操作" summary={String(operation.operationId ?? "未记录")}><PhoneFacts time={phoneTime} value={operation} />{(canGrant || canRevoke) && typeof operation.operationId === "string" && historyReceiptTypes.includes(String(operation.commandType)) && <Button size="sm" onClick={() => { setHistoryRow(null); void query(String(operation.operationId)); }}>查看原操作结果</Button>}</Fold>)}{typeof historyRow.operationId === "string" && historyReceiptTypes.includes(String(historyRow.commandType)) && (canGrant || canRevoke) && <Button size="sm" onClick={() => { const id = String(historyRow.operationId); setHistoryRow(null); void query(id); }}>查看原操作结果</Button>}</Drawer>}
      {active && receipt && <Drawer open onClose={() => setReceipt(null)} title="原操作回执" icon={ShieldCheck}>{receiptIndependent && <Notice tone="warn">这条结果可能属于其他账号，不代表当前选中的账号，请按申请号或特批号核对。</Notice>}<PhoneReceiptView time={phoneTime} receipt={receipt} /></Drawer>}
    </div>;
}
