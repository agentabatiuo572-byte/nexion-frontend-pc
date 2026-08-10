export function l5PageCount(total: number, pageSize: number): number {
  const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 1;
  return Math.max(1, Math.ceil(safeTotal / safePageSize));
}

export function clampL5Page(pageNum: number, total: number, pageSize: number): number {
  const safePage = Number.isSafeInteger(pageNum) && pageNum > 0 ? pageNum : 1;
  return Math.min(safePage, l5PageCount(total, pageSize));
}
