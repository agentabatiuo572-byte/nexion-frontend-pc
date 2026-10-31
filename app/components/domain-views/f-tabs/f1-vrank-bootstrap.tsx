"use client";

import { useState } from "react";
import Link from "next/link";
import { bootstrapRankCodes, buildVRankBootstrap, emptyVRankBootstrap, type VRankBootstrapDraft } from "@/lib/admin/vrank-bootstrap";
import type { FViewCtx } from "./types";

const numericFields = [
  ["selfComputePoints", "自购算力点"], ["teamComputePoints", "团队算力点"],
  ["directRefs", "直接邀请人数"], ["requiredDownlineCount", "达标分支数"],
  ["leadershipVotes", "领导奖池票数"],
] as const;

export function F1VrankBootstrap({ ctx }: { ctx: FViewCtx }) {
  const [drafts, setDrafts] = useState(emptyVRankBootstrap);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const current = drafts[active];
  const change = (key: keyof VRankBootstrapDraft, value: string) => {
    setDrafts((rows) => rows.map((row, index) => index === active ? { ...row, [key]: value } : row));
    setError("");
  };
  const review = () => {
    try {
      const ranks = buildVRankBootstrap(drafts);
      ctx.openActionConfirm({ name: "首次配置会员等级", amplify: true,
        detail: "将创建完整的 V0–V8 晋升条件、团队奖励层数、同级奖比例和票数。另一位管理员审核后生效；晋升奖励请在等级建立后单独配置。",
        completionCopy: "首次配置需另一位管理员审核后生效。",
        run: async (reason) => {
          await ctx.proposeVRankBootstrap(ranks, reason);
          setSubmitted(true);
        },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "请核对等级配置";
      setError(message);
      const level = /^V([0-8]) ·/.exec(message);
      if (level) setActive(Number(level[1]));
    }
  };

  return <section className="ladder">
    <div className="ladder-h"><span className="ph-ttl">会员等级 · 首次配置</span></div>
    <div className="f1-bootstrap">
      <p className="ph-sub">尚未设置会员等级。请逐级填写 V0–V8，提交后由另一位管理员审核。没有门槛或比例的项目请明确填写 0。已提交的申请可在<Link href="/platform/audit">操作记录</Link>查看，请勿重复提交。</p>
      {submitted ? <div role="status">
        <p>首次配置已提交，请在操作记录中查看审批结果。</p>
        <Link className="f-cta" href="/platform/audit">查看操作记录</Link>{" "}
        <button type="button" className="f-cta" onClick={() => void ctx.refreshF1()}>刷新等级</button>
      </div> : !editing ? <button type="button" className="f-cta" onClick={() => setEditing(true)}>首次配置 V0–V8</button> : <>
        <div className="f1-bootstrap-levels" role="group" aria-label="选择要配置的等级">
          {bootstrapRankCodes.map((code, index) => <button type="button" key={code} className="f-cta"
            aria-pressed={active === index} onClick={() => setActive(index)}>{code}</button>)}
        </div>
        <fieldset className="f1-bootstrap-fields">
          <legend>{current.rankCode} 等级设置</legend>
          {([ ["titleCn", "中文头衔"], ["titleEn", "英文头衔"] ] as const).map(([key, label]) =>
            <label key={key}>{label}<input value={current[key]} maxLength={64} autoComplete="off"
              placeholder="请填写" onChange={(event) => change(key, event.target.value)} /></label>)}
          {numericFields.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="1"
            value={current[key]} placeholder="请填写" onChange={(event) => change(key, event.target.value)} /></label>)}
          <label>分支最低等级<select value={current.requiredDownlineRank} onChange={(event) => change("requiredDownlineRank", event.target.value)}>
            <option value="">不要求</option>{bootstrapRankCodes.slice(0, active).map((code) => <option key={code} value={code}>{code}</option>)}
          </select></label>
          <label>团队奖励层数<select value={current.unilevelDepth} onChange={(event) => change("unilevelDepth", event.target.value)}>
            <option value="" disabled>请选择</option><option value="0">不开通</option>
            {Array.from({ length: 7 }, (_, index) => <option key={index} value={`L1-L${index + 1}`}>{index + 1} 层</option>)}
          </select></label>
          <label>同级奖比例（%）<input type="number" min="0" max="100" step="0.01" value={current.peerBonusPercent}
            placeholder="请填写" onChange={(event) => change("peerBonusPercent", event.target.value)} /></label>
        </fieldset>
        <p className="ph-sub">达标分支须低于当前等级；V1–V8 至少填写一项正数晋升条件。晋升奖励在等级建立后使用现有奖励配置。</p>
        {error && <p role="alert" className="f1-bootstrap-error">{error}</p>}
        <div className="f1-bootstrap-actions">
          <button type="button" className="f-cta" disabled={active === 0} onClick={() => setActive(active - 1)}>上一级</button>
          {active < 8 && <button type="button" className="f-cta" onClick={() => setActive(active + 1)}>下一级</button>}
          <button type="button" className="f-cta" onClick={review}>核对并提交全部等级</button>
        </div>
      </>}
    </div>
  </section>;
}
