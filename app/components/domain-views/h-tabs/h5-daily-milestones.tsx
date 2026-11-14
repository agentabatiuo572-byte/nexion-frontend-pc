"use client";

/** H5: approval routing and durable original-command recovery, using the established H5 forms. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpDown, BarChart3, CalendarCheck, CircleSlash, Dices, Gift, Lock, Pencil, RefreshCw, ShieldCheck, Sparkles, Trophy, Users,
} from "lucide-react";
import {
  BlockState, Button, ChartLegend, ColumnChart, Conclusion, ConfigList, ConfigRow, Fact, Facts, Notice, PageHeader, PageTabs, Panel,
  SegmentBar, Stat, StatBand, StatusTag, StepBar, useTabIds,
} from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import {
  fetchH5CheckIn,
} from "@/lib/admin/h-client";
import { h5Amount, h5StreakReward, h5WholeReward, parseH5Model } from "@/lib/admin/h5-contract";
import { useH5Mutations, type H5PendingCommand } from "@/lib/admin/use-h5-mutations";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import type { ActionConfirmReq, HCtx } from "./types";
import {
  CheckInStrip, H5RecoveryNotice, MilestoneTrack, amountText, countText, dayNumber, expiredTag, legacyRewardName, pendingTag,
  positiveInteger, rewardKindText, streakRewardView, unknownTag,
  type CheckInRule, type EarnMilestone, type H5Model, type H5RecoveryRow, type PowerUp, type StreakMilestone, type StripMilestone,
} from "./h5-parts";

function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function rewardDestination(value: unknown) {
  const path = text(value, "");
  return ({
    "/team": "团队成长页",
    "/me/rewards": "我的奖励页",
    "/wallet/staking": "质押活动页",
    "/market/genesis": "创世节点 资格页",
  } as Record<string, string>)[path] ?? "相关权益页";
}

function decimalText(value: string) {
  return value.trim().replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** 谁来批：签到规则走旧规则审批，另一位有审批批准权限和签到规则修改权限的管理员就能批；成长、收益、连签的专用审批要另一位超级管理员。 */
const RULE_APPROVER = "另一位管理员";
const RULE_APPROVER_RIGHTS = "审批批准权限和签到规则修改权限";
const FUND_APPROVER = "另一位超级管理员";
const FUND_APPROVER_RIGHTS = "审批批准权限";

/** 签到规则的单位和说明，按规则键取；没列的键按后端原文显示。 */
const RULE_COPY: Record<string, { unit?: string; what: string; effect: string; fixed?: string }> = {
  baseline: { unit: "UVT", what: "每次签到固定给的 UVT，幸运倍率只乘这一项", effect: "批准后之后每次签到按新值发；已经签到的不变。调高会让平台每天多付 UVT。" },
  bonus7: { unit: "UVT", what: "连签每满 7 天（第 7、14、21… 天）那次签到另外加的 UVT", effect: "批准后之后满 7 天的签到按新值加；已经签到的不变。调高会让平台多付 UVT。" },
  p15: { unit: "%", what: "签到时基础奖励抽中 1.5 倍的机会", effect: "批准后之后的签到按新概率抽；已经签到的不变。调高会让用户平均多拿 UVT。" },
  p2: { unit: "%", what: "签到时基础奖励抽中 2 倍的机会", effect: "批准后之后的签到按新概率抽；已经签到的不变。调高会让用户平均多拿 UVT。" },
  luckyMultiplierMax: { fixed: "2×", what: "抽倍率最高一档是 2 倍", effect: "固定值，后台不能改。" },
  revive: { fixed: "1 张", what: "断签后恢复连签，每次用 1 张补救卡", effect: "固定值，后台不能改；App 也按一次用 1 张处理。" },
  broken: { unit: "小时", what: "多久没签到算断签", effect: "目前不影响签到：实际按日期判断，昨天没签今天就从第 1 天算。" },
  brokenHours: { unit: "小时", what: "多久没签到算断签", effect: "目前不影响签到：实际按日期判断，昨天没签今天就从第 1 天算。" },
  saver: { what: "补签卡的设置", effect: "目前不影响签到：用户恢复连签不读这一项。" },
  reviveCards: { what: "补签卡的设置", effect: "目前不影响签到：用户恢复连签不读这一项。" },
};
const IDLE_RULE_KEYS = new Set(["broken", "brokenHours", "saver", "reviveCards"]);
const STRIP_RULE_KEYS = new Set(["baseline", "bonus7"]);

function ruleValueText(rule: CheckInRule) {
  const copy = RULE_COPY[rule.key];
  if (copy?.fixed) return copy.fixed;
  const cur = text(rule.cur, "—");
  if (cur === "—" || !copy?.unit) return cur;
  return copy.unit === "%" ? `${cur}%` : `${cur} ${copy.unit}`;
}

type H5Confirm = ActionConfirmReq & { target: string; original?: H5PendingCommand; confirmLabelForValue?: (value?: string) => string };

type Tab = "rules" | "streak" | "power" | "earn" | "idle";

export function H5DailyMilestones({ ctx }: { ctx: HCtx }) {
  const { toast } = ctx;
  const session = useAdminAuth(s => s.session);
  const canRuleWrite = !!session?.authorities.includes("growth_h5_rule_write");
  const canWrite = !!session?.authorities.includes("growth_h5_write");
  const canWriteTick = useAdminAuth(({ session }) => !!session
    && ["superadmin", "super"].includes(session.role)
    && session.authorities.includes("growth_h5_tick_write"));
  const reach = useReach();
  const tabIds = useTabIds();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<H5Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("rules");
  const [mc, setMc] = useState<H5Confirm | null>(null);
  const fresh = useRef(false);
  const [approvalLabel, setApprovalLabel] = useState(false);
  const openActionConfirm = (req: H5Confirm) => {
    if (!req.original && (!fresh.current || mutations.record(req.target))) {
      toast("请先查询原结果并成功刷新签到数据，再发起新的修改。");
      return;
    }
    setApprovalLabel(false);
    setMc(req);
  };

  const reload = async () => {
    fresh.current = false;
    setLoading(true);
    try {
      setModel(parseH5Model(await fetchH5CheckIn()));
      fresh.current = true;
      setReadAt(Date.now());
      setError(null);
    } catch (err) {
      setError(displayAdminError(err));
    } finally {
      setLoading(false);
    }
  };

  const mutations = useH5Mutations(toast, async () => {
    fresh.current = false;
    setMc(null);
    await reload();
  }, () => fresh.current);

  const refresh = async () => {
    setMc(null);
    const results = await mutations.refreshTickets();
    for (const result of results) if (result.status === "rejected") toast(displayAdminError(result.reason));
    await reload();
  };
  useEffect(() => {
    void refresh();
  }, []);

  const proposal = (op: string, values: Record<string, unknown>) => {
    const def = findHighOp(op)!;
    return { command: def.buildCommand(values), target: def.buildTarget(values), type: def.type, amplifies: def.amplifies, roleGate: def.gateLabel };
  };

  const approveRuleTag = <StatusTag tone="progress" filled explain={`${RULE_APPROVER}批准后才生效，提交人不能批自己的；批准前仍按现在的值。`}>批准后生效</StatusTag>;
  const ruleApproverFacts = <>
    <Fact k="谁来批">{`${RULE_APPROVER}，不能是提交人`}</Fact>
    <Fact k="需有权限">{RULE_APPROVER_RIGHTS}</Fact>
  </>;
  const fundApproverFacts = (when: string) => <>
    <Fact k="谁来批">{`${when}：${FUND_APPROVER}，不能是提交人`}</Fact>
    <Fact k="需有权限">{FUND_APPROVER_RIGHTS}</Fact>
  </>;

  const openRule = (rule: CheckInRule, original?: H5PendingCommand) => {
    const snapshot = original?.change.snapshot ?? model!;
    const target = `rule:${rule.key}`;
    const current = text(rule.cur);
    const isProbability = rule.key === "p15" || rule.key === "p2";
    const currentNumber = current;
    const name = operatorCopyText(rule.name);
    const copy = RULE_COPY[rule.key];
    const submit = async (reason: string, value?: string) => {
      if (!value) throw new Error("value is required");
      const nextValue = value.trim();
      if (["baseline", "bonus7"].includes(rule.key) && !h5WholeReward(nextValue)) throw new Error("CHECKIN_REWARD_POSITIVE_INTEGER_REQUIRED");
      await mutations.run({ target, action: `签到规则 · ${operatorCopyText(rule.name)}`, name: `签到规则 · ${operatorCopyText(rule.name)}`,
        before: rule.cur, after: nextValue, success: "已提交，等待审批后执行", reason, snapshot,
        editValue: isProbability ? undefined : nextValue, businessValue: isProbability ? { [rule.key]: nextValue } : undefined,
        approvalRequired: true, proposal: { ...proposal("h5_checkin_rule", { ruleKey: rule.key, value: nextValue, expectedValue: rule.cur }),
          amplifies: isProbability && Number(nextValue) > Number(currentNumber) },
      });
    };
    const ruleBrief = { impact: copy?.effect ?? "批准后之后的签到按新值；已经签到的不变。", check: "核对新值和单位；理由写清依据或工单号。" };
    if (isProbability) {
      const other = snapshot.rules.find((item) => item.key === (rule.key === "p15" ? "p2" : "p15"));
      if (!other || !other.cur.trim() || !rule.cur.trim()) {
        toast("没有读到幸运倍率的设置。");
        return;
      }
      const otherProbability = Number(other.cur);
      openActionConfirm({ target, original, briefKind: "config", reasonPlaceholder: "例如：活动方案或工单号",
        action: `签到规则 · ${operatorCopyText(rule.name)}`,
        title: `调整${name}`,
        detail: <>每档概率必须在 0–100%，两档合计不能超过 100%。另一档当前为 {otherProbability}%。批准后生效。</>,
        effect: approveRuleTag,
        facts: (
          <Facts>
            <Fact k="现在" lead unit="%">{current}</Fact>
            <Fact k={operatorCopyText(other.name)}>{`${text(other.cur)}%，两档合计不能超过 100%`}</Fact>
            {ruleApproverFacts}
          </Facts>
        ),
        statedBrief: ruleBrief,
        coverageLead: "调高概率会让用户平均多拿 UVT",
        coverageCheck: "提交审批时不检查；批准时后端检查兑付覆盖率不低于红线，低于或算不准都拒绝。",
        confirmLabel: "提交审批",
        businessForm: {
          kind: "multi-field",
          amplifies: (values) => Number(values[rule.key]) > Number(currentNumber),
          fields: [{ key: rule.key, label: `${operatorCopyText(rule.name)}（%）`, inputKind: "number", current: currentNumber, min: 0, max: 100 }],
          feedback: (values) => {
            const raw = values[rule.key].trim();
            const decimal = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw);
            const probability = Number(raw);
            const total = probability + otherProbability;
            const invalid = !decimal || probability < 0 || probability > 100 || total > 100;
            return { message: `两档概率合计 ${Number(total.toFixed(4))}%；${!decimal ? "概率请填写普通十进制数字，不支持科学计数法" : probability < 0 || probability > 100 ? "单项概率必须在 0–100%" : total > 100 ? "两档合计不能超过 100%" : "符合单项范围和合计要求"}。`, invalid };
          },
        },
        run: (reason, _value, values) => submit(reason, values?.[rule.key]),
      });
      return;
    }
    if (rule.hot) {
      openActionConfirm({ target, original, briefKind: "config", reasonPlaceholder: "例如：活动方案或工单号",
        action: `签到规则 · ${operatorCopyText(rule.name)}`,
        title: `调整${name}`,
        detail: <>当前 <b>{current}</b>。批准后生效。</>,
        effect: approveRuleTag,
        facts: <Facts><Fact k="现在">{ruleValueText(rule)}</Fact>{ruleApproverFacts}</Facts>,
        statedBrief: ruleBrief,
        coverageCheck: "提交审批时不检查；批准时后端检查兑付覆盖率不低于红线，低于或算不准都拒绝。",
        confirmLabel: "提交审批",
        amplifies: true,
        edit: { kind: "number", current: currentNumber || current, unit: copy?.unit },
        run: submit,
      });
      return;
    }
    const idle = IDLE_RULE_KEYS.has(rule.key);
    const strip = STRIP_RULE_KEYS.has(rule.key);
    openActionConfirm({ target, original, briefKind: "config",
      action: `签到规则 · ${operatorCopyText(rule.name)}`,
      title: `调整${name}`,
      detail: <>当前 <b>{current}</b>。批准后生效。</>,
      effect: approveRuleTag,
      statedBrief: ruleBrief,
      content: (
        <div className="rd-stack">
          {idle && <Notice tone="warn" title="目前不影响签到">{copy?.effect}保存只改这一项的值。</Notice>}
          <Facts>
            <Fact k="现在" lead={strip} unit={strip ? copy?.unit : undefined}>{strip ? current : ruleValueText(rule)}</Fact>
            {strip && !positiveInteger(current) && <Fact k="现在的值" tone="warn">不是正整数，App 发不出，用户签到会失败</Fact>}
            {ruleApproverFacts}
          </Facts>
        </div>
      ),
      edit: { kind: strip || rule.key === "broken" || rule.key === "brokenHours" ? "number" : "text", current: rule.cur, unit: copy?.unit,
        label: strip ? `新值（${copy?.unit}，正整数）` : copy?.unit ? `新值（${copy.unit}）` : "新值",
        validate: strip ? (value) => h5WholeReward(value) ? undefined : displayAdminError(new Error("CHECKIN_REWARD_POSITIVE_INTEGER_REQUIRED")) : undefined },
      confirmLabel: "提交审批",
      reasonPlaceholder: "例如：活动方案或工单号",
      run: submit,
    });
  };

  const openStreak = (milestone: StreakMilestone, original?: H5PendingCommand) => {
    const snapshot = original?.change.snapshot ?? model!;
    const target = `streak:${milestone.id}`;
    const legacy = legacyRewardName(milestone.reward);
    const view = streakRewardView(milestone.reward, milestone.kind, operatorCopyText);
    openActionConfirm({ target, original, briefKind: "config", reasonPlaceholder: "例如：活动方案或工单号",
      action: `连签里程碑 · ${milestone.day}`,
      title: `改连签 ${milestone.day}奖励`,
      detail: legacy ? <>当前是 <b>{view.main}</b>，名称还是旧写法「{view.legacyName}」。</> : <>当前奖励 <b>{view.main}</b>。</>,
      effect: <StatusTag tone="neutral" icon={ArrowUpDown} explain={<>
        <p>数量变多，或换成 UVT、USDT、转盘票里别的一种：提交审批，{FUND_APPROVER}批准后才生效，提交人不能批自己的。</p>
        <p>数量变少或不变、改成徽章：确认后立即生效。方向按后端记的真实种类和数量判断，不看名称里的数字。</p>
      </>}>变多要批准 · 变少立即生效</StatusTag>,
      facts: (
        <Facts>
          <Fact k="连签">{milestone.day}</Fact>
          <Fact k="现在的奖励">{view.main}</Fact>
          {legacy
            ? <Fact k="名称" tone="warn">{`${view.legacyName}（旧名称，改时换成新写法）`}</Fact>
            : <Fact k="种类">{rewardKindText(milestone.kind)}</Fact>}
          {fundApproverFacts("变多或换种类")}
        </Facts>
      ),
      statedBrief: { impact: "改的是之后的领取：还没领的人领到新奖励，已经领过的不补不退；不给任何人直接发奖。", check: "核对奖励的种类和数量；理由写清依据或工单号。" },
      coverageLead: "数量变多或换成别的资金、转盘票，平台会多付",
      coverageCheck: "提交审批时和批准时，后端检查兑付覆盖率不低于红线；变少、不变、改成徽章不检查。",
      amplifies: true,
      edit: { kind: "text", current: milestone.reward, currentLabel: "现在的名称", hint: "一种奖励、数量是正整数：+5 UVT、+1 USDT、转盘票 ×2",
        validate: value => { const issue = h5StreakReward(value).issue; return issue ? displayAdminError(new Error(issue)) : undefined; } },
      confirmLabelForValue: value => value && h5StreakReward(value).amount && h5StreakReward(value).type.toLowerCase() !== milestone.kind?.toLowerCase() ? "提交审批" : "确认提交",
      run: async (reason, value) => {
        if (!value) throw new Error("reward is required");
        const reward = value.trim();
        const parsed = h5StreakReward(reward);
        if (parsed.issue) throw new Error(parsed.issue);
        await mutations.run({ target, action: `连签里程碑 · ${milestone.day}`, name: `连签里程碑 · ${milestone.day}`, before: milestone.reward, after: reward,
          success: `连签 ${milestone.day} 奖励已更新`, reason, snapshot, editValue: reward,
          direct: { path: `/check-in/streak-milestones/${milestone.id}`, body: { key: "reward", value: reward, expectedValue: milestone.reward } },
          proposal: proposal("h5_streak_milestone", { milestoneId: milestone.id, reward, expectedReward: milestone.reward }),
          approvalRequired: parsed.amount !== undefined && parsed.amount > BigInt(0) && parsed.type.toLowerCase() !== milestone.kind?.toLowerCase(),
        });
      },
    });
  };

  const openPowerUp = (powerUp: PowerUp, original?: H5PendingCommand) => {
    const snapshot = original?.change.snapshot ?? model!;
    const target = `power:${powerUp.id}`;
    const multiplier = powerUp.effectType === "CHECKIN_MULTIPLIER";
    const name = operatorCopyText(powerUp.label);
    const currentNote = text(powerUp.note, "");
    const amplifies = (values: Record<string, string>) => Number(values.day) < powerUp.day
      || (multiplier && (h5Amount(values.note) ?? BigInt(0)) > (h5Amount(currentNote) ?? BigInt(0)));
    openActionConfirm({ target, original, briefKind: "config", reasonPlaceholder: "例如：活动方案或工单号",
      action: `连续签到成长奖励 · ${operatorCopyText(powerUp.label)}`,
      title: `调整${name}`,
      detail: <>当前连续签到 <b>{powerUp.day}</b> 天解锁。{multiplier ? "签到倍率会改变用户每天签到拿多少。" : "说明文字只改显示。"}</>,
      effect: <StatusTag tone="neutral" icon={ArrowUpDown} explain={<>
        <p>{multiplier ? "提前解锁或调高倍率" : "提前解锁"}：提交审批，{FUND_APPROVER}批准后才生效，提交人不能批自己的。</p>
        <p>{multiplier ? "推后或调低倍率" : "推后或只改说明"}：确认后立即生效。已经激活的权益不收回。</p>
      </>}>{multiplier ? "提前、调高要批准" : "提前要批准"} · 其余立即生效</StatusTag>,
      facts: (
        <Facts>
          <Fact k="现在">{`连签第 ${powerUp.day} 天解锁 · ${multiplier ? `签到奖励 ×${currentNote || "—"}` : `前往${rewardDestination(powerUp.downstream)}`}`}</Fact>
          <Fact k="怎么拿到">用户连签到这一天后，在 App 签到页自己激活</Fact>
          {multiplier && <Fact k="已激活的人">改倍率后，之后每天签到也按新倍率</Fact>}
          {fundApproverFacts(multiplier ? "提前或调高" : "提前")}
        </Facts>
      ),
      statedBrief: (values) => amplifies(values)
        ? { impact: `${multiplier ? "提前解锁或调高倍率" : "提前解锁"}会让平台多付 UVT：提交审批，${FUND_APPROVER}批准后才生效。已有的签到记录不变。`, check: "核对天数和倍率；理由写清依据或工单号。" }
        : { impact: "确认后立即生效：之后达到天数的人按新设置激活；已经激活的权益不收回，已有的签到记录不变。", check: "核对天数和倍率；理由写清依据或工单号。" },
      coverageLead: multiplier ? "提前解锁或调高倍率会让平台多付 UVT" : "提前解锁会让平台多付",
      coverageCheck: "提交审批时和批准时，后端检查兑付覆盖率不低于红线，低于或算不准都拒绝。",
      amplifies: false,
      businessForm: {
        kind: "multi-field",
        amplifies,
        onFieldChange: (_key, values) => { setApprovalLabel(amplifies(values)); return values; },
        feedback: values => {
          const day = Number(values.day);
          const badDay = !/^\d+(?:\.0+)?$/.test(values.day) || !Number.isInteger(day) || day < 1 || day > 365;
          const badNote = multiplier && (!/^\d+(?:\.\d{1,4})?$/.test(values.note) || (h5Amount(values.note) ?? BigInt(0)) <= BigInt(0) || Number(values.note) >= 100000000);
          return { invalid: badDay || badNote, message: badDay ? "解锁天数须为 1–365 天的整数" : badNote ? displayAdminError(new Error("POWER_UP_MULTIPLIER_INVALID")) : "", field: badDay ? "day" : "note" };
        },
        fields: [
          { key: "day", label: "解锁天数", inputKind: "number", current: String(powerUp.day), placeholder: "例如 30", help: "连签满几天解锁，1–365 天" },
          multiplier
            ? { key: "note", label: "签到倍率", inputKind: "text", current: text(powerUp.note, ""), placeholder: "例如 1.5", required: true, help: "激活后每天的签到奖励乘这个数；不能留空，最多 4 位小数" }
            : { key: "note", label: "说明文字", inputKind: "text", current: text(powerUp.note, ""), placeholder: "可留空", required: false },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form || !form.day) throw new Error("POWER_UP_EXPECTED_STATE_REQUIRED");
        if (powerUp.businessAvailable === false) throw new Error("H5_POWER_UP_BUSINESS_RETIRED");
        const day = Number(form.day);
        if (!/^\d+(?:\.0+)?$/.test(form.day) || !Number.isInteger(day) || day < 1 || day > 365) throw new Error("POWER_UP_DAY_INTEGER_REQUIRED");
        const note = form.note ?? "";
        if (multiplier && (!/^\d+(?:\.\d{1,4})?$/.test(note) || (h5Amount(note) ?? BigInt(0)) <= BigInt(0) || Number(note) >= 100000000)) throw new Error("POWER_UP_MULTIPLIER_INVALID");
        await mutations.run({ target, action: `连续签到成长奖励 · ${name}`, name: `连续签到成长奖励 · ${name}`, before: `连签 ${powerUp.day} 天；${currentNote}`, after: `连签 ${day} 天；${note}`,
          success: `${name} 已更新`, reason, snapshot, businessValue: { day: form.day, note }, approvalRequired: amplifies(form),
          direct: { path: `/check-in/power-ups/${powerUp.id}/config`, body: { day, note, expectedDay: powerUp.day, expectedNote: currentNote } },
          proposal: proposal("h5_power_up_config", { powerUpId: powerUp.id, day, note, expectedDay: powerUp.day, expectedNote: currentNote }),
        });
      },
    });
  };

  const openEarn = (milestone: EarnMilestone, original?: H5PendingCommand) => {
    const snapshot = original?.change.snapshot ?? model!;
    const target = `earn:${milestone.key}`;
    const list = snapshot.earnMilestones;
    const index = list.findIndex((item) => item.key === milestone.key);
    const prev = index > 0 ? list[index - 1] : undefined;
    const next = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;
    const amplifies = (values: Record<string, string>) => (h5Amount(values.threshold) ?? h5Amount(milestone.threshold)!) < h5Amount(milestone.threshold)!
      || (h5Amount(values.nex) ?? h5Amount(milestone.nex)!) > h5Amount(milestone.nex)!;
    const issue = (values: Record<string, string>) => {
      const threshold = h5Amount(values.threshold);
      const reward = h5Amount(values.nex);
      if (threshold === undefined || reward === undefined || threshold < BigInt(1000000) || threshold > BigInt("100000000000000") || reward > BigInt("100000000000000")) return "门槛为 1–100000000 USDT，奖励为 0–100000000 UVT，最多 6 位小数";
      if (prev && threshold <= h5Amount(prev.threshold)! || next && threshold >= h5Amount(next.threshold)!) return displayAdminError(new Error("EARN_MILESTONE_THRESHOLD_ORDER_INVALID"));
    };
    openActionConfirm({ target, original, briefKind: "config", reasonPlaceholder: "例如：活动方案或工单号",
      action: `收益里程碑 · $${milestone.threshold}`,
      title: `调整收益里程碑 ${milestone.key}`,
      detail: <>当前门槛 <b>{amountText(milestone.threshold)} USDT</b>，奖励 <b>{amountText(milestone.nex)} UVT</b>。门槛要从小到大排列。</>,
      effect: <StatusTag tone="neutral" icon={ArrowUpDown} explain={<>
        <p>降门槛或加奖励：提交审批，{FUND_APPROVER}批准后才生效，提交人不能批自己的。</p>
        <p>提高门槛或减奖励：确认后立即生效。</p>
      </>}>降门槛、加奖励要批准 · 反方向立即生效</StatusTag>,
      facts: (
        <Facts>
          <Fact k="现在">{`累计收益满 ${amountText(milestone.threshold)} USDT，奖励 ${amountText(milestone.nex)} UVT`}</Fact>
          <Fact k="相邻的档">{`${prev ? `上一档 ${amountText(prev.threshold)} USDT` : "这是第一档"}；${next ? `下一档 ${amountText(next.threshold)} USDT` : "这是最后一档"}；门槛要从小到大`}</Fact>
          <Fact k="近 7 天达成">{milestone.weekTrigger == null ? "—" : `${countText(milestone.weekTrigger)} 次`}</Fact>
          {fundApproverFacts("降门槛或加奖励")}
        </Facts>
      ),
      statedBrief: (values) => amplifies(values)
        ? { impact: `降门槛或加奖励会让平台多付 UVT：提交审批，${FUND_APPROVER}批准后才生效。已经达成的不重发、不追发。`, check: "核对门槛、奖励和前后两档的顺序；理由写清依据或工单号。" }
        : { impact: "确认后立即生效：还没达成的人按新门槛和奖励算；已经达成的不重发、不追发。", check: "核对门槛、奖励和前后两档的顺序；理由写清依据或工单号。" },
      coverageLead: "降门槛或加奖励会让平台多付 UVT",
      coverageCheck: "提交审批时和批准时，后端检查兑付覆盖率不低于红线，低于或算不准都拒绝。",
      amplifies: true,
      businessForm: {
        kind: "multi-field",
        amplifies,
        onFieldChange: (_key, values) => { setApprovalLabel(amplifies(values)); return values; },
        feedback: values => ({ invalid: !!issue(values), message: issue(values) ?? "" }),
        fields: [
          { key: "threshold", label: "门槛（累计收益 USDT）", inputKind: "number", current: String(milestone.threshold), placeholder: "500", help: "最多 6 位小数，在相邻两档之间" },
          { key: "nex", label: "奖励（UVT）", inputKind: "number", current: String(milestone.nex), placeholder: "250", help: "最多 6 位小数，可以是 0" },
        ],
      },
      run: async (reason, _value, form) => {
        if (!form) throw new Error("EARN_MILESTONE_AMOUNTS_REQUIRED");
        const invalid = issue(form);
        if (invalid) throw new Error(invalid);
        const threshold = decimalText(form.threshold);
        const nex = decimalText(form.nex);
        await mutations.run({ target, action: `收益里程碑 · $${milestone.threshold}`, name: `收益里程碑 · ${milestone.key}`,
          before: `${milestone.threshold} USDT；${milestone.nex} UVT`, after: `${threshold} USDT；${nex} UVT`, success: `${milestone.key} 已更新`,
          reason, snapshot, businessValue: { threshold, nex }, approvalRequired: amplifies(form),
          direct: { path: `/earn-milestones/${encodeURIComponent(milestone.key)}`, body: { thresholdUsd: threshold, rewardNex: nex } },
          proposal: proposal("h5_earn_milestone", { milestoneKey: milestone.key, thresholdUsd: threshold, rewardNex: nex, expectedThresholdUsd: decimalText(milestone.threshold), expectedRewardNex: decimalText(milestone.nex) }),
        });
      },
    });
  };

  const openTick = (original?: H5PendingCommand) => {
    const snapshot = original?.change.snapshot ?? model!;
    const target = "tick:interval";
    const current = String(snapshot.tickInterval.seconds);
    const currentSeconds = current;
    openActionConfirm({ target, original, briefKind: "config",
      action: "收益里程碑触发检查间隔",
      title: "调整收益里程碑检查间隔",
      detail: <>当前 <b>{text(snapshot.tickInterval?.value, current)}</b>。目前没有任何地方按这个间隔检查收益里程碑，保存只改这一项的值。</>,
      effect: <StatusTag tone="progress" filled explain="保存后马上能读回新值。">立即保存</StatusTag>,
      statedBrief: { impact: "只改保存的值，不改变收益里程碑什么时候发：后端没有按这个间隔检查的任务，用户在 App 成就页主动领取。", check: "核对秒数；理由写清依据或工单号。" },
      content: (
        <div className="rd-stack">
          <Notice tone="warn" title="目前不影响收益里程碑">后端没有按这个间隔检查的任务；收益里程碑由用户在 App 成就页主动领取。</Notice>
          <Facts>
            <Fact k="现在">{text(snapshot.tickInterval?.value, current)}</Fact>
            {snapshot.tickInterval?.seconds === 0 && <Fact k="现在的值" tone="warn">0 秒不在 1–60 秒内，是以前存下的值</Fact>}
            <Fact k="谁能改">有检查间隔修改权限的超级管理员</Fact>
          </Facts>
        </div>
      ),
      edit: { kind: "number", label: "秒数（1–60）", current: currentSeconds, min: 1, max: 60 },
      confirmLabel: "确认修改",
      reasonPlaceholder: "例如：工单号或核对依据",
      run: async (reason, value) => {
        if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim()) || Number(value) < 1 || Number(value) > 60) throw new Error("TICK_INTERVAL_OUT_OF_RANGE");
        await mutations.run({ target, action: "收益里程碑触发检查间隔", name: "收益里程碑触发检查间隔", before: snapshot.tickInterval.value, after: `${value} 秒`,
          success: "收益里程碑触发检查间隔已更新", reason, snapshot, editValue: value, approvalRequired: false,
          direct: { path: "/earn-milestones/tick-interval", body: { key: "tick", value } },
        });
      },
    });
  };

  const auditHref = "/platform/audit?domain=H";
  const canAudit = reach("/platform/audit");
  const anyWrite = canRuleWrite || canWrite || canWriteTick;
  const pendingOf = (target: string) => {
    const original = mutations.record(target);
    return original?.ticket?.status === "pending" ? { approver: target.startsWith("rule:") ? RULE_APPROVER : FUND_APPROVER } : undefined;
  };
  const blocked = (target: string) => mutations.record(target) ? "这一项有未结束的原操作，请先查询原结果" : !fresh.current ? "请先成功刷新签到数据" : undefined;
  const restore = (original: H5PendingCommand) => {
    const snapshot = original.change.snapshot;
    const [kind, ...idParts] = original.change.target.split(":");
    const id = idParts.join(":");
    if (kind === "rule") openRule(snapshot.rules.find(item => item.key === id)!, original);
    else if (kind === "streak") openStreak(snapshot.streakMilestones.find(item => item.id === Number(id))!, original);
    else if (kind === "power") openPowerUp(snapshot.powerUps.find(item => item.id === Number(id))!, original);
    else if (kind === "earn") openEarn(snapshot.earnMilestones.find(item => item.key === id)!, original);
    else openTick(original);
  };
  const queryOriginal = async (original: H5PendingCommand) => {
    try {
      const result = await mutations.query(original);
      if (result === null && isRetryExpired(original) && !original.acknowledged && !original.ticket) {
        toast("原申请已过期，查询确认没有这张审批单。原记录继续保留。");
      }
    } catch (err) { toast(displayAdminError(err)); }
  };

  const recoveryRows: H5RecoveryRow[] = mutations.records.filter(record => !record.ticket).map((record) => ({
    key: record.commandKey,
    name: record.change.name,
    change: `${record.change.before} → ${record.change.after}${record.acknowledged ? "；申请已建单，批没批准还没查到" : ""}`,
    submittedAt: record.createdAt,
    tag: isRetryExpired(record) ? expiredTag(record.request.kind) : unknownTag(record.request.kind),
    ticket: record.ticket?.id,
    actions: <>
      <Button size="sm" onClick={() => void queryOriginal(record)}>查询原结果</Button>
      {!isRetryExpired(record) && !record.acknowledged && <Button size="sm" disabledReason={mutations.canRetry(record) ? undefined : "当前账号没有原操作的修改权限"} onClick={() => restore(record)}>按原请求重试</Button>}
    </>,
  }));
  const recovery = (
    <H5RecoveryNotice title={`${recoveryRows.length} 个修改结果未知`} rows={recoveryRows}
      explain={<>
        <p>提交时没收到确定结果，原修改（改的是哪一项、从多少到多少、理由）保存在这个浏览器标签页里。</p>
        <p>先「查询原结果」；查不到、又没过 24 小时，可以「按原请求重试」，后端认得出是同一次提交，不会重复执行或建第二张审批单。过了 24 小时只能查询。</p>
        <p>结果确认之前，这一项不能再提交新的修改。</p>
      </>}
      link={canAudit ? <Link className="rd-link" href={auditHref} prefetch={false}>到操作记录与审批核对</Link> : undefined} />
  );

  const header = (
    <PageHeader
      pageId="H5"
      title="签到与UVT奖励"
      summary="看签到情况和用户签到拿多少，维护签到和奖励规则。"
      meta={readAt ? <span className="rd-toolbar">
        <span>{`${businessClock(readAt)} 读取（${businessZone().label}）· 打开时读取`}</span>
        <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh()}>刷新</Button>
      </span> : undefined}
      readOnly={!anyWrite ? "你只能查看；改签到规则、奖励和里程碑要有这页的修改权限。" : undefined}
    />
  );

  const activeCommand = mc ? mutations.record(mc.target) : undefined;
  const confirmModal = mc && (
    <OperationConfirmModal key={`${mc.target}:${mc.original?.commandKey ?? "new"}`} briefKind={mc.briefKind}
      action={mc.action}
      title={mc.title}
      detail={mc.detail}
      amplifies={mc.amplifies}
      edit={mc.edit && mc.original ? { ...mc.edit, initialValue: mc.original.change.editValue } : mc.edit}
      businessForm={mc.businessForm}
      facts={mc.facts}
      effect={mc.effect}
      content={mc.content}
      initialReason={mc.original?.change.reason}
      getPendingReason={() => mutations.record(mc.target)?.change.reason}
      getPendingBusinessValue={() => mc.original?.change.businessValue ?? mutations.record(mc.target)?.change.businessValue}
      blockedReason={activeCommand && !mutations.canRetry(activeCommand) ? isRetryExpired(activeCommand) ? "已超过 24 小时，只能查询原结果" : activeCommand.acknowledged ? "申请已建单，请查询原结果。" : "当前账号不能重试原操作，请查询原结果" : !mc.original && !mutations.record(mc.target) && !fresh.current ? "请先成功刷新签到数据" : undefined}
      confirmLabelForValue={mc.confirmLabelForValue}
      confirmLabel={mc.target.startsWith("power:") || mc.target.startsWith("earn:") ? approvalLabel ? "提交审批" : mc.confirmLabel : mc.confirmLabel}
      confirmTone={mc.confirmTone}
      statedBrief={mc.statedBrief}
      coverageLead={mc.coverageLead}
      coverageCheck={mc.coverageCheck}
      reasonPlaceholder={mc.reasonPlaceholder}
      onClose={() => setMc(null)}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          const original = mutations.record(mc.target);
          if (original) await mutations.retry(original);
          else if (mc.original) throw new Error("原操作已处理，请刷新后重新操作。");
          else await mc.run(reason, newValue, businessValue);
          setMc(null);
        } catch (err) {
          toast(err instanceof Error ? displayAdminError(err) : "操作失败");
          throw err;
        }
      }}
    />
  );

  if (loading && !model) return <div className="h5-page">{header}{recovery}<BlockState state="loading" title="签到数据读取中…" />{confirmModal}</div>;
  if (error || !model) {
    return (
      <div className="h5-page">
        {header}
        {recovery}
        <BlockState state="error" title="签到数据读取失败" detail={`${error ?? "没有收到数据"} · 读到之前不能修改签到规则和奖励；一直失败请联系值班同事。`} onRetry={() => void refresh()} retrying={loading} />
        {confirmModal}
      </div>
    );
  }

  const stats = model.stats ?? {};
  const coverage = model.coverage ?? {};
  const rules = model.rules;
  const ruleOf = (key: string) => rules.find((rule) => rule.key === key);
  const baseline = ruleOf("baseline");
  const bonus7 = ruleOf("bonus7");
  const p15 = ruleOf("p15");
  const p2 = ruleOf("p2");
  const coverageRatio = coverage.coverageRatio;
  const coverageKnown = coverageRatio != null && coverageRatio !== "";
  const coverageBad = coverage.reliable === false || coverage.redlineBreached === true;
  const distribution = (model.streakDistribution ?? []).map((item) => ({ day: item.day, count: Number(item.count) }));
  const distributionTotal = distribution.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  const topGroup = distribution.reduce<{ day: string; count: number } | null>((best, item) => (!best || item.count > best.count ? item : best), null);
  const weekMsNex = text(stats.weekMsNex, "");
  const weekMsNexAmount = weekMsNex ? amountText(weekMsNex.replace(/\s*UVT\s*$/i, "")) : "—";

  // 签到条：第 1–7 天能领的连签奖励。
  const stripGifts: Record<number, StripMilestone[]> = {};
  for (const milestone of model.streakMilestones) {
    const day = dayNumber(milestone.day);
    if (day !== null && day >= 1 && day <= 7) {
      const view = streakRewardView(milestone.reward, milestone.kind, operatorCopyText);
      (stripGifts[day] ??= []).push({ key: String(milestone.id), text: view.main, legacyName: view.legacyName, kind: String(milestone.kind ?? "").toLowerCase() });
    }
  }
  const legacyCount = model.streakMilestones.filter((milestone) => legacyRewardName(milestone.reward)).length;
  const openTab = (next: Tab) => { setTab(next); tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const multiplierPowerUp = model.powerUps.find((item) => item.effectType === "CHECKIN_MULTIPLIER" && item.businessAvailable !== false);
  const p15Number = Number(p15?.cur);
  const p2Number = Number(p2?.cur);
  const luckyValid = p15 && p2 && p15.cur.trim() !== "" && p2.cur.trim() !== "" && Number.isFinite(p15Number) && Number.isFinite(p2Number) && p15Number >= 0 && p2Number >= 0 && p15Number + p2Number <= 100;
  const plainChance = luckyValid ? Number((100 - p15Number - p2Number).toFixed(6)) : null;

  const conclusion = (() => {
    const signText = stats.todaySign == null ? "今天签到人数读不到" : `今天 ${countText(stats.todaySign)} 人签到，签到率 ${text(stats.signRate, "—")}`;
    const coverageText = !coverageKnown
      ? "兑付覆盖率读不到"
      : coverage.reliable === false
        ? `兑付覆盖率 ${coverageRatio}% 数据不可靠，加奖励、提前解锁这类修改会被拒`
        : coverage.redlineBreached === true
          ? `兑付覆盖率 ${coverageRatio}% 低于红线 ${text(coverage.redlinePct, "—")}%，加奖励、提前解锁这类修改会被拒`
          : `兑付覆盖率 ${coverageRatio}%，高于红线`;
    return (
      <Conclusion state={recoveryRows.length || coverageBad ? "warn" : "neutral"} icon={CalendarCheck}
        explain={<>
          <p>签到人数按业务日期算，同一个人一天只算一次；签到率的分母是有连签记录的人，不是注册总人数。</p>
          <p>兑付覆盖率低于红线或不可靠时，会让平台多付的修改（加奖励、调高概率、提前解锁、降门槛）提交和批准时都会被后端拒绝。</p>
          <p>后端读不到统计时也会返回 0，这页暂时分不出「真的是 0」和「没读到」。</p>
        </>}
        action={canAudit ? <Link className="rd-link" href={auditHref} prefetch={false}>看待批准的申请</Link> : undefined}>
        {`${signText}；${coverageText}`}
        {recoveryRows.length > 0 && `；${recoveryRows.length} 个修改结果未知，先查询原结果`}
      </Conclusion>
    );
  })();

  const ruleRow = (rule: CheckInRule) => {
    const copy = RULE_COPY[rule.key];
    const name = operatorCopyText(rule.name);
    const pending = pendingOf(`rule:${rule.key}`);
    const fixed = !!copy?.fixed;
    const strip = STRIP_RULE_KEYS.has(rule.key);
    const bad = strip && !positiveInteger(text(rule.cur, ""));
    return (
      <ConfigRow key={rule.key} name={name}
        what={copy?.what ?? (rule.sub ? operatorCopyText(rule.sub) : undefined)}
        when={fixed ? undefined : `提交审批，${RULE_APPROVER}批准后生效；批准前仍按现在的值`}
        effect={copy?.effect}
        note={bad ? "App 只发正整数，现在这个值会让用户签到失败；改成正整数。" : undefined}
        value={<span className="h5-value">
          <span className="h5-value-num" data-empty={text(rule.cur, "") === "" && !fixed ? "" : undefined}>{ruleValueText(rule)}</span>
          {fixed && <StatusTag tone="neutral" icon={Lock}>固定</StatusTag>}
          {bad && <StatusTag tone="warn" icon={AlertTriangle} explain="App 只发正整数，现在这个值会让用户签到失败。">不是正整数</StatusTag>}
          {pending && pendingTag(pending.approver)}
          {!fixed && <span className="h5-dir">改动都要批准</span>}
        </span>}
        action={!fixed && canRuleWrite ? (describedBy) => (
          <Button size="sm" aria-describedby={describedBy} aria-label={`调整 ${name}`} disabledReason={blocked(`rule:${rule.key}`)} onClick={() => openRule(rule)}>调整</Button>
        ) : undefined} />
    );
  };

  const signRules = rules.filter((rule) => !IDLE_RULE_KEYS.has(rule.key));
  const idleRules = rules.filter((rule) => IDLE_RULE_KEYS.has(rule.key));
  const tickSeconds = model.tickInterval?.seconds;

  const panes: Record<Tab, ReactNode> = {
    rules: (
      <Panel title="签到规则" icon={CalendarCheck} tone="role-4"
        sub={`${signRules.length} 项`}
        explain="每天签到给多少、抽倍率的机会多大。改动都要提交审批，另一位管理员批准后才生效；批准前仍按现在的值发。">
        {signRules.length
          ? <ConfigList label="签到规则">{signRules.map(ruleRow)}</ConfigList>
          : <BlockState state="empty" title="没有读到签到规则" detail="也可能是读取失败，这页分不出来。" />}
      </Panel>
    ),
    streak: (
      <Panel title="连签奖励" icon={Gift} tone="role-4"
        sub={`${model.streakMilestones.length} 档 · 用户在 App 领取`}
        explain={<>
          <p>连签到这一天，用户可以在 App 签到页领取这份奖励；领取不是自动的，这页也不代领、不直接发奖。</p>
          <p>改奖励只改之后的领取：还没领的人领到新奖励，已经领过的不补不退。</p>
          <p>数量变多或换成别的资金、转盘票要{FUND_APPROVER}批准；变少、不变、改成徽章立即生效。</p>
        </>}>
        {model.streakMilestones.length
          ? <MilestoneTrack label="连签奖励，按天数先后" nodes={model.streakMilestones.map((milestone) => {
            const pending = pendingOf(`streak:${milestone.id}`);
            const kind = String(milestone.kind ?? "").toLowerCase();
            const view = streakRewardView(milestone.reward, milestone.kind, operatorCopyText);
            return {
              key: String(milestone.id),
              day: milestone.day,
              kind,
              reward: <>{view.main}{view.legacyName && <span className="h5-track-legacy">{`名称 ${view.legacyName}`}</span>}</>,
              tags: <>
                {!view.legacyName && <span className="h5-kind">{rewardKindText(milestone.kind)}</span>}
                {view.legacyName && <StatusTag tone="warn" icon={AlertTriangle} explain="后端存的名称还是旧写法（NEX、积分这类）。种类和数量按后端记的算，这一档照常能领；App 按种类和数量显示，不显示这个名称。改奖励时写成 UVT、USDT 或转盘票的新写法。">旧名称</StatusTag>}
                {pending && pendingTag(pending.approver)}
              </>,
              action: canWrite ? <Button size="sm" icon={<Pencil size={14} aria-hidden />} aria-label={`修改连签 ${milestone.day}奖励`}
                disabledReason={blocked(`streak:${milestone.id}`)} onClick={() => openStreak(milestone)}>改奖励</Button> : undefined,
            };
          })} />
          : <BlockState state="empty" title="还没有连签奖励" detail="也可能是读取失败，这页分不出来。" />}
        <ChartLegend items={[
          { key: "fund", slot: 4, label: "UVT、USDT、转盘票：数量变多要批准" },
          { key: "badge", slot: "other", label: "徽章：只能改文字，立即生效" },
        ]} />
      </Panel>
    ),
    power: (
      <Panel title="成长权益" icon={Sparkles} tone="role-4"
        sub={`${model.powerUps.length} 档 · 用户在 App 激活`}
        explain={<>
          <p>连签到这一天解锁，用户在 App 签到页自己激活；签到加成激活后，之后每天的签到奖励再乘它，断签后失效。</p>
          <p>提前解锁、调高倍率要{FUND_APPROVER}批准；推后、调低、只改说明文字立即生效。已经激活的权益不收回，改倍率后已激活的人之后也按新倍率。</p>
          <p>指向的业务停用后这一档只读：App 里显示已停用、不能激活，已获得的记录保留。</p>
        </>}>
        {model.powerUps.length
          ? <StepBar label="成长权益，按解锁天数" unit="天" items={model.powerUps.map((powerUp) => {
            const retired = powerUp.businessAvailable === false;
            const unknown = powerUp.businessAvailable == null && (powerUp.downstream === "/wallet/staking" || powerUp.downstream === "/market/genesis");
            const multiplier = powerUp.effectType === "CHECKIN_MULTIPLIER";
            const pending = pendingOf(`power:${powerUp.id}`);
            return {
              key: String(powerUp.id),
              label: operatorCopyText(powerUp.label),
              name: multiplier ? `签到奖励 ×${text(powerUp.note, "—")}` : `前往${rewardDestination(powerUp.downstream)}`,
              value: Number(powerUp.day),
              valueText: countText(powerUp.day),
              secondary: retired ? "用不了，已获得的保留"
                : unknown ? "暂时确认不了能不能用"
                : multiplier ? "激活后生效" : "解锁后可进入",
              mark: retired ? "业务已停用" : unknown ? "状态未知" : pending ? "待审批" : undefined,
              actions: canWrite && !retired
                ? <Button size="sm" icon={<Pencil size={14} aria-hidden />} aria-label={`调整成长奖励 ${operatorCopyText(powerUp.label)}（${powerUp.day} 天）`}
                  disabledReason={blocked(`power:${powerUp.id}`)} onClick={() => openPowerUp(powerUp)}>调整</Button>
                : canWrite && retired ? <span className="h5-readonly">只读</span> : undefined,
            };
          })} />
          : <BlockState state="empty" title="还没有成长权益" detail="也可能是读取失败，这页分不出来。" />}
      </Panel>
    ),
    earn: (
      <Panel title="收益里程碑" icon={Trophy} tone="role-4"
        sub={`${model.earnMilestones.length} 档 · 门槛是累计 USDT 收益`}
        explain={<>
          <p>用户累计到账的 USDT 收益满门槛，可以在 App 成就页领取这一档的 UVT 奖励，一次领一档；不是到了就自动发。</p>
          <p>降门槛、加奖励要{FUND_APPROVER}批准；提高门槛、减奖励立即生效。门槛要从小到大，已经达成的不重发、不追发；奖励是 0 的档达成后不发 UVT。</p>
        </>}>
        {model.earnMilestones.length
          ? <StepBar label="收益里程碑，按门槛从小到大" unit="USDT" items={model.earnMilestones.map((milestone) => {
            const pending = pendingOf(`earn:${milestone.key}`);
            return {
              key: milestone.key,
              label: milestone.key,
              name: `奖励 ${amountText(milestone.nex)} UVT`,
              value: Number(milestone.threshold),
              valueText: amountText(milestone.threshold),
              secondary: `近 7 天达成 ${milestone.weekTrigger == null ? "—" : `${countText(milestone.weekTrigger)} 次`}`,
              mark: pending ? "待审批" : undefined,
              actions: canWrite ? <Button size="sm" icon={<Pencil size={14} aria-hidden />} aria-label={`调整收益里程碑 ${milestone.key}`}
                disabledReason={blocked(`earn:${milestone.key}`)} onClick={() => openEarn(milestone)}>调整</Button> : undefined,
            };
          })} />
          : <BlockState state="empty" title="还没有收益里程碑" detail="也可能是读取失败，这页分不出来。" />}
      </Panel>
    ),
    idle: (
      <Panel title="目前不生效的参数" icon={CircleSlash} tone="role-other"
        sub={`${idleRules.length + 1} 项 · 能保存，后端没有地方用`}
        explain="这几项能保存、能读回，但后端没有地方按它们判断，改了不改变签到和发奖。已提给后端接上或退役；在那之前保留入口，方便核对现在存的值。">
        <ConfigList label="目前不生效的参数">
          {idleRules.map((rule) => {
            const copy = RULE_COPY[rule.key];
            const name = operatorCopyText(rule.name);
            return (
              <ConfigRow key={rule.key} name={name}
                what={copy?.what ?? (rule.sub ? operatorCopyText(rule.sub) : undefined)}
                when={`提交审批，${RULE_APPROVER}批准后保存`}
                effect={copy?.effect}
                value={<span className="h5-value">
                  <span className="h5-value-num">{ruleValueText(rule)}</span>
                  <StatusTag tone="neutral" icon={CircleSlash}>目前不影响签到</StatusTag>
                </span>}
                action={canRuleWrite ? (describedBy) => <Button size="sm" aria-describedby={describedBy} aria-label={`调整 ${name}`} disabledReason={blocked(`rule:${rule.key}`)} onClick={() => openRule(rule)}>调整</Button> : undefined} />
            );
          })}
          <ConfigRow name="收益里程碑检查间隔"
            what="原来设计成系统每隔几秒检查谁达到了收益里程碑"
            when="立即保存，马上能读回"
            effect="目前不影响收益里程碑：后端没有按这个间隔检查的任务，用户在 App 成就页主动领取。"
            note={tickSeconds === 0 ? "现在存的 0 秒不在 1–60 秒内，是以前存下的值。" : undefined}
            value={<span className="h5-value">
              <span className="h5-value-num">{text(model.tickInterval?.value, "—")}</span>
              {tickSeconds === 0 && <StatusTag tone="warn" icon={AlertTriangle} explain="现在存的 0 秒不在 1–60 秒内，是以前存下的值。">不在范围内</StatusTag>}
              <StatusTag tone="neutral" icon={CircleSlash}>目前不影响收益里程碑</StatusTag>
            </span>}
            action={canWrite || canRuleWrite || canWriteTick ? (describedBy) => <Button size="sm" aria-describedby={describedBy} aria-label="调整 收益里程碑检查间隔"
              disabledReason={canWriteTick ? blocked("tick:interval") : "仅超级管理员可调整检查间隔，还要有检查间隔修改权限"} onClick={() => openTick()}>调整</Button> : undefined} />
        </ConfigList>
      </Panel>
    ),
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "rules", label: "签到规则" },
    { value: "streak", label: "连签奖励" },
    { value: "power", label: "成长权益" },
    { value: "earn", label: "收益里程碑" },
    { value: "idle", label: "目前不生效" },
  ];

  return (
    <div className="h5-page">
      {header}
      {recovery}
      {conclusion}

      <StatBand label="签到概况">
        <Stat lead tone="role-3" icon={Users} label="今日签到" value={stats.todaySign == null ? "—" : countText(stats.todaySign)} unit="人"
          sub={`签到率 ${text(stats.signRate, "—")}`}
          explain="今天（业务日期）签到的人数，同一个人一天只算一次。签到率的分母是有连签记录的人，不是注册总人数；读不到时后端也返回 0。" />
        <Stat tone="role-4" icon={Dices} label="今天抽中加倍" value={text(stats.lucky15Actual, "—")}
          sub={`2 倍 ${text(stats.lucky2Actual, "—")} · 设置 ${text(stats.lucky15Config, "—")} + ${text(stats.lucky2Config, "—")}`}
          explain={<>
            <p>今天的签到里抽中 1.5 倍及以上的占比，包括抽中 2 倍的；后面是其中抽中 2 倍的占比。</p>
            <p>设置的 1.5 倍和 2 倍是分开抽的，所以要拿「抽中加倍」和两档设置加起来比。</p>
          </>} />
        <Stat tone="role-2" icon={Trophy} label="近 7 天收益里程碑" value={stats.weekMsTrigger == null ? "—" : countText(stats.weekMsTrigger)} unit="次"
          sub={`奖励 ${weekMsNexAmount} UVT`}
          explain="最近 7 天（往前滚 7 天，不是自然周）达成收益里程碑的记录数和奖励 UVT 合计；不是连签奖励。" />
        <Stat tone={!coverageKnown ? undefined : coverageBad ? "danger" : "ok"} icon={ShieldCheck} label="兑付覆盖率"
          value={coverageKnown ? String(coverageRatio) : "—"} unit={coverageKnown ? "%" : undefined}
          sub={`红线 ${text(coverage.redlinePct, "—")}%${coverage.reliable === false ? " · 数据不可靠" : ""}`}
          explain="平台能兑付的钱和要付的钱之比。加奖励、调高概率、提前解锁、降门槛这类会让平台多付的修改，后端会检查它不低于红线。" />
      </StatBand>

      <div className="rd-split">
        <Panel title="签到 7 天拿多少" icon={CalendarCheck} tone="role-4"
          sub={`基础 ${ruleValueText(baseline ?? { key: "baseline", name: "", cur: "" })} · 每满 7 天另加 ${ruleValueText(bonus7 ?? { key: "bonus7", name: "", cur: "" })}`}
          explain={<>
            <p>一个用户连签一周，每天签到拿到的 UVT。签到时基础奖励先按幸运倍率乘一次（向下取整），连签每满 7 天那次再加连续7天奖励。</p>
            <p>{multiplierPowerUp ? `连签满 ${multiplierPowerUp.day} 天的人激活签到加成后，整笔再乘 ${text(multiplierPowerUp.note, "—")}。` : "激活签到加成的人，整笔再乘加成倍率。"}</p>
            <p>格子上的礼物是连签到那天能领的连签奖励，要用户在 App 里自己领。</p>
          </>}
          actions={<Button variant="ghost" size="sm" onClick={() => openTab("rules")}>看签到规则</Button>}>
          <div className="h5-strip-block">
            <CheckInStrip
              base={text(baseline?.cur, "—")} baseOk={!baseline || positiveInteger(text(baseline.cur, ""))}
              bonus={text(bonus7?.cur, "—")} bonusOk={!bonus7 || positiveInteger(text(bonus7.cur, ""))}
              milestones={stripGifts} />
            <div className="h5-lucky">
              <span className="h5-lucky-title">每次签到抽倍率</span>
              {luckyValid && plainChance !== null
                ? <SegmentBar label="每次签到抽中各倍率的机会" segments={[
                  { key: "x1", label: "不加倍", value: plainChance, slot: "other", text: `不加倍 ${plainChance}%` },
                  { key: "x15", label: "1.5 倍", value: p15Number, slot: 2, text: `1.5 倍 ${p15!.cur}%` },
                  { key: "x2", label: "2 倍", value: p2Number, slot: 4, text: `2 倍 ${p2!.cur}%` },
                ]} />
                : <p className="h5-note">{p15 && p2 ? "两档概率读不出或合计超过 100%，不画；到「签到规则」核对。" : "没有读到幸运倍率的设置。"}</p>}
            </div>
            {legacyCount > 0 && <Notice tone="warn" actionBelow action={<Button size="sm" variant="ghost" onClick={() => openTab("streak")}>去连签奖励改</Button>}>
              {`有 ${legacyCount} 档连签奖励的名称还是旧写法（NEX）；App 按种类和数量显示，不显示名称。`}
            </Notice>}
          </div>
        </Panel>

        <Panel title="连签人数分布" icon={BarChart3} tone="role-3"
          sub={distribution.length ? `${countText(distributionTotal)} 人 · 按连签天数${distribution.length >= 30 ? " · 只列前 30 组" : ""}` : `近 7 天补救记录 ${stats.weekRevive == null ? "—" : `${countText(stats.weekRevive)} 条`}`}
          explain={<>
            <p>每个有连签记录的人按现在记下的连签天数分组。看它能判断大部分人签几天就断了。</p>
            <p>断签的人要等下次签到才从第 1 天重新算，在那之前还算在原来的天数里。最多列 30 组，天数更长的不列。</p>
            <p>近 7 天补救记录是这 7 天里和补救卡有关的权益记录条数，不去重、不等于真的接上连签的人数。</p>
          </>}>
          {distribution.length
            ? <div className="h5-dist">
              <ColumnChart label="连签人数分布" height={160}
                data={distribution.map((item) => ({ key: item.day, tick: item.day, values: [Number.isFinite(item.count) ? item.count : 0] }))}
                series={[{ label: "人数", slot: 3 }]} format={(value) => `${countText(value)} 人`} axisFormat={(value) => countText(value)} />
              <p className="h5-note">{topGroup ? `最多的是连签 ${topGroup.day}，${countText(topGroup.count)} 人` : ""}{` · 近 7 天补救记录 ${stats.weekRevive == null ? "—" : `${countText(stats.weekRevive)} 条`}`}</p>
            </div>
            : <BlockState state="empty" title="还没有人在连签" detail="也可能是读取失败，这页分不出来。" />}
        </Panel>
      </div>

      <div className="h5-rules" ref={tabsRef}>
        <PageTabs label="签到和奖励规则" value={tab} onChange={setTab} ids={tabIds} items={tabs} />
        <div {...tabIds.panel(tab)} className="rd-tab-pane">
          {panes[tab]}
        </div>
      </div>

      {confirmModal}
    </div>
  );
}

export default H5DailyMilestones;
