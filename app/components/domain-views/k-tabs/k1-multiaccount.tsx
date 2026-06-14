"use client";

/**
 * K1 反多账户引擎 — 拦截阈值(5 参数 操作确认)+ 三层去重命中列表 + 簇详情(hub-spoke 图谱)+
 * 新人礼重复发放 + 簇状态机 + IP 白名单。
 * 状态机:detected → flagged(仍需操作确认 标记) → frozen(操作确认) → released(操作确认);detected → cleared(白名单自动 / 人工 操作确认)。
 * 冻结台账权威落 C2;命中喂 K4 多账户维度 + B5 雷达。簇实时态 = K.cluster.<id>.st(与 K2 联动冻结共用同一键)。
 */
import { useMemo, useState } from "react";
import { useId } from "react";
import { PaginationExemptionList } from "../design-kit";
import { K_RISK, RISK } from "@/lib/mock/admin/design-data";
import { K1_PARAMS, K1_CLUSTERS, K1_WHITELIST, CLUSTER_ST, strengthColor, type ClusterStatus, type K1Cluster } from "./data";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function K1HeaderActions() {
  return <span className="f-ro"><span className="d" />判定全部在服务端 · 客户端改不动</span>;
}

function ClusterGraph({ c }: { c: K1Cluster }) {
  const gid = useId();
  const W = 320, H = 272, cx = W / 2, cy = H / 2, R = 94;
  const edgeColor = c.layer === "device" ? "var(--warning)" : c.layer === "payment" ? "var(--cyan)" : "var(--ink-4)";
  const stColor: Record<ClusterStatus, string> = {
    frozen: "var(--danger)", flagged: "var(--warning)", detected: "var(--ink-4)", released: "var(--success)", cleared: "var(--success)",
  };
  const k = Math.min(c.nodes.length, 8);
  const over = c.n - k;
  const total = k + (over > 0 ? 1 : 0);
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
        const col = stColor[nd[5]] ?? "var(--ink-4)";
        return (
          <g key={`${gid}-${nd[0]}`}>
            {line}
            <circle cx={x} cy={y} r={18} fill={col} opacity={0.1} />
            <circle cx={x} cy={y} r={13} fill="var(--surface-2)" stroke={col} strokeWidth={1.6} />
            <circle cx={x} cy={y} r={3} fill={col} />
            {nd[3] === "是" && <circle cx={x + 10} cy={y - 10} r={3.6} fill="var(--warning)" stroke="var(--surface)" strokeWidth={1.5} />}
            <text x={x} y={uy >= 0 ? y + 31 : y - 23} fontSize={11} fill="var(--ink-2)" textAnchor="middle">{nd[0].slice(4)}</text>
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
  const [layer, setLayer] = useState<"all" | "ip" | "device" | "payment">("all");
  const [sel, setSel] = useState(0);

  const liveSt = (c: K1Cluster): ClusterStatus => {
    const v = ctx.pget(`K.cluster.${c.id}.st`);
    return (v as ClusterStatus | undefined) ?? c.status;
  };

  // 簇处置动作 —— 解除误判/判正常 = 放行方向挂 B1;冻结 = 收紧不挂。
  const flagCluster = (c: K1Cluster) =>
    ctx.openConfirm({
      action: `标记可疑账户簇 · ${c.id}`,
      detail: "只是打上「可疑」标签,不冻结任何资产或余额 —— 后续批量冻结才需要操作确认。标记会同步给风险评分(K4)和风险雷达(B5)。",
      chips: [["仅标记 · 不动资产", "done"], ["落 admin.cluster_flagged 审计", "ready"]],
      okLabel: "确认标记",
      run: (reason) => {
        ctx.setParam(`K.cluster.${c.id}.st`, "flagged", { action: `标记可疑账户簇 ${c.id}`, reason: reason || "人工标记可疑" });
        ctx.toast(`${c.id} 已标可疑 · 喂 K4 / B5`);
      },
    });

  const freezeCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `批量冻结关联账户 · ${c.id}`,
      detail: `把簇内 ${c.n} 个账户全部冻结(冻结台账落用户域 C2)。关联强度 ${c.strength.toFixed(2)} · 维度:${c.layerLabel} · 涉及新人礼 ${c.gifts.length ? c.gifts[0][1] : "无"}。请求自带防重号(Idempotency-Key),网络抖动不会重复冻结同一批;确认通过后由服务器一次性原子冻结并产事件,页面不做本地冻结 · 写入 admin.cluster_frozen`,
      run: (reason) => {
        ctx.setParam(`K.cluster.${c.id}.st`, "frozen", { action: `批量冻结关联账户簇 ${c.id}(${c.n} 账户)`, reason });
        ctx.toast(`${c.id} 已批量冻结 ${c.n} 个账户 · 台账落 C2`);
      },
    });

  const releaseCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `解除误判 · ${c.id}`,
      detail: "解冻 = 放行,必须第二个人确认不是被滥用。解除后账户恢复正常,本簇移入「已解除误判」。常见正当理由:家庭共用卡、合租网络、已知合作账户 · 写入 admin.cluster_released",
      amplifies: true,
      run: (reason) => {
        ctx.setParam(`K.cluster.${c.id}.st`, "released", { action: `解除误判关联簇 ${c.id}`, reason });
        ctx.toast(`${c.id} 已解除误判 · 理由留痕`);
      },
    });

  const clearCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `判定为正常 · ${c.id}`,
      detail: "这个动作会把账户簇永久移出监控队列,以后这批账户不再参与多账户检测,也会减少风险评分和刷量检测的输入 —— 影响不可逆,风险与「解除误判」对称,所以同样要理由必填确认,并且必须写清理由(比如共享办公网络、已知合作账户)。命中 IP 白名单的纯技术性正常由系统自动放过,不用走这里 · 写入 admin.cluster_cleared",
      amplifies: true,
      run: (reason) => {
        ctx.setParam(`K.cluster.${c.id}.st`, "cleared", { action: `判定为正常 ${c.id}(永久移出监控)`, reason });
        ctx.toast(`${c.id} 已判定正常 · 永久移出监控 · 理由留痕`);
      },
    });

  // PRD K1④「人工复审簇」:仍需操作确认,只落复审备注 + 结论,不改簇状态(结论出口另走 标可疑 / 判正常)。
  const reviewNote = (c: K1Cluster) =>
    ctx.openConfirm({
      action: `人工复审备注 · ${c.id}`,
      detail: "记录复审过程与初步结论(可疑 / 正常 / 待更多证据),不改变簇状态、不动任何账户 —— 状态变更仍走「标可疑 / 判正常 / 批量冻结」各自的流程。",
      chips: [["仅备注 · 不改状态", "done"], ["落 A2 审计", "ready"]],
      reason: true,
      okLabel: "保存备注",
      run: (reason) => {
        ctx.setParam(`K.cluster.${c.id}.reviewNote`, reason, { action: `人工复审备注 ${c.id}`, reason });
        ctx.toast(`${c.id} 复审备注已留痕`);
      },
    });

  const adjParam = (p: (typeof K1_PARAMS)[number]) => {
    const cur = ctx.pget(`K.k1.${p.key}`) ?? p.val;
    ctx.openActionConfirm({
      action: `拦截阈值调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${cur} · ${p.note}。这条线由服务器在注册 / 绑上级 / 绑卡入口直接执行,改严会拦掉更多注册,改松会放进更多小号 —— 所以要理由必填确认,通过后下一次校验生效 · 写入 admin.risk_threshold_adjusted`,
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam(`K.k1.${p.key}`, newVal, { action: `调整拦截阈值 ${p.name}`, reason });
        ctx.toast(`${p.name} 调整已确认生效 · 通过后下一次校验生效`);
      },
    });
  };

  // 白名单(风控主管 · 仍需操作确认 · 只影响 IP 维度):种子 − 已移除 + 已添加(K.wl.add.* 派生)。
  const wlAdded = useMemo(
    () =>
      Object.entries(ctx.params)
        .filter(([k]) => k.startsWith("K.wl.add."))
        .map(([k, v]) => [k.slice("K.wl.add.".length), String(v), "你", "2026-12-31"] as [string, string, string, string]),
    [ctx.params],
  );
  const wlRows = [...K1_WHITELIST.filter(([cidr]) => ctx.pget(`K.wl.del.${cidr}`) !== "1"), ...wlAdded.filter(([cidr]) => ctx.pget(`K.wl.del.${cidr}`) !== "1")];

  const addWl = () =>
    ctx.openConfirm({
      action: "添加 IP 白名单",
      detail: "加白后该 IP / 网段不再触发「同 IP 多账户」报警(设备和支付维度照常检测),也不会解冻任何已冻结账户。请在原因里写明场景(如合租办公网、校园网)。",
      chips: [["只影响 IP 维度", "ready"], ["不解冻已冻结账户", "done"]],
      reason: true,
      input: { label: "IP / 网段", placeholder: "如 198.51.100.0/24" },
      okLabel: "确认加白",
      run: (reason, cidr) => {
        if (!cidr) return;
        ctx.setParam(`K.wl.add.${cidr}`, reason, { action: `添加 IP 白名单 ${cidr}`, reason });
        ctx.toast("白名单已添加 · 失效时间默认年底 · 落审计");
      },
    });

  const rmWl = (cidr: string) =>
    ctx.openConfirm({
      action: `移除白名单 · ${cidr}`,
      detail: "移除后该网段恢复「同 IP 多账户」检测。",
      chips: [["恢复 IP 维度检测", "ready"]],
      reason: true,
      okLabel: "确认移除",
      run: (reason) => {
        ctx.setParam(`K.wl.del.${cidr}`, "1", { action: `移除 IP 白名单 ${cidr}`, reason });
        ctx.toast("白名单已移除 · 落审计");
      },
    });

  // 统计派生:base(样本窗以外存量)+ 样本实时态(store 处置即时反映)。
  const live = K1_CLUSTERS.filter((c) => liveSt(c) !== "cleared" && liveSt(c) !== "released");
  const stTotal = K_RISK.clusterBase + live.length;
  const stHigh = K_RISK.highBase + live.filter((c) => c.strength >= 0.7 && liveSt(c) !== "frozen").length;
  const frozenList = K1_CLUSTERS.filter((c) => liveSt(c) === "frozen");
  const stFrozen = K_RISK.frozenBase + frozenList.length;
  const stFrozenAcc = K_RISK.frozenAccountsBase + frozenList.reduce((a, c) => a + c.n, 0);

  const cur = K1_CLUSTERS[sel];
  const curSt = liveSt(cur);

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat"><div className="k">监控中账户簇</div><div className="v">{stTotal}</div><div className="sub">三个维度去重合成 · 覆盖 {fmt(RISK.flaggedAccounts)} 个账户</div></div>
        <div className="f-stat warn"><div className="k">高风险簇(强度 ≥ 0.7)</div><div className="v">{stHigh}</div><div className="sub">列表标红 · 建议批量冻结</div></div>
        <div className="f-stat danger"><div className="k">已冻结簇</div><div className="v">{stFrozen}</div><div className="sub">共 {stFrozenAcc} 个账户 · 冻结台账在 C2</div></div>
        <div className="f-stat ok"><div className="k">新人礼拦截(本月)</div><div className="v">${fmt(K_RISK.giftBlockedUsd)}</div><div className="sub">{K_RISK.giftBlockedCnt} 笔重复领取被拦下</div></div>
      </div>

      {/* 拦截阈值(PRD K1③ · 全部操作确认) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">拦截阈值</span>
          <span className="sub">· 注册 / 绑上级 / 绑卡入口由服务器按这些线直接拦 · 改动要理由必填确认</span>
          <div className="r"><span className="kcode electric" title="linkWeight 例外:仅对之后的新判定批生效,不追溯历史簇">改后下一次校验生效 · linkWeight 仅新判定批</span></div>
        </div>
        <div className="l-b">
          <div className="param-list">
            {K1_PARAMS.map((p) => {
              const curV = ctx.pget(`K.k1.${p.key}`);
              return (
                <div className="p" key={p.key}>
                  <div className="txt"><div className="k">{p.name}</div><div className="s">{p.sub}{curV ? <span> · 已调整(原 {p.val})</span> : null}</div></div>
                  <span className="v" style={p.key === "linkWeight" ? { fontSize: 13 } : undefined}>{curV ?? p.val}</span>
                  <button className="l-btn sm mc" onClick={() => adjParam(p)} title={`PRD K1③ ${p.key}`}>调整</button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 三层去重命中列表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">三层去重命中列表</span>
          <span className="sub">· 点任意一行看簇详情 · 强度 ≥ 0.7 标红</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["ip", "IP"], ["device", "设备指纹"], ["payment", "支付工具"]] as const).map(([v, lb]) => (
                <button key={v} className={`chip${layer === v ? " sel" : ""}`} onClick={() => setLayer(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>去重键(脱敏)</th><th>维度</th><th className="num">关联账户</th><th>关联强度</th><th>注册时间跨度</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {K1_CLUSTERS.map((c, i) => {
                if (layer !== "all" && c.layer !== layer) return null;
                const cst = liveSt(c);
                const [stLb, stTone] = CLUSTER_ST[cst];
                const hot = c.strength >= 0.7 && cst !== "frozen" && cst !== "cleared" && cst !== "released";
                return (
                  <tr key={c.id} className="click" onClick={() => setSel(i)} style={hot ? { background: "var(--danger-soft)" } : undefined}>
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
                        {/* 状态机按 PRD K1④:批量冻结仅 flagged → frozen(detected 先标可疑再冻,不可直跳)。 */}
                        {cst === "detected" && <><button className="l-btn sm" onClick={() => flagCluster(c)}>标可疑</button><button className="l-btn sm mc" onClick={() => clearCluster(c)}>判正常</button></>}
                        {cst === "flagged" && <button className="l-btn sm mc" onClick={() => freezeCluster(c)}>批量冻结</button>}
                        {(cst === "frozen" || cst === "flagged") && <button className="l-btn sm mc" onClick={() => releaseCluster(c)}>解除误判</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="sm-strip">
            <span className="st">detected 命中</span><span className="ar">人工标记 →</span>
            <span className="st warn">flagged 可疑</span><span className="ar">操作确认 →</span>
            <span className="st bad">frozen 已冻结</span><span className="ar">操作确认 →</span>
            <span className="st ok">released 解除误判</span>
            <span className="ar" style={{ marginLeft: 14 }}>命中白名单自动 / 人工操作确认 →</span>
            <span className="st ok">cleared 判定正常</span>
          </div>
        </div>
      </section>

      {/* 簇详情 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">簇详情 · {cur.id}</span>
          <span className="sub">· 同一实体的账户群 · 连线标注共享的维度</span>
          <div className="r">
            <button className="l-btn" onClick={() => reviewNote(cur)}>人工复审备注</button>
            {curSt === "detected" && <button className="l-btn" onClick={() => flagCluster(cur)}>标可疑</button>}
            {curSt === "flagged" && <button className="l-btn mc" onClick={() => freezeCluster(cur)}>批量冻结(操作确认)</button>}
            {curSt === "frozen" && <button className="l-btn mc" onClick={() => releaseCluster(cur)}>解除误判(操作确认)</button>}
          </div>
        </div>
        <div className="cl-split">
          <div className="graph">
            <ClusterGraph c={cur} />
            <div className="edge-legend">
              <span className="it"><span className="sw2" style={{ background: "var(--warning)" }} />同设备</span>
              <span className="it"><span className="sw2" style={{ background: "var(--cyan)" }} />同支付工具</span>
              <span className="it"><span className="sw2" style={{ background: "var(--ink-4)" }} />同 IP</span>
            </div>
            <div className="edge-legend">
              <span className="it"><span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--surface-3)", border: "1.5px solid var(--danger)", display: "inline-block" }} />已冻结</span>
              <span className="it"><span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--surface-3)", border: "1.5px solid var(--warning)", display: "inline-block" }} />可疑</span>
              <span className="it"><span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--surface-3)", border: "1.5px solid var(--ink-4)", display: "inline-block" }} />待判</span>
              <span className="it"><span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warning)", display: "inline-block" }} />领过新人礼</span>
            </div>
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
            <div style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "var(--ink)" }}>
              新人礼重复发放记录 <span className="kcode" style={{ marginLeft: 6 }} title="welcome gift $5 + 200 NEX · 发放由服务器按账户只发一次,清缓存无效">同一实体多号领取</span>
            </div>
            {cur.gifts.length ? (
              cur.gifts.map((g) => (
                <div className="gift-row" key={g[0]}>
                  <span className="gid">{g[0]}</span>
                  <span className="gtx">{g[1]}</span>
                  <span className={`bdg ${g[2].includes("拦截") || g[2].includes("处置") ? "ok" : "warn"}`}>{g[2]}</span>
                </div>
              ))
            ) : (
              <div className="ktint" style={{ fontSize: 12 }}>本簇没有新人礼重复发放记录。</div>
            )}
          </div>
        </div>
      </section>

      {/* IP 白名单 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">IP 白名单</span>
          <span className="sub">· 合租办公网 / 校园网加白后不再按 IP 维度报警 · 不影响已冻结账户 · 风控主管操作</span>
          <div className="r"><button className="l-btn" onClick={addWl}>+ 添加白名单</button></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 680 }}>
            <thead><tr><th>IP / 网段</th><th>备注</th><th>添加人</th><th>失效时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {wlRows.map((w) => (
                <tr key={w[0]}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{w[0]}</td>
                  <td style={{ fontSize: 12.5 }}>{w[1]}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{w[2]}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{w[3]}</td>
                  <td style={{ textAlign: "right" }}><button className="l-btn sm" onClick={() => rmWl(w[0])}>移除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="f-foot">
        <b>拦截发生在服务器,不在这个页面</b>:注册、绑上级、绑卡时服务器按上面的阈值直接拒绝,客户端删缓存、换浏览器都绕不过;新人礼按「账户只发一次」由服务器记账,清本地存储不会重置。本页面只配阈值、看命中、处置簇。<b>三类动作必须操作确认</b>:批量冻结(把一簇账户全冻上)、解除误判(放行)、判定为正常(永久移出监控,会影响后续检测基底,风险和解冻同级)。纯技术性的正常(命中白名单)由系统自动放过,不占人工流程。命中信号喂风险评分(K4)多账户维度和风险雷达(B5);冻结台账落在用户域(C2)。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "三层去重命中列表",
            maxRows: 5,
            reason: "去重命中当前五个聚类样本,按维度 chip 切换查看",
          },
          {
            label: "簇详情 · CL-318",
            maxRows: 5,
            reason: "簇详情仅展示当前选中聚类五个账户样本",
          },
          {
            label: "IP 白名单",
            maxRows: 2,
            reason: "白名单当前两条固定样本,新增走操作确认",
          },
        ]}
      />
    </div>
  );
}
