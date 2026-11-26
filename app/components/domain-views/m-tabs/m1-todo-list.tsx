"use client";

/**
 * 客服工作台「待跟进」名单的界面（超管、主管；design-plan 板 4，画板 4-sa、4-sv、4-ix）。
 * 只管样子：数据、筛选条件、翻页和动作都由挂载处（m1-todo-tab.tsx）传进来，这里不发请求。
 */
import type { ReactNode } from "react";
import { Clock3, Info, MessageSquare, UserRound, Users } from "lucide-react";
import { BlockState, Button, Cell, Drawer, Explain, FilterBar, FilterField, Input, Notice, Pager, Panel, Segments, Select, StatusTag, Table, TableLoading, Td, Th, Tr } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact, parseBusinessTime } from "@/lib/admin/business-time";
import { durationText } from "./m1-live-service";
import { SupportAvatar } from "./support-avatar";

/** 待办原因筛选：全部待办和三种原因，取值就是接口的 filter。 */
import { TODO_PAGE_SIZES, type TodoFilter } from "@/lib/admin/support-todo-route";
/** 名单一行。三种原因按后端判断给（首次待联系、待维护已含「维护开启」），起点和判断时刻是 B116 的四个时间，没有时传 null。 */
export type TodoRow = {
  customerId: string;
  customerCode: string;
  name: string;
  avatarPath?: string;
  agentName: string | null;
  waitingReply: boolean;
  pendingReplyCount: number;
  waitingReplySinceAt: string | null;
  firstContact: boolean;
  firstContactSinceAt: string | null;
  due: boolean;
  maintenanceDueAt: string | null;
  /** 这一行的判断时刻（B116 行 evaluatedAt），时长都算到它。 */
  evaluatedAt: string;
  /** 客户上次交互式登录（lastEffectiveAt，后端只记登录）。 */
  lastLoginAt: string | null;
};
/** 名单读取的结果。unconfigured：选了「待维护」而主动维护间隔天数没配置（接口回 available=false），不是 0。 */
export type TodoListRead =
  | { state: "loading" }
  | { state: "error" | "denied" | "missing"; detail: string }
  | { state: "unconfigured" }
  | { state: "ready"; rows: TodoRow[]; total: number; evaluatedAt: string };
/** 副标题里的范围：超管全部客服、主管负责组 N 个，或已选的组、客服。 */
export type TodoScope = { kind: "all" } | { kind: "managed"; groups: number | null } | { kind: "group"; name: string } | { kind: "agent"; name: string };
type TodoOption = { value: string; label: string };
export type TodoOptions = TodoOption[] | { unavailable: string };
/** 行和抽屉里的动作。reply：有回复权（发起会话）；read：只有会话页查看权（查看会话记录）；none：只给查看资料。 */
export type TodoAccess = "reply" | "read" | "none";
/** 「服务规则与话术」的入口：能改写「配置」，只能看写「查看」，不可达不传。 */
export type TodoConfigLink = { href: string; verb: "配置" | "查看" };

const REASON_ICON = { WAITING_REPLY: MessageSquare, FIRST_CONTACT: UserRound, DUE: Clock3 } as const;
const FILTER_ITEMS: { value: TodoFilter; label: string }[] = [
  { value: "TODO", label: "全部待办" },
  { value: "WAITING_REPLY", label: "待回复" },
  { value: "FIRST_CONTACT", label: "首次待联系" },
  { value: "DUE", label: "待维护" },
];

function since(from: string | null, to: string): string | null {
  return from === null ? null : durationText(parseBusinessTime(to) - parseBusinessTime(from));
}
/** 一行的原因：只有待回复写「等了」，首次待联系写「已分配」，待维护写「超期」；首次待联系和待维护起点相同时合写一次。 */
export function todoReasons(row: TodoRow): { key: keyof typeof REASON_ICON; text: string }[] {
  const parts: { key: keyof typeof REASON_ICON; text: string }[] = [];
  if (row.waitingReply) {
    const waited = since(row.waitingReplySinceAt, row.evaluatedAt);
    parts.push({ key: "WAITING_REPLY", text: "待回复 " + row.pendingReplyCount + " 条" + (waited ? " · 等了 " + waited : "") });
  }
  const sameStart = row.firstContact && row.due && row.firstContactSinceAt !== null && row.firstContactSinceAt === row.maintenanceDueAt;
  if (row.firstContact) {
    const assigned = since(row.firstContactSinceAt, row.evaluatedAt);
    parts.push({ key: "FIRST_CONTACT", text: (sameStart ? "首次待联系、待维护" : "首次待联系") + (assigned ? " · 已分配 " + assigned : "") });
  }
  if (row.due && !sameStart) {
    const overdue = since(row.maintenanceDueAt, row.evaluatedAt);
    parts.push({ key: "DUE", text: "待维护" + (overdue ? " · 超期 " + overdue : "") });
  }
  return parts;
}
/** 原因格：待回复是要先处理的，用橙黄；其余灰字加图标。名单只剩待回复时它也灰（VS-21）。 */
export function TodoReasons({ row, quietReply = false }: { row: TodoRow; quietReply?: boolean }) {
  return <span className="m1-todo-reasons">{todoReasons(row).map(part => {
    const Icon = REASON_ICON[part.key];
    return <span key={part.key} className="m1-todo-reason" data-tone={part.key === "WAITING_REPLY" && !quietReply ? "warn" : undefined}><Icon size={14} strokeWidth={1.9} aria-hidden />{part.text}</span>;
  })}</span>;
}
const asOf = (value: string) => "截至 " + formatBusinessTimeCompact(value, "—") + "（" + businessZone().label + "）";

function scopeText(scope: TodoScope): string {
  return scope.kind === "all" ? "全部客服" : scope.kind === "managed" ? "负责组 " + (scope.groups ?? "—") + " 个" : scope.kind === "group" ? "负责组 " + scope.name : "客服 " + scope.name;
}

export function TodoRowActions({ row, access, checking, refreshing, onStart, onRead, onProfile }: { row: TodoRow; access: TodoAccess; checking: boolean; refreshing: boolean; onStart: () => void; onRead: () => void; onProfile?: () => void }) {
  return <span className="m1-todo-actions">
    {access === "reply" && <Button size="sm" loading={checking} disabled={refreshing} onClick={onStart}>发起会话</Button>}
    {access === "read" && <Button size="sm" onClick={onRead}>查看会话记录</Button>}
    {onProfile && <Button size="sm" variant="ghost" aria-label={"查看资料：" + row.name} onClick={onProfile}>查看资料</Button>}
  </span>;
}

/** 名单上方的接待状态提示：读不到不是提交失败，用橙黄（VS-107）；只给下一步。 */
export function TodoHoldNotice({ name, message, onRead, onDismiss }: ({ name: string; onRead?: () => void; message?: never } | { message: string; name?: never; onRead?: never }) & { onDismiss: () => void }) {
  return <Notice tone="warn" action={<>{onRead && <Button size="sm" onClick={onRead}>查看会话记录</Button>}<Button size="sm" onClick={onDismiss}>知道了</Button></>}>
    {message ?? `${name}：暂时核对不了接待状态，请稍后再点「发起会话」。`}
  </Notice>;
}

export type TodoPanelProps = {
  scope: TodoScope;
  read: TodoListRead;
  filter: TodoFilter;
  onFilter: (filter: TodoFilter) => void;
  keyword: string;
  onKeyword: (keyword: string) => void;
  onSubmit: () => void;
  /** 输入框里的客户词和已应用的不一样（还没点查询）：查询旁写「条件未应用」（ST-18）。 */
  draftChanged: boolean;
  /** 已应用的客户关键词：筛空时空态写明是关键词没有匹配（ST-33）。 */
  appliedKeyword: string;
  /** 更多筛选：负责组、客服。选项读不到时传 unavailable 写原因，名单照常。 */
  groupValue: string;
  groupOptions: TodoOptions;
  onGroup: (groupId: string) => void;
  agentValue: string;
  agentOptions: TodoOptions;
  onAgent: (agentId: string) => void;
  applied: { key: string; label: string; onRemove: () => void }[];
  moreCount: number;
  canClear: boolean;
  onClear: () => void;
  querying: boolean;
  /** 换条件或翻页读取中：上一次读到的总数。表格换成占位，分页条留着、按钮禁用；读完再按新结果校正，失败或 0 条时移除（ST-13、ST-32）。 */
  keptTotal?: number;
  noGroups: boolean;
  onRetry: () => void;
  configLink?: TodoConfigLink;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  access: TodoAccess;
  checkingId: string | null;
  selectedId: string | null;
  onStart: (row: TodoRow) => void;
  onRead: (row: TodoRow) => void;
  onProfile: (row: TodoRow) => void;
  /** 发起会话时查不到接待状态的提示，放在筛选条下、名单上方（抽屉开着时放抽屉里，这里不传）。 */
  notice?: ReactNode;
};

function optionsOf(options: TodoOptions, all: string): { list: TodoOption[]; disabled?: boolean; reason?: string } {
  return Array.isArray(options) ? { list: [{ value: "", label: all }, ...options] } : { list: [{ value: "", label: all }], disabled: true, reason: options.unavailable };
}

export function M1TodoPanel(props: TodoPanelProps) {
  const { read, filter } = props;
  const ready = read.state === "ready" ? read : null;
  const filtered = props.canClear;
  const groups = optionsOf(props.groupOptions, "全部负责组");
  const agents = optionsOf(props.agentOptions, "全部客服");
  const kept = read.state === "loading" ? props.keptTotal : undefined;
  const list = ready && ready.rows.length > 0 ? { rows: ready.rows, total: ready.total } : kept ? { rows: null, total: kept } : null;
  const sub = <>{scopeText(props.scope)}{ready && ready.rows.length > 0 && <>{filter === "WAITING_REPLY" ? "" : " · 待回复在前"} · {asOf(ready.evaluatedAt)}</>}</>;
  return <Panel className="m1-todo" icon={Users} tone="role-3" title="待跟进客户" sub={sub} explainLabel="待跟进客户的说明"
    explain="一位客户只算一次、占一行。不带筛选时和今日概览用同一范围，各自刷新。待回复的排在前面。">
    <FilterBar onSubmit={props.onSubmit} querying={props.querying} onClear={props.onClear} canClear={props.canClear} moreCount={props.moreCount} applied={props.applied}
      // 「条件未应用」由共用筛选条放在「查询」旁（ST-18）。
      result={props.draftChanged ? "条件未应用" : undefined}
      scope={<FilterField><div className="rd-field"><span aria-hidden="true">待办原因</span><Segments label="待办原因" value={filter} items={FILTER_ITEMS} onChange={props.onFilter} /></div></FilterField>}
      more={<>
        <FilterField label="负责组"><Select aria-label="负责组" value={props.groupValue} options={groups.list} disabled={groups.disabled} onChange={props.onGroup} /></FilterField>
        <FilterField label="客服"><Select aria-label="客服" value={props.agentValue} options={agents.list} disabled={agents.disabled} onChange={props.onAgent} /></FilterField>
        {groups.reason && <p className="m1-todo-more-note">负责组：{groups.reason}</p>}
        {agents.reason && <p className="m1-todo-more-note">客服：{agents.reason}</p>}
      </>}>
      <FilterField label="客户" grow><Input value={props.keyword} maxLength={200} onChange={event => props.onKeyword(event.target.value)} placeholder="客户名称、用户编码或手机号" aria-label="查询客户名称、用户编码或手机号" /></FilterField>
    </FilterBar>
    {props.notice}
    {read.state === "loading" && !kept && <BlockState state="loading" title="正在加载…" />}
    {read.state === "error" && <BlockState state="error" title="待跟进客户加载失败" detail={read.detail} onRetry={props.onRetry} retrying={props.querying} />}
    {read.state === "missing" && <BlockState state="error" title="待跟进客户加载失败" detail={read.detail} />}
    {read.state === "denied" && <BlockState state="denied" title="无权限访问" detail={read.detail} />}
    {read.state === "unconfigured" && <div className="m1-todo-unconfigured" role="status">
      <p className="m1-todo-unconfigured-title"><b>主动维护间隔天数</b><StatusTag tone="neutral" icon={Info}>未配置</StatusTag></p>
      <p>配好之前查不了待维护，这不代表没有要维护的客户。</p>
      {props.configLink && <a className="rd-link" href={props.configLink.href}>去「服务规则与话术」{props.configLink.verb}</a>}
    </div>}
    {ready && ready.rows.length === 0 && (filtered
      ? <BlockState state="empty" title="没有符合条件的待跟进客户" detail={<>{props.appliedKeyword ? "关键词没有匹配的客户，换个关键词再查。" : "换个待办原因或客服再看。"}<span className="m1-todo-empty-action"><Button size="sm" onClick={props.onClear}>清除筛选</Button></span></>} />
      : props.noGroups ? <TodoNoGroups /> : <BlockState state="empty" title="暂无待跟进客户" detail="客户发来消息、新分给专属客服或到了维护时间，会出现在这里。" />)}
    {list && <>
      <Table label="待跟进客户" className="m1-todo-table" aria-busy={list.rows === null || undefined}>
        <colgroup><col /><col /><col /><col /><col /></colgroup>
        <thead><Tr><Th>客户</Th><Th>负责客服</Th><Th><span className="m1-todo-th">待办原因<Explain label="待办原因的说明" content="待回复写等了多久，从最早一条没回的消息算；首次待联系写分给专属客服多久；待维护写超期多久。都算到「截至」的时间。" /></span></Th><Th>上次登录</Th><Th sticky="end">操作</Th></Tr></thead>
        <tbody>{list.rows === null ? <TableLoading columns={5} rows={Math.min(props.pageSize, 10)} /> : list.rows.map(row => <Tr key={row.customerId} selected={row.customerId === props.selectedId} onOpen={() => props.onProfile(row)}>
          <Td><span className="m1-todo-customer"><SupportAvatar name={row.name} path={row.avatarPath} size={28} /><Cell title={row.name + " · " + row.customerCode} main={row.name} sub={<span className="m-user-code">{row.customerCode}</span>} /></span></Td>
          <Td><span className="m1-todo-nowrap">{row.agentName ?? "—"}</span></Td>
          <Td><TodoReasons row={row} quietReply={filter === "WAITING_REPLY"} /></Td>
          <Td><span className="m1-todo-nowrap">{row.lastLoginAt ? formatBusinessTimeCompact(row.lastLoginAt, "—") : "—"}</span></Td>
          <Td sticky="end" data-fit=""><TodoRowActions row={row} access={props.access} checking={props.checkingId === row.customerId} refreshing={props.querying} onStart={() => props.onStart(row)} onRead={() => props.onRead(row)} onProfile={() => props.onProfile(row)} /></Td>
        </Tr>)}</tbody>
      </Table>
      <Pager label="待跟进客户" total={list.total} page={props.page} pageSize={props.pageSize} sizes={TODO_PAGE_SIZES} loading={props.querying} onPage={props.onPage} onPageSize={props.onPageSize} />
    </>}
  </Panel>;
}

export function TodoNoGroups() {
  return <BlockState state="empty" title="你还没有负责的客服组" detail="请超级管理员在「客服与分组」给你设置负责组。" />;
}

/**
 * 资料抽屉（来源 M1）：开头写这位客户为什么在名单里、算到什么时候；资料本身是现有的管理版客户资料（children）。
 * 上一条、下一条只在当前页内切；发起会话的结果写在抽屉里、底部动作上方。
 */
export function TodoProfileDrawer({ row, access, checking, refreshing, nav, holdNotice, onStart, onRead, onClose, children }: {
  row: TodoRow; access: TodoAccess; checking: boolean; refreshing: boolean;
  nav: { onPrev: () => void; onNext: () => void; hasPrev: boolean; hasNext: boolean };
  holdNotice?: ReactNode; onStart: () => void; onRead: () => void; onClose: () => void; children: ReactNode;
}) {
  return <Drawer open title="客户资料" sub={row.name + " · " + row.customerCode} nav={nav} onClose={onClose}
    footer={<>{holdNotice}<div className="m1-todo-drawer-actions">
      {access === "reply" && <Button variant="primary" loading={checking} disabled={refreshing} onClick={onStart}>发起会话</Button>}
      {access === "read" && <Button onClick={onRead}>查看会话记录</Button>}
      <Button onClick={onClose}>关闭</Button>
    </div></>}>
    <p className="sa-disclosure">按你的客户资料查看权限显示；能看到统计不代表能操作资金或回复客户。</p>
    <section className="m1-todo-points" aria-label="待办">
      <h4>待办</h4>
      <TodoReasons row={row} />
      <p className="m1-todo-points-asof">{asOf(row.evaluatedAt)}</p>
    </section>
    {children}
  </Drawer>;
}
