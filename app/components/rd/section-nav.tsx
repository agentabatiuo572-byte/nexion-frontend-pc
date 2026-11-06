"use client";

/**
 * SectionNav 分组导航（CP-91）。配置页三组以上时放在内容旁边，点一下定位，滚动时当前组高亮。
 *
 * const nav = useSectionNav(SECTIONS, { onReveal: (id) => openFold(id) });
 * <SectionNav label="本页分组" items={SECTIONS} nav={nav} />
 * <div id={nav.anchor("common")}>…</div>
 *
 * - 定位写进查询参数 section，刷新和带参进来都回到那一组（PG-53）。别的参数原样留着。
 * - 目标在折叠组里时 onReveal 先展开，再定位，焦点落到组标题：折叠组的 summary，或带 data-section-focus 的元素。
 * - 组内有异常时 item.alert 为 true，导航项上标出来（DP-03）。
 * - 每项是真实链接，当前组 aria-current。窄宽时收成一行，由 CSS 管。
 * - 详情页的分区导航传 row：横排一行，放在折叠组上方（PG-50），外面包 .rd-detail-nav 滚动时钉住。
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export interface SectionNavItem {
  id: string;
  label: string;
  alert?: boolean;
}

const PARAM = "section";

export function useSectionNav(items: readonly SectionNavItem[], { onReveal, ready = true }: { onReveal?: (id: string) => void; ready?: boolean }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const lock = useRef(0);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  const ids = items.map((item) => item.id).join("|");

  const go = useCallback((id: string, smooth = true) => {
    reveal.current?.(id);
    setActive(id);
    lock.current = Date.now() + 800;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`section-${id}`);
      target?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      target?.querySelector<HTMLElement>("[data-section-focus], summary")?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const wanted = new URLSearchParams(window.location.search).get(PARAM);
    if (wanted && ids.split("|").includes(wanted)) go(wanted, false);
  }, [go, ids, ready]);

  useEffect(() => {
    if (!ready) return;
    const list = ids.split("|");
    const seen = new Set<string>();
    const scroller = document.getElementById(`section-${list[0]}`)?.closest("main");
    const pick = () => {
      if (Date.now() < lock.current) return;
      // 滚到底时最后一组进不了判定带，上面的组还在里面，这时算最后一组。
      const atEnd = scroller && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const current = atEnd ? list.at(-1) : list.find((id) => seen.has(id));
      if (current) setActive(current);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.id.replace(/^section-/, "");
        if (entry.isIntersecting) seen.add(id);
        else seen.delete(id);
      }
      pick();
    }, { rootMargin: "-80px 0px -60% 0px" });
    for (const id of list) {
      const target = document.getElementById(`section-${id}`);
      if (target) observer.observe(target);
    }
    scroller?.addEventListener("scroll", pick, { passive: true });
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", pick);
    };
  }, [ids, ready]);

  const select = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    go(id);
  }, [go]);

  return { active, select, anchor: (id: string) => `section-${id}` };
}

export function SectionNav({ label, items, nav, row }: { label: string; items: readonly SectionNavItem[]; nav: ReturnType<typeof useSectionNav>; row?: boolean }) {
  const open = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    nav.select(id);
  };
  return (
    <nav className="rd-section-nav" data-row={row ? "" : undefined} aria-label={label}>
      {items.map((item) => (
        <a key={item.id} href={`?${PARAM}=${item.id}`} aria-current={nav.active === item.id ? "true" : undefined} data-alert={item.alert ? "" : undefined} onClick={(event) => open(event, item.id)}>
          {item.label}
          {item.alert && <span className="rd-section-nav-alert">有异常</span>}
        </a>
      ))}
    </nav>
  );
}
