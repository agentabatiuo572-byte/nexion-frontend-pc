/**
 * 源码结构判定的统一剥注释器。
 *
 * why:子串 / 正则判据直接跑在原文上时,「删掉真实现 + 把声明挪进注释」就能骗绿
 * (2026-08-06 实测走私路径:pending-idempotency 哨兵的 MIGRATED 判据)。
 * 凡是「代码里必须存在 X」这类判定,一律先过本函数。
 *
 * 🔴 两条不变量,改这里必须同步看 pending-idempotency-key-sentinel.mjs 的判据 0b 自检:
 *   ① 行注释判据必须用 `/gm`(多行模式下 `$` 匹配 \r 之前),**不要改成按行
 *      `split("\n").map(l => l.replace(/\/\/.*$/, ""))`** —— 那种写法在 CRLF 文件上
 *      从来不生效(`.` 不匹配 \r,行尾 \r 挡在 `$` 前),门对注释走私恒绿。本仓文件是 CRLF。
 *   ② `(^|[^:])` 守卫不能删 —— 删了会把 `"https://x"` 截成 `"https:`,正常代码被当注释吃掉。
 */
export function stripComments(source, { html = false } = {}) {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (html) out = out.replace(/<!--[\s\S]*?-->/g, "");
  return out;
}
