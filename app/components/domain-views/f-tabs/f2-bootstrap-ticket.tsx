/**
 * F2 首次配置的七层数怎么读、怎么列。审批单上的数是后端建单时用校验后的数写的「改后」
 * （AuditReplayBusinessPermissionGuard，b72c1c26）：「L1: usdtPct=10, nexPerUsd=0.5; L2: …」。
 * F2 待审批和 A2 列表、详情、批准框都从这里拆成七行，不在前端重算；格式对不上返回 undefined，页面照原文显示。
 */
import { Cell, Notice, Table, Td, Th } from "@/app/components/rd";
import { compareDecimal } from "@/lib/admin/f1-rank-benefit";
import { LAYERS, LAYER_WHO, SAMPLE_ORDER, num, pctAdd, pctSample, rangeText } from "./f2-shared";

/** 第 1、2 层按受益人等级时传九级最低、最高（百分数字符串）；读不到传 null；不传就按单一比例显示（A2 审批页照旧）。 */
export type F2RankedRange = { l1: { min: string; max: string }; l2: { min: string; max: string } } | null;

export type F2BootstrapRow = { layer: string; usdtPct: string; nexPerUsd: string };

const ROW = /^L([1-7]): usdtPct=(\d+(?:\.\d+)?), nexPerUsd=(\d+(?:\.\d+)?)$/;

export function parseF2BootstrapAfter(after: string | undefined): F2BootstrapRow[] | undefined {
  const parts = (after ?? "").split(";").map((part) => part.trim());
  if (parts.length !== 7) return undefined;
  const rows: F2BootstrapRow[] = [];
  for (const [index, part] of parts.entries()) {
    const match = ROW.exec(part);
    if (!match || Number(match[1]) !== index + 1) return undefined;
    rows.push({ layer: `L${match[1]}`, usdtPct: match[2], nexPerUsd: match[3] });
  }
  return rows;
}

/** The retained PC request writes zero placeholders for L1/L2. Fixed-rate requests require L1=10. */
export function f2BootstrapUsesRank(first: string | null | undefined, second: string | null | undefined) {
  return !!first && !!second && compareDecimal(first, "0") === 0 && compareDecimal(second, "0") === 0;
}

/** 两个不带符号的小数相乘，按整数算，不经浮点；去掉末尾 0。 */
export function f2DecimalTimes(a: string, b: string) {
  const [aWhole, aFraction = ""] = a.split(".");
  const [bWhole, bFraction = ""] = b.split(".");
  const scale = aFraction.length + bFraction.length;
  const digits = (BigInt(aWhole + aFraction) * BigInt(bWhole + bFraction)).toString().padStart(scale + 1, "0");
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return `${digits.slice(0, digits.length - scale)}${fraction ? `.${fraction}` : ""}`;
}

/** 七层 USDT 比例相加（最多 4 位小数，按整数单位算）。 */
export function f2PctSum(values: readonly string[]) {
  const units = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value.split(".");
    return sum + Number(whole) * 10000 + Number(fraction.padEnd(4, "0").slice(0, 4));
  }, 0);
  const fraction = String(units % 10000).padStart(4, "0").replace(/0+$/, "");
  return `${Math.floor(units / 10000)}${fraction ? `.${fraction}` : ""}`;
}

/** 示例订单里这一层分到的 USDT（订单 × 比例 ÷ 100）。 */
export const f2SampleUsdt = (pct: string) => f2DecimalTimes(pct, String(SAMPLE_ORDER / 100));

/** App 对七层原始配置的读取上限（commission-config-api.ts）。 */
export const F2_APP_TOTAL_LIMIT = 25;
export const F2_APP_LIMIT_COPY = "App 最多读到合计 25%，会读不到团队奖励配置。核对后仍可以提交。";
/** 七层原始比例合计超过 App 读取上限时的提示标题，合计数和上限数在正文或图上，不重复；partial = 还没填齐。 */
export function f2AppLimitIssue(pcts: readonly string[], partial = false) {
  return pcts.reduce((sum, pct) => sum + Number(pct), 0) > F2_APP_TOTAL_LIMIT + 0.000001
    ? `${partial ? "已填的" : "七层"}原始比例合计超过 App 读取上限` : undefined;
}

/** 七层逐行核对：确认框、A2 详情和批准框共用。只用 rd 组件，A2 页没有 F2 的样式表。 */
export function F2BootstrapReview({ rows, label = "七层规则", ranked, limitCopy = F2_APP_LIMIT_COPY }: { rows: readonly F2BootstrapRow[]; label?: string; ranked?: F2RankedRange; /** 合计超过 App 读取上限时的说明，发起和审批各自的说法。 */ limitCopy?: string }) {
  const byRank = ranked !== undefined;
  const limitIssue = f2AppLimitIssue(rows.map((row) => row.usdtPct));
  const others = f2PctSum(rows.filter((_, index) => !byRank || index > 1).map((row) => row.usdtPct));
  const total = byRank ? null : f2PctSum(rows.map((row) => row.usdtPct));
  const span = byRank && ranked ? { low: pctAdd(pctAdd(others, ranked.l1.min), ranked.l2.min), high: pctAdd(pctAdd(others, ranked.l1.max), ranked.l2.max) } : null;
  return <>
    {limitIssue && <Notice tone="warn" title={limitIssue}>{limitCopy}</Notice>}
    <Table label={label}>
      <thead><tr>
        <Th>哪一层</Th>
        <Th align="right">USDT 比例</Th>
        <Th align="right">UVT 系数</Th>
        <Th align="right">示例 {num(SAMPLE_ORDER)} USDT 订单分到</Th>
      </tr></thead>
      <tbody>
        {rows.map((row, index) => {
          const sample = f2SampleUsdt(row.usdtPct);
          const rng = byRank && index < 2 ? ranked ? (index === 0 ? ranked.l1 : ranked.l2) : null : undefined;
          if (rng !== undefined) {
            const lo = rng ? pctSample(rng.min) : null, hi = rng ? pctSample(rng.max) : null;
            return <tr key={row.layer}>
              <Td>{row.layer} {LAYER_WHO[LAYERS[index]]}</Td>
              <Td align="right"><span className="f2-ranked"><strong>{rng ? rangeText(rng.min, rng.max) : "区间未知"}</strong><span className="f2-ranked-sub">按受益人等级</span></span></Td>
              <Td align="right">{num(row.nexPerUsd)}</Td>
              <Td align="right">{lo && hi ? <Cell num main={rangeText(lo, hi, "USDT")} sub={`另发 ${rangeText(f2DecimalTimes(lo, row.nexPerUsd), f2DecimalTimes(hi, row.nexPerUsd), "USDT").replace(/ USDT$/, "")} UVT`} /> : "—"}</Td>
            </tr>;
          }
          return <tr key={row.layer}>
            <Td>{row.layer} {LAYER_WHO[LAYERS[index]]}</Td>
            <Td align="right"><strong>{num(row.usdtPct)}%</strong></Td>
            <Td align="right">{num(row.nexPerUsd)}</Td>
            <Td align="right"><Cell num main={`${num(sample)} USDT`} sub={`另发 ${num(f2DecimalTimes(sample, row.nexPerUsd))} UVT`} /></Td>
          </tr>;
        })}
        <tr>
          <Td><strong>七层合计</strong></Td>
          <Td align="right"><strong>{total !== null ? `${num(total)}%` : span ? rangeText(span.low, span.high) : "—"}</strong></Td>
          <Td align="right">—</Td>
          <Td align="right"><strong>{total !== null ? `${num(f2SampleUsdt(total))} USDT` : span ? rangeText(pctSample(span.low), pctSample(span.high), "USDT") : "—"}</strong></Td>
        </tr>
      </tbody>
    </Table>
  </>;
}
