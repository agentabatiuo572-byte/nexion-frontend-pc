/**
 * Janus C2 控制台(K6)— 变更 store(设备手动覆盖 + A2 审计,PRD §9 / §16.5 / §16.6 / §19)。
 * backend-replaceable:applyOverride 即真后台 POST /ops/devices/:sid/status 的化身。
 * 时间戳用 Date.now() —— 仅在点击 handler(applyOverride / 非渲染期)取值,无 SSR 水合问题。
 * 持久化 localStorage(版本化 key);console 全客户端渲染,持久态不引发水合错位。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { JANUS_DEVICES } from "@/lib/mock/admin/janus-c2/devices";
import { JANUS_STRATEGIES, deepClone } from "@/lib/mock/admin/janus-c2/strategies";
import { computePriorityScore, computeRecommendationScore } from "@/lib/mock/admin/janus-c2/scoring";
import { REMOTE_URL_LABEL, STATUS_LABEL } from "@/lib/mock/admin/janus-c2/labels";
import type {
  AuditLog,
  ConfirmationMode,
  Device,
  DeviceStatus,
  EffectiveTiming,
  Role,
  Strategy,
  StrategyStatus,
  StrategyVersion,
} from "@/lib/mock/admin/janus-c2/types";
import type { Transition } from "@/lib/mock/admin/janus-c2/transitions";

/** 远程地址配置键(下发类动作可选,PRD §9.2 remoteUrlKey)。 */
export const REMOTE_URL_KEYS: { key: string; label: string }[] = [
  { key: "default", label: REMOTE_URL_LABEL.default },
  { key: "backup", label: REMOTE_URL_LABEL.backup },
  { key: "promo", label: REMOTE_URL_LABEL.promo },
];

export interface OverrideForm {
  reasonCategory: string;
  reasonText: string;
  effectiveTiming: EffectiveTiming;
  expireAt?: number;
  remoteUrlKey?: string;
  confirmationMode: ConfirmationMode;
}

export interface DeviceOverride extends OverrideForm {
  status: DeviceStatus;
  operatorId: string;
  /** 执行该流转要求的最低角色(PRD §16.5 roleGate,来自 transition.role)。 */
  roleGate: Role;
  createdAt: number;
}

interface JanusC2State {
  overrides: Record<string, DeviceOverride>;
  audit: AuditLog[];
  strategies: Strategy[];
  applyOverride: (device: Device, t: Transition, form: OverrideForm, operatorId: string) => void;
  /** 批量同动作覆盖(PRD §9.1.7,先预览后提交;此处提交)。 */
  applyBatch: (devices: Device[], t: Transition, form: OverrideForm, operatorId: string) => void;
  /** 策略新建 / 编辑(PRD §6/§14)。 */
  saveStrategy: (strategy: Strategy, operatorId: string, isNew: boolean) => void;
  /** 策略状态切换:草稿/发布/暂停/归档(PRD §6.1 / §14.3)。发布(active)可带发布说明 note。 */
  setStrategyStatus: (id: string, status: StrategyStatus, operatorId: string, note?: string) => void;
  deleteStrategy: (id: string, operatorId: string) => void;
  duplicateStrategy: (id: string, operatorId: string) => void;
  /** 回滚到历史版本(PRD §14.4),生成新版本快照,回滚原因必填。 */
  rollbackStrategy: (id: string, version: number, operatorId: string, reason: string) => void;
  /** 报表 / 审计导出留痕(PRD §19:导出报表为必审计动作)。 */
  recordExport: (label: string, operatorId: string, detail: Record<string, unknown>) => void;
  resetAll: () => void;
}

let seq = 0;
const nextId = (prefix: string, at: number): string => `${prefix}-${at.toString(36).toUpperCase()}-${(seq += 1).toString().padStart(3, "0")}`;

function buildAudit(device: Device, t: Transition, form: OverrideForm, operatorId: string, at: number): AuditLog {
  return {
    auditId: nextId("AUD", at),
    actorId: operatorId,
    action: `手动改为「${STATUS_LABEL[t.to]}」`,
    targetType: "device",
    targetId: device.sid,
    beforeSnapshot: { status: device.status, statusSource: device.statusSource },
    afterSnapshot: { status: t.to, statusSource: "manual", remoteUrlKey: form.remoteUrlKey ?? null },
    reasonCategory: form.reasonCategory,
    reasonText: form.reasonText,
    sourceContext: `后台 · ${operatorId}`,
    createdAt: at,
    requestId: nextId("REQ", at),
  };
}

function strategyAudit(action: string, s: Strategy, before: unknown, after: unknown, operatorId: string, at: number, reason?: string): AuditLog {
  return {
    auditId: nextId("AUD", at),
    actorId: operatorId,
    action,
    targetType: "strategy",
    targetId: s.strategyId,
    beforeSnapshot: before,
    afterSnapshot: after,
    reasonText: reason,
    sourceContext: `后台 · ${operatorId}`,
    createdAt: at,
    requestId: nextId("REQ", at),
  };
}

const STATUS_VERB: Record<StrategyStatus, string> = { draft: "存为草稿", active: "发布", paused: "暂停", archived: "归档" };

export const useJanusC2Store = create<JanusC2State>()(
  persist(
    (set) => ({
      overrides: {},
      audit: [],
      strategies: JANUS_STRATEGIES,
      applyOverride: (device, t, form, operatorId) => {
        const at = Date.now();
        const override: DeviceOverride = { ...form, status: t.to, operatorId, roleGate: t.role, createdAt: at };
        const audit = buildAudit(device, t, form, operatorId, at);
        set((s) => ({ overrides: { ...s.overrides, [device.sid]: override }, audit: [audit, ...s.audit] }));
      },
      // 批量同动作覆盖(PRD §9.1.7,UI 批量入口为后续 SPEC;高风险 noBatch 流转禁止批量)。
      applyBatch: (devices, t, form, operatorId) => {
        if (t.noBatch) return;
        const at = Date.now();
        set((s) => {
          const overrides = { ...s.overrides };
          const audits: AuditLog[] = [];
          devices.forEach((d) => {
            overrides[d.sid] = { ...form, status: t.to, operatorId, roleGate: t.role, createdAt: at };
            audits.push(buildAudit(d, t, form, operatorId, at));
          });
          return { overrides, audit: [...audits, ...s.audit] };
        });
      },
      saveStrategy: (strategy, operatorId, isNew) => {
        const at = Date.now();
        set((st) => {
          const exists = st.strategies.find((x) => x.strategyId === strategy.strategyId);
          const strategies = exists
            ? st.strategies.map((x) => (x.strategyId === strategy.strategyId ? strategy : x))
            : [strategy, ...st.strategies];
          const audit = strategyAudit(
            `${isNew ? "新建" : "编辑"}策略「${strategy.name}」`,
            strategy,
            exists ? { status: exists.status, priority: exists.priority, action: exists.action.type } : null,
            { status: strategy.status, priority: strategy.priority, action: strategy.action.type },
            operatorId,
            at,
          );
          return { strategies, audit: [audit, ...st.audit] };
        });
      },
      setStrategyStatus: (id, status, operatorId, note) => {
        const at = Date.now();
        set((st) => {
          const s = st.strategies.find((x) => x.strategyId === id);
          if (!s) return st;
          let updated: Strategy;
          if (status === "active") {
            // 发布生成不可变版本快照(PRD §14.3/§14.4),note = 发布说明。
            const version = s.version + 1;
            const snap: StrategyVersion = { version, note: note?.trim() || `发布 v${version}`, actorId: operatorId, createdAt: at, ruleTree: deepClone(s.ruleTree), action: { ...s.action } };
            updated = { ...s, status, version, publishedAt: at, versions: [snap, ...s.versions] };
          } else {
            updated = { ...s, status };
          }
          const audit = strategyAudit(`${STATUS_VERB[status]}策略「${s.name}」`, s, { status: s.status, name: s.name, priority: s.priority }, { status, version: updated.version }, operatorId, at, note?.trim());
          return { strategies: st.strategies.map((x) => (x.strategyId === id ? updated : x)), audit: [audit, ...st.audit] };
        });
      },
      deleteStrategy: (id, operatorId) => {
        const at = Date.now();
        set((st) => {
          const s = st.strategies.find((x) => x.strategyId === id);
          if (!s) return st;
          const audit = strategyAudit(`删除策略「${s.name}」`, s, { status: s.status }, null, operatorId, at);
          return { strategies: st.strategies.filter((x) => x.strategyId !== id), audit: [audit, ...st.audit] };
        });
      },
      duplicateStrategy: (id, operatorId) => {
        const at = Date.now();
        set((st) => {
          const s = st.strategies.find((x) => x.strategyId === id);
          if (!s) return st;
          const copy: Strategy = {
            ...s,
            strategyId: nextId("STRAT", at),
            name: `${s.name}(副本)`,
            status: "draft",
            version: 1,
            ruleTree: deepClone(s.ruleTree),
            action: { ...s.action },
            safeguards: { ...s.safeguards },
            scope: deepClone(s.scope),
            versions: [],
            createdAt: at,
            publishedAt: undefined,
          };
          const audit = strategyAudit(`复制策略「${s.name}」为草稿`, copy, null, { name: copy.name, status: "draft" }, operatorId, at);
          return { strategies: [copy, ...st.strategies], audit: [audit, ...st.audit] };
        });
      },
      rollbackStrategy: (id, version, operatorId, reason) => {
        const at = Date.now();
        set((st) => {
          const s = st.strategies.find((x) => x.strategyId === id);
          if (!s) return st;
          const v = s.versions.find((x) => x.version === version);
          if (!v) return st;
          const newVersion = s.version + 1;
          const snap: StrategyVersion = { version: newVersion, note: `回滚自 v${version}${reason ? ` · ${reason}` : ""}`, actorId: operatorId, createdAt: at, ruleTree: deepClone(v.ruleTree), action: { ...v.action } };
          const updated: Strategy = { ...s, ruleTree: deepClone(v.ruleTree), action: { ...v.action }, version: newVersion, versions: [snap, ...s.versions] };
          const audit = strategyAudit(`回滚策略「${s.name}」到 v${version}`, s, { version: s.version }, { version: newVersion, rolledBackFrom: version }, operatorId, at, reason);
          return { strategies: st.strategies.map((x) => (x.strategyId === id ? updated : x)), audit: [audit, ...st.audit] };
        });
      },
      recordExport: (label, operatorId, detail) => {
        const at = Date.now();
        const audit: AuditLog = {
          auditId: nextId("AUD", at), actorId: operatorId, action: label,
          targetType: "config", targetId: "export",
          beforeSnapshot: null, afterSnapshot: detail,
          sourceContext: `后台 · ${operatorId}`, createdAt: at, requestId: nextId("REQ", at),
        };
        set((s) => ({ audit: [audit, ...s.audit] }));
      },
      resetAll: () => set({ overrides: {}, audit: [], strategies: JANUS_STRATEGIES }),
    }),
    { name: "nexion-admin-janus-c2-v1" },
  ),
);

/** 基础设备 + 手动覆盖 → 有效设备(状态/来源/操作人/优先级 live 派生,单源不缓存)。 */
export function effectiveDevices(overrides: Record<string, DeviceOverride>): Device[] {
  return JANUS_DEVICES.map((d) => {
    const o = overrides[d.sid];
    if (!o) return d;
    const merged: Device = {
      ...d,
      status: o.status,
      statusSource: "manual",
      activated:
        o.status === "ACTIVATED" || o.status === "MANUAL_FORCED" ? true
        : o.status === "RESET" || o.status === "BLOCKED" || o.status === "ENV_FILTERED" ? false
        : d.activated,
      remoteUrlKey: o.remoteUrlKey ?? d.remoteUrlKey,
      lastOperatorId: o.operatorId,
      lastOperationReason: o.reasonText,
      manualOverride: {
        targetStatus: o.status,
        reasonCategory: o.reasonCategory,
        reasonText: o.reasonText,
        operatorId: o.operatorId,
        effectiveTiming: o.effectiveTiming,
        expireAt: o.expireAt,
        createdAt: o.createdAt,
        confirmationMode: o.confirmationMode,
        roleGate: o.roleGate,
        remoteUrlKey: o.remoteUrlKey,
      },
    };
    // 状态变了 → 优先级/建议分 live 重算(不缓存旧值)。
    const recommendationScore = computeRecommendationScore(merged);
    const withRec = { ...merged, recommendationScore };
    return { ...withRec, priorityScore: computePriorityScore(withRec) };
  });
}
