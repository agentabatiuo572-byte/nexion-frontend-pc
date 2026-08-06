/**
 * H9「对外公布数据」纯校验模块 —— 分位表值域规则的**后台单源**。
 *
 * 🔴 为什么单独成文件:本模块被 tests/h9-public-stats-contract.test.mjs 直接 `node --test`
 *    加载,与前端 `Nexion-uniapp/src/lib/network-rank.ts` 的 `isValidPercentileTable`
 *    做**行为级等价**核对(合法表两边都收、非法表两边都拒)。因此本文件必须保持
 *    **零 import**(路径别名 `@/` node 解析不了),校验规则也只许写在这里,不许在面板里手写第二份。
 *
 * 🔴 判据只许**照抄规格 FEAT-HOME02b ③ 与前端**(tops ≥ 下限且严格升序、cumPct ∈ [0,100] 且
 *    单调不减、至少 H9_BAND_MIN 档),后台不许自己加严:这里曾写过 `tops > 0`、外面曾限
 *    「最多 8 档」——两条规格和前端都没有的限制,会让一张合法的表(9 档、或首档 tops=0)
 *    把整页锁成永久不可保存,运营连改在线率都被拦。加严方向由等价契约测试直接判红。
 */

/**
 * 分位表合法域 —— 逐条取自规格 ③,机器门:
 *   scripts/h9-public-stats-parity.mjs 判据 C2 / C3(档数下限对规格、tops 下限对前端;
 *   后台再自造一个上限就红)+ tests/h9-public-stats-contract.test.mjs(行为等价)。
 */
export const H9_BAND_MIN = 2;
/** 单档算力档位下限,与前端 `network-rank.ts` 的 `band.tops < 0` 判据同值(0 合法)。 */
export const H9_BAND_TOPS_MIN = 0;

/** 分位表单行的表单草稿(输入框原文,未解析)。 */
export type H9BandDraft = { tops: string; cumPct: string };

/** 表单草稿 → 数字:空串 / 非纯数字一律 NaN(不让 `Number("")===0` 把空输入当合法值)。 */
export function h9DraftNumber(value: string): number {
  const text = value.trim();
  if (!text || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return Number.NaN;
  return Number(text);
}

/**
 * 分位表逐行校验 —— 报错定位到具体行(规格 ⑤报错态),合法行返回空串。
 * 档数下限不在本函数管(面板用 H9_BAND_MIN 单独提示,报错位置不同)。
 */
export function h9BandRowErrors(rows: readonly H9BandDraft[]): string[] {
  const errors = rows.map(() => "");
  let previousTops = Number.NEGATIVE_INFINITY;
  let previousPct = Number.NEGATIVE_INFINITY;
  rows.forEach((row, index) => {
    const tops = h9DraftNumber(row.tops);
    const cumPct = h9DraftNumber(row.cumPct);
    if (!Number.isFinite(tops) || tops < H9_BAND_TOPS_MIN) errors[index] = `算力档要填 ${H9_BAND_TOPS_MIN} 或以上的数字`;
    else if (tops <= previousTops) errors[index] = "算力档必须比上一行大(表按算力从小到大排)";
    else if (!Number.isFinite(cumPct) || cumPct < 0) errors[index] = "累计占比要填 0 以上的数字";
    else if (cumPct > 100) errors[index] = "累计占比不能超过 100%";
    else if (cumPct < previousPct) errors[index] = "累计占比不能比上一行小(越往上只能不降)";
    if (Number.isFinite(tops)) previousTops = tops;
    if (Number.isFinite(cumPct) && !errors[index]) previousPct = cumPct;
  });
  return errors;
}

/**
 * 占位卡文案拼接:错误字典整句以「。」收尾,再接固定尾句就是「。。」;
 * 原样透传的非字典串(如网络层英文)又没有句号,直接拼会连成一句。
 * 这里统一收敛成**恰好一个**句号衔接。契约测试钉双向(有句号不叠、没句号补上)。
 */
export function h9PlaceholderCopy(error: string | null): string {
  const lead = (error || "没拿到服务端权威快照").replace(/。$/u, "");
  return `${lead}。为免拿旧值当真值,这里不显示任何数字,写操作也一并冻结。`;
}
