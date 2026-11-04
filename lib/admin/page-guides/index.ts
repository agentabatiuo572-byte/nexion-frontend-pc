/**
 * 「这页怎么用」的内容，按页面编号取（CP-89，TX-37）。
 * 只写现有功能，步骤里的按钮名和页面一致，写不准的标「待确认」（DP-33）。
 * 每页迁移时在这里加一条；原来页底的规则说明、长页头说明写进三块正文，口径全文放 more。
 */
import type { ReactNode } from "react";

export interface PageGuideContent {
  /** 这页管什么，一句话，不超过 30 字。 */
  purpose: string;
  /** 最常做的三件事，每件不超过 3 步。 */
  tasks: readonly { title: string; steps: readonly string[] }[];
  /** 这页特有的词，不超过 5 个。 */
  terms: readonly { name: string; text: string }[];
  /** 底部「技术信息」：口径全文这类第三层内容（TX-37）。 */
  more?: ReactNode;
}

const PAGE_GUIDES: Record<string, PageGuideContent> = {
  B0: {
    purpose: "每天第一眼看这里，判断今天要不要动手。",
    tasks: [
      { title: "处理待办", steps: ["看最上面那句话", "点「待处理」里最上面一行", "到业务页处理，这页不审批"] },
      { title: "看今日经营", steps: ["看销售额、新增用户、资金净流入、设备异常", "和下面的「昨天全天」比", "点数字旁的问号看怎么算"] },
      { title: "查资金", steps: ["看「资金安全」那句话", "点开「资金明细」看储备、应付款和到期", "要导出或核对，点「查看资金总览」"] },
    ],
    terms: [
      { name: "应付款", text: "平台欠用户的钱，共 9 类。" },
      { name: "可覆盖天数", text: "储备除以未来 7 天日均到期金额。" },
      { name: "红线", text: "资金安全底线，跌破会告警，不会自动收紧提现或暂停业务。" },
      { name: "健康线", text: "资金健康目标值，低于它要留意。" },
      { name: "资金净流入", text: "今天已确认的流入减流出，财务注资也算流入。" },
    ],
    more: "每块各自读取，页头是最后一次读完的时间。客服待跟进和紧急开关告警每 30 秒更新，其余打开和点「刷新」时读取。「今天」「昨天」按业务日历算，新增用户按北京时间切日。",
  },
  D2: {
    purpose: "财务在这里审核用户的提现申请。",
    tasks: [
      { title: "审一笔提现", steps: ["点单号打开详情", "看金额、风险和触发规则", "点「放行」「延迟」「冻结」或「拒绝」，填理由提交"] },
      { title: "找一笔提现", steps: ["输入提现单号、用户编号或昵称", "点「查询」", "条件多时打开「更多筛选」"] },
      { title: "处理冻结的单", steps: ["选状态「冻结」", "打开详情", "点「解冻」"] },
    ],
    terms: [
      { name: "放行", text: "允许这笔提现往下走。" },
      { name: "冻结", text: "暂停处理，要写责任人和复查时间。" },
      { name: "风险分", text: "系统按规则算的分数，越高越要仔细看。" },
    ],
  },
};

export function getPageGuide(pageId: string): PageGuideContent | undefined {
  return PAGE_GUIDES[pageId];
}
