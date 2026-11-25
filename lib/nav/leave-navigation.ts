type PageRouter = { push: (path: string) => void; replace: (path: string) => void };
export type PageNavigation = (replace?: boolean) => void;
type NavigationGuard = (navigate: PageNavigation) => void;

const guards = new Set<NavigationGuard>();

/** In-page navigation can use the same confirmation as a captured link click. */
export function registerNavigationGuard(guard: NavigationGuard) {
  guards.add(guard);
  return () => { guards.delete(guard); };
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
  const guard = guards.values().next().value;
  if (guard) guard(navigate);
  else navigate();
}
