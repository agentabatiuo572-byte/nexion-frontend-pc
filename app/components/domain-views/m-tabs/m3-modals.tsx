"use client";

/**
 * M3 会话台 modal 群(从 m3-sessions 抽出,逻辑不变):
 *  - InitiateModal: 主动发起会话(真实单用户 + 撰写 + 预览)
 *  - CustomerProfileModal: 完整客户档案(只读快照)
 *  - QuickActionModal: 历史会话 / 关联工单 / 重置密码 / 账户操作 / 客户备注(不写审计,交 C/D 域复核)
 * 均渲染于 design-kit Modal;合规(运营可读中文 · 数字不自曝)。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useReasonRule } from "@/lib/admin/use-reason-rule";
import { Button, DiffList, Field as RdField, Notice, NumberInput, Select, StatusTag, Textarea } from "@/app/components/rd";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { Icon, Modal } from "../design-kit";
import {
  STANDBY_POOL_LABEL,
  type AdvisorScript,
  type CustomerProfile,
  type InitiateIdentity,
  type SessionReplyTpl,
  type TransferTarget,
} from "./data";
import { MAvatar, ownerLabel, relWhen } from "./hd-ui";
import { scriptGroupLabel, type ConversationTimeoutPolicy } from "@/lib/admin/m-client";

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>
        {label}
        {required && <b style={{ color: "var(--danger)", marginLeft: 4 }}>*</b>}
      </span>
      {children}
    </label>
  );
}

type IdlePolicyInput = { warnMinutes: number; closeMinutes: number; sessionEndMinutes?: number; reason: string };
export function IdlePolicyModal({
  policy,
  initialInput,
  canSave,
  saving,
  error,
  pending = false,
  conflict = false,
  latest,
  onCheckPending,
  onRefreshLatest,
  onReviewLatest,
  onDraftChange,
  onClose,
  onSave,
}: {
  policy: ConversationTimeoutPolicy;
  initialInput?: IdlePolicyInput;
  canSave: boolean;
  saving: boolean;
  error: string;
  pending?: boolean;
  conflict?: boolean;
  latest?: ConversationTimeoutPolicy | null;
  onCheckPending?: () => Promise<void>;
  onRefreshLatest?: () => Promise<void>;
  onReviewLatest?: () => void;
  onDraftChange?: (input: IdlePolicyInput) => void;
  onClose: () => void;
  onSave: (input: IdlePolicyInput) => Promise<boolean>;
}) {
  // B15 无人发言自动结束: shown as unavailable and never sent until the policy returns sessionEndMinutes.
  const endAvailable = policy.sessionEndMinutes !== null;
  const [warn, setWarn] = useState(String(initialInput?.warnMinutes??policy.warnMinutes));
  const [close, setClose] = useState(String(initialInput?.closeMinutes??policy.closeMinutes));
  const [end, setEnd] = useState(String(initialInput?.sessionEndMinutes??policy.sessionEndMinutes??""));
  const [reason, setReason] = useState(initialInput?.reason??"");
  const [confirm, setConfirm] = useState(false);
  // 刚打开不报错，失焦才用橙黄写原因（VS-107）。
  const [numbersLeft, setNumbersLeft] = useState(false);
  const [reasonLeft, setReasonLeft] = useState(false);
  useEffect(() => { setConfirm(false); }, [policy.version, error, pending, conflict, canSave]);
  // 换到最新版本后要按新版本重新写理由（OP-97）。待确认的原操作不动。
  const shownVersion = useRef(policy.version);
  useEffect(() => { if (shownVersion.current !== policy.version) { shownVersion.current = policy.version; if (!pending) setReason(""); } }, [policy.version, pending]);
  useEffect(() => {
    if (!canSave) { setWarn(String(policy.warnMinutes)); setClose(String(policy.closeMinutes)); setEnd(String(policy.sessionEndMinutes ?? "")); setReason(""); }
  }, [canSave, policy.warnMinutes, policy.closeMinutes, policy.sessionEndMinutes]);
  const warnN = Number(warn);
  const closeN = Number(close);
  const endN = Number(end);
  const warnOk = Number.isInteger(warnN) && warnN >= 1 && warnN <= 30;
  const closeOk = Number.isInteger(closeN) && closeN >= 2 && closeN <= 120;
  const endOk = !endAvailable || Number.isInteger(endN) && endN >= 2 && endN <= 120;
  const orderOk = warnOk && closeOk && closeN > warnN && endOk;
  const rule = useReasonRule(canSave);
  const reasonOk = rule.ok(reason);
  const unchanged = warnN === policy.warnMinutes && closeN === policy.closeMinutes && (!endAvailable || endN === policy.sessionEndMinutes);
  const blocked = saving || pending || conflict;
  const sessionEndMinutes = endAvailable ? endN : undefined;
  useEffect(() => { if (canSave) onDraftChange?.({ warnMinutes: warnN, closeMinutes: closeN, sessionEndMinutes, reason }); }, [warnN, closeN, sessionEndMinutes, reason, canSave, onDraftChange]);

  async function save() {
    if (!canSave || blocked || !confirm || !orderOk || !reasonOk || unchanged) return;
    const succeeded = await onSave({
      warnMinutes: warnN,
      closeMinutes: closeN,
      sessionEndMinutes,
      reason: reason.trim(),
    });
    if (succeeded) onClose();
  }

  const numField = (
    label: string,
    hint: string,
    value: string,
    setValue: (value: string) => void,
    min: number,
    max: number,
    available = true,
    fieldError?: string,
  ) => {
    const shownError = numbersLeft ? fieldError : undefined;
    // 范围只写在框下面，填错时错误顶替这一行（VS-103）。
    return <RdField label={label} explain={hint} help={available && canSave && !shownError ? `${min}–${max}` : undefined} error={shownError}>
      {(control) => <NumberInput {...control} unit="分钟" min={min} max={max} step={1} value={value} placeholder={available ? undefined : "—"} disabled={!available || !canSave || blocked || confirm}
        onChange={(event) => { setConfirm(false); setValue(event.target.value); }} onBlur={() => setNumbersLeft(true)} />}
    </RdField>;
  };

  return (
    <Modal
      className="m3-policy-modal"
      title={canSave ? "调整会话超时策略" : "会话超时策略"}
      icon="clock"
      sub={canSave ? <StatusTag tone="progress" filled>立即生效</StatusTag> : <StatusTag tone="neutral" filled icon={Lock} explain="仅获准超级管理员可修改。要调整请联系超级管理员。">只读</StatusTag>}
      busy={saving}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={saving}>{canSave ? "取消" : "关闭"}</Button>
        {confirm && <Button disabled={saving} onClick={() => setConfirm(false)}>返回修改</Button>}
        {canSave && <Button
          variant="primary"
          data-proof="session-idle-policy-save"
          onClick={() => { if (confirm) void save(); else setConfirm(true); }}
          disabledReason={saving ? "正在保存" : pending ? "先查询原操作结果" : conflict ? "先读取最新策略" : unchanged ? "改了时长才能保存" : !orderOk ? "先把时长填对" : !reasonOk ? "先写变更理由" : undefined}
        >
          {saving ? "保存中…" : confirm ? "确认并保存" : "预览变更"}
        </Button>}
      </>}
    >
      <div className="m3-policy-fields">
        {numField("待回复提醒", "客户消息等待回复达到该时长，标记待处理。", warn, setWarn, 1, 30, true, warnOk ? undefined : "填 1 到 30 的整数分钟")}
        {numField("严重超时", "超过该时长仍未回复，标记严重超时。须大于提醒时长。", close, setClose, 2, 120, true, !closeOk ? "填 2 到 120 的整数分钟" : warnOk && closeN <= warnN ? "要大于待回复提醒时长" : undefined)}
        {numField("无人发言自动结束", endAvailable ? "后台人员最后一次发消息后，超过该时长没人再发，会话自动结束，其他人就可以发起。" : "暂不可用：自动结束时长还不能在这里设置，其他两项照常保存。", end, setEnd, 2, 120, endAvailable, endOk ? undefined : "填 2 到 120 的整数分钟")}
      </div>
      {confirm && <div className="rd-confirm-facts m3-policy-preview" role="status">
        <DiffList rows={[
          { key: "warn", label: "待回复提醒", before: `${policy.warnMinutes} 分钟`, after: `${warnN} 分钟` },
          { key: "close", label: "严重超时", before: `${policy.closeMinutes} 分钟`, after: `${closeN} 分钟` },
          ...(endAvailable ? [{ key: "end", label: "无人发言自动结束", before: `${policy.sessionEndMinutes} 分钟`, after: `${endN} 分钟` }] : []),
        ]} />
      </div>}
      {canSave && <RdField label="变更理由" required hint={`至少 ${rule.min} 字`} explain="待回复提醒和严重超时只做标记。自动结束只让出接待：不结束对话、不改专属客服，客户的待回复照常保留。保存后立即生效。"
        error={blocked || unchanged || !orderOk || reasonOk || !reasonLeft ? undefined : rule.ready || rule.error ? rule.hint(reason) : "正在读取理由规则…"}>
        {(control) => <Textarea {...control} rows={3} value={reason} disabled={!canSave || blocked || confirm} maxLength={200} count={`${visibleReasonLength(reason)}/${rule.max}`}
          onChange={(event) => { setConfirm(false); setReason(event.target.value); }} onBlur={() => setReasonLeft(true)} placeholder="请说明调整的原因" />}
      </RdField>}
      {error && !conflict && !pending && <Notice tone="danger">{error}</Notice>}
      {pending && <Notice tone="warn" title={error || undefined} action={canSave && onCheckPending ? <Button size="sm" disabled={saving} onClick={() => void onCheckPending()}>查询原操作结果</Button> : undefined}>原操作结果待确认，输入已锁定。{latest && <p>现在的策略：待回复提醒 {latest.warnMinutes} 分钟，严重超时 {latest.closeMinutes} 分钟{latest.sessionEndMinutes !== null && `，无人发言自动结束 ${latest.sessionEndMinutes} 分钟`}；尚不能据此认定原操作成功。</p>}</Notice>}
      {conflict && <Notice tone="warn" action={latest
        ? <Button size="sm" disabled={saving || !canSave} onClick={onReviewLatest}>以最新策略重新确认</Button>
        : <Button size="sm" disabled={saving || !canSave} onClick={() => void onRefreshLatest?.()}>读取最新策略</Button>}>设置刚被别人改过，你填写的内容还在。{latest && <p>待回复提醒：原 {policy.warnMinutes} 分钟 → 最新 {latest.warnMinutes} 分钟；严重超时：原 {policy.closeMinutes} 分钟 → 最新 {latest.closeMinutes} 分钟{endAvailable && latest.sessionEndMinutes !== null && `；无人发言自动结束：原 ${policy.sessionEndMinutes} 分钟 → 最新 ${latest.sessionEndMinutes} 分钟`}。</p>}</Notice>}
    </Modal>
  );
}

/* ============ 完整客户档案(只读快照)============ */
function ProfileCell({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return (
    <div className="itint" style={{ padding: "11px 13px" }}>
      <div className="tiny" style={{ color: "var(--ink-4)" }}>{k}</div>
      <div className="mono" style={{ fontSize: 18, color: "var(--ink)", marginTop: 4 }}>
        {v}
        {unit && <span style={{ fontSize: 12, color: "var(--ink-4)", marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

export function CustomerProfileModal({
  profile,
  onClose,
  onQuick,
}: {
  profile: CustomerProfile;
  onClose: () => void;
  onQuick: (kind: "history" | "tickets" | "resetpw" | "account" | "note") => void;
}) {
  const riskTone = profile.risk === "低" ? "ok" : "warn";
  const accountRows: Array<[string, string]> = [
    ["持有设备", profile.device],
    ["算力", profile.hashrate],
    ["地区", profile.region],
    ["账龄", profile.joined],
    ["最近活跃", profile.lastActive],
  ];
  return (
    <Modal
      title="完整客户档案"
      icon="users"
      wide
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={13} />只能查看 · 处理账户或资金请去对应页面
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button>
          <button type="button" className="btn btn-sec btn-sm" onClick={() => onQuick("note")}>客户备注</button>
          <button type="button" className="btn btn-pri btn-sm" onClick={() => onQuick("account")}>账户操作</button>
        </div>
      }
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)" }}>{profile.nickname}</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 3 }}>{profile.uid} · {profile.phone}</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="bdg cyan">{profile.vlevel}</span>
            {[...profile.systemTags, ...profile.customTags].map((t) => <span key={t} className="bdg dim">{t}</span>)}
          </div>
          <div className="sub" style={{ fontWeight: 600, marginTop: 4 }}>风险研判</div>
          <div className="itint">
            <span className={`bdg ${riskTone}`}>风险 {profile.risk}</span>
            <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>{profile.riskNote}</div>
          </div>
          <div className="sub" style={{ fontWeight: 600, marginTop: 4 }}>资金概览</div>
          <div className="grid g-2" style={{ gap: 10 }}>
            <ProfileCell k="累计充值" v={profile.recharge} unit="USDT" />
            <ProfileCell k="累计提现" v={profile.withdraw} unit="USDT" />
            <ProfileCell k="当前余额" v={profile.balance} unit="USDT" />
            <ProfileCell k="关联工单" v={String(profile.tickets)} unit="张" />
          </div>
        </div>
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="sub" style={{ fontWeight: 600 }}>账户与设备</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {accountRows.map(([k, v], i) => (
              <div key={k} className="row" style={{ justifyContent: "space-between", gap: 12, padding: "9px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <span className="sub">{k}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{v}</span>
              </div>
            ))}
          </div>
          <div className="sub" style={{ fontWeight: 600, marginTop: 4 }}>近期资金流水</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {profile.ledger.map((l, i) => (
              <div key={`${l.label}-${i}`} className="row" style={{ justifyContent: "space-between", gap: 12, padding: "9px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                    {l.label}
                    {l.pending && <span className="bdg warn" style={{ marginLeft: 7 }}>处理中</span>}
                  </div>
                  <div className="mono tiny" style={{ color: "var(--ink-4)", marginTop: 2 }}>{l.when}</div>
                </div>
                <span className="mono" style={{ fontSize: 13, color: l.up ? "var(--success)" : "var(--ink)" }}>{l.amount}</span>
              </div>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-sec btn-sm" onClick={() => onQuick("history")}>历史会话</button>
            <button type="button" className="btn btn-sec btn-sm" onClick={() => onQuick("tickets")}>关联工单</button>
            <button type="button" className="btn btn-sec btn-sm" onClick={() => onQuick("resetpw")}>重置密码</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ============ QuickAction(从客户档案派生 · 不写审计,交 C/D 域复核)============ */
export function QuickActionModal({
  kind,
  profile,
  onClose,
  onAddNote,
  onRemoveNote,
  onAccount,
}: {
  kind: "history" | "tickets" | "resetpw" | "account" | "note";
  profile: CustomerProfile;
  onClose: () => void;
  onAddNote: (text: string) => Promise<boolean>;
  onRemoveNote: (id: string) => Promise<boolean>;
  onAccount: (label: string) => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [via, setVia] = useState<"sms" | "email">("sms");

  if (kind === "history") {
    return (
      <Modal title="历史会话" icon="clock" onClose={onClose} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button></>}>
        <div className="sub" style={{ marginBottom: 8 }}>{profile.nickname}</div>
        <div className="itint">
          <div style={{ fontSize: 13 }}>在会话列表按昵称或客户编号搜索，可查看历史会话。</div>
        </div>
      </Modal>
    );
  }
  if (kind === "tickets") {
    return (
      <Modal title="关联工单" icon="doc" onClose={onClose} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button></>}>
        <div className="sub" style={{ marginBottom: 8 }}>{profile.nickname} · 当前 {profile.tickets} 张未关闭</div>
        <div className="itint">
          <div style={{ fontSize: 13 }}>请在客服工单里用昵称、用户编码或工单号搜索相关工单。</div>
          <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>本弹窗不再展示静态工单预览。</div>
        </div>
      </Modal>
    );
  }
  if (kind === "resetpw") {
    return (
      <Modal
        title="重置密码"
        icon="lock"
        onClose={onClose}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button><button type="button" className="btn btn-pri btn-sm" onClick={() => onAccount(`重置密码 · ${via === "sms" ? "短信" : "邮箱"}`)}>发送链接</button></>}
      >
        <div className="sub" style={{ marginBottom: 8 }}>选择验证通道并向客户发送重置链接</div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className={`chip${via === "sms" ? " sel" : ""}`} onClick={() => setVia("sms")}>手机 {profile.phone}</button>
          <button type="button" className={`chip${via === "email" ? " sel" : ""}`} onClick={() => setVia("email")}>注册邮箱</button>
        </div>
        <div className="itint" style={{ marginTop: 10 }}>发送后由账户相关同事处理，客服这边不保存记录。</div>
      </Modal>
    );
  }
  if (kind === "account") {
    const acts: Array<[string, string, string]> = [
      ["临时冻结账户", "24 小时内不能登录和交易", "账户操作"],
      ["提现限额下调", "单日上限调至默认 50%", "D 域提现记录"],
      ["请用户补充资料", "提醒用户补充工单资料", "客服工单"],
      ["解绑并重装设备", "重新生成设备令牌", "E 域设备明细"],
    ];
    return (
      <Modal title="账户操作" icon="wallet" onClose={onClose} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button></>}>
        <div className="sub" style={{ marginBottom: 10 }}>{profile.nickname} · {profile.uid} · 选一项会跳到对应的处理页面（实际操作在那里完成）</div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {acts.map(([k, d, domain]) => (
            <button key={k} type="button" className="itint" style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }} onClick={() => onAccount(k)}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{k}</span>
                <span className="bdg dim" style={{ fontSize: 10.5 }}>→ {domain}</span>
              </div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 3 }}>{d}</div>
            </button>
          ))}
        </div>
        <div className="itint" style={{ marginTop: 10 }}>点入口到对应页面 · 客服这里不代为提交，实际由账户、资金、设备相关页面审核处理。</div>
      </Modal>
    );
  }
  const notes = profile.notes ?? [];
  return (
    <Modal
      title="客户备注"
      icon="doc"
      onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button><button type="button" className="btn btn-pri btn-sm" disabled={!noteText.trim()} onClick={async () => { if (await onAddNote(noteText)) setNoteText(""); }}>保存备注</button></>}
    >
      <div className="sub" style={{ marginBottom: 6 }}>{profile.nickname} · {profile.uid} · 备注只有后台能看到，会一直保留在这个会话里</div>
      <textarea className="fld" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="例:机构账户,提现需重点复核;上次沟通约定 7 日后回访。" style={{ resize: "vertical" }} />
      {notes.length > 0 && (
        <>
          <div className="sub" style={{ fontWeight: 600, margin: "12px 0 6px" }}>已留备注 {notes.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflow: "auto" }}>
            {notes.map((n) => (
              <div key={n.id} className="itint">
                <div style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{n.text}</div>
                <div className="row" style={{ gap: 8, marginTop: 5, alignItems: "center" }}>
                  <span className="tiny" style={{ color: "var(--ink-4)" }} suppressHydrationWarning>{n.author} · {relWhen(n.ts)}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn btn-sec btn-sm" onClick={() => onRemoveNote(n.id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ============ 主动发起会话(真实单用户 + 内容源 + 撰写 + 预览)============ */
export type InitiatePayload = { identity: InitiateIdentity; targetLabel: string; targetDesc: string; text: string; ctaHref?: string; profile?: CustomerProfile };
export function InitiateModal({
  onClose,
  onSend,
  identities = [],
  advisorScripts = [],
  replyTemplates = [],
  customers = [],
  customerLoading = false,
  customerError = "",
  onCustomerQueryChange,
}: {
  onClose: () => void;
  onSend: (p: InitiatePayload) => Promise<void>;
  identities?: InitiateIdentity[];
  advisorScripts?: AdvisorScript[];
  replyTemplates?: SessionReplyTpl[];
  customers?: CustomerProfile[];
  customerLoading?: boolean;
  customerError?: string;
  onCustomerQueryChange?: (query: string) => void;
}) {
  const [identId, setIdentId] = useState(identities[0]?.id ?? "");
  const identity = identities.find((i) => i.id === identId) ?? identities[0];
  const isAdvisor = identity?.type === "advisor";
  const [custUid, setCustUid] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const supportTpls = replyTemplates.filter((t) => t.type === "support" && t.status === "published");
  // 发起会话默认使用空白自定义文案，避免把历史模板（尤其测试/草稿内容）误发给真实用户。
  const [scriptId, setScriptId] = useState("");
  const [tplId, setTplId] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const script = advisorScripts.find((s) => s.id === scriptId) ?? null;
  useEffect(() => {
    if (identities.length === 0) {
      if (identId) setIdentId("");
      return;
    }
    if (!identities.some((i) => i.id === identId)) setIdentId(identities[0].id);
  }, [identId, identities]);
  useEffect(() => {
    if (custUid && !customers.some((c) => c.uid === custUid)) setCustUid("");
  }, [custUid, customers]);
  useEffect(() => {
    onCustomerQueryChange?.(custQuery);
  }, [custQuery, onCustomerQueryChange]);
  useEffect(() => {
    if (isAdvisor) { const s = advisorScripts.find((x) => x.id === scriptId); setText(s ? s.text : ""); }
    else { const t = replyTemplates.find((x) => x.id === tplId); setText(t ? t.text : ""); }
  }, [advisorScripts, isAdvisor, replyTemplates, scriptId, tplId]);

  const selectedCust = customers.find((c) => c.uid === custUid) ?? null;
  const targetLabel = selectedCust?.nickname ?? "";
  const targetDesc = `单个客户 ${selectedCust?.nickname ?? ""}(${selectedCust?.uid ?? ""})`;
  const ok = !!identity && text.trim() !== "" && !!selectedCust;
  const normalizedCustomerQuery = custQuery.trim().toLowerCase();
  const matchingCustomers = customers.filter((customer) => (
    !normalizedCustomerQuery
    || `${customer.nickname}${customer.uid}${customer.region}`.toLowerCase().includes(normalizedCustomerQuery)
  ));

  return (
    <Modal
      title="主动发起会话"
      icon="plus"
      wide
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={13} />发起会话会记入操作记录（身份、对象、话术）
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn btn-pri btn-sm"
            disabled={!ok || submitting}
            onClick={async () => {
              if (!identity) return;
              setSubmitting(true);
              try {
                await onSend({ identity, targetLabel, targetDesc, text: text.trim(), ctaHref: isAdvisor && script ? script.ctaHref : "—", profile: selectedCust ?? undefined });
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "正在发起…" : `发起会话${!ok ? " · 待补全" : ""}`}
          </button>
        </div>
      }
    >
      <div className="pa-grid">
        <div className="pa-col">
          <Field label="发起身份">
            <Select aria-label="发起身份" value={identId} onChange={setIdentId} options={identities.length === 0 ? [{ value: "", label: "暂无可发起身份" }] : identities.map((i) => ({ value: i.id, label: `${i.label} · ${i.name}（${i.id}）` }))} />
            <span className="hint" style={{ color: isAdvisor ? "var(--m-wait)" : "var(--ink-4)" }}>
              {identity ? (isAdvisor ? "顾问身份 · 可带主动话术与转化跳转" : "客服身份 · 中性答复,无主动话术 / 跳转") : "请先在「服务规则与话术」给客服设置可用的服务类型"}
            </span>
          </Field>

          <div className="field">
            <span className="bf-legend">发起对象</span>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="inp">
                <Icon name="search" size={15} />
                <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder="搜索客户 昵称 / 用户编码 / 地区" />
              </div>
              <div className="tiny" style={{ color: "var(--ink-4)" }}>从全部用户里搜索；没聊过的用户也可以主动发起。</div>
              <div style={{ maxHeight: 224, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {customerLoading && <div className="itint"><div style={{ fontSize: 13 }}>正在查询用户…</div></div>}
                {!customerLoading && customerError && <div className="itint"><div style={{ fontSize: 13 }}>用户查询失败</div><div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>请检查网络后重试搜索；错误：{customerError}</div></div>}
                {!customerLoading && !customerError && matchingCustomers.length === 0 && <div className="itint"><div style={{ fontSize: 13 }}>未找到匹配客户</div><div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>可按昵称、用户编码或地区重新搜索。</div></div>}
                {!customerLoading && matchingCustomers.map((c) => (
                  <button key={c.uid} type="button" onClick={() => setCustUid(c.uid)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${custUid === c.uid ? "var(--m-hd-border)" : "var(--border)"}`, background: custUid === c.uid ? "var(--m-hd-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    <MAvatar name={c.nickname} size="sm" />
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{c.nickname}</span><span className="cvp-vchip" style={{ height: 17, fontSize: 10.5, padding: "0 5px" }}>{c.vlevel}</span></span><span className="mono dim2" style={{ fontSize: 11 }}>{c.uid} · {c.region}</span></span>
                    <span style={{ fontSize: 11.5, flex: "none", color: c.risk === "低" ? "var(--m-ok)" : c.risk === "中" ? "var(--m-high)" : "var(--m-urgent)" }}>风险 {c.risk}</span>
                    {custUid === c.uid && <Icon name="check" size={15} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Field label={isAdvisor ? "选择话术" : "选择回复模板"}>
            {isAdvisor ? (
              <Select aria-label="选择话术" value={scriptId} onChange={setScriptId} options={[{ value: "", label: "自定义开场消息" }, ...advisorScripts.map((s) => ({ value: s.id, label: `${s.id} · ${scriptGroupLabel(s.group)}${s.ctaHref !== "—" ? `（${s.ctaHref}）` : ""}` }))]} />
            ) : (
              <Select aria-label="选择回复模板" value={tplId} onChange={setTplId} options={[{ value: "", label: "自定义开场消息" }, ...supportTpls.map((t) => ({ value: t.id, label: `${t.id} · ${t.text.slice(0, 14)}…` }))]} />
            )}
          </Field>

        </div>

        <div className="pa-col">
          <Field label="开场消息">
            <textarea className="fld" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="撰写发给用户的第一句话…" style={{ resize: "vertical" }} />
          </Field>
          <div className="pa-sech" style={{ fontSize: 12.5 }}>预览 · 用户将收到</div>
          <div className="pa-prev">
            <div className="pa-prev-to">
              发送至 <b>{targetLabel || "(待填写用户)"}</b>
            </div>
            <div className="pa-bubble-row">
              <div className="pa-bubble">
                <div className="pa-bubble-name">{identity?.name ?? "待选择身份"}</div>
                <div className="pa-bubble-text">{text || "(开场消息为空)"}</div>
                {isAdvisor && script && script.ctaHref !== "—" && (
                  <span className="pa-cta"><Icon name="arrow" size={13} />{script.ctaHref}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ============ 跨坐席转交(选目标 + 转交原因)============
 * 例行内部交接:不弹操作确认(MC)、不写 A2 审计;转交原因记入会话系统消息。 */
type TransferAgentOption = { id: string; name: string; position?: string };
export type TransferPayload = { to: TransferTarget; reason: string };
export function TransferModal({
  currentOwnerId,
  onClose,
  onSubmit,
  agents = [],
  queues = [],
}: {
  currentOwnerId?: string;
  onClose: () => void;
  onSubmit: (p: TransferPayload) => void;
  agents?: TransferAgentOption[];
  queues?: string[];
}) {
  const agentOptions = agents.filter((a) => a.name !== "Unassigned" && a.id !== currentOwnerId);
  const [kind, setKind] = useState<"agent" | "queue" | "standby">(agentOptions.length ? "agent" : queues.length ? "queue" : "standby");
  const [selectedAgentId, setSelectedAgentId] = useState(agentOptions[0]?.id ?? "");
  const [queue, setQueue] = useState(queues[0] ?? "");
  const [reason, setReason] = useState("");
  const reasonLength = reason.trim().length;
  const reasonOk = reasonLength >= 8 && reasonLength <= 200;
  const selectedAgent = agentOptions.find((item) => item.id === selectedAgentId);
  const targetOk = kind === "agent" ? Boolean(selectedAgent) : kind === "queue" ? !!queue : true;
  const to: TransferTarget = kind === "agent" && selectedAgent ? { kind: "agent", agentId: selectedAgent.id, name: selectedAgent.name } : kind === "queue" ? { kind: "queue", queue } : { kind: "standby" };
  const ok = reasonOk && targetOk;
  return (
    <Modal
      title="转交会话"
      icon="users"
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="users" size={13} />内部交接 · 原因会记在会话里
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button type="button" data-proof="session-transfer-submit" className="btn btn-pri btn-sm" disabled={!ok} onClick={() => onSubmit({ to, reason: reason.trim() })}>
            转交 · 转入待处理{!ok ? " · 待补全" : ""}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="field">
          <span className="bf-legend">转交目标</span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className={`chip${kind === "agent" ? " sel" : ""}`} disabled={agentOptions.length === 0} onClick={() => setKind("agent")}>指定坐席</button>
            <button type="button" className={`chip${kind === "queue" ? " sel" : ""}`} disabled={queues.length === 0} onClick={() => setKind("queue")}>技能队列</button>
            <button type="button" className={`chip${kind === "standby" ? " sel" : ""}`} onClick={() => setKind("standby")}>备勤池</button>
          </div>
          {kind === "agent" && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 224, overflow: "auto" }}>
              {agentOptions.length === 0 && (
                <div className="itint">
                  <div style={{ fontSize: 13 }}>暂无可转交坐席</div>
                  <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>可转交的客服来自「服务规则与话术」里已启用、没暂停接单的客服。</div>
                </div>
              )}
              {agentOptions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  data-proof={`session-transfer-agent-${a.id}`}
                  onClick={() => setSelectedAgentId(a.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${selectedAgentId === a.id ? "var(--m-hd-border)" : "var(--border)"}`, background: selectedAgentId === a.id ? "var(--m-hd-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                >
                  <MAvatar name={a.name} size="sm" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, color: "var(--ink)" }}>{a.name}</span>
                    {a.position && <span className="dim2" style={{ fontSize: 11.5 }}>{a.position}</span>}
                    <span className="dim2 mono" style={{ display: "block", fontSize: 11.5 }}>坐席ID {a.id}</span>
                  </span>
                  {selectedAgentId === a.id && <Icon name="check" size={15} />}
                </button>
              ))}
            </div>
          )}
          {kind === "queue" && (
            <Select aria-label="转交队列" value={queue} onChange={setQueue} options={queues.length === 0 ? [{ value: "", label: "暂无可转交队列" }] : queues.map((q) => ({ value: q, label: q }))} />
          )}
          {kind === "standby" && (
            <div className="itint" style={{ marginTop: 8 }}>转入<b>{STANDBY_POOL_LABEL}</b>,由负载调度重新分配给空闲坐席接待。</div>
          )}
        </div>
        <Field label="转交原因" required>
          <span className="hint">8–200 字 · 接手的客服能看到，会记在会话里</span>
          <textarea className="fld" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客户是设备掉线＋固件问题,转给硬件支持跟进更对口。" style={{ resize: "vertical" }} />
        </Field>
      </div>
    </Modal>
  );
}

/* ============ 手动退回(退回来源坐席 / 备勤池 + 必填退回原因)============
 * 退回原因记入会话系统消息;不写 A2 审计。 */
export type ReturnPayload = { target: "from" | "standby"; reason: string };
export function ReturnModal({ fromAgent, onClose, onSubmit }: { fromAgent: string; onClose: () => void; onSubmit: (p: ReturnPayload) => void }) {
  const [target, setTarget] = useState<"from" | "standby">("from");
  const [reason, setReason] = useState("");
  const reasonLength = reason.trim().length;
  const ok = reasonLength >= 8 && reasonLength <= 200;
  return (
    <Modal
      title="退回会话"
      icon="arrow"
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={13} />退回原因会记在会话里
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button type="button" data-proof="session-transfer-return-submit" className="btn btn-danger btn-sm" disabled={!ok} onClick={() => onSubmit({ target, reason: reason.trim() })}>
            确认退回{!ok ? " · 待填原因" : ""}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="field">
          <span className="bf-legend">退回去向</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className={`chip${target === "from" ? " sel" : ""}`} onClick={() => setTarget("from")}>退回来源坐席 {ownerLabel(fromAgent)}</button>
            <button type="button" className={`chip${target === "standby" ? " sel" : ""}`} onClick={() => setTarget("standby")}>退回{STANDBY_POOL_LABEL}</button>
          </div>
        </div>
        <Field label="退回原因" required>
          <span className="hint">8–200 字 · 必填 · 会作为系统消息记在会话里</span>
          <textarea className="fld" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:此问题属硬件范畴,我这边无法处理,退回原坐席重新分派。" style={{ resize: "vertical" }} />
        </Field>
      </div>
    </Modal>
  );
}
