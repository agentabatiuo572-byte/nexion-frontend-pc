"use client";

/** 充值与收款对账四个区共用的小件：网址参数、要处理的数、金额写法、结果未确认的提醒条。 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Copy, PowerOff } from "lucide-react";
import { Button, Explain, IconButton, Notice, ReleaseModal, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { isDOutcomeUnknownError } from "@/lib/admin/d-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useReach } from "@/lib/nav/use-reach";

export type D1Section = "payments" | "bank" | "usdt" | "ledger";
export const D1_SECTIONS: readonly D1Section[] = ["payments", "bank", "usdt", "ledger"];
export const D1_SECTION_NAME: Record<D1Section, string> = { payments: "订单付款", bank: "银行卡充值", usdt: "USDT 充值", ledger: "充值流水与对账" };
const RETURN_LABEL: Record<D1Section, string> = { payments: "返回订单付款", bank: "返回银行卡充值", usdt: "返回 USDT 充值", ledger: "返回充值流水与对账" };

/** 网址里的参数，不在允许值里的不认。 */
export function readParam(name: string, allowed?: readonly string[]): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(name);
  if (value === null) return null;
  return !allowed || allowed.includes(value) ? value : null;
}

export function readPage(name: string, fallback = 1): number {
  const value = Number(readParam(name));
  return Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}

/** 替换写入，不增加浏览器历史；别的参数（比如临时的 theme）原样留着（SPM-12、X19）。 */
export function writeParams(values: Record<string, string | number | null>) {
  const url = new URL(window.location.href);
  Object.entries(values).forEach(([name, value]) => {
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, String(value));
  });
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** 一个区里要人处理的数：读到的数（capped 是数到了上限）、读不到；undefined 是还在读。 */
export type D1Count = { n: number; capped?: boolean } | "failed" | undefined;
export const countText = (count: D1Count): number | string | undefined =>
  count === undefined ? undefined : count === "failed" ? "—" : count.capped ? `${count.n}+` : count.n;

/** 这个区有哪些别的区该知道的事：没保存的修改、结果未确认、待审批。 */
export type D1Activity = readonly string[];

/** USDT 金额：千分位，至少两位小数，后端给的精度照写，不舍入。 */
export function usdt(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, whole, fraction = ""] = match;
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

/** 越南盾整数金额。 */
export function vnd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "number" ? String(Math.trunc(value)) : value.trim();
  return /^\d+$/.test(text) ? text.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : text;
}

export const zoneLabel = () => businessZone().label;

/** 哈希、地址这类长值：写前后几位，完整值在提示里，旁边能复制；不在值列折行掉一位（VS-52、DT-09）。 */
export function LongValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState("");
  if (value.length <= 22) return <>{value}</>;
  return (
    <span className="rd-record-reference">
      <span title={value}>{`${value.slice(0, 10)}…${value.slice(-8)}`}</span>
      <IconButton aria-label={copied || `复制${label}`} onClick={() => {
        if (!navigator.clipboard) { setCopied("复制失败，请从提示里手动选择"); return; }
        void navigator.clipboard.writeText(value).then(() => setCopied(`已复制${label}`), () => setCopied("复制失败，请从提示里手动选择"));
      }}><Copy size={14} aria-hidden /></IconButton>
    </span>
  );
}

/** 开关现在开还是关：开绿，关灰，紧急停用后红（D1 颜色表）。 */
export function SwitchTag({ on, stopped, children }: { on: boolean; stopped?: boolean; children: ReactNode }) {
  if (stopped) return <StatusTag tone="danger" icon={PowerOff}>{children}</StatusTag>;
  return on ? <StatusTag tone="ok">{children}</StatusTag> : <StatusTag tone="neutral" icon={PowerOff}>{children}</StatusTag>;
}

export type D1PendingItem = {
  /** 命令号。 */
  key: string;
  /** 原操作的名字，写进标题和解除框。 */
  label: string;
  createdAt: number;
  /** 还能重试时写在发出时间后面的话；过了重试时限写 blocked。 */
  hint: ReactNode;
  /** 现在不能重试的原因：过了时限、没有权限。 */
  blocked?: string;
  auditHref?: string;
  /** 读回这条对象的现状，返回写给人看的一句话。 */
  verify?: () => Promise<ReactNode>;
  /** 按原请求重发。后端不按命令号去重的操作不给：再发可能再执行一次，只能读回核对（OP-94）。 */
  retry?: () => Promise<unknown>;
  /** 原样重试被明确拒绝后，人核实过原操作再放开本页的锁，不发请求。 */
  release: () => void;
  after: () => void;
};

const unknownOutcome = (error: unknown) => isDOutcomeUnknownError(error)
  || (typeof error === "object" && error !== null && (error as { unknownOutcome?: unknown }).unknownOutcome === true);

/**
 * 结果未确认的写操作，所在页签顶部常显（OP-93）。只能按原请求重试（OP-94）；重试被后端明确拒绝后才出现「解除待确认」，
 * 后端不按命令号去重的操作只读回事实，不给重试或解除，记录保留到关标签页（决定 03）。解除只清本地记录，不发请求（OP-153）。
 */
export function PendingNotices({ items, disabled }: { items: readonly D1PendingItem[]; disabled?: boolean }) {
  const reach = useReach();
  const [running, setRunning] = useState("");
  const [releasable, setReleasable] = useState<readonly string[]>([]);
  const [notes, setNotes] = useState<Record<string, ReactNode>>({});
  const [releasing, setReleasing] = useState<D1PendingItem | null>(null);
  if (!items.length && !releasing) return null;
  const note = (key: string, text: ReactNode) => setNotes((current) => ({ ...current, [key]: text }));
  const retry = async (item: D1PendingItem) => {
    if (!item.retry) return;
    setRunning(item.key);
    setReleasable((current) => current.filter((key) => key !== item.key));
    try {
      await item.retry();
      note(item.key, "");
    } catch (error) {
      if (isPermissionDenied(error)) announcePermissionDenied();
      if (isExplicitRejection(error)) {
        note(item.key, <>重试被拒：{displayAdminError(error)} 这说明不了原操作的结果，先核实原操作，再决定要不要解除。</>);
        setReleasable((current) => [...current, item.key]);
      } else if (unknownOutcome(error)) note(item.key, "重试结果仍未确认，原操作继续保留。");
      else note(item.key, <>这次没能确认结果：{displayAdminError(error)} 原操作继续保留。</>);
    } finally {
      setRunning("");
      item.after();
    }
  };
  const verify = async (item: D1PendingItem) => {
    if (!item.verify) return;
    setRunning(item.key);
    try {
      note(item.key, await item.verify());
    } catch (error) { note(item.key, `读回失败：${displayAdminError(error)} 待确认继续保留。`); }
    finally { setRunning(""); }
  };
  return (
    <>
      {items.map((item) => (
        <Notice key={item.key} tone="warn" title={`${item.label} · 结果未确认`}
          action={<>
            {item.verify && <Button size="sm" disabled={disabled || !!running} onClick={() => void verify(item)}>读回核对</Button>}
            {item.retry && <Button size="sm" loading={running === item.key} disabled={disabled || (!!running && running !== item.key)} disabledReason={item.blocked} onClick={() => void retry(item)}>按原操作重试</Button>}
            {item.retry && releasable.includes(item.key) && <Button size="sm" disabled={disabled || !!running} onClick={() => setReleasing(item)}>解除待确认</Button>}
          </>}>
          {businessStamp(item.createdAt)}（{zoneLabel()}）发出，可能已经生效。{item.retry ? item.blocked ?? item.hint : item.hint}
          {item.auditHref && reach(item.auditHref, "platform_a2_read") && <> <Link className="rd-link" href={item.auditHref}>到操作记录与审批核对</Link></>}
          <Explain label="技术信息" content={`命令号 ${item.key}`} />
          {notes[item.key] && <div>{notes[item.key]}</div>}
        </Notice>
      ))}
      {releasing && (
        <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)}
          explain="重试被明确拒绝后，先到操作记录核实原操作。解除只移除本标签页的待确认记录，后端结果和锁定状态不变。"
          onConfirm={() => { releasing.release(); setReleasing(null); releasing.after(); }} />
      )}
    </>
  );
}

/** 跨区提醒：别的区有没保存的修改、结果未确认、待审批时，在页签上方说一声，带「返回…」。 */
export function CrossAreaNotice({ rows, onGo }: { rows: readonly { section: D1Section; lines: D1Activity }[]; onGo: (section: D1Section) => void }) {
  if (!rows.length) return null;
  return (
    <Notice tone="warn" title="别的页签有事没做完">
      {rows.map((row) => (
        <div key={row.section} className="rd-toolbar">
          <span>{D1_SECTION_NAME[row.section]}：{row.lines.join("；")}</span>
          <Button size="sm" variant="ghost" onClick={() => onGo(row.section)}>{RETURN_LABEL[row.section]}</Button>
        </div>
      ))}
    </Notice>
  );
}
