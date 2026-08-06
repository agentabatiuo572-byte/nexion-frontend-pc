"use client";

/**
 * M3 会话台 modal 群(从 m3-sessions 抽出,逻辑不变):
 *  - InitiateModal: 主动发起会话(真实单用户 + 撰写 + 预览)
 *  - CustomerProfileModal: 完整客户档案(只读快照)
 *  - QuickActionModal: 历史会话 / 关联工单 / 重置密码 / 账户操作 / 客户备注(不写审计,交 C/D 域复核)
 * 均渲染于 design-kit Modal;合规(运营可读中文 · 数字不自曝)。
 */
import { useEffect, useState, type ReactNode } from "react";
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
import type { ConversationTimeoutPolicy } from "@/lib/admin/m-client";

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

export function IdlePolicyModal({
  policy,
  canSave,
  saving,
  error,
  onClose,
  onSave,
}: {
  policy: ConversationTimeoutPolicy;
  canSave: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: { warnMinutes: number; closeMinutes: number; reason: string }) => Promise<boolean>;
}) {
  const [warn, setWarn] = useState(String(policy.warnMinutes));
  const [close, setClose] = useState(String(policy.closeMinutes));
  const [reason, setReason] = useState("");
  const warnN = Number(warn);
  const closeN = Number(close);
  const warnOk = Number.isInteger(warnN) && warnN >= 1 && warnN <= 30;
  const closeOk = Number.isInteger(closeN) && closeN >= 2 && closeN <= 120;
  const orderOk = warnOk && closeOk && closeN > warnN;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const unchanged = warnN === policy.warnMinutes && closeN === policy.closeMinutes;

  async function save() {
    if (!canSave || saving || !orderOk || !reasonOk || unchanged) return;
    const succeeded = await onSave({
      warnMinutes: warnN,
      closeMinutes: closeN,
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
  ) => (
    <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <span>
        <span style={{ fontSize: 13 }}>{label}</span>
        <span className="sub" style={{ display: "block" }}>{hint}</span>
      </span>
      <input
        className="fld mono"
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={!canSave || saving}
        onChange={(event) => setValue(event.target.value)}
        style={{ width: 88, textAlign: "right" }}
        aria-label={label}
      />
    </label>
  );

  return (
    <Modal
      title="会话超时策略"
      icon="clock"
      onClose={onClose}
      footer={(
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={13} />
            作用于真实会话 · 版本 {policy.version} · 变更记入审计
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose} disabled={saving}>取消</button>
          <button
            type="button"
            data-proof="session-idle-policy-save"
            className="btn btn-pri btn-sm"
            onClick={save}
            disabled={!canSave || saving || !reasonOk || !orderOk || unchanged}
          >
            {saving ? "保存中…" : !canSave ? "无策略管理权限" : unchanged ? "策略未变更" : "确认并保存"}
          </button>
        </div>
      )}
    >
      <div className="col" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {numField("闲置提醒时长(分钟)", "用户静默满该时长,会话内写入系统预告", warn, setWarn, 1, 30)}
        {numField("闲置自动结束时长(分钟)", "用户静默满该时长,服务端自动结束会话", close, setClose, 2, 120)}
        {!orderOk && (
          <div className="sub" style={{ color: "var(--danger)" }}>
            {!warnOk || !closeOk ? "请输入整数分钟并满足允许范围。" : "自动结束时长必须大于提醒时长。"}
          </div>
        )}
        <div className="itint" style={{ padding: "11px 13px", lineHeight: 1.7, fontSize: 12.5 }}>
          服务端实际效果:静默 {warnOk ? warnN : "—"} 分钟写入提醒;静默 {closeOk ? closeN : "—"} 分钟后以 CAS 校验最后活动时间并自动结束。期间有新消息则本轮任务失效,不会误关会话。
        </div>
        <label className="col" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13 }}>
            变更理由 <span style={{ color: "var(--danger)" }}>*</span>
            <span className="sub">(8–200 字 · 后端审计必填)</span>
          </span>
          <textarea
            className="fld"
            rows={2}
            value={reason}
            disabled={!canSave || saving}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例:根据当前接待量调整闲置策略,释放长期无响应会话"
            style={{ resize: "vertical" }}
          />
        </label>
        {error && (
          <div className="itint" role="alert" style={{ color: "var(--danger)", padding: "10px 12px" }}>
            保存失败或结果未知,页面数据未更新。请保留当前输入并重试;若提示版本过期,关闭弹窗后重新打开。
            <div className="mono" style={{ marginTop: 4, fontSize: 11 }}>{error}</div>
          </div>
        )}
      </div>
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
    ...(profile.idle ? ([["闲置情况", profile.idle]] as Array<[string, string]>) : []),
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
            <Icon name="shield" size={13} />只读快照 · 真实账户处置回 C 账户 / D 资金域
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
            <span className="bdg ok">KYC {profile.kyc}</span>
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
        <div className="sub" style={{ marginBottom: 8 }}>{profile.nickname} · 后端会话记录</div>
        <div className="itint">
          <div style={{ fontSize: 13 }}>请在 M3 会话列表使用用户昵称 / 用户编码搜索查看该用户的真实历史会话。</div>
          <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>本弹窗不再展示静态历史预览。</div>
        </div>
      </Modal>
    );
  }
  if (kind === "tickets") {
    return (
      <Modal title="关联工单" icon="doc" onClose={onClose} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button></>}>
        <div className="sub" style={{ marginBottom: 8 }}>{profile.nickname} · 当前 {profile.tickets} 张未关闭</div>
        <div className="itint">
          <div style={{ fontSize: 13 }}>请在 M2 工单台使用用户昵称 / 用户编码 / 工单号搜索查看真实关联工单。</div>
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
        <div className="itint" style={{ marginTop: 10 }}>发送后由 C 账户域处置 · 客服侧不落库、不计审计。</div>
      </Modal>
    );
  }
  if (kind === "account") {
    const acts: Array<[string, string, string]> = [
      ["临时冻结账户", "限制登录与交易 24h", "C2 账户操作"],
      ["提现限额下调", "单日上限调至默认 50%", "D 域提现记录"],
      ["补资料指令", "推送实名重传提醒", "C4 实名台账"],
      ["解绑并重装设备", "重新生成设备令牌", "E 域设备明细"],
    ];
    return (
      <Modal title="账户操作" icon="wallet" onClose={onClose} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button></>}>
        <div className="sub" style={{ marginBottom: 10 }}>{profile.nickname} · {profile.uid} · 选择一项将直达对应域处置页(真实写操作在 C/D/E 域完成)</div>
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
        <div className="itint" style={{ marginTop: 10 }}>点击即跳转对应域处置页 · 客服侧不代为提交,真实处置在 C 账户 / D 资金 / E 设备域复核执行。</div>
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
      <div className="sub" style={{ marginBottom: 6 }}>{profile.nickname} · {profile.uid} · 备注仅后台可见,随会话持久</div>
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
            <Icon name="shield" size={13} />发起写入审计 · 身份 / 目标 / 话术留档
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
            {submitting ? "正在发起..." : `发起会话${!ok ? " · 待补全" : ""}`}
          </button>
        </div>
      }
    >
      <div className="pa-grid">
        <div className="pa-col">
          <Field label="发起身份">
            <select className="fld" value={identId} onChange={(e) => setIdentId(e.target.value)}>
              {identities.length === 0 && <option value="">暂无可发起身份</option>}
              {identities.map((i) => <option key={i.id} value={i.id}>{i.label} · {i.name}（{i.id}）</option>)}
            </select>
            <span className="hint" style={{ color: isAdvisor ? "var(--m-wait)" : "var(--ink-4)" }}>
              {identity ? (isAdvisor ? "顾问身份 · 可带主动话术与转化跳转" : "客服身份 · 中性答复,无主动话术 / 跳转") : "请先在 M5 给客服配置可用服务类型"}
            </span>
          </Field>

          <div className="field">
            <span className="bf-legend">发起对象</span>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="inp">
                <Icon name="search" size={15} />
                <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder="搜索客户 昵称 / 用户编码 / 地区" />
              </div>
              <div className="tiny" style={{ color: "var(--ink-4)" }}>从真实用户库搜索；无历史会话也可主动发起。</div>
              <div style={{ maxHeight: 224, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {customerLoading && <div className="itint"><div style={{ fontSize: 13 }}>正在查询真实用户…</div></div>}
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
              <select className="fld" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">自定义开场消息</option>
                {advisorScripts.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.group}{s.ctaHref !== "—" ? `（${s.ctaHref}）` : ""}</option>)}
              </select>
            ) : (
              <select className="fld" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                <option value="">自定义开场消息</option>
                {supportTpls.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.text.slice(0, 14)}…</option>)}
              </select>
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
            <Icon name="users" size={13} />例行内部交接 · 不触发审计弹窗 · 原因记入会话
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
                  <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>可转交坐席来自 M5 岗位配置中的启用且未暂停接派单坐席。</div>
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
            <select className="fld" style={{ marginTop: 8 }} value={queue} onChange={(e) => setQueue(e.target.value)}>
              {queues.length === 0 && <option value="">暂无可转交队列</option>}
              {queues.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          )}
          {kind === "standby" && (
            <div className="itint" style={{ marginTop: 8 }}>转入<b>{STANDBY_POOL_LABEL}</b>,由负载调度重新分配给空闲坐席接待。</div>
          )}
        </div>
        <Field label="转交原因" required>
          <span className="hint">8-200 字 · 接手坐席能看到,记入会话留档(不写 A2 审计)</span>
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
            <Icon name="shield" size={13} />退回原因记入会话留档 · 不写审计
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
          <span className="hint">8-200 字 · 必填 · 记入会话系统消息(不写 A2 审计)</span>
          <textarea className="fld" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:此问题属硬件范畴,我这边无法处理,退回原坐席重新分派。" style={{ resize: "vertical" }} />
        </Field>
      </div>
    </Modal>
  );
}
