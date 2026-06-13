"use client";

/**
 * C1 检索 & 画像 — C 域入口与用户检索面(design_handoff_c_domain port)。
 * 单源纪律:
 *  - 用户行 = design-data.USERS 全量 7 行(设计稿中文名单为发明,弃);风险分与 K4 同分单源;
 *  - 高风险档 = K_RISK.scoreHigh 只读引用,不重算;
 *  - 冻结账户 = frozenTotal(manualLive):K1 批量 86 + 人工存量 11 + C2 台账实时人工冻结数,
 *    与 C2 页同一派生口径(useUserOps 覆盖种子,严禁两页各写一份);
 *  - 行内冻结实时态 = useUserOps frozen 覆盖 USERS.frozen 种子(与 C2 / 360 页同 store)。
 * 本页零写权:行点击深链 /users/search/<id> 进 360 画像;处置去 C2/C3/C4/C5。
 * 页头导出按钮(C1HeaderActions)走普通确认 + logAudit(admin.user_list_exported,归口 L5)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { PaginationExemptionList } from "../design-kit";
import { USERS, REGISTERED_USERS, K_RISK, fmtUsd } from "@/lib/mock/admin/design-data";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { C1_STATS, C4_LEDGER, KYC_STATE, frozenTotal, manualFrozenSeeds } from "./data";
import type { CCtx } from "./types";

type Seg = "all" | "frozen" | "highrisk" | "kyc";
const SEGS: [Seg, string][] = [["all", "全部"], ["frozen", "冻结"], ["highrisk", "高风险"], ["kyc", "KYC 待确认"]];

const riskTone = (r: number) => (r >= 70 ? "bad" : r >= 40 ? "warn" : "ok");

export function C1Search({ ctx }: { ctx: CCtx }) {
  const router = useRouter();
  const [seg, setSeg] = useState<Seg>("all");
  const [q, setQ] = useState("");
  const opsUsers = useUserOps((s) => s.users);
  const hydrated = useOpsHydrated();

  // 冻结实时态:store 覆盖种子(与 C2 / 360 页同源)。
  const liveFrozen = (id: string, seed: boolean) =>
    hydrated && opsUsers[id] ? !!opsUsers[id].frozen : seed;

  // 实时人工冻结数 = manualFrozenSeeds(C2 台账 ∪ USERS 去重)统一派生 —— 与 C2 页同一列表,
  // 360 页冻结任一检索用户同样计入;种子下 = 1(usr_55B1)→ 总数 98。
  const manualLive = manualFrozenSeeds.filter(({ id, seed }) => liveFrozen(id, seed)).length;

  // KYC 列 = C4 唯一真相源(本页不自存):实时裁决(C.kyc.<id>.st)> C4 台账种子 > USERS 基础态(台账样本窗外用户)。
  // 三态与 C4 同口径:verified / review(K5 复审中)/ none —— USERS.kyc 只作 verified/none 回落,不表达复审态。
  const kycOf = (id: string, seed: string): keyof typeof KYC_STATE => {
    const live = ctx.pget(`C.kyc.${id}.st`) as keyof typeof KYC_STATE | undefined;
    if (live) return live;
    const row = C4_LEDGER.find((r) => r.id === id);
    if (row) return row.st;
    return seed === "verified" ? "verified" : "none";
  };

  const ql = q.trim().toLowerCase();
  const rows = USERS.filter((u) => {
    const frozen = liveFrozen(u.id, u.frozen);
    if (seg === "frozen" && !frozen) return false;
    if (seg === "highrisk" && u.risk < 70) return false;
    if (seg === "kyc" && kycOf(u.id, u.kyc) === "verified") return false;
    if (ql && !(u.id.toLowerCase().includes(ql) || u.name.toLowerCase().includes(ql) || u.ref.toLowerCase().includes(ql))) return false;
    return true;
  });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">注册用户</div><div className="v">{REGISTERED_USERS.toLocaleString("en-US")}</div><div className="sub">本周新增 {C1_STATS.weeklyNew.toLocaleString("en-US")}</div></div>
        <div className="f-stat ok"><div className="k">设备持有者(L4+)</div><div className="v">{C1_STATS.deviceHolders.toLocaleString("en-US")}</div><div className="sub">占 {C1_STATS.holderPct}%</div></div>
        <div className="f-stat warn"><div className="k">高风险档(K4)</div><div className="v">{K_RISK.scoreHigh.toLocaleString("en-US")}</div><div className="sub">只读引用 · 不重算</div></div>
        <div className="f-stat cyan"><div className="k">冻结账户(C2)</div><div className="v">{frozenTotal(manualLive)}</div><div className="sub">台账在账户操作页</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检索 &amp; 画像</span>
          <span className="sub">· 用户分层口径 L0–L5 / V0–V12 · 手机号仅脱敏/哈希搜</span>
          <div className="r">
            <div className="search-bar">
              <input placeholder="userId / 姓名 / 推荐码" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="chips">
              {SEGS.map(([v, lb]) => (
                <button key={v} className={`chip${seg === v ? " sel" : ""}`} onClick={() => setSeg(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1000 }}>
            <thead><tr><th>userId</th><th>姓名</th><th>生命周期</th><th>V-Rank</th><th className="num">设备</th><th>KYC</th><th>风险分</th><th className="num">余额</th><th>状态</th></tr></thead>
            <tbody>
              {rows.map((u) => {
                const frozen = liveFrozen(u.id, u.frozen);
                return (
                  <tr key={u.id} className="click" onClick={() => router.push(`/users/search/${u.id}`)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{u.id} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                    <td>{u.name}</td>
                    <td><span className="bdg dim">{u.lc}</span></td>
                    <td><span className="bdg dim">{u.vrank}</span></td>
                    <td className="num mono">{u.devices}</td>
                    <td>{(() => { const st = kycOf(u.id, u.kyc); const [label, tone] = KYC_STATE[st]; return <span className={`bdg ${tone}`}>{label}</span>; })()}</td>
                    <td><span className={`bdg ${riskTone(u.risk)}`}>{u.risk}</span></td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{fmtUsd(u.balance)}</td>
                    <td>{frozen ? <span className="bdg bad">冻结</span> : <span className="bdg ok">正常</span>}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>无匹配用户 · 换个检索词或分组试试</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ctint"><b>检索结果只读</b> · 本页只定位与展示;冻结/解冻去 C2,资产调整去 C3,实名裁决去 C4,安全处置去 C5,各自走操作确认。</div>
        </div>
      </section>

      <p className="f-foot">隐私三道闸:手机号/地址全程脱敏(检索、展示、导出);看敏感维度落 <b>admin.user_profile_viewed</b>;导出名单落 <b>admin.user_list_exported</b>(检索条件以哈希记录,不含明文),统一归口导出审计台(L5)。生命周期 L0–L5 / V-Rank V0–V12 是内部分诊口径,用户端永不可见。</p>
      <PaginationExemptionList
        items={[
          {
            label: "检索 & 画像",
            kind: "sample-ledger",
            maxRows: 7,
            reason: "C1 只读检索固定七个种子用户,真实处置从深链进入各业务页",
          },
        ]}
      />
    </>
  );
}

export function C1HeaderActions({ ctx }: { ctx: CCtx }) {
  return (
    <button
      className="f-cta"
      onClick={() => ctx.openConfirm({
        action: "导出用户名单(脱敏 CSV)",
        detail: "按当前检索条件导出。手机号、地址全部脱敏;检索条件以哈希记入审计,不含明文。落 admin.user_list_exported,统一归口到导出审计台(L5)。",
        okLabel: "确认导出",
        run: () => {
          ctx.logAudit({ actor: "总管理员", action: "导出用户名单(脱敏 CSV)· admin.user_list_exported", target: "C1" });
          ctx.toast("名单已导出(脱敏)· 落审计并归口 L5");
        },
      })}
    >
      <Download size={14} />
      导出用户名单(脱敏)
    </button>
  );
}
