"use client";

/**
 * G3「排程执行情况」：紧挨「自动按日推进」那一行，排的时间和最近一次实际结果上下对照（G3-BE-04，后端 56bc8461 G3ScheduledAdvanceService.latestExecution）。
 * 没有记录、读不到、服务还不支持各写各的，都不叫失败；失败也不说成价格没变。记录编号、存放位置、UTC 排程日只放「技术信息」。
 */
import { CircleHelp, Clock3, TriangleAlert } from "lucide-react";
import { Change, Explain, Fact, Facts, InlineRetry, StatusTag } from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import type { G3ScheduleAttempt, G3ScheduleExecutionRead } from "@/lib/admin/g3-client";
import { amountDisplay } from "@/lib/format";

const OUTCOME: Record<G3ScheduleAttempt["outcome"], { label: string; tone: StateTone }> = {
  ADVANCED: { label: "已推进", tone: "ok" },
  PRICE_CHANGED: { label: "价格已更新", tone: "ok" },
  NO_CHANGE: { label: "没有变化", tone: "neutral" },
  SKIPPED: { label: "跳过", tone: "neutral" },
  COMPLETED: { label: "已执行", tone: "neutral" },
  FAILED: { label: "失败", tone: "danger" },
};

/** 没变化、跳过、失败的原因：和 lib/admin/error-messages.ts 同一套叫法（句首相同），一句话。没有对应的写「原因没记下」，原码在技术信息。 */
const REASON: Record<string, string> = {
  G3_ENGINE_PAUSED: "价格自动变化已暂停",
  G3_FRAME_PINNED: "已固定生效日",
  G3_FRAME_VALUES_UNCHANGED: "推进后生效日和价格都和之前一样",
  G3_WEEKLY_CURVE_NOT_CONFIGURED: "七天价格计划还没配置",
  RUN_DATE_ALREADY_CLAIMED: "这一天的排程已经执行过，不再重复",
  PRICE_COMPARISON_UNAVAILABLE: "前后价格有一个读不到，看不出变没变",
  G3_WEEKLY_CURVE_INVALID: "七天价格计划不完整或格式不对",
  B1_COVERAGE_UNRELIABLE: "兑付覆盖率读不准",
  COVERAGE_BELOW_REDLINE: "兑付覆盖率低于红线",
  AUDIT_REQUIRED_DISABLED: "操作记录服务没开",
  AUDIT_REQUIRED_INVALID: "操作记录内容不完整",
  PERSISTENCE_FAILURE: "保存数据时出错",
  TRANSACTION_FAILURE: "保存数据时出错",
  G3_SCHEDULE_EXECUTION_FAILED: "系统内部出错",
};

const reasonText = (code: string | null) => code ? REASON[code] ?? "原因没记下" : "原因没记下";
const at = (value: string) => formatBusinessTimeCompact(value, "—");
const usdt = (value: string) => `${amountDisplay(value)} USDT`;
const day = (index: number | null) => index === null ? "—" : `D${index + 1}`;

/** 这一次做了什么：推进写生效日和价格的前后；没变化、跳过、失败写原因。 */
function attemptDetail(attempt: G3ScheduleAttempt) {
  const before = `${day(attempt.beforeDayIndex)} · ${attempt.beforePrice ? usdt(attempt.beforePrice) : "价格读不到"}`;
  const after = `${day(attempt.afterDayIndex)} · ${attempt.afterPrice ? usdt(attempt.afterPrice) : "价格读不到"}`;
  if (attempt.outcome === "ADVANCED" || attempt.outcome === "PRICE_CHANGED") return <Change settled from={before} to={after} />;
  if (attempt.outcome === "COMPLETED") return <span className="g3-run-detail"><Change settled from={before} to={after} /><span>{reasonText(attempt.reasonCode)}</span></span>;
  if (attempt.outcome === "FAILED") return `${reasonText(attempt.reasonCode)}；价格有没有变，以现价为准`;
  return reasonText(attempt.reasonCode);
}

function techInfo(attempt: G3ScheduleAttempt) {
  return <>
    <p>记录编号 <span data-mono="">{String(attempt.auditId)}</span>{attempt.storage === "nx_audit_log_archive" ? "（已归档）" : ""}</p>
    {attempt.runDate && <p>排程日（UTC）<span data-mono="">{attempt.runDate}</span></p>}
    <p>开始 {at(attempt.attemptedAt)}，结束 {at(attempt.completedAt)}（{businessZone().label}）</p>
    {attempt.reasonCode && <p>原因码 <span data-mono="">{attempt.reasonCode}</span></p>}
  </>;
}

export function G3ScheduleResult({ read, onRetry, retrying }: {
  read: G3ScheduleExecutionRead | undefined;
  onRetry: () => void;
  retrying: boolean;
}) {
  const zone = businessZone().label;
  const head = <div className="g3-subhead">排程执行情况<span className="g3-subnote">{`时间为${zone}`}</span>
    <Explain label="排程执行情况" content={<>
      <p>到了排程时间，系统有没有真的切换。只记每天排程那一次，不含手动固定、应急改价。</p>
      <p>「没有变化」「跳过」是排程照常跑了，只是这次不用切换。</p>
      <p>失败时价格可能已经改过，以现价为准。</p>
    </>} /></div>;
  if (!read || read.state === "unsupported") {
    return <section className="g3-run" aria-label="排程执行情况">{head}<Facts>
      <Fact k="实际执行">{read ? <span className="g3-run-detail"><StatusTag tone="neutral" icon={CircleHelp}>看不到</StatusTag><span>当前服务版本还没有执行记录</span></span> : "—"}</Fact>
    </Facts></section>;
  }
  if (read.state === "unavailable") {
    return <section className="g3-run" aria-label="排程执行情况">{head}<Facts>
      <Fact k="实际执行"><span className="g3-run-detail"><StatusTag tone="warn" icon={TriangleAlert} explain={read.error}>读不到</StatusTag><span>不代表没执行或失败</span><InlineRetry onRetry={onRetry} retrying={retrying} label="重新读取" /></span></Fact>
    </Facts></section>;
  }
  const { lastAttempt, lastAdvance, execution, reason } = read.data;
  if (!lastAttempt) {
    const legacy = reason === "LEGACY_MARK_ONLY" && execution;
    return <section className="g3-run" aria-label="排程执行情况">{head}<Facts>
      <Fact k="实际执行"><span className="g3-run-detail">
        <StatusTag tone="neutral" icon={Clock3} explain={legacy ? <>只记了 UTC 日期 <span data-mono="">{execution.runDate}</span> 执行过，没记下结果。</> : undefined}>{legacy ? "只有旧标记" : "还没有记录"}</StatusTag>
        <span>{legacy ? `${at(execution.updatedAt)} 执行过，结果没记下` : "排程还没执行过，或执行时还没开始记录"}</span>
      </span></Fact>
    </Facts></section>;
  }
  const outcome = OUTCOME[lastAttempt.outcome];
  const advanceIsLast = lastAdvance && String(lastAdvance.auditId) === String(lastAttempt.auditId);
  return (
    <section className="g3-run" aria-label="排程执行情况" data-outcome={lastAttempt.outcome}>
      {head}
      <Facts>
        <Fact k="最近一次" tone={lastAttempt.outcome === "FAILED" ? "danger" : undefined}>
          <span className="g3-run-detail">
            <StatusTag tone={outcome.tone} filled={lastAttempt.outcome === "FAILED"}>{outcome.label}</StatusTag>
            <span>{at(lastAttempt.attemptedAt)}</span>
            <Explain label="技术信息" content={techInfo(lastAttempt)} />
          </span>
        </Fact>
        <Fact k={lastAttempt.outcome === "FAILED" ? "原因" : "结果"}>{attemptDetail(lastAttempt)}</Fact>
        {!advanceIsLast && <Fact k="最近一次推进">{lastAdvance
          ? <span className="g3-run-detail"><span>{at(lastAdvance.attemptedAt)}</span>{lastAdvance.outcome === "ADVANCED"
            ? <Change settled from={day(lastAdvance.beforeDayIndex)} to={day(lastAdvance.afterDayIndex)} />
            : <span>{`${day(lastAdvance.afterDayIndex)} 价格已更新`}</span>}</span>
          : "—（没有记录）"}</Fact>}
      </Facts>
    </section>
  );
}
