"use client";

/**
 * A2 批准 F5 补发、冲正、单笔状态变更时，按申请单上的奖励记录号读这笔奖励现在的样子（F5 按记录号读一条）。
 * 只显示，不挡批准：批准人不一定有查看奖励记录的权限。读到的是现在的值，不是发起时的样子。
 * 详情抽屉和批准框共用一份读数：选中一张单时重读，框里不再重复读。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Cell, Fact, Fold, InlineRetry, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import { fetchF5CommissionByBusinessId, type F5CommissionRecord } from "@/lib/admin/f1-client";
import { amountText, isFriend, KIND_LABELS, reissueOutcome, StatusBadge } from "../f-tabs/f5-shared";

type Unread = "denied" | "unsupported" | "failed";
export type F5Current = { state: "loading" } | { state: "found"; record: F5CommissionRecord } | { state: "missing" } | { state: Unread };

const readings = new Map<string, F5Current>();
const listeners = new Set<() => void>();
let version = 0;
const publish = () => { version += 1; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => version;

/** 读不到分三种：没有查看权限；后端还没有按记录号读一条（旧版本没有这条路，回 404 或 405，不是「查无这笔」）；网络或服务异常。 */
function unread(error: unknown): F5Current {
  const failure = error as { httpStatus?: number; apiCode?: number };
  if (failure.httpStatus === 403 || failure.apiCode === 403) return { state: "denied" };
  if ([404, 405].includes(failure.httpStatus ?? 0) || [404, 405].includes(failure.apiCode ?? 0)) return { state: "unsupported" };
  return { state: "failed" };
}

/** 读这些记录号；fresh 时已读过的也重读（选中一张单时）。正在读的不重复发。 */
export function readF5Current(ids: readonly string[], fresh = false) {
  for (const id of ids) {
    const known = readings.get(id);
    if (known && (known.state === "loading" || !fresh)) continue;
    readings.set(id, { state: "loading" });
    void fetchF5CommissionByBusinessId(id).then(
      (read): F5Current => read.status === "found" ? { state: "found", record: read.record } : { state: "missing" },
      unread,
    ).then((next) => { readings.set(id, next); publish(); });
  }
  publish();
}

function useF5Current(ids: readonly string[]): F5Current[] {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = ids.join(",");
  // 没读过的才读；选中单子时由页面重读。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { readF5Current(ids); }, [key]);
  return ids.map((id) => readings.get(id) ?? { state: "loading" });
}

const UNREAD_TEXT: Record<Unread, string> = {
  denied: "你的账号没有查看奖励记录的权限",
  unsupported: "系统还不能按记录号查看单笔奖励",
  failed: "网络或服务异常",
};
const NOW_NOTE = "现在读到的值，可能和发起时不同";
const NO_BLOCK = "读不到不影响批准";
const isUnread = (now: F5Current): now is { state: Unread } => now.state === "denied" || now.state === "unsupported" || now.state === "failed";
const retry = (ids: readonly string[]) => <InlineRetry onRetry={() => readF5Current(ids, true)} />;

const money = (record: F5CommissionRecord) => `${amountText(record.amount)} ${record.currency}`;
/** 好友奖励整组一起处理（F5 同一写法）：两种币各一个金额。 */
const groupMoney = (record: F5CommissionRecord) => isFriend(record) && record.amountUSDT !== undefined && record.amountNEX !== undefined
  ? `整组 ${amountText(record.amountUSDT)} USDT + ${amountText(record.amountNEX)} UVT` : undefined;

/** 冲正后余额不够时，已扣回和待追回各多少（等级月薪和结算组奖励才有，后端原值，不舍入）。 */
function recoveryText(record: F5CommissionRecord) {
  if (record.recoveredAmount === undefined && record.pendingRecoveryAmount === undefined) return undefined;
  return `已扣回 ${record.recoveredAmount === undefined ? "—" : amountText(record.recoveredAmount)} · 待追回 ${record.pendingRecoveryAmount === undefined ? "—" : amountText(record.pendingRecoveryAmount)} ${record.currency}`;
}

/** F5 详情抽屉用：打开时按记录号重读这笔现在的已扣回、待追回；读不到时写原因并给重试。 */
export function F5RecoveryAmounts({ id }: { id: string }) {
  const [now] = useF5Current([id]);
  useEffect(() => { readF5Current([id], true); }, [id]);
  if (now.state === "loading") return <span className="rd-note">正在加载已扣回和待追回…</span>;
  if (now.state === "missing") return <span>已扣回和待追回读不到：按记录号没有找到这笔</span>;
  if (isUnread(now)) return <span>已扣回和待追回读不到：{UNREAD_TEXT[now.state]}{now.state === "failed" && <> {retry([id])}</>}</span>;
  return recoveryText(now.record) ?? "已扣回和待追回：系统没有给出";
}

/** 一笔奖励现在的样子：金额、类型、用户一行，状态和「现在读到的」一行。 */
function currentNode(now: F5Current, id: string): ReactNode {
  if (now.state === "loading") return <span className="a2-f5-now"><span className="rd-note">正在加载…</span></span>;
  if (now.state === "missing") return <span className="a2-f5-now"><span><StatusTag tone="danger">查无这笔记录</StatusTag></span>
    <span className="a2-f5-sub">按记录号没有找到这笔奖励，请发起人核对记录号</span></span>;
  if (isUnread(now)) return <span className="a2-f5-now"><span><StatusTag tone="warn">读不到</StatusTag> {UNREAD_TEXT[now.state]}{now.state === "failed" && <> {retry([id])}</>}</span>
    <span className="a2-f5-sub">{NO_BLOCK}</span></span>;
  const { record } = now;
  const group = groupMoney(record);
  return <span className="a2-f5-now">
    <span><span className="a2-amount">{money(record)}</span> · {KIND_LABELS[record.kind] ?? "未知奖励类型"} · 用户 <span data-mono className="a2-code">{record.user}</span></span>
    {group && <span className="a2-f5-sub">{group}</span>}
    {recoveryText(record) && <span className="a2-f5-sub">{recoveryText(record)}</span>}
    <span className="a2-f5-sub"><StatusBadge status={record.status} explain={false} />{NOW_NOTE}</span>
  </span>;
}

/** 抽屉「判断要点」里的一行内容。 */
export function F5CurrentValue({ id }: { id: string }) {
  const [now] = useF5Current([id]);
  return <>{currentNode(now, id)}</>;
}

/** 批准框事实区的一行。 */
export function F5CurrentFact({ id }: { id: string }) {
  const [now] = useF5Current([id]);
  return <Fact k="这笔奖励">{currentNode(now, id)}</Fact>;
}

export function F5ReissueOutcome({ ids }: { ids: readonly string[] }) {
  const reads = useF5Current(ids);
  const kinds = new Set(reads.flatMap((read) => read.state === "found" ? [read.record.kind] : []));
  const outcomes = [...kinds].map((kind) => `${KIND_LABELS[kind]}：${reissueOutcome(kind)}`);
  if (!outcomes.length) return "尚未读到奖励类型，无法确认解锁时间";
  if (reads.some((read) => read.state !== "found")) outcomes.push("其余记录的解锁时间未确认");
  return outcomes.join("；");
}

/** 补发多笔：按申请单上的顺序逐笔列出，每一笔各读各的；放在折叠里，摘要写读到、查无、读不到各几笔。 */
export function F5ReissueReadings({ ids, open = false }: { ids: readonly string[]; open?: boolean }) {
  const reads = useF5Current(ids);
  // 每笔金额和异常是做决定要看的：抽屉和批准框里都默认展开（OP-151）；有查无的记录时摘要标红。
  const [expanded, setExpanded] = useState(open);
  const count = (test: (now: F5Current) => boolean) => reads.filter(test).length;
  const loading = count((now) => now.state === "loading"), found = count((now) => now.state === "found"), missing = count((now) => now.state === "missing");
  const unreadCount = count(isUnread);
  const summary = loading ? `正在加载 ${ids.length} 笔` : [found && `读到 ${found} 笔`, missing && `查无 ${missing} 笔`, unreadCount && `读不到 ${unreadCount} 笔`].filter(Boolean).join(" · ");
  // 全部因为同一个原因读不到（没有权限、系统还不支持）时只说一次，下面只列记录号。
  const same = !loading && unreadCount === ids.length && reads.every((now) => now.state === reads[0].state) ? reads[0].state as Unread : undefined;
  return <Fold inset title={`这次补发的 ${ids.length} 笔`} summary={summary} alert={missing > 0} open={expanded} onOpenChange={setExpanded}>
    {same ? <>
      <p className="rd-note"><StatusTag tone="warn">读不到</StatusTag> {UNREAD_TEXT[same]}；{NO_BLOCK}。{same === "failed" && retry(ids)}</p>
      <p className="rd-note" data-mono>{ids.join("、")}</p>
    </> : <>
      <p className="rd-note">{NOW_NOTE}；{NO_BLOCK}。</p>
      <div className="a2-f5-list" data-long={ids.length > 6 ? "" : undefined}>
        <Table label={`这次补发的 ${ids.length} 笔`} className="a2-f5-table">
          <thead><tr><Th>奖励记录</Th><Th>奖励类型</Th><Th align="right">金额</Th><Th>状态</Th></tr></thead>
          <tbody>
            {ids.map((id, index) => {
              const now = reads[index];
              if (now.state !== "found") return <Tr key={id}>
                <Td><Cell mono main={id} /></Td>
                <Td colSpan={3}>{now.state === "loading" ? <span className="rd-note">正在加载…</span>
                  : now.state === "missing" ? <StatusTag tone="danger">查无这笔记录</StatusTag>
                    : <><StatusTag tone="warn">读不到</StatusTag> {UNREAD_TEXT[now.state]}{now.state === "failed" && <> {retry([id])}</>}</>}</Td>
              </Tr>;
              const { record } = now;
              return <Tr key={id}>
                <Td><Cell mono main={id} sub={`用户 ${record.user}`} /></Td>
                <Td><Cell main={KIND_LABELS[record.kind] ?? "未知奖励类型"} /></Td>
                <Td align="right"><Cell num main={money(record)} /></Td>
                <Td><StatusBadge status={record.status} explain={false} /></Td>
              </Tr>;
            })}
          </tbody>
        </Table>
      </div>
    </>}
  </Fold>;
}
