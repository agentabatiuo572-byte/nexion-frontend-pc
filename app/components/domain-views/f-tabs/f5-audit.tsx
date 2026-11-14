"use client";

/**
 * F5 奖励记录核对（改版）。首屏：一句结论 → 奖励走到哪一步（七个状态一条路）→ 八类奖励；下面五个页签：
 * 奖励流水（筛选、勾选补发、点行看详情）、等价格、异常样本、暂停名单、处置历史。
 * 读取、筛选、翻批、导出和七个处置都调用 F 域外壳原有的函数，请求和改版前一样；这里只管排版和文字。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, ListChecks, RotateCcw } from "lucide-react";
import {
  BatchBar, Button, Cell, Change, Checkbox, Conclusion, Explain, Fact, Facts, FilterBar, FilterField, Input, IrreversibleTag, MoreMenu,
  PageHeader, PageTabs, Panel, Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { F5CommissionEvent, F5CommissionQuery } from "@/lib/admin/f1-client";
import { F5_KINDS as KINDS } from "@/lib/admin/f-overview-contract";
import type { F5Recovery, FViewCtx } from "./types";
import { canRetryF5Proposal, type F5ConfirmationSnapshot } from "@/lib/admin/f5-approval";
import { canRetryF5Anomaly } from "@/lib/admin/f5-anomaly-write";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import {
  APPROVER, KIND_LABELS, STATUS_BY_LABEL, STATUS_META, StatusBadge, amountText, approvalTag, approverText, isFriend, isGrouped, knownRejection,
  statusName, timeText, userCode, zoneNote, F5ConfirmHost, Money, F5RecoveryNotice, type F5Confirm, type F5RecoveryRow,
} from "./f5-shared";
import { F5KindTiles, F5StatusFlow } from "./f5-overview";
import { F5Drawer, type F5RowAction } from "./f5-drawer";
import { F5AnomalyList, F5HistoryList, F5PendingList, F5SuspensionList } from "./f5-lists";

type Tab = "records" | "pending" | "anomalies" | "suspensions" | "history";
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
  const [kind, setKind] = useState("");
  const [currency, setCurrency] = useState("");
  const [userId, setUserId] = useState("");
  const [cohort, setCohort] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // 列表现在用的是哪组条件（只给页面显示用：已生效的筛选、等价格是否返回）。外壳首次读取不带条件。
  const [applied, setApplied] = useState<F5CommissionQuery>({});
  const [tab, setTab] = useState<Tab>("records");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<F5Confirm | null>(null);
  const tabIds = useTabIds();
  const { f5Overview: data, f5NextQuery, f5Loading: loading, f5Error: error } = ctx;
  const reissueAvailable = canReissue && !error && !!data;
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
      const saved = current.snapshot ? ctx.getF5Operation(current.snapshot) : undefined;
      if (saved) return current.recovery ? current : { ...current, recovery: saved };
      return current.recovery || loading ? null : current;
    });
  }, [ctx.f5ReadEpoch, loading, ctx.f5Proposals, ctx.f5AnomalyWrites]);

  const query = (): F5CommissionQuery => ({
    kind: kind || undefined,
    currency: currency || undefined,
    userId: userId.trim() || undefined,
    cohort: cohort.trim() || undefined,
    status: status || undefined,
    limit: "20",
  });
  const load = (next: F5CommissionQuery) => {
    setApplied(next);
    void ctx.refreshF5(next);
  };

  const applyKindFilter = (selectedKind: string) => {
    const nextKind = applied.kind === selectedKind ? "" : selectedKind;
    setKind(nextKind);
    setCurrency(""); setUserId(""); setCohort(""); setStatus("");
    setSelected([]);
    setTab("records");
    load({ kind: nextKind || undefined, limit: "20" });
  };

  const applyStatusFilter = (selectedStatus: string) => {
    const nextStatus = applied.status === selectedStatus ? "" : selectedStatus;
    setStatus(nextStatus);
    setKind(""); setCurrency(""); setUserId(""); setCohort("");
    setSelected([]);
    setTab("records");
    load({ status: nextStatus || undefined, limit: "20" });
  };

  const submitFilters = () => { setSelected([]); load(query()); };
  const clearFilters = () => {
    setKind(""); setCurrency(""); setUserId(""); setCohort(""); setStatus(""); setSelected([]);
    load({ kind: undefined, currency: undefined, userId: undefined, cohort: undefined, status: undefined, limit: "20" });
  };
  const hasDraft = !!(kind || currency || userId.trim() || cohort.trim() || status);

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
    ? <Fact k="处置范围" tone="warn">好友奖励整组两笔一起{verb}：{groupMoney(row)}</Fact>
    : isGrouped(row) ? <Fact k="处置范围">只{verb}这一笔，同组另一种币不动</Fact>
      : <Fact k="处置范围">只{verb}这一笔</Fact>;

  // 单笔冻结 / 提前解锁 / 解冻：可逆的「先按住观察」，和不可逆的冲正分开。提交走外壳原有的 updateF5Config（f_commission_status 审批单）。
  const dispose = (action: "freeze" | "unlock" | "unfreeze", row: F5CommissionEvent, recovery?: F5Recovery) => {
    const friend = isFriend(row);
    const grouped = isGrouped(row);
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
        coverageLead: "提前解锁会让这笔钱提前流出",
        coverageCheck: "提交前按页面读到的兑付覆盖率检查一次；批准执行时后端不再检查。",
        blockedReason: knownRejection(row, "release"),
        statedBrief: grouped
          ? { impact: "批准时后端核对结算组的冷却是否真正到期，没到期会拒绝", check: "核对剩余冷却天数，理由写清为什么要提前。" }
          : { impact: "批准后这笔改为已解锁，释放到用户钱包", check: "核对兑付覆盖率和这笔奖励，理由写清为什么要提前。" },
        detail: grouped
          ? `提前解锁 ${row.id}：这笔属于结算组，批准时后端会核对冷却是否真正到期，没到期就拒绝，不会提前放钱。`
          : `提前解锁 ${row.id}：批准后从冷却中改为已解锁，释放到用户钱包；不改冷却设置。`,
        facts: <Facts>
          {recordFacts(row)}
          <Fact k="状态"><Change from="冷却中" to="已解锁" /></Fact>
          <Fact k="剩余冷却">{row.coolingDaysLeft > 0 ? `${row.coolingDaysLeft} 天` : "按天数已到期"}</Fact>
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
        statedBrief: { impact: "批准后这笔回到冷却中，到期后自动解锁；用户余额不变", check: "核对冻结的原因是否已经解除，理由写清依据。" },
        detail: `解冻 ${row.id}：批准后从已冻结回到冷却中，不是直接解锁。`,
        facts: <Facts>
          {recordFacts(row)}
          <Fact k="状态"><Change from="已冻结" to="冷却中" /></Fact>
          {scopeFact(row, "解冻")}
          {friend
            ? <Fact k="到期时间" tone="warn">沿用原来的，不重新计算；用户还有其他冻结条件（暂停、风险）时批准会被拒</Fact>
            : grouped ? <Fact k="到期时间">沿用原来的，不重新计算</Fact>
              : <Fact k="到期时间" tone="warn">沿用原来的<Explain label="暂停时冻结的旧记录" content="没有结算组的旧记录，如果是暂停用户奖励时被冻结的，到期时间已被清空，解冻后不会自动到期，要再提前解锁。已提后端修复（F5-BE-05）。" /></Fact>}
          <Fact k="用户余额">不变：到期解锁后才进可用余额</Fact>
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
    const grouped = isGrouped(row);
    setConfirm({
      recovery, snapshot: recovery?.original.f5Snapshot ?? { action: "reverse", row },
      action: `冲正奖励 ${row.id}`, title: "冲正奖励", briefKind: "funds", confirmTone: "danger", completionCopy: completion,
      effect: <>{approvalTag()}<IrreversibleTag /></>,
      blockedReason: knownRejection(row, "reverse"),
      reasonPlaceholder: "例如：订单已退款，工单号",
      statedBrief: { impact: grouped ? "批准后收回这笔奖励，余额不够的部分记为待追回" : "批准后收回这笔奖励，余额不够时整次失败", check: "核对凭证单号和这笔奖励有关，理由写清收回的原因。" },
      detail: `冲正 ${row.id}：批准后把这笔奖励收回，状态改为已冲正，收不回来。`,
      facts: <Facts>
        {recordFacts(row)}
        <Fact k="状态"><Change from={statusName(row.status)} to="已冲正" /></Fact>
        {scopeFact(row, "收回")}
        {grouped
          ? <Fact k="用户余额" tone="warn">已入账的部分按现在的余额扣回，扣不够的记为待追回，不会扣成负数</Fact>
          : <Fact k="用户余额" tone="warn">已转进钱包的才扣回；余额不够时这次冲正整个失败，什么都不改<Explain label="没有结算组的旧奖励怎么收回" content="还没转进钱包的，只关掉待发记录，不扣余额。余额不够不会记成待追回，冲正会失败，要等余额够了再提交。" /></Fact>}
        <Fact k="之后">{friend ? "好友奖励冲正后不能补发" : "可以勾选这笔补发一笔新的"}</Fact>
        <Fact k="谁来批准">{approverText("冲正权限")}</Fact>
      </Facts>,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "refundRef", label: "凭证单号", inputKind: "text", required: true, wide: true, placeholder: "退款单号、订单号、发放单号或客服工单号",
            explain: "后端核对这个编号存在：这笔奖励的订单号、等级奖励的发放单号，或任意一张没删除的客服工单号。不核对工单是不是这位用户的，请自己确认和这笔奖励有关。" },
        ],
      },
      submit: async (reason, value) => {
        const refundRef = value?.refundRef?.trim();
        if (!refundRef) throw new Error("请填写有效的单号");
        await ctx.reverseF5Commission(row.id, refundRef, reason);
        ctx.toast(`${row.id} 冲正已提交，等待审批`);
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
    const coolingDays = (kindKey: string) => policy?.find((item) => item.kind === kindKey)?.days;
    const after = (row: F5CommissionEvent) => {
      if (row.kind === "network" || row.kind === "binary") {
        const days = coolingDays(row.kind);
        return days === undefined ? "重新冷却" : days > 0 ? `冷却 ${days} 天后解锁` : "冷却期为 0，马上解锁";
      }
      return "批准后马上解锁";
    };
    setConfirm({
      recovery, snapshot: recovery?.original.f5Snapshot ?? { action: "reissue", rows, coolingPolicy: policy, coverage: data?.coverage },
      action: `批量补发 ${rows.length} 笔奖励`, title: "批量补发奖励", briefKind: "funds", amplify: true, completionCopy: `${APPROVER}在「操作记录与审批」批准后才执行；批准前不生成新记录。`,
      effect: approvalTag("批准前不生成新记录。"),
      coverageLead: "补发会让平台再付一次这些钱",
      coverageCheck: "提交前按页面读到的兑付覆盖率检查一次；批准执行时后端再查，低于红线整批不补发。",
      statedBrief: { impact: "批准后每笔生成一条新记录，原记录保持已冲正", check: "核对每一笔为什么能补发，理由写清依据。" },
      detail: `补发已冲正的记录：${rows.map((row) => row.id).join("、")}。每笔生成一条新记录，原记录不变。`,
      facts: <Facts>
        <Fact k="补发" lead unit="笔">{String(rows.length)}</Fact>
        <Fact k="补发后">每笔生成一条新记录，原记录保持已冲正</Fact>
        <Fact k="整批" tone="warn">有一笔不合格，整批都不补，不会只补一部分</Fact>
        <Fact k="用户余额">团队购买、团队平衡两类重新冷却；其余四类批准后马上解锁</Fact>
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
      statedBrief: { impact: "批准后这位用户所选类型里还没结束的奖励都改为已冻结", check: "核对用户和要暂停的类型，理由写清依据。" },
      detail: "暂停这位用户所选类型的奖励：批准后，还没结束的记录改为已冻结；好友两类以后新产生的也先冻结。",
      facts: <Facts>
        <Fact k="用户">{row.user}</Fact>
        <Fact k="从哪一笔打开"><span data-mono>{row.id}</span> · {kindName(row.kind)}</Fact>
        <Fact k="批准后">所选类型里还没结束的记录都改为已冻结<Explain label="哪些记录会被冻结" content="好友两类：冷却中和已冻结的整组按住。其他类型：等发放、冷却中、已解锁的都改为已冻结，并清掉到期时间。已提现、已冲正这些结束的记录不动。" /></Fact>
        <Fact k="以后" tone="warn">好友两类新产生的先冻结；其他类型以后会不会继续产生，后端还没统一，不是全部停发</Fact>
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
            options: KINDS,
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
        ? "需要审批。批准后这类奖励以后照常产生；没有其他冻结条件的好友奖励会回到冷却期，仍有其他冻结条件的继续冻结。"
        : "需要审批。批准后解除暂停，已冻结的不会自动解冻。",
      facts: <Facts>
        <Fact k="用户">{userCode(item.userId)}</Fact>
        <Fact k="奖励类型">{kindName(item.kind)}</Fact>
        <Fact k="状态"><Change from="暂停中" to="恢复" /></Fact>
        {friend
          ? <Fact k="批准后">没有其他冻结条件的好友奖励回到冷却中，到期时间不重新计算；还有其他冻结条件的继续冻结</Fact>
          : <Fact k="批准后" tone="warn">只解除暂停；之前冻结的这类记录不会自动解冻，要在「奖励流水」逐笔解冻<Explain label="解冻后会不会自动到期" content="暂停时被冻结的旧记录，到期时间已被清空，逐笔解冻后也不会自动到期，要再提前解锁。已提后端修复（F5-BE-05）。" /></Fact>}
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
      detail: "金额偏离可设 2–5 倍标准差（σ），每次加减 0.5；L1–L7 比例偏离可设 10%–50%。数字越小，挑出的异常越多。保存后马上生效。",
      facts: <Facts>
        <Fact k="金额偏离">{sigma} 倍标准差</Fact>
        <Fact k="层比例偏离">{ratio}%</Fact>
        <Fact k="保存后">马上按新标准重新挑异常样本，不改奖励金额和状态</Fact>
      </Facts>,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "sigma", label: "金额偏离（倍标准差 σ）", current: sigma, inputKind: "number", min: 2, max: 5, step: 0.5, required: true, help: "2–5，步长 0.5；越小异常越多" },
          { key: "ratio", label: "L1–L7 比例偏离（%）", current: ratio, inputKind: "number", min: 10, max: 50, step: 1, required: true, help: "10–50 的整数；越小异常越多" },
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

  const exportAllFiltered = () => {
    const filters = query();
    const scope = [
      filters.kind ? kindName(filters.kind) : "",
      filters.currency ?? "",
      filters.userId ? `用户 ${userCode(filters.userId)}` : "",
      filters.cohort ? `${filters.cohort} 注册` : "",
      filters.status ? statusName(filters.status) : "",
    ].filter(Boolean);
    setConfirm({
      action: "导出当前筛选的全部奖励", title: "导出筛选结果", briefKind: "export", confirmLabel: "导出 CSV",
      effect: <StatusTag tone="neutral">只生成文件，不改数据</StatusTag>,
      completionCopy: "不改奖励和余额，提交后直接生成文件。",
      statedBrief: { impact: "按筛选栏里现在填的条件导出全部记录，敏感信息已隐藏", check: "核对筛选条件，理由写清导出用途。" },
      detail: "按当前筛选条件导出全部记录，不只是这一页。敏感信息已隐藏。",
      reasonPlaceholder: "例如：月度对账，工单号",
      facts: <Facts>
        <Fact k="筛选条件">{scope.length ? scope.join("、") : "没有填，导出全部记录"}</Fact>
        <Fact k="导出多少">符合条件的全部记录，不只是这一批 20 笔</Fact>
        <Fact k="上限" tone="warn">5 万行、10 MB，超了不给文件，请缩小筛选</Fact>
        <Fact k="内容">12 列，用户编号只留后 4 位，单号保留</Fact>
        <Fact k="下载">核对完整后马上下载，不生成下载链接</Fact>
        <Fact k="留痕">每生成一次记一条审计</Fact>
      </Facts>,
      submit: async (reason) => {
        const receipt = await ctx.exportF5Commissions(filters, reason);
        ctx.toast(`已下载 ${receipt.filename} · 共 ${receipt.rowCount} 行`);
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
      actions: <>
        <Button size="sm" onClick={() => { void ctx.recoverF5(record, "query").catch(error => ctx.toast(displayAdminError(error))); }}>查询原结果</Button>
        {retryable && <Button size="sm" onClick={() => openOriginal(record)}>按原请求重试</Button>}
      </>,
    };
  });
  const ownTicketIds = new Set(ctx.f5Proposals.flatMap(row => row.ticket ? [row.ticket.id] : row.f5TicketId ? [row.f5TicketId] : []));
  const pendingTickets = ctx.f5ApprovalRows.filter((ticket, index, rows) => ticket.mine && ticket.status === "pending"
    && ["f_commission_status", "f5_commission_reverse", "f5_commission_reissue", "f5_commission_suspension"].includes(ticket.operationCode ?? "")
    && !ownTicketIds.has(ticket.id) && rows.findIndex(other => other.id === ticket.id) === index);
  recoveryRows.push(...pendingTickets.map(ticket => ({ key: ticket.id, name: ticket.action, change: `${ticket.before} → ${ticket.after}`, state: "pending" as const,
    actions: <Button size="sm" onClick={() => { void ctx.refreshF5(applied); }}>查询原结果</Button>,
  })));

  const blockedRecord = (row: F5CommissionEvent) => {
    const pending = [...ctx.f5ApprovalRows, ...ctx.f5Proposals.flatMap(original => original.ticket ? [original.ticket] : [])]
      .some(ticket => ticket.status === "pending" && (ticket.obj === row.auditKey || ticket.obj.split(",").includes(row.id)));
    const retained = ctx.f5Proposals.some(original => original.f5Snapshot?.row?.id === row.id
      || original.f5Snapshot?.rows?.some(item => item.id === row.id));
    return pending ? "这个对象已有待批单，等批准、驳回或撤回后再操作。" : retained ? "请先查询保存的原操作。" : undefined;
  };
  const rowActions = (row: F5CommissionEvent): F5RowAction[] => {
    const list: F5RowAction[] = [];
    if (canFreeze && row.status === "cooling") list.push({ key: "freeze", label: "冻结", onSelect: () => dispose("freeze", row) });
    if (canRelease && row.status === "cooling" && !isFriend(row)) list.push({ key: "unlock", label: "提前解锁", disabledReason: knownRejection(row, "release"), onSelect: () => dispose("unlock", row) });
    if (canFreeze && row.status === "frozen") list.push({ key: "unfreeze", label: "解冻", onSelect: () => dispose("unfreeze", row) });
    if (canSuspend) list.push({ key: "suspend", label: "暂停此类奖励", onSelect: () => suspend(row) });
    if (canReverse && !SETTLED.includes(row.status)) list.push({ key: "reverse", label: "冲正", danger: true, disabledReason: knownRejection(row, "reverse"), onSelect: () => reverse(row) });
    return list.map(item => ({ ...item, disabledReason: blockedRecord(row) ?? item.disabledReason }));
  };

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
    applied.kind ? { key: "kind", label: kindName(applied.kind), onRemove: () => { setKind(""); setSelected([]); load({ ...query(), kind: undefined, cursor: undefined }); } } : null,
    applied.status ? { key: "status", label: statusName(applied.status), onRemove: () => { setStatus(""); setSelected([]); load({ ...query(), status: undefined, cursor: undefined }); } } : null,
    applied.currency ? { key: "currency", label: applied.currency, onRemove: () => { setCurrency(""); setSelected([]); load({ ...query(), currency: undefined, cursor: undefined }); } } : null,
    applied.userId ? { key: "user", label: `用户 ${userCode(applied.userId)}`, onRemove: () => { setUserId(""); setSelected([]); load({ ...query(), userId: undefined, cursor: undefined }); } } : null,
    applied.cohort ? { key: "cohort", label: `${applied.cohort} 注册`, onRemove: () => { setCohort(""); setSelected([]); load({ ...query(), cohort: undefined, cursor: undefined }); } } : null,
  ].filter((chip): chip is { key: string; label: string; onRemove: () => void } => chip !== null);

  const conclusion = () => {
    if (!data) {
      if (error) return <Conclusion state="unknown" action={<Button size="sm" onClick={() => void ctx.refreshF5(query())}>重试</Button>}>奖励记录读不到，现在不知道有没有要处理的</Conclusion>;
      return <Conclusion state="unknown">正在读取奖励记录…</Conclusion>;
    }
    const anomalies = data.anomalies.length;
    const recovery = statusCounts.recovery_pending ?? 0;
    const frozen = data.summary.frozenCount;
    const parts = [
      anomalies ? <><b>{anomalies}</b> 条异常样本</> : null,
      recovery ? <><b>{recovery}</b> 笔待追回</> : null,
      frozen ? <><b>{frozen}</b> 笔已冻结</> : null,
    ].filter(Boolean);
    const hint = pendingCount ? `${pendingCount} 组好友奖励在等价格，不用处理。` : undefined;
    const explain = <>
      <p>异常样本从最近 200 条奖励里挑出来；待追回、已冻结和等价格算全部记录。都不跟下方筛选变。</p>
      <p>提交的处置要{APPROVER}在「操作记录与审批」批准，这页看不到批准进度。</p>
    </>;
    const approvals = canReadA2 ? <Link className="rd-link" href="/platform/audit?domain=F" prefetch={false}>看待批准的处置</Link> : undefined;
    if (!parts.length) return <Conclusion state="ok" hint={hint} explain={explain} action={approvals}>没有异常样本、待追回和冻结中的奖励</Conclusion>;
    return <Conclusion state="warn" hint={hint} explain={explain}
      action={<>{anomalies ? <Button size="sm" onClick={() => setTab("anomalies")}>看异常样本</Button> : null}{approvals}</>}>
      要核对：{parts.map((part, index) => <span key={index}>{index ? "、" : ""}{part}</span>)}
    </Conclusion>;
  };

  const kindOptions = [{ value: "", label: "全部类型" }, ...KINDS.map((item) => ({ value: item, label: KIND_LABELS[item] }))];
  const statusOptions = [{ value: "", label: "全部状态" }, ...STATUS_ORDER.map((item) => ({ value: item, label: STATUS_META[item].name }))];
  const currencyOptions = [{ value: "", label: "全部币种" }, { value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }];
  const moreCount = (currency ? 1 : 0) + (cohort ? 1 : 0);
  const busyText = "奖励记录正在更新";

  const recordsPanel = (
    <div className="f5-records">
      <FilterBar onSubmit={submitFilters} querying={loading} onClear={clearFilters} canClear={hasDraft || appliedChips.length > 0}
        applied={appliedChips.length ? appliedChips : undefined}
        more={<>
          <FilterField label="币种"><Select aria-label="全部币种" value={currency} onChange={setCurrency} options={currencyOptions} /></FilterField>
          <FilterField label="注册月份"><Input aria-label="用户群" type="month" title="按收款用户的注册月份筛选" value={cohort} onChange={(event) => setCohort(event.target.value)} /></FilterField>
        </>}
        moreCount={moreCount}>
        <FilterField><Select aria-label="奖励类型" value={kind} onChange={setKind} options={kindOptions} /></FilterField>
        <FilterField><Select aria-label="奖励状态" value={status} onChange={setStatus} options={statusOptions} /></FilterField>
        <FilterField grow><Input aria-label="用户编号" placeholder="用户编号，只填数字" inputMode="numeric" value={userId} onChange={(event) => setUserId(event.target.value.replace(/\D/g, ""))} /></FilterField>
      </FilterBar>
      <Panel flush icon={ListChecks} tone="role-1" title="奖励流水" className="f5-records-panel"
        sub={loading && data ? "正在更新，暂不能查询或处理" : data ? `共 ${data.total.toLocaleString("en-US")} 笔符合条件 · 这一批 ${events.length} 笔 · 时间为${zoneNote()}` : undefined}
        explain={<>
          <p>按上面的筛选查，一批 20 笔，新的在前；「共 N 笔」是符合筛选的总数。点一行看这一笔是怎么来的、现在到哪一步。</p>
          <p>同一个结算组的 USDT 和 UVT 两笔，左边用竖线连在一起。结算时间是这笔最后一次变动的时间，不一定是发奖的时刻。</p>
        </>}
        actions={canExport ? <Button size="sm" icon={<Download size={14} aria-hidden />} onClick={exportAllFiltered}>导出筛选结果</Button> : undefined}>
        {reissueAvailable && selectedRows.length > 0 && (
          <BatchBar summary={`已勾选 ${selectedRows.length} 笔已冲正的记录`} hint="只能勾选这一批里已冲正、不是好友奖励、来源没有退款的记录；改筛选会清掉勾选。">
            <Button size="sm" onClick={() => setSelected([])}>取消勾选</Button>
            <Button size="sm" variant="primary" onClick={() => reissue()}>批量补发</Button>
          </BatchBar>
        )}
          <Table label="奖励流水" className="f5-table f5-record-table" aria-busy={loading} data-select={canReissue ? "" : undefined} data-actions={rowWrite ? "" : undefined}>
            <thead><tr>
              {canReissue && <Th control className="f5-col-pick"><Explain label="勾选做什么" content="勾选已冲正的记录，可以一起补发。好友奖励、来源已经退款的不能勾。" /></Th>}
              <Th className="f5-col-id">奖励</Th>
              <Th className="f5-col-user">用户 / 来源</Th>
              <Th align="right" className="f5-col-amt">金额</Th>
              <Th className="f5-col-time">结算时间</Th>
              <Th className="f5-col-state">状态</Th>
              {rowWrite && <Th sticky="end" className="f5-col-act">处置</Th>}
            </tr></thead>
            <tbody>
              {!data && loading ? <TableLoading columns={columns} rows={8} />
                : !data && error ? <TableMessage columns={columns} role="alert">奖励记录读取失败：{error.replace(/[。.\s]+$/, "")}。数据不完整，批量补发已暂停。 <Button size="sm" onClick={() => void ctx.refreshF5(query())}>重试</Button></TableMessage>
                  : events.length === 0 ? <TableMessage columns={columns} role="status">
                    {appliedChips.length ? <>没有符合条件的奖励记录 <Button size="sm" onClick={clearFilters}>清除筛选</Button></> : "还没有奖励记录"}
                  </TableMessage>
                    : events.map((row, index) => {
                      const selectable = !blockedRecord(row) && canReissue && row.status === "reversed" && !isFriend(row) && !row.reversalRecorded;
                      const blockedPick = blockedRecord(row) ?? (row.status === "reversed" && !selectable ? isFriend(row) ? "好友奖励不能补发" : row.reversalRecorded ? "已退款的记录不能补发" : undefined : undefined);
                      const source = isFriend(row) ? `直接邀请的好友${row.sourceUserId ? ` ${userCode(row.sourceUserId)}` : ""}`
                        : [row.sourceUserId ? `来自 ${userCode(row.sourceUserId)}` : "", row.layer ? `第 ${row.layer} 层` : ""].filter(Boolean).join(" · ") || "—";
                      const items = rowActions(row);
                      return (
                        <Tr key={row.id} selected={openRow?.id === row.id} onOpen={() => setOpenId(row.id)} data-group={groupPos(index)}>
                          {canReissue && <Td>{row.status === "reversed" && <Checkbox aria-label={`选择 ${row.id}`} disabled={!selectable} title={blockedPick} checked={selected.includes(row.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id))} />}</Td>}
                          <Td><Cell main={<button type="button" className="rd-cell-link" data-mono="" aria-haspopup="dialog" aria-label={`查看奖励 ${row.id}`} onClick={() => setOpenId(row.id)}>{row.id}</button>}
                            sub={<>{kindName(row.kind)}{row.settlementNo ? <span className="f5-group-tag">双币组</span> : null}</>} /></Td>
                          <Td><Cell mono main={row.user} sub={<span className="f5-sans">{source}</span>} /></Td>
                          <Td align="right"><Cell num main={<Money value={row.amt} currency={row.cur} />} /></Td>
                          <Td className="f5-col-time"><Cell num main={timeText(row.settledAt)} /></Td>
                          <Td><Cell main={<StatusBadge status={row.status} />} sub={row.status === "cooling" ? row.coolingDaysLeft > 0 ? `剩 ${row.coolingDaysLeft} 天` : "按天数已到期" : undefined} /></Td>
                          {rowWrite && <Td sticky="end" data-fit="">{items.length ? <MoreMenu label={`处置 ${row.id}`} items={items.map((item) => ({ key: item.key, label: item.label, danger: item.danger, disabledReason: item.disabledReason, onSelect: item.onSelect }))} /> : <span className="f5-weak">—</span>}</Td>}
                        </Tr>
                      );
                    })}
            </tbody>
          </Table>
        {data && (f5NextQuery || applied.cursor) && (
          <div className="f5-batch-nav">
            <span>这一批 {events.length} 笔，按新到旧</span>
            {applied.cursor && <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => load({ ...applied, cursor: undefined })}>回到第一批</Button>}
            {f5NextQuery && <Button size="sm" onClick={() => load(f5NextQuery)}>下一批</Button>}
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
      <PageHeader pageId="F5" title="奖励记录核对" summary="核对八类团队奖励的每一笔，处置有问题的记录。"
        meta="打开时读取，不自动刷新"
        readOnly={anyWrite ? undefined : "你只能查看；处置奖励需要对应的处置权限"} />
      <F5RecoveryNotice rows={recoveryRows} />
      {conclusion()}
      <fieldset className="f5-fieldset" disabled={loading} aria-busy={loading}>
        <div className="f5-stack">
        {data && <>
          <F5StatusFlow data={data} statusFilter={applied.status ?? ""} onStatus={applyStatusFilter} pendingCount={pendingCount} onPending={() => setTab("pending")} />
          <F5KindTiles data={data} kindFilter={applied.kind ?? ""} onKind={applyKindFilter} />
        </>}
        <div className="f5-tabs">
          <PageTabs label="奖励记录内容" value={tab} onChange={setTab} ids={tabIds} items={data ? tabItems : tabItems.slice(0, 1)} />
          <div {...tabIds.panel(tab)} className="rd-tab-pane">
            {tab === "records" && recordsPanel}
            {tab === "pending" && data && <F5PendingList rows={data.pendingCalculations} count={data.pendingCalculationCount} statusFiltered={statusFiltered} />}
            {tab === "anomalies" && data && <F5AnomalyList rows={data.anomalies} sigma={data.configValues.commissionAnomalySigma} ratio={data.configValues.layerRatioAnomalyPct} canWrite={canWrite} onAdjust={() => editThreshold()} />}
            {tab === "suspensions" && data && <F5SuspensionList rows={data.activeSuspensions} canSuspend={canSuspend} onResume={item => resume(item)} />}
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
      {confirm && <F5ConfirmHost confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}
    </div>
  );
}
