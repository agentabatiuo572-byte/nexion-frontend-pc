"use client";

/** F1 · V-Rank 晋升 —— 13 阶阶梯(V-badge 热度渐变 + log 人口条)+ 右栏人口金字塔 / 治理口径。
 *  奖励改为运营可配的「奖励清单」(USDT / NEX / 代金券 / SKU / 自定义),实物奖与发货队列已删。 */
import { CodeTag } from "../design-kit";
import { useState } from "react";
import type { BusinessFormValue } from "../design-kit";
import type { FViewCtx } from "./types";
import type { F1VRankRow } from "@/lib/admin/f1-client";
import { PublishedContentEditor } from "@/app/components/domain-views/published-content-editor";
import type { OpsVRankRewardItem, VRankRewardType } from "@/lib/admin/platform-types";

function popPct(p: number, logMax: number): number { return p <= 0 ? 0 : Math.max(2, (Math.log10(Math.max(p, 1)) / logMax) * 100); }
function pyrPct(p: number, logMax: number): number { return p <= 0 ? 0 : Math.max(3, (Math.log10(Math.max(p, 1)) / logMax) * 100); }
function popColor(i: number): string { return i <= 2 ? "var(--cyan)" : i <= 5 ? "var(--brand)" : i <= 7 ? "var(--warning)" : "var(--brand-2)"; }

type VRow = F1VRankRow;
type VField = { k: string; label: string; cur: string; kind: "text" | "number"; options?: string[] };

// 奖励 chip 文案(运营可读)。
function rewardLabel(it: OpsVRankRewardItem, voucherLabels: Record<string, string>, skuLabels: Record<string, string>): string {
  switch (it.type) {
    case "usdt": return `USDT $${(it.amount ?? 0).toLocaleString()}`;
    case "nex": return `${(it.amount ?? 0).toLocaleString()} NEX`;
    case "voucher": return `券 · ${voucherLabels[it.voucherId ?? ""] ?? it.voucherId ?? "—"}`;
    case "sku": return `SKU · ${skuLabels[it.skuId ?? ""] ?? it.skuId ?? "—"}`;
    case "custom": return it.custom ?? "自定义";
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

// 门槛按钮按语义分色(易辨认):业绩/金额=lemon green · 人数/分支=cyan · 等级=橙。
function toneOf(k: string): string {
  if (k === "selfBuy" || k === "teamGv") return "t-vol";   // 业绩 / 金额
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
          <span className="ph-ttl">V-Rank 13 阶阶梯</span>
          <span className="ph-sub">正在读取后端数据</span>
          <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">server-canonical</CodeTag></span>
        </div>
        <div className="empty">F1 数据加载中...</div>
      </section>
    );
  }

  if (ctx.f1Error && rows.length === 0) {
    return (
      <section className="ladder">
        <div className="ladder-h">
          <span className="ph-ttl">V-Rank 13 阶阶梯</span>
          <span className="ph-sub">后端接口返回失败</span>
        </div>
        <div className="empty">F1 数据加载失败 · {ctx.f1Error}</div>
        <button type="button" className="f-cta" onClick={() => void ctx.refreshF1()}>重试</button>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="ladder">
        <div className="ladder-h">
          <span className="ph-ttl">V-Rank 13 阶阶梯</span>
          <span className="ph-sub">后端暂无数据</span>
          <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">server-canonical</CodeTag></span>
        </div>
        <div className="empty">F1 暂无 V-Rank 数据</div>
      </section>
    );
  }

  // 门槛改为每子值单独单值「调整」(不再一个文本框手打「自买 $299 · 直推 3」整串);展示行由各字段合成可读串。
  const rewardsOf = (v: string): OpsVRankRewardItem[] => ctx.rewards[v] ?? [];
  const hasFundReward = (v: string): boolean => rewardsOf(v).some((it) => isFund(it.type));
  const composeTh = (r: VRow): string => {
    const p: string[] = [];
    if (r.selfBuy != null) p.push(`自买 ${r.selfBuy}`);
    if (r.teamGv != null) p.push(`团队 GV ${r.teamGv}`);
    if (r.directRefs != null) p.push(`直推 ${r.directRefs}`);
    if (r.legCount != null) p.push(`${r.legCount} 条分支 · 每条 ≥${r.legRank ?? "—"}`);
    return p.length ? p.join(" · ") : "—";
  };
  const fieldsOf = (r: VRow): VField[] => {
    const f: VField[] = [];
    if (r.selfBuy != null) f.push({ k: "selfBuy", label: "自买额", cur: r.selfBuy, kind: "text" });
    if (r.teamGv != null) f.push({ k: "teamGv", label: "团队GV", cur: r.teamGv, kind: "text" });
    if (r.directRefs != null) f.push({ k: "directRefs", label: "直推数", cur: r.directRefs, kind: "number" });
    if (r.legCount != null) f.push({ k: "legCount", label: "达标分支数", cur: r.legCount, kind: "number" });
    // 分支最低等级 = V-Rank 13 阶有限枚举(运营从已存在等级里勾选,不手输「V3」串)。
    if (r.legRank != null) f.push({ k: "legRank", label: "分支最低等级", cur: r.legRank, kind: "text", options: rows.map((x) => x.v) });
    return f;
  };
  const editField = (r: VRow, f: VField) => {
    const fund = hasFundReward(r.v);
    const cur = f.cur;
    ctx.openActionConfirm({
      name: `${r.v} 门槛 · ${f.label}调整`, amplify: fund, op: "param", paramKey: `F.vrank.${r.v}.${f.k}`,
      edit: f.options ? { kind: "select", current: cur, options: f.options } : { kind: f.kind, current: cur },
      detail: `${r.v} 晋升门槛 · ${f.label} 当前 ${cur} · server 晋升判定改后对下一轮评估生效,不回溯已晋升用户。${fund ? "该阶含 NEX / USDT 奖励派发,放大资金流出,受 B1 覆盖率约束。" : ""}`,
    });
  };

  // ── 奖励 CRUD(复用 OperationConfirmModal + businessForm「vrank-reward-edit」;真写经 ctx.run 回调 + 审计)──
  const rewardFormBase = (r: VRow) => ({
    voucherOptions: ctx.voucherOptions, voucherLabels: ctx.voucherLabels,
    skuOptions: ctx.skuOptions, skuLabels: ctx.skuLabels, subject: `${r.v} 等级`,
  });
  const openAddReward = (r: VRow) => {
    // 新增是「配置奖励模板」,非即时派发资金;类型在表单内选,资金提示由表单内 per-type tint 给出,
    // 真正 B1 备付金硬闸发生在派发结算侧。故入口不整弹窗 amplify(避免对 代金券/SKU/自定义 误挂资金流出警告 + 覆盖率压力档误阻断)。
    ctx.openActionConfirm({
      name: `${r.v} · 新增奖励`, amplify: false,
      businessForm: { kind: "vrank-reward-edit", ...rewardFormBase(r) },
      detail: `为 ${r.v} 等级新增一项晋升奖励。USDT / NEX 类为资金 / 代币流出,派发时受 B1 备付金覆盖率约束;代金券 / SKU / 自定义不直接入资金账。`,
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
      detail: `编辑 ${r.v} 等级奖励「${rewardLabel(item, ctx.voucherLabels, ctx.skuLabels)}」。改类型 / 金额后对下一轮派发生效,不回溯已发放。`,
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
      detail: `移除 ${r.v} 等级的奖励「${rewardLabel(item, ctx.voucherLabels, ctx.skuLabels)}」。移除后该奖励不再发放;已派发的不回收。`,
      run: async (reason) => {
        await ctx.removeReward(r.v, item.id, reason);
        ctx.toast(`${r.v} · 已移除奖励`);
      },
    });
  };

  const prizeName = ctx.f1ConfigValues["F.prize.name"] ?? "";
  const permanentOn = (ctx.f1ConfigValues["F.vrank.permanent"] ?? "on") === "on";
  // V-Rank 13 阶头衔(JSON V0-V12)回填解析 · 无记录用空串,首次配置时 13 阶全填。
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
  // 顶栏会员数派生自后端 rows/leadership,不硬编码。
  const v3plus = ctx.leadership?.qualifiers ?? rows.filter((r) => Number(r.v.replace("V", "")) >= 3).reduce((s, r) => s + r.pop, 0);
  const totalMembers = ctx.leadership?.totalMembers ?? rows.reduce((s, r) => s + r.pop, 0);
  const v0Pop = rows.find((r) => r.v === "V0")?.pop ?? 0;
  const v3plusPct = totalMembers > 0 ? ((v3plus / totalMembers) * 100).toFixed(2) : "0.00";
  const unlockRank = ctx.leadership?.unlockRank ?? 3;
  const topN = ctx.leadership?.topN ?? 10;
  // 人口金字塔底注的真实顶部分布(取代历史硬编码 "V8+ 仅 10 人;V12 仅 1 人")。
  const v8plusPop = rows.filter((r) => Number(r.v.replace("V", "")) >= 8).reduce((s, r) => s + r.pop, 0);
  const v12Pop = rows.find((r) => r.v === "V12")?.pop ?? 0;
  // 等级票权串:从 leadership.ranks 真实 votes 派生(取代硬编码 "V3=1 票 … V12=512 票")。
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
    if (record.rewardType === "USDT" || record.rewardType === "NEX") {
      return `${record.amount.toLocaleString()} ${record.rewardType}`;
    }
    return record.voucherId || record.skuId || record.customLabel || record.rewardType || "—";
  };
  const openManualOverride = () => {
    ctx.openActionConfirm({
      name: "V-Rank 人工晋升 / 回滚",
      amplify: true,
      businessForm: {
        kind: "multi-field",
        title: "人工调整等级",
        hint: "动作先进入 A2 确认队列；服务端再次校验用户、当前等级、目标等级和幂等状态。",
        requireAnyChange: false,
        fields: [
          { key: "userId", label: "用户 ID", inputKind: "number", min: 1, required: true, placeholder: "请输入用户 ID" },
          { key: "targetV", label: "目标等级", inputKind: "select", options: rows.map((row) => row.v), required: true },
          { key: "direction", label: "动作", inputKind: "select", options: ["promote", "rollback"], optionLabels: { promote: "人工晋升", rollback: "人工回滚" }, required: true },
        ],
      },
      detail: "人工等级调整会改变用户权益与后续奖励资格。提交后只生成 A2 提案，不直接改库；复核执行时写审计号与晋升流水。",
      run: async (reason, businessValue) => {
        const userId = businessValue?.userId?.trim() ?? "";
        const targetV = businessValue?.targetV?.trim() ?? "";
        const direction = businessValue?.direction === "rollback" ? "rollback" : "promote";
        if (!/^[1-9]\d*$/.test(userId)) throw new Error("用户 ID 必须为正整数");
        if (!rows.some((row) => row.v === targetV)) throw new Error("目标等级无效");
        await ctx.proposeVRankOverride(userId, targetV, direction, reason);
      },
    });
  };
  const openPayoutAction = (payoutId: string, action: "reissue" | "reverse") => {
    ctx.openActionConfirm({
      name: `奖励派发${action === "reissue" ? "重发" : "冲正"}`,
      amplify: action === "reissue",
      detail: `${action === "reissue" ? "重发仅允许 REVERSED 派发单；可能放大资金流出。" : "冲正仅允许 GRANTED / REISSUED / PENDING_GRANT 派发单。"} 动作进入 A2 确认队列并由服务端状态机、对象锁和幂等键兜底。`,
      run: async (reason) => ctx.proposePayoutAction(payoutId, action, reason),
    });
  };

  return (
    <>
      <PublishedContentEditor kind="rankHow" />
      <div className="f-stats">
        <div className="f-stat"><div className="k">总会员</div><div className="v">{totalMembers.toLocaleString()}</div><div className="sub">含 V0 {v0Pop.toLocaleString()}</div></div>
        <div className="f-stat ok"><div className="k">V3+ 高价值</div><div className="v">{v3plus}</div><div className="sub">≈ {v3plusPct}% · 顶部漏斗</div></div>
        <div className="f-stat cyan"><div className="k">本月晋升</div><div className="v">{ctx.promotionTotal.toLocaleString()}</div><div className="sub">晋升流水 · 初始按本月筛选</div></div>
        <div className="f-stat cyan"><div className="k">已配奖励等级</div><div className="v">{configuredLevels}</div><div className="sub">全 13 阶 · 运营可增删</div></div>
      </div>

      <div className="f1-layout-shell">
        <div className="f1-main">
          <section className="ladder">
          <div className="ladder-h">
            <span className="ph-ttl">V-Rank 13 阶阶梯</span>
            <span className="ph-sub">门槛 · 奖励 · 在册人数</span>
            <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">server-canonical</CodeTag></span>
          </div>
          {ctx.f1Error && <div className="empty">F1 刷新失败 · {ctx.f1Error}</div>}
          {rows.map((r, i) => {
            const flds = fieldsOf(r);
            const items = rewardsOf(r.v);
            return (
              <div key={r.v} className={`lrow${r.pop === 0 ? " empty" : ""}${i === rows.length - 1 ? " last" : ""}`}>
                <div className={`vbadge v-${i}`}>{r.v}</div>
                <div className="lcell">
                  <div className="l1">{r.label || r.v} · {composeTh(r)}</div>
                  <div className="l2">F.vrank.{r.v} · 网络 {r.unilevelDepth || "—"} 层 · 同级奖 {r.peerBonusRate}% · {r.votes} 票 · {r.visible ? "客户端可见" : "客户端隐藏"}</div>
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
                    {canWrite && <button type="button" className="rwd-add" title={`为 ${r.v} 新增奖励`} onClick={() => openAddReward(r)}>＋ 加奖励</button>}
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
            <div className="rc-h">人口金字塔<span className="tag">log</span></div>
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
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 6, lineHeight: 1.5 }}>log 标尺可视化顶部稀薄分布 · 真实在册 V8+ {v8plusPop.toLocaleString()} 人 · V12 {v12Pop.toLocaleString()} 人。</div>
          </div>

          <div className="rail-card">
            <div className="rc-h">治理口径</div>
            <div className="gov-groups">
              <div className="gov-grp">
                <div className="gov-grp-h">晋升与保级</div>
                <div className="gov-list"><div className="it">门槛调整只对<b>下一轮评估</b>生效,已晋升用户不降级。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">激励与资金风控</div>
                <div className="gov-list"><div className="it">发放 <b>NEX / USDT</b> 奖励会即时计入平台待付,受备付金覆盖率监控约束。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">等级权力</div>
                <div className="gov-list"><div className="it">等级越高,领导奖池投票权越大{voteWeightLabel ? <>(<b>{voteWeightLabel}</b>)</> : "(票权数据待领导池配置接入)"}。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">奖励派发</div>
                <div className="gov-list"><div className="it">奖励发放与领取记录进<b>审计日志</b>留痕。</div></div>
              </div>
            </div>
          </div>

          <div className="rail-card">
            <div className="rc-h">晋升治理<span className="tag">F.vrank.*</span></div>
            <div className="gov-list">
              <div className="it">V-Rank 不降级保护 · 当前 <b>{permanentOn ? "已开启" : "已关闭"}</b></div>
              <div className="it" style={{ marginTop: 4 }}>{permanentOn ? "已晋升用户即使下轮未达当前阶门槛,也保持现有等级。" : "已按门槛严格评估 · 未达标的高阶用户将在下轮评估降级,影响其领导池票权。"}</div>
            </div>
            {canProtect && <button type="button" className="f-cta" style={{ marginTop: 8, ...(permanentOn ? { borderColor: "var(--danger)", color: "var(--danger)" } : null) }} onClick={() => ctx.openActionConfirm({
              name: permanentOn ? "关闭 V-Rank 不降级保护" : "开启 V-Rank 不降级保护",
              op: "dispose", paramKey: "F.vrank.permanent", fixedVal: permanentOn ? "off" : "on",
              detail: permanentOn
                ? "关闭不降级保护 · 下轮评估起,未达当前阶门槛的用户将被降级,影响其等级身份与领导池票权,属高风险动作,写 A2 审计。"
                : "开启不降级保护 · 已晋升用户即使下轮未达门槛也保持当前阶 · 仅对新晋升按门槛判定,写 A2 审计。",
            })}>{permanentOn ? "关闭不降级保护" : "开启不降级保护"}</button>}
          </div>

          <div className="rail-card">
            <div className="rc-h">全局展示文案<span className="tag">F.prize.*</span></div>
            <div className="gov-list">
              <div className="it">V-Rank 体系全局奖品名 · 当前 <b>{prizeName || "未配置"}</b></div>
              <div className="it" style={{ marginTop: 4 }}>用于 PC 与客户端展示,不影响资金计算与晋升判定。</div>
            </div>
            {canWrite && <button type="button" className="f-cta" style={{ marginTop: 8 }} onClick={() => ctx.openActionConfirm({
              name: prizeName ? "修改全局奖品名" : "配置全局奖品名",
              op: "param",
              paramKey: "F.prize.name",
              edit: { kind: "text", current: prizeName, unit: "V-Rank 全局奖品名" },
              detail: "V-Rank 晋升体系的全局唯一奖品名称,用于 PC 与客户端展示;不影响资金计算与晋升判定。",
            })}>{prizeName ? "修改奖品名" : "配置奖品名"}</button>}
          </div>

          <div className="rail-card">
            <div className="rc-h">13 阶头衔<span className="tag">F.vrank.titles</span></div>
            <div className="gov-list">
              <div className="it">V0-V12 各阶展示头衔 · 已配 <b>{Object.keys(titlesByLevel).length}</b>/13 阶</div>
              <div className="it" style={{ marginTop: 4 }}>用于 PC 与客户端等级名称展示 · 不影响资金计算与晋升判定。</div>
            </div>
            {canWrite && <button type="button" className="f-cta" style={{ marginTop: 8 }} onClick={() => ctx.openActionConfirm({
              name: "V-Rank 13 阶头衔调整",
              businessForm: {
                kind: "multi-field",
                title: "V-Rank 13 阶头衔",
                hint: "V0-V12 各阶展示头衔 · 13 阶均须非空 · 用于 PC 与客户端等级名称展示 · 不影响资金计算与晋升判定。",
                fields: rows.map((r) => ({
                  key: r.v,
                  label: r.v,
                  current: titlesByLevel[r.v] ?? "",
                  inputKind: "text" as const,
                  placeholder: `${r.v} 头衔`,
                })),
              },
              detail: "V-Rank 13 阶展示头衔 · 13 阶均须非空 · 不影响资金计算与晋升判定 · 用于 PC 与客户端展示。",
              run: async (reason, bv) => {
                if (!bv) throw new Error("请填写头衔");
                const titles: Record<string, string> = {};
                for (const r of rows) {
                  const t = (bv[r.v] ?? "").trim();
                  if (!t) throw new Error(`请填写 ${r.v} 的头衔(13 阶均须非空)`);
                  titles[r.v] = t;
                }
                await ctx.updateF1Config("F.vrank.titles", JSON.stringify(titles), reason);
                ctx.toast("V-Rank 13 阶头衔已确认生效");
              },
            })}>配置 13 阶头衔</button>}
          </div>
          </aside>
        </div>
      </div>

      <div className="f1-flow-grid">
        <section className="f1-flow" aria-label="晋升流水">
          <div className="f1-flow-h">
            <div>
              <div className="ph-ttl">晋升流水</div>
              <div className="ph-sub">引擎 / 人工 · 资格快照 · 触发事件 · A2 审计号</div>
            </div>
            {canPromote && <button type="button" className="f-cta" onClick={openManualOverride}>人工晋升 / 回滚</button>}
          </div>
          <div className="f1-filter">
            <input aria-label="晋升用户ID" value={promotionFilters.userId} onChange={(event) => setPromotionFilter("userId", event.target.value)} placeholder="用户 ID" inputMode="numeric" />
            <select aria-label="晋升目标等级" value={promotionFilters.v} onChange={(event) => setPromotionFilter("v", event.target.value)}>
              <option value="">全部等级</option>
              {rows.map((row) => <option key={row.v} value={row.v}>{row.v}</option>)}
            </select>
            <input aria-label="晋升批次" value={promotionFilters.cohort} onChange={(event) => setPromotionFilter("cohort", event.target.value)} placeholder="批次 cohort" />
            <input aria-label="晋升开始日期" type="date" value={promotionFilters.from} onChange={(event) => setPromotionFilter("from", event.target.value)} />
            <input aria-label="晋升结束日期" type="date" value={promotionFilters.to} onChange={(event) => setPromotionFilter("to", event.target.value)} />
            <button type="button" className="f-cta" disabled={ctx.f1PromotionLoading} onClick={() => void ctx.queryPromotions(promotionFilters)}>查询</button>
          </div>
          {ctx.f1PromotionError && <div className="empty">晋升流水加载失败 · {ctx.f1PromotionError}</div>}
          <div className="f1-table-wrap">
            <table className="ctbl">
              <thead><tr><th>用户</th><th>等级变化</th><th>方式 / 批次</th><th>资格快照</th><th>触发 / 审计</th><th>时间</th></tr></thead>
              <tbody>
                {ctx.promotionRecords.map((record) => (
                  <tr key={record.id}>
                    <td><span className="cid">{record.nickname || "—"}</span><br /><span className="uid">{record.userId}</span></td>
                    <td><span className="kind-tag network">{record.fromCode || "—"} → {record.toCode || "—"}</span></td>
                    <td>{record.isManual ? "人工" : "引擎"}<br /><span className="uid">{record.operator || record.cohort || "—"}</span></td>
                    <td><details><summary>查看快照</summary><code className="f1-snapshot">{snapshotLabel(record.snapshot)}</code></details></td>
                    <td><span className="uid">{record.triggerEventId || "—"}</span><br /><span className="uid">{record.auditNo || "—"}</span></td>
                    <td className="uid">{record.createdAt || "—"}</td>
                  </tr>
                ))}
                {!ctx.f1PromotionLoading && ctx.promotionRecords.length === 0 && <tr className="empty-row"><td colSpan={6}>当前筛选无晋升流水</td></tr>}
                {ctx.f1PromotionLoading && ctx.promotionRecords.length === 0 && <tr className="empty-row"><td colSpan={6}>正在读取晋升流水…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="f1-flow-foot">当前筛选 {ctx.promotionTotal.toLocaleString()} 条 · 晋升引擎每个触发事件最多前进一阶，确保每阶权益与奖励不被跳过。{" "}{ctx.promotionNextCursor && <button type="button" className="l-btn sm" disabled={ctx.f1PromotionLoading} onClick={() => void ctx.queryPromotions({ ...promotionFilters, cursor: ctx.promotionNextCursor }, true)}>加载更早记录</button>}</div>
        </section>

        <section className="f1-flow" aria-label="奖励派发流水">
          <div className="f1-flow-h">
            <div>
              <div className="ph-ttl">奖励派发流水</div>
              <div className="ph-sub">派发状态机 · D4 账单 · 触发事件 · 重发 / 冲正</div>
            </div>
            <CodeTag tone="cyan">server-canonical</CodeTag>
          </div>
          <div className="f1-filter">
            <input aria-label="派发用户ID" value={payoutFilters.userId} onChange={(event) => setPayoutFilter("userId", event.target.value)} placeholder="用户 ID" inputMode="numeric" />
            <select aria-label="派发等级" value={payoutFilters.v} onChange={(event) => setPayoutFilter("v", event.target.value)}>
              <option value="">全部等级</option>
              {rows.map((row) => <option key={row.v} value={row.v}>{row.v}</option>)}
            </select>
            <select aria-label="奖励类型" value={payoutFilters.type} onChange={(event) => setPayoutFilter("type", event.target.value)}>
              <option value="">全部奖励</option><option value="USDT">USDT</option><option value="NEX">NEX</option><option value="VOUCHER">代金券</option><option value="SKU">SKU</option><option value="CUSTOM">自定义</option>
            </select>
            <select aria-label="派发状态" value={payoutFilters.status} onChange={(event) => setPayoutFilter("status", event.target.value)}>
              <option value="">全部状态</option><option value="PENDING_GRANT">待派发</option><option value="GRANTED">已派发</option><option value="REISSUED">已重发</option><option value="REVERSED">已冲正</option><option value="FAILED">失败</option>
            </select>
            <button type="button" className="f-cta" disabled={ctx.f1PayoutLoading} onClick={() => void ctx.queryPayouts(payoutFilters)}>查询</button>
          </div>
          {ctx.f1PayoutError && <div className="empty">派发流水加载失败 · {ctx.f1PayoutError}</div>}
          <div className="f1-table-wrap">
            <table className="ctbl">
              <thead><tr><th>派发单 / 用户</th><th>等级 / 奖励</th><th>赞助人</th><th>状态</th><th>D4 / 触发事件</th><th>时间</th><th>动作</th></tr></thead>
              <tbody>
                {ctx.payoutRecords.map((record) => {
                  const canReissue = canReissuePayout && record.status === "REVERSED";
                  const canReverse = canReversePayout && ["GRANTED", "REISSUED", "PENDING_GRANT"].includes(record.status);
                  return (
                    <tr key={record.payoutId}>
                      <td><span className="cid">{record.payoutId}</span><br /><span className="uid">用户 {record.userId}</span></td>
                      <td><span className="kind-tag peer">{record.rankCode || "—"}</span><br />{rewardPayoutLabel(record)}</td>
                      <td className="uid">{record.sponsorUserId || "—"}</td>
                      <td><span className={`f1-state st-${record.status.toLowerCase()}`}>{record.status || "UNKNOWN"}</span></td>
                      <td><span className="uid">{record.billId || "—"}</span><br /><span className="uid">{record.triggerEventId || "—"}</span></td>
                      <td className="uid">{record.reversedAt || record.grantedAt || "—"}</td>
                      <td>
                        <div className="row-acts">
                          {canReissue && <button type="button" className="unlock" onClick={() => openPayoutAction(record.payoutId, "reissue")}>重发</button>}
                          {canReverse && <button type="button" className="reject" onClick={() => openPayoutAction(record.payoutId, "reverse")}>冲正</button>}
                          {!canReissue && !canReverse && <span className="none">无可用动作</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!ctx.f1PayoutLoading && ctx.payoutRecords.length === 0 && <tr className="empty-row"><td colSpan={7}>当前筛选无奖励派发流水</td></tr>}
                {ctx.f1PayoutLoading && ctx.payoutRecords.length === 0 && <tr className="empty-row"><td colSpan={7}>正在读取派发流水…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="f1-flow-foot">当前筛选 {ctx.payoutTotal.toLocaleString()} 条 · 重发会放大资金流出并受 B1 覆盖率约束；冲正与 D4 账单保持可追溯。{" "}{ctx.payoutNextCursor && <button type="button" className="l-btn sm" disabled={ctx.f1PayoutLoading} onClick={() => void ctx.queryPayouts({ ...payoutFilters, cursor: ctx.payoutNextCursor }, true)}>加载更早记录</button>}</div>
        </section>
      </div>

      <div className="f1-chain-note">
        <b>调用链核验：</b>App 展示等级与权益 ← F1 服务端阶梯；F2 网络层级 / 同级奖、F4 领导池票权、F5 佣金审计、D4 派发账单、A2 高风险复核、A4 触发事件均以同一 V-Rank / payout 标识关联。
      </div>

      <p className="f-foot"><b>顶部稀薄、底部臃肿</b>是 V-Rank 设计意图;领导池全部分给 V{unlockRank}+ 领袖,且高阶指数票权让顶部 {topN} 名(V8+)虹吸 ≈{topConcPct}% 池子。调高 V8+ 门槛会收紧头部分润但需先核验 B1 覆盖率 · 调高低阶门槛(V1/V2)会压制新人进群速度。</p>
    </>
  );
}
