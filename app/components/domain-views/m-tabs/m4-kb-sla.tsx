"use client";

/**
 * M4 知识库与 SLA — Help/FAQ 内容池 + Ticket 分类×SLA 矩阵(helpdesk 设计稿布局,由 I8 迁出)。
 * FAQ / SLA 读写走后端 content/knowledge 接口;I.support.* 为 M 容器传入的视图适配键。
 * 新建 FAQ、保存 SLA 走弹窗 + 审计理由;均刷新后仍在。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Icon, Modal, PaginationExemptionList } from "../design-kit";
import {
  type SupportFaq,
  type SupportSla,
  type SupportTicketCategory,
} from "./data";
import { catCN } from "./hd-ui";
import type { MCtx } from "./types";

const FAQ_KEY = "I.support.faqs";
const SLA_KEY = "I.support.sla";

const CATEGORY_OPTIONS: SupportTicketCategory[] = ["withdrawal", "deposit", "hardware", "account", "earnings", "genesis", "technical", "other"];
const FAQ_CATEGORY_OPTIONS: SupportFaq["category"][] = ["general", ...CATEGORY_OPTIONS];
const SURFACES: SupportFaq["surface"][] = ["Help Center", "Ticket Create", "Nova"];
const SURFACE_CN: Record<SupportFaq["surface"], string> = { "Help Center": "帮助中心", "Ticket Create": "创建工单页", Nova: "Nova AI" };
const LANGUAGE_OPTIONS: Array<{ value: SupportFaq["language"]; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
  { value: "vi-VN", label: "Tiếng Việt" },
];
const FAQ_PAGE_SIZE = 5;

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function nextFaqId(): string {
  // This ID only lets the diff layer recognize a newly added row. Backend IDs are
  // timestamp-shaped and exceed Number.MAX_SAFE_INTEGER, so never do arithmetic on them.
  return `FAQ-TMP-${crypto.randomUUID()}`;
}
const minReason = (r: string) => r.trim().length >= 8 && r.trim().length <= 200;

export function M4KbSla({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const isSuperAdmin = currentRole === "super" || currentRole === "superadmin";
  const canWriteM4 = isSuperAdmin || Boolean(authorities?.includes("service_m4_write"));
  // Undefined is the initial loading state. Writes stay fail-closed until the
  // strict M4 response validator explicitly publishes a successful "1".
  const knowledgeAvailable = pget("I.support.knowledgeAvailable") === "1";
  const faqs = useMemo(() => parseParamArray<SupportFaq>(pget(FAQ_KEY), []), [ctx.params, pget]);
  const sla = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), []), [ctx.params, pget]);

  const [showAddFaq, setShowAddFaq] = useState(false);
  const [editFaq, setEditFaq] = useState<SupportFaq | null>(null);
  const [editCat, setEditCat] = useState<SupportTicketCategory | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupportFaq["category"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SupportFaq["status"]>("all");
  const [page, setPage] = useState(1);
  const [writePending, setWritePending] = useState(false);
  const writeInFlight = useRef(false);
  const createFaqTempId = useRef<string | null>(null);

  const filteredFaqs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faqs
      .filter((faq) => categoryFilter === "all" || faq.category === categoryFilter)
      .filter((faq) => statusFilter === "all" || faq.status === statusFilter)
      .filter((faq) => !q || [faq.id, faq.question, faq.answer, faq.surface].some((value) => value.toLowerCase().includes(q)))
      .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt));
  }, [categoryFilter, faqs, query, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredFaqs.length / FAQ_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedFaqs = filteredFaqs.slice((currentPage - 1) * FAQ_PAGE_SIZE, currentPage * FAQ_PAGE_SIZE);
  useEffect(() => setPage(1), [query, categoryFilter, statusFilter]);

  const commitM4Write = async (write: () => Promise<boolean>, successMessage: string): Promise<boolean> => {
    if (writeInFlight.current) {
      toast("操作正在提交,请稍候");
      return false;
    }
    if (!canWriteM4 || !knowledgeAvailable) return false;
    writeInFlight.current = true;
    setWritePending(true);
    try {
      const succeeded = await write();
      if (succeeded) toast(successMessage);
      return succeeded;
    } finally {
      writeInFlight.current = false;
      setWritePending(false);
    }
  };

  const saveFaq = async (form: { category: SupportFaq["category"]; surface: SupportFaq["surface"]; language: SupportFaq["language"]; sortOrder: string; question: string; answer: string; status: SupportFaq["status"]; reason: string }) => {
    const sortOrder = Number(form.sortOrder);
    if (!form.question.trim() || !form.answer.trim() || !minReason(form.reason)) {
      toast("FAQ 需要问题 / 回答 / 8 字以上审计理由");
      return false;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999) {
      toast("排序值必须是 0–999999 的整数");
      return false;
    }
    const row: SupportFaq = {
      id: editFaq?.id ?? createFaqTempId.current ?? (createFaqTempId.current = nextFaqId()),
      category: form.category,
      question: form.question.trim(),
      answer: form.answer.trim(),
      status: form.status,
      surface: form.surface,
      language: form.language,
      sortOrder,
      version: editFaq ? editFaq.version + 1 : 1,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    const next = editFaq ? faqs.map((faq) => (faq.id === row.id ? row : faq)) : [row, ...faqs];
    const succeeded = await commitM4Write(
      () => setParam(FAQ_KEY, JSON.stringify(next), {
        action: `${editFaq ? "编辑" : "新建"}支持 FAQ ${row.id} · admin.support_faq_${editFaq ? "updated" : "created"}`,
        reason: form.reason.trim(),
      }),
      `${row.id} 已保存 · ${catCN(row.category)} FAQ`,
    );
    if (succeeded) {
      createFaqTempId.current = null;
      setShowAddFaq(false);
      setEditFaq(null);
    }
    return succeeded;
  };

  const changeFaqStatus = async (id: string, status: SupportFaq["status"]) => {
    await commitM4Write(
      () => setParam(FAQ_KEY, JSON.stringify(faqs.map((faq) => (faq.id === id ? { ...faq, status, version: faq.version + 1, updatedAt: new Date().toISOString().slice(0, 10) } : faq))), {
        action: `${status === "published" ? "发布" : "下架"}支持 FAQ ${id} · admin.support_faq_${status === "published" ? "published" : "unpublished"}`,
        reason: status === "published" ? "FAQ 发布例行审核留档" : "FAQ 下架例行审核留档",
      }),
      status === "published" ? `${id} 已发布` : `${id} 已下架为草稿`,
    );
  };
  const requestDeleteFaq = (faq: SupportFaq) => {
    openActionConfirm({
      action: <>删除 FAQ <span className="mono">{faq.id}</span></>,
      detail: <>删除后将从帮助中心内容池移除“{faq.question}”,且不可在本页恢复。</>,
      reasonMin: 8,
      run: (reason) => commitM4Write(
        () => setParam("I.support.faq.__delete", JSON.stringify({ faqId: faq.id, expectedStatus: faq.status, expectedVersion: faq.version }), { action: `删除支持 FAQ ${faq.id} · admin.support_faq_deleted`, reason }),
        `${faq.id} 已删除`,
      ),
    });
  };

  const saveSla = async (cat: SupportTicketCategory, form: { firstResponseMins: string; resolutionHours: string; queue: string; escalation: string; reason: string }) => {
    const firstResponseMins = Number(form.firstResponseMins);
    const resolutionHours = Number(form.resolutionHours);
    if (!Number.isFinite(firstResponseMins) || !Number.isFinite(resolutionHours) || firstResponseMins <= 0 || resolutionHours <= 0) {
      toast("SLA 数值必须大于 0");
      return false;
    }
    if (!form.queue.trim() || !form.escalation.trim() || !minReason(form.reason)) {
      toast("SLA 需要队列 / 升级路径 / 8 字以上审计理由");
      return false;
    }
    if (!editRow) {
      toast("SLA 权威版本不可用,请刷新后重试");
      return false;
    }
    const row: SupportSla = { category: cat, firstResponseMins, resolutionHours, queue: form.queue.trim(), escalation: form.escalation.trim(), version: editRow.version + 1 };
    const succeeded = await commitM4Write(
      () => setParam(SLA_KEY, JSON.stringify([row, ...sla.filter((x) => x.category !== cat)]), { action: `更新支持 SLA ${cat} · admin.support_sla_changed`, reason: form.reason.trim() }),
      `${catCN(cat)} SLA 已更新`,
    );
    if (succeeded) setEditCat(null);
    return succeeded;
  };

  const editRow = editCat ? sla.find((r) => r.category === editCat) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="dim" style={{ margin: 0, fontSize: 13 }}>维护帮助中心问答,设定每类工单多久要首次响应、多久要解决。</p>

      {!knowledgeAvailable && <div className="callout warn">知识库后端当前不可用,页面已停止写入,避免显示未落库的成功状态。</div>}
      {knowledgeAvailable && !canWriteM4 && <div className="callout">当前账号只有查看权限;编辑 FAQ、发布状态与 SLA 需要 service_m4_write 权限。</div>}

      <div className="m4-cols">
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center" }}>
            <div className="sec-h" style={{ margin: 0 }}>
              <span className="t">Help/FAQ 内容管理</span>
              <span className="n">{faqs.length} 篇</span>
            </div>
            {canWriteM4 && knowledgeAvailable && <button type="button" className="btn btn-pri btn-sm" style={{ marginLeft: "auto" }} disabled={writePending} onClick={() => { createFaqTempId.current = nextFaqId(); setEditFaq(null); setShowAddFaq(true); }}>
              <Icon name="plus" size={16} />
              新增文章
            </button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 130px 110px", gap: 8, padding: "0 12px 10px" }}>
            <input className="fld" aria-label="搜索 FAQ" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索编号、问题或回答" />
            <select className="fld" aria-label="FAQ 分类筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              <option value="all">全部分类</option>
              {FAQ_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{catCN(category)}</option>)}
            </select>
            <select className="fld" aria-label="FAQ 状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">全部状态</option>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </div>
          <div style={{ padding: "0 8px 10px" }}>
            {pagedFaqs.map((f) => (
              <div key={f.id} data-proof="support-faq-row" data-faq-id={f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{f.question}</div>
                  <div className="dim" style={{ fontSize: 12, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.answer}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                    <span className="idtag" style={{ fontSize: 11 }}>{f.id}</span>
                    <span className="chip" style={{ height: 18, fontSize: 11, border: "none" }}>{catCN(f.category)}</span>
                    <span className="dim2" style={{ fontSize: 11 }}>{SURFACE_CN[f.surface]} · {f.language} · 排序 {f.sortOrder} · v{f.version} · <span className="mono">{f.updatedAt}</span></span>
                  </div>
                </div>
                <span className={`stat ${f.status === "published" ? "resolved" : "wait"}`} style={{ height: 20 }}>{f.status === "published" ? "已发布" : "草稿"}</span>
                {canWriteM4 && knowledgeAvailable && <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={writePending} title="编辑 FAQ" onClick={() => { createFaqTempId.current = null; setShowAddFaq(false); setEditFaq(f); }}><Icon name="doc" size={16} /></button>}
                {canWriteM4 && knowledgeAvailable && (f.status === "draft" ? (
                  <button type="button" data-proof="support-faq-publish" className="btn btn-sec btn-sm" disabled={writePending} onClick={() => changeFaqStatus(f.id, "published")}>
                    <Icon name="download" size={16} />
                    发布
                  </button>
                ) : (
                  <button type="button" data-proof="support-faq-unpublish" className="btn btn-sec btn-sm" disabled={writePending} onClick={() => changeFaqStatus(f.id, "draft")}>
                    <Icon name="box" size={16} />
                    下架
                  </button>
                ))}
                {canWriteM4 && knowledgeAvailable && <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={writePending} title="删除 FAQ" onClick={() => requestDeleteFaq(f)}><Icon name="x" size={16} /></button>}
              </div>
            ))}
            {pagedFaqs.length === 0 && <div className="empty" style={{ margin: 12 }}>没有符合当前筛选条件的 FAQ</div>}
            {filteredFaqs.length > 0 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 0", borderTop: "1px solid var(--border)" }}>
              <span className="dim2" style={{ fontSize: 11 }}>第 {currentPage}/{pageCount} 页 · 共 {filteredFaqs.length} 篇</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-sec btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
                <button type="button" className="btn btn-sec btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
              </div>
            </div>}
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
              <div key={r.category} data-proof="support-sla-row" data-sla-category={r.category} style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 30px", gap: 8, alignItems: "center", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                    {catCN(r.category)} <span className="dim2 mono" style={{ fontWeight: 400, fontSize: 11 }}>{r.category}</span>
                  </div>
                  <div className="dim2" style={{ fontSize: 11 }}>{r.queue} · 升级 {r.escalation}</div>
                </div>
                <span className="mono" style={{ textAlign: "right", fontSize: 12.5, color: "var(--ink-2)" }}>{r.firstResponseMins}m</span>
                <span className="mono" style={{ textAlign: "right", fontSize: 12.5, color: "var(--ink-2)" }}>{r.resolutionHours}h</span>
                {canWriteM4 && knowledgeAvailable ? <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={writePending} title="编辑 SLA" onClick={() => setEditCat(r.category)}>
                  <Icon name="doc" size={16} />
                </button> : <span />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <PaginationExemptionList
        items={[
          { label: "Ticket 分类与 SLA", kind: "reference-catalog", maxRows: 9, reason: "SLA 分类固定,同屏核对升级路径比翻页更适合" },
        ]}
      />

      {(showAddFaq || editFaq) && <FaqModal key={editFaq?.id ?? "new"} row={editFaq} pending={writePending} onClose={() => { createFaqTempId.current = null; setShowAddFaq(false); setEditFaq(null); }} onSave={saveFaq} />}
      {editCat && <EditSlaModal category={editCat} row={editRow} pending={writePending} onClose={() => setEditCat(null)} onSave={saveSla} />}
    </div>
  );
}

function FaqModal({
  row,
  pending,
  onClose,
  onSave,
}: {
  row: SupportFaq | null;
  pending: boolean;
  onClose: () => void;
  onSave: (form: { category: SupportFaq["category"]; surface: SupportFaq["surface"]; language: SupportFaq["language"]; sortOrder: string; question: string; answer: string; status: SupportFaq["status"]; reason: string }) => Promise<boolean>;
}) {
  const [category, setCategory] = useState<SupportFaq["category"]>(row?.category ?? "general");
  const [surface, setSurface] = useState<SupportFaq["surface"]>(row?.surface ?? "Help Center");
  const [language, setLanguage] = useState<SupportFaq["language"]>(row?.language ?? "zh-CN");
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 10));
  const [question, setQuestion] = useState(row?.question ?? "");
  const [answer, setAnswer] = useState(row?.answer ?? "");
  const [status, setStatus] = useState<SupportFaq["status"]>(row?.status ?? "published");
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={row ? `编辑 Help/FAQ · ${row.id}` : "新增 Help/FAQ 文章"}
      icon="doc"
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" disabled={pending} onClick={onClose}>取消</button>
          <button type="button" data-proof="support-faq-save" className="btn btn-pri btn-sm" disabled={pending} onClick={() => onSave({ category, surface, language, sortOrder, question, answer, status, reason })}>{pending ? "提交中…" : "保存 FAQ"}</button>
        </>
      }
    >
      <div className="grid g-2" style={{ gap: 12, marginBottom: 12 }}>
        <label className="field"><span className="bf-legend">分类</span>
          <select className="fld" value={category} onChange={(e) => setCategory(e.target.value as SupportFaq["category"])}>
            {FAQ_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{catCN(c)}</option>)}
          </select>
        </label>
        <label className="field"><span className="bf-legend">可见位置</span>
          <select className="fld" value={surface} onChange={(e) => setSurface(e.target.value as SupportFaq["surface"])}>
            {SURFACES.map((s) => <option key={s} value={s}>{SURFACE_CN[s]}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <label className="field"><span className="bf-legend">问题</span><input className="fld" data-proof="support-faq-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="如:提现审核要多久?" /></label>
        <label className="field"><span className="bf-legend">回答</span><textarea className="fld" data-proof="support-faq-answer" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="写清用户可执行步骤、后台处理队列与 SLA" style={{ resize: "vertical" }} /></label>
        <div className="grid g-2" style={{ gap: 12 }}>
          <label className="field"><span className="bf-legend">语言</span>
            <select className="fld" value={language} onChange={(e) => setLanguage(e.target.value as SupportFaq["language"])}>
              {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field"><span className="bf-legend">排序(小值靠前)</span><input className="fld mono" type="number" min={0} max={999999} step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
        </div>
        <div className="grid g-2" style={{ gap: 12 }}>
          <label className="field"><span className="bf-legend">发布状态</span>
            <select className="fld" value={status} onChange={(e) => setStatus(e.target.value as SupportFaq["status"])}>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </label>
          <label className="field"><span className="bf-legend">审计理由(≥8 字)</span><input className="fld" data-proof="support-faq-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:帮助中心提现板块缺口补齐" /></label>
        </div>
      </div>
    </Modal>
  );
}

function EditSlaModal({
  category,
  row,
  pending,
  onClose,
  onSave,
}: {
  category: SupportTicketCategory;
  row: SupportSla | null;
  pending: boolean;
  onClose: () => void;
  onSave: (cat: SupportTicketCategory, form: { firstResponseMins: string; resolutionHours: string; queue: string; escalation: string; reason: string }) => Promise<boolean>;
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
          <button type="button" className="btn btn-sec btn-sm" disabled={pending} onClick={onClose}>取消</button>
          <button type="button" className="btn btn-pri btn-sm" disabled={pending} onClick={() => onSave(category, { firstResponseMins, resolutionHours, queue, escalation, reason })}>{pending ? "提交中…" : "保存 SLA"}</button>
        </>
      }
    >
      <div className="field" style={{ marginBottom: 12 }} data-proof="support-sla-category">
        <span className="bf-legend">分类</span>
        <div className="chip" style={{ width: "fit-content", border: "none" }}>{catCN(category)} · {category}</div>
      </div>
      <div className="grid g-2" style={{ gap: 12 }}>
        <label className="field"><span className="bf-legend">首响(分钟)</span><input className="fld mono" type="number" value={firstResponseMins} onChange={(e) => setFirst(e.target.value)} /></label>
        <label className="field"><span className="bf-legend">解决(小时)</span><input className="fld mono" type="number" value={resolutionHours} onChange={(e) => setResolve(e.target.value)} /></label>
        <label className="field"><span className="bf-legend">负责人队列</span><input className="fld" value={queue} onChange={(e) => setQueue(e.target.value)} placeholder="例:Payment desk" /></label>
        <label className="field"><span className="bf-legend">升级路径</span><input className="fld" value={escalation} onChange={(e) => setEscalation(e.target.value)} placeholder="例:D2 withdrawal review" /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}><span className="bf-legend">审计理由(≥8 字)</span><input className="fld" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:SLA 与 D2/C5 队列口径同步" /></label>
    </Modal>
  );
}
