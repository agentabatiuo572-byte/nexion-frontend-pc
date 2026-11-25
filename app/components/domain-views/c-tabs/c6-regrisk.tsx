"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * C6 注册与登录风险配置。
 * 数据源为后端 /registration-risk/overview；调参写 /registration-risk/params/{paramKey}。
 * 四类写入保存完整原请求；结果未知时只允许原样恢复或读回核对。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleHelp, Fingerprint, KeyRound, LockKeyhole, MessageSquareText, Network, RefreshCw, ShieldCheck, ShieldOff, SlidersHorizontal, Users } from "lucide-react";
import { BlockState, Button, Change, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, Fold, KeyValues, Notice, PageHeader, Panel, ScaleBar, Stat, StatBand, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { pendingC6Commands, prepareC6Command, submitC6Command, forgetC6Command, isCompleteC6Command, isC6ExplicitRejection, type C6Pending, type C6Original } from "@/lib/admin/c6-regrisk-commands";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import {
  fetchUserRegistrationRiskOverview,
  UsersRequestError,
  type UserRegistrationRiskK1Guard,
  type UserRegistrationRiskOverview,
  type UserRegistrationRiskParam,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const EMPTY_AUTHORITIES: string[] = [];
const K1_PATH_FALLBACK = "/risk/multi-account";
const K2_PATH = "/risk/abuse";
const C5_PATH = "/users/security";

// 人机验证 紧急关闭的恢复时限固定枚举，避免不可恢复的安全降级。
const CAPTCHA_RECOVERY_OPTIONS = ["30 分钟后自动恢复", "1 小时后自动恢复", "2 小时后自动恢复", "4 小时后自动恢复"];
/** 只改框里的显示，提交的仍是上面的原值。 */
const CAPTCHA_RECOVERY_LABELS: Record<string, string> = {
  "30 分钟后自动恢复": "30 分钟",
  "1 小时后自动恢复": "1 小时",
  "2 小时后自动恢复": "2 小时",
  "4 小时后自动恢复": "4 小时",
};

/** 关闭期间仍然有效的部分（后端事实 F06、待后端 BE-04）。 */
const CAPTCHA_LIMITS_STILL_ON = "重发冷却、发送次数上限、IP 频率限制";
const CAPTCHA_SCENE_LABEL = { REGISTER: "注册", LOGIN: "登录", RESET: "找回密码" } as const;

/** 关闭期间仍要验证的 H5 注册（后端 h5RegisterCaptcha / h5RegisterMissingDeviceCaptcha）；旧后端没有标志时用原写法。 */
function h5ForcedText(overview: UserRegistrationRiskOverview) {
  if (overview.h5RegisterCaptcha === true) return "H5 注册";
  if (overview.h5RegisterCaptcha === false && overview.h5RegisterMissingDeviceCaptcha === true) return "缺设备信息的 H5 注册";
  return "H5 注册的强制验证";
}

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

function numericParts(value: unknown) {
  return String(value ?? "").match(/\d+/g)?.map(Number) ?? [];
}

function formatCaptchaRestoreAt(value: unknown) {
  const raw = text(value, "");
  const deadline = new Date(raw);
  if (!raw || Number.isNaN(deadline.getTime())) return "恢复时间未知";
  return `${formatBusinessTimeCompact(deadline.toISOString())}（${businessZone().label}）`;
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

function rowKey(param: UserRegistrationRiskParam) {
  return text(param.key, `${text(param.group)}-${operatorCopyText(text(param.name))}`);
}

function guardKey(guard: UserRegistrationRiskK1Guard) {
  return text(guard.k1Key, text(guard.name));
}

/** 锁定参数的两段数字，读不出两段时返回 null，界面写原值。 */
function lockRule(param: UserRegistrationRiskParam | undefined, fallbackUnit: string) {
  if (!param) return null;
  const [attempts, duration] = numericParts(param.value);
  if (attempts === undefined || duration === undefined) return null;
  return { attempts, duration, unit: text(param.secondaryUnit, fallbackUnit) };
}

/** 本机待确认记录的指纹按动作拼（见各 perform 调用），这里只取前几段给人看。 */
function pendingLabel(fingerprint: string) {
  const [kind, first, second] = fingerprint.split("|");
  if (kind === "lock") return `${first === "lockLong" ? "调整长锁" : "调整短锁"}为 ${text(second)}`;
  if (kind === "captcha-disable") return `临时关闭人机验证 · ${CAPTCHA_RECOVERY_LABELS[first] ?? text(first)}`;
  if (kind === "captcha-restore") return "立即恢复人机验证";
  return "调整注册与登录风险设置";
}

/** 第一次提交被拒、页面重读之后交给原确认框的显示数据：打开时的规则、读到的最新规则（没读到是 null）。 */
type C6Reread = { failure: unknown; opened: UserRegistrationRiskOverview; latest: UserRegistrationRiskOverview | null };

function isVersionConflict(failure: unknown) {
  return failure instanceof UsersRequestError && failure.code === "C6_CONFIG_VERSION_CONFLICT";
}

/** 被拒的原因写给运营看，不出现状态码和英文码。 */
function rejectionText(failure: unknown) {
  const status = failure instanceof UsersRequestError ? failure.status : 0;
  if (isVersionConflict(failure)) return "刚被别人改过。";
  if (status === 401) return "登录已失效，请重新登录。";
  if (failure instanceof UsersRequestError && failure.code === "ADMIN_PASSWORD_CHANGE_REQUIRED") return "你的账号要先修改登录密码，改完再提交。";
  if (status === 403) return "你的账号现在没有修改这一项的权限，请联系管理员核对。";
  if (status === 429) return "提交太频繁，稍等一会儿再点确认。";
  return errorMessage(failure);
}

/** 被拒后最新规则没读到：框留着、输入留着，但不能再提交。 */
function staleText(failure: unknown) {
  const conflict = isVersionConflict(failure);
  return <><b>{conflict ? "刚被别人改过，这次没有保存，最新的规则也没读到。" : "这次没有保存，最新的规则也没读到。"}</b>{!conflict && <><br />{rejectionText(failure)}</>}<br />关掉这个框，在页面上重新加载后再打开。</>;
}
const STALE_TOAST = "最新的规则没读到，现在不能提交。关掉这个框，重新加载后再打开。";
const C6_EXPIRED_TEXT = "原请求已超过 24 小时或没有保存完整，不能再重试，只能查询原操作。";

export function C6Regrisk({ ctx }: { ctx: CCtx }) {
  const reach = useReach();
  const router = useRouter();
  const { toast, openActionConfirm, openConfirm } = ctx;
  const role = useAdminAuth((state) => state.session?.role ?? state.role);
  const authorities = useAdminAuth((state) => state.session?.authorities ?? EMPTY_AUTHORITIES);
  const canWrite = role === "super" || role === "superadmin" || authorities.includes("user_c6_write");
  const owner = useAdminAuth((state) => state.session?.adminId ?? 0);
  const [overview, setOverview] = useState<UserRegistrationRiskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useRef(false);
  const overviewRef = useRef<UserRegistrationRiskOverview | null>(null);
  const readEpoch = useRef(0);
  const invalidate = useCallback(() => {
    readEpoch.current += 1;
    overviewRef.current = null;
    setOverview(null);
    setLoading(false);
    ctx.closeConfirms();
  }, [ctx.closeConfirms]);
  /** 只用于页头「读取于」，不参与任何判断。 */
  const [readAt, setReadAt] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    const epoch = ++readEpoch.current;
    setLoading(true);
    try {
      const data = await fetchUserRegistrationRiskOverview();
      if (epoch !== readEpoch.current) return false;
      overviewRef.current = data;
      setOverview(data);
      setReadAt(Date.now());
      setError(null);
      return true;
    } catch (err) {
      if (epoch !== readEpoch.current) return false;
      overviewRef.current = null;
      setOverview(null);
      setError(`加载失败 · ${errorMessage(err)}`);
      return false;
    } finally {
      if (epoch === readEpoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pending = owner ? pendingC6Commands(owner) : [];
  const [expiryNow, setExpiryNow] = useState(Date.now);
  const nextExpiry = pending.reduce((next, row) => row.expiresAt > expiryNow ? Math.min(next, row.expiresAt) : next, Infinity);
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setExpiryNow(Date.now()), Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);
  const pendingFor = (target: C6Original["target"]) => pendingC6Commands(owner).find(row => !isCompleteC6Command(row) || row.target === target);
  const unavailable = (target: C6Original["target"]) => busy ? "正在提交，请稍候" : pendingFor(target) ? "这一项有一次提交结果未知，先在页面上方核对" : undefined;
  const canSubmit = () => {
    const auth = useAdminAuth.getState();
    return auth.session?.adminId === owner && (auth.session.role === "super" || auth.session.role === "superadmin" || auth.session.authorities.includes("user_c6_write"));
  };
  const perform = async (original: C6Pending, retry = true, onRejected?: (latest: UserRegistrationRiskOverview | null, failure: unknown) => void) => {
    if (mutation.current || !canSubmit()) return false;
    if (original.expiresAt <= Date.now()) {
      toast(C6_EXPIRED_TEXT, "warn");
      return false;
    }
    mutation.current = true;
    setBusy(true);
    let row: C6Pending | undefined;
    try {
      row = pendingC6Commands(owner).find(item => item.commandKey === original.commandKey);
      if (!row) { ctx.closeConfirms(); return false; }
      await submitC6Command(row);
      forgetC6Command(row);
      // Replayed receipts describe the original write, never the current overview.
      // Close every old confirmation before a new authoritative read enables writes.
      invalidate();
      toast(row.successMessage!);
      await loadData();
      return true;
    } catch (err) {
      const rejected = retry ? isC6ExplicitRejection(err)
        : err instanceof UsersRequestError && isDeterministicRejection(err.status, err.businessStatus);
      if (row && rejected) {
        forgetC6Command(row);
        if (retry) invalidate();
        else {
          // Keep the mounted form and its draft while replacing its read basis.
          readEpoch.current += 1;
          overviewRef.current = null;
          setOverview(null);
          await loadData();
          onRejected?.(overviewRef.current, err);
        }
      } else if (row) { readEpoch.current += 1; overviewRef.current = null; setOverview(null); setLoading(false); }
      // 重试被 401／403／429 挡下：说这次为什么没执行，原操作仍是结果未知。
      const retryRefused = row && !rejected && retry && err instanceof UsersRequestError && [401, 403, 429].includes(err.status);
      const message = retryRefused ? `这次重试没有执行：${rejectionText(err)}原操作仍是结果未知，原请求已保留。`
        : row && !rejected ? "结果未知 · 已保留原请求，在页面上方查询原操作或按原操作重试" : `操作失败 · ${errorMessage(err)}`;
      // 第一次提交被拒时原框还开着，原因写在框里，不再弹同一句；最新规则没读到时页面照旧停在「没有保存」。
      const keptOpen = Boolean(row && rejected && !retry);
      if (!keptOpen || !overviewRef.current) setError(message);
      if (!keptOpen) toast(message, row && !rejected ? "warn" : "error");
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  // Each open form owns at most one original command. A settled form cannot
  // silently become a new mutation, even if its callback is still being invoked.
  const commandRun = (target: C6Original["target"], kind: C6Original["kind"], label: string, successMessage: (value: string) => string, basis: UserRegistrationRiskOverview, rebase: (after: C6Reread) => void) => {
    let original: C6Pending | undefined;
    let settled = false;
    return {
      getPendingReason: () => original && pendingC6Commands(owner).find(row => row.commandKey === original!.commandKey)?.reason,
      getPendingExpired: () => !!original && (pendingC6Commands(owner).find(row => row.commandKey === original!.commandKey)?.expiresAt ?? Infinity) <= Date.now(),
      run: async (value: string, reason: string) => {
        if (settled) return false;
        if (original) return perform(original);
        if (!canSubmit() || mutation.current || overviewRef.current !== basis || pendingFor(target)) {
          toast("规则可能已变，请重新加载后再改。", "warn");
          return false;
        }
        const operator = OPERATOR(), version = Number(basis.configVersion);
        const request: C6Original = { owner, target, kind, label: kind === "lock" ? `${label}为 ${value}` : kind === "captcha-disable" ? `${label} · ${CAPTCHA_RECOVERY_LABELS[value] ?? value}` : label, successMessage: successMessage(value), value, reason, operator, version,
          method: "PATCH", path: `/api/admin/users/registration-risk/params/${target}`,
          body: JSON.stringify({ value, reason, operator, expectedVersion: version }) };
        // Capture the stored command before sending so the existing modal's
        // getPendingReason freezes its inputs when no verdict is received.
        try { original = prepareC6Command(request); }
        catch (failure) { toast(errorMessage(failure), "error"); return false; }
        return perform(original, false, (latest, failure) => {
          original = undefined;
          settled = true;
          // 没读到最新规则时框按打开时的内容重画一次，只为写上不能提交的原因。
          rebase({ failure, opened: basis, latest });
        });
      },
    };
  };

  const header = (
    <PageHeader
      pageId="C6"
      title="注册与登录风险"
      summary="看今天的登录和验证码情况，调整 App 登录锁定和人机验证。"
      meta={readAt && overview ? `读取于 ${businessStamp(readAt)}（${businessZone().label}）` : undefined}
      readOnly={canWrite ? undefined : "你只有查看权限，锁定规则和人机验证不能修改"}
      actions={<Button icon={<RefreshCw size={14} />} loading={loading} disabledReason={busy ? "正在提交，请稍候" : undefined} onClick={() => void loadData()}>刷新</Button>}
    />
  );

  // Restore from the saved request even when the overview cannot be loaded.
  const pendingNotices = pending.length > 0 && (
    <Notice tone="warn" title={<>有 {pending.length} 个操作结果未知<Explain label="结果未知怎么处理" content="提交时没收到确定结果，可能已经生效。24 小时内可以按原操作重试，系统认得出是同一次提交，不会重复执行；超过 24 小时只能查询原操作。「查询原操作」读的是现在的规则，证明不了原操作有没有执行。有结论前这一项不能再改。" /></>}>
      <ul className="c6-pending" aria-label="结果未知的操作">
        {pending.map((record) => {
          const complete = isCompleteC6Command(record);
          const expired = record.expiresAt <= Date.now();
          return (
            <li key={record.commandKey}>
              <span className="c6-pending-name">{record.label ?? pendingLabel(record.fingerprint)}</span>
              <span className="c6-pending-time">{businessStamp(record.createdAt)} 提交</span>
              <span>{!complete
                ? <StatusTag tone="neutral" icon={CircleHelp} explain="这条是旧页面留下的记录，没有保存原请求，不能重试。">只能查询原操作</StatusTag>
                : expired
                  ? <StatusTag tone="neutral" icon={CircleHelp} explain="原请求超过 24 小时，不能再重试。">已过期</StatusTag>
                  : <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag>}</span>
              <span className="c6-pending-actions">
                <Button size="sm" loading={loading} disabledReason={busy ? "正在提交，请稍候" : undefined} onClick={() => void loadData()}>查询原操作</Button>
                {complete && !expired && <Button size="sm" variant="primary" disabledReason={busy ? "正在提交，请稍候" : !canWrite ? "你没有修改权限，只能查询原操作" : undefined} onClick={() => void perform(record)}>按原操作重试</Button>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="c6-pending-zone">提交时间为{businessZone().label}</p>
    </Notice>
  );

  if (!overview) {
    return (
      <div className="c6-page">
        {header}
        {pendingNotices}
        {loading ? (
          <BlockState state="loading" title="正在读取注册与登录风险" />
        ) : error && !error.startsWith("加载失败") ? (
          <Notice tone={error.startsWith("操作失败") ? "danger" : "warn"} title={error.startsWith("操作失败") ? "这次修改没有保存，重新加载后再改" : "重新加载后再看当前规则"}
            action={<Button size="sm" onClick={() => void loadData()}>重新加载</Button>}>
            {error.startsWith("操作失败") && error.replace(/^操作失败 · /, "")}
          </Notice>
        ) : (
          <BlockState state="error" title="数据暂不可用，已暂停显示和修改" detail={error ?? "没有读到这页的数据。"} onRetry={() => void loadData()} retrying={loading} retryLabel="重新加载" />
        )}
      </div>
    );
  }

  const params = overview.params ?? [];
  const otpParams = params.filter((param) => param.group === "otp");
  const lockParams = params.filter((param) => param.group === "lock");
  const otpCaptchaAfterSends = overview.captchaAfterSends!;
  const otpCaptchaStart = otpCaptchaAfterSends + 1;
  const stats = overview.stats;
  const alwaysScenes = overview.captchaAlwaysScenes;
  const captchaRestoreAt = overview.stats?.captchaTemporarilyDisabled ? text(overview.stats.captchaRestoreAt, "") : "";
  const k1Guards = overview?.k1Guards ?? [];
  const k1Path = text(overview?.k1Path, K1_PATH_FALLBACK);
  const shortParam = lockParams.find((row) => row.key === "lockShort");
  const longParam = lockParams.find((row) => row.key === "lockLong");
  const shortRule = lockRule(shortParam, "分钟");
  const longRule = lockRule(longParam, "小时");
  const remainingMinutes = Math.ceil(toNumber(overview.stats?.captchaRemainingSeconds) / 60);
  const lockedShort = toNumber(overview?.stats?.lockedShort);
  const lockedLong = toNumber(overview?.stats?.lockedLong);

  const ruleText = (rule: ReturnType<typeof lockRule>, param?: UserRegistrationRiskParam) => rule ? `输错 ${rule.attempts} 次 · 锁 ${rule.duration} ${rule.unit}` : text(param?.value);

  const openLock = (key: string, basis: UserRegistrationRiskOverview, after?: C6Reread) => {
    const rebasing = !!after;
    const lockParams = basis.params!.filter(param => param.group === "lock");
    const param = lockParams.find(param => param.key === key);
    if (!param) return;
    const shortParam = lockParams.find(param => param.key === "lockShort");
    const longParam = lockParams.find(param => param.key === "lockLong");
    const shortRule = lockRule(shortParam, "分钟");
    const longRule = lockRule(longParam, "小时");
    const currentValue = text(param.value, "");
    const [currentAttempts = 0, currentDuration = 0] = numericParts(currentValue);
    const shortAttempts = numericParts(lockParams.find((row) => row.key === "lockShort")?.value)[0] ?? 0;
    const longAttempts = numericParts(lockParams.find((row) => row.key === "lockLong")?.value)[0] ?? Number.MAX_SAFE_INTEGER;
    const attemptMin = toNumber(param.min, 0);
    const attemptMax = toNumber(param.max, 0);
    const durationMin = toNumber(param.secondaryMin, 0);
    const durationMax = toNumber(param.secondaryMax, 0);
    const durationUnit = text(param.secondaryUnit, key === "lockLong" ? "小时" : "分钟");
    const isLong = key === "lockLong";
    const name = operatorCopyText(text(param.name));
    const windowMinutes = shortRule ? `${shortRule.duration} 分钟` : "短锁时长";
    const relation = isLong
      ? `要大于短锁的 ${shortAttempts} 次`
      : longAttempts === Number.MAX_SAFE_INTEGER ? "要小于长锁次数" : `要小于长锁的 ${longAttempts} 次`;
    const impactFor = (attempts: string, duration: string) => {
      const a = /^\d+$/.test(attempts ?? "") ? attempts : String(currentAttempts);
      const d = /^\d+$/.test(duration ?? "") ? duration : String(currentDuration);
      return isLong
        ? `保存后，${windowMinutes}计数窗口内累计输错到 ${a} 次就锁 ${d} 小时；短锁期间只有验证码登录输错还计数。`
        : `保存后，从第一次输错起 ${d} 分钟内输错 ${a} 次，就锁 ${d} 分钟；这段时间也是长锁的计数窗口。`;
    };
    if (!rebasing && (!canSubmit() || mutation.current || pendingFor(key as C6Original["target"]) || overviewRef.current !== basis)) return;
    const original = commandRun(key as C6Original["target"], "lock", `调整${name}`, value => `${name} 已更新为 ${value}`, basis, next => openLock(key, next.latest ?? next.opened, next));
    // 被拒后读到了最新规则：和打开时不一样的值标「刚改过」，问号里写打开时的值。
    const reread = after?.latest ? after : undefined;
    const openedLock = (k: string) => {
      const opened = reread?.opened.params?.find(row => row.group === "lock" && row.key === k);
      return ruleText(lockRule(opened, k === "lockLong" ? "小时" : "分钟"), opened);
    };
    const nowText = ruleText(lockRule(param, durationUnit), param);
    const otherKey = isLong ? "lockShort" : "lockLong";
    const otherText = ruleText(isLong ? shortRule : longRule, isLong ? shortParam : longParam);
    const changedNow = !!reread && openedLock(key) !== nowText;
    const changedOther = !!reread && openedLock(otherKey) !== otherText;
    const justChanged = (was: string) => <> <StatusTag tone="warn" explain={`你打开时：${was}`}>刚改过</StatusTag></>;
    openActionConfirm({ briefKind: "config",
      getPendingReason: original.getPendingReason,
      action: `调整登录锁定 · ${name}`,
      title: `调整${name}`,
      detail: <><b>{name}</b> · 当前 {text(param.value)} · 次数可设 {attemptMin}–{attemptMax}，时长可设 {durationMin}–{durationMax} {durationUnit}。长锁次数要大于短锁。</>,
      amplifies: false,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: `确认调整${name}`,
      reasonPlaceholder: "例如：近期批量试密码增多，依据风控工单调整锁定规则",
      blockedReason: after && !after.latest ? staleText(after.failure) : undefined,
      facts: (
        <>
          <Facts>
            <Fact k="现在">{nowText}{changedNow && justChanged(openedLock(key))}</Fact>
            <Fact k={isLong ? "短锁（不改）" : "长锁（不改）"}>{otherText}{changedOther && justChanged(openedLock(otherKey))}</Fact>
            <Fact k="已锁的账户">这次修改不改它们的解锁时间和已累计次数</Fact>
          </Facts>
          {reread && (isVersionConflict(reread.failure)
            ? <Notice tone="warn" title="刚被别人改过，这次没有保存">{changedNow || changedOther ? "上面已换成最新的规则，变了的标「刚改过」。" : "上面的规则和你打开时一样。"}你填的还在，核对后再点确认。</Notice>
            : <Notice tone="danger" title="这次没有保存">{rejectionText(reread.failure)}</Notice>)}
        </>
      ),
      statedBrief: (value) => ({
        impact: impactFor(value.attempts, value.duration),
        check: "提交时检查次数和时长的范围；打开后如果已被别人改过，这次不会保存。",
      }),
      businessFormRevision: Number(basis.configVersion),
      businessForm: {
        kind: "multi-field",
        hint: "次数和时长一起保存",
        fields: [
          { key: "attempts", label: "输错几次后锁定", inputKind: "number", current: String(currentAttempts), min: toNumber(param.min, 0), max: toNumber(param.max, 0), step: 1, required: true, help: `${attemptMin}–${attemptMax} 次，${relation}`,
            // 另一级刚被别人改过、你填的次数按最新的不成立时，说清为什么现在保存不了（不改校验，点确认仍按原来的提示拦下）。
            warning: changedOther ? (value) => {
              const attempts = value.attempts?.trim() ? Number(value.attempts) : NaN;
              if (!Number.isInteger(attempts)) return undefined;
              if (isLong && attempts <= shortAttempts) return `短锁刚改成 ${shortAttempts} 次，现在保存不了`;
              if (!isLong && attempts >= longAttempts) return `长锁刚改成 ${longAttempts} 次，现在保存不了`;
              return undefined;
            } : undefined },
          { key: "duration", label: `锁定时长(${durationUnit})`, inputKind: "number", current: String(currentDuration), min: toNumber(param.secondaryMin, 0), max: toNumber(param.secondaryMax, 0), step: 1, required: true, help: `${durationMin}–${durationMax} ${durationUnit}` },
        ],
      },
      run: async (reason, _nextValue, businessValue) => {
        const attempts = businessValue?.attempts?.trim() ? Number(businessValue.attempts) : NaN;
        const duration = businessValue?.duration?.trim() ? Number(businessValue.duration) : NaN;
        if (!key || !Number.isInteger(attempts) || !Number.isInteger(duration)) {
          toast("请填写有效的整数次数和锁定时长");
          return false;
        }
        if ((key === "lockShort" && attempts >= longAttempts)
          || (key === "lockLong" && attempts <= shortAttempts)) {
          toast("长锁次数要大于短锁次数，未保存");
          return false;
        }
        const value = `${attempts} 次 / ${duration} ${durationUnit}`;
        return original.run(value, reason);
      },
    });
  };

  const adjustRow = (param: UserRegistrationRiskParam) => {
    const key = param.key;
    const isLong = key === "lockLong";
    const name = operatorCopyText(text(param.name));
    const durationUnit = text(param.secondaryUnit, isLong ? "小时" : "分钟");
    const windowMinutes = shortRule ? `${shortRule.duration} 分钟` : "短锁时长";
    const rule = lockRule(param, durationUnit);
    return (
      <ConfigRow key={rowKey(param)} id={`c6-${key}`}
        name={name}
        what={isLong ? `第二级锁定：${windowMinutes}计数窗口内累计输错到这个次数，锁更久，不强制改密码` : "第一级锁定：同一手机号输错到这个次数，先锁一段时间"}
        when="保存后立即生效，之后的输错按新规则计数和锁定"
        effect={isLong
          ? "次数越少越早锁长锁，误锁的用户要等很久或由运营解锁。短锁期间只有验证码登录输错还计数，单靠输错密码一般到不了长锁"
          : "次数越少、时长越长，越挡得住批量试密码，正常用户也越容易被锁。时长同时是计数窗口：从第一次输错起算，过了就重新计数"}
        note="修改不改已锁账户的解锁时间和已累计次数"
        where="App 登录、验证码登录和两步验证输错时；用户只看到「暂时锁定」，看不到解锁时间"
        value={rule ? <span className="c6-rule">输错 <b>{rule.attempts}</b> 次<span aria-hidden>→</span>锁 <b>{rule.duration}</b> {rule.unit}</span> : text(param.value)}
        action={canWrite && !param.readOnly
          ? <Button size="sm" disabledReason={!key ? "这一项读不全，暂时不能调整" : unavailable(key as C6Original["target"])} onClick={() => openLock(key!, overview)}>调整</Button>
          : undefined}
      />
    );
  };

  const restoreCaptcha = (basis: UserRegistrationRiskOverview, after?: C6Reread) => {
    const rebasing = !!after;
    if (!canWrite) {
      toast("你只有查看权限，不能恢复人机验证");
      return;
    }
    if (!rebasing && (mutation.current || pendingFor("captchaOff") || overviewRef.current !== basis)) return;
    const original = commandRun("captchaOff", "captcha-restore", "立即恢复人机验证", () => "人机验证已恢复", basis, next => restoreCaptcha(next.latest ?? next.opened, next));
    const reread = after?.latest ? after : undefined;
    const stale = after && !after.latest;
    // 别人已经先恢复了：不再让人提交一次「开启 → 开启」，只说明不用再操作。
    if (reread && !basis.stats?.captchaTemporarilyDisabled) {
      openConfirm({ briefKind: "record",
        action: "恢复人机验证",
        title: "立即恢复人机验证",
        detail: "人机验证已经开启。",
        statedBrief: { impact: "人机验证已经开启，不用再提交。", check: "点「知道了」关掉这个框，不会发出修改。" },
        content: (
          <>
            <Facts>
              <Fact k="人机验证">开启 <StatusTag tone="warn" explain="你打开时：临时关闭">刚改过</StatusTag></Fact>
            </Facts>
            <Notice tone="ok" title="人机验证已经开启，这次没有保存">{isVersionConflict(reread.failure) ? "别人先恢复了，或已到原定时间自动恢复。" : rejectionText(reread.failure)}</Notice>
          </>
        ),
        reason: true,
        okLabel: "知道了",
        run: () => true,
      });
      return;
    }
    const restoreAt = formatCaptchaRestoreAt(basis.stats?.captchaRestoreAt);
    const restoreChanged = !!reread && formatCaptchaRestoreAt(reread.opened.stats?.captchaRestoreAt) !== restoreAt;
    openConfirm({ briefKind: "record",
    freezePendingInput: true,
    getPendingReason: original.getPendingReason,
    action: "恢复人机验证",
    title: "立即恢复人机验证",
    detail: "人机验证立即恢复拦截。",
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    statedBrief: {
      impact: "提交后马上恢复按规则拖滑块，不用等原定的恢复时间。",
      check: "打开后如果已被别人改过，这次不会保存，框里会换上最新的值。",
    },
    get content() { return (
      <>
        {original.getPendingReason() !== undefined && <Notice tone="warn" title="结果未知，可能已经生效">理由已锁住。按原操作重试只发原来那一次，不会重复执行；也可以关掉后在页面上方查询原操作。</Notice>}
        {stale && <Notice tone="warn">{staleText(after.failure)}</Notice>}
        <Facts>
          <Fact k="人机验证"><Change from={basis.stats?.captchaTemporarilyDisabled ? "临时关闭" : "开启"} to="开启" /></Fact>
          <Fact k="原定恢复">{restoreAt}{restoreChanged && <> <StatusTag tone="warn" explain={`你打开时：${formatCaptchaRestoreAt(reread!.opened.stats?.captchaRestoreAt)}`}>刚改过</StatusTag></>}</Fact>
        </Facts>
        {reread && (isVersionConflict(reread.failure)
          ? <Notice tone="warn" title="刚被别人改过，这次没有保存">{restoreChanged ? "原定恢复时间变了，上面已换成最新的。" : "人机验证仍是临时关闭。"}你填的理由还在，核对后再点确认。</Notice>
          : <Notice tone="danger" title="这次没有保存">{rejectionText(reread.failure)}</Notice>)}
      </>
    ); },
    reason: true,
    reasonPlaceholder: "例如：滑块服务已恢复，提前打开人机验证",
    get okLabel() { return original.getPendingReason() !== undefined ? "按原操作重试" : "确认恢复"; },
    getPendingBlockReason: () => original.getPendingExpired() ? C6_EXPIRED_TEXT : undefined,
    // 共用的普通确认框不认 blockedReason，按钮还能点：点了只提示原因，不发请求。
    run: stale ? () => { toast(STALE_TOAST, "warn"); return false; } : (reason) => {
      return original.run("", reason);
    },
    });
  };

  const disableCaptcha = (basis: UserRegistrationRiskOverview, after?: C6Reread) => {
    const rebasing = !!after;
    if (!canWrite) {
      toast("你只有查看权限，不能关闭人机验证");
      return;
    }
    if (!rebasing && (mutation.current || pendingFor("captchaOff") || overviewRef.current !== basis)) return;
    const original = commandRun("captchaOff", "captcha-disable", "临时关闭人机验证", value => `人机验证已临时关闭 · ${value}`, basis, next => disableCaptcha(next.latest ?? next.opened, next));
    const reread = after?.latest ? after : undefined;
    // 「紧急关闭」只在开启时出现；重读后发现别人已经关了，写清再确认会怎样。
    const offNow = !!basis.stats?.captchaTemporarilyDisabled;
    openActionConfirm({ briefKind: "config",
    getPendingReason: original.getPendingReason,
    action: "紧急关闭人机验证",
    title: "临时关闭人机验证",
    detail: "只在滑块服务出故障时使用，须选恢复时间，到点自动开回。",
    amplifies: false,
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    confirmTone: "danger",
    confirmLabel: "确认临时关闭",
    reasonPlaceholder: "例如：滑块服务商故障，用户收不到验证码，工单号…",
    statedBrief: {
      impact: "关闭期间发验证码不再要求拖滑块，强制验证除外；到点自动恢复。",
      check: "恢复时间只能选这四档；打开后如果已被别人改过，这次不会保存。",
    },
    blockedReason: after && !after.latest ? staleText(after.failure) : undefined,
    facts: (
      <>
        <Facts>
          <Fact k="关闭期间仍会验证">{h5ForcedText(basis)}</Fact>
          <Fact k="关闭期间照常执行">{CAPTCHA_LIMITS_STILL_ON}</Fact>
          <Fact k="提前恢复">有本页修改权限的人点「立即恢复」</Fact>
        </Facts>
        {reread && (isVersionConflict(reread.failure)
          ? <Notice tone="warn" title="刚被别人改过，这次没有保存">{offNow
            ? "别人已临时关闭人机验证，原定恢复时间见下方「现在」。再点确认会从现在起按你选的时长重新算。"
            : "人机验证仍是开启的。你选的还在，核对后再点确认。"}</Notice>
          : <Notice tone="danger" title="这次没有保存">{rejectionText(reread.failure)}{offNow && "人机验证现在已临时关闭，再点确认会从现在起按你选的时长重新算。"}</Notice>)}
      </>
    ),
    edit: {
      kind: "select", current: basis.stats?.captchaTemporarilyDisabled ? formatCaptchaRestoreAt(basis.stats.captchaRestoreAt) : "开启", initialValue: CAPTCHA_RECOVERY_OPTIONS[0], options: CAPTCHA_RECOVERY_OPTIONS,
      label: "关闭多久", optionLabels: CAPTCHA_RECOVERY_LABELS,
      hint: "只能选这四档，不能永久关闭",
      preview: (value) => `${CAPTCHA_RECOVERY_LABELS[value] ?? value}后自动恢复，从关闭生效时起算；按原操作重试不会重新计时。`,
    },
    run: (reason, nextValue) => {
      const value = (nextValue ?? "").trim();
      if (!CAPTCHA_RECOVERY_OPTIONS.includes(value)) {
        toast("请选择恢复时间");
        return false;
      }
      return original.run(value, reason);
    },
    });
  };

  const k1Confirm = (guard: UserRegistrationRiskK1Guard) => openConfirm({ briefKind: "record",
    action: "打开「多账户风险排查」",
    title: "到「多账户风险排查」修改",
    detail: <><b>{operatorCopyText(text(guard.name))}</b> 在「多账户风险排查」修改。</>,
    statedBrief: {
      impact: "只跳转到「多账户风险排查」，不保存任何内容。",
      check: "到那一页按那一页的规则修改；没有那一页的修改权限时只能查看。",
    },
    content: (
      <Facts>
        <Fact k="这一项">{operatorCopyText(text(guard.name))}</Fact>
        <Fact k="在哪里改">多账户风险排查</Fact>
      </Facts>
    ),
    remarkHint: "选填",
    reasonPlaceholder: "不用填写，备注不会保存",
    okLabel: "去修改 →",
    run: () => {
      router.push(text(guard.suggestedPath, k1Path));
    },
  });

  const otpMirrorRow = (param: UserRegistrationRiskParam) => (
    <ConfigRow key={rowKey(param)}
      name={operatorCopyText(text(param.name))}
      what={operatorCopyText(text(param.sub, text(param.note)))}
      when={param.sub ? operatorCopyText(text(param.note, "")) || undefined : undefined}
      effect="这里只显示当前值，修改请到「异常套利与刷量排查」"
      value={text(param.value)}
    />
  );

  const captchaOff = Boolean(captchaRestoreAt);
  const restoreText = formatCaptchaRestoreAt(captchaRestoreAt);
  // 长锁没有上限：轴多画一段给「长锁」，段宽只为放得下名字，不代表次数上限。
  const ladderReady = shortRule && longRule && longRule.attempts > shortRule.attempts;

  return (
    <div className="c6-page">
      {header}
      {pendingNotices}
      {error && <Notice tone="danger">{error}</Notice>}

      {captchaOff ? (
        <Conclusion state="warn" lead icon={ShieldOff}
          hint={canWrite ? "除 H5 注册的强制验证外，发验证码不用拖滑块；服务恢复后可在下方立即恢复。" : "除 H5 注册的强制验证外，发验证码不用拖滑块。"}
          explain="到点系统自动恢复；页面不自己倒计时，刷新后才看得到。">
          人机验证已临时关闭，{restoreText}自动恢复
        </Conclusion>
      ) : (
        <Conclusion state="ok" icon={ShieldCheck}
          explain="这句话只看人机验证有没有被临时关闭，锁定规则见下方。下面的计数没有告警线，页面不判断数量是否异常。">
          人机验证开启，App 登录按两级锁定规则执行
        </Conclusion>
      )}

      <StatBand label="今日计数">
        <Stat label="今日登录锁定" value={toNumber(overview?.stats?.locked).toLocaleString("en-US")} unit="次" icon={LockKeyhole} tone="role-3"
          sub={`短锁 ${lockedShort.toLocaleString("en-US")} · 长锁 ${lockedLong.toLocaleString("en-US")}`}
          href={reach(C5_PATH) ? C5_PATH : undefined} openLabel="到安全与登录设备查看被锁的账户"
          explain="今天新触发的锁定次数，同一个账户锁两次算两次；不是现在仍被锁的人数。要看或解除某个账户的锁定，到「安全与登录设备」。" />
        <Stat label="今日验证码记录" value={toNumber(overview?.stats?.otpToday).toLocaleString("en-US")} unit="次" icon={MessageSquareText} tone="role-2"
          explain={`今天登录、两步验证等申请验证码的次数，${stats?.otpIncludesRegistration === true ? "含" : "不含"}注册验证码，${stats?.otpCountsSuccessfulSends === true ? "只算发送成功的" : stats?.otpCountsSuccessfulSends === false ? "发送失败的也算在内" : "也不代表短信都送达了"}。${stats?.otpIncludesRegistration === true ? "" : "统计范围已提给技术补全。"}`} />
        <Stat label="今日人机验证记录" value={toNumber(overview?.stats?.captchaTriggeredToday).toLocaleString("en-US")} unit="次" icon={Fingerprint} tone="role-2"
          explain={stats?.captchaTriggeredProducerFound === true ? "统计要求拖滑块的次数。" : "统计要求拖滑块的次数。系统暂时还没开始记录这类情况，0 不代表今天没人拖过滑块，已提给技术补上。"} />
        <Stat label="近 7 天多账户关联组" value={toNumber(overview?.stats?.stuffingClusters7d).toLocaleString("en-US")} unit="组" icon={Network} tone="role-3"
          href={reach(k1Path) ? k1Path : undefined} openLabel="到多账户风险排查查看关联组"
          explain={`近 7 天${stats?.stuffingClusters7dCountsFirstInsertedOnly === false ? "" : "新出现、"}达到多账户阈值的关联组数${stats?.stuffingClusters7dIsCredentialStuffing === true ? "" : "，按共用注册 IP、设备和支付方式关联，不是试密码的检测"}${stats?.stuffingClusters7dIncludesAllDispositions === false ? "" : "，已处理的也算"}。明细在「多账户风险排查」。`} />
      </StatBand>

      <div className="rd-split c6-main" data-even="">
        <Panel title="App 登录锁定" icon={LockKeyhole} tone="role-3"
          explain={<><p>同一手机号登录、验证码登录、两步验证输错都计数，先到短锁。短锁期间密码和两步验证直接被拒、不再计数，只有验证码登录输错还会累计到长锁。</p><p>IP 每分钟的登录频率限制是另一条固定规则，不在这里设置。</p></>}>
          <div className="c6-ladder">
            {ladderReady ? (
              <ScaleBar label="两级锁定" max={longRule.attempts + Math.max(3, longRule.attempts - shortRule.attempts)}
                valueText={`从第一次输错起 ${shortRule.duration} 分钟内：不到 ${shortRule.attempts} 次可以继续尝试；${shortRule.attempts} 到 ${longRule.attempts - 1} 次锁 ${shortRule.duration} 分钟；${longRule.attempts} 次及以上锁 ${longRule.duration} 小时`}
                bands={{ labels: ["可以继续尝试", `短锁 ${shortRule.duration} 分钟`, `长锁 ${longRule.duration} 小时`], openEnd: true,
                  marks: [{ value: shortRule.attempts, text: `第 ${shortRule.attempts} 次` }, { value: longRule.attempts, text: `第 ${longRule.attempts} 次` }] }} />
            ) : (
              <ScaleBar label="两级锁定" max={1} valueText="锁定规则没有读全" state="empty" emptyText="锁定规则没有读全，下面写的是读到的原值。" />
            )}
            {ladderReady && <p className="c6-ladder-note">{shortRule.duration} 分钟窗口内累计；短锁期间只有验证码登录输错还计数</p>}
          </div>
          <ConfigList label="锁定规则">
            {lockParams.map(adjustRow)}
          </ConfigList>
          {lockParams.length === 0 && <BlockState compact state="empty" title="暂无锁定参数" />}
          {reach(C5_PATH) && (
            <nav className="rd-links" aria-label="解锁用户">
              <span>要解锁某个用户</span><Link className="rd-link" href={C5_PATH} prefetch={false}>到「安全与登录设备」→</Link>
            </nav>
          )}
        </Panel>

        <Panel title="人机验证" icon={captchaOff ? ShieldOff : ShieldCheck} tone={captchaOff ? "warn" : "ok"}
          explain={<><p>发短信验证码前要求拖滑块，挡住批量发码。只在滑块服务出故障、正常用户收不到验证码时临时关闭。</p><p>它会影响注册转化，但它是安全开关：修改需要本页修改权限，增长角色默认只能查看。</p></>}>
          <div className="c6-captcha" data-off={captchaOff ? "" : undefined}>
            <div className="c6-captcha-state">
              <StatusTag tone={captchaOff ? "warn" : "ok"}>{captchaOff ? "临时关闭" : "开启"}</StatusTag>
              <strong>{captchaOff ? `${restoreText}自动恢复` : "发验证码前按规则要求拖滑块"}</strong>
            </div>
            {canWrite && (captchaOff
              ? <Button variant="primary" disabledReason={unavailable("captchaOff")} onClick={() => restoreCaptcha(overview)}>立即恢复</Button>
              : <Button variant="danger-outline" disabledReason={unavailable("captchaOff")} onClick={() => disableCaptcha(overview)}>紧急关闭</Button>)}
          </div>
          <KeyValues rows={[
            ...(captchaOff ? [
              { key: "left", label: "读取时还剩", value: remainingMinutes > 0 ? `约 ${remainingMinutes.toLocaleString("en-US")} 分钟` : "—", explain: "按读取这一刻算，页面不自动倒计时；刷新后更新。" },
              { key: "still", label: "关闭期间仍会验证", value: h5ForcedText(overview) },
              { key: "limits", label: "关闭期间照常执行", value: CAPTCHA_LIMITS_STILL_ON },
            ] : []),
            { key: "after", label: "什么时候要拖滑块", value: otpCaptchaAfterSends === 0 ? "同一手机号每次发验证码都要" : `同一手机号 24 小时内发满 ${otpCaptchaAfterSends} 次，第 ${otpCaptchaStart} 次起`,
              explain: <><p>按同一手机号 24 小时内的发送次数算，不论短信是否送达：发满 {otpCaptchaAfterSends} 次后，从第 {otpCaptchaStart} 次起要拖滑块。</p><p>{alwaysScenes ? "" : "注册等场景可能第一次就要拖，本页读不到这项设置。"}次数在「异常套利与刷量排查」修改。</p></> },
            ...(alwaysScenes && alwaysScenes.length > 0 && !captchaOff ? [{ key: "always", label: "每次都要拖滑块", value: alwaysScenes.map((scene) => CAPTCHA_SCENE_LABEL[scene]).join("、") }] : []),
          ]} />
          {reach(K2_PATH) && (
            <nav className="rd-links" aria-label="滑块次数在别处修改">
              <span>滑块次数和验证码参数</span><Link className="rd-link" href="/risk/abuse" prefetch={false}>到「异常套利与刷量排查」修改 →</Link>
            </nav>
          )}
        </Panel>
      </div>

      <Fold title="短信验证码参数" icon={KeyRound} tone="role-other"
        summary={otpParams.length ? `${otpParams.length} 项：${otpParams.map((param) => `${operatorCopyText(text(param.name))} ${text(param.value)}`).join(" · ")}` : "暂无短信验证码设置"}
        explain="只显示当前值，修改请到「异常套利与刷量排查」。注册、登录、找回密码共用同一手机号的发送额度。"
        actions={reach(K2_PATH) ? <Link className="rd-link" href="/risk/abuse" prefetch={false}>去修改 →</Link> : undefined}>
        {otpParams.length > 0
          ? <ConfigList label="短信验证码参数">{otpParams.map(otpMirrorRow)}</ConfigList>
          : <BlockState compact state="empty" title="暂无短信验证码设置" />}
      </Fold>

      <Fold title="多账户限制" icon={Users} tone="role-other"
        summary={k1Guards.length ? `${k1Guards.length} 项，在「多账户风险排查」修改` : "暂无"}
        explain="同 IP 24 小时注册上限、同设备和同支付方式的绑定上限，都在「多账户风险排查」设置，这页只列出归属。">
        {k1Guards.length > 0 ? (
          <ConfigList label="多账户限制">
            {k1Guards.map((guard) => (
              <ConfigRow key={guardKey(guard)}
                name={operatorCopyText(text(guard.name))}
                what="注册和绑定时的多账户限制"
                effect="当前值和修改都在「多账户风险排查」"
                value={<span className="c6-elsewhere">在多账户风险排查设置</span>}
                action={reach(text(guard.suggestedPath, k1Path)) ? <Button size="sm" onClick={() => k1Confirm(guard)}>去修改 →</Button> : undefined}
              />
            ))}
          </ConfigList>
        ) : <BlockState compact state="empty" title="暂无" />}
      </Fold>

      <Fold title="统计口径与数据来源" icon={SlidersHorizontal} tone="role-other"
        summary={`${(overview?.sources ?? []).length} 个来源${stats?.countsUseBusinessDay === false ? "" : " · 今日按业务日计"}`}
        explain={`${stats?.countsUseBusinessDay === false ? "" : "今日计数从业务日的零点起算；"}多账户关联组按数据库时间往前 7 天。`}>
        <ConfigList label="统计口径与数据来源">
          <ConfigRow name="数据来源" value={(overview?.sources ?? ["登录风控设置", "用户安全状态", "多账户风控设置"]).map(sourceLabel).join("、")} />
          <ConfigRow name="登录锁定出现在" value="风险提醒、安全与登录设备" effect="注册完成会计入用户转化分析" />
          <ConfigRow name="锁定的影响" value="锁定期间，该手机号新的登录都会被拒绝" effect="已登录的设备不会因此下线；注册发验证码不受登录锁定影响" />
        </ConfigList>
      </Fold>
    </div>
  );
}
