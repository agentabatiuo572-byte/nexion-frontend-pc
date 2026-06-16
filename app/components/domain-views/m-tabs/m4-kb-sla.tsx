"use client";

/**
 * M4 知识库与 SLA — Help/FAQ 内容池 + Ticket 分类×SLA 矩阵(helpdesk 设计稿布局,由 I8 迁出)。
 * 真写统一落 platform-config params(persist 兼容前缀):
 *  - I.support.faqs: FAQ/help content rows(新增 / 发布)
 *  - I.support.sla: category SLA matrix(编辑)
 * 新建 FAQ、保存 SLA 走弹窗 + 审计理由;均刷新后仍在。
 */
import { useEffect, useMemo, useState } from "react";
import { Icon, Modal, PaginationExemptionList } from "../design-kit";
import {
  SUPPORT_FAQS,
  SUPPORT_SLA,
  type SupportFaq,
  type SupportSla,
  type SupportTicketCategory,
} from "./data";
import { catCN } from "./hd-ui";
import type { MCtx } from "./types";

const FAQ_KEY = "I.support.faqs";
const SLA_KEY = "I.support.sla";

const CATEGORY_OPTIONS: SupportTicketCategory[] = ["withdrawal", "deposit", "kyc", "hardware", "account", "earnings", "genesis", "technical", "other"];
const FAQ_CATEGORY_OPTIONS: SupportFaq["category"][] = ["general", ...CATEGORY_OPTIONS];
const SURFACES: SupportFaq["surface"][] = ["Help Center", "Ticket Create", "Nova"];
const SURFACE_CN: Record<SupportFaq["surface"], string> = { "Help Center": "帮助中心", "Ticket Create": "创建工单页", Nova: "Nova AI" };

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function nextFaqId(rows: SupportFaq[]): string {
  const max = rows.reduce((acc, row) => {
    const n = Number(row.id.replace(/^FAQ-/, ""));
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 3);
  return `FAQ-${String(max + 1).padStart(3, "0")}`;
}
const minReason = (r: string) => r.trim().length >= 8;

export function M4KbSla({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast } = ctx;
  const faqs = useMemo(() => parseParamArray<SupportFaq>(pget(FAQ_KEY), SUPPORT_FAQS), [ctx.params, pget]);
  const sla = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), SUPPORT_SLA), [ctx.params, pget]);

  const [showAddFaq, setShowAddFaq] = useState(false);
  const [editCat, setEditCat] = useState<SupportTicketCategory | null>(null);

  const saveFaq = (form: { category: SupportFaq["category"]; surface: SupportFaq["surface"]; question: string; answer: string; status: SupportFaq["status"]; reason: string }) => {
    if (!form.question.trim() || !form.answer.trim() || !minReason(form.reason)) {
      toast("FAQ 需要问题 / 回答 / 8 字以上审计理由");
      return;
    }
    const row: SupportFaq = {
      id: nextFaqId(faqs),
      category: form.category,
      question: form.question.trim(),
      answer: form.answer.trim(),
      status: form.status,
      surface: form.surface,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setParam(FAQ_KEY, JSON.stringify([row, ...faqs]), { action: `新建支持 FAQ ${row.id} · admin.support_faq_created`, reason: form.reason.trim() });
    setShowAddFaq(false);
    toast(`${row.id} 已保存 · ${catCN(row.category)} FAQ`);
  };

  const publishFaq = (id: string) => {
    setParam(FAQ_KEY, JSON.stringify(faqs.map((f) => (f.id === id ? { ...f, status: "published", updatedAt: new Date().toISOString().slice(0, 10) } : f))), { action: `发布支持 FAQ ${id} · admin.support_faq_published`, reason: "FAQ 发布(例行,自动留档)" });
    toast(`${id} 已发布`);
  };

  const saveSla = (cat: SupportTicketCategory, form: { firstResponseMins: string; resolutionHours: string; queue: string; escalation: string; reason: string }) => {
    const firstResponseMins = Number(form.firstResponseMins);
    const resolutionHours = Number(form.resolutionHours);
    if (!Number.isFinite(firstResponseMins) || !Number.isFinite(resolutionHours) || firstResponseMins <= 0 || resolutionHours <= 0) {
      toast("SLA 数值必须大于 0");
      return;
    }
    if (!form.queue.trim() || !form.escalation.trim() || !minReason(form.reason)) {
      toast("SLA 需要队列 / 升级路径 / 8 字以上审计理由");
      return;
    }
    const row: SupportSla = { category: cat, firstResponseMins, resolutionHours, queue: form.queue.trim(), escalation: form.escalation.trim() };
    setParam(SLA_KEY, JSON.stringify([row, ...sla.filter((x) => x.category !== cat)]), { action: `更新支持 SLA ${cat} · admin.support_sla_changed`, reason: form.reason.trim() });
    setEditCat(null);
    toast(`${catCN(cat)} SLA 已更新`);
  };

  const editRow = editCat ? sla.find((r) => r.category === editCat) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="dim" style={{ margin: 0, fontSize: 13 }}>维护帮助中心问答,设定每类工单多久要首次响应、多久要解决。</p>

      <div className="m4-cols">
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center" }}>
            <div className="sec-h" style={{ margin: 0 }}>
              <span className="t">Help/FAQ 内容管理</span>
              <span className="n">{faqs.length} 篇</span>
            </div>
            <button type="button" className="btn btn-pri btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowAddFaq(true)}>
              <Icon name="plus" size={16} />
              新增文章
            </button>
          </div>
          <div style={{ padding: "0 8px 10px" }}>
            {faqs.map((f) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{f.question}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                    <span className="idtag" style={{ fontSize: 11 }}>{f.id}</span>
                    <span className="chip" style={{ height: 18, fontSize: 11 }}>{catCN(f.category)}</span>
                    <span className="dim2" style={{ fontSize: 11 }}>{SURFACE_CN[f.surface]} · <span className="mono">{f.updatedAt}</span></span>
                  </div>
                </div>
                <span className={`stat ${f.status === "published" ? "resolved" : "wait"}`} style={{ height: 20 }}>{f.status === "published" ? "已发布" : "草稿"}</span>
                {f.status === "draft" ? (
                  <button type="button" data-proof="support-faq-publish" className="btn btn-sec btn-sm" onClick={() => publishFaq(f.id)}>
                    <Icon name="download" size={16} />
                    发布
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="编辑" onClick={() => toast(`已打开编辑器 · ${f.id}`)}>
                    <Icon name="doc" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 10 }}>
            <div className="sec-h" style={{ margin: 0 }}>
              <span className="t">Ticket 分类与 SLA</span>
              <span className="sp" />
              <span className="n">首响 / 解决</span>
            </div>
          </div>
          <div style={{ padding: "0 8px 10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 30px", gap: 8, padding: "0 12px 8px", fontSize: 11.5, color: "var(--ink-4)" }}>
              <span>分类 · 队列 · 升级</span>
              <span style={{ textAlign: "right" }}>首响</span>
              <span style={{ textAlign: "right" }}>解决</span>
              <span />
            </div>
            {sla.map((r) => (
              <div key={r.category} style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 30px", gap: 8, alignItems: "center", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                    {catCN(r.category)} <span className="dim2 mono" style={{ fontWeight: 400, fontSize: 11 }}>{r.category}</span>
                  </div>
                  <div className="dim2" style={{ fontSize: 11 }}>{r.queue} · 升级 {r.escalation}</div>
                </div>
                <span className="mono" style={{ textAlign: "right", fontSize: 12.5, color: "var(--ink-2)" }}>{r.firstResponseMins}m</span>
                <span className="mono" style={{ textAlign: "right", fontSize: 12.5, color: "var(--ink-2)" }}>{r.resolutionHours}h</span>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="编辑 SLA" onClick={() => setEditCat(r.category)}>
                  <Icon name="doc" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <PaginationExemptionList
        items={[
          { label: "Help/FAQ 内容管理", maxRows: 3, reason: "FAQ 为种子内容,新增后进入内容池" },
          { label: "Ticket 分类与 SLA", kind: "reference-catalog", maxRows: 6, reason: "SLA 分类固定,同屏核对升级路径比翻页更适合" },
        ]}
      />

      {showAddFaq && <AddFaqModal onClose={() => setShowAddFaq(false)} onSave={saveFaq} />}
      {editCat && <EditSlaModal category={editCat} row={editRow} onClose={() => setEditCat(null)} onSave={saveSla} />}
    </div>
  );
}

function AddFaqModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (form: { category: SupportFaq["category"]; surface: SupportFaq["surface"]; question: string; answer: string; status: SupportFaq["status"]; reason: string }) => void;
}) {
  const [category, setCategory] = useState<SupportFaq["category"]>("general");
  const [surface, setSurface] = useState<SupportFaq["surface"]>("Help Center");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<SupportFaq["status"]>("published");
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="新增 Help/FAQ 文章"
      icon="doc"
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button type="button" data-proof="support-faq-save" className="btn btn-pri btn-sm" onClick={() => onSave({ category, surface, question, answer, status, reason })}>保存 FAQ</button>
        </>
      }
    >
      <div className="grid g-2" style={{ gap: 12, marginBottom: 12 }}>
        <label className="field"><label>分类</label>
          <select className="fld" value={category} onChange={(e) => setCategory(e.target.value as SupportFaq["category"])}>
            {FAQ_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{catCN(c)}</option>)}
          </select>
        </label>
        <label className="field"><label>可见位置</label>
          <select className="fld" value={surface} onChange={(e) => setSurface(e.target.value as SupportFaq["surface"])}>
            {SURFACES.map((s) => <option key={s} value={s}>{SURFACE_CN[s]}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <label className="field"><label>问题</label><input className="fld" data-proof="support-faq-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="如:提现审核要多久?" /></label>
        <label className="field"><label>回答</label><textarea className="fld" data-proof="support-faq-answer" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="写清用户可执行步骤、后台处理队列与 SLA" style={{ resize: "vertical" }} /></label>
        <div className="grid g-2" style={{ gap: 12 }}>
          <label className="field"><label>发布状态</label>
            <select className="fld" value={status} onChange={(e) => setStatus(e.target.value as SupportFaq["status"])}>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </label>
          <label className="field"><label>审计理由(≥8 字)</label><input className="fld" data-proof="support-faq-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:帮助中心提现板块缺口补齐" /></label>
        </div>
      </div>
    </Modal>
  );
}

function EditSlaModal({
  category,
  row,
  onClose,
  onSave,
}: {
  category: SupportTicketCategory;
  row: SupportSla | null;
  onClose: () => void;
  onSave: (cat: SupportTicketCategory, form: { firstResponseMins: string; resolutionHours: string; queue: string; escalation: string; reason: string }) => void;
}) {
  const [firstResponseMins, setFirst] = useState(String(row?.firstResponseMins ?? 15));
  const [resolutionHours, setResolve] = useState(String(row?.resolutionHours ?? 12));
  const [queue, setQueue] = useState(row?.queue ?? "");
  const [escalation, setEscalation] = useState(row?.escalation ?? "");
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="编辑分类 SLA"
      icon="clock"
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-pri btn-sm" onClick={() => onSave(category, { firstResponseMins, resolutionHours, queue, escalation, reason })}>保存 SLA</button>
        </>
      }
    >
      <div className="field" style={{ marginBottom: 12 }} data-proof="support-sla-category">
        <label>分类</label>
        <div className="chip" style={{ width: "fit-content" }}>{catCN(category)} · {category}</div>
      </div>
      <div className="grid g-2" style={{ gap: 12 }}>
        <label className="field"><label>首响(分钟)</label><input className="fld mono" type="number" value={firstResponseMins} onChange={(e) => setFirst(e.target.value)} /></label>
        <label className="field"><label>解决(小时)</label><input className="fld mono" type="number" value={resolutionHours} onChange={(e) => setResolve(e.target.value)} /></label>
        <label className="field"><label>负责人队列</label><input className="fld" value={queue} onChange={(e) => setQueue(e.target.value)} placeholder="例:Payment desk" /></label>
        <label className="field"><label>升级路径</label><input className="fld" value={escalation} onChange={(e) => setEscalation(e.target.value)} placeholder="例:D2 withdrawal review" /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}><label>审计理由(≥8 字)</label><input className="fld" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:SLA 与 D2/C4 队列口径同步" /></label>
    </Modal>
  );
}
