"use client";

/**
 * J4 · 监管点名应急 SOP — 8 剧本库(actionSequence timeline)+ 应急快速轨 SLA + 执行追溯历史。
 * 每步原子动作落各域确认门；J4 先收集整体原因，再逐项确认目标域、动作与规范引用。
 * 剧本编辑 / 演练 / 执行 / 新增均走 OperationConfirmModal，正式执行另经逐步确认 → 后端 /emergency/sop/* 接口。
 */
import { useEffect, useRef, useState } from "react";
import { CodeTag, Modal } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { JCtx } from "./types";
import { createJEmergencyCommandKey, type J4PlaybookCreateInput, type Playbook, type SopExecution } from "@/lib/admin/j-client";
import { createA2OperationProposal } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";

/* 域 badge → 色族(danger=J 域 / warning=D2 / brand=I5 / cyan=I3,I2 / brand-2=C2,K1 / success=B1) */
const DOM_CLS: Record<string, string> = { J1: "dj", J2: "dj", D2: "dd", I5: "di5", I3: "di", I2: "di", C2: "dc", K1: "dc", B1: "db" };

/** ax 内 **…** 强调标记 → <b> 渲染。 */
function axRender(s: string) {
  return s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>));
}

function playbookFormBody(bv: Record<string, string> | undefined, fallbackName: string): J4PlaybookCreateInput {
  return {
    name: bv?.name?.trim() || fallbackName,
    scene: bv?.scene,
    owner: bv?.owner,
    sla: bv?.sla,
    emergencyTrack: bv?.emergencyTrack === "true",
    actionSeq: bv?.actionSeq,
    notifyCampaignNo: bv?.notifyCampaignNo,
    notifyTemplate: bv?.notifyTemplate,
    rollback: bv?.rollback,
    drillRequired: true,
  };
}

function actionSeqText(p: Playbook) {
  return p.seq.map((s) => `${s.dom}·${s.ax.replace(/\*\*/g, "")}${s.ref ? `·${s.ref}` : ""}`).join("\n");
}

function executionStepLabel(status: string) {
  if (status === "pending") return "待执行";
  if (status === "done") return "成功";
  if (status === "failed") return "失败";
  if (status === "skipped") return "跳过";
  if (status === "rolled_back") return "回滚";
  if (status === "running") return "执行中";
  if (status === "recovering") return "恢复核对中";
  return "未知状态";
}

function executionModeLabel(mode: string) {
  if (mode === "drill") return "演练";
  if (mode === "emergency") return "应急实战";
  if (mode === "regular") return "常规实战";
  return "未知模式";
}

/** J4 页头 CTA(挂 DomainHeader 右槽):+ 新增剧本。 */
export function J4HeaderActions({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency } = ctx;
  const canWrite = useAdminAuth((state) => state.session?.authorities.includes("emergency_j4_write") ?? false);
  const contractReady = emergency.sop?.contractVersion === "J4_REAL_EXECUTION_V4";
  const runBackend = async (task: Promise<void>, ok: string) => {
    try {
      await task;
    } catch (error) {
      // 判定与展示同源:裸机器码(J4_EXECUTION_PARTIAL 等)只有过咽喉译成中文后才命中下面的关键词。
      const message = displayAdminError(error);
      if (/中途失败|未收到执行结果|结果暂未确认/.test(message)) {
        await actions.reloadJEmergency().catch(() => undefined);
      }
      toast(`操作失败 · ${message}`);
      throw error;
    }
    try {
      await actions.reloadJEmergency();
      toast(ok);
    } catch {
      toast(`${ok}，但页面刷新失败，请点击当前页签重新读取`);
    }
  };
  const newPb = () => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: "新增应急剧本",
    detail: <><b>SOP 编排器</b>:配置名称 / 触发场景 / 责任角色 / 响应时限 / 应急轨 / 可执行动作 / 通知活动 / 回滚方案 / 演练要求。提交后进入剧本库并保留变更记录。</>,
    businessForm: {
      kind: "sop-authoring",
      nameHint: "如 监管点名快速止血",
      scenes: (emergency.sop?.scenes ?? []).filter((item) => item !== "全部"),
      notifyTemplates: emergency.notifyTemplates ?? [],
      notifyTemplatesError: emergency.notifyTemplatesError,
      actionOptions: emergency.sop?.actionOptions ?? [],
      rollbackOptions: emergency.sop?.rollbackOptions ?? [],
    },
    run: (reason, _v, bv) => {
      const name = bv?.name || "未命名应急剧本";
      return runBackend(actions.createJ4Playbook(playbookFormBody(bv, name), reason, commandKey), `新剧本「${name}」已创建${bv?.drillRequired === "true" ? "，请先完成演练" : "并可执行"}`);
    },
  });
  };
  return canWrite ? <button className="f-cta" disabled={!contractReady} title={!contractReady ? "后端 J4 安全执行契约未就绪，请先升级后端" : undefined} onClick={newPb}>+ 新增剧本</button> : null;
}

export function J4Sop({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canWrite = authorities.includes("emergency_j4_write");
  const canRun = authorities.includes("emergency_j4_playbook_execute");
  const canPropose = authorities.includes("platform_a2_write")
    || authorities.includes("platform_a2_proposal_create");
  const [scene, setScene] = useState("全部");
  const [traceExecution, setTraceExecution] = useState<SopExecution | null>(null);
  const sceneLocationReady = useRef(false);
  useEffect(() => {
    if (!sceneLocationReady.current) {
      sceneLocationReady.current = true;
      const initial = new URL(window.location.href).searchParams.get("j4Scene");
      if (initial) setScene(initial);
      return;
    }
    const url = new URL(window.location.href);
    if (scene === "全部") url.searchParams.delete("j4Scene");
    else url.searchParams.set("j4Scene", scene);
    window.history.replaceState(window.history.state, "", url);
  }, [scene]);
  const data = emergency.sop;
  if (contentLoading && !data) {
    return <section className="pb-grid"><div className="pb-card"><div className="pb-top"><span className="pb-code">J4</span><div className="nm">SOP 数据加载中</div></div></div></section>;
  }
  if (!data) {
    return <section className="pb-grid"><div className="pb-card"><div className="pb-top"><span className="pb-code">J4</span><div className="nm">暂无 SOP 数据</div></div></div></section>;
  }
  const PLAYBOOKS = data.playbooks;
  const isSupportedStep = (step: Playbook["seq"][number]) => (data.actionOptions ?? []).some((option) => {
    if (option.domain !== step.dom || !option.ref || !step.ref) return false;
    if (!option.ref.includes("{target}")) return option.ref === step.ref;
    const [prefix] = option.ref.split("{target}");
    return step.ref.startsWith(prefix) && step.ref.length > prefix.length;
  });
  const unsupportedStepCount = (playbook: Playbook) => playbook.seq.filter((step) => !isSupportedStep(step)).length;
  const contractReady = data.contractVersion === "J4_REAL_EXECUTION_V4";
  const PB_SCENES = data.scenes;
  const EXECS = data.executions;
  const statNumber = (...keys: string[]) => {
    for (const key of keys) {
      const parsed = Number(data.stats[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  // 近 90d 统计只取后端汇总；字段未返回时明确显示“未返回”。
  const liveExecs = statNumber("liveExec90d");
  const drillExecs = statNumber("drill90d");

  const runBackend = async (task: Promise<void>, ok: string) => {
    try {
      await task;
    } catch (error) {
      // 判定与展示同源:裸机器码(J4_EXECUTION_PARTIAL 等)只有过咽喉译成中文后才命中下面的关键词。
      const message = displayAdminError(error);
      if (/中途失败|未收到执行结果|结果暂未确认/.test(message)) {
        await actions.reloadJEmergency().catch(() => undefined);
      }
      toast(`操作失败 · ${message}`);
      throw error;
    }
    try {
      await actions.reloadJEmergency();
      toast(ok);
    } catch {
      toast(`${ok}，但页面刷新失败，请点击当前页签重新读取`);
    }
  };
  const effDrillState = (p: Playbook): "active" | "todo" | string => unsupportedStepCount(p) === 0 && p.executionReady === true && p.state === "active" && !p.draft ? "active" : "todo";
  const shown = PLAYBOOKS.filter((p) => scene === "全部" || p.scene === scene);
  const ready = PLAYBOOKS.filter((p) => effDrillState(p) === "active").length;
  const todo = PLAYBOOKS.length - ready;
  const emerCount = PLAYBOOKS.filter((p) => p.emer).length;

  const editPb = (p: Playbook) => {
    if (!p.version) return;
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: `编辑应急剧本 · ${p.code} ${p.name}`,
    detail: <><b>SOP 编排器 · 剧本库维护</b>:重排 {p.name} 的动作序列(当前 {p.seq.length} 步)、触发场景、责任角色、响应时限、应急轨、通知活动和回滚方案；保存后保留前后版本记录。</>,
    businessForm: {
      kind: "sop-authoring",
      nameHint: p.name,
      scenes: data.scenes.filter((item) => item !== "全部"),
      owners: Array.from(new Set([p.owner, "风控", "合规审计", "超管"])),
      notifyTemplates: emergency.notifyTemplates ?? [],
      notifyTemplatesError: emergency.notifyTemplatesError,
      actionOptions: data.actionOptions ?? [],
      rollbackOptions: data.rollbackOptions ?? [],
      currentName: p.name,
      currentScene: p.scene,
      currentOwner: p.owner,
      currentSla: p.sla,
      currentEmergencyTrack: p.emer,
      currentActionSeq: actionSeqText(p),
      currentNotifyCampaignNo: p.notifyCampaignNo,
      currentNotifyTemplate: p.notifyTemplate,
      currentRollback: p.rollback,
      currentDrillRequired: p.drillRequired,
    },
    run: (reason, _v, bv) => {
      const steps = (bv?.actionSeq || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const summary = steps.length ? steps.join(" | ") : `${bv?.name || p.name} · ${bv?.scene || p.scene} · ${bv?.owner || p.owner}`;
      return runBackend(actions.updateJ4Playbook(p.code, { ...playbookFormBody(bv, p.name), summary, version: p.version! }, reason, commandKey), `${p.code} 剧本变更已保存${bv?.drillRequired === "true" ? "，需重新演练" : ""}(${steps.length} 步)`);
    },
  });
  };

  const drillPb = (p: Playbook) => {
    if (unsupportedStepCount(p) > 0) {
      toast("历史剧本包含尚未接通的动作，请先编辑并替换后再演练");
      return;
    }
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: `启动演练 · ${p.code} ${p.name}`,
    detail: <><b>演练校验</b>(非实战):逐项校验 {p.seq.length} 步动作是否有可用处置入口、通知活动是否可下发；不触发生产动作。全部通过后保存每步结果并将剧本发布为「演练就绪」。</>,
    run: (reason) => {
      return runBackend(actions.drillJ4Playbook(p.code, reason, commandKey), `${p.code} 演练校验已通过 · 剧本现已就绪`);
    },
  });
  };

  // 注:执行剧本不传 amplifies —— B1 前置只挂「恢复放大流出」方向;应急执行是止血方向(熔断/封锁/暂停),
  // 覆盖率低于红线时恰恰最需要执行(SOP-02 对账缺口/SOP-03 挤兑),不可被 B1 禁放行锁死(对齐 J1「熔断方向不前置 B1」)。
  const execPb = (p: Playbook, isEmer: boolean) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
    action: `执行应急剧本 · ${p.code}${isEmer ? "(应急轨)" : "(常规轨)"}`,
    detail: (
      <>
        {isEmer
          ? <><b style={{ color: "var(--danger)" }}>应急轨</b> — 仅允许关停/暂停等止血方向，仍需填写原因并保留完整执行记录。</>
          : <><b>常规轨</b> — 按动作序列调用每个已接通的处置入口。</>}
        <br />本次原因将作为触发上下文；提交后先进入 A2 确认队列，批准时调用以下已接通动作
        <span style={{ display: "block", marginTop: 4 }}>
          <b>动作序列({p.seq.length} 步)</b>:
          {p.seq.map((s, i) => (
            <span key={i} style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", display: "block", marginTop: 2 }}>
              {i + 1}. {s.dom} · {s.ax.replace(/\*\*/g, "")}{s.approve ? "(操作确认)" : ""}
            </span>
          ))}
        </span>
        <b>责任</b>:{p.owner} · <b>SLA</b>:{p.sla}
      </>
    ),
    businessForm: {
      kind: "j4-execution-confirmation",
      triggerBases: ["监管点名", "挤兑风险", "安全事件", "其他"],
      defaultTriggerBasis: p.scene === "监管点名"
        ? "监管点名"
        : (p.scene === "舆情挤兑" || p.scene === "资金异常" ? "挤兑风险" : "安全事件"),
      steps: p.seq.map((step) => ({
        domain: step.dom,
        action: step.ax.replace(/\*\*/g, ""),
        ref: step.ref || "",
        approve: step.approve,
      })),
    },
    run: async (reason, _value, businessValue) => {
      if (!businessValue || p.seq.some((_, index) => businessValue[`stepConfirm.${index}`] !== "true")) {
        throw new Error("请逐项确认全部动作后再提交执行");
      }
      const stepConfirmations = p.seq.map((step, index) => ({
        step: index + 1,
        domain: step.dom,
        ref: step.ref || "",
        confirmed: true as const,
      }));
      const triggerBasis = businessValue?.triggerBasis ?? "";
      const triggerContext = businessValue?.triggerContext ?? "";
      return runBackend(createA2OperationProposal({
        action: `执行应急剧本 · ${p.code}`,
        obj: p.code,
        beforeValue: "演练就绪",
        afterValue: "批准后逐步执行",
        operator: session?.operator ?? session?.username ?? "",
        operatorRole: session?.role ?? "superadmin",
        type: "sos",
        amplifies: false,
        sos: true,
        roleGate: "A2 确认",
        reason,
        sourceDomain: "J4",
        command: {
          domain: "J",
          op: "j4_playbook_execute",
          params: {
            code: p.code,
            emergency: isEmer,
            triggerBasis,
            triggerContext,
            stepConfirmations,
          },
        },
        target: { domain: "J", type: "playbook", id: p.code },
      }, commandKey).then(() => undefined), `${p.code} 已提交 A2 确认队列；批准后才会逐步执行`);
    },
  });
  };

  // 回滚单次剧本执行:跨域写入(配置恢复 / 通知停发)· 恒走常规轨 · 不可应急加速。
  const rollbackPb = (exec: { executionId: string; code: string; name?: string }) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
      action: `回滚剧本执行 · ${exec.executionId}`,
      detail: (
        <><b>{exec.code}</b>(<span className="mono">{exec.executionId}</span>)将按本次执行快照逐项恢复可逆的 J1 关停动作。已发送通知无法撤回，如需更正请另建通知活动。</>
      ),
      run: (reason) => {
        return runBackend(actions.rollbackJ4Playbook(exec.code, exec.executionId, reason, commandKey), `${exec.executionId} 已按执行快照完成回滚`);
      },
    });
  };

  const cancelExecution = (exec: { executionId: string; code: string }) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
      action: `取消执行 · ${exec.executionId}`,
      detail: <>取消请求会在下一个步骤边界生效：已经完成的止血动作保持生效，尚未开始的步骤标记为跳过，整次执行以「部分完成」终止并保留审计。正在调用中的目标域动作不会被伪装成已取消。</>,
      run: (reason) => runBackend(
        actions.cancelJ4Playbook(exec.code, exec.executionId, reason, commandKey),
        `${exec.executionId} 已登记取消请求，请刷新核对最终逐步状态`,
      ),
    });
  };

  const resumeExecution = (exec: { executionId: string; code: string }) => {
    const commandKey = createJEmergencyCommandKey();
    openActionConfirm({
      action: `恢复核对 · ${exec.executionId}`,
      detail: <>仅对超过恢复租约、仍停在待执行/执行中的记录生效。服务端只核对目标域持久化事实：已确认的动作记成功，未知结果记失败并终止剩余步骤；不会盲目重复跨域副作用。</>,
      run: (reason) => runBackend(
        actions.resumeJ4Playbook(exec.code, exec.executionId, reason, commandKey),
        `${exec.executionId} 已完成恢复核对`,
      ),
    });
  };

  return (
    <div>
      {!contractReady && (
        <div className="tint" role="alert" style={{ marginBottom: 12 }}>
          后端 J4 安全执行契约未就绪，当前页面已切换为只读。请先升级后端后再新增、编辑、演练、执行或回滚。
        </div>
      )}
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat"><div className="k">剧本库</div><div className="v">{PLAYBOOKS.length}</div><div className="sub">已发布 + 草稿</div></div>
        <div className="f-stat ok"><div className="k">演练就绪</div><div className="v">{ready}</div><div className="sub">90 天内已演练</div></div>
        <div className="f-stat warn"><div className="k">待演练</div><div className="v">{todo}</div><div className="sub">超期 · 阻断「演练就绪」</div></div>
        <div className="f-stat danger"><div className="k">应急轨剧本</div><div className="v">{emerCount}</div><div className="sub">可走应急加急通道</div></div>
      </div>

      {/* SLA + 执行框架 */}
      <div className="top-side">
        <section className="sla-card">
          <div className="h">
            <span className="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg></span>
            <div><div className="t">应急轨约束</div><div className="s">· <AutoGloss>只用于关停、暂停等止血动作</AutoGloss></div></div>
          </div>
          <div className="sla-kv"><span className="k">允许方向</span><span className="v danger">关停 / 暂停</span></div>
          <div className="sla-kv"><span className="k">禁止方向</span><span className="v ok">恢复 / 解封 / 放行</span></div>
          <div className="sla-kv"><span className="k">执行前提</span><span className="v">剧本已发布且演练通过</span></div>
          <div className="sla-kv"><span className="k">操作原因</span><span className="v">8–200 字，必填</span></div>
          <div className="sla-kv"><span className="k">执行记录</span><span className="v danger">逐步留痕</span></div>
        </section>

        <section className="sla-card">
          <div className="h">
            <span className="ic b"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></span>
            <div><div className="t">当前可执行范围</div><div className="s">· <AutoGloss>只展示已经接通真实处置入口的动作</AutoGloss></div></div>
          </div>
          <div className="sla-kv"><span className="k">J1 / D2</span><span className="v">提现 / Genesis 关停</span></div>
          <div className="sla-kv"><span className="k">J2 / C2 / K1</span><span className="v">地域、用户与账户簇止血</span></div>
          <div className="sla-kv"><span className="k">I3 / I5</span><span className="v">通知下发 / 披露发布</span></div>
          <div className="sla-kv"><span className="k">执行审批</span><span className="v warn">A2 批准后执行</span></div>
          <div className="sla-kv"><span className="k">演练失败</span><span className="v">保持待演练，不可执行</span></div>
          <div className="sla-kv"><span className="k">步骤失败</span><span className="v danger">明确失败，不伪报成功</span></div>
        </section>
      </div>

      {/* 过滤 + 统计 */}
      <div className="pb-bar">
        <div className="seg">
          {PB_SCENES.map((s) => <button key={s} className={scene === s ? "on" : ""} onClick={() => setScene(s)}>{s}</button>)}
        </div>
        <div className="stats">
          <span>近 90d 实战执行 <b>{liveExecs == null ? "未返回" : `${liveExecs} 次`}</b></span>
          <span>近 90d 演练 <b>{drillExecs == null ? "未返回" : `${drillExecs} 次`}</b></span>
        </div>
      </div>

      {/* 剧本库 grid */}
      <div className="pb-grid">
        {shown.length === 0 && (
          <div className="pb-card">
            <div className="pb-top"><span className="pb-code">J4</span><div className="nm">当前场景暂无剧本</div></div>
            <div className="scene">{canWrite ? "可切换到「全部」查看其他剧本；如需新增，请使用页面右上角「+ 新增剧本」。" : "可切换到「全部」查看其他剧本；如需新增，请联系具备 J4 维护权限的管理员。"}</div>
          </div>
        )}
        {shown.map((p) => {
          const state = effDrillState(p);
          const legacyStepCount = unsupportedStepCount(p);
          const supportedSteps = p.seq.filter(isSupportedStep);
          const targetAuthority: Record<string, string> = {
            J1: "emergency_j1_gate_kill",
            J2: "emergency_j2_emergency_block",
            C2: "user_c2_account_freeze",
            K1: "risk_k1_cluster_freeze",
            I3: "content_i3_write",
            I5: "content_i5_disclosure_publish",
          };
          const hasTargetAuthorities = p.seq.every((step) => Boolean(targetAuthority[step.dom])
            && authorities.includes(targetAuthority[step.dom]));
          const canExecute = contractReady && !contentLoading && canRun && canPropose && legacyStepCount === 0 && state === "active" && p.executionReady === true && hasTargetAuthorities;
          const executionHint = !contractReady ? "后端 J4 安全执行契约未就绪，请先升级后端" : contentLoading ? "正在重新读取" : legacyStepCount > 0 ? "历史剧本包含尚未接通的动作，请先编辑并替换后重新演练" : p.executionReady !== true || state !== "active" ? (p.readinessReason || "先完成演练") : !canRun ? "缺少 J4 执行权限" : !canPropose ? "缺少 A2 提案权限" : !hasTargetAuthorities ? "缺少对应处置权限" : undefined;
          return (
          <div key={p.code} className={"pb-card" + (p.emer ? " emer" : "")} role="article" aria-label={`${p.code} ${p.name}`} data-testid={`j4-playbook-${p.code}`}>
            <div className="pb-top">
              <span className="pb-code">{p.code}</span>
              <div style={{ flex: 1 }}>
                <div className="nm"><AutoGloss>{p.name}</AutoGloss></div>
                <div className="scene">触发场景:<b><AutoGloss>{p.scene}</AutoGloss></b> · {legacyStepCount > 0 ? `${supportedSteps.length} 个已接通动作 · ${legacyStepCount} 个历史动作需迁移` : `${p.seq.length} 步原子动作`}</div>
              </div>
              <div className="r">
                {p.emer && <span className="emer-tag">EMERGENCY</span>}
                {state === "active" ? <span className="state active">演练就绪</span> : <span className="state todo" title={legacyStepCount > 0 ? executionHint : p.readinessReason}>{legacyStepCount > 0 ? "历史剧本 · 需迁移" : (p.readinessReason || "草稿 · 待演练")}</span>}
              </div>
            </div>
            <div className="pb-seq">
              {supportedSteps.map((s, i) => (
                <div key={i} className={"step " + (DOM_CLS[s.dom] ?? "di")}>
                  <span className="dom">{s.dom}</span>
                  <div className="ax">{axRender(s.ax)}</div>
                  {s.approve ? <span className="approve req">操作确认</span> : <span className="approve">普通确认</span>}
                  {s.ref && <span className="approve ref">{s.ref}</span>}
                </div>
              ))}
              {legacyStepCount > 0 && (
                <div className="step di">
                  <span className="dom">历史</span>
                  <div className="ax">{legacyStepCount} 个动作尚未接通，请编辑并替换</div>
                  <span className="approve req">禁止演练</span>
                </div>
              )}
            </div>
            <div className="pb-ft">
              <div className="meta">
                <div className="it"><span className="k">SLA</span><span className="v">{p.sla}</span></div>
                <div className="it"><span className="k">责任</span><span className="v"><AutoGloss>{p.owner}</AutoGloss></span></div>
                <div className="it"><span className="k">最近演练</span><span className={"v" + (state === "todo" ? " warn" : "")}>{p.lastDrill}</span></div>
              </div>
              <div className="acts">
                {canWrite && <button className="edit" disabled={!contractReady || contentLoading || !p.version} title={!contractReady || !p.version ? "服务端版本较旧，升级后才能安全编辑" : undefined} onClick={() => editPb(p)}>编辑</button>}
                {canWrite && <button className="drill" disabled={!contractReady || contentLoading || legacyStepCount > 0} title={!contractReady ? "后端 J4 安全执行契约未就绪，请先升级后端" : legacyStepCount > 0 ? "历史剧本包含尚未接通的动作，请先编辑并替换" : undefined} onClick={() => drillPb(p)}>演练</button>}
                {p.emer
                  ? <button className="exec emer" disabled={!canExecute} title={executionHint} onClick={() => execPb(p, true)}>提交应急复核</button>
                  : <button className="exec" disabled={!canExecute} title={executionHint} onClick={() => execPb(p, false)}>提交执行复核</button>}
              </div>
            </div>
          </div>
        ); })}
      </div>

      {/* 执行追溯历史 */}
      <section className="exec-card">
        <div className="exec-h">
          <span className="ttl">执行追溯历史 · 合规取证</span>
          <span className="sub">· <AutoGloss>每条记录每步的最终状态 · 失败前已完成的止血动作保持生效</AutoGloss></span>
          <div className="r"><CodeTag tone="electric">审计记录</CodeTag><CodeTag>逐步结果已留痕</CodeTag></div>
        </div>
        <div className="exec-tblwrap"><div className="exec-tbl">
          <div className="hd">
            <div className="c">时间</div><div className="c">剧本</div><div className="c">触发上下文</div><div className="c">模式</div>
            <div className="c">步骤状态</div><div className="c">操作员 / 执行门槛</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作</div>
          </div>
          {EXECS.length === 0 && (
            <div className="rw empty" role="status">
              <div className="c" style={{ gridColumn: "1 / -1" }}>
                尚无执行记录。{canRun ? "请先完成剧本演练，再从就绪剧本发起执行。" : "如需发起执行，请联系具备 J4 执行权限的管理员。"}
              </div>
            </div>
          )}
          {EXECS.map((e) => (
            <div className="rw" key={e.executionId || `${e.ts}-${e.code}-${e.trig}`} data-testid={e.executionId ? `j4-execution-${e.executionId}` : undefined}>
              <div className="c ts">{e.ts}</div>
              <div className="c pb"><span className="code">{e.code}</span><span className="nm"><AutoGloss>{e.name}</AutoGloss></span></div>
              <div className="c trig"><AutoGloss>{e.trig}</AutoGloss></div>
               <div className="c"><span className={"mode " + e.mode}>{executionModeLabel(e.mode)}</span>{e.rollbackStatus === "ROLLED_BACK" && <span className="mode drill" title="仅已完成且仍由本次执行持有的 J1 动作被恢复；通知等不可逆动作不受影响">已回滚可逆动作</span>}{e.rollbackStatus === "NOT_REQUIRED" && <span className="mode drill" title="演练仅校验，未执行生产动作，无需回滚">无需回滚</span>}</div>
               <div className="c"><div className="steps">{e.steps.map((s, i) => <span key={i} className={"sdot " + s} title={executionStepLabel(s)}>{i + 1}:{executionStepLabel(s)}</span>)}</div></div>
              <div className="c confirm-pair">
                <span><span className="role">操作员</span> {e.operator}</span>
                <span><span className="role">门槛</span> {e.roleGate}</span>
              </div>
              <div className="c acts">
                 <button onClick={() => setTraceExecution(e)}>查看追溯</button>
                {contractReady && canRun && Boolean(e.executionId) && e.mode !== "drill" && e.steps.some((step) => step === "pending" || step === "running") && (
                  <>
                    <button className="rollback" disabled={contentLoading} onClick={() => cancelExecution({ executionId: e.executionId!, code: e.code })}>取消</button>
                    <button disabled={contentLoading} title="仅超过 2 分钟恢复租约的执行可核对" onClick={() => resumeExecution({ executionId: e.executionId!, code: e.code })}>恢复核对</button>
                  </>
                )}
                {contractReady && canRun && authorities.includes("emergency_j1_gate_resume") && Boolean(e.executionId) && e.reversible && !e.steps.some((step) => step === "pending" || step === "running" || step === "recovering") && e.mode !== "drill" && e.rollbackStatus !== "ROLLED_BACK" && (
                  <button
                    className="rollback"
                    disabled={contentLoading}
                    onClick={() => rollbackPb({ executionId: e.executionId!, code: e.code, name: e.name })}
                  >
                    回滚
                  </button>
                )}
              </div>
            </div>
          ))}
        </div></div>
      </section>

      {traceExecution && (
        <Modal title={`执行追溯 · ${traceExecution.executionId || "执行编号缺失"}`} icon="shield" wide onClose={() => setTraceExecution(null)}>
          <div className="tint" style={{ marginBottom: 12 }}>
            <b>{traceExecution.code} · {traceExecution.name}</b><br />
            {traceExecution.ts} · {executionModeLabel(traceExecution.mode)} · 操作员 {traceExecution.operator} · 门槛 {traceExecution.roleGate}
          </div>
          <div className="field">
            <label>触发与确认依据</label>
            <div className="tiny">业务原因: {traceExecution.trig || "未记录"}</div>
            <div className="tiny">触发依据: {String(traceExecution.notificationDispatch.triggerBasis || "未记录")}</div>
            <div className="tiny">触发上下文: {String(traceExecution.notificationDispatch.triggerContext || "未记录")}</div>
            {Array.isArray(traceExecution.notificationDispatch.stepConfirmations)
              ? (traceExecution.notificationDispatch.stepConfirmations as Array<Record<string, unknown>>).map((confirmation, index) => (
                <div className="tint tiny" data-proof={`j4-trace-confirmation-${index + 1}`} key={`${String(confirmation.domain)}-${String(confirmation.step || index)}`} style={{ marginTop: 6 }}>
                  第 {String(confirmation.step ?? index + 1)} 步 · {String(confirmation.domain || "未知域")} · 契约 {String(confirmation.ref || "未记录")} · {confirmation.confirmed === true ? "已确认" : "未确认"}
                </div>
              ))
              : <div className="tiny" data-proof="j4-trace-confirmation-legacy" style={{ marginTop: 6 }}>历史记录未保存逐步确认。</div>}
          </div>
          <div className="field">
            <label>逐步执行结果</label>
            {traceExecution.domainActions.length === 0 ? <div className="tiny">没有可核对的原子动作记录。</div> : traceExecution.domainActions.map((action, index) => (
              <div className="tint tiny" key={`${String(action.domain)}-${String(action.stepIndex || index)}`} style={{ marginBottom: 7 }}>
                <b>{index + 1}. {String(action.domain || "未知域")} · {String(action.action || "未记录动作")}</b><br />
                状态 {String(action.status || executionStepLabel(traceExecution.steps[index] || ""))}
                {action.ref ? ` · 契约 ${String(action.ref)}` : ""}
                {action.failure ? ` · 失败 ${String(action.failure)}` : ""}
                {action.ownershipToken ? ` · 所有权 ${String(action.ownershipToken)}` : ""}
              </div>
            ))}
          </div>
          <div className="field">
            <label>通知与审计</label>
            <div className="tiny">通知状态 {String(traceExecution.notificationDispatch.status || "未记录")} · 审计状态 {String(traceExecution.notificationDispatch.auditStatus || "未记录")} · 下发数 {String(traceExecution.notificationDispatch.notificationCount ?? "未返回")}</div>
            {traceExecution.notificationDispatch.failure ? <div className="tiny" style={{ color: "var(--danger)" }}>失败原因 {String(traceExecution.notificationDispatch.failure)}</div> : null}
          </div>
          <div className="field">
            <label>回滚事实</label>
            <div className="tiny">状态 {traceExecution.rollbackStatus === "NOT_REQUIRED" ? "无需回滚（演练仅校验，未执行生产动作，无需回滚）" : (traceExecution.rollbackStatus || "未回滚")} · 时间 {traceExecution.rollbackAt || "—"} · 原因 {traceExecution.rollbackReason || "—"}</div>
            {traceExecution.rollbackActions.map((action, index) => <div className="tiny" key={index}>{index + 1}. {String(action.domain || "J1")} · {String(action.status || action.action || "已记录")}</div>)}
          </div>
        </Modal>
      )}

      <p className="f-foot"><b>页面只允许编排已经接通的动作</b>。演练只校验动作和通知活动，不改变生产状态；实战先进入 A2 确认队列，批准后再按顺序调用 J1/J2/C2/K1/I3/I5 真实入口并保存每步结果。J1 提现关停会直接阻断 D2 新提现，C2/K1 还会联动冻结相关 D2 待处理提现。任何未接通、未演练、并发失效或恢复方向的动作都会被服务端拒绝，不会以“已完成”掩盖失败。</p>
    </div>
  );
}
