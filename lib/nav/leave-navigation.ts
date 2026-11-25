type PageRouter = { push: (path: string) => void; replace: (path: string) => void };
export type PageNavigation = (replace?: boolean) => void;
type NavigationGuard = (navigate: PageNavigation) => void;

let guard: { ask: NavigationGuard; modalBlocksNavigation: () => boolean } | undefined;

/** In-page navigation can use the same confirmation as a captured link click. */
export function registerNavigationGuard(ask: NavigationGuard, modalBlocksNavigation: () => boolean) {
  guard = { ask, modalBlocksNavigation };
  return () => { guard = undefined; };
}

export function isPageNavigationBlockedByModal() {
  return guard?.modalBlocksNavigation() ?? false;
}

/** 命令面板不开在打开着的弹窗上，焦点留在弹窗里（02 OP-46）；有草稿守卫时沿用它的放行条件（H4 限额子框）。 */
export function isCommandPaletteBlockedByModal() {
  // 原生模态 dialog（H4 日期时间选择器用 showModal 打开）同样算打开着的弹窗。
  if (document.querySelector("dialog:modal")) return true;
  return guard ? guard.modalBlocksNavigation() : !!document.querySelector('.rd-modal[data-state="open"]');
}

export function pageNavigation(router: PageRouter, path: string): PageNavigation {
  return (replace) => {
    if (replace) router.replace(path);
    else router.push(path);
  };
}

export function requestPageNavigation(path: string, router: PageRouter) {
  if (new URL(path, window.location.href).href === window.location.href) return;
  const navigate = pageNavigation(router, path);
  if (guard) guard.ask(navigate);
  else navigate();
}
