"use client";

/**
 * F3 核对一期结算：点一条结算记录开的抽屉（残额、结算方式、经手人、审批单），和「被拦下的结算」记录。
 * 只读，不发请求。后端没给的写「没有记下」，不补 0、不用现在的名单补名字。
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, ReceiptText } from "lucide-react";
import {
  BlockState, Cell, Drawer, Explain, Fact, Facts, Fold, KeyValues, Pager, Panel, StatusTag, Table, TableMessage, Td, Th, Tr,
  type DrawerNav, type StateTone,
} from "@/app/components/rd";
import type { LucideIcon } from "lucide-react";
import { ADMIN_ERROR_MESSAGES } from "@/lib/admin/error-messages";
import type { F3BlockedSettlementAttempt, F3Settlement } from "@/lib/admin/f1-client";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import { useDataListPager } from "../design-kit";
import { residualLabel } from "./f3-rule";

const NONE = "没有记下";

/** 后端原值：去掉末尾 0，至少两位，不舍入。 */
const money = (raw: string | null | undefined) => {
  if (raw === null || raw === undefined) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(match[3] ?? "").replace(/0+$/, "").padEnd(2, "0")} USDT` : `${raw.trim()} USDT`;
};

const MODE: Record<string, string> = { MANUAL: "人工结算", AUTOMATIC: "自动结算" };
export const f3ModeText = (mode: string | null) => mode === null ? null : MODE[mode] ?? "方式没认出";

/** 发起人、批准人、审批单：自动结算本来就没有，人工结算没记下的写「没有记下」。 */
function people(mode: string | null, proposer: string | null, approver: string | null) {
  const auto = mode === "AUTOMATIC";
  return {
    proposer: proposer ?? (auto ? "系统按周期结算" : NONE),
    approver: approver ?? (auto ? "不用批准" : NONE),
  };
}

function TicketLink({ id, mode }: { id: string | null; mode: string | null }) {
  const reach = useReach();
  if (!id) return <>{mode === "AUTOMATIC" ? "不用审批" : NONE}</>;
  return reach("/platform/audit", "platform_a2_read")
    ? <Link className="rd-link" href={`/platform/audit?domain=F&object=${encodeURIComponent(id)}`} prefetch={false}>在操作记录与审批查看</Link>
    : <span className="f3-weak">有审批单，查看要有操作记录与审批的权限</span>;
}

/** 一条结算记录的核对抽屉。 */
export function F3SettlementDrawer({ row, state, nav, onClose }: {
  row: F3Settlement | null;
  state: { label: string; tone: StateTone; icon: LucideIcon; explain: string } | null;
  nav: DrawerNav;
  onClose: () => void;
}) {
  if (!row || !state) return <Drawer open={false} onClose={onClose} title="这一期结算">{null}</Drawer>;
  const reviewed = [row.residualTrackARaw, row.residualTrackBRaw, row.residualAmountUsdt, row.residualPolicy, row.settlementMode, row.proposerName, row.approverName, row.a2OperationId]
    .some((value) => value !== null);
  const who = people(row.settlementMode, row.proposerName, row.approverName);
  const amount = (raw: string | null | undefined, legacy: number) => raw === undefined ? `${legacy.toLocaleString("en-US")} USDT` : money(raw) ?? "—";
  const residualKnown = row.residualAmountUsdt !== null;
  return (
    <Drawer open onClose={onClose} title="这一期结算" icon={ReceiptText} tone="role-2" nav={nav}
      sub={<>{row.user} · 结算日 {row.settlementDate || "—"}</>}
      explain="核对这一期怎么结的：结算后两组还剩多少，谁发起、谁批准。名字是当时记下的。">
      <Facts>
        <Fact k="状态"><StatusTag tone={state.tone} icon={state.icon} explain={state.explain}>{state.label}</StatusTag></Fact>
        <Fact k="记账奖励" lead>{amount(row.todayRaw, row.today)}</Fact>
        <Fact k="匹配订单额">{amount(row.matchRaw, row.match)}</Fact>
        <Fact k="A 组订单额">{amount(row.aRaw, row.a)}</Fact>
        <Fact k="B 组订单额">{amount(row.bRaw, row.b)}</Fact>
      </Facts>
      {!reviewed
        ? <BlockState state="empty" compact title="这条结算没有核对记录" detail="残额、结算方式和经手人都没有记下，不是 0。" />
        : <>
          <div className="rd-detail-block">
            <Panel plain headingLevel={3} title="结算后剩下的订单额"
              explain="两组各扣掉这一期匹配上的部分后剩下的。残额取剩得多的一组，不是两组相加；按当时的残额处理算。">
              <KeyValues rows={[
                { key: "a", label: "A 组剩下", value: money(row.residualTrackARaw) ?? NONE },
                { key: "b", label: "B 组剩下", value: money(row.residualTrackBRaw) ?? NONE },
                { key: "pool", label: "残额", value: residualKnown ? <strong>{money(row.residualAmountUsdt)}</strong> : NONE },
                { key: "policy", label: "当时的残额处理", value: row.residualPolicy === null ? NONE : residualLabel(row.residualPolicy) },
              ]} />
            </Panel>
          </div>
          <div className="rd-detail-block">
            <Panel plain headingLevel={3} title="谁经手">
              <KeyValues rows={[
                { key: "mode", label: "结算方式", value: f3ModeText(row.settlementMode) ?? NONE },
                { key: "proposer", label: "发起人", value: who.proposer },
                { key: "approver", label: "批准人", value: who.approver },
                { key: "ticket", label: "审批单", value: <TicketLink id={row.a2OperationId} mode={row.settlementMode} /> },
              ]} />
            </Panel>
          </div>
        </>}
      <Fold inset title="技术信息" summary="结算号和审批单号">
        <KeyValues rows={[
          { key: "no", label: "结算号", value: row.settlementNo ?? "—", mono: true },
          { key: "a2", label: "审批单号", value: row.a2OperationId ?? "—", mono: true },
          { key: "mode", label: "结算方式原值", value: row.settlementMode ?? "—", mono: true },
          { key: "policy", label: "残额处理原值", value: row.residualPolicy ?? "—", mono: true },
        ]} />
      </Fold>
    </Drawer>
  );
}

const reasonText = (code: string | null) => code === null ? NONE : ADMIN_ERROR_MESSAGES[code] ?? "原因没有中文说明，见技术信息";

/** 被拦下的结算决定：独立的记录，最多最近 100 次；和「按结算日」里状态是被拦下的结算记录不是一回事。 */
export function F3BlockedAttempts({ attempts }: { attempts: F3BlockedSettlementAttempt[] | null }) {
  const [current, setCurrent] = useState<F3BlockedSettlementAttempt | null>(null);
  const pager = useDataListPager(attempts ?? [], { initialPageSize: 10, resetKey: String(attempts?.length ?? "none") });
  const latest = attempts?.[0];
  const summary = attempts === null ? "读不到这份记录"
    : attempts.length === 0 ? "没有被拦下的结算"
      : `最近 ${attempts.length.toLocaleString("en-US")} 次 · 最新 ${formatBusinessTimeCompact(latest!.blockedAt, "—")}`;
  const index = current ? pager.pageRows.indexOf(current) : -1;
  const nav: DrawerNav = {
    hasPrev: index > 0, hasNext: index >= 0 && index < pager.pageRows.length - 1,
    onPrev: () => index > 0 && setCurrent(pager.pageRows[index - 1]),
    onNext: () => index >= 0 && index < pager.pageRows.length - 1 && setCurrent(pager.pageRows[index + 1]),
  };
  let body: ReactNode;
  if (attempts === null) body = <BlockState state="empty" compact title="读不到被拦下的结算" detail="后台还没提供这份记录，不代表没有结算被拦下。" />;
  else if (attempts.length === 0) body = <BlockState state="empty" compact title="没有被拦下的结算" detail="开始记录以来没有结算被拦下。更早的看「按结算日」里的被拦下条数。" />;
  else body = <>
    <Table label="被拦下的结算" className="f3-blocked">
      <thead><tr>
        <Th>时间</Th>
        <Th>邀请人</Th>
        <Th>为什么被拦下</Th>
        <Th>怎么结的</Th>
      </tr></thead>
      <tbody>
        {pager.pageRows.map((row, i) => {
          const who = people(row.settlementMode, row.proposerName, row.approverName);
          const mode = f3ModeText(row.settlementMode);
          return (
            <Tr key={`${row.settlementNo}:${row.blockedAt}:${pager.startIndex + i}`} selected={row === current} onOpen={() => setCurrent(row)}>
              <Td><Cell num main={formatBusinessTimeCompact(row.blockedAt, "—")} /></Td>
              <Td><Cell main={<span data-mono>{row.ownerUserId ?? "—"}</span>} sub={`结算日 ${row.settlementDate ?? "—"}`} /></Td>
              <Td grow><Cell main={reasonText(row.reason)} title={reasonText(row.reason)} /></Td>
              <Td><Cell main={mode ?? NONE} sub={row.settlementMode === "MANUAL" ? `批准人 ${who.approver}` : undefined} /></Td>
            </Tr>
          );
        })}
        {pager.pageRows.length === 0 && <TableMessage columns={4}>没有被拦下的结算</TableMessage>}
      </tbody>
    </Table>
    {pager.total > 0 && <Pager label="被拦下的结算" total={pager.total} page={pager.page} pageSize={pager.pageSize} sizes={[10, 20, 50]}
      onPage={pager.setPage} onPageSize={pager.setPageSize} note={attempts.length >= 100 ? "只列最近 100 次" : undefined} />}
    <p className="f3-dates-note">时间为{businessZone().label}</p>
  </>;
  const who = current ? people(current.settlementMode, current.proposerName, current.approverName) : null;
  return (
    <>
      <Fold title="被拦下的结算" icon={Ban} tone="role-other" summary={summary}
        explain={<>
          <p>每次结算被拦下记一条：什么时候、为什么、谁经手。被拦下不发钱、不写结算记录，问题处理好后同一天还能再结。</p>
          <p>最多列最近 100 次，不是历史总数。「按结算日」里的「被拦下」是结算记录里状态为被拦下的条数，两边来源不同，数对不上是正常的。</p>
        </>}>
        {body}
      </Fold>
      {current && who
        ? <Drawer open onClose={() => setCurrent(null)} title="被拦下的结算" icon={Ban} tone="warn" nav={nav}
            sub={<>邀请人 {current.ownerUserId ?? "—"} · 结算日 {current.settlementDate ?? "—"}</>}
            explain="被拦下不发钱、不写结算记录；问题处理好后同一天还能再结。名字是当时记下的。">
            <Facts>
              <Fact k="时间">{formatBusinessTimeCompact(current.blockedAt, "—")}（{businessZone().label}）</Fact>
              <Fact k="为什么被拦下" tone="warn">{reasonText(current.reason)}</Fact>
              <Fact k="结算方式">{f3ModeText(current.settlementMode) ?? NONE}</Fact>
              <Fact k="发起人">{who.proposer}</Fact>
              <Fact k="批准人">{who.approver}</Fact>
              <Fact k="审批单"><TicketLink id={current.a2OperationId} mode={current.settlementMode} /></Fact>
            </Facts>
            <Fold inset title="技术信息" summary="结算号、审批单号和原因代码">
              <KeyValues rows={[
                { key: "no", label: "结算号", value: current.settlementNo, mono: true },
                { key: "a2", label: "审批单号", value: current.a2OperationId ?? "—", mono: true },
                { key: "reason", label: "原因代码", value: current.reason ?? "—", mono: true },
                { key: "mode", label: "结算方式原值", value: current.settlementMode ?? "—", mono: true },
              ]} />
            </Fold>
          </Drawer>
        : <Drawer open={false} onClose={() => setCurrent(null)} title="被拦下的结算">{null}</Drawer>}
    </>
  );
}

/** 表头旁的说明，和主表的「怎么结的」一列一起用。 */
export const F3_MODE_EXPLAIN = <Explain label="结算方式怎么看" side="bottom" content="自动结算是系统按周期结的；人工结算是有人提交、另一位批准后结的。没有核对记录的旧结算写「没有记下」。点一行看残额和经手人。" />;
