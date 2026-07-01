"use client";

/**
 * 高敏操作待执行队列(A2「高敏操作动态(b)· pending」实时单源)。
 * 按执行门槛分流:发起人权限不足该动作门槛时,不直接执行,而是 addProposal 入此队列,
 * 等有权者(lead/超管)在 A2 点「执行」→ 回放 mutations 写回目标域 + 审计 → resolveProposal。
 *
 * backend-replaceable:proposal 携带**可序列化的 mutation 描述符**(非闭包)。
 * PRD §A2 已固化执行门槛分流契约(状态机 pending → 已执行 / 已驳回;审计读端点 GET /api/admin/audit?sensitive=true):
 *   list/get → GET  /api/admin/audit/pending
 *   add      → POST /api/admin/audit/pending(各域发起时落库 + 通知)
 *   execute  → POST /api/admin/audit/pending/:id/execute(具门槛者执行:复核 canExecute + 仅 pending + B1 红线 → 回放目标域 + 审计,一次事务 + 幂等)
 *   reject   → POST /api/admin/audit/pending/:id/reject(终态)
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ExecGate } from "@/lib/admin/ops-authority";

export type ProposalType = "fund" | "param" | "acct" | "sos";

/** 可序列化 mutation 描述符:执行时回放 setParam(key,value,{action,reason})。多条 = 原子组。 */
export interface PendingMutation {
  key: string;
  value: string; // 以字符串存(与各域 ctx.setParam 的 value:string 一致;数值参数存其字符串表示)
  action: string;
}

export interface PendingProposal {
  id: string;
  ts: number;
  tsLabel: string; // 展示用相对时间(实时=「刚刚」;种子沿用原相对串如「2m」)
  action: string; // 动作名
  obj: string; // 对象
  before: string;
  after: string;
  type: ProposalType;
  amplifies: boolean;
  sos: boolean;
  proposer: string; // 发起人名
  proposerRole: string; // 发起人角色中文(含 lead)
  gate: ExecGate; // 执行门槛(结构化,执行端二次校验)
  gateLabel: string; // 门槛展示
  reason: string; // 发起理由
  mutations: PendingMutation[]; // 执行回放
  sourceDomain: string; // 来源域标识(如 D2 / I7 / J1)
  status: "pending" | "approved" | "rejected";
}

interface PendingStore {
  proposals: PendingProposal[] | null;
  ensureProposals: (seed: PendingProposal[]) => void;
  addProposal: (p: Omit<PendingProposal, "id" | "ts" | "tsLabel" | "status">) => void;
  resolveProposal: (id: string, status: "approved" | "rejected") => void;
}

let PROP_SEQ = 0; // 跨 reload 防 id 碰撞

export const usePendingOps = create<PendingStore>()(
  persist(
    (set) => ({
      proposals: null,
      ensureProposals: (seed) => set((s) => (s.proposals ? s : { proposals: seed })),
      addProposal: (p) =>
        set((s) => {
          const list = s.proposals ?? [];
          const entry: PendingProposal = {
            ...p,
            id: `PROP-${list.length}-${(PROP_SEQ = (PROP_SEQ + 1) % 1_000_000)}`,
            ts: Date.now(),
            tsLabel: "刚刚",
            status: "pending",
          };
          return { proposals: [entry, ...list] };
        }),
      // 幂等:只有仍 pending 的提案能被裁决,防多 tab/抽屉竞态二次执行(重放 mutation + 重复审计)。
      resolveProposal: (id, status) =>
        set((s) => ({ proposals: (s.proposals ?? []).map((x) => (x.id === id && x.status === "pending" ? { ...x, status } : x)) })),
    }),
    {
      name: "nexion-admin-pending-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<PendingStore>;
        if (version < 1) p.proposals = null; // 旧无版本数据丢弃,由 ensureProposals 按新 seed 重建
        return p as PendingStore;
      },
    },
  ),
);
