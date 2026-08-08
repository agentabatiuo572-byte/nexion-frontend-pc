"use client";

/**
 * LoginGate — 后台账号密码登录。
 */
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Loader2, LockKeyhole, LogIn, ShieldCheck, UserRound } from "lucide-react";
import { changeAdminPassword, currentAdminSession, loginAdmin, verifyAdminMfa, type AdminMfaChallenge, type LoginResult } from "@/lib/admin/auth-client";
import { completeInteractiveLogin } from "@/lib/admin/login-completion";
import { createTotpEnrollmentQrDataUrl, validatedManualTotpKey } from "@/lib/admin/mfa-enrollment-qr";
import { useAdminAuth } from "@/lib/store/admin-auth";

function strongPassword(value: string) {
  const normalized = value.trim();
  return normalized.length >= 16
    && /[a-z]/.test(normalized)
    && /[A-Z]/.test(normalized)
    && /\d/.test(normalized)
    && /[^A-Za-z0-9]/.test(normalized);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function LoginGate({ onAuthenticated }: { onAuthenticated?: () => void } = {}) {
  const signIn = useAdminAuth((s) => s.signIn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<AdminMfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [pendingLogin, setPendingLogin] = useState<LoginResult | null>(null);
  const [currentPasswordForChange, setCurrentPasswordForChange] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const enrollmentQrDataUrl = useMemo(
    () => mfaChallenge?.mode === "ENROLL"
      ? createTotpEnrollmentQrDataUrl(mfaChallenge.provisioningUri)
      : null,
    [mfaChallenge],
  );
  const enrollmentManualKey = useMemo(
    () => mfaChallenge?.mode === "ENROLL"
      ? validatedManualTotpKey(mfaChallenge.provisioningUri, mfaChallenge.manualKey)
      : null,
    [mfaChallenge],
  );

  async function finishInteractiveLogin(result: LoginResult) {
    await completeInteractiveLogin(signIn, result, {
      readAuthoritativeSession: currentAdminSession,
    });
    setError("");
    onAuthenticated?.();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError("请输入账号和密码");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await loginAdmin(normalizedUsername, password);
      setCurrentPasswordForChange(password);
      setPassword("");
      setMfaCode("");
      if (result.loginResult) {
        if (result.loginResult.session.passwordChangeRequired) {
          setPendingLogin(result.loginResult);
          setNewPassword("");
          setConfirmPassword("");
          return;
        }
        setCurrentPasswordForChange("");
        setUsername("");
        await finishInteractiveLogin(result.loginResult);
        return;
      }
      if (!result.mfaChallenge) {
        throw new Error("登录状态无效，请重试");
      }
      setMfaChallenge(result.mfaChallenge);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge || !/^\d{6}$/.test(mfaCode.trim())) {
      setError("请输入身份验证器中的 6 位一次性验证码");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await verifyAdminMfa(mfaChallenge.challengeId, mfaCode);
      if (result.session.passwordChangeRequired) {
        setMfaChallenge(null);
        setMfaCode("");
        setPendingLogin(result);
        setNewPassword("");
        setConfirmPassword("");
        return;
      }
      await finishInteractiveLogin(result);
      setMfaChallenge(null);
      setMfaCode("");
      setCurrentPasswordForChange("");
      setUsername("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function restartEnrollment() {
    setMfaChallenge(null);
    setMfaCode("");
    setCurrentPasswordForChange("");
    setError("");
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingLogin || !currentPasswordForChange) {
      setError("请先使用初始密码登录");
      setPendingLogin(null);
      return;
    }
    if (!strongPassword(newPassword)) {
      setError("新密码至少 16 位，且必须包含大小写字母、数字和符号");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await changeAdminPassword(currentPasswordForChange, newPassword);
      await finishInteractiveLogin(result);
      setPendingLogin(null);
      setCurrentPasswordForChange("");
      setNewPassword("");
      setConfirmPassword("");
      setUsername("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const changingPassword = !!pendingLogin;
  const verifyingMfa = !!mfaChallenge;
  const enrollmentUnavailable = mfaChallenge?.mode === "ENROLL"
    && !enrollmentQrDataUrl
    && !enrollmentManualKey;

  return (
    <div
      className="flex h-screen w-screen items-center justify-center p-6"
      style={{ background: "var(--v5-bg)" }}
    >
      <form
        onSubmit={changingPassword ? handlePasswordChange : verifyingMfa ? handleMfaSubmit : handleSubmit}
        className="w-full max-w-sm rounded-[var(--admin-radius)] p-7"
        style={{
          background: "var(--v5-surface)",
          border: "1px solid var(--v5-border)",
          boxShadow: "var(--v5-card-shadow-lift-strong)",
        }}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-[9px] font-display"
          style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)", fontWeight: 600, fontSize: 18 }}
        >
          N
        </span>
        <h1 className="font-display mt-4 text-[20px]" style={{ color: "var(--v5-ink)" }}>
          {changingPassword ? "首次登录修改密码" : verifyingMfa ? "双因素身份验证" : "运营控制台登录"}
        </h1>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
          {changingPassword
            ? `登录名 ${pendingLogin?.session.username ?? ""}`
            : verifyingMfa
              ? mfaChallenge?.mode === "ENROLL" ? "首次登录，请先绑定身份验证器" : "请输入身份验证器生成的一次性验证码"
              : "请输入后台账号和密码"}
        </p>

        {!changingPassword && !verifyingMfa ? (
          <>
            <label className="mt-5 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
              账号
            </label>
            <div
              className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3"
              style={{
                background: "var(--v5-surface-3)",
                border: "1px solid var(--v5-border)",
                color: "var(--v5-ink)",
              }}
            >
              <UserRound size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                aria-label="账号"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
                style={{ color: "var(--v5-ink)" }}
              />
            </div>

            <label className="mt-4 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
              密码
            </label>
            <div
              className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3"
              style={{
                background: "var(--v5-surface-3)",
                border: "1px solid var(--v5-border)",
                color: "var(--v5-ink)",
              }}
            >
              <LockKeyhole size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-label="密码"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
                style={{ color: "var(--v5-ink)" }}
              />
            </div>
          </>
        ) : verifyingMfa ? (
          <>
            {mfaChallenge?.mode === "ENROLL" && enrollmentQrDataUrl && (
              <div
                className="mt-5 rounded-[9px] p-3 text-center text-[12px]"
                style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-2)" }}
              >
                <p>打开 Google Authenticator，点击“+”并扫描二维码：</p>
                <img
                  src={enrollmentQrDataUrl}
                  alt="Google Authenticator 绑定二维码"
                  className="mx-auto mt-3 block max-w-full rounded-[6px] bg-white"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
            )}
            {mfaChallenge?.mode === "ENROLL" && enrollmentManualKey && (
              <div className="mt-5 rounded-[9px] p-3 text-[12px]" style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-2)" }}>
                <p>无法扫码时，可手动输入以下密钥：</p>
                <code className="mt-2 block break-all select-all font-mono" style={{ color: "var(--v5-ink)" }}>{enrollmentManualKey}</code>
                <p className="mt-2" style={{ color: "var(--v5-ink-3)" }}>密钥只在本次绑定时显示，请勿发送给他人。</p>
              </div>
            )}
            {enrollmentUnavailable ? (
              <div className="mt-5 rounded-[9px] p-3 text-[12px]" role="alert" style={{ background: "color-mix(in srgb, var(--v5-danger) 10%, transparent)", color: "var(--v5-danger)" }}>
                <p>无法生成绑定信息，请返回登录页重新获取。</p>
                <button type="button" onClick={restartEnrollment} className="mt-3 underline underline-offset-2">
                  返回登录重新获取
                </button>
              </div>
            ) : (
              <>
                <label className="mt-5 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
                  一次性验证码
                </label>
                <div className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3" style={{ background: "var(--v5-surface-3)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" }}>
                  <ShieldCheck size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoComplete="one-time-code"
                    aria-label="一次性验证码"
                    className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[15px] tracking-[0.25em] outline-none"
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <label className="mt-5 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
              新密码
            </label>
            <div
              className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3"
              style={{
                background: "var(--v5-surface-3)",
                border: "1px solid var(--v5-border)",
                color: "var(--v5-ink)",
              }}
            >
              <LockKeyhole size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                aria-label="新密码"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
                style={{ color: "var(--v5-ink)" }}
              />
            </div>
            <label className="mt-4 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
              确认新密码
            </label>
            <div
              className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3"
              style={{
                background: "var(--v5-surface-3)",
                border: "1px solid var(--v5-border)",
                color: "var(--v5-ink)",
              }}
            >
              <ShieldCheck size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-label="确认新密码"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
                style={{ color: "var(--v5-ink)" }}
              />
            </div>
          </>
        )}

        {error && (
          <p className="mt-3 rounded-[8px] px-3 py-2 text-[12px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 10%, transparent)", color: "var(--v5-danger)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || enrollmentUnavailable}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-[13.5px] font-medium transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LogIn size={16} aria-hidden />}
          {changingPassword ? "确认修改并进入" : verifyingMfa ? "验证并进入" : "继续"}
        </button>
      </form>
    </div>
  );
}
