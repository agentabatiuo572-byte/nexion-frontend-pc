/** 运营人员身份(Maker/Checker 演示用)。 */
import type { AdminRole } from "@/lib/nav/console-nav";

export interface Operator {
  name: string;
  role: AdminRole;
}

export const OPERATORS: Operator[] = [
  { name: "周岚", role: "finance" },
  { name: "陈默", role: "risk" },
  { name: "李薇", role: "finance" },
  { name: "Nova 系统", role: "superadmin" },
];
