"use client";

/**
 * F2 七层规则全空时的首次配置：入口、七层一张表填十四个数、确认框逐行核对、待审批和结果未知。
 * 提交调外壳的 ctx.bootstrapF2Unilevel（请求、保存原请求和恢复都在数据层）；这里只排界面和逐格提示。
 * 逐格的范围和格式照后端 OpsTeamService.unilevelBootstrapLayerRates：USDT 0–100、最多 4 位小数，
 * UVT 不小于 0、最多 6 位小数、整数最多 12 位；第 1 层固定 10%。不替运营填默认值，也不补 0。
 */
import Link from "next/link";
import { Clock3, Lock } from "lucide-react";
import { Button, Cell, Explain, Fact, Facts, Figure, Notice, NumberInput, ScaleBar, StatusTag, Table, Td, Th } from "@/app/components/rd";
import { f4Decimal } from "@/lib/admin/f4-money";
import { F2_BOOTSTRAP_SLOT } from "@/lib/admin/f2-approval";
import { F2BootstrapReview, F2_APP_LIMIT_COPY, F2_APP_TOTAL_LIMIT, f2DecimalTimes, f2PctSum, f2SampleUsdt, parseF2BootstrapAfter, type F2BootstrapRow } from "./f2-bootstrap-ticket";
import { LAYERS, LAYER_WHO, SAMPLE_ORDER, f2Ranked, num, pctAdd, pctSample, rangeText, rankedRange, stamp, type F2Confirm, type Layer } from "./f2-shared";
import type { FViewCtx } from "./types";

/** 填到一半的七层；checked 是点过「核对并提交审批」，之后没填的格也标出来。 */
export type F2BootstrapDraft = { cells: Record<Layer, { usdt: string; nex: string }>; checked: boolean };
export const emptyF2BootstrapDraft = (): F2BootstrapDraft => ({
  cells: { L1: { usdt: "10", nex: "" }, L2: { usdt: "", nex: "" }, L3: { usdt: "", nex: "" }, L4: { usdt: "", nex: "" }, L5: { usdt: "", nex: "" }, L6: { usdt: "", nex: "" }, L7: { usdt: "", nex: "" } },
  checked: false,
});

const BOOT_APPROVER = "另一位管理员";
const COVERAGE_CHECK = "批准时检查兑付覆盖率，低于红线不会执行。";

/** 一格的问题；没问题返回 undefined。百分号和千分位逗号照后端去掉再读。 */
function cellIssue(kind: "usdt" | "nex", raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return "请填写";
  const value = f4Decimal(text.replace(/[%,]/g, ""));
  if (value === null) return "请填数字";
  if (value.startsWith("-")) return "不能小于 0";
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "").length;
  if (kind === "usdt") {
    if (decimals > 4) return "最多 4 位小数";
    if (Number(whole) > 100 || Number(whole) === 100 && decimals > 0) return "不能超过 100%";
    return undefined;
  }
  if (decimals > 6) return "最多 6 位小数";
  if (whole.replace(/^0+/, "").length > 12) return "整数最多 12 位";
  return undefined;
}
/** 合法时的规范写法（去掉末尾 0），给合计和示例用；提交仍用运营填的原文。 */
const plain = (raw: string) => {
  const value = f4Decimal(raw.trim().replace(/[%,]/g, ""));
  return value === null ? null : value.includes(".") ? value.replace(/\.?0+$/, "") : value;
};

/** 这时首次配置的表单是不是开着：开着时它代替下面的规则表。 */
export function f2BootstrapFormShown(ctx: FViewCtx, draft: F2BootstrapDraft | null) {
  const original = ctx.f2ProposalRecord(F2_BOOTSTRAP_SLOT);
  return !!draft && !ctx.f2BootstrapPending && !(original && !original.ticket) && ctx.can("network_f2_royalty_rate");
}

export function F2Bootstrap({ ctx, openConfirm, draft, setDraft, cap }: {
  ctx: FViewCtx; openConfirm: (spec: F2Confirm) => void;
  draft: F2BootstrapDraft | null; setDraft: (next: F2BootstrapDraft | null) => void; cap: number | null;
}) {
  const canWrite = ctx.can("network_f2_royalty_rate");
  const canAudit = ctx.can("platform_a2_read");
  const pending = ctx.f2BootstrapPending;
  const original = ctx.f2ProposalRecord(F2_BOOTSTRAP_SLOT);
  const auditLink = canAudit ? <Link className="rd-link" href="/platform/audit" prefetch={false}>去操作记录与审批查看</Link> : undefined;

  if (pending) {
    const rows = parseF2BootstrapAfter(pending.after);
    return <div className="f2-boot">
      <Notice tone="warn" title={<>首次配置在等{BOOT_APPROVER}批准<StatusTag tone="warn" icon={Clock3}>待审批</StatusTag></>} action={auditLink}>
        <p>{pending.operator}{pending.mine ? "（你）" : ""} 提交于 {pending.rawTs ? stamp(pending.rawTs) : pending.ts} · 审批单 <span data-mono>{pending.id}</span></p>
        <p>批准前七层仍没有规则，也不能再提交首次配置。</p>
      </Notice>
      {rows ? <BootstrapGrid rows={rows} /> : <p className="f2-boot-note">七层各是多少，到「操作记录与审批」的这张单里看。</p>}
    </div>;
  }
  if (original && !original.ticket) return <Notice tone="warn" title="首次配置的申请还没有结论">先在页面上方查询原结果，有结论前不能再提交。</Notice>;
  if (!canWrite) return <Notice tone="warn" title="还没有配置团队购买奖励">首次配置需有「团队奖励比例」和「发起审批」权限，这个账号只能查看。</Notice>;
  if (!draft) return (
    <Notice tone="warn" title="还没有配置团队购买奖励"
      action={<Button variant="primary" disabledReason={ctx.f2WriteBlocked(F2_BOOTSTRAP_SLOT)} onClick={() => setDraft(emptyF2BootstrapDraft())}>首次配置</Button>}>
      一次填好七层，{BOOT_APPROVER}批准后生效；之后还要单独申请启用，才开始结算。
    </Notice>
  );
  return <BootstrapForm ctx={ctx} openConfirm={openConfirm} draft={draft} setDraft={setDraft} cap={cap} />;
}

/** 待审批时页面上的七层：横排一张，USDT 比例、UVT 系数各一行，最后一列合计。 */
function BootstrapGrid({ rows }: { rows: readonly F2BootstrapRow[] }) {
  return (
    <Table label="待批准的七层" className="f2-boot-grid">
      <thead><tr><Th>待批准的值</Th>{rows.map((row) => <Th key={row.layer} align="right">{row.layer}</Th>)}<Th align="right">七层合计</Th></tr></thead>
      <tbody>
        <tr><Td>USDT 比例</Td>{rows.map((row) => <Td key={row.layer} align="right">{num(row.usdtPct)}%</Td>)}<Td align="right"><strong>{num(f2PctSum(rows.map((row) => row.usdtPct)))}%</strong></Td></tr>
        <tr><Td>UVT 系数</Td>{rows.map((row) => <Td key={row.layer} align="right">{num(row.nexPerUsd)}</Td>)}<Td align="right">—</Td></tr>
      </tbody>
    </Table>
  );
}

function BootstrapForm({ ctx, openConfirm, draft, setDraft, cap }: {
  ctx: FViewCtx; openConfirm: (spec: F2Confirm) => void; draft: F2BootstrapDraft; setDraft: (next: F2BootstrapDraft | null) => void; cap: number | null;
}) {
  // 第 1、2 层按受益人等级时（F2-RANK-WIRE）：这两层不填比例，只读显示九级最低到最高；
  // 提交时这两层的基础比例按已定的做法固定写 0（生效后不起作用，后端仍要七行齐全）。
  const ranked = f2Ranked(ctx);
  const byRank = (level: Layer) => ranked && (level === "L1" || level === "L2");
  const issues = LAYERS.flatMap((level) => [
    ...(level === "L1" || byRank(level) ? [] : [{ level, kind: "usdt" as const, issue: cellIssue("usdt", draft.cells[level].usdt) }]),
    { level, kind: "nex" as const, issue: cellIssue("nex", draft.cells[level].nex) },
  ]).filter((cell) => cell.issue);
  const usdtPlain = LAYERS.map((level) => byRank(level) ? null : cellIssue("usdt", draft.cells[level].usdt) ? null : plain(draft.cells[level].usdt));
  const filledAll = LAYERS.every((level, index) => byRank(level) || usdtPlain[index] !== null);
  const sum = f2PctSum(usdtPlain.filter((value): value is string => value !== null));
  const sumNumber = Number(sum);
  // 按等级时合计是一段：已填的第 3 层起加上第 1、2 层九级最低、最高。
  const l1 = ranked ? rankedRange(ctx, "L1") : null, l2 = ranked ? rankedRange(ctx, "L2") : null;
  const sumRange = ranked && l1 && l2 ? { low: pctAdd(pctAdd(sum, l1.min), l2.min), high: pctAdd(pctAdd(sum, l1.max), l2.max) } : null;
  const shownHigh = ranked ? Number(sumRange?.high ?? sum) : sumNumber;
  // 刻度留到 40%，25% 的 App 线和末端的字不挤在一起。
  const axisMax = Math.max(40, Math.ceil(Math.max(shownHigh, cap ?? 0) / 10) * 10);
  const over = shownHigh > F2_APP_TOTAL_LIMIT;
  const change = (level: Layer, kind: "usdt" | "nex", value: string) => setDraft({ ...draft, cells: { ...draft.cells, [level]: { ...draft.cells[level], [kind]: value } } });
  const shown = (level: Layer, kind: "usdt" | "nex") => draft.checked || draft.cells[level][kind] !== "" ? cellIssue(kind, draft.cells[level][kind]) : undefined;

  const review = () => {
    if (issues.length) {
      setDraft({ ...draft, checked: true });
      document.getElementById(`f2-boot-${issues[0].level}-${issues[0].kind}`)?.focus();
      return;
    }
    const layers = LAYERS.map((level, index) => ({ layerNo: index + 1, usdtPct: byRank(level) ? "0" : level === "L1" ? "10" : draft.cells[level].usdt.trim(), nexPerUsd: draft.cells[level].nex.trim() }));
    const rows = LAYERS.map((level, index) => ({ layer: level, usdtPct: plain(layers[index].usdtPct)!, nexPerUsd: plain(layers[index].nexPerUsd)! }));
    openConfirm({
      slot: F2_BOOTSTRAP_SLOT,
      action: "首次配置 L1–L7 团队购买奖励", title: "首次配置团队购买奖励", briefKind: "config", amplify: true,
      effect: <StatusTag tone="progress" filled explain={`${BOOT_APPROVER}在「操作记录与审批」批准后，七层规则一次建好；结算要另外申请启用。`}>批准后生效</StatusTag>,
      facts: <Facts>
        <Fact k="要建立">L1–L7 七层规则</Fact>
        <Fact k="七层合计占订单">{ranked ? sumRange ? `${rangeText(sumRange.low, sumRange.high)}，示例 ${num(SAMPLE_ORDER)} USDT 订单分出 ${rangeText(pctSample(sumRange.low), pctSample(sumRange.high), "USDT")}` : "—"
          : `${num(sum)}%，示例 ${num(SAMPLE_ORDER)} USDT 订单分出 ${num(f2SampleUsdt(sum))} USDT`}</Fact>
        <Fact k="整体结算">不会自动启用，要另外申请</Fact>
      </Facts>,
      content: <div className="rd-stack">
        {over && <Notice tone="warn" title={`七层合计 ${num(sum)}%，超过 25%`}>{F2_APP_LIMIT_COPY}</Notice>}
        <F2BootstrapReview rows={rows} label="要建立的七层规则" />
      </div>,
      statedBrief: { impact: "批准后七层规则一次建好；整体结算不会自动启用，要另外申请。", check: ranked ? "逐层核对下表；第 1、2 层按受益人等级。" : "逐层核对下表；第 1 层固定 10%。" },
      detail: "七层都没有规则时才能首次配置，以前配置过的会被拒。",
      completionCopy: `批准人要是${BOOT_APPROVER}，需有审批批准权限和「团队奖励比例」权限；批准前七层仍没有规则。`,
      coverageCheck: COVERAGE_CHECK, coverageLead: "启用结算后，平台按这些比例付团队奖励",
      submit: async (reason) => { await ctx.bootstrapF2Unilevel(layers, reason); setDraft(null); },
      done: `首次配置已提交审批，等${BOOT_APPROVER}批准`,
    });
  };

  const header = (name: string, help: string) => <Th align="right"><span className="f2-boot-th">{name}<Explain label={`${name}怎么填`} content={help} /></span></Th>;
  return (
    <section className="f2-boot" aria-label="首次配置七层规则">
      <div className="f2-boot-head">
        {ranked ? <p className="f2-boot-title">首次配置七层规则<Explain label="首次配置怎么填" content="每格都要填，这一层不发就填 0；第 1、2 层的比例按受益人等级，在团队等级晋升设置，这里不填。" /></p>
          : <><p className="f2-boot-title">首次配置七层规则</p>
            <p className="f2-boot-note">每格都要填，这一层不发就填 0；第 1 层固定 10%。</p></>}
      </div>
      <Table label="首次配置七层规则" className="f2-boot-table">
        <thead><tr>
          <Th>哪一层</Th>
          {header("USDT 比例", `这一层分到订单金额的百分之几：填 5 就是 5%。0–100，最多 4 位小数。${ranked ? "第 1、2 层按受益人等级，不在这里填。" : ""}`)}
          {header("UVT 系数", "这一层每发 1 USDT 奖励，另发多少 UVT。不小于 0，最多 6 位小数。")}
          <Th align="right">示例 {num(SAMPLE_ORDER)} USDT 订单分到</Th>
        </tr></thead>
        <tbody>
          {LAYERS.map((level) => {
            const rng = byRank(level) ? rankedRange(ctx, level) : null;
            const usdt = byRank(level) ? null : level === "L1" ? "10" : plain(draft.cells[level].usdt) !== null && !cellIssue("usdt", draft.cells[level].usdt) ? plain(draft.cells[level].usdt) : null;
            const nex = !cellIssue("nex", draft.cells[level].nex) ? plain(draft.cells[level].nex) : null;
            const sample = usdt === null ? null : f2SampleUsdt(usdt);
            const sampleRange = rng ? { low: pctSample(rng.min), high: pctSample(rng.max) } : null;
            return <tr key={level}>
              <Td><span className="f2-layer"><span className="f2-layer-chip" data-direct={level === "L1" ? "" : undefined}>{level}</span>{LAYER_WHO[level]}</span></Td>
              <Td align="right">{byRank(level)
                ? <span className="f2-ranked"><strong>{rng ? rangeText(rng.min, rng.max) : "—"}</strong><span className="f2-ranked-sub">按受益人等级</span></span>
                : level === "L1" ? <span className="f2-boot-fixed"><strong>10%</strong><StatusTag tone="neutral" icon={Lock} explain="第 1 层 USDT 比例固定 10%，不接受别的值；提交时照样写进审批单。">固定</StatusTag></span>
                : <BootCell id={`f2-boot-${level}-usdt`} label={`${level} USDT 比例`} unit="%" value={draft.cells[level].usdt} issue={shown(level, "usdt")} onChange={(value) => change(level, "usdt", value)} />}</Td>
              <Td align="right"><BootCell id={`f2-boot-${level}-nex`} label={`${level} UVT 系数`} unit="UVT" value={draft.cells[level].nex} issue={shown(level, "nex")} onChange={(value) => change(level, "nex", value)} /></Td>
              <Td align="right">{sampleRange ? <Cell num main={rangeText(sampleRange.low, sampleRange.high, "USDT")} sub={nex === null ? "UVT 待填" : `另发 ${rangeText(f2DecimalTimes(sampleRange.low, nex), f2DecimalTimes(sampleRange.high, nex), "USDT").replace(/ USDT$/, "")} UVT`} />
                : sample === null ? <span className="f2-muted">—</span>
                : <Cell num main={`${num(sample)} USDT`} sub={nex === null ? "UVT 待填" : `另发 ${num(f2DecimalTimes(sample, nex))} UVT`} />}</Td>
            </tr>;
          })}
        </tbody>
      </Table>
      <Figure width={420} stack="wide" graphic={
        <div className="f2-sum-graphic">
          {ranked ? <ScaleBar label="七层合计占订单" max={axisMax} range={sumRange ? { low: Number(sumRange.low), high: Number(sumRange.high) } : undefined} target={cap ?? F2_APP_TOTAL_LIMIT} tone="role-4"
            ticks={[{ value: 0, text: "0%" }, { value: cap ?? F2_APP_TOTAL_LIMIT, text: `上限 ${num(cap ?? F2_APP_TOTAL_LIMIT)}%` }, { value: axisMax, text: `${axisMax}%` }]}
            valueText={sumRange ? `已填的层合计 ${rangeText(sumRange.low, sumRange.high)}` : "第 1、2 层的九级比例没读到，合计这次没有算"} />
          : <ScaleBar label="七层合计占订单" max={axisMax} value={sumNumber} fill tone={over ? "role-other" : "role-4"}
            ticks={[{ value: 0, text: "0%" }, { value: F2_APP_TOTAL_LIMIT, text: "App 上限 25%" }, ...(cap !== null && cap <= axisMax && cap !== F2_APP_TOTAL_LIMIT ? [{ value: cap, text: `总额上限 ${num(cap)}%` }] : []), { value: axisMax, text: `${axisMax}%` }]}
            valueText={`${filledAll ? "七层合计" : "已填的层合计"} ${num(sum)}%`} />}
          {ranked && <p className="f2-sum-cap">{`上限 ${num(cap ?? F2_APP_TOTAL_LIMIT)}%：${num(SAMPLE_ORDER)} USDT 订单最多分 ${num(f2SampleUsdt(String(cap ?? F2_APP_TOTAL_LIMIT)))} USDT`}<Explain label="上限怎么用" content="一笔订单七层 USDT 奖励最多占订单金额的这个比例，App 也按它显示。超出时从 L1 往下分，分完为止。" /></p>}
        </div>}>
        {ranked ? <dl className="f2-sum">
          <div><dt>{filledAll ? "七层合计" : "已填的层合计"}</dt>{sumRange ? <dd><strong>{rangeText(pctSample(sumRange.low), pctSample(sumRange.high), "USDT").replace(/ USDT$/, "")}</strong> USDT<span>占订单 {rangeText(sumRange.low, sumRange.high)}</span></dd> : <dd data-empty="">—</dd>}</div>
        </dl> : <dl className="f2-sum">
          <div><dt>{filledAll ? "七层合计" : "已填的层合计"}</dt><dd><strong>{num(sum)}%</strong><span>示例订单分出 {num(f2SampleUsdt(sum))} USDT</span></dd></div>
          <div><dt>奖励总额上限</dt><dd data-empty={cap === null ? "" : undefined}>{cap === null ? "未配置" : `${num(cap)}%`}</dd></div>
        </dl>}
      </Figure>
      {over && <Notice tone="warn" title={ranked ? `七层合计最高 ${num(sumRange?.high ?? sum)}%，超过 25%` : `七层合计 ${num(sum)}%，超过 25%`}>{F2_APP_LIMIT_COPY}</Notice>}
      <div className="rd-toolbar" data-end="">
        {draft.checked && issues.length > 0 && <span className="f2-boot-error" role="alert">还有 {issues.length} 格要改，已在表里标出</span>}
        <Button onClick={() => setDraft(null)}>取消</Button>
        <Button variant="primary" onClick={review}>核对并提交审批</Button>
      </div>
    </section>
  );
}

function BootCell({ id, label, unit, value, issue, onChange }: { id: string; label: string; unit: string; value: string; issue?: string; onChange: (value: string) => void }) {
  return <span className="f2-boot-cell">
    <NumberInput id={id} aria-label={label} unit={unit} min={0} value={value} placeholder="请填写"
      aria-invalid={issue ? true : undefined} aria-describedby={issue ? `${id}-issue` : undefined} onChange={(event) => onChange(event.target.value)} />
    {issue && <span id={`${id}-issue`} className="f2-boot-error">{issue}</span>}
  </span>;
}
