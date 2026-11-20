/**
 * F2 首次配置的七层数怎么读、怎么列。审批单上的数是后端建单时用校验后的数写的「改后」
 * （AuditReplayBusinessPermissionGuard，b72c1c26）：「L1: usdtPct=10, nexPerUsd=0.5; L2: …」。
 * F2 待审批和 A2 列表、详情、批准框都从这里拆成七行，不在前端重算；格式对不上返回 undefined，页面照原文显示。
 */
import { Cell, Table, Td, Th } from "@/app/components/rd";
import { LAYERS, LAYER_WHO, SAMPLE_ORDER, num } from "./f2-shared";

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

/** App 和 Lite 现在只接受七层合计不超过 25% 的配置（proto-app commission-config-api.ts:146、159–160）。 */
export const F2_APP_TOTAL_LIMIT = 25;
export const F2_APP_LIMIT_COPY = "App 目前只接受合计不超过 25% 的配置，超过会导致 App 读不出团队奖励配置。";

/** 七层逐行核对：确认框、A2 详情和批准框共用。只用 rd 组件，A2 页没有 F2 的样式表。 */
export function F2BootstrapReview({ rows, label = "七层规则" }: { rows: readonly F2BootstrapRow[]; label?: string }) {
  const total = f2PctSum(rows.map((row) => row.usdtPct));
  return (
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
          return <tr key={row.layer}>
            <Td>{row.layer} {LAYER_WHO[LAYERS[index]]}</Td>
            <Td align="right"><strong>{num(row.usdtPct)}%</strong></Td>
            <Td align="right">{num(row.nexPerUsd)}</Td>
            <Td align="right"><Cell num main={`${num(sample)} USDT`} sub={`另发 ${num(f2DecimalTimes(sample, row.nexPerUsd))} UVT`} /></Td>
          </tr>;
        })}
        <tr>
          <Td><strong>七层合计</strong></Td>
          <Td align="right"><strong>{num(total)}%</strong></Td>
          <Td align="right">—</Td>
          <Td align="right"><strong>{num(f2SampleUsdt(total))} USDT</strong></Td>
        </tr>
      </tbody>
    </Table>
  );
}
