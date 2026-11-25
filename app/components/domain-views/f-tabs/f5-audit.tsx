"use client";

/**
 * F5 奖励记录核对（改版）。首屏：一句结论 → 奖励走到哪一步（七个状态一条路）→ 各类奖励；下面五个页签：
 * 奖励流水（筛选、勾选补发、点行看详情）、等价格、异常样本、暂停名单、处置历史。
 * 读取、筛选、翻批、导出和七个处置都调用 F 域外壳原有的函数，请求和改版前一样；这里只管排版和文字。
 */
import type { BusinessFormValue } from "../design-kit";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, ListChecks, RotateCcw } from "lucide-react";
import {
  BatchBar, Button, Cell, Change, Checkbox, Conclusion, Explain, Fact, Facts, FilterBar, FilterField, Input, IrreversibleTag, MoreMenu,
  Notice, PageHeader, PageTabs, Panel, Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {  type F5CommissionEvent, type F5CommissionQuery } from "@/lib/admin/f1-client";
import type { F5Recovery, FViewCtx } from "./types";
import { FReleaseButton } from "./f-release";
import { rebaseFValues, useFReconfirmations } from "@/lib/admin/f-reconfirmation";
import { canRetryF5Proposal, f5ProposalAuthority, type F5ConfirmationSnapshot } from "@/lib/admin/f5-approval";
import { canRetryF5Anomaly } from "@/lib/admin/f5-anomaly-write";
import { f5ExportRecovery, pendingF5Export } from "@/lib/admin/f5-export-operation";
import { compareDecimal } from "@/lib/admin/f1-rank-benefit";
import { readF5Filters, readF5Tab, replaceTeamFilterParams, type F5Tab } from "@/lib/admin/team-filter-url";
import { teamUserId } from "@/lib/admin/f-overview-contract";
import { isPreviousMonthSalaryClaim } from "@/lib/admin/business-calendar-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import {
  APPROVER, KIND_LABELS, STATUS_BY_LABEL, STATUS_META, StatusBadge, amountText, approvalTag, approverText, deviceEarningSource, isFriend, isGrouped, kindCountLabel, knownRejection,
  reissueOutcome, statusName, timeText, userCode, zoneNote, F5ConfirmHost, Money, F5RecoveryNotice, type F5Confirm, type F5RecoveryRow,
} from "./f5-shared";
import { F5KindTiles, F5StatusFlow } from "./f5-overview";
import { F5Drawer, type F5RowAction } from "./f5-drawer";
import { F5AnomalyList, F5HistoryList, F5PendingList, F5SuspensionList } from "./f5-lists";

const F5_DISPOSAL_CODES = ["f_commission_status", "f5_commission_reverse", "f5_commission_reissue", "f5_commission_suspension"];
const STATUS_ORDER = ["cooling", "unlocked", "withdrawn", "frozen", "reversed", "recovery_pending", "rejected"];
const SETTLED = ["reversed", "withdrawn", "rejected", "recovery_pending"];

export function F5Audit({ ctx }: { ctx: FViewCtx }) {
  const canExport = useAdminAuth(({ session }) => session?.authorities.includes("network_f5_export") ?? false);
  const canWrite = ctx.can("network_f5_write");
  const canFreeze = ctx.can("network_f5_commission_freeze");
  const canSuspend = ctx.can("network_f5_commission_suspend");
  const canRelease = ctx.can("network_f5_commission_release");
  const canReverse = ctx.can("network_f5_commission_reverse");
  const canReissue = ctx.can("network_f5_commission_reissue");
  const reach = useReach();
  const canReadD4 = reach("/finance/ledger", "finance_d4_read");
  const canReadB1 = reach("/overview/dual-ledger");
  const canReadL4 = reach("/analytics/operations", "bi_l4_read");
  const canReadA2 = reach("/platform/audit", "platform_a2_read");
  const canReadA4 = reach("/platform/events");
  const canReadSalary = reach("/network/v-rank", "network_f1_read");
  const [kind, setKind] = useState("");
  const [currency, setCurrency] = useState("");
  const [userId, setUserId] = useState("");
  const [userQueryError, setUserQueryError] = useState(false);
  const [cohort, setCohort] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // 已应用条件独立于正在编辑的草稿，并在翻批时保持不变。
  const [applied, setApplied] = useState<F5CommissionQuery>({});
  const [tab, setActiveTab] = useState<F5Tab>("records");
  const setTab = (next: F5Tab) => {
    setActiveTab(next);
    replaceTeamFilterParams({ tab: next === "records" ? undefined : next });
  };
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const next = readF5Filters(params);
      const nextTab = readF5Tab(params);
      setApplied(next);
      setKind(next.kind ?? "");
      setCurrency(next.currency ?? "");
      setUserId(next.userId ?? "");
      setCohort(next.cohort ?? "");
      setStatus(next.status ?? "");
      setActiveTab(nextTab);
      setSelected([]);
      replaceTeamFilterParams({ tab: nextTab === "records" ? undefined : nextTab });
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const [openId, setOpenId] = useState<string | null>(null);
  // 九类奖励折叠组开着没有放在这里：筛选后重读数据时卡片会重新挂载，不能因此自己收起。
  const [kindsOpen, setKindsOpen] = useState(false);
  const [confirm, setConfirm] = useState<F5Confirm | null>(null);
  const proposalDrafts = useFReconfirmations("F5");
  const anomalyDrafts = useFReconfirmations("f5-anomaly");
  const [, refreshExport] = useState(0);
  const originalExport = pendingF5Export();
  const tabIds = useTabIds();
  const { f5Overview: data, f5AppliedQuery, f5NextQuery, f5AppendError, f5Loading: loading, f5Error: error } = ctx;
  const suspendableKinds = data?.suspendableKinds ?? [];
  const reissueAvailable = canReissue && !error && !!data;
  const busyText = "奖励记录正在更新";
  const exportBlockedReason = ctx.f5ExportBlocked(f5AppliedQuery ?? {});
  const events = useMemo(() => data?.commissionEvents ?? [], [data]);
  const selectedRows = useMemo(
    () => events.filter((row) => selected.includes(row.id)),
    [events, selected],
  );
  const anyWrite = canWrite || canFreeze || canSuspend || canRelease || canReverse || canReissue;
  const rowWrite = canFreeze || canRelease || canReverse || canSuspend;
  useEffect(() => {
    // Refresh invalidates new confirmations; retained originals stay independently recoverable.
    setConfirm(current => {
      if (!current) return null;
      if (current.recovery && [...proposalDrafts, ...anomalyDrafts].some(row => row.commandKey === current.recovery!.original.commandKey)) return null;
      const saved = current.snapshot ? ctx.getF5Operation(current.snapshot) : undefined;
      if (saved) return current.recovery ? current : { ...current, recovery: saved };
      return current;
    });
  }, [ctx.f5Proposals, ctx.f5AnomalyWrites]);
  useEffect(() => {
    setConfirm(current => current?.recovery || current?.exportFilters ? current : null);
  }, [ctx.f5ReadEpoch]);

  const query = (): F5CommissionQuery => ({
    kind: kind || undefined,
    currency: currency || undefined,
    userId: teamUserId(userId) ?? undefined,
    cohort: cohort.trim() || undefined,
    status: status || undefined,
    limit: "20",
  });
  const load = (next: F5CommissionQuery) => {
    setApplied(next);
    replaceTeamFilterParams({ kind: next.kind, currency: next.currency, userId: next.userId, cohort: next.cohort, status: next.status });
    void ctx.refreshF5(next);
  };

  const applyKindFilter = (selectedKind: string) => {
    const nextKind = applied.kind === selectedKind ? "" : selectedKind;
    setKind(nextKind);
    setSelected([]);
    setTab("records");
    load({ ...applied, kind: nextKind || undefined, cursor: undefined, limit: "20" });
  };

  /** 页级提示「看待追回」：流水只看待追回（已经在看就不取消），切到流水页签并滚到表格。 */
  const showRecovery = () => {
    if (applied.status !== "recovery_pending") applyStatusFilter("recovery_pending");
    else setTab("records");
    requestAnimationFrame(() => document.getElementById("f5-records")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const applyStatusFilter = (selectedStatus: string) => {
    const nextStatus = applied.status === selectedStatus ? "" : selectedStatus;
    setStatus(nextStatus);
    setKind(""); setCurrency(""); setUserId(""); setCohort("");
    setSelected([]);
    setTab("records");
    load({ status: nextStatus || undefined, limit: "20" });
  };

  const submitFilters = () => {
    const invalidUser = !!userId.trim() && teamUserId(userId) === null;
    setUserQueryError(invalidUser);
    if (invalidUser) return;
    setSelected([]);
    load(query());
  };
  const clearFilters = () => {
    setUserQueryError(false);
    setKind(""); setCurrency(""); setUserId(""); setCohort(""); setStatus(""); setSelected([]);
    load({ kind: undefined, currency: undefined, userId: undefined, cohort: undefined, status: undefined, limit: "20" });
  };
  const hasDraft = !!(kind || currency || userId.trim() || cohort.trim() || status);
  // 草稿和已应用条件不一致时在「查询」旁写「条件未应用」（ST-18）；用户输入按查询时的换算比。
  const draftChanged = (kind || undefined) !== applied.kind || (status || undefined) !== applied.status || (currency || undefined) !== applied.currency
    || (cohort.trim() || undefined) !== applied.cohort || (userId.trim() ? teamUserId(userId) ?? userId.trim() : undefined) !== applied.userId;

  const groupMoney = (row: F5CommissionEvent) => row.amountUSDT !== undefined && row.amountNEX !== undefined
    ? `${amountText(row.amountUSDT)} USDT + ${amountText(row.amountNEX)} UVT` : "—";
  const kindName = (value: string) => KIND_LABELS[value] ?? "未知奖励类型";
  const completion = `${APPROVER}在「操作记录与审批」批准后才执行；批准前这笔奖励不变。`;
  const recordFacts = (row: F5CommissionEvent) => <>
    <Fact k="金额" lead tone="role-1" unit={row.cur}>{amountText(row.amt)}</Fact>
    <Fact k="奖励"><span data-mono>{row.id}</span> · {kindName(row.kind)}</Fact>
    <Fact k="用户">{row.user}</Fact>
  </>;
  const scopeFact = (row: F5CommissionEvent, verb: string) => isFriend(row)
    ? <Fact k="处置范围" tone="warn">好友奖励整组一起{verb}：{groupMoney(row)}</Fact>
    : isGrouped(row) ? <Fact k="处置范围">只{verb}这一笔，同组另一种币不动</Fact>
      : <Fact k="处置范围">只{verb}这一笔</Fact>;

  // 单笔冻结 / 提前解锁 / 解冻：可逆的「先按住观察」，和不可逆的冲正分开。提交走外壳原有的 updateF5Config（f_commission_status 审批单）。
  const dispose = (action: "freeze" | "unlock" | "unfreeze", row: F5CommissionEvent, recovery?: F5Recovery) => {
    const friend = isFriend(row);
    const grouped = isGrouped(row);
    // 暂停名单最多 100 条：命中能说明在暂停，没命中不能说明没暂停，所以只写命中的。
    const suspension = grouped ? undefined : data?.activeSuspensions.find(item => item.userId === String(row.userId) && item.kind === row.kind);
    if (action === "freeze") {
      setConfirm({
        recovery, snapshot: recovery?.original.f5Snapshot ?? { action, row, coverage: data?.coverage },
        action: `冻结奖励 ${row.id}`, title: "冻结奖励", briefKind: "funds", effect: approvalTag(), completionCopy: completion,
        statedBrief: { impact: "批准后这笔停在冷却里，到期也不解锁；用户余额不变", check: "核对这笔奖励和用户，理由写清为什么要先按住。" },
        detail: `冻结 ${row.id}：批准后从冷却中改为已冻结，到期也不会解锁。和冲正不同，冻结可以解冻。`,
        facts: <Facts>
          {recordFacts(row)}
          <Fact k="状态"><Change from="冷却中" to="已冻结" /></Fact>
          {scopeFact(row, "冻结")}
          <Fact k="用户余额">不变：这笔还在冷却，没进可用余额</Fact>
          <Fact k="能不能撤回">能，解冻后回到冷却中</Fact>
          <Fact k="谁来批准">{approverText("奖励冻结权限")}</Fact>
        </Facts>,
        submit: async (reason) => {
          await ctx.updateF5Config(row.auditKey, "frozen", reason, row.version);
          ctx.toast(`冻结 ${row.id} 已提交审批，批准前这笔不变`);
        },
      });
    } else if (action === "unlock") {
      setConfirm({
        recovery, snapshot: recovery?.original.f5Snapshot ?? { action, row, coverage: data?.coverage },
        action: `奖励提前解锁 ${row.id}`, title: "提前解锁奖励", briefKind: "funds", effect: approvalTag(), completionCopy: completion, amplify: true,
        coverageLead: "提前解锁后这笔钱可能提前流出",
        coverageCheck: grouped ? "提交前按页面读到的兑付覆盖率查一次。批准时系统再查：覆盖率读不到或低于红线不放钱，审批单留着待审批；等于红线算够。冷却没到期、暂停、风险或退款也会被拒。" : "提交前按页面读到的兑付覆盖率查一次。批准时系统再查：这类奖励在暂停中会被拒；覆盖率读不到或低于红线不放钱，审批单留着待审批；等于红线算够。",
        blockedReason: knownRejection(row, "release", data?.activeSuspensions),
        statedBrief: grouped
          ? { impact: "批准时系统核对结算组的冷却是否真正到期，没到期会拒绝", check: "核对剩余冷却天数，理由写清为什么要提前。" }
          : { impact: "批准后这笔改为已解锁，释放到用户钱包", check: "核对兑付覆盖率和这笔奖励，理由写清为什么要提前。" },
        detail: grouped
          ? `提前解锁 ${row.id}：这笔属于结算组，冷却没真正到期就不会提前放钱。`
          : `提前解锁 ${row.id}：批准后从冷却中改为已解锁，释放到用户钱包；不改冷却设置。`,
        facts: <Facts>
          {recordFacts(row)}
          <Fact k="状态"><Change from="冷却中" to="已解锁" /></Fact>
          <Fact k="剩余冷却">{row.coolingDaysLeft > 0 ? `${row.coolingDaysLeft} 天` : "当天到期或没有到期时间"}</Fact>
          {suspension && <Fact k="奖励暂停" tone="warn">这类奖励正在暂停，批准时会被拒<Explain label="暂停原因" content={`${suspension.reason || "暂停时没写原因"}（${timeText(suspension.updatedAt)} 起，${zoneNote()}）`} /></Fact>}
          {grouped
            ? <Fact k="用户余额" tone="warn">属于结算组：冷却没真正到期时批准会被拒，钱不会提前流出</Fact>
            : <Fact k="用户余额">批准后进用户钱包的可用余额；能不能提走仍受钱包其他限制</Fact>}
          <Fact k="能不能撤回" tone="warn">不能改回冷却中，要收回只能冲正</Fact>
          <Fact k="谁来批准">{approverText("提前解锁权限")}</Fact>
        </Facts>,
        submit: async (reason) => {
          await ctx.updateF5Config(row.auditKey, "unlocked", reason, row.version);
          ctx.toast(`提前解锁 ${row.id} 已提交审批，批准前这笔不变`);
        },
      });
    } else {
      setConfirm({
        recovery, snapshot: recovery?.original.f5Snapshot ?? { action, row, coverage: data?.coverage },
        action: `解冻奖励 ${row.id}`, title: "解冻奖励", briefKind: "funds", effect: approvalTag(), completionCopy: completion,
        statedBrief: { impact: "批准后这笔回到冷却中；有到期时间的到期后自动解锁，解冻本身不动用户余额", check: "核对冻结的原因是否已经解除，理由写清依据。" },
        detail: `解冻 ${row.id}：批准后从已冻结回到冷却中，不是直接解锁。`,
        facts: <Facts>
          {recordFacts(row)}
          <Fact k="状态"><Change from="已冻结" to="冷却中" /></Fact>
          {scopeFact(row, "解冻")}
          {friend
            ? <Fact k="到期时间" tone="warn">沿用原来的，不重新计算；用户还有其他冻结条件（暂停、风险）时批准会被拒</Fact>
            : <>
              <Fact k="到期时间">接着冷却冻结时还剩的时间</Fact>
              <Fact k="可能被拒" tone="warn">到期时间已丢失的旧记录会被拒，奖励仍冻结<Explain label="哪些旧记录会被拒" content="以前暂停用户奖励时冻结的旧记录，到期时间被清空了，系统不替它补算，这页也看不出是哪几笔。被拒后要处理，请联系值班人员核对。" /></Fact>
            </>}
          <Fact k="用户余额">解冻本身不动余额</Fact>
          <Fact k="能不能撤回">能，可以再冻结</Fact>
          <Fact k="谁来批准">{approverText("奖励冻结权限")}</Fact>
        </Facts>,
        submit: async (reason) => {
          await ctx.updateF5Config(row.auditKey, "cooling", reason, row.version);
          ctx.toast(`解冻 ${row.id} 已提交审批，批准前这笔不变`);
        },
      });
    }
  };

  const reverse = (row: F5CommissionEvent, recovery?: F5Recovery) => {
    const friend = isFriend(row);
    const salary = row.kind === "vrank_salary";
    const tracksRecovery = isGrouped(row) || row.kind === "vrank_salary";
    const after = tracksRecovery ? "已冲正或待追回" : "已冲正";
    setConfirm({
      recovery, snapshot: recovery?.original.f5Snapshot ?? { action: "reverse", row },
      action: `冲正奖励 ${row.id}`, title: "冲正奖励", briefKind: "funds", confirmTone: "danger", completionCopy: completion,
      effect: <>{approvalTag()}<IrreversibleTag /></>,
      blockedReason: knownRejection(row, "reverse"),
      reasonPlaceholder: "例如：订单已退款，工单号",
      statedBrief: { impact: tracksRecovery ? "批准后收回这笔奖励，余额不够的部分记为待追回" : "批准后收回这笔奖励，余额不够时整次失败", check: "核对凭证单号和这笔奖励有关，理由写清收回的原因。" },
      detail: `冲正 ${row.id}：批准后收回这笔奖励，状态改为${after}。`,
      facts: <Facts>
        {recordFacts(row)}
        <Fact k="状态"><Change from={statusName(row.status)} to={after} /></Fact>
        {scopeFact(row, "收回")}
        {tracksRecovery
          ? <Fact k="用户余额" tone="warn">已入账的部分按现在的余额扣回，扣不够的记为待追回，不会扣成负数</Fact>
          : <Fact k="用户余额" tone="warn">已转进钱包的才扣回；余额不够时这次冲正整个失败，什么都不改<Explain label="没有结算组的旧奖励怎么收回" content="还没转进钱包的，只关掉待发记录，不扣余额。余额不够不会记成待追回，冲正会失败，要等余额够了再提交。" /></Fact>}
        <Fact k="之后">{friend ? "好友奖励冲正后不能补发" : "可以勾选申请补发，批准时再核补发条件"}</Fact>
        {salary && (row.claimNo || canReadSalary) && <Fact k="月薪领取号">{row.claimNo
          ? <span data-mono>{row.claimNo}</span>
          : <Link className="rd-link" href={`/network/v-rank?tab=salary&userId=${encodeURIComponent(row.user)}`} prefetch={false}>去月薪领取记录查询</Link>}</Fact>}
        <Fact k="谁来批准">{approverText("冲正权限")}</Fact>
      </Facts>,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "refundRef", label: "凭证单号", inputKind: "text", required: true, wide: true, placeholder: salary ? "这笔月薪的领取号或关联客服工单号" : "关联订单号、等级发放单号或客服工单号",
            explain: salary ? "填这次月薪的领取号，或与这笔月薪有关的客服工单号。"
              : "系统只核对这个编号存在：这笔奖励的订单号、等级奖励的发放单号，或任意一张没删除的客服工单号。不核对工单是不是这位用户的，请自己确认和这笔奖励有关。" },
        ],
      },
      submit: async (reason, value) => {
        const refundRef = value?.refundRef?.trim();
        if (!refundRef) throw new Error("请填写有效的单号");
        await ctx.reverseF5Commission(row.id, refundRef, reason);
        ctx.toast("已提交，等待审批后执行");
      },
    });
  };

  const reissue = (rows = selectedRows, policy = data?.coolingPolicy, recovery?: F5Recovery) => {
    if (rows.some(row => isFriend(row) || row.reversalRecorded || row.status !== "reversed")) {
      ctx.toast("好友奖励、已退款或待追回的记录不能补发。");
      return;
    }
    if (!rows.length) {
      ctx.toast("请先勾选要补发的已冲正奖励");
      return;
    }
    const after = (row: F5CommissionEvent) => reissueOutcome(row.kind, policy?.find((item) => item.kind === row.kind)?.days);
    setConfirm({
      recovery, snapshot: recovery?.original.f5Snapshot ?? { action: "reissue", rows, coolingPolicy: policy, coverage: data?.coverage },
      action: `批量补发 ${rows.length} 笔奖励`, title: "批量补发奖励", briefKind: "funds", amplify: true, completionCopy: `${APPROVER}在「操作记录与审批」批准后才执行；批准前不生成新记录。`,
      effect: approvalTag("批准前不生成新记录。"),
      coverageLead: "补发会给每笔生成一条新的应付奖励",
      coverageCheck: "提交前按页面读到的兑付覆盖率检查一次；批准执行时再查一次，低于红线整批不补发。",
      statedBrief: { impact: "批准后每笔生成一条新记录，原记录保持已冲正", check: "核对每一笔为什么能补发，理由写清依据。" },
      detail: `补发已冲正的记录：${rows.map((row) => row.id).join("、")}。`,
      facts: <Facts>
        <Fact k="补发" lead unit="笔">{String(rows.length)}</Fact>
        <Fact k="补发后">每笔生成一条新记录，原记录保持已冲正</Fact>
        <Fact k="整批" tone="warn">有一笔不合格，整批都不补，不会只补一部分</Fact>
        <Fact k="用户余额">{[...new Set(rows.map(after))].join("；")}</Fact>
        <Fact k="能不能撤回">不能；新记录可以再冲正</Fact>
        <Fact k="谁来批准">{approverText("补发权限")}</Fact>
      </Facts>,
      content: <section className="rd-impact" aria-label="这次补发的记录">
        <h3 className="rd-impact-title">这次补发的 {rows.length} 笔</h3>
        <Table label="这次补发的记录" className="f5-table">
          <thead><tr><Th>原记录</Th><Th>用户</Th><Th align="right">金额</Th><Th>补发后</Th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td><Cell main={<span data-mono>{row.id}</span>} sub={kindName(row.kind)} /></Td>
                <Td><Cell mono main={row.user} /></Td>
                <Td align="right"><Cell num main={<Money value={row.amt} currency={row.cur} />} /></Td>
                <Td><Cell main={after(row)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>,
      submit: async (reason) => {
        await ctx.reissueF5Commissions(rows.map((row) => row.id), reason);
        setSelected([]);
        ctx.toast("批量补发已提交，等待审批");
      },
    });
  };

  const suspend = (row: F5CommissionEvent, recovery?: F5Recovery) => {
    setConfirm({
      recovery, snapshot: recovery?.original.f5Snapshot ?? { action: "suspend", row },
      action: `暂停用户 ${row.userId} 的奖励`, title: "暂停用户奖励", briefKind: "funds", completionCopy: `${APPROVER}在「操作记录与审批」批准后才执行；批准前这位用户的奖励照常。`,
      effect: approvalTag("批准前这位用户的奖励照常。"),
      statedBrief: { impact: "批准后这位用户所选类型里未发完的记录改为已冻结（等价格、待追回的不动）", check: "核对用户和要暂停的类型，理由写清依据。" },
      detail: "暂停这位用户所选类型的奖励。",
      facts: <Facts>
        <Fact k="用户">{row.user}</Fact>
        <Fact k="从哪一笔打开"><span data-mono>{row.id}</span> · {kindName(row.kind)}</Fact>
        <Fact k="批准后">所选类型里未发完的记录改为已冻结<Explain label="哪些记录会被冻结" content="好友两类：冷却中和已冻结的整组按住，等价格的不动。其他类型：等发放、冷却中、已解锁的都改为已冻结，到期时间保留。已提现、已冲正、待追回的记录不动。" /></Fact>
        <Fact k="以后" tone="warn">好友两类以后算出金额的先冻结；其他类型以后不一定停发</Fact>
        <Fact k="能不能撤回">能，在「暂停名单」恢复，也要审批</Fact>
        <Fact k="谁来批准">{approverText("暂停奖励权限")}</Fact>
      </Facts>,
      businessForm: {
        kind: "multi-field",
        fields: [
          {
            key: "kinds",
            label: "暂停哪些奖励",
            current: row.kind,
            inputKind: "multi-select",
            options: [...suspendableKinds],
            optionLabels: KIND_LABELS,
            required: true,
            wide: true,
          },
        ],
      },
      submit: async (reason, value) => {
        const kinds = (value?.kinds ?? "").split(",").map((item) => item.trim()).filter(Boolean);
        if (!kinds.length) throw new Error("至少选择一种奖励");
        await ctx.suspendF5UserCommissions(row.userId, kinds, true, reason);
        ctx.toast(`用户 ${row.userId} 的 ${kinds.map((item) => KIND_LABELS[item] ?? "所选奖励").join("、")} 暂停已提交，等待审批`);
      },
    });
  };

  const resume = (item: { userId: string; kind: string }, recovery?: F5Recovery) => {
    const friend = item.kind === "direct_purchase" || item.kind === "direct_device_earning";
    setConfirm({
      recovery, snapshot: recovery?.original.f5Snapshot ?? { action: "resume", suspension: item },
      action: `恢复奖励 · ${item.userId} / ${KIND_LABELS[item.kind] ?? "所选奖励"}`, title: "恢复用户奖励",
      briefKind: friend ? "funds" : "record",
      completionCopy: `${APPROVER}在「操作记录与审批」批准后才执行；批准前继续暂停。`,
      effect: approvalTag("批准前继续暂停。"),
      statedBrief: { impact: friend ? "批准后没有其他冻结条件的好友奖励回到冷却中" : "批准后只解除暂停，已冻结的记录不会自动解冻", check: "核对用户和奖励类型，理由写清为什么可以恢复。" },
      detail: friend
        ? "批准后解除这类暂停；没有其他冻结条件的好友奖励回到冷却期，风控、政策或价格条件仍可能拦住发放。"
        : "批准后解除暂停，已冻结的不会自动解冻。",
      facts: <Facts>
        <Fact k="用户">{userCode(item.userId)}</Fact>
        <Fact k="奖励类型">{kindName(item.kind)}</Fact>
        <Fact k="状态"><Change from="暂停中" to="恢复" /></Fact>
        {friend
          ? <Fact k="批准后">没有其他冻结条件的好友奖励回到冷却中，到期时间不重新计算；还有其他冻结条件的继续冻结</Fact>
          : <Fact k="批准后" tone="warn">只解除暂停；之前冻结的这类记录不会自动解冻，要在「奖励流水」逐笔解冻<Explain label="解冻后会不会自动到期" content="会。暂停时冻结的记录保留到期时间，解冻后接着冷却，到期自动解锁。以前暂停时清掉了到期时间的旧记录不能解冻，要联系值班人员核对。" /></Fact>}
        <Fact k="谁来批准">{approverText("暂停奖励权限")}</Fact>
      </Facts>,
      submit: async (reason) => {
        const numericUserId = Number(String(item.userId).replace(/\D/g, ""));
        if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) throw new Error("无效用户编号");
        await ctx.suspendF5UserCommissions(numericUserId, [item.kind], false, reason);
        ctx.toast(`用户 ${item.userId} 的 ${KIND_LABELS[item.kind] ?? "所选奖励"} 恢复已提交，等待审批`);
      },
    });
  };

  const editThreshold = (snapshot?: F5ConfirmationSnapshot, recovery?: F5Recovery) => {
    const sigma = snapshot?.sigma ?? data?.configValues.commissionAnomalySigma ?? "3";
    const ratio = snapshot?.ratio ?? data?.configValues.layerRatioAnomalyPct ?? "20";
    setConfirm({
      recovery, snapshot: snapshot ?? { action: "anomaly", sigma, ratio },
      action: "调整异常预警标准", title: "调整异常标准", briefKind: "config", confirmLabel: "保存",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      completionCopy: "保存后马上生效，不走审批；会记一条处置历史。",
      statedBrief: { impact: "保存后马上按新标准重新挑异常样本，以前的样本也按新标准重算", check: "核对两个数，理由写清为什么调整。" },
      detail: "数字越小，挑出的异常越多。",
      facts: <Facts>
        <Fact k="金额偏离">{sigma} 倍标准差</Fact>
        <Fact k="层比例偏离">{ratio}%</Fact>
        <Fact k="保存后">马上按新标准重新挑异常样本，不改奖励金额和状态</Fact>
      </Facts>,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "sigma", label: "金额偏离（倍标准差 σ）", current: sigma, inputKind: "number", min: 2, max: 5, step: 0.5, required: true, help: "2–5，步长 0.5；越小异常越多" },
          { key: "ratio", label: "L1–L7 比例偏离（%）", current: ratio, inputKind: "number", min: 10, max: 50, step: 1, required: true, help: "这里填 10–50 的整数；越小异常越多" },
        ],
      },
      submit: async (reason, value) => {
        const nextSigma = Number(value?.sigma);
        const nextRatio = Number(value?.ratio);
        await ctx.updateF5AnomalyConfig(nextSigma, nextRatio, reason);
        ctx.toast("异常预警标准已更新");
      },
    });
  };

  const exportAllFiltered = (original = pendingF5Export()) => {
    const filters = original ? original.f5ExportRequest?.filters : f5AppliedQuery;
    if (!filters || !original && exportBlockedReason) return;
    const scope = [
      filters.kind ? kindName(filters.kind) : "",
      filters.currency ?? "",
      filters.userId ? `用户 ${userCode(filters.userId)}` : "",
      filters.cohort ? `${filters.cohort} 注册` : "",
      filters.status ? statusName(filters.status) : "",
    ].filter(Boolean);
    let commandKey = original?.commandKey;
    setConfirm({
      action: "导出当前筛选的全部奖励", title: "导出筛选结果", briefKind: "export", confirmLabel: "导出 CSV", exportFilters: filters, exportKey: () => commandKey,
      reloadExport: () => {
        setKind(filters.kind ?? ""); setCurrency(filters.currency ?? ""); setUserId(filters.userId ?? "");
        setCohort(filters.cohort ?? ""); setStatus(filters.status ?? "");
        load({ ...filters, cursor: undefined, limit: "20" });
      },
      effect: <StatusTag tone="neutral">只生成文件，不改数据</StatusTag>,
      completionCopy: "不改奖励和余额，提交后直接生成文件。",
      statedBrief: { impact: "按已应用且读取成功的筛选条件导出全部匹配的记录，敏感信息已隐藏", check: "核对筛选条件，理由写清导出用途。" },
      detail: "导出符合筛选的全部奖励记录。",
      reasonPlaceholder: "例如：月度对账，工单号",
      facts: <Facts>
        <Fact k="筛选条件">{scope.length ? scope.join("、") : "未应用筛选，导出全部记录"}</Fact>
        <Fact k="导出多少">符合条件的全部记录，不只是这一批 20 笔</Fact>
        <Fact k="上限" tone="warn">5 万行、10 MiB，超了不给文件，请缩小筛选</Fact>
        <Fact k="内容">12 列，用户编号只留后 4 位，单号保留</Fact>
        <Fact k="下载">核对完整后马上下载，不生成下载链接</Fact>
        <Fact k="留痕">每生成一次记一条审计</Fact>
      </Facts>,
      submit: async (reason) => {
        try {
          const receipt = await ctx.exportF5Commissions(filters, reason, commandKey, key => { commandKey = key; });
          ctx.toast(`已下载 ${receipt.filename} · 共 ${receipt.rowCount} 行`);
        } finally { refreshExport(value => value + 1); }
      },
    });
  };

  const openOriginal = (record: F5Recovery) => {
    const saved = record.original.f5Snapshot;
    if (!saved) { void ctx.recoverF5(record, "query").catch(error => ctx.toast(displayAdminError(error))); return; }
    if (["freeze", "unlock", "unfreeze"].includes(saved.action)) dispose(saved.action as "freeze" | "unlock" | "unfreeze", saved.row!, record);
    else if (saved.action === "reverse") reverse(saved.row!, record);
    else if (saved.action === "suspend") suspend(saved.row!, record);
    else if (saved.action === "resume") resume(saved.suspension!, record);
    else if (saved.action === "reissue") reissue(saved.rows!, saved.coolingPolicy, record);
    else editThreshold(saved, record);
  };
  const recoveryRows: F5RecoveryRow[] = [
    ...ctx.f5Proposals.map(original => ({ kind: "proposal" as const, original })),
    ...ctx.f5AnomalyWrites.map(original => ({ kind: "anomaly" as const, original })),
  ].map(record => {
    const original = record.original;
    const ticket = record.kind === "proposal" ? record.original.ticket : undefined;
    const retryable = record.kind === "proposal" ? canRetryF5Proposal(record.original) : canRetryF5Anomaly(record.original);
    const spec = record.kind === "proposal" ? record.original.spec : undefined;
    const request = record.kind === "anomaly" ? record.original.f5Request : undefined;
    const saved = original.f5Snapshot;
    const nextStatus = saved?.action === "freeze" ? "frozen" : saved?.action === "unlock" ? "unlocked" : saved?.action === "unfreeze" ? "cooling" : "reversed";
    const change = saved?.row && ["freeze", "unlock", "unfreeze", "reverse"].includes(saved.action) ? `${statusName(saved.row.status)} → ${statusName(nextStatus)}`
      : saved?.action === "reissue" ? "每笔生成一条新记录，原记录保持已冲正"
        : saved?.action === "suspend" || saved?.action === "resume" ? `${((spec?.command.params.kinds ?? []) as string[]).map(kindName).join("、")} → ${saved.action === "suspend" ? "暂停中" : "恢复"}`
          : request ? `金额偏离 ${saved?.sigma ?? "—"} → ${request.commissionAnomalySigma}；层比例 ${saved?.ratio ?? "—"}% → ${request.layerRatioAnomalyPct}%` : "原请求不完整，只能查询原结果。";
    return { key: original.commandKey,
      name: saved?.name ?? spec?.action ?? (record.kind === "anomaly" ? "调整异常预警标准" : "奖励处置"),
      change: `${change}${!ticket && record.kind === "proposal" && record.original.received ? " · 原申请建过单，批没批准还没查到" : ""}`,
      submittedAt: original.createdAt,
      state: ticket?.status === "pending" ? "pending" : isRetryExpired(original) ? "expired" : "unknown",
      direct: record.kind === "anomaly",
      actions: <>
        <Button size="sm" onClick={() => { if (saved && !ticket) openOriginal(record); else void ctx.recoverF5(record, "query").catch(error => ctx.toast(displayAdminError(error))); }}>查询原结果</Button>
        {retryable && <Button size="sm" onClick={() => openOriginal(record)}>按原请求重试</Button>}
        {original.replayRejection
          && <FReleaseButton label={saved?.name ?? spec?.action ?? "奖励处置"} toast={ctx.toast} onRelease={() => ctx.recoverF5(record, "release")} />}
      </>,
    };
  });
  if (originalExport) recoveryRows.push({
    key: originalExport.commandKey, name: "导出筛选结果", submittedAt: originalExport.createdAt, exportOperation: true,
    state: isRetryExpired(originalExport) ? "expired" : "unknown",
    change: originalExport.f5ExportRequest ? "原筛选条件和理由已保留。" : "原请求不完整，请在操作记录与审批核对。",
    actions: <>
      {originalExport.f5ExportRequest && <Button size="sm" onClick={() => exportAllFiltered(originalExport)}>查看原操作</Button>}
      {originalExport.replayRejection && <FReleaseButton label="导出筛选结果" toast={ctx.toast} onRelease={async () => {
        if (!f5ExportRecovery.releaseRejectedReplay(originalExport)) throw new Error("PENDING_REPLAY_BLOCKED");
        refreshExport(value => value + 1);
      }} />}
    </>,
  });
  const ownTicketIds = new Set(ctx.f5Proposals.flatMap(row => row.ticket ? [row.ticket.id] : row.f5TicketId ? [row.f5TicketId] : []));
  const pendingTickets = ctx.f5ApprovalRows.filter((ticket, index, rows) => ticket.mine && ticket.status === "pending"
    && ["f_commission_status", "f5_commission_reverse", "f5_commission_reissue", "f5_commission_suspension"].includes(ticket.operationCode ?? "")
    && !ownTicketIds.has(ticket.id) && rows.findIndex(other => other.id === ticket.id) === index);
  recoveryRows.push(...pendingTickets.map(ticket => ({ key: ticket.id, name: ticket.action, change: `${ticket.before} → ${ticket.after}`, state: "pending" as const,
    actions: <Button size="sm" onClick={() => { void ctx.refreshF5(applied); }}>查询原结果</Button>,
  })));

  const blockedRecord = (row: F5CommissionEvent) => {
    if (loading) return busyText;
    if (error) return "奖励记录未成功读取，重试后才能处理";
    const pending = [...ctx.f5ApprovalRows, ...ctx.f5Proposals.flatMap(original => original.ticket ? [original.ticket] : [])]
      .some(ticket => ticket.status === "pending" && (ticket.obj === row.auditKey || ticket.obj.split(",").includes(row.id)));
    const retained = ctx.f5Proposals.some(original => original.f5Snapshot?.row?.id === row.id
      || original.f5Snapshot?.rows?.some(item => item.id === row.id));
    return pending ? "这个对象已有待审批的申请，批准、驳回或撤回后再操作。" : retained ? "请先查询保存的原操作。" : undefined;
  };
  const rowActions = (row: F5CommissionEvent): F5RowAction[] => {
    const list: F5RowAction[] = [];
    if (canFreeze && row.status === "cooling") list.push({ key: "freeze", label: "冻结", onSelect: () => dispose("freeze", row) });
    if (canRelease && (row.canUnlock === true || row.status === "cooling" && (!isFriend(row) || row.canUnlock !== undefined))) list.push({ key: "unlock", label: "提前解锁", disabledReason: knownRejection(row, "release", data?.activeSuspensions), onSelect: () => dispose("unlock", row) });
    if (canFreeze && row.status === "frozen") list.push({ key: "unfreeze", label: "解冻", onSelect: () => dispose("unfreeze", row) });
    if (canSuspend && suspendableKinds.includes(row.kind)) list.push({ key: "suspend", label: "暂停此类奖励", onSelect: () => suspend(row) });
    if (canReverse && (row.canReverse === true || !SETTLED.includes(row.status))) list.push({ key: "reverse", label: "冲正", danger: true, disabledReason: knownRejection(row, "reverse"), onSelect: () => reverse(row) });
    return list.map(item => ({ ...item, disabledReason: blockedRecord(row) ?? item.disabledReason }));
  };

  for (const { original } of anomalyDrafts) {
    const snapshot = original.f5Snapshot, request = original.f5Request;
    const sigma = data?.configValues.commissionAnomalySigma, ratio = data?.configValues.layerRatioAnomalyPct;
    const writable = canWrite && !loading && !error && sigma !== undefined && ratio !== undefined
      && snapshot?.sigma !== undefined && snapshot.ratio !== undefined && !!request && !ctx.f5AnomalyWrites.length;
    recoveryRows.push({
      key: original.commandKey, name: "调整异常预警标准", state: "settled", submittedAt: original.createdAt,
      change: request ? `金额偏离 ${request.commissionAnomalySigma}；层比例偏离 ${request.layerRatioAnomalyPct}%` : "请核对现行设置",
      actions: writable ? <Button size="sm" onClick={() => {
        const before = { sigma: snapshot.sigma!, ratio: snapshot.ratio! };
        const wanted = { sigma: String(request.commissionAnomalySigma), ratio: String(request.layerRatioAnomalyPct) };
        const initial = rebaseFValues(before, wanted, { sigma, ratio }, (a, b) => a === b || compareDecimal(a, b) === 0);
        editThreshold();
        setConfirm(current => current && { ...current, draft: original, initial });
      }}>继续修改</Button> : <span>请核对当前设置和操作权限</span>,
    });
  }
  for (const { original } of proposalDrafts) {
    const snapshot = original.f5Snapshot, spec = original.spec;
    const params = original.request?.command.params;
    const writable = snapshot && spec && data && !loading && !error && ctx.can(f5ProposalAuthority(spec));
    const continueDraft = () => {
      if (!snapshot || !data || !spec) return;
      const { action } = snapshot;
      if (action === "resume") {
        const item = data.activeSuspensions.find(row => row.userId === snapshot.suspension?.userId && row.kind === snapshot.suspension.kind);
        if (!item) { ctx.toast("当前暂停记录不在已读名单中，请核对。"); return; }
        resume(item);
      } else {
        const ids = snapshot.rows?.map(row => row.id) ?? (snapshot.row ? [snapshot.row.id] : []);
        const rows = ids.flatMap(id => events.find(event => event.id === id) ?? []);
        if (!rows.length || rows.length !== ids.length) { ctx.toast("请先在奖励流水中读取原记录。"); return; }
        if (action === "reissue") {
          if (rows.some(row => blockedRecord(row) || isFriend(row) || row.reversalRecorded || row.status !== "reversed")) {
            ctx.toast("原奖励记录当前不能补发，请核对。"); return;
          }
          reissue(rows, data.coolingPolicy);
        } else {
          const row = rows[0];
          const option = rowActions(row).find(item => item.key === action);
          if (!option || option.disabledReason) { ctx.toast(option?.disabledReason ?? "原奖励记录当前不能执行这项处置，请核对。"); return; }
          option.onSelect();
        }
      }
      const initial: BusinessFormValue | undefined = typeof params?.refundRef === "string" ? { refundRef: params.refundRef }
        : Array.isArray(params?.kinds) && action === "suspend" ? { kinds: params.kinds.filter(kind => suspendableKinds.includes(kind)).join(",") } : undefined;
      setConfirm(current => current && { ...current, draft: original, initial });
    };
    recoveryRows.push({
      key: original.commandKey, name: snapshot?.name ?? spec?.action ?? "奖励处置",
      change: spec ? `${spec.before} → ${spec.after}` : "请核对原奖励记录", state: "settled", submittedAt: original.createdAt,
      actions: writable ? <Button size="sm" onClick={continueDraft}>继续修改</Button>
        : <span>请核对当前奖励记录和操作权限</span>,
    });
  }

  // 同一个结算组的两笔挨着时，用左边的竖线连起来。
  const groupPos = (index: number) => {
    const no = events[index]?.settlementNo;
    if (!no) return undefined;
    const prev = events[index - 1]?.settlementNo === no;
    const next = events[index + 1]?.settlementNo === no;
    return prev && next ? "mid" : prev ? "last" : next ? "first" : "single";
  };
  const columns = 5 + (canReissue ? 1 : 0) + (rowWrite ? 1 : 0);
  const openRow = openId ? events.find((row) => row.id === openId) ?? null : null;

  const statusCounts: Record<string, number> = {};
  data?.statusDistribution.forEach((item) => {
    const key = STATUS_BY_LABEL[item.nm];
    if (key) statusCounts[key] = Number(item.ct);
  });
  const statusFiltered = !!applied.status;
  const pendingCount = data && !statusFiltered ? data.pendingCalculationCount : undefined;

  const appliedChips = [
    applied.kind ? { key: "kind", label: kindName(applied.kind), onRemove: () => { setKind(""); setSelected([]); load({ ...applied, kind: undefined, cursor: undefined }); } } : null,
    applied.status ? { key: "status", label: statusName(applied.status), onRemove: () => { setStatus(""); setSelected([]); load({ ...applied, status: undefined, cursor: undefined }); } } : null,
    applied.currency ? { key: "currency", label: applied.currency, onRemove: () => { setCurrency(""); setSelected([]); load({ ...applied, currency: undefined, cursor: undefined }); } } : null,
    applied.userId ? { key: "user", label: `用户 ${userCode(applied.userId)}`, onRemove: () => { setUserId(""); setSelected([]); load({ ...applied, userId: undefined, cursor: undefined }); } } : null,
    applied.cohort ? { key: "cohort", label: `${applied.cohort} 注册`, onRemove: () => { setCohort(""); setSelected([]); load({ ...applied, cohort: undefined, cursor: undefined }); } } : null,
  ].filter((chip): chip is { key: string; label: string; onRemove: () => void } => chip !== null);

  const conclusion = () => {
    if (!data) {
      if (error) return <Conclusion state="unknown" action={<Button size="sm" onClick={() => void ctx.refreshF5()}>重试</Button>}>奖励记录读不到，现在不知道有没有要处理的</Conclusion>;
      return <Conclusion state="unknown">正在加载奖励记录…</Conclusion>;
    }
    const anomalies = data.anomalies.length;
    const recovery = statusCounts.recovery_pending ?? 0;
    const frozen = data.summary.frozenCount;
    const awaiting = ctx.f5ApprovalRows.filter((ticket, index, rows) => ticket.status === "pending" && F5_DISPOSAL_CODES.includes(ticket.operationCode ?? "")
      && rows.findIndex(other => other.id === ticket.id) === index).length;
    const parts = [
      anomalies ? <><b>{anomalies}</b> 条异常样本</> : null,
      recovery ? <><b>{recovery}</b> 笔待追回</> : null,
      frozen ? <><b>{frozen}</b> 笔已冻结</> : null,
    ].filter(Boolean);
    // USDT 层比例没法比较、或没读到比较结果时，「没有异常样本」不能单独当作正常（UVT 本来就不比，不在首屏提）。
    const layerUnchecked = data.layerRatioComparisons === undefined || data.layerRatioComparisons.some((item) => item.currency === "USDT" && !item.available);
    const hint = [
      pendingCount ? `${pendingCount} 组好友奖励在等价格；价格长期不恢复时请联系值班人员。` : "",
      layerUnchecked && !anomalies ? "层比例这次没比较，不能当作正常，看「异常样本」。" : "",
    ].filter(Boolean).join(" ") || undefined;
    const explain = <>
      <p>异常样本从最近 200 条奖励里挑出来；待追回、已冻结算全部记录，这三项不跟下方筛选变。等价格跟着类型、用户和注册月份筛选变，选了状态时不显示。</p>
      <p>提交的处置要{APPROVER}在「操作记录与审批」批准；这页显示读到的本人待审批申请。</p>
    </>;
    const approvals = awaiting && canReadA2 ? <span className="f5-awaiting">{awaiting} 条处置待审批 · <Link className="rd-link" href="/platform/audit?domain=F" prefetch={false}>去操作记录与审批 →</Link></span> : undefined;
    if (!parts.length) return <Conclusion state="ok" hint={hint} explain={explain} action={approvals}>没有异常样本、待追回和冻结中的奖励</Conclusion>;
    return <Conclusion state="warn" hint={hint} explain={explain}
      action={<>{anomalies ? <Button size="sm" onClick={() => setTab("anomalies")}>看异常样本</Button> : null}
        {recovery ? <button type="button" className="rd-link" onClick={showRecovery}>看待追回 →</button> : null}{approvals}</>}>
      要核对：{parts.map((part, index) => <span key={index}>{index ? "、" : ""}{part}</span>)}
    </Conclusion>;
  };

  const kindOptions = [{ value: "", label: "全部类型" }, ...(data?.commissionKinds ?? []).map((item) => ({ value: item.key, label: KIND_LABELS[item.key] ?? item.lbl }))];
  const statusOptions = [{ value: "", label: "全部状态" }, ...STATUS_ORDER.map((item) => ({ value: item, label: STATUS_META[item].name }))];
  const currencyOptions = [{ value: "", label: "全部币种" }, { value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }];
  const moreCount = Number(!!applied.currency) + Number(!!applied.cohort);
  const recordCounts = loading && data ? "正在更新，暂不能查询或处理"
    : data ? data.total === events.length ? `共 ${data.total.toLocaleString("en-US")} 笔 · 时间为${zoneNote()}` : `共 ${data.total.toLocaleString("en-US")} 笔符合条件 · 这一批 ${events.length} 笔 · 时间为${zoneNote()}` : undefined;

  const recordsPanel = (
    <div className="f5-records" id="f5-records">
      <FilterBar onSubmit={submitFilters} querying={loading} onClear={clearFilters} canClear={hasDraft || appliedChips.length > 0}
        result={draftChanged ? "条件未应用" : undefined}
        applied={appliedChips.length ? appliedChips : undefined}
        notice={userQueryError ? "查询条件有误：请填用户编码或正整数系统编号。这次没有查询。" : undefined}
        more={<>
          <FilterField label="币种"><Select aria-label="全部币种" value={currency} onChange={setCurrency} options={currencyOptions} /></FilterField>
          <FilterField label="注册月份"><Input aria-label="用户群" type="month" title="按收款用户的注册月份筛选" value={cohort} onChange={(event) => setCohort(event.target.value)} /></FilterField>
        </>}
        moreCount={moreCount}>
        <FilterField><Select aria-label="奖励类型" value={kind} onChange={setKind} options={kindOptions} /></FilterField>
        <FilterField><Select aria-label="奖励状态" value={status} onChange={setStatus} options={statusOptions} /></FilterField>
        <FilterField grow><Input aria-label="用户编码或系统编号" placeholder="用户编码或系统编号" value={userId} onChange={(event) => { setUserId(event.target.value); setUserQueryError(false); }} /></FilterField>
      </FilterBar>
      <Panel flush icon={ListChecks} tone="role-1" title="奖励流水" className="f5-records-panel"
        sub={[recordCounts, canExport ? exportBlockedReason : undefined].filter(Boolean).join(" · ") || undefined}
        explain={<>
          <p>按上面的筛选查，一批 20 笔，新的在前；「共 N 笔」是符合筛选的总数。点一行看这一笔是怎么来的、现在到哪一步。</p>
          <p>同一个结算组的 USDT 和 UVT 两笔，左边用竖线连在一起。结算时间是这笔最后一次变动的时间，不一定是发奖的时刻。</p>
          <p>导出使用已应用且读取成功的筛选条件，包含全部匹配记录。</p>
          {canReissue && <p>行首勾选已冲正的记录，可以一起补发；好友奖励、来源已经退款的不能勾。</p>}
        </>}
        actions={canExport ? <Button size="sm" icon={<Download size={14} aria-hidden />} disabled={!!exportBlockedReason || !!originalExport} onClick={() => exportAllFiltered()}>导出筛选结果</Button> : undefined}>
        {reissueAvailable && selectedRows.length > 0 && (
          <BatchBar summary={`已勾选 ${selectedRows.length} 笔已冲正的记录`} hint="只能勾选这一批里已冲正、不是好友奖励、来源没有退款的记录；改筛选会清掉勾选。">
            <Button size="sm" onClick={() => setSelected([])}>取消勾选</Button>
            <Button size="sm" variant="primary" disabledReason={selectedRows.map(blockedRecord).find(Boolean)} onClick={() => reissue()}>批量补发</Button>
          </BatchBar>
        )}
          <Table label="奖励流水" className="f5-table f5-record-table" aria-busy={loading} data-select={canReissue ? "" : undefined} data-actions={rowWrite ? "" : undefined}>
            <thead><tr>
              {canReissue && <Th control className="f5-col-pick"><span className="rd-sr-only">勾选补发</span></Th>}
              <Th className="f5-col-id">奖励</Th>
              <Th className="f5-col-user">用户 / 来源</Th>
              <Th align="right" className="f5-col-amt">金额</Th>
              <Th className="f5-col-time">结算时间</Th>
              <Th className="f5-col-state">状态</Th>
              {rowWrite && <Th sticky="end" className="f5-col-act">处置</Th>}
            </tr></thead>
            <tbody>
              {!data && loading ? <TableLoading columns={columns} rows={8} />
                : !data && error ? <TableMessage columns={columns} role="alert">奖励记录读取失败：{error.replace(/[。.\s]+$/, "")}。数据不完整，批量补发已暂停。 <Button size="sm" onClick={() => void ctx.refreshF5()}>重试</Button></TableMessage>
                  : events.length === 0 ? <TableMessage columns={columns} role="status">
                    {appliedChips.length ? <>没有符合条件的奖励记录 <Button size="sm" onClick={clearFilters}>清除筛选</Button></> : "还没有奖励记录"}
                  </TableMessage>
                    : events.map((row, index) => {
                      const selectable = !blockedRecord(row) && canReissue && row.status === "reversed" && !isFriend(row) && !row.reversalRecorded;
                      const blockedPick = blockedRecord(row) ?? (row.status === "reversed" && !selectable ? isFriend(row) ? "好友奖励不能补发" : row.reversalRecorded ? "已退款的记录不能补发" : undefined : undefined);
                      // 等级月薪写「月份 · 等级」；设备收益写和受益人的关系；购买奖励（好友购买、团队购买）写「来自 U… · 第 N 层」。
                      const salary = row.kind === "vrank_salary" ? row : null;
                      const lateClaim = salary?.salaryMonth && salary.claimedAt && isPreviousMonthSalaryClaim(ctx.teamBusinessCalendar, salary.salaryMonth, salary.claimedAt);
                      const source = salary ? [salary.salaryMonth, salary.salaryRank, lateClaim ? "1 号领上月" : null].filter(Boolean).join(" · ") || "—"
                        : row.kind === "direct_device_earning" ? `${deviceEarningSource(row.layer)}${row.sourceUserId ? ` ${userCode(row.sourceUserId)}` : ""}`
                        : [row.sourceUserId ? `来自 ${userCode(row.sourceUserId)}` : "", row.layer ? `第 ${row.layer} 层` : ""].filter(Boolean).join(" · ") || "—";
                      const items = rowActions(row);
                      return (
                        <Tr key={row.id} selected={openRow?.id === row.id} onOpen={() => setOpenId(row.id)} data-group={groupPos(index)}>
                          {canReissue && <Td>{row.status === "reversed" && <Checkbox aria-label={`选择 ${row.id}`} disabled={!selectable} title={blockedPick} checked={selected.includes(row.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id))} />}</Td>}
                          <Td><Cell main={<button type="button" className="rd-cell-link" data-mono="" aria-haspopup="dialog" aria-label={`查看奖励 ${row.id}`} onClick={() => setOpenId(row.id)}>{row.id}</button>}
                            sub={<>{kindName(row.kind)}{row.settlementNo ? <span className="f5-group-tag">{compareDecimal(row.amountUSDT ?? "", "0") === 1 && compareDecimal(row.amountNEX ?? "", "0") === 1 ? "双币组" : "结算组"}</span> : null}{salary?.claimNo ? <span className="f5-sans"> · <span data-mono="" title={`月薪领取的领取号 ${salary.claimNo}`}>{salary.claimNo}</span></span> : null}</>} /></Td>
                          <Td><Cell mono main={row.user} sub={<span className="f5-sans">{source}</span>} /></Td>
                          <Td align="right"><Cell num main={<Money value={row.amt} currency={row.cur} />} /></Td>
                          <Td className="f5-col-time"><Cell num main={timeText(row.settledAt)} /></Td>
                          <Td><Cell main={<StatusBadge status={row.status} />} sub={row.status === "cooling" ? row.coolingDaysLeft > 0 ? `剩 ${row.coolingDaysLeft} 天` : "当天到期或没有到期时间" : row.status === "unlocked" && salary ? "领取即可用" : undefined} /></Td>
                          {rowWrite && <Td sticky="end" data-fit="">{items.length ? <MoreMenu label={`处置 ${row.id}`} items={items.map((item) => ({ key: item.key, label: item.label, danger: item.danger, disabledReason: item.disabledReason, onSelect: item.onSelect }))} /> : <span className="f5-weak">—</span>}</Td>}
                        </Tr>
                      );
                    })}
            </tbody>
          </Table>
        {data && (f5NextQuery || events.length > 20) && (
          <div className="f5-batch-nav">
            <span>{f5AppendError ?? `已加载 ${events.length} 笔，按新到旧`}</span>
            {events.length > 20 && <Button size="sm" disabled={loading} icon={<RotateCcw size={14} aria-hidden />} onClick={() => { setSelected([]); load(applied); }}>回到第一批</Button>}
            {f5NextQuery && <Button size="sm" disabled={loading} onClick={() => void ctx.refreshF5(f5NextQuery)}>{f5AppendError ? "重试" : "加载更多"}</Button>}
          </div>
        )}
      </Panel>
    </div>
  );

  const tabItems = [
    { value: "records" as const, label: "奖励流水" },
    { value: "pending" as const, label: "等价格", count: data ? pendingCount ?? "—" : undefined },
    { value: "anomalies" as const, label: "异常样本", count: data ? data.anomalies.length : undefined },
    { value: "suspensions" as const, label: "暂停名单", count: data ? data.activeSuspensions.length : undefined },
    { value: "history" as const, label: "处置历史" },
  ];

  return (
    <div className="f5-page">
      <PageHeader pageId="F5" title="奖励记录核对" summary={`核对${data ? kindCountLabel(data.commissionKinds.length) : ""}奖励的每一笔，处置有问题的记录。`}
        readOnly={anyWrite ? undefined : "你只能查看；处置奖励需要对应的处置权限"} />
      {conclusion()}
      <F5RecoveryNotice rows={recoveryRows} />
      {/* 审批进度没读全：和 F2 的审批读取警示一个样子，一行，不挡下面的业务概览。 */}
      {ctx.f5ApprovalReadError && <Notice tone="warn" title="审批进度没读到"
        action={<Button size="sm" disabled={loading} onClick={() => void ctx.refreshF5(applied)}>重试</Button>}>
        {ctx.f5ApprovalReadError}读到之前，页面可能没标出已有待审批申请的记录。
      </Notice>}
      <fieldset className="f5-fieldset" aria-busy={loading}>
        <div className="f5-stack">
        {data && <>
          <F5StatusFlow data={data} statusFilter={applied.status ?? ""} onStatus={applyStatusFilter} pendingCount={pendingCount} onPending={() => setTab("pending")} />
          <F5KindTiles data={data} kindFilter={applied.kind ?? ""} onKind={applyKindFilter} open={kindsOpen} onOpenChange={setKindsOpen} />
        </>}
        <div className="f5-tabs">
          <PageTabs label="奖励记录内容" value={tab} onChange={setTab} ids={tabIds} items={data || tab !== "records" ? tabItems : tabItems.slice(0, 1)} />
          <div {...tabIds.panel(tab)} className="rd-tab-pane">
            {tab === "records" && recordsPanel}
            {tab === "pending" && data && <F5PendingList rows={data.pendingCalculations} count={data.pendingCalculationCount} statusFiltered={statusFiltered} />}
            {tab === "anomalies" && data && <F5AnomalyList rows={data.anomalies} comparisons={data.layerRatioComparisons} sigma={data.configValues.commissionAnomalySigma} ratio={data.configValues.layerRatioAnomalyPct} canWrite={canWrite && !loading} onAdjust={() => editThreshold()} />}
            {tab === "suspensions" && data && <F5SuspensionList rows={data.activeSuspensions} canSuspend={canSuspend && !loading} onResume={item => resume(item)} />}
            {tab === "history" && data && <F5HistoryList rows={data.operationHistory} />}
          </div>
        </div>
        <nav className="rd-links f5-links" aria-label="相关页面">
          <span>相关页面</span>
          {canReadD4 ? <Link className="rd-link" href="/finance/ledger" prefetch={false}>账本与账单核对</Link> : <span className="f5-weak" title="你没有查看资金账本的权限">账本与账单核对 无权限</span>}
          {canReadB1 ? <Link className="rd-link" href="/overview/dual-ledger" prefetch={false}>资金与应付款总览</Link> : <span className="f5-weak" title="你没有查看资金与应付款总览的权限">资金与应付款总览 无权限</span>}
          {canReadL4 ? <Link className="rd-link" href="/analytics/operations" prefetch={false}>设备、任务与团队报表</Link> : <span className="f5-weak" title="你没有查看设备、任务与团队报表的权限">设备、任务与团队报表 无权限</span>}
          {canReadA2 ? <Link className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link> : <span className="f5-weak" title="你没有查看操作记录与审批的权限">操作记录与审批 无权限</span>}
          {canReadA4 ? <Link className="rd-link" href="/platform/events" prefetch={false}>用户行为事件</Link> : <span className="f5-weak" title="你没有查看用户行为事件的权限">用户行为事件 无权限</span>}
        </nav>
        </div>
      </fieldset>
      <F5Drawer row={openRow} rows={events} history={data?.operationHistory ?? []} ledgerAllowed={canReadD4} coverageAllowed={canReadB1} l4Allowed={canReadL4} a2Allowed={canReadA2}
        actions={rowActions} readOnly={!rowWrite} busyReason={loading ? busyText : undefined} onOpen={(row) => setOpenId(row.id)} onClose={() => setOpenId(null)} />
      {confirm && <F5ConfirmHost key={confirm.draft?.commandKey ?? confirm.recovery?.original.commandKey ?? "fresh"} confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}
    </div>
  );
}
