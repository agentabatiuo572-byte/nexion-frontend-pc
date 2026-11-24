"use client";

/**
 * F1「V8 审核」页签（画板 A6、A7）：已满足 V8 数值条件的 V7。不是待办：审核不通过的不用处理，留在名单里，系统也不会自动升 V8。
 * 「审核通过」走现有人工改级（A2 审批），用户、目标等级 V8、方向升级预先填好（确认框在 f1-vrank 里开）。
 * F1-RANK-WIRE：名单数据来自 ctx.v8Review（B88-BE-02），加载更多调 ctx.queryV8Review(true)。
 */
import { CircleCheck, Hourglass, UserCheck } from "lucide-react";
import { BlockState, Button, Cell, Panel, StatusTag, Table, TableLoading, Td, Th, Tr } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fmtNum } from "@/lib/format";
import type { FViewCtx } from "./types";
import type { F1RankRowView, F1V8Candidate, F1V8ReviewState } from "./f1-rank-types";

const num = (raw: string) => /^\d+$/.test(raw.trim()) ? fmtNum(Number(raw)) : raw.trim() || "—";

export function F1V8Review({ ctx, state, v8, canApprove, onApprove }: {
  ctx: FViewCtx;
  state: F1V8ReviewState;
  v8: F1RankRowView | undefined;
  canApprove: boolean;
  onApprove: (candidate: F1V8Candidate) => void;
}) {
  const rows = state.items;
  const sent = rows.filter((row) => row.pendingV8Proposal).length;
  const zone = businessZone().label;
  const req = (text: string | undefined) => text ? <span className="f1-th-req">≥ {text}</span> : null;
  const leader = v8 && Number(v8.legCount ?? "0") > 0 && v8.legRank && v8.legRank !== "NONE" ? `${v8.legCount} 个 ${v8.legRank}` : undefined;
  const sub = rows.length === 0 ? undefined
    : state.nextCursor
      ? `已加载 ${rows.length} 人 · ${state.pendingReviewCount ?? "—"} 人可审核 · 时间为${zone}`
      : `${state.pendingReviewCount ?? "—"} 人可审核 · ${sent} 人待审批 · 时间为${zone}`;
  return (
    <Panel title="已满足 V8 数值条件" icon={UserCheck} tone="role-3" flush sub={sub}
      explain={<><p>名单里是已满足 V8 数值条件的 V7。核对推荐信、做完官方审核后点「审核通过」；审核不通过的不用处理，系统不会自动升 V8。</p>
        <p>驳回或撤回后回到名单，原因在「操作记录与审批」看；已提交的人数值掉下去也不会自动撤单。</p></>}>
      {state.error && rows.length === 0
        ? <BlockState state="error" title="V8 审核名单读取失败" detail={state.error} onRetry={ctx.queryV8Review ? () => void ctx.queryV8Review!() : undefined} retrying={state.loading} />
        : rows.length === 0 && !state.loading
          ? <BlockState state="empty" title="还没有 V7 满足 V8 数值条件" detail="V1–V8 各级数值条件都满足的 V7 会列在这里；系统不会自动升到 V8。" />
          : <Table label="已满足 V8 数值条件" className="f1-table f1-v8-table">
            <thead><tr>
              <Th>用户</Th>
              <Th align="right">自购算力点{req(v8?.selfBuy && v8.selfBuy !== "0" ? num(v8.selfBuy) : undefined)}</Th>
              <Th align="right">团队算力点{req(v8?.teamGv && v8.teamGv !== "0" ? num(v8.teamGv) : undefined)}</Th>
              <Th align="right">一二级已购人数{req(v8?.directRefs && v8.directRefs !== "0" ? num(v8.directRefs) : undefined)}</Th>
              <Th align="right">下级领导者{req(leader)}</Th>
              <Th>邀请人</Th>
              <Th align="right" sticky="end">操作</Th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <TableLoading columns={7} /> : rows.map((row) => (
                <Tr key={row.userId}>
                  <Td><Cell mono main={row.userCode || "—"} sub={<span className="f5-sans">{row.nickname || "—"}</span>} /></Td>
                  <Td align="right"><Cell num main={num(row.selfComputePoints)} /></Td>
                  <Td align="right"><Cell num main={num(row.teamComputePoints)} /></Td>
                  <Td align="right"><Cell num main={`${num(row.directRefs)} 人`} /></Td>
                  <Td align="right"><Cell num main={v8?.legRank && v8.legRank !== "NONE" ? `${num(row.qualifiedDownlineCount)} 个 ${v8.legRank} 及以上` : num(row.qualifiedDownlineCount)} /></Td>
                  <Td><Cell mono main={row.inviterCode || "—"} sub={row.inviterCode ? <span className="f5-sans">{row.inviterNickname || "—"}</span> : undefined} /></Td>
                  <Td align="right" sticky="end" data-fit="">{row.pendingV8Proposal
                    ? <Cell main={<StatusTag tone="progress" icon={Hourglass}>待审批</StatusTag>}
                      sub={row.pendingV8ProposalCreatedAt ? <span className="f5-sans">已提交 {formatBusinessTimeCompact(row.pendingV8ProposalCreatedAt, "—")}</span> : undefined} />
                    : canApprove
                      ? <Button size="sm" icon={<CircleCheck size={14} aria-hidden />} aria-label={`审核通过 ${row.nickname || row.userCode}`} onClick={() => onApprove(row)}>审核通过</Button>
                      : <span className="f1-weak">—</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>}
      {rows.length > 0 && (state.nextCursor || state.error) && ctx.queryV8Review && <div className="f1-more">
        {state.error && <span className="f1-more-error" role="alert">没有加载到更多 · {state.error}</span>}
        <Button size="sm" loading={state.loading} onClick={() => void ctx.queryV8Review!(true)}>{state.error ? "重试" : "加载更多"}</Button>
      </div>}
    </Panel>
  );
}
