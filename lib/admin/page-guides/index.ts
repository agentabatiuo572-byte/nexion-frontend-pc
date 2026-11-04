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
