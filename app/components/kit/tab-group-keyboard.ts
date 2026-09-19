/**
 * TabGroup 的键盘移动规则 —— 抽成纯函数,让「方向键 / Home / End 落在哪一项」这条
 * 可访问性契约能被直接跑,而不必靠 DOM 事件模拟去间接推断。
 *
 * 规则(WAI-ARIA tabs 手动激活的简化版:本仓分段控件点击即生效,故方向键也立即选中):
 * - ArrowRight / ArrowDown → 下一项;ArrowLeft / ArrowUp → 上一项;两端环绕。
 * - Home → 第一项;End → 最后一项。
 * - disabled 项跳过(调用方传入的 items 已是可选项)。
 * - 当前值不在可选项里(如整组禁用后恢复)时,向右取第一项、向左取最后一项。
 * - 其它按键返回 null,调用方不得 preventDefault,也不得改选中态。
 */
export function nextTabValue<T extends string | number>(
  items: readonly T[],
  value: T,
  key: string,
): T | null {
  if (!items.length) return null;
  const current = items.indexOf(value);
  if (key === "ArrowRight" || key === "ArrowDown") {
    return current < 0 ? items[0] : items[(current + 1) % items.length];
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return current < 0 ? items[items.length - 1] : items[(current - 1 + items.length) % items.length];
  }
  if (key === "Home") return items[0];
  if (key === "End") return items[items.length - 1];
  return null;
}
