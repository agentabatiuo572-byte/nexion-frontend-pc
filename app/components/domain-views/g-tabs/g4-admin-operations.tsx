"use client";

/**
 * G4 认购、预售与持有人规则（十五项配置）和模拟成交演练（改版，RdPage）。
 * 读取、写入、回执校验沿用原实现，本文件只换界面；确认框由页面（g4-genesis）统一开。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Archive, FlaskConical, ShieldCheck } from "lucide-react";
import {
  BlockState, Button, Cell, ConfigList, KeepText, ConfigRow, Fact, Facts, Field, Fold, Input, Notice, Panel, Select, StatusTag, Table, TableMessage, Td, Th,
} from "@/app/components/rd";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  archiveG4AdminSimulation,
  createG4AdminSimulation,
  fetchG4AdminOperations,
  updateG4AdminOperationConfig,
  type G4AdminOperationsOverview,
} from "@/lib/admin/g4-client";
import { listG4DirectCommands, g4DirectObject } from "@/lib/admin/g4-direct-command";
import type { ActionConfirmReq } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { g4Amount } from "./g4-recovery";

/** 本页的确认框请求：在共用的 ActionConfirmReq 上只加显示用的字段，提交仍走 run。 */
export type G4ConfirmReq = ActionConfirmReq & {
  directObject?: string;
  title?: ReactNode;
  effect?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  statedBrief?: { impact: string; check: string };
  confirmLabel?: string;
  confirmLabelForValue?: (value?: string) => string;
  confirmTone?: "primary" | "danger";
  coverageLead?: ReactNode;
  coverageCheck?: string;
  reasonPlaceholder?: string;
};
export type G4Ctx = { toast: (message: string) => void; openActionConfirm: Dispatch<SetStateAction<G4ConfirmReq | null>> };

const configValueText = (kind: string, value: unknown): string => value == null || value === "" ? "未配置" : kind === "select" ? value === true || value === "true" ? "已开启" : value === false || value === "false" ? "已关闭" : "状态未知" : String(value);
/** 页面上的写法：数字去掉补的 0、加千分位，金额至少两位小数；UTC 时间写成「2026-08-17 00:00 UTC」。不改存值。 */
function configShown(key: string, kind: string, value: unknown, unit?: string) {
  const text = configValueText(kind, value);
  if (value == null || value === "" || kind === "select") return text;
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(text);
  if (iso) return `${iso[1]} ${iso[2]} UTC`;
  if (kind !== "number") return text;
  const shown = unit === "USDT" ? g4Amount(text) : g4Count(text);
  return unit ? `${shown} ${unit}` : shown;
}
/** 数量：去掉补的 0、加千分位，不补小数位。 */
export function g4Count(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${match[1]}${BigInt(match[2]).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
const sideText = (value: string) => value === "BUY" ? "模拟买入" : value === "SELL" ? "模拟卖出" : "方向未知";
export const G4_CONFIGS = [
  { key: "eligibility.enabled", label: "启用购买资格限制", kind: "select", options: ["true", "false"] },
  { key: "eligibility.maxPerUser", label: "每人最多认购", kind: "number" },
  { key: "eligibility.minAccountAgeDays", label: "最少注册天数", kind: "number" },
  { key: "presale.enabled", label: "开启预售", kind: "select", options: ["true", "false"] },
  { key: "presale.showCountdown", label: "显示倒计时", kind: "select", options: ["true", "false"] },
  { key: "presale.unitPrice", label: "预售单价", kind: "number" },
  { key: "presale.maxPerUser", label: "预售每人上限", kind: "number" },
  { key: "presale.startAt", label: "预售开始时间（UTC）", kind: "text" },
  { key: "presale.endAt", label: "预售结束时间（UTC）", kind: "text" },
  { key: "holder.allocationNexPerHolding", label: "每个节点给持有人预留的 UVT", kind: "number" },
  { key: "holder.priorityTop1Percent", label: "前 1% 持有人门槛", kind: "number" },
  { key: "holder.priorityTop3Percent", label: "前 3% 持有人门槛", kind: "number" },
  { key: "holder.priorityTop5Percent", label: "前 5% 持有人门槛", kind: "number" },
  { key: "holder.policyVersion", label: "持有人规则版本", kind: "text" },
  { key: "holder.effectiveAt", label: "持有人规则生效时间（UTC）", kind: "text" },
] as const;

/** 只用于显示：每项是什么、怎么填、改了会怎样（后端 OpsGenesisSimulationService / AppGenesisService 现行行为）。 */
const CONFIG_HELP: Record<string, { what: string; hint?: string; unit?: string; effect: string; note?: string }> = {
  "eligibility.enabled": { what: "开了才按「每人最多认购」和「最少注册天数」限制购买", effect: "关着时这两项不限制；预售每人上限照常限制" },
  "eligibility.maxPerUser": { what: "开了资格限制时，每人最多同时持有几个节点（持有中和挂售中都算）", hint: "0–1,000,000 的整数", unit: "个", effect: "按持有数算，不是按单笔订单数；不回写已下的订单" },
  "eligibility.minAccountAgeDays": { what: "开了资格限制时，账号注册满几天才能买", hint: "0–1,000,000 的整数", unit: "天", effect: "下一次购买时按这个天数检查" },
  "presale.enabled": { what: "开了以后，在预售开始和结束时间之间按预售规则卖", effect: "开启前要先填好开始和结束时间；开了也只在时间窗里生效，不等于提交后马上能买" },
  "presale.showCountdown": { what: "App 上显示不显示预售倒计时", effect: "暂未开放或暂停时 App 本来就不显示" },
  "presale.unitPrice": { what: "预售规则里写的单价", hint: "最多 6 位小数", unit: "USDT", effect: "目前只作为预售规则展示，实际认购价仍按价格档位（后端现行行为）；填 0 时 App 的预售规则显示不可用", note: "改它不会改变用户实际付的价格。" },
  "presale.maxPerUser": { what: "预售期间每人最多买几个", hint: "0–1,000,000 的整数", unit: "个", effect: "和资格的每人上限取较小的那个；不回写已下的订单" },
  "presale.startAt": { what: "预售从什么时候开始（UTC）", hint: "例如 2026-08-01T00:00:00Z", effect: "要早于结束时间；另一端还没填时可以先单独保存" },
  "presale.endAt": { what: "预售到什么时候结束（UTC，不含这一刻）", hint: "例如 2026-08-31T00:00:00Z", effect: "要晚于开始时间；另一端还没填时可以先单独保存" },
  "holder.allocationNexPerHolding": { what: "每个节点给持有人预留多少 UVT", hint: "最多 6 位小数", unit: "UVT", effect: "只改预留规则，不铸币、不入账；填 0 时 App 的持有人权益显示不可用" },
  "holder.priorityTop1Percent": { what: "持有排名前多少算「前 1%」的门槛", hint: "1–100 的整数", effect: "后端不检查前 1%、3%、5% 的大小顺序；顺序不对时 App 的持有人权益显示不可用" },
  "holder.priorityTop3Percent": { what: "持有排名前多少算「前 3%」的门槛", hint: "1–100 的整数", effect: "后端不检查前 1%、3%、5% 的大小顺序；顺序不对时 App 的持有人权益显示不可用" },
  "holder.priorityTop5Percent": { what: "持有排名前多少算「前 5%」的门槛", hint: "1–100 的整数", effect: "后端不检查前 1%、3%、5% 的大小顺序；顺序不对时 App 的持有人权益显示不可用" },
  "holder.policyVersion": { what: "持有人规则的版本号", effect: "只改版本号，不迁移历史数据" },
  "holder.effectiveAt": { what: "持有人规则从什么时候起生效（UTC）；还没到时 App 显示规则未生效", hint: "例如 2026-08-01T00:00:00Z", effect: "只保存时间，不另排定时任务" },
};

/** 原操作提醒里写一项认购设置的值：和页面同一种写法（带单位、开关写已开启／已关闭、UTC 时间）。 */
export function g4ConfigValueShown(key: string, value: unknown) {
  const definition = G4_CONFIGS.find((row) => row.key === key);
  return definition ? configShown(key, definition.kind, value, CONFIG_HELP[key]?.unit) : String(value ?? "—");
}

const GROUPS: { key: string; title: string; explain: string; keys: readonly string[] }[] = [
  { key: "eligibility", title: "购买资格", explain: "资格只看这三项。以前的入金、旗舰设备、V 等级、邀请码条件已停用；设备商城的购买条件在另一个页面，不受影响。国家、地区限制、预售时间和市场开关另外限制购买。", keys: ["eligibility.enabled", "eligibility.maxPerUser", "eligibility.minAccountAgeDays"] },
  { key: "presale", title: "预售", explain: "开始和结束时间可以分两次保存；开启预售时两端都要有效，后端在保存「开启预售」时检查。", keys: ["presale.enabled", "presale.showCountdown", "presale.unitPrice", "presale.maxPerUser", "presale.startAt", "presale.endAt"] },
  { key: "holder", title: "持有人规则", explain: "可以分步配置：某一步保存后 App 的持有人权益可能暂时显示不可用（预留为 0、门槛顺序不对、生效时间没到），后端在 App 读取时检查，不在保存时拦。", keys: ["holder.allocationNexPerHolding", "holder.priorityTop1Percent", "holder.priorityTop3Percent", "holder.priorityTop5Percent", "holder.policyVersion", "holder.effectiveAt"] },
];

export default function G4AdminOperations({ ctx, refreshVersion = 0, blocked = false }: { ctx: G4Ctx; refreshVersion?: number; blocked?: boolean }) {
  const session = useAdminAuth((state) => state.session);
  const canWrite = session?.role === "superadmin" || !!session?.authorities.includes("finprod_g4_write");
  const [data, setData] = useState<G4AdminOperationsOverview | null>(null);
  const [error, setError] = useState("");
  const [readFailed, setReadFailed] = useState(true);
  const latest = useRef({ data, readFailed, blocked });
  latest.current = { data, readFailed, blocked };
  const ensureNew = () => {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session?.adminId
      || !auth.session?.authorities.includes("finprod_g4_write") || latest.current.blocked || latest.current.readFailed || !latest.current.data) {
      throw new Error("当前设置暂不能修改，请重新读取当前状态并核对权限。 ");
    }
  };
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("1000");

  const load = useCallback(async () => {
    setReadFailed(true);
    try { setData(await fetchG4AdminOperations()); setReadFailed(false); setError(""); }
    catch (cause) { setError(displayAdminError(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshVersion]);

  const edit = (definition: (typeof G4_CONFIGS)[number]) => {
    const configured = data?.config[definition.key];
    const current = configured ?? (definition.kind === "select" ? "false" : "");
    // Missing rows use the backend's empty-string CAS baseline. This keeps a
    // damaged/pre-migration database recoverable from G4 instead of turning the
    // display fallback "false" into an unavoidable first-write conflict.
    const expectedValue = configured == null ? "" : String(configured);
    const help = CONFIG_HELP[definition.key];
    const currentShown = configShown(definition.key, definition.kind, configured, help?.unit);
    ctx.openActionConfirm({ briefKind: "config", directObject: `operations/config/${encodeURIComponent(definition.key)}`,
      action: `修改创世认购设置 · ${definition.label}`,
      title: `调整${definition.label}`,
      detail: definition.kind === "text" && /At$/.test(definition.key) ? "只改设置，不会产生用户资产或成交。时间请按 UTC 填写（例如 2026-08-01T00:00:00Z），开始时间要早于结束时间。" : "只改设置，不会产生用户资产或成交。",
      effect: <StatusTag tone="progress" filled explain="确认后立即保存，不走审批。App 下次读取时用新设置，已打开的 App 页面不会自动刷新。">立即生效</StatusTag>,
      confirmLabel: "确认修改",
      facts: <Facts>
        <Fact k="改的是">{definition.label}</Fact>
        {/* 开关读到「已开启 / 已关闭」时，下面「现在 → 改后」已写着；没配置或读不懂时只有这里写得出来。 */}
        {definition.kind !== "number" && !(definition.kind === "select" && ["已开启", "已关闭"].includes(currentShown)) && <Fact k="现在">{currentShown}</Fact>}
        <Fact k="改了会怎样"><KeepText text={help?.effect ?? "—"} /></Fact>
        <Fact k="付不付钱">不付钱；只改设置，不产生用户资产或成交</Fact>
      </Facts>,
      statedBrief: { impact: "确认后立即保存，App 下次读取时用新设置。", check: "核对新值；时间按 UTC 填写；理由写清依据或工单号。" },
      amplifies: false,
      edit: definition.kind === "select"
        ? { kind: "select", current: String(current), options: [...(definition.options ?? [])], optionLabels: { true: "已开启", false: "已关闭" } }
        : definition.kind === "number"
          ? { kind: "number", current: String(current), min: 0, unit: help?.unit, hint: help?.hint }
          : { kind: "text", current: String(current), hint: help?.hint },
      run: async (reason, value) => {
        ensureNew();
        if (String(latest.current.data!.config[definition.key] ?? "") !== expectedValue) throw new Error("这项设置已变化，请关闭后按当前值重新操作。");
        if (value == null || value === "") return;
        let normalized = value;
        if (definition.key === "presale.startAt" || definition.key === "presale.endAt" || definition.key === "holder.effectiveAt") {
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
            throw new Error("请按 UTC 填写时间，例如 2026-08-01T00:00:00Z");
          }
          normalized = new Date(value).toISOString();
          if (definition.key === "presale.startAt" || definition.key === "presale.endAt") {
            const otherKey = definition.key === "presale.startAt" ? "presale.endAt" : "presale.startAt";
            const other = data?.config[otherKey];
            if (other) {
              const start = definition.key === "presale.startAt" ? normalized : String(other);
              const end = definition.key === "presale.endAt" ? normalized : String(other);
              if (Date.parse(start) >= Date.parse(end)) throw new Error("预售开始时间必须早于结束时间");
            }
          }
        }
        await updateG4AdminOperationConfig(
          definition.key,
          normalized,
          reason,
          currentAdminOperator(),
          expectedValue,
        );
        await load();
        ctx.toast(`${definition.label} 已更新`);
      },
    });
  };

  const createSimulation = () => ctx.openActionConfirm({ briefKind: "record", directObject: "operations/simulations",
    action: "创建模拟成交",
    title: "创建模拟成交",
    detail: `创建 ${sideText(side)} ${quantity} × ${unitPrice} 的模拟记录。只用于后台演练，不影响钱包、账本、真实成交和市场统计，用户也看不到。`,
    effect: <StatusTag tone="neutral" icon={FlaskConical}>只在后台 · 不动真实数据</StatusTag>,
    confirmLabel: "确认创建",
    facts: <Facts>
      <Fact k="方向">{sideText(side)}</Fact>
      <Fact k="数量">{quantity}</Fact>
      <Fact k="单价">{unitPrice}</Fact>
      <Fact k="不影响">钱包、资金账本、真实成交、地板价和持有人等统计；用户看不到</Fact>
    </Facts>,
    statedBrief: { impact: "只新建一条标记为模拟的后台记录。", check: "核对方向、数量和单价，理由写清演练目的。" },
    amplifies: false,
    run: async (reason) => {
      ensureNew();
      await createG4AdminSimulation(side, quantity, unitPrice, reason, currentAdminOperator());
      await load();
      ctx.toast("模拟成交已创建");
    },
  });

  const archive = (id: number, no: string) => ctx.openActionConfirm({ briefKind: "record", directObject: `operations/simulations/${id}`,
    action: `归档模拟成交 · ${no}`,
    title: "归档模拟成交",
    detail: "只归档这条模拟记录，不影响真实市场、资产和统计。",
    effect: <StatusTag tone="neutral" icon={Archive}>只改这条模拟记录</StatusTag>,
    confirmLabel: "确认归档",
    facts: <Facts>
      <Fact k="记录"><span data-mono>{no}</span></Fact>
      <Fact k="归档以后">从列表里移走，操作记录保留；没有撤销归档的入口</Fact>
      <Fact k="不影响">真实市场、资产和统计</Fact>
    </Facts>,
    statedBrief: { impact: "这条模拟记录不再显示。", check: "核对记录编号，理由写清为什么归档。" },
    amplifies: false,
    run: async (reason) => {
      ensureNew();
      await archiveG4AdminSimulation(id, reason, currentAdminOperator());
      await load();
      ctx.toast(`${no} 已归档`);
    },
  });

  if (!data) {
    return error
      ? <BlockState state="error" title="创世认购设置加载失败" detail={error} retryLabel="重试" onRetry={() => void load()} />
      : <BlockState state="loading" title="创世认购设置加载中…" />;
  }

  const configuredCount = G4_CONFIGS.filter((definition) => data.config[definition.key] != null && data.config[definition.key] !== "").length;
  const simulationAction = canWrite && <Button size="sm" variant="primary" disabledReason={blocked || readFailed ? "页面要先重新读取成功，才能再改" : !!session && listG4DirectCommands(session.adminId).some(row => g4DirectObject(row) === "operations/simulations") ? "请先核对原操作" : !(Number(quantity) > 0) || !(Number(unitPrice) > 0) ? "数量和单价都要大于 0" : undefined} onClick={createSimulation}>创建模拟成交</Button>;
  return <>
    {error && <Notice tone="warn" title="刷新失败，下面是上次加载的数据" action={<Button size="sm" onClick={() => void load()}>重试</Button>}><p>{error}</p></Notice>}
    <Fold title="认购、预售与持有人规则" icon={ShieldCheck} tone="role-3"
      summary={`15 项 · 已配置 ${configuredCount} 项 · 修改后立即保存`}
      explain="每项自己保存，不走审批；App 下次读取时用新设置，已打开的 App 页面不会自动刷新。资格只看资格开关、每人上限和最少注册天数，以前的入金、旗舰设备、V 等级、邀请码条件已停用。">
      <div className="g4x-groups">{GROUPS.map((group) => (
        <Panel key={group.key} plain headingLevel={3} title={group.title} explain={group.explain}>
          <ConfigList label={group.title}>
            {group.keys.map((key) => {
              const definition = G4_CONFIGS.find((row) => row.key === key)!;
              const help = CONFIG_HELP[key];
              const value = data.config[key];
              return (
                <ConfigRow key={key} name={definition.label} what={help?.what} effect={help?.effect} note={help?.note}
                  when="确认后立即保存，App 下次读取时生效"
                  value={<span className={value == null || value === "" ? "g4x-dir" : "g4x-value-num"}>{configShown(key, definition.kind, value, help?.unit)}</span>}
                  action={canWrite ? (describedBy) => (
                    <Button size="sm" disabled={blocked || readFailed || !!session && listG4DirectCommands(session.adminId).some(row => g4DirectObject(row) === `operations/config/${encodeURIComponent(key)}`)} aria-describedby={describedBy} aria-label={`调整${definition.label}`} onClick={() => edit(definition)}>调整</Button>
                  ) : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
      ))}</div>
    </Fold>
    <Fold title="模拟成交演练" icon={FlaskConical} tone="role-other"
      summary={`${data.simulations.length} 条模拟记录 · 只在后台可见`}
      explain="只用于后台演练：不进钱包和资金账本，不计入成交量、地板价、持有人等统计，用户看不到。列表显示最新的 50 条。">
      {canWrite && <div className="g4x-sim-form">
        <Field label="方向">{(control) => <Select {...control} aria-label="模拟成交方向" value={side} onChange={(value) => setSide(value === "SELL" ? "SELL" : "BUY")}
          options={[{ value: "BUY", label: "模拟买入" }, { value: "SELL", label: "模拟卖出" }]} />}</Field>
        <Field label="数量">{(control) => <Input {...control} type="number" min="0.000001" max="999999999999.999999" step="0.000001" value={quantity} aria-label="模拟成交数量" onChange={(e) => setQuantity(e.target.value)} placeholder="数量" />}</Field>
        <Field label="单价">{(control) => <Input {...control} type="number" min="0.000001" max="999999999999.999999" step="0.000001" value={unitPrice} aria-label="模拟成交单价" onChange={(e) => setUnitPrice(e.target.value)} placeholder="单价" />}</Field>
        {simulationAction || <span />}
      </div>}
      <Table label="模拟成交记录" className="g4x-sim-table">
        <thead><tr><Th>编号</Th><Th>方向</Th><Th align="right">数量</Th><Th align="right">单价（USDT）</Th><Th align="right">金额（USDT）</Th><Th>类型</Th><Th>操作人</Th>{canWrite && <Th align="right">动作</Th>}</tr></thead>
        <tbody>
          {data.simulations.map((row) => <tr key={row.id}>
            <Td><Cell main={<span data-mono>{row.simulationNo}</span>} title={row.simulationNo} /></Td>
            <Td>{sideText(row.side)}</Td>
            <Td align="right"><Cell num main={g4Count(String(row.quantity))} /></Td>
            <Td align="right"><Cell num main={g4Amount(String(row.unitPrice))} /></Td>
            <Td align="right"><Cell num main={g4Amount(String(row.notional))} /></Td>
            <Td><StatusTag tone="neutral" icon={FlaskConical}>{row.recordType === "SIMULATED" ? "模拟记录" : "类型未知"}</StatusTag></Td>
            <Td><Cell main={row.operator} title={row.operator} /></Td>
            {canWrite && <Td align="right" data-fit=""><Button size="sm" disabled={blocked || readFailed || !!session && listG4DirectCommands(session.adminId).some(command => g4DirectObject(command) === `operations/simulations/${row.id}`)} onClick={() => archive(row.id, row.simulationNo)}>归档</Button></Td>}
          </tr>)}
          {!data.simulations.length && <TableMessage columns={canWrite ? 8 : 7}>暂无模拟成交记录</TableMessage>}
        </tbody>
      </Table>
    </Fold>
  </>;
}
