"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * C6 注册/登录风控配置。
 * 数据源为后端 /registration-risk/overview；调参写 /registration-risk/params/{paramKey}。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchUserRegistrationRiskOverview,
  updateUserRegistrationRiskParam,
  type UserRegistrationRiskK1Guard,
  type UserRegistrationRiskOverview,
  type UserRegistrationRiskParam,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const EMPTY_AUTHORITIES: string[] = [];
const K1_REJECT_CODE_FALLBACK = "MULTI_ACCOUNT_PARAM_BELONGS_TO_K1";
const K1_PATH_FALLBACK = "/risk/multi-account";

// CAPTCHA 紧急关闭的恢复时限固定枚举，避免不可恢复的安全降级。
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
  return error instanceof Error ? error.message : String(error || "C6_DATA_LOAD_FAILED");
}

function stripTimesUnit(value: unknown) {
  return text(value, "3 次").replace(/\s*次\s*$/, "");
}

function numericParts(value: unknown) {
  return String(value ?? "").match(/\d+/g)?.map(Number) ?? [];
}

function formatCaptchaRestoreAt(value: unknown) {
  const raw = text(value, "");
  const deadline = new Date(raw);
  if (!raw || Number.isNaN(deadline.getTime())) return "恢复时刻不可用";
  return deadline.toLocaleString("zh-CN", { hour12: false });
}

function sourceLabel(value: unknown) {
  const source = text(value, "");
  const labels: Record<string, string> = {
    "nx_user_otp_challenge": "验证码挑战事实",
    "nx_event_outbox:auth.captcha_required": "人机验证触发事件",
    "nx_event_outbox:auth.login_locked": "登录锁定事件",
    "nx_admin_risk_multi_account_cluster": "K1 多账户关联簇",
    "nx_config_item:auth.risk.*": "服务端登录风控配置",
  };
  return labels[source] ?? (source.startsWith("nx_") ? "服务端业务事实" : source);
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
  return text(param.key, `${text(param.group)}-${text(param.name)}`);
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
      setError(`C6 数据加载失败 · ${errorMessage(err)}`);
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const perform = useCallback(async (work: () => Promise<string>, fallback: string) => {
    setBusy(true);
    try {
      const message = await work();
      const refreshed = await loadData(true);
      if (!refreshed) return false;
      toast(message || fallback);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      setOverview(null);
      setError(`C6 操作失败 · ${message}`);
      toast(`C6 操作失败 · ${message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">注册/登录风控</span><span className="sub">· 安全失败关闭</span></div>
        <div className="l-b">
          <div className={`ctint ${error ? "bad" : ""}`} role={error ? "alert" : "status"}>
            {loading ? "C6 数据加载中，安全配置暂不可操作…" : (error ?? "C6 数据暂不可用，安全配置已停止展示和写入。")}
          </div>
          {!loading && <button className="l-btn" style={{ marginTop: 12 }} onClick={() => void loadData()}>重新加载</button>}
        </div>
      </section>
    );
  }

  const params = overview.params ?? [];
  const otpParams = params.filter((param) => param.group === "otp");
  const lockParams = params.filter((param) => param.group === "lock");
  const otpMaxParam = params.find((param) => param.key === "otpMax24h");
  const otpMaxN = stripTimesUnit(otpMaxParam?.value);
  const otpCaptchaStart = Number.isFinite(Number(otpMaxN)) ? String(Number(otpMaxN) + 1) : "N+1";
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
          <div className="k">{text(param.name)}</div>
          <div className="s">{text(param.sub, text(param.note))}</div>
        </div>
        <span className="v">{text(param.value)}</span>
        <button
          className="l-btn sm mc"
          title={canWrite ? undefined : "当前账号只有 C6 读取权限"}
          disabled={!canWrite || busy || !key || !!param.readOnly}
          onClick={() => openActionConfirm({
            action: `登录风控参数 · ${text(param.name)}`,
            detail: <><b>{text(param.name)}</b> · 当前 {text(param.value)} · 次数范围 {attemptMin}-{attemptMax}，时长范围 {durationMin}-{durationMax} {durationUnit}。长锁次数必须大于短锁次数。</>,
            amplifies: false,
            businessForm: {
              kind: "multi-field",
              title: `${text(param.name)}结构化参数`,
              hint: `服务端将两项参数作为同一事务提交；当前配置版本 ${configVersion}`,
              fields: [
                { key: "attempts", label: "触发次数", inputKind: "number", current: String(currentAttempts), min: toNumber(param.min, 0), max: toNumber(param.max, 0), step: 1, required: true },
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
                toast("长锁触发次数必须大于短锁触发次数，未执行");
                return false;
              }
              const value = `${attempts} 次 / ${duration} ${durationUnit}`;
              return perform(async () => {
                await updateUserRegistrationRiskParam(key, value, reason, OPERATOR(), configVersion);
                return `${text(param.name)} 已更新为 ${value}`;
              }, "登录风控参数已更新");
            },
          })}
        >
          {!canWrite || param.readOnly ? "只读" : "调整"}
        </button>
      </div>
    );
  };

  const otpMirrorRow = (param: UserRegistrationRiskParam) => (
    <div className="p-row" key={rowKey(param)}>
      <div className="txt">
        <div className="k">{text(param.name)} <span className="bdg dim">K2 唯一入口</span></div>
        <div className="s">{text(param.sub, text(param.note))}；C6 仅展示服务端当前值，避免两处配置打架。</div>
      </div>
      <span className="v">{text(param.value)}</span>
      <Link className="l-btn sm" href="/risk/abuse">去 K2 调整</Link>
    </div>
  );

  const restoreCaptcha = () => {
    if (!canWrite) {
      toast("当前账号只有 C6 读取权限，不能恢复人机验证");
      return;
    }
    openConfirm({
    action: "恢复人机验证",
    detail: "立即恢复 CAPTCHA 拦截；服务端会清除临时关闭时限并保留操作记录。",
    reason: true,
    okLabel: "确认恢复",
    run: (reason) => {
      return perform(async () => {
        await updateUserRegistrationRiskParam("captchaOff", "", reason, OPERATOR(), configVersion);
        return "人机验证已恢复";
      }, "人机验证已恢复");
    },
    });
  };

  const disableCaptcha = () => {
    if (!canWrite) {
      toast("当前账号只有 C6 读取权限，不能关闭人机验证");
      return;
    }
    openActionConfirm({
    action: "紧急关闭人机验证",
    detail: <><b>关闭 = 同号验证码超频不再拦截</b>。只用于人机验证服务商故障等系统级紧急维护，必须选择恢复时限，到点自动开回。</>,
    amplifies: false,
    edit: { kind: "select", current: CAPTCHA_RECOVERY_OPTIONS[0], options: CAPTCHA_RECOVERY_OPTIONS },
    run: (reason, nextValue) => {
      const value = (nextValue ?? "").trim();
      if (!CAPTCHA_RECOVERY_OPTIONS.includes(value)) {
        toast("必须选择有效恢复时限，未执行");
        return false;
      }
      return perform(async () => {
        await updateUserRegistrationRiskParam("captchaOff", value, reason, OPERATOR(), configVersion);
        return `人机验证已临时关闭 · ${value}`;
      }, "人机验证已临时关闭");
    },
    });
  };

  const k1Confirm = (guard: UserRegistrationRiskK1Guard) => openConfirm({
    action: `422 · ${text(guard.rejectCode, k1RejectCode)}`,
    detail: <>服务器拒收：<b>{text(guard.name)}</b> 的唯一配置入口在反多账户引擎 K1。返回 422 {text(guard.rejectCode, k1RejectCode)}，suggestedPath 仅为导航建议。</>,
    chips: [["接口层强制 · 422 拒收", "ready"], ["唯一入口 · K1", "done"]],
    okLabel: "去 K1 配置",
    run: () => {
      router.push(text(guard.suggestedPath, k1Path));
    },
  });

  return (
    <>
      <div className="f-stats">
        <StatCard
          label="今日 OTP 发送"
          value={toNumber(overview?.stats?.otpToday).toLocaleString("en-US")}
          sub={`触发人机验证 ${toNumber(overview?.stats?.captchaTriggeredToday).toLocaleString("en-US")} 次`}
        />
        <StatCard
          tone="warn"
          label="今日登录锁定"
          value={toNumber(overview?.stats?.locked)}
          sub={`短锁 ${toNumber(overview?.stats?.lockedShort)} · 长锁 ${toNumber(overview?.stats?.lockedLong)} · 来自今日登录锁定事件`}
        />
        {captchaRestoreAt ? (
          <StatCard tone="danger" label="人机验证" value="临时关闭" sub={`服务端自动恢复：${formatCaptchaRestoreAt(captchaRestoreAt)}`} />
        ) : (
          <StatCard tone="ok" label="人机验证" value="开启" sub={`完成 ${otpMaxN} 次发送后，第 ${otpCaptchaStart} 次起要求滑块`} />
        )}
        <StatCard
          tone="cyan"
          label="撞库信号(7 天)"
          value={`${toNumber(overview?.stats?.stuffingClusters7d)} 簇`}
          sub="IP 维度命中同步 K1"
        />
      </div>

      {error && <div className="ctint bad" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>C6 数据加载中...</div>}

      <div className="sec-grid">
        <section className="l-card">
          <div className="l-h"><span className="ttl">验证码(OTP)</span><span className="sub">· K2 短信闸门只读镜像</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {otpParams.map(otpMirrorRow)}
            {otpParams.length === 0 && <div className="ctint">暂无 OTP 参数</div>}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">连错锁定</span><span className="sub">· 改动写入服务端配置，解锁在 C5</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {lockParams.map(adjustRow)}
            {lockParams.length === 0 && <div className="ctint">暂无锁定参数</div>}
            <div className="p-row">
              <div className="txt"><div className="k">计数维度</div><div className="s">按 IP + 账户双维度在服务器计数，客户端只显示倒计时</div></div>
              <span className="v">IP + 账户</span>
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">人机验证(CAPTCHA)</span><span className="sub">· 关掉 = 开放短信轰炸，慎用</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <div className="txt"><div className="k">全局开关</div><div className="s">仅限服务商故障等紧急维护时关，关闭必须填恢复时限</div></div>
              {captchaRestoreAt ? (
                <>
                  <span className="v" style={{ color: "var(--danger)" }}>临时关闭 · {formatCaptchaRestoreAt(captchaRestoreAt)} 恢复</span>
                  <button className="l-btn sm" title={canWrite ? undefined : "当前账号只有 C6 读取权限"} disabled={!canWrite || busy} onClick={restoreCaptcha}>{canWrite ? "立即恢复" : "只读"}</button>
                </>
              ) : (
                <>
                  <span className="v" style={{ color: "var(--success)" }}>开启</span>
                  <button className="l-btn sm mc" title={canWrite ? undefined : "当前账号只有 C6 读取权限"} disabled={!canWrite || busy} onClick={disableCaptcha}>{canWrite ? "紧急关闭" : "只读"}</button>
                </>
              )}
            </div>
            <div className="p-row">
              <div className="txt">
                <div className="k">触发阈值 <span className="bdg dim">K2 唯一入口</span></div>
                <div className="s">同号完成 {otpMaxN} 次发送后，第 {otpCaptchaStart} 次起要求滑块；权威配置在 K2，C6 只读。</div>
              </div>
              <span className="v">&gt;= {otpMaxN} 次</span>
            </div>
            <div className="ctint warn" style={{ marginTop: 10 }}><b>给增长同事的话</b> · 人机验证影响注册漏斗转化，但这是安全开关，不开放写权。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">和 K1 / K2 的分工(接口层强制)</span><span className="sub">· 防参数配两套打架</span></div>
        <div className="l-b">
          <div className="split-grid">
            <div className="ctint"><b>这页管(登录安全)</b> · 连错锁定两档与人机验证紧急开关。验证码有效期、重发冷却、触发线由 K2 短信闸门统一配置，本页只读镜像。</div>
            <div className="ctint"><b>K1 管(多账户去重)</b> · 同 IP 24h 注册上限 / 同设备绑定上限 / 同支付工具绑定上限。本页提交那三个参数，服务器直接退回 422。</div>
          </div>
          {k1Guards.map((guard) => (
            <div className="p-row" key={guardKey(guard)}>
              <div className="txt">
                <div className="k">{text(guard.name)} <span className="bdg dim">K1 唯一入口</span></div>
                <div className="s">本页提交会返回 422 {text(guard.rejectCode, k1RejectCode)}</div>
              </div>
              <button className="l-btn sm" onClick={() => k1Confirm(guard)}>去 K1 调整</button>
            </div>
          ))}
          {k1Guards.length === 0 && <div className="ctint" style={{ marginTop: 10 }}>暂无 K1 边界参数</div>}
          <div className="ctint" style={{ marginTop: 10 }}>
            <b>产出去向</b> · 注册漏斗事件喂 B3；登录锁定事件喂 B5 和 C5；注册侧 IP/设备命中喂 K1。配置变更会写入不可改操作记录。
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>全部在服务器执行</b>：验证码的有效期、试错次数、幂等去重都在服务端校验；锁定期间服务器拒绝该手机号的一切登录请求。数据源：{(overview?.sources ?? ["服务端风险配置", "用户安全状态", "K1 风控边界"]).map(sourceLabel).join(" · ")}
      </p>
    </>
  );
}
