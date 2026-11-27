"use client";

/**
 * H3 新建任务的填写抽屉：左边填，右边看这个任务在 App 上的样子和建好后的状态。
 * 只收集表单值，去完成页面按当前任务编号与读模型候选校验；
 * 点「下一步」后由页面打开确认框写理由，提交内容仍由页面原来的 run 拼出。
 */
import { useState } from "react";
import { ListChecks } from "lucide-react";
import { Button, Decision, Drawer, Field, InlineRetry, Input, Modal, Notice, NumberInput, SearchSelect, Select, StatusTag } from "@/app/components/rd";
import { PreviewTarget, TASK_CATEGORY_LABELS, TASK_CATEGORY_OPTIONS, amountText } from "./h3-quest-parts";
import { h3ActionRoutes } from "@/lib/admin/config-help/h3-task";
import { h3MissionCreationRefusal, type H3ProductActionTarget } from "@/lib/admin/h3-contract";
import { displayAdminError } from "@/lib/admin/error-messages";

export type H3MissionForm = Record<string, string>;

/** 和原 mission-create 表单 initBusinessForm 同样的初值。 */
export const MISSION_FORM_INITIAL: H3MissionForm = { category: "explore", actionRoute: "/pages/missions/missions" };

// GrowthMissionRequest.rewardPoints is a Java Integer (also enforced at approval).
const MAX_MISSION_REWARD_POINTS = 2_147_483_647;

function readMissionReward(input = ""): { value: number | null; error?: string } {
  if (!input.trim()) return { value: null, error: "请填写奖励 UVT 数" };
  if (/[^0-9]/.test(input)) return { value: null, error: "奖励 UVT 数须为非负整数" };
  const value = Number(input);
  if (value > MAX_MISSION_REWARD_POINTS) {
    return { value: null, error: `奖励不能超过 ${amountText(String(MAX_MISSION_REWARD_POINTS))} UVT` };
  }
  return { value };
}

function missionFormErrors(state: H3MissionForm, missionType: string, rewardError?: string, routeError?: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!state.missionCode?.trim()) e.missionCode = "请填写任务编号";
  const refusal = h3MissionCreationRefusal(missionType, state.missionCode?.trim() ?? "");
  if (refusal) e.missionCode = displayAdminError(new Error(refusal));
  if (!state.missionName?.trim()) e.missionName = "请填写任务名称";
  if (rewardError) e.rewardPoints = rewardError;
  if (!state.category?.trim()) e.category = "请选择任务类别";
  if (routeError) e.actionRoute = routeError;
  return e;
}

const SUBJECT_TEXT: Record<string, string> = {
  DAY_ONE: "新手任务",
  WEEKLY_T1: "每周一档任务",
  WEEKLY_T2: "每周二档任务",
};

export function H3MissionFormDrawer({ missionType, initial, productActionTargets, routeLabels, readFailed, targetsRetry, onClose, onReview }: {
  missionType: "DAY_ONE" | "WEEKLY_T1" | "WEEKLY_T2";
  initial?: H3MissionForm;
  productActionTargets?: readonly H3ProductActionTarget[] | null;
  routeLabels: Record<string, string>;
  /** 抽屉开着时页面重读失败：抽屉和填的内容留着，读到前不能进下一步。 */
  readFailed?: { retrying: boolean; onRetry: () => void };
  /** 只有商品候选没读到（其他数据都在）：在「去完成」这一项下就地写，带「重试」。 */
  targetsRetry?: { retrying: boolean; onRetry: () => void };
  onClose: () => void;
  onReview: (value: H3MissionForm, reward: number) => void;
}) {
  const [value, setValue] = useState<H3MissionForm>(initial ?? MISSION_FORM_INITIAL);
  const [attempted, setAttempted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /** 「去完成」框里正在打的字；没在打字时为 null，框里显示已选项的名称。 */
  const [routeTyping, setRouteTyping] = useState<string | null>(null);
  /** 离开过的字段：刚打开不报，离开这一项后报它，点过「下一步」后全部亮出（OP-15、VS-107）。 */
  const [left, setLeft] = useState<Record<string, boolean>>({});
  const leave = (key: string) => () => setLeft((state) => state[key] ? state : { ...state, [key]: true });
  const actionRoutes = h3ActionRoutes(value.missionCode ?? "", productActionTargets);
  const actionRoute = actionRoutes.includes(value.actionRoute) ? value.actionRoute : "";
  const routeBlocked = productActionTargets === null ? "商品候选没读到，读到后才能新建" : actionRoutes.length ? undefined : productActionTargets === undefined
    ? "商品候选没读到，重新读取后再选"
    : "现在没有能作回本目标的 S1 商品（已开放、能显示预计收益），上架后再选";
  const { value: reward, error: rewardError } = readMissionReward(value.rewardPoints);
  const errors = missionFormErrors(value, missionType, rewardError, routeBlocked ?? (actionRoute ? undefined : "请选择去完成页面"));
  const creationRefusal = h3MissionCreationRefusal(missionType, value.missionCode?.trim() ?? "");
  const shown: Record<string, string> = attempted ? errors : Object.fromEntries(Object.entries(errors).filter(([key]) => left[key]));
  const routeText = (route: string) => routeLabels[route] ?? route;
  const routeQuery = routeTyping?.trim().toLowerCase() ?? "";
  const routeOptions = actionRoutes.filter((route) => !routeQuery || routeText(route).toLowerCase().includes(routeQuery))
    .map((route) => ({ value: route, label: routeText(route) }));
  const missing = Object.values(errors);
  const dirty = JSON.stringify(value) !== JSON.stringify(MISSION_FORM_INITIAL);
  const set = (key: string, next: string) => setValue((state) => ({ ...state, [key]: next }));
  const close = () => { if (dirty) setLeaving(true); else onClose(); };
  const review = () => { setAttempted(true); if (!readFailed && missing.length === 0 && reward !== null) onReview(value, reward); };
  const subject = SUBJECT_TEXT[missionType];
  const needsApproval = reward !== null && reward > 0;
  return (
    <>
      <Drawer open wide onClose={close} title={`新建${subject}`} sub="建好后是已停用" icon={ListChecks} tone="role-4"
        explain="左边填，右边看它在 App 上的样子。点「下一步」后核对、写理由再提交。建好的任务先是已停用，要先在「完成条件」里绑定用户做了什么算完成，再启用。"
        // 没填好时「下一步」禁用，原因只放按钮提示；点一下把各项错误亮在字段下（OP-15、OP-126），底栏不再重复列一遍。
        footer={<Decision
          primary={<Button variant="primary" disabledReason={readFailed ? "最新数据读到后才能继续" : missing.length ? missing.join("；") : undefined}
            onBlockedClick={() => setAttempted(true)} onClick={review}>下一步：核对并提交</Button>}
          others={<Button onClick={close}>取消</Button>} />}>
        <div className="rd-split h3-form-split" data-detail="" data-preview="">
          <div className="h3-form">
            {readFailed && <Notice tone="warn" title="最新数据没读到"
              action={<Button size="sm" loading={readFailed.retrying} loadingText="重试中…" onClick={readFailed.onRetry}>重试</Button>}>
              填的内容还在，读到以后才能继续。
            </Notice>}
            <Field label="任务编号" required hint="英文和数字" error={shown.missionCode ?? (creationRefusal ? displayAdminError(new Error(creationRefusal)) : undefined)}>
              {(control) => <Input {...control} value={value.missionCode ?? ""} placeholder="如 dayOne-visit-earn" onBlur={leave("missionCode")} onChange={(event) => set("missionCode", event.target.value)} />}
            </Field>
            <Field label="任务名称" required help="各语言名称建好后在任务详情里填，启用前英文和运营区域语言要填齐" error={shown.missionName}>
              {(control) => <Input {...control} value={value.missionName ?? ""} placeholder="如 Visit earnings page" onBlur={leave("missionName")} onChange={(event) => set("missionName", event.target.value)} />}
            </Field>
            <Field label="奖励" required hint="非负整数" error={shown.rewardPoints}
>
              {(control) => <NumberInput {...control} unit="UVT" min={0} step={1} value={value.rewardPoints ?? ""} onBlur={leave("rewardPoints")} onChange={(event) => set("rewardPoints", event.target.value)} />}
            </Field>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="任务类别" required error={shown.category}>
                {(control) => <div onBlur={leave("category")}><Select {...control} aria-label="任务类别" value={value.category ?? ""} onChange={(next) => set("category", next)}
                  options={TASK_CATEGORY_OPTIONS.map((option) => ({ value: option, label: TASK_CATEGORY_LABELS[option] }))} /></div>}
              </Field>
              <Field label="点「去完成」跳到" required
                help={productActionTargets === null ? <>{routeBlocked}{targetsRetry && <> · <InlineRetry onRetry={targetsRetry.onRetry} retrying={targetsRetry.retrying} /></>}</> : shown.actionRoute ? undefined : routeBlocked}
                error={productActionTargets === null ? undefined : shown.actionRoute}>
                {/* 框里显示的是已选项名称时，点进去先全选，打字就替换它，不会接在名称后面去搜（Ant Design Select showSearch）。 */}
                {(control) => <div onBlur={leave("actionRoute")}
                  onFocus={(event) => { if (routeTyping === null && event.target instanceof HTMLInputElement) event.target.select(); }}
                  onClick={(event) => { if (routeTyping === null && event.target instanceof HTMLInputElement) event.target.select(); }}>
                  <SearchSelect {...control} aria-label="点「去完成」跳到" aria-required placeholder="选择或输入名称搜索" disabled={!actionRoutes.length}
                    value={routeTyping ?? (actionRoute ? routeText(actionRoute) : "")}
                    onChange={(next) => { setRouteTyping(next); if (value.actionRoute) set("actionRoute", ""); }}
                    options={routeOptions} selected={actionRoute || undefined} empty="没有匹配的页面或商品"
                    onSelect={(next) => { setRouteTyping(null); set("actionRoute", next); }} />
                </div>}
              </Field>
            </div>
          </div>
          <aside className="h3-form-preview" aria-label="建好后">
            <h3 className="h3-form-title">建好后</h3>
            <div className="h3-phone h3-phone-single">
              <div className="h3-phone-hero">
                <span className="h3-phone-cat">{TASK_CATEGORY_LABELS[value.category] ?? "其他"}</span>
                <b>{value.missionName?.trim() || "任务名称"}</b>
                {missionType !== "DAY_ONE" && <span className="h3-phone-reward">{reward == null ? "—" : `+${amountText(String(reward))} UVT`}</span>}
                <span className="h3-phone-go">去完成 ›</span>
                <PreviewTarget label={actionRoute ? routeLabels[actionRoute] ?? actionRoute : ""} />
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
