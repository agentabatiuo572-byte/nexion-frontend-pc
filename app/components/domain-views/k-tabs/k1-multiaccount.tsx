"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { DataListPager, Modal } from "../design-kit";
import type { AdminPage, ClusterStatus, K1Cluster, K1ClusterLayer, K1WhitelistRow, KRiskParam } from "@/lib/admin/k-client";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
const CLUSTER_PAGE_SIZE_OPTIONS = [5, 10, 20];
const WHITELIST_PAGE_SIZE_OPTIONS = [5, 10, 20];
const EMPTY_CLUSTER_PAGE: AdminPage<K1Cluster> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
const EMPTY_WHITELIST_PAGE: AdminPage<K1WhitelistRow> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
type WeightDraft = { param: KRiskParam; device: string; payment: string; ip: string; reason: string };

const CLUSTER_ST: Record<ClusterStatus, [string, string]> = {
  detected: ["待判定", "dim"],
  flagged: ["可疑", "warn"],
  frozen: ["已冻结", "bad"],
  released: ["解除误判", "ok"],
  cleared: ["正常", "ok"],
};

function strengthColor(v: number) {
  return v >= 0.75 ? "var(--danger)" : v >= 0.55 ? "var(--warning)" : "var(--success)";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

function parseNamedWeight(value: string, label: string, fallback: string) {
  const idx = value.indexOf(label);
  if (idx < 0) return fallback;
  const suffix = value.slice(idx + label.length);
  const match = suffix.match(/[0-9]+(?:\.[0-9]+)?/);
  return match?.[0] ?? fallback;
}

function parseLinkWeight(value: string): Pick<WeightDraft, "device" | "payment" | "ip"> {
  return {
    device: parseNamedWeight(value, "设备", "0.50"),
    payment: parseNamedWeight(value, "支付", "0.40"),
    ip: parseNamedWeight(value, "IP", "0.10"),
  };
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function linkWeightValue(draft: WeightDraft) {
  const device = numberValue(draft.device);
  const payment = numberValue(draft.payment);
  const ip = numberValue(draft.ip);
  return `设备 ${device.toFixed(2)} · 支付 ${payment.toFixed(2)} · IP ${ip.toFixed(2)}`;
}

export function K1HeaderActions() {
  return <span className="f-ro"><span className="d" />服务端分页 · 判定全部后端落库</span>;
}

function ClusterGraph({ c }: { c: K1Cluster }) {
  const gid = useId();
  const W = 320, H = 272, cx = W / 2, cy = H / 2, R = 94;
  const edgeColor = c.layer === "device" ? "var(--warning)" : c.layer === "payment" ? "var(--cyan)" : "var(--ink-4)";
  const stColor: Record<ClusterStatus, string> = {
    frozen: "var(--danger)", flagged: "var(--warning)", detected: "var(--ink-4)", released: "var(--success)", cleared: "var(--success)",
  };
  const k = Math.min(c.nodes.length, 8);
  const over = Math.max(c.n - k, 0);
  const total = Math.max(k + (over > 0 ? 1 : 0), 1);
  const ew = 1.2 + c.strength * 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 272, display: "block" }} aria-label={`簇 ${c.id} 关联图谱`}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--border)" strokeDasharray="3 6" />
      {Array.from({ length: total }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
        const ux = Math.cos(a), uy = Math.sin(a);
        const x = cx + R * ux, y = cy + R * uy;
        const isOver = i >= k;
        const line = (
          <line
            x1={(cx + ux * 28).toFixed(1)} y1={(cy + uy * 28).toFixed(1)}
            x2={(x - ux * 16).toFixed(1)} y2={(y - uy * 16).toFixed(1)}
            stroke={edgeColor} strokeWidth={isOver ? 1 : ew} opacity={isOver ? 0.3 : 0.55}
            strokeDasharray={isOver ? "3 4" : undefined}
          />
        );
        if (isOver) {
          return (
            <g key={`${gid}-o`}>
              {line}
              <circle cx={x} cy={y} r={13} fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth={1.3} strokeDasharray="3 3" />
              <text x={x} y={y + 4} fontSize={11} fontWeight={700} fill="var(--ink-4)" textAnchor="middle">{`+${over}`}</text>
              <text x={x} y={uy >= 0 ? y + 30 : y - 22} fontSize={10.5} fill="var(--ink-4)" textAnchor="middle">未列出</text>
            </g>
          );
        }
        const nd = c.nodes[i];
        const col = stColor[nd?.[5] ?? "detected"] ?? "var(--ink-4)";
        return (
          <g key={`${gid}-${nd?.[0] ?? i}`}>
            {line}
            <circle cx={x} cy={y} r={18} fill={col} opacity={0.1} />
            <circle cx={x} cy={y} r={13} fill="var(--surface-2)" stroke={col} strokeWidth={1.6} />
            <circle cx={x} cy={y} r={3} fill={col} />
            {nd?.[3] === "是" && <circle cx={x + 10} cy={y - 10} r={3.6} fill="var(--warning)" stroke="var(--surface)" strokeWidth={1.5} />}
            <text x={x} y={uy >= 0 ? y + 31 : y - 23} fontSize={11} fill="var(--ink-2)" textAnchor="middle">{(nd?.[0] ?? "").slice(4)}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={34} fill="var(--warning)" opacity={0.07} />
      <circle cx={cx} cy={cy} r={24} fill="var(--surface-2)" stroke="var(--warning)" strokeWidth={1.6} />
      <text x={cx} y={cy - 1} fontSize={11.5} fontWeight={700} fill="var(--warning)" textAnchor="middle">同一</text>
      <text x={cx} y={cy + 12} fontSize={11.5} fontWeight={700} fill="var(--warning)" textAnchor="middle">实体</text>
    </svg>
  );
}

export function K1MultiAccount({ ctx }: { ctx: KCtx }) {
  const [layer, setLayer] = useState<K1ClusterLayer>("all");
  const [clusterPage, setClusterPage] = useState(1);
  const [clusterPageSize, setClusterPageSize] = useState(5);
  const [whitelistPage, setWhitelistPage] = useState(1);
  const [whitelistPageSize, setWhitelistPageSize] = useState(5);
  const [sel, setSel] = useState(0);
  const [weightDraft, setWeightDraft] = useState<WeightDraft | null>(null);
  const overview = ctx.risk.multiAccount;
  const stats = overview?.stats ?? {};
  const params = overview?.params ?? [];
  const clusterPageData = overview?.clusters ?? EMPTY_CLUSTER_PAGE;
  const whitelistPageData = overview?.whitelist ?? EMPTY_WHITELIST_PAGE;
  const clusters = clusterPageData.records;
  const whitelist = whitelistPageData.records;
  const pageQuery = useMemo(() => ({
    clusterPageNum: clusterPage,
    clusterPageSize,
    clusterLayer: layer,
    whitelistPageNum: whitelistPage,
    whitelistPageSize,
  }), [clusterPage, clusterPageSize, layer, whitelistPage, whitelistPageSize]);
  const cur = clusters[sel] ?? clusters[0];

  useEffect(() => {
    void ctx.reloadKRisk({ multiAccount: pageQuery });
  }, [ctx.reloadKRisk, pageQuery]);

  useEffect(() => {
    setSel(0);
  }, [clusterPage, clusterPageSize, layer]);

  const stat = (key: string) => Number(stats[key] ?? 0);
  const runAction = async (work: () => Promise<void>, ok: string) => {
    try {
      await work();
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(ok);
    } catch (error) {
      ctx.toast(`K1 操作失败 · ${errorText(error)}`);
    }
  };

  const setClusterStatus = (c: K1Cluster, status: ClusterStatus, reason: string, ok: string) =>
    runAction(() => ctx.actions.updateK1ClusterStatus(c.id, status, reason), ok);

  const flagCluster = (c: K1Cluster) =>
    ctx.openConfirm({
      action: `标记可疑账户簇 · ${c.id}`,
      detail: "只打可疑标签,不冻结资产。标记会同步给风险评分和风险雷达,操作写入后端审计。",
      chips: [["仅标记 · 不动资产", "done"], ["后端落库 + 审计", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => void setClusterStatus(c, "flagged", reason, `${c.id} 已标可疑 · 已同步后端`),
    });

  const freezeCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `批量冻结关联账户 · ${c.id}`,
      detail: `把簇内 ${c.n} 个账户置为冻结簇状态。冻结台账和账户执行仍由后端链路处理,本页只提交处置命令和原因。`,
      run: (reason) => void setClusterStatus(c, "frozen", reason, `${c.id} 已批量冻结 · 后端已记录`),
    });

  const releaseCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `解除误判 · ${c.id}`,
      detail: "解冻/放行方向会放大资金流出,需要操作确认并写清原因。后端会保留审计记录。",
      amplifies: true,
      run: (reason) => void setClusterStatus(c, "released", reason, `${c.id} 已解除误判 · 理由留痕`),
    });

  const clearCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `判定为正常 · ${c.id}`,
      detail: "该动作会把账户簇移出监控队列,会减少后续风险评分输入,必须填写原因。",
      amplifies: true,
      run: (reason) => void setClusterStatus(c, "cleared", reason, `${c.id} 已判定正常 · 后端已记录`),
    });

  const reviewNote = (c: K1Cluster) =>
    ctx.openConfirm({
      action: `人工复审备注 · ${c.id}`,
      detail: "记录复审备注并保持当前状态不变。",
      chips: [["仅备注 · 不改状态", "done"], ["后端审计", "ready"]],
      reason: true,
      okLabel: "保存备注",
      run: (reason) => void setClusterStatus(c, c.status, reason, `${c.id} 复审备注已留痕`),
    });

  const adjParam = (p: KRiskParam) => {
    if (p.key === "linkWeight") {
      setWeightDraft({ param: p, ...parseLinkWeight(p.value), reason: "" });
      return;
    }
    ctx.openActionConfirm({
      action: `拦截阈值调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${p.value}。${p.note}。改后下一次服务端校验生效。`,
      amplifies: true,
      edit: { kind: "text", current: p.value },
      run: (reason, newVal) => {
        if (!newVal) return;
        void runAction(() => ctx.actions.updateK1Param(p.key, newVal, reason), `${p.name} 已更新为 ${newVal}`);
      },
    });
  };

  const saveWeightDraft = async () => {
    if (!weightDraft) return;
    const value = linkWeightValue(weightDraft);
    try {
      await ctx.actions.updateK1Param(weightDraft.param.key, value, weightDraft.reason.trim());
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(`${weightDraft.param.name} 已更新为 ${value}`);
      setWeightDraft(null);
    } catch (error) {
      ctx.toast(`K1 操作失败 · ${errorText(error)}`);
    }
  };

  const addWl = () =>
    ctx.openConfirm({
      action: "添加 IP 白名单",
      detail: "加白后该 IP / 网段不再触发同 IP 多账户报警,设备和支付维度照常检测。",
      chips: [["只影响 IP 维度", "ready"], ["不解冻已冻结账户", "done"]],
      reason: true,
      input: { label: "IP / 网段", placeholder: "如 198.51.100.0/24" },
      okLabel: "确认加白",
      run: (reason, cidr) => {
        if (!cidr) return;
        void runAction(() => ctx.actions.upsertK1Whitelist(cidr, reason, reason), "白名单已写入后端");
      },
    });

  const rmWl = (cidr: string) =>
    ctx.openConfirm({
      action: `移除白名单 · ${cidr}`,
      detail: "移除后该网段恢复同 IP 多账户检测。",
      chips: [["恢复 IP 维度检测", "ready"]],
      reason: true,
      okLabel: "确认移除",
      run: (reason) => void runAction(() => ctx.actions.disableK1Whitelist(cidr, reason), "白名单已移除"),
    });

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K1 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat"><div className="k">监控中账户簇</div><div className="v">{stat("activeClusters")}</div><div className="sub">三个维度去重合成 · 覆盖 {fmt(stat("flaggedAccounts"))} 个账户</div></div>
        <div className="f-stat warn"><div className="k">高风险簇</div><div className="v">{stat("highClusters")}</div><div className="sub">强度达到建议冻结线</div></div>
        <div className="f-stat danger"><div className="k">已冻结簇</div><div className="v">{stat("frozenClusters")}</div><div className="sub">共 {stat("frozenAccounts")} 个账户</div></div>
        <div className="f-stat ok"><div className="k">新人礼拦截</div><div className="v">${fmt(stat("giftBlockedUsd"))}</div><div className="sub">{stat("giftBlockedCnt")} 笔重复领取被拦下</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">拦截阈值</span>
          <span className="sub">· 注册 / 绑上级 / 绑卡入口由服务器执行</span>
          <div className="r"><span className="kcode electric">改后下一次校验生效</span></div>
        </div>
        <div className="l-b">
          <div className="param-list">
            {params.map((p) => (
              <div className="p" key={p.key}>
                <div className="txt"><div className="k">{p.name}</div><div className="s">{p.sub}</div></div>
                <span className="v" style={p.key === "linkWeight" ? { fontSize: 13 } : undefined}>{p.value}{p.unit ? ` ${p.unit}` : ""}</span>
                <button className="l-btn sm mc" onClick={() => adjParam(p)}>调整</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">三层去重命中列表</span>
          <span className="sub">· 点任意一行看簇详情</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["ip", "IP"], ["device", "设备指纹"], ["payment", "支付工具"]] as const).map(([v, lb]) => (
                <button key={v} className={`chip${layer === v ? " sel" : ""}`} onClick={() => { setLayer(v); setClusterPage(1); }}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>去重键</th><th>维度</th><th className="num">关联账户</th><th>关联强度</th><th>注册时间跨度</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {clusters.map((c, index) => {
                const [stLb, stTone] = CLUSTER_ST[c.status];
                const hot = c.strength >= 0.7 && c.status !== "frozen" && c.status !== "cleared" && c.status !== "released";
                return (
                  <tr key={c.id} className="click" onClick={() => setSel(index)} style={hot ? { background: "var(--danger-soft)" } : undefined}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{c.key}</td>
                    <td><span className="bdg dim">{c.layerLabel}</span></td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{c.n}</td>
                    <td>
                      <span className="meter">
                        <span className="track"><i style={{ width: `${c.strength * 100}%`, background: strengthColor(c.strength) }} /></span>
                        <span className="n" style={{ color: strengthColor(c.strength) }}>{c.strength.toFixed(2)}</span>
                      </span>
                      {hot && <span className="bdg bad" style={{ marginLeft: 9, verticalAlign: "middle" }}>建议冻结</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{c.span}</td>
                    <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        {c.status === "detected" && <><button className="l-btn sm" onClick={() => flagCluster(c)}>标可疑</button><button className="l-btn sm mc" onClick={() => clearCluster(c)}>判正常</button></>}
                        {c.status === "flagged" && <button className="l-btn sm mc" onClick={() => freezeCluster(c)}>批量冻结</button>}
                        {(c.status === "frozen" || c.status === "flagged") && <button className="l-btn sm mc" onClick={() => releaseCluster(c)}>解除误判</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!clusters.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>暂无命中簇</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="K1 去重命中列表"
          page={clusterPage}
          pageSize={clusterPageSize}
          total={clusterPageData.total}
          onPageChange={setClusterPage}
          onPageSizeChange={(next) => {
            setClusterPageSize(next);
            setClusterPage(1);
          }}
          pageSizeOptions={CLUSTER_PAGE_SIZE_OPTIONS}
        />
      </section>

      {cur && (
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">簇详情 · {cur.id}</span>
            <span className="sub">· 同一实体的账户群 · 连线标注共享维度</span>
            <div className="r">
              <button className="l-btn" onClick={() => reviewNote(cur)}>人工复审备注</button>
              {cur.status === "detected" && <button className="l-btn" onClick={() => flagCluster(cur)}>标可疑</button>}
              {cur.status === "flagged" && <button className="l-btn mc" onClick={() => freezeCluster(cur)}>批量冻结</button>}
              {cur.status === "frozen" && <button className="l-btn mc" onClick={() => releaseCluster(cur)}>解除误判</button>}
            </div>
          </div>
          <div className="cl-split">
            <div className="graph">
              <ClusterGraph c={cur} />
              <div className="ktint" style={{ fontSize: 12 }}><b>判读</b> · {cur.note}</div>
            </div>
            <div className="tbl-pane">
              <table className="l-tbl">
                <thead><tr><th>账户</th><th>注册时间</th><th>上级</th><th>领过新人礼</th><th className="num">累计入金</th><th>状态</th></tr></thead>
                <tbody>
                  {cur.nodes.map((n) => {
                    const [lb, tone] = CLUSTER_ST[n[5]];
                    return (
                      <tr key={n[0]}>
                        <td className="mono" style={{ color: "var(--ink)" }}>{n[0]}</td>
                        <td className="mono" style={{ fontSize: 11.5 }}>{n[1]}</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{n[2]}</td>
                        <td>{n[3] === "是" ? <span className="bdg warn">已领</span> : <span className="bdg dim">未领</span>}</td>
                        <td className="num mono">{n[4]}</td>
                        <td><span className={`bdg ${tone}`}>{lb}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "var(--ink)" }}>新人礼重复发放记录</div>
              {cur.gifts.length ? cur.gifts.map((g) => (
                <div className="gift-row" key={g[0]}>
                  <span className="gid">{g[0]}</span>
                  <span className="gtx">{g[1]}</span>
                  <span className={`bdg ${g[2].includes("拦截") || g[2].includes("处置") ? "ok" : "warn"}`}>{g[2]}</span>
                </div>
              )) : <div className="ktint" style={{ fontSize: 12 }}>本簇没有新人礼重复发放记录。</div>}
            </div>
          </div>
        </section>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">IP 白名单</span>
          <span className="sub">· 只影响 IP 维度,不影响设备和支付维度</span>
          <div className="r"><button className="l-btn" onClick={addWl}>+ 添加白名单</button></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 680 }}>
            <thead><tr><th>IP / 网段</th><th>备注</th><th>添加人</th><th>失效时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {whitelist.map((w) => (
                <tr key={w.cidr}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{w.cidr}</td>
                  <td style={{ fontSize: 12.5 }}>{w.note}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{w.operator}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{w.expireText}</td>
                  <td style={{ textAlign: "right" }}><button className="l-btn sm" onClick={() => rmWl(w.cidr)}>移除</button></td>
                </tr>
              ))}
              {!whitelist.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-4)", padding: 20 }}>暂无白名单</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="K1 IP 白名单"
          page={whitelistPage}
          pageSize={whitelistPageSize}
          total={whitelistPageData.total}
          onPageChange={setWhitelistPage}
          onPageSizeChange={(next) => {
            setWhitelistPageSize(next);
            setWhitelistPage(1);
          }}
          pageSizeOptions={WHITELIST_PAGE_SIZE_OPTIONS}
        />
      </section>

      {weightDraft && (() => {
        const device = numberValue(weightDraft.device);
        const payment = numberValue(weightDraft.payment);
        const ip = numberValue(weightDraft.ip);
        const weights = [device, payment, ip];
        const validNumbers = weights.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
        const total = weights.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
        const totalOk = Math.abs(total - 1) <= 0.001;
        const reasonOk = weightDraft.reason.trim().length >= 8;
        const canSave = validNumbers && totalOk && reasonOk;
        const updateDraft = (patch: Partial<WeightDraft>) => setWeightDraft((current) => current ? { ...current, ...patch } : current);
        return (
          <Modal
            title={`拦截阈值调整 · ${weightDraft.param.name}`}
            icon="shield"
            onClose={() => setWeightDraft(null)}
            footer={
              <>
                <button className="l-btn" onClick={() => setWeightDraft(null)}>取消</button>
                <button className="l-btn mc" disabled={!canSave} onClick={() => void saveWeightDraft()}>确认保存</button>
              </>
            }
          >
            <div className="ctint" style={{ marginBottom: 12 }}>
              关联强度 = 设备指纹命中 × 设备权重 + 支付工具命中 × 支付权重 + IP 命中 × IP 权重。每项单独填写,合计必须等于 1.00。
            </div>
            <div className="grid g-3" style={{ gap: 10 }}>
              {[
                ["device", "设备指纹权重", "设备指纹 / 浏览器指纹 / App 实例"] as const,
                ["payment", "支付工具权重", "银行卡 / 钱包 / 收款工具"] as const,
                ["ip", "IP 权重", "同出口 IP / 网段"] as const,
              ].map(([key, label, help]) => (
                <div className="field" key={key} style={{ marginBottom: 0 }}>
                  <label>{label}</label>
                  <input
                    className="fld"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={weightDraft[key]}
                    onChange={(e) => updateDraft({ [key]: e.target.value } as Partial<WeightDraft>)}
                    placeholder="0.00 - 1.00"
                  />
                  <div className="tiny" style={{ marginTop: 6, color: "var(--ink-3)" }}>{help}</div>
                </div>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>操作理由(必填 · 8 字以上)</label>
              <textarea
                rows={3}
                value={weightDraft.reason}
                onChange={(e) => updateDraft({ reason: e.target.value })}
                placeholder="例: 根据误判样本回归,降低 IP 权重并提高设备指纹权重"
              />
            </div>
            <div className={`ctint${validNumbers && totalOk ? "" : " danger"}`} style={{ marginTop: 10 }}>
              当前合计 <span className="mono">{total.toFixed(2)}</span>
              {!validNumbers ? " · 每项必须在 0 到 1 之间" : !totalOk ? " · 三项合计必须等于 1.00" : ` · 保存值 ${linkWeightValue(weightDraft)}`}
              {!reasonOk && <span> · 理由还需 {Math.max(0, 8 - weightDraft.reason.trim().length)} 字</span>}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
