/**
 * F4「区域大使确认」分档的展示口径。
 *
 * 分档 `id` 是服务端封闭枚举(venue / kol / print / dev),但 `title` 与 `rule` 是运营
 * 手输的英文原文,PC 此前直接渲染,于是中文界面里出现 Event venue / Host an in-person
 * event 这样的英文整段(缺陷 35)。App 的 /pages/team/agent 早已按同一份字典中文化,
 * 两端因此长期不一致。
 *
 * 这里把字典放到 PC 侧,并按 id 解析可见文案:服务端原文保留为**未知 id 的兜底**,
 * 这样未来新增分档在翻译上线前仍能显示,而不是变成空白。
 */

const BUCKET_COPY: Record<string, { title: string; rule: string }> = {
  venue: { title: "线下大会场地", rule: "签到 QR ≥ 100 人" },
  kol: { title: "KOL 推广配比", rule: "结束后提交发票 + 流量数据" },
  print: { title: "印制物料", rule: "横幅 / 手册 / 名片" },
  dev: { title: "SDK / 开发支持", rule: "为顶级客户定制集成" },
};

/** 分档可见名:命中字典用中文,否则退回服务端原文(绝不显示空白)。 */
export function formatF4AmbassadorBucketTitle(id: string, serverTitle: string): string {
  return BUCKET_COPY[id]?.title ?? serverTitle;
}

/** 分档可见规则:同上。 */
export function formatF4AmbassadorBucketRule(id: string, serverRule: string): string {
  return BUCKET_COPY[id]?.rule ?? serverRule;
}
