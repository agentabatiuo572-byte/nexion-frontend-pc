type NavigationGuard = (resume: () => void) => void;

const guards = new Set<NavigationGuard>();

/** In-page navigation can use the same confirmation as a captured link click. */
export function registerNavigationGuard(guard: NavigationGuard) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function requestPageNavigation(path: string, navigate: (path: string) => void) {
  if (new URL(path, window.location.href).href === window.location.href) return;
  const resume = () => navigate(path);
  const guard = guards.values().next().value;
  if (guard) guard(resume);
  else resume();
}
