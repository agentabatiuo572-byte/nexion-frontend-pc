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
 * - 高亮只跟着用户自己的滚动走（BUG-636）：点导航选中的组（页面用 nav.mark 定位的组也一样）在用户再滚之前一直亮着；
 *   「滚到底算最后一组」只在用户自己滚到底时算；内容高度变了、页面自己滚动（刷新、展开、补位），都不重判。
 *   用户在滚指滚轮、触摸、翻页和方向键、Tab、拖滚动条。
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export interface SectionNavItem {
  id: string;
  label: string;
  alert?: boolean;
}

const PARAM = "section";
/** 用户最后一次滚动输入之后这么久之内的滚动和交叉变化，才算用户在滚（键盘平滑滚动约半秒）。 */
const USER_SCROLL_MS = 1000;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab"]);

export function useSectionNav(items: readonly SectionNavItem[], { onReveal, ready = true, restoreKey }: {
  onReveal?: (id: string) => void;
  ready?: boolean;
  /** When supplied, restore the URL position once per key, even if sections change later. */
  restoreKey?: string;
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  /** 点导航或 mark 选中后为 true，用户再滚才放开；放在观察器外面，分区变了、观察器重建也留着。 */
  const held = useRef(false);
  const userAt = useRef(0);
  const restoredKey = useRef<string | undefined>(undefined);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  const ids = items.map((item) => item.id).join("|");

  const go = useCallback((id: string, smooth = true) => {
    reveal.current?.(id);
    setActive(id);
    held.current = true;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`section-${id}`);
      target?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      target?.querySelector<HTMLElement>("[data-section-focus], summary")?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!ready || (restoreKey !== undefined && restoredKey.current === restoreKey)) return;
    restoredKey.current = restoreKey;
    const wanted = new URLSearchParams(window.location.search).get(PARAM);
    if (wanted && ids.split("|").includes(wanted)) go(wanted, false);
  }, [go, ids, ready, restoreKey]);

  useEffect(() => {
    if (!ready) return;
    const list = ids.split("|");
    const seen = new Set<string>();
    const scroller = document.getElementById(`section-${list[0]}`)?.closest("main");
    let dragging = false;
    const userScrolling = () => dragging || Date.now() - userAt.current < USER_SCROLL_MS;
    const pick = () => {
      if (held.current || !userScrolling()) return;
      // 滚到底时最后一组进不了判定带，上面的组还在里面，这时算最后一组。
      const atEnd = scroller && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      // 回到顶部时第一组可能还在判定带下面，这时算第一组，不留着上一次的高亮。
      const current = scroller?.scrollTop === 0 ? list[0] : atEnd ? list.at(-1) : list.find((id) => seen.has(id));
      if (current) setActive(current);
    };
    const input = () => { held.current = false; userAt.current = Date.now(); };
    const onKey = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || event.key !== "Tab" && (event.target as Element | null)?.closest?.("input, textarea, select, [contenteditable='true'], [role='listbox'], [role='menu']")) return;
      input();
    };
    // 拖滚动条：按在滚动区自己身上（不是里面的内容）。
    const onDown = (event: PointerEvent) => { if (event.target === scroller) { dragging = true; input(); } };
    const onUp = () => { dragging = false; };
    const onScroll = () => { if (!held.current && userScrolling()) userAt.current = Date.now(); pick(); };
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
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    scroller?.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("wheel", input, { passive: true, capture: true });
    window.addEventListener("touchmove", input, { passive: true, capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", onScroll);
      scroller?.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("wheel", input, { capture: true });
      window.removeEventListener("touchmove", input, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [ids, ready]);

  const select = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    go(id);
  }, [go]);

  /** 页面自己定位到某组（比如点统计数字）时用：只高亮这一组，不滚动、不写网址，用户再滚之前保持。 */
  const mark = useCallback((id: string) => {
    setActive(id);
    held.current = true;
  }, []);

  return { active, select, mark, anchor: (id: string) => `section-${id}` };
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
