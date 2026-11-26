/**
 * A2 改角色授权的审批单：后端存下的增减（13193cec roleGrantsDiff，数据层 roleGrantsReview）。
 * 队列、详情抽屉、批准确认框三处共用。增加的排前面、去掉的划线；名称来自权限和菜单目录，目录里没有或没读到时按原码显示。
 * 读不到增减（旧单，null）和确实没有增减（四组都空）分开写。
 */
import type { ReactNode } from "react";
import { Fold, StatusTag } from "@/app/components/rd";
import type { A2RoleGrantsReview } from "@/lib/admin/a2-client";

/** 详情抽屉每组露 8 项；批准确认框露 4 项，让理由框留在首屏。 */
const SHOWN = 8;

type Item = { key: string; code: string; name: string | null; catalogueStatus: "found" | "missing" | "unavailable" };
const perms = (items: A2RoleGrantsReview["permissionsAdded"]): Item[] => items.map((item) => ({ key: item.code, ...item }));
const menus = (items: A2RoleGrantsReview["menusAdded"]): Item[] => items.map((item) => ({ key: String(item.id), code: `菜单编号 ${item.id}`, name: item.name, catalogueStatus: item.catalogueStatus }));

function Group({ title, items, kind, limit }: { title: string; items: Item[]; kind: "add" | "remove"; limit: number }) {
  if (!items.length) return null;
  const list = (part: Item[]) => (
    <ul className="a6-change-list" data-kind={kind}>
      {part.map((item) => (
        <li key={item.key} title={item.name ? `${item.name}\n${item.code}` : item.code}>
          <span className="a6-change-mark" aria-hidden>{kind === "add" ? "+" : "−"}</span>
          <span className="a6-change-name">{item.name ?? <span data-mono="">{item.code}</span>}</span>
          {item.name && !item.code.startsWith("菜单") && <span className="a6-change-mod" data-mono="">{item.code}</span>}
          <span className="a6-change-tags">{item.catalogueStatus === "missing" && <StatusTag tone="neutral">目录里没有</StatusTag>}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="a2-change-group">
      <div className="a2-change-sub">{title} · {items.length} 项</div>
      {list(items.slice(0, limit))}
      {items.length > limit && <Fold inset title={`还有 ${items.length - limit} 项`} summary={`${title}的其余各项`}>{list(items.slice(limit))}</Fold>}
    </div>
  );
}

/** 详情和批准确认框：四组增减；旧单写明没有记下增减，原始内容收进技术信息。 */
export function A2RoleGrantsChange({ review, fallback, limit = SHOWN }: { review: A2RoleGrantsReview | null; fallback: ReactNode; limit?: number }) {
  const empty = review && !review.permissionsAdded.length && !review.permissionsRemoved.length && !review.menusAdded.length && !review.menusRemoved.length;
  const all = review ? [...review.permissionsAdded, ...review.permissionsRemoved] : [];
  const menuAll = review ? [...review.menusAdded, ...review.menusRemoved] : [];
  const unread = [all.some((item) => item.catalogueStatus === "unavailable") && "权限", menuAll.some((item) => item.catalogueStatus === "unavailable") && "菜单"].filter(Boolean).join("和");
  return (
    <section className="a2-change-review" aria-label="权限和菜单的增减">
      <div className="a2-change-title">权限和菜单的增减</div>
      {!review ? <>
        <p className="a2-change-sub">这张单是旧单，没有记下增加和去掉了哪些。</p>
        <Fold inset title="技术信息" summary="改后的完整权限和菜单">{fallback}</Fold>
      </> : empty ? <p className="a2-change-sub">权限和菜单都没有增减。</p> : <>
        <Group limit={limit} title="增加的权限" items={perms(review.permissionsAdded)} kind="add" />
        <Group limit={limit} title="去掉的权限" items={perms(review.permissionsRemoved)} kind="remove" />
        <Group limit={limit} title="增加的菜单" items={menus(review.menusAdded)} kind="add" />
        <Group limit={limit} title="去掉的菜单" items={menus(review.menusRemoved)} kind="remove" />
        {unread && <p className="rd-note">{unread}名称没读到（这个账号看不到目录或目录读取失败），按原码显示。</p>}
      </>}
    </section>
  );
}
