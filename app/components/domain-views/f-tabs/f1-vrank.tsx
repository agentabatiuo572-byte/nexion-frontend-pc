"use client";

/**
 * F1 团队等级晋升（改版）。
 * 首屏回答：九级阶梯现在什么样（每级多少人、门槛跳在哪、升上去拿什么），有没有要处理的事，改哪一项会让平台多付钱。
 * 排法：一句结论 → 四个数 → 页签「等级与奖励」「晋升记录」「奖励发放记录」「App 等级说明」。
 * 「等级与奖励」是九级阶梯（选择器，柱高按所选口径）+ 选中一级的详情（五项门槛、奖励模板、只读参数）+ 九级共用的设置。
 * 请求、校验、权限全部沿用旧页面：门槛和奖励走 F1PolicyConfirm（lib/admin/f1-policy-change），其余走 ctx 上现成的提交函数。
 */
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  ArrowUpCircle, CircleHelp, Gift, Layers3, Lock, Pencil, Plus, RefreshCw, Settings2, ShieldCheck, ShieldOff, Trash2, TriangleAlert, Users,
} from "lucide-react";
import {
  BlockState, Button, Change, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, Notice, PageHeader, PageTabs, Panel,
  Segments, Stat, StatBand, StatusTag, useTabIds,
} from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { f1ConditionLabels, listF1PolicyOperations, pendingF1Policy, type F1ConditionField, type F1PolicyEditor } from "@/lib/admin/f1-policy-change";
import { fetchUserProfilesPage } from "@/lib/admin/user360-client";
import { pendingF1RankHow } from "@/lib/admin/f1-rank-how-save";
import type { F1VRankRow } from "@/lib/admin/f1-client";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { BusinessFormValue } from "../design-kit";
import type { FViewCtx } from "./types";
import { F1PolicyConfirm } from "./f1-policy-confirm";
import { F1RecoveryNotice } from "./f1-recovery";
import { F1VrankBootstrap } from "./f1-vrank-bootstrap";
import { F1PromotionHistory, F1PayoutHistory } from "./f1-history";
import { F1RankHow } from "./f1-rank-how";
import { ADMIN_APPROVER, F1ConfirmHost, REWARD_KIND, SUPER_APPROVER, rewardKind, rewardLine, rewardText, type F1Confirm } from "./f1-shared";

type View = "ladder" | "promotions" | "payouts" | "howto";
type Lens = "pop" | "teamGv" | "selfBuy" | "directRefs";

const FIELDS: F1ConditionField[] = ["teamGv", "selfBuy", "directRefs", "legCount", "legRank"];
/** 五项门槛用运营的话说是什么（VRankPromotionEngine.meetsAllConditions：大于 0 才算条件）。 */
const FIELD_WHAT: Record<F1ConditionField, string> = {
  teamGv: "这位用户整个团队买的算力点合计，到这个数才算满足。",
  selfBuy: "这位用户自己买的算力点合计，到这个数才算满足。",
  directRefs: "直接邀请的人里，自己买的算力点达到 V1 自购门槛的人数。",
  legCount: "直接邀请的人里，等级不低于「分支最低等级」的要有几个。",
  legRank: "数「达标分支」时，直接邀请的人至少要到哪一级。",
};
const FIELD_UNIT: Record<F1ConditionField, string> = { teamGv: "点", selfBuy: "点", directRefs: "人", legCount: "个", legRank: "" };
const LENSES: { value: Lens; label: string; unit: string }[] = [
  { value: "pop", label: "人数", unit: "人" },
  { value: "teamGv", label: "团队算力点", unit: "点" },
  { value: "selfBuy", label: "自购算力点", unit: "点" },
  { value: "directRefs", label: "直接邀请人数", unit: "人" },
];

const fmt = (value: number) => value.toLocaleString("en-US");
const fmtText = (value: string) => /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : value;
const levelNo = (code: string) => Number(code.replace(/^V/, ""));

export function F1Vrank({ ctx }: { ctx: FViewCtx }) {
  const rows = ctx.vrankRows;
  const owner = useAdminAuth((state) => state.session?.adminId);
  const canWrite = ctx.can("network_f1_write");
  const canProtect = ctx.can("network_f1_permanent_protection");
  const canPromote = ctx.can("network_f1_promote_user");
  const canReissue = ctx.can("network_f1_reward_reissue");
  const canReverse = ctx.can("network_f1_reward_reverse");
  const ids = useTabIds();
  const ladderIds = useTabIds();
  const [view, setView] = useState<View>("ladder");
  const [lens, setLens] = useState<Lens>("pop");
  const [picked, setPicked] = useState<string | null>(null);
  const [policyEditor, setPolicyEditor] = useState<F1PolicyEditor | null>(null);
  const [confirm, setConfirm] = useState<F1Confirm | null>(null);
  const [howEpoch, setHowEpoch] = useState(0);
  const [, setRecoveryEpoch] = useState(0);

  const overrideRead = useRef(0);
  useEffect(() => { setConfirm(null); setPolicyEditor(null); }, [ctx.f1ReadEpoch]);
  const pendingApprovalRanks: ReadonlySet<string> = new Set(ctx.f1ApprovalRanks);
  const readOnly = !(canWrite || canProtect || canPromote || canReissue || canReverse)
    ? "你只能查看；这个账号没有修改等级、发起审批或处理奖励的权限。" : undefined;
  const header = (
    <PageHeader pageId="F1" title="团队等级晋升"
      summary="管 V0–V8 九级的晋升条件、升级奖励和每级人数。"
      actions={<>
        <Link className="rd-link" href="/network/leadership-pool" prefetch={false}>团队激励池票数权重</Link>
        <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={ctx.f1Loading} onClick={() => void ctx.refreshF1()}>重新读取</Button>
      </>}
      readOnly={readOnly} />
  );
  const dialogs = <Fragment key="f1-dialogs">
    {policyEditor && <F1PolicyConfirm
      key={`${policyEditor.row.v}:${policyEditor.action}:${policyEditor.field ?? policyEditor.reward?.id ?? "new"}:${policyEditor.recoveryCommandKey ?? "edit"}`}
      editor={policyEditor} ctx={ctx} pendingApproval={pendingApprovalRanks.has(policyEditor.row.v)} onClose={() => setPolicyEditor(null)}
      onPendingChange={() => setRecoveryEpoch(value => value + 1)} />}
    {confirm && <F1ConfirmHost confirm={confirm} ctx={ctx} onClose={() => setConfirm(null)} />}
  </Fragment>;
  const recovery = <F1RecoveryNotice ctx={ctx} onOpenPolicy={setPolicyEditor} onRankHowChecked={() => setHowEpoch((value) => value + 1)} />;

  if (rows.length === 0) {
    const body = ctx.f1Loading
      ? <><Conclusion state="unknown">正在读取会员等级…</Conclusion>{recovery}<Panel title="九级阶梯"><BlockState state="loading" title="正在读取会员等级" /></Panel></>
      : ctx.f1Error
        ? <><Conclusion state="danger">会员等级读取失败，这部分没有判断</Conclusion>
          {recovery}
          <Panel title="九级阶梯"><BlockState state="error" title="会员等级读取失败" detail={ctx.f1Error} onRetry={() => void ctx.refreshF1()} /></Panel></>
        : canWrite
          ? <>{recovery}<F1VrankBootstrap ctx={ctx} openConfirm={setConfirm} /></>
          : <><Conclusion state="neutral" icon={Layers3}>还没有建立会员等级</Conclusion>
            {recovery}
            <Panel title="九级阶梯"><BlockState state="empty" title="还没有建立会员等级" detail="有修改权限的同事可以发起首次配置，另一位管理员批准后这里才会出现九级。" /></Panel></>;
    return <div className="f1-page">{header}{body}{dialogs}</div>;
  }

  const rewardsOf = (v: string): OpsVRankRewardItem[] => ctx.rewards[v] ?? [];
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
  const policyOperations = owner === undefined ? [] : listF1PolicyOperations(owner);
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
        hint={unconfigured.length ? `${unconfigured.join("、")} 还没有升级奖励。` : undefined}>
        {fmt(total)} 位会员分在九级里，人最多的是 {busiest.v}（{fmt(busiest.pop)} 人）</Conclusion>;

  const stats = (
    <StatBand label="会员等级摘要">
      <Stat label="总会员" value={fmt(total)} unit="人" icon={Users} tone="role-3" sub={`含 V0 ${fmt(v0Pop)} 人`}
        explain="全部未删除的用户；没有等级记录的算 V0。九级人数加起来就是这个数。" />
      <Stat label="V3 及以上" value={fmt(v3plus)} unit="人" icon={Layers3} tone="role-3"
        sub={total > 0 ? `占 ${((v3plus / total) * 100).toFixed(2)}%` : "总会员为 0"} explain="V3 到 V8 的人数合计。" />
      <Stat label="本月晋升" value={ctx.monthlyPromotionCount == null ? "—" : fmt(ctx.monthlyPromotionCount)} unit={ctx.monthlyPromotionCount == null ? undefined : "人次"}
        icon={ArrowUpCircle} tone="role-3"
        explain="本月（业务时区的自然月）等级往上升的次数，含人工升级；同一个人升两次算两次。和下面晋升记录的筛选无关。读不到时写「—」。" />
      <Stat label="配了升级奖励" value={String(configured)} unit="级" icon={Gift} tone="role-2" sub={`共 ${rows.length} 级`}
        explain="奖励模板里至少有一项奖励的等级数。" />
    </StatBand>
  );

  const lensInfo = LENSES.find((item) => item.value === lens)!;
  const lensValue = (row: F1VRankRow): number | null => {
    if (lens === "pop") return row.pop;
    const raw = row[lens];
    return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const lensMax = Math.max(1, ...rows.map((row) => lensValue(row) ?? 0));
  const select = (code: string) => { setPicked(code); };
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
      explain="点一级看它的晋升条件和升级奖励。九根柱用同一个刻度；切换上面的口径看人数或某项门槛在九级之间怎么变化，柱跳得最高的地方就是门槛跳得最多的地方。门槛为 0 表示这一级不看这一项，不画柱。">
      <div className="f1-lens"><Segments label="柱高口径" value={lens} items={LENSES.map(({ value, label }) => ({ value, label }))} onChange={setLens} /></div>
      <div className="f1-ladder-wrap"><div className="f1-ladder" role="tablist" aria-label="会员等级">
        {rows.map((row) => {
          const value = lensValue(row);
          const isSelected = row.v === selected.v;
          const rewards = rewardsOf(row.v);
          const kinds = [...new Set(rewards.map((item) => rewardKind(item.type)))];
          const title = titlesByLevel[row.v] ?? row.label;
          // 柱的满高 72px，九根柱共用一个刻度；0 不画柱。
          const height = value && value > 0 ? Math.max(3, (value / lensMax) * 72) : 0;
          const valueText = value === null ? "—" : lens !== "pop" && value === 0 ? "不要求" : fmt(value);
          return (
            <button key={row.v} type="button" role="tab" id={ladderIds.tab(row.v)} aria-selected={isSelected} aria-controls={ladderIds.panelId(selected.v)}
              tabIndex={isSelected ? 0 : -1} onKeyDown={onLadderKey} onClick={() => select(row.v)}
              className="f1-step" data-selected={isSelected ? "" : undefined}
              aria-label={`${row.v} ${title}，${lensInfo.label} ${valueText}${value && value > 0 ? ` ${lensInfo.unit}` : ""}，${rewards.length ? `${rewards.length} 项升级奖励` : "没有升级奖励"}${pendingByRow[row.v] ? `，${pendingByRow[row.v]} 项修改结果未知` : ""}`}>
              <span className="f1-step-head"><b>{row.v}</b><span className="f1-step-title" title={title}>{title || "—"}</span></span>
              <span className="f1-step-col" aria-hidden>
                <span className="f1-step-value" data-empty={!value ? "" : undefined}>{valueText}</span>
                {height > 0 && <svg className="f1-step-bar" data-lens={lens} width="36" height={height} viewBox={`0 0 36 ${height}`} aria-hidden><rect width="36" height={height} rx="2" /></svg>}
              </span>
              <span className="f1-step-foot" aria-hidden>
                {rewards.length
                  ? <span className="f1-step-kinds">{kinds.map((kind) => { const Icon = REWARD_KIND[kind].icon; return <Icon key={kind} size={13} />; })}<span>{rewards.length} 项</span></span>
                  : <span className="f1-step-none">没有奖励</span>}
                {pendingByRow[row.v] > 0 && <span className="f1-step-flag" data-tone="warn"><CircleHelp size={12} />未知</span>}
                {pendingApprovalRanks.has(row.v) && <span className="f1-step-flag" data-tone="warn"><Lock size={12} />待批</span>}
              </span>
              {isSelected && <span className="f1-step-current">当前查看</span>}
            </button>
          );
        })}
      </div></div>
    </Panel>
  );

  const openThreshold = (row: F1VRankRow, field: F1ConditionField) => setPolicyEditor({ row, action: "threshold", field, valuation: ctx.f1RewardValuation });
  const detail = <RankDetail row={selected} rows={rows} ctx={ctx} rewards={rewardsOf(selected.v)} title={titlesByLevel[selected.v] ?? selected.label}
    panel={ladderIds.panel(selected.v)} canWrite={canWrite} pendingOf={pendingOf} hasPendingApproval={pendingApprovalRanks.has(selected.v)}
    onThreshold={openThreshold}
    onReward={(action, reward) => setPolicyEditor({ row: selected, action, reward, valuation: ctx.f1RewardValuation })}
    />;

  const leadership = ctx.leadership;
  const protectionValue = permanent === "on"
    ? <StatusTag tone="ok" icon={ShieldCheck}>已开启</StatusTag>
    : permanent === "off" ? <StatusTag tone="neutral" icon={ShieldOff}>已关闭</StatusTag>
      : <StatusTag tone="warn" icon={TriangleAlert} explain="没有这项设置，按关闭执行。">未设置，按关闭执行</StatusTag>;
  const openProtection = (next: "on" | "off") => {
    const action = next === "off" ? "关闭不降级保护" : "开启不降级保护";
    const now = permanent === "on" ? "已开启" : permanent === "off" ? "已关闭" : "未设置（按关闭执行）";
    setConfirm({
      proposalSlot: "f-config:F.vrank.permanent",
      action, briefKind: "record", title: next === "off" ? "关闭不降级保护" : "开启不降级保护",
      confirmTone: next === "off" ? "danger" : "primary", confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled explain={`${ADMIN_APPROVER}（需有不降级保护权限和审批批准权限）在「操作记录与审批」批准后才生效；批准前仍按现在的设置评估。`}>批准后生效</StatusTag>,
      facts: <Facts><Fact k="不降级保护"><Change from={now} to={next === "off" ? "关闭" : "开启"} /></Fact><Fact k="影响范围">九级全部用户</Fact></Facts>,
      statedBrief: next === "off"
        ? { impact: "批准后，用户下一次被评估时没达标就降到实际达到的等级，团队激励池票数按所在等级算；已发的奖励不收回。不是批准时一次扫描全部用户。", check: "核对是否要让没达标的用户降级；理由写清依据或工单号。" }
        : { impact: "批准后，用户下一次被评估时没达标也保留现在的等级；已经降过级的用户不会恢复原来的等级，人工降级不受影响。", check: "核对开启范围是全部九级；理由写清依据或工单号。" },
      detail: "不降级保护",
      submit: async (reason) => { await ctx.updateF1Config("F.vrank.permanent", next, reason); },
      done: `${action} 已提交审批，等另一位管理员批准`,
    });
  };
  const openPrize = () => {
    const action = prizeName ? "修改全局奖品名" : "配置全局奖品名";
    setConfirm({
      proposalSlot: "f-config:F.prize.name",
      action, briefKind: "config", title: prizeName ? "修改奖品名称" : "配置奖品名称", confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled explain={`${ADMIN_APPROVER}（需有团队等级修改权限和审批批准权限）在「操作记录与审批」批准后才生效；批准前仍显示原来的名字。`}>批准后生效</StatusTag>,
      edit: { kind: "text", current: prizeName, unit: "奖品名称" },
      statedBrief: { impact: "只改显示的名字，不影响晋升和奖励发放。", check: "核对名字写法；1–160 字。" },
      detail: "会员等级的奖品名称，只用于显示，不影响奖励和晋升。",
      submit: async (reason, _value, newValue) => {
        if (!newValue) throw new Error("请填写新值");
        await ctx.updateF1Config("F.prize.name", newValue, reason);
      },
      done: `${action} 已提交审批，等另一位管理员批准`,
    });
  };
  const openTitles = () => setConfirm({
    proposalSlot: "f-config:F.vrank.titles",
    action: "设置各级头衔", briefKind: "config", title: "设置各级头衔", confirmLabel: "提交审批",
    effect: <StatusTag tone="progress" filled explain={`${ADMIN_APPROVER}（需有团队等级修改权限和审批批准权限）在「操作记录与审批」批准后才生效；批准前仍按原来的头衔显示。`}>批准后生效</StatusTag>,
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
      ctx.toast("各级头衔已提交，批准后生效；批准前仍按原设置显示");
    },
  });
  const titleCount = Object.keys(titlesByLevel).length;
  const shared = (
    <Panel title="九级共用的设置" icon={Settings2} tone="role-4" explain="这几项对九级同时生效，修改都要提交审批，由另一位管理员批准。">
      <ConfigList label="九级共用的设置">
        <ConfigRow name="不降级保护" value={protectionValue}
          what="开启时，没达标的用户在下一次评估时保留现在的等级；关闭时降到实际达到的等级。"
          when="提交审批，另一位管理员批准后生效；之后每次评估用户时按新设置判断，不是批准时扫描全部用户。"
          effect="关闭：没达标的用户会降级，团队激励池票数按所在等级算，已发的奖励不收回。开启：只保留现在的等级，不会把已经降级的人恢复；人工降级不受这项限制。"
          action={canProtect ? <span className="f1-row-actions">
            {permanent !== "on" && <Button size="sm" onClick={() => openProtection("on")}>开启保护</Button>}
            {permanent !== "off" && <Button size="sm" variant="danger-outline" onClick={() => openProtection("off")}>{permanent === "unset" ? "设为关闭" : "关闭保护"}</Button>}
          </span> : undefined} />
        <ConfigRow name="奖品名称" value={prizeName ? <span className="f1-strong">{prizeName}</span> : <span className="f1-weak">未配置</span>}
          what="会员等级奖品的显示名字，不影响奖励和晋升。"
          where="这页显示；这个名字也会发给 App，App 现在没有地方显示它。没配置时发默认名。"
          when="提交审批，另一位管理员批准后生效。"
          action={canWrite ? <Button size="sm" onClick={openPrize}>{prizeName ? "修改" : "配置"}</Button> : undefined} />
        <ConfigRow name="各级头衔" value={<span className="f1-strong">已设置 {titleCount}/{rows.length} 级</span>}
          what="每一级的称呼，只用于显示，不影响奖励和晋升。"
          where="这页的等级卡和发给 App 的等级名；App 现在只显示 V0–V8，不显示头衔。"
          when="提交审批，另一位管理员批准后生效；每一级都要填。"
          action={canWrite ? <Button size="sm" onClick={openTitles}>设置头衔</Button> : undefined} />
        <ConfigRow name="团队激励池" value={leadership
          ? <span className="f1-strong">{leadership.unlockRank > 0 ? `从 V${leadership.unlockRank} 起有票数` : "没有等级有票数"}</span>
          : <span className="f1-weak">—</span>}
          sub={leadership ? `票数最多的前 ${fmt(leadership.topN)} 人占全池票数 ${leadership.topConcentrationPct}%` : "读不到激励池摘要"}
          what="每级的票数决定这一级的人在团队激励池里分多少；这里只读，票数在「奖励池、名额与排行榜」改。"
          effect="「从 V几 起」是最低一个票数大于 0 的等级；前 N 人占比按票数算，不是人数占比，也不是分到的钱的占比。"
          action={<Link className="rd-link" href="/network/leadership-pool" prefetch={false}>去改票数</Link>} />
      </ConfigList>
    </Panel>
  );

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
      briefKind: (value) => value.direction !== "rollback" && (ctx.rewards[value.targetV] ?? []).some((reward) => reward.type === "usdt" || reward.type === "uvt") ? "funds" : "config",
      amplify: true,
      confirmLabel: "提交审批",
      effect: <StatusTag tone="progress" filled explain={`${ADMIN_APPROVER}（需有人工调级权限和审批批准权限）在「操作记录与审批」批准后才执行；批准前这位用户的等级不变。`}>批准后生效</StatusTag>,
      coverageLead: "升级会按目标等级的奖励模板发奖，可能让平台多付钱",
      coverageCheck: "批准执行时按目标等级发奖励，发资金奖励前检查兑付覆盖率。",
      facts: <Facts><Fact k="现在的等级">这页读不到；批准时按当时的等级核对方向</Fact></Facts>,
      statedBrief: (value) => {
        const user = value.userId?.trim() ? `用户 ${value.userId.trim()}` : "这位用户";
        const target = value.targetV || "目标等级";
        if (value.direction === "rollback") return {
          impact: `批准后 ${user} 降到 ${target}：不收回已发的奖励，不受不降级保护限制。目标等级必须低于当时的等级，否则批准时被拒。`,
          check: "先在「晋升记录」按用户编号查这位用户最近一次等级变化，确认现在的等级再选。",
        };
        const rewards = value.targetV ? (ctx.rewards[value.targetV] ?? []).map((item) => rewardLine(item, ctx)) : [];
        return {
          impact: `批准后 ${user} 升到 ${target}：只发 ${target} 这一级的奖励模板${value.targetV ? `（${rewards.length ? rewards.join("、") : "现在没有奖励"}）` : ""}，中间跳过的等级不补发。目标等级必须高于当时的等级，否则批准时被拒。`,
          check: "先在「晋升记录」按用户编号查这位用户最近一次等级变化，确认现在的等级再选。",
        };
      },
      businessForm: {
        kind: "multi-field",
        requireAnyChange: false,
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

  const tabs = [
    { value: "ladder" as const, label: "等级与奖励" },
    { value: "promotions" as const, label: "晋升记录" },
    { value: "payouts" as const, label: "奖励发放记录" },
    { value: "howto" as const, label: "App 等级说明" },
  ];

  return (
    <div className="f1-page">
      {header}
      {conclusion}
      {recovery}
      {ctx.f1Error && <Notice tone="danger" title="刚才重新读取失败，下面是上一次读到的内容" action={<Button size="sm" onClick={() => void ctx.refreshF1()}>重试</Button>}>{ctx.f1Error}</Notice>}
      {stats}
      <PageTabs label="团队等级晋升" value={view} items={tabs} onChange={setView} ids={ids} />
      <div {...ids.panel(view)} className="f1-view">
        {view === "ladder" && <>{ladder}{detail}{shared}</>}
        {view === "promotions" && <F1PromotionHistory ctx={ctx} rows={rows} canPromote={canPromote} onOverride={openOverride} />}
        {view === "payouts" && <F1PayoutHistory ctx={ctx} rows={rows} canReissue={canReissue} canReverse={canReverse} openConfirm={setConfirm} />}
        {view === "howto" && <F1RankHow key={howEpoch} ladder={rows} toast={ctx.toast} onPendingChange={() => setRecoveryEpoch(value => value + 1)} />}
      </div>
      {dialogs}
    </div>
  );

}

/** 选中一级的详情：五项门槛、奖励模板、只读参数。 */
function RankDetail({ row, rows, ctx, rewards, title, panel, canWrite, pendingOf, hasPendingApproval, onThreshold, onReward }: {
  row: F1VRankRow;
  rows: F1VRankRow[];
  ctx: FViewCtx;
  rewards: OpsVRankRewardItem[];
  title: string;
  panel: { id: string; role: "tabpanel"; "aria-labelledby": string };
  canWrite: boolean;
  pendingOf: (editor: Omit<F1PolicyEditor, "valuation">) => unknown;
  hasPendingApproval: boolean;
  onThreshold: (row: F1VRankRow, field: F1ConditionField) => void;
  onReward: (action: "reward_add" | "reward_update" | "reward_remove", reward?: OpsVRankRewardItem) => void;
}) {
  const index = rows.findIndex((item) => item.v === row.v);
  const prev = index > 0 ? rows[index - 1] : undefined;
  const next = index < rows.length - 1 ? rows[index + 1] : undefined;
  const share = (() => { const total = rows.reduce((sum, item) => sum + item.pop, 0); return total > 0 ? `${((row.pop / total) * 100).toFixed(2)}%` : "—"; })();
  const legBroken = Number(row.legCount ?? "0") > 0 && (row.legRank ?? "NONE") === "NONE";

  const thresholdValue = (field: F1ConditionField, source: F1VRankRow | undefined) => {
    const raw = source?.[field];
    if (raw === undefined) return undefined;
    if (field === "legRank") return raw === "NONE" ? "未设置" : raw;
    return raw === "0" ? (field === "legCount" ? "不看分支" : "不要求") : `${fmtText(raw)} ${FIELD_UNIT[field]}`;
  };
  // 0（不要求）调不低，不写方向；分支最低等级「未设置」也一样。
  const raw0 = (field: F1ConditionField, source: F1VRankRow) => source[field] === "0" || source[field] === "NONE";
  const steps = (field: F1ConditionField) => {
    if (field === "legRank") return null;
    const values = rows.map((item) => { const raw = item[field]; return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0; });
    const max = Math.max(1, ...values);
    return (
      <span className="f1-mini" aria-hidden>
        <svg width="61" height="20" viewBox="0 0 61 20">
          {values.map((value, i) => {
            const h = value > 0 ? Math.max(3, (value / max) * 20) : 0;
            return <rect key={rows[i].v} data-on={i === index ? "" : undefined} x={i * 7} y={20 - h} width="5" height={h} rx="1" />;
          })}
        </svg>
      </span>
    );
  };

  return (
    <Panel {...panel} className="f1-detail" title={<>{row.v}<span className="f1-detail-title">{title}</span></>} explainLabel={`${row.v} 的说明`}
      sub={`${fmt(row.pop)} 人 · 占 ${share}`} icon={Layers3} tone="role-3"
      explain="五项门槛要同时满足才升到这一级；门槛为 0 表示不看这一项。用户每次被评估最多升一级，所以不能跳过这一级。">
      {hasPendingApproval && <Notice tone="warn" title={`${row.v} 有一张待审批的门槛或奖励申请`}>
        批准前这一级仍按现在的设置；这期间门槛和奖励都改不了，批准、驳回或撤回后再改。
      </Notice>}
      <div className="rd-split f1-detail-split">
        <Panel plain headingLevel={3} title="晋升条件" icon={Lock} tone="role-4" sub="五项同时满足"
          explain="调低门槛是放宽，要提交审批；调高是收紧，确认后立即生效。保存后只影响以后的评估，不会重算已有等级，也不补发历史奖励。">
          {legBroken && <Notice tone="warn" title="分支条件不完整">达标分支数大于 0 但没设分支最低等级，评估时这一项一律判不满足，这一级没人能升上来。</Notice>}
          <ConfigList label={`${row.v} 晋升条件`}>
            {FIELDS.map((field) => {
              const value = thresholdValue(field, row);
              const pending = pendingOf({ row, action: "threshold", field });
              const prevText = thresholdValue(field, prev);
              const nextText = thresholdValue(field, next);
              const ordered = field !== "directRefs";
              return (
                <ConfigRow key={field} name={f1ConditionLabels[field]}
                  what={FIELD_WHAT[field]}
                  when="保存后，之后每次评估用户时按新值算；不重算已有等级，不补发历史奖励。"
                  effect={`调低（放宽）要提交审批，${SUPER_APPROVER}批准后生效；调高（收紧）或不变确认后立即生效。${field === "legCount" || field === "legRank" ? "达标分支数为 0 时，这两项的改动都直接生效。" : ""}`}
                  note={[
                    ordered ? "不能低于上一级、不能高于下一级（相等可以；为 0 或分支没配成对的不比）。" : "这一项不和相邻等级比大小。",
                    field === "selfBuy" && row.v === "V1" ? "V1 的自购算力点也是数「直接邀请人数」时算不算一个人的标准，改它会影响所有等级的这一项。" : undefined,
                    field === "legRank" ? "只能选比这一级低的等级，或者「未设置」。" : undefined,
                  ].filter(Boolean).join("")}
                  value={value === undefined ? <span className="f1-weak">—</span> : <span className="f1-th">
                    <span className={value === "不要求" || value === "不看分支" || value === "未设置" ? "f1-weak" : "f1-strong"}>{value}</span>
                    {steps(field)}
                    {pending ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效或已建审批单。点「查看原操作」查询或按原内容重试。">结果未知</StatusTag> : null}
                    {!canWrite || raw0(field, row) || (field === "legRank" && (row.legCount ?? "0") === "0") ? null : <span className="f1-dir">调低要批准</span>}
                  </span>}
                  sub={value === undefined ? "这项数据现在没有" : [prevText !== undefined && prev ? `${prev.v} ${prevText}` : undefined, nextText !== undefined && next ? `${next.v} ${nextText}` : undefined].filter(Boolean).join(" · ") || undefined}
                  action={value !== undefined && (canWrite || pending) ? (describedBy) => (
                    <span className="f1-row-actions">
                      <Button size="sm" aria-describedby={describedBy} aria-label={`${pending ? "查看原操作" : "调整"} ${row.v} ${f1ConditionLabels[field]}`}
                        onClick={() => onThreshold(row, field)}>{pending ? "查看原操作" : "调整"}</Button>
                    </span>
                  ) : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
        <Panel plain headingLevel={3} title="升级奖励" icon={Gift} tone="role-2" sub={rewards.length ? `${rewards.length} 项` : "没有奖励"}
          explain="用户升到这一级时，按这里的每一项各发一次。改模板只影响以后的发放，已经发出的奖励和账本不变。增加资金奖励（加钱、换成资金、按 UVT 现价折算后变多）要提交审批；其余确认后立即生效。"
          actions={canWrite ? <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => onReward("reward_add")}>添加奖励</Button> : undefined}>
          {rewards.length === 0
            ? <p className="f1-empty">升到 {row.v} 时不发奖励。</p>
            : <ul className="f1-rewards" aria-label={`${row.v} 升级奖励`}>
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
                        {REWARD_KIND[kind].name}
                        {item.type === "uvt" && <Explain label="UVT 奖励发给谁" content="默认发给这位用户的直接邀请人；奖励模板带本人标记或没有邀请人时发给本人。" />}
                        {stale && <StatusTag tone="warn" icon={TriangleAlert} explain="它已不在现在可发的券或商品里（停用、过期、发完或下架）。升到这一级时可能发不出；编辑时要重新选。">现在不可发</StatusTag>}
                        {pending ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果。点「查看原操作」查询或按原内容重试。">结果未知</StatusTag> : null}
                      </span>
                    </span>
                    {canWrite && <span className="f1-row-actions">
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} aria-hidden />} aria-label={`编辑 ${row.v} 奖励 ${rewardLine(item, ctx)}`} onClick={() => onReward("reward_update", item)}>编辑</Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} aria-label={`移除 ${row.v} 奖励 ${rewardLine(item, ctx)}`} onClick={() => onReward("reward_remove", item)}>移除</Button>
                    </span>}
                  </li>
                );
              })}
            </ul>}
        </Panel>
      </div>
      <div className="f1-detail-more">
        <h3 className="f1-subhead">这一级的其他设置<Explain label="其他设置的说明" content="这几项在首次配置时填写，这页只读，没有修改入口。" /></h3>
        <dl className="f1-facts">
          {[
            { key: "depth", label: "团队购买奖励范围", value: row.unilevelDepth && row.unilevelDepth !== "0" ? row.unilevelDepth.replace("-", "–") : "不开通",
              explain: "这一级的用户能拿团队里哪几层的购买奖励。" },
            { key: "peer", label: "同级奖比例", value: `${(row.peerBonusRate * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`,
              explain: "这是配置值；同级奖现在不派发，App 也显示为未开放。" },
            { key: "votes", label: "团队激励池票数", value: `${fmt(row.votes)} 票`, explain: "这一级每人在团队激励池里的票数，在「奖励池、名额与排行榜」改。" },
            { key: "visible", label: "App 显示", value: row.visible ? "显示" : "隐藏", explain: "这里只列启用的等级，正常都是显示；这页没有切换入口。" },
          ].map((item) => <div key={item.key}>
            <dt>{item.label}<Explain label={`${item.label}的说明`} content={item.explain} /></dt>
            <dd>{item.value}</dd>
          </div>)}
        </dl>
      </div>
    </Panel>
  );
}
