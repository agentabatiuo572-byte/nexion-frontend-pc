"use client";

/**
 * M4 知识库的展示件：语言名、「给谁看」、状态标签、App 里的样子、详情抽屉、发布和下架的确认框、结果未知列表。
 * 只管排版：读到的问答和写操作都由 m4-kb-sla.tsx 传进来，这里不发请求、不改请求内容。
 */
import { useState, type ReactNode } from "react";
import { Bot, BookOpenText, CheckCircle2, CircleHelp, EyeOff, FilePen, Headset, Pencil, Smartphone, Trash2, Upload, Archive } from "lucide-react";
import { Button, Change, Decision, Drawer, Explain, Fact, Facts, Fold, JudgmentPoints, Modal, Notice, StatusTag, type DrawerNav, type StateTone } from "@/app/components/rd";
import { OPEN_RESULT_LABELS, useFreshFirst } from "../recovery-panel";
import { M_RECOVERY_INTRO, mNoticeTone } from "@/lib/admin/m-recovery-copy";
import { MAuditLink } from "./m-release";
import type { FaqRecoveryInfo } from "./m4-kb-sla";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import type { SupportFaq } from "./data";
import { catCN } from "./hd-ui";

/** 后端合法的九种语言（三个长码 + 六个附加短码），名字和 I5 一致。 */
export const M4_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "zh-CN", name: "中文" },
  { code: "en-US", name: "英语" },
  { code: "vi-VN", name: "越南语" },
  { code: "id", name: "印尼语" },
  { code: "ms", name: "马来语" },
  { code: "fil", name: "菲律宾语" },
  { code: "ru", name: "俄语" },
  { code: "kk", name: "哈萨克语" },
  { code: "uz", name: "乌兹别克语" },
];
/** App 帮助中心只按这三种语言读取（App serverLanguage 只发 zh / vi / en）。 */
export const APP_LANGUAGES = ["zh-CN", "en-US", "vi-VN"];
/** 不认识的语言码原样写出来，不当成中文。 */
export const languageName = (code: string) => M4_LANGUAGES.find((language) => language.code === code)?.name ?? code;

export const SURFACE_NAME: Record<string, string> = { "Help Center": "帮助中心", Nova: "Nova 智能问答（已下线）" };
export const surfaceName = (surface: string) => SURFACE_NAME[surface] ?? surface;

/** 页面读到的问答。语言按后端原值显示；附加翻译要等读取层接上（M4-B02）。 */
export type M4Faq = Omit<SupportFaq, "language"> & {
  language: string;
  translations?: Record<string, { question: string; answer: string }>;
};

type Reach = { key: string; icon: typeof Smartphone; who: string; reaches: boolean; note: string };

/** 一条问答发布后谁读得到：按后端和 App 现在的真实读取写，不按选项名承诺（M4-B03、M4-X02）。 */
export function reachOf(faq: Pick<M4Faq, "surface" | "language">, after: "on" | "off" = "on"): Reach[] {
  const rows: Reach[] = [];
  if (faq.surface === "Nova") {
    rows.push({ key: "nova", icon: Bot, who: "Nova 智能问答", reaches: false, note: "已下线，用户看不到" });
  } else if (APP_LANGUAGES.includes(faq.language)) {
    const users = faq.language === "en-US" ? "界面是英语或另外六种语言的用户；这一分类没有越南语问答时，越南语用户也看到它" : `界面是${languageName(faq.language)}的用户`;
    rows.push({ key: "app", icon: Smartphone, who: "App 帮助中心", reaches: true, note: users });
  } else {
    rows.push({ key: "app", icon: Smartphone, who: "App 帮助中心", reaches: false, note: `App 现在只按中文、英语、越南语读取，${languageName(faq.language)}的问答用户看不到` });
  }
  rows.push({ key: "agent", icon: Headset, who: "客服回复时", reaches: true, note: after === "off" ? "客服的「知识库」不再列出这条" : faq.language === "en-US"
    ? "英语客户能查到；其他语言没有问答时也列英语"
    : `${languageName(faq.language)}客户能查到` });
  return rows;
}

/** 发布后有没有用户能在 App 里看到。 */
export const reachesUsers = (faq: Pick<M4Faq, "surface" | "language">) => faq.surface === "Help Center" && APP_LANGUAGES.includes(faq.language);

export function ReachList({ faq, label, after = "on" }: { faq: Pick<M4Faq, "surface" | "language">; label: string; after?: "on" | "off" }) {
  return (
    <ul className="m4-reach" aria-label={label}>
      {reachOf(faq, after).map((row) => (
        <li key={row.key} data-reaches={row.reaches ? "" : undefined}>
          <row.icon size={16} aria-hidden />
          <span className="m4-reach-who">{row.who}</span>
          <span className="m4-reach-note">{row.reaches ? row.note : <><EyeOff size={14} aria-hidden /><span>{row.note}</span></>}</span>
        </li>
      ))}
    </ul>
  );
}

export function FaqStatusTag({ status }: { status: SupportFaq["status"] }) {
  return status === "published"
    ? <StatusTag tone="ok" icon={CheckCircle2} explain="在线上：用户和客服按「给谁看」读得到。">已发布</StatusTag>
    : <StatusTag tone="neutral" icon={FilePen} explain="只在后台，用户和客服都读不到。">草稿</StatusTag>;
}

/** 列表里「给谁看」一格的第二行：语言，读不到时补一句。 */
export function audienceSub(faq: Pick<M4Faq, "surface" | "language">) {
  if (faq.surface === "Nova") return `${languageName(faq.language)} · 用户看不到`;
  if (!APP_LANGUAGES.includes(faq.language)) return `${languageName(faq.language)} · App 不读这个语言`;
  return languageName(faq.language);
}

/** 用户在 App 帮助中心里大概看到的样子：问题一行，点开是回答，换行原样保留。只是排版近似，不是 App 截图。 */
export function FaqPreview({ question, answer, empty = "还没写" }: { question: string; answer: string; empty?: string }) {
  return (
    <div className="m4-preview">
      <div className="m4-preview-q" data-user-content="">{question.trim() || <span className="m4-preview-empty">问题{empty}</span>}</div>
      <div className="m4-preview-a" data-user-content="">{answer.trim() || <span className="m4-preview-empty">回答{empty}</span>}</div>
    </div>
  );
}

/** 英语问答带的附加翻译。读取层还没接 translations，接上后这里才有内容（M4-B02）。 */
function Translations({ faq }: { faq: M4Faq }) {
  const entries = Object.entries(faq.translations ?? {});
  if (!entries.length) return null;
  return (
    <Fold inset title="附带的翻译" summary={`${entries.length} 种语言`}
      explain="只有英语问答能带翻译：用英语保存不影响翻译，改成别的语言保存会清掉。App 现在只读中文、英语、越南语，这些翻译暂时不显示给用户。">
      {entries.map(([code, text]) => (
        <div key={code} className="m4-translation">
          <span className="m4-translation-lang">{languageName(code)}</span>
          <FaqPreview question={text.question} answer={text.answer} />
        </div>
      ))}
    </Fold>
  );
}

export function M4FaqDrawer({ faq, author, nav, busy, canWrite, onClose, onEdit, onStatus, onDelete }: {
  faq: M4Faq | null;
  /** 当前这一版的修改人：undefined 后端没给，null 查不到。 */
  author?: string | null;
  nav?: DrawerNav;
  busy: boolean;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStatus: () => void;
  onDelete: () => void;
}) {
  if (!faq) return <Drawer open={false} onClose={onClose} title="问答详情">{null}</Drawer>;
  const published = faq.status === "published";
  return (
    <Drawer open onClose={onClose} title="问答详情" sub={<span data-mono="">{faq.id}</span>} icon={BookOpenText} tone="role-2" busy={busy} nav={nav}
      footer={canWrite ? <Decision
        danger={<Button variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} disabled={busy} onClick={onDelete}>删除</Button>}
        others={<Button icon={published ? <Archive size={14} aria-hidden /> : <Upload size={14} aria-hidden />} disabled={busy} onClick={onStatus}>{published ? "下架" : "发布"}</Button>}
        primary={<Button variant="primary" icon={<Pencil size={14} aria-hidden />} disabled={busy} onClick={onEdit}>编辑</Button>} /> : undefined}>
      <JudgmentPoints rows={[
        { label: "状态", value: <FaqStatusTag status={faq.status} /> },
        { label: "给谁看", value: `${surfaceName(faq.surface)} · ${languageName(faq.language)}` },
        { label: "分类", value: catCN(faq.category) },
        { label: "排序", value: <span data-num="">{faq.sortOrder}</span>, reason: "小值靠前" },
        { label: "最近更新", value: <><span data-num="">{faq.updatedAt.slice(0, 16)}</span>（{businessZone().label}）· 第 {faq.version} 版</> },
        ...(author === undefined ? [] : [{ label: "这一版谁改的", value: author ?? "未记录", reason: author === null ? "迁移或预置的问答、修改人账号已删除时查不到" : undefined }]),
      ]} />
      <section className="m4-drawer-block" aria-label={published ? "现在谁读得到" : "发布后谁读得到"}>
        <h3 className="m4-block-title">{published ? "现在谁读得到" : "发布后谁读得到"}</h3>
        <ReachList faq={faq} label={published ? "现在谁读得到" : "发布后谁读得到"} />
      </section>
      <section className="m4-drawer-block" aria-label="帮助中心里大概这样">
        <h3 className="m4-block-title">帮助中心里大概这样<Explain label="预览怎么来的" content="按 App 帮助中心的排版近似画出：问题一行，展开是回答，换行原样保留。实际字号和折行以 App 为准。" /></h3>
        <FaqPreview question={faq.question} answer={faq.answer} />
      </section>
      <Translations faq={faq} />
    </Drawer>
  );
}

/** 发布、下架的确认框。确认后发出的请求和改版前一样（理由固定，见下面的「操作记录」一行）。 */
export function M4StatusConfirm({ faq, busy, disabled, disabledReason, failure, retry, info, onQuery, onCancel, onConfirm }: {
  faq: M4Faq;
  busy: boolean;
  failure: Error | null;
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** 从结果未知恢复：确认就是按原请求重试。 */
  retry?: import("../design-kit").PendingConfirmRecovery;
  /** 恢复原操作时：和行同一份结论。 */
  info?: FaqRecoveryInfo;
  onQuery?: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const publish = faq.status === "draft";
  const unknown = isOutcomeUnknownError(failure);
  const querying = retry?.state?.busy === "query";
  const action = publish ? "发布" : "下架";
  return (
    <Modal title={publish ? "发布这条问答" : "下架这条问答"} icon={publish ? Upload : Archive}
      sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} busy={busy} onClose={onCancel}
      footer={<>
        <Button disabled={busy} onClick={onCancel}>取消</Button>
        {retry && <Button variant={retry.state?.replayBlock && !info?.rejected ? "primary" : "secondary"} loading={querying} loadingText="查询中…" disabled={busy} disabledReason={onQuery ? undefined : "当前账号没有知识库查看权限"} onClick={onQuery}>查询原结果</Button>}
        {info?.rejected ? <Button onClick={info.release}>核实后解除</Button>
          : <Button variant={retry?.state?.replayBlock ? "secondary" : "primary"} loading={busy && !querying} disabled={disabled} disabledReason={busy ? undefined : disabledReason} onClick={onConfirm}>{retry || unknown ? "按原请求重试" : `确认${action}`}</Button>}
      </>}>
      <Facts>
        <Fact k="问题"><span className="m4-fact-text">{faq.question}</span></Fact>
        <Fact k="给谁看">{surfaceName(faq.surface)} · {languageName(faq.language)}</Fact>
        <Fact k="状态"><Change from={publish ? "草稿" : "已发布"} to={publish ? "已发布" : "草稿"} /></Fact>
      </Facts>
      <section className="m4-confirm-block" aria-label={publish ? "发布后谁读得到" : "下架后谁读不到"}>
        <h3 className="m4-block-title">{publish ? "发布后谁读得到" : "下架后这些地方不再读到"}</h3>
        <ReachList faq={faq} after={publish ? "on" : "off"} label={publish ? "发布后谁读得到" : "下架后谁读不到"} />
      </section>
      {publish && !reachesUsers(faq) && <Notice tone="warn">发布后状态会变成已发布，但 App 用户现在还看不到这条。</Notice>}
      {!publish && <p className="m4-confirm-note">问答留在列表里，随时可以重新发布。已经发给客户的回答不会撤回；App 里已打开的帮助页可能过几分钟才更新。</p>}
      <p className="m4-confirm-note">操作记录会记下这次{publish ? "发布" : "下架"}，理由固定写「{publish ? "常见问答 发布例行审核留档" : "常见问答 下架例行审核留档"}」。</p>
      {failure && !unknown && <Notice tone="danger" title="没有成功"><p>{failure?.message}</p></Notice>}
      {info && <Notice tone={mNoticeTone(info.view)} title={info.view.label} actionBelow action={info.gone || info.rejected ? <MAuditLink /> : undefined}>
        <p>{info.gone && "这条问答已不在列表里。"}{info.view.line}</p>
        {unknown && failure?.message && <p>{failure.message}</p>}
      </Notice>}
    </Modal>
  );
}

export type M4PendingRow = { key: string; question: string; change: ReactNode; submittedAt: number; expired: boolean;
  /** 这一行的标签和结论（共用 fundRecoveryStatus 的叫法）；note 是结论句和技术信息。 */
  status: { tone: StateTone; label: string; more?: string }; note: ReactNode; actions: ReactNode };

/**
 * 结果未知的写操作逐条列出：改的是哪条、改成什么、什么时候提交的、查到什么、现在能做什么。
 * 多条时默认露出三条，其余点开再看，首屏留给问答列表（提示不盖正事）。
 */
export function M4PendingWrites({ rows }: { rows: readonly M4PendingRow[] }) {
  const [all, setAll] = useState(false);
  const { ordered, box } = useFreshFirst(rows.map((row) => ({ ...row, createdAt: row.submittedAt })));
  if (rows.length === 0) return null;
  const open = rows.filter((row) => OPEN_RESULT_LABELS.includes(row.status.label)).length;
  const title = [rows.length - open > 0 && `${rows.length - open} 个操作结果未知`, open > 0 && `${open} 个操作还没结案`].filter(Boolean).join("，");
  return (
    <Notice tone="warn" title={<>{title}<Explain label="结果未知怎么处理" content={<><p>{M_RECOVERY_INTRO}</p><p>过了 24 小时还没结论的，由有调查权限的超级管理员核查结案。有结论前这条问答不能再改。</p></>} /></>}>
      <div ref={box}><ul className="m4-pending" aria-label="结果未知的操作">
        {(all ? ordered : ordered.slice(0, 3)).map((row) => (
          <li key={row.key}>
            <span className="m4-pending-name">{row.question}</span>
            <span className="m4-pending-change">{row.change}</span>
            <span className="m4-pending-time">{businessStamp(row.submittedAt)} 提交</span>
            <span className="m4-pending-state"><StatusTag tone={row.status.tone} explain={row.status.more}>{row.status.label}</StatusTag></span>
            <span className="m4-pending-actions">{row.actions}</span>
            <span className="m4-pending-note" role="status">{row.note}</span>
          </li>
        ))}
      </ul></div>
      {rows.length > 3 && <Button size="sm" variant="ghost" onClick={() => setAll((value) => !value)}>{all ? "只看前 3 条" : `显示全部 ${rows.length} 条`}</Button>}
      <p className="m4-pending-zone">提交时间为{businessZone().label}</p>
    </Notice>
  );
}
