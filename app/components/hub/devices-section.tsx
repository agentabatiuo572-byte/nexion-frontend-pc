"use client";

/**
 * 360 HUB · 设备卡(单用户算力设备 CRUD)— C1·deepening。
 * 真交互层:下线/上线/换机/回收 经 confirm(Maker-Checker 复核)后**真实改 useUserOps state** → 行状态/在线数/今日产出立即更新 + 写审计流。
 * 真后台:每动作对应 server-canonical 端点(POST /api/admin/devices/{id}/{deactivate|activate|replace|recycle},Idempotency-Key)。salvage 不入余额。
 * CGM: CGM-C devices[].* / CGM-E activate/deactivate/replace/recycle。
 */
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Cpu, ArrowUpRight, ShieldAlert } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserDevices } from "@/lib/mock/admin/user-360";
import { useUserOps, useOpsHydrated, type OpsDevice } from "@/lib/store/admin/user-ops-store";
import { fmtUsd } from "@/lib/format";
import { confirm, toast } from "@/lib/store/ui";
import { StatusPill } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric, HubActBtn } from "./hub-kit";

export function DevicesSection({ user }: { user: AdminUser }) {
  const seed = useMemo<OpsDevice[]>(() => getUserDevices(user.id, user.deviceCount), [user.id, user.deviceCount]);
  const hydrated = useOpsHydrated();
  const ensure = useUserOps((s) => s.ensure);
  const stored = useUserOps((s) => s.users[user.id]?.devices);
  const deviceToggle = useUserOps((s) => s.deviceToggle);
  const deviceRecycle = useUserOps((s) => s.deviceRecycle);
  const deviceSwap = useUserOps((s) => s.deviceSwap);

  useEffect(() => {
    if (hydrated) ensure(user.id, seed);
  }, [hydrated, user.id, seed, ensure]);

  const devices = hydrated && stored ? stored : seed;
  const active = devices.filter((d) => !d.recycled);
  const online = active.filter((d) => d.online).length;
  const todaySum = active.reduce((s, d) => s + d.todayEarningsUsd, 0);

  async function doToggle(d: OpsDevice) {
    const goOnline = !d.online;
    const ok = await confirm({
      title: goOnline ? "上线设备?" : "下线设备?",
      message: `${goOnline ? "恢复" : "停止"}「${d.name} ${d.id}」算力产出 · 第二角色复核后 server 原子执行 + 审计留痕。`,
      confirmLabel: goOnline ? "确认上线" : "确认下线",
      danger: !goOnline,
    });
    if (ok) {
      deviceToggle(user.id, d.id);
      toast.success(goOnline ? "设备已上线" : "设备已下线", `${user.id} · ${d.id}`);
    }
  }
  async function doRecycle(d: OpsDevice) {
    const ok = await confirm({ title: "回收设备?", message: `回收「${d.name} ${d.id}」:停止产出并退出车队,salvage 残值不入余额。需第二角色复核 + 审计。`, confirmLabel: "确认回收", danger: true });
    if (ok) {
      deviceRecycle(user.id, d.id);
      toast.success("设备已回收", `${user.id} · ${d.id}`);
    }
  }
  async function doSwap(d: OpsDevice) {
    const ok = await confirm({ title: "换机?", message: `为「${d.name} ${d.id}」更换新代际硬件(G${d.generation} → G${d.generation + 1})。需第二角色复核 + 审计。`, confirmLabel: "确认换机" });
    if (ok) {
      deviceSwap(user.id, d.id);
      toast.success("已换机", `${user.id} · ${d.id} → G${d.generation + 1}`);
    }
  }

  return (
    <HubCard icon={<Cpu size={15} style={{ color: "var(--admin-domain-e)" }} />} title="设备卡 · 单用户算力设备 CRUD" tag="C1·deepening · 真状态写 · MC 双签">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="设备总数" value={`${active.length}`} accent="var(--admin-domain-e)" />
        <HubMetric label="在线" sub={`/ ${active.length} 台`} value={`${online}`} accent={online > 0 ? "var(--v5-success)" : "var(--v5-ink-4)"} />
        <HubMetric label="今日产出" sub="在线设备合计" value={fmtUsd(todaySum)} />
        <HubMetric label="活跃上限" sub="每户上限" value="6" />
      </div>

      <div className="mt-3 overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
        <div className="max-h-[280px] overflow-y-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr style={{ background: "var(--v5-surface-2)" }}>
                {["设备", "状态", "激活", "今日产出", "代际/负载", "操作"].map((h, i) => (
                  <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 3 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid var(--v5-border)", opacity: d.recycled ? 0.5 : 1 }}>
                  <td className="px-2.5 py-1.5"><span style={{ color: "var(--v5-ink)" }}>{d.name}</span> <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{d.id}</span></td>
                  <td className="px-2.5 py-1.5">
                    <StatusPill label={d.recycled ? "已回收" : d.online ? "在线" : "离线"} tone={d.recycled ? "danger" : d.online ? "success" : "neutral"} size="sm" dot={false} />
                  </td>
                  <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{d.activatedAt}</td>
                  <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: d.online ? "var(--v5-ink)" : "var(--v5-ink-4)" }}>{fmtUsd(d.todayEarningsUsd)}</td>
                  <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>G{d.generation} · {d.gpuUsage}%</td>
                  <td className="px-2.5 py-1.5">
                    {d.recycled ? (
                      <span className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {d.online ? <HubActBtn label="下线" onClick={() => doToggle(d)} danger /> : <HubActBtn label="上线" onClick={() => doToggle(d)} />}
                        {d.kind !== "phone" && <HubActBtn label="换机" onClick={() => doSwap(d)} />}
                        {d.kind !== "phone" && <HubActBtn label="回收" onClick={() => doRecycle(d)} danger />}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-1 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <ShieldAlert size={12} /> <AutoGloss>下线/上线/换机/回收 = server-canonical action 端点 + Maker-Checker 双签 + 审计;批量调度/衰减曲线见</AutoGloss>
        <Link href="/devices/ops" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-e)" }}>E7 设备处置<ArrowUpRight size={11} /></Link>。
      </p>
    </HubCard>
  );
}
