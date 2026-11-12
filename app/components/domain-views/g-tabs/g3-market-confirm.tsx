"use client";

import {
  executeG3MarketChange, g3MarketChangeAuthority, g3MarketCommandExpired,
  g3MarketRequiresApproval, pendingG3MarketCommand,
  type G3CommandResult, type G3MarketChange,
} from "@/lib/admin/g3-market-command";
import type { G3CurveFrame } from "@/lib/admin/g3-client";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { Fact, Facts, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";

function price(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

/**
 * 提高目标价、上涨概率、现价和首次配置排程的确认框（W01、W02、W04、W07）。
 * 提交、查询原审批单和按原操作重试都走 executeG3MarketChange，原样不动；这里只排框里的层次：
 * 标题写动作和对象，标题下是生效方式，事实区随填写的新值说清生效方式、对兑换的影响和后端检查什么。
 */
export function G3MarketConfirm({ session, epoch, requested, today, frames, tuning, onClose, onDone }: {
  session: AdminSession; epoch: number; requested: G3MarketChange;
  /** 以下只用于显示：今天是第几天、七天计划、后端在当前环境是否允许人工改价（界面已备好，PC 现在读不到环境）。 */
  today: number; frames: G3CurveFrame[]; tuning: "unknown" | "forbidden" | "allowed";
  onClose: () => void; onDone: (result: G3CommandResult) => void;
}) {
  const pending = pendingG3MarketCommand(session.adminId, requested);
  const change = pending?.change ?? requested;
  const schedule = change.action === "schedule";
  const initialSchedule = schedule && change.current === "";
  const probability = change.action === "curve-cell" && change.field === "pumpProbability";
  const day = change.action === "curve-cell" ? `D${change.dayIndex + 1}` : "";
  const title = change.action === "curve-cell"
    ? `修改 ${day} ${probability ? "上涨概率" : "目标价"}`
    : schedule ? initialSchedule ? "首次配置自动推进时间" : "调整自动推进时间" : "应急改现价";
  const unit = schedule || probability ? "" : " USDT";
  const before = change.current || "未配置";
  // 生效方式一处说清：走审批时写在审批标题下，直接保存时写在业务后果下一行。
  const timing = change.action === "curve-cell"
    ? `另一位有权超管批准后才写进计划，批准前七天计划不变。`
    : initialSchedule ? "另一位有权超管批准后启用，批准前价格不自动推进。"
    : "另一位有权超管批准后才发布，待批期间现价不变。";
  const directCopy = change.action === "curve-cell"
    ? `确认后直接写进计划，推进到 ${day} 时按它发布。`
    : schedule ? "确认后保存，从下一次排程时刻起按新时间推进。"
    : "确认后立即发布新现价。";
  const restricted = probability || change.action === "current-price";

  const effect = change.action === "curve-cell"
    ? <StatusTag tone="progress" filled explain={`改的是计划。推进到 ${day}，或把生效日固定到 ${day} 时，才按它发布现价。`}>推进到 {day} 时生效</StatusTag>
    : change.action === "current-price"
      ? <StatusTag tone="progress" filled explain="降低：确认后立即发布。提高：另一位有权超管批准后才发布，待批期间现价不变。">发布新现价</StatusTag>
      : initialSchedule
        ? <StatusTag tone="progress" filled explain="另一位有权超管批准前不启用这份排程。">批准后启用</StatusTag>
        : <StatusTag tone="progress" filled>下一次排程时刻起生效</StatusTag>;

  const facts = (value?: string) => {
    const raising = !!value && !schedule && Number(value) > Number(change.current);
    const decided = !!value && !schedule;
    if (change.action === "curve-cell") {
      return <Facts>
        <Fact k="哪一天">{day}{change.dayIndex === today ? "（今天）" : ""}</Fact>
        <Fact k="提交时检查">{raising
          ? `按改后整周最高目标价（现在 ${price(Math.max(...frames.map((frame) => frame.targetPrice)))}）复核覆盖率，低于红线拒绝${probability ? "；概率不折成应付款" : ""}`
          : decided ? "七天计划在你打开后被改过就拒绝" : "提高复核兑付覆盖率；降低核对计划未变"}</Fact>
        {probability && <Fact k="环境限制" tone="warn">非开发环境后端一律拒绝改上涨概率（含审批）</Fact>}
      </Facts>;
    }
    if (change.action === "current-price") {
      return <Facts>
        <Fact k="提交时检查">{raising ? "按新价重估兑付覆盖率，低于红线拒绝" : decided ? "现价在你打开后变过就拒绝" : "提高按新价重估覆盖率；降低核对现价未变"}</Fact>
        <Fact k="环境限制" tone="warn">非开发环境后端一律拒绝直接改现价（含审批）</Fact>
      </Facts>;
    }
    return <Facts>
      <Fact k="怎么写">例如「每日 08:30 Asia/Shanghai 自动推进」（北京时间 08:30）。时区紧跟在时刻后面，不写按 UTC</Fact>
      <Fact k="现在的排程">{before}</Fact>
      <Fact k="提交时检查">{initialSchedule ? "格式、时刻和时区能被解析；排程在批准前仍未配置" : "格式、时刻和时区能被解析；原排程在你打开后没有被别人改过"}</Fact>
    </Facts>;
  };

  function ensureOwner(write: boolean) {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
    if (write && !auth.session.authorities.includes(g3MarketChangeAuthority(change))
        && auth.session.role !== "super" && auth.session.role !== "superadmin") {
      throw new Error("你没有修改这一项的权限。");
    }
  }
  async function execute(mode: "submit" | "lookup" | "retry", reason = "", value = "") {
    ensureOwner(mode !== "lookup");
    const result = await executeG3MarketChange(session, change, value, reason, mode);
    ensureOwner(false);
    if (result) onDone(result);
    return !!result;
  }

  return <OperationConfirmModal
    briefKind="config"
    action={change.action === "curve-cell"
      ? `修改一周价格计划 · D${change.dayIndex + 1} ${probability ? "上涨概率" : "目标价"}`
      : schedule ? initialSchedule ? "首次配置自动推进时间" : "调整价格计划运行方式 · 自动按日推进" : "手动设置 · 当前价格"}
    title={title}
    effect={effect}
    facts={facts}
    statedBrief={change.action === "curve-cell"
      ? { impact: change.dayIndex === today
        ? `只改计划，现价和用户兑换现在不变。${day} 就是今天，改了不会马上发布，要等下一轮推进到 ${day} 或固定到 ${day}。`
        : probability ? `只改计划，现价和用户兑换不变；推进到 ${day} 时写进当天配置，现价仍按目标价发布。` : `只改计划，现价和用户兑换现在不变；推进到 ${day} 时按新目标价发布，之后的兑换按新价。`,
        check: "核对是哪一天、新值和生效方式，理由写清调价依据。" }
      : change.action === "current-price"
        ? { impact: "发布后新的兑换按新价成交，已完成的兑换不变；七天计划不变，下次推进时恢复计划价。", check: "核对新价和生效方式，理由写清为什么要应急改价。" }
        : { impact: "只改自动推进的时间，现价不当场变；同一个 UTC 日期最多推进一次。", check: "核对时刻和时区，理由写清依据或工单号。" }}
    blockedReason={tuning === "forbidden" && restricted && !pending ? "当前环境后端禁止人工修改，提交会被拒绝" : undefined}
    confirmLabel="确认修改"
    detail={<>
      当前 {before}{unit}。{schedule ? <>填写运行时间与时区，例如「每日 08:30 Asia/Shanghai 自动推进」（北京时间 08:30）。未填时区按 UTC。</> : <>提高走审批，降低直接保存。</>}
    </>}
    amplifies={false}
    edit={schedule
      ? { kind: "text", label: "运行时间与时区", current: before, initialValue: pending?.value, disallowCurrent: true }
      : { kind: "number", label: probability ? "目标新值（0–1）" : "目标新值（USDT）", current: change.current, initialValue: pending?.value,
        min: probability ? 0 : 0.00000001, max: probability ? 1 : 1000000,
        step: probability ? 0.01 : 0.00000001, disallowCurrent: true, unit: unit.trim(),
        hint: probability ? "0–1，0.35 表示 35%" : "大于 0，最多八位小数" }}
    reasonMin={8}
    reasonMax={200}
    getPendingReason={() => pendingG3MarketCommand(session.adminId, requested)?.reason}
    completionCopy={directCopy}
    inlineApproval={{
      dialogClassName: `g3-market-confirm${schedule ? " g3-schedule-confirm" : ""}`,
      fieldLayout: "compact",
      pending: pending?.request.kind === "approval",
      expired: !!pending && g3MarketCommandExpired(pending),
      disabledReason: pending && pending.request.kind === "direct" && g3MarketCommandExpired(pending)
        ? "原直接保存请求已过期，仅保留原内容供核对。该入口没有按命令号查询接口，不能重试或另建编号。" : undefined,
      resolve: (_business, value) => {
        if (!(pending ? pending.request.kind === "approval" : g3MarketRequiresApproval(change, value))) return undefined;
        return {
          heading: initialSchedule ? "首次配置需另一位超管批准" : "需另一位超管批准后生效",
          completionCopy: timing,
          disabledReason: !/^[0-9a-f]{64}$/.test(change.expectedRevision) ? "当前配置版本未就绪，请关闭弹窗后重新读取页面。" : undefined,
        };
      },
      recover: () => execute("lookup"),
      retry: () => execute("retry").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, value) => execute("submit", reason, value ?? "").then(() => undefined)}
  />;
}
