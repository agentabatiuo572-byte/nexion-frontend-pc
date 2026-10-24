"use client";

/** M4 help center content. Retired ticket configuration remains stored on the server. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Icon, Modal } from "../design-kit";
import {
  type SupportFaq,
  type SupportTicketCategory,
} from "./data";
import { catCN } from "./hd-ui";
import type { MCtx } from "./types";

const FAQ_KEY = "I.support.faqs";

const CATEGORY_OPTIONS: SupportTicketCategory[] = ["withdrawal", "deposit", "hardware", "account", "earnings", "genesis", "technical", "other"];
const FAQ_CATEGORY_OPTIONS: SupportFaq["category"][] = ["general", ...CATEGORY_OPTIONS];
const SURFACES: SupportFaq["surface"][] = ["Help Center", "Nova"];
const SURFACE_CN: Record<SupportFaq["surface"], string> = { "Help Center": "帮助中心", "Ticket Create": "创建工单页", Nova: "Nova AI" };
const LANGUAGE_OPTIONS: Array<{ value: SupportFaq["language"]; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "英语" },
  { value: "vi-VN", label: "越南语" },
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

  const [showAddFaq, setShowAddFaq] = useState(false);
  const [editFaq, setEditFaq] = useState<SupportFaq | null>(null);
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
      .filter(faq => faq.surface !== "Ticket Create")
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
      toast("常见问答 需要问题 / 回答 / 8 字以上审计理由");
      return false;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999) {
      toast("排序值必须是 0–999999 的整数");
      return false;
    }
    if (editFaq) {
      const currentFaq = faqs.find((faq) => faq.id === editFaq.id);
      if (!currentFaq || currentFaq.version !== editFaq.version || currentFaq.status !== editFaq.status) {
        toast("常见问答 已更新或不可用，请保留当前输入，重新核对最新内容后再编辑。");
        return false;
      }
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
        action: `${editFaq ? "编辑" : "新建"}支持 常见问答 ${row.id} · admin.support_faq_${editFaq ? "updated" : "created"}`,
        reason: form.reason.trim(),
      }),
      `${row.id} 已保存 · ${catCN(row.category)}常见问答`,
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
        action: `${status === "published" ? "发布" : "下架"}支持 常见问答 ${id} · admin.support_faq_${status === "published" ? "published" : "unpublished"}`,
        reason: status === "published" ? "常见问答 发布例行审核留档" : "常见问答 下架例行审核留档",
      }),
      status === "published" ? `${id} 已发布` : `${id} 已下架为草稿`,
    );
  };
  const requestDeleteFaq = (faq: SupportFaq) => {
    openActionConfirm({
      action: <>删除常见问答 <span className="mono">{faq.id}</span></>,
      detail: <>删除后将从帮助中心内容池移除“{faq.question}”,且不可在本页恢复。</>,
      reasonMin: 8,
      run: (reason) => commitM4Write(
        () => setParam("I.support.faq.__delete", JSON.stringify({ faqId: faq.id, expectedStatus: faq.status, expectedVersion: faq.version }), { action: `删除支持 常见问答 ${faq.id} · admin.support_faq_deleted`, reason }),
        `${faq.id} 已删除`,
      ),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="dim" style={{ margin: 0, fontSize: 13 }}>维护帮助中心的常见问题与解答。</p>

      {!knowledgeAvailable && <div className="callout warn" data-module-health-state="error">知识库当前不可用，暂时无法修改。请稍后刷新重试。</div>}
      {knowledgeAvailable && !canWriteM4 && <div className="callout">当前账号只有查看权限;编辑常见问答与发布状态需要知识库编辑权限。</div>}

      <div>
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 10, display: "flex", alignItems: "center" }}>
            <div className="sec-h" style={{ margin: 0 }}>
              <span className="t">帮助内容管理</span>
              <span className="n">{knowledgeAvailable ? faqs.filter(f => f.surface !== "Ticket Create").length : "-"} 篇</span>
            </div>
            {canWriteM4 && knowledgeAvailable && <button type="button" className="btn btn-pri btn-sm" style={{ marginLeft: "auto" }} disabled={writePending} onClick={() => { createFaqTempId.current = nextFaqId(); setEditFaq(null); setShowAddFaq(true); }}>
              <Icon name="plus" size={16} />
              新增文章
            </button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 130px 110px", gap: 8, padding: "0 12px 10px" }}>
            <input className="fld" aria-label="搜索常见问答" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索编号、问题或回答" />
            <select className="fld" aria-label="常见问答 分类筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              <option value="all">全部分类</option>
              {FAQ_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{catCN(category)}</option>)}
            </select>
            <select className="fld" aria-label="常见问答 状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
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
                {canWriteM4 && knowledgeAvailable && <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={writePending} title="编辑 常见问答" onClick={() => { createFaqTempId.current = null; setShowAddFaq(false); setEditFaq(f); }}><Icon name="doc" size={16} /></button>}
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
                {canWriteM4 && knowledgeAvailable && <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={writePending} title="删除常见问答" onClick={() => requestDeleteFaq(f)}><Icon name="x" size={16} /></button>}
              </div>
            ))}
            {pagedFaqs.length === 0 && <div className="empty" style={{ margin: 12 }}>没有符合当前筛选条件的 常见问答</div>}
            {filteredFaqs.length > 0 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 0", borderTop: "1px solid var(--border)" }}>
              <span className="dim2" style={{ fontSize: 11 }}>第 {currentPage}/{pageCount} 页 · 共 {filteredFaqs.length} 篇</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-sec btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
                <button type="button" className="btn btn-sec btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
              </div>
            </div>}
          </div>
        </div>

      </div>

      {(showAddFaq || editFaq) && <FaqModal key={editFaq?.id ?? "new"} row={editFaq} pending={writePending} onClose={() => { createFaqTempId.current = null; setShowAddFaq(false); setEditFaq(null); }} onSave={saveFaq} />}
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
      title={row ? `编辑帮助内容 · ${row.id}` : "新增帮助内容"}
      icon="doc"
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" disabled={pending} onClick={onClose}>取消</button>
          <button type="button" data-proof="support-faq-save" className="btn btn-pri btn-sm" disabled={pending} onClick={() => onSave({ category, surface, language, sortOrder, question, answer, status, reason })}>{pending ? "提交中…" : "保存 常见问答"}</button>
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
        <label className="field"><span className="bf-legend">回答</span><textarea className="fld" data-proof="support-faq-answer" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="写清用户可执行步骤、后台处理队列与 处理时限" style={{ resize: "vertical" }} /></label>
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
