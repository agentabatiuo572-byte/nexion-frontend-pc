/**
 * 执行门槛(execution gate)—— A2 高敏动作「够权直接执行 / 不够权入 pending」的判定单源。
 * 与代码里既有的 roleGate/operatorRole「执行门槛」概念一致;此处结构化以便机器判定。
 * 不变量:超管(super)恒可执行;其余角色须命中 gate.roles。
 * 注意:这是单人确认链路里的「谁有权执行」校验 —— 执行者一人(可以是发起人本人,
 * 也可以是发起人权限不足时的更高门槛执行者),不引入第二人会签。
 */
import type { ActingOperator, OpsRole } from "@/lib/store/admin/acting-operator-store";
import { ROLE_LABEL } from "@/lib/store/admin/acting-operator-store";

export interface ExecGate {
  roles: OpsRole[]; // 除超管外可执行的角色集合
}

export function canExecute(op: ActingOperator, gate: ExecGate): boolean {
  if (op.role === "super") return true; // 超管恒可
  return gate.roles.includes(op.role);
}

/** 门槛展示文案,如「财务 / 超管」。超管总在末尾(恒可执行)。 */
export function gateLabel(gate: ExecGate): string {
  const parts = gate.roles.map((r) => ROLE_LABEL[r]);
  return [...parts, "超管"].join(" / ");
}
