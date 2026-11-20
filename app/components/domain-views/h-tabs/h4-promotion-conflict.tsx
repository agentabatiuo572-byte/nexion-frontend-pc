"use client";

/**
 * 促销活动保存、审核、发布遇到「别人先改过」时的对比。说法和样子照 H4 玩法规则的三方对比（h4-conflict-compare）：
 * 你打开时、别人改成、你填的；只列有差别的项；按我填的保存会换掉哪几项别人的修改，逐项写出来。
 * 整组的值（规则、预算、人群、政策、上限、三语文字）只列这一组里不一样的那几条，用编辑器和详情页现成的写法；
 * 金额去掉补的 0、不舍入、带币种；没配置写「未配置」，不写成 0。只管显示，不读数据、不决定能不能提交。
 */
import type { ReactNode } from "react";
import { Fold, Notice, StatusTag } from "@/app/components/rd";
import { promotionFieldLabel } from "@/lib/admin/promotion-client";
import { limitText, policyLabel } from "@/lib/admin/promotion-form";
import type { Catalog, Draft, DraftAudience, DraftRewardSpec, Limit, PolicyRef } from "@/lib/admin/promotion-types";
import type { promotionDraftChanges } from "@/lib/admin/promotion-conflict";
import { TEMPLATE_LABELS, amountText, formatTime, promotionAssetText, rewardText, text, zoneLabel } from "./h4-promotion-ui";

export type PromotionDraftChange = ReturnType<typeof promotionDraftChanges>[number];
type Part = { label: string; value: string };
type Shown = string | string[];

const ORDER: Array<keyof Draft> = ["name", "category", "template", "startsAt", "endsAt", "displayTimezone", "placement", "bannerAssetId", "title", "terms", "minimumClientCapabilities",
  "buyerAudience", "inviterAudience", "rules", "combinationMatch", "perPersonLimit", "activityLimit", "maxRewardUnitsPerOrder", "budgets", "shortagePolicy", "policies"];
const EXTRA_LABELS: Partial<Record<keyof Draft, string>> = { category: "活动类别", template: "活动模板", placement: "投放位置", combinationMatch: "组合购买匹配" };
export const promotionDraftLabel = (field: keyof Draft) => EXTRA_LABELS[field] ?? promotionFieldLabel(String(field));
const POLICY_SLOTS: Array<[keyof NonNullable<Draft["policies"]>, string]> = [["firstPurchase", "首购认定"], ["settlement", "结算"], ["stacking", "叠加"], ["refund", "售后追回"], ["quote", "报价期限"], ["authorization", "审核发布授权"]];
const EMPTY: Partial<Record<keyof Draft, string>> = { rules: "没有规则", budgets: "没有填预算", bannerAssetId: "没有宣传图", placement: "不投放首页", minimumClientCapabilities: "不限客户端", name: "未填写" };

const days = (range: { minDays: number | null; maxDays: number | null } | undefined) => !range || range.minDays == null && range.maxDays == null ? "不限"
  : range.minDays != null && range.maxDays != null ? `${range.minDays}–${range.maxDays} 天` : range.minDays != null ? `至少 ${range.minDays} 天` : `不超过 ${range.maxDays} 天`;

/** 一个配置项拆成可逐条比较的几行；没配置时返回 null。键名只在这里用来对齐三份值，不显示。 */
function partsOf(field: keyof Draft, draft: Draft | undefined, catalog: Catalog, banners: string[]): Map<string, Part> | null {
  const value = draft?.[field];
  if (value === undefined || value === null || Array.isArray(value) && !value.length && field !== "minimumClientCapabilities") return field === "placement" || field === "minimumClientCapabilities" ? new Map([["", { label: "", value: EMPTY[field]! }]]) : null;
  const one = (v: string) => new Map([["", { label: "", value: v }]]);
  const sku = (id: string | null | undefined) => { const name = text(catalog.skus.find(s => s.productNo === id)?.name); return name === "未提供" ? "未选设备" : name; };
  const reward = (r: DraftRewardSpec | null | undefined) => rewardText(r, r?.type === "DEVICE" ? sku(r.giftProductNo) : undefined);
  const policy = (ref: PolicyRef | null | undefined) => { if (!ref) return "未选"; const p = catalog.policies.find(item => item.policyId === ref.policyId && item.version === ref.version); return p ? `${policyLabel(p, catalog)} · v${ref.version}` : `v${ref.version}（目录里没有这一版）`; };
  const d = draft!;
  switch (field) {
    case "name": return one(String(value));
    case "category": return one(value === "REFERRAL" ? "邀请推广" : "促销");
    case "template": return one(TEMPLATE_LABELS[value as keyof typeof TEMPLATE_LABELS] ?? "未配置");
    case "startsAt": case "endsAt": return one(`${formatTime(value as string, d.displayTimezone || "UTC")}（${zoneLabel(d.displayTimezone)}）`);
    case "displayTimezone": return one(zoneLabel(value as string));
    case "placement": return one("首页购机推广");
    case "minimumClientCapabilities": return one((value as string[]).length ? "只向支持促销的客户端开放" : EMPTY.minimumClientCapabilities!);
    case "bannerAssetId": return one(`宣传图 ${banners.indexOf(value as string) + 1}`);
    case "combinationMatch": return one(value === "ALL" ? "同时满足全部购买项" : "满足任一购买项");
    case "shortagePolicy": return one(value === "RULE_STOP" ? "停止该规则新增预留" : "暂停整个活动");
    case "activityLimit": case "maxRewardUnitsPerOrder": return one(limitText(value as Limit));
    case "title": case "terms": {
      const localized = value as NonNullable<Draft["title"]>;
      return new Map(([["zh", "中文"], ["en", "英语"], ["vi", "越南语"]] as const).map(([key, label]) => [key, { label, value: localized[key] || "未填写" }]));
    }
    case "perPersonLimit": { const v = value as NonNullable<Draft["perPersonLimit"]>; return new Map([["buyer", { label: "购买者", value: limitText(v.buyer) }], ["directInviter", { label: "直接邀请人", value: limitText(v.directInviter) }]]); }
    case "buyerAudience": case "inviterAudience": {
      const a = value as DraftAudience;
      return new Map<string, Part>([
        ["purchaseHistory", { label: "购机历史", value: ({ ANY: "全部账户", NEVER_PAID: "首次合格购机", HAS_VALID_PURCHASE: "复购账户" } as Record<string, string>)[a.purchaseHistory ?? ""] ?? "未配置" }],
        ["devicePresence", { label: "设备条件", value: ({ ANY: "不限持有情况", NONE: "当前无符合条件的设备", HAS_QUALIFYING_DEVICE: "持有符合条件的设备" } as Record<string, string>)[a.devicePresence ?? ""] ?? "未配置" }],
        ["deviceAudiencePolicy", { label: "设备判断政策", value: policy(a.deviceAudiencePolicy) }],
        ["rankIds", { label: "等级", value: a.rankIds?.length ? a.rankIds.map(id => text(catalog.ranks.find(r => r.id === id)?.name)).join("、") : "不限等级" }],
        ["markets", { label: "市场", value: a.markets?.length ? a.markets.map(id => text(catalog.markets.find(m => m.id === id)?.name)).join("、") : "不限市场" }],
        ["sponsor", { label: "邀请关系", value: ({ ANY: "不限邀请关系", REQUIRED: "须有直接邀请人", ABSENT: "没有直接邀请人" } as Record<string, string>)[a.sponsor ?? ""] ?? "未配置" }],
        ["neverPurchased", { label: "历史购机", value: a.neverPurchased === true ? "仅从未有效购机" : a.neverPurchased === false ? "不额外排除" : "未配置" }],
        ["registrationAge", { label: "注册天数", value: days(a.registrationAge) }],
        ["lastValidPurchaseAge", { label: "距上次购机", value: days(a.lastValidPurchaseAge) }],
      ]);
    }
    case "rules": return new Map((value as NonNullable<Draft["rules"]>).flatMap(r => {
      const name = sku(r.productNo);
      return [[r.ruleId, { label: name, value: `买 ${r.minBuyQty ?? "未配置"} 台一组 · 购买者 ${reward(r.buyerReward)}${r.inviterReward ? ` · 邀请人 ${reward(r.inviterReward)}` : ""}` }],
        [`${r.ruleId}.productNo`, { label: "购买设备", value: name }],
        [`${r.ruleId}.minBuyQty`, { label: `${name} · 每组购买`, value: r.minBuyQty == null ? "未配置" : `${r.minBuyQty} 台` }],
        [`${r.ruleId}.buyerReward`, { label: `${name} · 购买者奖励`, value: reward(r.buyerReward) }],
        [`${r.ruleId}.inviterReward`, { label: `${name} · 邀请人奖励`, value: r.inviterReward ? reward(r.inviterReward) : "没有" }],
        [`${r.ruleId}.repeatMode`, { label: `${name} · 计奖方式`, value: r.repeatMode === "PER_GROUP" ? "每组发放" : r.repeatMode === "ONCE_PER_ORDER" ? "每单一次" : "未配置" }],
        [`${r.ruleId}.maxGroups`, { label: `${name} · 每单计奖组数`, value: limitText(r.maxGroups) }],
        [`${r.ruleId}.maxGroupsPerPerson`, { label: `${name} · 每人累计计奖组数`, value: limitText(r.maxGroupsPerPerson) }],
        [`${r.ruleId}.priority`, { label: `${name} · 优先级`, value: r.priority == null ? "未配置" : String(r.priority) }]] as Array<[string, Part]>;
    }));
    case "budgets": return new Map((value as NonNullable<Draft["budgets"]>).map(b => [`${b.asset}:${b.asset === "DEVICE" ? b.productNo ?? "" : ""}`, {
      label: b.asset === "DEVICE" ? `赠品 ${sku(b.productNo)}` : b.asset === "DISCOUNT_USDT" ? "订单立减" : `${promotionAssetText(b.asset)} 奖励`,
      value: b.total == null ? "未填" : b.asset === "DEVICE" ? `${amountText(b.total, true)} 台` : `${amountText(b.total)} ${b.asset === "DISCOUNT_USDT" ? "USDT" : promotionAssetText(b.asset)}`,
    }]));
    case "policies": { const set = value as NonNullable<Draft["policies"]>; return new Map(POLICY_SLOTS.map(([key, label]) => [key, { label, value: policy(set[key]) }])); }
  }
  return one("已配置");
}

/** 同一项的几份值，只留下彼此不同的那几条；整条规则有无不同时，只写这一条的摘要。 */
function cellsOf(field: keyof Draft, drafts: Array<Draft | undefined>, catalog: Catalog): Shown[] {
  const banners = [...new Set(drafts.map(d => d?.bannerAssetId).filter((v): v is string => !!v))];
  const maps = drafts.map(d => partsOf(field, d, catalog, banners));
  const keys = [...new Set(maps.flatMap(m => m ? [...m.keys()] : []))];
  const absent = field === "rules" ? "没有这条规则" : field === "budgets" ? "未填" : "未配置";
  const differs = (key: string) => new Set(maps.map(m => m ? m.get(key)?.value ?? "\u0000" : "\u0001")).size > 1;
  const whole = new Set(keys.filter(key => !key.includes(".") && maps.some(m => m && !m.has(key)) && maps.some(m => m?.has(key))));
  // 整条增删的只写一行摘要；都在的只写不一样的那几条。
  const parent = (key: string) => keys.some(other => other.startsWith(`${key}.`));
  const changed = keys.filter(key => whole.has(key) || differs(key) && !whole.has(key.split(".")[0]) && !parent(key));
  const shown = changed.length ? changed : keys.filter(key => !key.includes("."));
  return maps.map(map => {
    if (!map) return EMPTY[field] ?? "未配置";
    const lines = shown.map(key => {
      const part = map.get(key), label = part?.label ?? maps.find(m => m?.get(key))?.get(key)?.label ?? "";
      return label ? `${label}：${part?.value ?? absent}` : part?.value ?? absent;
    });
    return lines.length === 1 ? lines[0] : lines;
  });
}

const isEmpty = (value: unknown) => value === null || value === undefined || Array.isArray(value) && !value.length;
function Value({ value }: { value: Shown }) {
  if (typeof value === "string") return <span className="h4-compare-value" title={value.length > 60 ? value : undefined}>{value}</span>;
  return <ul className="h4-compare-values">{value.map(line => <li key={line} title={line.length > 60 ? line : undefined}>{line}</li>)}</ul>;
}

type Row = { change: PromotionDraftChange; opened: Shown; latest: Shown; mine: Shown };
const tag = (change: PromotionDraftChange) => change.changedByOther && change.changedByMe ? <StatusTag tone="warn">两边都改了</StatusTag>
  : change.changedByOther ? <StatusTag tone="warn">只有别人改了</StatusTag> : <StatusTag tone="neutral">你改的</StatusTag>;

function ThreeWayTable({ rows, label }: { rows: Row[]; label: string }) {
  return <table className="h4-compare-table" data-promotion="" aria-label={label}>
    <thead><tr><th scope="col">项</th><th scope="col">你打开时</th><th scope="col">别人改成</th><th scope="col">你填的</th></tr></thead>
    <tbody>{rows.map(({ change, opened, latest, mine }) => <tr key={change.field}>
      <th scope="row"><span className="h4-compare-name">{promotionDraftLabel(change.field)}</span>{tag(change)}</th>
      <td><Value value={opened}/></td>
      <td data-changed={change.changedByOther ? "" : undefined}>{change.changedByOther ? <Value value={latest}/> : <span className="h4-dim">没改</span>}</td>
      <td data-changed={change.changedByMe ? "" : undefined}>{change.changedByMe ? <><Value value={mine}/>{change.overwritesOther && <span className="h4-compare-lost">会换掉别人改的</span>}</>
        : <><span className="h4-dim">没动</span>{change.overwritesOther ? <span className="h4-compare-lost">{isEmpty(change.mine) ? "按我填的保存会清空" : typeof mine === "string" && mine.length <= 12 && !mine.includes("：") ? `按我填的保存会改回 ${mine}` : "按我填的保存会改回打开时的"}</span>
          : change.changedByOther && <span className="h4-dim h4-compare-keep">保存后照别人改的</span>}</>}</td>
    </tr>)}</tbody>
  </table>;
}

const LOCKED_TITLE = "没有保存：你编辑时，别人先保存了这个活动";

/** 保存草稿的确认框里冲突这一块：核对前、核对后、核对后已经不能保存。 */
export function PromotionSaveConflict({ stage, changes, opened, latest, mine, catalog, blocked }: {
  stage: "locked" | "reviewed" | "blocked";
  changes: PromotionDraftChange[];
  opened: Draft;
  latest?: Draft;
  mine: Draft;
  catalog: Catalog;
  /** 不能保存时：为什么、现在能做什么，各一句。 */
  blocked?: { reason: string; next: string };
}) {
  if (stage === "blocked") return <Notice tone="warn" title="这份草稿已经不能保存">{blocked?.reason}。{blocked?.next}</Notice>;
  if (stage === "locked") return <Notice tone="warn" title={LOCKED_TITLE}>你填的都还在。点「重新加载并核对」，看清别人改了什么再决定。</Notice>;
  const rows = [...changes].sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field)).map(change => {
    const [o, l, m] = cellsOf(change.field, [opened, latest, mine], catalog);
    return { change, opened: o, latest: l, mine: m };
  });
  const others = rows.filter(row => row.change.changedByOther), minesOnly = rows.filter(row => !row.change.changedByOther);
  const lost = others.filter(row => row.change.overwritesOther).map(row => promotionDraftLabel(row.change.field));
  return <Notice tone="warn" title={LOCKED_TITLE}>
    <div className="h4-compare">
      <p className="h4-compare-lede">{others.length ? `别人改了 ${others.length} 项，下面只列有差别的项。` : "别人保存的内容和你打开时一样，下面是你改的项。"}</p>
      {(others.length ? others : minesOnly).length > 0 && <ThreeWayTable rows={others.length ? others : minesOnly} label="你打开时、别人改成、你填的"/>}
      {others.length > 0 && minesOnly.length > 0 && <Fold inset title={`你改的另外 ${minesOnly.length} 项`} summary="别人没动，保存后照你填的"><ThreeWayTable rows={minesOnly} label="只有你改的项"/></Fold>}
      <div className="h4-compare-choices">
        <div className="h4-compare-choice">
          <b>按我填的保存</b>
          <p>{lost.length ? `别人改的 ${lost.length} 项会换成你填的：${lost.join("、")}。没列出的不动。` : "别人改的都会留着，再加上你改的。"}</p>
        </div>
        <div className="h4-compare-choice">
          <b>不保存，返回活动</b>
          <p>放弃你的改动；回到活动后再点「编辑草稿」，看到的就是别人保存的内容。</p>
        </div>
      </div>
    </div>
  </Notice>;
}

export type RecheckFact = { label: string; before: ReactNode; after: ReactNode };
/** 审核页动作重新读取后：你打开时 → 现在。approve、publish 写明再确认的是「现在」这一列。 */
export function PromotionRecheck({ facts, changes, opened, latest, catalog, actionLabel, confirmLabel, emphasize, blocked }: {
  facts: RecheckFact[];
  changes: PromotionDraftChange[];
  opened?: Draft;
  latest?: Draft;
  catalog: Catalog;
  actionLabel: string;
  confirmLabel: string;
  /** 批准、发布：确认的是变了之后的内容，要说清。 */
  emphasize: boolean;
  /** 读到的最新状态已经不能做这一步时，写原因。 */
  blocked?: string;
}) {
  const content = [...changes].sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field)).map(change => {
    const [before, after] = cellsOf(change.field, [opened, latest], catalog);
    return { key: String(change.field), label: promotionDraftLabel(change.field), before: <Value value={before}/>, after: <Value value={after}/> };
  });
  const rows = [...facts.map(f => ({ key: f.label, ...f })), ...content];
  const title = blocked ? `现在不能${actionLabel}` : !rows.length ? "已重新读取，影响这一步的内容都没变" : emphasize && content.length ? `你要${actionLabel}的内容变了` : "你打开后，活动有变化";
  return <Notice tone={blocked || rows.length ? "warn" : "neutral"} title={title}>
    <div className="h4-compare">
      {blocked && <p className="h4-compare-lede">{blocked}关掉这个框，回到活动看最新情况。</p>}
      {rows.length > 0 && <table className="h4-compare-table" data-promotion="" aria-label="你打开时和现在">
        <thead><tr><th scope="col">项</th><th scope="col">你打开时</th><th scope="col">现在</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row"><span className="h4-compare-name">{row.label}</span></th><td>{row.before}</td><td data-changed="">{row.after}</td></tr>)}</tbody>
      </table>}
      {!blocked && <p className="h4-compare-lede">{emphasize && content.length ? `再点「${confirmLabel}」，${actionLabel}的是「现在」这一列的内容。` : `核对后再点「${confirmLabel}」。`}</p>}
    </div>
  </Notice>;
}
