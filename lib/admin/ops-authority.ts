/**
 * 执行门槛(execution gate)—— A2 高敏动作「够权直接执行 / 不够权入 pending」的判定单源。
 * 与代码里既有的 roleGate/operatorRole「执行门槛」概念一致;此处结构化以便机器判定。
 * 不变量:总管理员(superadmin)恒可执行;其余角色须命中 gate.roles。
 * 注意:这是单人确认链路里的「谁有权执行」校验 —— 执行者一人(可以是发起人本人,
 * 也可以是发起人权限不足时的更高门槛执行者),不引入第二人会签。
 */
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL } from "@/lib/nav/console-nav";

export interface AuthPrincipal {
  name: string;
  role: AdminRole;
  authorities: string[];
}

export interface ExecGate {
  roles: AdminRole[]; // 除总管理员外可执行的角色集合
}

export function canExecute(principal: AuthPrincipal, gate: ExecGate): boolean {
  if (principal.role === "superadmin") return true;
  return gate.roles.includes(principal.role);
}

/** 门槛展示文案,如「财务 / 超管」。超管总在末尾(恒可执行)。 */
export function gateLabel(gate: ExecGate): string {
  const parts = gate.roles.filter((r) => r !== "superadmin").map((r) => ROLE_LABEL[r]);
  return [...parts, ROLE_LABEL.superadmin].join(" / ");
}
