"use client";

/**
 * A4 用户行为事件的展示件：名称翻译、时间和时长写法、上线进度点、原操作提醒。
 * 只管怎么显示，不发请求、不判权限；数据和按钮都由 a4-events.tsx 传进来。
 */
import type { ReactNode } from "react";
import { Explain, Notice } from "@/app/components/rd";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import type { A4Overview } from "@/lib/admin/a4-client";

export type A4Schema = A4Overview["schemaRegistrations"][number];
export type A4Lifecycle = A4Schema["lifecycleState"];

/** 上线进度五步，按顺序。停用是全面开放之后的终点，不能回头。 */
export const LIFECYCLE_ORDER: readonly A4Lifecycle[] = ["new", "pending_publish", "gray", "full", "disabled"];
export const LIFECYCLE_TEXT: Record<A4Lifecycle, string> = { new: "新建", pending_publish: "待发布", gray: "分批开放", full: "全面开放", disabled: "已停用" };
/** 停在这一步时事件记不记、发不发（BF10）。 */
export const LIFECYCLE_NOW: Record<A4Lifecycle, string> = {
  new: "还不记录、也不投递。",
  pending_publish: "仍然不记录、也不投递，只是标成准备发布。",
  gray: "服务器按用户范围抽 10% 记录和投递；App 发来的行为事件这一步仍不放行。",
  full: "所有来源都按事件规则记录和投递。",
  disabled: "不再记录、也不再投递；已经记下的旧事件不删。",
};
/** 推进到这一步之后会怎样，确认框和详情抽屉共用。 */
export const LIFECYCLE_AFTER: Record<Exclude<A4Lifecycle, "new">, string> = {
  pending_publish: "推进后仍然不记录、也不投递，只是标成准备发布；下一步才开始分批开放。",
  gray: "推进后开始分批开放：服务器按用户范围抽 10% 记录和投递；App 发来的行为事件这一步仍不放行，不能保证每个用户都能上报。",
  full: "推进后全面开放：所有来源都按事件规则记录和投递，字段、来源和采样的检查照常。",
  disabled: "推进后停用，之后不再记录也不再投递，停用后不能再开放；已排队没送出的也可能被拦下，旧事件不删。",
};
export const NEXT_LIFECYCLE: Partial<Record<A4Lifecycle, Exclude<A4Lifecycle, "new">>> = { new: "pending_publish", pending_publish: "gray", gray: "full", full: "disabled" };

/** 上线进度点：五个点一条线，走过的实心、当前的上色、后面的空心。旁边写当前状态的字，颜色之外有文字。 */
export function LifeDots({ state }: { state: A4Lifecycle }) {
  const at = LIFECYCLE_ORDER.indexOf(state);
  return (
    <span className="a4-life" data-state={state}>
      <span className="a4-life-dots" aria-hidden>
        {LIFECYCLE_ORDER.map((step, index) => <i key={step} data-at={index < at ? "done" : index === at ? "now" : "todo"} />)}
      </span>
      <span className="a4-life-text">{LIFECYCLE_TEXT[state]}</span>
    </span>
  );
}

/** 积压明细里的状态，接口只给这三种。 */
export const BACKLOG_STATUS: Record<string, string> = { PENDING: "待发送", FAILED: "发送失败", OTHER: "其他" };
/** 回执状态：某个使用方处理到了哪一步。 */
export const RECEIPT_STATUS: Record<string, string> = { PENDING: "等待处理", FAILED: "处理失败", SUCCESS: "已处理", DEAD: "已终止", PROCESSING: "处理中", SKIPPED: "已跳过", PENDING_BINDING: "待关联", OTHER: "其他" };
/** 重新排队预览和结果里的两层状态。 */
export const REDRIVE_STATUS: Record<string, string> = { PENDING: "待发送", CLAIMED: "处理中", PROCESSING: "处理中", SENT: "已发送", DELIVERED: "已送达", DEAD: "已终止", FAILED: "失败待重试", RETRY_REQUESTED: "已请求重试" };

/** 可以重新排队的五种原任务事件（只这五种，后端白名单）。都是用户任务管理的周任务完成证据。 */
export const H3_TYPE_TEXT: Record<string, string> = {
  H3_STOREFRONT_THREE_PRODUCTS_VIEWED: "周任务「逛商城」：看过 3 个商品",
  H3_GENESIS_SECONDARY_MARKET_VIEWED: "周任务：看过创世节点二级市场",
  H3_COMPUTE_COMPLETED_50: "周任务：完成 50 个算力任务",
  H3_REFERRAL_REGISTERED: "周任务「邀请好友」：好友已注册",
  H3_EXCHANGE_COMPLETED: "周任务：完成一次兑换",
};

/** 积压明细的失败原因：接口给受控的原因码，这里翻成人话，原码进问号。 */
const ERROR_TEXT: Record<string, string> = {
  OTHER_ERROR: "其他错误",
  C1_AUDIT_EVIDENCE_NOT_UNIQUE: "查看用户资料：对应的操作记录不止一条",
  C1_AUDIT_ENVELOPE_INVALID: "查看用户资料：事件外层格式不对",
  C1_AUDIT_PAYLOAD_INVALID: "查看用户资料：事件内容不对",
  C1_AUDIT_DELIVERY_NOT_COMPLETE: "查看用户资料：操作记录还没投递完",
  C1_AUDIT_RECEIPT_NOT_PERSISTED: "查看用户资料：回执没保存下来",
  C1_AUDIT_SOURCE_INVALID: "查看用户资料：事件来源不对",
  H3_EVENT_BINDING_PENDING: "任务事件：还在等关联到用户任务",
  L6_EVIDENCE_FACT_MISSING: "行为热力图：找不到原始记录",
  L6_EVIDENCE_ENVELOPE_INVALID: "行为热力图：事件外层格式不对",
  L6_EVIDENCE_PAYLOAD_INVALID: "行为热力图：事件内容不对",
  L6_EVIDENCE_FACT_CONFLICT: "行为热力图：和原始记录对不上",
  L6_EVIDENCE_RECEIPT_FAILED: "行为热力图：回执写入失败",
  L6_EVIDENCE_RECEIPT_CONFLICT: "行为热力图：回执和已有的冲突",
  L6_EVIDENCE_PUBLICATION_FAILED: "行为热力图：发布失败",
  L6_EVIDENCE_VERIFICATION_UNAVAILABLE: "行为热力图：暂时无法核验",
  F4_ALERT_AUDIT_MISSING: "奖励池告警：缺对应的操作记录",
  F4_ALERT_ENVELOPE_INVALID: "奖励池告警：事件外层格式不对",
  F4_ALERT_PAYLOAD_INVALID: "奖励池告警：事件内容不对",
  F4_ALERT_AUDIT_NOT_UNIQUE: "奖励池告警：对应的操作记录不止一条",
  F4_ALERT_AUDIT_CONFLICT: "奖励池告警：和操作记录对不上",
  F4_ALERT_AUDIT_ALREADY_CLAIMED: "奖励池告警：操作记录已被另一条认领",
  F4_ALERT_RECEIPT_FAILED: "奖励池告警：回执写入失败",
  F4_ALERT_RECEIPT_CONFLICT: "奖励池告警：回执和已有的冲突",
  F4_ALERT_PUBLICATION_FAILED: "奖励池告警：发布失败",
  F4_ALERT_VERIFICATION_UNAVAILABLE: "奖励池告警：暂时无法核验",
};

export function errorText(code: string | null): ReactNode {
  if (code === null) return <span className="a4-dim">没有记录</span>;
  return <span className="a4-pair">{ERROR_TEXT[code] ?? "其他错误"}<Explain label="原因码" content={<p>原因码 <span data-mono>{code}</span></p>} /></span>;
}

/** 事件类型的人话：在事件目录的说明里找得到就用说明，找不到写原名。 */
export function eventDesc(overview: A4Overview | null, eventName: string): string | undefined {
  if (!overview) return undefined;
  for (const family of overview.eventFamilies) {
    const hit = family.events.find((event) => event.item.trim() === eventName);
    if (hit) return hit.desc;
  }
  return undefined;
}

/** 后端的时间串没有时区，按业务时区读，写到分钟（TX-25）。 */
export function minute(value: string | null | undefined): string {
  if (!value) return "—";
  return formatBusinessTimeCompact(value, "—");
}

export function zoneNote(): string {
  return `时间为${businessZone().label}`;
}

/** 等了多久：天和小时、小时和分钟，不到一分钟写秒。 */
export function waited(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

/** 字段串「name:type, name:type」数个数；空串、null 都算 0 个。 */
export function propertyList(properties: string | null | undefined): { name: string; type: string }[] {
  if (!properties) return [];
  return properties.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const at = part.lastIndexOf(":");
    return at < 0 ? { name: part, type: "—" } : { name: part.slice(0, at), type: part.slice(at + 1) };
  });
}

export const PROPERTY_TYPE_TEXT: Record<string, string> = { string: "文字", number: "数字", boolean: "是／否", enum: "固定选项", timestamp: "时间", id: "编号", json: "结构数据" };
export const PRODUCER_TEXT: Record<string, string> = { server: "服务器", client: "App", "server+client": "服务器和 App" };

/** 谁在用：使用方原文按「/」分开；像「L1」这样的页面编号换成菜单名，其余照原文。 */
export function consumerParts(consumers: string, pageName: (code: string) => string | undefined): { key: string; text: string; code?: string }[] {
  return consumers.split(/[/,，、]/).map((part) => part.trim()).filter(Boolean).map((part, index) => {
    const name = /^[A-Z][0-9]{1,2}$/.test(part) ? pageName(part) : undefined;
    return name ? { key: `${part}-${index}`, text: name, code: part } : { key: `${part}-${index}`, text: part };
  });
}

export type A4RecoveryRow = { key: string; name: ReactNode; change: ReactNode; submittedAt?: number; tag: ReactNode; ticket?: string; actions: ReactNode };

/** 原操作提醒：逐条写改的是什么、对象是谁、什么时候提交的、现在什么状态，按钮在行尾。 */
export function A4RecoveryNotice({ title, explain, rows }: { title: ReactNode; explain: ReactNode; rows: A4RecoveryRow[] }) {
  if (!rows.length) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  return (
    <Notice tone="warn" title={<>{title}<Explain label="原操作怎么处理" content={explain} /></>}>
      <ul className="a4-rec" aria-label="原操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="a4-rec-name">{row.name}</span>
            <span className="a4-rec-change">{row.change}</span>
            <span className="a4-rec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="a4-rec-state">{row.tag}{row.ticket && <span className="a4-rec-ticket">审批单 <span data-mono>{row.ticket}</span></span>}</span>
            <span className="a4-rec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {timed && <p className="a4-rec-zone">提交时间为{businessZone().label}</p>}
    </Notice>
  );
}
