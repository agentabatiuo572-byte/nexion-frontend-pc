import { formatB3RefOption } from "@/lib/admin/b3-ref-display";
import type { L2FunnelQuery } from "@/lib/admin/l-client";
import { INTERFACE_LANGUAGES } from "@/lib/admin/platform-experience-client";

const LANGUAGE_NAME = new Map<string, string>(INTERFACE_LANGUAGES.map((item) => [item.code, item.zhName]));

/** 现在看的是哪一批人（L2 页传已应用的条件，不是输入框里还没提交的）。L5 任务表写转化与留存导出的范围也用它，两页同一个说法。 */
export function l2ScopeText(query: L2FunnelQuery) {
  const parts = [
    query.cohort ? `注册批次 ${query.cohort}` : null,
    query.phase ? `阶段 ${query.phase}` : null,
    query.locale ? `语言 ${LANGUAGE_NAME.get(query.locale.toLowerCase().split("-")[0]) ?? query.locale}（${query.locale}）` : null,
    query.ref ? `渠道 ${formatB3RefOption(query.ref)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "全部注册用户";
}
