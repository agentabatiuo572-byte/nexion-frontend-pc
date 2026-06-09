"use client";

/**
 * 360 HUB · 账户·安全·合规卡 — C1·deepening。
 * 覆盖:auth 生命周期 / KYC / 风险披露 / 改密·2FA·会话吊销 / 档案(昵称·地区·时区·语言)/ 领导池分红历史。
 * 高敏(改密/吊销会话/重置2FA)= confirm→MC 双签。CGM: A-002/K-001..005/I-001..002/C-009。
 */
import Link from "next/link";
import { UserCog, ArrowUpRight, ShieldCheck, KeyRound, Smartphone } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserAccount } from "@/lib/mock/admin/user-360";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { fmtUsd } from "@/lib/format";
import { confirm, toast } from "@/lib/store/ui";
import { StatusPill } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

export function AccountSection({ user }: { user: AdminUser }) {
  const a = getUserAccount(user.id, user.kyc, user.nickname);
  const hydrated = useOpsHydrated();
  const storeRevoked = useUserOps((s) => s.users[user.id]?.revokedSessions);
  const storeTwoFAReset = useUserOps((s) => s.users[user.id]?.twoFactorReset);
  const revoked = hydrated ? (storeRevoked ?? []) : [];
  const twoFactorReset = hydrated ? (storeTwoFAReset ?? false) : false;
  const revokeSession = useUserOps((s) => s.revokeSession);
  const resetTwoFactor = useUserOps((s) => s.resetTwoFactor);
  const opsLog = useUserOps((s) => s.log);
  const twoFactorOn = a.twoFactor && !twoFactorReset;
  const liveSessions = a.sessions.filter((s) => !revoked.includes(s.id));

  async function act(title: string, message: string, ok: string, action: string, detail: string, tone: "danger" | "warning" | "success" | "neutral", danger?: boolean) {
    const yes = await confirm({ title, message, confirmLabel: ok, danger });
    if (yes) {
      opsLog(user.id, action, detail, tone);
      toast.success(ok, `${user.id} · 已提交复核(MC 双签)`);
    }
  }
  async function doResetTwoFactor() {
    const yes = await confirm({ title: "重置两步验证?", message: `清除 ${user.nickname} 的 2FA 绑定,用户需重新设置。需第二角色复核 + 审计。`, confirmLabel: "确认重置", danger: true });
    if (yes) {
      resetTwoFactor(user.id);
      toast.success("2FA 已重置", `${user.id} · ${user.nickname}`);
    }
  }
  async function doRevoke(sid: string, device: string, loc: string) {
    const yes = await confirm({ title: "吊销该会话?", message: `使「${device} · ${loc}」登录立即失效。需第二角色复核 + 审计。`, confirmLabel: "吊销会话" });
    if (yes) {
      revokeSession(user.id, sid, `${device} · ${loc}`);
      toast.success("会话已吊销", `${user.id} · ${device}`);
    }
  }
  return (
    <HubCard icon={<UserCog size={15} style={{ color: "var(--admin-domain-a)" }} />} title="账户·安全·合规卡" tag="C1·deepening · A/K/I · 高敏 MC">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="账户状态" value={a.onboardingDone ? "已激活" : "引导中"} accent={a.onboardingDone ? "var(--v5-success)" : "var(--v5-warning)"} />
        <HubMetric label="两步验证" value={twoFactorOn ? "已开启" : twoFactorReset ? "待重设" : "未开启"} accent={twoFactorOn ? "var(--v5-success)" : twoFactorReset ? "var(--v5-warning)" : "var(--v5-ink-4)"} />
        <HubMetric label="风险披露" value={a.riskDisclosureAccepted ? "已签署" : "未签署"} accent={a.riskDisclosureAccepted ? "var(--v5-success)" : "var(--v5-danger)"} />
        <HubMetric label="活跃会话" value={`${liveSessions.length}`} sub={revoked.length ? `已吊销 ${revoked.length}` : undefined} />
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-[8px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
          <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>档案 · I 内容</p>
          <Kv k="昵称" v={a.displayName} />
          <Kv k="地区 / 时区" v={`${a.region} · ${a.timezone}`} />
          <Kv k="语言" v={`${a.locale}${a.localeUserSet ? " · 用户已设" : " · 默认"}`} />
          <Kv k="简介" v={a.bio} />
        </div>
        <div className="rounded-[8px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
          <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>安全 · 合规</p>
          <Kv k="KYC" v={a.kycStatus} />
          <Kv k="注册 / 末次登录" v={`${a.signupAt} · ${a.lastSignIn}`} />
          <Kv k="密码上次修改" v={a.passwordChangedAt} />
          <Kv k="两步验证" v={twoFactorOn ? "已开启" : twoFactorReset ? "待重设(运营已重置)" : "未开启"} />
        </div>
      </div>

      {/* 会话 + 吊销 */}
      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>登录会话</p>
      <ul className="flex flex-col gap-1.5">
        {liveSessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[11.5px]" style={{ background: "var(--v5-surface-2)" }}>
            <span className="inline-flex items-center gap-1.5" style={{ color: "var(--v5-ink)" }}>
              <Smartphone size={12} style={{ color: "var(--v5-ink-4)" }} /> {s.device} · {s.loc} · {s.lastActive}
              {s.current && <StatusPill label="当前" tone="success" size="sm" dot={false} />}
            </span>
            {!s.current && (
              <button type="button" onClick={() => doRevoke(s.id, s.device, s.loc)}
                className="rounded-[6px] px-2 py-0.5 text-[10.5px] transition-colors hover:bg-[var(--v5-surface)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}>吊销</button>
            )}
          </li>
        ))}
        {revoked.length > 0 && <li className="px-2.5 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>已吊销 {revoked.length} 个会话(本次运营操作)</li>}
      </ul>

      {/* 领导池分红历史(C-009) */}
      {a.leadershipPayouts.length > 0 && (
        <>
          <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>领导池分红历史 · F</p>
          <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
            <table className="w-full border-collapse text-[11px]">
              <thead><tr style={{ background: "var(--v5-surface-2)" }}>{["周期", "池规模", "我的票", "份额", "分红"].map((h, i) => <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i > 0 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>{a.leadershipPayouts.map((p) => (
                <tr key={p.weekId} style={{ borderTop: "1px solid var(--v5-border)" }}>
                  <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink)" }}>{p.weekId}</td>
                  <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink-3)" }}>{fmtUsd(p.poolUsd)}</td>
                  <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink-3)" }}>{p.myVotes}</td>
                  <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink-3)" }}>{p.sharePct}%</td>
                  <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-success)" }}>{fmtUsd(p.payoutUsd)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <ActBtn icon={<KeyRound size={13} />} label="强制改密" onClick={() => act("强制改密?", `要求 ${user.nickname} 下次登录重置密码。`, "确认改密", "强制改密", "下次登录强制重置密码", "warning", true)} />
        <ActBtn icon={<ShieldCheck size={13} />} label="重置 2FA" onClick={doResetTwoFactor} />
        <ActBtn label="重发 KYC 复核" onClick={() => act("重新发起 KYC 复核?", `将 ${user.nickname} 的 KYC 重新置为待复核。`, "确认", "重发 KYC 复核", "KYC 置为待复核", "neutral")} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <Link href="/risk/kyc-review" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-k)" }}>K5 KYC 复核<ArrowUpRight size={11} /></Link>
        <Link href="/platform/audit" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-a)" }}>A2 审计<ArrowUpRight size={11} /></Link>
        <AutoGloss>安全/合规动作均 MC 双签 + 审计留痕。</AutoGloss>
      </p>
    </HubCard>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[11.5px]">
      <span style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{k}</AutoGloss></span>
      <span style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{v}</AutoGloss></span>
    </div>
  );
}
function ActBtn({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
      {icon}<AutoGloss>{label}</AutoGloss>
    </button>
  );
}
