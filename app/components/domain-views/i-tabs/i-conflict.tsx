"use client";

/**
 * 内容与触达五页（I1–I4、I6）共用的「刚被别人改过」核对框。
 * 第一次提交被后端以版本对不上明确拒绝后，页面已重读最新值、留住运营填的内容和理由；这里把两边并排给运营看。
 * 「按最新的重新填写」只重建编辑器或确认框（输入和理由留着），不发请求；运营核对后再点原来的提交。
 * 读取失败时不能继续；关掉框不丢记录，页面上留一条提醒可以再打开。
 */
import { useState, type ReactNode } from "react";
import { History, RefreshCw } from "lucide-react";
import { BlockState, Button, Modal, Notice, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import type { IConflictReview } from "@/lib/admin/i-conflict-review";

/** 一行对照：left、right 两列的表头由 columns 定（编辑类写「现在 / 你填的」，确认类写「你打开时 / 现在」）。 */
export type IConflictRow = { label: string; left: ReactNode; right: ReactNode; changed?: boolean };

/** 框开着还是收起：每次新的冲突都重新打开。 */
export function useIConflictView(review: IConflictReview<unknown, unknown> | null) {
  const [hidden, setHidden] = useState<unknown>(null);
  return {
    open: !!review && hidden !== review.requested,
    hide: () => setHidden(review?.requested ?? null),
    show: () => setHidden(null),
  };
}

export function IConflictModal({ review, subject, rows, columns, gone, note, rebuildLabel = "按最新的重新填写", onReread, onRebuild, onDiscard, onClose }: {
  review: IConflictReview<unknown, unknown>;
  /** 改的是哪一项，比如「文案 home.title」。 */
  subject: ReactNode;
  rows: IConflictRow[];
  columns: [left: string, right: string];
  /** 最新读取里这一项已经没有了（删掉、下架、状态变了）：写原因，不能重新填写，只能放弃。 */
  gone?: string;
  /** 重新填写之后还要注意的一句，比如「三语核对要重新勾」。 */
  note?: ReactNode;
  rebuildLabel?: string;
  onReread: () => void;
  onRebuild: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const waiting = review.reading ? "正在读取最新的" : review.readError ? "最新的没读到，重新读取后再继续" : undefined;
  return (
    <Modal title="刚被别人改过" icon={History} onClose={onClose} footer={<>
      <Button onClick={onClose}>稍后</Button>
      <Button disabledReason={waiting} onClick={onDiscard}>放弃这次修改</Button>
      <Button variant="primary" disabledReason={waiting ?? gone} onClick={onRebuild}>{rebuildLabel}</Button>
    </>}>
      <div className="rd-stack i-conflict">
        <p><b>{subject}</b>：别人先改了，这次没有保存；你填的内容和理由还在。</p>
        {review.reading
          ? <BlockState state="loading" title="正在读取最新的…" />
          : review.readError
            ? <Notice tone="danger" title="最新的没读到" action={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={onReread}>重新读取</Button>}>{review.readError}</Notice>
            : gone
              ? <Notice tone="warn">{gone}</Notice>
              : rows.length > 0 && <Table label="最新的和你的对照" className="i-conflict-table">
                <thead><tr><Th>项目</Th><Th>{columns[0]}</Th><Th>{columns[1]}</Th></tr></thead>
                <tbody>
                  {rows.map((row) => <Tr key={row.label}>
                    <Td><span className="i-conflict-label">{row.label}{row.changed && <StatusTag tone="warn">不一样</StatusTag>}</span></Td>
                    <Td><span className="i-conflict-value" data-user-content="">{row.left}</span></Td>
                    <Td><span className="i-conflict-value" data-user-content="">{row.right}</span></Td>
                  </Tr>)}
                </tbody>
              </Table>}
        {note && !review.reading && !review.readError && !gone && <p className="rd-note">{note}</p>}
      </div>
    </Modal>
  );
}

/** 核对框收起后留在页面上的提醒；核对完才能发起新的修改。 */
export function IConflictPending({ subject, onOpen }: { subject: ReactNode; onOpen: () => void }) {
  return <Notice tone="warn" title={<>{subject}刚被别人改过，还没核对</>} action={<Button size="sm" onClick={onOpen}>核对</Button>}>核对完才能发起新的修改。</Notice>;
}

/** 两边一样不标；空值写「—」。 */
export function conflictRow(label: string, left: unknown, right: unknown): IConflictRow {
  const text = (value: unknown) => value === undefined || value === null || String(value).trim() === "" ? "—" : String(value);
  return { label, left: text(left), right: text(right), changed: text(left) !== text(right) };
}
