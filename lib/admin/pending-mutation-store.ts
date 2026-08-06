/**
 * 幂等键(Idempotency-Key)待定命令的共享持久化存储。
 *
 * 背景:高敏动作提交后若网络结果未知(超时 / 上游 outcome=unknown),运营必须用**同一个**
 * 命令号重试,后端才能去重。命令号只存在内存(模块级 Map / useState / useRef)时,刷新页面即
 * 丢失,重试会铸新命令号 → 重复入账 / 重复操作。sessionStorage 让命令号跨刷新存活。
 *
 * 单源:全仓所有域的待定命令号都走本模块,禁止再复制一份内存态实现。
 * 机器门:`scripts/pending-idempotency-key-sentinel.mjs`(全仓扫内存态幂等键 + 台账)。
 *
 * 作用域说明:
 * - sessionStorage 而非 localStorage —— 命令号是「本次会话本次操作」的凭据,跨标签页 / 跨天
 *   复用只会让过期命令号打到后端;24h TTL 是第二道保险(**从首次尝试起算的硬上限,重试不续期**,
 *   否则客户端记录会活过后端那个固定 24h 窗,窗外复用给的是虚假的去重信心)。
 * - sessionStorage 不可用时(隐私模式 / 配额满)自动降级为本页内存,并 console.warn 一次;
 *   降级期间同会话重试仍复用同号,只是刷新即丢。
 * - 一个 storageKey 可承载多个动作族,由调用方给 fingerprint 加命名空间前缀区分
 *   (见 c3-adjust:submit| / review| / reverse|),不要为每个动作族各建一个 storageKey。
 * - fingerprint 必须把「动作类型 + 目标对象 id」编码进去,否则不同目标会撞 key,把别人的
 *   操作误判成重复提交而吞掉。
 */

export const PENDING_MUTATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingMutationRecord {
  fingerprint: string;
  commandKey: string;
  createdAt: number;
  expiresAt: number;
}

/** 记录里除四个公共字段之外的调用方自定义元数据(如 d-client 的 base/path/method/body)。 */
export type PendingMutationExtra<T extends PendingMutationRecord> = Omit<T, keyof PendingMutationRecord>;

export interface PendingMutationStore<T extends PendingMutationRecord> {
  /** 取该 fingerprint 上一次未收敛的命令号;没有则 undefined(调用方铸新号)。 */
  get(fingerprint: string): string | undefined;
  /**
   * 记住一次尝试。重复 remember 同一 commandKey 会保留原 createdAt,**且不延长 expiresAt**
   * —— 过期时刻恒为「首次尝试 + TTL」,对齐后端从首次请求起算的固定 24h 幂等窗。
   */
  remember(fingerprint: string, commandKey: string, extra?: PendingMutationExtra<T>): void;
  /** 命令已收敛(成功 / 确定性失败),丢弃该 fingerprint 的全部记录。 */
  forget(fingerprint: string): void;
  /** 当前仍有效的全部记录(已剔除过期 / 结构非法项)。 */
  list(): T[];
}

function isBaseRecord(value: unknown, commandKey: string, now: number): value is PendingMutationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as PendingMutationRecord;
  return record.commandKey === commandKey
    && typeof record.fingerprint === "string"
    && record.fingerprint.length > 0
    && typeof record.commandKey === "string"
    && record.commandKey.length > 0
    && Number.isFinite(record.createdAt)
    && Number.isFinite(record.expiresAt)
    && record.expiresAt > now;
}

/**
 * 这张 sessionStorage 表是不是本模块写的命令号表?
 *
 * 🔴 **按记录形状判,不按键名判**(2026-08-06)。键名会漂:全仓 30 个面里
 * `nexgrid-admin-d1-uncertain-commands-v1` 是另一种前缀,`nexion-admin-h9-public-stats-attempt`
 * 干脆既没有 `commands` 也没有版本后缀 —— 任何「按名字匹配」的谓词都会整张漏掉它们,
 * 而且将来新增一把键就又漏一张,没人会记得回来改谓词。四字段签名不会漂。
 */
function isPendingCommandTable(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const rows = Object.entries(parsed);
    if (!rows.length) return false;
    // 空表不算(没什么可泄漏的);非空表要求**每一行**都是命令号记录 —— 只要有一行不是,
    // 就说明这不是本模块的表,宁可不清也不能误删别人的数据。
    return rows.every(([commandKey, value]) => {
      const record = value as Partial<PendingMutationRecord> | null;
      return !!record && typeof record === "object"
        && record.commandKey === commandKey
        && typeof record.fingerprint === "string" && record.fingerprint.length > 0
        && Number.isFinite(record.createdAt) && Number.isFinite(record.expiresAt);
    });
  } catch {
    return false;
  }
}

/**
 * 清掉本次会话残留的**全部**在途命令号,返回清掉的表数(供调用方记日志 / 测试断言)。
 *
 * 何时必须调用:**登出 / 换操作员**。命令号是「谁在什么时候提交了哪条命令」的凭据,
 * 换人不清 = 同一个 tab 里 B 登录后复用 A 的命令号 → 后端按幂等回放 A 的提案:
 * B 的操作被静默吞掉,而审计轨记在 A 头上(操作被吞 + 归属错位,两个都是高敏事故)。
 *
 * ponytail: 各 store 实例的内存镜像由 resetAdminSession 之后的整页 reload 一并清掉
 *           (JS 上下文重建);单靠本函数清不掉别人的闭包,也不该为此建一份全局注册表。
 */
/**
 * 命令号的归属人标记(与命令号表同放 sessionStorage,逐 tab)。
 * 存的是稳定唯一身份(adminId),不是显示名 —— 显示名会重名、会改。
 */
const COMMAND_OWNER_KEY = "nexion-admin-command-owner";

/**
 * 认领本 tab 的在途命令号:换人才清,会话断开不清。返回清掉的表数。
 *
 * 🔴 触发条件是**身份变了**,不是「会话结束了」(2026-08-06 第三轮独立验收 2×P0)。
 *   先前挂在 signOut / resetAdminSession 上,两头都错:
 *   ① 漏:A 没点退出直接按 F5,而 cookie 已换成 B —— 刷新后前端状态为空,
 *      「换人才清」的守卫短路,B 复用 A 的全部命令号;
 *   ② **误伤(本包自己引入的新缺陷)**:会话端点抖一下,console-shell 的 catch 里
 *      signOut() 把**同一个人**的在途命令号全清了 —— 他重新登录再重试必然铸新号 = 重复打款。
 *      而「会话过期后重新登录再重试」正是最典型的重试场景。
 *   身份判据一处到位,顺带解决「显示名重名判不出换人」。
 *
 *   marker 缺失时**保守清扫**:归属不明的命令号不能给下一个人用。
 *   (升级后首次加载会命中一次,属一次性过渡。)
 */
export function claimPendingCommandOwner(ownerId: string): number {
  if (typeof window === "undefined" || !ownerId) return 0;
  let previous: string | null = null;
  try {
    previous = window.sessionStorage.getItem(COMMAND_OWNER_KEY);
  } catch {
    return 0; // 存储不可用 = 本来也没有跨会话残留可清
  }
  if (previous === ownerId) return 0;
  const cleared = clearPendingCommandRecords();
  try {
    window.sessionStorage.setItem(COMMAND_OWNER_KEY, ownerId);
  } catch { /* 降级:清扫已完成,只是下次还会再清一遍,不影响正确性 */ }
  return cleared;
}

/**
 * 清扫代次。每清一次 +1;各 store 实例读到代次变了就作废自己的内存镜像。
 *
 * 🔴 没有它,清扫会被**同步复活**(2026-08-06 独立验收 P0-2,非竞态而是必然序列):
 * `d-client` / `user360-client` 在同一个同步块里先 resetAdminSession() 清空存储、
 * 后 pendingMutations.forget() —— forget 走 readAll(内存还有货、存储已空)再整表 writeAll
 * 写回,刚清掉的命令号原样复活。原设计假设「内存镜像由随后的整页 reload 一并清掉」,
 * 而这条假设被本仓自己的调用点推翻了(reload 发生在这段同步代码之后,退出按钮更是压根不 reload)。
 */
let clearGeneration = 0;

export function clearPendingCommandRecords(storage?: Storage): number {
  // 代次先推进:哪怕下面读存储失败(隐私模式),各实例的内存镜像也必须作废 ——
  // 降级态下内存就是唯一真源,不作废等于换人后照样复用前一个人的号。
  clearGeneration += 1;
  const target = storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage);
  if (!target) return 0;
  try {
    // 先收集再删:边遍历边 removeItem 会让 key(i) 的索引塌陷,漏掉一半。
    const doomed: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key && isPendingCommandTable(target.getItem(key))) doomed.push(key);
    }
    doomed.forEach((key) => target.removeItem(key));
    return doomed.length;
  } catch {
    // 存储不可读 = 本来就没持久化任何命令号,没有残留可清。
    return 0;
  }
}

export function createPendingMutationStore<T extends PendingMutationRecord = PendingMutationRecord>(options: {
  /** sessionStorage 键名。同一动作族共用一个键,靠 fingerprint 前缀分命名空间。 */
  storageKey: string;
  ttlMs?: number;
  /** 公共字段之外的结构校验(元数据字段)。返回 false 的记录读取时即被剔除。 */
  isValidRecord?: (value: T) => boolean;
}): PendingMutationStore<T> {
  const { storageKey, ttlMs = PENDING_MUTATION_TTL_MS, isValidRecord } = options;
  // 空 storageKey 会静默退化成「只有内存、刷新即丢」—— 正是本模块要根治的缺陷。
  // 类型层挡不住 .mjs 调用方,所以在运行时也焊一道。
  if (typeof storageKey !== "string" || !storageKey) {
    throw new Error("PENDING_MUTATION_STORE_REQUIRES_STORAGE_KEY");
  }
  /**
   * 内存镜像**不是读缓存,是降级兜底**(2026-08-06 修正)。
   *
   * 上一版把它当缓存(只存 fingerprint→commandKey),而 `list()` 直接读 sessionStorage 绕过它。
   * 于是隐私模式 / 配额满 —— `writeAll` 静默吞异常、`readAll` 恒返回 {} —— 槽位式调用方
   * (`SlotAttemptStore.resolve` 走的正是 `list()`)**同一会话连续重试也每次铸新号**,
   * 防重复整体失效,而且一声不吭。现在存整条记录,并让 readAll 以它打底。
   */
  const memory = new Map<string, T>();
  let degradedNotified = false;
  let seenGeneration = clearGeneration;

  /** 清扫发生过 → 本实例的内存镜像连同它兜的那份记录一起作废(见 clearGeneration 注释)。 */
  function dropMemoryIfCleared() {
    if (seenGeneration === clearGeneration) return;
    seenGeneration = clearGeneration;
    memory.clear();
  }

  function noteDegraded(action: string) {
    // 只喊一次:提交路径上每次读写都喊会把 console 淹掉,反而盖住问题。
    // ponytail: 只到 console —— 把降级态透到每个调用方的 UI 要改 30 个消费面,越出本包;
    //           真正的止血是下面的内存兜底,告警只是让排查时有迹可循。
    if (degradedNotified) return;
    degradedNotified = true;
    console.warn(
      `[pending-mutation-store] sessionStorage ${action}失败(${storageKey}):命令号降级为「仅本页内存」`
      + " —— 刷新页面即丢失,刷新后重试会铸新命令号,后端无法去重。常见于隐私模式 / 存储配额已满。",
    );
  }

  function usable(value: unknown, commandKey: string, now: number): value is T {
    return isBaseRecord(value, commandKey, now) && (!isValidRecord || isValidRecord(value as T));
  }

  function syncMemory(value: Record<string, T>) {
    memory.clear();
    for (const [commandKey, record] of Object.entries(value)) memory.set(commandKey, record);
  }

  function readAll(): Record<string, T> {
    dropMemoryIfCleared();
    const now = Date.now();
    // 内存打底、存储覆盖:存储可用时两者本就一致;存储不可用时内存是唯一真源。
    const current: Record<string, T> = {};
    for (const [commandKey, record] of memory) {
      if (usable(record, commandKey, now)) current[commandKey] = record;
    }
    let persistedCount: number | null = null;
    if (typeof window !== "undefined") {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}") as Record<string, T>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          persistedCount = Object.keys(parsed).length;
          for (const [commandKey, record] of Object.entries(parsed)) {
            if (usable(record, commandKey, now)) current[commandKey] = record;
          }
        } else {
          persistedCount = 0;
        }
      } catch {
        noteDegraded("读取");
      }
    }
    syncMemory(current);
    // 存储里有过期 / 坏形记录被剪掉,或降级期间攒下的记录终于能落盘 → 回写对齐。
    if (persistedCount !== null && persistedCount !== Object.keys(current).length) {
      writeAll(current);
    }
    return current;
  }

  function writeAll(value: Record<string, T>) {
    syncMemory(value);
    if (typeof window === "undefined") return;
    try {
      if (Object.keys(value).length === 0) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      noteDegraded("写入");
    }
  }

  return {
    get(fingerprint) {
      return Object.values(readAll()).find((value) => value.fingerprint === fingerprint)?.commandKey;
    },
    remember(fingerprint, commandKey, extra) {
      const persisted = readAll();
      const previous = persisted[commandKey];
      // 🔴 TTL 是**从首次尝试起的硬上限,不滑动续期**(2026-08-06 修正)。
      //    后端幂等窗固定 24h 且从第一次请求起算(开发落地规格 §0.4,运营不可调)。
      //    上一版每次 remember 都 `Date.now() + ttl`,连续重试能让客户端记录活过后端窗口 ——
      //    窗外再复用同一个号,后端早已不认,却给了操作员「这次会被去重」的虚假信心。
      const createdAt = previous?.createdAt ?? Date.now();
      // 🔴 四个公共字段全部排在 extra 之后(2026-08-06 独立验收 P2-1):
      //   原顺序里 extra 展开在 fingerprint / commandKey 之后,调用方元数据一旦撞名就能覆盖它们;
      //   commandKey 与行键一旦不符,isBaseRecord 判非法直接丢弃 = 命令号静默丢失。
      //   类型层今天挡得住 TS 调用方,但探针实测确实能覆盖 —— 顺序本身就该免疫。
      persisted[commandKey] = {
        ...(extra as object | undefined),
        fingerprint,
        commandKey,
        createdAt,
        expiresAt: createdAt + ttlMs,
      } as T;
      writeAll(persisted);
    },
    forget(fingerprint) {
      const persisted = readAll();
      Object.entries(persisted).forEach(([commandKey, value]) => {
        if (value.fingerprint === fingerprint) delete persisted[commandKey];
      });
      writeAll(persisted);
    },
    list() {
      return Object.values(readAll());
    },
  };
}

export interface SlotAttemptRecord extends PendingMutationRecord {
  /** 本次尝试的输入指纹(值 / 版本 / 理由…)。与上次不同 = 新意图,换新命令号。 */
  inputFingerprint: string;
}

export interface SlotAttemptStore {
  /** 取该槽位可复用的命令号:输入指纹一致才复用,否则铸新号并丢弃旧号。 */
  resolve(slot: string, inputFingerprint: string, mint: () => string): string;
  /** 命令已收敛,丢弃该槽位。 */
  forget(slot: string): void;
}

/**
 * 「一个槽位同时只有一次在途尝试」的命令号存储。
 *
 * 适用形态:`Map<槽位, { fingerprint, commandKey }>` —— 槽位是目标对象(用户号 / 档位 / 版块…),
 * 输入指纹是本次提交的值。i3 / i4 / j3 / k4 / k5 迁移前都是这个形态的组件 useRef。
 *
 * 为什么不直接把输入指纹拼进 fingerprint:那样旧尝试会留到 TTL 到期。运营改了值再改回来时会
 * 复用那个可能已被后端消费掉的命令号,让一次真实的新操作被当成重复提交静默吞掉。
 */
export function createSlotAttemptStore(options: { storageKey: string; ttlMs?: number }): SlotAttemptStore {
  const store = createPendingMutationStore<SlotAttemptRecord>({
    ...options,
    isValidRecord: (record) => typeof record.inputFingerprint === "string" && record.inputFingerprint.length > 0,
  });
  return {
    resolve(slot, inputFingerprint, mint) {
      const saved = store.list().find((record) => record.fingerprint === slot);
      if (saved?.inputFingerprint === inputFingerprint) {
        store.remember(slot, saved.commandKey, { inputFingerprint });
        return saved.commandKey;
      }
      if (saved) store.forget(slot);
      const commandKey = mint();
      store.remember(slot, commandKey, { inputFingerprint });
      return commandKey;
    },
    forget: store.forget,
  };
}
