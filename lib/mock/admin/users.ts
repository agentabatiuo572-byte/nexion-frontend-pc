/** C1 用户检索 & 画像 mock(确定性)。部分用户与提现队列交叉一致(minerJoe/fastCash99…)。 */
import type { AuditEntry } from "@/app/components/kit/audit-timeline";
import { USERS as DESIGN_USERS } from "@/lib/mock/admin/design-data";

export type UserKyc = "已认证" | "复审中" | "待认证";

export interface UserSession {
  id: string;
  device: string;
  ip: string;
  lastActive: string;
}

export interface AdminUser {
  id: string;
  nickname: string;
  email: string;
  registeredAt: string;
  kyc: UserKyc;
  riskScore: number;
  balanceUsd: number;
  nexBalance?: number; // NEX 余额(双币);未显式提供时 360 页按余额/沉淀派生展示,接真后台填真值
  depositedUsd: number;
  withdrawnUsd: number;
  teamSize: number;
  deviceCount: number;
  lifecycle: string; // L0–L5 生命周期
  vRank: string; // V0–V12
  regPhase: string; // 注册时运营阶段
  flags: string[]; // 风险标记
  sessions: UserSession[];
  audit: AuditEntry[];
}

const sess = (id: string, device: string, ip: string, lastActive: string): UserSession => ({ id, device, ip, lastActive });

export const USERS: AdminUser[] = [
  {
    id: "U-88421", nickname: "minerJoe", email: "joe***@gmail.com", registeredAt: "2026-03-12", kyc: "已认证",
    riskScore: 32, balanceUsd: 4_820, depositedUsd: 12_400, withdrawnUsd: 6_200, teamSize: 8, deviceCount: 2,
    lifecycle: "L4", vRank: "V3", regPhase: "P2", flags: [],
    sessions: [sess("s1", "iPhone 15 · iOS 18", "10.21.x.x", "06-02 14:02"), sess("s2", "Chrome · macOS", "10.21.x.x", "06-01 20:11")],
    audit: [{ id: "U-88421-a1", actor: "周岚", role: "finance", action: "余额调整", detail: "补发任务奖励 +30 NEX", at: "05-28 10:20", ip: "10.12.x.x" }],
  },
  {
    id: "U-90233", nickname: "stella_w", email: "stella***@outlook.com", registeredAt: "2026-02-28", kyc: "已认证",
    riskScore: 64, balanceUsd: 18_640, depositedUsd: 42_000, withdrawnUsd: 9_800, teamSize: 31, deviceCount: 4,
    lifecycle: "L5", vRank: "V6", regPhase: "P1", flags: ["大额波动"],
    sessions: [sess("s1", "Android · 小米", "10.33.x.x", "06-02 13:40")],
    audit: [{ id: "U-90233-a1", actor: "陈默", role: "risk", action: "风险标记", detail: "近 7 日提现波动 +180%", at: "06-01 09:05", ip: "10.12.x.x" }],
  },
  {
    id: "U-39922", nickname: "fastCash99", email: "fast***@proton.me", registeredAt: "2026-05-26", kyc: "复审中",
    riskScore: 94, balanceUsd: 47_200, depositedUsd: 48_000, withdrawnUsd: 0, teamSize: 2, deviceCount: 1,
    lifecycle: "L3", vRank: "V1", regPhase: "P3", flags: ["多账户关联", "套现模式", "新账户大额"],
    sessions: [sess("s1", "Chrome · Windows", "45.8.x.x", "06-02 09:30")],
    audit: [
      { id: "U-39922-a1", actor: "陈默", role: "risk", action: "冻结提现", detail: "K1 反多账户命中,转合规核查", at: "06-02 09:40", ip: "10.12.x.x" },
      { id: "U-39922-a2", actor: "Nova 系统", role: "superadmin", action: "自动标记", detail: "设备指纹与 U-39880 重叠", at: "06-02 09:31", ip: "system" },
    ],
  },
  {
    id: "U-77810", nickname: "cryptoLily", email: "lily***@gmail.com", registeredAt: "2026-04-18", kyc: "已认证",
    riskScore: 18, balanceUsd: 320, depositedUsd: 1_200, withdrawnUsd: 600, teamSize: 0, deviceCount: 1,
    lifecycle: "L3", vRank: "V0", regPhase: "P2", flags: [],
    sessions: [sess("s1", "iPhone 13", "10.55.x.x", "06-02 15:40")], audit: [],
  },
  {
    id: "U-66120", nickname: "newbie_8821", email: "n8821***@163.com", registeredAt: "2026-05-30", kyc: "复审中",
    riskScore: 88, balanceUsd: 9_600, depositedUsd: 9_600, withdrawnUsd: 0, teamSize: 0, deviceCount: 1,
    lifecycle: "L2", vRank: "V0", regPhase: "P3", flags: ["新账户大额", "KYC 待补"],
    sessions: [sess("s1", "Android · OPPO", "27.18.x.x", "06-02 12:18")],
    audit: [{ id: "U-66120-a1", actor: "陈默", role: "risk", action: "风险标记", detail: "7 天内首提 + 大额", at: "06-02 12:35", ip: "10.12.x.x" }],
  },
  {
    id: "U-51002", nickname: "hodler_max", email: "max***@gmail.com", registeredAt: "2026-01-15", kyc: "已认证",
    riskScore: 24, balanceUsd: 1_240, depositedUsd: 28_000, withdrawnUsd: 22_000, teamSize: 14, deviceCount: 3,
    lifecycle: "L5", vRank: "V5", regPhase: "P1", flags: [],
    sessions: [sess("s1", "Chrome · Windows", "10.61.x.x", "06-02 11:00")], audit: [],
  },
  {
    id: "U-43391", nickname: "quietRiver", email: "river***@yahoo.com", registeredAt: "2026-03-02", kyc: "已认证",
    riskScore: 71, balanceUsd: 26_800, depositedUsd: 31_000, withdrawnUsd: 4_200, teamSize: 22, deviceCount: 2,
    lifecycle: "L5", vRank: "V4", regPhase: "P2", flags: ["大额提现"],
    sessions: [sess("s1", "iPad · iOS 18", "10.72.x.x", "06-02 10:12")], audit: [],
  },
  {
    id: "U-28457", nickname: "moonbase", email: "moon***@gmail.com", registeredAt: "2026-04-30", kyc: "已认证",
    riskScore: 29, balanceUsd: 760, depositedUsd: 2_000, withdrawnUsd: 1_100, teamSize: 1, deviceCount: 1,
    lifecycle: "L3", vRank: "V0", regPhase: "P3", flags: [],
    sessions: [sess("s1", "iPhone 14", "10.84.x.x", "06-02 15:02")], audit: [],
  },
  {
    id: "U-11203", nickname: "earlybird", email: "early***@hotmail.com", registeredAt: "2026-05-22", kyc: "待认证",
    riskScore: 55, balanceUsd: 13_400, depositedUsd: 13_400, withdrawnUsd: 0, teamSize: 3, deviceCount: 1,
    lifecycle: "L2", vRank: "V0", regPhase: "P3", flags: ["KYC 待补"],
    sessions: [sess("s1", "Android · 三星", "10.95.x.x", "06-02 14:45")], audit: [],
  },
  {
    id: "U-50098", nickname: "vault_keeper", email: "vault***@proton.me", registeredAt: "2026-02-10", kyc: "已认证",
    riskScore: 76, balanceUsd: 33_500, depositedUsd: 40_000, withdrawnUsd: 7_500, teamSize: 19, deviceCount: 3,
    lifecycle: "L5", vRank: "V5", regPhase: "P1", flags: ["大额提现"],
    sessions: [sess("s1", "Chrome · macOS", "10.99.x.x", "06-02 12:50")], audit: [],
  },
  {
    id: "U-62214", nickname: "silentNode", email: "silent***@gmail.com", registeredAt: "2026-04-05", kyc: "已认证",
    riskScore: 47, balanceUsd: 6_300, depositedUsd: 8_400, withdrawnUsd: 2_000, teamSize: 6, deviceCount: 2,
    lifecycle: "L4", vRank: "V2", regPhase: "P2", flags: [],
    sessions: [sess("s1", "iPhone 15 Pro", "10.41.x.x", "06-02 13:18")], audit: [],
  },
  {
    id: "U-30771", nickname: "freshStart", email: "fresh***@gmail.com", registeredAt: "2026-06-01", kyc: "待认证",
    riskScore: 12, balanceUsd: 0, depositedUsd: 0, withdrawnUsd: 0, teamSize: 0, deviceCount: 0,
    lifecycle: "L0", vRank: "V0", regPhase: "P3", flags: ["未绑卡"],
    sessions: [sess("s1", "iPhone 12", "10.12.x.x", "06-02 16:05")], audit: [],
  },
];

// 确定性 PRNG(FNV-1a),供 design-data 用户映射派生缺失字段(SSR/CSR 一致)。
function seededUser(s: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 把检索列表(design-data)的用户映射成 360 HUB 所需的 AdminUser:已知字段直取,资金/团队等缺失字段确定性派生。
function fromDesignUser(d: (typeof DESIGN_USERS)[number]): AdminUser {
  const r = seededUser(d.id);
  const deposited = Math.round((d.balance * (1.3 + r() * 1.4)) / 100) * 100;
  const withdrawn = Math.round((deposited * r() * 0.5) / 100) * 100;
  const handle = d.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6) || "user";
  return {
    id: d.id, nickname: d.name, email: `${handle}***@mail.com`, registeredAt: d.joined,
    // pending = 未验证 → 「待认证」(C4 三态口径;「复审中」专指 K5 工单在审,页面层再按 C4 权威实时覆盖)。
    kyc: d.kyc === "verified" ? "已认证" : "待认证", riskScore: d.risk,
    balanceUsd: d.balance, nexBalance: d.nex, depositedUsd: deposited, withdrawnUsd: withdrawn,
    teamSize: 2 + Math.floor(r() * 40), deviceCount: d.devices, lifecycle: d.lc, vRank: d.vrank,
    regPhase: "P" + (1 + Math.floor(r() * 6)), flags: d.frozen ? ["已冻结"] : d.risk >= 70 ? ["高风险"] : [],
    sessions: [sess(d.id + "-s1", "iPhone 15 · iOS 18", `10.${20 + Math.floor(r() * 80)}.x.x`, "刚刚")],
    audit: [],
  };
}

// 检索详情:先查权威 USERS,未命中再映射检索列表(design-data)用户 → 任意列表用户都能进 360 HUB。
export function findUser(id: string): AdminUser | undefined {
  const u = USERS.find((x) => x.id === id);
  if (u) return u;
  const d = DESIGN_USERS.find((x) => x.id === id);
  return d ? fromDesignUser(d) : undefined;
}

export function searchUsers(q: string, kyc: "all" | UserKyc, highRiskOnly: boolean): AdminUser[] {
  const query = q.trim().toLowerCase();
  return USERS.filter((u) => {
    if (kyc !== "all" && u.kyc !== kyc) return false;
    if (highRiskOnly && u.riskScore < 70) return false;
    if (!query) return true;
    return (
      u.id.toLowerCase().includes(query) ||
      u.nickname.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query)
    );
  });
}
