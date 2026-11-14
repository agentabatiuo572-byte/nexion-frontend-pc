"use client";

/**
 * J4 监管要求应急处理的页面专用件，只管排版，不发请求：
 * - stepInfo / StepTimeline：一个预案按下去会依次发生什么：第几步、做什么（用那个页面的叫法）、对象、影响谁、能不能收回。
 * - PlaybookEditor：新增、编辑预案的第一步（名称、场景、步骤、通知活动、回滚方案），点「下一步」才进共用确认框写理由。
 *   字段、默认值、校验和提交内容照改版前共用确认框里的 sop-authoring 表单（J4-H01、H02、H10），提交的正文逐字相同。
 * - ExecutePrepare：发起正式执行的第一步：先看清每一步和后果、逐步勾选确认，再填触发依据和说明。
 *   字段和校验照改版前的 j4-execution-confirmation（J4-H03），之后进共用确认框写理由、提交审批申请。
 * - TraceDrawer：一次执行的只读追溯（触发依据、逐步确认、逐步结果、通知和审计记录、恢复情况）。
 * - J4RecoveryNotice：结果未知的原操作逐条列出。行由页面用本机保存的原请求拼好传进来；旧逻辑不保存原请求，现在传空，等代码 worker 按 R1 接。
 */
import { useState, type ReactNode } from "react";
import { Ban, CircleHelp, Clock3, FlaskConical, Hourglass, ListChecks, Pencil, Plus, Search, Siren, SkipForward, Trash2, Undo2, Workflow } from "lucide-react";
import { Button, Checkbox, Drawer, Explain, Fact, Facts, Field, Input, Modal, NumberInput, Notice, Panel, SearchSelect, Select, StatusTag, Textarea, Check } from "@/app/components/rd";
import { businessStamp, businessZone, formatBusinessTime, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { J4ActionOption, J4RollbackOption, JNotifyTemplateOption, Playbook, PlaybookStep, SopExecution } from "@/lib/admin/j-client";

export const count = (value: number) => value.toLocaleString("en-US");

/** 后端时间没有时区，按存储时区（北京时间）读，按业务时区写；只到分钟的串补上秒再读，不按浏览器时区猜。 */
export function j4Time(value: string | undefined, fallback = "—") {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  const withSeconds = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(raw) ? `${raw}:00` : raw;
  return formatBusinessTimeCompact(withSeconds, raw);
}
export function j4TimeSeconds(value: string | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return "—";
  return formatBusinessTime(raw, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }, raw);
}

/* ---------------- 步骤：做什么、对象、影响、能不能收回 ---------------- */

/** 预案步骤落在哪个页面：叫法照那一页。 */
export const DOMAIN_PAGE: Record<string, string> = {
  J1: "紧急停用开关", J2: "地区访问限制", C2: "账户操作", K1: "多账户风险排查", I3: "通知活动", I5: "法律条款与风险披露",
};
/** J1 开关的名字照「紧急停用开关」。 */
export const GATE_NAME: Record<string, string> = { "killswitch.withdraw": "提现", "killswitch.genesis": "创世节点", "killswitch.exchange": "兑换" };

export type UndoKind = "here" | "elsewhere" | "never";
export type StepInfo = { title: string; target?: string; impact: string; undo: UndoKind; undoText: string; page: string; legacy?: boolean };

const TIER_TEXT: Record<string, string> = { critical: "紧急", high: "高", normal: "普通", low: "低" };
/** 通知活动的优先级写成中文（和「通知活动」页一样）。 */
export const tierText = (tier: string) => TIER_TEXT[tier] ?? tier;
/** 通知活动的名字是「名称 · 优先级 · 受众」，里面的优先级代码写成中文；只改显示，存的值不动。 */
export const notifyLabelText = (label: string) => label.split(" · ").map(tierText).join(" · ");
/** 两位国家代码写成「中文名 代码」，其他写法原样。 */
function regionText(code: string) {
  return /^[A-Z]{2}$/.test(code) ? `${new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code)} ${code}` : code;
}

export function stepInfo(step: Pick<PlaybookStep, "dom" | "ax" | "ref">, notify?: { campaignNo?: string; template?: string }): StepInfo {
  const dom = (step.dom || "").toUpperCase();
  const ref = (step.ref || "").trim();
  const arg = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : "";
  const page = DOMAIN_PAGE[dom] ?? "";
  if (dom === "J1" && ref === "withdraw") return { title: "关停提现", impact: "停止新提现申请、审核放行和未派发的链上打款；已交给打款方的不保证撤回", undo: "here", undoText: "执行完成后可以在这页恢复这个开关（直接生效，不走审批）", page };
  if (dom === "J1" && ref === "genesis") return { title: "关停创世节点", impact: "暂停创世节点交易和转让市场入口", undo: "here", undoText: "执行完成后可以在这页恢复这个开关（直接生效，不走审批）", page };
  if (dom === "J2" && ref.startsWith("geo-block:")) return { title: "封锁国家或地区", target: regionText(arg.toUpperCase()), impact: "这个国家或地区用户的 App 请求都被拒：注册、登录、浏览、资金操作都不行；后台、支付回调不受影响", undo: "elsewhere", undoText: "这页收不回；要放开，到「地区访问限制」从封锁名单去掉", page };
  if (dom === "C2" && ref.startsWith("user-freeze:")) return { title: "冻结账户", target: `用户 ${arg}`, impact: "账户冻结、登录会话失效，这位用户待处理的提现一并冻结；只能冻结状态正常的用户", undo: "elsewhere", undoText: "这页收不回；要解冻，到「账户操作」处理", page };
  if (dom === "K1" && ref.startsWith("cluster-freeze:")) return { title: "冻结账户组", target: `账户组 ${arg}`, impact: "冻结这个账户组里符合条件的账户，待处理的提现一并冻结；只能冻结已标记的账户组", undo: "elsewhere", undoText: "这页收不回；要解冻，到「多账户风险排查」处理", page };
  if (dom === "I3" && ref === "campaign-notify") return { title: "发送通知活动", target: (notify?.template && notifyLabelText(notify.template)) || notify?.campaignNo || undefined, impact: "按这个通知活动设定的受众发送；发送数是系统创建的通知条数，不是用户已读数", undo: "never", undoText: "发出后撤不回；要更正只能另发一条通知", page };
  if (dom === "I5" && ref.startsWith("disclosure-publish:")) return { title: "发布风险披露", target: arg.includes(":") ? `${regionText(arg.slice(0, arg.indexOf(":")).toUpperCase())} · ${arg.slice(arg.indexOf(":") + 1)}` : arg, impact: "把这个地区指定版本的草稿发布为现行风险披露；用的是执行那一刻的草稿内容", undo: "elsewhere", undoText: "这页收不回；要更正，到「法律条款与风险披露」再发一版", page };
  return { title: operatorCopyText((step.ax || "").replace(/\*\*/g, "")) || "未知动作", target: ref || undefined, impact: "这个动作已经不能执行，要先编辑预案换成能用的动作", undo: "never", undoText: "历史动作，不能执行", page, legacy: true };
}

export function UndoTag({ info }: { info: StepInfo }) {
  if (info.legacy) return <StatusTag tone="warn" icon={Ban} explain={info.undoText}>历史动作</StatusTag>;
  if (info.undo === "here") return <StatusTag tone="ok" icon={Undo2} explain={info.undoText}>能在这页恢复</StatusTag>;
  if (info.undo === "never") return <StatusTag tone="danger" icon={Ban} explain={info.undoText}>撤不回</StatusTag>;
  return <StatusTag tone="warn" icon={Ban} explain={info.undoText}>这页收不回</StatusTag>;
}

/** 一个预案的步骤时间线。`confirm` 传了就在每一步右边放勾选（发起正式执行时逐步确认）。 */
export function StepTimeline({ steps, notify, confirm, label = "执行步骤" }: {
  steps: Pick<PlaybookStep, "dom" | "ax" | "ref" | "approve">[];
  notify?: { campaignNo?: string; template?: string };
  confirm?: { checked: (index: number) => boolean; onChange: (index: number, next: boolean) => void; disabled?: boolean };
  label?: string;
}) {
  return (
    <ol className="j4-steps" aria-label={label}>
      {steps.map((step, index) => {
        const info = stepInfo(step, notify);
        const checked = confirm?.checked(index) ?? false;
        return (
          <li key={`${step.dom}-${step.ref}-${index}`} className="j4-step" data-undo={info.legacy ? "legacy" : info.undo} data-checked={confirm && checked ? "" : undefined}>
            <span className="j4-step-n" aria-hidden>{index + 1}</span>
            <div className="j4-step-body">
              <div className="j4-step-head">
                <span className="j4-step-title">{info.title}</span>
                {info.target && <span className="j4-step-target" data-mono="">{info.target}</span>}
                <UndoTag info={info} />
                {step.approve && <StatusTag tone="neutral" icon={ListChecks} explain="预案定义里这一步标了「需确认」。提交执行时每一步都要你逐项勾选；批准后系统按顺序自动执行，执行中途不会停下来等人确认。">需确认</StatusTag>}
              </div>
              <p className="j4-step-impact">{info.impact}</p>
              {info.page && <p className="j4-step-page">在「{info.page}」执行</p>}
            </div>
            {confirm && (
              <label className="j4-step-check">
                <Checkbox data-proof={`j4-step-confirm-${index + 1}`} checked={checked} disabled={confirm.disabled} onChange={(event) => confirm.onChange(index, event.target.checked)} aria-label={`确认第 ${index + 1} 步：${info.title}${info.target ? ` ${info.target}` : ""}`} />
                <span>确认</span>
              </label>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 「能在这页恢复 a 步，这页收不回 b 步」一句话。 */
export function undoSummary(steps: Pick<PlaybookStep, "dom" | "ax" | "ref">[]) {
  const infos = steps.map((step) => stepInfo(step));
  const here = infos.filter((info) => !info.legacy && info.undo === "here").length;
  const elsewhere = infos.filter((info) => !info.legacy && info.undo === "elsewhere").length;
  const never = infos.filter((info) => !info.legacy && info.undo === "never").length;
  return [here && `能在这页恢复 ${here} 步`, elsewhere && `这页收不回 ${elsewhere} 步（到对应页面处理）`, never && `撤不回 ${never} 步`].filter(Boolean).join("，") || "没有可执行的步骤";
}

/* ---------------- 执行进度 ---------------- */

export const STEP_LABEL: Record<string, string> = { pending: "待执行", ready: "准备就绪", validated: "校验通过", done: "成功", failed: "失败", skipped: "已跳过", rolled_back: "已恢复", running: "执行中", recovering: "恢复核对中" };
export function executionStepLabel(status: string) {
  return STEP_LABEL[status.toLowerCase()] ?? "状态未知";
}
export function executionModeLabel(mode: string) {
  if (mode === "drill") return "演练";
  if (mode === "emergency") return "应急执行";
  if (mode === "regular") return "常规执行";
  return "未知模式";
}
export function isActiveExecution(execution: SopExecution) {
  return execution.mode !== "drill" && execution.steps.some((step) => step === "pending" || step === "running" || step === "recovering");
}

/** 逐步小格加一句话：做到哪一步、哪一步失败。 */
export function StepDots({ steps, drill }: { steps: string[]; drill?: boolean }) {
  const done = steps.filter((step) => step === "done" || step === "validated").length;
  const failedAt = steps.findIndex((step) => step === "failed");
  const runningAt = steps.findIndex((step) => step === "running" || step === "recovering");
  const pendingAt = steps.findIndex((step) => step === "pending");
  const unknown = steps.some((step) => !STEP_LABEL[step.toLowerCase()]);
  const text = steps.length === 0 ? "没有步骤记录"
    : runningAt >= 0 ? `第 ${runningAt + 1} 步${executionStepLabel(steps[runningAt])}`
    : pendingAt >= 0 ? `第 ${pendingAt + 1} 步待执行`
    : failedAt >= 0 ? `第 ${failedAt + 1} 步失败，${done} 步成功`
    : unknown ? "有步骤状态未知"
    : steps.every((step) => step === "rolled_back") ? `${count(steps.length)} 步已恢复`
    : done === steps.length ? (drill ? `${count(steps.length)} 步检查通过` : `${count(steps.length)} 步全部成功`)
    : `${done}/${steps.length} 步成功`;
  return (
    <span className="j4-dots">
      <span className="j4-dots-row" aria-hidden>
        {steps.map((step, index) => <span key={index} className="j4-dot" data-state={step.toLowerCase()} title={`第 ${index + 1} 步：${executionStepLabel(step)}`} />)}
      </span>
      <span className="j4-dots-text">{text}</span>
    </span>
  );
}

/* ---------------- 结果未知逐条提醒（界面备好，等代码 worker 接 R1） ---------------- */

export type J4RecoveryRow = {
  key: string;
  /** 哪个预案的哪种操作：「SOP-01 监管点名快速止血 · 发起正式执行」。 */
  name: string;
  /** 提交了什么，写人话：「应急通道，触发依据 监管点名，4 步」。 */
  change: ReactNode;
  /** 本机保存原请求的时间（毫秒）。 */
  submittedAt: number;
  /** 走审批的申请（发起正式执行）还是直接生效的写操作。 */
  kind: "approval" | "direct";
  expired: boolean;
  onQuery: () => void;
  onRetry?: () => void;
  /** 执行申请过期且后端明确查不到，或改版前的旧记录过期：可以确认解除这条记录。 */
  onRelease?: () => void;
  note?: ReactNode;
};
export function j4UnknownTag(kind: "approval" | "direct") {
  return kind === "approval"
    ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，申请可能已经提交、正在等批准。先查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会建第二张申请。">结果未知</StatusTag>
    : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效。先查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会重复执行。">结果未知</StatusTag>;
}
export function j4ExpiredTag(kind: "approval" | "direct", legacy = false) {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "approval"
    ? "原请求超过 24 小时，不能再重试，只能查询原申请。后端明确查不到这张申请时，说明没建成，可以确认解除。"
    : legacy ? "已超过 24 小时。旧记录没存原请求，不能重试；到「操作记录与审批」核对过，可以确认解除。"
      : "原请求超过 24 小时，不能再重试，只能查询。读到的是现在的状态，不能据此认定原操作成没成，记录继续保留。"}>已过期</StatusTag>;
}
export function J4RecoveryNotice({ rows }: { rows: J4RecoveryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>{rows.length} 项操作结果未知<Explain label="结果未知怎么处理" content={<>
      <p>提交时没收到确定结果。发起正式执行的申请可能已经提交、在等批准；新增、编辑、演练、取消、核对和恢复开关可能已经生效。</p>
      <p>先点「查询原结果」；24 小时内也可以按原请求重试，后端认得出是同一次提交。</p>
      <p>执行申请按原请求查原申请，查到就以它为准；其他操作只能读回现在的状态，可能是别人改的，不能单凭它认定原操作成没成。记录留到原请求有确定结果；执行申请过期且后端查不到、或改版前的旧记录过期，可以确认解除。</p>
    </>} /></>}>
      <ul className="j4-rec" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="j4-rec-name">{row.name}</span>
            <span className="j4-rec-change">{row.change}</span>
            <span className="j4-rec-time">{businessStamp(row.submittedAt)} 提交</span>
            <span className="j4-rec-state">{row.expired ? j4ExpiredTag(row.kind, row.kind === "direct" && !!row.onRelease) : j4UnknownTag(row.kind)}</span>
            <span className="j4-rec-actions">
              <Button size="sm" onClick={row.onQuery}>查询原结果</Button>
              {!row.expired && row.onRetry && <Button size="sm" onClick={row.onRetry}>按原请求重试</Button>}
              {row.expired && row.onRelease && <Button size="sm" onClick={row.onRelease}>确认解除</Button>}
            </span>
            {row.note && <span className="j4-rec-note">{row.note}</span>}
          </li>
        ))}
      </ul>
      <p className="j4-rec-zone">提交时间为{businessZone().label}</p>
    </Notice>
  );
}

/* ---------------- 新增、编辑预案（第一步） ---------------- */

/** 照改版前共用表单：「≤1h」这类旧写法换成分钟，1–1440 分钟整数才算填好。 */
export function parseSopSlaMinutes(raw?: string): number | null {
  const value = (raw ?? "").trim();
  let match = value.match(/^(?:≤|<=)?\s*(\d{1,2})\s*h$/i);
  if (match) {
    const minutes = Number(match[1]) * 60;
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
  }
  match = value.match(/^(\d{1,4})\s*(?:分钟|m)$/i);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

export type PlaybookDraft = {
  name: string; scene: string; owner: string; sla: string; slaLegacyValue: string; emergencyTrack: string;
  lines: string[]; notifyCampaignNo: string; notifyTemplate: string; notifySearch: string;
  rollback: string; rollbackTemplate: string; rollbackSearch: string; drillRequired: string;
};
export type EditorSpec = {
  mode: "create" | "edit";
  playbook?: Playbook;
  scenes: string[];
  owners?: string[];
  nameHint: string;
  notifyTemplates: JNotifyTemplateOption[];
  notifyTemplatesError?: string;
  actionOptions: J4ActionOption[];
  rollbackOptions: J4RollbackOption[];
  current?: { name: string; scene: string; owner: string; sla: string; emergencyTrack: boolean; actionSeq: string; notifyCampaignNo?: string; notifyTemplate?: string; rollback?: string; drillRequired?: boolean };
  draft?: PlaybookDraft;
  onNext: (draft: PlaybookDraft) => void;
};

export function initialDraft(spec: EditorSpec): PlaybookDraft {
  const current = spec.current;
  const minutes = parseSopSlaMinutes(current?.sla);
  const rollback = current?.rollback ?? "";
  return {
    name: current?.name ?? "",
    scene: current?.scene ?? spec.scenes[0] ?? "监管点名",
    owner: current?.owner ?? spec.owners?.[0] ?? "风控",
    sla: minutes == null ? (current?.sla ? "" : "15 分钟") : `${minutes} 分钟`,
    slaLegacyValue: current?.sla ?? "",
    emergencyTrack: current?.emergencyTrack === false ? "false" : "true",
    lines: (current?.actionSeq ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    notifyCampaignNo: current?.notifyCampaignNo ?? "",
    notifyTemplate: current?.notifyTemplate ?? "",
    notifySearch: current?.notifyTemplate ?? "",
    rollback,
    rollbackTemplate: "",
    rollbackSearch: spec.rollbackOptions.find((item) => item.plan === rollback)?.label ?? "",
    drillRequired: current?.drillRequired === false ? "false" : "true",
  };
}

/** 照改版前共用表单的必填和格式检查（J4-H01～H03），缺什么写在「下一步」的灰色原因里。 */
export function draftMissing(draft: PlaybookDraft) {
  const missing: string[] = [];
  const needs = (value: string, label: string) => { if (!value.trim()) missing.push(label); };
  needs(draft.name, "预案名称");
  needs(draft.scene, "触发场景");
  needs(draft.owner, "责任角色");
  needs(draft.sla, "响应时限");
  needs(draft.lines.join("\n"), "动作序列");
  needs(draft.rollback, "回滚方案");
  if (parseSopSlaMinutes(draft.sla) == null) missing.push("响应时限须为 1-1440 分钟整数");
  if (draft.lines.some((line) => line.trim().startsWith("I3·"))) needs(draft.notifyCampaignNo, "I3 通知活动");
  return missing;
}

/** 预案定义里的一行：「J2·封锁指定国家或地区·geo-block:us」拆成步骤。 */
export function lineStep(line: string): Pick<PlaybookStep, "dom" | "ax" | "ref" | "approve"> {
  const [dom, ax, ...rest] = line.split("·");
  return { dom: (dom ?? "").trim(), ax: (ax ?? "").trim(), ref: rest.join("·").trim() || null, approve: false };
}

/** 参数照改版前的格式检查：J2 两位字母转大写，C2 正整数 1–19 位，K1 字母数字和 ._-，I5 地区:版本。 */
function normalizedTarget(item: J4ActionOption, raw: string) {
  const value = raw.trim();
  if (!item.ref?.includes("{target}")) return "";
  if (item.domain === "J2") return /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : "";
  if (item.domain === "C2") return /^[1-9]\d{0,18}$/.test(value) ? value : "";
  if (item.domain === "K1") return /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : "";
  if (item.domain === "I5") return /^[A-Za-z0-9_-]{2,32}:[A-Za-z0-9._-]{1,32}$/.test(value) ? value : "";
  return "";
}
function optionLine(item: J4ActionOption, target: string) {
  const ref = item.ref?.includes("{target}") ? item.ref.replace("{target}", target) : item.ref;
  return `${item.domain}·${item.action}${ref ? `·${ref}` : ""}`;
}
const TARGET_HINT: Record<string, string> = { J2: "两位国家代码，例如 US", C2: "用户数字编号，例如 123", K1: "账户组编号，例如 cluster-001", I5: "地区:版本，例如 VN:v1.2" };
const TARGET_PLACEHOLDER: Record<string, string> = { J2: "国家代码，如 US", C2: "用户编号，如 123", K1: "如 cluster-001", I5: "如 VN:v1.2" };

export function PlaybookEditor({ spec, onClose }: { spec: EditorSpec; onClose: () => void }) {
  const [draft, setDraft] = useState<PlaybookDraft>(() => spec.draft ?? initialDraft(spec));
  const [actionSearch, setActionSearch] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const set = (patch: Partial<PlaybookDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const missing = draftMissing(draft);
  const slaMinutes = parseSopSlaMinutes(draft.sla)?.toString() ?? "";
  const scenes = spec.scenes.length ? spec.scenes : ["监管点名", "资金异常", "数据泄露", "舆情挤兑", "技术故障"];
  const owners = spec.owners ?? ["风控", "合规审计", "超管", "财务"];
  const actionQuery = actionSearch.trim().toLowerCase();
  const shownActions = spec.actionOptions.filter((item) => !actionQuery || (item.searchText ?? `${item.label} ${item.description ?? ""}`).toLowerCase().includes(actionQuery)).slice(0, 8);
  const notifyQuery = draft.notifySearch.trim().toLowerCase();
  const shownNotify = spec.notifyTemplates.filter((item) => !notifyQuery || (item.searchText ?? `${item.label} ${item.meta ?? ""}`).toLowerCase().includes(notifyQuery)).slice(0, 8);
  const rollbackQuery = draft.rollbackSearch.trim().toLowerCase();
  const shownRollback = spec.rollbackOptions.filter((item) => !rollbackQuery || (item.searchText ?? `${item.label} ${item.scene ?? ""} ${item.riskLevel ?? ""} ${item.plan}`).toLowerCase().includes(rollbackQuery)).slice(0, 8);
  const selectedRollback = spec.rollbackOptions.find((item) => item.plan === draft.rollback || item.value === draft.rollbackTemplate);
  const hasNotifyStep = draft.lines.some((line) => line.trim().startsWith("I3·"));
  const add = (item: J4ActionOption) => {
    const target = normalizedTarget(item, targets[item.value] ?? "");
    if (item.ref?.includes("{target}") && !target) return;
    const line = optionLine(item, target);
    if (!draft.lines.includes(line)) set({ lines: [...draft.lines, line] });
    setTargets((prev) => ({ ...prev, [item.value]: "" }));
  };
  const title = spec.mode === "create" ? "新增预案" : "编辑预案";
  return (
    <Modal title={title} wide onClose={onClose} className="j4-editor" icon={spec.mode === "create" ? Plus : Pencil}
      sub={<StatusTag tone="neutral" icon={FlaskConical} explain="保存只改预案定义，不动任何线上业务。保存后预案是待演练，演练通过才能正式执行；编辑已有预案也会回到待演练，已有的执行记录不变。">保存后要先演练</StatusTag>}
      footer={<>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabledReason={missing.length ? `还缺：${missing.join("；")}` : undefined} onClick={() => spec.onNext(draft)}>下一步：核对并写理由</Button>
      </>}>
      <div className="rd-form-grid" data-cols="2" data-dense="">
        <Field label="预案名称" required hint="2–128 字">
          <Input value={draft.name} placeholder={spec.nameHint} onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label="触发场景" required>
          <Select aria-label="触发场景" value={draft.scene} onChange={(value) => set({ scene: value })} options={scenes.map((scene) => ({ value: scene, label: scene }))} />
        </Field>
        <Field label="责任角色" required explain="只记录这个预案由谁负责，不给任何人增加权限。谁能维护、谁能执行看账号权限。">
          <Select aria-label="责任角色" value={draft.owner} onChange={(value) => set({ owner: value })} options={owners.map((owner) => ({ value: owner, label: owner }))} />
        </Field>
        <Field label="响应时限" required hint="1–1440 分钟" explain="记录出事后多久内要处理完，系统不会因此加快执行。"
          error={draft.slaLegacyValue && !slaMinutes ? `原来的「${draft.slaLegacyValue}」格式不对，请重新填 1–1440 分钟` : undefined}>
          {(control) => <NumberInput {...control} aria-label="响应时限（分钟）" unit="分钟" min={1} max={1440} step={1} value={slaMinutes} placeholder="15"
            onChange={(event) => set({ sla: event.target.value ? `${event.target.value} 分钟` : "" })} />}
        </Field>
      </div>
      <Check label="标成应急通道预案" checked={draft.emergencyTrack === "true"} data-proof="sop-emergency"
        onChange={(event) => set({ emergencyTrack: event.target.checked ? "true" : "false" })}
        explain="应急通道只影响记录：执行记为「应急执行」。审批人、批准要求、执行顺序都和常规一样，不会加急。不管选不选，预案里都不能放恢复、解封、放行这类动作。" />

      <section className="j4-editor-block" aria-label="执行步骤">
        <h3 className="j4-editor-title">执行步骤<span className="j4-editor-hint">按加入顺序执行，不能拖动排序</span></h3>
        {draft.lines.length === 0
          ? <p className="j4-editor-empty" data-proof="sop-action-sequence">还没有步骤，从下面加，至少 1 步。</p>
          : <ol className="j4-added" data-proof="sop-action-sequence" aria-label="已加入的步骤">
            {draft.lines.map((line, index) => {
              const info = stepInfo(lineStep(line), { template: draft.notifyTemplate, campaignNo: draft.notifyCampaignNo });
              return (
                <li key={`${line}-${index}`}>
                  <span className="j4-step-n" aria-hidden>{index + 1}</span>
                  <span className="j4-added-main"><span className="j4-step-title">{info.title}</span>{info.target && <span className="j4-step-target" data-mono="">{info.target}</span>}{info.page && <span className="j4-added-page">{info.page}</span>}</span>
                  <UndoTag info={info} />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} onClick={() => set({ lines: draft.lines.filter((_, i) => i !== index) })}>移除</Button>
                </li>
              );
            })}
          </ol>}
        <div className="j4-pick" data-proof="sop-action-option-select">
          <div className="j4-pick-search">
            <Search size={14} aria-hidden />
            <Input type="search" data-search="" aria-label="搜索可以加的动作" placeholder="搜索动作" value={actionSearch} onChange={(event) => setActionSearch(event.target.value)} />
          </div>
          {spec.actionOptions.length === 0
            ? <Notice tone="warn">没有可以加的动作，请刷新；仍然没有请联系值班人员。</Notice>
            : shownActions.length === 0
              ? <p className="j4-editor-empty">没有匹配的动作，换个关键词试试。</p>
              : <ul className="j4-pick-list" aria-label="可以加的动作">
                {shownActions.map((item) => {
                  const needsTarget = Boolean(item.ref?.includes("{target}"));
                  const raw = targets[item.value] ?? "";
                  const target = normalizedTarget(item, raw);
                  const line = needsTarget && !target ? "" : optionLine(item, target);
                  const added = Boolean(line) && draft.lines.includes(line);
                  const info = stepInfo({ dom: item.domain, ax: item.action, ref: item.ref?.replace("{target}", "") ?? null });
                  const blocked = added ? "已经加过同一步" : needsTarget && !target ? (raw.trim() ? `格式不对：${TARGET_HINT[item.domain] ?? "请检查"}` : `先填${item.parameterLabel ?? "对象"}`) : undefined;
                  return (
                    <li key={item.value}>
                      <span className="j4-pick-main">
                        <span className="j4-step-title">{info.title}</span>
                        <span className="j4-added-page">{info.page}</span>
                        <UndoTag info={info} />
                      </span>
                      {needsTarget && <Input className="j4-pick-target" aria-label={`${info.title}的对象：${TARGET_HINT[item.domain] ?? item.parameterLabel ?? ""}`} placeholder={TARGET_PLACEHOLDER[item.domain] ?? item.parameterPlaceholder}
                        value={raw} aria-invalid={raw.trim() && !target ? true : undefined}
                        onChange={(event) => setTargets((prev) => ({ ...prev, [item.value]: event.target.value }))} />}
                      <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={blocked} onClick={() => add(item)}>加入</Button>
                    </li>
                  );
                })}
              </ul>}
        </div>
      </section>

      <Field label="通知活动" required={hasNotifyStep} hint="步骤里有「发送通知活动」时必选"
        help={spec.notifyTemplatesError && draft.notifyCampaignNo ? <>已绑定 <span data-mono="">{draft.notifyCampaignNo}</span>：候选读不到不代表绑定不存在。</> : undefined}
        explain="只能选已排期的通知活动。保存预案不会新建或发送通知；正式执行到这一步时才按活动设定的受众发送。">
        {(control) => spec.notifyTemplatesError
          ? <Notice tone="warn">通知活动读不到或没有查看权限，其他步骤不受影响；要发通知请联系管理员。</Notice>
          : spec.notifyTemplates.length === 0
            ? <Notice tone="neutral">没有已排期的通知活动。先到「通知活动」安排，或不加发送通知这一步。</Notice>
            : <div data-proof="sop-i3-notify-template-select">
              <SearchSelect {...control} aria-label="通知活动" placeholder="搜索通知名称、编号、优先级或受众" value={draft.notifySearch}
                onChange={(value) => set({ notifySearch: value, notifyCampaignNo: "", notifyTemplate: "" })}
                options={shownNotify.map((item) => ({ value: item.value, label: notifyLabelText(item.label), extra: item.campaignNo }))}
                selected={draft.notifyCampaignNo || undefined} empty="没有匹配的通知活动"
                onSelect={(value) => { const item = spec.notifyTemplates.find((row) => row.value === value); if (item) set({ notifyCampaignNo: item.value, notifyTemplate: item.label, notifySearch: notifyLabelText(item.label) }); }} />
            </div>}
      </Field>

      <Field label="回滚方案" required help={selectedRollback?.plan} explain="只是写给人看的说明，恢复时系统不按它执行：这页只能恢复这次关停的提现、创世节点这类开关，其他步骤收不回。">
        {(control) => spec.rollbackOptions.length === 0
          ? <Notice tone="warn">没有可用的回滚方案，请刷新后重试。</Notice>
          : <div data-proof="sop-rollback-template-select">
            <SearchSelect {...control} aria-label="回滚方案" placeholder="搜索场景、方案名称或内容" value={draft.rollbackSearch}
              onChange={(value) => set({ rollbackSearch: value, rollbackTemplate: "", rollback: "" })}
              options={shownRollback.map((item) => ({ value: item.value, label: item.label, extra: item.scene }))}
              selected={selectedRollback?.value} empty="没有匹配的回滚方案"
              onSelect={(value) => { const item = spec.rollbackOptions.find((row) => row.value === value); if (item) set({ rollbackTemplate: item.value, rollback: item.plan, rollbackSearch: item.label }); }} />
          </div>}
      </Field>
      <Check label="保存后先演练，演练通过才能正式执行" checked readOnly disabled data-proof="sop-drill" />
    </Modal>
  );
}

/** 编辑：只列改了的项。 */
export function draftChanges(before: PlaybookDraft, after: PlaybookDraft) {
  const rows: { k: string; from: string; to: string }[] = [];
  const push = (k: string, from: string, to: string) => { if (from !== to) rows.push({ k, from: from || "—", to: to || "—" }); };
  push("名称", before.name.trim(), after.name.trim());
  push("触发场景", before.scene, after.scene);
  push("责任角色", before.owner, after.owner);
  push("响应时限", before.sla || before.slaLegacyValue, after.sla);
  push("应急通道", before.emergencyTrack === "true" ? "是" : "否", after.emergencyTrack === "true" ? "是" : "否");
  push("通知活动", before.notifyTemplate || before.notifyCampaignNo, after.notifyTemplate || after.notifyCampaignNo);
  push("回滚方案", before.rollback, after.rollback);
  return rows;
}

/* ---------------- 发起正式执行（第一步） ---------------- */

export const TRIGGER_BASES = ["监管点名", "挤兑风险", "安全事件", "其他"];
export type ExecuteDraft = { triggerBasis: string; triggerContext: string; confirmed: boolean[] };

export function executeMissing(draft: ExecuteDraft) {
  const missing: string[] = [];
  if (!draft.triggerBasis.trim()) missing.push("触发依据");
  const length = draft.triggerContext.trim().length;
  if (!length) missing.push("触发说明");
  if (length > 0 && (length < 8 || length > 500)) missing.push("触发说明须为 8-500 字");
  draft.confirmed.forEach((value, index) => { if (!value) missing.push(`确认第 ${index + 1} 步`); });
  return missing;
}

export function ExecutePrepare({ playbook, emergency, draft: initial, onNext, onClose }: {
  playbook: Playbook; emergency: boolean; draft: ExecuteDraft;
  onNext: (draft: ExecuteDraft) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [contextLeft, setContextLeft] = useState(false);
  const missing = executeMissing(draft);
  const confirmedCount = draft.confirmed.filter(Boolean).length;
  const contextLength = draft.triggerContext.trim().length;
  const contextError = (contextLeft || draft.triggerContext.length > 0) && contextLength > 0 && contextLength < 8 ? `还差 ${8 - contextLength} 字，8–500 字` : undefined;
  const notify = { campaignNo: playbook.notifyCampaignNo, template: playbook.notifyTemplate };
  return (
    <Modal title={`发起正式执行 · ${playbook.name}`} wide tone="danger" icon={Siren} className="j4-execute" onClose={onClose}
      sub={<>
        <StatusTag tone="warn" icon={Clock3} explain="提交后先建一张审批申请，另一位管理员在「操作记录与审批」批准后才执行；批准前任何业务都不变。">批准后才执行</StatusTag>
        {emergency ? <StatusTag tone="danger" icon={Siren} explain="执行记为「应急执行」。审批人、批准要求和执行顺序都和常规一样，不会加急。">应急通道</StatusTag> : <StatusTag tone="neutral" icon={Workflow}>常规通道</StatusTag>}
      </>}
      footer={<>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabledReason={missing.length ? `还缺：${missing.join("；")}` : undefined} onClick={() => onNext(draft)}>下一步：写理由并提交</Button>
      </>}>
      <Facts>
        <Fact k="批准前">什么都不会发生，业务照常</Fact>
        <Fact k="批准后">系统按下面的顺序自动执行 {count(playbook.seq.length)} 步，中途不再等人确认；某一步失败就停下，后面的跳过，前面做完的保持生效</Fact>
        <Fact k="收得回吗" tone={playbook.seq.some((step) => stepInfo(step).undo !== "here") ? "warn" : undefined}>{undoSummary(playbook.seq)}</Fact>
      </Facts>
      <section className="j4-execute-steps" aria-label="逐步确认">
        <h3 className="j4-editor-title">逐步确认<span className="j4-editor-hint">已确认 {confirmedCount}/{playbook.seq.length}，逐步看过并勾选后才能提交</span></h3>
        <StepTimeline steps={playbook.seq} notify={notify} label="会依次执行的步骤"
          confirm={{ checked: (index) => draft.confirmed[index] === true, onChange: (index, next) => setDraft((prev) => ({ ...prev, confirmed: prev.confirmed.map((value, i) => (i === index ? next : value)) })) }} />
      </section>
      <div className="rd-form-grid" data-cols="2" data-dense="">
        <Field label="触发依据" required>
          <Select aria-label="触发依据" data-proof="j4-trigger-basis" value={draft.triggerBasis} onChange={(value) => setDraft((prev) => ({ ...prev, triggerBasis: value }))}
            options={TRIGGER_BASES.map((value) => ({ value, label: value }))} />
        </Field>
      </div>
      <Field label="触发说明" required hint="8–500 字" error={contextError} help="写清来函编号、事件编号、影响范围和为什么要执行。">
        {(control) => <Textarea {...control} rows={3} maxLength={500} data-proof="j4-trigger-context" value={draft.triggerContext}
          placeholder="例如：监管来函 2026-07 号要求暂停新提现；影响范围、处置必要性"
          count={`${contextLength}/500`} onBlur={() => setContextLeft(true)}
          onChange={(event) => setDraft((prev) => ({ ...prev, triggerContext: event.target.value }))} />}
      </Field>
    </Modal>
  );
}

/* ---------------- 执行追溯（只读） ---------------- */

const NOTIFY_STATUS: Record<string, string> = { SKIPPED: "已跳过", DISPATCHED: "已发送", FAILED: "发送失败", PENDING: "待发送", VALIDATED: "校验通过（演练没有发送）" };
const AUDIT_STATUS: Record<string, string> = { PENDING: "待记录", AUDITED: "已记录审计" };
const ROLLBACK_STATUS: Record<string, string> = { NOT_REQUIRED: "无需恢复（演练未执行生产操作）", ROLLED_BACK: "已恢复可逆操作", PENDING: "待恢复", RUNNING: "恢复中", FAILED: "恢复失败" };
export function rollbackStatusText(value?: string) {
  if (!value) return "尚无恢复记录";
  return ROLLBACK_STATUS[value] ?? "状态未知";
}
/** 已保存流程里的失败原因码写成人话；原码等宽跟在后面。 */
const FAILURE_TEXT: Record<string, string> = {
  J4_EXECUTION_CANCELLED: "已登记取消，后面的步骤跳过",
  J4_EXECUTION_START_AUDIT_FAILED: "启动记录没写成，第一步没有执行",
  J4_EXECUTION_PROGRESS_WRITE_FAILED: "这一步做完了，但进度没记上，可能已经生效",
  J4_STALE_EXECUTION_RECONCILED: "超时后核对：证明不了做成的记为失败",
  J4_STEP_FAILED: "这一步执行失败",
};
export function failureText(raw: unknown) {
  const code = String(raw ?? "");
  const known = Object.keys(FAILURE_TEXT).find((key) => code === key || code.startsWith(`${key}:`));
  return { text: known ? FAILURE_TEXT[known] : "执行失败", code };
}
const ROLE_TEXT: Record<string, string> = { superadmin: "超级管理员", risk: "风控", finance: "财务", compliance: "合规审计", "超管": "超级管理员" };
export function roleText(value: string) {
  return ROLE_TEXT[value] ?? (/^[㐀-鿿、与 ]+$/.test(value) ? value : "权限未知");
}
function stepStatusTag(status: string) {
  const s = status.toLowerCase();
  const tone = s === "failed" ? "danger" : s === "running" || s === "recovering" || s === "pending" ? "progress" : s === "done" || s === "validated" || s === "rolled_back" ? "done" : s === "skipped" ? "neutral" : "warn";
  return <StatusTag tone={tone} icon={tone === "neutral" ? SkipForward : tone === "warn" ? CircleHelp : undefined}>{executionStepLabel(status)}</StatusTag>;
}

export function TraceDrawer({ execution, onClose }: { execution: SopExecution | null; onClose: () => void }) {
  const e = execution;
  const dispatch = e?.notificationDispatch ?? {};
  const confirmations = Array.isArray(dispatch.stepConfirmations) ? dispatch.stepConfirmations as Array<Record<string, unknown>> : null;
  const actions = e?.domainActions ?? [];
  const sent = dispatch.notificationCount;
  const failure = dispatch.failure ? failureText(dispatch.failure) : null;
  const drill = e?.mode === "drill";
  return (
    <Drawer open={Boolean(e)} onClose={onClose} title="执行追溯" sub={e ? <span data-mono="">{e.executionId || "执行编号缺失"}</span> : undefined} wide
      explain="打开时那一行的快照，只读；刷新页面后重新打开才是最新的。">
      {e && <div className="j4-trace">
        <Facts>
          <Fact k="预案">{e.name}<span className="j4-muted"> · <span data-mono="">{e.code}</span></span></Fact>
          <Fact k="开始时间">{j4TimeSeconds(e.ts)}</Fact>
          <Fact k="方式">{executionModeLabel(e.mode)}{drill && <span className="j4-muted">（只检查，没动真实业务）</span>}</Fact>
          <Fact k="执行人">{e.operator || "—"}</Fact>
          <Fact k="责任">{roleText(e.roleGate)}</Fact>
          <Fact k="业务原因">{e.trig || "未记录"}</Fact>
          {dispatch.cancelRequested === true && <Fact k="取消" tone="warn">已登记取消{dispatch.cancelRequestedAt ? `（${j4Time(String(dispatch.cancelRequestedAt))}）` : ""}</Fact>}
        </Facts>
        <Panel plain headingLevel={3} title="触发依据和逐步确认">
          <Facts>
            <Fact k="触发依据">{String(dispatch.triggerBasis || "未记录")}</Fact>
            <Fact k="触发说明">{String(dispatch.triggerContext || "未记录")}</Fact>
          </Facts>
          {confirmations
            ? <ol className="j4-trace-list">
              {confirmations.map((confirmation, index) => (
                <li key={`${String(confirmation.domain)}-${String(confirmation.step ?? index)}`} data-proof={`j4-trace-confirmation-${index + 1}`}>
                  <span className="j4-trace-n">第 {String(confirmation.step ?? index + 1)} 步</span>
                  <span>{DOMAIN_PAGE[String(confirmation.domain)] ?? String(confirmation.domain || "未知页面")}</span>
                  <span className="j4-muted" data-mono="">{String(confirmation.ref || "未记录")}</span>
                  {confirmation.confirmed === true ? <StatusTag tone="done">已确认</StatusTag> : <StatusTag tone="warn">未确认</StatusTag>}
                </li>
              ))}
            </ol>
            : <p className="j4-muted" data-proof="j4-trace-confirmation-legacy">历史记录未保存逐步确认。</p>}
        </Panel>
        <Panel plain headingLevel={3} title="逐步结果">
          {actions.length === 0
            ? <p className="j4-muted">没有可核对的分步操作记录。</p>
            : <ol className="j4-trace-list" data-wide="">
              {actions.map((action, index) => {
                const status = String(action.status || e.steps[index] || "");
                const info = stepInfo({ dom: String(action.domain || ""), ax: String(action.action || ""), ref: action.ref ? String(action.ref) : String(action.domain) === "J1" ? String(action.configKey || "").replace("killswitch.", "") : String(action.domain) === "I3" ? "campaign-notify" : null }, { campaignNo: action.campaignNo ? String(action.campaignNo) : undefined });
                const fail = action.failure ? failureText(action.failure) : null;
                return (
                  <li key={`${String(action.domain)}-${String(action.step ?? index)}`}>
                    <span className="j4-trace-n">第 {String(action.step ?? index + 1)} 步</span>
                    <span><b className="j4-step-title">{info.legacy ? operatorCopyText(String(action.action || "未记录动作")) : info.title}</b>{info.target && <span className="j4-step-target" data-mono="">{info.target}</span>}<span className="j4-added-page">{info.page}</span></span>
                    {stepStatusTag(status)}
                    {(fail || Boolean(action.ownershipToken)) && <span className="j4-trace-more">
                      {fail && <span className="j4-trace-fail">{fail.text} <span data-mono="">{fail.code}</span></span>}
                      {action.ownershipToken ? <span className="j4-muted">开关凭证 <span data-mono="">{String(action.ownershipToken)}</span></span> : null}
                    </span>}
                  </li>
                );
              })}
            </ol>}
        </Panel>
        <Panel plain headingLevel={3} title="通知和审计记录">
          <Facts>
            <Fact k="通知">{NOTIFY_STATUS[String(dispatch.status)] ?? "状态未知"}</Fact>
            <Fact k="发送数">{sent == null ? "未返回" : `${String(sent)} 条`}</Fact>
            <Fact k="审计记录">{AUDIT_STATUS[String(dispatch.auditStatus)] ?? "状态未知"}</Fact>
            {failure && <Fact k="失败原因" tone="danger">{failure.text} <span data-mono="">{failure.code}</span></Fact>}
          </Facts>
        </Panel>
        <Panel plain headingLevel={3} title="恢复情况">
          <Facts>
            <Fact k="状态">{rollbackStatusText(e.rollbackStatus)}</Fact>
            <Fact k="时间">{j4Time(e.rollbackAt)}</Fact>
            <Fact k="原因">{e.rollbackReason || "—"}</Fact>
          </Facts>
          {e.rollbackActions.length > 0 && <ol className="j4-trace-list">
            {e.rollbackActions.map((action, index) => (
              <li key={index}>
                <span className="j4-trace-n">{index + 1}</span>
                <span>{GATE_NAME[String(action.configKey)] ? `${GATE_NAME[String(action.configKey)]}开关` : String(action.domain || "J1")}</span>
                {action.status ? stepStatusTag(String(action.status)) : <span className="j4-muted">恢复记录已保存</span>}
              </li>
            ))}
          </ol>}
        </Panel>
        <p className="j4-note">时间为{businessZone().label}</p>
      </div>}
    </Drawer>
  );
}

/** 一次执行里能被「恢复开关」放开的 J1 开关：完成且带凭证的提现、创世节点、兑换（和后端 reversibleJ1Actions 同一个条件）。 */
export function reversibleGates(execution: SopExecution) {
  return execution.domainActions
    .filter((action) => String(action.domain ?? "").toUpperCase() === "J1" && GATE_NAME[String(action.configKey ?? "")] && String(action.status ?? "").toUpperCase() === "DONE" && String(action.ownershipToken ?? "").trim())
    .map((action) => GATE_NAME[String(action.configKey)]);
}

