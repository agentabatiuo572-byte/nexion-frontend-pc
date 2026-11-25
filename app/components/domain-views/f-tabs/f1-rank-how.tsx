"use client";

/**
 * F1 的「App 等级说明」：左边编辑、右边看 App 上的样子；草稿和已发布分开写。
 * 读、写、校验和共用的 PublishedContentEditor（kind="rankHow"）一样：GET/PUT /api/admin/teams/rank-policy，
 * F1 发布前额外检查旧规则变量，草稿仍可保存。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, CircleHelp, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { BlockState, Button, Explain, Field, Fold, Input, Notice, Panel, Segments, Select, StatusTag, Textarea } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import { OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchRankHowPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";
import { pendingF1RankHow, queryF1RankHow, saveF1RankHow, type F1RankHowComparison } from "@/lib/admin/f1-rank-how-save";
import type { F1VRankRow } from "@/lib/admin/f1-client";

type Row = Record<string, unknown>;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
const LOCALE_NAMES: Record<string, string> = { zh: "中文", "zh-cn": "简体中文", en: "英语", vi: "越南语", id: "印尼语", ms: "马来语", fil: "菲律宾语", ru: "俄语", kk: "哈萨克语", uz: "乌兹别克语" };
/** 和共用编辑器同一个测试钩子：data-testid="published-content-rankHow"。 */
const KIND = "rankHow";
const CONFLICT = "版本已变化，草稿已保留，请核对后再保存。";

/** 发布内容只收中文、英语、越南语（A3「发布必填」的三个语言位）；其余语言只用于显示已有内容的名字。 */
const PUBLISH_LOCALES = ["zh", "en", "vi"];
const LEGACY_REFERRAL_SLOT = "referralThreshold";
/** 正文里的规则占位：预览里画成灰底小块、写中文名，App 上按实时等级数据替换；没登记的占位显示原名。 */
const SLOT_NAMES: Record<string, string> = {
  firstRank: "最低等级", lastRank: "最高等级", rankCount: "等级数", fromRank: "当前等级", toRank: "下一等级",
  [LEGACY_REFERRAL_SLOT]: "好友自购要求（旧变量）", selfComputePoints: "自购算力点要求", teamComputePoints: "团队算力点要求", directRefs: "达标好友要求",
  peerRate: "同级奖励比例", votes: "票数", leadershipStatus: "激励池状态", cultivation: "好友升级奖励合计", protection: "等级保护状态",
};
function slots(value: string) {
  return value.split(/(\{[A-Za-z]+\})/).map((part, index) => {
    const key = /^\{([A-Za-z]+)\}$/.exec(part)?.[1];
    return key ? <span key={index} className="f1-how-slot" title={key === LEGACY_REFERRAL_SLOT ? "旧变量，发布前请移除" : `App 上换成实时数据：${SLOT_NAMES[key] ?? key}`}>{SLOT_NAMES[key] ?? key}</span> : part;
  });
}

function rankHowPublishIssue(document: PublishedContentDocument | null) {
  if (document?.status !== "PUBLISHED") return;
  const token = `{${LEGACY_REFERRAL_SLOT}}`;
  for (const [code, raw] of Object.entries(document.locales)) {
    const label = LOCALE_NAMES[code] ?? code;
    const policy = row(raw);
    if (text(policy.hero).includes(token)) return `${label}主说明含旧变量 ${token}，请移除后再发布。`;
    for (const [index, rawSection] of list(policy.sections).entries()) {
      const section = row(rawSection);
      const fields = [text(section.title).includes(token) ? "标题" : "", text(section.body).includes(token) ? "正文" : ""].filter(Boolean);
      if (fields.length) return `${label}第 ${index + 1} 段${fields.join("和")}含旧变量 ${token}，请移除后再发布。`;
    }
  }
}

/** 版本冲突后：运营的草稿和刚读到的最新内容逐项比，只写哪里不同，不贴原文。 */
function draftDiff(draft: PublishedContentDocument, latest: PublishedContentDocument) {
  const rows: { key: string; label: string; text: string }[] = [];
  if (draft.version.trim() !== latest.version.trim()) rows.push({ key: "version", label: "版本号", text: `草稿 ${draft.version || "—"}，最新 ${latest.version || "—"}` });
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

const statusName = (value: string) => value === "PUBLISHED" ? "发布" : "草稿";

export function F1RankHow({ ladder, onPendingChange, toast }: { ladder: F1VRankRow[]; onPendingChange: () => void; toast: (message: string) => void }) {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("network_f1_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("network_f1_write") === true;
  const [document, setDocument] = useState<PublishedContentDocument | null>(null);
  const [baseline, setBaseline] = useState<PublishedContentDocument | null>(null);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ unknown: boolean; comparison: F1RankHowComparison | null }>(() => ({
    unknown: session ? !!pendingF1RankHow(session.adminId) : false, comparison: null,
  }));
  const { unknown } = recovery;
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
      setLocale(Object.keys(original.document.locales)[0] ?? "en"); setRecovery({ unknown: true, comparison: null });
      setLoading(false);
      return;
    }
    setRecovery({ unknown: false, comparison: null });
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
    setRecovery(current => ({ ...current, comparison: null }));
    try {
      const result = await queryF1RankHow(session.adminId);
      if (result.matched) {
        preserveDraft.current = false; baselineStale.current = false;
        setDocument(result.current); setBaseline(result.current); setReason(""); setRecovery({ unknown: false, comparison: null });
        toast(`已核对：原内容已保存，修订号 ${result.current.revision}`);
      } else {
        setRecovery({ unknown: true, comparison: result.comparison });
      }
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); onPendingChange(); }
  };
  const locked = saving || unknown || loading;
  const publishIssue = rankHowPublishIssue(document);
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
    if (!document || !canWrite || !session || locked || publishIssue) return;
    if (baselineStale.current) { await refresh(); return; }
    if (reason.trim().length < 8 || reason.trim().length > 500) { setError("变更理由需为 8–500 个字符。"); return; }
    if (!hasChanges) { setError("内容没有变化，无需提交。"); return; }
    setSaving(true); setError(null); setRecovery({ unknown: false, comparison: null });
    try {
      const payload = { ...document, status: document.status === "UNPUBLISHED" ? "DRAFT" as const : document.status };
      const value = await saveF1RankHow(session.adminId, payload, reason.trim());
      preserveDraft.current = false;
      setDocument(value); setBaseline(value); setReason("");
      toast(`${value.status === "PUBLISHED" ? "已发布" : "已保存草稿"}，修订号 ${value.revision}`);
    } catch (cause) {
      // 结果未知由上面的「保存结果未知」提示条说清；不再叠一条「请检查网络后重试」，这项保存不能重发。
      setError(cause instanceof OutcomeUnknownError ? null : displayAdminError(cause)); setRecovery({ unknown: cause instanceof OutcomeUnknownError, comparison: null });
      if (!(cause instanceof OutcomeUnknownError) && (cause as { reasonCode?: string }).reasonCode === "RANK_HOW_POLICY_VERSION_CONFLICT") {
        baselineStale.current = true;
        preserveDraft.current = true;
        await refresh();
      }
    }
    finally { setSaving(false); onPendingChange(); }
  };

  const comparison = recovery.comparison;
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

  // 结果未知时编辑器里是原提交，不是后端现在的内容：状态行写原提交，不写成当前状态。
  const original = unknown && session ? pendingF1RankHow(session.adminId) : undefined;
  const statusLine = original ? <span className="f1-how-status">
    <StatusTag tone="warn" icon={CircleHelp}>原提交</StatusTag>
    <span>{original.document.status === "PUBLISHED" ? "保存并发布" : "保存草稿"}</span>
    <span>基于修订号 {original.document.revision}</span>
    <span>{businessStamp(original.createdAt)}（{businessZone().label}）提交</span>
  </span> : document && <span className="f1-how-status">
    {baseStatus === "PUBLISHED" ? <StatusTag tone="ok">已发布</StatusTag> : <StatusTag tone="neutral">草稿</StatusTag>}
    <span>版本 {document.version || "—"}<Explain label="技术信息" content={`修订号 ${document.revision}：每保存一次加 1，核对「已被别人改过」时用。`} /></span>
    {document.revision === 0 && <StatusTag tone="warn" icon={CircleHelp} explain="还没保存过，或者读取时用的是内置的默认说明。这不代表运营已经保存或发布过。">内置默认内容</StatusTag>}
  </span>;

  return (
    <Panel data-testid={`published-content-${KIND}`} title="App 等级说明" icon={BookOpenText} tone="role-4"
      sub={document ? (document.hasPublishedVersion ? "App 读的是最近一次发布的版本" : "还没发布过，App 读的是内置默认说明") : undefined}
      explain="App「等级怎么升」页面的说明文字，按语言分开写。保存草稿不替换 App 正在读的版本；保存并发布后，App 下一次读取成功就换成新内容，缺用户的语言或缺固定段落时可能显示不全。保存直接生效，不走审批。"
      actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void (unknown ? checkOriginal() : refresh())}>刷新</Button>}>
      {unknown && <Notice tone="warn" title="保存结果未知" actionBelow
        action={<Button size="sm" loading={loading} onClick={() => void checkOriginal()}>重新读取核对</Button>}>
        {comparison
          ? <p>{`现在的内容和原提交对不上：修订号应为 ${comparison.revision.expected}，实际是 ${comparison.revision.current}，内容${comparison.contentMatches ? "相同" : "不同"}。请到操作记录与审批核对。`}</p>
          : <p>提交时没收到确定结果，可能已经保存。不能按原操作重发，先刷新核对；你填的内容还在下面。</p>}
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
                    <Select aria-label="新增语言" placeholder="选语言" value={newLocale} disabled={locked} onChange={setNewLocale}
                      options={Object.entries(LOCALE_NAMES).filter(([key]) => PUBLISH_LOCALES.includes(key) && !document.locales[key]).map(([key, name]) => ({ value: key, label: name }))} />
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
                      summary={`第 ${Number.isSafeInteger(item.order) ? item.order : 0} 位`}>
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
                <Fold inset title="技术信息" summary={`${LOCALE_NAMES[locale] ?? locale}的原始内容，只读`}>
                  <pre className="f1-json">{JSON.stringify(document.locales[locale], null, 2)}</pre>
                </Fold>
              </div>
              <aside className="f1-how-phone" aria-label="App 上的样子">
                <div className="f1-how-phone-head"><Smartphone size={14} aria-hidden />App 上的样子（示意） · {LOCALE_NAMES[locale] ?? locale}
                  <StatusTag tone={status === "PUBLISHED" ? "ok" : "neutral"}>{status === "PUBLISHED" ? "保存后发布" : "草稿，App 看不到"}</StatusTag></div>
                <div className="f1-how-phone-body">
                  {text(current.hero) ? <p className="f1-how-hero" data-user-content="">{slots(text(current.hero))}</p> : <p className="f1-weak">主说明还没写</p>}
                  {preview.map(({ item, index }) => (
                    <section key={index} className="f1-how-card" data-user-content="">
                      <h4>{text(item.title) ? slots(text(item.title)) : <span className="f1-weak">没有标题</span>}</h4>
                      <p>{text(item.body) ? slots(text(item.body)) : <span className="f1-weak">没有正文</span>}</p>
                    </section>
                  ))}
                  <p className="f1-how-note">示意：灰底的占位在 App 上换成实时等级数据<Explain label="预览和 App 的差别" content={`实际排版以 App 为准：App 按「顺序」从小到大排，占位按当时的 ${ladder.length} 级数据替换。`} /></p>
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
                <Button variant="primary" loading={saving} disabledReason={unknown ? "保存结果未知，请先重新读取核对" : loading ? "正在读取" : publishIssue ?? (!hasChanges ? "内容没有变化" : undefined)} onClick={() => void save()}>{status === "PUBLISHED" ? "保存并发布" : "保存草稿"}</Button>
              </div>
            </div>}
          </>}
    </Panel>
  );
}
