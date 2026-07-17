"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * C6 注册/登录风控配置。
 * 数据源为后端 /registration-risk/overview；调参写 /registration-risk/params/{paramKey}。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchUserRegistrationRiskOverview,
  updateUserRegistrationRiskParam,
  type UserRegistrationRiskK1Guard,
  type UserRegistrationRiskOverview,
  type UserRegistrationRiskParam,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
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
  const [overview, setOverview] = useState<UserRegistrationRiskOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchUserRegistrationRiskOverview();
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(`C6 数据加载失败 · ${errorMessage(err)}`);
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
      await loadData(true);
      toast(message || fallback);
      setError(null);
    } catch (err) {
      const message = errorMessage(err);
      setError(`C6 操作失败 · ${message}`);
      toast(`C6 操作失败 · ${message}`);
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  const params = overview?.params ?? [];
  const otpParams = params.filter((param) => param.group === "otp");
  const lockParams = params.filter((param) => param.group === "lock");
  const otpMaxParam = params.find((param) => param.key === "otpMax24h");
  const otpMaxN = stripTimesUnit(otpMaxParam?.value);
  const otpCaptchaStart = Number.isFinite(Number(otpMaxN)) ? String(Number(otpMaxN) + 1) : "N+1";
  const captchaOff = overview?.stats?.captchaTemporarilyDisabled ? text(overview.stats.captchaRestoreWindow, "") : "";
  const k1Guards = overview?.k1Guards ?? [];
  const k1RejectCode = text(overview?.k1RejectCode, K1_REJECT_CODE_FALLBACK);
  const k1Path = text(overview?.k1Path, K1_PATH_FALLBACK);

  const adjustRow = (param: UserRegistrationRiskParam) => {
    const key = param.key;
    const currentValue = text(param.value, "");
    return (
      <div className="p-row" key={rowKey(param)}>
        <div className="txt">
          <div className="k">{text(param.name)}</div>
          <div className="s">{text(param.sub, text(param.note))}</div>
        </div>
        <span className="v">{text(param.value)}</span>
        <button
          className="l-btn sm mc"
          disabled={busy || !key || !!param.readOnly}
          onClick={() => openActionConfirm({
            action: `登录风控参数 · ${text(param.name)}`,
            detail: <><b>{text(param.name)}</b> · 当前 {text(param.value)} · {text(param.note)}。注册登录摩擦参数会影响可用性与安全，操作确认。</>,
            amplifies: false,
            edit: { kind: "text", current: currentValue },
            run: (reason, nextValue) => {
              const value = (nextValue ?? "").trim();
              if (!key || !value) {
                toast("请输入调整后的参数值");
                return;
              }
              void perform(async () => {
                await updateUserRegistrationRiskParam(key, value, reason, OPERATOR());
                return `${text(param.name)} 已更新为 ${value}`;
              }, "登录风控参数已更新");
            },
          })}
        >
          {param.readOnly ? "只读" : "调整"}
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

  const restoreCaptcha = () => openConfirm({
    action: "恢复人机验证",
    detail: "立即恢复 CAPTCHA 拦截。后端会写回 auth.risk.captcha_off_window 为空并留审计。",
    reason: true,
    okLabel: "确认恢复",
    run: (reason) => {
      void perform(async () => {
        await updateUserRegistrationRiskParam("captchaOff", "", reason, OPERATOR());
        return "人机验证已恢复";
      }, "人机验证已恢复");
    },
  });

  const disableCaptcha = () => openActionConfirm({
    action: "紧急关闭人机验证",
    detail: <><b>关闭 = 同号验证码超频不再拦截</b>。只用于人机验证服务商故障等系统级紧急维护，必须选择恢复时限，到点自动开回。</>,
    amplifies: false,
    edit: { kind: "select", current: CAPTCHA_RECOVERY_OPTIONS[0], options: CAPTCHA_RECOVERY_OPTIONS },
    run: (reason, nextValue) => {
      const value = (nextValue ?? "").trim();
      if (!CAPTCHA_RECOVERY_OPTIONS.includes(value)) {
        toast("必须选择有效恢复时限，未执行");
        return;
      }
      void perform(async () => {
        await updateUserRegistrationRiskParam("captchaOff", value, reason, OPERATOR());
        return `人机验证已临时关闭 · ${value}`;
      }, "人机验证已临时关闭");
    },
  });

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
          sub={`短锁 ${toNumber(overview?.stats?.lockedShort)} · 长锁 ${toNumber(overview?.stats?.lockedLong)} · 来自账户安全状态`}
        />
        {captchaOff ? (
          <StatCard tone="danger" label="人机验证" value="临时关闭" sub={`恢复时限：${captchaOff} · 到点自动开回`} />
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
              {captchaOff ? (
                <>
                  <span className="v" style={{ color: "var(--danger)" }}>临时关闭 · {captchaOff}</span>
                  <button className="l-btn sm" disabled={busy} onClick={restoreCaptcha}>立即恢复</button>
                </>
              ) : (
                <>
                  <span className="v" style={{ color: "var(--success)" }}>开启</span>
                  <button className="l-btn sm mc" disabled={busy} onClick={disableCaptcha}>紧急关闭</button>
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
              <button className="l-btn sm" onClick={() => k1Confirm(guard)}>调整</button>
            </div>
          ))}
          {k1Guards.length === 0 && <div className="ctint" style={{ marginTop: 10 }}>暂无 K1 边界参数</div>}
          <div className="ctint" style={{ marginTop: 10 }}>
            <b>产出去向</b> · 注册漏斗事件喂 B3；登录锁定事件喂 B5 和 C5；注册侧 IP/设备命中喂 K1。配置变更产 <b>admin.auth_config_changed</b> 进审计。
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>全部在服务器执行</b>：验证码的有效期、试错次数、幂等去重都在服务端校验；锁定期间服务器拒绝该手机号的一切登录请求。数据源：{(overview?.sources ?? ["服务端风险配置", "用户安全状态", "K1 风控边界"]).join(" · ")}
      </p>
    </>
  );
}
