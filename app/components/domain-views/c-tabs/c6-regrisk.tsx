"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * C6 注册与登录风险配置。
 * 数据源为后端 /registration-risk/overview；调参写 /registration-risk/params/{paramKey}。
 * 读取、提交、命令号和校验沿用改版前的写法；这次只换界面（rd 组件）。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Fingerprint, KeyRound, LockKeyhole, MessageSquareText, Network, RefreshCw, ShieldCheck, ShieldOff, SlidersHorizontal, Users } from "lucide-react";
import { BlockState, Button, Change, ConfigList, ConfigRow, Conclusion, Fact, Facts, Fold, KeyValues, Notice, PageHeader, Panel, ScaleBar, Stat, StatBand, StatusTag } from "@/app/components/rd";
import { businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
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
const CAPTCHA_STILL_ON = "H5 注册的强制验证照常要求拖滑块";
const CAPTCHA_LIMITS_STILL_ON = "重发冷却、短时间内的发送次数、同号 24 小时上限、IP 频率限制照常执行";

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
  return `${formatBusinessTimeFull(deadline.toISOString())}（${businessZone().label}）`;
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

export function C6Regrisk({ ctx }: { ctx: CCtx }) {
  const reach = useReach();
  const router = useRouter();
  const { toast, openActionConfirm, openConfirm } = ctx;
  const role = useAdminAuth((state) => state.session?.role ?? state.role);
  const authorities = useAdminAuth((state) => state.session?.authorities ?? EMPTY_AUTHORITIES);
  const canWrite = role === "super" || role === "superadmin" || authorities.includes("user_c6_write");
  const [overview, setOverview] = useState<UserRegistrationRiskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 只用于页头「读取于」，不参与任何判断。 */
  const [readAt, setReadAt] = useState<number | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchUserRegistrationRiskOverview();
      setOverview(data);
      setReadAt(Date.now());
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
      // 只换提示的字和颜色：结果未知（命令号已保留）不说成失败，用橙黄（VS-107）。
      const unsure = writeReturned || err instanceof UsersOutcomeUnknownError;
      setOverview(null);
      setError(`${unsure ? "结果待确认" : "操作失败"} · ${message}`);
      toast(`${unsure ? "结果待确认" : "操作失败"} · ${message}`, unsure ? "warn" : "error");
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  const header = (
    <PageHeader
      pageId="C6"
      title="注册与登录风险"
      summary="看今天的登录和验证码情况，调整 App 登录锁定和人机验证。"
      meta={readAt && overview ? `读取于 ${formatBusinessTimeFull(new Date(readAt).toISOString())}（${businessZone().label}）· 手动刷新` : undefined}
      readOnly={canWrite ? undefined : "你只有查看权限，锁定规则和人机验证不能修改"}
      actions={<Button icon={<RefreshCw size={14} />} loading={loading} disabledReason={busy ? "正在提交，请稍候" : undefined} onClick={() => void loadData()}>刷新</Button>}
    />
  );

  // 结果待确认：perform 在请求前记下命令号，只有成功或明确失败才删；留下来的就是没有确定结果的那一笔。
  // 界面已备好：「按原操作重试」「解除待确认」等原请求恢复由逻辑 worker 接（R1，重构说明 F01/F02），这里只给读回核对。
  const pending = busy ? [] : pendingCommandKeys.list();
  const pendingNotices = pending.length > 0 && (
    <div className="c6-pending" aria-label="结果待确认">
      {pending.map((record) => (
        <Notice key={record.commandKey} tone="warn" title={`${pendingLabel(record.fingerprint)}：结果待确认`} actionBelow
          action={<Button size="sm" loading={loading} onClick={() => void loadData()}>刷新核对</Button>}>
          <p>没有收到确定的结果，可能已经生效。先刷新，看当前规则是不是已经变成你要的值；已经是就不用再提交。</p>
          <p>这条记录保留到 {formatBusinessTimeFull(new Date(record.expiresAt).toISOString())}（{businessZone().label}）· 命令号 <span data-mono>{record.commandKey}</span></p>
        </Notice>
      ))}
    </div>
  );

  if (!overview) {
    return (
      <div className="c6-page">
        {header}
        {pendingNotices}
        {loading ? (
          <BlockState state="loading" title="正在读取注册与登录风险" />
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
  const captchaRestoreAt = overview.stats?.captchaTemporarilyDisabled ? text(overview.stats.captchaRestoreAt, "") : "";
  const configVersion = toNumber(overview.configVersion, -1);
  const k1Guards = overview?.k1Guards ?? [];
  const k1RejectCode = text(overview?.k1RejectCode, K1_REJECT_CODE_FALLBACK);
  const k1Path = text(overview?.k1Path, K1_PATH_FALLBACK);
  const shortParam = lockParams.find((row) => row.key === "lockShort");
  const longParam = lockParams.find((row) => row.key === "lockLong");
  const shortRule = lockRule(shortParam, "分钟");
  const longRule = lockRule(longParam, "小时");
  const remainingMinutes = Math.ceil(toNumber(overview.stats?.captchaRemainingSeconds) / 60);
  const lockedShort = toNumber(overview?.stats?.lockedShort);
  const lockedLong = toNumber(overview?.stats?.lockedLong);

  const ruleText = (rule: ReturnType<typeof lockRule>, param?: UserRegistrationRiskParam) => rule ? `输错 ${rule.attempts} 次 · 锁 ${rule.duration} ${rule.unit}` : text(param?.value);

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
        ? `保存后，从第一次输错起 ${windowMinutes}内累计输错到 ${a} 次，就锁 ${d} 小时；之后新的输错都按这条规则。`
        : `保存后，从第一次输错起 ${d} 分钟内输错 ${a} 次，就锁 ${d} 分钟；这段时间也是长锁的计数窗口。`;
    };
    const open = () => openActionConfirm({ briefKind: "config",
      action: `调整登录锁定 · ${name}`,
      title: `调整${name}`,
      detail: <><b>{name}</b> · 当前 {text(param.value)} · 次数可设 {attemptMin}–{attemptMax}，时长可设 {durationMin}–{durationMax} {durationUnit}。长时锁定的次数须大于短时锁定。</>,
      amplifies: false,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: `确认调整${name}`,
      reasonPlaceholder: "例如：近期撞库尝试增多，依据风控工单收紧短锁次数",
      facts: (
        <Facts>
          <Fact k="现在">{ruleText(lockRule(param, durationUnit), param)}</Fact>
          <Fact k={isLong ? "短锁（不改）" : "长锁（不改）"}>{ruleText(isLong ? shortRule : longRule, isLong ? shortParam : longParam)}</Fact>
          <Fact k="正在被锁的账户">按原来的解锁时间解锁，已累计的输错次数不清零</Fact>
        </Facts>
      ),
      statedBrief: (value) => ({
        impact: impactFor(value.attempts, value.duration),
        check: `提交时检查整数范围、长锁次数大于短锁次数和配置版本（${configVersion}）；IP 每分钟的登录频率限制不是这里设置的。`,
      }),
      businessForm: {
        kind: "multi-field",
        hint: `次数和时长会一起保存（当前版本 ${configVersion}）`,
        fields: [
          { key: "attempts", label: "输错几次后锁定", inputKind: "number", current: String(currentAttempts), min: toNumber(param.min, 0), max: toNumber(param.max, 0), step: 1, required: true, help: `${attemptMin}–${attemptMax} 次，${relation}` },
          { key: "duration", label: `锁定时长(${durationUnit})`, inputKind: "number", current: String(currentDuration), min: toNumber(param.secondaryMin, 0), max: toNumber(param.secondaryMax, 0), step: 1, required: true, help: `${durationMin}–${durationMax} ${durationUnit}` },
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
    });
    const rule = lockRule(param, durationUnit);
    return (
      <ConfigRow key={rowKey(param)} id={`c6-${key}`}
        name={name}
        what={isLong ? "输错太多次时的第二级锁定，锁的时间更长" : "连续输错时的第一级锁定"}
        when="保存后立即生效，之后的输错按新规则计数和锁定"
        effect={isLong
          ? `短锁的 ${windowMinutes}计数窗口内累计输错到这个次数就锁长锁。已经锁上的账户按原解锁时间解锁，不会强制用户重置密码`
          : "这个时长同时是输错次数的计数窗口：从第一次输错起算，过了这段时间重新计数。已经锁上的账户按原解锁时间解锁"}
        where="App 登录、验证码登录和两步验证输错时；用户只看到「暂时锁定」，看不到解锁时间"
        value={rule ? <span className="c6-rule">输错 <b>{rule.attempts}</b> 次<span aria-hidden>→</span>锁 <b>{rule.duration}</b> {rule.unit}</span> : text(param.value)}
        action={canWrite && !param.readOnly
          ? <Button size="sm" disabledReason={busy ? "正在提交，请稍候" : !key ? "这项缺少参数键，暂时不能调整" : undefined} onClick={open}>调整</Button>
          : undefined}
      />
    );
  };

  const restoreCaptcha = () => {
    if (!canWrite) {
      toast("你只有查看权限，不能恢复人机验证");
      return;
    }
    openConfirm({ briefKind: "record",
    action: "恢复人机验证",
    title: "立即恢复人机验证",
    detail: "人机验证立即恢复拦截。",
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    statedBrief: {
      impact: "提交后发短信验证码重新按规则要求拖滑块，不用等到原定的恢复时间；不影响已发出的验证码和用户的登录锁定。",
      check: `提交时检查修改权限和配置版本（${configVersion}）；版本变了会被拒绝，请刷新后再提交。`,
    },
    content: (
      <Facts>
        <Fact k="人机验证"><Change from="临时关闭" to="开启" /></Fact>
        <Fact k="原定恢复">{formatCaptchaRestoreAt(captchaRestoreAt)}</Fact>
      </Facts>
    ),
    reason: true,
    reasonPlaceholder: "例如：滑块服务已恢复，提前打开人机验证",
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
    openActionConfirm({ briefKind: "config",
    action: "紧急关闭人机验证",
    title: "临时关闭人机验证",
    detail: <><b>关闭后，同一手机号频繁发验证码将不再被拦截</b>。只在人机验证服务出故障时使用，须选择恢复时间，到时自动开回。</>,
    amplifies: false,
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    confirmTone: "danger",
    confirmLabel: "确认临时关闭",
    reasonPlaceholder: "例如：滑块服务商故障，用户收不到验证码，工单号…",
    statedBrief: {
      impact: "关闭期间发短信验证码不再要求拖滑块，挡批量发码的这一道暂时没有；到点由系统自动恢复。",
      check: `提交时检查修改权限、恢复时间是否为四个固定选项之一和配置版本（${configVersion}）。`,
    },
    facts: (
      <Facts>
        <Fact k="关闭期间仍会验证">{CAPTCHA_STILL_ON}</Fact>
        <Fact k="关闭期间照常执行">{CAPTCHA_LIMITS_STILL_ON}</Fact>
        <Fact k="谁能提前恢复">有本页修改权限的人，在这页点「立即恢复」</Fact>
      </Facts>
    ),
    edit: {
      kind: "select", current: "开启", initialValue: CAPTCHA_RECOVERY_OPTIONS[0], options: CAPTCHA_RECOVERY_OPTIONS,
      label: "关闭多久", optionLabels: CAPTCHA_RECOVERY_LABELS,
      hint: "只能选这四档，不能永久关闭",
      preview: (value) => `${CAPTCHA_RECOVERY_LABELS[value] ?? value}后自动恢复：从服务器收到这次提交时开始计时，恢复时间以页面刷新后显示的为准。`,
    },
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

  const k1Confirm = (guard: UserRegistrationRiskK1Guard) => openConfirm({ briefKind: "record",
    action: `422 · ${text(guard.rejectCode, k1RejectCode)}`,
    title: "到「多账户风险排查」修改",
    detail: <><b>{operatorCopyText(text(guard.name))}</b> 在「多账户风险排查」修改。</>,
    statedBrief: {
      impact: "只打开「多账户风险排查」，这一步不保存任何设置，备注也不会保存，不写操作记录。",
      check: "到那一页后按那一页的规则修改；没有那一页的修改权限时只能查看。",
    },
    content: (
      <Facts>
        <Fact k="这一项">{operatorCopyText(text(guard.name))}</Fact>
        <Fact k="在哪里改">多账户风险排查</Fact>
        <Fact k="归属码"><span data-mono>{text(guard.rejectCode, k1RejectCode)}</span></Fact>
      </Facts>
    ),
    remarkHint: "选填",
    reasonPlaceholder: "不用填写，备注不会保存",
    okLabel: "去修改",
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
          hint={`关闭期间发验证码不要求拖滑块；${CAPTCHA_STILL_ON}。服务恢复后可以在下方立即恢复。`}
          explain="人机验证的开关读自服务器；页面不会自己倒计时，到点后后端自动恢复，刷新页面才看得到。">
          人机验证已临时关闭，{restoreText} 自动恢复
        </Conclusion>
      ) : (
        <Conclusion state="ok" icon={ShieldCheck}
          explain="这句话看两件事：人机验证有没有被临时关闭，两级登录锁定规则有没有读到。下面的计数没有告警线，页面不判断数量是否异常。">
          人机验证开启，App 登录按两级锁定规则执行
        </Conclusion>
      )}

      <StatBand label="今日计数">
        <Stat label="今日登录锁定" value={toNumber(overview?.stats?.locked).toLocaleString("en-US")} unit="次" icon={LockKeyhole} tone="role-3"
          sub={`短锁 ${lockedShort.toLocaleString("en-US")} · 长锁 ${lockedLong.toLocaleString("en-US")}`}
          href={reach(C5_PATH) ? C5_PATH : undefined} openLabel="到安全与登录设备查看被锁的账户"
          explain="今天新触发的锁定次数，同一个账户锁两次算两次；不是现在仍被锁的人数。要看或解除某个账户的锁定，到「安全与登录设备」。" />
        <Stat label="今日验证码记录" value={toNumber(overview?.stats?.otpToday).toLocaleString("en-US")} unit="次" icon={MessageSquareText} tone="role-2"
          explain="今天新建的验证码记录数（登录、两步验证等），不含注册验证码，也不代表短信都发送成功了。统计范围已提给后端补全。" />
        <Stat label="今日人机验证记录" value={toNumber(overview?.stats?.captchaTriggeredToday).toLocaleString("en-US")} unit="次" icon={Fingerprint} tone="role-2"
          explain="数的是「需要拖滑块」的事件记录。后端目前还没有写这类记录，0 不代表今天没人拖过滑块，已提给后端补上。" />
        <Stat label="近 7 天多账户关联组" value={toNumber(overview?.stats?.stuffingClusters7d).toLocaleString("en-US")} unit="组" icon={Network} tone="role-3"
          href={reach(k1Path) ? k1Path : undefined} openLabel="到多账户风险排查查看关联组"
          explain="近 7 天新出现、达到多账户阈值的关联组数，不只是批量试密码，也不分是否已处理。明细在「多账户风险排查」。" />
      </StatBand>

      <div className="rd-split c6-main" data-even="">
        <Panel title="App 登录锁定" icon={LockKeyhole} tone="role-3"
          explain={<><p>同一个手机号输错密码、验证码或两步验证时计数。先到短锁，继续输错到长锁次数就升级成长锁。</p><p>IP 每分钟的登录频率限制是另一条固定规则，不在这里设置。</p></>}>
          <div className="c6-ladder">
            {ladderReady ? (
              <ScaleBar label="两级锁定" max={longRule.attempts + Math.max(3, longRule.attempts - shortRule.attempts)}
                valueText={`从第一次输错起 ${shortRule.duration} 分钟内：不到 ${shortRule.attempts} 次可以继续尝试；${shortRule.attempts} 到 ${longRule.attempts - 1} 次锁 ${shortRule.duration} 分钟；${longRule.attempts} 次及以上锁 ${longRule.duration} 小时`}
                bands={{ labels: ["可以继续尝试", `短锁 ${shortRule.duration} 分钟`, `长锁 ${longRule.duration} 小时`], openEnd: true,
                  marks: [{ value: shortRule.attempts, text: `第 ${shortRule.attempts} 次` }, { value: longRule.attempts, text: `第 ${longRule.attempts} 次` }] }} />
            ) : (
              <ScaleBar label="两级锁定" max={1} valueText="锁定规则没有读全" state="empty" emptyText="锁定规则没有读全，下面写的是读到的原值。" />
            )}
            {ladderReady && <p className="c6-ladder-note">从第一次输错起 {shortRule.duration} 分钟内累计计数，过了这段时间重新计数</p>}
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
              <strong>{captchaOff ? `${restoreText} 自动恢复` : "发验证码前按规则要求拖滑块"}</strong>
            </div>
            {canWrite && (captchaOff
              ? <Button variant="primary" disabledReason={busy ? "正在提交，请稍候" : undefined} onClick={restoreCaptcha}>立即恢复</Button>
              : <Button variant="danger-outline" disabledReason={busy ? "正在提交，请稍候" : undefined} onClick={disableCaptcha}>紧急关闭</Button>)}
          </div>
          <KeyValues rows={[
            ...(captchaOff ? [
              { key: "left", label: "读取时还剩", value: remainingMinutes > 0 ? `约 ${remainingMinutes.toLocaleString("en-US")} 分钟` : "—", explain: "按读取这一刻算，页面不自动倒计时；刷新后更新。" },
              { key: "still", label: "关闭期间仍会验证", value: "H5 注册的强制验证" },
              { key: "limits", label: "关闭期间照常执行", value: "重发冷却、发送次数上限、IP 频率限制" },
            ] : []),
            { key: "after", label: "什么时候要拖滑块", value: otpCaptchaAfterSends === 0 ? "同一手机号每次发验证码都要" : `同一手机号 24 小时内发满 ${otpCaptchaAfterSends} 次，第 ${otpCaptchaStart} 次起`,
              explain: <><p>同一手机号 24 小时内发满 {otpCaptchaAfterSends} 次验证码后，从第 {otpCaptchaStart} 次起要拖动滑块。</p><p>有些场景（比如注册）可能第一次发验证码就要拖，按后端配置，本页读不到这一项。次数在「异常套利与刷量排查」修改。</p></> },
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
        actions={reach(K2_PATH) ? <Link className="rd-link" href="/risk/abuse" prefetch={false}>去修改</Link> : undefined}>
        {otpParams.length > 0
          ? <ConfigList label="短信验证码参数">{otpParams.map(otpMirrorRow)}</ConfigList>
          : <BlockState compact state="empty" title="暂无短信验证码设置" />}
      </Fold>

      <Fold title="多账户限制" icon={Users} tone="role-other"
        summary={k1Guards.length ? `${k1Guards.length} 项，在「多账户风险排查」修改` : "暂无"}
        explain="同一 IP 每天注册上限、同一设备绑定上限、同一支付方式绑定上限，都在「多账户风险排查」设置，这页只列出归属。">
        {k1Guards.length > 0 ? (
          <ConfigList label="多账户限制">
            {k1Guards.map((guard) => (
              <ConfigRow key={guardKey(guard)}
                name={operatorCopyText(text(guard.name))}
                what="注册和绑定时的多账户限制"
                effect="当前值和修改都在「多账户风险排查」"
                value={<span className="c6-elsewhere">在多账户风险排查设置</span>}
                action={reach(text(guard.suggestedPath, k1Path)) ? <Button size="sm" onClick={() => k1Confirm(guard)}>去修改</Button> : undefined}
              />
            ))}
          </ConfigList>
        ) : <BlockState compact state="empty" title="暂无" />}
      </Fold>

      <Fold title="统计口径与数据来源" icon={SlidersHorizontal} tone="role-other"
        summary={`${(overview?.sources ?? []).length} 个来源 · 今日按业务日计`}
        explain="今日计数从业务日的零点起算；多账户关联组按数据库时间往前 7 天。">
        <ConfigList label="统计口径与数据来源">
          <ConfigRow name="数据来源" value={(overview?.sources ?? ["登录风控设置", "用户安全状态", "多账户风控设置"]).map(sourceLabel).join(" · ")} />
          <ConfigRow name="会出现在哪里" value="登录锁定出现在风险提醒和「安全与登录设备」" effect="注册完成会计入用户转化分析" />
          <ConfigRow name="锁定的影响" value="锁定期间，该手机号的所有登录都会被拒绝" effect="已登录的设备不会因此下线；注册发验证码不受登录锁定影响" />
        </ConfigList>
      </Fold>
    </div>
  );
}
