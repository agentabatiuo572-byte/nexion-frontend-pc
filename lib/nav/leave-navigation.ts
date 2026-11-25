type PageRouter = { push: (path: string) => void; replace: (path: string) => void };
export type PageNavigation = (replace?: boolean) => void;
type NavigationGuard = (navigate: PageNavigation) => void;

let guard: NavigationGuard | undefined;

/** In-page navigation can use the same confirmation as a captured link click. */
export function registerNavigationGuard(ask: NavigationGuard) {
  guard = ask;
  return () => { guard = undefined; };
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
  if (guard) guard(navigate);
  else navigate();
}
