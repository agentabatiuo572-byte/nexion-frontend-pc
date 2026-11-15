"use client";

/**
 * H4 玩法规则、创世抽奖保存被「别人先改过」拒绝后的三方对比：你打开时、别人改成、你填的。
 * 只列有差别的项；别人改了你没动的项单独标出来——按你填的提交会把它改回打开时的值。
 * 两个出口：「按我填的提交」调原来的 conflictReview.confirm（整份按你填的、带原理由）；
 * 「合并后再核对」由页面把你改的项放到最新配置上，回表单再保存。值原样显示，不舍入、空值不当 0。
 */
import type { ReactNode } from "react";
import { Button, Notice, StatusTag } from "@/app/components/rd";
import type { HConflictField } from "@/lib/admin/h-conflict-review";

type Which = "opened" | "latest" | "mine";
export type H4ConflictGroup = { key: string; label: string; opened: ReactNode; latest: ReactNode; mine: ReactNode; byOther: boolean; byMe: boolean };

/** 把一组叶子按路径拼回原来的值（数组、对象），给页面按自己的写法显示。 */
function rebuild(key: string, leaves: Array<{ path: string; value: unknown }>): unknown {
  let root: unknown;
  for (const { path, value } of leaves) {
    if (value === undefined) continue;
    const rest = path === key ? [] : path.slice(key.length + 1).split(".");
    if (!rest.length) return value;
    root ??= /^\d+$/.test(rest[0]) ? [] : {};
    let node = root as Record<string, unknown>;
    rest.forEach((part, index) => {
      if (index === rest.length - 1) { node[part] = value; return; }
      node[part] ??= /^\d+$/.test(rest[index + 1]) ? [] : {};
      node = node[part] as Record<string, unknown>;
    });
  }
  return root;
}

export function h4ConflictGroups(fields: HConflictField[], groupOf: (path: string) => string, label: (key: string) => string,
  show: (key: string, value: unknown) => ReactNode): H4ConflictGroup[] {
  const groups = new Map<string, HConflictField[]>();
  for (const field of fields) { const key = groupOf(field.path); groups.set(key, [...(groups.get(key) ?? []), field]); }
  return [...groups].flatMap(([key, leaves]) => {
    const byOther = leaves.some(leaf => leaf.changedByOther), byMe = leaves.some(leaf => leaf.changedByMe);
    if (!byOther && !byMe) return [];
    const value = (which: Which) => show(key, rebuild(key, leaves.map(leaf => ({ path: leaf.path, value: leaf[which] }))));
    return [{ key, label: label(key), opened: value("opened"), latest: value("latest"), mine: value("mine"), byOther, byMe }];
  });
}

export function H4ConflictCompare({ groups, onMerge, onKeepMine }: { groups: H4ConflictGroup[]; onMerge: () => void; onKeepMine: () => void }) {
  const otherOnly = groups.filter(group => group.byOther && !group.byMe).length;
  const mine = groups.filter(group => group.byMe).length;
  return <Notice tone="warn" title="没有保存：你编辑时，别人先保存过">
    <div className="h4-compare">
      <table className="h4-compare-table" aria-label="三份值的差别">
        <thead><tr><th scope="col">项</th><th scope="col">你打开时</th><th scope="col">别人改成</th><th scope="col">你填的</th></tr></thead>
        <tbody>{groups.map(group => <tr key={group.key}>
          <th scope="row"><span className="h4-compare-name">{group.label}</span>
            {group.byOther && group.byMe ? <StatusTag tone="warn">两边都改了</StatusTag>
              : group.byOther ? <StatusTag tone="warn">只有别人改了</StatusTag> : <StatusTag tone="neutral">你改的</StatusTag>}</th>
          <td>{group.opened}</td>
          <td data-changed={group.byOther ? "" : undefined}>{group.byOther ? group.latest : <span className="h4-dim">没改</span>}</td>
          <td data-changed={group.byMe ? "" : undefined}>{group.byMe ? group.mine : <span className="h4-dim">没动</span>}</td>
        </tr>)}</tbody>
      </table>
      <div className="h4-compare-choices">
        <div className="h4-compare-choice">
          <Button variant="primary" size="sm" onClick={onMerge}>合并后再核对</Button>
          <p>表单换成最新配置，再放回你改的 {mine} 项；核对后点「保存配置」。</p>
        </div>
        <div className="h4-compare-choice">
          <Button size="sm" onClick={onKeepMine}>按我填的提交</Button>
          <p>{otherOnly ? `整份按你填的提交：别人改的 ${otherOnly} 项会改回你打开时的值。` : "整份按你填的提交，理由沿用刚才填的。"}</p>
        </div>
      </div>
    </div>
  </Notice>;
}
