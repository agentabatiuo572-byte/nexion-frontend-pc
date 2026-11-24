"use client";
/**
 * E2 单条任务的「编辑」「新增」：抽屉填写 → 叠一层确认框核对前后值、填理由（OP-12、OP-31、PG-38）。
 * 抽屉不挡下面的任务表（PG-37：权重要对照同等级其他任务边看边填）。
 *
 * 状态全在一个值里（E2TaskEditorState），由 E2Tasks 持有：打开、填写、确认、提交中、被拒、被别人改过、
 * 读到最新、结果未知都只改这一个值。请求、去重、结果未知的保存和恢复「待 Codex 接入」：
 * 提交走 onSubmit，读最新走 onReadLatest，结果未知的原样重试走 onRetry，三者现在都是空实现。
 */
import "./e2-task-editor.css";
import { ClipboardList, Pencil, Plus } from "lucide-react";
import { Button, Change, Check, ConflictBar, Decision, DiffList, Drawer, Fact, Facts, Field, Fold, Input, Modal, Notice,
  NumberInput, Select, StatusTag, TaskClassTag, Textarea, type DiffRow } from "@/app/components/rd";
import { APP_VISIBLE_TEXT_HINT, appVisibleTextError } from "@/lib/admin/content-language-rules";
import { businessStamp, businessZoneText } from "@/lib/admin/business-time";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import type { PoolTask, TaskClass, TaskPool } from "@/lib/admin/task-pool-client";

export type E2TaskField = "name" | "taskClass" | "duration" | "weight";
export interface E2TaskDraft { name: string; taskClass: TaskClass; duration: string; weight: string; enabled: boolean }
/** 提交后的样子。待 Codex 接入：按接口回包设置。 */
export type E2TaskOutcome =
  | { kind: "none" }
  /** 明确被拒。带 field 的回到抽屉写在这一项下面（OP-15），不带的留在确认框（OP-81）。 */
  | { kind: "rejected"; message: string; field?: E2TaskField; code?: string }
  /** 这条任务已被别人改过（409 TASK_TYPE_VERSION_CONFLICT）：框不关，读最新（OP-97）。 */
  | { kind: "conflict" }
  /** 读到最新后回到抽屉：别人改了什么；yours 是自己也改过、保留下来的值。 */
  | { kind: "latest"; changes: { field: E2TaskField; label: string; from: string; to: string; yours?: string }[] }
  /** 结果未知：内容冻结，只能按原请求重试（OP-93、OP-94）。 */
  | { kind: "unknown"; createdAt: number; expired?: boolean };
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

const ENABLED_LIMIT = 200;
const NAME_MAX = 128;
const WEIGHT_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
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
const sameWeight = (a: string, b: string) => WEIGHT_PATTERN.test(a) && WEIGHT_PATTERN.test(b) && formatWeight(a) === formatWeight(b);
const durationOk = (value: string) => /^\d+$/.test(value) && Number(value) >= 5 && Number(value) <= 120 && Number(value) % 5 === 0;

export function openE2TaskEditor(mode: "create" | "update", pool: TaskPool, task: PoolTask | null): E2TaskEditorState {
  return {
    mode, pool, task, step: "form", reason: "", saving: false, outcome: { kind: "none" }, key: crypto.randomUUID(),
    touched: { name: false, taskClass: false, duration: false, weight: false, reason: false },
    draft: task ? { name: task.name, taskClass: task.taskClass, duration: String(task.durationMinutes), weight: task.baseReward ? trimWeight(task.baseReward) : "", enabled: task.enabled }
      : { name: "", taskClass: "EM", duration: "", weight: "", enabled: pool.enabledCount < ENABLED_LIMIT },
  };
}

function fieldErrors(draft: E2TaskDraft): Partial<Record<E2TaskField, string>> {
  const name = draft.name.trim();
  return {
    name: !name ? "请填写任务名称" : appVisibleTextError(name, "任务名称") ?? ([...name].length > NAME_MAX ? `任务名称最多 ${NAME_MAX} 个字符` : undefined),
    duration: durationOk(draft.duration) ? undefined : "时长要填 5–120 分钟，5 的倍数",
    weight: WEIGHT_PATTERN.test(draft.weight) && /[1-9]/.test(draft.weight) ? undefined : "权重要大于 0，最多 6 位小数",
  };
}

export function E2TaskEditor({ state, onChange, writeBlock, toast, onSubmit, onReadLatest, onRetry }: {
  state: E2TaskEditorState;
  onChange: (next: E2TaskEditorState | null) => void;
  /** 页面级的不能写原因（只读、本等级有结果未知的操作、数据不新鲜）。 */
  writeBlock?: string;
  toast: (message: string) => void;
  /** 待 Codex 接入：发送新增或修改，按回包改 state.outcome。 */
  onSubmit: (state: E2TaskEditorState) => Promise<void>;
  /** 待 Codex 接入：被别人改过后读最新，回到抽屉，自己改过的项保留、理由清空（OP-97）。 */
  onReadLatest: (state: E2TaskEditorState) => Promise<void>;
  /** 待 Codex 接入：结果未知时按原请求重试。 */
  onRetry: (state: E2TaskEditorState) => Promise<void>;
}) {
  const { mode, pool, task, draft, step, outcome, saving } = state;
  const set = (patch: Partial<E2TaskEditorState>) => onChange({ ...state, ...patch });
  const edit = (patch: Partial<E2TaskDraft>, field?: E2TaskField) => set({
    draft: { ...draft, ...patch },
    outcome: outcome.kind === "rejected" && outcome.field && outcome.field === field ? { kind: "none" } : outcome,
  });
  const touch = (field: E2TaskField | "reason") => set({ touched: { ...state.touched, [field]: true } });
  const errors = fieldErrors(draft);
  const shown = (field: E2TaskField) => outcome.kind === "rejected" && outcome.field === field ? outcome.message : state.touched[field] ? errors[field] : undefined;
  const minutes = durationOk(draft.duration) ? Number(draft.duration) : null;
  const reference = minutes === null ? null : referenceWeight(minutes, draft.taskClass);
  const before = task ? { name: task.name, taskClass: task.taskClass, duration: String(task.durationMinutes), weight: task.baseReward ?? "" } : null;
  const rows: DiffRow[] = before ? [
    { key: "name", label: "名称", before: before.name, after: draft.name.trim() },
    { key: "taskClass", label: "类型", before: TASK_CLASS_LABELS[before.taskClass], after: TASK_CLASS_LABELS[draft.taskClass] },
    { key: "duration", label: "时长", before: `${before.duration} 分钟`, after: `${draft.duration} 分钟` },
    { key: "weight", label: "权重", before: before.weight ? formatWeight(before.weight) : "—", after: WEIGHT_PATTERN.test(draft.weight) ? formatWeight(draft.weight) : draft.weight },
  ] : [];
  const changed = !before || draft.name.trim() !== before.name || draft.taskClass !== before.taskClass
    || Number(draft.duration) !== Number(before.duration) || !sameWeight(draft.weight, before.weight);
  const firstError = (Object.keys(errors) as E2TaskField[]).map(field => errors[field]).find(Boolean);
  const formBlock = writeBlock ?? firstError ?? (!changed ? "没有修改" : undefined);
  const reasonLength = Array.from(state.reason.trim()).length;
  const reasonReady = reasonLength >= 8 && reasonLength <= 200;
  const confirmBlock = formBlock ?? (outcome.kind === "conflict" ? "请先读取最新内容" : !reasonReady ? "请填写 8–200 字的操作理由" : undefined);
  const dirty = changed && mode === "update" || mode === "create" && !!(draft.name || draft.duration || draft.weight);
  const weightUp = before && WEIGHT_PATTERN.test(draft.weight) && WEIGHT_PATTERN.test(before.weight) && !sameWeight(draft.weight, before.weight)
    ? Number(draft.weight) > Number(before.weight) : null;
  const direction = weightUp === null ? undefined : weightUp ? "调高后，这条任务在同等级里分得更多，其他任务相应少一些。" : "调低后，这条任务在同等级里分得更少，其他任务相应多一些。";
  const close = () => { if (!saving) onChange(null); };
  const leave = () => { if (saving) return; if (step === "leaving") set({ step: "form" }); else if (dirty) set({ step: "leaving" }); else close(); };
  const toConfirm = () => {
    const touched = { ...state.touched, name: true, taskClass: true, duration: true, weight: true };
    onChange({ ...state, touched, step: formBlock ? state.step : "confirm" });
  };
  const label = mode === "create" ? "新增任务" : "修改任务";
  const unknown = outcome.kind === "unknown" ? outcome : null;

  return <>
    {!unknown && <Drawer open onClose={leave} busy={saving} icon={mode === "create" ? Plus : Pencil}
      title={step === "leaving" ? "任务改动还没保存" : mode === "create" ? "新增任务" : "编辑任务"} sub={`${pool.code} ${pool.name}`}
      explain={step === "leaving" ? undefined : mode === "create" ? "按填的名称、类型、时长和权重加一条任务，确认后立即生效。"
        : "改名称、类型、时长和权重，确认后立即生效。不能换等级：要放到别的等级，就在那个等级新增一条，再停用这条。"}
      footer={step === "leaving"
        ? <Decision others={<><Button onClick={() => set({ step: "form" })}>继续编辑</Button><Button variant="danger-outline" onClick={close}>放弃改动并返回</Button></>}
          primary={<Button variant="primary" disabledReason={formBlock} onClick={toConfirm}>保存并立即生效</Button>} />
        : <Decision explain="下一步核对改动、填写操作理由，确认后立即生效。" others={<Button disabled={saving} onClick={leave}>取消</Button>}
          primary={<Button variant="primary" disabledReason={formBlock} onClick={toConfirm}>{mode === "create" ? "新增任务" : "保存修改"}</Button>} />}>
      {step === "leaving" ? <p>可以继续编辑、放弃改动，或核对后保存。</p>
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
          <Field label="权重" required hint="大于 0，最多 6 位小数" error={shown("weight")}
            explain={<><p>不是每单的钱，只决定这条任务在同等级启用任务里分得多还是少；同一条任务在不同商品、不同天拿到的钱不同。</p><p>参考值按时长和类型算，可以填别的数。</p></>}
            help={<span className="e2-editor-ref">{reference === null ? "填好时长后给出参考值" : <>参考值 <b>{formatWeight(reference)}</b>
              <Button size="sm" variant="ghost" disabled={saving} disabledReason={sameWeight(draft.weight, reference) ? "已经是参考值" : undefined}
                onClick={() => edit({ weight: reference }, "weight")}>填入参考值</Button></>}
              {direction && <span className="e2-editor-direction">{direction}</span>}</span>}>
            <NumberInput min={0} step={0.000001} value={draft.weight} disabled={saving} onChange={event => edit({ weight: event.target.value }, "weight")} onBlur={() => touch("weight")} />
          </Field>
          {mode === "create" && <Check label="新增后立即启用" checked={draft.enabled} disabled={saving || pool.enabledCount >= ENABLED_LIMIT}
            help={pool.enabledCount >= ENABLED_LIMIT ? `这个等级已启用 ${ENABLED_LIMIT} 个，到上限了，只能先加为停用。` : undefined}
            explain="不勾选就先加为停用，不参加派单，之后在任务表勾选启用。" onChange={event => edit({ enabled: event.target.checked })} />}
        </div>}
    </Drawer>}

    {(step === "confirm" || unknown) && <Modal title={unknown ? unknown.expired ? "原操作已过重试时限" : "核对原操作" : label}
      icon={unknown ? ClipboardList : mode === "create" ? Plus : Pencil} busy={saving} dirty={!unknown && !!state.reason}
      sub={unknown ? undefined : <StatusTag tone="progress" filled>立即生效</StatusTag>}
      onClose={() => { if (saving) return; if (unknown) close(); else set({ step: "form", reason: "", touched: { ...state.touched, reason: false } }); }}
      footer={unknown ? <><Button disabled={saving} onClick={close}>收起</Button>
          {!unknown.expired && <Button variant="primary" loading={saving} loadingText="提交中…" disabledReason={writeBlock} onClick={() => void onRetry(state)}>按原请求重试</Button>}</>
        : <><Button disabled={saving} onClick={() => set({ step: "form", reason: "", touched: { ...state.touched, reason: false } })}>取消</Button>
          <Button variant="primary" loading={saving} loadingText="提交中…" disabledReason={saving ? undefined : confirmBlock}
            onClick={() => { set({ touched: { ...state.touched, reason: true } }); if (!confirmBlock) void onSubmit(state); }}>{mode === "create" ? "确认新增" : "确认修改"}</Button></>}>
      <div className="rd-stack">
        {unknown && <Notice tone="warn" title={unknown.expired ? "已超过 24 小时，不能再重试" : "结果未知，原操作已冻结"}>
          {unknown.expired ? "原请求继续保留，请核对操作记录；这个等级仍暂停新操作。" : "只能按原请求重试：系统认得出是同一次提交，不会重复执行。"}</Notice>}
        <Facts><Fact k="任务等级">{pool.code} {pool.name}</Fact>
          {task && (unknown || draft.name.trim() === task.name) && <Fact k="任务">{task.name}</Fact>}
          {unknown && <Fact k="首次提交">{businessStamp(unknown.createdAt)} · {businessZoneText()}</Fact>}
          {mode === "create" && <>
            <Fact k="名称">{draft.name.trim()}</Fact>
            <Fact k="类型"><TaskClassTag taskClass={draft.taskClass} /></Fact>
            <Fact k="时长">{draft.duration} 分钟</Fact>
            <Fact k="权重">{formatWeight(draft.weight)}{reference !== null && !sameWeight(draft.weight, reference) && <span className="e2-editor-yours">参考值 {formatWeight(reference)}</span>}</Fact>
            <Fact k="新增后">{draft.enabled ? "立即启用" : "先不启用"}</Fact>
          </>}
        </Facts>
        {mode === "update" && <DiffList rows={rows} restTitle="其余内容" />}
        {direction && <p className="e2-editor-note">{direction}</p>}
        {!unknown && <Notice tone="neutral">{mode === "update" ? "只影响之后新派的任务，正在做的任务按原来的金额结算。"
          : draft.enabled ? "确认后加入当前等级，供之后新派的任务使用。" : "确认后先加为停用，不参加派单；在任务表启用后才会派。"}</Notice>}
        {unknown ? <Facts><Fact k="原操作理由">{state.reason.trim()}</Fact></Facts>
          : <Field label="操作理由" required hint="至少 8 字" explain="记录这次调整的依据，随这次操作写入操作记录。"
            error={state.touched.reason && !reasonReady ? "请填写 8–200 字的操作理由" : undefined}>
            <Textarea rows={3} maxLength={400} count={`${reasonLength}/200`} placeholder="写清调整原因和依据" value={state.reason} disabled={saving || outcome.kind === "conflict"}
              onChange={event => set({ reason: event.target.value })} onBlur={() => touch("reason")} />
          </Field>}
        {outcome.kind === "conflict" && <Notice tone="warn" title="这条任务刚被别人改过，这次没有保存">
          <ConflictBar message="读取最新后，你改过的内容会保留，再核对一遍。" onRead={() => onReadLatest(state)} /></Notice>}
        {outcome.kind === "rejected" && !outcome.field && <Notice tone="danger">{outcome.message}</Notice>}
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
