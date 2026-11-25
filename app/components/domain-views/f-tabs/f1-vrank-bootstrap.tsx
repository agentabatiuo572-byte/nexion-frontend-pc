"use client";

/**
 * F1 还没有等级时的首次配置：一级一级填 V0–V8，最后一起提交审批；批准前页面仍是空的。
 * 草稿、校验（buildVRankBootstrap）、提交（ctx.proposeVRankBootstrap）和旧页面一样，只换样子。
 */
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Layers3, ListChecks, RefreshCw } from "lucide-react";
import { Button, Conclusion, Fact, Facts, Field, Input, Notice, Panel, Select, StatusTag, Table, Td, Th } from "@/app/components/rd";
import { bootstrapRankCodes, buildVRankBootstrap, emptyVRankBootstrap, type VRankBootstrapDraft } from "@/lib/admin/vrank-bootstrap";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import type { FViewCtx } from "./types";
import { SUPER_APPROVER, type F1Confirm } from "./f1-shared";

const NUMBERS = [
  ["teamComputePoints", "团队算力点", "点"], ["selfComputePoints", "自购算力点", "点"],
  ["directRefs", "一二级已购人数", "人"], ["requiredDownlineCount", "下级领导者人数", "个"],
  ["leadershipVotes", "团队激励池票数", "票"],
] as const;
const REQUIRED: (keyof VRankBootstrapDraft)[] = ["titleCn", "titleEn", "selfComputePoints", "directRefs", "teamComputePoints", "requiredDownlineCount", "unilevelDepth", "peerBonusPercent", "leadershipVotes"];
const filled = (draft: VRankBootstrapDraft) => REQUIRED.every((key) => draft[key].trim() !== "");
const depthLabel = (value: string) => value === "0" ? "不开通" : value.replace("-", "–");

export function F1VrankBootstrap({ ctx, openConfirm, continuation }: { ctx: FViewCtx; openConfirm: (confirm: F1Confirm) => void; continuation?: { original: FDomainAttempt; drafts: VRankBootstrapDraft[] } }) {
  const [drafts, setDrafts] = useState(() => continuation?.drafts ?? emptyVRankBootstrap());
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(!!continuation);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const current = drafts[active];
  const change = (key: keyof VRankBootstrapDraft, value: string) => {
    setDrafts((rows) => rows.map((row, index) => index === active ? { ...row, [key]: value } : row));
    setError("");
  };
  const done = drafts.filter(filled).length;
  const review = () => {
    try {
      const ranks = buildVRankBootstrap(drafts);
      openConfirm({
        draft: continuation?.original,
        proposalSlot: "f-vrank-bootstrap:current",
        action: "首次配置会员等级", title: "首次配置会员等级", briefKind: "config", amplify: true, confirmLabel: "提交审批",
        effect: <StatusTag tone="progress" filled explain={`${SUPER_APPROVER}在「操作记录与审批」批准后，九级一次建好；批准前这页仍是空的。`}>批准后生效</StatusTag>,
        coverageLead: "首次配置会让以后的晋升按这些条件发生",
        coverageCheck: "首次配置不带奖励；以后给各级加资金奖励时再单独检查兑付覆盖率。",
        facts: <Facts><Fact k="要建立">V0–V8 共 9 级</Fact><Fact k="升级奖励">不在这里配；等级建立后逐级添加</Fact></Facts>,
        content: <div className="rd-impact">
          <div className="rd-impact-title">九级的晋升条件</div>
          <Table label="九级的晋升条件">
            <thead><tr><Th>等级</Th><Th>头衔</Th><Th align="right">团队算力点</Th><Th align="right">自购算力点</Th><Th align="right">一二级已购</Th><Th>下级领导者</Th><Th align="right">票数</Th></tr></thead>
            <tbody>{ranks.map((rank) => <tr key={rank.rankCode}>
              <Td>{rank.rankCode}</Td><Td>{rank.titleCn}</Td>
              <Td align="right">{rank.teamComputePoints.toLocaleString("en-US")}</Td><Td align="right">{rank.selfComputePoints.toLocaleString("en-US")}</Td>
              <Td align="right">{rank.directRefs.toLocaleString("en-US")}</Td>
              <Td>{rank.requiredDownlineCount === 0 ? "不要求" : `${rank.requiredDownlineCount} 个 ${rank.requiredDownlineRank}+`}</Td>
              <Td align="right">{rank.leadershipVotes.toLocaleString("en-US")}</Td>
            </tr>)}</tbody>
          </Table>
        </div>,
        statedBrief: { impact: "批准后一次建好 V0–V8 九级的晋升条件、团队购买奖励范围、同级奖比例和票数；只在等级和奖励两张表都是空的时候能建，已经有任何一级就会被拒。", check: "逐级核对上表；升级奖励等等级建好后再加。" },
        detail: "将创建完整的 V0–V8 晋升条件、团队购买奖励范围、同级奖比例和票数。另一位超级管理员批准后生效；晋升奖励请在等级建立后单独配置。",
        submit: async (reason) => {
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

  const auditLink = <Link className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>;
  if (submitted) return <>
    <Conclusion state="neutral" icon={Layers3}>首次配置已提交审批，批准前这里仍是空的</Conclusion>
    <Panel title="首次配置" icon={ListChecks} tone="role-4">
      <Notice tone="warn" title="等另一位超级管理员批准" actionBelow action={<>
        <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={ctx.f1Loading} onClick={() => void ctx.refreshF1()}>刷新等级</Button>
        {auditLink}
      </>}>
        <p>批准后九级一次建好，点「刷新等级」就能看到。进度在「操作记录与审批」里看；不要重复提交。</p>
      </Notice>
    </Panel>
  </>;

  return <>
    <Conclusion state="neutral" icon={Layers3} hint="逐级填好 V0–V8，最后一起提交审批。">还没有建立会员等级</Conclusion>
    <Panel title="首次配置会员等级" icon={ListChecks} tone="role-4" sub={editing ? `已填 ${done}/9 级` : undefined}
      explain="九级要一次建好，另一位超级管理员批准后才出现。没有门槛或比例的项填 0；V1–V8 每级至少一项晋升条件大于 0。升级奖励在等级建好后逐级添加。已经提交过的申请在「操作记录与审批」里看，不要重复提交。">
      {!editing ? <div className="f1-boot-start">
        <ol className="f1-boot-preview" aria-label="要建立的九级">{bootstrapRankCodes.map((code) => <li key={code}>{code}</li>)}</ol>
        <p>填完九级后一起提交审批。</p>
        <p>已提交的申请看 {auditLink}</p>
        <Button variant="primary" onClick={() => setEditing(true)}>首次配置 V0–V8</Button>
      </div> : <>
        <div className="f1-boot-steps" role="group" aria-label="选择要配置的等级">
          {bootstrapRankCodes.map((code, index) => {
            const ok = filled(drafts[index]);
            const Icon = ok ? CheckCircle2 : Circle;
            return <button type="button" key={code} className="f1-boot-step" aria-pressed={active === index} data-done={ok ? "" : undefined}
              aria-label={`${code}${ok ? "，已填完" : "，没填完"}`} onClick={() => setActive(index)}>
              <Icon size={14} aria-hidden />{code}
            </button>;
          })}
        </div>
        {error && <Notice tone="warn">{error}</Notice>}
        <fieldset className="f1-boot-form">
          <legend>{current.rankCode} 的设置</legend>
          <div className="rd-form-grid" data-cols="2" data-dense="">
            <Field label="中文头衔" required hint="1–64 字"><Input value={current.titleCn} maxLength={64} autoComplete="off" placeholder="请填写" onChange={(event) => change("titleCn", event.target.value)} /></Field>
            <Field label="英文头衔" required hint="1–64 字"><Input value={current.titleEn} maxLength={64} autoComplete="off" placeholder="请填写" onChange={(event) => change("titleEn", event.target.value)} /></Field>
            {NUMBERS.map(([key, label, unit]) => (
              <Field key={key} label={label} required hint={`整数，没有填 0 · ${unit}`}>
                <Input inputMode="numeric" value={current[key]} placeholder="请填写" onChange={(event) => change(key, event.target.value)} />
              </Field>
            ))}
            <Field label="下级领导者最低等级" hint={current.rankCode === "V0" ? "V0 没有更低的等级" : "低于本级"}>
              {(control) => <Select {...control} aria-label="下级领导者最低等级" value={current.requiredDownlineRank} onChange={(value) => change("requiredDownlineRank", value)}
                options={[{ value: "", label: "不要求" }, ...bootstrapRankCodes.slice(0, active).map((code) => ({ value: code, label: code }))]} />}
            </Field>
            <Field label="团队购买奖励范围" required>
              {(control) => <Select {...control} aria-label="团队购买奖励范围" value={current.unilevelDepth} placeholder="请选择" onChange={(value) => change("unilevelDepth", value)}
                options={[{ value: "0", label: "不开通" }, ...Array.from({ length: 7 }, (_, index) => ({ value: `L1-L${index + 1}`, label: depthLabel(`L1-L${index + 1}`) }))]} />}
            </Field>
            <Field label="同级奖比例" required hint="0–100，最多两位小数 · %">
              <Input inputMode="decimal" value={current.peerBonusPercent} placeholder="请填写" onChange={(event) => change("peerBonusPercent", event.target.value)} />
            </Field>
          </div>
        </fieldset>
        <div className="rd-toolbar" data-end="">
          <span className="rd-toolbar-note">下级领导者人数大于 0 时要选最低等级；为 0 时选「不要求」。</span>
          <Button icon={<ChevronLeft size={14} aria-hidden />} disabledReason={active === 0 ? "已经是第一级" : undefined} onClick={() => setActive(active - 1)}>上一级</Button>
          {active < 8 && <Button icon={<ChevronRight size={14} aria-hidden />} onClick={() => setActive(active + 1)}>下一级</Button>}
          <Button variant="primary" onClick={review}>核对并提交全部等级</Button>
        </div>
      </>}
    </Panel>
  </>;
}
