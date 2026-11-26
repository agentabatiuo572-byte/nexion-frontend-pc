export const SUPPORT_TODO_PATH = "/service/overview";
export const SUPPORT_TODO_HOME = SUPPORT_TODO_PATH + "?view=todo&entry=overview";
export const PERSONAL_TODO_HOME = SUPPORT_TODO_PATH + "?view=my-customers&filter=TODO&page=1&entry=overview";

export const TODO_FILTERS = ["TODO", "WAITING_REPLY", "FIRST_CONTACT", "DUE"] as const;
export const TODO_PAGE_SIZES = [10, 20, 50];

export type TodoFilter = typeof TODO_FILTERS[number];
export type TodoListLocation = {
  reason: TodoFilter;
  groupId: string;
  agentId: string;
  page: number;
  pageSize: number;
};

function positiveParam(params: URLSearchParams, key: string): string {
  const values = params.getAll(key);
  const value = values[0];
  return values.length === 1 && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : "";
}

export function readTodoLocation(params: URLSearchParams): TodoListLocation {
  const filters = params.getAll("filter");
  const pageSize = Number(positiveParam(params, "pageSize"));
  return {
    reason: (filters.length === 1 && TODO_FILTERS.find(filter => filter === filters[0])) || "TODO",
    groupId: positiveParam(params, "groupId"),
    agentId: positiveParam(params, "agentId"),
    page: Number(positiveParam(params, "page")) || 1,
    pageSize: TODO_PAGE_SIZES.includes(pageSize) ? pageSize : TODO_PAGE_SIZES[0],
  };
}

export function todoListHref(location = readTodoLocation(new URLSearchParams())): string {
  const params = new URLSearchParams({ view: "todo", filter: location.reason, page: String(location.page), pageSize: String(location.pageSize) });
  if (location.groupId) params.set("groupId", location.groupId);
  if (location.agentId) params.set("agentId", location.agentId);
  return SUPPORT_TODO_PATH + "?" + params;
}

export function todoSessionsHref(target: { customerId: string } | { conversationNo: string }): string {
  const params = new URLSearchParams({ ...target, from: "todo", returnTo: todoListHref(readTodoLocation(new URLSearchParams(window.location.search))) });
  return "/service/sessions?" + params;
}

export function todoSessionReturnHref(returnTo: string | null): string {
  const [path, query] = returnTo?.split("?") ?? [];
  if (path !== SUPPORT_TODO_PATH || !query) return todoListHref();
  const params = new URLSearchParams(query);
  return params.get("view") === "todo" ? todoListHref(readTodoLocation(params)) : todoListHref();
}
