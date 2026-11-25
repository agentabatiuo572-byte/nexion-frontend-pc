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
