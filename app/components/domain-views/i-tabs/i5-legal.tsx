"use client";

/**
 * 法律条款页签：按语言和适用法律地区看版本。填理由直接生效，不走审批（Q-08）。
 * 当前生效和草稿分开放；版本详情和草稿编辑用抽屉（PG-47）。理由在确认框里填（OP-24），发布只发已保存的内容（OP-26）。
 * 不能增删节，所以新建草稿带入现行版本的全部节，节数比现行版本少的草稿不能发布（PG-59、OPS-16）。
 * 这个范围没有版本时，按 App 的回退顺序找一份带入，不然新草稿只有一节，写不出完整条款。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { FileCheck2, FilePen, FileText, History, Scale } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterField, Fold, Input, IrreversibleTag, MoreMenu, Notice, Panel, RecordList, Select, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr, type StateTone } from "@/app/components/rd";
import { businessClock, businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchLegalTermsAdmin, type LegalTermsSection, type LegalTermsVersion } from "@/lib/admin/legal-terms-client";
import { currentLegalTermsDateTime, normalizeLegalTermsDateTime } from "@/lib/admin/legal-terms-contract";
import type { TabHead } from "./i5-disclosures";
import { LeaveDialog, MergeNotice, mergeEdits, useLeaveGuard, withConflict, WRITE_LOCKED, type EditorSwitch, type I5Writes, type MergeReport } from "./i5-writes";
import type { ICtx } from "./types";

const LOCALE_OPTIONS = [{ value: "en", label: "英文" }, { value: "zh", label: "中文" }, { value: "vi", label: "越南语" }];
const localeName = (value: string) => LOCALE_OPTIONS.find((item) => item.value === value)?.label ?? value;
const STATUS: Record<string, { text: string; tone: StateTone }> = {
  DRAFT: { text: "草稿", tone: "neutral" },
  PUBLISHED: { text: "生效中", tone: "ok" },
  SUPERSEDED: { text: "历史版本", tone: "done" },
  REVOKED: { text: "已撤回", tone: "warn" },
};
const statusOf = (row: LegalTermsVersion) => STATUS[row.status] ?? { text: "版本状态待核实", tone: "warn" as StateTone };
const timeText = (value: string) => formatBusinessTimeFull(value, value);
const validTime = (value: string) => { try { normalizeLegalTermsDateTime(value); return true; } catch { return false; } };

const sameContent = (left: LegalTermsVersion, right: LegalTermsVersion) => JSON.stringify([left.title, left.summary, left.sections]) === JSON.stringify([right.title, right.summary, right.sections]);
const FIELD_NAME: Record<string, string> = { title: "标题", summary: "摘要", effectiveAt: "生效时间", sections: "条款段落" };

function scopeProblem(jurisdiction: string) {
  if (!jurisdiction) return "请填写适用法律地区，例如 GLOBAL。";
  return /^[A-Z][A-Z0-9_-]{1,15}$/.test(jurisdiction) ? null : "适用法律地区需为 2–16 位，以字母开头，只含字母、数字、下划线或短横线。";
}

export function LegalTab({ ctx, writes, canWrite, canPublish, nonce, focus, onHead }: { ctx: ICtx; writes: I5Writes; canWrite: boolean; canPublish: boolean; nonce: number;
  /** 待确认的「读回核对」：切到原操作的语言和地区（REV2-02）。 */
  focus: { locale: string; jurisdiction: string; nonce: number } | null;
  onHead: (key: "legal", head: TabHead) => void;
}) {
  const { openActionConfirm, toast } = ctx;
  const [locale, setLocale] = useState("en");
  const [jurisdictionInput, setJurisdictionInput] = useState("GLOBAL");
  const [jurisdiction, setJurisdiction] = useState("GLOBAL");
  const typedScope = jurisdictionInput.trim().toUpperCase();
  const scopeError = scopeProblem(typedScope);
  // 框里的地区和已读取的不一致时，下面不显示旧地区的内容和写入口（I5-Q02、ST-27）。
  const scopePending = !scopeError && typedScope !== jurisdiction;
  const scopeReady = !scopeError && !scopePending;
  const [rows, setRows] = useState<LegalTermsVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [readAt, setReadAt] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<LegalTermsVersion | null>(null);
  const [latest, setLatest] = useState<LegalTermsVersion | null>(null);
  /** 新草稿内容的来源，核对「和当前版本相同」用。 */
  const [draftBase, setDraftBase] = useState<LegalTermsVersion | null>(null);
  /** 「读取最新」读失败时留着要读的版本，编辑器里给重读。 */
  const [unread, setUnread] = useState<string | null>(null);
  const editorSwitch = useRef<EditorSwitch | null>(null);
  const requestSequence = useRef(0);
  const target = `legal:${locale}:${jurisdiction}`;

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setError(null);
    setRows([]);
    setViewing(null);
    setBusy(true);
    try {
      const value = await fetchLegalTermsAdmin(locale, jurisdiction);
      if (sequence === requestSequence.current) {
        setRows(value);
        setReadAt(businessClock(Date.now()));
      }
      return value;
    } catch (cause) {
      if (sequence === requestSequence.current) setError(displayAdminError(cause));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [locale, jurisdiction]);
  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh, nonce]);
  useEffect(() => { onHead("legal", { readAt, busy, disabled: !scopeReady || !!editing, failed: !!error, refresh: () => void refresh() }); }, [onHead, readAt, busy, scopeReady, editing, error, refresh]);

  /** 替换或盖住编辑器的入口都走这里，未保存时先问（OP-29）。 */
  const leaveEditor = (next: () => void) => { if (editorSwitch.current) editorSwitch.current.attempt(next); else next(); };

  useEffect(() => {
    if (!focus) return;
    leaveEditor(() => {
      setLocale(focus.locale);
      setJurisdictionInput(focus.jurisdiction);
      setJurisdiction(focus.jurisdiction);
    });
  }, [focus]);

  const applyScope = () => {
    const next = jurisdictionInput.trim().toUpperCase();
    setJurisdictionInput(next);
    if (!scopeProblem(next)) setJurisdiction(next);
  };

  const published = rows.find((row) => row.status === "PUBLISHED") ?? null;
  const drafts = rows.filter((row) => row.status === "DRAFT");
  const history = rows.filter((row) => row.status !== "PUBLISHED" && row.status !== "DRAFT");
  const shown = viewing === null ? null : rows.find((row) => row.id === viewing) ?? null;
  const scopeText = `${localeName(locale)} · ${jurisdiction}`;
  const writeBlocked = !scopeReady ? "适用法律地区还没读取，先完成地区" : busy ? "正在读取最新数据，读完再操作" : error ? "当前范围的条款尚未确认，请先点「重试」。" : writes.isLocked(target) ? WRITE_LOCKED : undefined;

  /** 节数比现行版本少的草稿不发布：会用少的几节换掉线上全部条款。 */
  const sectionsBlocked = (row: LegalTermsVersion) => published && row.sections.length < published.sections.length
    ? `这个草稿 ${row.sections.length} 节，现行版本 ${published.sections.length} 节，节数变少不能发布。点「新建草稿」，新草稿带入现行版本全部节。` : undefined;
  const publishBlocked = (row: LegalTermsVersion) => writeBlocked ?? sectionsBlocked(row);

  /** 带入内容的来源：本范围现行版本、本范围最近的版本，再按 App 的回退顺序找已发布版本。 */
  const findDraftBase = async () => {
    const own = published ?? rows.find((row) => row.status !== "DRAFT");
    if (own) return own;
    const scopes = [[locale, "GLOBAL"], ["en", jurisdiction], ["en", "GLOBAL"]].filter(([l, j], index, list) => (l !== locale || j !== jurisdiction) && list.findIndex(([otherL, otherJ]) => otherL === l && otherJ === j) === index);
    for (const [fallbackLocale, fallbackJurisdiction] of scopes) {
      const found = (await fetchLegalTermsAdmin(fallbackLocale, fallbackJurisdiction)).find((row) => row.status === "PUBLISHED");
      if (found) return found;
    }
    return null;
  };

  const newDraft = async () => {
    const next = rows.reduce((max, row) => Math.max(max, Number(/^v(\d+)/.exec(row.version)?.[1] ?? 0)), 0) + 1;
    let base: LegalTermsVersion | null;
    try {
      base = await findDraftBase();
    } catch (cause) {
      toast(`现行条款没读到，这次没有新建：${displayAdminError(cause)}`, "error");
      return;
    }
    leaveEditor(() => {
      setViewing(null);
      setDraftBase(base);
      setEditing({ id: 0, locale, jurisdiction, version: `v${next}`, effectiveAt: currentLegalTermsDateTime(), status: "DRAFT", title: base?.title ?? "", summary: base?.summary ?? "", sections: base?.sections ?? [{ key: "general", title: "", body: "", sortOrder: 10 }], revision: 0, publishedAt: null, revokedAt: null });
    });
  };

  const readLatest = (version?: string) => {
    setUnread(null);
    void refresh().then((value) => {
      if (!version) return;
      if (value) setLatest(value.find((row) => row.version === version) ?? null);
      else setUnread(version);
    });
  };

  const saveDraft = (form: LegalTermsVersion, after?: () => void) => openActionConfirm(withConflict(ctx, { briefKind: "content",
    action: <>保存法律条款草稿 · {form.version}</>,
    title: "保存法律条款草稿",
    detail: <>只保存草稿，用户看到的条款不变。</>,
    amplifies: false,
    effect: <StatusTag tone="neutral" filled>保存草稿，线上不变</StatusTag>,
    confirmLabel: "保存草稿",
    statedBrief: { impact: "只保存草稿，用户看到的条款不变。", check: "核对标题、摘要和每节正文，理由写清修改依据。" },
    facts: <Facts><Fact k="范围">{scopeText}</Fact><Fact k="草稿">{form.version} · {form.sections.length} 节</Fact>{draftBase && form.id === 0 && sameContent(form, draftBase) && <Fact k="内容" tone="warn">和 {draftBase.version} 相同，还没有修改</Fact>}</Facts>,
    reasonPlaceholder: "例如：法务要求更新第 3 节",
    run: async (reason) => {
      const result = await writes.send({ target, label: `保存法律条款草稿 · ${scopeText} ${form.version}`, op: { kind: "legal-save", body: {
        locale: form.locale, jurisdiction: form.jurisdiction, version: form.version, effectiveAt: form.effectiveAt, title: form.title, summary: form.summary, sections: form.sections, expectedRevision: form.revision, reason,
      } } });
      setEditing(null);
      if (result === "done") { toast("草稿已保存，用户看到的条款不变", "success"); after?.(); }
    },
  }, () => readLatest(form.version)));

  const publish = (row: LegalTermsVersion) => {
    openActionConfirm(withConflict(ctx, { briefKind: "content",
      action: <>发布法律条款 · {row.version}</>,
      title: "发布法律条款",
      detail: <>发布已保存的草稿，不走审批。</>,
      amplifies: false,
      confirmTone: "danger",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认发布，立即生效",
      statedBrief: { impact: `这个版本立即替换 ${scopeText} 的公开条款，旧发布版转为历史版本。发布后不能再改。`, check: "核对版本、节数和生效时间，理由写清发布依据。" },
      facts: <Facts><Fact k="范围">{scopeText}</Fact><Fact k="版本"><Change from={published ? `${published.version}（${published.sections.length} 节）` : "无已发布版本"} to={`${row.version}（${row.sections.length} 节）`} /></Fact><Fact k="条文生效时间">{timeText(row.effectiveAt)}（{businessZone().label}）</Fact></Facts>,
      reasonPlaceholder: "例如：法务审定稿，工单号",
      run: async (reason) => {
        const result = await writes.send({ target, label: `发布法律条款 · ${scopeText} ${row.version}`, op: { kind: "legal-transition", action: "publish", row, reason } });
        setEditing(null);
        setViewing(null);
        if (result === "done") toast("条款已发布，请核对公开版本", "success");
      },
    }, () => readLatest()));
  };

  const revoke = (row: LegalTermsVersion) => openActionConfirm(withConflict(ctx, { briefKind: "content",
    action: <>撤回法律条款 · {row.version}</>,
    title: "撤回法律条款",
    detail: <>{locale === "en" && jurisdiction === "GLOBAL" ? "这是最后的回退范围。有自己已发布版本的语言和地区不受影响。" : "App 改读英文或 GLOBAL 的已发布版本。"}撤回不走审批。</>,
    amplifies: false,
    confirmTone: "danger",
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
    confirmLabel: "确认撤回，立即生效",
    statedBrief: { impact: `${scopeText} 的公开条款立即下架，不能恢复这个版本。`, check: "确认要下架线上条款，理由写清依据。" },
    facts: <Facts><Fact k="范围">{scopeText}</Fact><Fact k="版本">{row.version} · {row.title}</Fact><Fact k="状态"><Change from="生效中" to="已撤回" /></Fact><Fact k="后果" tone="danger">{locale === "en" && jurisdiction === "GLOBAL" ? `读 ${scopeText} 的用户，以及回退到这里的用户都读不到条款` : "英文和 GLOBAL 都没有已发布版本时，用户读不到条款"}</Fact></Facts>,
    reasonPlaceholder: "例如：条款有误，法务要求下架",
    run: async (reason) => {
      const result = await writes.send({ target, label: `撤回法律条款 · ${scopeText} ${row.version}`, op: { kind: "legal-transition", action: "revoke", row, reason } });
      setViewing(null);
      if (result === "done") toast("条款已撤回", "success");
    },
  }, () => readLatest()));

  const closeEditor = useCallback(() => { setEditing(null); setLatest(null); setUnread(null); }, []);

  const fallbackHint = "这里只看这个语言和地区。App 没有读到时会回退到英文或 GLOBAL 的已发布版本。";
  const conclusion = !scopeReady ? null
    : busy ? <Conclusion state="unknown">正在加载条款…</Conclusion>
      : error ? null
        : writes.isLocked(target) ? <Conclusion state="warn" hint="到页面上方核对原操作结果。">{scopeText}：有操作结果未确认</Conclusion>
        : !rows.length ? <Conclusion state="warn" explain={fallbackHint}>当前适用地区暂无条款版本。</Conclusion>
          : !published ? <Conclusion state="warn" explain={fallbackHint}>{scopeText}：没有已发布版本</Conclusion>
            : drafts.length ? <Conclusion state="neutral" icon={FilePen}>{scopeText}：{published.version} 生效中，有 {drafts.length} 个草稿待发布</Conclusion>
              : <Conclusion state="ok" icon={FileCheck2}>{scopeText}：{published.version} 生效中，没有草稿</Conclusion>;

  const openRow = (row: LegalTermsVersion) => leaveEditor(() => {
    if (row.status === "DRAFT" && canWrite) { setViewing(null); setDraftBase(null); setEditing(row); }
    else setViewing(row.id);
  });

  return <div data-testid="legal-terms-editor" className="rd-tab-stack">
    <div className="rd-scope-bar">
      <FilterField label="语言"><Select aria-label="语言" value={locale} options={LOCALE_OPTIONS} disabled={!!editing} onChange={setLocale} /></FilterField>
      <FilterField label={<span>适用法律地区 <Explain label="适用法律地区是什么" content="按这个代码读条款，大写字母开头，默认 GLOBAL。回车或离开输入框后读取。" /></span>}>
        <Input aria-label="适用法律地区" value={jurisdictionInput} maxLength={32} aria-invalid={!!scopeError} disabled={!!editing} onChange={(event) => setJurisdictionInput(event.target.value)} onBlur={applyScope} onKeyDown={(event) => { if (event.key === "Enter") applyScope(); }} />
      </FilterField>
    </div>
    {scopeError && <Notice tone="warn" title="请先完成适用法律地区，再加载条款。">{scopeError}</Notice>}
    {scopePending && <BlockState state="empty" compact title={`回车或离开输入框后读取 ${typedScope} 的条款`} />}
    {conclusion}
    {scopeReady && error && !busy && <BlockState state="error" title="当前范围的条款尚未确认" detail={error} onRetry={() => void refresh()} />}

    {scopeReady && !error && !busy && <>
      <Panel title="当前生效版本" icon={Scale} tone="role-2" actions={published ? <>
        <Button size="sm" onClick={() => leaveEditor(() => setViewing(published.id))}>查看全文</Button>
        {canPublish && <MoreMenu items={[{ key: "revoke", label: "撤回", danger: true, disabledReason: writeBlocked, onSelect: () => leaveEditor(() => revoke(published)) }]} />}
      </> : undefined}>
        {published ? <Facts>
          <Fact k="版本">{published.version} · {published.sections.length} 节</Fact>
          <Fact k="生效时间">{timeText(published.effectiveAt)}（{businessZone().label}）</Fact>
          <Fact k="标题">{published.title}</Fact>
        </Facts> : <p className="rd-note">当前范围没有已发布版本</p>}
      </Panel>

      <Panel title="草稿" icon={FilePen} tone="role-1" flush={drafts.length > 0} actions={canWrite ? <Button variant="primary" size="sm" disabledReason={writeBlocked} onClick={() => void newDraft()}>新建草稿</Button> : undefined}>
        {drafts.length ? (
          <Table label="法律条款草稿">
            <thead><tr><Th>版本</Th><Th>标题</Th><Th>生效时间（{businessZone().label}）</Th><Th align="right">操作</Th></tr></thead>
            <tbody>
              {drafts.map((row) => (
                <Tr key={row.id} onOpen={() => openRow(row)}>
                  <Td><Cell main={row.version} sub={`${row.sections.length} 节`} /></Td>
                  <Td><Cell main={row.title || "未填写"} /></Td>
                  <Td><Cell num main={timeText(row.effectiveAt)} /></Td>
                  <Td align="right"><span className="rd-row-actions">
                    {canWrite && <Button size="sm" disabledReason={writeBlocked} onClick={() => openRow(row)}>编辑</Button>}
                    {canPublish && <Button size="sm" disabledReason={publishBlocked(row)} onClick={() => leaveEditor(() => publish(row))}>发布</Button>}
                  </span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="rd-note">没有草稿</p>}
      </Panel>

      <Fold title="版本历史" icon={History} tone="role-3" summary={history.length ? `${history.length} 个历史或已撤回版本` : "没有历史版本"}>
        <Table label="法律条款版本历史">
          <thead><tr><Th>版本</Th><Th>状态</Th><Th>标题</Th><Th>生效时间（{businessZone().label}）</Th></tr></thead>
          <tbody>
            {history.map((row) => (
              <Tr key={row.id} selected={row.id === viewing} onOpen={() => leaveEditor(() => setViewing(row.id))}>
                <Td><Cell main={row.version} sub={`${row.sections.length} 节`} /></Td>
                <Td><StatusTag tone={statusOf(row).tone}>{statusOf(row).text}</StatusTag></Td>
                <Td><Cell main={row.title} /></Td>
                <Td><Cell num main={timeText(row.effectiveAt)} /></Td>
              </Tr>
            ))}
            {!history.length && <TableMessage columns={4}>这个范围没有历史版本。</TableMessage>}
          </tbody>
        </Table>
      </Fold>
    </>}

    <Drawer open={!!shown} onClose={() => setViewing(null)} title="法律条款" sub={shown ? `${shown.version} · ${scopeText}` : undefined} icon={FileText} tone="role-3"
      footer={shown?.status === "PUBLISHED" && canPublish ? <Decision danger={<Button variant="danger-outline" disabledReason={writeBlocked} onClick={() => revoke(shown)}>撤回</Button>} others={<Button onClick={() => setViewing(null)}>关闭</Button>} />
        : shown?.status === "DRAFT" && canPublish ? <Decision primary={<Button variant="primary" disabledReason={publishBlocked(shown)} onClick={() => publish(shown)}>发布</Button>} /> : undefined}>
      {shown && <>
        <Facts>
          <Fact k="状态"><StatusTag tone={statusOf(shown).tone}>{statusOf(shown).text}</StatusTag></Fact>
          <Fact k="生效时间">{timeText(shown.effectiveAt)}（{businessZone().label}）</Fact>
          <Fact k="节数">{shown.sections.length} 节</Fact>
        </Facts>
        <div className="rd-doc">
          <h3>{shown.title}</h3>
          <p>{shown.summary}</p>
          {shown.sections.map((section, index) => <section key={section.key}><h3>第 {index + 1} 节 · {section.title}</h3><p>{section.body}</p></section>)}
        </div>
        <Fold inset title="技术信息" summary={`修订号 ${shown.revision}`}>
          <RecordList label="法律条款章节标识" records={shown.sections.map((section, index) => ({ id: section.key, value: `第 ${index + 1} 节 · ${section.title}`, reference: section.key }))} />
        </Fold>
      </>}
    </Drawer>

    {editing && <LegalEditor key={`${editing.id}|${editing.version}`} initial={editing} latest={latest} base={draftBase} sectionsBlocked={sectionsBlocked} canPublish={canPublish} blockedReason={writeBlocked} readFailed={!!unread} onRetryRead={() => readLatest(unread ?? undefined)} switcher={editorSwitch} onSave={saveDraft} onPublish={publish} onClose={closeEditor} />}
  </div>;
}

function LegalEditor({ initial, latest, base, sectionsBlocked, canPublish, blockedReason, readFailed, onRetryRead, switcher, onSave, onPublish, onClose }: {
  initial: LegalTermsVersion;
  /** 「读取最新」读到的这个版本，三方合并（OP-97）。 */
  latest: LegalTermsVersion | null;
  /** 新草稿带入内容的来源。 */
  base: LegalTermsVersion | null;
  sectionsBlocked: (row: LegalTermsVersion) => string | undefined;
  canPublish: boolean;
  blockedReason?: string;
  readFailed: boolean;
  onRetryRead: () => void;
  switcher: RefObject<EditorSwitch | null>;
  onSave: (form: LegalTermsVersion, after?: () => void) => void;
  onPublish: (form: LegalTermsVersion) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [merged, setMerged] = useState<MergeReport | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const isNew = baseline.id === 0;
  const guard = useLeaveGuard(dirty, onClose, switcher);
  useEffect(() => {
    if (!latest) return;
    const next = mergeEdits(baseline, form, latest);
    setForm(next.value);
    setBaseline(latest);
    setMerged(next.report);
    // 只在「读取最新」时合并一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);
  const fieldName = (path: string[]) => {
    if (path[0] !== "sections" || path.length === 1) return FIELD_NAME[path[0]] ?? null;
    const index = form.sections.findIndex((section) => section.key === path[1]);
    return `${index >= 0 ? `第 ${index + 1} 节` : "已删除的一节"}${path[2] === "title" ? "标题" : path[2] === "body" ? "正文" : ""}`;
  };
  const update = (patch: Partial<LegalTermsVersion>) => setForm((current) => ({ ...current, ...patch }));
  const updateSection = (index: number, patch: Partial<LegalTermsSection>) => setForm((current) => ({ ...current, sections: current.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section) }));
  const missing = [
    !form.title.trim() && "标题",
    !form.summary.trim() && "摘要",
    !validTime(form.effectiveAt) && "生效时间",
    form.sections.some((section) => !section.title.trim() || !section.body.trim()) && "条款段落",
  ].filter(Boolean);
  const unchanged = isNew && !!base && sameContent(form, base);
  const saveBlocked = (readFailed ? "最新内容没读到，重新读取后再保存" : undefined) ?? blockedReason ?? (missing.length ? `还缺：${missing.join("、")}` : !dirty && !isNew ? "没有改动" : undefined);
  const publishBlocked = blockedReason ?? (isNew || dirty ? "先保存草稿，发布只发已保存的内容" : sectionsBlocked(form));
  const close = guard.askClose;
  return <>
    <Drawer open wide onClose={close} title="法律条款草稿" sub={`${form.version} · ${localeName(form.locale)} · ${form.jurisdiction}`} icon={FilePen} tone="role-1"
      footer={<Decision explain="保存草稿不改变用户看到的条款。发布立即生效，不走审批。" others={<>
        <Button onClick={close}>取消</Button>
        <Button variant={canPublish ? "secondary" : "primary"} disabledReason={saveBlocked} onClick={() => onSave(form)}>保存草稿</Button>
      </>} primary={canPublish ? <Button variant="primary" disabledReason={publishBlocked} onClick={() => onPublish(form)}>发布</Button> : undefined} />}>
      <div className="rd-form-stack">
        {readFailed && <Notice tone="warn" title="最新内容没读到" action={<Button size="sm" onClick={onRetryRead}>重新读取</Button>}>你的修改还在，读到后再保存。</Notice>}
        <MergeNotice report={merged} name={fieldName} />
        {isNew && base && (base.locale !== form.locale || base.jurisdiction !== form.jurisdiction) && <Notice tone="warn" title={`内容带入自 ${localeName(base.locale)} · ${base.jurisdiction} ${base.version}`}>这个范围还没有版本。改成这个范围要用的内容再保存。</Notice>}
        {isNew && !base && <Notice tone="warn" title="没有可以带入的版本">这个范围和回退范围都没有已发布版本，这里只有一节，不能增删节。</Notice>}
        {sectionsBlocked(form) && <Notice tone="warn" title="这个草稿不能发布">{sectionsBlocked(form)}</Notice>}
        {unchanged && base.locale === form.locale && base.jurisdiction === form.jurisdiction && <Notice tone="progress">内容和 {base.version} 相同，改完再保存，不改也能存成新草稿。</Notice>}
        <div className="rd-form-grid">
          <Field label="版本"><div className="rd-form-static">{form.version}<Explain label="版本号怎么来的" content="现有最大版本号加一，不能手填。" /></div></Field>
          <Field label={`生效时间（${businessZone().label}）`} required explain="写在条款上给用户看。发布后马上替换公开版本，不会等到这个时间。" error={validTime(form.effectiveAt) ? undefined : "格式：2026-11-05 09:00:00"}>{(control) => <Input {...control} value={form.effectiveAt} onChange={(event) => update({ effectiveAt: event.target.value })} />}</Field>
        </div>
        <Field label="标题" required>{(control) => <Input {...control} maxLength={200} value={form.title} onChange={(event) => update({ title: event.target.value })} />}</Field>
        <Field label="摘要" required>{(control) => <Textarea {...control} rows={3} maxLength={2000} value={form.summary} onChange={(event) => update({ summary: event.target.value })} />}</Field>
        <h3 className="rd-form-group-title">条款段落 · {form.sections.length} 节</h3>
        {form.sections.map((section, index) => (
          <Fold key={section.key} inset title={`第 ${index + 1} 节${section.title ? ` · ${section.title}` : "（未填标题）"}`} summary={section.body ? `${section.body.length} 字` : "未填写"} defaultOpen={!section.title.trim() || !section.body.trim()}>
            <div className="rd-form-stack">
              <Field label="标题" required>{(control) => <Input {...control} aria-label={`第 ${index + 1} 节标题`} maxLength={200} value={section.title} onChange={(event) => updateSection(index, { title: event.target.value })} />}</Field>
              <Field label="正文" required>{(control) => <Textarea {...control} aria-label={`第 ${index + 1} 节正文`} rows={6} maxLength={10000} value={section.body} onChange={(event) => updateSection(index, { body: event.target.value })} />}</Field>
            </div>
          </Fold>
        ))}
      </div>
    </Drawer>
    <LeaveDialog guard={guard} saveLabel="保存草稿" saveBlocked={saveBlocked} onSave={() => onSave(form, guard.saved)} />
  </>;
}
