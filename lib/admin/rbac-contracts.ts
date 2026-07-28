function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function string(value: unknown, message: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(message);
  return value.trim();
}

function optionalString(value: unknown, message: string): string {
  return value == null ? "" : string(value, message, true);
}

function integer(value: unknown, message: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(message);
  return value;
}

function flag(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function strings(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) throw new Error(message);
  const result = value.map((item) => string(item, message));
  if (new Set(result).size !== result.length) throw new Error(message);
  return result;
}

function ids(value: unknown, message: string): number[] {
  if (!Array.isArray(value)) throw new Error(message);
  const result = value.map((item) => integer(item, message, 1));
  if (new Set(result).size !== result.length) throw new Error(message);
  return result;
}

export function normalizeA6Overview(raw: unknown) {
  const message = "A6_OVERVIEW_CONTRACT_INVALID";
  const data = object(raw, message);
  if (!Array.isArray(data.roles)) throw new Error(message);
  const roles = data.roles.map((item) => {
    const row = object(item, message);
    const status = integer(row.status, message);
    if (status !== 0 && status !== 1) throw new Error(message);
    return {
      id: integer(row.id, message, 1),
      roleCode: string(row.roleCode, message),
      roleName: string(row.roleName, message),
      remark: optionalString(row.remark, message),
      status,
      builtin: flag(row.builtin, message),
      adminCount: integer(row.adminCount, message),
    };
  });
  const total = integer(data.total, message);
  if (total !== roles.length || new Set(roles.map((role) => role.id)).size !== roles.length) throw new Error(message);
  return { roles, total };
}

export function normalizeA6Detail(raw: unknown) {
  const message = "A6_DETAIL_CONTRACT_INVALID";
  const row = object(raw, message);
  const status = integer(row.status, message);
  if (status !== 0 && status !== 1) throw new Error(message);
  return {
    id: integer(row.id, message, 1),
    roleCode: string(row.roleCode, message),
    roleName: string(row.roleName, message),
    remark: optionalString(row.remark, message),
    status,
    builtin: flag(row.builtin, message),
    permissionCodes: strings(row.permissionCodes, message),
    menuIds: ids(row.menuIds, message),
  };
}

function normalizeA7Node(raw: unknown): Record<string, unknown> & { children: ReturnType<typeof normalizeA7Node>[] } {
  const message = "A7_OVERVIEW_CONTRACT_INVALID";
  const wrapper = object(raw, message);
  const node = object(wrapper.node, message);
  if (!Array.isArray(wrapper.children)) throw new Error(message);
  const status = integer(node.status, message);
  if (status !== 0 && status !== 1) throw new Error(message);
  const parentId = node.parentId == null ? null : integer(node.parentId, message, 1);
  return {
    id: integer(node.id, message, 1),
    menuCode: string(node.menuCode, message),
    menuName: string(node.menuName, message),
    menuNameZh: optionalString(node.menuNameZh, message),
    parentId,
    routePath: optionalString(node.routePath, message),
    icon: optionalString(node.icon, message),
    sortOrder: integer(node.sortOrder, message),
    status,
    version: string(node.version, message),
    children: wrapper.children.map(normalizeA7Node),
  };
}

export function normalizeA7Overview(raw: unknown) {
  const message = "A7_OVERVIEW_CONTRACT_INVALID";
  const data = object(raw, message);
  if (!Array.isArray(data.tree)) throw new Error(message);
  const tree = data.tree.map(normalizeA7Node);
  const domainCount = integer(data.domainCount, message);
  const pageCount = integer(data.pageCount, message);
  const activeCount = integer(data.activeCount, message);
  const flat = (nodes: typeof tree): typeof tree => nodes.flatMap((node) => [node, ...flat(node.children)]);
  const nodes = flat(tree);
  if (domainCount !== tree.length || domainCount + pageCount !== nodes.length
      || activeCount !== nodes.filter((node) => node.status === 1).length
      || new Set(nodes.map((node) => node.id)).size !== nodes.length) {
    throw new Error(message);
  }
  return { tree, domainCount, pageCount, activeCount };
}

export function normalizeA8Permission(raw: unknown) {
  const message = "A8_PERMISSION_CONTRACT_INVALID";
  const row = object(raw, message);
  const amplifies = integer(row.amplifies, message);
  if (amplifies !== 0 && amplifies !== 1) throw new Error(message);
  const permType = string(row.permType, message);
  if (!["READ", "WRITE", "HIGH"].includes(permType)) throw new Error(message);
  return {
    permissionCode: string(row.permissionCode, message),
    permissionName: optionalString(row.permissionName, message),
    permType,
    menuId: row.menuId == null ? null : integer(row.menuId, message, 1),
    menuCodePath: string(row.menuCodePath, message),
    amplifies,
    boundRoleCount: integer(row.boundRoleCount, message),
    resourcePath: optionalString(row.resourcePath, message),
  };
}

export function normalizeA8Page(raw: unknown) {
  const message = "A8_PAGE_CONTRACT_INVALID";
  const data = object(raw, message);
  if (!Array.isArray(data.records)) throw new Error(message);
  const total = integer(data.total, message);
  const pageNum = integer(data.pageNum, message, 1);
  const pageSize = integer(data.pageSize, message, 1);
  const records = data.records.map(normalizeA8Permission);
  if (records.length > pageSize
      || records.length > total
      || (total === 0 && records.length !== 0)
      || new Set(records.map((row) => row.permissionCode)).size !== records.length) {
    throw new Error(message);
  }
  return { total, pageNum, pageSize, records };
}
