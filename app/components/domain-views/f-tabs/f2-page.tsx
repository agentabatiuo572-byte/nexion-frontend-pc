"use client";

/**
 * F2 团队奖励设置（改版，RdPage）。首屏回答：整体结算开着没有、一笔订单的钱怎么一层层分上去、
 * 每一层现在分多少、改哪一项会让平台多付钱。分组按运营的问题排：每层分多少、谁能拿到、总量和冷却、
 * 好友奖励政策、合作伙伴权益，旧档位和旧参数收起。所有修改都是提交审批，另一位管理员批准后才生效。
 * 读取、提交、结果未知的保存和恢复都走外壳 f-view 原来的函数，这里只排界面。
 */
import { useState } from "react";
import { Archive, CircleHelp, Coins, PauseCircle, Power, PowerOff, Users } from "lucide-react";
import { Button, Conclusion, Fold, PageHeader, SectionNav, Stat, StatBand, useSectionNav, type SectionNavItem } from "@/app/components/rd";
import { parseF2DepthGateLayer, parseF2DepthGateRank } from "@/lib/admin/f2-depth-gate";
import { F2DirectPolicy } from "./f2-direct-policy";
import { F2Layers, F2Legacy, F2Limits, F2Partner, F2Who } from "./f2-rates";
import { F2SevenLayerActivation } from "./f2-seven-layer-activation";
import { F2ConfirmModal, LAYERS, configuredValue, num, type F2Confirm } from "./f2-shared";
import { stamp } from "./f2-shared";
import type { FViewCtx } from "./types";


export function F2Page({ ctx, coverage }: { ctx: FViewCtx; coverage?: { coverageRatio: number; redlinePct: number } }) {
  const [confirm, setConfirm] = useState<F2Confirm | null>(null);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const policy = ctx.f2DirectPolicy;
  const rates = ctx.f2Unilevel;
  const cv = (key: string) => configuredValue(ctx.f2ConfigValues[key]);
  const ratesReady = !ctx.f2Loading && !ctx.f2Error;
  const gate = cv("F.unilevel.depthGate"), rank = cv("F.unilevel.depthGateRank");
  const gateBad = ratesReady && (!gate || !rank || !parseF2DepthGateLayer(gate).legal || !parseF2DepthGateRank(rank).legal);
  const coolingRaw = cv("F.cooldown");
  const coolingBad = ratesReady && !!coolingRaw && !(/^[+-]?\d+$/.test(coolingRaw) && Number(coolingRaw) >= 0 && Number(coolingRaw) <= 90);
  const pauseBad = ratesReady && LAYERS.some((level) => !["on", "off"].includes(cv(`F.unilevel.${level}.paused`)));
  const sections: SectionNavItem[] = [
    { id: "layers", label: "每层分多少", alert: ratesReady && (rates.length === 0 || pauseBad) },
    { id: "who", label: "谁能拿到", alert: gateBad },
    { id: "limits", label: "总量和冷却", alert: coolingBad },
    { id: "friend", label: "好友奖励政策", alert: !!ctx.f2DirectPolicyError },
    { id: "partner", label: "合作伙伴权益" },
    { id: "legacy", label: "旧档位和旧参数" },
  ];
  const nav = useSectionNav(sections, { ready: !ctx.f2Loading, onReveal: (id) => { if (id === "legacy") setLegacyOpen(true); } });
  const canWrite = ctx.can("network_f2_royalty_rate") || ctx.can("network_f2_policy_amplify");

  const activeSum = rates.filter((row) => cv(`F.unilevel.${row.l}.paused`) !== "on").reduce((sum, row) => sum + row.usdt, 0);
  const pending = ctx.f2ActivationPending;
  const attempt = ctx.f2ActivationAttempt;
  const followUp = attempt ? "上一次整体结算申请结果未知，先在下面「整体结算」里处理。"
    : pending ? "整体结算有申请在等另一位管理员批准，批准前状态不变。" : undefined;
  const conclusion = ctx.f2DirectPolicyLoading && !policy ? { state: "unknown" as const, icon: CircleHelp, text: "团队奖励：读取中" }
    : !policy ? { state: "unknown" as const, icon: CircleHelp, text: "团队奖励：结算状态没读到，暂时无法判断", hint: "点页头「刷新」重试。" }
      : !policy.sevenLayerEnabled ? { state: "warn" as const, icon: PowerOff, text: ratesReady && rates.length === 0 ? "团队奖励：七层结算未启用，规则还没配置" : "团队奖励：七层结算还没启用",
        hint: followUp ?? (ratesReady && rates.length === 0 ? "七层规则要先由后端初始化，才能申请启用。" : "启用前先看「整体结算」里后端要检查的三条。") }
        : policy.sevenLayerPaused ? { state: "warn" as const, icon: PauseCircle, text: "团队奖励：已暂停，新订单的奖励先不算", hint: followUp }
          : !ratesReady ? { state: (ctx.f2Error ? "warn" : "unknown") as "warn" | "unknown", icon: Power, text: ctx.f2Error ? "团队奖励：正常计算，但七层比例没读到" : "团队奖励：正常计算，七层比例读取中", hint: followUp ?? (ctx.f2Error ? "点页头「刷新」重试。" : undefined) }
            : { state: "ok" as const, icon: Power, text: rates.length ? `团队奖励：正常计算，七层合计占订单 ${num(activeSum)}%` : "团队奖励：正常计算，但七层规则还没配置", hint: followUp };

  const metric = (id: string) => ctx.f2Metrics.find((row) => row.id === id);
  const usdt = metric("weeklyUsdtRoyalty"), uvt = metric("weeklyNexPayout"), l1 = metric("l1TriggerRate");
  const amount = (raw: string | undefined) => raw ? num(raw.replace(/^\$/, "").replace(/,/g, "")) : "—";
  const absent = "没有记录时后端不返回这个数，这里写「—」，不是 0。";

  return (
    <div className="f2-page">
      <PageHeader pageId="F2" title="团队奖励设置" summary="好友和好友的好友买设备时，奖励怎么一层层分上去。"
        actions={<Button loading={ctx.f2Loading || ctx.f2DirectPolicyLoading} onClick={() => void ctx.refreshF2()}>刷新</Button>}
        meta={policy?.configured && policy.effectiveAt ? `好友奖励政策第 ${policy.policyVersion} 版，生效于 ${stamp(policy.effectiveAt)}` : policy ? "好友奖励政策还没设置" : undefined}
        readOnly={canWrite ? undefined : "只能查看：这个账号没有修改团队奖励的权限"} />
      <Conclusion state={conclusion.state} icon={conclusion.icon} hint={conclusion.hint}
        explain="整体结算的状态来自好友奖励政策接口；七层合计只算发放中的层，按比例算，不含影响分、活动倍率、等级门槛和总额上限。">{conclusion.text}</Conclusion>
      <F2SevenLayerActivation ctx={ctx} openConfirm={setConfirm} />
      {ratesReady && <StatBand label="近 7 天" fit>
        <Stat label="近 7 天记入的 USDT 奖励" icon={Coins} tone="role-1" value={amount(usdt?.value)} unit={usdt ? "USDT" : undefined} sub={usdt?.sub?.replace(/ 笔.*$/, " 笔记录")}
          explain={<><p>按记录的创建时间，统计近 7 天全部 USDT 奖励记录，不区分有没有发出；后端已舍到两位小数。</p>{!usdt && <p>{absent}</p>}</>} />
        <Stat label="近 7 天记入的 UVT 奖励" icon={Coins} tone="role-1" value={amount(uvt?.value)} unit={uvt ? "UVT" : undefined} sub={uvt?.sub?.replace(/ 笔.*$/, " 笔记录")}
          explain={<><p>按记录的创建时间，统计近 7 天全部 UVT 奖励记录，不区分有没有发出；后端已舍到两位小数。</p>{!uvt && <p>{absent}</p>}</>} />
        <Stat label="L1 成员占比" icon={Users} tone="role-3" value={l1?.value ?? "—"} sub={l1?.sub}
          explain={<><p>团队成员记录里第 1 层成员占全部成员的比例，不是奖励触发率。</p>{!l1 && <p>{absent}</p>}</>} />
      </StatBand>}
      <div className="rd-config-layout"><div className="rd-config-grid">
        <div className="rd-config-rail"><SectionNav label="本页分组" items={sections} nav={nav} /></div>
        <div className="rd-config-groups">
          <div id={nav.anchor("layers")}><F2Layers ctx={ctx} openConfirm={setConfirm} /></div>
          <div id={nav.anchor("who")}><F2Who ctx={ctx} openConfirm={setConfirm} /></div>
          <div id={nav.anchor("limits")}><F2Limits ctx={ctx} openConfirm={setConfirm} /></div>
          <div id={nav.anchor("friend")}><F2DirectPolicy key="direct-policy" ctx={ctx} openConfirm={setConfirm} /></div>
          <div id={nav.anchor("partner")}><F2Partner ctx={ctx} openConfirm={setConfirm} /></div>
          <div id={nav.anchor("legacy")}>
            <Fold title="旧档位和旧参数" icon={Archive} open={legacyOpen} onOpenChange={setLegacyOpen}
              summary={`${ctx.f2RateTiers.length} 个旧档位，只读、已不生效`}
              explain="这些是旧版团队奖励留下的档位和参数，现在的结算不再读它们，后台也不能再改。">
              <span id="royalty-history" />
              <F2Legacy ctx={ctx} />
            </Fold>
          </div>
        </div>
      </div></div>
      {confirm && <F2ConfirmModal spec={confirm} coverage={coverage} toast={ctx.toast} onClose={() => setConfirm(null)} />}
    </div>
  );
}
