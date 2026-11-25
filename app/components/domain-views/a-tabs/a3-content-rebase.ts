export type Row = Record<string, unknown>;
export const contentMap = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
export const row = (value: unknown): Row => contentMap(value) ? value : {};
export const text = (value: unknown) => typeof value === "string" ? value : "";
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type ContentConflict = { path: string[]; before: unknown; draft: unknown; latest: unknown; kind: "deleted" | "choice" };

function itemKey(collection: string, item: unknown) {
  if (!contentMap(item)) return "";
  if (collection === "blocks") return text(item.id).trim();
  if (collection === "endpoints" && text(item.method).trim() && text(item.path).trim()) {
    return JSON.stringify([text(item.method).trim().toUpperCase(), text(item.path).trim()]);
  }
  return "";
}

function indexList(collection: string, items: unknown[]) {
  const result = new Map<string, unknown>();
  for (const item of items) {
    const key = itemKey(collection, item);
    if (!key || result.has(key)) return;
    result.set(key, item);
  }
  return result;
}

function rebaseList(latest: unknown[], draft: unknown[], before: unknown[], conflicts: ContentConflict[], path: string[]) {
  const collection = path.at(-1)!;
  const currentItems = indexList(collection, latest);
  const draftItems = indexList(collection, draft);
  const baseItems = indexList(collection, before);
  const chooseList = () => {
    conflicts.push({ path, before, draft, latest, kind: "choice" });
    return latest;
  };
  // Text-only entries have no stable identity. An index is not enough to match concurrent edits.
  if (!currentItems || !draftItems || !baseItems) return chooseList();

  const draftAdds = [...draftItems.keys()].filter(key => !baseItems.has(key));
  const currentAdds = [...currentItems.keys()].filter(key => !baseItems.has(key));
  const bothReplace = draftAdds.length > 0 && currentAdds.length > 0
    && [...baseItems.keys()].some(key => !draftItems.has(key) && !currentItems.has(key));
  if (bothReplace) return chooseList();

  const baseOrder = [...baseItems.keys()];
  const draftKeys = [...draftItems.keys()];
  const currentKeys = [...currentItems.keys()];
  const draftOrder = draftKeys.filter(key => baseItems.has(key));
  const locallyReordered = !same(draftOrder, baseOrder.filter(key => draftItems.has(key)));
  const peerOrder = currentKeys.filter(key => baseItems.has(key));
  if (locallyReordered && !same(peerOrder, baseOrder.filter(key => currentItems.has(key)))) return chooseList();

  // Editing an identity field replaces its key. Keep its position when the surviving keys still line up with the baseline.
  const positions = new Map<string, string>();
  if (draftKeys.length === baseOrder.length && draftKeys.every((key, i) => !baseItems.has(key) || key === baseOrder[i])) {
    baseOrder.forEach((key, i) => { if (!draftItems.has(key)) positions.set(key, draftKeys[i]); });
  }
  const currentWithReplacements = currentKeys.flatMap(key => positions.has(key) ? [key, positions.get(key)!] : [key]);
  const order = new Set(locallyReordered ? [...draftKeys, ...currentKeys] : [...currentWithReplacements, ...draftKeys]);
  return [...order].map(key => mergeValue(currentItems.get(key), draftItems.get(key), baseItems.get(key), conflicts, [...path, key]))
    .filter(item => item !== undefined);
}

function mergeValue(latest: unknown, draft: unknown, before: unknown, conflicts: ContentConflict[], path: string[]): unknown {
  if (same(draft, before)) return latest;
  if (same(latest, before)) return draft;
  if (Array.isArray(latest) && Array.isArray(draft) && Array.isArray(before)) {
    return rebaseList(latest, draft, before, conflicts, path);
  }
  if (contentMap(latest) && contentMap(draft) && contentMap(before)) {
    return rebaseContent(latest, draft, before, conflicts, path);
  }
  if (latest === undefined && contentMap(draft) && contentMap(before)) {
    conflicts.push({ path, before, draft, latest, kind: "deleted" });
    return latest;
  }
  if ((before === undefined || draft === undefined) && (contentMap(latest) || Array.isArray(draft) || Array.isArray(before))) {
    conflicts.push({ path, before, draft, latest, kind: "choice" });
    return latest;
  }
  return draft;
}

function rebaseContent(latest: Row, draft: Row, before: Row, conflicts: ContentConflict[], path: string[]): Row {
  const rebased = { ...latest };
  for (const key of new Set([...Object.keys(draft), ...Object.keys(before)])) {
    const value = mergeValue(latest[key], draft[key], before[key], conflicts, [...path, key]);
    if (value === undefined) delete rebased[key];
    else rebased[key] = value;
  }
  return rebased;
}

/** Apply a recorded choice or reconstruct the versions of an unresolved edit before reading again. */
export function setContentAtPath(content: Row, [key, ...path]: readonly string[], value: unknown): Row {
  const next = { ...content };
  if (!path.length) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  } else if (Array.isArray(content[key])) {
    const [id, ...fields] = path;
    const current = content[key] as unknown[];
    const index = current.findIndex(item => itemKey(key, item) === id);
    const replacement = fields.length ? setContentAtPath(row(current[index]), fields, value) : value;
    if (index < 0) next[key] = replacement === undefined ? current : [...current, replacement];
    else next[key] = replacement === undefined ? current.filter((_, i) => i !== index)
      : current.map((item, i) => i === index ? replacement : item);
  } else {
    next[key] = setContentAtPath(row(content[key]), path, value);
  }
  return next;
}

export function rebaseDocument<K extends "locales" | "contents", T extends { version: string } & Record<K, Row>>(
  latest: T, submitted: T, baseline: T, body: K, pending: ContentConflict[],
) {
  const conflicts: ContentConflict[] = [];
  const draft = pending.reduce<Row>((value, edit) => setContentAtPath(value, edit.path, edit.draft), submitted[body]);
  const before = pending.reduce<Row>((value, edit) => setContentAtPath(value, edit.path, edit.before), baseline[body]);
  const document: T = {
    ...latest,
    version: same(submitted.version, baseline.version) ? latest.version : submitted.version,
    [body]: rebaseContent(latest[body], draft, before, conflicts, []),
  };
  return { document, conflicts };
}
