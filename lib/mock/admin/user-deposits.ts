/**
 * C1 投入卡 mock — 单用户充值明细(确定性,SSR/CSR 一致:纯由 userId 派生,无 Date.now/Math.random)。
 * backend-replaceable:
 *   topups      → GET /api/admin/bills?userId=&type=topup        (D4 账本权威)
 *   adjustments → C3 GET /api/admin/users/:userId/adjustments    (D4 落 adjustment bill)
 *   curve30d    → wallet.topup_confirmed 事件按日聚合             (A4 §2.4.5 ③ money)
 * 累计/余额 canonical 来自 C1 聚合端点 GET /api/admin/users/:userId/profile(本 mock 用 AdminUser 聚合字段)。
 */
export type TopupStatus = "posted" | "pending" | "failed";
export interface TopupBill {
  id: string;
  tsLabel: string; // 服务端权威 ms epoch 的展示态
  amountUsd: number;
  status: TopupStatus;
  channel: string;
  ref: string; // PSP 充值单 / 链上 txid
}
export type DepositAdjKind = "对账核销" | "拒付冲正" | "余额补记";
export interface DepositAdjustment {
  id: string;
  tsLabel: string;
  deltaUsd: number; // 带符号;拒付冲正为负
  kind: DepositAdjKind;
  ticket: string;
  maker: string;
  checker: string;
}
export interface UserDeposits {
  topups: TopupBill[];
  adjustments: DepositAdjustment[];
  curve30d: number[]; // 近 30 日按日 topup 入账额
}

const CHANNELS = ["USDT-TRC20", "USDT-ERC20", "Bank-PSP", "Card-PSP"];
const KINDS: DepositAdjKind[] = ["对账核销", "拒付冲正", "余额补记"];
const MAKERS = ["周岚", "陈默", "李航"];
const CHECKERS = ["总管理员", "王敏"];

// FNV-1a seeded PRNG — 确定性,跨 SSR/CSR 稳定
function seeded(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad2 = (n: number) => String(n).padStart(2, "0");

export function getUserDeposits(userId: string, depositedUsd: number): UserDeposits {
  const rnd = seeded(userId + ":deposit");
  if (depositedUsd <= 0) return { topups: [], adjustments: [], curve30d: Array.from({ length: 30 }, () => 0) };

  // 逐笔 topup:4-8 笔,和 ≈ depositedUsd(末笔取余使总额闭合)
  const n = 4 + Math.floor(rnd() * 5);
  const topups: TopupBill[] = [];
  let remaining = depositedUsd;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const amt = last ? Math.max(0, Math.round(remaining)) : Math.round((remaining / (n - i)) * (0.6 + rnd() * 0.8));
    remaining -= amt;
    const r = rnd();
    const status: TopupStatus = r < 0.82 ? "posted" : r < 0.93 ? "pending" : "failed";
    const mo = 1 + Math.floor(rnd() * 5);
    const da = 1 + Math.floor(rnd() * 27);
    topups.push({
      id: "TP-" + userId.slice(2) + "-" + pad2(i + 1),
      tsLabel: "2026-" + pad2(mo) + "-" + pad2(da) + " " + pad2(Math.floor(rnd() * 24)) + ":" + pad2(Math.floor(rnd() * 60)),
      amountUsd: amt,
      status,
      channel: CHANNELS[Math.floor(rnd() * CHANNELS.length)],
      ref: "PSP-" + Math.floor(rnd() * 0xffffffff).toString(16).toUpperCase().padStart(8, "0"),
    });
  }
  topups.sort((a, b) => (a.tsLabel < b.tsLabel ? 1 : -1)); // 新→旧

  // 调整记录:有 audit/大额标记的用户更可能有
  const adjN = rnd() < 0.5 ? 1 + Math.floor(rnd() * 2) : 0;
  const adjustments: DepositAdjustment[] = [];
  for (let i = 0; i < adjN; i++) {
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    const sign = kind === "拒付冲正" ? -1 : 1;
    adjustments.push({
      id: "ADJ-" + userId.slice(2) + "-" + (i + 1),
      tsLabel: "2026-0" + (1 + Math.floor(rnd() * 5)) + "-" + pad2(1 + Math.floor(rnd() * 27)),
      deltaUsd: sign * Math.round(50 + rnd() * 900),
      kind,
      ticket: "WO-" + Math.floor(1000 + rnd() * 9000),
      maker: MAKERS[Math.floor(rnd() * MAKERS.length)],
      checker: CHECKERS[Math.floor(rnd() * CHECKERS.length)],
    });
  }

  // 30 日曲线:右偏(近端更密),峰值 ~ depositedUsd/12
  const peak = depositedUsd / 12;
  const curve30d = Array.from({ length: 30 }, () => Math.round(rnd() * rnd() * peak));
  return { topups, adjustments, curve30d };
}
