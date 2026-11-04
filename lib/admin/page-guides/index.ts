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
  D3: {
    purpose: "看平台的钱够不够付，要不要补储备。",
    tasks: [
      { title: "看资金安全", steps: ["先读顶部一句话", "正常就不用处理", "变红时按建议上报"] },
      { title: "查应付款和到期", steps: ["切到「应付款与到期」", "选 7 天或 30 天", "点九类里的一行看这类的详情"] },
      { title: "登记储备注入", steps: ["点「登记储备注入」", "填金额和到账凭证", "写理由后确认登记"] },
    ],
    terms: [
      { name: "可用储备", text: "扣掉质押锁定金额后，平台能动用的钱。" },
      { name: "应付款", text: "平台之后要付给用户的九类钱。" },
      { name: "可覆盖天数", text: "可用储备够付多少天的到期应付款，按未来 7 天的平均到期额算。" },
      { name: "资金安全等级", text: "按可覆盖天数分四档：正常、关注、预警、危险。" },
      { name: "差额", text: "储备减应付款。正数是有富余，负数是不够付。" },
    ],
  },
};

export function getPageGuide(pageId: string): PageGuideContent | undefined {
  return PAGE_GUIDES[pageId];
}
