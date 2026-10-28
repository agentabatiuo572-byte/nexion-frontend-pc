"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * C6 注册与登录风险配置。
 * 数据源为后端 /registration-risk/overview；调参写 /registration-risk/params/{paramKey}。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchUserRegistrationRiskOverview,
  updateUserRegistrationRiskParam,
  type UserRegistrationRiskK1Guard,
  type UserRegistrationRiskOverview,
  type UserRegistrationRiskParam,
  UsersOutcomeUnknownError,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const EMPTY_AUTHORITIES: string[] = [];
const K1_REJECT_CODE_FALLBACK = "MULTI_ACCOUNT_PARAM_BELONGS_TO_K1";
const K1_PATH_FALLBACK = "/risk/multi-account";

// 人机验证 紧急关闭的恢复时限固定枚举，避免不可恢复的安全降级。
const CAPTCHA_RECOVERY_OPTIONS = ["30 分钟后自动恢复", "1 小时后自动恢复", "2 小时后自动恢复", "4 小时后自动恢复"];

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || String(value).trim() === "" ? fallback : String(value);
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function errorMessage(error: unknown) {
  return displayAdminError(error);
}

function newCommandKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

/** C6 三类调参共用一张表,调用点 fingerprint 已带动作类型前缀 + 目标参数键 / 配置版本
 *  (`lock|参数键|新值|版本`、`captcha-disable|…`),刷新后仍能用同一命令号重试。 */
const pendingCommandKeys = createPendingMutationStore({
  storageKey: "nexion-admin-c6-regrisk-commands-v1",
});

function numericParts(value: unknown) {
  return String(value ?? "").match(/\d+/g)?.map(Number) ?? [];
}

function formatCaptchaRestoreAt(value: unknown) {
  const raw = text(value, "");
  const deadline = new Date(raw);
  if (!raw || Number.isNaN(deadline.getTime())) return "恢复时间未知";
  return deadline.toLocaleString("zh-CN", { hour12: false });
}

function sourceLabel(value: unknown) {
  const source = text(value, "");
  const labels: Record<string, string> = {
    "nx_user_otp_challenge": "验证码记录",
    "nx_event_outbox:auth.captcha_required": "人机验证记录",
    "nx_event_outbox:auth.login_locked": "登录锁定记录",
    "nx_admin_risk_multi_account_cluster": "多账户关联记录",
    "nx_config_item:auth.risk.*": "登录风控设置",
  };
  return labels[source] ?? (source.startsWith("nx_") ? "系统记录" : source);
}

function StatCard({ tone, label, value, sub }: { tone?: string; label: string; value: string | number; sub: string }) {
  return (
    <div className={`f-stat ${tone ?? ""}`}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function rowKey(param: UserRegistrationRiskParam) {
  return text(param.key, `${text(param.group)}-${operatorCopyText(text(param.name))}`);
}

function guardKey(guard: UserRegistrationRiskK1Guard) {
  return text(guard.k1Key, text(guard.name));
}

export function C6Regrisk({ ctx }: { ctx: CCtx }) {
  const router = useRouter();
  const { toast, openActionConfirm, openConfirm } = ctx;
  const role = useAdminAuth((state) => state.session?.role ?? state.role);
  const authorities = useAdminAuth((state) => state.session?.authorities ?? EMPTY_AUTHORITIES);
  const canWrite = role === "super" || role === "superadmin" || authorities.includes("user_c6_write");
  const [overview, setOverview] = useState<UserRegistrationRiskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchUserRegistrationRiskOverview();
      setOverview(data);
      setError(null);
      return true;
    } catch (err) {
      setOverview(null);
      setError(`加载失败 · ${errorMessage(err)}`);
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const perform = useCallback(async (
    fingerprint: string,
    work: (commandKey: string) => Promise<string>,
    fallback: string,
  ) => {
    setBusy(true);
    const commandKey = pendingCommandKeys.get(fingerprint) ?? newCommandKey("c6-command");
    pendingCommandKeys.remember(fingerprint, commandKey);
    let writeReturned = false;
    try {
      const message = await work(commandKey);
      writeReturned = true;
      const refreshed = await loadData(true);
      if (!refreshed) {
        throw new Error("可能已生效，但页面没刷新出来。请刷新查看，重试不会重复执行");
      }
      pendingCommandKeys.forget(fingerprint);
      toast(message || fallback);
      return true;
    } catch (err) {
      if (!writeReturned && !(err instanceof UsersOutcomeUnknownError)) {
        pendingCommandKeys.forget(fingerprint);
      }
      const message = errorMessage(err);
      setOverview(null);
      setError(`操作失败 · ${message}`);
      toast(`操作失败 · ${message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">注册与登录风险</span><span className="sub">· 加载失败时暂停所有操作</span></div>
        <div className="l-b">
          <div className={`ctint ${error ? "bad" : ""}`} role={error ? "alert" : "status"}>
            {loading ? "正在加载…" : (error ?? "数据暂不可用，已暂停显示和修改。")}
          </div>
          {!loading && <button className="l-btn" style={{ marginTop: 12 }} onClick={() => void loadData()}>重新加载</button>}
        </div>
      </section>
    );
  }

  const params = overview.params ?? [];
  const otpParams = params.filter((param) => param.group === "otp");
  const lockParams = params.filter((param) => param.group === "lock");
  const otpCaptchaAfterSends = overview.captchaAfterSends!;
  const otpCaptchaStart = otpCaptchaAfterSends + 1;
  const captchaRestoreAt = overview.stats?.captchaTemporarilyDisabled ? text(overview.stats.captchaRestoreAt, "") : "";
  const configVersion = toNumber(overview.configVersion, -1);
  const k1Guards = overview?.k1Guards ?? [];
  const k1RejectCode = text(overview?.k1RejectCode, K1_REJECT_CODE_FALLBACK);
  const k1Path = text(overview?.k1Path, K1_PATH_FALLBACK);

  const adjustRow = (param: UserRegistrationRiskParam) => {
    const key = param.key;
    const currentValue = text(param.value, "");
    const [currentAttempts = 0, currentDuration = 0] = numericParts(currentValue);
    const shortAttempts = numericParts(lockParams.find((row) => row.key === "lockShort")?.value)[0] ?? 0;
    const longAttempts = numericParts(lockParams.find((row) => row.key === "lockLong")?.value)[0] ?? Number.MAX_SAFE_INTEGER;
    const attemptMin = toNumber(param.min, 0);
    const attemptMax = toNumber(param.max, 0);
    const durationMin = toNumber(param.secondaryMin, 0);
    const durationMax = toNumber(param.secondaryMax, 0);
    const durationUnit = text(param.secondaryUnit, key === "lockLong" ? "小时" : "分钟");
    return (
      <div className="p-row" key={rowKey(param)}>
        <div className="txt">
          <div className="k">{operatorCopyText(text(param.name))}</div>
          <div className="s">{operatorCopyText(text(param.sub, text(param.note)))}</div>
        </div>
        <span className="v">{text(param.value)}</span>
        <button
          className="l-btn sm mc"
          title={canWrite ? undefined : "你只有查看权限"}
          disabled={!canWrite || busy || !key || !!param.readOnly}
          onClick={() => openActionConfirm({
            action: `调整登录锁定 · ${operatorCopyText(text(param.name))}`,
            detail: <><b>{operatorCopyText(text(param.name))}</b> · 当前 {text(param.value)} · 次数可设 {attemptMin}–{attemptMax}，时长可设 {durationMin}–{durationMax} {durationUnit}。长时锁定的次数须大于短时锁定。</>,
            amplifies: false,
            businessForm: {
              kind: "multi-field",
              title: operatorCopyText(text(param.name)),
              hint: `次数和时长会一起保存（当前版本 ${configVersion}）`,
              fields: [
                { key: "attempts", label: "输错几次后锁定", inputKind: "number", current: String(currentAttempts), min: toNumber(param.min, 0), max: toNumber(param.max, 0), step: 1, required: true },
                { key: "duration", label: `锁定时长(${durationUnit})`, inputKind: "number", current: String(currentDuration), min: toNumber(param.secondaryMin, 0), max: toNumber(param.secondaryMax, 0), step: 1, required: true },
              ],
            },
            run: async (reason, _nextValue, businessValue) => {
              const attempts = Number(businessValue?.attempts);
              const duration = Number(businessValue?.duration);
              if (!key || !Number.isInteger(attempts) || !Number.isInteger(duration)) {
                toast("请填写有效的整数次数和锁定时长");
                return false;
              }
              if ((key === "lockShort" && attempts >= longAttempts)
                || (key === "lockLong" && attempts <= shortAttempts)) {
                toast("长时锁定的次数须大于短时锁定，未保存");
                return false;
              }
              const value = `${attempts} 次 / ${duration} ${durationUnit}`;
              return perform(`lock|${key}|${value}|${configVersion}|${reason}`, async (commandKey) => {
                await updateUserRegistrationRiskParam(key, value, reason, OPERATOR(), configVersion, commandKey);
                return `${operatorCopyText(text(param.name))} 已更新为 ${value}`;
              }, "登录锁定规则已更新");
            },
          })}
        >
          {!canWrite || param.readOnly ? "只能查看" : "调整"}
        </button>
      </div>
    );
  };

  const otpMirrorRow = (param: UserRegistrationRiskParam) => (
    <div className="p-row" key={rowKey(param)}>
      <div className="txt">
        <div className="k">{operatorCopyText(text(param.name))} <span className="bdg dim">在别处设置</span></div>
        <div className="s">{operatorCopyText(text(param.sub, text(param.note)))}。这里只显示当前值，修改请到「异常套利与刷量排查」。</div>
      </div>
      <span className="v">{text(param.value)}</span>
      <Link className="l-btn sm" href="/risk/abuse">去修改</Link>
    </div>
  );

  const restoreCaptcha = () => {
    if (!canWrite) {
      toast("你只有查看权限，不能恢复人机验证");
      return;
    }
    openConfirm({
    action: "恢复人机验证",
    detail: "人机验证立即恢复拦截。",
    reason: true,
    okLabel: "确认恢复",
    run: (reason) => {
      return perform(`captcha-restore|${configVersion}|${reason}`, async (commandKey) => {
        await updateUserRegistrationRiskParam("captchaOff", "", reason, OPERATOR(), configVersion, commandKey);
        return "人机验证已恢复";
      }, "人机验证已恢复");
    },
    });
  };

  const disableCaptcha = () => {
    if (!canWrite) {
      toast("你只有查看权限，不能关闭人机验证");
      return;
    }
    openActionConfirm({
    action: "紧急关闭人机验证",
    detail: <><b>关闭后，同一手机号频繁发验证码将不再被拦截</b>。只在人机验证服务出故障时使用，须选择恢复时间，到时自动开回。</>,
    amplifies: false,
    edit: { kind: "select", current: CAPTCHA_RECOVERY_OPTIONS[0], options: CAPTCHA_RECOVERY_OPTIONS },
    run: (reason, nextValue) => {
      const value = (nextValue ?? "").trim();
      if (!CAPTCHA_RECOVERY_OPTIONS.includes(value)) {
        toast("请选择恢复时间");
        return false;
      }
      return perform(`captcha-disable|${value}|${configVersion}|${reason}`, async (commandKey) => {
        await updateUserRegistrationRiskParam("captchaOff", value, reason, OPERATOR(), configVersion, commandKey);
        return `人机验证已临时关闭 · ${value}`;
      }, "人机验证已临时关闭");
    },
    });
  };

  const k1Confirm = (guard: UserRegistrationRiskK1Guard) => openConfirm({
    action: `422 · ${text(guard.rejectCode, k1RejectCode)}`,
    detail: <><b>{operatorCopyText(text(guard.name))}</b> 只能在「多账户风险排查」修改。</>,
    chips: [["在多账户风险排查修改", "done"]],
    okLabel: "去修改",
    run: () => {
      router.push(text(guard.suggestedPath, k1Path));
    },
  });

  return (
    <>
      <div className="f-stats">
        <StatCard
          label="今日发送短信验证码"
          value={toNumber(overview?.stats?.otpToday).toLocaleString("en-US")}
          sub={`触发人机验证 ${toNumber(overview?.stats?.captchaTriggeredToday).toLocaleString("en-US")} 次`}
        />
        <StatCard
          tone="warn"
          label="今日登录锁定"
          value={toNumber(overview?.stats?.locked)}
          sub={`短时 ${toNumber(overview?.stats?.lockedShort)} · 长时 ${toNumber(overview?.stats?.lockedLong)}`}
        />
        {captchaRestoreAt ? (
          <StatCard tone="danger" label="人机验证" value="临时关闭" sub={`将于 ${formatCaptchaRestoreAt(captchaRestoreAt)} 自动恢复`} />
        ) : (
          <StatCard tone="ok" label="人机验证" value="开启" sub={`同一手机号 24 小时内发满 ${otpCaptchaAfterSends} 次验证码后，从第 ${otpCaptchaStart} 次起要拖动滑块`} />
        )}
        <StatCard
          tone="cyan"
          label="批量试密码（7 天）"
          value={`${toNumber(overview?.stats?.stuffingClusters7d)} 组`}
          sub="同一 IP 大量试密码，已同步到多账户风险排查"
        />
      </div>

      {error && <div className="ctint bad" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>正在加载…</div>}

      <div className="sec-grid">
        <section className="l-card">
          <div className="l-h"><span className="ttl">短信验证码</span><span className="sub">· 只能查看，修改请到「异常套利与刷量排查」</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {otpParams.map(otpMirrorRow)}
            {otpParams.length === 0 && <div className="ctint">暂无短信验证码设置</div>}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">App 用户输错锁定</span><span className="sub">· 解锁用户请到「安全与登录设备」</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {lockParams.map(adjustRow)}
            {lockParams.length === 0 && <div className="ctint">暂无锁定参数</div>}
            <div className="p-row">
              <div className="txt"><div className="k">怎么计数</div><div className="s">同时按 IP 和账户计数，用户在 App 上能看到解锁倒计时</div></div>
              <span className="v">IP + 账户</span>
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">人机验证</span><span className="sub">· 关掉就挡不住短信轰炸，慎用</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <div className="txt"><div className="k">全局开关</div><div className="s">只在服务出故障时关，关闭时须选择恢复时间</div></div>
              {captchaRestoreAt ? (
                <>
                  <span className="v" style={{ color: "var(--danger)" }}>临时关闭 · {formatCaptchaRestoreAt(captchaRestoreAt)} 恢复</span>
                  <button className="l-btn sm" title={canWrite ? undefined : "你只有查看权限"} disabled={!canWrite || busy} onClick={restoreCaptcha}>{canWrite ? "立即恢复" : "只能查看"}</button>
                </>
              ) : (
                <>
                  <span className="v" style={{ color: "var(--success)" }}>开启</span>
                  <button className="l-btn sm mc" title={canWrite ? undefined : "你只有查看权限"} disabled={!canWrite || busy} onClick={disableCaptcha}>{canWrite ? "紧急关闭" : "只能查看"}</button>
                </>
              )}
            </div>
            <div className="p-row">
              <div className="txt">
                <div className="k">什么时候要求滑块 <span className="bdg dim">在别处设置</span></div>
                <div className="s">同一手机号 24 小时内发满 {otpCaptchaAfterSends} 次验证码后，从第 {otpCaptchaStart} 次起要拖动滑块。修改请到「异常套利与刷量排查」。</div>
              </div>
              <span className="v">&gt;= {otpCaptchaAfterSends} 次/24h</span>
            </div>
            <div className="ctint warn" style={{ marginTop: 10 }}><b>增长同事请注意</b> · 人机验证会影响注册转化，但它是安全开关，增长角色不能修改。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">相关设置在哪里改</span></div>
        <div className="l-b">
          <div className="split-grid">
            <div className="ctint"><b>这里改</b> · 输错锁定和人机验证开关。验证码有效期、重发间隔和滑块触发次数请到「异常套利与刷量排查」修改。</div>
            <div className="ctint"><b>「多账户风险排查」改</b> · 同一 IP 每天注册上限、同一设备绑定上限、同一支付方式绑定上限。</div>
          </div>
          {k1Guards.map((guard) => (
            <div className="p-row" key={guardKey(guard)}>
              <div className="txt">
                <div className="k">{operatorCopyText(text(guard.name))} <span className="bdg dim">在别处设置</span></div>
                <div className="s">请到「多账户风险排查」修改</div>
              </div>
              <button className="l-btn sm" onClick={() => k1Confirm(guard)}>去修改</button>
            </div>
          ))}
          {k1Guards.length === 0 && <div className="ctint" style={{ marginTop: 10 }}>暂无</div>}
          <div className="ctint" style={{ marginTop: 10 }}>
            注册数据会进入用户转化分析，登录锁定会显示在风险提醒和「安全与登录设备」，注册时发现的同 IP / 同设备会同步到多账户风险排查。
          </div>
        </div>
      </section>

      <p className="f-foot">
        锁定期间，该手机号的所有登录都会被拒绝。数据来源：{(overview?.sources ?? ["登录风控设置", "用户安全状态", "多账户风控设置"]).map(sourceLabel).join(" · ")}
      </p>
    </>
  );
}
