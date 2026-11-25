import { f4Decimal } from "./f4-money";
import { PAYOUT_VND_FIELDS, type PayoutVndWritableField } from "./payout-vnd-contract";

type Source = "D5" | "D7";
type Unit = "count" | "ratio" | "USDT" | "hours" | "days" | "USDT/UVT" | "boolean" | "%" | "minutes";
type Field = { label: string; unit: Unit; networks?: true; integer?: true };
type RawChange = { field: string; before: unknown; after: unknown; unit: Unit };

const D5_FIELDS: Record<string, Field> = {
  dailyLimitCount: { label: "每日提现次数", unit: "count", integer: true },
  balanceMaxRatio: { label: "余额可提上限", unit: "ratio" },
  minUsdt: { label: "最低提现额", unit: "USDT" },
  smallAmountThresholdUsd: { label: "小额免审线", unit: "USDT" },
  payoutSlaHours: { label: "到账时效", unit: "hours", integer: true },
  addressEffectiveDelayHours: { label: "新地址生效等待", unit: "hours", integer: true },
  addressChangeCooldownDays: { label: "地址再次更换间隔", unit: "days", integer: true },
  networkConfirmFeeUsd: { label: "网络确认费", unit: "USDT", networks: true },
  networkEnabled: { label: "提现网络", unit: "boolean", networks: true },
  networkFeeRatio: { label: "通用网络费率", unit: "ratio" },
  networkFeeMin: { label: "通用网络费下限", unit: "USDT" },
  networkFeeMax: { label: "通用网络费上限", unit: "USDT" },
  nexFeeOffsetRate: { label: "UVT 抵扣率", unit: "USDT/UVT" },
};
const D7_FIELDS: Record<string, Field> = Object.fromEntries(Object.entries(PAYOUT_VND_FIELDS).map(([key, field]) => [key, {
  label: field.label, unit: field.unit === "分钟" ? "minutes" : field.unit,
  ...("integer" in field ? { integer: true } : {}),
}]));
D7_FIELDS.forceInverted = { label: "倒挂价", unit: "boolean" };

const NETWORKS = ["trc20", "bep20", "erc20"] as const;
const DISPLAY_UNITS = { count: "次", USDT: "USDT", hours: "小时", days: "天", "USDT/UVT": "USDT / UVT", minutes: "分钟" };

export type WithdrawalProposalFact = { key: string; label: string; before: string; after: string };
export type WithdrawalProposalChanges = { facts: WithdrawalProposalFact[]; forced: boolean };
type Ticket = { before?: string; after?: string; withdrawalChanges?: WithdrawalProposalChanges | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function trimFraction(value: string) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function decimal(value: unknown, integer?: true): string | null {
  if (typeof value !== "string") return null;
  const exponent = /[eE]([+-]?\d+)$/.exec(value)?.[1];
  // The stored command is a TEXT column. Reject exponent expansion beyond that snapshot's size.
  if (exponent && Math.abs(Number(exponent)) > 65_535) return null;
  const plain = f4Decimal(value);
  if (plain === null || plain.startsWith("-")) return null;
  const canonical = trimFraction(plain);
  return integer && canonical.includes(".") ? null : canonical;
}

function readValue(field: Field, value: unknown): string | null {
  if (field.unit === "boolean") return typeof value === "boolean" ? String(value) : null;
  return decimal(value, field.integer);
}

function displayValue(source: Source, key: string, unit: Unit, value: string): string {
  if (unit === "boolean") return value === "true" ? "开启" : "关闭";
  if (key === "minUsdt" && value === "0") return "不限制";
  const exact = unit === "ratio" ? trimFraction(f4Decimal(`${value}e2`)!) : value;
  const [whole, fraction] = exact.split(".");
  const number = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
  if (unit === "ratio" || unit === "%") return `${number}%`;
  return `${number}${source === "D7" ? "\u00a0" : " "}${DISPLAY_UNITS[unit]}`;
}

/** A partial set would misstate the scope of the approval. A malformed snapshot invalidates all its facts. */
export function readWithdrawalProposalChanges(source: Source, input: unknown): WithdrawalProposalChanges | null {
  if (!Array.isArray(input) || !input.length) return null;
  const fields = source === "D5" ? D5_FIELDS : D7_FIELDS;
  const changes = new Map<string, { before: unknown; after: unknown }>();
  for (const item of input) {
    const row = asRecord(item);
    if (!row || typeof row.field !== "string" || !Object.hasOwn(fields, row.field) || changes.has(row.field)) return null;
    const { field, before, after } = row;
    const { unit } = fields[field];
    if (row.unit !== unit) return null;
    changes.set(field, { before, after });
  }

  const facts: WithdrawalProposalFact[] = [];
  let forced = false;
  for (const [key, field] of Object.entries(fields)) {
    const change = changes.get(key);
    if (!change) continue;
    if (key === "forceInverted") {
      if (change.before !== false || change.after !== true) return null;
      forced = true;
      continue;
    }
    const before = field.networks ? asRecord(change.before) : { [key]: change.before };
    const after = field.networks ? asRecord(change.after) : { [key]: change.after };
    const keys = field.networks ? NETWORKS : [key];
    if (!before || !after || Object.keys(before).length !== keys.length || Object.keys(after).length !== keys.length) return null;
    for (const part of keys) {
      const from = readValue(field, before[part]);
      const to = readValue(field, after[part]);
      if (from === null || to === null) return null;
      if (from === to) continue;
      facts.push({ key: field.networks ? `${key}.${part}` : key,
        label: field.networks ? `${part.toUpperCase()} ${field.label}` : field.label,
        before: displayValue(source, key, field.unit, from), after: displayValue(source, key, field.unit, to) });
    }
  }
  return facts.length ? { facts, forced } : null;
}

/** D5's legacy preview is a Java map string with two possible nested network maps. */
function legacyD5Values(text: string) {
  const body = /^\{(.+)\}$/.exec(text)?.[1];
  if (!body) return null;
  const fields = new Map<string, unknown>();
  for (const part of body.split(/, (?![^[]*\])/)) {
    const [, key, value] = /^(\w+)=([^=]+|\[.+\])$/.exec(part) ?? [];
    if (!key || !Object.hasOwn(D5_FIELDS, key) || fields.has(key)) return null;
    if (!D5_FIELDS[key].networks) {
      fields.set(key, value);
      continue;
    }
    const group = /^\[(.+)\]$/.exec(value)?.[1];
    if (!group) return null;
    const networks: Record<string, string | boolean> = {};
    for (const pair of group.split(", ")) {
      const [, name, raw] = /^(TRC20|BEP20|ERC20)=([^=]+)$/.exec(pair) ?? [];
      if (!name || Object.hasOwn(networks, name.toLowerCase())) return null;
      networks[name.toLowerCase()] = key === "networkEnabled" && (raw === "true" || raw === "false") ? raw === "true" : raw;
    }
    fields.set(key, networks);
  }
  return fields;
}

const D7_LEGACY_KEYS: Record<string, PayoutVndWritableField> = {
  spread: "sellSpreadPct", ttl: "quoteTtlMinWithdraw", tol: "requoteTolerancePct", rate: "feeRatePct",
  minFee: "feeMinUsd", maxFee: "feeMaxUsd", minAmt: "minAmountUsd", maxAmt: "maxAmountUsd",
};

function legacyD7Values(text: string) {
  const match = /^v\d+((?: [A-Za-z]+=-?\d+(?:\.\d+)?)+)( forceInverted)?$/.exec(text);
  if (!match) return null;
  const values = new Map<string, string>();
  for (const pair of match[1].trim().split(" ")) {
    const [name, value] = pair.split("=");
    if (!Object.hasOwn(D7_LEGACY_KEYS, name) || values.has(D7_LEGACY_KEYS[name])) return null;
    values.set(D7_LEGACY_KEYS[name], value);
  }
  return values.size === Object.keys(D7_LEGACY_KEYS).length ? { values, forced: !!match[2] } : null;
}

export function withdrawalProposalChanges(source: Source, ticket: Ticket): WithdrawalProposalChanges | null {
  if (ticket.withdrawalChanges !== undefined) return ticket.withdrawalChanges;
  if (!ticket.before || !ticket.after) return null;
  if (source === "D5") {
    const before = legacyD5Values(ticket.before);
    const after = legacyD5Values(ticket.after);
    if (!before || !after || before.size !== after.size || [...before.keys()].some(key => !after.has(key))) return null;
    return readWithdrawalProposalChanges(source, [...before].map(([field, value]) => ({
      field, before: value, after: after.get(field), unit: D5_FIELDS[field].unit,
    })));
  }
  const before = legacyD7Values(ticket.before);
  const after = legacyD7Values(ticket.after);
  if (!before || !after) return null;
  const changes: RawChange[] = [...before.values].map(([field, value]) => ({
    field, before: value, after: after.values.get(field), unit: D7_FIELDS[field].unit,
  }));
  if (after.forced) changes.push({ field: "forceInverted", before: false, after: true, unit: "boolean" });
  return readWithdrawalProposalChanges(source, changes);
}
