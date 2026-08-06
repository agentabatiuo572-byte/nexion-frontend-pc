/**
 * G4 创世邀请码码表 — 发码 / 作废 / 追溯(规格 FEAT-GEN11)。
 *
 * 边界(主人 2026-08-04 指令):**不写后端服务接口实现**。本仓其余 G4 动作走
 * `g4-client.ts`,经 `/api/admin/market/nex/genesis` 那一族代理到兄弟仓真后端;
 * 邀请码这一档是 mock 驱动的控制台,数据源 = 本地 `nexion-admin-*` 命名空间的持久化码表。
 * (此处写具体已登记路径而非通配写法 —— endpoint-citation 哨兵会扫注释里的接口引用,
 *  带 `**` 的形态对不上台账、会被判成「引用了不存在的接口」。)
 *
 * 但**结构 100% 按真后台写**(项目铁律 mock-real-compatible),接后台时只换本文件的
 * 三个 async 函数体,调用方一行不用改:
 *   - 全部对外函数 async + 失败 throw Error(与 g4Request 同款失败语义);
 *   - 单条码是可序列化的扁平记录,时刻用 ms epoch;持久键带版本号;
 *   - 发码 / 作废是写动作 → 真后台侧带 Idempotency-Key + 服务端事务(见各函数注释)。
 *
 * 真后台对接点:发码 / 作废走**创世域后台接口**,归后台 PRD 线,本规格不定义具体路径
 * (规格 ⑦)。用户侧核销由 server 事务保证一码一用,不由本控制台承担。
 */

/** 码状态机(规格 ④):unused →(用户核销)used[终态] / →(运营作废)void[终态]。 */
export type G4InviteStatus = "unused" | "used" | "void";

export interface G4InviteCode {
  code: string;
  status: G4InviteStatus;
  issuedBy: string;
  issuedAt: number;
  note: string;
  /** 核销账号 / 时刻:仅 used 态非空。 */
  redeemedBy: string | null;
  redeemedAt: number | null;
  /** 作废操作者 / 时刻 / 理由:仅 void 态非空。 */
  voidedBy: string | null;
  voidedAt: number | null;
  voidReason: string | null;
}

export interface G4InviteRegistry {
  codes: G4InviteCode[];
  counts: Record<G4InviteStatus | "all", number>;
}

/** 运营面可读中文(项目铁律:页面禁裸枚举值)。 */
export const G4_INVITE_STATUS_LABEL: Record<G4InviteStatus, string> = {
  unused: "未使用",
  used: "已使用",
  void: "已作废",
};

export const G4_INVITE_STATUS_TONE: Record<G4InviteStatus, string> = {
  unused: "ok",
  used: "dim",
  void: "bad",
};

const STORAGE_KEY = "nexion-admin-g4-invite-codes-v1";
const CODE_PREFIX = "NEXGRID-OG-";
/** 去掉 I/O/0/1:码要被运营念给用户、被用户手输,形近字符是真实的客诉来源。 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_BODY_LENGTH = 4;

export const G4_INVITE_MAX_BATCH = 100;
export const G4_INVITE_NOTE_MAX = 60;
export const G4_INVITE_REASON_MIN = 8;
export const G4_INVITE_REASON_MAX = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asTimeOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStatus(value: unknown): G4InviteStatus {
  return value === "used" || value === "void" ? value : "unused";
}

/** 磁盘 → 内存:未知形态整条丢弃,不让脏行把列表渲染成半截。 */
function normalizeCode(raw: unknown): G4InviteCode | null {
  if (!isRecord(raw)) return null;
  const code = asText(raw.code);
  if (!code) return null;
  const status = asStatus(raw.status);
  return {
    code,
    status,
    issuedBy: asText(raw.issuedBy, "unknown-admin"),
    issuedAt: asTimeOrNull(raw.issuedAt) ?? 0,
    note: asText(raw.note),
    redeemedBy: status === "used" ? asTextOrNull(raw.redeemedBy) : null,
    redeemedAt: status === "used" ? asTimeOrNull(raw.redeemedAt) : null,
    voidedBy: status === "void" ? asTextOrNull(raw.voidedBy) : null,
    voidedAt: status === "void" ? asTimeOrNull(raw.voidedAt) : null,
    voidReason: status === "void" ? asTextOrNull(raw.voidReason) : null,
  };
}

function readTable(): G4InviteCode[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCode).filter((row): row is G4InviteCode => row !== null);
  } catch {
    return [];
  }
}

function writeTable(codes: G4InviteCode[]) {
  if (typeof window === "undefined") throw new Error("G4_INVITE_STORAGE_UNAVAILABLE");
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    throw new Error("G4_INVITE_STORAGE_WRITE_FAILED");
  }
}

function countBy(codes: G4InviteCode[]): G4InviteRegistry["counts"] {
  return {
    all: codes.length,
    unused: codes.filter((row) => row.status === "unused").length,
    used: codes.filter((row) => row.status === "used").length,
    void: codes.filter((row) => row.status === "void").length,
  };
}

/** 发放时间倒序 —— 运营最关心刚发的那批。 */
function toRegistry(codes: G4InviteCode[]): G4InviteRegistry {
  return {
    codes: [...codes].sort((a, b) => b.issuedAt - a.issuedAt || a.code.localeCompare(b.code)),
    counts: countBy(codes),
  };
}

function randomBody() {
  const size = CODE_BODY_LENGTH;
  const bytes = new Uint8Array(size);
  const source = typeof globalThis.crypto?.getRandomValues === "function" ? globalThis.crypto : null;
  if (source) source.getRandomValues(bytes);
  else for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < size; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * 生成 count 个**互不重复、且与存量不重复**的码。
 * 系统出码,不接受手输(规格 ④ 禁止动作)——手输会撞码,也会长出可猜的人为规律。
 */
function mintCodes(count: number, taken: Set<string>): string[] {
  const minted: string[] = [];
  // 32^4 ≈ 100 万个码位;单次最多 100 个,撞码重摇即可。上界防「码位耗尽时死循环」。
  const maxAttempts = count * 200 + 1000;
  for (let attempt = 0; minted.length < count; attempt++) {
    if (attempt >= maxAttempts) throw new Error("G4_INVITE_CODE_SPACE_EXHAUSTED");
    const candidate = `${CODE_PREFIX}${randomBody()}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    minted.push(candidate);
  }
  return minted;
}

/** 读码表。真后台:GET 创世域邀请码列表(分页/筛选由 server 承担)。 */
export async function fetchG4InviteCodes(): Promise<G4InviteRegistry> {
  return toRegistry(readTable());
}

/**
 * 批量发码。真后台:POST 创世域发码接口(带 Idempotency-Key,server 单事务铸码 + 落审计)。
 * 发放人 / 时刻即审计留痕:每条码自带 issuedBy/issuedAt,列表可逐条追溯。
 */
export async function issueG4InviteCodes(
  count: number,
  note: string,
  operator: string,
): Promise<{ issued: G4InviteCode[]; registry: G4InviteRegistry }> {
  if (!Number.isInteger(count) || count < 1 || count > G4_INVITE_MAX_BATCH) {
    throw new Error(`单次生成数量需为 1-${G4_INVITE_MAX_BATCH} 的整数`);
  }
  const trimmedNote = note.trim();
  if (trimmedNote.length > G4_INVITE_NOTE_MAX) {
    throw new Error(`发放备注不能超过 ${G4_INVITE_NOTE_MAX} 字`);
  }
  const current = readTable();
  const minted = mintCodes(count, new Set(current.map((row) => row.code)));
  const issuedAt = Date.now();
  const issued: G4InviteCode[] = minted.map((code) => ({
    code,
    status: "unused",
    issuedBy: operator,
    issuedAt,
    note: trimmedNote,
    redeemedBy: null,
    redeemedAt: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  }));
  const next = [...current, ...issued];
  writeTable(next);
  return { issued, registry: toRegistry(next) };
}

/**
 * 作废一个**未使用**的码。真后台:POST 创世域作废接口(带 Idempotency-Key + A2 审计)。
 *
 * 🔴 规格 ④ 禁止动作:永不允许 used → void(已核销 = 资格已发生,收回资格走「取消资格」)。
 * 前置条件在**读到的最新码表**上复核 —— 页面上那一行可能是几分钟前的快照。
 */
export async function voidG4InviteCode(
  code: string,
  reason: string,
  operator: string,
): Promise<{ code: G4InviteCode; registry: G4InviteRegistry }> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < G4_INVITE_REASON_MIN || trimmedReason.length > G4_INVITE_REASON_MAX) {
    throw new Error(`作废理由需 ${G4_INVITE_REASON_MIN}-${G4_INVITE_REASON_MAX} 字`);
  }
  const current = readTable();
  const target = current.find((row) => row.code === code);
  if (!target) throw new Error("邀请码不存在或已被移除,请刷新后重试");
  if (target.status === "void") throw new Error("该邀请码已是已作废状态");
  if (target.status === "used") throw new Error("已核销的邀请码不可作废,请改走取消资格流程");
  const voided: G4InviteCode = {
    ...target,
    status: "void",
    voidedBy: operator,
    voidedAt: Date.now(),
    voidReason: trimmedReason,
  };
  const next = current.map((row) => (row.code === code ? voided : row));
  writeTable(next);
  return { code: voided, registry: toRegistry(next) };
}
