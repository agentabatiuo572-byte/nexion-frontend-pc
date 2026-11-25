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
 * - guideId 可按当前权限指定「这页怎么用」的内容，默认读 pageId。
 * - guideExtra 是「这页怎么用」里随数据变的内容，比如接口返回的检查项，写在技术信息前面。
 * - 详情页（PG-50，PRD §5A 方案一）传 status、level、facts：标题行是名字、状态标签、等级弱字和「这页怎么用」；
 *   右上是 meta（读取时间）和 actions 同一行，readOnly 在它下面；facts 另起一行，标签在上、值在下，按项数等分占满一行，
 *   项多时列数跟着项数走（后加的事实自然排进去）。不传 facts 的页面照旧：meta 和 readOnly 在最下一行。
 */
import type { ReactNode } from "react";
import { PageGuide } from "./page-guide";

export function PageHeader({ title, summary, pageId, guideId = pageId, actions, meta, readOnly, back, guideExtra, status, level, facts }: {
  title: ReactNode;
  summary?: ReactNode;
  pageId?: string;
  guideId?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  readOnly?: ReactNode;
  back?: ReactNode;
  guideExtra?: ReactNode;
  /** 详情页：标题后的状态标签。 */
  status?: ReactNode;
  /** 详情页：状态后的等级，弱字。 */
  level?: ReactNode;
  /** 详情页的身份事实。传了就用详情排法。 */
  facts?: readonly { label: ReactNode; value: ReactNode }[];
}) {
  const detail = facts !== undefined;
  return (
    <header className="rd-head" data-layout={detail ? "detail" : undefined}>
      {back && <div className="rd-head-back">{back}</div>}
      <div className="rd-head-main">
        <div className="rd-head-titles">
          <div className="rd-head-row">
            <h1 className="rd-head-title">{title}</h1>
            {status}
            {level && <span className="rd-head-level">{level}</span>}
            {pageId && <PageGuide pageId={pageId} guideId={guideId} extra={guideExtra} />}
          </div>
          {summary && <p className="rd-head-summary">{summary}</p>}
        </div>
        {detail
          ? (actions || meta || readOnly) && (
            <div className="rd-head-side">
              {(meta || actions) && <div className="rd-head-actions">{meta && <span className="rd-head-time">{meta}</span>}{actions}</div>}
              {readOnly && <span className="rd-head-readonly">{readOnly}</span>}
            </div>
          )
          : actions && <div className="rd-head-actions">{actions}</div>}
      </div>
      {detail && facts.length > 0 && (
        <dl className="rd-head-facts">
          {facts.map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      )}
      {!detail && (meta || readOnly) && (
        <div className="rd-head-meta">
          {meta && <span>{meta}</span>}
          {readOnly && <span className="rd-head-readonly">{readOnly}</span>}
        </div>
      )}
    </header>
  );
}
