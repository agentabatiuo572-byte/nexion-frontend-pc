"use client";

/**
 * F2 好友奖励政策：好友购买奖励的币种拆分和好友设备收益奖励是一组，一起提交审批、一起生效。
 * 草稿只在内存；放弃修改并刷新成功才重填。提交前重读政策核对两个版本，逻辑照旧。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, HandCoins, ShoppingCart, Smartphone } from "lucide-react";
import { BlockState, Button, DiffList, Explain, Field, Notice, NumberInput, Panel, RatioBar, Segments, StatusTag, type DiffRow } from "@/app/components/rd";
import { directReferralAmplifies, directReferralSummary, validateDirectReferralUpdate, type DirectReferralPolicy, type DirectReferralUpdate } from "@/lib/admin/direct-referral-policy";
import { Fact, Facts, num, type F2Confirm } from "./f2-shared";
import { stamp } from "./f2-shared";
import type { FViewCtx } from "./types";
import "./f2-direct-policy.css";

const draftOf = (policy: DirectReferralPolicy): DirectReferralUpdate => ({
  schemaVersion: 2, expectedVersion: policy.policyVersion, expectedSevenLayerRevision: policy.sevenLayerRevision,
  purchaseSplit: { ...policy.purchaseSplit }, deviceEarning: { ...policy.deviceEarning },
});

const pct = (value: number) => Number.isFinite(value) ? `${num(value)}%` : "未填";
const onOff = (on: boolean, off = "停用") => on ? "启用" : off;

export function F2DirectPolicy({ ctx, openConfirm }: { ctx: FViewCtx; openConfirm: (spec: F2Confirm) => void }) {
  const policy = ctx.f2DirectPolicy;
  const [draft, setDraft] = useState<DirectReferralUpdate | null>(() => policy ? draftOf(policy) : null);
  const submitted = !!ctx.f2PendingFor("f-direct-referral-policy");
  useEffect(() => { if (!draft && policy) setDraft(draftOf(policy)); }, [draft, policy]);
  const allowed = ctx.can("network_f2_royalty_rate");
  const busy = ctx.f2DirectPolicyLoading;
  const stale = !!draft && !!policy && (draft.expectedVersion !== policy.policyVersion || draft.expectedSevenLayerRevision !== policy.sevenLayerRevision || (ctx.f2SevenLayerRevision !== null && ctx.f2SevenLayerRevision !== policy.sevenLayerRevision));
  const invalid = draft ? validateDirectReferralUpdate(draft) || (draft.purchaseSplit.enabled && (!policy || policy.sevenLayerReference.baseRatePct === null || policy.sevenLayerReference.coolingDays === null) ? "第 1 层比例或购买冷却还没设置，先在上面「每层分多少」「总量和冷却」里配好。" : null) : null;
  const changed = !!draft && !!policy && (JSON.stringify(draft.purchaseSplit) !== JSON.stringify(policy.purchaseSplit) || JSON.stringify(draft.deviceEarning) !== JSON.stringify(policy.deviceEarning));
  const disabled = !!ctx.f2WriteBlocked("f-direct-referral-policy") || !allowed || busy || !!ctx.f2DirectPolicyError || !policy || !draft || stale || !policy.sevenLayerEnabled;
  const reset = async () => {
    const latest = await ctx.refreshF2();
    if (latest) { setDraft(draftOf(latest)); }
  };
  const ref = policy?.sevenLayerReference;
  const rows = (before: DirectReferralUpdate | DirectReferralPolicy, after: DirectReferralUpdate): DiffRow[] => [
    { key: "split", label: "好友购买奖励 · 币种拆分", before: onOff(before.purchaseSplit.enabled), after: onOff(after.purchaseSplit.enabled),
      note: before.purchaseSplit.enabled && !after.purchaseSplit.enabled ? `关闭后好友购买奖励改回全额发 USDT，另按旧系数加发 UVT；USDT 占比增加 ${100 - before.purchaseSplit.usdtSharePct} 个百分点。` : undefined },
    { key: "splitUsdt", label: "好友购买奖励 · USDT / UVT", before: `${pct(before.purchaseSplit.usdtSharePct)} / ${pct(100 - before.purchaseSplit.usdtSharePct)}`, after: `${pct(after.purchaseSplit.usdtSharePct)} / ${pct(100 - after.purchaseSplit.usdtSharePct)}` },
    { key: "device", label: "好友设备收益奖励", before: onOff(before.deviceEarning.enabled), after: onOff(after.deviceEarning.enabled) },
    { key: "deviceTotal", label: "好友设备收益奖励 · 总比例", before: pct(before.deviceEarning.totalRatePct), after: pct(after.deviceEarning.totalRatePct) },
    { key: "deviceUsdt", label: "好友设备收益奖励 · USDT / UVT", before: `${pct(before.deviceEarning.usdtSharePct)} / ${pct(100 - before.deviceEarning.usdtSharePct)}`, after: `${pct(after.deviceEarning.usdtSharePct)} / ${pct(100 - after.deviceEarning.usdtSharePct)}` },
    { key: "deviceCool", label: "好友设备收益奖励 · 冷却", before: `${before.deviceEarning.coolingDays} 天`, after: `${after.deviceEarning.coolingDays} 天` },
  ];
  const submit = () => {
    if (disabled || !draft || !policy || invalid || !changed) return;
    const value = structuredClone(draft), reference = policy.sevenLayerReference;
    openConfirm({
      slot: "f-direct-referral-policy",
      action: "好友奖励设置整组调整", title: "提交好友奖励政策", briefKind: "config", amplify: directReferralAmplifies(policy, value),
      effect: <StatusTag tone="progress" filled explain="另一位管理员在「操作记录与审批」批准后，两项一起立即生效；批准前按原政策执行。">批准后两项一起生效</StatusTag>,
      facts: <Facts>
        <Fact k="第 1 层比例">{reference.baseRatePct === null ? "未配置" : `${num(reference.baseRatePct)}%（来自七层，这里不改）`}</Fact>
        <Fact k="购买冷却">{reference.coolingDays === null ? "未配置" : `${reference.coolingDays} 天（来自七层，这里不改）`}</Fact>
        <Fact k="旧 UVT 系数">{reference.legacyNexPerUsd === null ? "未配置" : `${num(reference.legacyNexPerUsd)} UVT / 1 USDT`}</Fact>
      </Facts>,
      content: <DiffList rows={rows(policy, value)} restTitle="没改的项" />,
      statedBrief: { impact: "批准后两项一起生效，只对之后发生的购买和设备收益算；已经算好的不变。开启拆分后好友购买奖励按比例发 USDT 和 UVT，不再另加旧 UVT；只影响第 1 层。设备奖励由平台另付，不扣成员自己的收益。", check: "提交前重读一次政策，版本变了就不提交；批准时后端再核对版本，调高方向检查兑付覆盖率。" },
      detail: `修改前：${directReferralSummary(policy)}。修改后：${directReferralSummary(value)}。（政策版本 ${policy.policyVersion}）`,
      completionCopy: "批准人要是另一位管理员，需有审批批准权限和「团队奖励比例」权限；批准前按原政策执行。",
      coverageCheck: "批准时后端检查兑付覆盖率，低于红线不会执行。", coverageLead: "这次修改会让平台多付好友奖励",
      submit: async (reason) => { await ctx.updateF2DirectPolicy(value, reason); },
      done: "好友奖励政策已提交审批，等另一位管理员批准",
    });
  };
  const setRule = <K extends "purchaseSplit" | "deviceEarning">(key: K, patch: Partial<DirectReferralUpdate[K]>) => draft && setDraft({ ...draft, [key]: { ...draft[key], ...patch } });
  const numberOf = (raw: string) => raw === "" ? NaN : Number(raw);
  const lock = disabled || submitted;
  const lockReason = ctx.f2WriteBlocked("f-direct-referral-policy") ?? (!allowed ? "只能查看：改好友奖励政策需有「团队奖励比例」权限"
    : busy ? "正在读取" : ctx.f2DirectPolicyError ? "政策没读到，先刷新" : !policy?.sevenLayerEnabled ? "整体结算启用后才能改"
      : stale ? "政策刚被别人改过，先放弃修改并刷新" : submitted ? "已提交，等另一位管理员批准" : invalid ?? (!changed ? "还没有改动" : undefined));

  const split = (key: "purchaseSplit" | "deviceEarning", label: string) => draft && <>
    <Field label="币种拆分" explain={key === "purchaseSplit" ? "开启后好友购买奖励按比例发 USDT 和 UVT，不再另加旧 UVT；关闭后恢复原来的发法。" : undefined}>
      <Segments label={label + "启用状态"} value={draft[key].enabled ? "enabled" : "disabled"}
        items={[{ value: "disabled", label: key === "purchaseSplit" ? "停用拆分" : "停用" }, { value: "enabled", label: "启用" }]}
        onChange={(next) => !lock && setRule(key, { enabled: next === "enabled" })} />
    </Field>
    <div className="f2-share">
      <Field label="USDT 占比" hint="开启时大于 0 且小于 100">
        <NumberInput aria-label={label + "USDT 占比 (%)"} unit="%" min={0} max={100} step={0.01} disabled={lock}
          value={Number.isFinite(draft[key].usdtSharePct) ? draft[key].usdtSharePct : ""} onChange={(event) => setRule(key, { usdtSharePct: numberOf(event.target.value) })} />
      </Field>
      <div className="f2-share-uvt">
        <span className="f2-share-k">UVT 占比<Explain label="UVT 占比怎么算" content="自动算：100% 减 USDT 占比，不单独提交。" /></span>
        <output aria-label={label + "UVT 占比（只读）"}>{Number.isFinite(draft[key].usdtSharePct) ? `${num(100 - draft[key].usdtSharePct)}%` : "待填写"}</output>
      </div>
    </div>
    {Number.isFinite(draft[key].usdtSharePct) && draft[key].usdtSharePct >= 0 && draft[key].usdtSharePct <= 100 &&
      <RatioBar label={`${label}币种比例`} value={draft[key].usdtSharePct} total={100} tone="role-2" valueText={`USDT ${num(draft[key].usdtSharePct)}%，UVT ${num(100 - draft[key].usdtSharePct)}%`} quiet />}
  </>;

  return (
    <Panel id="f2-friend" aria-label="好友奖励设置" title="好友奖励政策" icon={HandCoins} tone="role-2"
      sub={policy ? policy.configured ? <>第 {policy.policyVersion} 版 · 生效于 <time dateTime={policy.effectiveAt!}>{stamp(policy.effectiveAt!)}</time></> : "还没设置" : undefined}
      explain="好友购买奖励怎么拆成 USDT 和 UVT、好友有设备收益时平台另给邀请人多少，这两项是一组：一起提交审批、批准后一起生效。只影响直接邀请的好友（第 1 层），L2–L7 不变。">
      {busy && !draft ? <BlockState state="loading" title="好友奖励政策读取中" />
        : ctx.f2DirectPolicyError && !draft ? <BlockState state="error" title="好友奖励政策没读到，这部分没有判断" detail={ctx.f2DirectPolicyError} onRetry={() => void ctx.refreshF2()} />
          : <>
            <div className="f2-policy-notes">
              {ctx.f2DirectPolicyError && <Notice tone="danger" title="好友奖励政策没读到">{ctx.f2DirectPolicyError} 已填的内容还在，可以刷新重试。</Notice>}
              {!allowed && <Notice tone="neutral" title="只能查看">改好友奖励政策需有「团队奖励比例」权限。</Notice>}
              {policy && !policy.sevenLayerEnabled && <Notice tone="neutral" title="整体结算启用后才能改">现在只能查看；启用后刷新页面即可修改。</Notice>}
              {policy && !policy.configured && <Notice tone="neutral" title="还没设置">下面的数字是默认占位，不代表正在生效；好友购买奖励现在不拆分，按第 1 层的 UVT 系数仍可能另发 UVT。</Notice>}
              {policy?.nexUsdtPrice === null && <Notice tone="warn" title="UVT 价格读不到">开了拆分的奖励，USDT 和 UVT 会一起等价格恢复后再算，不会先发 USDT。</Notice>}
              {stale && <Notice tone="warn" title="政策刚被别人改过">你填的内容还在。点「放弃修改并刷新」读最新的政策后重新填写。</Notice>}
              {submitted && <Notice tone="warn" title={<>已提交，等另一位管理员批准<StatusTag tone="warn" icon={Clock3}>待审批</StatusTag></>}
                action={ctx.can("platform_a2_read") ? <Link className="rd-link" href="/platform/audit">去操作记录与审批查看</Link> : undefined}>
                批准前仍按原政策执行，批准后点页头「刷新」看新政策。这组在批准前锁住。
              </Notice>}
            </div>
            {draft && <div className="f2-policy-cards">
              <fieldset className="f2-policy-card" disabled={lock}>
                <legend><ShoppingCart size={16} aria-hidden />好友购买奖励</legend>
                {policy && !policy.purchaseSplitConfigured && <p className="f2-policy-hint">还没设置拆分，旧系数仍可能另发 UVT</p>}
                <dl className="f2-policy-ref">
                  <div><dt>第 1 层比例</dt><dd aria-label="好友购买奖励 L1 奖励比例（只读）">{ref?.baseRatePct == null ? "未配置" : `${num(ref.baseRatePct)}%`}</dd></div>
                  <div><dt>购买冷却</dt><dd aria-label="好友购买奖励购买冷却天数（只读）">{ref?.coolingDays == null ? "未配置" : `${ref.coolingDays} 天`}</dd></div>
                </dl>
                {split("purchaseSplit", "好友购买奖励拆分")}
              </fieldset>
              <fieldset className="f2-policy-card" disabled={lock}>
                <legend><Smartphone size={16} aria-hidden />好友设备收益奖励</legend>
                <p className="f2-policy-hint">平台另给邀请人，不扣成员自己的收益</p>
                <Field label="开关">
                  <Segments label="好友设备收益奖励启用状态" value={draft.deviceEarning.enabled ? "enabled" : "disabled"}
                    items={[{ value: "disabled", label: "停用" }, { value: "enabled", label: "启用" }]}
                    onChange={(next) => !lock && setRule("deviceEarning", { enabled: next === "enabled" })} />
                </Field>
                <div className="f2-share">
                  <Field label="总奖励比例" hint="0–100%，开启时大于 0">
                    <NumberInput aria-label="好友设备收益奖励总奖励比例 (%)" unit="%" min={0} max={100} step={0.01} disabled={lock}
                      value={Number.isFinite(draft.deviceEarning.totalRatePct) ? draft.deviceEarning.totalRatePct : ""} onChange={(event) => setRule("deviceEarning", { totalRatePct: numberOf(event.target.value) })} />
                  </Field>
                  <Field label="冷却天数" hint="0–365 的整数">
                    <NumberInput aria-label="好友设备收益奖励冷却天数" unit="天" min={0} max={365} step={1} disabled={lock}
                      value={Number.isFinite(draft.deviceEarning.coolingDays) ? draft.deviceEarning.coolingDays : ""} onChange={(event) => setRule("deviceEarning", { coolingDays: numberOf(event.target.value) })} />
                  </Field>
                </div>
                {split("deviceEarning", "好友设备收益奖励")}
              </fieldset>
            </div>}
            <div className="rd-toolbar f2-policy-bar" data-end="">
              <span className="rd-toolbar-note" data-tone={draft && invalid ? "warn" : undefined}>
                {draft && invalid ? invalid : changed ? `改了 ${rows(policy!, draft!).filter((row) => row.before !== row.after).length} 项，两项一起提交` : "两项一起提交，批准后一起生效"}
              </span>
              <span className="f2-actions">
                {draft && policy && <Button disabled={busy} onClick={() => void reset()}>放弃修改并刷新</Button>}
                {allowed && <Button variant="primary" disabledReason={lockReason} onClick={submit}>提交审批</Button>}
              </span>
            </div>
          </>}
    </Panel>
  );
}
