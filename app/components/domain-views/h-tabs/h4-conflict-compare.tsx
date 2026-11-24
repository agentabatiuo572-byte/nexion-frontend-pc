"use client";

/**
 * H4 玩法规则、创世抽奖保存被「别人先改过」拒绝后的三方对比：你打开时、别人改成、你填的。
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
  show: (key: string, value: unknown, which: Which) => ReactNode): H4ConflictGroup[] {
  const groups = new Map<string, HConflictField[]>();
  for (const field of fields) { const key = groupOf(field.path); groups.set(key, [...(groups.get(key) ?? []), field]); }
  return [...groups].flatMap(([key, leaves]) => {
    const byOther = leaves.some(leaf => leaf.changedByOther), byMe = leaves.some(leaf => leaf.changedByMe);
    if (!byOther && !byMe) return [];
    const raw = (which: Which) => rebuild(key, leaves.map(leaf => ({ path: leaf.path, value: leaf[which] })));
    const value = (which: Which) => show(key, raw(which), which);
    return [{ key, label: label(key), opened: value("opened"), latest: value("latest"), mine: value("mine"), byOther, byMe }];
  });
}

/** 一组差别行；抽奖按奖项分组时带组标题和增删标记。 */
export type H4CompareSection = { key: string; title?: ReactNode; tags?: ReactNode; rows: H4ConflictGroup[];
  /** 增删过的整项，以及另一侧仍有的字段改动。 */
  whole?: { opened: ReactNode; latest: ReactNode; mine: ReactNode; byOther: boolean; byMe: boolean } };
export function H4ConflictCompare({ groups, sections, onMerge, mergeDisabledReason }: {
  groups: H4ConflictGroup[]; sections?: H4CompareSection[];
  onMerge: () => void; mergeDisabledReason?: string;
}) {
  const mine = groups.filter(group => group.byMe).length;
  const same = (sections ?? [{ key: "all", rows: groups }]).every(section => !section.whole && !section.rows.length);
  const row = (group: H4ConflictGroup) => <tr key={group.key}>
    <th scope="row"><span className="h4-compare-name">{group.label}</span>
      {group.byOther && group.byMe ? <StatusTag tone="warn">两边都改了</StatusTag>
        : group.byOther ? <StatusTag tone="warn">只有别人改了</StatusTag> : <StatusTag tone="neutral">你改的</StatusTag>}</th>
    <td>{group.opened}</td>
    <td data-changed={group.byOther ? "" : undefined}>{group.byOther ? group.latest : <span className="h4-dim">没改</span>}</td>
    <td data-changed={group.byMe ? "" : undefined}>
      {group.byMe ? group.mine : <span className="h4-dim">没动</span>}
    </td>
  </tr>;
  return <Notice tone="warn" title="没有保存：你编辑时，别人先保存过">
    <div className="h4-compare">
      {same ? <p>最新内容和你打开时一样，没有要合并的差别。</p> : <table className="h4-compare-table" aria-label="三份值的差别">
        <thead><tr><th scope="col">项</th><th scope="col">你打开时</th><th scope="col">别人改成</th><th scope="col">你填的</th></tr></thead>
        {(sections ?? [{ key: "all", rows: groups }]).map(section => section.whole
          ? <tbody key={section.key}><tr data-whole="">
            <th scope="row"><span className="h4-compare-name">{section.title}</span><span className="h4-compare-tags">{section.tags}</span></th>
            <td>{section.whole.opened}</td><td data-changed={section.whole.byOther ? "" : undefined}>{section.whole.latest}</td><td data-changed={section.whole.byMe ? "" : undefined}>{section.whole.mine}</td>
          </tr>{section.rows.map(row)}</tbody>
          : <tbody key={section.key} data-section={section.title ? "" : undefined}>
            {section.title && <tr className="h4-compare-section"><th scope="rowgroup" colSpan={4}><span>{section.title}</span>{section.tags}</th></tr>}
            {section.rows.map(row)}
          </tbody>)}
      </table>}
      <div className="h4-compare-choices">
        <div className="h4-compare-choice">
          <Button variant="primary" size="sm" disabledReason={mergeDisabledReason} onClick={onMerge}>合并后再核对</Button>
          <p>{mergeDisabledReason ?? (mine ? `表单换成最新配置，再放回你改的 ${mine} 项；核对后点「保存配置」。` : <>表单换成最新配置；<span className="rd-keep">核对后点「保存配置」。</span></>)}</p>
        </div>
      </div>
    </div>
  </Notice>;
}
