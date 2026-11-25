"use client";

/**
 * J2 地区访问限制的两件页面专用小件，只管排版，不发请求：
 * - CountryEditor：改名单、改入口规则、应急批量封锁的第一步。选国家时随时看到「加了哪些、去了哪些、没变多少」，
 *   点「下一步」才进共用确认框（理由、提交锁和请求都在共用确认框里，和改版前一样）。
 * - CountryDiff：确认框关键信息层里的差异对照，加和去各写后果。
 */
import { useMemo, useState, type ReactNode } from "react";
import { Check, Minus, Plus, Replace, RotateCcw, Search, X } from "lucide-react";
import { Button, Checkbox, Explain, Fold, Input, Modal, Segments, StatusTag } from "@/app/components/rd";
import type { GeoCountryOption } from "@/lib/admin/j-client";

export type GeoStatus = "blocked" | "limited";
export const STATUS_TEXT: Record<GeoStatus, string> = { blocked: "封锁", limited: "受限" };

/** 空搜索时列前 40 个加已选的，和改版前的选择器一样（J2-H07）。 */
const FIRST_PAGE = 40;

export function countryName(cc: string, names: Record<string, string>) {
  return `${names[cc] ?? cc}（${cc}）`;
}

/** 一个国家：中文名在前，代码等宽小一档。 */
export function CountryLabel({ cc, names }: { cc: string; names: Record<string, string> }) {
  return <span className="j2-cc-label"><span>{names[cc] ?? cc}</span><span className="j2-cc-code" data-mono="">{cc}</span></span>;
}

export type EditorMode = "derived" | "explicit";
export type EditorResult = { codes: string[]; mode?: EditorMode };

export type EditorSpec = {
  kind: "blocked" | "limited" | "emergency" | "endpoint";
  title: string;
  /** 能选的国家，按后端目录的顺序。 */
  options: GeoCountryOption[];
  /** 框里第一块：改的是哪个对象（入口规则写入口名）。 */
  subject?: ReactNode;
  /** 应急批量封锁：现有封锁几个（只加不减，它们不变）。 */
  existingCount?: number;
  /** 打开时的名单（应急批量封锁是空的）。 */
  initial: string[];
  /** 从确认框「返回修改」回来时带着上次选的。 */
  draft?: EditorResult;
  /** 入口规则打开时的方式。 */
  initialMode?: EditorMode;
  /** 名单旁边要标出来的现状：「现在受限」「现在封锁」。 */
  statusOf: (cc: string) => GeoStatus | undefined;
  /** 不在候选里、但要说明为什么的国家（受限名单里排除的封锁国家）。 */
  excludedNote?: ReactNode;
  names: Record<string, string>;
  onNext: (result: EditorResult) => void;
};

function diffOf(initial: string[], codes: string[]) {
  const before = new Set(initial);
  const after = new Set(codes);
  return {
    added: codes.filter((cc) => !before.has(cc)),
    removed: initial.filter((cc) => !after.has(cc)),
    kept: initial.filter((cc) => after.has(cc)),
  };
}

export function CountryEditor({ spec, onClose, blockedReason }: { spec: EditorSpec; onClose: () => void; blockedReason?: string }) {
  const { kind, options, initial, names, statusOf } = spec;
  const [codes, setCodes] = useState<string[]>(() => spec.draft?.codes ?? (kind === "emergency" ? [] : [...initial]));
  const [mode, setMode] = useState<EditorMode>(spec.draft?.mode ?? spec.initialMode ?? "derived");
  const [query, setQuery] = useState("");
  const listed = kind !== "endpoint" || mode === "explicit";
  const effective = listed ? codes : [];
  const { added, removed, kept } = diffOf(initial, effective);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const values = options.map((option) => option.value);
    const matched = q ? values.filter((cc) => `${cc} ${names[cc] ?? ""}`.toLocaleLowerCase().includes(q)) : values;
    return !q && matched.length > FIRST_PAGE ? [...new Set([...codes.filter((cc) => values.includes(cc)), ...matched.slice(0, FIRST_PAGE)])] : matched;
  }, [codes, names, options, query]);

  // 逐项切换，加在末尾：应急批量封锁按点选的顺序提交，和改版前一样（J2-H07）。
  const toggle = (cc: string) => setCodes((current) => current.includes(cc) ? current.filter((item) => item !== cc) : [...current, cc]);
  const modeChanged = kind === "endpoint" && mode !== (spec.initialMode ?? "derived");
  const changed = added.length + removed.length > 0 || modeChanged;
  const blocked = kind === "emergency"
    ? (codes.length === 0 ? "先选要封锁的国家或地区" : undefined)
    : kind === "endpoint" && mode === "explicit" && codes.length === 0 ? "单独设定至少选一个国家或地区"
      : !changed ? (kind === "endpoint" ? "规则没有改动" : "名单没有改动") : undefined;

  const sub = kind === "emergency" ? <StatusTag tone="neutral" icon={Plus}>只加不减</StatusTag>
    : kind === "endpoint" ? undefined
      : <StatusTag tone="neutral" icon={Replace}>提交的是整份名单</StatusTag>;
  const addWord = kind === "emergency" ? "加封" : "加";

  return (
    <Modal title={spec.title} wide onClose={onClose} className="j2-editor" sub={sub}
      dirty={changed || (kind === "emergency" && codes.length > 0)}
      footer={<>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabledReason={blockedReason ?? blocked} onClick={() => spec.onNext({ codes: effective, mode: kind === "endpoint" ? mode : undefined })}>下一步：核对改动</Button>
      </>}>
      {spec.subject}
      {kind === "endpoint" && (
        <div className="j2-editor-mode">
          <span className="j2-editor-label">设置方式<Explain label="设置方式说明" rows={[
            { k: "继承全局", v: "这个入口只按封锁名单和受限名单处理，不另外封锁国家。" },
            { k: "单独设定", v: "在全局名单之外，再封锁选中的国家：这些国家的用户不能用这个入口（浏览也不行）。封锁名单里的国家照样先被拒，单独设定不能给它们开口子。" },
          ]} /></span>
          <Segments label="设置方式" value={mode} onChange={setMode} items={[{ value: "derived", label: "继承全局" }, { value: "explicit", label: "单独设定" }]} />
        </div>
      )}

      <div className="j2-editor-diff" aria-live="polite" data-proof="j2-editor-diff">
        <span className="j2-editor-count" data-tone={added.length ? "add" : undefined}><Plus size={14} aria-hidden />{addWord} <b>{added.length}</b> 个</span>
        {kind !== "emergency" && <span className="j2-editor-count" data-tone={removed.length ? "remove" : undefined}><Minus size={14} aria-hidden />去 <b>{removed.length}</b> 个</span>}
        {kind !== "emergency" && <span className="j2-editor-count"><Check size={14} aria-hidden />不变 <b>{kept.length}</b> 个</span>}
        {kind === "emergency" && <span className="j2-editor-count"><Check size={14} aria-hidden />现有封锁 <b>{spec.existingCount ?? 0}</b> 个不变</span>}
      </div>

      {listed && (
        <section className="j2-editor-block" aria-label={kind === "emergency" ? "要封锁的国家或地区" : "名单里的国家或地区"}>
          <h3 className="j2-editor-label">{kind === "emergency" ? `要封锁的（${codes.length}）` : `名单里（${codes.length}）`}</h3>
          {codes.length === 0
            ? <p className="j2-editor-empty">{kind === "emergency" ? "还没选。在下面搜索并勾选。" : kind === "endpoint" ? "还没选。单独设定至少选一个。" : "名单是空的。提交后这份名单里没有国家或地区。"}</p>
            : <ul className="j2-chips">
              {codes.map((cc) => (
                <li key={cc} className="rd-chip j2-chip" data-new={initial.includes(cc) ? undefined : ""}>
                  <CountryLabel cc={cc} names={names} />
                  {!initial.includes(cc) && <span className="j2-chip-mark">新加</span>}
                  <button type="button" className="rd-chip-x" aria-label={`从名单去掉${countryName(cc, names)}`} onClick={() => toggle(cc)}><X size={14} aria-hidden /></button>
                </li>
              ))}
            </ul>}
          {removed.length > 0 && (
            <div className="j2-editor-removed">
              <span className="j2-editor-label">要去掉的（{removed.length}）</span>
              <ul className="j2-chips">
                {removed.map((cc) => (
                  <li key={cc} className="rd-chip j2-chip" data-removed="">
                    <CountryLabel cc={cc} names={names} />
                    <button type="button" className="rd-chip-x" aria-label={`把${countryName(cc, names)}放回名单`} title="放回名单" onClick={() => toggle(cc)}><RotateCcw size={13} aria-hidden /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {listed && (
        <section className="j2-editor-block" aria-label="找国家或地区">
          <label className="j2-editor-search">
            <Search size={14} aria-hidden />
            <Input type="search" data-search="" aria-label="搜索国家代码或名称" placeholder="搜索国家代码或名称" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {spec.excludedNote && <p className="j2-editor-note">{spec.excludedNote}</p>}
          {options.length === 0 ? <p className="j2-editor-empty">当前没有可选的国家或地区</p>
            : visible.length === 0 ? <p className="j2-editor-empty">没找到「{query.trim()}」，换个代码或中文名试试。<button type="button" className="rd-link j2-linkbtn" onClick={() => setQuery("")}>清空搜索</button></p>
              : <ul className="j2-pick" data-proof="j2-editor-options">
                {visible.map((cc) => {
                  const status = statusOf(cc);
                  const on = codes.includes(cc);
                  return (
                    <li key={cc}>
                      <label className="j2-pick-row" data-on={on ? "" : undefined}>
                        <Checkbox checked={on} onChange={() => toggle(cc)} />
                        <CountryLabel cc={cc} names={names} />
                        {status && <span className="j2-pick-status" data-status={status}>现在{STATUS_TEXT[status]}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>}
          {!query.trim() && options.length > visible.length && <p className="j2-editor-note">显示 {visible.length} / {options.length} 个，输入代码或名称找其他的</p>}
        </section>
      )}

      {!listed && <p className="j2-editor-note">{initial.length > 0 ? `改成继承全局后，原来单独封锁的 ${initial.length} 个国家或地区会去掉，这个入口只按全局名单处理。` : "这个入口只按封锁名单和受限名单处理。"}</p>}
    </Modal>
  );
}

/** 确认框关键信息层：加的、去的分开写后果，没变的收起来。 */
export function CountryDiff({ initial, codes, names, statusOf, addTitle, addEffect, removeTitle, removeEffect, keptTitle, impact, onBack, backDisabled, asOf = "现在" }: {
  initial: string[];
  codes: string[];
  names: Record<string, string>;
  statusOf: (cc: string) => GeoStatus | undefined;
  addTitle: string;
  addEffect: ReactNode;
  removeTitle?: string;
  removeEffect?: ReactNode;
  keptTitle?: string;
  /** 加进来的这几个按账户国家统计的人数和余额。 */
  impact?: ReactNode;
  onBack?: () => void;
  /** 结果未知期间原请求已锁定：返回修改不可用，写原因。 */
  backDisabled?: string;
  /** 国家旁标的状态是什么时候的：新操作写「现在」，恢复原操作写「提交时」。 */
  asOf?: string;
}) {
  const { added, removed, kept } = diffOf(initial, codes);
  const chip = (cc: string, mark?: ReactNode) => (
    <li key={cc} className="rd-chip j2-chip"><CountryLabel cc={cc} names={names} />{mark}</li>
  );
  return (
    <div className="j2-diff" data-proof="j2-confirm-diff">
      {added.length > 0 && (
        <section className="j2-diff-group" data-tone="add">
          <h3 className="j2-diff-head"><Plus size={14} aria-hidden />{addTitle} <b>{added.length}</b> 个</h3>
          <ul className="j2-chips">{added.map((cc) => chip(cc, statusOf(cc) && <span className="j2-chip-mark">{asOf}{STATUS_TEXT[statusOf(cc)!]}</span>))}</ul>
          <p className="j2-diff-effect">{addEffect}</p>
          {impact && <p className="j2-diff-impact">{impact}</p>}
        </section>
      )}
      {removeTitle && removed.length > 0 && (
        <section className="j2-diff-group" data-tone="remove">
          <h3 className="j2-diff-head"><Minus size={14} aria-hidden />{removeTitle} <b>{removed.length}</b> 个</h3>
          <ul className="j2-chips">{removed.map((cc) => chip(cc))}</ul>
          <p className="j2-diff-effect">{removeEffect}</p>
        </section>
      )}
      {keptTitle && (kept.length > 0
        ? <Fold inset title={keptTitle} summary={`${kept.length} 个，不受这次修改影响`}><ul className="j2-chips">{kept.map((cc) => chip(cc))}</ul></Fold>
        : <p className="j2-diff-none">{keptTitle}：没有</p>)}
      {onBack && <div className="j2-diff-back"><Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} disabledReason={backDisabled} onClick={onBack}>返回修改</Button></div>}
    </div>
  );
}
