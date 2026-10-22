"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Clock3, Inbox, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
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
        return <section className="l-card phone-admin-panel phone-account-panel"><div className="l-h"><span className="ttl">手机绑定与换机特批</span></div><PhoneEmptyState title="当前没有查看权限" detail="请联系有查看权限的管理员。" /></section>;
    if (!userId)
        return <section className="l-card phone-admin-panel phone-account-panel"><div className="l-h"><span className="ttl">手机绑定与换机特批</span></div><PhoneEmptyState title="请先选择用户" detail="在上方用户列表中点击“查看安全信息”，再查看该用户的手机绑定和换机申请。" /></section>;
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
    return <section className="l-card phone-admin-panel phone-account-panel" data-proof="c5-phone-replacement" aria-label="手机绑定与一次性特批">
      <div className="l-h">
        <div className="phone-panel-heading"><Smartphone size={16} aria-hidden="true" /><h3>手机绑定与换机特批</h3><span className="ccode">{userLabel}</span></div>
        <div className="r"><button className="l-btn sm" disabled={busy || loading || !!confirm || denied} onClick={() => { void load(); void loadHistory(); }}><RefreshCw size={13} aria-hidden="true" />{loading ? "刷新中…" : "刷新"}</button></div>
      </div>
      <div className="l-b">
        <p className="phone-intro">处理更换手机设备的申请，与修改登录手机号分开统计。</p>
        {error && <div role="alert" className="ctint warn phone-feedback">{error}</div>}
        {message && !denied && <div role="status" className="ctint cyan phone-feedback">{message}</div>}
        {denied ? <PhoneEmptyState title="暂时无法查看此用户" detail="请重新选择用户或登录后再试。" /> : <>
          {loading ? <div className="phone-loading" role="status"><RefreshCw size={16} aria-hidden="true" />正在读取手机与申请状态…</div> : !overview ? <PhoneEmptyState title="手机信息未能加载" detail="请点击右上方“刷新”重试。" /> : <>
            <div className="phone-summary-grid">
              <section className="phone-summary-card" aria-label="手机绑定状态">
                <div className="phone-section-heading"><h4><Smartphone size={14} aria-hidden="true" />手机绑定</h4><span className={`bdg ${overview.eligibility.binding ? "ok" : "dim"}`}>{overview.eligibility.binding ? "已绑定" : "未绑定"}</span></div>
                {overview.eligibility.binding ? <dl className="phone-summary-facts">
                  <div><dt>绑定设备</dt><dd className="mono">{overview.eligibility.binding.installationId || "待核实"}</dd></div>
                  <div><dt>最近绑定时间</dt><dd>{phoneTime(overview.eligibility.binding.changedAt)}</dd></div>
                  <div><dt>绑定记录版本</dt><dd>{overview.eligibility.binding.bindingVersion}</dd></div>
                </dl> : <div className="phone-binding-empty"><span className="phone-icon-tile"><Smartphone size={23} strokeWidth={1.5} aria-hidden="true" /></span><div><strong>尚未绑定手机</strong><p>用户绑定后，可在这里查看设备和绑定时间。</p></div></div>}
                {overview.executionPauseReason && <div className="ctint warn phone-feedback"><b>手机执行已暂停</b> · {phoneLabel(overview.executionPauseReason)}</div>}
              </section>
              <section className="phone-summary-card" aria-label="换机条件">
                <div className="phone-section-heading"><h4><ShieldCheck size={14} aria-hidden="true" />换机条件</h4><span className={`bdg ${overview.eligibility.canReplace ? "ok" : "warn"}`}>{overview.eligibility.canReplace ? "可更换" : "暂不能更换"}</span></div>
                <div className="phone-metrics"><div><span>统计期内已换机</span><strong>{overview.eligibility.usedCount ?? "待核实"}<small>次</small></strong></div><div><span>剩余可换次数</span><strong>{overview.eligibility.remainingCount ?? "待核实"}<small>次</small></strong></div></div>
                <dl className="phone-summary-facts">
                  <div><dt>最早可更换时间</dt><dd>{overview.eligibility.nextAllowedAt == null ? "暂无法确定" : phoneTime(overview.eligibility.nextAllowedAt)}</dd></div>
                  <div><dt>历史次数</dt><dd><span className={`bdg ${overview.eligibility.historyComplete ? "dim" : "warn"}`}>{overview.eligibility.historyComplete ? "已核实" : "待核实，不按零次计算"}</span></dd></div>
                </dl>
              </section>
            </div>
            {overview.eligibility.canReplace ? <div className="ctint ok phone-eligibility-note"><ShieldCheck size={15} aria-hidden="true" /><span>已满足换机条件，需由用户在手机应用中确认更换。</span></div> : <div className="ctint warn phone-eligibility-note"><AlertTriangle size={15} aria-hidden="true" /><div><b>暂不能更换手机</b>{overview.eligibility.blockedReasons.length ? <ul>{overview.eligibility.blockedReasons.map((r, i) => <li key={`${r}:${i}`}>{r === "CURRENT_APP_REQUIRED" ? "没有可用于换机的手机应用登录记录" : phoneLabel(r)}</li>)}</ul> : <p>请刷新并核对当前绑定状态和换机条件。</p>}</div></div>}

            <div className="phone-work-grid">
              <section className="phone-section" aria-label="待处理换机申请">
                <div className="phone-section-heading"><h4><Inbox size={14} aria-hidden="true" />待处理申请</h4>{!!requests?.items.length && <span className="bdg cyan">本页 {requests.items.length} 条</span>}</div>
                {requests?.items.length ? <><p className="phone-note">选择申请后，核对关联客服记录，再决定是否特批。</p><div className="phone-request-list">{requests.items.map(row => <button key={row.requestId} className={`phone-request-choice ${selected === row.requestId ? "selected" : ""}`} disabled={blocked} aria-pressed={selected === row.requestId} onClick={() => { setSelected(row.requestId); setVerification(null); setWaiveCount(false); setWaiveInterval(false); }}>
                  <span><strong>{row.requestNo}</strong><small>{phoneTime(row.createdAt)} · 设备 {row.targetInstallationId}</small></span><span className={`bdg ${row.status === "PENDING" ? "warn" : "dim"}`}>{selected === row.requestId ? "已选择" : phoneLabel(row.status)}</span>
                </button>)}</div></> : <PhoneEmptyState title="本页暂无换机申请" detail="用户在手机应用中发起申请并关联客服会话后，可在这里处理。" />}
                {(requestPage > 1 || requests?.hasMore) && <div className="phone-pagination"><span>第 {requestPage} 页</span><div><button className="l-btn sm" disabled={blocked || requestPage === 1} onClick={() => setRequestPage(p => p - 1)}>上一页申请</button><button className="l-btn sm" disabled={blocked || !requests?.hasMore} onClick={() => setRequestPage(p => p + 1)}>下一页申请</button></div></div>}
                {selection && <div className="phone-record phone-request-detail"><PhoneFacts value={selection}/><p>客服关联：{phoneLabel(selection.supportLinkStatus)}</p>
                  {selection.supportRef && <p className="phone-note">请核对客服会话 {selection.supportRef} 中的用户和申请。核实不会发送消息。</p>}
                  {canGrant && <div className="phone-actions"><button className="l-btn sm" disabled={blocked || !usableRequest || selection.supportLinkStatus !== "LINKED"} onClick={() => begin("PHONE_VERIFY", selection.requestId, "确认已人工核实此申请及关联客服记录")}>核实关联记录</button><button className="l-btn sm" disabled={blocked || !usableRequest} onClick={() => begin("PHONE_REQUEST_CLOSE", selection.requestId, "不予授予并关闭此申请")}>不予授予</button></div>}
                  {canGrant && <><fieldset disabled={blocked || !usableRequest}><legend>本次特批范围</legend><label><input type="checkbox" checked={waiveCount} onChange={e => setWaiveCount(e.target.checked)}/>豁免次数限制</label><label><input type="checkbox" checked={waiveInterval} onChange={e => setWaiveInterval(e.target.checked)}/>豁免间隔限制</label></fieldset>
                    <p className="phone-note">特批签发后 24 小时内有效，仅可使用一次。历史次数未知时须勾选次数豁免；绑定时间未知时还需间隔豁免，原有未知标记会保留。</p>
                    <p className="phone-note">{verification?.requestId === selected ? `已核实：${verification.evidenceRef} · ${phoneTime(verification.verifiedAt)}` : "签发前，请先核实本申请的关联客服记录。"}</p>
                    <button className="l-btn primary" disabled={blocked || !usableRequest || verification?.requestId !== selected || !(waiveCount || waiveInterval) || activeGrant?.status === "ACTIVE"} onClick={() => begin("PHONE_GRANT_ISSUE", selected, "授予此目标安装一次特批")}>确认一次授权</button>
                    {activeGrant?.status === "ACTIVE" && <p className="phone-note">已有有效特批，不能叠加。需要调整时，请先撤销，再由用户提交新申请。</p>}</>}
                </div>}
              </section>
              <section className="phone-section" aria-label="当前换机特批">
                <div className="phone-section-heading"><h4><ShieldCheck size={14} aria-hidden="true" />当前特批</h4>{activeGrant && <span className={`bdg ${activeGrant.status === "ACTIVE" ? "ok" : "dim"}`}>{phoneLabel(activeGrant.status)}</span>}</div>
                {activeGrant ? <><dl className="phone-summary-facts">
                  <div><dt>有效期至</dt><dd>{phoneTime(activeGrant.expiresAt)}</dd></div>
                  <div><dt>剩余使用次数</dt><dd>{activeGrant.remainingUses ?? "待核实"} 次</dd></div>
                  <div><dt>特批内容</dt><dd>{[activeGrant.waiveCount && "豁免次数限制", activeGrant.waiveInterval && "豁免间隔限制"].filter(Boolean).join("、") || "未记录豁免项"}</dd></div>
                </dl><details className="phone-details"><summary>查看特批详情<ChevronDown size={14} aria-hidden="true" /></summary><PhoneFacts value={activeGrant}/></details>{canRevoke && <button className="l-btn mc" disabled={blocked || activeGrant.status !== "ACTIVE"} onClick={() => begin("PHONE_GRANT_REVOKE", activeGrant.grantId, "撤销此一次性特批")}>撤销授权</button>}</> : <PhoneEmptyState title="暂无有效特批" detail="核实用户的换机申请后，可按需授予一次特批。" />}
                <p className="phone-section-footnote">特批仅放宽勾选的次数或间隔限制，不会直接绑定或激活手机。</p>
              </section>
            </div>
            {overview.pendingOperations.length > 0 && <section className="phone-section"><div className="phone-section-heading"><h4><Clock3 size={14} aria-hidden="true" />正在处理的操作</h4></div>{overview.pendingOperations.map(row => <div key={row.operationId} className="phone-actions"><span>{phoneLabel(row.commandType)} · {phoneTime(row.submittedAt)}</span>{(canGrant || canRevoke) && <button className="l-btn sm" disabled={busy} onClick={() => void query(row.operationId)}>查询原操作</button>}</div>)}</section>}
          </>}

          {pendingRows.length > 0 && <div className="phone-record"><h4>提交结果待核实</h4><p className="phone-note">原请求已保存。离开页面不会取消操作；超过 24 小时仍只查询原结果。</p>{pendingRows.some(row => !phoneCommandAllowed(row.type, rights)) && <p>有原操作需要恢复相应处置权限后核实，内容已隐藏。</p>}{pendingRows.filter(row => phoneCommandAllowed(row.type, rights)).map(row => <div key={row.commandKey}><p>{phoneLabel(row.type)} · {phoneTime(row.createdAt)} · 原操作标识：{row.commandKey}</p><p>原确认对象：{row.target}</p><PhoneFacts value={row.body}/><button className="l-btn sm" disabled={busy || !phoneCommandAllowed(row.type, rights)} onClick={() => void recover(row)}>查询原操作结果</button></div>)}</div>}
          {confirm && <section className="phone-record phone-confirm" aria-label="操作确认"><div className="phone-section-heading"><h4>{confirm.label}</h4><span className="bdg warn">待确认</span></div><p>账号：{userLabel} · 对象：{confirm.target}</p>
            {confirm.type === "PHONE_GRANT_ISSUE" && <p>目标：{selection?.targetInstallationId} · 绑定版本：{selection?.bindingVersion} · 次数豁免：{waiveCount ? "是" : "否"} · 间隔豁免：{waiveInterval ? "是" : "否"} · 24 小时、一次使用，须用户返回应用确认。</p>}
            <label>操作理由（8–200 字）<textarea value={reason} maxLength={200} disabled={busy} onChange={e => setReason(e.target.value)}/></label>
            <label className="phone-confirm-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>我已核对账号、对象及上述影响，明确确认此操作</label>
            <div className="phone-actions"><button className="l-btn primary" disabled={busy || !confirmed || reason.trim().length < 8} onClick={() => void submit()}>确认提交</button><button className="l-btn" disabled={busy} onClick={() => setConfirm(null)}>取消</button></div>
          </section>}

          <section className="phone-section phone-history" aria-label="换机与处置历史">
            <div className="phone-section-heading"><h4><Clock3 size={14} aria-hidden="true" />换机与处置历史</h4><div className="chips" role="group" aria-label="记录类型">{([['SUCCESS', '成功换机'], ['REQUEST', '申请记录'], ['GRANT', '特批记录']] as const).map(([value, label]) => <button key={value} className={`chip ${kind === value ? "sel" : ""}`} aria-pressed={kind === value} disabled={historyLoading || busy} onClick={() => { setKind(value); setPage(1); }}>{label}</button>)}</div></div>
            {historyLoading ? <div className="phone-loading" role="status"><RefreshCw size={15} aria-hidden="true" />正在读取历史记录…</div> : historyError ? <div className="ctint warn" role="alert">{historyError} <button className="l-btn sm" onClick={() => void loadHistory()}>重试历史查询</button></div> : history?.items.length ? history.items.map((row, i) => <div className="phone-record" key={i}><PhoneFacts value={row}/>
              {Array.isArray(row.operations) && row.operations.filter(record).map((op, j) => <div key={j}><PhoneFacts value={op}/>{(canGrant || canRevoke) && typeof op.operationId === "string" && <button className="l-btn sm" disabled={busy} onClick={() => void query(String(op.operationId))}>查看原操作结果</button>}</div>)}
              {typeof row.operationId === "string" && (canGrant || canRevoke) && <button className="l-btn sm" disabled={busy} onClick={() => void query(String(row.operationId))}>查看原操作结果</button>}
            </div>) : <PhoneEmptyState title={`本页暂无${kind === "SUCCESS" ? "成功换机" : kind === "REQUEST" ? "申请" : "特批"}记录`} detail="可切换记录类型，查看其他类别的历史。" />}
            {(page > 1 || history?.hasMore) && <div className="phone-pagination"><span>第 {page} 页</span><div><button className="l-btn sm" disabled={historyLoading || page === 1} onClick={() => setPage(p => p - 1)}>上一页历史</button><button className="l-btn sm" disabled={historyLoading || !history?.hasMore} onClick={() => setPage(p => p + 1)}>下一页历史</button></div></div>}
          </section>

          {overview && <details className="phone-details phone-advanced"><summary><span><ShieldCheck size={14} aria-hidden="true" />换机规则与登录设备</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="phone-grid"><section><h4>当前换机规则</h4><PhoneFacts value={overview.eligibility.policy}/><p className="phone-note">特批不能解除禁换、账号限制、风险暂停、校准或条款要求。</p></section><section><h4>登录设备</h4>{overview.sessions.length ? overview.sessions.map((s, i) => <div className="phone-record" key={i}><b>{s.sessionGroup === "APP" ? "手机应用" : "网页版"}</b><dl className="phone-summary-facts"><div><dt>设备标识</dt><dd className="mono">{s.installationId || "未提供"}</dd></div><div><dt>登录记录</dt><dd>{s.sessionCount} 条</dd></div><div><dt>最近活跃</dt><dd>{s.lastActiveAt ?? "待核实"}</dd></div><div><dt>应用版本</dt><dd>{s.appSessionVersion ?? "不适用"}</dd></div><div><dt>手机执行</dt><dd>{s.executionSupported ? "支持" : "不支持"}</dd></div></dl></div>) : <PhoneEmptyState title="暂无有效登录记录" detail="用户在手机应用或网页版登录后，可在这里查看。" />}</section></div></details>}
          {(canGrant || canRevoke) && <details className="phone-details phone-advanced"><summary><span><Clock3 size={14} aria-hidden="true" />查询此前操作结果</span><ChevronDown size={14} aria-hidden="true" /></summary><p className="phone-note">用原操作号或原操作标识核对结果，不会重复提交。</p><div className="phone-grid"><label>查询方式<select value={lookupMode} onChange={e => setLookupMode(e.target.value)}><option value="id">操作号</option><option value="key">原操作标识</option></select></label>{lookupMode === "key" && <label>操作类型<select value={lookupType} onChange={e => setLookupType(e.target.value as PhoneCommand)}>{(["PHONE_GRANT_ISSUE", "PHONE_REQUEST_CLOSE", "PHONE_GRANT_REVOKE"] as PhoneCommand[]).filter(t => phoneCommandAllowed(t, rights)).map(t => <option key={t} value={t}>{phoneLabel(t)}</option>)}</select></label>}<label>{lookupMode === "id" ? "原操作号" : "当前操作者的原操作标识"}<input value={lookup} maxLength={128} onChange={e => setLookup(e.target.value)}/></label></div><div className="phone-actions"><button className="l-btn sm" disabled={busy || !lookup.trim()} onClick={() => void query()}>只读查询</button></div></details>}
          {receipt && <><p className="phone-note">{receiptIndependent ? "独立原操作查询：此回执可能属于您有权访问的其他账号，不代表当前所选账号的绑定或授权事实。请按原申请号、授权号核对归属。" : `当前账号 ${userLabel} 的原操作回执`}</p><PhoneReceiptView receipt={receipt}/></>}
        </>}
      </div>
    </section>;
}

function PhoneEmptyState({ title, detail }: { title: string; detail: string }) {
    return <div className="phone-empty"><Inbox size={24} strokeWidth={1.5} aria-hidden="true" /><strong>{title}</strong><p>{detail}</p></div>;
}
