/**
 * PageHeader 页头（CP-22，PG-13）。全站只有这一种。
 *
 * <PageHeader pageId="D3" title="资金储备与应付款" summary="看平台的钱够不够付，要不要补储备。"
 *   actions={<Button variant="primary">登记储备注入</Button>}
 *   meta="09:21 读取 · 打开时读取" readOnly="当前账号只能查看这页" back={<Link …>返回用户列表</Link>} />
 *
 * - h1，全页只有一个。域名只留在面包屑，这里不放域名和编号。
 * - summary 一句话，不超过 30 字，长说明进 lib/admin/page-guides（DP-17）。
 * - actions 放右侧：次按钮在前，主按钮最后，主按钮最多一个；危险操作不紧挨主按钮（PG-15）。
 * - meta 是数据时间和刷新方式，全页读同一份数据时才放这里（PG-16）。readOnly 写法见 OP-125。
 * - back 只在带来源进入时传（PG-17）。
 * - guideExtra 是「这页怎么用」里随数据变的内容，比如接口返回的检查项，写在技术信息前面。
 * - identity 是详情页的身份行：编码、状态、等级（PG-50）。详情页的 title 写对象的名字，这一行紧跟说明。
 */
import type { ReactNode } from "react";
import { PageGuide } from "./page-guide";

export function PageHeader({ title, summary, pageId, actions, meta, readOnly, back, guideExtra, identity }: {
  title: ReactNode;
  summary?: ReactNode;
  pageId?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  readOnly?: ReactNode;
  back?: ReactNode;
  guideExtra?: ReactNode;
  identity?: ReactNode;
}) {
  return (
    <header className="rd-head">
      {back && <div className="rd-head-back">{back}</div>}
      <div className="rd-head-main">
        <div className="rd-head-titles">
          <div className="rd-head-row">
            <h1 className="rd-head-title">{title}</h1>
            {pageId && <PageGuide pageId={pageId} extra={guideExtra} />}
          </div>
          {summary && <p className="rd-head-summary">{summary}</p>}
          {identity && <div className="rd-head-identity">{identity}</div>}
        </div>
        {actions && <div className="rd-head-actions">{actions}</div>}
      </div>
      {(meta || readOnly) && (
        <div className="rd-head-meta">
          {meta && <span>{meta}</span>}
          {readOnly && <span className="rd-head-readonly">{readOnly}</span>}
        </div>
      )}
    </header>
  );
}
