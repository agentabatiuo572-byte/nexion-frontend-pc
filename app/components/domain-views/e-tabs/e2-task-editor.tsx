"use client";
/**
 * E2 单条任务的「编辑」「新增」：抽屉填写 → 叠一层确认框核对前后值、填理由（OP-12、OP-31、PG-38）。
 * 抽屉不挡下面的任务表（PG-37：权重要对照同等级其他任务边看边填）。
 *
 * 状态全在一个值里（E2TaskEditorState），由 E2Tasks 持有：打开、填写、确认、提交中、被拒、被别人改过、
 * 读到最新、结果未知都只改这一个值。E2Tasks 负责提交、持久保存和恢复原操作。
 */
import "./e2-task-editor.css";
import { ClipboardList, Pencil, Plus } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Button, Change, Check, ConflictBar, Decision, DiffList, Drawer, Fact, Facts, Field, Fold, Input, Modal, Notice,
  NumberInput, Select, StatusTag, TaskClassTag, Textarea, type DiffRow } from "@/app/components/rd";
import { APP_VISIBLE_TEXT_HINT, appVisibleTextError } from "@/lib/admin/content-language-rules";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import type { useReasonRule } from "@/lib/admin/use-reason-rule";
import { businessStamp, businessZoneText } from "@/lib/admin/business-time";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { taskWeightMicros, validTaskWeight, type PoolTask, type TaskClass, type TaskPool } from "@/lib/admin/task-pool-client";

export type E2TaskField = "name" | "taskClass" | "duration" | "weight";
export type E2LevelWeightRange = { min: string; max: string; count: number };
export interface E2TaskDraft { name: string; taskClass: TaskClass; duration: string; weight: string; enabled: boolean }
export type E2TaskOutcome =
  | { kind: "none" }
  /** 明确被拒。带 field 的回到抽屉写在这一项下面（OP-15），不带的留在确认框（OP-81）。 */
  | { kind: "rejected"; message: string; field?: E2TaskField; code?: string }
  /** 这条任务已被别人改过（409 TASK_TYPE_VERSION_CONFLICT）：框不关，读最新（OP-97）。 */
  | { kind: "conflict"; message?: string }
  /** 读到最新后回到抽屉：别人改了什么；yours 是自己也改过、保留下来的值。 */
  | { kind: "latest"; changes: { field: E2TaskField; label: string; from: string; to: string; yours?: string }[] }
  /** 结果未知：内容冻结，只能按原请求重试（OP-93、OP-94）。 */
  | { kind: "unknown"; createdAt: number; expired?: boolean; message?: string };
export interface E2TaskEditorState {
  mode: "create" | "update";
  pool: TaskPool;
  /** 编辑时打开那一刻的任务；新增时为 null。 */
  task: PoolTask | null;
  draft: E2TaskDraft;
  step: "form" | "leaving" | "confirm";
  reason: string;
  touched: Record<E2TaskField | "reason", boolean>;
  /** 本次提交的请求编号（idempotencyKey），开框时生成一次。 */
  key: string;
  saving: boolean;
  outcome: E2TaskOutcome;
}

export function e2EditorReasonBlock(reason: string, rule: ReturnType<typeof useReasonRule>): string | undefined {
  if (!rule.ready) return rule.error || "正在加载，稍候即可提交。";
  if (!rule.ok(reason)) return rule.hint(reason);
  if (Array.from(reason.trim()).length > 200) return "操作理由最多 200 个字符，请缩短后重试。";
}

export function isE2ReasonRejection(code?: string) {
  return code === "REASON_LENGTH_INVALID" || code === "REASON_REQUIRED"
    || /^REASON_(?:TOO_SHORT_MIN|TOO_LONG_MAX)_[1-9][0-9]*$/.test(code ?? "");
}

const ENABLED_LIMIT = 200;
const NAME_MAX = 128;
/** 类型系数的十倍：向量计算 1.0 … 视频生成 1.5（B85）。 */
const CLASS_FACTOR: Record<TaskClass, number> = { EM: 10, SP: 11, IG: 12, LL: 13, FT: 14, VG: 15 };

/** 金额写法（TX-20）：整数部分千分位，去掉小数末尾的 0，不舍入。 */
export function formatWeight(raw: string) {
  const [whole, fraction = ""] = raw.split(".");
  const kept = fraction.replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${kept ? `.${kept}` : ""}`;
}
/** 后端给的六位小数去掉末尾的 0，不加千分位，放进输入框（TX-20）。 */
const trimWeight = (raw: string) => raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
/** 权重参考值：分钟 × 类型系数 × 0.001，六位小数，按百万分之一整数算，不经浮点。返回不带千分位的原值。 */
export function referenceWeight(minutes: number, taskClass: TaskClass) {
  const micro = minutes * CLASS_FACTOR[taskClass] * 100;
  const fraction = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${Math.floor(micro / 1_000_000)}${fraction ? `.${fraction}` : ""}`;
}
const sameWeight = (a: string, b: string) => validTaskWeight(a) && validTaskWeight(b) && taskWeightMicros(a) === taskWeightMicros(b);
const durationOk = (value: string) => /^\d+$/.test(value) && Number(value) >= 5 && Number(value) <= 120 && Number(value) % 5 === 0;

function taskDraft(task: PoolTask): E2TaskDraft {
  return { name: task.name, taskClass: task.taskClass, duration: String(task.durationMinutes), weight: task.baseReward ? trimWeight(task.baseReward) : "", enabled: task.enabled };
}

function draftChanged(task: PoolTask, draft: E2TaskDraft) {
  const weight = task.baseReward ?? "";
  return draft.name.trim() !== task.name || draft.taskClass !== task.taskClass
    || Number(draft.duration) !== task.durationMinutes || !(draft.weight === weight || sameWeight(draft.weight, weight));
}

export function isE2TaskEditorDirty(state: E2TaskEditorState) {
  if (state.outcome.kind === "unknown") return false;
  const { task, draft, pool } = state;
  return !!state.reason || (task ? draftChanged(task, draft)
    : !!(draft.name || draft.duration || draft.weight) || draft.taskClass !== "EM" || draft.enabled !== (pool.enabledCount < ENABLED_LIMIT));
}

export function openE2TaskEditor(mode: "create" | "update", pool: TaskPool, task: PoolTask | null, key = crypto.randomUUID()): E2TaskEditorState {
  return {
    mode, pool, task, step: "form", reason: "", saving: false, outcome: { kind: "none" }, key,
    touched: { name: false, taskClass: false, duration: false, weight: false, reason: false },
    draft: task ? taskDraft(task)
      : { name: "", taskClass: "EM", duration: "", weight: "", enabled: pool.enabledCount < ENABLED_LIMIT },
  };
}

export function applyLatestE2Task(state: E2TaskEditorState, task: PoolTask, pool: TaskPool): E2TaskEditorState {
  const before = taskDraft(state.task!);
  const draft = taskDraft(task);
  const changes: Extract<E2TaskOutcome, { kind: "latest" }>["changes"] = [];
  const fields: { field: E2TaskField; label: string; format: (value: string) => string; equal: (a: string, b: string) => boolean }[] = [
    { field: "name", label: "名称", format: value => value, equal: (a, b) => a.trim() === b.trim() },
    { field: "taskClass", label: "类型", format: value => TASK_CLASS_LABELS[value as TaskClass], equal: (a, b) => a === b },
    { field: "duration", label: "时长", format: value => `${value} 分钟`, equal: (a, b) => Number(a) === Number(b) },
    { field: "weight", label: "权重", format: formatWeight, equal: sameWeight },
  ];
  function rebaseField<K extends E2TaskField>(field: K, label: string, format: (value: string) => string, equal: (a: string, b: string) => boolean) {
    const yours = state.draft[field];
    const changed = !equal(before[field], yours);
    if (!equal(before[field], draft[field])) {
      changes.push({ field, label, from: format(before[field]), to: format(draft[field]), ...(changed ? { yours: format(yours) } : {}) });
    }
    if (changed) draft[field] = yours;
  }
  for (const { field, label, format, equal } of fields) rebaseField(field, label, format, equal);
  return { ...state, task, pool, draft, reason: "", touched: { ...state.touched, reason: false }, step: "form", saving: false, outcome: { kind: "latest", changes } };
}

function fieldErrors(draft: E2TaskDraft): Partial<Record<E2TaskField, string>> {
  const name = draft.name.trim();
  return {
    name: !name ? "请填写任务名称" : appVisibleTextError(name, "任务名称") ?? ([...name].length > NAME_MAX ? `任务名称最多 ${NAME_MAX} 个字符` : undefined),
    taskClass: TASK_CLASSES.includes(draft.taskClass) ? undefined : "任务类型无效，请从六种类型中重新选择。",
    duration: durationOk(draft.duration) ? undefined : "时长要填 5–120 分钟，5 的倍数",
    weight: weightError(draft.weight),
  };
}

/** 权重错在哪就说哪（TX-33）；范围写在字段名后面，不在错误里重复。 */
function weightError(value: string) {
  if (!value) return "请填写权重";
  if (!/^\d+(?:\.\d+)?$/.test(value)) return "权重只能填数字，比如 0.05";
  const [whole, fraction = ""] = value.split(".");
  if (whole.length > 12) return "权重整数最多 12 位";
  if (fraction.length > 6) return "权重小数最多 6 位";
  if (!/[1-9]/.test(value)) return "权重要大于 0";
}

export function E2TaskEditor({ state, onChange, onClose, onContinue, reasonRule, levelWeightRange, writeBlock, toast, onSubmit, onReadLatest, frozen }: {
  state: E2TaskEditorState;
  onChange: Dispatch<SetStateAction<E2TaskEditorState | null>>;
  onClose: () => void;
  onContinue: () => void;
  reasonRule: ReturnType<typeof useReasonRule>;
  levelWeightRange: E2LevelWeightRange | null;
  /** 页面级的不能写原因（只读、本等级有结果未知的操作、数据不新鲜）。 */
  writeBlock?: string;
  toast: (message: string) => void;
  onSubmit: (state: E2TaskEditorState) => Promise<void>;
  onReadLatest: (state: E2TaskEditorState) => Promise<void>;
  /** 结果未知时冻结框的那一条提示和底栏，由页面按查询结果、重试被拒、过期给出（OP-93）。 */
  frozen?: { notice: ReactNode; footer: ReactNode };
}) {
  const { mode, pool, task, draft, step, outcome, saving } = state;
  const set = (patch: Partial<E2TaskEditorState>) => onChange(current => current?.key === state.key ? { ...current, ...patch } : current);
  const edit = (patch: Partial<E2TaskDraft>, field?: E2TaskField) => set({
    draft: { ...draft, ...patch },
    outcome: outcome.kind === "rejected" && outcome.field && outcome.field === field ? { kind: "none" } : outcome,
  });
  const touch = (field: E2TaskField | "reason") => onChange(current => current?.key === state.key
    ? { ...current, touched: { ...current.touched, [field]: true } } : current);
  const errors = fieldErrors(draft);
  const shown = (field: E2TaskField) => outcome.kind === "rejected" && outcome.field === field ? outcome.message : state.touched[field] ? errors[field] : undefined;
  const minutes = durationOk(draft.duration) ? Number(draft.duration) : null;
  const reference = minutes === null ? null : referenceWeight(minutes, draft.taskClass);
  const before = task ? { name: task.name, taskClass: task.taskClass, duration: String(task.durationMinutes), weight: task.baseReward ?? "" } : null;
  const nameChanged = !!before && draft.name.trim() !== before.name;
  // 名称最长 128 个字符，放进三列对照会挤成窄条；改了名称时另起两行写全（VS-103「长文字上下排」）。
  const rows: DiffRow[] = before ? [
    ...(nameChanged ? [] : [{ key: "name", label: "名称", before: before.name, after: draft.name.trim() }]),
    { key: "taskClass", label: "类型", before: TASK_CLASS_LABELS[before.taskClass], after: TASK_CLASS_LABELS[draft.taskClass] },
    { key: "duration", label: "时长", before: `${before.duration} 分钟`, after: `${draft.duration} 分钟` },
    { key: "weight", label: "权重", before: before.weight ? formatWeight(before.weight) : "—", after: !draft.weight ? "—" : validTaskWeight(draft.weight) ? formatWeight(draft.weight) : draft.weight },
  ] : [];
  const changed = !task || draftChanged(task, draft);
  const firstError = (Object.keys(errors) as E2TaskField[]).map(field => errors[field]).find(Boolean);
  const formBlock = writeBlock ?? (!changed ? "没有修改" : firstError);
  const reasonLength = visibleReasonLength(state.reason);
  const reasonBlock = e2EditorReasonBlock(state.reason, reasonRule);
  const confirmBlock = formBlock ?? (outcome.kind === "conflict" ? "请先读取最新内容" : reasonBlock);
  const dirty = isE2TaskEditorDirty(state);
  const weightUp = before && validTaskWeight(draft.weight) && validTaskWeight(before.weight) && !sameWeight(draft.weight, before.weight)
    ? taskWeightMicros(draft.weight) > taskWeightMicros(before.weight) : null;
  const direction = weightUp === null || !task ? undefined : !task.enabled ? "这条任务已停用，现在不参加分配；启用后按新权重计算。"
    : "之后新派到这条任务时按新权重计算；每单实际多少，要和设备当时能接的其他任务一起算。";
  const range = levelWeightRange && `本等级启用的 ${levelWeightRange.count} 个任务：权重 ${formatWeight(levelWeightRange.min)}${sameWeight(levelWeightRange.min, levelWeightRange.max) ? "" : `–${formatWeight(levelWeightRange.max)}`}`;
  const reasonRejected = outcome.kind === "rejected" && isE2ReasonRejection(outcome.code) ? outcome.message : undefined;
  const close = () => { if (!saving) onClose(); };
  const continueEditing = () => { onContinue(); set({ step: "form" }); };
  const leave = () => { if (saving) return; if (step === "leaving") continueEditing(); else if (dirty) set({ step: "leaving" }); else close(); };
  const cancelConfirm = () => { onContinue(); set({ step: "form", reason: "", touched: { ...state.touched, reason: false } }); };
  const toConfirm = () => {
    const touched = { ...state.touched, name: true, taskClass: true, duration: true, weight: true };
    onChange({ ...state, touched, step: formBlock ? state.step : "confirm" });
  };
  const label = mode === "create" ? "新增任务" : "修改任务";
  const unknown = outcome.kind === "unknown" ? outcome : null;

  return <>
    {!unknown && <Drawer open onClose={leave} busy={saving} icon={mode === "create" ? Plus : Pencil}
      onInteractOutside={event => {
        const target = event.detail.originalEvent.target;
        if (dirty && target instanceof Element && target.closest(".e2-levels [role=tab], [data-e2-switch-pool], [data-e2-editor-leave], a[href]")) event.preventDefault();
      }}
      title={step === "leaving" ? "任务改动还没保存" : mode === "create" ? "新增任务" : "编辑任务"} sub={`${pool.code} ${pool.name}`}
      explain={step === "leaving" ? undefined : mode === "create" ? "按填的名称、类型、时长和权重加一条任务，确认后立即生效。"
        : "改名称、类型、时长和权重，确认后立即生效。不能换等级：要放到别的等级，就在那个等级新增一条，再停用这条。"}
      footer={step === "leaving"
        ? <Decision others={<><Button onClick={continueEditing}>继续编辑</Button><Button variant="danger-outline" onClick={close}>放弃改动并返回</Button></>}
          primary={<Button variant="primary" disabledReason={formBlock} onClick={toConfirm}>保存并立即生效</Button>} />
        : <Decision explain="下一步核对改动、填写操作理由，确认后立即生效。" others={<Button disabled={saving} onClick={leave}>取消</Button>}
          primary={<Button variant="primary" disabledReason={formBlock} onClick={toConfirm}>{mode === "create" ? "新增任务" : "保存修改"}</Button>} />}>
      {step === "leaving" ? <p>{mode === "create" ? "放弃后，这次填的内容不保存，也不会新增任务。" : "放弃后，这次改的内容都不保存，任务保持原样。"}</p>
        : <div className="rd-stack e2-editor">
          {outcome.kind === "latest" && <Notice tone="warn" title="这条任务刚被别人改过，已换成最新内容">
            <ul className="e2-editor-changes">{outcome.changes.map(row => <li key={row.field}><span>{row.label}</span><span><Change from={row.from} to={row.to} settled />
              {row.yours && <span className="e2-editor-yours">你填的 {row.yours} 保留</span>}</span></li>)}</ul>
            <p>你改过的项保留了，其余已换成最新的，核对后再保存。</p>
          </Notice>}
          {task && <Facts><Fact k="状态"><StatusTag tone={task.enabled ? "ok" : "done"} explain="启用、停用在任务表里勾选后操作。">{task.enabled ? "已启用" : "已停用"}</StatusTag></Fact></Facts>}
          <Field label="任务名称" required hint={`1–${NAME_MAX} 个字符`} help={shown("name") ? undefined : APP_VISIBLE_TEXT_HINT} error={shown("name")}
            explain={<><p>设备接到这条任务时显示的名字，同一等级里不能重名。</p><p>显示位置：App 设备的当前任务、凭证列表和凭证详情「作业名称」。</p><p>确认后用于之后新派的任务。</p></>}>
            <Input value={draft.name} disabled={saving} placeholder="例如：Vector Embedding · Catalog Index" onChange={event => edit({ name: event.target.value }, "name")} onBlur={() => touch("name")} />
          </Field>
          <Field label="任务类型" required explain="这条任务算哪一类。六类任选，不限于这个等级默认开放的类型；换类型会换权重参考值。" error={shown("taskClass")}>
            <Select aria-label="任务类型" value={draft.taskClass} disabled={saving} onChange={taskClass => edit({ taskClass: taskClass as TaskClass }, "taskClass")}
              options={TASK_CLASSES.map(value => ({ value, label: TASK_CLASS_LABELS[value] }))} />
          </Field>
          <Field label="时长" required hint="5–120，5 的倍数" error={shown("duration")} explain="设备跑一单要多久。确认后用于之后新派的任务，正在做的任务不变。">
            <NumberInput unit="分钟" min={5} max={120} step={5} value={draft.duration} disabled={saving} onChange={event => edit({ duration: event.target.value }, "duration")} onBlur={() => touch("duration")} />
          </Field>
          <div className="e2-weight-field">
            <Field label="权重" required hint="大于 0，整数最多 12 位，小数最多 6 位" error={shown("weight")}
              explain={<><p>不是每单的钱，只决定这条任务在同等级启用任务里分得多还是少；同一条任务在不同商品、不同天拿到的钱不同。</p><p>参考值按时长和类型算，可以填别的数。</p></>}>
              <NumberInput min="0.000001" step={0.000001} value={draft.weight} disabled={saving} onChange={event => edit({ weight: event.target.value }, "weight")} onBlur={() => touch("weight")} />
            </Field>
            <div className="rd-form-help e2-editor-ref">{reference === null ? "填好时长后给出参考值" : <>参考值 <b>{formatWeight(reference)}</b>
              <Button size="sm" variant="ghost" disabled={saving} disabledReason={sameWeight(draft.weight, reference) ? "已经是参考值" : undefined}
                onClick={() => edit({ weight: reference }, "weight")}>填入参考值</Button></>}
              {range && <span className="e2-editor-line">{range}</span>}
              {direction && <span className="e2-editor-line">{direction}</span>}</div>
          </div>
          {mode === "create" && <Check label="新增后立即启用" checked={draft.enabled} disabled={saving || pool.enabledCount >= ENABLED_LIMIT}
            help={pool.enabledCount >= ENABLED_LIMIT ? `这个等级已启用 ${ENABLED_LIMIT} 个，到上限了，只能先加为停用。` : undefined}
            explain="不勾选就先加为停用，不参加派单，之后在任务表勾选启用。" onChange={event => edit({ enabled: event.target.checked })} />}
        </div>}
    </Drawer>}

    {(step === "confirm" || unknown) && <Modal title={unknown ? unknown.expired ? "原操作已过重试时限" : "核对原操作" : label}
      icon={unknown ? ClipboardList : mode === "create" ? Plus : Pencil} busy={saving} dirty={!unknown && !!state.reason}
      sub={unknown ? undefined : <StatusTag tone="progress" filled>立即生效</StatusTag>}
      onClose={() => { if (saving) return; if (unknown) close(); else cancelConfirm(); }}
      footer={unknown ? frozen?.footer ?? <><Button disabled={saving} onClick={close}>收起</Button>
          {!unknown.expired && <Button variant="primary" disabledReason={writeBlock}>按原请求重试</Button>}</>
        : <><Button disabled={saving} onClick={cancelConfirm}>取消</Button>
          <Button variant="primary" loading={saving} loadingText="提交中…" disabledReason={saving ? undefined : confirmBlock}
            onClick={() => { set({ touched: { ...state.touched, reason: true } }); if (!confirmBlock) void onSubmit(state); }}>{mode === "create" ? "确认新增" : "确认修改"}</Button></>}>
      <div className="rd-stack">
        {unknown && (frozen?.notice ?? <Notice tone="warn" title="结果未知，原操作已冻结">{writeBlock}</Notice>)}
        <Facts><Fact k="任务等级">{pool.code} {pool.name}</Fact>
          {task && !nameChanged && <Fact k="任务">{task.name}</Fact>}
          {task && nameChanged && <><Fact k="现在名称">{task.name}</Fact><Fact k="改后名称" tone="progress">{draft.name.trim()}</Fact></>}
          {unknown && <Fact k="首次提交">{businessStamp(unknown.createdAt)} · {businessZoneText()}</Fact>}
          {mode === "create" && <>
            <Fact k="名称">{draft.name.trim()}</Fact>
            <Fact k="类型"><TaskClassTag taskClass={draft.taskClass} /></Fact>
            <Fact k="时长">{draft.duration} 分钟</Fact>
            <Fact k="权重">{formatWeight(draft.weight)}{reference !== null && !sameWeight(draft.weight, reference) && <span className="e2-editor-yours">参考值 {formatWeight(reference)}</span>}</Fact>
            <Fact k="新增后">{draft.enabled ? "立即启用" : "先不启用"}</Fact>
          </>}
        </Facts>
        {mode === "update" && <DiffList rows={rows} restTitle="其余内容" emptyNote={nameChanged ? "只改了名称" : undefined} />}
        {direction && <p className="e2-editor-note">{direction}</p>}
        {!unknown && <Notice tone="neutral">{mode === "update" ? "只影响之后新派的任务；已派出的按派出时的时长和收益完成。"
          : draft.enabled ? "确认后加入当前等级，供之后新派的任务使用。" : "确认后先加为停用，不参加派单；在任务表启用后才会派。"}</Notice>}
        {unknown ? <Facts><Fact k="原操作理由">{state.reason.trim()}</Fact></Facts>
          : <Field label="操作理由" required hint={reasonRule.ready ? `至少 ${reasonRule.min} 字` : undefined} explain="记录这次调整的依据，随这次操作写入操作记录。"
            help={reasonRule.ready ? undefined : reasonBlock} error={reasonRejected ?? (reasonRule.ready && state.touched.reason ? reasonBlock : undefined)}>
            <Textarea rows={3} maxLength={400} count={reasonRule.ready ? `${reasonLength}/${reasonRule.max}` : undefined} placeholder="写清调整原因和依据" value={state.reason} disabled={saving || outcome.kind === "conflict"}
              onChange={event => set({ reason: event.target.value, ...(reasonRejected ? { outcome: { kind: "none" } } : {}) })} onBlur={() => touch("reason")} />
          </Field>}
        {outcome.kind === "conflict" && <Notice tone="warn" title="这条任务刚被别人改过，这次没有保存">
          <ConflictBar message="读取最新后，你改过的内容会保留，再核对一遍。" onRead={() => onReadLatest(state)} /></Notice>}
        {(outcome.kind === "rejected" && !outcome.field && !reasonRejected || outcome.kind === "conflict") && outcome.message && <Notice tone="danger">{outcome.message}</Notice>}
        <Fold title="执行摘要" summary="立即生效，不经审批"><p>{mode === "update" ? "每次修改都会留下记录。两人同时改同一条时，后提交的会被拒，要读取最新后再改。"
          : "每级最多启用 200 个、共 300 个任务（含停用）。同一等级里任务名称不能重名。"}</p></Fold>
        <Fold title="技术信息" summary="任务池与请求编号"><Facts><Fact k="任务池">{pool.code}</Fact>
          <Fact k="请求编号"><span data-mono className="e2-request-key">{state.key}</span><Button size="sm" variant="ghost"
            onClick={() => { void navigator.clipboard.writeText(state.key).then(() => toast("请求编号已复制"), () => toast("复制失败，请选中完整编号复制。")); }}>复制编号</Button></Fact>
          {outcome.kind === "rejected" && outcome.code && <Fact k="原错误码">{outcome.code}</Fact>}</Facts>
          <p>权重参考值：每分钟 0.001，向量计算、语音处理、图像生成、大模型推理、模型微调、视频生成依次乘 1.0、1.1、1.2、1.3、1.4、1.5。</p></Fold>
      </div>
    </Modal>}
  </>;
}
