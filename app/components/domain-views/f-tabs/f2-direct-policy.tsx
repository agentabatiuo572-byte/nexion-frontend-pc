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
import { Fact, Facts, f2Ranked, num, rangeText, type F2Confirm } from "./f2-shared";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
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
  // 设备收益二级比例（F2-RANK-WIRE）：现值读 ctx.f2DeviceLevel2RatePct，没有这个字段时不出这一项；
  // 草稿单独放，不混进 draft（draft 原样交给 updateF2DirectPolicy，请求内容不变）。null = 没改。
  const level2Now = ctx.f2DeviceLevel2RatePct;
  const hasLevel2 = level2Now !== undefined;
  const [level2Draft, setLevel2Draft] = useState<number | null>(null);
  const level2 = level2Draft ?? level2Now ?? NaN;
  const level2Changed = hasLevel2 && level2Draft !== null && level2Draft !== level2Now;
  const ranked = f2Ranked(ctx);
  const range = ranked ? ctx.f2RankPurchaseRange : undefined;
  const canOpenF1 = useAdminAuth((state) => !!state.session && canAccessResolvedPath(resolveVisibleDomains(state.session), "/network/v-rank"));
  const submitted = !!ctx.f2PendingFor("f-direct-referral-policy");
  useEffect(() => { if (!draft && policy) setDraft(draftOf(policy)); }, [draft, policy]);
  const allowed = ctx.can("network_f2_royalty_rate");
  const busy = ctx.f2DirectPolicyLoading;
  const stale = !!draft && !!policy && (draft.expectedVersion !== policy.policyVersion || draft.expectedSevenLayerRevision !== policy.sevenLayerRevision || (ctx.f2SevenLayerRevision !== null && ctx.f2SevenLayerRevision !== policy.sevenLayerRevision));
  const invalid = draft ? validateDirectReferralUpdate(draft) || (draft.purchaseSplit.enabled && (!policy || policy.sevenLayerReference.baseRatePct === null || policy.sevenLayerReference.coolingDays === null) ? "第 1 层比例或购买冷却还没设置，先在上面「每层分多少」「总量和冷却」里配好。" : null)
    || (hasLevel2 && !(Number.isFinite(level2) && level2 >= 0 && level2 <= 100) ? "好友设备收益奖励：二级比例填 0–100%。" : null) : null;
  const changed = !!draft && !!policy && (JSON.stringify(draft.purchaseSplit) !== JSON.stringify(policy.purchaseSplit) || JSON.stringify(draft.deviceEarning) !== JSON.stringify(policy.deviceEarning) || level2Changed);
  const disabled = !!ctx.f2WriteBlocked("f-direct-referral-policy") || !allowed || busy || !!ctx.f2DirectPolicyError || !policy || !draft || stale || !policy.sevenLayerEnabled;
  const reset = async () => {
    const latest = await ctx.refreshF2();
    if (latest) { setDraft(draftOf(latest)); setLevel2Draft(null); }
  };
  const ref = policy?.sevenLayerReference;
  const rows = (before: DirectReferralUpdate | DirectReferralPolicy, after: DirectReferralUpdate, l2After: number): DiffRow[] => [
    { key: "split", label: "好友购买奖励 · 币种拆分", before: onOff(before.purchaseSplit.enabled), after: onOff(after.purchaseSplit.enabled),
      note: before.purchaseSplit.enabled && !after.purchaseSplit.enabled ? `关闭后好友购买奖励改回全额发 USDT，另按旧系数加发 UVT；USDT 占比增加 ${100 - before.purchaseSplit.usdtSharePct} 个百分点。` : undefined },
    { key: "splitUsdt", label: "好友购买奖励 · USDT / UVT", before: `${pct(before.purchaseSplit.usdtSharePct)} / ${pct(100 - before.purchaseSplit.usdtSharePct)}`, after: `${pct(after.purchaseSplit.usdtSharePct)} / ${pct(100 - after.purchaseSplit.usdtSharePct)}` },
    { key: "device", label: "好友设备收益奖励", before: onOff(before.deviceEarning.enabled), after: onOff(after.deviceEarning.enabled) },
    { key: "deviceTotal", label: hasLevel2 ? "好友设备收益奖励 · 一级比例" : "好友设备收益奖励 · 总比例", before: pct(before.deviceEarning.totalRatePct), after: pct(after.deviceEarning.totalRatePct) },
    ...(hasLevel2 ? [{ key: "deviceL2", label: "好友设备收益奖励 · 二级比例", before: pct(level2Now!), after: pct(l2After) }] : []),
    { key: "deviceUsdt", label: "好友设备收益奖励 · USDT / UVT", before: `${pct(before.deviceEarning.usdtSharePct)} / ${pct(100 - before.deviceEarning.usdtSharePct)}`, after: `${pct(after.deviceEarning.usdtSharePct)} / ${pct(100 - after.deviceEarning.usdtSharePct)}` },
    { key: "deviceCool", label: "好友设备收益奖励 · 冷却", before: `${before.deviceEarning.coolingDays} 天`, after: `${after.deviceEarning.coolingDays} 天` },
  ];
  const submit = () => {
    if (disabled || !draft || !policy || invalid || !changed) return;
    const value = structuredClone(draft), reference = policy.sevenLayerReference, l2After = level2;
    const splitChanged = JSON.stringify(value.purchaseSplit) !== JSON.stringify(policy.purchaseSplit);
    const deviceChanged = JSON.stringify(value.deviceEarning) !== JSON.stringify(policy.deviceEarning) || level2Changed;
    const scope = splitChanged && deviceChanged ? "之后发生的购买和设备收益" : splitChanged ? "之后发生的购买" : "之后的设备收益";
    // 二级比例调高也算平台多付钱（F2-RANK-WIRE：逻辑项把它并进 directReferralAmplifies）。
    const amplify = directReferralAmplifies(policy, value) || (level2Changed && value.deviceEarning.enabled && l2After > level2Now!);
    openConfirm({
      slot: "f-direct-referral-policy",
      action: "好友奖励设置整组调整", title: "提交好友奖励政策", briefKind: "config", amplify, icon: "sliders", dialogClassName: "f2-confirm",
      effect: <StatusTag tone="progress" filled icon={Clock3} explain="另一位管理员在「操作记录与审批」批准后，两项一起立即生效；批准前按原政策执行。">批准后两项一起生效</StatusTag>,
      facts: <Facts>
        <Fact k="购买冷却">{reference.coolingDays === null ? "未配置" : `${reference.coolingDays} 天`}</Fact>
        <Fact k="第 1 层另发 UVT">{reference.legacyNexPerUsd === null ? "未配置" : `${num(reference.legacyNexPerUsd)} UVT / 1 USDT`}</Fact>
        {ranked ? <Fact k="好友购买奖励比例">{range ? `一级 ${rangeText(range.l1.min, range.l1.max)}、二级 ${rangeText(range.l2.min, range.l2.max)}，按受益人等级` : "按受益人等级"}</Fact>
          : <Fact k="第 1 层比例">{reference.baseRatePct === null ? "未配置" : `${num(reference.baseRatePct)}%`}</Fact>}
      </Facts>,
      content: <div className="rd-stack">
        <DiffList rows={rows(policy, value, l2After)} restTitle="其余设置" />
        {level2Changed && <p className="f2-diff-note">{`改后：好友的好友的设备每产生 100 USDT 收益，平台另给 ${num(l2After)} USDT 等值，拆法和一级一样。`}</p>}
      </div>,
      statedBrief: { impact: `另一位管理员批准后生效，只算${scope}；批准前按原政策执行，已经算好的不变。${splitChanged ? "开启拆分后第 1 层的好友购买奖励按比例发 USDT 和 UVT，不再另加旧 UVT。" : ""}`, check: "提交前重读一次政策，已被别人改过就不提交；批准时再核对一次，调高方向检查兑付覆盖率。" },
      detail: `修改前：${directReferralSummary(policy)}。修改后：${directReferralSummary(value)}。（政策版本 ${policy.policyVersion}）`,
      completionCopy: "批准人要是另一位管理员，需有审批批准权限和「团队奖励比例」权限；批准前按原政策执行。",
      coverageCheck: "批准时检查兑付覆盖率，低于红线不会执行。", coverageLead: "这次修改会让平台多付好友奖励",
      submit: async (reason) => {
        // F2-RANK-WIRE：二级比例的提交还没接上；改了二级比例时不发请求，免得只交一半。
        if (level2Changed) throw new Error("二级比例的提交还没接上，这次没有保存。");
        await ctx.updateF2DirectPolicy(value, reason);
      },
      done: "好友奖励政策已提交审批，等另一位管理员批准",
    });
  };
  const setRule = <K extends "purchaseSplit" | "deviceEarning">(key: K, patch: Partial<DirectReferralUpdate[K]>) => draft && setDraft({ ...draft, [key]: { ...draft[key], ...patch } });
  const numberOf = (raw: string) => raw === "" ? NaN : Number(raw);
  const lock = disabled || submitted;
  const lockReason = ctx.f2WriteBlocked("f-direct-referral-policy") ?? (!allowed ? "只能查看：改好友奖励政策需有「团队奖励比例」权限"
    : busy ? "正在读取" : ctx.f2DirectPolicyError ? "政策没读到，先刷新" : !policy?.sevenLayerEnabled ? "整体结算启用后才能改"
      : stale ? "政策刚被别人改过，先放弃修改并刷新" : submitted ? "已提交，等另一位管理员批准" : invalid ?? (!changed ? "还没有改动" : undefined));

  const share = (key: "purchaseSplit" | "deviceEarning", label: string) => draft && <>
    <div className="f2-pair">
      <Field label="USDT 占比" help={key === "deviceEarning" ? "开启时大于 0 且小于 100" : "大于 0、小于 100"}>
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
  const f1Link = canOpenF1 ? <Link className="rd-link" href="/network/v-rank" prefetch={false}>去团队等级晋升 →</Link> : null;

  return (
    <Panel id="f2-friend" aria-label="好友奖励设置" title="好友奖励政策" icon={HandCoins} tone="role-2"
      sub={policy ? policy.configured ? <>第 {policy.policyVersion} 版 · 生效于 <time dateTime={policy.effectiveAt!}>{stamp(policy.effectiveAt!)}</time></> : "还没设置" : undefined}
      explain={ranked ? "购买拆分（只影响第 1 层）和设备收益奖励一起提交审批、一起生效。购买奖励的比例按受益人等级，在团队等级晋升设置。"
        : "好友购买奖励怎么拆成 USDT 和 UVT、好友有设备收益时平台另给邀请人多少，这两项是一组：一起提交审批、批准后一起生效。只影响直接邀请的好友（第 1 层），L2–L7 不变。"}>
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
                <div className="f2-mirror">
                  {ranked ? <>
                    <dl className="f2-policy-ref">
                      <div><dt>一级比例</dt><dd aria-label="好友购买奖励一级比例（只读）">{range ? rangeText(range.l1.min, range.l1.max) : "—"}</dd></div>
                      <div><dt>二级比例</dt><dd aria-label="好友购买奖励二级比例（只读）">{range ? rangeText(range.l2.min, range.l2.max) : "—"}</dd></div>
                    </dl>
                    <p className="f2-mirror-note">按受益人的等级取<Explain label="比例按等级取的说明" content="每一级的一级、二级比例在「团队等级晋升」里按级设置，这里只显示九级里最低到最高。受益人每次按自己当时的等级取比例。" />{f1Link}</p>
                  </> : <dl className="f2-policy-ref">
                    <div><dt>第 1 层比例</dt><dd aria-label="好友购买奖励 L1 奖励比例（只读）">{ref?.baseRatePct == null ? "未配置" : `${num(ref.baseRatePct)}%`}</dd></div>
                  </dl>}
                </div>
                <div className="f2-pair">
                  <Field label="币种拆分" explain="开启后第 1 层的好友购买奖励按比例发 USDT 和 UVT，不再另加旧 UVT；关闭后恢复原来的发法。">
                    <Segments label="好友购买奖励拆分启用状态" value={draft.purchaseSplit.enabled ? "enabled" : "disabled"}
                      items={[{ value: "disabled", label: "停用拆分" }, { value: "enabled", label: "启用" }]}
                      onChange={(next) => !lock && setRule("purchaseSplit", { enabled: next === "enabled" })} />
                  </Field>
                  <div className="f2-share-uvt">
                    <span className="f2-share-k">购买冷却<Explain label="购买冷却从哪来" content="在上面「总量和冷却」设置，这里不改。" /></span>
                    <output aria-label="好友购买奖励购买冷却天数（只读）">{ref?.coolingDays == null ? "未配置" : `${ref.coolingDays} 天`}</output>
                  </div>
                </div>
                {draft.purchaseSplit.enabled ? share("purchaseSplit", "好友购买奖励拆分")
                  : <p className="f2-split-off">{Number.isFinite(draft.purchaseSplit.usdtSharePct) ? `USDT 占比 ${num(draft.purchaseSplit.usdtSharePct)}%、UVT 占比 ${num(100 - draft.purchaseSplit.usdtSharePct)}%：启用后按这个比例拆；现在全发 USDT。` : "启用后按填的比例拆；现在全发 USDT。"}</p>}
              </fieldset>
              <fieldset className="f2-policy-card" disabled={lock}>
                <legend><Smartphone size={16} aria-hidden />好友设备收益奖励</legend>
                <p className="f2-policy-hint">{hasLevel2 ? "平台另给一级、二级邀请人，不扣成员自己的收益" : "平台另给邀请人，不扣成员自己的收益"}</p>
                <div className="f2-pair">
                  <Field label="开关">
                    <Segments label="好友设备收益奖励启用状态" value={draft.deviceEarning.enabled ? "enabled" : "disabled"}
                      items={[{ value: "disabled", label: "停用" }, { value: "enabled", label: "启用" }]}
                      onChange={(next) => !lock && setRule("deviceEarning", { enabled: next === "enabled" })} />
                  </Field>
                  <Field label="冷却天数" help="0–365 的整数">
                    <NumberInput aria-label="好友设备收益奖励冷却天数" unit="天" min={0} max={365} step={1} disabled={lock}
                      value={Number.isFinite(draft.deviceEarning.coolingDays) ? draft.deviceEarning.coolingDays : ""} onChange={(event) => setRule("deviceEarning", { coolingDays: numberOf(event.target.value) })} />
                  </Field>
                </div>
                <div className="f2-pair">
                  <Field label={hasLevel2 ? "一级比例" : "总奖励比例"} help={hasLevel2 ? "0–100%" : "0–100%，开启时大于 0"}
                    explain={hasLevel2 ? "好友的设备每产生一笔收益，按这个比例给邀请人；开启时要大于 0。原来叫「总奖励比例」。" : undefined}>
                    <NumberInput aria-label={hasLevel2 ? "好友设备收益奖励一级比例 (%)" : "好友设备收益奖励总奖励比例 (%)"} unit="%" min={0} max={100} step={0.01} disabled={lock}
                      value={Number.isFinite(draft.deviceEarning.totalRatePct) ? draft.deviceEarning.totalRatePct : ""} onChange={(event) => setRule("deviceEarning", { totalRatePct: numberOf(event.target.value) })} />
                  </Field>
                  {hasLevel2 && <Field label="二级比例" help="0–100%" explain="好友的好友的设备每产生一笔收益，按这个比例给邀请人的邀请人。调高算平台多付钱，批准时检查兑付覆盖率。">
                    <NumberInput aria-label="好友设备收益奖励二级比例 (%)" unit="%" min={0} max={100} step={0.01} disabled={lock}
                      value={Number.isFinite(level2) ? level2 : ""} onChange={(event) => setLevel2Draft(numberOf(event.target.value))} />
                  </Field>}
                </div>
                {share("deviceEarning", "好友设备收益奖励")}
              </fieldset>
            </div>}
            <div className="rd-toolbar f2-policy-bar" data-end="">
              {draft && invalid && <span className="rd-toolbar-note" data-tone="warn">{invalid}</span>}
              <span className="f2-actions">
                {draft && policy && <Button disabled={busy} onClick={() => void reset()}>放弃修改并刷新</Button>}
                {allowed && <Button variant="primary" disabledReason={lockReason} onClick={submit}>提交审批</Button>}
              </span>
            </div>
          </>}
    </Panel>
  );
}
