"use client";

/**
 * 操作员身份(演示用)—— A2 高敏操作动态实时化的「谁在操作」单源。
 * 真后台:身份/角色来自登录 session(useAdminAuth),不需要切换器;本 store 是原型演示装置,
 * 让你「以客服 / 增长 / 财务 / 风控 / 内容 / 超管 身份操作」,从而触发不同的执行门槛分流
 * (够权直接执行 / 不够权入 pending 提案)。backend-replaceable:接真后台时换成 session.role 即可。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type OpsRole = "super" | "finance" | "risk" | "growth" | "content" | "support" | "auditor";

export const ROLE_LABEL: Record<OpsRole, string> = {
  super: "超管",
  finance: "财务",
  risk: "风控",
  growth: "增长",
  content: "内容",
  support: "客服",
  auditor: "只读审计",
};

export interface ActingOperator {
  role: OpsRole;
  name: string;
}

/** 演示预设身份(与 A2 种子里的发起人对齐)。默认第 0 个 = 超管(沿用现状:能执行一切)。 */
export const ACTING_PRESETS: ActingOperator[] = [
  { role: "super", name: "陈锐(超管)" },
  { role: "finance", name: "吴桐(财务)" },
  { role: "finance", name: "郑爽(财务)" },
  { role: "risk", name: "王磊(风控)" },
  { role: "growth", name: "高翔(增长)" },
  { role: "content", name: "李文(内容)" },
  { role: "support", name: "刘佳(客服)" },
];

interface ActingStore {
  acting: ActingOperator;
  setActing: (a: ActingOperator) => void;
}

export const useActingOperator = create<ActingStore>()(
  persist(
    (set) => ({
      acting: ACTING_PRESETS[0],
      setActing: (a) => set({ acting: a }),
    }),
    {
      name: "nexion-admin-acting-operator-v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<ActingStore>;
        if (version < 2 || !p.acting) {
          const role = p.acting?.role;
          p.acting = ACTING_PRESETS.find((item) => item.role === role) ?? ACTING_PRESETS[0];
        }
        return p as ActingStore;
      },
    },
  ),
);

export function actingRoleLabel(a: ActingOperator): string {
  return ROLE_LABEL[a.role];
}
