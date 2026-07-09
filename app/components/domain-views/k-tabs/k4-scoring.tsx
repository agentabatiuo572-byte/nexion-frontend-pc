"use client";

import { useEffect, useId, useState } from "react";
import { DataListPager } from "../design-kit";
import type { K4Distribution, K4User, K4UserOption } from "@/lib/admin/k-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function scoreColor(score: number) {
  return score >= 70 ? "var(--danger)" : score >= 40 ? "var(--warning)" : "var(--success)";
}

export function K4HeaderActions() {
  return <span className="f-ro"><span className="d" />全平台唯一评分源 · 别处只引用不重算</span>;
}

function BandDonut({ dist, totalUsers }: { dist: K4Distribution[]; totalUsers: number }) {
  const gid = useId();
  const C = 2 * Math.PI * 64, gap = 3;
  let off = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 168 168" aria-label="风险分档分布">
        <circle cx={84} cy={84} r={64} fill="none" stroke="var(--surface-3)" strokeWidth={17} />
        {dist.map((s) => {
          const len = Math.max((C * s.percentage) / 100 - gap, 2);
          const el = (
            <circle key={`${gid}-${s.band}`} cx={84} cy={84} r={64} fill="none" stroke={s.color || "var(--ink-4)"} strokeWidth={17}
              strokeDasharray={`${len.toFixed(1)} ${C.toFixed(1)}`} strokeDashoffset={(-off).toFixed(1)}>
              <title>{`${s.band} ${s.percentage}%`}</title>
            </circle>
          );
          off += (C * s.percentage) / 100;
          return el;
        })}
      </svg>
      <div className="c"><div><div className="n">{fmt(totalUsers)}</div><div className="l">在册用户</div></div></div>
    </div>
  );
}

export function K4Scoring({ ctx }: { ctx: KCtx }) {
  const propose = usePropose();
  const overview = ctx.risk.scoring;
  const dimensions = overview?.dimensions ?? [];
  const config = overview?.config;
  const dist = overview?.distribution ?? [];
  const [weights, setWeights] = useState<number[]>([]);
  const [touched, setTouched] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<K4UserOption[]>([]);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [defaultUserLoaded, setDefaultUserLoaded] = useState(false);
  const [lookupUser, setLookupUser] = useState<K4User | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const userOptionsId = useId();
  const [overridePage, setOverridePage] = useState(1);
  const [overridePageSize, setOverridePageSize] = useState(5);
  const overridesPage = overview?.overrides;
  const overrides = overridesPage?.records ?? [];

  const dimSignature = dimensions.map((d) => `${d.dimKey}:${d.weightPct}`).join("|");
  useEffect(() => {
    setWeights(dimensions.map((d) => d.weightPct / 100));
    setTouched(false);
  }, [dimSignature]);

  const liveWeights = touched ? weights : dimensions.map((d) => d.weightPct / 100);
  const pctWeights = liveWeights.map((v) => Math.round(v * 100));
  const pctTotal = pctWeights.reduce((a, b) => a + b, 0);
  const sum = liveWeights.reduce((a, b) => a + b, 0);
  const sumOk = pctTotal === 100;

  const loadUser = async (id: string) => {
    const userNo = id.trim();
    if (!userNo) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const user = await ctx.actions.fetchK4User(userNo);
      setLookupUser(user);
      setUserSearch(user.userNo);
    } catch (error) {
      setLookupError(errorText(error));
      ctx.toast(`K4 查询失败 · ${errorText(error)}`);
    } finally {
      setLookupLoading(false);
    }
  };

  useEffect(() => {
    if (!overview) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setUserSearchLoading(true);
      setUserSearchError(null);
      ctx.actions.searchK4Users(userSearch)
        .then((options) => {
          if (!alive) return;
          setUserOptions(options);
        })
        .catch((error) => {
          if (!alive) return;
          setUserOptions([]);
          setUserSearchError(errorText(error));
        })
        .finally(() => {
          if (alive) setUserSearchLoading(false);
        });
    }, 240);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ctx.actions, overview, userSearch]);

  useEffect(() => {
    if (!overview || defaultUserLoaded || lookupUser || userOptions.length === 0) return;
    if (userSearch.trim() || userSearchOpen) return;
    setDefaultUserLoaded(true);
    const first = userOptions[0];
    setUserSearch(first.userNo);
    setUserSearchOpen(false);
    void loadUser(first.userNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, userOptions, defaultUserLoaded, lookupUser, userSearch, userSearchOpen]);

  useEffect(() => {
    void ctx.reloadKRisk({
      scoring: {
        overridePageNum: overridePage,
        overridePageSize,
      },
    });
  }, [ctx.reloadKRisk, overridePage, overridePageSize]);

  const reloadCurrentScoring = () =>
    ctx.reloadKRisk({
      scoring: {
        overridePageNum: overridePage,
        overridePageSize,
      },
    });

  const runAction = async (work: () => Promise<void>, ok: string) => {
    try {
      await work();
      await reloadCurrentScoring();
      ctx.toast(ok);
    } catch (error) {
      ctx.toast(`K4 操作失败 · ${errorText(error)}`);
    }
  };

  const submitWeights = () => {
    if (!sumOk) { ctx.toast(`合计 ${pctTotal}% ≠ 100%,服务器会拒绝`); return; }
    ctx.openActionConfirm({
      action: "评分模型权重变更",
      detail: `新权重:${dimensions.map((d, i) => `${d.name} ${pctWeights[i]}%`).join(" / ")}。影响提现路由、画像展示和雷达告警。`,
      run: (reason) => {
        const next = Object.fromEntries(dimensions.map((d, i) => [d.dimKey, pctWeights[i]]));
        void runAction(() => ctx.actions.updateK4Weights(next, reason), "权重变更已写入后端");
      },
    });
  };

  const resetWeights = () => {
    setWeights(dimensions.map((d) => d.weightPct / 100));
    setTouched(false);
    ctx.toast("已还原为当前生效权重");
  };

  const toggleSource = () => {
    const cur = config?.inputSource ?? "全部启用";
    ctx.openActionConfirm({
      action: "评分维度开关切换",
      detail: "临时停用 / 启用某个输入维度。停用后该维度不参与合成,下游分数随之变化。",
      edit: { kind: "select", current: cur, options: ["全部启用", "停用 C4 实名维度", "停用 K2 套利维度", "停用异常行为维度"] },
      run: (reason, newVal) => {
        if (!newVal) return;
        void runAction(() => ctx.actions.updateK4Source(newVal, reason), "维度开关变更已写入后端");
      },
    });
  };

  const adjBand = () => {
    const cur = `${config?.bandLowMax ?? 40} / ${config?.bandHighMin ?? 70}`;
    ctx.openActionConfirm({
      action: "风险分档线调整",
      detail: "输入低风险上限 / 高风险下限,例如 40 / 70。必须满足低 < 高。",
      edit: { kind: "text", current: cur },
      run: (reason, newVal) => {
        const nums = (newVal ?? "").match(/\d+/g)?.map(Number) ?? [];
        if (nums.length < 2 || nums[0] >= nums[1]) {
          ctx.toast("请输入有效分档线,例如 40 / 70");
          return;
        }
        void runAction(() => ctx.actions.updateK4Band(nums[0], nums[1], reason), "分档线已写入后端");
      },
    });
  };

  const adjEscalate = () => {
    const cur = String(config?.autoEscalateScore ?? 85);
    ctx.openActionConfirm({
      action: "自动升级线调整",
      detail: "范围 70-100。超过该分数自动建议提现转人工并点亮雷达。",
      edit: { kind: "number", current: cur, unit: "分" },
      run: (reason, newVal) => {
        const score = Number(newVal);
        if (!Number.isFinite(score) || score < 70 || score > 100) {
          ctx.toast("自动升级线须为 70-100 的数字");
          return;
        }
        void runAction(() => ctx.actions.updateK4Escalate(Math.round(score), reason), "自动升级线已写入后端");
      },
    });
  };

  const overrideScore = (user: K4User) =>
    ctx.openConfirm({
      action: `人工覆盖评分 · ${user.userNo}`,
      detail: `把这个用户的分数改成指定值(覆盖模型分 ${user.modelScore})。必须写清原因,全程留痕。`,
      chips: [["单人 · 强制原因", "ready"], ["可随时回模型分", "done"]],
      reason: true,
      input: { label: "覆盖分(0-100)", placeholder: "如 35" },
      okLabel: "确认覆盖",
      run: (reason, value) => {
        const score = Math.round(Number(value));
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          ctx.toast("覆盖分需在 0-100 之间");
          return;
        }
        const def = findHighOp("k4_user_override")!;
        void propose(ctx.toast, {
          action: `人工覆盖评分 · ${user.userNo}`,
          obj: user.userNo,
          before: String(user.effectiveScore),
          after: String(score),
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K4",
          command: def.buildCommand({ userNo: user.userNo, score }),
          target: def.buildTarget({ userNo: user.userNo }),
        });
      },
    });

  const recompute = (target: { userNo: string; before: number; after: number }) =>
    ctx.openConfirm({
      action: `重算回模型分 · ${target.userNo}`,
      detail: "丢弃人工覆盖值,按当前模型权重重新算一遍。",
      chips: [["回归模型计算", "done"], ["前后分留痕", "ready"]],
      reason: true,
      okLabel: "确认重算",
      run: (reason) => {
        const def = findHighOp("k4_user_recompute")!;
        void propose(ctx.toast, {
          action: `重算回模型分 · ${target.userNo}`,
          obj: target.userNo,
          before: String(target.before),
          after: String(target.after),
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K4",
          command: def.buildCommand({ userNo: target.userNo }),
          target: def.buildTarget({ userNo: target.userNo }),
        });
      },
    });

  const selectLookupUser = (option: K4UserOption) => {
    setUserSearch(option.userNo);
    setUserSearchOpen(false);
    void loadUser(option.userNo);
  };

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K4 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }

  const shown = lookupUser?.effectiveScore ?? 0;
  const col = scoreColor(shown);
  const maxPt = Math.max(...(lookupUser?.contributions ?? []).map((d) => d.points), 1);
  const sumLabel = sumOk ? `权重合计 = ${sum.toFixed(2)} · 可以提交` : `权重合计 = ${sum.toFixed(2)},必须等于 1.00`;

  return (
    <div>
      <div className="f-stats">
        {dist.map((row) => (
          <div className={`f-stat ${row.tone}`} key={row.band}>
            <div className="k">{row.band}</div>
            <div className="v">{row.percentage}%</div>
            <div className="sub">{fmt(row.count)} 人 · {row.rangeText}</div>
          </div>
        ))}
        <div className="f-stat cyan"><div className="k">人工覆盖中</div><div className="v">{overview?.overrideActive ?? 0}</div><div className="sub">全部带原因留痕 · 可一键回模型分</div></div>
      </div>

      <div className="two-col r12">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">评分权重</span>
            <span className="sub">· 六个维度的权重加起来必须等于 100%</span>
            <div className="r"><span className="kcode" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>平台管理员</span></div>
          </div>
          <div className="l-b">
            {dimensions.map((d, i) => (
              <div className="w-row" key={d.dimKey}>
                <span className="nm">{d.name}<span className="src">{d.source}</span></span>
                <input
                  type="range" min={0} max={100} value={pctWeights[i] ?? 0}
                  onChange={(e) => {
                    const next = [...liveWeights];
                    next[i] = Number(e.target.value) / 100;
                    setWeights(next);
                    setTouched(true);
                  }}
                  aria-label={`${d.name} 权重`}
                />
                <span className="val">{(liveWeights[i] ?? 0).toFixed(2)}</span>
              </div>
            ))}
            <div className={`w-sum ${sumOk ? "ok" : "bad"}`}>{sumLabel}</div>
            <div className="w-foot">
              <button className="l-btn mc" onClick={submitWeights}>提交权重变更</button>
              <button className="l-btn" onClick={resetWeights}>还原当前生效值</button>
              <span className="note">改后只对新评分生效</span>
            </div>
            <div className="ktint" style={{ marginTop: 14, fontSize: 12 }}>
              <div><b>维度开关</b> · 当前:{config?.inputSource ?? "全部启用"}</div>
              <button className="l-btn sm mc" style={{ marginTop: 10 }} onClick={toggleSource}>切换维度开关</button>
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">分档与全平台分布</span>
            <span className="sub">· 风险雷达的告警线直接引用这套分档</span>
          </div>
          <div className="l-b">
            <div className="dist-wrap">
              <BandDonut dist={dist} totalUsers={overview?.totalUsers ?? 0} />
              <div className="dist-rows">
                {dist.map((s) => (
                  <div className="r" key={s.band}>
                    <span className="dot2" style={{ background: s.color }} />
                    <span className="nm">{s.band} <small>{s.rangeText}</small></span>
                    <span className="ct">{fmt(s.count)}</span>
                    <span className="pc">{s.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="band-tints">
              <div className="ktint" style={{ fontSize: 12 }}>
                <span className="tx"><b>分档线</b> · 低 &lt; {config?.bandLowMax ?? 40} / 高 ≥ {config?.bandHighMin ?? 70}</span>
                <button className="l-btn sm mc" onClick={adjBand}>调整</button>
              </div>
              <div className="ktint warn" style={{ fontSize: 12 }}>
                <span className="tx"><b>自动升级线</b> · ≥ {config?.autoEscalateScore ?? 85} 分自动建议提现转人工</span>
                <button className="l-btn sm mc" onClick={adjEscalate}>调整</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">单用户风险分查询</span>
          <span className="sub">· 每一分都能说清来源</span>
          <div className="r">
            <div className="lookup" style={{ width: 360, position: "relative" }}>
              <input
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setUserSearchOpen(true);
                }}
                onFocus={() => setUserSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setUserSearchOpen(false), 140)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (userOptions[0]) {
                      selectLookupUser(userOptions[0]);
                    } else {
                      ctx.toast("没有可选择的用户候选");
                    }
                  }
                  if (e.key === "Escape") setUserSearchOpen(false);
                }}
                placeholder="搜索用户编号 / 用户名 / 手机号"
                aria-label="搜索用户编号或用户名"
                aria-autocomplete="list"
                aria-controls={userOptionsId}
                aria-expanded={userSearchOpen}
                role="combobox"
              />
              {userSearchOpen && (
                <div
                  id={userOptionsId}
                  role="listbox"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "calc(100% + 6px)",
                    zIndex: 20,
                    display: "grid",
                    gap: 6,
                    padding: 8,
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--surface)",
                    boxShadow: "var(--shadow-lg)",
                  }}
                >
                  {userSearchLoading && <div className="note" style={{ padding: "8px 10px" }}>搜索中...</div>}
                  {!userSearchLoading && userSearchError && <div className="note" style={{ padding: "8px 10px", color: "var(--danger)" }}>候选加载失败 · {userSearchError}</div>}
                  {!userSearchLoading && !userSearchError && userOptions.length === 0 && <div className="note" style={{ padding: "8px 10px" }}>暂无匹配用户</div>}
                  {!userSearchLoading && !userSearchError && userOptions.map((option) => (
                    <button
                      type="button"
                      role="option"
                      key={option.userNo}
                      aria-selected={lookupUser?.userNo === option.userNo}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectLookupUser(option)}
                      className="l-btn"
                      style={{
                        width: "100%",
                        height: "auto",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "9px 10px",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                        <span className="note" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.sub}</span>
                      </span>
                      <span className={`bdg ${option.bandTone}`}>{option.bandLabel || option.effectiveScore}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="l-b">
          {lookupLoading && <div className="ktint" style={{ marginBottom: 12 }}>正在读取用户风险分...</div>}
          {lookupError && <div className="ktint bad" style={{ marginBottom: 12 }}>查询失败 · {lookupError}</div>}
          {lookupUser && (
            <>
              <div className="score-hero">
                <div className="score-ring" style={{ background: `conic-gradient(${col} ${shown}%, var(--surface-3) 0)` }}>
                  <div className="in" style={{ color: col }}>{shown}</div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {lookupUser.userNo} <span className={`bdg ${lookupUser.bandTone}`}>{lookupUser.bandLabel}</span>
                    {shown >= (config?.autoEscalateScore ?? 85) && <span className="bdg warn">超过自动升级线 {config?.autoEscalateScore ?? 85}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 5 }}>
                    模型分 {lookupUser.modelScore} · {lookupUser.overridden ? `已被人工覆盖 → ${lookupUser.effectiveScore}` : "未被人工覆盖"} · 模型版本 {lookupUser.modelVersion} · {lookupUser.updatedText}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="l-btn" onClick={() => overrideScore(lookupUser)}>人工覆盖评分</button>
                    <button className="l-btn" onClick={() => recompute({ userNo: lookupUser.userNo, before: lookupUser.effectiveScore, after: lookupUser.modelScore })}>重算回模型分</button>
                  </div>
                </div>
              </div>
              <div>
                {lookupUser.contributions.map((d) => (
                  <div key={`${d.name}-${d.evidence}`}>
                    <div className="dim-row">
                      <span className="nm">{d.name}</span>
                      <span>{d.points > 0 ? <span className="bdg warn">命中</span> : <span className="bdg dim">未中</span>}</span>
                      <span className="track"><i style={{ width: `${(d.points / maxPt) * 100}%` }} /></span>
                      <span className="pt">{d.points > 0 ? `+${d.points}` : "0"}</span>
                    </div>
                    {d.points > 0 && <div className="dim-note">{d.evidence}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">人工覆盖记录</span>
          <span className="sub">· 谁、把谁的分、从多少改到多少、为什么</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 780 }}>
            <thead><tr><th>账户</th><th className="num">模型分</th><th className="num">覆盖分</th><th>原因</th><th>操作人</th><th>时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={`${o.userNo}-${o.timeText}`} style={!o.active ? { opacity: 0.62 } : undefined}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{o.userNo}</td>
                  <td className="num mono">{o.modelScore}</td>
                  <td className="num mono" style={{ fontWeight: 700, color: o.overrideScore > o.modelScore ? "var(--danger)" : "var(--success)" }}>{o.overrideScore}</td>
                  <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{o.reason}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{o.operator}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{o.timeText}</td>
                  <td style={{ textAlign: "right" }}>{o.active ? <button className="l-btn sm" onClick={() => recompute({ userNo: o.userNo, before: o.overrideScore, after: o.modelScore })}>回模型分</button> : <span className="bdg dim">已回模型分</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="人工覆盖记录"
          page={overridesPage?.pageNum ?? overridePage}
          pageSize={overridesPage?.pageSize ?? overridePageSize}
          total={overridesPage?.total ?? overrides.length}
          onPageChange={setOverridePage}
          onPageSizeChange={(next) => {
            setOverridePageSize(next);
            setOverridePage(1);
          }}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>
    </div>
  );
}
