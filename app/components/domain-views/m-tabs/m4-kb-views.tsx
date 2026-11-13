"use client";

/**
 * M4 知识库的展示件：语言名、「给谁看」、状态标签、App 里的样子、详情抽屉、发布和下架的确认框、结果未知列表。
 * 只管排版：读到的问答和写操作都由 m4-kb-sla.tsx 传进来，这里不发请求、不改请求内容。
 */
import type { ReactNode } from "react";
import { Bot, BookOpenText, CheckCircle2, CircleHelp, EyeOff, FilePen, Headset, Pencil, Smartphone, Trash2, Upload, Archive } from "lucide-react";
import { Button, Change, Decision, Drawer, Explain, Fact, Facts, Fold, JudgmentPoints, Modal, Notice, StatusTag, type DrawerNav } from "@/app/components/rd";
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
const APP_LANGUAGES = ["zh-CN", "en-US", "vi-VN"];
/** 不认识的语言码原样写出来，不当成中文。 */
export const languageName = (code: string) => M4_LANGUAGES.find((language) => language.code === code)?.name ?? code;

export const SURFACE_NAME: Record<string, string> = { "Help Center": "帮助中心", Nova: "Nova 智能助手" };
export const surfaceName = (surface: string) => SURFACE_NAME[surface] ?? surface;

/** 页面读到的问答。语言按后端原值显示；附加翻译要等读取层接上（M4-B02）。 */
export type M4Faq = Omit<SupportFaq, "language"> & {
  language: string;
  translations?: Record<string, { question: string; answer: string }>;
};

type Reach = { key: string; icon: typeof Smartphone; who: string; reaches: boolean; note: string };

/** 一条问答发布后谁读得到：按后端和 App 现在的真实读取写，不按选项名承诺（M4-B03、M4-X02）。 */
export function reachOf(faq: Pick<M4Faq, "surface" | "language">): Reach[] {
  const rows: Reach[] = [];
  if (faq.surface === "Nova") {
    rows.push({ key: "nova", icon: Bot, who: "Nova 智能助手", reaches: false, note: "目前读不到普通问答：后端语言代码对不上，已提后端修" });
  } else if (APP_LANGUAGES.includes(faq.language)) {
    const users = faq.language === "en-US" ? "界面是英语，或另外六种语言（App 按英语读取）的用户" : `界面是${languageName(faq.language)}的用户`;
    rows.push({ key: "app", icon: Smartphone, who: "App 帮助中心", reaches: true, note: users });
  } else {
    rows.push({ key: "app", icon: Smartphone, who: "App 帮助中心", reaches: false, note: `App 现在只按中文、英语、越南语读取，${languageName(faq.language)}的问答用户看不到` });
  }
  rows.push(faq.language === "zh-CN"
    ? { key: "agent", icon: Headset, who: "客服回复时", reaches: true, note: "专属会话的「知识库」里能查到，点一下插入回答" }
    : { key: "agent", icon: Headset, who: "客服回复时", reaches: false, note: "客服的「知识库」只列中文问答" });
  return rows;
}

/** 发布后有没有用户能在 App 里看到。 */
export const reachesUsers = (faq: Pick<M4Faq, "surface" | "language">) => faq.surface !== "Nova" && APP_LANGUAGES.includes(faq.language);

export function ReachList({ faq, label }: { faq: Pick<M4Faq, "surface" | "language">; label: string }) {
  return (
    <ul className="m4-reach" aria-label={label}>
      {reachOf(faq).map((row) => (
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
  if (faq.surface === "Nova") return `${languageName(faq.language)} · 智能助手读不到`;
  if (!APP_LANGUAGES.includes(faq.language)) return `${languageName(faq.language)} · App 不读这个语言`;
  return languageName(faq.language);
}

/** 用户在 App 帮助中心里大概看到的样子：问题一行，点开是回答，换行原样保留。只是排版近似，不是 App 截图。 */
export function FaqPreview({ question, answer, empty = "还没写" }: { question: string; answer: string; empty?: string }) {
  return (
    <div className="m4-preview">
      <div className="m4-preview-q">{question.trim() || <span className="m4-preview-empty">问题{empty}</span>}</div>
      <div className="m4-preview-a">{answer.trim() || <span className="m4-preview-empty">回答{empty}</span>}</div>
    </div>
  );
}

/** 英语问答带的附加翻译。读取层还没接 translations，接上后这里才有内容（M4-B02）。 */
function Translations({ faq }: { faq: M4Faq }) {
  const entries = Object.entries(faq.translations ?? {});
  if (!entries.length) return null;
  return (
    <Fold inset title="附带的翻译" summary={`${entries.length} 种语言`}
      explain="只有英语问答能带翻译。改成别的语言保存，翻译会被清掉；英语保存时不带翻译，原翻译保留。App 现在只按中文、英语、越南语读取，这些翻译暂时不会显示给用户。">
      {entries.map(([code, text]) => (
        <div key={code} className="m4-translation">
          <span className="m4-translation-lang">{languageName(code)}</span>
          <FaqPreview question={text.question} answer={text.answer} />
        </div>
      ))}
    </Fold>
  );
}

export function M4FaqDrawer({ faq, nav, busy, canWrite, onClose, onEdit, onStatus, onDelete }: {
  faq: M4Faq | null;
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
        { label: "最近更新", value: <><span data-num="">{faq.updatedAt}</span> · 第 {faq.version} 版</> },
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
export function M4StatusConfirm({ faq, busy, failure, onCancel, onConfirm }: {
  faq: M4Faq;
  busy: boolean;
  failure: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const publish = faq.status === "draft";
  const unknown = failure.startsWith("结果未确认");
  return (
    <Modal title={publish ? "发布这条问答" : "下架这条问答"} icon={publish ? Upload : Archive}
      sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} busy={busy} onClose={onCancel}
      footer={<>
        <Button disabled={busy} onClick={onCancel}>取消</Button>
        <Button variant="primary" loading={busy} onClick={onConfirm}>{publish ? "确认发布" : "确认下架"}</Button>
      </>}>
      <Facts>
        <Fact k="问题"><span className="m4-fact-text">{faq.question}</span></Fact>
        <Fact k="给谁看">{surfaceName(faq.surface)} · {languageName(faq.language)}</Fact>
        <Fact k="状态"><Change from={publish ? "草稿" : "已发布"} to={publish ? "已发布" : "草稿"} /></Fact>
      </Facts>
      <section className="m4-confirm-block" aria-label={publish ? "发布后谁读得到" : "下架后谁读不到"}>
        <h3 className="m4-block-title">{publish ? "发布后谁读得到" : "下架后这些地方不再读到"}</h3>
        <ReachList faq={faq} label={publish ? "发布后谁读得到" : "下架后谁读不到"} />
      </section>
      {publish && !reachesUsers(faq) && <Notice tone="warn">发布后状态会变成已发布，但 App 用户现在还看不到这条。</Notice>}
      {!publish && <p className="m4-confirm-note">问答留在列表里，随时可以重新发布。已经发给客户的回答不会撤回；App 里已打开的帮助页可能过几分钟才更新。</p>}
      <p className="m4-confirm-note">操作记录会记下这次{publish ? "发布" : "下架"}，理由固定写「{publish ? "常见问答 发布例行审核留档" : "常见问答 下架例行审核留档"}」。</p>
      {failure && <Notice tone={unknown ? "warn" : "danger"} title={unknown ? "结果未知" : "没有成功"}>
        {unknown ? <p>请求已经发出，可能已经{publish ? "发布" : "下架"}。先关掉这个框，看列表里这条的状态；状态没变再重新操作。</p> : <p>{failure}</p>}
      </Notice>}
    </Modal>
  );
}

export type M4PendingRow = { key: string; question: string; change: ReactNode; submittedAt: number; expired: boolean; actions: ReactNode };

/**
 * 结果未知的写操作逐条列出：改的是哪条、改成什么、什么时候提交的、现在能做什么。
 * 界面已备好，行要由代码 worker 按 R1 从本标签页保存的原请求拼出来（M4-B01）；现在没有来源，传空数组不显示。
 */
export function M4PendingWrites({ rows }: { rows: readonly M4PendingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>有 {rows.length} 个操作结果未知<Explain label="结果未知怎么处理" content="提交时没收到确定结果，可能已经生效。24 小时内可以按原请求重试，后端认得出是同一次提交，不会重复执行；超过 24 小时只能查询。有结论前，这条问答不要再改。" /></>}>
      <ul className="m4-pending" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="m4-pending-name">{row.question}</span>
            <span className="m4-pending-change">{row.change}</span>
            <span className="m4-pending-time">{businessStamp(row.submittedAt)} 提交</span>
            <span className="m4-pending-state">{row.expired
              ? <StatusTag tone="neutral" icon={CircleHelp} explain="原请求超过 24 小时，不能再重试，只能查询。">已过期</StatusTag>
              : <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag>}</span>
            <span className="m4-pending-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="m4-pending-zone">提交时间为{businessZone().label}</p>
    </Notice>
  );
}
