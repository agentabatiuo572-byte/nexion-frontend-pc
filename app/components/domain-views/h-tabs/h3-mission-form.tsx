"use client";

/**
 * H3 新建任务的填写抽屉：左边填，右边看这个任务在 App 上的样子和建好后的状态。
 * 只收集表单值（和原共用确认框 mission-create 表单同样的键、初值和字符串值），校验照原表单一条不改；
 * 点「下一步」后由页面打开确认框写理由，提交内容仍由页面原来的 run 拼出。
 */
import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { Button, Decision, Drawer, Field, Input, Modal, Notice, NumberInput, Select, StatusTag } from "@/app/components/rd";
import { TASK_ACTION_ROUTES, TASK_ACTION_ROUTE_LABELS, TASK_CATEGORY_LABELS, TASK_CATEGORY_OPTIONS, amountText } from "./h3-quest-parts";
import { h3MissionCreationRefusal } from "@/lib/admin/h3-contract";
import { displayAdminError } from "@/lib/admin/error-messages";

export type H3MissionForm = Record<string, string>;

/** 和原 mission-create 表单 initBusinessForm 同样的初值。 */
export const MISSION_FORM_INITIAL: H3MissionForm = { category: "explore", actionRoute: "/pages/missions/missions" };

/** 原表单的校验（design-kit mission-create），一条不改；按字段归位，好写在字段下面。 */
export function missionFormErrors(state: H3MissionForm, missionType: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!state.missionCode?.trim()) e.missionCode = "请填写任务编号";
  const refusal = h3MissionCreationRefusal(missionType, state.missionCode?.trim() ?? "");
  if (refusal) e.missionCode = displayAdminError(new Error(refusal));
  if (!state.missionName?.trim()) e.missionName = "请填写任务名称";
  if (!state.rewardPoints?.trim()) e.rewardPoints = "请填写奖励 UVT 数";
  if (!state.category?.trim()) e.category = "请选择任务类别";
  if (!state.actionRoute?.trim()) e.actionRoute = "请选择去完成页面";
  if (!e.rewardPoints && (!Number.isSafeInteger(Number(state.rewardPoints)) || Number(state.rewardPoints) < 0)) e.rewardPoints = "奖励 UVT 数须为非负整数";
  return e;
}

const SUBJECT_TEXT: Record<string, string> = {
  DAY_ONE: "新手任务",
  WEEKLY_T1: "每周一档任务",
  WEEKLY_T2: "每周二档任务",
};

export function H3MissionFormDrawer({ missionType, readFailed, onClose, onReview }: {
  missionType: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2";
  /** 抽屉开着时页面重读失败：抽屉和填的内容留着，读到前不能进下一步。 */
  readFailed?: { retrying: boolean; onRetry: () => void };
  onClose: () => void;
  onReview: (value: H3MissionForm) => void;
}) {
  const [value, setValue] = useState<H3MissionForm>(MISSION_FORM_INITIAL);
  const [attempted, setAttempted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const errors = useMemo(() => missionFormErrors(value, missionType), [value, missionType]);
  const creationRefusal = h3MissionCreationRefusal(missionType, value.missionCode?.trim() ?? "");
  const shown = attempted ? errors : {};
  const missing = Object.values(errors);
  const dirty = JSON.stringify(value) !== JSON.stringify(MISSION_FORM_INITIAL);
  const set = (key: string, next: string) => setValue((state) => ({ ...state, [key]: next }));
  const close = () => { if (dirty) setLeaving(true); else onClose(); };
  const review = () => { setAttempted(true); if (missing.length === 0) onReview(value); };
  const subject = SUBJECT_TEXT[missionType];
  const reward = /^\d+$/.test(value.rewardPoints?.trim() ?? "") ? value.rewardPoints.trim() : null;
  const needsApproval = reward != null && Number(reward) > 0;
  return (
    <>
      <Drawer open wide onClose={close} title={`新建${subject}`} sub="建好后是已停用" icon={ListChecks} tone="role-4"
        explain="左边填，右边看它在 App 上的样子。名称建好后可以在任务详情里分别填英文、中文、越南语。点「下一步」后核对、写理由再提交。建好的任务先是已停用，要先在「完成条件」里绑定用户做了什么算完成，再启用。"
        footer={<Decision note={attempted && missing.length ? `还有 ${missing.length} 项要改：${missing.join("；")}` : undefined}
          primary={<Button variant="primary" disabledReason={readFailed ? "最新数据读到后才能继续" : creationRefusal ? displayAdminError(new Error(creationRefusal)) : undefined} onClick={review}>下一步：核对并提交</Button>}
          others={<Button onClick={close}>取消</Button>} />}>
        <div className="rd-split h3-form-split" data-detail="" data-preview="">
          <div className="h3-form">
            {readFailed && <Notice tone="warn" title="最新数据没读到"
              action={<Button size="sm" loading={readFailed.retrying} onClick={readFailed.onRetry}>重试读取</Button>}>
              填的内容还在，读到以后才能继续。
            </Notice>}
            <Field label="任务编号" required hint="英文和数字" error={shown.missionCode ?? (creationRefusal ? displayAdminError(new Error(creationRefusal)) : undefined)}>
              {(control) => <Input {...control} value={value.missionCode ?? ""} placeholder="如 dayOne-visit-earn" onChange={(event) => set("missionCode", event.target.value)} />}
            </Field>
            <Field label="任务名称" required error={shown.missionName}>
              {(control) => <Input {...control} value={value.missionName ?? ""} placeholder="如 逛收益页" onChange={(event) => set("missionName", event.target.value)} />}
            </Field>
            <Field label="奖励" required hint="非负整数" error={shown.rewardPoints}
>
              {(control) => <NumberInput {...control} unit="UVT" min={0} step={1} value={value.rewardPoints ?? ""} onChange={(event) => set("rewardPoints", event.target.value)} />}
            </Field>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="任务类别" required error={shown.category}>
                {(control) => <Select {...control} aria-label="任务类别" value={value.category ?? ""} onChange={(next) => set("category", next)}
                  options={TASK_CATEGORY_OPTIONS.map((option) => ({ value: option, label: TASK_CATEGORY_LABELS[option] }))} />}
              </Field>
              <Field label="点「去完成」跳到" required error={shown.actionRoute}>
                {(control) => <Select {...control} aria-label="点「去完成」跳到" value={value.actionRoute ?? ""} onChange={(next) => set("actionRoute", next)}
                  options={TASK_ACTION_ROUTES.map((route) => ({ value: route, label: TASK_ACTION_ROUTE_LABELS[route] ?? route }))} />}
              </Field>
            </div>
          </div>
          <aside className="h3-form-preview" aria-label="建好后">
            <h3 className="h3-form-title">建好后</h3>
            <div className="h3-phone h3-phone-single">
              <div className="h3-phone-hero">
                <span className="h3-phone-cat">{TASK_CATEGORY_LABELS[value.category] ?? "其他"}</span>
                <b>{value.missionName?.trim() || "任务名称"}</b>
                {missionType !== "DAY_ONE" && <span className="h3-phone-reward">{reward == null ? "—" : `+${amountText(reward)} UVT`}</span>}
                <span className="h3-phone-go">{`去完成 › ${TASK_ACTION_ROUTE_LABELS[value.actionRoute] ?? ""}`}</span>
              </div>
            </div>
            <dl className="h3-form-facts">
              <div><dt>任务编号</dt><dd>不能和已有的重复，建好后不能改</dd></div>
              <div><dt>状态</dt><dd><StatusTag tone="neutral">已停用</StatusTag></dd></div>
              <div><dt>用户什么时候看到</dt><dd>绑定条件并启用后才发给用户</dd></div>
              {missionType === "DAY_ONE" && <div><dt>奖励</dt><dd>不单发，做完全部新手任务统一领「新手任务奖励」</dd></div>}
              {missionType !== "DAY_ONE" && <div><dt>怎么生效</dt><dd>{reward == null ? "—" : needsApproval ? "奖励大于 0：提交审批，批准前不建" : "奖励是 0：确认后直接建好"}</dd></div>}
            </dl>
            {missionType === "DAY_ONE" && needsApproval && <Notice tone="neutral">奖励大于 0 要提交审批，另一位超级管理员批准后才建。</Notice>}
          </aside>
        </div>
      </Drawer>
      {leaving && (
        <Modal title="放弃这次填写？" onClose={() => setLeaving(false)}
          footer={<><Button onClick={() => setLeaving(false)}>继续填写</Button><Button variant="danger" onClick={() => { setLeaving(false); onClose(); }}>放弃</Button></>}>
          <p>填写的内容不会保存。</p>
        </Modal>
      )}
    </>
  );
}
