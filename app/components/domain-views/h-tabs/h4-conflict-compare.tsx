"use client";

/**
 * H4 玩法规则、创世抽奖保存被「别人先改过」拒绝后的三方对比：你打开时、别人改成、你填的。
 * 只列有差别的项。「按我填的提交」是整份换成你填的：别人改过、和你填的不一样的项都会被换掉（你没动的改回打开时的值），逐项列出来。
 * 两个出口：「按我填的提交」调 conflictReview.confirm（整份按你填的、理由重新填写）；
 * 「合并后再核对」由页面把你改的项放到最新配置上，回表单再保存。值原样显示，不舍入、空值不当 0。
 */
import type { ReactNode } from "react";
import { Button, Notice, StatusTag } from "@/app/components/rd";
import type { HConflictField } from "@/lib/admin/h-conflict-review";

type Which = "opened" | "latest" | "mine";
export type H4ConflictGroup = { key: string; label: string; opened: ReactNode; latest: ReactNode; mine: ReactNode; submitted?: ReactNode; byOther: boolean; byMe: boolean; overwritesOther: boolean };

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
  show: (key: string, value: unknown, which: Which) => ReactNode,
  options?: { equal?: (key: string, left: unknown, right: unknown) => boolean; submission?: ReadonlyMap<string, { latest: string; value: string }> }): H4ConflictGroup[] {
  const groups = new Map<string, HConflictField[]>();
  for (const field of fields) { const key = groupOf(field.path); groups.set(key, [...(groups.get(key) ?? []), field]); }
  return [...groups].flatMap(([key, leaves]) => {
    const byOther = leaves.some(leaf => leaf.changedByOther), byMe = leaves.some(leaf => leaf.changedByMe);
    if (!byOther && !byMe) return [];
    const raw = (which: Which) => rebuild(key, leaves.map(leaf => ({ path: leaf.path, value: leaf[which] })));
    const value = (which: Which) => show(key, raw(which), which);
    const submission = options?.submission?.get(key);
    const draft = raw("mine"), latest = submission?.latest ?? raw("latest"), after = submission?.value ?? draft;
    const overwritesOther = byOther && JSON.stringify(latest) !== JSON.stringify(after) && !options?.equal?.(key, latest, after);
    const submitted = submission && after !== draft ? show(key, after, "mine") : undefined;
    return [{ key, label: label(key), opened: value("opened"), latest: value("latest"), mine: value("mine"), submitted, byOther, byMe, overwritesOther }];
  });
}

/** 一组差别行；抽奖按奖项分组时带组标题和增删标记。 */
export type H4CompareSection = { key: string; title?: ReactNode; tags?: ReactNode; rows: H4ConflictGroup[];
  /** 增删过的整项：一行写完三份，不再分字段。 */
  whole?: { opened: ReactNode; latest: ReactNode; mine: ReactNode; byOther: boolean; byMe: boolean } };
/** 整份按我填的提交时，会被换掉的一处别人的修改。 */
export type H4Overwrite = { key: string; label: ReactNode; latest?: ReactNode; submitted?: ReactNode; note?: ReactNode };

export function H4ConflictCompare({ groups, sections, overwrites, structure, onMerge, onKeepMine, mergeDisabledReason }: {
  groups: H4ConflictGroup[]; sections?: H4CompareSection[]; overwrites?: H4Overwrite[]; structure?: ReactNode;
  onMerge: () => void; onKeepMine: () => void; mergeDisabledReason?: string;
}) {
  const lost: H4Overwrite[] = overwrites ?? groups.filter(group => group.overwritesOther).map(group => ({ key: group.key, label: group.label, latest: group.latest, submitted: group.submitted ?? group.mine }));
  const mine = groups.filter(group => group.byMe).length;
  const row = (group: H4ConflictGroup) => <tr key={group.key}>
    <th scope="row"><span className="h4-compare-name">{group.label}</span>
      {group.byOther && group.byMe ? <StatusTag tone="warn">两边都改了</StatusTag>
        : group.byOther ? <StatusTag tone="warn">只有别人改了</StatusTag> : <StatusTag tone="neutral">你改的</StatusTag>}</th>
    <td>{group.opened}</td>
    <td data-changed={group.byOther ? "" : undefined}>{group.byOther ? group.latest : <span className="h4-dim">没改</span>}</td>
    <td data-changed={group.byMe ? "" : undefined}>
      {group.byMe ? group.mine : <span className="h4-dim">没动</span>}
      {group.overwritesOther && (!group.byMe || group.submitted !== undefined) && <span className="h4-compare-lost">
        {group.submitted !== undefined ? <>提交后是 {group.submitted}</> : group.mine === "—" ? "按我填的提交会清空" : <>按我填的提交会改回 {group.mine}</>}
      </span>}
    </td>
  </tr>;
  return <Notice tone="warn" title="没有保存：你编辑时，别人先保存过">
    <div className="h4-compare">
      {structure}
      <table className="h4-compare-table" aria-label="三份值的差别">
        <thead><tr><th scope="col">项</th><th scope="col">你打开时</th><th scope="col">别人改成</th><th scope="col">你填的</th></tr></thead>
        {(sections ?? [{ key: "all", rows: groups }]).map(section => section.whole
          ? <tbody key={section.key}><tr data-whole="">
            <th scope="row"><span className="h4-compare-name">{section.title}</span><span className="h4-compare-tags">{section.tags}</span></th>
            <td>{section.whole.opened}</td><td data-changed={section.whole.byOther ? "" : undefined}>{section.whole.latest}</td><td data-changed={section.whole.byMe ? "" : undefined}>{section.whole.mine}</td>
          </tr></tbody>
          : <tbody key={section.key} data-section={section.title ? "" : undefined}>
            {section.title && <tr className="h4-compare-section"><th scope="rowgroup" colSpan={4}><span>{section.title}</span>{section.tags}</th></tr>}
            {section.rows.map(row)}
          </tbody>)}
      </table>
      <div className="h4-compare-choices">
        <div className="h4-compare-choice">
          <Button variant="primary" size="sm" disabledReason={mergeDisabledReason} onClick={onMerge}>合并后再核对</Button>
          <p>{mergeDisabledReason ?? `表单换成最新配置，再放回你改的 ${mine} 项；核对后点「保存配置」。`}</p>
        </div>
        <div className="h4-compare-choice">
          <Button size="sm" onClick={onKeepMine}>按我填的提交</Button>
          {lost.length ? <>
            <p>{`整份换成你填的，别人改过的 ${lost.length} 项会被换掉：`}</p>
            <ul className="h4-compare-lost-list">{lost.map(item => <li key={item.key}><b>{item.label}</b>{item.note ?? <>：别人改成 {item.latest}，{item.submitted === "—" ? "提交后清空" : <>提交后是 {item.submitted}</>}</>}</li>)}</ul>
          </> : <p>整份按你填的提交，理由沿用刚才填的。</p>}
        </div>
      </div>
    </div>
  </Notice>;
}
