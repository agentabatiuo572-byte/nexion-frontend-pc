"use client";

/**
 * F1 团队等级晋升（改版）。
 * 首屏回答：九级阶梯现在什么样（每级多少人、门槛跳在哪、升上去拿什么），有没有要处理的事，改哪一项会让平台多付钱。
 * 排法：一句结论 → 四个数 → 页签「等级与奖励」「晋升记录」「奖励发放记录」「App 等级说明」。
 * 「等级与奖励」是九级阶梯（选择器，柱高按所选口径）+ 选中一级的详情（五项门槛、奖励模板、只读参数）+ 九级共用的设置。
 * 请求、校验、权限全部沿用旧页面：门槛和奖励走 F1PolicyConfirm（lib/admin/f1-policy-change），其余走 ctx 上现成的提交函数。
 */
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpCircle, CircleHelp, Clock3, Gift, Layers3, Lock, Pencil, Plus, RefreshCw, Settings2, ShieldCheck, ShieldOff, Sparkles, Trash2, TriangleAlert, Users,
} from "lucide-react";
import {
  BlockState, Button, Change, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, Notice, PageHeader, PageTabs, Panel,
  Segments, Stat, StatBand, StatusTag, useTabIds,
} from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { f1ConditionLabels, listF1PolicyOperations, pendingF1Policy, type F1ConditionField, type F1PolicyEditor } from "@/lib/admin/f1-policy-change";
import { fetchUserProfilesPage } from "@/lib/admin/user360-client";
import { isF1BenefitField } from "@/lib/admin/f1-rank-benefit";
import { pendingF1RankHow } from "@/lib/admin/f1-rank-how-save";
import type { F1VRankRow } from "@/lib/admin/f1-client";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { BusinessFormValue } from "../design-kit";
import type { FViewCtx } from "./types";
import { F1PolicyConfirm } from "./f1-policy-confirm";
import { F1RecoveryNotice } from "./f1-recovery";
import { F1VrankBootstrap } from "./f1-vrank-bootstrap";
import { F1PromotionHistory, F1PayoutHistory } from "./f1-history";
import { F1BenefitConfirm, benefitValue } from "./f1-benefit-confirm";
import { F1V8Review } from "./f1-v8-review";
import { F1SalaryClaims } from "./f1-salary";
import { V8_PERKS, V8_TERMS, ratePct, type F1BenefitField, type F1V8Candidate } from "./f1-rank-types";
import { amountDisplay } from "@/lib/format";
import { F1RankHow } from "./f1-rank-how";
import { F1ConfirmHost, REWARD_KIND, SUPER_APPROVER, VRANK_APPROVER, rewardKind, rewardLine, rewardText, type F1Confirm } from "./f1-shared";

type View = "ladder" | "v8" | "promotions" | "payouts" | "salary" | "howto";
type Lens = "pop" | "selfBuy" | "teamGv" | "directRefs" | "l1" | "salary";

/** 四项晋升条件（rank-rules：自购算力点、团队算力点、一二级已购人数、下级领导者）。下级领导者是人数和最低等级两条写入，一行两个按钮。 */
const SINGLE_FIELDS: ("selfBuy" | "teamGv" | "directRefs")[] = ["selfBuy", "teamGv", "directRefs"];
/** 页面上的名字（操作记录里的名字仍用 f1ConditionLabels，请求不变）。 */
const FIELD_NAME: Record<"selfBuy" | "teamGv" | "directRefs", string> = { selfBuy: "自购算力点", teamGv: "团队算力点", directRefs: "一二级已购人数" };
const FIELD_WHAT: Record<"selfBuy" | "teamGv" | "directRefs", string> = {
  selfBuy: "这位用户自己有效订单的算力点合计。",
  teamGv: "团队一到七级成员有效订单的算力点合计，不含本人。",
  directRefs: "一二级好友里买过东西的人数。",
};
const FIELD_UNIT: Record<F1ConditionField, string> = { teamGv: "点", selfBuy: "点", directRefs: "人", legCount: "个", legRank: "" };
const LENSES: { value: Lens; label: string; unit: string }[] = [
  { value: "pop", label: "人数", unit: "人" },
  { value: "selfBuy", label: "自购算力点", unit: "点" },
  { value: "teamGv", label: "团队算力点", unit: "点" },
  { value: "directRefs", label: "一二级已购人数", unit: "人" },
  { value: "l1", label: "好友购买奖励 · 一级", unit: "%" },
  { value: "salary", label: "月薪", unit: "USDT" },
];

const fmt = (value: number) => value.toLocaleString("en-US");
/** 占比一位小数（TX-23），整数不带 .0；有人但不到 0.1% 写「<0.1%」，不写成 0%。 */
const pct = (part: number, whole: number) => whole <= 0 ? "—" : part > 0 && part / whole < 0.0005 ? "<0.1%" : `${Math.round((part / whole) * 1000) / 10}%`;
const fmtText = (value: string) => /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : value;
const levelNo = (code: string) => Number(code.replace(/^V/, ""));

export function F1Vrank({ ctx }: { ctx: FViewCtx }) {
  const rows: F1VRankRow[] = ctx.vrankRows;
  const owner = useAdminAuth((state) => state.session?.adminId);
  const canWrite = ctx.can("network_f1_write");
  const canProtect = ctx.can("network_f1_permanent_protection");
  const canPromote = ctx.can("network_f1_promote_user");
  const canReissue = ctx.can("network_f1_reward_reissue");
  const canReverse = ctx.can("network_f1_reward_reverse");
  const ids = useTabIds();
  const ladderIds = useTabIds();
  const [requestedView, setRequestedView] = useState<View>("ladder");
  const [lens, setLens] = useState<Lens>("pop");
  const [picked, setPicked] = useState<string | null>(null);
  const [policyEditor, setPolicyEditor] = useState<F1PolicyEditor | null>(null);
  const [confirm, setConfirm] = useState<F1Confirm | null>(null);
  const v8Review = ctx.v8Review;
  const canApproveV8 = useAdminAuth(({ session }) => !!session
    && session.authorities.includes("network_f1_promote_user")
    && session.authorities.includes("platform_a2_write"));
  const canWithdrawV8 = useAdminAuth(({ session }) => !!session
    && session.authorities.includes("platform_a2_proposal_create")
    && canAccessResolvedPath(resolveVisibleDomains(session), "/platform/audit"));
  const salaryPresent = ctx.f1SalaryFieldPresent === true;
  const salaryTabAvailable = ctx.f1SalaryFieldPresent !== false;
  const view = requestedView === "v8" && !v8Review || requestedView === "salary" && !salaryTabAvailable ? "ladder" : requestedView;
  useEffect(() => {
    const read = () => {
      const query = new URLSearchParams(window.location.search);
      const next = query.get("tab");
      const rank = query.get("rank");
      setRequestedView(next === "v8" || next === "salary" || next === "promotions" || next === "payouts" || next === "howto" ? next : "ladder");
      setPicked(rank && /^V[0-8]$/.test(rank) ? rank : null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const writeQuery = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
  };
  const setView = (value: View) => { setRequestedView(value); writeQuery("tab", value); };
  const lenses = salaryPresent ? LENSES : LENSES.filter((item) => item.value !== "salary");
  const [howEpoch, setHowEpoch] = useState(0);
  const [, setRecoveryEpoch] = useState(0);

  const overrideRead = useRef(0);
  useEffect(() => { setConfirm(null); setPolicyEditor(null); }, [ctx.f1ReadEpoch]);
  const policyOperations = owner === undefined ? [] : listF1PolicyOperations(owner);
  const pendingApprovalRanks: ReadonlySet<string> = new Set([
    ...ctx.f1ApprovalRanks,
    ...policyOperations.filter(record => record.ticket?.status === "pending").map(record => record.original.values.rank),
  ]);
  const readOnly = !(canWrite || canProtect || canPromote || canReissue || canReverse)
    ? "你只能查看；这个账号没有修改等级、发起审批或处理奖励的权限。" : undefined;
  const header = (
    <PageHeader pageId="F1" title="团队等级晋升"
      summary="管 V0–V8 九级的晋升条件、晋级奖励、等级权益和每级人数。"
      actions={<>
        <Link className="rd-link" href="/network/leadership-pool" prefetch={false}>团队激励池票数权重 →</Link>
        <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={ctx.f1Loading} onClick={() => void ctx.refreshF1()}>刷新</Button>
      </>}
      readOnly={readOnly} />
  );
  const dialogs = <Fragment key="f1-dialogs">
    {policyEditor && (isF1BenefitField(policyEditor.field)
      ? <F1BenefitConfirm key={`${policyEditor.row.v}:${policyEditor.field}:${policyEditor.recoveryCommandKey ?? "edit"}`}
        editor={policyEditor} field={policyEditor.field} ctx={ctx} onClose={() => setPolicyEditor(null)}
        onPendingChange={() => setRecoveryEpoch(value => value + 1)} />
      : <F1PolicyConfirm
        key={`${policyEditor.row.v}:${policyEditor.action}:${policyEditor.field ?? policyEditor.reward?.id ?? "new"}:${policyEditor.recoveryCommandKey ?? "edit"}`}
        editor={policyEditor} ctx={ctx} pendingApproval={pendingApprovalRanks.has(policyEditor.row.v)} onClose={() => setPolicyEditor(null)}
        onPendingChange={() => setRecoveryEpoch(value => value + 1)} />)}
    {confirm && <F1ConfirmHost confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}
  </Fragment>;
  const recovery = <F1RecoveryNotice ctx={ctx} onOpenPolicy={setPolicyEditor} onRankHowChecked={() => setHowEpoch((value) => value + 1)} />;

  const rewardsOf = (v: string): OpsVRankRewardItem[] => ctx.rewards[v] ?? [];
  // V8 审核：审核通过走现有人工改级（A2 审批），用户、目标 V8、方向升级预先填好（画板 B5）。升 V8 不查兑付覆盖率，所以不按放大算、不出覆盖率块。
  const openV8Approve = (candidate: F1V8Candidate, recoverOriginal = false) => {
    if (!recoverOriginal && (ctx.f1Loading || ctx.f1Error)) return;
    const v7 = rows.find((row) => row.v === "V7");
    const v8 = rows.find((row) => row.v === "V8");
    const v8Rewards = rewardsOf("V8");
    const lead = v8Rewards.length === 1 && (v8Rewards[0].type === "usdt" || v8Rewards[0].type === "uvt") ? rewardText(v8Rewards[0], ctx) : undefined;
    const name = candidate.nickname || candidate.userCode;
    const rate = (row: F1VRankRow | undefined, key: "purchaseL1Rate" | "purchaseL2Rate") => row ? ratePct(row[key]) : undefined;
    const l1 = [rate(v7, "purchaseL1Rate"), rate(v8, "purchaseL1Rate")], l2 = [rate(v7, "purchaseL2Rate"), rate(v8, "purchaseL2Rate")];
    const salary = [v7?.monthlySalaryUsdt?.trim(), v8?.monthlySalaryUsdt?.trim()];
    setConfirm({
      proposalSlot: `f-vrank-override:${candidate.userId}`,
      v8Review: true,
      recoverOriginal,
      action: "手动调整会员等级",
      title: `V8 审核通过：${name}`,
      briefKind: "config",
      confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled icon={Clock3} explain={`${VRANK_APPROVER}（还要有审批批准权限）在「操作记录与审批」批准后才执行；批准前这位用户的等级不变。`}>批准后生效</StatusTag>,
      statedBrief: { impact: `${VRANK_APPROVER}批准后，${name}升到 V8；批准前还是 V7，名单里这一行显示待审批。`, check: "核对推荐信和官方审核；理由写推荐信来自哪位 V8、官方审核的依据。" },
      facts: <Facts>
        {lead
          ? <Fact k="V8 晋级奖励 · 发给本人" lead>{lead.main}{lead.unit && <span className="rd-fact-unit">{lead.unit}</span>}<small className="f1-lead-note">以前领过 V8 晋级奖励的不再发</small></Fact>
          : <Fact k="V8 晋级奖励 · 发给本人">{v8Rewards.length ? `${v8Rewards.map((item) => rewardLine(item, ctx)).join("、")}；以前领过的不再发` : "没有晋级奖励"}</Fact>}
        <Fact k="用户">{candidate.nickname || "—"} · <span data-mono="">{candidate.userCode}</span></Fact>
        <Fact k="等级"><Change from="V7" to="V8" /></Fact>
        <Fact k="邀请人">{candidate.inviterCode ? <>{candidate.inviterNickname || "—"} · <span data-mono="">{candidate.inviterCode}</span></> : "—"}</Fact>
        {l1[0] && l1[1] && l2[0] && l2[1] && <Fact k="好友购买奖励">一级 <Change from={`${l1[0]}%`} to={`${l1[1]}%`} /> · 二级 <Change from={`${l2[0]}%`} to={`${l2[1]}%`} /></Fact>}
        {salary[0] && salary[1] && <Fact k="月薪"><Change from={amountDisplay(salary[0])} to={`${amountDisplay(salary[1])} USDT`} />，批准后次日起；本月已领的不补差</Fact>}
        <Fact k="能否收回">{canWithdrawV8 && "批准前可在「操作记录与审批」撤回；"}批准后奖励不收回，之后人工降级也不收回</Fact>
      </Facts>,
      reasonPlaceholder: "写推荐信来自哪位 V8、官方审核的依据",
      dialogClassName: "f1-policy-confirm f1-v8-confirm",
      detail: "人工把这位用户升到 V8，提交后需在「操作记录与审批」批准才执行。",
      submit: async (reason) => {
        try { await ctx.proposeVRankOverride(candidate.userId, "V8", "promote", reason); }
        catch (error) {
          if ((error as { backendMessage?: string }).backendMessage === "OBJECT_ALREADY_PENDING") {
            throw new Error("没有提交：这位用户已有一张改级单在等审批，处理完再提交。");
          }
          throw error;
        }
        await ctx.queryV8Review?.();
      },
      done: "已提交，等待审批后执行",
    });
  };

  const v8Count = v8Review ? v8Review.error ? "—" : v8Review.pendingReviewCount ?? undefined : undefined;
  const tabs = [
    { value: "ladder" as const, label: "等级与奖励" },
    ...(v8Review ? [{ value: "v8" as const, label: "V8 审核", count: v8Count, countTone: "neutral" as const }] : []),
    { value: "promotions" as const, label: "晋升记录" },
    { value: "payouts" as const, label: "奖励发放记录" },
    ...(salaryTabAvailable ? [{ value: "salary" as const, label: "月薪领取" }] : []),
    { value: "howto" as const, label: "App 等级说明" },
  ];
  const v8Ready = typeof v8Count === "number" && v8Count > 0 && view !== "v8";

  const tabBar = <>
    <div className="f1-tabs-row"><PageTabs label="团队等级晋升" value={view} items={tabs} onChange={setView} ids={ids} /></div>
    {v8Ready && <p className="f1-tabs-note">有 V7 已满足 V8 数值条件，等审核 · <button type="button" className="rd-link" onClick={() => setView("v8")}>去 V8 审核 →</button></p>}
  </>;

  if (rows.length === 0) {
    const body = ctx.f1Loading
      ? <><Conclusion state="unknown">正在读取会员等级…</Conclusion>{recovery}<Panel title="九级阶梯"><BlockState state="loading" title="正在读取会员等级" /></Panel></>
      : ctx.f1Error
        ? <><Conclusion state="unknown" hint="点页头「刷新」重试；其他页签照常能看。">会员等级：暂时无法判断</Conclusion>
          {recovery}
          <Panel title="九级阶梯"><BlockState state="error" title="会员等级读取失败" detail={ctx.f1Error} onRetry={() => void ctx.refreshF1Membership()} /></Panel></>
        : canWrite
          ? <>{recovery}<F1VrankBootstrap ctx={ctx} openConfirm={setConfirm} /></>
          : <><Conclusion state="neutral" icon={Layers3}>还没有建立会员等级</Conclusion>
            {recovery}
            <Panel title="九级阶梯"><BlockState state="empty" title="还没有建立会员等级" detail="有修改权限的同事可以发起首次配置，另一位超级管理员批准后这里才会出现九级。" /></Panel></>;
    if (!ctx.f1Error && !ctx.f1Loading) return <div className="f1-page">{header}{body}{dialogs}</div>;
    return <div className="f1-page">{header}
      {view === "v8" || view === "salary" ? recovery : null}
      {tabBar}
      <div {...ids.panel(view)} className="f1-view">
        {view === "v8" && v8Review ? <F1V8Review ctx={ctx} state={v8Review} v8={undefined} canApprove={canApproveV8} onApprove={openV8Approve} />
          : view === "salary" ? <F1SalaryClaims ctx={ctx} rows={rows} />
            : view === "promotions" ? <F1PromotionHistory ctx={ctx} rows={rows} canPromote={false} onOverride={() => {}} />
              : view === "payouts" ? <F1PayoutHistory ctx={ctx} rows={rows} canReissue={false} canReverse={false} openConfirm={setConfirm} />
                : view === "howto" ? <F1RankHow key={howEpoch} ladder={rows} toast={ctx.toast} onPendingChange={() => setRecoveryEpoch(value => value + 1)} /> : body}
      </div>
      {dialogs}
    </div>;
  }

  const selected = rows.find((row) => row.v === picked) ?? rows.find((row) => row.v === "V1") ?? rows[0];
  const total = rows.reduce((sum, row) => sum + row.pop, 0);
  const v0Pop = rows.find((row) => row.v === "V0")?.pop ?? 0;
  const v3plus = rows.filter((row) => levelNo(row.v) >= 3).reduce((sum, row) => sum + row.pop, 0);
  const configured = rows.filter((row) => rewardsOf(row.v).length > 0).length;
  const unconfigured = rows.filter((row) => row.v !== "V0" && rewardsOf(row.v).length === 0).map((row) => row.v);
  const busiest = rows.reduce((top, row) => row.pop > top.pop ? row : top, rows[0]);

  // 不降级保护：后端只认 on / off，缺值按关闭执行（F1-B01），不显示成开启。
  const permanentRaw = (ctx.f1ConfigValues["F.vrank.permanent"] ?? "").trim().toLowerCase();
  const permanent: "on" | "off" | "unset" = permanentRaw === "on" ? "on" : permanentRaw === "off" ? "off" : "unset";
  const prizeName = nexGridBrandText(ctx.f1ConfigValues["F.prize.name"] ?? "");
  const titlesByLevel: Record<string, string> = {};
  const titlesRaw = ctx.f1ConfigValues["F.vrank.titles"] ?? "";
  if (titlesRaw) {
    try {
      const parsed = JSON.parse(titlesRaw);
      for (const row of rows) {
        const title = parsed?.[row.v];
        if (typeof title === "string" && title.trim()) titlesByLevel[row.v] = title.trim();
      }
    } catch { /* 坏 JSON 不覆盖原头衔，提交时后端 validateVrankTitles 把关 */ }
  }

  // 本标签页里还没核对完的门槛、奖励修改（R-F1 原记录）。只读本机存储，不发请求。
  const pendingOf = (editor: Omit<F1PolicyEditor, "valuation">) => {
    if (owner === undefined) return undefined;
    try { return pendingF1Policy(owner, { ...editor, valuation: ctx.f1RewardValuation }) ?? undefined; }
    catch { return undefined; }
  };
  const rowPending = (row: F1VRankRow) => policyOperations.filter(item => !item.ticket && item.original.values.rank === row.v).length;
  const pendingByRow = Object.fromEntries(rows.map((row) => [row.v, rowPending(row)]));
  const pendingTotal = Object.values(pendingByRow).reduce((sum, n) => sum + n, 0);
  const openOriginals = pendingTotal + ctx.f1Proposals.filter((item) => item.ticket?.status !== "pending").length + (owner !== undefined && pendingF1RankHow(owner) ? 1 : 0);

  const conclusion = openOriginals > 0
    ? <Conclusion state="warn" icon={CircleHelp} hint="在下面的列表里逐条核对；有结论前不要换个办法重做。">有 {openOriginals} 项原操作还没有结论，先逐条核对</Conclusion>
    : permanent === "unset"
      ? <Conclusion state="warn" icon={ShieldOff} hint="在下面「九级共用的设置」里明确开启或关闭。"
        explain="没有这项设置时按关闭执行：用户下一次被评估时，没达标就降到实际达到的等级。">不降级保护没有设置，按关闭执行：没达标的用户会降级</Conclusion>
      : <Conclusion state="neutral" icon={Layers3}
        hint={unconfigured.length ? `${unconfigured.join("、")} 还没有晋级奖励。` : undefined}>
        九级里人最多的是 {busiest.v}，占 {pct(busiest.pop, total)}</Conclusion>;

  const stats = (
    <StatBand label="会员等级摘要">
      <Stat label="总会员" value={fmt(total)} unit="人" icon={Users} tone="role-3" sub={`含 V0 ${fmt(v0Pop)} 人`}
        explain="全部未删除的用户；没有等级记录的算 V0。九级人数加起来就是这个数。" />
      <Stat label="V3 及以上" value={fmt(v3plus)} unit="人" icon={Layers3} tone="role-3"
        sub={total > 0 ? `占 ${pct(v3plus, total)}` : "总会员为 0"} explain="V3 到 V8 的人数合计。" />
      <Stat label="本月晋升" value={ctx.monthlyPromotionCount == null ? "—" : fmt(ctx.monthlyPromotionCount)} unit={ctx.monthlyPromotionCount == null ? undefined : "人次"}
        icon={ArrowUpCircle} tone="role-3"
        explain="本月（业务时区的自然月）等级往上升的次数，含人工升级；同一个人升两次算两次。和下面晋升记录的筛选无关。读不到时写「—」。" />
      <Stat label="配了晋级奖励" value={String(configured)} unit="级" icon={Gift} tone="role-2" sub={`共 ${rows.length} 级`}
        explain="晋级奖励里至少有一项奖励的等级数。" />
    </StatBand>
  );

  const lensInfo = lenses.find((item) => item.value === lens) ?? lenses[0];
  const lensValue = (row: F1VRankRow): number | null => {
    if (lens === "pop") return row.pop;
    const raw = lens === "l1" ? ratePct(row.purchaseL1Rate) : lens === "salary" ? row.monthlySalaryUsdt?.trim() : row[lens];
    return raw !== undefined && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
  };
  const lensText = (row: F1VRankRow, value: number | null) => {
    if (value === null) return "—";
    if (lens === "pop") return fmt(value);
    if (lens === "l1") return `${ratePct(row.purchaseL1Rate)}%`;
    if (value === 0) return lens === "salary" ? "不发" : "不要求";
    return lens === "salary" ? amountDisplay(row.monthlySalaryUsdt!.trim()) : fmt(value);
  };
  const lensMax = Math.max(1, ...rows.map((row) => lensValue(row) ?? 0));
  const select = (code: string) => { setPicked(code); writeQuery("rank", code); };
  const onLadderKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const codes = rows.map((row) => row.v);
    const at = codes.indexOf(selected.v);
    const next = event.key === "ArrowRight" ? codes[(at + 1) % codes.length]
      : event.key === "ArrowLeft" ? codes[(at - 1 + codes.length) % codes.length]
        : event.key === "Home" ? codes[0] : event.key === "End" ? codes[codes.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    select(next);
    document.getElementById(ladderIds.tab(next))?.focus();
  };

  const ladder = (
    <Panel title="九级阶梯" icon={Layers3} tone="role-3" sub={`柱高：${lensInfo.label}`}
      explain={<><p>点一级看它的晋升条件、晋级奖励和等级权益。九根柱同一个刻度，数小的几级会贴底，具体看柱上的数；为 0 的不画柱。</p>
        <p>看门槛和权益时，数字后面的「×3」是这一级是上一级的几倍。门槛一般逐级变高；月薪和比例可以不涨，×1 以下不一定是填错。</p></>}>
      <div className="f1-lens"><Segments label="柱高口径" value={lensInfo.value} items={lenses.map(({ value, label }) => ({ value, label }))} onChange={setLens} /></div>
      <div className="f1-ladder-wrap"><div className="f1-ladder" role="tablist" aria-label="会员等级">
        {rows.map((row, i) => {
          const value = lensValue(row);
          const prevValue = i > 0 ? lensValue(rows[i - 1]) : null;
          const ratio = lens !== "pop" && value && prevValue ? String(Math.round((value / prevValue) * 10) / 10) : null;
          const isSelected = row.v === selected.v;
          const rewards = rewardsOf(row.v);
          const kinds = [...new Set(rewards.map((item) => rewardKind(item.type)))];
          const title = titlesByLevel[row.v] && titlesByLevel[row.v] !== row.v ? titlesByLevel[row.v] : "";
          // 柱的满高 72px，九根柱共用一个刻度；0 不画柱。
          const height = value && value > 0 ? Math.max(3, (value / lensMax) * 72) : 0;
          const valueText = lensText(row, value);
          return (
            <button key={row.v} type="button" role="tab" id={ladderIds.tab(row.v)} aria-selected={isSelected} aria-controls={ladderIds.panelId(selected.v)}
              tabIndex={isSelected ? 0 : -1} onKeyDown={onLadderKey} onClick={() => select(row.v)}
              className="f1-step" data-selected={isSelected ? "" : undefined}
              aria-label={`${row.v}${title ? ` ${title}` : ""}，${lensInfo.label} ${valueText}${value && value > 0 && lens !== "l1" ? ` ${lensInfo.unit}` : ""}，${rewards.length ? `${rewards.length} 项晋级奖励` : "没有晋级奖励"}${pendingApprovalRanks.has(row.v) ? "，有待审批的申请" : ""}${pendingByRow[row.v] ? `，${pendingByRow[row.v]} 项修改结果未知` : ""}`}>
              <span className="f1-step-head"><b>{row.v}</b>{title && <span className="f1-step-title" title={title}>{title}</span>}</span>
              <span className="f1-step-col" aria-hidden>
                <span className="f1-step-value" data-empty={!value ? "" : undefined}>{valueText}{ratio && <small className="f1-step-ratio">×{ratio}</small>}</span>
                {height > 0 && <svg className="f1-step-bar" data-lens={lens} width="36" height={height} viewBox={`0 0 36 ${height}`} aria-hidden><rect width="36" height={height} rx="2" /></svg>}
              </span>
              <span className="f1-step-foot" aria-hidden>
                {rewards.length
                  ? <span className="f1-step-kinds">{kinds.map((kind) => { const Icon = REWARD_KIND[kind].icon; return <Icon key={kind} size={13} />; })}<span>{rewards.length} 项</span></span>
                  : <span className="f1-step-none">没有晋级奖励</span>}
                {pendingByRow[row.v] > 0 && <span className="f1-step-flag" data-tone="warn"><CircleHelp size={12} />未知</span>}
                {pendingApprovalRanks.has(row.v) && <span className="f1-step-flag" data-tone="warn">待审批</span>}
              </span>
              {isSelected && <span className="f1-step-current">当前查看</span>}
            </button>
          );
        })}
      </div></div>
    </Panel>
  );

  const openThreshold = (row: F1VRankRow, field: F1ConditionField) => setPolicyEditor({ row, action: "threshold", field, valuation: ctx.f1RewardValuation });
  const detail = <RankDetail row={selected} rows={rows} ctx={ctx} rewards={rewardsOf(selected.v)} title={titlesByLevel[selected.v] && titlesByLevel[selected.v] !== selected.v ? titlesByLevel[selected.v] : ""}
    panel={ladderIds.panel(selected.v)} canWrite={canWrite} pendingOf={pendingOf} hasPendingApproval={pendingApprovalRanks.has(selected.v)} hasUnknownOperation={rowPending(selected) > 0}
    onThreshold={openThreshold} onBenefit={(field) => setPolicyEditor({ row: selected, action: "threshold", field, valuation: ctx.f1RewardValuation })}
    onGoV8={v8Review ? () => setView("v8") : undefined} salaryPresent={salaryPresent}
    onReward={(action, reward) => setPolicyEditor({ row: selected, action, reward, valuation: ctx.f1RewardValuation })}
    />;

  const leadership = ctx.leadership;
  const protectionValue = permanent === "on"
    ? <StatusTag tone="ok" icon={ShieldCheck}>已开启</StatusTag>
    : permanent === "off" ? <StatusTag tone="neutral" icon={ShieldOff}>未开启</StatusTag>
      : <StatusTag tone="warn" icon={TriangleAlert} explain="没有这项设置，按关闭执行。">未设置，按关闭执行</StatusTag>;
  const openProtection = (next: "on" | "off") => {
    const action = next === "off" ? "关闭不降级保护" : "开启不降级保护";
    const now = permanent === "on" ? "已开启" : permanent === "off" ? "未开启" : "未设置（按关闭执行）";
    setConfirm({
      proposalSlot: "f-config:F.vrank.permanent",
      action, briefKind: "record", title: next === "off" ? "关闭不降级保护" : "开启不降级保护",
      confirmTone: next === "off" ? "danger" : "primary", confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled explain={`${SUPER_APPROVER}在「操作记录与审批」批准后才生效；批准前仍按现在的设置评估。`}>批准后生效</StatusTag>,
      facts: <Facts><Fact k="不降级保护"><Change from={now} to={next === "off" ? "关闭" : "开启"} /></Fact><Fact k="影响范围">九级全部用户</Fact></Facts>,
      statedBrief: next === "off"
        ? { impact: "批准后，用户下一次被评估时没达标就降到实际达到的等级，团队激励池票数按所在等级算；已发的奖励不收回。不是批准时一次扫描全部用户。", check: "核对是否要让没达标的用户降级；理由写清依据或工单号。" }
        : { impact: "批准后，用户下一次被评估时没达标也保留现在的等级；已经降过级的用户不会恢复原来的等级，人工降级不受影响。", check: "核对开启范围是全部九级；理由写清依据或工单号。" },
      detail: "不降级保护",
      submit: async (reason) => { await ctx.updateF1Config("F.vrank.permanent", next, reason); },
      done: "已提交，等待审批后执行",
    });
  };
  const openPrize = () => {
    const action = prizeName ? "修改全局奖品名" : "配置全局奖品名";
    setConfirm({
      proposalSlot: "f-config:F.prize.name",
      action, briefKind: "config", title: prizeName ? "修改奖品名称" : "配置奖品名称", confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled explain={`${SUPER_APPROVER}在「操作记录与审批」批准后才生效；批准前仍显示原来的名字。`}>批准后生效</StatusTag>,
      edit: { kind: "text", current: prizeName, unit: "奖品名称" },
      statedBrief: { impact: "只改显示的名字，不影响晋升和奖励发放。", check: "核对名字写法；1–160 字。" },
      detail: "会员等级的奖品名称，只用于显示，不影响奖励和晋升。",
      submit: async (reason, _value, newValue) => {
        if (!newValue) throw new Error("请填写新值");
        await ctx.updateF1Config("F.prize.name", newValue, reason);
      },
      done: "已提交，等待审批后执行",
    });
  };
  const openTitles = () => setConfirm({
    proposalSlot: "f-config:F.vrank.titles",
    action: "设置各级头衔", briefKind: "config", title: "设置各级头衔", confirmLabel: "提交审批",
    effect: <StatusTag tone="progress" filled explain={`${SUPER_APPROVER}在「操作记录与审批」批准后才生效；批准前仍按原来的头衔显示。`}>批准后生效</StatusTag>,
    statedBrief: { impact: "只改这页和发给 App 的头衔文字，不影响晋升条件和奖励；App 现在只显示 V0–V8，不显示头衔。", check: "每一级都要填。" },
    businessForm: {
      kind: "multi-field",
      fields: rows.map((row) => ({ key: row.v, label: row.v, current: titlesByLevel[row.v] ?? "", inputKind: "text" as const, placeholder: `${row.v} 头衔` })),
    },
    detail: "每一级都要填写，只用于显示，不影响奖励和晋升。",
    submit: async (reason, values) => {
      if (!values) throw new Error("请填写头衔");
      const titles: Record<string, string> = {};
      for (const row of rows) {
        const title = (values[row.v] ?? "").trim();
        if (!title) throw new Error(`请填写 ${row.v} 的头衔（每一级都要填）`);
        titles[row.v] = title;
      }
      await ctx.updateF1Config("F.vrank.titles", JSON.stringify(titles), reason);
      ctx.toast("已提交，等待审批后执行");
    },
  });
  const titleCount = Object.keys(titlesByLevel).length;
  const shared = (
    <Panel title="九级共用的设置" icon={Settings2} tone="role-4" explain="这几项对九级同时生效，修改都要提交审批，由另一位超级管理员批准。">
      <ConfigList label="九级共用的设置">
        <ConfigRow name="不降级保护" value={protectionValue}
          what="没达标时保不保留现在的等级。"
          when="提交审批，另一位超级管理员批准后生效；之后每次评估用户时按新设置判断，不是批准时扫描全部用户。"
          effect="开启：下一次评估没达标也保留现在的等级，不会把已经降级的人恢复，人工降级不受这项限制。关闭：降到实际达到的等级，团队激励池票数按所在等级算，已发的奖励不收回。"
          action={canProtect ? <span className="f1-row-actions">
            {permanent !== "on" && <Button size="sm" disabled={ctx.f1Loading || !!ctx.f1Error} onClick={() => openProtection("on")}>开启保护</Button>}
            {permanent !== "off" && <Button size="sm" variant="danger-outline" disabled={ctx.f1Loading || !!ctx.f1Error} onClick={() => openProtection("off")}>{permanent === "unset" ? "设为关闭" : "关闭保护"}</Button>}
          </span> : undefined} />
        <ConfigRow name="奖品名称" value={prizeName ? <span className="f1-strong">{prizeName}</span> : <span className="f1-weak">未配置</span>}
          what="会员等级奖品的显示名字，不影响奖励和晋升。"
          where="这页显示；这个名字也会发给 App，App 现在没有地方显示它。没配置时发默认名。"
          when="提交审批，另一位超级管理员批准后生效。"
          action={canWrite ? <Button size="sm" disabled={ctx.f1Loading || !!ctx.f1Error} onClick={openPrize}>{prizeName ? "修改" : "配置"}</Button> : undefined} />
        <ConfigRow name="各级头衔" value={<span className="f1-strong">已设置 {titleCount}/{rows.length} 级</span>}
          what="每一级的称呼，只用于显示，不影响奖励和晋升。"
          where="这页的等级卡和发给 App 的等级名；App 现在只显示 V0–V8，不显示头衔。"
          when="提交审批，另一位超级管理员批准后生效；每一级都要填。"
          action={canWrite ? <Button size="sm" disabled={ctx.f1Loading || !!ctx.f1Error} onClick={openTitles}>设置头衔</Button> : undefined} />
        <ConfigRow name="团队激励池" value={leadership
          ? <span className="f1-strong">{leadership.unlockRank > 0 ? `从 V${leadership.unlockRank} 起有票数` : "没有等级有票数"}</span>
          : <span className="f1-weak">—</span>}
          sub={leadership ? `票数最多的前 ${fmt(leadership.topN)} 人占全池票数 ${leadership.topConcentrationPct}%` : "读不到激励池摘要"}
          what="每级票数决定这一级在激励池里分多少。" note="这里只读，票数在「奖励池、名额与排行榜」改。"
          effect="「从 V几 起」是最低一个票数大于 0 的等级；前 N 人占比按票数算，不是人数占比，也不是分到的钱的占比。"
          action={<Link className="rd-link" href="/network/leadership-pool" prefetch={false}>去改票数</Link>} />
      </ConfigList>
    </Panel>
  );

  const skipsOverrideCoverage = (values: BusinessFormValue) => values.targetV === "V8" && values.direction === "promote";
  const openOverride = () => {
    overrideRead.current += 1;
    const proposalSlot = (values?: BusinessFormValue) => `f-vrank-override:${values?.userId?.trim() ?? ""}`;
    const readUserRank = async (values: BusinessFormValue) => {
      const request = ++overrideRead.current;
      const userId = values.userId?.trim() ?? "";
      setConfirm(current => current?.proposalSlot === proposalSlot ? { ...current, facts: <Facts><Fact k="现在的等级">这页读不到；批准时按当时的等级核对方向</Fact></Facts> } : current);
      let rank: string | undefined;
      if (/^[1-9]\d*$/.test(userId) && Number.isSafeInteger(Number(userId)) && ctx.can("user_c1_read")) {
        try {
          const page = await fetchUserProfilesPage({ userId, pageNum: 1, pageSize: 20 });
          // C1 filters by the internal ID but deliberately returns only the public userNo.
          const profile = page.total === 1 ? page.records[0] : undefined;
          if (profile?.vRank && /^V[0-8]$/.test(profile.vRank)) rank = profile.vRank;
        } catch { /* Read failure keeps the prepared unknown state; never infer V0. */ }
      }
      if (overrideRead.current === request) setConfirm(current => current?.proposalSlot === proposalSlot ? { ...current,
        facts: <Facts><Fact k="现在的等级">{rank ?? "这页读不到；批准时按当时的等级核对方向"}</Fact></Facts>,
      } : current);
    };
    setConfirm({
      proposalSlot,
      action: "手动调整会员等级",
      title: "人工调整等级",
      briefKind: (value) => !skipsOverrideCoverage(value) && value.direction !== "rollback" && (ctx.rewards[value.targetV] ?? []).some((reward) => reward.type === "usdt" || reward.type === "uvt") ? "funds" : "config",
      amplify: true,
      confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled explain={`${VRANK_APPROVER}（还要有审批批准权限）在「操作记录与审批」批准后才执行；批准前这位用户的等级不变。`}>批准后生效</StatusTag>,
      coverageLead: "升级会按目标等级的奖励模板发奖，可能让平台多付钱",
      coverageCheck: "批准执行时按目标等级发奖励，发资金奖励前检查兑付覆盖率。",
      facts: <Facts><Fact k="现在的等级">这页读不到；批准时按当时的等级核对方向</Fact></Facts>,
      statedBrief: (value) => {
        const user = value.userId?.trim() ? `用户 ${value.userId.trim()}` : "这位用户";
        const target = value.targetV || "目标等级";
        if (value.direction === "rollback") return {
          impact: `批准后 ${user} 降到 ${target}：不收回已发的奖励，不受不降级保护限制。目标等级必须低于当时的等级，否则批准时被拒。`,
          check: "先在「晋升记录」查这位用户上次的等级变化，确认现在的等级再选。",
        };
        const rewards = value.targetV ? (ctx.rewards[value.targetV] ?? []).map((item) => rewardLine(item, ctx)) : [];
        return {
          impact: `批准后 ${user} 升到 ${target}：只发 ${target} 这一级的奖励模板${value.targetV ? `（${rewards.length ? rewards.join("、") : "现在没有奖励"}）` : ""}，中间跳过的等级不补发。目标等级必须高于当时的等级，否则批准时被拒。`,
          check: "先在「晋升记录」查这位用户上次的等级变化，确认现在的等级再选。",
        };
      },
      businessForm: {
        kind: "multi-field",
        requireAnyChange: false,
        amplifies: (values) => !skipsOverrideCoverage(values),
        onFieldChange: (field, next) => { if (field === "userId") void readUserRank(next); return next; },
        fields: [
          { key: "userId", label: "用户编号", inputKind: "text", required: true, placeholder: "请输入用户编号", pattern: "^[1-9]\\d*$", patternMessage: "用户编号须为正整数" },
          { key: "targetV", label: "目标等级", inputKind: "select", options: rows.map((row) => row.v), required: true, mustChoose: true },
          { key: "direction", label: "调整方向", inputKind: "select", options: ["promote", "rollback"], optionLabels: { promote: "升级", rollback: "降级" }, required: true, mustChoose: true },
        ],
      },
      detail: "会改变用户的权益和之后的奖励资格。提交后需在「操作记录与审批」确认才生效。",
      submit: async (reason, values) => {
        const userId = values?.userId?.trim() ?? "";
        const targetV = values?.targetV?.trim() ?? "";
        const direction = values?.direction;
        if (direction !== "rollback" && direction !== "promote") throw new Error("请选择调整方向");
        if (!/^[1-9]\d*$/.test(userId) || !Number.isSafeInteger(Number(userId))) throw new Error("用户编号须为正整数");
        if (!rows.some((row) => row.v === targetV)) throw new Error("目标等级无效");
        overrideRead.current += 1;
        await ctx.proposeVRankOverride(userId, targetV, direction, reason);
      },
    });
  };

  return (
    <div className="f1-page">
      {header}
      {conclusion}
      {recovery}
      {stats}
      {tabBar}
      <div {...ids.panel(view)} className="f1-view">
        {view === "ladder" && <>
          {ctx.f1Error && <Notice tone="danger" title="刚才重新读取失败，下面是上一次读到的内容" action={<Button size="sm" onClick={() => void ctx.refreshF1Membership()}>重试</Button>}>{ctx.f1Error}</Notice>}
          {ladder}{detail}{shared}
        </>}
        {view === "v8" && v8Review && <F1V8Review ctx={ctx} state={v8Review} v8={rows.find((row) => row.v === "V8")} canApprove={canApproveV8} onApprove={openV8Approve} />}
        {view === "salary" && <F1SalaryClaims ctx={ctx} rows={rows} />}
        {view === "promotions" && <F1PromotionHistory ctx={ctx} rows={rows} canPromote={canPromote} onOverride={openOverride} />}
        {view === "payouts" && <F1PayoutHistory ctx={ctx} rows={rows} canReissue={canReissue} canReverse={canReverse} openConfirm={setConfirm} />}
        {view === "howto" && <F1RankHow key={howEpoch} ladder={rows} toast={ctx.toast} onPendingChange={() => setRecoveryEpoch(value => value + 1)} />}
      </div>
      {dialogs}
    </div>
  );

}

/** 选中一级的详情：上排晋升条件 | 等级权益，下排晋级奖励 | 这一级的其他设置（画板 A1、A5）。 */
function RankDetail({ row, rows, ctx, rewards, title, panel, canWrite, pendingOf, hasPendingApproval, hasUnknownOperation, onThreshold, onBenefit, onReward, onGoV8, salaryPresent }: {
  row: F1VRankRow;
  rows: F1VRankRow[];
  ctx: FViewCtx;
  rewards: OpsVRankRewardItem[];
  title: string;
  panel: { id: string; role: "tabpanel"; "aria-labelledby": string };
  canWrite: boolean;
  pendingOf: (editor: Omit<F1PolicyEditor, "valuation">) => unknown;
  hasPendingApproval: boolean;
  hasUnknownOperation: boolean;
  onThreshold: (row: F1VRankRow, field: F1ConditionField) => void;
  onBenefit: (field: F1BenefitField) => void;
  onReward: (action: "reward_add" | "reward_update" | "reward_remove", reward?: OpsVRankRewardItem) => void;
  onGoV8?: () => void;
  salaryPresent: boolean;
}) {
  const index = rows.findIndex((item) => item.v === row.v);
  const prev = index > 0 ? rows[index - 1] : undefined;
  const next = index < rows.length - 1 ? rows[index + 1] : undefined;
  const total = rows.reduce((sum, item) => sum + item.pop, 0);
  const top = row.v === "V8";
  // 「操作记录与审批」这个账号进得去才给链接（ST-58）。
  const canOpenA2 = useAdminAuth((state) => !!state.session && canAccessResolvedPath(resolveVisibleDomains(state.session), "/platform/audit"));
  const legCount = row.legCount ?? "0";
  const legBroken = Number(legCount) > 0 && (row.legRank ?? "NONE") === "NONE";
  // 这一级有待审批单：条件、权益、晋级奖励同一个审批锁，按钮都禁用并写原因（B83 同一套锁）。
  const lock = hasPendingApproval ? "等审批结果：批准、驳回或撤回后再改"
    : ctx.f1Loading || ctx.f1Error ? "请先成功重新读取会员等级。"
    : hasUnknownOperation
      ? "这一级有结果未知的原操作，请先查询原结果。" : undefined;

  const single = (field: "selfBuy" | "teamGv" | "directRefs", source: F1VRankRow | undefined) => {
    const raw = source?.[field];
    if (raw === undefined) return undefined;
    return raw === "0" ? "不要求" : `${fmtText(raw)} ${FIELD_UNIT[field]}`;
  };
  const leader = (source: F1VRankRow | undefined) => {
    if (!source || source.legCount === undefined) return undefined;
    if (source.legCount === "0") return "不要求";
    return !source.legRank || source.legRank === "NONE" ? `${fmtText(source.legCount)} 个 · 最低等级未设置` : `${fmtText(source.legCount)} 个 ${source.legRank}`;
  };
  const near = (text: (source: F1VRankRow) => string | undefined) =>
    [prev && text(prev) !== undefined ? `${prev.v} ${text(prev)}` : undefined, next && text(next) !== undefined ? `${next.v} ${text(next)}` : undefined].filter(Boolean).join(" · ") || undefined;
  const mini = (value: (source: F1VRankRow) => number) => {
    const values = rows.map(value);
    const max = Math.max(1, ...values);
    return (
      <span className="f1-mini" aria-hidden>
        <svg width="61" height="20" viewBox="0 0 61 20">
          {values.map((item, i) => {
            const h = item > 0 ? Math.max(3, (item / max) * 20) : 0;
            return <rect key={rows[i].v} data-on={i === index ? "" : undefined} x={i * 7} y={20 - h} width="5" height={h} rx="1" />;
          })}
        </svg>
      </span>
    );
  };
  const numeric = (raw: string | undefined) => raw !== undefined && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : 0;
  const unknownTag = <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效或已建审批单。点「查看原操作」查询或按原内容重试。">结果未知</StatusTag>;
  const evalWhen = top ? "保存后，之后评估时按新值判断谁进「V8 审核」名单；不会自动升到 V8，不重算已有等级。" : "保存后，之后每次评估用户时按新值算；不重算已有等级，不补发历史奖励。";
  const needCount = [row.selfBuy, row.teamGv, row.directRefs, legCount].filter((raw) => raw !== undefined && raw !== "0").length;

  const thresholdAction = (field: F1ConditionField, label: string, text: string, describedBy?: string) => {
    const pending = pendingOf({ row, action: "threshold", field });
    if (!canWrite && !pending) return null;
    return <Button size="sm" aria-describedby={describedBy} aria-label={`${pending ? "查看原操作" : label} ${row.v} ${text}`} disabledReason={pending ? undefined : lock}
      onClick={() => onThreshold(row, field)}>{pending ? "查看原操作" : label}</Button>;
  };

  const benefitRow = (field: F1BenefitField, name: string, info: { what: string; where?: string; when: string; effect: string; note?: ReactNode }) => {
    const value = benefitValue(row, field);
    const salary = field === "monthlySalaryUsdt";
    const text = (source: F1VRankRow) => {
      const raw = benefitValue(source, field);
      if (raw === undefined) return undefined;
      return salary ? Number(raw) === 0 ? "不发" : `${amountDisplay(raw)} USDT` : `${raw}%`;
    };
    const pending = pendingOf({ row, action: "threshold", field });
    const fixed = salary && (row.v === "V0" || row.v === "V1");
    if (fixed) return <ConfigRow key={field} name={name} what="V2 起才有月薪。"
      value={<span className="f1-th"><span className="f1-weak">不发</span>{value !== undefined && mini((source) => numeric(benefitValue(source, field)))}</span>}
      sub={value === undefined ? undefined : near(text)} />;
    return <ConfigRow key={field} name={name} what={info.what} where={info.where} when={info.when} effect={info.effect} note={info.note}
      value={value === undefined
        ? <span className="f1-weak">—</span>
        : <span className="f1-th"><span className={text(row) === "不发" ? "f1-weak" : "f1-strong"}>{text(row)}</span>{mini((source) => numeric(benefitValue(source, field)))}</span>}
      sub={value === undefined ? "暂时读不到" : near(text)}
      action={pending || value !== undefined && canWrite ? (describedBy) => <span className="f1-row-actions">
        {pending ? unknownTag : null}
        <Button size="sm" aria-describedby={describedBy} aria-label={`${pending ? "查看原操作" : "调整"} ${row.v} ${name}`} disabledReason={pending ? undefined : lock} onClick={() => onBenefit(field)}>{pending ? "查看原操作" : "调整"}</Button>
      </span> : undefined} />;
  };

  const zeroFact = (value: string) => value === "不开通" || value === "未开放" || value === "0 票" || value.endsWith("未派发");
  const peer = row.peerBonusRate === 0 ? "未开放" : `${(row.peerBonusRate * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%，未派发`;
  const facts = [
    { key: "depth", label: "团队购买奖励范围", value: row.unilevelDepth && row.unilevelDepth !== "0" ? row.unilevelDepth.replace("-", "–") : "不开通",
      explain: "这一级的用户能拿第 3 层以后哪几层的团队购买奖励。第 1、2 层按等级比例照发，不受它管。不开通时 App 不显示。" },
    { key: "peer", label: "同级奖励", value: peer,
      explain: row.peerBonusRate === 0 ? "同级奖励现在不派发，比例为 0，App 不显示。" : "这是配置值；同级奖励现在不派发，App 显示为未开放。" },
    { key: "votes", label: "团队激励池票数", value: `${fmt(row.votes)} 票`,
      explain: "这一级每人在团队激励池里的票数。为 0 时这一级不参与激励池分配，App 不显示；在「奖励池、名额与排行榜」改。" },
    { key: "visible", label: "在 App 显示", value: row.visible ? "显示" : "隐藏", explain: "这里只列启用的等级，正常都是显示；这页没有切换入口。" },
  ];

  return (
    <Panel {...panel} className="f1-detail" title={<>{row.v}{title && <span className="f1-detail-title">{title}</span>}</>} explainLabel={`${row.v} 的说明`}
      sub={`${fmt(row.pop)} 人 · 占 ${pct(row.pop, total)}`} icon={Layers3} tone="role-3"
      explain={top ? "左边是升到 V8 要满足什么，右边是 V8 拿什么。V8 不自动晋级，审核后人工升级。" : "左边是升到这一级要满足什么，右边是升到这一级拿什么。用户每次被评估最多升一级，所以不能跳过这一级。"}>
      {hasPendingApproval && <Notice tone="warn" title={`${row.v} 有一张待审批的申请`}
        action={canOpenA2 ? <Link className="rd-link" href="/platform/audit" prefetch={false}>去操作记录与审批查看 →</Link> : undefined}>批准、驳回或撤回前，这一级的条件、权益和晋级奖励都改不了。</Notice>}
      <div className="rd-split f1-detail-split">
        <Panel plain headingLevel={3} title="晋升条件" icon={Lock} tone="role-4" sub={top ? "4 项数值 · 2 项人工审核" : `${needCount} 项`}
          explain={top
            ? "V8 不自动晋级，要审核：四项数值条件由系统评估，V1–V8 各级都满足的 V7 进「V8 审核」名单；后两项只在审核时核对。门槛照常可调：调低要提交审批，调高确认后立即生效。"
            : "列出的几项要同时满足，门槛为 0 的不看。调低门槛是放宽，要提交审批；调高是收紧，确认后立即生效。保存后只影响以后的评估，不会重算已有等级，也不补发历史奖励。"}>
          {legBroken && <Notice tone="warn" title="下级领导者不完整">设了人数但没设最低等级，评估时这一项一律判不满足，这一级没人能升上来。</Notice>}
          <ConfigList label={`${row.v} 晋升条件`}>
            {SINGLE_FIELDS.map((field) => {
              const value = single(field, row);
              const pending = pendingOf({ row, action: "threshold", field });
              const ordered = field !== "directRefs";
              return (
                <ConfigRow key={field} name={FIELD_NAME[field]} what={FIELD_WHAT[field]} when={evalWhen}
                  effect={`调低（放宽）要提交审批，${SUPER_APPROVER}批准后生效；调高（收紧）或不变确认后立即生效。`}
                  note={ordered ? "不能低于上一级、不能高于下一级（相等可以；为 0 的不比）。" : "有一笔有效付款订单就算，买任何商品都算，不看金额。这一项不和相邻等级比大小。"}
                  value={value === undefined ? <span className="f1-weak">—</span> : <span className="f1-th">
                    <span className={value === "不要求" ? "f1-weak" : "f1-strong"}>{value}</span>
                    {mini((source) => numeric(source[field]))}
                    {pending ? unknownTag : null}
                  </span>}
                  sub={value === undefined ? "这项数据现在没有" : near((source) => single(field, source))}
                  action={value !== undefined ? (describedBy) => {
                    const button = thresholdAction(field, "调整", FIELD_NAME[field], describedBy);
                    return button ? <span className="f1-row-actions">{button}</span> : null;
                  } : undefined} />
              );
            })}
            {(() => {
              const value = leader(row);
              const pending = pendingOf({ row, action: "threshold", field: "legCount" }) || pendingOf({ row, action: "threshold", field: "legRank" });
              const count = thresholdAction("legCount", "调人数", "下级领导者人数");
              const rank = thresholdAction("legRank", "调等级", "下级领导者最低等级");
              return <ConfigRow name="下级领导者（一二级）" what="一二级好友里，等级不低于要求的人数。" when={evalWhen}
                effect={`人数和最低等级分开调整。调低人数或调低最低等级是放宽，要提交审批，${SUPER_APPROVER}批准后生效；收紧确认后立即生效。人数为 0 时不看这一项。`}
                note="等级更高的也算，例：5 个 V1 = 一二级里 V1 及以上 5 人。和相邻等级比时，最低等级高的更严；最低等级相同再比人数。"
                value={value === undefined ? <span className="f1-weak">—</span> : <span className="f1-th">
                  <span className={value === "不要求" ? "f1-weak" : legBroken ? "f1-warn-text" : "f1-strong"}>{value}</span>
                  {pending ? unknownTag : null}
                </span>}
                sub={value === undefined ? "这项数据现在没有" : near(leader)}
                action={value !== undefined && (count || rank) ? <span className="f1-row-actions">{count}{rank}</span> : undefined} />;
            })()}
            {top && <ConfigRow name="审核时另看" what="两项都是 App 展示的固定文案，系统不记录。" where="App 我的等级 › V8 晋升条件"
              note="推荐信来自哪位 V8、官方审核的依据，写进「审核通过」的理由。" value={<span className="f1-text-value">{V8_TERMS.join("、")}</span>}
              action={onGoV8 ? <span className="f1-row-actions"><button type="button" className="rd-link" onClick={onGoV8}>去 V8 审核 →</button></span> : undefined} />}
          </ConfigList>
        </Panel>
        <Panel plain headingLevel={3} className="f1-benefits" title="等级权益" icon={Sparkles} tone="role-1" sub={`${(salaryPresent ? 3 : 2) + (top ? 1 : 0)} 项`}
          explain={top
            ? `V8 的${salaryPresent ? "月薪、" : ""}好友买设备时的奖励比例照常可调；另外 5 项是 App 展示的固定文案，这里只读。调高要提交审批，调低确认后立即生效。`
            : `${salaryPresent ? "这一级的用户每个月能领的月薪，和" : ""}好友买设备时给这一级的奖励比例。调高是增加资金，要提交审批；调低确认后立即生效。`}>
          <ConfigList label={`${row.v} 等级权益`}>
            {benefitRow("purchaseL1Rate", "好友购买奖励 · 一级", {
              what: "一级好友买设备时，按这个比例给奖励。", where: "App 我的等级 › 等级权益；好友奖励说明",
              when: "调低立即生效，调高批准后生效；之后付款的订单按新比例算，已经算好的不变。",
              effect: `调高要提交审批，${SUPER_APPROVER}批准后生效，提交和批准时检查兑付覆盖率；调低确认后立即生效。`,
              note: "发放记录在「奖励记录核对」：购买拆分开启时记为好友购买奖励，否则记为团队购买奖励，行内写第 1 层。",
            })}
            {benefitRow("purchaseL2Rate", "好友购买奖励 · 二级", {
              what: "二级好友（好友的好友）买设备时，按这个比例给奖励。", where: "App 我的等级 › 等级权益；好友奖励说明",
              when: "调低立即生效，调高批准后生效；之后付款的订单按新比例算，已经算好的不变。",
              effect: `调高要提交审批，${SUPER_APPROVER}批准后生效，提交和批准时检查兑付覆盖率；调低确认后立即生效。`,
              note: "发放记录在「奖励记录核对」记为团队购买奖励，行内写第 2 层。",
            })}
            {salaryPresent && benefitRow("monthlySalaryUsdt", "月薪", {
              what: "这一级每个自然月可领一次的 USDT。", where: "App 我的等级 › 月薪",
              when: "改了从下个月起按新金额；这个月已到这一级的人仍按原金额，这个月才升上来的按升级那天的金额。",
              effect: `调高要提交审批，${SUPER_APPROVER}批准后生效，提交和批准时检查兑付覆盖率；调低确认后立即生效。可以填 0（这一级不发）。`,
              note: <>用户在 App 手动领取，只能当月领，没领的下月作废；月底最后一天升到当月新的最高等级的，下月 1 号当天还能领上个月的。<br />兑付覆盖率低于红线或读不到时领不了；领到直接进可用余额，不冷却。</>,
            })}
            {top && <ConfigRow name="V8 另加权益" what="五项都是 App 展示的固定文案。" where="App 我的等级 › V8 等级权益"
              note="系统不发放、不记录；这里只读，不能改。"
              value={<span className="f1-text-value f1-text-list">{V8_PERKS.map((perk, i) => <span key={perk}>{perk}{i < V8_PERKS.length - 1 ? "、" : ""}</span>)}</span>} />}
          </ConfigList>
        </Panel>
      </div>
      <div className="rd-split f1-detail-split f1-detail-bottom">
        <Panel plain headingLevel={3} title="晋级奖励" icon={Gift} tone="role-2" sub={rewards.length ? `${rewards.length} 项` : "没有晋级奖励"}
          explain={top
            ? "人工升到 V8 的审批执行时，一次性发给晋级本人；先进冷却，到期后可用。改奖励只影响以后的发放，增加资金奖励要提交审批。"
            : "升到这一级时一次性发给晋级本人，按这里的每一项各发一次；先进冷却，到期后可用。改奖励只影响以后的发放，已经发出的不变。增加资金奖励要提交审批；其余确认后立即生效。"}
          actions={canWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={lock} onClick={() => onReward("reward_add")}>添加奖励</Button> : undefined}>
          {rewards.length === 0
            ? <p className="f1-empty">升到 {row.v} 时不发晋级奖励。</p>
            : <ul className="f1-rewards" aria-label={`${row.v} 晋级奖励`}>
              {rewards.map((item) => {
                const kind = rewardKind(item.type);
                const Icon = REWARD_KIND[kind].icon;
                const text = rewardText(item, ctx);
                const stale = (item.type === "voucher" && item.voucherId && !ctx.voucherOptions.includes(item.voucherId))
                  || (item.type === "sku" && item.skuId && !ctx.skuOptions.includes(item.skuId));
                const pending = pendingOf({ row, action: "reward_update", reward: item }) ?? pendingOf({ row, action: "reward_remove", reward: item });
                return (
                  <li key={item.id} className="f1-reward" data-kind={kind}>
                    <span className="f1-reward-icon" aria-hidden><Icon size={16} /></span>
                    <span className="f1-reward-main">
                      <span className="f1-reward-value">{text.missing ? <span className="f1-weak">{text.main}</span> : <>{text.main}{text.unit && <small> {text.unit}</small>}</>}</span>
                      <span className="f1-reward-kind">
                        {REWARD_KIND[kind].name} · 发给晋级本人
                        {stale && <StatusTag tone="warn" icon={TriangleAlert} explain="它已不在现在可发的券或商品里（停用、过期、发完或下架）。升到这一级时可能发不出；编辑时要重新选。">现在不可发</StatusTag>}
                        {pending ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果。点「查看原操作」查询或按原内容重试。">结果未知</StatusTag> : null}
                      </span>
                    </span>
                    {canWrite && <span className="f1-row-actions">
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} aria-hidden />} disabledReason={pending ? undefined : lock} aria-label={`编辑 ${row.v} 奖励 ${rewardLine(item, ctx)}`} onClick={() => onReward("reward_update", item)}>编辑</Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} disabledReason={pending ? undefined : lock} aria-label={`移除 ${row.v} 奖励 ${rewardLine(item, ctx)}`} onClick={() => onReward("reward_remove", item)}>移除</Button>
                    </span>}
                  </li>
                );
              })}
            </ul>}
        </Panel>
        <Panel plain headingLevel={3} title="这一级的其他设置" icon={Settings2} tone="role-other" sub={`${facts.length} 项`}
          explain="这几项在首次配置时填写，在这页不能改。为 0 或不开通时用户看不到这一项。">
          <dl className="f1-facts">
            {facts.map((item) => <div key={item.key}>
              <dt>{item.label}<Explain label={`${item.label}的说明`} content={item.explain} /></dt>
              <dd className={zeroFact(item.value) ? "f1-weak" : undefined}>{item.value}</dd>
            </div>)}
          </dl>
        </Panel>
      </div>
    </Panel>
  );
}
