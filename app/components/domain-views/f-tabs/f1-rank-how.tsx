"use client";

/**
 * F1 的「App 等级说明」：左边编辑、右边看 App 上的样子；草稿和已发布分开写。
 * 读、写、校验和共用的 PublishedContentEditor（kind="rankHow"）一样：GET/PUT /api/admin/teams/rank-policy，
 * 正文、状态、语言、理由的规则和提交内容逐字不变。共用编辑器别的页面还在用，这里只换 F1 的样子。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, CircleHelp, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { BlockState, Button, Field, Fold, Input, Notice, Panel, Segments, StatusTag, Textarea } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchRankHowPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";
import { pendingF1RankHow, queryF1RankHow, saveF1RankHow } from "@/lib/admin/f1-rank-how-save";
import type { F1VRankRow } from "@/lib/admin/f1-client";

type Row = Record<string, unknown>;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
const LOCALE_NAMES: Record<string, string> = { zh: "中文", "zh-cn": "简体中文", en: "英语", vi: "越南语" };
/** 和共用编辑器同一个测试钩子：data-testid="published-content-rankHow"。 */
const KIND = "rankHow";
const CONFLICT = "版本已变化，草稿已保留，请核对后再保存。";

/** 版本冲突后：运营的草稿和刚读到的最新内容逐项比，只写哪里不同，不贴原文。 */
function draftDiff(draft: PublishedContentDocument, latest: PublishedContentDocument) {
  const rows: { key: string; label: string; text: string }[] = [];
  if (draft.version.trim() !== latest.version.trim()) rows.push({ key: "version", label: "版本号", text: `草稿 ${draft.version || "—"}，最新 ${latest.version || "—"}` });
  const statusName = (value: string) => value === "PUBLISHED" ? "发布" : "草稿";
  if (draft.status !== latest.status) rows.push({ key: "status", label: "保存为", text: `草稿选的是${statusName(draft.status)}，最新是${statusName(latest.status)}` });
  for (const code of [...new Set([...Object.keys(draft.locales), ...Object.keys(latest.locales)])]) {
    const label = LOCALE_NAMES[code] ?? code;
    const mine = draft.locales[code], theirs = latest.locales[code];
    if (!theirs) { rows.push({ key: code, label, text: "最新内容没有这种语言，草稿有" }); continue; }
    if (!mine) { rows.push({ key: code, label, text: "最新内容有这种语言，草稿删掉了" }); continue; }
    const a = row(mine), b = row(theirs);
    const parts: string[] = [];
    if (text(a.hero) !== text(b.hero)) parts.push("主说明");
    const sa = list(a.sections).map(row), sb = list(b.sections).map(row);
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      const what = [text(sa[i].title) !== text(sb[i].title) ? "标题" : "", text(sa[i].body) !== text(sb[i].body) ? "正文" : "",
        Number(sa[i].order) !== Number(sb[i].order) || text(sa[i].id) !== text(sb[i].id) ? "顺序或 ID" : ""].filter(Boolean).join("、");
      if (what) parts.push(`第 ${i + 1} 段${what}`);
    }
    if (sa.length !== sb.length) parts.push(`段落数 草稿 ${sa.length}、最新 ${sb.length}`);
    if (parts.length) rows.push({ key: code, label, text: `${parts.join("；")}不同` });
  }
  return rows;
}

export function F1RankHow({ ladder, onPendingChange }: { ladder: F1VRankRow[]; onPendingChange: () => void }) {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("network_f1_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("network_f1_write") === true;
  const [document, setDocument] = useState<PublishedContentDocument | null>(null);
  const [baseline, setBaseline] = useState<PublishedContentDocument | null>(null);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(() => session ? !!pendingF1RankHow(session.adminId) : false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const baselineStale = useRef(false);
  const preserveDraft = useRef(false);
  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true); setError(null);
    const original = session ? pendingF1RankHow(session.adminId) : undefined;
    if (original) {
      setDocument(original.document); setBaseline(original.document); setReason(original.reason);
      setLocale(Object.keys(original.document.locales)[0] ?? "en"); setUnknown(true);
      setLoading(false);
      return;
    }
    setUnknown(false);
    try {
      const value = await fetchRankHowPolicyAdmin();
      if (preserveDraft.current) {
        setDocument(draft => draft ? { ...value, version: draft.version, status: draft.status, locales: draft.locales } : value);
        setBaseline(value); baselineStale.current = false;
        setError(CONFLICT);
      } else {
        setDocument(value); setBaseline(value); setLocale(Object.keys(value.locales)[0] ?? "en"); setReason("");
      }
    } catch (cause) {
      if (!preserveDraft.current) { setDocument(null); setBaseline(null); }
      setError(displayAdminError(cause));
    }
    finally { setLoading(false); }
  }, [canRead, session?.adminId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const hasChanges = useMemo(() => JSON.stringify(document) !== JSON.stringify(baseline), [document, baseline]);
  if (!canRead) return <Panel title="App 等级说明"><BlockState state="denied" title="这个账号不能查看等级说明" /></Panel>;

  const checkOriginal = async () => {
    if (!session || loading) return;
    setLoading(true); setError(null);
    try {
      const result = await queryF1RankHow(session.adminId);
      if (result.matched) {
        preserveDraft.current = false; baselineStale.current = false;
        setDocument(result.current); setBaseline(result.current); setReason(""); setUnknown(false);
      } else setError("当前读取与原提交内容或修订号不一致，保存结果仍未知，请保留原内容并到操作记录核对。");
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); onPendingChange(); }
  };
  const locked = saving || unknown || loading;
  const updateLocale = (value: Row) => document && setDocument({ ...document, locales: { ...document.locales, [locale]: value } });
  const addLocale = () => {
    if (!document) return;
    const normalized = newLocale.trim().toLowerCase().replace("_", "-");
    if (!/^(?:[a-z]{2}|fil)(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setError("语言 格式无效，例如 en、zh、vi 或 zh-cn。"); return; }
    if (!document.locales[normalized] && Object.keys(document.locales).length >= 10) { setError("最多维护 10 种语言。"); return; }
    const empty = { hero: "", sections: [{ id: "section-1", title: "", body: "", order: 0 }] };
    setDocument({ ...document, locales: { ...document.locales, [normalized]: document.locales[normalized] ?? empty } });
    setLocale(normalized); setNewLocale(""); setError(null);
  };
  const removeLocale = () => {
    if (!document || Object.keys(document.locales).length <= 1) { setError("至少保留一种语言。"); return; }
    const next = { ...document.locales }; delete next[locale]; const nextLocale = Object.keys(next)[0];
    setDocument({ ...document, locales: next }); setLocale(nextLocale);
  };
  const save = async () => {
    if (!document || !canWrite || !session || locked) return;
    if (baselineStale.current) { await refresh(); return; }
    if (reason.trim().length < 8 || reason.trim().length > 500) { setError("变更理由需为 8–500 个字符。"); return; }
    if (!hasChanges) { setError("内容没有变化，无需提交。"); return; }
    setSaving(true); setError(null); setUnknown(false);
    try {
      const payload = { ...document, status: document.status === "UNPUBLISHED" ? "DRAFT" as const : document.status };
      const value = await saveF1RankHow(session.adminId, payload, reason.trim());
      preserveDraft.current = false;
      setDocument(value); setBaseline(value); setReason("");
    } catch (cause) {
      setError(displayAdminError(cause)); setUnknown(cause instanceof OutcomeUnknownError);
      if (!(cause instanceof OutcomeUnknownError) && (cause as { reasonCode?: string }).reasonCode === "RANK_HOW_POLICY_VERSION_CONFLICT") {
        baselineStale.current = true;
        preserveDraft.current = true;
        await refresh();
      }
    }
    finally { setSaving(false); onPendingChange(); }
  };

  const status = document?.status === "UNPUBLISHED" ? "DRAFT" : document?.status;
  const baseStatus = baseline?.status === "UNPUBLISHED" ? "DRAFT" : baseline?.status;
  const current = row(document?.locales[locale]);
  const sections = list(current.sections).map(row);
  const setSection = (index: number, key: string, next: unknown) => updateLocale({ ...current, sections: sections.map((item, i) => i === index ? { ...item, [key]: next } : item) });
  const addSection = () => {
    const ids = new Set(sections.map((section) => text(section.id).trim()));
    let suffix = sections.length + 1;
    while (ids.has(`section-${suffix}`)) suffix++;
    updateLocale({ ...current, sections: [...sections, { id: `section-${suffix}`, title: "", body: "", order: sections.length }] });
  };
  const preview = [...sections].map((item, index) => ({ item, index })).sort((a, b) => (Number(a.item.order) || 0) - (Number(b.item.order) || 0));
  const reasonLength = reason.trim().length;

  const statusLine = document && <span className="f1-how-status">
    {baseStatus === "PUBLISHED" ? <StatusTag tone="ok">已发布</StatusTag> : <StatusTag tone="neutral">草稿</StatusTag>}
    <span>版本号 {document.version || "—"}</span>
    <span>修订号 {document.revision}</span>
    {document.revision === 0 && <StatusTag tone="warn" icon={CircleHelp} explain="后台还没保存过，或者读取时后端用了内置的默认说明。这不代表运营已经保存或发布过。">内置默认内容</StatusTag>}
  </span>;

  return (
    <Panel data-testid={`published-content-${KIND}`} title="App 等级说明" icon={BookOpenText} tone="role-4"
      sub={document ? (document.hasPublishedVersion ? "App 读的是最近一次发布的版本" : "还没发布过，App 读的是内置默认说明") : undefined}
      explain="App「等级怎么升」页面的说明文字，按语言分开写。保存草稿不替换 App 正在读的版本；保存并发布后，App 下一次读取成功就换成新内容，缺用户的语言或缺固定段落时可能显示不全。保存直接生效，不走审批。"
      actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void (unknown ? checkOriginal() : refresh())}>重新读取</Button>}>
      {unknown && <Notice tone="warn" title="保存结果未知" actionBelow
        action={<Button size="sm" loading={loading} onClick={() => void checkOriginal()}>重新读取核对</Button>}>
        <p>提交时没收到确定结果，可能已经保存。这项保存后端不认重复提交，不能按原内容再提交一次；先读回核对，你填的内容还在下面。</p>
      </Notice>}
      {preserveDraft.current && document && baseline && (() => {
        const diff = draftDiff(document, baseline);
        return <Notice tone="warn" title="版本已变化，草稿已保留">
          <p>{diff.length ? `有人先保存了修订号 ${baseline.revision}。下面是你的草稿和最新内容不同的地方；保存会用草稿替换最新内容。` : `有人先保存了修订号 ${baseline.revision}，内容和你的草稿相同。`}</p>
          {diff.length > 0 && <dl className="f1-how-diff">{diff.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.text}</dd></div>)}</dl>}
        </Notice>;
      })()}
      {error && !(preserveDraft.current && error === CONFLICT) && <Notice tone={document ? "warn" : "danger"}>{error}</Notice>}
      {loading && !document ? <BlockState state="loading" title="正在读取等级说明" />
        : !document ? <BlockState state="error" title="等级说明读取失败，现在的状态没确认" detail={error ?? undefined} onRetry={() => void refresh()} />
          : <>
            <div className="f1-how-head">{statusLine}</div>
            <div className="rd-split f1-how" data-detail="" data-preview="">
              <div className="f1-how-edit">
                <div className="f1-how-locales">
                  <Segments label="内容语言" value={locale} items={Object.keys(document.locales).map((key) => ({ value: key, label: LOCALE_NAMES[key] ?? key }))} onChange={setLocale} />
                  {canWrite && <span className="f1-how-locale-tools">
                    <Input aria-label="新增语言" placeholder="例如 vi、zh-cn" value={newLocale} maxLength={11} size={12} disabled={locked} onChange={(event) => setNewLocale(event.target.value)} />
                    <Button size="sm" icon={<Plus size={14} aria-hidden />} disabled={locked} onClick={addLocale}>新增语言</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} disabled={locked} onClick={removeLocale}>删除这种语言</Button>
                  </span>}
                </div>
                <div className="rd-form-grid" data-cols="2" data-dense="">
                  <Field label="版本号" hint="最多 64 字"><Input maxLength={64} value={document.version} disabled={!canWrite || locked} onChange={(event) => setDocument({ ...document, version: event.target.value })} /></Field>
                </div>
                <Field label="页面主说明" hint="最多 500 字">
                  <Textarea rows={3} maxLength={500} value={text(current.hero)} disabled={!canWrite || locked} onChange={(event) => updateLocale({ ...current, hero: event.target.value })} />
                </Field>
                <div className="f1-how-sections" aria-label="规则段落">
                  <h3 className="f1-subhead">规则段落 <span className="f1-weak">{sections.length} 段，点开编辑</span></h3>
                  {sections.map((item, index) => (
                    <Fold key={index} inset title={<span className="f1-how-section-title">{text(item.title) || <span className="f1-weak">没有标题</span>}</span>}
                      summary={`顺序 ${Number.isSafeInteger(item.order) ? item.order : 0} · ${text(item.id) || "没有 ID"}`}>
                      <div className="f1-how-section">
                        <div className="rd-form-grid" data-cols="2" data-dense="">
                          <Field label="段落 ID" hint="最多 64 字"><Input maxLength={64} value={text(item.id)} disabled={!canWrite || locked} onChange={(event) => setSection(index, "id", event.target.value)} /></Field>
                          <Field label="顺序" hint="数字小的在前"><Input type="number" min={0} step={1} value={Number.isSafeInteger(item.order) ? String(item.order) : "0"} disabled={!canWrite || locked} onChange={(event) => setSection(index, "order", Number(event.target.value))} /></Field>
                        </div>
                        <Field label="标题" hint="最多 256 字"><Input maxLength={256} value={text(item.title)} disabled={!canWrite || locked} onChange={(event) => setSection(index, "title", event.target.value)} /></Field>
                        <Field label="正文" hint="最多 10000 字"><Textarea rows={4} maxLength={10000} value={text(item.body)} disabled={!canWrite || locked} onChange={(event) => setSection(index, "body", event.target.value)} /></Field>
                        {canWrite && <div className="f1-how-section-tools"><Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} disabled={locked} onClick={() => updateLocale({ ...current, sections: sections.filter((_, i) => i !== index) })}>删除段落</Button></div>}
                      </div>
                    </Fold>
                  ))}
                  {sections.length === 0 && <p className="f1-empty">这种语言还没有段落；至少要有一段才能保存。</p>}
                  {canWrite && sections.length < 100 && <div><Button size="sm" icon={<Plus size={14} aria-hidden />} disabled={locked} onClick={addSection}>新增段落</Button></div>}
                </div>
                <Fold inset title="变更预览（只读）" summary={`${LOCALE_NAMES[locale] ?? locale} 的原始内容`}>
                  <pre className="f1-json">{JSON.stringify(document.locales[locale], null, 2)}</pre>
                </Fold>
              </div>
              <aside className="f1-how-phone" aria-label="App 上的样子">
                <div className="f1-how-phone-head"><Smartphone size={14} aria-hidden />App 上的样子（示意） · {LOCALE_NAMES[locale] ?? locale}
                  <StatusTag tone={status === "PUBLISHED" ? "ok" : "neutral"}>{status === "PUBLISHED" ? "保存后发布" : "草稿，App 看不到"}</StatusTag></div>
                <div className="f1-how-phone-body">
                  {text(current.hero) ? <p className="f1-how-hero">{text(current.hero)}</p> : <p className="f1-weak">主说明还没写</p>}
                  {preview.map(({ item, index }) => (
                    <section key={index} className="f1-how-card">
                      <h4>{text(item.title) || <span className="f1-weak">没有标题</span>}</h4>
                      <p>{text(item.body) || <span className="f1-weak">没有正文</span>}</p>
                    </section>
                  ))}
                  <p className="f1-how-note">示意，实际排版以 App 为准：App 按「顺序」从小到大排，正文里的规则占位换成实时的等级数据（共 {ladder.length} 级）。</p>
                </div>
              </aside>
            </div>
            {canWrite && <div className="f1-how-save">
              <div className="rd-form-grid" data-cols="2" data-dense="">
                <Field label="保存为">
                  <Segments label="保存为" value={status ?? "DRAFT"} items={[{ value: "DRAFT", label: "草稿", disabled: locked }, { value: "PUBLISHED", label: "发布", disabled: locked }]}
                    onChange={(value) => setDocument({ ...document, status: value as PublishedContentDocument["status"] })} />
                </Field>
                <Field label="变更理由" required hint="8–500 字">
                  <Textarea rows={2} maxLength={500} value={reason} disabled={locked} count={`${reasonLength}/500`} onChange={(event) => setReason(event.target.value)} />
                </Field>
              </div>
              <div className="rd-toolbar" data-end="">
                <span className="rd-toolbar-note">{status === "PUBLISHED" ? "发布后替换 App 正在读的版本" : "草稿不替换 App 正在读的版本"}</span>
                <Button variant="primary" loading={saving} disabledReason={unknown ? "保存结果未知，请先重新读取核对" : loading ? "正在读取" : !hasChanges ? "内容没有变化" : undefined} onClick={() => void save()}>{status === "PUBLISHED" ? "保存并发布" : "保存草稿"}</Button>
              </div>
            </div>}
          </>}
    </Panel>
  );
}
