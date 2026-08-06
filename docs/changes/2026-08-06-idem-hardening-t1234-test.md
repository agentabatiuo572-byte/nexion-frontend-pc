# 独立验收报告 — 幂等硬化包 T1/T2/T3/T4

- 分支 `pkg/idem-hardening`,受检 commit `ef202b0` / `461903b` / `ace9178` / `8f726ab`
- 验收方式:回源 Read + 自造运行时探针 + 自造变异 battery(不复用 `scripts/_redtest-idem-hardening.mjs` 里的任何一条)
- 自造脚本落在会话 scratchpad(不入仓):`probe-runtime.mjs` / `probe-mutations.mjs` / `probe-mutations2.mjs` / `probe-m2b.mjs` / `enum-keys.mjs`
- 全部注入均「备份 → 注入 → 跑门 → 还原 + sha1 逐字节校验」,末尾 `git status --porcelain` 无残留

## 结论速览

| AC | 判定 | 一句话 |
|---|---|---|
| AC1 T3 兜底 | **PASS** | 存储读写全抛时契约全部成立;自造 6 条破坏,5 条按预期打红,1 条为无效变异(非门的漏洞) |
| AC2 T4 硬上限 | **PASS(门有缺口)** | 运行时行为正确、既有 createdAt 语义未破坏;但硬上限只钉在 `remember` 一处,把续期藏进读路径门抓不到 |
| AC3 T2 清扫 | **FAIL** | 清扫函数本身覆盖全 29 把键;但**主人指定的「登出 / 换操作员」场景根本没接上清扫**,且唯一接上的那条路会被 T3 的内存镜像当场复活 |
| AC4 T1 归类 | **PASS(门可绕过)** | 12 个 client 逐个回源无遗漏;但门只认字面表达式,helper 化 / 反转操作数可在门绿 + tsc 绿的前提下把口径退回去;另有一份未被门覆盖的口径副本 |
| AC5 不波及 | **PASS** | tsc 0 / verify 退出码 0(37/42,5 齿缺兄弟仓如实跳过)/ 红测 45/45 / 7 个 pending·outcome 测试全绿 / 改动面不出 `lib` `scripts` `tests` `docs` |

问题分级:**P0 × 2 · P1 × 4 · P2 × 6**(详见文末)。

---

## AC1 — T3 兜底真成立(PASS)

### 自造运行时探针(`probe-runtime.mjs`,sessionStorage 的 `length/key/getItem/setItem/removeItem` 全抛)

```
[AC1] sessionStorage 读写全抛时的命令号契约
  ✓ 同槽同输入连续 3 次 resolve 返回同一命令号
  ✓ 换输入必须换号
  ✓ forget 后必须铸新号
  ✓ 不同槽位互不顶掉
  ✓ 降级只告警一次
  ✓ 告警文本点明「刷新即丢 / 后端无法去重」
  ✓ 降级期间过期记录不得复用(内存不是免死金牌)
  ✓ 只有写抛(配额满)时同输入重试仍复用同号
  ✓ 只有读抛时同输入重试仍复用同号
```

后两条是仓内测试没有的**半降级**形态(只读抛 / 只写抛)。仓内 `installBrokenStorage` 只造了「读写全抛」;真实的配额满是**只有 `setItem` 抛**,真实的隐私模式在部分浏览器是**只有 `getItem` 抛**。两种半降级下命令号复用同样成立。

### 自造变异(`probe-mutations.mjs`,打 `tests/pending-mutation-store-contract.test.mjs`)

| # | 变异 | 期望 | 实测 | 红因 |
|---|---|---|---|---|
| N1 | `writeAll` 把 `syncMemory` 挪到 `setItem` 成功之后(降级时内存不留) | 红 | ✓ 红 | `'k-2' !== 'k-1'` |
| N2 | `readAll` 读失败的 catch 里 `memory.clear()` | 红 | **绿** | 见下 |
| N3 | `list()` 绕过 `readAll` 直读 sessionStorage(原缺陷的另一半) | 红 | ✓ 红 | `'k-2' !== 'k-1'` |
| N4 | 过期判定失效:`isBaseRecord` 的 `expiresAt > now` 放宽为 `> 0` | 红 | ✓ 红 | 过期项未被剪掉 |
| N5 | 降级告警 `console.warn` → `console.debug`(静默降级) | 红 | ✓ 红 | `0 !== 1` |
| N6 | 内存镜像只存 `{ commandKey }`(退回读缓存形态) | 红 | ✓ 红 | `'k-2' !== 'k-1'` |

**N2 是无效变异,不是门的漏洞**:`readAll` 先从 `memory` 装 `current`,再读存储;catch 里清空 `memory` 之后,函数结尾的 `syncMemory(current)` 又把它填了回去 —— 语义上是恒等变换。据此报绿正确。真正能制造「内存镜像不同步」的注入点是 `writeAll` 的 `syncMemory`(= N1 / 仓内 T3②),两处都咬得住。

判定:**PASS**。

---

## AC2 — T4 硬上限(PASS,但门有缺口)

### 运行时(`probe-runtime.mjs`)

```
[AC2] TTL 硬上限(首次起算,重试不续期)
  ✓ 23h 在途记录再 remember:createdAt 不变
  ✓ 23h 在途记录再 remember:expiresAt 仍钉在首次+24h
  ✓ expiresAt 严格早于「现在+24h」(相等即被从头重算)
  ✓ 连续 200 次重试仍钉在首次+24h
  ✓ 同命令号重复 remember 保留原 createdAt(既有语义未被破坏)
  ✓ 同命令号重复 remember 仍会更新 extra 元数据
  ✓ 超过硬上限的记录不得被复用
  ✓ 过期后再 remember 同号:createdAt 重新起算(不继承已死记录)
  ✓ extra 不能覆盖 createdAt/expiresAt
  ✗ extra 不能覆盖 commandKey / fingerprint
      实际 {"K":{"fingerprint":"OTHER","commandKey":"HIJACK",...}}
```

**「同一命令号重复 remember 保留原 createdAt」的既有语义没有被 T4 破坏**,且 `extra` 元数据仍会被后一次 remember 更新(d-client 的 base/path/method/body 依赖这一点)。

### 反向 / 绕过变异

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| M1 | 换写法的滑动续期:`expiresAt: Math.max(previous?.expiresAt ?? 0, Date.now() + ttlMs)` | 红 | ✓ 红 |
| M2 | 续期**藏进 `readAll`**:活记录读一次就 `expiresAt: now + ttlMs` | 红 | **绿(门抓不到)** |
| M3 | 反误红:`createdAt` 取法换成等价显式三元 | 绿 | ✓ 绿 |
| M4 | `extra` 展开挪到 `createdAt/expiresAt` **之后** | 红 | **绿(门抓不到)** |

M2 在存储可用时会被存储覆盖自愈,所以我补了一条**存储不可用路径**的定量探针(`probe-m2b.mjs`,`ttlMs=40ms`,20ms 读一次、60ms 再读):

```
  基线(未注入): {"midRead":"K","afterCap":null}
  注入 M2 后:   {"midRead":"K","afterCap":"K"}     ← 硬上限被击穿
  store 契约门:绿 ✗
```

M4 的运行时后果同样定量(`probe-mutations2.mjs`):

```
  基线(未注入): {"createdAt":1786010672034,"cappedByTtl":true}
  注入 M4 后:   {"createdAt":1,"cappedByTtl":false}
  store 契约门:绿 ✗(硬上限可被调用方绕开而无人知)
```

判定:**PASS**(实现正确、既有语义未破坏),门缺口记 P1-1 / P2-1。

---

## AC3 — T2 清扫(FAIL)

### (a) 全仓命令号存储键 = 29 把,清扫全覆盖

`enum-keys.mjs` 全树扫 `.ts/.tsx/.mjs`(排除 `tests/` `scripts/`),按 `storageKey: "…"` 与 `createStableMutationExecutor(_, "…")` 两种形态收敛:

- **29 把键 / 29 处声明点**,含题面点名的两种反例:`nexgrid-admin-d1-uncertain-commands-v1`(异前缀)、`nexion-admin-h9-public-stats-attempt`(既不含 `commands` 也没有版本后缀)。
- 台账 `MIGRATED` 30 条 vs 实际持键文件 29 个,差的一条是 `lib/admin/stable-mutation.ts`(执行器模块本身不持键,由 g1/g2/g3/g4/g7 传入)—— **对得上,不是缺口**。
- **没有任何命令号绕过共享 store 直写 storage**:全树 `setItem` 只剩 4 处,分别是 `nexion:l2:view` / `nexion:l4:view`(视图偏好)、`nexion-sidebar-scroll`(滚动位置)、`g4-invite-client.ts` 的 `nexion-admin-g4-invite-codes-v1`(localStorage 里的邀请码 mock 注册表,不是命令号)。

清扫按**记录形状**判而不按键名,所以覆盖的是「所有 29 把 + 将来任何新键」。这一维 **PASS**。

### (b) 误删检验:自造 9 种形状相近的数据

| 诱饵 | 结果 |
|---|---|
| 行键与 `commandKey` 不一致 | ✓ 保留 |
| 缺 `fingerprint` | ✓ 保留 |
| `fingerprint` 为空串 | ✓ 保留 |
| `createdAt/expiresAt` 是 ISO 字符串 | ✓ 保留 |
| 数组而非对象 | ✓ 保留 |
| 混合表(一行像命令号 + 一行是草稿) | ✓ 保留 |
| 非 JSON(`"420"`) | ✓ 保留 |
| 空对象 `{}` | ✓ 保留 |
| **四字段恰好齐全的业务缓存**(`{ "ORDER-1": { fingerprint, commandKey:"ORDER-1", createdAt, expiresAt, note } }`) | **✗ 被误删** |

最后一条是形状判据的**固有代价**,不是 bug —— 但它意味着「以订单号为键、带 fingerprint/时间戳」的任何未来缓存会被登出静默清掉。记 P2-2(建议:写表时加一个 `__kind: "pending-command"` 标记位,判据同时认形状与标记)。

### (c) 清扫排在 reload 之前 — PASS

`lib/admin/auth-session.ts:27` 调清扫,`:31` 才 `.finally(() => window.location.reload())`,且 `tests/pending-mutation-migration-contract.test.mjs` 已用 `indexOf` 先后序钉住。我自造的 C3(删掉原位、挪到 `finally` 回调里 reload 之后)按预期打红。

### (d) 内存镜像残留 — **FAIL,两条 P0**

#### P0-1:主人指定的「登出 / 换操作员」场景根本没接上清扫

`clearPendingCommandRecords` 只接在 `resetAdminSession`(`auth-session.ts:27`)。但 `resetAdminSession` **不是登出路径**,它是各 client 撞 401 时的会话失效自动重置。真正的「退出登录」按钮在 `app/components/shell/topbar.tsx:27-42`:

```
const response = await fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" });
if (!response.ok) throw new Error("服务端会话撤销失败，请重试");
signOut();
```

`signOut` 是 `lib/store/admin-auth.ts` 里的纯 zustand `set({...})` —— **不清 sessionStorage、不清命令号、不 reload**。之后 `console-shell.tsx:159-160` 渲染 `LoginGate`,B 在**同一个 tab** 登录;`lib/admin/login-completion.ts:14-15` 是 `signIn(result); reload();` —— reload 会清掉内存镜像,**但 sessionStorage 跨 reload 存活**。

净结果:**A 点退出 → B 登录 → 29 张表原样留给 B**,B 提交同指纹动作时直接复用 A 的命令号。这正是 `pending-mutation-store.ts:93-96` 与 `auth-session.ts:22-24` 两处注释白纸黑字描述、并声称已修的事故(「B 的操作被静默吞掉,审计轨记在 A 头上」)。

同族第二处:`lib/admin/j-client.ts:66` 撞 401 时调的是 `useAdminAuth.getState().signOut()`,同样绕过清扫与 reload。

#### P0-2:唯一接上清扫的那条路,会被 T3 的内存镜像当场复活

T3 让 `readAll` 以内存打底、并在「存储条目数 ≠ 结果条目数」时回写(`pending-mutation-store.ts:187-191`)。于是清扫之后、reload 落地之前,**任何一次 store 读写都会把内存里的记录重新写回 sessionStorage**:

```
[AC3d] 清扫后、整页 reload 之前的内存镜像
  ✗ 清扫后一次 forget 不得把命令号写回 sessionStorage
      被复活:{"cmd-A-2":{"fingerprint":"PATCH|/y|{}","commandKey":"cmd-A-2",...}}
  ✗ 清扫后 get() 不得仍返回 A 的命令号
```

**这不是竞态,是同步必然序列**。两处调用点在同一个同步块里先后执行:

- `lib/admin/d-client.ts:581` `resetAdminSession()` → `:596` `pendingMutations.forget(mutationFingerprint)`
- `lib/admin/user360-client.ts:771` `resetAdminSession()` → `:783` `pendingUserMutations.forget(mutationFingerprint)`

401 属 4xx = 确定性拒绝,首次尝试时 `!pendingKeyBeforeRequest` 成立,`forget` 必然执行 → `readAll`(内存有货、存储已空)→ `writeAll` 把该 store 剩余记录整表写回。再加上 `.finally(() => reload())` 之前还有一整个 fetch 往返的窗口,期间任何组件读 `store.list()`(如 d 域待确认命令横幅)同样会复活。

`pending-mutation-store.ts:98-99` 的 ponytail 注释「各 store 实例的内存镜像由 resetAdminSession 之后的整页 reload 一并清掉」这个前提,被本包自己的调用点推翻了。

### 自造 T2 变异

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| C1 | 形状判据去掉「行键 == commandKey」对位 | 红 | ✓ 红(`2 !== 1`) |
| C2 | `rows.every` → `rows.some`(一行像就整张清) | 红 | **绿(门抓不到)** |
| C3 | 清扫挪到 reload 之后的 finally 回调里 | 红 | ✓ 红 |
| C4 | 只清 `nexion-` 前缀(漏掉 `nexgrid-` 那把) | 红 | ✓ 红(`28 !== 29`) |

C2 的运行时后果已定量(`probe-mutations2.mjs`):

```
  基线(未注入): {"cleared":0,"mixedSurvived":true}
  注入 C2 后:   {"cleared":1,"mixedSurvived":false}
  迁移契约门:绿 ✗(误删无人知)
```

原因:`tests/pending-mutation-migration-contract.test.mjs` 的反误删诱饵只有**单行**的 `look-alike-but-not-ours`,`some` 与 `every` 对单行表同真同假。缺一条**混合表**诱饵。记 P2-3。

判定:**FAIL**。

---

## AC4 — T1 归类统一

### (a) 12 个 client 逐个回源

| client | 命令号去留判据(行号) | 5xx + 在途号 |
|---|---|---|
| a1 | `:161` `outcomeStaysUnknown(response.status, result?.code)` → throw `A1OutcomeUncertainError` | 归未知 ✓ |
| a2 | `:360` → throw `A2OutcomeUncertainError` | ✓ |
| a3 | `:262` → throw `A3OutcomeUncertainError` | ✓ |
| b2 | `:390-392` 头 ∨ 谓词 → `B2OutcomeUnknownError` | ✓ |
| b3 | `:97-99` 头 ∨ 谓词 → `B3OutcomeUnknownError` | ✓ |
| b5 | `:227-229` 头 ∨ 谓词 → `B5OutcomeUnknownError` | ✓ |
| d | `:594-596` `!outcomeStaysUnknown(...)` 才 `forget` | ✓ |
| i | `:55-56` `!outcomeStaysUnknown(...)` 才 `forget` | ✓ |
| j | `:70-71` 头 ∨ 谓词 → `EmergencyOutcomeUncertainError` | ✓ |
| k | `:118` → `K1OutcomeUncertainError` | ✓ |
| k6 | `:183` → `K6OutcomeUncertainError` | ✓ |
| user360 | `:781-783` `!outcomeStaysUnknown(...)` 才 `forget` | ✓ |

**没有任何一个仍把「5xx + 在途命令号」当确定失败**。三处非归类用途的 `status >= 500` 都带 `classification-ok:` 显式豁免(user360 `:785-787` 挑错误文案)。

注意扫描面口径:门的 `CLIENTS` 过滤条件是「文件里出现 `Outcome(Uncertain|Unknown)Error`」,`d-client` / `i-client` 不含该类型 → **不在门的静态半覆盖内**(d 由 `pending-mutation-store-contract` 的正则钉住,i 只由本次回源覆盖)。记 P2-4。

### (b) 传输层失败一律归「结果未知」

逐条回源(重点查 b2/b3/b5):

- **b2** `:377-384` `try { fetch } catch { if (commandKey) throw B2OutcomeUnknownError }`,唯一写入点 `:424` 设 `Idempotency-Key`。✓
- **b3** 写入走独立包装 `writeFetch`(`:107-113`,catch 直接抛 `B3OutcomeUnknownError`);全文件只有 `:129` 一处带 `Idempotency-Key` 的写,确实走 `writeFetch`;`:116` `:143` 是 GET。✓
- **b5** `:214-221` catch → `B5OutcomeUnknownError`。✓
- a1/a3 catch 内先重试一次,仍失败抛 `*OutcomeUncertainError`;a2 `:336-339`;k `:94-95`;k6 `:155-156`;j `:44-48`(另含 `res.text()` `:53-55` 与 `JSON.parse` `:60-62` 两段中断兜底);user360 `:760-763`。✓
- **d** `:571-576` catch 里**不 forget**、文案带命令号(「请使用同一请求号重试」);**i** `:45-48` catch 原样 rethrow、同样不 forget —— 保号方向正确。✓
- g 域走通用执行器:`stable-mutation.ts:72-75` 只在 `classifyStableMutationFailure(error) === "deterministic"` 时 forget,而非 `StableMutationFailure` 的裸异常(fetch 抛的 TypeError)一律落 `"outcome-unknown"`。✓

### (c) 门能不能咬住退化 —— 部分能

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| B1 | **b5** 退回自搓 `response.status >= 500`(仓内红测打的是 k) | 红 | ✓ 红 |
| B4′ | 把 j-client 的 `EmergencyOutcomeUncertainError` **全量**重命名(整文件掉出扫描面) | 红 | ✓ 红:`只找到 9 个带 outcome 通道的 client,扫描已失真` |
| B2′ | 真判据换成本地 helper `k1Unknown(s, c)`(参数不叫 `status`),另留一条 `outcomeStaysUnknown(200, 0) && false` 的死调用充数 | 红 | **绿 ✗(且 tsc 也绿)** |
| B3 | 反转操作数写成 `!(500 > res.status)` | 红 | **绿 ✗** |

B2′ 的注入把 k-client 的判据变成「恒为确定性拒绝」= 所有失败都弃号 = 资金动作双发,**`outcome classification contract` 门与 `npx tsc --noEmit` 双绿**。原因是门的两条静态判据都只看字面:

- 「不许自搓 5xx 门槛」正则是 `/\bstatus\s*[<>]=?\s*500\b/` —— 参数名不叫 `status`、或操作数反转,都认不出;
- 「谓词必须真的管着命令号去留」只要求文件里**存在**一处 `outcomeStaysUnknown(...)` 且其后 260 字符内有 throw / forget —— 一条永假的死分支即可满足。

顺带记一条实现层的同族问题:`lib/admin/stable-mutation.ts:34-35` 里**另有一份与共享谓词逐字等价的判据副本**,局部常量还叫 `isDeterministicRejection`(与共享函数同名,读起来像是那一个):

```ts
const isDeterministicRejection = (status >= 400 && status < 500)
  || (status >= 200 && status < 300 && typeof apiCode === "number" && apiCode !== 0);
```

`stable-mutation.ts` 不是 `-client.ts`,不在门的扫描面里 —— 也就是说「全仓单源」目前是**两源**,g1/g2/g3/g4/g7 五个域走的是那份副本。今天两份逻辑一致,改一份不会带另一份,而且没有任何门会响。记 P1-3。

### (d) 会不会把「本该报失败」的场景误报成「结果未知」

会,是**明知的代价**,但代价不止于文案:

1. **无副作用的 5xx**(后端未捕获异常、参数解析炸在写库之前)会被告知「可能已生效,请先刷新核对,并使用同一请求号重试」。运营被迫去核对一次从未发生的操作。
2. **502/504 来自反向代理、请求根本没到应用**(滚动重启窗口)同理,而且是**批量**发生 —— d 域 `listD1PendingTopupCommands` 会把这些从未落库的命令列成「待确认」,一挂 24h,把真正需要核对的那几条淹掉。
3. **上游没有「确定失败」的表达位**:`X-Nexion-Upstream-Outcome` 只有 `unknown` 一个分支(b2 `:390`、b3 `:97`、b5 `:227`、j `:70`、k `:112`、k6 `:160` 全是 `=== "unknown"`)。代理即使明确知道是确定失败,只要 HTTP 是 5xx,谓词照样判未知 —— 增强信号只能往「更不确定」推,推不回来。
4. **归类正确但「同号重试」在部分域不成立**:j 域(kill-switch / 地域封锁)的命令号是 `j-client.ts:36` 每次请求现铸的 `idempotencyKey()`,`j1-killswitch.tsx` 在**每次打开确认弹窗**时 `createJEmergencyCommandKey()`;j 域没有任何 pending store。T1 把这条路径的触发面从「代理打了 unknown 头」扩大到「任何 5xx」,等于把「未知态」的发生频次抬高了一个量级。所幸 j 域 UI 的引导是安全的(`j2-geoblock.tsx:100-106`:重新拉服务端权威状态 +「请勿连续提交,以审计记录为准」,不承诺同号重试),所以只是**commit message 里「宁可保号重试」的说法与 j 域实现不符**,不构成运营误导。记 P2-5。

判定:(a)(b) **PASS**;(c) 门**可绕过**记 P1-2;实现层双源记 P1-3;(d) 记 P2-5。

---

## AC5 — 不波及既有面(PASS)

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npm run verify   （判定读工程根 .verify-exit.code,不读管道）
EXITCODE_FILE=0
⚠️  verify 完成,但 5/42 个齿轮**未运行**(环境缺件,非缺陷):
     ⏭  real recharge-channel parity / FE-BE mapping closure ratchet / J1 contract / J2 contract / K2 contract
   原因:本机无兄弟仓 nexion-backend。          ← 与已知环境事实一致

$ node scripts/_redtest-idem-hardening.mjs
红测全部按预期(45 项)
REDTEST_EXIT=0
```

`tests/` 下 pending·outcome 全族逐个单跑:

```
pending-mutation-store-contract            PASS
pending-mutation-migration-contract        PASS
outcome-classification-contract            PASS
a2-outcome-uncertain-contract              PASS
b23-outcome-unknown-contract               PASS
f-pending-store-contract                   PASS
i4-a2-pending-visibility-contract          PASS
```

误伤检查:四个 commit 合并 diff 共 27 файла,`git diff --name-only ef202b0~1 8f726ab | grep -v '^lib/\|^scripts/\|^tests/\|^docs/'` 为空 —— **没碰 `app/` 等其它渲染面**。verify 的 37 个已运行齿(含 J3/K3/K4/K5/G4/F5/B4/D1/H9 等各域契约)全绿,未见既有契约被误伤。

副产品:`a2-outcome-uncertain-contract` / `b23-outcome-unknown-contract` / `i4-a2-pending-visibility-contract` 三个测试**没挂在 `scripts/verify.mjs` 的齿轮表上**(`grep -c` = 0),今天手跑是绿的,但没有任何门在守它们。记 P2-6。

---

## 问题清单

### P0

**P0-1 — 「登出 / 换操作员」这条路根本没接清扫,T2 没有覆盖它声称要修的场景**
顶栏退出按钮走 `topbar.tsx:27-42` → `admin-auth.ts` 的 `signOut()`(纯 zustand set,不清 storage、不 reload);B 登录走 `login-completion.ts:14-15` 的 `signIn + reload`,reload 清内存但 sessionStorage 跨 reload 存活。结果:同一 tab 里 A 退出、B 登录后,29 张命令号表原样可用,B 提交同指纹动作会复用 A 的命令号 → 后端幂等回放 A 的提案(B 的操作被吞 + 审计归属错位)。`j-client.ts:66` 的 401 分支同样只 `signOut()`。
修法方向:把清扫下沉到 `signOut()`(或在 `topbar` / `login-completion` 两处补调),并让「换人」这条路也走整页 reload。

**P0-2 — 清扫会被 T3 的内存镜像当场复活(同步必然序列,非竞态)**
`readAll` 以内存打底 + 条目数不符即回写(`pending-mutation-store.ts:187-191`)。`d-client.ts:581→596` 与 `user360-client.ts:771→783` 都在同一个同步块里先 `resetAdminSession()`(清空 sessionStorage)、后 `pendingMutations.forget()`(把内存整表写回)。探针实测被复活。此外 `.finally(() => reload())` 之前还有一整个 fetch 往返窗口,期间任何 `store.list()` 同样复活。
修法方向:给 store 一个可被清扫触达的注册表 / 版本号(清扫时递增,store 发现版本变了就丢内存),或让 `clearPendingCommandRecords` 同时置一个「本会话已作废」标志位,`readAll` 见到即不回写。

### P1

**P1-1 — TTL 硬上限只钉在 `remember` 一处,读路径续期门抓不到**
把 `expiresAt: now + ttlMs` 塞进 `readAll` 的内存分支,存储不可用时硬上限被击穿(`afterCap` 由 `null` 变 `"K"`),`pending-mutation-store-contract` 全绿。建议补一条契约:降级态下「读多次也不得延寿」。

**P1-2 — `outcome classification contract` 的静态半可被绕过,且绕过版 tsc 也绿**
参数不叫 `status` 的 helper、或 `!(500 > res.status)` 这类反转操作数,配一条永假的 `outcomeStaysUnknown(...)` 死分支充数,即可把某个域的口径退回「5xx = 确定失败」而门全绿。建议:判据从「文件里存在一处 wired 调用」升级为「**每一条**决定命令号去留的分支都由共享谓词驱动」(如禁止 `-client.ts` 里出现除共享谓词外的任何 `\b\d{3}\b` 状态码阈值常量,豁免仍走 `classification-ok:`)。

**P1-3 — 「全仓单源」实际是两源:`stable-mutation.ts:34-35` 有一份等价副本**
局部常量还与共享函数同名 `isDeterministicRejection`,读起来像是引用了共享的那个。g1/g2/g3/g4/g7 五个域走的是这份副本,且 `stable-mutation.ts` 不是 `-client.ts`,不在门的扫描面里。建议:直接 `import { isDeterministicRejection }` 复用,并把门的扫描面从 `-client.ts` 扩到「所有含 `Idempotency-Key` / 命令号去留逻辑的 `lib/admin/*.ts`」。

**P1-4 — 「换人」场景在 `j-client` 上是双重缺口**
`j-client.ts:66` 撞 401 走 `signOut()`,既不清命令号也不 reload;而 j 域本身没有 pending store,`j1-killswitch.tsx` 每次开弹窗现铸命令号。两件事叠加意味着 j 域(kill-switch / 地域封锁,重复执行代价最高的一类)既没有跨刷新的命令号,也没有换人清扫。建议至少统一到 `resetAdminSession`。

### P2

- **P2-1** — `remember` 里 `extra` 展开在 `fingerprint/commandKey` **之后**、`createdAt/expiresAt` **之前**。今天类型层挡住了 TS 调用方,但探针实测 `extra` **确实能覆盖 `commandKey` / `fingerprint`**;一旦被覆盖,记录的 `commandKey` 与行键不符,`isBaseRecord` 直接判非法丢弃 = 命令号静默丢失。且没有任何门钉住这个字段顺序(把 `extra` 挪到最后,门全绿)。建议把四个公共字段全部放在 `extra` 之后,并补一条契约。
- **P2-2** — 形状判据会误删「四字段恰好齐全」的业务缓存(探针里的 `decoy-lookalike-cache` 被清)。建议写表时加 `__kind: "pending-command"` 标记位,判据形状 + 标记双认。
- **P2-3** — 迁移契约的反误删诱饵只有单行表,`rows.every → rows.some` 这种放宽门抓不到(实测混合表被误删而门绿)。建议补一条混合表诱饵。
- **P2-4** — 门的 `CLIENTS` 扫描面靠「文件里出现 `Outcome(Uncertain|Unknown)Error`」筛选,`d-client` / `i-client` 因此不在静态半覆盖内。`CLIENTS.length >= 10` 的下限能咬住「整体掉出扫描面」(B4′ 实测红),但对这两个文件本身零覆盖。
- **P2-5** — commit message 与 `j-client` 注释里「宁可保号重试也不能弃号重铸」的说法,在 j 域没有实现基础(无 pending store、每次开弹窗现铸)。UI 引导本身是安全的(不承诺同号重试),但表述与实现有落差,容易让下一个人以为 j 域已经保号。
- **P2-6** — `tests/a2-outcome-uncertain-contract` / `b23-outcome-unknown-contract` / `i4-a2-pending-visibility-contract` 三个同族测试没挂进 `scripts/verify.mjs` 齿轮表,今天手跑绿但无门守。

---

## 末尾 git status

```
$ git status --porcelain
?? docs/changes/2026-08-06-idem-hardening-t1234-test.md

$ git status --porcelain --ignored | grep -i "probe\|redtest-bak"
(none)
```

仅本报告一个新文件;所有注入均经 sha1 逐字节还原校验(两轮 battery 末尾均报「逐字节一致 ✓」),无 `.probe-bak` / `probe-*` 残留,未 commit / push,未改 `docs/` 下其它文件。
