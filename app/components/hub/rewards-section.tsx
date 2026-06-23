"use client";

/**
 * 360 HUB · 奖励 & 代金券卡 — C1·deepening。
 * 同步显示该用户的:① 已领代金券(运营派发 + 用户自领)② 客服补偿累计(USDT/NEX)。
 * 写动作:客服补偿(USDT/NEX,复用 user-ops earningAppend — 与 C3 资产调整同源台账)
 * + 派发代金券(从现存投放券下拉选 → user-ops issueVoucher)。加钱方向 server 侧核验兑付覆盖率;
 * 代金券是促销折扣非负债、不挂红线。一切留 A2 审计。真后台对接:POST /api/users/:id/compensation、
 * POST /api/users/:id/vouchers。
 */
import { useState } from "react";
import { Gift } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { usePlatformConfig, type OpsVoucher } from "@/lib/store/admin/platform-config-store";
import { VOUCHER_SEED } from "@/lib/mock/admin/vouchers";
import { confirm, toast } from "@/lib/store/ui";
import { HubCard, HubMetric } from "./hub-kit";
import { AutoGloss } from "@/app/components/kit/gloss";

const fieldStyle: React.CSSProperties = { background: "var(--v5-surface)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" };
const ctaStyle: React.CSSProperties = { background: "var(--brand)", color: "var(--v5-on-brand)", fontWeight: 600 };

function voucherValueText(v: OpsVoucher): string {
  return v.type === "fixed" ? `满减 $${v.amountUSD ?? 0}` : `${v.percent ?? 0}% 折扣`;
}

export function RewardsSection({ user }: { user: AdminUser }) {
  const hydrated = useOpsHydrated();
  const claimed = useUserOps((s) => s.users[user.id]?.claimedVouchers);
  const balAdjUsd = useUserOps((s) => s.users[user.id]?.balanceAdjustUsd);
  const balAdjNex = useUserOps((s) => s.users[user.id]?.balanceAdjustNex);
  const earningAppend = useUserOps((s) => s.earningAppend);
  const issueVoucher = useUserOps((s) => s.issueVoucher);
  const vouchers = usePlatformConfig((s) => s.vouchers);

  const claimedIds = hydrated ? (claimed ?? []) : [];
  const compUsd = hydrated ? (balAdjUsd ?? 0) : 0;
  const compNex = hydrated ? (balAdjNex ?? 0) : 0;
  const voucherList = hydrated && vouchers ? vouchers : VOUCHER_SEED;
  const voucherById = (id: string) => voucherList.find((v) => v.id === id);
  const activeVouchers = voucherList.filter((v) => v.status === "active");

  // 客服补偿表单
  const [amt, setAmt] = useState("");
  const [ccy, setCcy] = useState<"USDT" | "NEX">("USDT");
  const [reason, setReason] = useState("");
  // 派发代金券
  const [vid, setVid] = useState("");

  const doComp = async () => {
    const n = Number(amt);
    if (!Number.isFinite(n) || n <= 0) { toast.error("金额无效", "请输入正数"); return; }
    if (reason.trim().length < 4) { toast.error("请填写补偿理由", "≥4 字,审计留痕"); return; }
    const yes = await confirm({
      title: `客服补偿 · +${n} ${ccy}`,
      message: `给 ${user.nickname}(${user.id})发放 ${n} ${ccy} 客服补偿。理由:${reason.trim()}。加钱方向 server 侧核验兑付覆盖率,A2 审计留痕。`,
      confirmLabel: "确认发放",
    });
    if (!yes) return;
    earningAppend(user.id, "补发", n, `客服补偿 · ${reason.trim()}`, ccy);
    toast.success("客服补偿已发放", `${user.id} · +${n} ${ccy}`);
    setAmt(""); setReason("");
  };

  const doIssue = async () => {
    const v = voucherById(vid);
    if (!v) { toast.error("请选择代金券"); return; }
    if (claimedIds.includes(v.id)) { toast.error("该用户已持有此券", v.name); return; }
    const yes = await confirm({
      title: `派发代金券 · ${v.name}`,
      message: `给 ${user.nickname}(${user.id})派发「${v.name}」(${voucherValueText(v)})。代金券为促销折扣、非负债,不挂兑付红线;A2 审计留痕。`,
      confirmLabel: "确认派发",
    });
    if (!yes) return;
    issueVoucher(user.id, v.id, v.name);
    toast.success("代金券已派发", `${user.id} · ${v.name}`);
    setVid("");
  };

  return (
    <HubCard
      icon={<Gift size={15} style={{ color: "var(--admin-domain-h)" }} />}
      title="奖励 & 代金券卡"
      tag="C1·deepening · 客服补偿 / 派发券"
    >
        <div className="grid grid-cols-3 gap-2.5">
          <HubMetric label="客服补偿(累计)" value={`$${compUsd.toLocaleString()}`} sub="USDT · C3/本卡发放" accent="var(--admin-domain-c)" />
          <HubMetric label="系统奖励(累计)" value={`${compNex.toLocaleString()} NEX`} sub="NEX 补偿 / 奖励" accent="var(--admin-domain-h)" />
          <HubMetric label="已领代金券" value={`${claimedIds.length} 张`} sub="运营派发 + 用户自领" />
        </div>

        {/* 已领券列表 */}
        {claimedIds.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {claimedIds.map((id) => {
              const v = voucherById(id);
              return (
                <div key={id} className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[12px]" style={{ background: "var(--v5-surface-2)" }}>
                  <span style={{ color: "var(--v5-ink)" }}>{v ? v.name : id}</span>
                  <span className="font-mono-tabular" style={{ color: "var(--v5-ink-3)" }}>{v ? voucherValueText(v) : "—"}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 客服补偿 */}
        <div className="mt-3 rounded-[9px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
          <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>客服补偿(USDT / NEX)</AutoGloss></p>
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} placeholder="金额" inputMode="decimal"
              className="rounded-[6px] px-2 py-1 text-[12px]" style={{ width: 78, ...fieldStyle }} />
            <select value={ccy} onChange={(e) => setCcy(e.target.value as "USDT" | "NEX")} className="rounded-[6px] px-2 py-1 text-[12px]" style={fieldStyle}>
              <option value="USDT">USDT</option>
              <option value="NEX">NEX</option>
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="补偿理由(≥4 字)"
              className="flex-1 rounded-[6px] px-2 py-1 text-[12px]" style={{ minWidth: 120, ...fieldStyle }} />
            <button type="button" onClick={doComp} className="rounded-[6px] px-2.5 py-1 text-[11px]" style={ctaStyle}>发放</button>
          </div>
        </div>

        {/* 派发代金券 */}
        <div className="mt-2 rounded-[9px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
          <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>派发代金券(从现存投放券选)</AutoGloss></p>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={vid} onChange={(e) => setVid(e.target.value)} className="flex-1 rounded-[6px] px-2 py-1 text-[12px]" style={{ minWidth: 160, ...fieldStyle }}>
              <option value="">选择代金券…</option>
              {activeVouchers.map((v) => <option key={v.id} value={v.id}>{v.name} · {voucherValueText(v)}</option>)}
            </select>
            <button type="button" onClick={doIssue} className="rounded-[6px] px-2.5 py-1 text-[11px]" style={ctaStyle}>派发</button>
          </div>
        </div>
      </HubCard>
  );
}
