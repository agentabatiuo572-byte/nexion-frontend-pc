"use client";

/**
 * M3 会话台 modal 群(从 m3-sessions 抽出,逻辑不变):
 *  - InitiateModal: 主动发起会话(身份 + 单人/固定档/自定义圈选 + 撰写 + 预览)
 *  - CustomerProfileModal: 完整客户档案(只读快照)
 *  - QuickActionModal: 历史会话 / 关联工单 / 重置密码 / 账户操作 / 客户备注(不写审计,交 C/D 域复核)
 * 均渲染于 design-kit Modal;合规(运营可读中文 · 数字不自曝)。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Icon, Modal } from "../design-kit";
import {
  AUDIENCE_PRESETS,
  SEG_FIELDS,
  STANDBY_POOL_LABEL,
  type AdvisorScript,
  type CustomerProfile,
  type InitiateIdentity,
  type SegCond,
  type SessionReplyTpl,
  type TransferTarget,
} from "./data";
import { MAvatar, ownerLabel, relWhen } from "./hd-ui";

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
            {profile.tags.map((t) => <span key={t} className="bdg dim">{t}</span>)}
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
  onAddNote: (text: string) => void;
  onRemoveNote: (id: string) => void;
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
    const acts: Array<[string, string]> = [
      ["临时冻结账户", "限制登录与交易 24h"],
      ["提现限额下调", "单日上限调至默认 50%"],
      ["补资料指令", "推送实名重传提醒"],
      ["解绑并重装设备", "重新生成设备令牌"],
    ];
    return (
      <Modal title="账户操作" icon="wallet" onClose={onClose} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button></>}>
        <div className="sub" style={{ marginBottom: 10 }}>{profile.nickname} · {profile.uid} · 选择一项权限内动作(交 C/D 域复核)</div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {acts.map(([k, d]) => (
            <button key={k} type="button" className="itint" style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }} onClick={() => onAccount(k)}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{k}</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 3 }}>{d}</div>
            </button>
          ))}
        </div>
        <div className="itint" style={{ marginTop: 10 }}>账户类动作客服侧仅发起,真实处置在 C 账户 / D 资金 / 风控域复核执行。</div>
      </Modal>
    );
  }
  const notes = profile.notes ?? [];
  return (
    <Modal
      title="客户备注"
      icon="doc"
      onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>关闭</button><button type="button" className="btn btn-pri btn-sm" disabled={!noteText.trim()} onClick={() => { onAddNote(noteText); setNoteText(""); }}>保存备注</button></>}
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
                  <span className="tiny" style={{ color: "var(--ink-4)" }}>{n.author} · {relWhen(n.ts)}</span>
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

/* ============ 自定义圈选构建器(字段 × 运算符 × 值,多条件「且」)============ */
export function segSummary(conds: SegCond[]): string {
  return conds
    .filter((c) => String(c.value).trim() !== "")
    .map((c) => {
      const f = SEG_FIELDS.find((x) => x.id === c.field);
      const tail = f?.unit ? (f.unit === "USDT" ? ` ${f.unit}` : f.unit) : "";
      return `${f?.label ?? c.field} ${c.op} ${c.value}${tail}`;
    })
    .join(" 且 ");
}
export function segValid(conds: SegCond[]): boolean {
  return conds.length > 0 && conds.every((c) => String(c.value).trim() !== "");
}
function CustomSegment({ conds, setConds }: { conds: SegCond[]; setConds: (c: SegCond[]) => void }) {
  const fieldOf = (id: string) => SEG_FIELDS.find((f) => f.id === id) ?? SEG_FIELDS[0];
  const add = () => {
    const f = SEG_FIELDS[0];
    setConds([...conds, { field: f.id, op: f.ops[0], value: f.vals ? f.vals[0] : "" }]);
  };
  const upd = (i: number, patch: Partial<SegCond>) => setConds(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const del = (i: number) => setConds(conds.filter((_, j) => j !== i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {conds.map((c, i) => {
        const f = fieldOf(c.field);
        return (
          <div key={i} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {i > 0 && <span className="sub" style={{ fontWeight: 600 }}>且</span>}
            <select
              className="fld"
              style={{ width: "auto" }}
              value={c.field}
              onChange={(e) => { const nf = fieldOf(e.target.value); upd(i, { field: nf.id, op: nf.ops[0], value: nf.vals ? nf.vals[0] : "" }); }}
            >
              {SEG_FIELDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <select className="fld" style={{ width: 64 }} value={c.op} onChange={(e) => upd(i, { op: e.target.value })}>
              {f.ops.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {f.vals ? (
              <select className="fld" style={{ width: "auto" }} value={c.value} onChange={(e) => upd(i, { value: e.target.value })}>
                {f.vals.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <span className="row" style={{ gap: 4, alignItems: "center" }}>
                <input className="fld mono" type="number" value={c.value} placeholder="数值" onChange={(e) => upd(i, { value: e.target.value })} style={{ width: 96 }} />
                {f.unit && <span className="sub">{f.unit}</span>}
              </span>
            )}
            <button type="button" className="btn btn-sec btn-sm" onClick={() => del(i)} title="删除条件"><Icon name="x" size={13} /></button>
          </div>
        );
      })}
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sec btn-sm" onClick={add}><Icon name="plus" size={13} /> 添加条件</button>
        {conds.length === 0 && <span className="sub">按 V 等级 / 余额 / 提现 / 持仓 / 注册天数 … 多条件「且」组合</span>}
      </div>
    </div>
  );
}

/* ============ 主动发起会话(身份 + 单人/固定档/自定义圈选 + 内容源 + 撰写 + 预览)============ */
export type InitiatePayload = { identity: InitiateIdentity; targetLabel: string; targetDesc: string; text: string; ctaHref?: string; reason?: string; profile?: CustomerProfile; isSegment?: boolean };
export function InitiateModal({
  onClose,
  onSend,
  identities = [],
  advisorScripts = [],
  replyTemplates = [],
  customers = [],
}: {
  onClose: () => void;
  onSend: (p: InitiatePayload) => void;
  identities?: InitiateIdentity[];
  advisorScripts?: AdvisorScript[];
  replyTemplates?: SessionReplyTpl[];
  customers?: CustomerProfile[];
}) {
  const [identId, setIdentId] = useState(identities[0]?.id ?? "");
  const identity = identities.find((i) => i.id === identId) ?? identities[0];
  const isAdvisor = identity?.type === "advisor";
  const [mode, setMode] = useState<"user" | "audience">("user");
  const [custUid, setCustUid] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const [audMode, setAudMode] = useState<"preset" | "custom">("preset");
  const [preset, setPreset] = useState<string>(AUDIENCE_PRESETS[0]);
  const [conds, setConds] = useState<SegCond[]>([]);
  const pubScripts = advisorScripts.filter((s) => s.status === "published");
  const [scriptId, setScriptId] = useState(pubScripts[0]?.id ?? advisorScripts[0]?.id ?? "");
  const supportTpls = replyTemplates.filter((t) => t.type === "support" && t.status === "published");
  const [tplId, setTplId] = useState(supportTpls[0]?.id ?? "");
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");

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
    if (isAdvisor) { const s = advisorScripts.find((x) => x.id === scriptId); setText(s ? s.text : ""); }
    else { const t = replyTemplates.find((x) => x.id === tplId); setText(t ? t.text : ""); }
  }, [advisorScripts, isAdvisor, replyTemplates, scriptId, tplId]);

  const selectedCust = customers.find((c) => c.uid === custUid) ?? null;
  const targetLabel = mode === "user" ? selectedCust?.nickname ?? "" : audMode === "preset" ? preset : segValid(conds) ? "自定义人群" : "";
  const targetDesc = mode === "user" ? `单个客户 ${selectedCust?.nickname ?? ""}(${selectedCust?.uid ?? ""})` : audMode === "preset" ? `人群 · ${preset}` : `自定义人群 · ${segSummary(conds)}`;
  const needReason = mode === "audience";
  const targetOk = mode === "user" ? !!selectedCust : audMode === "preset" ? true : segValid(conds);
  const ok = !!identity && text.trim() !== "" && targetOk && (!needReason || reason.trim().length >= 6);

  return (
    <Modal
      title="主动发起会话"
      icon="plus"
      wide
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={13} />发起写入审计 · 身份 / 目标 / 话术{needReason ? " / 理由" : ""}留档
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn btn-pri btn-sm"
            disabled={!ok}
            onClick={() => {
              if (!identity) return;
              onSend({ identity, targetLabel, targetDesc, text: text.trim(), ctaHref: isAdvisor && script ? script.ctaHref : "—", reason: needReason ? reason.trim() : undefined, profile: mode === "user" ? selectedCust ?? undefined : undefined, isSegment: mode === "audience" });
            }}
          >
            发起会话{!ok ? " · 待补全" : ""}
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
            <label>发起对象</label>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className={`chip${mode === "user" ? " sel" : ""}`} onClick={() => setMode("user")}>指定用户</button>
              <button type="button" className={`chip${mode === "audience" ? " sel" : ""}`} onClick={() => setMode("audience")}>圈选人群</button>
            </div>
            {mode === "user" ? (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="inp">
                  <Icon name="search" size={15} />
                  <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder="搜索客户 昵称 / 用户编码 / 地区" />
                </div>
                <div style={{ maxHeight: 224, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {customers.length === 0 && (
                    <div className="itint">
                      <div style={{ fontSize: 13 }}>暂无可选客户</div>
                      <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>请先确认 M3 会话接口已返回客户档案。</div>
                    </div>
                  )}
                  {customers.filter((c) => {
                    const q = custQuery.trim().toLowerCase();
                    return !q || (c.nickname + c.uid + c.region).toLowerCase().includes(q);
                  }).map((c) => (
                    <button
                      key={c.uid}
                      type="button"
                      onClick={() => setCustUid(c.uid)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${custUid === c.uid ? "var(--m-hd-border)" : "var(--border)"}`, background: custUid === c.uid ? "var(--m-hd-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                    >
                      <MAvatar name={c.nickname} size="sm" />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{c.nickname}</span>
                          <span className="cvp-vchip" style={{ height: 17, fontSize: 10.5, padding: "0 5px" }}>{c.vlevel}</span>
                        </span>
                        <span className="mono dim2" style={{ fontSize: 11 }}>{c.uid} · {c.region}</span>
                      </span>
                      <span style={{ fontSize: 11.5, flex: "none", color: c.risk === "低" ? "var(--m-ok)" : c.risk === "中" ? "var(--m-high)" : "var(--m-urgent)" }}>风险 {c.risk}</span>
                      {custUid === c.uid && <Icon name="check" size={15} />}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className={`chip${audMode === "preset" ? " sel" : ""}`} onClick={() => setAudMode("preset")}>固定档</button>
                  <button type="button" className={`chip${audMode === "custom" ? " sel" : ""}`} onClick={() => setAudMode("custom")}>自定义圈选</button>
                </div>
                {audMode === "preset" ? (
                  <select className="fld" value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {AUDIENCE_PRESETS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                ) : (
                  <CustomSegment conds={conds} setConds={setConds} />
                )}
              </div>
            )}
          </div>

          <Field label={isAdvisor ? "选择话术" : "选择回复模板"}>
            {isAdvisor ? (
              <select className="fld" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                {advisorScripts.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.group}{s.ctaHref !== "—" ? `（${s.ctaHref}）` : ""}</option>)}
              </select>
            ) : (
              <select className="fld" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                {supportTpls.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.text.slice(0, 14)}…</option>)}
              </select>
            )}
          </Field>

          {needReason && (
            <Field label="投放理由" required>
              <span className="hint">人群批量触达属高敏 · ≥6 字 · 留档</span>
              <textarea className="fld" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:针对设备闲置户的复投唤醒批次,本批限顾问 Mia 触达。" style={{ resize: "vertical" }} />
            </Field>
          )}
        </div>

        <div className="pa-col">
          <Field label="开场消息">
            <textarea className="fld" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="撰写发给用户的第一句话…" style={{ resize: "vertical" }} />
          </Field>
          <div className="pa-sech" style={{ fontSize: 12.5 }}>预览 · 用户将收到</div>
          <div className="pa-prev">
            <div className="pa-prev-to">
              发送至 <b>{targetLabel || (mode === "user" ? "(待填写用户)" : "(待选受众)")}</b>
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
  currentOwner,
  onClose,
  onSubmit,
  agents = [],
  queues = [],
}: {
  currentOwner: string;
  onClose: () => void;
  onSubmit: (p: TransferPayload) => void;
  agents?: TransferAgentOption[];
  queues?: string[];
}) {
  const agentOptions = agents.filter((a) => a.name !== "Unassigned" && a.name !== currentOwner);
  const [kind, setKind] = useState<"agent" | "queue" | "standby">(agentOptions.length ? "agent" : queues.length ? "queue" : "standby");
  const [agent, setAgent] = useState(agentOptions[0]?.name ?? "");
  const [queue, setQueue] = useState(queues[0] ?? "");
  const [reason, setReason] = useState("");
  const reasonOk = reason.trim().length >= 6;
  const targetOk = kind === "agent" ? !!agent : kind === "queue" ? !!queue : true;
  const to: TransferTarget = kind === "agent" ? { kind: "agent", name: agent } : kind === "queue" ? { kind: "queue", queue } : { kind: "standby" };
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
          <label>转交目标</label>
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
                  onClick={() => setAgent(a.name)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${agent === a.name ? "var(--m-hd-border)" : "var(--border)"}`, background: agent === a.name ? "var(--m-hd-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                >
                  <MAvatar name={a.name} size="sm" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, color: "var(--ink)" }}>{a.name}</span>
                    {a.position && <span className="dim2" style={{ fontSize: 11.5 }}>{a.position}</span>}
                  </span>
                  {agent === a.name && <Icon name="check" size={15} />}
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
          <span className="hint">≥6 字 · 接手坐席能看到,记入会话留档(不写 A2 审计)</span>
          <textarea className="fld" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客户是设备掉线＋固件问题,转给硬件支持跟进更对口。" style={{ resize: "vertical" }} />
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
  const ok = reason.trim().length >= 6;
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
          <label>退回去向</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className={`chip${target === "from" ? " sel" : ""}`} onClick={() => setTarget("from")}>退回来源坐席 {ownerLabel(fromAgent)}</button>
            <button type="button" className={`chip${target === "standby" ? " sel" : ""}`} onClick={() => setTarget("standby")}>退回{STANDBY_POOL_LABEL}</button>
          </div>
        </div>
        <Field label="退回原因" required>
          <span className="hint">≥6 字 · 必填 · 记入会话系统消息(不写 A2 审计)</span>
          <textarea className="fld" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:此问题属硬件范畴,我这边无法处理,退回原坐席重新分派。" style={{ resize: "vertical" }} />
        </Field>
      </div>
    </Modal>
  );
}
