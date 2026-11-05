"use client";

import {
  executeG3MarketChange, g3MarketChangeAuthority, g3MarketCommandExpired,
  g3MarketRequiresApproval, pendingG3MarketCommand,
  type G3CommandResult, type G3MarketChange,
} from "@/lib/admin/g3-market-command";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { OperationConfirmModal } from "../design-kit";

export function G3MarketConfirm({ session, epoch, requested, onClose, onDone }: {
  session: AdminSession; epoch: number; requested: G3MarketChange;
  onClose: () => void; onDone: (result: G3CommandResult) => void;
}) {
  const pending = pendingG3MarketCommand(session.adminId, requested);
  const change = pending?.change ?? requested;
  const schedule = change.action === "schedule";
  const initialSchedule = schedule && change.current === "";
  const probability = change.action === "curve-cell" && change.field === "pumpProbability";
  const title = change.action === "curve-cell"
    ? `修改一周价格计划 · D${change.dayIndex + 1} ${probability ? "上涨概率" : "目标价"}`
    : schedule ? initialSchedule ? "首次配置自动推进时间" : "调整价格计划运行方式 · 自动按日推进" : "手动设置 · 当前价格";
  const unit = schedule || probability ? "" : " USDT";
  const before = change.current || "未配置";
  const timing = change.action === "curve-cell"
    ? probability ? "只修改计划，当前价格保持不变。" : "只修改计划，当前价格保持不变。后续推进到该日才使用新目标价。"
    : initialSchedule ? "批准前不启用这份排程；批准后按所填时区安排后续推进，不当场修改价格。"
    : schedule ? "保存后按所填时区安排后续推进，不当场修改价格。"
    : "待审期间全站沿用当前价格。批准后发布新价格，下次自动切换仍按计划执行。";
  const coverageCopy = change.action === "curve-cell"
    ? `提交和批准时按拟改后整周最高目标价复核覆盖率。${probability ? "不把概率换算成虚构应付款。" : ""}`
    : "提交和批准时按拟发布价重估覆盖率。";

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
    action={title}
    detail={<>
      当前 {before}{unit}。{schedule ? <>填写运行时间与时区，例如「每日 08:30 Asia/Shanghai 自动推进」（北京时间 08:30）。未填时区按 UTC。</> : <>降低继续直接保存。{change.action === "current-price" ? "保存后立即发布，下次自动切换仍按计划执行。" : timing}</>}
    </>}
    amplifies={false}
    edit={schedule
      ? { kind: "text", label: "运行时间与时区", current: before, initialValue: pending?.value, disallowCurrent: true }
      : { kind: "number", label: probability ? "目标新值（0–1）" : "目标新值（USDT）", current: change.current, initialValue: pending?.value,
        min: probability ? 0 : 0.00000001, max: probability ? 1 : 1000000,
        step: probability ? 0.01 : 0.00000001, disallowCurrent: true, unit: unit.trim() }}
    reasonMin={8}
    reasonMax={200}
    getPendingReason={() => pendingG3MarketCommand(session.adminId, requested)?.reason}
    completionCopy={schedule ? timing : undefined}
    inlineApproval={{
      dialogClassName: `g3-market-confirm${schedule ? " g3-schedule-confirm" : ""}`,
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
          comparison: <>
            <div className="g3-market-comparison">当前 <strong>{before}{unit}</strong> → 拟改 <strong>{value || "待填写"}{unit}</strong></div>
            {!schedule && <p className="g3-market-check">{coverageCopy}</p>}
          </>,
        };
      },
      recover: () => execute("lookup"),
      retry: () => execute("retry").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, value) => execute("submit", reason, value ?? "").then(() => undefined)}
  />;
}
