"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { PhoneApiError, fetchPhoneOverview, fetchPhoneRequests, fetchPhoneHistory, fetchPhoneOperation, pendingPhoneCommands, preparePhoneCommand, submitPhoneCommand, recoverPhoneCommand, type PendingPhoneCommand } from "@/lib/admin/phone-replacement-client";
import { PHONE_GRANT, PHONE_REVOKE, phoneLabel, phoneCommandAllowed, record, type PhoneCommand, type PhoneOverview, type PhonePage, type PhoneRequest, type PhoneReceipt, type PhoneVerification } from "@/lib/admin/phone-replacement-contract";
import { PhoneFacts, PhoneReceiptView, phoneTime } from "../phone-replacement-receipt";
export function PhoneReplacementPanel({ userId, userLabel }: {
    userId: string | null;
    userLabel: string;
}) {
    const session = useAdminAuth(s => s.session);
    const epoch = useAdminAuth(s => s.authEpoch);
    if (!session?.authorities.includes("user_c5_read"))
        return <section className="phone-admin-panel"><h3>手机绑定与一次性特批</h3><p>当前没有查看权限。</p></section>;
    if (!userId)
        return <section className="phone-admin-panel"><h3>手机绑定与一次性特批</h3><p>请先在上方选择账号；不会展示上个账号的手机信息。</p></section>;
    return <AccountPhonePanel key={`${session.adminId}:${epoch}:${userId}`} userId={userId} userLabel={userLabel} owner={session.adminId} rights={session.authorities}/>;
}
function AccountPhonePanel({ userId, userLabel, owner, rights }: {
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
    const selection = requests?.items.find(row => row.requestId === selected);
    const syncPending = useCallback(() => setPendingRows(pendingPhoneCommands(owner, userId)), [owner, userId]);
    const fail = useCallback((failure: unknown, accountRead = false) => {
        if (!live.current)
            return;
        const accountUnavailable = accountRead && failure instanceof PhoneApiError && failure.status === 404;
        if (accountUnavailable || failure instanceof PhoneApiError && [401, 403].includes(failure.status)) {
            generation.current++;
            historyGeneration.current++;
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
            setSelected(current => rows.items.some(r => r.requestId === current) ? current : "");
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
        if (confirm.type === "PHONE_GRANT_ISSUE" && (!selection || !verification || verification.requestId !== selection.requestId || !(waiveCount || waiveInterval)))
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
            const attempt = preparePhoneCommand(owner, userId, confirm.type, confirm.target, body);
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
    return <section className="phone-admin-panel" data-proof="c5-phone-replacement" aria-label="手机绑定与一次性特批">
    <h3>手机绑定与一次性特批 · {userLabel}</h3>
    <p className="phone-note">后台只处置申请，不替用户绑定手机。特批仅豁免勾选的次数或间隔限制，不能解除禁换、账号限制、风险暂停、校准或条款要求。</p>
    {error && <p role="alert" className="phone-error">{error}</p>}{message && !denied && <p role="status">{message}</p>}
    {denied ? <p>当前内容已隐藏，请返回账号选择或重新登录。</p> : <>
    <div className="phone-actions"><button className="l-btn" disabled={busy || loading || !!confirm} onClick={() => { void load(); void loadHistory(); }}>刷新当前账号</button></div>
    {loading ? <p role="status">正在读取手机与申请状态…</p> : !overview ? <p>手机信息尚未读取成功，处置暂不可用。</p> : <>
      <div className="phone-grid"><div><h4>绑定与执行</h4>{overview.eligibility.binding ? <PhoneFacts value={overview.eligibility.binding}/> : <p>尚未绑定手机。</p>}
        <p>执行暂停：{overview.executionPauseReason ? phoneLabel(overview.executionPauseReason) : "未记录暂停原因"}</p></div>
      <div><h4>换机资格</h4><p>已用次数：{overview.eligibility.usedCount ?? "待核实"} · 剩余额度：{overview.eligibility.remainingCount ?? "待核实"}</p>
        <p>历史完整性：{overview.eligibility.historyComplete ? "已确认" : "待核实，不视为零次"}</p>
        <p>最早普通换机时间：{overview.eligibility.nextAllowedAt == null ? "暂无法确定" : phoneTime(overview.eligibility.nextAllowedAt)}</p>
        <p>{overview.eligibility.canReplace ? "当前满足换机条件，仍需用户在 App 明确确认。" : "当前不能更换绑定手机。"}</p>
        <ul>{overview.eligibility.blockedReasons.map((r, i) => <li key={`${r}:${i}`}>{phoneLabel(r)}</li>)}</ul></div></div>
      <details><summary>当前策略与会话概览</summary><PhoneFacts value={overview.eligibility.policy}/>
        {overview.sessions.length ? overview.sessions.map((s, i) => <div className="phone-record" key={i}><b>{s.sessionGroup === "APP" ? "当前 App" : "H5 网页"}</b><p>安装：{s.installationId || "未提供"} · 会话数：{s.sessionCount} · 最近活跃：{s.lastActiveAt ?? "待核实"}</p><p>App 版本：{s.appSessionVersion ?? "不适用"} · 手机执行：{s.executionSupported ? "支持" : "不支持"}</p></div>) : <p>暂无有效 App 或 H5 会话。</p>}</details>
      <h4>待处理申请</h4><p className="phone-note">选择用户从目标 App 发起的申请。请查看关联客服会话并完成人工核实；不能手工输入目标安装。</p>
      {requests?.items.length ? <label>选择申请<select value={selected} disabled={blocked} onChange={e => { setSelected(e.target.value); setVerification(null); setWaiveCount(false); setWaiveInterval(false); }}><option value="">请选择申请</option>{requests.items.map(row => <option value={row.requestId} key={row.requestId}>{row.requestNo} · {phoneLabel(row.status)} · {row.targetInstallationId}</option>)}</select></label> : <p>本页暂无申请。请用户在目标 App 发起申请并关联客服会话。</p>}
      <div className="phone-actions"><button className="l-btn" disabled={blocked || requestPage === 1} onClick={() => setRequestPage(p => p - 1)}>上一页申请</button><span>第 {requestPage} 页</span><button className="l-btn" disabled={blocked || !requests?.hasMore} onClick={() => setRequestPage(p => p + 1)}>下一页申请</button></div>
      {selection && <div className="phone-record"><PhoneFacts value={selection}/><p>客服关联：{phoneLabel(selection.supportLinkStatus)}</p>
        {selection.supportRef && <p>请在客服会话中核对引用 {selection.supportRef} 对应的用户和申请。核实不发送消息。</p>}
        {canGrant && <div className="phone-actions"><button className="l-btn" disabled={blocked || !usableRequest || selection.supportLinkStatus !== "LINKED"} onClick={() => begin("PHONE_VERIFY", selection.requestId, "确认已人工核实此申请及关联客服记录")}>核实关联记录</button>
          <button className="l-btn" disabled={blocked || !usableRequest} onClick={() => begin("PHONE_REQUEST_CLOSE", selection.requestId, "不予授予并关闭此申请")}>不予授予</button></div>}
        {canGrant && <><fieldset disabled={blocked || !usableRequest}><legend>一次性特批范围</legend><label><input type="checkbox" checked={waiveCount} onChange={e => setWaiveCount(e.target.checked)}/>豁免次数限制</label><label><input type="checkbox" checked={waiveInterval} onChange={e => setWaiveInterval(e.target.checked)}/>豁免间隔限制</label></fieldset>
          <p className="phone-note">有效期从签发成功起独立计算 24 小时，仅使用一次。历史次数未知时须勾选次数豁免；绑定时间未知还需间隔豁免。未知标记不会因此消失。</p>
          <p>{verification?.requestId === selected ? `已核实：${verification.evidenceRef} · ${phoneTime(verification.verifiedAt)}` : "签发前须先明确核实本申请的关联客服记录。"}</p>
          <button className="l-btn primary" disabled={blocked || !usableRequest || verification?.requestId !== selected || !(waiveCount || waiveInterval) || activeGrant?.status === "ACTIVE"} onClick={() => begin("PHONE_GRANT_ISSUE", selected, "授予此目标安装一次特批")}>确认一次授权</button>
          {activeGrant?.status === "ACTIVE" && <p>已有有效特批，不能覆盖或叠加。确需调整时先明确撤销，再由用户提交新申请。</p>}</>}
      </div>}
      <h4>当前授权</h4>{activeGrant ? <div className="phone-record"><PhoneFacts value={activeGrant}/>{canRevoke && <button className="l-btn danger" disabled={blocked || activeGrant.status !== "ACTIVE"} onClick={() => begin("PHONE_GRANT_REVOKE", activeGrant.grantId, "撤销此一次性特批")}>撤销授权</button>}</div> : <p>暂无有效特批。撤销或授权都不会替用户激活手机。</p>}
      {overview.pendingOperations.length > 0 && <div><h4>服务端处理中</h4>{overview.pendingOperations.map(row => <div key={row.operationId} className="phone-actions"><span>{phoneLabel(row.commandType)} · {phoneTime(row.submittedAt)}</span>{(canGrant || canRevoke) && <button className="l-btn" disabled={busy} onClick={() => void query(row.operationId)}>查询原操作</button>}</div>)}</div>}
    </>}
    {pendingRows.length > 0 && <div className="phone-record"><h4>提交结果待核实</h4><p>原请求已经保存。离开页面不会取消操作；超过 24 小时仍只查询原结果。</p>{pendingRows.some(row => !phoneCommandAllowed(row.type, rights)) && <p>有原操作需要恢复相应处置权限后核实，内容已隐藏。</p>}{pendingRows.filter(row => phoneCommandAllowed(row.type, rights)).map(row => <div key={row.commandKey}><p>{phoneLabel(row.type)} · {phoneTime(row.createdAt)} · 原操作标识：{row.commandKey}</p><p>原确认对象：{row.target}</p><PhoneFacts value={row.body}/><button className="l-btn" disabled={busy || !phoneCommandAllowed(row.type, rights)} onClick={() => void recover(row)}>查询原操作结果</button></div>)}</div>}
    {confirm && <section className="phone-record" aria-label="操作确认"><h4>{confirm.label}</h4><p>账号：{userLabel} · 对象：{confirm.target}</p>
      {confirm.type === "PHONE_GRANT_ISSUE" && <p>目标：{selection?.targetInstallationId} · 绑定版本：{selection?.bindingVersion} · 次数豁免：{waiveCount ? "是" : "否"} · 间隔豁免：{waiveInterval ? "是" : "否"} · 24 小时、一次使用，须用户回 App 确认。</p>}
      <label>操作理由（8–200 字）<textarea value={reason} maxLength={200} disabled={busy} onChange={e => setReason(e.target.value)}/></label>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>我已核对账号、对象及上述影响，明确确认此操作</label>
      <div className="phone-actions"><button className="l-btn primary" disabled={busy || !confirmed || reason.trim().length < 8} onClick={() => void submit()}>确认提交</button><button className="l-btn" disabled={busy} onClick={() => setConfirm(null)}>取消</button></div></section>}
    <h4>换机与处置历史</h4><label>记录类型<select value={kind} disabled={historyLoading || busy} onChange={e => { setKind(e.target.value as typeof kind); setPage(1); }}><option value="SUCCESS">成功换机</option><option value="REQUEST">申请与关闭</option><option value="GRANT">特批与使用</option></select></label>
    {historyLoading ? <p role="status">正在读取历史…</p> : historyError ? <p role="alert">{historyError} <button className="l-btn" onClick={() => void loadHistory()}>重试历史查询</button></p> : history?.items.length ? history.items.map((row, i) => <div className="phone-record" key={i}><PhoneFacts value={row}/>
      {Array.isArray(row.operations) && row.operations.filter(record).map((op, j) => <div key={j}><PhoneFacts value={op}/>{(canGrant || canRevoke) && typeof op.operationId === "string" && <button className="l-btn" disabled={busy} onClick={() => void query(String(op.operationId))}>查看原操作结果</button>}</div>)}
      {typeof row.operationId === "string" && (canGrant || canRevoke) && <button className="l-btn" disabled={busy} onClick={() => void query(String(row.operationId))}>查看原操作结果</button>}
    </div>) : <p>本类记录当前页为空；不表示其他类别没有记录。</p>}
    <div className="phone-actions"><button className="l-btn" disabled={historyLoading || page === 1} onClick={() => setPage(p => p - 1)}>上一页历史</button><span>第 {page} 页</span><button className="l-btn" disabled={historyLoading || !history?.hasMore} onClick={() => setPage(p => p + 1)}>下一页历史</button></div>
    {(canGrant || canRevoke) && <details><summary>按原操作号或原操作标识查询</summary><div className="phone-grid"><label>查询方式<select value={lookupMode} onChange={e => setLookupMode(e.target.value)}><option value="id">操作号</option><option value="key">原操作标识</option></select></label>{lookupMode === "key" && <label>操作类型<select value={lookupType} onChange={e => setLookupType(e.target.value as PhoneCommand)}>{(["PHONE_GRANT_ISSUE", "PHONE_REQUEST_CLOSE", "PHONE_GRANT_REVOKE"] as PhoneCommand[]).filter(t => phoneCommandAllowed(t, rights)).map(t => <option key={t} value={t}>{phoneLabel(t)}</option>)}</select></label>}<label>{lookupMode === "id" ? "原操作号" : "当前操作者的原操作标识"}<input value={lookup} maxLength={128} onChange={e => setLookup(e.target.value)}/></label></div><button className="l-btn" disabled={busy || !lookup.trim()} onClick={() => void query()}>只读查询</button></details>}
    {receipt && <><p>{receiptIndependent ? "独立原操作查询：此回执可能属于您有权访问的其他账号，不代表当前所选账号的绑定或授权事实。请按原申请号、授权号核对归属。" : `当前账号 ${userLabel} 的原操作回执`}</p><PhoneReceiptView receipt={receipt}/></>}
    </>}
  </section>;
}
