"use client";

/**
 * J4 · 监管点名应急 SOP — 8 剧本库(actionSequence timeline)+ 应急快速轨 SLA + 执行追溯历史。
 * 每步原子动作落各域确认门,J4 编排面不再额外操作确认;应急快速轨只加速确认理由 SLA,绝不取消确认理由。
 * 剧本编辑 / 演练 / 执行 / 新增均走 OperationConfirmModal → setParam(J.emergency.playbook.*)。
 */
import { useState } from "react";
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { PLAYBOOKS, PB_SCENES, EXECS, type Playbook } from "./data";
import type { JCtx } from "./types";

/* 域 badge → 色族(danger=J 域 / warning=D2 / brand=I5 / cyan=I3,I2 / brand-2=C2,K1 / success=B1) */
const DOM_CLS: Record<string, string> = { J1: "dj", J2: "dj", D2: "dd", I5: "di5", I3: "di", I2: "di", C2: "dc", K1: "dc", B1: "db" };

/** ax 内 **…** 强调标记 → <b> 渲染。 */
function axRender(s: string) {
  return s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>));
}

/** J4 页头 CTA(挂 DomainHeader 右槽):+ 新增剧本。 */
export function J4HeaderActions({ ctx }: { ctx: JCtx }) {
  const { setParam, toast, openActionConfirm } = ctx;
  const newPb = () => openActionConfirm({
    action: "新增应急剧本",
    detail: <><b>创建新剧本</b>:填写名称 / 触发场景 / 动作序列(按 J1/J2/I5/C2/K1/D2/I3 各域原子动作组装)+ 是否应急轨 + 责任人 + SLA · 走 操作确认 · 入库后进剧本库 · 写 admin.emergency_playbook_edited(空序列 → 新 seq)· 原型记入草稿位。</>,
    edit: { kind: "text", current: "—(输入剧本名称)" },
    run: (reason, newValue) => {
      setParam("J.emergency.playbook.draft", newValue ?? "未命名剧本", { action: `新增应急剧本草稿「${newValue ?? "未命名剧本"}」`, reason });
      toast("新剧本工单已确认生效 · 记入草稿位");
    },
  });
  return <button className="f-cta" onClick={newPb}>+ 新增剧本</button>;
}

export function J4Sop({ ctx }: { ctx: JCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const [scene, setScene] = useState("全部");
  // 应急加急参数与 J1 同源(J.emergency.* store 覆盖回落 PRD 默认 15/60/4),J1 调整后本卡同步。
  const slaMins = pget("J.emergency.confirmSlaMins") ?? "15";
  const escMins = pget("J.emergency.escalateMaxMins") ?? "60";
  const escRounds = pget("J.emergency.escalateMaxRounds") ?? "4";
  // 近 90d 实战执行次数从 EXECS 派生(名称含「(演练)」的为演练记录)。
  const liveExecs = EXECS.filter((e) => !e.name.includes("(演练)")).length;

  const effDrillState = (p: Playbook): "active" | "todo" => (pget(`J.emergency.playbook.${p.code}.drill`) === "drilling" ? "active" : p.state);
  const shown = PLAYBOOKS.filter((p) => scene === "全部" || p.scene === scene);
  const ready = PLAYBOOKS.filter((p) => effDrillState(p) === "active").length;
  const todo = PLAYBOOKS.length - ready;
  const emerCount = PLAYBOOKS.filter((p) => p.emer).length;

  const editPb = (p: Playbook) => openActionConfirm({
    action: `编辑应急剧本 · ${p.code} ${p.name}`,
    detail: <><b>剧本库维护</b>:编辑 {p.name} 的动作序列({p.seq.length} 步)+ 触发场景 + 应急轨开关 + SLA · 编辑本身走<b>风控/超管 操作员 · 执行门槛:超管 </b> · 写入 admin.emergency_playbook_edited(before→after action_sequence,A2 留痕)。</>,
    edit: { kind: "text", current: `${p.seq.length} 步 · ${p.scene} · SLA ${p.sla}` },
    run: (reason, newValue) => {
      setParam(`J.emergency.playbook.${p.code}`, newValue ?? "", { action: `编辑应急剧本 ${p.code}(${p.name})`, reason });
      toast(`${p.code} 剧本变更已确认生效`);
    },
  });

  const drillPb = (p: Playbook) => openActionConfirm({
    action: `启动演练 · ${p.code} ${p.name}`,
    detail: <><b>演练执行</b>(非实战):走完 {p.seq.length} 步动作序列 · 每步原子动作在<b>沙箱环境</b>验证 · 实际不下发到生产 · 演练结果写 A2 · 通过则最近演练时间更新 · 剧本进入「演练就绪」。</>,
    run: (reason) => {
      setParam(`J.emergency.playbook.${p.code}.drill`, "drilling", { action: `启动演练 ${p.code}(${p.name})· 沙箱`, reason });
      toast(`${p.code} 演练已启动 · 沙箱执行`);
    },
  });

  // 注:执行剧本不传 amplifies —— B1 前置只挂「恢复放大流出」方向;应急执行是止血方向(熔断/封锁/暂停),
  // 覆盖率低于红线时恰恰最需要执行(SOP-02 对账缺口/SOP-03 挤兑),不可被 B1 禁放行锁死(对齐 J1「熔断方向不前置 B1」)。
  const execPb = (p: Playbook, isEmer: boolean) => openActionConfirm({
    action: `执行应急剧本 · ${p.code}${isEmer ? "(应急轨)" : "(常规轨)"}`,
    detail: (
      <>
        {isEmer
          ? <><b style={{ color: "var(--danger)" }}>应急快速轨</b> — 确认理由 SLA 压至 {slaMins} 分钟 · A2 标 emergency=true · 仅止血方向(熔断/封锁/暂停)。</>
          : <><b>常规操作确认逐步轨</b> — 每步在各域 操作确认 序列放行 · 标准 SLA。</>}
        <br />触发上下文:[人工选择 — 占位] · 后续 server 按动作序列逐步发起各域操作动态
        <span style={{ display: "block", marginTop: 4 }}>
          <b>动作序列({p.seq.length} 步)</b>:
          {p.seq.map((s, i) => (
            <span key={i} style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", display: "block", marginTop: 2 }}>
              {i + 1}. {s.dom} · {s.ax.replace(/\*\*/g, "")}{s.approve ? "(操作确认)" : ""}
            </span>
          ))}
        </span>
        <b>责任</b>:{p.owner} · <b>SLA</b>:{p.sla}
      </>
    ),
    run: (reason) => {
      setParam(`J.emergency.playbook.${p.code}.execute`, isEmer ? "emergency" : "regular", { action: `执行应急剧本 ${p.code}(${isEmer ? "应急轨 emergency=true" : "常规轨"})`, reason });
      toast(`${p.code} ${isEmer ? "应急执行 · A2 emergency=true" : "常规执行 · A2 留痕"}`);
    },
  });

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat"><div className="k">剧本库</div><div className="v">{PLAYBOOKS.length}</div><div className="sub">已发布 + 2 草稿</div></div>
        <div className="f-stat ok"><div className="k">演练就绪</div><div className="v">{ready}</div><div className="sub">近 90d 已演练</div></div>
        <div className="f-stat warn"><div className="k">待演练</div><div className="v">{todo}</div><div className="sub">超期 · 阻断「演练就绪」</div></div>
        <div className="f-stat danger"><div className="k">应急轨剧本</div><div className="v">{emerCount}</div><div className="sub">可走应急加急通道</div></div>
      </div>

      {/* SLA + 执行框架 */}
      <div className="top-side">
        <section className="sla-card">
          <div className="h">
            <span className="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg></span>
            <div><div className="t">应急加急规则(同 J1)</div><div className="s">· <AutoGloss>只用于关停/封锁等止血步 · 始终需确认理由审核</AutoGloss></div></div>
          </div>
          <div className="sla-kv"><span className="k">确认理由审核响应时限</span><span className="v warn">{slaMins} 分钟</span></div>
          <div className="sla-kv"><span className="k">最大升级总时限</span><span className="v warn">{escMins} 分钟</span></div>
          <div className="sla-kv"><span className="k">最大升级轮数</span><span className="v warn">{escRounds} 轮</span></div>
          <div className="sla-kv"><span className="k">超时升级通道</span><span className="v">紧急通知·全体超管</span></div>
          <div className="sla-kv"><span className="k">审计标记</span><span className="v danger">高亮·应急</span></div>
        </section>

        <section className="sla-card">
          <div className="h">
            <span className="ic b"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></span>
            <div><div className="t">执行方式(速度 与 确认的权衡)</div><div className="s">· <AutoGloss>两种轨并存 · 恢复方向恒走常规轨</AutoGloss></div></div>
          </div>
          <div className="sla-kv"><span className="k">常规逐步轨</span><span className="v">每步各理由校验核</span></div>
          <div className="sla-kv"><span className="k">应急快速轨</span><span className="v danger">确认理由 SLA 压至分钟</span></div>
          <div className="sla-kv"><span className="k">恢复 / 解封方向</span><span className="v ok">恒走常规轨</span></div>
          <div className="sla-kv"><span className="k">活性兜底</span><span className="v">升级链终止边界</span></div>
          <div className="sla-kv"><span className="k">绝不取消</span><span className="v danger">确认理由 / B1 前置核验</span></div>
        </section>
      </div>

      {/* 过滤 + 统计 */}
      <div className="pb-bar">
        <div className="seg">
          {PB_SCENES.map((s) => <button key={s} className={scene === s ? "on" : ""} onClick={() => setScene(s)}>{s}</button>)}
        </div>
        <div className="stats">
          <span>平均首步达成 <b>23 min</b></span>
          <span>近 90d 实战执行 <b>{liveExecs} 次</b></span>
          <span>近 90d 演练 <b>14 次</b></span>
        </div>
      </div>

      {/* 剧本库 grid */}
      <div className="pb-grid">
        {shown.map((p) => { const state = effDrillState(p); return (
          <div key={p.code} className={"pb-card" + (p.emer ? " emer" : "")}>
            <div className="pb-top">
              <span className="pb-code">{p.code}</span>
              <div style={{ flex: 1 }}>
                <div className="nm"><AutoGloss>{p.name}</AutoGloss></div>
                <div className="scene">触发场景:<b><AutoGloss>{p.scene}</AutoGloss></b> · {p.seq.length} 步原子动作</div>
              </div>
              <div className="r">
                {p.emer && <span className="emer-tag">EMERGENCY</span>}
                {state === "active" ? <span className="state active">有效</span> : <span className="state todo">待演练</span>}
              </div>
            </div>
            <div className="pb-seq">
              {p.seq.map((s, i) => (
                <div key={i} className={"step " + (DOM_CLS[s.dom] ?? "di")}>
                  <span className="dom">{s.dom}</span>
                  <div className="ax">{axRender(s.ax)}</div>
                  {s.approve ? <span className="approve req">操作确认</span> : <span className="approve">普通确认</span>}
                  {s.ref && <span className="approve ref">{s.ref}</span>}
                </div>
              ))}
            </div>
            <div className="pb-ft">
              <div className="meta">
                <div className="it"><span className="k">SLA</span><span className="v">{p.sla}</span></div>
                <div className="it"><span className="k">责任</span><span className="v"><AutoGloss>{p.owner}</AutoGloss></span></div>
                <div className="it"><span className="k">最近演练</span><span className={"v" + (state === "todo" ? " warn" : "")}>{pget(`J.emergency.playbook.${p.code}.drill`) === "drilling" ? "刚刚 · 沙箱" : p.lastDrill}</span></div>
              </div>
              <div className="acts">
                <button className="edit" onClick={() => editPb(p)}>编辑</button>
                <button className="drill" onClick={() => drillPb(p)}>演练</button>
                {p.emer
                  ? <button className="exec emer" onClick={() => execPb(p, true)}>应急执行</button>
                  : <button className="exec" onClick={() => execPb(p, false)}>执行</button>}
              </div>
            </div>
          </div>
        ); })}
      </div>

      {/* 执行追溯历史 */}
      <section className="exec-card">
        <div className="exec-h">
          <span className="ttl">执行追溯历史 · 合规取证</span>
          <span className="sub">· <AutoGloss>每条记录每步的最终状态 · 中途失败不回写</AutoGloss></span>
          <div className="r"><CodeTag tone="electric">A2 审计</CodeTag><CodeTag>执行记录已留痕</CodeTag></div>
        </div>
        <div className="exec-tblwrap"><div className="exec-tbl">
          <div className="hd">
            <div className="c">时间</div><div className="c">剧本</div><div className="c">触发上下文</div><div className="c">模式</div>
            <div className="c">步骤状态</div><div className="c">操作员 / 执行门槛</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作</div>
          </div>
          {EXECS.map((e) => (
            <div className="rw" key={e.ts + e.code}>
              <div className="c ts">{e.ts}</div>
              <div className="c pb"><span className="code">{e.code}</span><span className="nm"><AutoGloss>{e.name}</AutoGloss></span></div>
              <div className="c trig"><AutoGloss>{e.trig}</AutoGloss></div>
              <div className="c"><span className={"mode " + e.mode}>{e.mode.toUpperCase()}</span></div>
              <div className="c"><div className="steps">{e.steps.map((s, i) => <span key={i} className={"sdot " + s} title={s} />)}</div></div>
              <div className="c confirm-pair">
                <span><span className="role">操作员</span> {e.operator}</span>
                <span><span className="role">门槛</span> {e.roleGate}</span>
              </div>
              <div className="c acts"><button onClick={() => toast(`打开执行追溯详情 · ${e.code} · ${e.ts} · 含每步原子动作 A2 工单链`)}>查看追溯</button></div>
            </div>
          ))}
        </div></div>
      </section>

      <p className="f-foot"><b>每一步都会自动调用对应的处置面</b>(<AutoGloss>关停开关 / 地区封禁 / 风险披露更新 / 冻结账户 / 暂停提现 / 发通知</AutoGloss>),<AutoGloss>并在各自那里完成操作确认 · 本页</AutoGloss><b>不再追加一道确认</b>。<AutoGloss>应急加急只缩短填写理由的等待时间,</AutoGloss><b>绝不跳过确认理由</b>;<AutoGloss>编辑剧本本身也要按执行门槛填写理由并留痕。每次执行都留完整记录,并同步给风险评分和合规报表。</AutoGloss></p>
    </div>
  );
}
