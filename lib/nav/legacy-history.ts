// Installed before the router starts writing entries. Older browsers only report
// a traversal after it has committed, so record each same-document position.
export const LEGACY_HISTORY_SCRIPT = `
if (!window.navigation) {
  const history = window.history;
  const indexKey = "__nexionHistoryIndex";
  const cursor = window.nexionHistoryCursor = { index: 0 };
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (state, unused, url) => {
    const index = cursor.index + 1;
    push({ ...state, [indexKey]: index }, unused, url);
    cursor.index = index;
  };
  history.replaceState = (state, unused, url) =>
    replace({ ...state, [indexKey]: cursor.index }, unused, url);
  history.replaceState(history.state, "");
  window.addEventListener("popstate", (event) => {
    const destination = event.state?.[indexKey];
    if (typeof destination !== "number") return;
    const origin = cursor.index;
    cursor.index = destination;
    cursor.onTraverse?.(event, origin, destination);
  }, true);
}
`;

export type LegacyHistoryCursor = {
  index: number;
  onTraverse?: (event: PopStateEvent, origin: number, destination: number) => void;
};
