/**
 * 术语匹配(纯函数,无 React 依赖,便于边界用例直测)。
 *
 * AutoGloss 的匹配边界规则:
 *  ① 守护词区间内不拆解(中文无空格词边界,子串匹配会跨词误伤,如「累计提现」拆出「计提」)。
 *  ② **拉丁字母词边界**:首/尾字符是拉丁字母的术语,不得在另一个拉丁单词内部命中。
 *     例:术语 `pt` 不得命中 `Acceptance` / `prompt` 里的 `pt` 子串(#153),
 *     但 `5pt`、`5 pt` 这类独立 token 仍要提示。
 *     数字不算词边界字符 —— 术语解释本身写作「1pt = 1%」,`1pt` 属独立 token。
 *  ③ 长词优先(调用方传入已按长度降序的术语表),避免「质押池」先被「质押」截断。
 */

const LATIN = /[A-Za-z]/;

export type GlossaryHit = { start: number; end: number; term: string };

/**
 * 用固定术语表建一个匹配器。正则只在建匹配器时编译一次 —— 调用方(AutoGloss)
 * 在模块级建一次即可,渲染路径上不再重复编译。
 * `terms` 必须已按长度降序(长词优先);`guards` 为守护词(整体语义 ≠ 内部术语的完整词)。
 */
export function createGlossaryMatcher(terms: readonly string[], guards: readonly string[] = []) {
  const usable = terms.filter((term) => term.length > 0);
  const pattern = usable.length
    ? new RegExp("(" + usable.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g")
    : null;

  return function match(text: string): GlossaryHit[] {
    if (!text || !pattern) return [];
    const guardRanges: Array<[number, number]> = [];
    for (const guard of guards) {
      if (!guard) continue;
      for (let i = text.indexOf(guard); i >= 0; i = text.indexOf(guard, i + guard.length)) {
        guardRanges.push([i, i + guard.length]);
      }
    }

    const hits: GlossaryHit[] = [];
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const term = match[0];
      const start = match.index;
      const end = start + term.length;
      // 守护词内部:整体语义 ≠ 该术语,跳过。
      if (guardRanges.some(([gs, ge]) => start >= gs && end <= ge)) continue;
      // 拉丁词内部:术语首尾被英文字母包夹 → 是别的单词的碎片,跳过。
      if (LATIN.test(term.charAt(0)) && start > 0 && LATIN.test(text.charAt(start - 1))) continue;
      if (LATIN.test(term.charAt(term.length - 1)) && end < text.length && LATIN.test(text.charAt(end))) continue;
      hits.push({ start, end, term });
    }
    return hits;
  };
}
