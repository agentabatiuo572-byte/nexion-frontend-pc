/**
 * B 聚合风险条目（riskRadar.feed）的读法，今日概览和铃铛共用。
 * 不能按严重度整批过滤：覆盖率结论行正常时也是 p2，而等待重新评分、中风险账户这类 p2 是要处理的事。
 * 结论行是唯一指向资金总览的一条，挤兑比率到黄线前它只是在报现状（后端 dynamicCoverageFeed）。
 */
export function isRiskConclusion(item: { sev: string; href: string }) {
  return item.href === "/overview/dual-ledger" && item.sev !== "p0" && item.sev !== "p1";
}

/** 后端下发的「挤兑比率」就是页面上的「近 24 小时提现申请占储备」，同一个数用同一个名字。 */
export function riskFeedTitle(title: string) {
  return title.replace("挤兑比率", "近 24 小时提现申请占储备");
}
