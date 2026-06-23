"use client";

/** F1 · V-Rank 晋升 —— 13 阶阶梯(V-badge 热度渐变 + log 人口条)+ 右栏人口金字塔 / 治理口径。
 *  奖励改为运营可配的「奖励清单」(USDT / NEX / 代金券 / SKU / 自定义),实物奖与发货队列已删。 */
import { CodeTag } from "../design-kit";
import type { BusinessFormValue } from "../design-kit";
import { VRANK } from "./data";
import type { FViewCtx } from "./types";
import type { OpsVRankRewardItem, VRankRewardType } from "@/lib/store/admin/platform-config-store";

const LOG_MAX = Math.log10(84231);
function popPct(p: number): number { return p <= 0 ? 0 : Math.max(2, (Math.log10(Math.max(p, 1)) / LOG_MAX) * 100); }
function pyrPct(p: number): number { return p <= 0 ? 0 : Math.max(3, (Math.log10(Math.max(p, 1)) / LOG_MAX) * 100); }
function popColor(i: number): string { return i <= 2 ? "var(--cyan)" : i <= 5 ? "var(--brand)" : i <= 7 ? "var(--warning)" : "var(--brand-2)"; }

type VRow = (typeof VRANK)[number];
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
  // 门槛改为每子值单独单值「调整」(不再一个文本框手打「自买 $299 · 直推 3」整串);展示行由各字段合成可读串。
  const fg = (r: VRow, k: string, dflt: string): string => ctx.pget(`F.vrank.${r.v}.${k}`) ?? dflt;
  const rewardsOf = (v: string): OpsVRankRewardItem[] => ctx.rewards[v] ?? [];
  const hasFundReward = (v: string): boolean => rewardsOf(v).some((it) => isFund(it.type));
  const composeTh = (r: VRow): string => {
    const p: string[] = [];
    if (r.selfBuy != null) p.push(`自买 ${fg(r, "selfBuy", r.selfBuy)}`);
    if (r.teamGv != null) p.push(`团队 GV ${fg(r, "teamGv", r.teamGv)}`);
    if (r.directRefs != null) p.push(`直推 ${fg(r, "directRefs", r.directRefs)}`);
    if (r.legCount != null) p.push(`${fg(r, "legCount", r.legCount)} 条分支 · 每条 ≥${fg(r, "legRank", r.legRank ?? "")}`);
    return p.length ? p.join(" · ") : "—";
  };
  const fieldsOf = (r: VRow): VField[] => {
    const f: VField[] = [];
    if (r.selfBuy != null) f.push({ k: "selfBuy", label: "自买额", cur: r.selfBuy, kind: "text" });
    if (r.teamGv != null) f.push({ k: "teamGv", label: "团队GV", cur: r.teamGv, kind: "text" });
    if (r.directRefs != null) f.push({ k: "directRefs", label: "直推数", cur: r.directRefs, kind: "number" });
    if (r.legCount != null) f.push({ k: "legCount", label: "达标分支数", cur: r.legCount, kind: "number" });
    // 分支最低等级 = V-Rank 13 阶有限枚举(运营从已存在等级里勾选,不手输「V3」串)。
    if (r.legRank != null) f.push({ k: "legRank", label: "分支最低等级", cur: r.legRank, kind: "text", options: VRANK.map((x) => x.v) });
    return f;
  };
  const editField = (r: VRow, f: VField) => {
    const fund = hasFundReward(r.v);
    const cur = fg(r, f.k, f.cur);
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
      run: (reason, bv) => {
        if (!bv) return;
        const item: OpsVRankRewardItem = { id: genRewardId(), ...rewardFields(bv) };
        ctx.addReward(r.v, item, reason);
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
      run: (reason, bv) => {
        if (!bv) return;
        ctx.updateReward(r.v, item.id, rewardFields(bv), reason);
        ctx.toast(`${r.v} · 奖励已更新`);
      },
    });
  };
  const openRemoveReward = (r: VRow, item: OpsVRankRewardItem) => {
    ctx.openActionConfirm({
      name: `${r.v} · 移除奖励`,
      detail: `移除 ${r.v} 等级的奖励「${rewardLabel(item, ctx.voucherLabels, ctx.skuLabels)}」。移除后该奖励不再发放;已派发的不回收。`,
      run: (reason) => {
        ctx.removeReward(r.v, item.id, reason);
        ctx.toast(`${r.v} · 已移除奖励`);
      },
    });
  };

  const configuredLevels = VRANK.filter((r) => rewardsOf(r.v).length > 0).length;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">总会员</div><div className="v">100,575</div><div className="sub">含 V0 84,231</div></div>
        <div className="f-stat ok"><div className="k">V3+ 高价值</div><div className="v">614</div><div className="sub">≈ 0.61% · 顶部漏斗</div></div>
        <div className="f-stat cyan"><div className="k">本月晋升</div><div className="v">+217</div><div className="sub">V1 +148 · V2 +43 · V3+ +26</div></div>
        <div className="f-stat cyan"><div className="k">已配奖励等级</div><div className="v">{configuredLevels}</div><div className="sub">全 13 阶 · 运营可增删</div></div>
      </div>

      <div className="f1-main">
        <section className="ladder">
          <div className="ladder-h">
            <span className="ph-ttl">V-Rank 13 阶阶梯</span>
            <span className="ph-sub">门槛 · 奖励 · 在册人数</span>
            <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">server-canonical</CodeTag></span>
          </div>
          {VRANK.map((r, i) => {
            const flds = fieldsOf(r);
            const items = rewardsOf(r.v);
            return (
              <div key={r.v} className={`lrow${r.pop === 0 ? " empty" : ""}${i === VRANK.length - 1 ? " last" : ""}`}>
                <div className={`vbadge v-${i}`}>{r.v}</div>
                <div className="lcell"><div className="l1">{composeTh(r)}</div><div className="l2">F.vrank.{r.v}</div></div>
                <div className="lcell">
                  <div className="rwd-list">
                    {items.map((it) => (
                      <span key={it.id} className={`rwd-chip rw-${it.type}`}>
                        <button type="button" className="rwd-edit" title={`编辑 ${r.v} 奖励`} onClick={() => openEditReward(r, it)}>{rewardLabel(it, ctx.voucherLabels, ctx.skuLabels)}</button>
                        <button type="button" className="rwd-del" title="移除奖励" onClick={() => openRemoveReward(r, it)}>×</button>
                      </span>
                    ))}
                    <button type="button" className="rwd-add" title={`为 ${r.v} 新增奖励`} onClick={() => openAddReward(r)}>＋ 加奖励</button>
                  </div>
                </div>
                <div className="pop">
                  <div className="bar"><div className="f" style={{ width: `${popPct(r.pop)}%`, background: popColor(i) }} /></div>
                  <div className="ct">{r.pop.toLocaleString()}</div>
                </div>
                <div className="lact">
                  {flds.map((f) => (
                    <button key={f.k} className={`fbtn ${toneOf(f.k)}`} title={`调整${r.v} ${f.label}`} onClick={() => editField(r, f)}>{f.label}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="rail">
          <div className="rail-card">
            <div className="rc-h">人口金字塔<span className="tag">log</span></div>
            <div className="pyr">
              {[...VRANK].reverse().map((r) => {
                const idx = VRANK.findIndex((x) => x.v === r.v);
                const zero = r.pop === 0;
                return (
                  <div key={r.v} className="pyr-row">
                    <span className="lbl">{r.v}</span>
                    <div className={`b${idx >= 6 ? " top" : ""}`} style={zero ? { width: 1, opacity: 0.18 } : { width: `${pyrPct(r.pop)}%` }} />
                    <span className="ct">{r.pop.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 6, lineHeight: 1.5 }}>log 标尺以可视化顶部稀薄分布 · V8+ 仅 1 人;V12 至今 0 人。</div>
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
                <div className="gov-list"><div className="it">等级越高,领导奖池投票权越大(<b>V3=1 票 … V12=512 票</b>)。</div></div>
              </div>
              <div className="gov-grp">
                <div className="gov-grp-h">奖励派发</div>
                <div className="gov-list"><div className="it">奖励发放与领取记录进<b>审计日志</b>留痕。</div></div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <p className="f-foot"><b>顶部稀薄、底部臃肿</b>是 V-Rank 设计意图;V3+ 仅占 0.61% 但承担 80% 领导池分配。调高 V8+ 门槛会收紧头部分润但需先核验 B1 覆盖率 · 调高低阶门槛(V1/V2)会压制新人进群速度。</p>
    </>
  );
}
