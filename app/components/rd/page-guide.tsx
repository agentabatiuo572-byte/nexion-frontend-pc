"use client";

/**
 * PageGuide「这页怎么用」（CP-89，TX-37）。PageHeader 按 pageId 自动放入口，内容写在
 * lib/admin/page-guides/，没有内容的页不显示入口。
 *
 * 首次打开时入口旁显示一行提示，不抢焦点、不自动打开、不盖住内容；关掉后按账号和页面记住，
 * 读不到记忆时当已看过，不反复打扰。
 *
 * 层级照 Ant Design Typography：三个分区（这页管什么、最常做的三件事、用到的术语）是 16/600 的 h3，
 * 每件事的小标题是 14/500 的 h4，步骤是正文。技术信息收在折叠里，是第三层。
 */
import { useEffect, useState, type ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";
import { getPageGuide } from "@/lib/admin/page-guides";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Fold } from "./fold";
import { Drawer } from "./overlay";
import { KeepText } from "./keep-text";

function seenKey(adminId: number | undefined, pageId: string) {
  return `nexion-admin-page-guide-seen-v1:${adminId ?? "anonymous"}:${pageId}`;
}

export function PageGuide({ pageId, extra }: { pageId: string; extra?: ReactNode }) {
  const guide = getPageGuide(pageId);
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try {
      setHint(window.localStorage.getItem(seenKey(adminId, pageId)) === null);
    } catch {
      setHint(false);
    }
  }, [adminId, pageId]);
  const dismissHint = () => {
    setHint(false);
    try {
      window.localStorage.setItem(seenKey(adminId, pageId), "1");
    } catch {
      // 存不下时下次再提示一次。
    }
  };
  if (!guide) return null;
  // 一句一行：技术信息是查证时才看的，不能是一整段（DT-08、VS-51）。
  const more = guide.more?.split(/(?<=[。；])/).map((line) => line.trim()).filter(Boolean);
  return (
    <>
      <button type="button" className="rd-guide-entry" onClick={() => { dismissHint(); setOpen(true); }}>
        <CircleHelp size={14} aria-hidden /> 这页怎么用
      </button>
      {hint && (
        <span className="rd-guide-hint">
          第一次来，可以先看这里
          <button type="button" className="rd-chip-x" aria-label="不再提示" onClick={dismissHint}><X size={12} aria-hidden /></button>
        </span>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title="这页怎么用" icon={CircleHelp}>
        <section className="rd-guide-section">
          <h3>这页管什么</h3>
          <p>{guide.purpose}</p>
        </section>
        <section className="rd-guide-section">
          <h3>最常做的三件事</h3>
          <ol>{guide.tasks.map((task) => <li key={task.title}><h4>{task.title}</h4><ol>{task.steps.map((step) => <li key={step}><KeepText text={step} phrases={guide.keep ?? []} /></li>)}</ol></li>)}</ol>
        </section>
        {guide.terms.length > 0 && (
          <section className="rd-guide-section">
            <h3>用到的术语</h3>
            <dl>{guide.terms.map((term) => <div key={term.name}><dt>{term.name}：</dt><dd><KeepText text={term.text} phrases={guide.keep ?? []} /></dd></div>)}</dl>
          </section>
        )}
        {extra}
        {more && <Fold key={pageId} inset title="技术信息" summary={`${more.length} 条`}><ul className="rd-guide-more">{more.map((line) => <li key={line}><KeepText text={line} phrases={guide.keep ?? []} /></li>)}</ul></Fold>}
      </Drawer>
    </>
  );
}
