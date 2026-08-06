"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  PAYOUT_VND_DEFAULTS,
  PAYOUT_VND_FIELDS,
  deriveBuyRate,
  deriveSellRate,
  isInverted,
  loadPayoutVndConfig,
  payoutVndCrossErrors,
  payoutVndFieldErrors,
  togglePayoutVndChannel,
  updatePayoutVndConfig,
  type PayoutVndChanges,
  type PayoutVndConfig,
  type PayoutVndWritableField,
} from "@/lib/admin/payout-vnd-local";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;

/** 两组提交面:汇率与报价 / 费率与限额(骨架单源 PAYOUT_VND_FIELDS 的分组视图)。 */
const FX_FIELDS = ["buySpreadPct", "sellSpreadPct", "quoteTtlMinWithdraw", "requoteTolerancePct"] as const satisfies readonly PayoutVndWritableField[];
const FEE_FIELDS = ["feeRatePct", "feeMinUsd", "feeMaxUsd", "minAmountUsd", "maxAmountUsd"] as const satisfies readonly PayoutVndWritableField[];

/** 各字段说明(txt.s 行;域与步进从骨架表取,不重复写数字)。 */
const FIELD_NOTES: Record<PayoutVndWritableField, string> = {
  buySpreadPct: "入金方向(用户充值买入 USDT);调整只影响新付款单",
  sellSpreadPct: "出金方向(用户提现换回越南盾);调低放大流出、调高收紧",
  quoteTtlMinWithdraw: "提现报价锁定时长;到期需刷新报价;调长放大、调短收紧",
  requoteTolerancePct: "人工审核后重新报价,偏差超过此值需用户二次确认;调高放大、调低收紧",
  feeRatePct: "按提现金额百分比收取;调低放大、调高收紧",
  feeMinUsd: "单笔费用下限;不得大于等于单笔下限,否则最小额提现到手为零",
  feeMaxUsd: "单笔费用上限(封顶);不得低于最低收费",
  minAmountUsd: "低于此金额不可提交;调低放大、调高收紧",
  maxAmountUsd: "高于此金额不可提交;调高放大、调低收紧",
};

type Drafts = Record<PayoutVndWritableField, string>;

function draftsFrom(cfg: PayoutVndConfig): Drafts {
  const out = {} as Drafts;
  for (const key of Object.keys(PAYOUT_VND_FIELDS) as PayoutVndWritableField[]) {
    out[key] = String(cfg[key]);
  }
  return out;
}

function vnd(value: number) {
  return `${Number(value).toLocaleString("en-US")}₫`;
}

function timeText(value: string) {
  return value ? value.replace("T", " ").slice(0, 19) : "—";
}

export function D7PayoutVnd({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
  const canManage = isSuper || authorities.includes("finance_d7_manage");
  const [cfg, setCfg] = useState<PayoutVndConfig | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadPayoutVndConfig();
      setCfg(next);
      setDrafts(draftsFrom(next));
      setError("");
    } catch (err) {
      setCfg(null);
      setError(err instanceof Error ? err.message : "D7 法币提现参数读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !cfg || !drafts) {
    return <section className="l-card"><div className="l-b">{error ? <><div className="dtint warn">{error}</div><button className="l-btn primary" style={{ marginTop: 12 }} onClick={() => void load()}>重试读取</button></> : "D7 法币提现参数加载中..."}</div></section>;
  }

  // 草稿合成 next(校验、预览、diff 全部对着它;与数据层同一套判据,骨架单源)。
  // 空串按 NaN 处理:清空输入框 ≠ 改成 0,交给字段校验报「请输入有效数值」。
  const draftNext: PayoutVndConfig = { ...cfg };
  for (const key of Object.keys(PAYOUT_VND_FIELDS) as PayoutVndWritableField[]) {
    const raw = drafts[key].trim();
    draftNext[key] = raw === "" ? Number.NaN : Number(raw);
  }
  const fieldErrors = payoutVndFieldErrors(draftNext);
  const crossErrors = payoutVndCrossErrors(draftNext);
  const draftInverted = isInverted(draftNext);

  const changed = (keys: readonly PayoutVndWritableField[]): PayoutVndChanges => {
    const out: PayoutVndChanges = {};
    for (const key of keys) {
      if (draftNext[key] !== cfg[key]) out[key] = draftNext[key];
    }
    return out;
  };
  const fxChanges = changed(FX_FIELDS);
  const feeChanges = changed(FEE_FIELDS);
  const groupHasError = (keys: readonly PayoutVndWritableField[]) => keys.some((key) => fieldErrors[key]);

  // 生效值派生(统计条);草稿派生(预览条)。两个口径分开展示,不混。
  const liveBuy = deriveBuyRate(cfg);
  const liveSell = deriveSellRate(cfg);
  const draftBuy = deriveBuyRate(draftNext);
  const draftSell = deriveSellRate(draftNext);

  const diffLines = (changes: PayoutVndChanges) =>
    (Object.keys(changes) as PayoutVndWritableField[]).map((key) => {
      const spec = PAYOUT_VND_FIELDS[key];
      return <div key={key}>{spec.label}:{String(cfg[key])} {spec.unit} → <b>{String(changes[key])} {spec.unit}</b></div>;
    });

  /** 放大资金流出方向判定(弹窗方向提示):卖出点差/费率/最低费/封顶/下限调低、上限/报价时长/偏差阈值调高。 */
  const amplifies = (changes: PayoutVndChanges) =>
    (changes.sellSpreadPct !== undefined && changes.sellSpreadPct < cfg.sellSpreadPct) ||
    (changes.quoteTtlMinWithdraw !== undefined && changes.quoteTtlMinWithdraw > cfg.quoteTtlMinWithdraw) ||
    (changes.requoteTolerancePct !== undefined && changes.requoteTolerancePct > cfg.requoteTolerancePct) ||
    (changes.feeRatePct !== undefined && changes.feeRatePct < cfg.feeRatePct) ||
    (changes.feeMinUsd !== undefined && changes.feeMinUsd < cfg.feeMinUsd) ||
    (changes.feeMaxUsd !== undefined && changes.feeMaxUsd < cfg.feeMaxUsd) ||
    (changes.minAmountUsd !== undefined && changes.minAmountUsd < cfg.minAmountUsd) ||
    (changes.maxAmountUsd !== undefined && changes.maxAmountUsd > cfg.maxAmountUsd);

  const submitGroup = (label: string, changes: PayoutVndChanges, opts?: { forceInverted?: boolean }) => {
    openActionConfirm({
      action: `法币提现参数变更 · ${label}`,
      detail: <>
        {opts?.forceInverted && <div><b>⚠ 倒挂强制保存</b>:保存后卖出牌价 ≥ 买入牌价,平台在两个方向都不再赚取价差,存在被循环套利的资金风险。默认动作是取消。</div>}
        {diffLines(changes)}
        {(changes.buySpreadPct !== undefined || changes.sellSpreadPct !== undefined) && (
          <div>保存后牌价:买入 {vnd(draftBuy)} / 卖出 {vnd(draftSell)}(当前 {vnd(liveBuy)} / {vnd(liveSell)});只影响之后新建的提现单。</div>
        )}
        <div>方向:{amplifies(changes) ? "放大资金流出。" : "收紧或中性,不放大资金流出。"}</div>
        <div>提交基于配置版本 v{cfg.version};并发变化会被拒绝,任何字段失败均不会部分生效。</div>
      </>,
      amplifies: amplifies(changes),
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "提交成功后生效并落变更历史",
      auditSink: "local-history",
      run: async (reason) => {
        setBusy(true);
        try {
          const next = await updatePayoutVndConfig(changes, cfg.version, reason, OPERATOR(), opts);
          setCfg(next);
          setDrafts(draftsFrom(next));
          setError("");
          toast(`${label} 已生效 · 已落变更历史`);
        } catch (err) {
          // 规格异常4:失败态 + 原值回填 + 可重试,禁假成功。
          setError(err instanceof Error ? err.message : "保存失败,请重试");
          await load();
          throw err;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  // 规格异常5:通道启停属资金流向类动作,走超管确认(两个方向都收超管门,取 GWT 严口径)。
  const toggleChannel = () => {
    const enabling = !cfg.channelEnabled;
    openActionConfirm({
      action: `法币提现通道 · ${enabling ? "开启" : "停用"}(超管确认)`,
      detail: <>
        <div>法币提现通道:{cfg.channelEnabled ? "开启" : "关闭"} → <b>{enabling ? "开启" : "关闭"}</b></div>
        <div>{enabling ? "方向:放大资金流出 —— 开启后用户可发起银行卡(越南盾)提现。" : "方向:收紧资金流出 —— 停用后新提现单不可发起。"}</div>
        <div>在途单不受影响,照常推进到终态。</div>
      </>,
      amplifies: enabling,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "提交成功后生效并落变更历史",
      auditSink: "local-history",
      run: async (reason) => {
        setBusy(true);
        try {
          const next = await togglePayoutVndChannel(enabling, cfg.version, reason, OPERATOR());
          setCfg(next);
          setDrafts(draftsFrom(next));
          setError("");
          toast(`通道已${enabling ? "开启" : "停用"} · 已落变更历史`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "保存失败,请重试");
          await load();
          throw err;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  // 规格 §⑥ 倒挂强制行:二次身份确认(非凭据式指定短语)+ 风险声明,通过后才进「diff + 理由」确认。
  const FORCE_PHRASE = "确认倒挂风险";
  const startForcedSave = () => {
    openConfirm({
      action: "倒挂强制保存 · 二次确认",
      detail: <>
        <div><b>风险声明</b>:保存后卖出牌价 ≥ 买入牌价,平台在两个方向都不再赚取价差,存在被循环套利的资金风险。默认动作是取消。</div>
        <div style={{ marginTop: 6 }}>如确认继续,请在下方输入「{FORCE_PHRASE}」。</div>
      </>,
      input: { label: `输入「${FORCE_PHRASE}」以继续`, placeholder: FORCE_PHRASE, kind: "text" },
      okLabel: "继续(仍需填写理由)",
      run: (_reason, value) => {
        if ((value ?? "").trim() !== FORCE_PHRASE) {
          toast(`短语不匹配:请输入「${FORCE_PHRASE}」`);
          throw new Error("FORCE_PHRASE_MISMATCH");
        }
        submitGroup("双向牌价与报价(倒挂强制)", fxChanges, { forceInverted: true });
      },
    });
  };

  const inputRow = (key: PayoutVndWritableField) => {
    const spec = PAYOUT_VND_FIELDS[key];
    return (
      <div className="p-row" key={key}>
        <div className="txt">
          <div className="k">{spec.label}</div>
          <div className="s">{spec.min}–{spec.max} {spec.unit};{FIELD_NOTES[key]}</div>
          {fieldErrors[key] && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>{fieldErrors[key]}</div>}
        </div>
        <input
          aria-label={`${spec.label}目标值`}
          className="l-inp"
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={drafts[key]}
          disabled={!canManage || busy}
          onChange={(event) => setDrafts((current) => (current ? { ...current, [key]: event.target.value } : current))}
        />
        <span>{spec.unit}</span>
      </div>
    );
  };

  return <>
    {error && <div className="dtint warn" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="f-stats">
      <div className="f-stat ok"><div className="k">买入牌价(生效 · 派生)</div><div className="v">1 USDT ≈ {vnd(liveBuy)}</div><div className="sub">基准 ×(1 + 买入点差)· 取整到十位</div></div>
      <div className="f-stat cyan"><div className="k">卖出牌价(生效 · 派生)</div><div className="v">1 USDT ≈ {vnd(liveSell)}</div><div className="sub">基准 ×(1 − 卖出点差)· 提现按此折算</div></div>
      <div className={`f-stat ${liveSell >= liveBuy ? "danger" : ""}`}><div className="k">双向价差</div><div className="v">{vnd(liveBuy - liveSell)}</div><div className="sub">{liveSell >= liveBuy ? "倒挂中 · 存在双向亏损风险" : "买入价 − 卖出价 · 平台价差空间"}</div></div>
      <div className={`f-stat ${cfg.channelEnabled ? "warn" : ""}`}><div className="k">法币提现通道</div><div className="v">{cfg.channelEnabled ? "开启" : "关闭"}</div><div className="sub">首发默认关闭 · 停用不影响在途单</div></div>
    </div>

    <section className="l-card" style={{ marginBottom: 12 }}>
      <div className="l-h"><span className="ttl">联动核验入口</span><span className="sub">· 基准价、提现审核与 USDT 侧参数可直接追踪</span></div>
      <div className="l-b">
        <div className="chips">
          <Link className="chip" href="/finance/fx-rate">D6 汇率牌价(基准价单源)</Link>
          <Link className="chip" href="/finance/withdrawals">D2 提现审核</Link>
          <Link className="chip" href="/finance/params">D5 提现参数(USDT 侧)</Link>
        </div>
      </div>
    </section>

    <div className="two-col r11">
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">双向牌价与报价(操作确认)</span>
          <span className="sub">· 配置版本 v{cfg.version} · {canManage ? "确认 + 理由后生效" : "当前角色只读"}</span>
          <div className="r"><button className="l-btn sm" disabled={busy} onClick={() => void load()}>刷新</button></div>
        </div>
        <div className="l-b">
          <div className="p-row">
            <div className="txt"><div className="k">基准价</div><div className="s">由 D6 汇率牌价统一维护;本页为快照展示、只读,不提供第二个写入口</div></div>
            <span className="v">{vnd(cfg.baseRateVndPerUsdt)}</span>
            <Link className="l-btn sm" href="/finance/fx-rate">在 D6 调整 →</Link>
          </div>
          {FX_FIELDS.map(inputRow)}
          {fieldErrors.buySpreadPct || fieldErrors.sellSpreadPct ? (
            <div className="dtint warn" style={{ marginTop: 12 }}>
              <b>草稿牌价预览</b> · 点差输入无效,预览已停用;输入合法点差后显示两个方向的派生牌价(报价只对能提交的输入出)。
            </div>
          ) : (
            <div className="dtint ok" style={{ marginTop: 12 }}>
              <b>草稿牌价预览</b> · 买入 {vnd(cfg.baseRateVndPerUsdt)} ×(1 + {draftNext.buySpreadPct}%)= <b>{vnd(draftBuy)}</b>;卖出 {vnd(cfg.baseRateVndPerUsdt)} ×(1 − {draftNext.sellSpreadPct}%)= <b>{vnd(draftSell)}</b>;价差 <b>{vnd(draftBuy - draftSell)}</b>(幅度 {(draftNext.buySpreadPct + draftNext.sellSpreadPct).toFixed(2)}%)。充值取买入、提现取卖出,两方向各自取数。
            </div>
          )}
          {draftInverted && (
            <div className="dtint warn" style={{ marginTop: 10 }}>
              <b>价差倒挂</b> · 卖出牌价 ≥ 买入牌价,平台两个方向都不再赚取价差,默认拒绝保存。{isSuper ? "你是超级管理员,可在下方走强制保存(带风险声明)。" : "仅超级管理员可强制保存。"}
            </div>
          )}
          {canManage && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button
                className="l-btn sm mc"
                disabled={busy || Object.keys(fxChanges).length === 0 || groupHasError(FX_FIELDS) || draftInverted}
                onClick={() => submitGroup("双向牌价与报价", fxChanges)}
              >预览并提交</button>
              {isSuper && draftInverted && (
                <button
                  className="l-btn sm"
                  disabled={busy || Object.keys(fxChanges).length === 0 || groupHasError(FX_FIELDS)}
                  onClick={startForcedSave}
                >强制保存(倒挂风险 · 二次确认)</button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">提现费率与限额(操作确认)</span>
          <span className="sub">· 与 USDT 网络确认费(D5)并列独立,不共用字段</span>
        </div>
        <div className="l-b">
          {FEE_FIELDS.map(inputRow)}
          {crossErrors.map((message) => (
            <div className="dtint warn" style={{ marginTop: 10 }} key={message}>{message}</div>
          ))}
          {canManage && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button
                className="l-btn sm mc"
                disabled={busy || Object.keys(feeChanges).length === 0 || groupHasError(FEE_FIELDS) || crossErrors.length > 0}
                onClick={() => submitGroup("提现费率与限额", feeChanges)}
              >预览并提交</button>
              <button
                className="l-btn sm"
                disabled={busy}
                onClick={() => setDrafts(draftsFrom({ ...cfg, ...PAYOUT_VND_DEFAULTS, baseRateVndPerUsdt: cfg.baseRateVndPerUsdt }))}
              >恢复全部默认(两组草稿,仍需分组提交)</button>
            </div>
          )}
        </div>
      </section>
    </div>

    <div className="two-col r11" style={{ marginTop: 12 }}>
      <section className="l-card">
        <div className="l-h"><span className="ttl">通道总开关</span><span className="sub">· 资金流向类动作 · 确认 + 理由 + 落历史</span></div>
        <div className="l-b">
          <div className="p-row">
            <div className="txt"><div className="k">银行卡(越南盾)提现通道</div><div className="s">停用后新提现单不可发起;在途单不受影响,照常推进到终态;启停均需超级管理员确认</div></div>
            <span className={`bdg ${cfg.channelEnabled ? "warn" : "ok"}`}>{cfg.channelEnabled ? "开启" : "关闭"}</span>
            {isSuper ? (
              <button className="l-btn sm mc" disabled={busy} onClick={toggleChannel}>{cfg.channelEnabled ? "停用通道" : "开启通道"}</button>
            ) : (
              <span className="s">需超级管理员操作</span>
            )}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">生效历史</span><span className="sub">· 每次调整含前后值、操作者与理由</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>时间</th><th>变更内容</th><th>操作者</th><th>理由</th></tr></thead>
            <tbody>
              {cfg.history.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>暂无调整历史</td></tr>
              ) : cfg.history.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{timeText(row.createdAt)}</td>
                  <td>
                    {row.changes.map((change) => (
                      <div key={change.field}>{change.label}:{change.before} → <b>{change.after}</b></div>
                    ))}
                    {row.forced && <span className="bdg warn">倒挂强制</span>}
                  </td>
                  <td>{row.operator}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </>;
}
