"use client";
import { catalogSkuBrandText } from "@/lib/admin/brand-copy";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

/** F1 · 团队等级晋升 —— 13 阶阶梯(V-badge 热度渐变 + log 人口条)+ 右栏人口金字塔 / 治理口径。
 *  奖励改为运营可配的「奖励清单」(USDT / NEX / 代金券 / SKU / 自定义),实物奖与发货队列已删。 */
import { CodeTag } from "../design-kit";
import { useState } from "react";
import type { BusinessFormValue } from "../design-kit";
import type { FViewCtx } from "./types";
import type { F1VRankRow } from "@/lib/admin/f1-client";
import { nexGridBrandText, platformAssetText } from "@/lib/admin/brand-copy";
import { PublishedContentEditor } from "@/app/components/domain-views/published-content-editor";
import type { OpsVRankRewardItem, VRankRewardType } from "@/lib/admin/platform-types";

function popPct(p: number, logMax: number): number { return p <= 0 ? 0 : Math.max(2, (Math.log10(Math.max(p, 1)) / logMax) * 100); }
function pyrPct(p: number, logMax: number): number { return p <= 0 ? 0 : Math.max(3, (Math.log10(Math.max(p, 1)) / logMax) * 100); }
function popColor(i: number): string { return i <= 2 ? "var(--cyan)" : i <= 5 ? "var(--brand)" : i <= 7 ? "var(--warning)" : "var(--brand-2)"; }

type VRow = F1VRankRow;
type VField = { k: string; label: string; cur: string; kind: "text" | "number"; options?: string[] };

/**
 * `nx_v_rank_reward_rule.custom_label` 是运营手填自由文本,没有发布审核,因此可能存着
 * **测试工具名**。实测两处写入源:PC 验收脚本写 `F-A1REVERIFY-<ts>-custom-reward`
 * (tests/e2e/a1-reverify.mjs),F1 引擎自检写 `F1ENGINE …` 行。它们是内部标识符,不是
 * 用户文案 —— 绝不能让它们出现在 App 的 V 级头衔页(zentao #30)。
 *
 * App 侧已有一道同样的闸(src/lib/rank-entitlement-label.ts 的 INTERNAL_LABEL_PATTERN),
 * 但 PC 的 F1 阶梯是**另一条**上屏路径,此前没有闸,于是「F1ENGINE custom reward」照样
 * 出现在等级奖励 chip 上。判据与 App 保持一致,免得两边各自漂移。
 */
const INTERNAL_LABEL_PATTERN = /f1engine|reverify/i;

/** 内部标识符一律不上屏;空值同样退回占位。 */
function safeCustomLabel(raw: string | undefined, fallback = "自定义"): string {
  const label = (raw ?? "").trim();
  return label && !INTERNAL_LABEL_PATTERN.test(label) ? label : fallback;
}

// 奖励 chip 文案(运营可读)。
function rewardLabel(it: OpsVRankRewardItem, voucherLabels: Record<string, string>, skuLabels: Record<string, string>): string {
  switch (it.type) {
    case "usdt": return `USDT $${(it.amount ?? 0).toLocaleString()}`;
    case "nex": return `${(it.amount ?? 0).toLocaleString()} UVT`;
    case "voucher": return `券 · ${voucherLabels[it.voucherId ?? ""] ?? it.voucherId ?? "—"}`;
    case "sku": return `商品 · ${catalogSkuBrandText(it.skuId ?? undefined, skuLabels[it.skuId ?? ""] ?? it.skuId ?? "—")}`;
    case "custom": return safeCustomLabel(it.custom);
    default: return "—";
  }
}
// 业务表单值 → 奖励字段(add / update 共用;按类型只保留相关字段,其余清空防残留)。
function rewardFields(bv: BusinessFormValue): Omit<OpsVRankRewardItem, "id"> {
  const type = (bv.rtype ?? "nex") as VRankRewardType;
  return {
    type,
    amount: type === "usdt" || type === "nex" ? (Number(bv.amount) || 0) : undefined,
    voucherId: type === "voucher" ? (bv.voucherId || undefined) : undefined,
    skuId: type === "sku" ? (bv.skuId || undefined) : undefined,
    custom: type === "custom" ? (bv.custom || undefined) : undefined,
  };
}
function genRewardId(): string { return `vr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
const isFund = (t: VRankRewardType): boolean => t === "usdt" || t === "nex";

// 门槛按钮按语义分色(易辨认):算力额/金额=lemon green · 人数/分支=cyan · 等级=橙。
function toneOf(k: string): string {
  if (k === "selfBuy" || k === "teamGv") return "t-vol";   // 算力点
  if (k === "directRefs" || k === "legCount") return "t-count"; // 人数 / 分支数
  if (k === "legRank") return "t-rank";                    // 等级
  return "t-vol";
}

export function F1Vrank({ ctx }: { ctx: FViewCtx }) {
  const rows = ctx.vrankRows;
  const canWrite = ctx.can("network_f1_write");
  const canProtect = ctx.can("network_f1_permanent_protection");
  const canPromote = ctx.can("network_f1_promote_user");
  const canReissuePayout = ctx.can("network_f1_reward_reissue");
  const canReversePayout = ctx.can("network_f1_reward_reverse");
  const [promotionFilters, setPromotionFilters] = useState({ userId: "", v: "", cohort: "", from: "", to: "" });
  const [payoutFilters, setPayoutFilters] = useState({ type: "", v: "", status: "", userId: "" });
  const logMax = Math.max(1, Math.log10(Math.max(...rows.map((r) => r.pop), 1)));

  if (ctx.f1Loading && rows.length === 0) {
    return (
      <section className="ladder">
        <div className="ladder-h">
          <span className="ph-ttl">会员等级 · 共 {rows.length} 级</span>
          <span className="ph-sub">正在加载…</span>
          
        </div>
        <div className="empty">正在加载…</div>
      </section>
    );
  }

  if (ctx.f1Error && rows.length === 0) {
    return (
      <section className="ladder">
        <div className="ladder-h">
          <span className="ph-ttl">会员等级 · 共 {rows.length} 级</span>
          <span className="ph-sub">加载失败</span>
        </div>
        <div className="empty">会员等级加载失败 · {ctx.f1Error}</div>
        <button type="button" className="f-cta" onClick={() => void ctx.refreshF1()}>重试</button>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="ladder">
        <div className="ladder-h">
          <span className="ph-ttl">会员等级 · 共 {rows.length} 级</span>
          <span className="ph-sub">暂无数据</span>
          
        </div>
        <div className="empty">暂无会员等级数据</div>
      </section>
    );
  }

  // 门槛改为每子值单独单值「调整」(不再一个文本框手打整串);展示行由各字段合成可读串。
  const rewardsOf = (v: string): OpsVRankRewardItem[] => ctx.rewards[v] ?? [];
  const hasFundReward = (v: string): boolean => rewardsOf(v).some((it) => isFund(it.type));
  const composeTh = (r: VRow): string => {
    const p: string[] = [];
    if (r.selfBuy != null) p.push(`自购算力点 ${r.selfBuy}`);
    if (r.teamGv != null) p.push(`团队算力点 ${r.teamGv}`);
    if (r.directRefs != null) p.push(`直接邀请 ${r.directRefs}`);
    if (r.legCount != null) p.push(`${r.legCount} 条分支 · 每条 ≥${r.legRank ?? "—"}`);
    return p.length ? p.join(" · ") : "—";
  };
  const fieldsOf = (r: VRow): VField[] => {
    const f: VField[] = [];
    if (r.selfBuy != null) f.push({ k: "selfBuy", label: "自购算力点", cur: r.selfBuy, kind: "number" });
    if (r.teamGv != null) f.push({ k: "teamGv", label: "团队算力点", cur: r.teamGv, kind: "number" });
    if (r.directRefs != null) f.push({ k: "directRefs", label: "直接邀请人数", cur: r.directRefs, kind: "number" });
    if (r.legCount != null) f.push({ k: "legCount", label: "达标分支数", cur: r.legCount, kind: "number" });
    // 分支最低等级 = V-Rank 13 阶有限枚举(运营从已存在等级里勾选,不手输「V3」串)。
    if (r.legRank != null) f.push({ k: "legRank", label: "分支最低等级", cur: r.legRank, kind: "text", options: rows.map((x) => x.v) });
    return f;
  };
  const editField = (r: VRow, f: VField) => {
    const fund = hasFundReward(r.v);
    const cur = f.cur;
    ctx.openActionConfirm({
      name: `调整 ${r.v} 晋升条件 · ${f.label}`, amplify: fund, op: "param", paramKey: `F.vrank.${r.v}.${f.k}`,
      edit: f.options ? { kind: "select", current: cur, options: f.options } : { kind: f.kind, current: cur },
      detail: `${r.v} 的${f.label}当前为 ${cur}。从下一轮评估开始生效，已晋升的用户不受影响。${fund ? "这一级有 USDT / UVT 奖励，放宽条件会让平台多付钱，提交时检查兑付覆盖率。" : ""}`,
    });
  };

  // ── 奖励 CRUD(复用 OperationConfirmModal + businessForm「vrank-reward-edit」;真写经 ctx.run 回调 + 审计)──
  const rewardFormBase = (r: VRow) => ({
    voucherOptions: ctx.voucherOptions, voucherLabels: ctx.voucherLabels,
    skuOptions: ctx.skuOptions, skuLabels: Object.fromEntries(Object.entries(ctx.skuLabels).map(([id, label]) => [id, catalogSkuBrandText(id, label)])), subject: `${r.v} 等级`,
  });
  const openAddReward = (r: VRow) => {
    // 新增是「配置奖励模板」,非即时发放资金;类型在表单内选,资金提示由表单内 per-type tint 给出,
    // 真正 B1 备付金硬闸发生在发放结算侧。故入口不整弹窗 amplify(避免对 代金券/SKU/自定义 误挂资金流出警告 + 覆盖率压力档误阻断)。
    ctx.openActionConfirm({
      name: `${r.v} · 新增奖励`, amplify: false,
      businessForm: { kind: "vrank-reward-edit", ...rewardFormBase(r) },
      detail: `为 ${r.v} 新增一项晋升奖励。USDT / UVT 奖励发放时会检查兑付覆盖率；代金券、商品和自定义奖励不计入资金账。`,
      run: async (reason, bv) => {
        if (!bv) return;
        const item: OpsVRankRewardItem = { id: genRewardId(), ...rewardFields(bv) };
        await ctx.addReward(r.v, item, reason);
        ctx.toast(`${r.v} · 已新增奖励 ${rewardLabel(item, ctx.voucherLabels, ctx.skuLabels)}`);
      },
    });
  };
  const openEditReward = (r: VRow, item: OpsVRankRewardItem) => {
    ctx.openActionConfirm({
      name: `${r.v} · 编辑奖励`, amplify: isFund(item.type),
      businessForm: {
        kind: "vrank-reward-edit", ...rewardFormBase(r),
        currentType: item.type,
        currentAmount: item.amount != null ? String(item.amount) : "",
        currentVoucherId: item.voucherId,
        currentSkuId: item.skuId,
        currentCustom: item.custom,
      },
      detail: `修改 ${r.v} 的奖励「${rewardLabel(item, ctx.voucherLabels, ctx.skuLabels)}」，从下一次发放开始生效，已发的不变。`,
      run: async (reason, bv) => {
        if (!bv) return;
        await ctx.updateReward(r.v, item.id, rewardFields(bv), reason);
        ctx.toast(`${r.v} · 奖励已更新`);
      },
    });
  };
  const openRemoveReward = (r: VRow, item: OpsVRankRewardItem) => {
    ctx.openActionConfirm({
      name: `${r.v} · 移除奖励`,
      detail: `移除 ${r.v} 的奖励「${rewardLabel(item, ctx.voucherLabels, ctx.skuLabels)}」，之后不再发放，已发的不收回。`,
      run: async (reason) => {
        await ctx.removeReward(r.v, item.id, reason);
        ctx.toast(`${r.v} · 已移除奖励`);
      },
    });
  };

  // 服务端存量行仍可能带旧品牌(改名 NexGrid 前的 "Nexion V-Rank")。展示层归一,
  // 但**提交值不变** —— 归一只作用于上屏文案,协议与配置仍写原值。
  const prizeName = nexGridBrandText(ctx.f1ConfigValues["F.prize.name"] ?? "");
  const permanentOn = (ctx.f1ConfigValues["F.vrank.permanent"] ?? "on") === "on";
  // V-Rank 9 阶头衔(JSON V0-V8)回填解析 · 无记录用空串,首次配置时 9 阶全填。
  const titlesByLevel: Record<string, string> = {};
  const titlesRaw = ctx.f1ConfigValues["F.vrank.titles"] ?? "";
  if (titlesRaw) {
    try {
      const parsedTitles = JSON.parse(titlesRaw);
      for (const r of rows) {
        if (typeof parsedTitles[r.v] === "string") titlesByLevel[r.v] = parsedTitles[r.v];
      }
    } catch { /* schema 异常留空,提交时后端 validateVrankTitles 兜底 */ }
  }
  const configuredLevels = rows.filter((r) => rewardsOf(r.v).length > 0).length;
  const topConcPct = ctx.leadership?.topConcentrationPct ?? 0; // 顶部 N 名领袖占池比(后端派生)
  // 领导池仅含有票权的等级；顶部人口统计须与本页全等级阶梯行同源。
  const v3plus = rows.filter((r) => Number(r.v.replace("V", "")) >= 3).reduce((s, r) => s + r.pop, 0);
  const totalMembers = rows.reduce((s, r) => s + r.pop, 0);
  const v0Pop = rows.find((r) => r.v === "V0")?.pop ?? 0;
  const v3plusPct = totalMembers > 0 ? ((v3plus / totalMembers) * 100).toFixed(2) : "0.00";
  const unlockRank = ctx.leadership?.unlockRank ?? 3;
  const topN = ctx.leadership?.topN ?? 10;
  // 人口金字塔底注的真实顶部分布(取代历史硬编码的顶部人数)。
  const v8plusPop = rows.filter((r) => Number(r.v.replace("V", "")) >= 8).reduce((s, r) => s + r.pop, 0);
  const highestRank = rows.at(-1)?.v ?? "—";
  const highestPop = rows.at(-1)?.pop ?? 0;
  // 等级票权串:从 leadership.ranks 真实 votes 派生(取代硬编码票权)。
  const voteRanks = ctx.leadership?.ranks ?? [];
  const voteWeightLabel = voteRanks.length > 0
    ? voteRanks
        .filter((r) => r.votes > 0)
        .map((r) => `V${r.v}=${r.votes} 票`)
        .join(" · ")
    : "";

  const setPromotionFilter = (key: keyof typeof promotionFilters, value: string) => {
    setPromotionFilters((current) => ({ ...current, [key]: value }));
  };
  const setPayoutFilter = (key: keyof typeof payoutFilters, value: string) => {
    setPayoutFilters((current) => ({ ...current, [key]: value }));
  };
  const snapshotLabel = (snapshot: unknown) => {
    if (snapshot == null || snapshot === "") return "—";
    if (typeof snapshot === "string") return snapshot;
    try { return JSON.stringify(snapshot); } catch { return "—"; }
  };
  const rewardPayoutLabel = (record: (typeof ctx.payoutRecords)[number]) => {
    if (["USDT", "NEX", "UVEL", "UVT"].includes(record.rewardType.toUpperCase())) {
      return `${record.amount.toLocaleString()} ${platformAssetText(record.rewardType.toUpperCase())}`;
    }
    // 发放台账同样可能带内部标识符(custom_label 是自由文本),同 #30 一并归一。
    return record.voucherId || record.skuId || safeCustomLabel(record.customLabel, record.rewardType || "—") || record.rewardType || "—";
  };
  const openManualOverride = () => {
    ctx.openActionConfirm({
      name: "手动调整会员等级",
      amplify: true,
      businessForm: {
        kind: "multi-field",
        title: "人工调整等级",
        hint: "提交后需确认才生效。",
        requireAnyChange: false,
        fields: [
          { key: "userId", label: "用户编号", inputKind: "number", min: 1, required: true, placeholder: "请输入用户编号" },
          { key: "targetV", label: "目标等级", inputKind: "select", options: rows.map((row) => row.v), required: true },
          { key: "direction", label: "动作", inputKind: "select", options: ["promote", "rollback"], optionLabels: { promote: "升级", rollback: "降级" }, required: true },
        ],
      },
      detail: "会改变用户的权益和之后的奖励资格。提交后需在「操作记录与审批」确认才生效。",
      run: async (reason, businessValue) => {
        const userId = businessValue?.userId?.trim() ?? "";
        const targetV = businessValue?.targetV?.trim() ?? "";
        const direction = businessValue?.direction === "rollback" ? "rollback" : "promote";
        if (!/^[1-9]\d*$/.test(userId)) throw new Error("用户编号须为正整数");
        if (!rows.some((row) => row.v === targetV)) throw new Error("目标等级无效");
        await ctx.proposeVRankOverride(userId, targetV, direction, reason);
      },
    });
  };
  const openPayoutAction = (payoutId: string, action: "reissue" | "reverse") => {
    ctx.openActionConfirm({
      name: `${action === "reissue" ? "重新发放" : "冲正"}奖励`,
      amplify: action === "reissue",
      detail: `${action === "reissue" ? "只有已冲正的奖励可以重新发放，平台会多付钱。" : "只有已发放、已重发或待发放的奖励可以冲正。"}提交后需确认才生效。`,
      run: async (reason) => ctx.proposePayoutAction(payoutId, action, reason),
    });
  };

  return (
    <>
      <PublishedContentEditor kind="rankHow" />
      <div className="f-stats">
        <div className="f-stat"><div className="k">总会员</div><div className="v">{totalMembers.toLocaleString()}</div><div className="sub">含 V0 {v0Pop.toLocaleString()}</div></div>
        <div className="f-stat ok"><div className="k">V3+ 高价值</div><div className="v">{v3plus}</div><div className="sub">约占 {v3plusPct}%</div></div>
        <div className="f-stat cyan"><div className="k">本月晋升</div><div className="v">{ctx.promotionTotal.toLocaleString()}</div><div className="sub">本月晋升人次</div></div>
        <div className="f-stat cyan"><div className="k">已配奖励等级</div><div className="v">{configuredLevels}</div><div className="sub">共 {rows.length} 级</div></div>
      </div>

      <div className="f1-layout-shell">
        <div className="f1-main">
          <section className="ladder">
          <div className="ladder-h">
            <span className="ph-ttl">会员等级 · 共 {rows.length} 级</span>
            <span className="ph-sub">晋升条件、奖励和人数</span>
            
          </div>
          {ctx.f1Error && <div className="empty">刷新失败 · {ctx.f1Error}</div>}
          {rows.map((r, i) => {
            const flds = fieldsOf(r);
            const items = rewardsOf(r.v);
            return (
              <div key={r.v} className={`lrow${r.pop === 0 ? " empty" : ""}${i === rows.length - 1 ? " last" : ""}`}>
                <div className={`vbadge v-${i}`}>{r.v}</div>
                <div className="lcell">
                  <div className="l1">{r.label || r.v} · {composeTh(r)}</div>
                  <div className="l2">团队奖励 {r.unilevelDepth || "—"} 层 · 同级奖 {(r.peerBonusRate * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}% · {r.votes} 票 · {r.visible ? "App 可见" : "App 隐藏"}</div>
                </div>
                <div className="lcell">
                  <div className="rwd-list">
                    {items.map((it) => (
                      <span key={it.id} className={`rwd-chip rw-${it.type}`}>
                        {canWrite
                          ? <button type="button" className="rwd-edit" title={`编辑 ${r.v} 奖励`} onClick={() => openEditReward(r, it)}>{rewardLabel(it, ctx.voucherLabels, ctx.skuLabels)}</button>
                          : <span>{rewardLabel(it, ctx.voucherLabels, ctx.skuLabels)}</span>}
                        {canWrite && <button type="button" className="rwd-del" title="移除奖励" onClick={() => openRemoveReward(r, it)}>×</button>}
                      </span>
                    ))}
                    {canWrite && <button type="button" className="rwd-add" title={`为 ${r.v} 新增奖励`} onClick={() => openAddReward(r)}>＋ 添加奖励</button>}
                  </div>
                </div>
                <div className="pop">
                  <div className="bar"><div className="f" style={{ width: `${popPct(r.pop, logMax)}%`, background: popColor(i) }} /></div>
                  <div className="ct">{r.pop.toLocaleString()}</div>
                </div>
                {canWrite && <div className="lact">
                  {flds.map((f) => (
                    <button key={f.k} className={`fbtn ${toneOf(f.k)}`} title={`调整${r.v} ${f.label}`} onClick={() => editField(r, f)}>{f.label}</button>
                  ))}
                </div>}
              </div>
            );
          })}
        </section>

        <aside className="rail">
          <div className="rail-card">
            <div className="rc-h">各等级人数<span className="tag">对数刻度</span></div>
            <div className="pyr">
              {[...rows].reverse().map((r) => {
                const idx = rows.findIndex((x) => x.v === r.v);
                const zero = r.pop === 0;
                return (
                  <div key={r.v} className="pyr-row">
                    <span className="lbl">{r.v}</span>
                    <div className={`b${idx >= 6 ? " top" : ""}`} style={zero ? { width: 1, opacity: 0.18 } : { width: `${pyrPct(r.pop, logMax)}%` }} />
                    <span className="ct">{r.pop.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 6, lineHeight: 1.5 }}>按对数刻度展示各等级人数分布 · V8 及以上 {v8plusPop.toLocaleString()} 人 · {highestRank} {highestPop.toLocaleString()} 人。</div>
          </div>

          <div className="rail-card">
            <div className="rc-h">规则说明</div>
            <div className="gov-groups">
              <div className="gov-grp">
                <div className="gov-grp-h">晋升与保级</div>
                <div className="gov-list"><div className="it">修改晋升条件只对<b>下一轮评估</b>生效，已晋升的用户不降级。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">激励与资金风控</div>
                <div className="gov-list"><div className="it">发放 <b>UVT / USDT</b> 奖励会立即计入平台应付款，受兑付覆盖率限制。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">等级与票数</div>
                <div className="gov-list"><div className="it">等级越高，领导奖池里的票数越多{voteWeightLabel ? <>（<b>{voteWeightLabel}</b>）</> : "（票数在「奖励池、名额与排行榜」设置）"}。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">奖励发放</div>
                <div className="gov-list"><div className="it">奖励的发放和领取都会被<b>记录</b>。</div></div>
              </div>
            </div>
          </div>

          <div className="rail-card">
            <div className="rc-h">保级规则</div>
            <div className="gov-list">
              <div className="it">不降级保护 · 当前 <b>{permanentOn ? "已开启" : "已关闭"}</b></div>
              <div className="it" style={{ marginTop: 4 }}>{permanentOn ? "已晋升的用户下一轮没达标，也保持现有等级。" : "下一轮没达标的用户会降级，领导奖池票数也会减少。"}</div>
            </div>
            {canProtect && <button type="button" className="f-cta" style={{ marginTop: 8, ...(permanentOn ? { borderColor: "var(--danger)", color: "var(--danger)" } : null) }} onClick={() => ctx.openActionConfirm({
              name: permanentOn ? "关闭不降级保护" : "开启不降级保护",
              op: "dispose", paramKey: "F.vrank.permanent", fixedVal: permanentOn ? "off" : "on",
              detail: permanentOn
                ? "关闭后，从下一轮评估起，没达标的用户会被降级，等级和领导奖池票数都会受影响。请慎重。"
                : "开启后，已晋升的用户即使下一轮没达标也保持现有等级。",
            })}>{permanentOn ? "关闭不降级保护" : "开启不降级保护"}</button>}
          </div>

          <div className="rail-card">
            <div className="rc-h">奖品名称</div>
            <div className="gov-list">
              <div className="it">会员等级奖品名 · 当前 <b>{prizeName || "未配置"}</b></div>
              <div className="it" style={{ marginTop: 4 }}>只用于显示，不影响奖励和晋升。</div>
            </div>
            {canWrite && <button type="button" className="f-cta" style={{ marginTop: 8 }} onClick={() => ctx.openActionConfirm({
              name: prizeName ? "修改全局奖品名" : "配置全局奖品名",
              op: "param",
              paramKey: "F.prize.name",
              edit: { kind: "text", current: prizeName, unit: "奖品名称" },
              detail: "会员等级的奖品名称，只用于显示，不影响奖励和晋升。",
            })}>{prizeName ? "修改奖品名" : "配置奖品名"}</button>}
          </div>

          <div className="rail-card">
            <div className="rc-h">各级头衔</div>
            <div className="gov-list">
              <div className="it">V0–{highestRank} 各级显示的头衔 · 已设置 <b>{Object.keys(titlesByLevel).length}</b>/{rows.length} 级</div>
              <div className="it" style={{ marginTop: 4 }}>只用于显示，不影响奖励和晋升。</div>
            </div>
            {canWrite && <button type="button" className="f-cta" style={{ marginTop: 8 }} onClick={() => ctx.openActionConfirm({
              name: "设置各级头衔",
              businessForm: {
                kind: "multi-field",
                title: "各级头衔",
                hint: "每一级都要填写，只用于显示，不影响奖励和晋升。",
                fields: rows.map((r) => ({
                  key: r.v,
                  label: r.v,
                  current: titlesByLevel[r.v] ?? "",
                  inputKind: "text" as const,
                  placeholder: `${r.v} 头衔`,
                })),
              },
              detail: "每一级都要填写，只用于显示，不影响奖励和晋升。",
              run: async (reason, bv) => {
                if (!bv) throw new Error("请填写头衔");
                const titles: Record<string, string> = {};
                for (const r of rows) {
                  const t = (bv[r.v] ?? "").trim();
                  if (!t) throw new Error(`请填写 ${r.v} 的头衔（每一级都要填）`);
                  titles[r.v] = t;
                }
                await ctx.updateF1Config("F.vrank.titles", JSON.stringify(titles), reason);
                ctx.toast("各级头衔已生效");
              },
            })}>设置各级头衔</button>}
          </div>
          </aside>
        </div>
      </div>

      <div className="f1-flow-grid">
        <section className="f1-flow" aria-label="晋升记录">
          <div className="f1-flow-h">
            <div>
              <div className="ph-ttl">晋升记录</div>
              <div className="ph-sub">自动 / 手动 · 当时的达标情况 · 触发原因</div>
            </div>
            {canPromote && <button type="button" className="f-cta" onClick={openManualOverride}>手动调整等级</button>}
          </div>
          <div className="f1-filter">
            <input aria-label="晋升用户编号" value={promotionFilters.userId} onChange={(event) => setPromotionFilter("userId", event.target.value)} placeholder="用户编号" inputMode="numeric" />
            <select aria-label="晋升涉及等级" value={promotionFilters.v} onChange={(event) => setPromotionFilter("v", event.target.value)}>
              <option value="">全部等级</option>
              {rows.map((row) => <option key={row.v} value={row.v}>{row.v}</option>)}
            </select>
            <input aria-label="晋升批次" value={promotionFilters.cohort} onChange={(event) => setPromotionFilter("cohort", event.target.value)} placeholder="用户批次" />
            <input aria-label="晋升开始日期" type="date" value={promotionFilters.from} onChange={(event) => setPromotionFilter("from", event.target.value)} />
            <input aria-label="晋升结束日期" type="date" value={promotionFilters.to} onChange={(event) => setPromotionFilter("to", event.target.value)} />
            <button type="button" className="f-cta" disabled={ctx.f1PromotionLoading} onClick={() => void ctx.queryPromotions(promotionFilters)}>查询</button>
          </div>
          {ctx.f1PromotionError && <div className="empty">晋升记录加载失败 · {ctx.f1PromotionError}</div>}
          <div className="f1-table-wrap">
            <table className="ctbl">
              <thead><tr><th>用户</th><th>等级变化</th><th>方式 / 批次</th><th>达标情况</th><th>触发原因 / 记录</th><th>时间</th></tr></thead>
              <tbody>
                {ctx.promotionRecords.map((record) => (
                  <tr key={record.id}>
                    <td><span className="cid">{operatorNicknameText(record.nickname || "—")}</span><br /><span className="uid">{record.userId}</span></td>
                    <td><span className="kind-tag network">{record.fromCode || "—"} → {record.toCode || "—"}</span></td>
                    <td>{record.isManual ? "手动" : "自动"}<br /><span className="uid">{record.operator || record.cohort || "—"}</span></td>
                    <td><details><summary>查看</summary><code className="f1-snapshot">{snapshotLabel(record.snapshot)}</code></details></td>
                    <td><span className="uid">{record.triggerEventId || "—"}</span><br /><span className="uid">{record.auditNo || "—"}</span></td>
                    <td className="uid">{record.createdAt || "—"}</td>
                  </tr>
                ))}
                {!ctx.f1PromotionLoading && ctx.promotionRecords.length === 0 && <tr className="empty-row"><td colSpan={6}>没有符合条件的晋升记录</td></tr>}
                {ctx.f1PromotionLoading && ctx.promotionRecords.length === 0 && <tr className="empty-row"><td colSpan={6}>正在加载…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="f1-flow-foot">当前筛选 {ctx.promotionTotal.toLocaleString()} 条 · 每次最多升一级，每一级的奖励都不会跳过。{" "}{ctx.promotionNextCursor && <button type="button" className="l-btn sm" disabled={ctx.f1PromotionLoading} onClick={() => void ctx.queryPromotions({ ...promotionFilters, cursor: ctx.promotionNextCursor }, true)}>加载更早记录</button>}</div>
        </section>

        <section className="f1-flow" aria-label="奖励发放记录">
          <div className="f1-flow-h">
            <div>
              <div className="ph-ttl">奖励发放记录</div>
              <div className="ph-sub">可重新发放或冲正</div>
            </div>
            
          </div>
          <div className="f1-filter">
            <input aria-label="发放用户编号" value={payoutFilters.userId} onChange={(event) => setPayoutFilter("userId", event.target.value)} placeholder="用户编号" inputMode="numeric" />
            <select aria-label="发放等级" value={payoutFilters.v} onChange={(event) => setPayoutFilter("v", event.target.value)}>
              <option value="">全部等级</option>
              {rows.map((row) => <option key={row.v} value={row.v}>{row.v}</option>)}
            </select>
            <select aria-label="奖励类型" value={payoutFilters.type} onChange={(event) => setPayoutFilter("type", event.target.value)}>
              <option value="">全部奖励</option><option value="USDT">USDT</option><option value="NEX">UVT</option><option value="VOUCHER">代金券</option><option value="SKU">商品</option><option value="CUSTOM">自定义</option>
            </select>
            <select aria-label="发放状态" value={payoutFilters.status} onChange={(event) => setPayoutFilter("status", event.target.value)}>
              <option value="">全部状态</option><option value="PENDING_GRANT">待发放</option><option value="GRANTED">已发放</option><option value="REISSUED">已重发</option><option value="REVERSED">已冲正</option><option value="FAILED">失败</option>
            </select>
            <button type="button" className="f-cta" disabled={ctx.f1PayoutLoading} onClick={() => void ctx.queryPayouts(payoutFilters)}>查询</button>
          </div>
          {ctx.f1PayoutError && <div className="empty">发放记录加载失败 · {ctx.f1PayoutError}</div>}
          <div className="f1-table-wrap">
            <table className="ctbl">
              <thead><tr><th>发放单 / 用户</th><th>等级 / 奖励</th><th>邀请人</th><th>状态</th><th>账单 / 触发原因</th><th>时间</th><th>操作</th></tr></thead>
              <tbody>
                {ctx.payoutRecords.map((record) => {
                  const canReissue = canReissuePayout && record.status === "REVERSED";
                  const canReverse = canReversePayout && ["GRANTED", "REISSUED", "PENDING_GRANT"].includes(record.status);
                  return (
                    <tr key={record.payoutId}>
                      <td><span className="cid">{record.payoutId}</span><br /><span className="uid">用户 {record.userId}</span></td>
                      <td><span className="kind-tag peer">{record.rankCode || "—"}</span><br />{rewardPayoutLabel(record)}</td>
                      <td className="uid">{record.sponsorUserId || "—"}</td>
                      <td><span className={`f1-state st-${record.status.toLowerCase()}`}>{({PENDING_GRANT:"待发放",GRANTED:"已发放",REISSUED:"已重发",REVERSED:"已冲正",FAILED:"失败"} as Record<string,string>)[record.status] ?? "状态未知"}</span></td>
                      <td><span className="uid">{record.billId || "—"}</span><br /><span className="uid">{record.triggerEventId || "—"}</span></td>
                      <td className="uid">{record.reversedAt || record.grantedAt || "—"}</td>
                      <td>
                        <div className="row-acts">
                          {canReissue && <button type="button" className="unlock" onClick={() => openPayoutAction(record.payoutId, "reissue")}>重发</button>}
                          {canReverse && <button type="button" className="reject" onClick={() => openPayoutAction(record.payoutId, "reverse")}>冲正</button>}
                          {!canReissue && !canReverse && <span className="none">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!ctx.f1PayoutLoading && ctx.payoutRecords.length === 0 && <tr className="empty-row"><td colSpan={7}>没有符合条件的发放记录</td></tr>}
                {ctx.f1PayoutLoading && ctx.payoutRecords.length === 0 && <tr className="empty-row"><td colSpan={7}>正在加载…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="f1-flow-foot">当前筛选 {ctx.payoutTotal.toLocaleString()} 条 · 重新发放会让平台多付钱，受兑付覆盖率限制；冲正可在账单里查到。{" "}{ctx.payoutNextCursor && <button type="button" className="l-btn sm" disabled={ctx.f1PayoutLoading} onClick={() => void ctx.queryPayouts({ ...payoutFilters, cursor: ctx.payoutNextCursor }, true)}>加载更早记录</button>}</div>
        </section>
      </div>

      <div className="f1-chain-note">
        <b>关联：</b>App 上的等级和权益来自这里；团队分成、领导奖池票数、佣金记录和账单都按同一会员等级和发放编号关联。
      </div>

      <p className="f-foot">高等级人数较少、奖励分配权重较高。领导奖池向 V{unlockRank} 级及以上用户分配；前 {topN} 名高等级用户占比约 {topConcPct}%。修改晋升门槛会影响后续晋升和奖励分配，须先核验资金覆盖率。</p>
    </>
  );
}
