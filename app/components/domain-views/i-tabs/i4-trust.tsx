"use client";

/**
 * I4 信任中心与风险披露(合并页) — design_handoff_i_domain/I4 信任中心与披露.html port。
 * 单源:后端 /content/trust-disclosure/overview;空库时保持空态,不补前端业务样例。
 * 操作确认 显式 edit 契约:
 *  - 调参传 edit:回滚(text/current=v)/ 发布披露新版(text/current=j.v)/ 调整受限动作范围(text/current);
 *  - 处置不传 edit:发布信任版块 / 下架信任版块。
 * amplifies 全为 false —— I4 不碰 B1(条款重签不是熔断、不动账本)。
 * 凭据 / 合规铁律:披露全链 操作员 = 风控,执行门槛 = 风控 / 超管;详情文案体现这一点。
 */
import { useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";

type TrustSection = {
  key: string; desc: string; struct: string; v: string; status: string; lastChange: string; roleGate: string; highSensitivity: boolean;
};
type Jurisdiction = {
  code: string; name: string; v: string; status: string; publishedAt: string; affected: number; ackProgress: number; blocked: number;
};
type GateAction = { key: string; name: string; sub: string; st: string; tone: string; active: boolean };
type TrustDetailKey = string;

export function I4Trust({ ctx }: { ctx: ICtx }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const [secKey, setSecKey] = useState<TrustDetailKey | null>(null);
  const [jurCode, setJurCode] = useState<string | null>(null);
  const [chapNo, setChapNo] = useState<string | null>(null);
  const data = content.trustDisclosure;
  const I4_STATS = data?.stats ?? { managedSections: 0, jurisdictions: 0, staleAckUsers: 0, weeklyGateBlocked: 0 };
  const TRUST_SECTIONS: TrustSection[] = (data?.trustSections ?? []).map((s) => ({ ...s, v: s.version }));
  const FINANCIALS_FIELDS = (data?.financialFields ?? []).map((f) => ({ k: f.key, v: f.value, delta: f.delta }));
  const JURISDICTIONS: Jurisdiction[] = (data?.jurisdictions ?? []).map((j) => ({ ...j, v: j.version }));
  const DISCLOSURE_CHAPTERS = data?.chapters ?? [];
  const GATED_ACTIONS: GateAction[] = (data?.gatedActions ?? []).map((g) => ({ key: g.key, name: g.name, sub: g.sub, st: g.status, tone: g.tone, active: g.active }));
  const SECTION_FIELDS = (data?.sectionFields ?? []).reduce<Record<string, [string, string][]>>((acc, field) => {
    acc[field.sectionKey] = [...(acc[field.sectionKey] ?? []), [field.key, field.value]];
    return acc;
  }, {});
  const activeJurisdiction = JURISDICTIONS[0];
  const activeJurisdictionCode = activeJurisdiction?.code ?? "";
  const activeChapter = DISCLOSURE_CHAPTERS.find((c) => c.jurisdiction === activeJurisdictionCode) ?? DISCLOSURE_CHAPTERS[0];
  const CHAPTER_BODY_ZH = activeChapter?.zhBody ?? "";
  const CHAPTER_BODY_EN = activeChapter?.enBody ?? "";
  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  const liveTrustStatus = (s: TrustSection): string => s.status;
  const liveJurVersion = (j: Jurisdiction): string => j.v;
  const gateOn = (k: string): boolean => GATED_ACTIONS.find((g) => g.key === k)?.active ?? false;
  const disclosureDraft = data?.draft;

  const openSecDetail = (s: TrustSection) => setSecKey(s.key);
  const openJurDetail = (j: Jurisdiction) => setJurCode(j.code);
  const openChap = (no: string) => setChapNo(no);

  // ---------- I4 信任版块动作 ----------
  const pubSection = (s: TrustSection) =>
    openActionConfirm({
      action: <>发布信任版块 · {s.key}({s.desc})</>,
      detail: (
        <>
          对外信任内容上线,发布后 /trust 页即时换新。<b>执行门槛:{s.roleGate}</b>
          {s.highSensitivity && "(对外财务/代币叙事是高敏合规面,内容角色无权放行)"}。审计必须带「数据来源」与「对外披露(非内部账本)」标注;带防重号。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.publishI4TrustSection(s.key, s.v, reason), `${s.key} 已发布至 /trust`);
      },
    });

  const rollbackSection = (s: TrustSection) =>
    openActionConfirm({
      action: <>回滚信任版块 · {s.key}</>,
      detail: (
        <>
          当前 <b>{s.v}</b>。回滚 = 把历史版重新发布(对外内容立即回到旧版),等价一次发布,执行门槛与发布一致;审计记 from→to。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: s.v },
      run: (reason, nv) => {
        if (!nv) return;
        runBackend(actions.rollbackI4TrustSection(s.key, nv, reason), `${s.key} 回滚已确认生效`);
      },
    });

  const archiveSection = (s: TrustSection) =>
    openActionConfirm({
      action: <>下架信任版块 · {s.key}</>,
      detail: (
        <>
          当前 <b>{s.v}</b> 生效中。下架后 /trust 页该版块<b>整体隐藏</b>(无内置兜底)——一般只在对外内容出合规问题时才这么做;执行门槛与发布一致({s.roleGate})。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.archiveI4TrustSection(s.key, reason), `${s.key} 下架已确认生效`);
      },
    });

  // ---------- I4 披露动作 ----------
  const draftDisclosure = () =>
    openActionConfirm({
      action: <>草拟披露新版 · 风控提交</>,
      detail: (
        <>
          7 章节逐章改;中英两份镜像同步(占位符一致)。草稿不生效;发布走「执行门槛:风控/超管」操作确认并触发该法域重确认。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "version-authoring",
        version: disclosureDraft?.version ?? "",
        jurisdiction: disclosureDraft?.jurisdiction ?? activeJurisdictionCode,
        zh: CHAPTER_BODY_ZH,
        en: CHAPTER_BODY_EN,
      },
      run: (reason, _v, form) => {
        const version = form?.version?.trim() || disclosureDraft?.version?.trim() || "";
        const jurisdiction = form?.jurisdiction?.trim() || disclosureDraft?.jurisdiction?.trim() || activeJurisdictionCode;
        const zh = form?.zh?.trim() || CHAPTER_BODY_ZH;
        const en = form?.en?.trim() || CHAPTER_BODY_EN;
        if (!version || !jurisdiction || !zh || !en) {
          toast("缺少后端披露版本/法域/正文,无法提交草稿");
          return;
        }
        runBackend(actions.saveI4DisclosureDraft(jurisdiction, {
          version,
          jurisdiction,
          languageScope: form?.languageScope || disclosureDraft?.languageScope || "",
          effectiveDate: form?.effectiveDate || disclosureDraft?.effectiveDate || "",
          requiresReack: form?.requiresReack ?? true,
          zh,
          en,
        }, reason), "披露草稿已存 · 发布需风控操作确认");
      },
    });

  const configMatrix = () =>
    openConfirm({
      action: <>配置法域 × 版本映射(风控提交 · 操作确认)</>,
      detail: (
        <>
          增法域、改某法域的生效版本映射都在这里;版本号只增不减。改映射等同给该法域换生效条款,会触发重确认;<b>发起人限风控,执行门槛 = 风控 / 超管</b>。
        </>
      ),
      chips: [
        ["风控提交 · 留痕", "done"],
        ["发布另走风控操作确认", "ready"],
      ],
      reason: true,
      okLabel: "保存配置",
      run: (reason) => {
        runBackend(actions.configureI4Matrix(reason), "法域矩阵配置已提交风控操作确认");
      },
    });

  const publishDisclosure = (j: Jurisdiction) =>
    openActionConfirm({
      action: <>发布披露新版 · {j.code} {j.v} → 新版</>,
      detail: (
        <>
          <b>合规关键动作</b>:发布即把 {j.code} 法域全部用户的确认状态标成过期(stale),受限动作(提现等)在重确认前被服务器拦截;重确认提醒自动经通知页(I3)<b>critical</b> 通道下发。<b>发起人必须是风控,执行门槛 = 风控 / 超管</b>;内容角色草拟的文本由风控提交。中英镜像与占位符校验通过才能发;带防重号。监管点名当天可走此路径即时改条款。
        </>
      ),
      amplifies: false,
      // audit P1 修:edit current 必须读实时态 liveJurVersion(j),否则第二次操作 modal 显示种子值(stale)。
      businessForm: {
        kind: "version-authoring",
        version: liveJurVersion(j),
        jurisdiction: j.code,
        zh: CHAPTER_BODY_ZH,
        en: CHAPTER_BODY_EN,
      },
      run: (reason, v, form) => {
        if (!v) return;
        runBackend(actions.publishI4Disclosure(j.code, {
          version: v,
          jurisdiction: form?.jurisdiction || j.code,
          languageScope: form?.languageScope || "en+zh",
          effectiveDate: form?.effectiveDate || disclosureDraft?.effectiveDate || "",
          requiresReack: form?.requiresReack ?? true,
          zh: form?.zh || CHAPTER_BODY_ZH,
          en: form?.en || CHAPTER_BODY_EN,
        }, reason), `${j.code} 披露新版已发布 · 目标 ${v}`);
      },
    });

  const toggleGate = (g: GateAction) => {
    const on = gateOn(g.key);
    openActionConfirm({
      action: <>{on ? "移出" : "纳入"}受限动作 · {g.name}</>,
      detail: (
        <>
          {on
            ? <>把 <b>{g.name}</b> 移出受限范围:确认状态过期时<b>不再拦截</b>该动作。<b>缩小范围等于放松合规拦截</b>,确认时写清依据。</>
            : <>把 <b>{g.name}</b> 纳入受限范围:确认状态过期时拦截该动作。</>}
          {" "}风控提交,风控 / 超管执行。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const nextScope = GATED_ACTIONS
          .filter((item) => (item.key === g.key ? !on : item.active))
          .map((item) => item.name)
          .join(" + ");
        runBackend(actions.updateI4GateScope(nextScope || g.name, reason), `${g.name} 已${on ? "移出" : "纳入"}受限范围`);
      },
    });
  };

  // 抽屉数据。
  const sec = secKey ? TRUST_SECTIONS.find((s) => s.key === secKey) ?? null : null;
  const jur = jurCode ? JURISDICTIONS.find((j) => j.code === jurCode) ?? null : null;
  const chap = chapNo ? DISCLOSURE_CHAPTERS.find((c) => c.no === chapNo) ?? null : null;

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">I4 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">I4 暂无真实接口数据</div></div></section>;
  }

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管信任版块</div>
          <div className="v">{I4_STATS.managedSections} 个</div>
          <div className="sub">财务数字/团队/叙事/徽章/审计/外链</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">披露法域 × 版本</div>
          <div className="v">{I4_STATS.jurisdictions} 法域</div>
          <div className="sub">{JURISDICTIONS.map((j) => j.code).join(" · ") || "暂无后端法域"}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">待重确认用户</div>
          <div className="v">{I4_STATS.staleAckUsers.toLocaleString("en-US")}</div>
          <div className="sub">{activeJurisdiction ? `${activeJurisdiction.code} ${activeJurisdiction.v}` : "暂无后端法域版本"} · 下次提现前必须确认</div>
        </div>
        <div className="f-stat">
          <div className="k">合规闸拦截(本周)</div>
          <div className="v">{I4_STATS.weeklyGateBlocked} 次</div>
          <div className="sub">未确认者发起提现被拦</div>
        </div>
      </div>

      {/* (I4 · a) 信任中心 6 版块 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任中心(I4 · a)· /trust</span>
          <span className="sub">· 6 版块 · 财务数字/团队/叙事/徽章/审计/外链</span>
          <div className="r">
            <span className="icode danger">高敏合规</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>section</th>
                <th>当前内容</th>
                <th>版本</th>
                <th>确认级</th>
                <th>状态</th>
                <th>最近改动</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {TRUST_SECTIONS.map((s) => {
                const st = liveTrustStatus(s);
                const isArchived = st === "archived" || st.includes("archived");
                return (
                  <tr
                    key={s.key}
                    className="click"
                    onClick={() => openSecDetail(s)}
                    style={isArchived ? { opacity: 0.55 } : undefined}
                  >
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{s.key}</span>
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{s.desc}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.struct}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{s.v}</td>
                    <td>
                      {s.highSensitivity ? (
                        <span className="bdg warn">{s.roleGate}</span>
                      ) : (
                        <span className="bdg dim">{s.roleGate}</span>
                      )}
                    </td>
                    <td>
                      {isArchived ? (
                        <span className="bdg dim">已下架</span>
                      ) : (
                        <span className="bdg ok">published</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{s.lastChange}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); pubSection(s); }}>发布新版</button>{" "}
                      <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); rollbackSection(s); }}>回滚</button>
                      {!isArchived && (
                        <>
                          {" "}
                          <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); archiveSection(s); }}>下架</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* I4 披露版本 × 法域矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">披露矩阵(I4 · 披露)· version × jurisdiction</span>
          <span className="sub">· 风控提交 · 风控 / 超管执行</span>
          <div className="r">
            <span className="icode danger">合规关键 · 风控确认</span>
            <button className="l-btn sm mc" onClick={draftDisclosure}>草拟新版</button>
            <button className="l-btn sm" onClick={configMatrix}>配置矩阵</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>法域</th>
                <th>当前版本</th>
                <th>状态</th>
                <th>发布日</th>
                <th className="num">受影响</th>
                <th>re-ack 进度</th>
                <th className="num">拦截数</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {JURISDICTIONS.map((j) => {
                const v = liveJurVersion(j);
                return (
                  <tr key={j.code} className="click" onClick={() => openJurDetail(j)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{j.code}</span>
                      <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{j.name}</div>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{v}</td>
                    <td><span className="bdg ok">{j.status}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{j.publishedAt}</td>
                    <td className="num mono">{j.affected.toLocaleString("en-US")}</td>
                    <td>
                      <span className="tr-prog">
                        <i style={{ width: `${j.ackProgress}%` }} />
                      </span>
                      <span className="mono" style={{ fontSize: 11.5, marginLeft: 6 }}>{j.ackProgress}%</span>
                    </td>
                    <td
                      className="num mono"
                      style={j.blocked > 0 ? { color: "var(--warning)" } : undefined}
                    >
                      {j.blocked}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); publishDisclosure(j); }}>发新版</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="itint danger">
            <b>披露全链 操作员 = 风控、执行门槛 = 风控 / 超管;内容仅草拟。re-ack 非熔断闸,不入 J1/J2。</b>
          </div>
          {disclosureDraft && disclosureDraft.version && disclosureDraft.zh && disclosureDraft.en && (
            <div className="itint cyan" data-proof="disclosure-draft-preview" style={{ marginTop: 10 }}>
              <b>当前披露草稿回显</b> · 版本 <span className="mono">{disclosureDraft.version}</span>
              {" "}· 法域 <span className="mono">{disclosureDraft.jurisdiction ?? ""}</span>
              {" "}· 语言 <span className="mono">{disclosureDraft.languageScope ?? "en+zh"}</span>
              {" "}· 生效日 <span className="mono">{disclosureDraft.effectiveDate ?? ""}</span>
              {" "}· re-ack <span className="mono">{disclosureDraft.requiresReack ?? "true"}</span>
              <div className="grid g-2" style={{ gap: 10, marginTop: 8 }}>
                <div className="ab-prev">
                  <div className="lc">ZH · draft</div>
                  <div className="tx">{disclosureDraft.zh}</div>
                </div>
                <div className="ab-prev">
                  <div className="lc">EN · draft</div>
                  <div className="tx">{disclosureDraft.en}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* I4 章节版本详情 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">版本详情(I4 · 披露)· {activeJurisdiction ? `${activeJurisdiction.code} ${activeJurisdiction.v}` : "暂无后端法域"}</span>
          <span className="sub">· 中英镜像 + 占位符一致</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {DISCLOSURE_CHAPTERS.map((c) => (
            <div className="tr-vrow" key={c.no}>
              <span className="nm">
                <span className="mono" style={{ color: "var(--ink-4)", marginRight: 8 }}>{c.no}</span>
                <b style={{ fontWeight: 600, color: "var(--ink-2)" }}>{c.zh}</b>
                <small style={{ marginLeft: 26, color: "var(--ink-4)" }}>{c.en}</small>
              </span>
              <button className="l-btn sm" onClick={() => openChap(c.no)}>查看</button>
            </div>
          ))}
        </div>
      </section>

      {/* I4 re-ack 覆盖监控 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">重确认覆盖监控(I4 · 披露)</span>
          <span className="sub">· 改版后各法域确认进度 · 数字来自服务器确认事件</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>法域</th>
                <th>目标版本</th>
                <th className="num">受影响</th>
                <th className="num">已确认</th>
                <th>进度</th>
                <th className="num">拦截数</th>
              </tr>
            </thead>
            <tbody>
              {JURISDICTIONS.map((j) => {
                const acked = Math.round((j.affected * j.ackProgress) / 100);
                return (
                  <tr key={j.code}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{j.code}</span>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{liveJurVersion(j)}</td>
                    <td className="num mono">{j.affected.toLocaleString("en-US")}</td>
                    <td className="num mono">{acked.toLocaleString("en-US")}</td>
                    <td>
                      <span className="tr-prog">
                        <i style={{ width: `${j.ackProgress}%` }} />
                      </span>
                      <span className="mono" style={{ fontSize: 11.5, marginLeft: 6 }}>{j.ackProgress}%</span>
                    </td>
                    <td
                      className="num mono"
                      style={j.blocked > 0 ? { color: "var(--warning)" } : undefined}
                    >
                      {j.blocked}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 8 }}>
          <div className="itint">
            <b>没确认会怎样</b> · 确认状态过期(stale)的用户,发起受限动作时被服务器拦下并跳去披露页;拦截数持续偏高说明催办不够——重确认提醒走通知页(I3)的 critical 通道,永不被淘汰。
          </div>
        </div>
      </section>

      {/* I4 受限动作范围 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">受限动作范围(I4 · 披露)</span>
          <span className="sub">· 确认状态过期时,哪些动作会被拦 · 逐项启停(不再手打整串)</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {GATED_ACTIONS.map((g) => {
            const on = gateOn(g.key);
            return (
              <div className="tr-vrow" key={g.key}>
                <span className="nm">
                  <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{g.name}</span>
                  <small style={{ color: "var(--ink-4)" }}>{g.sub}</small>
                </span>
                <span className={`bdg ${g.tone}`}>{g.st}</span>
                <button className="l-btn sm mc" style={{ opacity: on ? 1 : 0.5 }} onClick={() => toggleGate(g)}>{on ? "受限内 · 移出" : "已移出 · 纳入"}</button>
              </div>
            );
          })}
          <div className="itint warn" style={{ marginTop: 10 }}>
            <b>这不是熔断闸</b> · 重确认是「条款重新签字」机制,不是开关熔断——它不占应急熔断矩阵(J1)的闸位,也不进开关存储。监管点名要停业务,走 J 域;要改条款重签,走这页。J 域的应急剧本(J4)里「发布新披露版」就是引用这页的发布动作。
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>执行门槛(两套,别混)</b>:信任中心(I4)= 内容执行门槛:一般版块内容角色,<b>财务数字 / NEX 叙事 / 对外合规声明类必须合规或超管执行</b>(财务角色对数字口径有知情确认职能,但仅为知情职能);风险披露(I4)= <b>风控执行门槛:风控 / 超管</b>,内容角色只能草拟、不能提交——条款是合规命脉,不给内容角色单独放行的口子。<b>事件去向</b>:版块曝光喂 BI(信任→转化间接归因);披露确认 / 重确认触发 / 拦截三类事件喂合规覆盖看板(L 域)和风控(K 域,拦截数是闸有效性信号)。披露类事件的归类登记(disclosure 域)是 BI 上线前必办工单,占位期按临时编号入库
        <span title="§2.4.3 domain 枚举扩展 · V4 内容批次 · blocking">。</span>
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "信任中心(I4 · a)· /trust",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "信任中心固定六版块,需同屏核对版本与状态",
          },
          {
            label: "披露矩阵(I4 · 披露)· version × jurisdiction",
            maxRows: 4,
            reason: "披露矩阵固定四法域,发布关系必须同屏对比",
          },
          {
            label: "重确认覆盖监控(I4 · 披露)",
            maxRows: 4,
            reason: "重确认监控固定四法域样本,完整 ack 事件进 BI",
          },
        ]}
      />

      {/* 版块详情 Drawer */}
      {sec && (
        <Drawer
          title={`版块 · ${sec.key}(${sec.desc})`}
          onClose={() => setSecKey(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSecKey(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            当前 {sec.v} · {liveTrustStatus(sec)} · 执行门槛:{sec.roleGate}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>
            结构化内容字段如下;文案部分挂双语词条(I6)。发布前可预览,发布走操作确认。
          </div>
          {sec.key === "financials" ? (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>财务数字组</div>
              <div style={{ overflowX: "auto" }}>
                <table className="l-tbl" style={{ minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th>数值</th>
                      <th>环比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FINANCIALS_FIELDS.map((f) => (
                      <tr key={f.k}>
                        <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{f.k}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{f.v}</td>
                        <td className="mono" style={{ color: "var(--success)" }}>{f.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>结构化字段</div>
              {(SECTION_FIELDS[sec.key] ?? []).map(([k, v], i) => (
                <div className="kv" key={i}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </>
          )}
          <div className="itint" style={{ marginTop: 12 }}>
            所有外部链接目前都是占位(纯展示);版本由服务器单源持有,App 端只渲染当前发布版。
          </div>
        </Drawer>
      )}

      {/* 法域详情 Drawer */}
      {jur && (
        <Drawer
          title={`法域 · ${jur.code}(${jur.name})`}
          onClose={() => setJurCode(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setJurCode(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            生效版本 {liveJurVersion(jur)} · {jur.publishedAt} 起 · 受影响用户 {jur.affected.toLocaleString("en-US")}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>
            该法域用户的确认状态按这个版本校验;版本号只增不减。
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>版本与操作 / 留痕</div>
          <div className="kv">
            <span className="k">版本历史</span>
            <span className="v">{liveJurVersion(jur)} 生效 · 此前版本已 superseded</span>
          </div>
          <div className="kv">
            <span className="k">locale</span>
            <span className="v">en + zh 镜像(挂 I6 词条)</span>
          </div>
          <div className="kv">
            <span className="k">操作 / 留痕</span>
            <span className="v">风控 / 超管</span>
          </div>
          <div className="kv">
            <span className="k">法域判定输入</span>
            <span className="v">用户 IP + KYC 辖区(C4 提供)</span>
          </div>
          <div className="itint" style={{ marginTop: 12 }}>
            给这个法域发新版 = 该法域全部用户确认状态转 stale,下次受限动作前强制重确认;重确认提醒经 I3 critical 通道下发。
          </div>
        </Drawer>
      )}

      {/* 章节 Drawer */}
      {chap && (
        <Drawer
          title={`章节 ${chap.no} · ${chap.zh}(${chap.jurisdiction} ${chap.version})`}
          onClose={() => setChapNo(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setChapNo(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "4px 0 4px", color: "var(--ink)" }}>zh</div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>正文(节选)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontSize: 12.5, lineHeight: 1.7 }}>{chap.zhBody}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>en</div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>Body (excerpt)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontSize: 12.5, lineHeight: 1.7 }}>{chap.enBody}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="itint" style={{ marginTop: 12 }}>
            中英镜像 ✓ 占位符一致 ✓ · 用户必须滚到底 + 勾选才能确认;确认记录(版本 + 法域)落在服务器。
          </div>
        </Drawer>
      )}
    </>
  );
}
