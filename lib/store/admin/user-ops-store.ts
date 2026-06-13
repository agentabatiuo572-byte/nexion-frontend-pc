"use client";

/**
 * 运营后台 · 单用户可变状态 store(真交互层)。
 * 360 HUB 的所有写操作(下线/上线/换机/回收设备、补发/调整/红冲收益、冻结、吊销会话、重置2FA、通知已读)
 * 在此真实改状态 → UI 立即反映 → 写入审计流。按 userId 隔离 + persist(运营改动跨刷新保留)。
 * 真后台对接:每个 action 对应一个 server-canonical 端点(见各 section 注释),此处为 mock state + 乐观更新。
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserDeviceRow, LedgerRow } from "@/lib/mock/admin/user-360";

export interface OpsDevice extends UserDeviceRow {
  recycled?: boolean;
}
export type AuditTone = "danger" | "warning" | "success" | "neutral";
export interface OpsAuditEntry {
  id: string;
  tsLabel: string;
  actor: string;
  action: string;
  detail: string;
  tone: AuditTone;
}
export interface UserOps {
  seeded: boolean;
  devices: OpsDevice[];
  ledgerExtra: LedgerRow[];
  balanceAdjustUsd: number;
  balanceAdjustNex: number;
  frozen: boolean;
  twoFactorReset: boolean;
  revokedSessions: string[];
  notifsAllRead: boolean;
  cancelledOrderIds: string[];
  audit: OpsAuditEntry[];
}

const ACTOR = "总管理员";
let seq = 0;
const nextId = (p: string) => `${p}-${(seq = (seq + 1) % 100000)}`;

function emptyOps(): UserOps {
  return {
    seeded: false,
    devices: [],
    ledgerExtra: [],
    balanceAdjustUsd: 0,
    balanceAdjustNex: 0,
    frozen: false,
    twoFactorReset: false,
    revokedSessions: [],
    notifsAllRead: false,
    cancelledOrderIds: [],
    audit: [],
  };
}

interface OpsStore {
  users: Record<string, UserOps>;
  /** 首次访问用确定性生成的设备种子初始化(幂等)。 */
  ensure: (userId: string, seedDevices: OpsDevice[]) => void;
  get: (userId: string) => UserOps;
  log: (userId: string, action: string, detail: string, tone: AuditTone) => void;
  deviceToggle: (userId: string, deviceId: string) => void;
  deviceRecycle: (userId: string, deviceId: string) => void;
  deviceSwap: (userId: string, deviceId: string) => void;
  earningAppend: (userId: string, kind: "补发" | "调整" | "红冲", delta: number, memo: string, ccy?: "USDT" | "NEX") => void;
  setFrozen: (userId: string, frozen: boolean) => void;
  revokeSession: (userId: string, sessionId: string, label: string) => void;
  resetTwoFactor: (userId: string) => void;
  markNotifsRead: (userId: string) => void;
  cancelOrder: (userId: string, orderId: string, label: string) => void;
}

function patch(state: OpsStore, userId: string, fn: (u: UserOps) => UserOps): Partial<OpsStore> {
  // 用 emptyOps() 回填缺省字段:旧 persist 记录(早期 schema)缺新增字段时不致 undefined 崩溃。
  const cur: UserOps = { ...emptyOps(), ...state.users[userId] };
  return { users: { ...state.users, [userId]: fn(cur) } };
}

function withAudit(u: UserOps, action: string, detail: string, tone: AuditTone): UserOps {
  // id 含审计长度(跨刷新递增)+ session seq → 持久条目与新条目不撞 key(避免 React 重复 key)。
  const entry: OpsAuditEntry = { id: `AU-${u.audit.length}-${(seq = (seq + 1) % 1000000)}`, tsLabel: "刚刚", actor: ACTOR, action, detail, tone };
  return { ...u, audit: [entry, ...u.audit].slice(0, 50) };
}

export const useUserOps = create<OpsStore>()(
  persist(
    (set, get) => ({
      users: {},

      ensure: (userId, seedDevices) =>
        set((s) => {
          if (s.users[userId]?.seeded) return s;
          return patch(s, userId, (u) => ({ ...u, seeded: true, devices: u.devices.length ? u.devices : seedDevices }));
        }),

      get: (userId) => get().users[userId] || emptyOps(),

      log: (userId, action, detail, tone) => set((s) => patch(s, userId, (u) => withAudit(u, action, detail, tone))),

      deviceToggle: (userId, deviceId) =>
        set((s) =>
          patch(s, userId, (u) => {
            const dev = u.devices.find((d) => d.id === deviceId);
            if (!dev) return u;
            const online = !dev.online;
            const devices = u.devices.map((d) =>
              d.id === deviceId ? { ...d, online, todayEarningsUsd: online ? d.todayEarningsUsd : 0 } : d,
            );
            return withAudit({ ...u, devices }, online ? "设备上线" : "设备下线", `${dev.name} ${deviceId}`, online ? "success" : "danger");
          }),
        ),

      deviceRecycle: (userId, deviceId) =>
        set((s) =>
          patch(s, userId, (u) => {
            const dev = u.devices.find((d) => d.id === deviceId);
            if (!dev) return u;
            const devices = u.devices.map((d) => (d.id === deviceId ? { ...d, online: false, recycled: true, todayEarningsUsd: 0 } : d));
            return withAudit({ ...u, devices }, "设备回收", `${dev.name} ${deviceId} · salvage 不入余额`, "danger");
          }),
        ),

      deviceSwap: (userId, deviceId) =>
        set((s) =>
          patch(s, userId, (u) => {
            const dev = u.devices.find((d) => d.id === deviceId);
            if (!dev) return u;
            const devices = u.devices.map((d) => (d.id === deviceId ? { ...d, generation: d.generation + 1, gpuUsage: 90 + (d.gpuUsage % 10) } : d));
            return withAudit({ ...u, devices }, "设备换机", `${dev.name} ${deviceId} → G${dev.generation + 1}`, "warning");
          }),
        ),

      earningAppend: (userId, kind, delta, memo, ccy = "USDT") =>
        set((s) =>
          patch(s, userId, (u) => {
            // NEX 资产调整:币种隔离 — 只动 NEX 累计 + 审计,不混入 USDT 台账(deltaUsd 语义保持 USDT);刷新不丢。
            if (ccy === "NEX") {
              return withAudit(
                { ...u, balanceAdjustNex: (u.balanceAdjustNex ?? 0) + delta },
                `资产${kind}`,
                `${delta >= 0 ? "+" : ""}${delta} NEX · ${memo}`,
                kind === "红冲" ? "danger" : "success",
              );
            }
            const row: LedgerRow = {
              id: nextId("LX"),
              tsLabel: "刚刚",
              kind,
              deltaUsd: delta,
              status: "已入账",
              ref: memo,
            };
            return withAudit(
              { ...u, ledgerExtra: [row, ...u.ledgerExtra].slice(0, 30), balanceAdjustUsd: u.balanceAdjustUsd + delta },
              `资产${kind}`,
              `${delta >= 0 ? "+" : ""}${delta} USDT · ${memo}`,
              kind === "红冲" ? "danger" : "success",
            );
          }),
        ),

      setFrozen: (userId, frozen) =>
        set((s) => patch(s, userId, (u) => withAudit({ ...u, frozen }, frozen ? "冻结账户" : "解冻账户", frozen ? "提现+交易已冻结,转合规核查" : "已恢复交易", frozen ? "danger" : "success"))),

      revokeSession: (userId, sessionId, label) =>
        set((s) =>
          patch(s, userId, (u) => (u.revokedSessions.includes(sessionId) ? u : withAudit({ ...u, revokedSessions: [...u.revokedSessions, sessionId] }, "吊销会话", label, "warning"))),
        ),

      resetTwoFactor: (userId) => set((s) => patch(s, userId, (u) => withAudit({ ...u, twoFactorReset: true }, "重置 2FA", "已清除两步验证绑定,用户需重新设置", "warning"))),

      markNotifsRead: (userId) => set((s) => patch(s, userId, (u) => withAudit({ ...u, notifsAllRead: true }, "通知全标已读", "清空未读标记", "neutral"))),

      cancelOrder: (userId, orderId, label) =>
        set((s) => patch(s, userId, (u) => (u.cancelledOrderIds.includes(orderId) ? u : withAudit({ ...u, cancelledOrderIds: [...u.cancelledOrderIds, orderId] }, "取消订单", label, "danger")))),
    }),
    { name: "nexion-admin-ops-v1", storage: createJSONStorage(() => localStorage) },
  ),
);

/**
 * persist + SSR 水合门:SSR 与首帧客户端渲染返回 false(读种子,避免 hydration mismatch),
 * localStorage 水合完成后返回 true(切换到持久态)。所有读 useUserOps 的组件必须用它 gate。
 */
export function useOpsHydrated(): boolean {
  // mounted-skeleton 模式(PRD §17.5):SSR + 首帧客户端 = false(读种子,匹配 SSR);
  // mount 后 = true(此时 sync localStorage 已同步水合,切换到持久态)。不依赖 persist 内部 API,最稳妥。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
