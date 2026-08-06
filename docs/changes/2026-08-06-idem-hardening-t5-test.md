# T5 幂等硬化包 —— 独立验收报告(2026-08-06)

被验对象:`scripts/lib/strip-comments.mjs`(新)、`scripts/pending-idempotency-key-sentinel.mjs`、
`scripts/uni-storage-key-sentinel.mjs`、`scripts/h9-public-stats-parity.mjs`、`scripts/_redtest-idem-hardening.mjs`(新)。
分支 `pkg/idem-hardening`,worktree `D:\WORKS\PLAN\admin-ops\.claude\worktrees\blissful-hodgkin-e878ca`。

验收方式:全部回源自跑,不采信实现方叙述。所有变异走「工程内 `.t5probe-bak` 副本 + finally 还原」,
禁 `git checkout`。探针脚本落在会话 scratchpad,未入仓。

## 结论速览

| AC | 判定 | 一句话 |
|---|---|---|
| AC1 核心漏洞真被堵住 | **FAIL** | 自造 8 种走私,3 种被挡、**5 种仍全绿**;其中 4 种连 tsc + 迁移契约测试也一并骗过 |
| AC2 门不会误红 | **FAIL** | 自造 12 种合法写法,**3 种被误判红**(executor 折行尾逗号 / storageKey 抽常量 / 协议相对 URL) |
| AC3 剥注释器失效必大声失败 | **FAIL** | 7 种改坏法:4 种大声红,**3 种静默绿**(两条正则各自丢 `g` 标志 + `html` 分支被摘) |
| AC4 不波及其它门 | **PASS** | 4 项全绿;MIGRATED 反解析出 30 条(非空);`npm run verify` 退出码 0(36/41 齿,5 齿缺 nexion-backend 跳过) |
| AC5 红测自身可信 | **PASS(带保留)** | 13/13 按预期、退出码 0;8 条打红用例逐条复核**理由都对**;但 ⑫⑬ 是空注入、harness 只看退出码不看哪条判据红 |

> 总评:这轮硬化**确实关掉了它自己记录的那条走私路径**(已独立复现:旧哨兵 + T5① 注入 = 绿,新哨兵 = 红),
> 但同族的其它入口没关。判据从「文中提到模块名」收紧到「真 import 了 create\* 符号」,
> 收紧的是**符号名**,没收紧**绑定去向**——别名、同名本地文件、`import type`、executor 旁路四条路全通。

---

## AC1 —— 核心漏洞真被堵住:**FAIL**

变异全部打在已迁移文件(`k1-multiaccount.tsx` 命令号式 / `k4-scoring.tsx` 槽位式 / `g1-client.ts` executor 式),
门 = `node scripts/pending-idempotency-key-sentinel.mjs`。

| # | 走私形态 | 哨兵 | tsc | 迁移契约测试 | 判定 |
|---|---|---|---|---|---|
| M1 | 真 store 只以**别名** import(永不使用)+ 同名本地内存桩接管全部调用点 | 🟢 PASS | 🟢 0 错 | 🟢 9/9 | **FAIL(P0)** |
| M1' | 同上,打在槽位式文件 k4(会过判据 3b 的 resolve/forget 核对) | 🟢 PASS | 🟢 0 错 | — | **FAIL(P0)** |
| M2 | import 路径改指**自造同名本地文件** `lib/admin/probe-pending-mutation-store.ts` | 🟢 PASS | 🟢 0 错 | 🟢 9/9 | **FAIL(P0)** |
| M4 | 删掉真 store,只留一个**悬空 executor 常量**顶包 → viaExecutor 分支 `continue` 免检 | 🟢 PASS | 🟢 0 错 | 🟢 9/9 | **FAIL(P0)** |
| M5 | executor 侧同款路径走私:`lib/admin/probe-stable-mutation.ts` | 🟢 PASS | 🟢 0 错 | 🟢 9/9 | **FAIL(P0)** |
| M3 | 真 import 改成 `import type`(运行时绑定被擦除) | 🟢 PASS | 🔴 TS1361 | 🟢 9/9 | **FAIL(P2,tsc 兜住)** |
| M6 | 模块名只活在字符串常量里 + 同名本地桩 | 🔴 FAIL | — | — | 挡住 ✅ |
| M7 | 静态 import 换成 `const {…} = await import(…)` | 🔴 FAIL | — | — | 挡住 ✅ |
| M8 | 多行块注释(JSDoc 形态)包住真 import + 同名本地桩 | 🔴 FAIL | — | — | 挡住 ✅ |

### 证据

```
========== AC1:注释/桩函数走私(期望全部 red) ==========
!!  [期望red] M1 别名 import + 同名本地桩(import 绑定判据被别名绕过)  => EXIT=0
      pending-idempotency-key sentinel PASS (扫描 353 个文件 / 命中 5 处 / 台账 5 条,其中待迁欠账 0 条 / 已迁 30 个文件,其中 25 个 store 标识符逐个核过调用点)
!!  [期望red] M2 import 路径改指自造同名本地文件(路径子串判据)  => EXIT=0
      pending-idempotency-key sentinel PASS (扫描 354 个文件 / …)
!!  [期望red] M3 真 import 换成 import type(运行时绑定被擦除)  => EXIT=0
!!  [期望red] M4 悬空 executor 常量顶包(viaExecutor 分支 continue 免检)  => EXIT=0
      pending-idempotency-key sentinel PASS (… 其中 24 个 store 标识符逐个核过调用点)
!!  [期望red] M5 executor import 路径改指自造同名本地文件  => EXIT=0
OK  [期望red] M6 模块名只活在字符串常量里 + 同名本地桩  => EXIT=1
      - k1-multiaccount.tsx 没有从共享 store(...)import create{PendingMutation,SlotAttempt}Store(剥注释后判定)…
OK  [期望red] M7 静态 import 换成动态 await import(...)  => EXIT=1
OK  [期望red] M8 多行块注释包住真 import + 同名本地桩  => EXIT=1
```

第二道复核(同一注入换成跑 tsc / 迁移契约测试):

```
!!  [期望red] M1 别名+同名桩 → tsc  => EXIT=0            (空输出 = 0 错)
!!  [期望red] M1 别名+同名桩 → 迁移契约 test  => EXIT=0   (ℹ pass 9 / fail 0)
!!  [期望red] M2 同名本地文件 → tsc  => EXIT=0
OK  [期望red] M3 import type → tsc  => EXIT=2
      k1-multiaccount.tsx(18,24): error TS1361: 'createPendingMutationStore' cannot be used as a value because it was imported using 'import type'.
!!  [期望red] M4 悬空 executor → tsc  => EXIT=0
!!  [期望red] M5 executor 同名本地文件 → tsc  => EXIT=0
```

k4(槽位式)复验:

```
!!  [期望red] M1' k4 别名 import + 同名本地槽位桩 → 哨兵  => EXIT=0
!!  [期望red] M1' k4 别名 import + 同名本地槽位桩 → tsc  => EXIT=0
```

### 根因(三条判据、一个共同病灶:判「名字出现过」而不判「绑定去向」)

`scripts/pending-idempotency-key-sentinel.mjs` L194-200:

```js
const importsStore = new RegExp(
  `import\\s*(?:type\\s*)?\\{[^}]*\\bcreate(?:PendingMutation|SlotAttempt)Store\\b[^}]*\\}`
  + `\\s*from\\s*["'][^"']*pending-mutation-store(?:\\.ts)?["']`,
).test(code);
const direct = importsStore && /create(?:PendingMutation|SlotAttempt)Store\s*(?:<[^>]*>)?\s*\(/.test(code);
const importsExecutor = /import\s*\{[^}]*\bcreateStableMutationExecutor\b[^}]*\}\s*from\s*["'][^"']*stable-mutation(?:\.ts)?["']/.test(code);
const viaExecutor = importsExecutor && /createStableMutationExecutor\s*\(/.test(code);
```

1. **`[^}]*` 允许 `as 别名`**:`{ createPendingMutationStore as _realPendingStore }` 照样命中,
   而调用点用的是同文件里另一个同名的本地 const。「import 了这个符号」与「调用点用的是这个符号」中间没有连线。
2. **`[^"']*pending-mutation-store` 是子串判据**:任何路径只要**含**这段子串就算数
   (`probe-pending-mutation-store`、`fake-pending-mutation-store`、`x/pending-mutation-store-stub` 全过)。
   `stable-mutation` 侧同病。
3. **`(?:type\s*)?` 主动放行 `import type`**:类型导入运行时不存在,却被当成真绑定。
4. **viaExecutor 分支 `continue` 是免检金牌**(L201-206):只要文件里有一处
   「真 executor import + 带字面量 storageKey 的调用」,不论那个 executor 有没有被使用,
   该文件后续**全部**判据(含判据 3b 的悬空 const 核对)一律跳过。M4 就是拿一个 `void` 掉的
   executor 常量换整文件免检。注意这条与判据 3 自己的立意直接矛盾——3b 存在的理由正是
   「悬空 const 没人会去删」,而 executor 分支恰恰不查悬空。

### 复现步骤(M1,最短)

```bash
cd <repo>
# 1) 把 k1 的真 import 改成别名,并加一个同名本地内存桩
#    import { createPendingMutationStore as _realPendingStore } from "@/lib/admin/pending-mutation-store";
#    const createPendingMutationStore = (_o: { storageKey: string }) => { const cells = new Map<string,string>();
#      return { get: k => cells.get(k), remember: (k,v) => { cells.set(k,v); }, forget: k => { cells.delete(k); }, list: () => [] }; };
# 2) 三道门全绿:
node scripts/pending-idempotency-key-sentinel.mjs   # PASS
node node_modules/typescript/bin/tsc --noEmit       # 0 错
node --test tests/pending-mutation-migration-contract.test.mjs   # 9/9
# 实际后果:k1 的命令号只活在内存,刷新即清零 —— 正是这道门要防的那件事。
```

M2 复现:新建 `lib/admin/probe-pending-mutation-store.ts` 导出同名内存桩,把 k1 的 import 路径指过去,同样三门全绿。
M4 复现:删掉 k1 的 store import 与调用,改用本地内存桩,并在文件里加
`const _k1Exec = createStableMutationExecutor(newK1CommandKey, "nexion-admin-k1-probe-v1");`(从不调用),三门全绿。

---

## AC2 —— 门不会误红:**FAIL(12 中 3 误红)**

| # | 合法写法 | 结果 |
|---|---|---|
| L1 | import 折行:`}` 与 `from` 之间换行 | 🟢 绿 |
| L2 | 混合 import:`{ type PendingMutationStore, createPendingMutationStore }` | 🟢 绿 |
| L3 | 改本地变量名 `commandAttempt` → `k1CommandLedger`(全量) | 🟢 绿 |
| L4 | 赋值右侧折行 + 插空行 | 🟢 绿 |
| L5 | import 路径改单引号 | 🟢 绿 |
| L6 | import 路径改相对路径 | 🟢 绿 |
| L7 | 调用点显式泛型实参 `createPendingMutationStore<PendingMutationRecord>(` | 🟢 绿 |
| L8 | 同一行先出现 `https://` URL 再出现承重 import | 🟢 绿 |
| **L9** | **executor 调用 prettier 折行 + 尾逗号** | 🔴 **误红(P1)** |
| **L10** | **storageKey 抽成具名常量** | 🔴 **误红(P1)** |
| **L11** | **协议相对 URL `"//cdn.example/x"` 与承重调用同行** | 🔴 **误红(P2)** |
| L12 | import 与调用点之间插块注释文档 | 🟢 绿 |

```
!!  [期望green] L9 executor 调用 prettier 折行 + 尾逗号(合法排版)  => EXIT=1
      - lib/admin/g1-client.ts 调用 createStableMutationExecutor 时没传非空 storageKey → 命令号退回内存态,刷新即失效
!!  [期望green] L10 storageKey 抽成具名常量(合法重构,键仍非空且持久)  => EXIT=1
      - lib/admin/g1-client.ts 调用 createStableMutationExecutor 时没传非空 storageKey → 命令号退回内存态,刷新即失效
!!  [期望green] L11 协议相对 URL(//cdn...)与承重调用同行  => EXIT=1
      - k1-multiaccount.tsx 未调用 createPendingMutationStore / createSlotAttemptStore → 只 import 不用等于没迁
```

- **L9/L10 根因**:`/createStableMutationExecutor\s*\([^,)]+,\s*"[^"]+"\s*\)/` 要求
  「第二个实参是字符串**字面量**且其后直接是 `)`」。尾逗号(`"…",\n)`)与具名常量
  (`, G1_COMMAND_STORAGE_KEY)`)都不满足,而两者都是日常重构。误红信息还会把人引向错误方向
  ——它说「没传非空 storageKey」,实际传了。同一条正则也被
  `tests/pending-mutation-migration-contract.test.mjs` 复用(那里靠它凑 `keys.length >= 25`),
  所以这两种重构会**同时**打红门和测试。
- **L11 根因**:`stripComments` 只护 `://`(`(^|[^:])//`),协议相对 URL 的 `//` 被当行注释,
  整行后半段被吃掉。`strip-comments.mjs` 的文档只提到 `://` 守卫,没提这一面。
  同族风险还有 `s.split("//")` 这类含裸 `//` 的字面量。

---

## AC3 —— 剥注释器不能悄悄失效:**FAIL(7 中 3 静默)**

| # | 改坏方式 | 门的反应 | 判定 |
|---|---|---|---|
| B1 | 整体退化成 no-op | 🔴 判据 0b 两条同时红 | ✅ 大声 |
| B2 | 函数体 `throw` | 🔴 进程栈崩,非零退出 | ✅ 大声 |
| B3 | 过度剥除(返回空串) | 🔴 判据 0b + 大量连带失败 | ✅ 大声 |
| B7 | 退回按行 `split("\n")` 形态(CRLF 上死) | 🔴 判据 0b 命中 | ✅ 大声 |
| **B4** | **块注释正则丢 `g`(只剥第一处)** | 🟢 **PASS** | ❌ **静默(P1)** |
| **B5** | **行注释正则丢 `g`(只剥第一处)** | 🟢 **PASS** | ❌ **静默(P1)** |
| **B6** | **`html` 分支被摘(`void html;`)** | 🟢 **PASS** | ❌ **静默(P2)** |

B4/B5 的第一版测试**结论不成立,已推翻重测**:`g1-client.ts` 全文无块注释、`k1` 的首个行注释
恰在载荷之后,于是「非全局正则」刚好剥掉了载荷本身,门看起来是红的。补一个**位置在前的诱饵注释**
再测,并加对照组证明载荷本身有杀伤力:

```
OK  [期望red] C1 对照:剥除器完好 + 诱饵块注释 + 块注释走私  => EXIT=1
      - lib/admin/g1-client.ts 没有从共享 store(...)import …  / 未调用 create…Store
!!  [期望red] B4++ 块正则丢 g + 诱饵块注释在前 + 块注释走私  => EXIT=0
      pending-idempotency-key sentinel PASS (…)
OK  [期望red] C2 对照:剥除器完好 + 诱饵行注释 + 行注释走私  => EXIT=1
      - k1-multiaccount.tsx 未调用 createPendingMutationStore / createSlotAttemptStore
!!  [期望red] B5++ 行正则丢 g + 诱饵行注释在前 + 行注释走私  => EXIT=0
      pending-idempotency-key sentinel PASS (…)
```

**根因**:判据 0b 的探针里,行注释和块注释**各只有一处**:

```js
const probe = 'const a = 1;\r\n// const smuggled = createSlotAttemptStore({ storageKey: "x" });\r\n'
  + 'const url = "https://nexion.example/pending-mutation-store";\r\n'
  + '/* const blockSmuggled = createPendingMutationStore({ storageKey: "y" }); */\r\n';
```

一处样本区分不了「全局替换」和「只替换第一处」。真实文件里注释成百上千,丢 `g` = 除第一处外
全部注释原样留在 `code` 里 = 全线走私放行,而门照打 PASS —— 这正是判据 0b 声称要钉住的那个失效模式。
最小补法:探针里每种注释各放**两处**,断言第二处也被剥掉。

**B6(P2)**:`html` 分支是 `uni-storage-key-sentinel.mjs` 的 `.vue` 面唯一依赖,把它摘掉后
三道门(idem / uni / h9)全绿——共享 lib 的这一半没有任何自检,而 0b 只在 idem 哨兵里、只测非 html 路径。

---

## AC4 —— 不波及其它门:**PASS**

```
=== uni-storage-key-sentinel ===
✓ uni-storage-key-sentinel: 27 处脚本引用全部匹配 App 现役键（59 个）
EXIT=0
=== h9-public-stats-parity ===
✓ H9 对外公布数据 — 前端/后台字段 8 键双向相等 · … · param-grid 基础规则覆盖 4 个消费域
EXIT=0
=== node --test tests/pending-mutation-migration-contract.test.mjs ===
ℹ tests 9  ℹ pass 9  ℹ fail 0     EXIT=0
=== node --test tests/pending-mutation-store-contract.test.mjs ===
ℹ tests 7  ℹ pass 7  ℹ fail 0     EXIT=0   （并发改动后复跑为 10/10,仍 0 失败）
```

**MIGRATED 反解析**(`/^\s{2}"([^"]+\.tsx?)",$/gm` 打在哨兵源码上)——非空,解析出 **30 条**,
与哨兵自报的「已迁 30 个文件」一致,测试里的 `>= 28` 断言有余量:

```
CRLF? true
解析条数 = 30
lib/admin/d-client.ts … app/_console/users/search/[id]/page.tsx
```

> 顺带记一笔隐含依赖(**不算缺陷,算脆性**):该正则要求条目行「恰好 2 个前导空格 + 以 `",` 结尾且行尾无尾随内容」。
> 之所以在 CRLF 下仍成立,是因为 JS 多行模式的 `$` 匹配任意行终止符(含 `\r`),不是因为排版对 CRLF 无所谓。
> 给某条目加行尾注释、改缩进、或把数组换成 `Set`,清单会**静默缩短**而不是报错——测试只有 `>= 28` 的下限兜底。

**`npm run verify`**:`.verify-exit.code = 0`,日志内无 `✗ / FAIL / ERROR`,
`pending-idempotency-key sentinel PASS` 在齿轮表内正常执行。

```
⚠️  verify 完成,但 5/41 个齿轮**未运行**(环境缺件,非缺陷):
     ⏭  real recharge-channel parity / FE-BE mapping / J1 / J2 / K2  ← 缺 nexion-backend
verify DEGRADED (36/41 gears ran, 5 skipped)
```

已知环境限制(memory: `nexion-backend-not-in-workspace`),不计入缺陷。

---

## AC5 —— 红测自身可信:**PASS(带保留)**

```
✓ [期望红] T5① … ✓ [期望红] T5⑨   ✓ [期望绿] T5⑩ … ✓ [期望绿] T5⑬
红测全部按预期(13 项)
REDTEST_EXIT=0
```

### 逐条审「有没有假红测」

复刻每一条打红注入并**打印真实失败信息**(红测自己只看退出码,看不出「红对了理由没有」):

| 用例 | 实测触发的判据 | 与标题是否一致 |
|---|---|---|
| T5① | `没有从共享 store … import create{…}Store` | ✅ |
| T5② | `未调用 createPendingMutationStore / createSlotAttemptStore` | ✅ |
| T5③ | g1 落到直接路径两条(= viaExecutor 已失效) | ✅ 机制对,措辞见下 |
| T5④ | 同上 | ✅ 机制对,措辞见下 |
| T5⑤ | `createSlotAttemptStore 换指纹时没丢弃旧命令号` | ✅ |
| T5⑥ | `没有写 sessionStorage:持久化是空壳` | ✅ |
| T5⑧ | `剥注释器误伤 :// 协议串…` (判据 0b) | ✅ |
| T5⑨ | `剥注释器没剥块注释…` (判据 0b) | ✅ |

**当前 8 条打红用例全部红在正确的判据上,没有假红测。** 但有 4 处结构性保留:

1. **P2 — ⑫⑬ 是空注入,零判别力。** 程序化确认 `from === to`:

   ```
   T5⑫  from = "const commandAttempt = createPendingMutationStore("
         to   = "const commandAttempt = createPendingMutationStore("   => from === to,空注入
   T5⑬  同上
   ```

   `inject()` 只在**锚点缺失**时 throw,`from === to` 不报错。于是这两条实际只是
   「在原样的树上跑一遍 `node --test`」。⑫ 的标题声称验「台账反解析不被破坏」,
   但它**没有触碰哨兵的排版**——真要验,该注入的是「给 MIGRATED 条目改缩进 / 加行尾注释」,
   然后断言迁移测试红。目前这个隐含依赖(见 AC4)完全没有红测覆盖。

2. **P2 — harness 只断言退出码,不断言哪条判据红了。** `gateRed()` 里 `catch { return true; }`
   吞掉一切非零退出。⑦⑧⑨ 的标题写「判据 0b 必红」,但注入若因别的原因红(甚至因语法错误让
   哨兵自己崩),用例照样显示 ✓。今天没踩到,但这条防线是空的。修法:让 `gateRed` 返回 stderr,
   用例带一个必须命中的关键词。

3. **P2 — 「还原完整性」检查弱于它的注释。** 注释写「跑完源文件必须逐字节回到原样」,
   实现只 `git status --porcelain` 后 `filter(line => line.includes(".redtest-bak"))`
   ——只抓残留备份文件,**抓不到内容没还原**。被查文件本来就处在 ` M` 状态,内容被改坏看不出差别。

4. **P2 — T5③/④ 的失败信息不提 executor。** 两条都为了验 executor 侧判据,但门吐的是
   「没有从共享 store import / 未调用 create…Store」。机制正确(executor 判据失效 → 落到直接路径),
   但维护者只看信息会往错误方向排查。

### 前提复核:「硬化前实测绿」属实

把 `HEAD` 版哨兵取出到临时文件,施加 T5① 同款注入:

```
OK  [期望green] 旧哨兵 + T5① 走私(前提:应为绿)  => EXIT=0
      pending-idempotency-key sentinel PASS (…)
OK  [期望green] 旧哨兵 + 无注入(基线:应为绿)  => EXIT=0
```

漏洞真实存在,且新哨兵对**这一形态**确实红了(T5① 复刻 EXIT=1)。硬化不是空转;问题是覆盖面。

---

## 问题清单(按严重度,全部上报)

### P0

1. **别名 import 绕过「真绑定」判据**(AC1/M1、M1')。`{ X as _unused }` 命中 import 判据,
   调用点用同文件的同名本地桩。哨兵 + tsc + 迁移契约测试**三门全绿**,持久化实际已没了。
   影响面:全部 30 个 MIGRATED 文件,命令号式与槽位式都实测通过。
2. **import 路径是子串判据**(AC1/M2、M5)。`[^"']*pending-mutation-store` /
   `[^"']*stable-mutation` 只要求路径**含**该串,自造同名本地文件即可全绿(tsc 也绿)。
3. **viaExecutor 分支 `continue` 免检**(AC1/M4)。一个从不被调用的 executor 常量就能让整个文件
   跳过后续所有判据(含判据 3b 的悬空 const 核对)。与判据 3b 自己的立意直接矛盾:
   3b 防的正是「悬空 const 没人删」,而 executor 分支恰恰不查悬空。

> 三条同一个病灶:判据认的是**名字出现过**,不是**调用点用的就是那个绑定**。
> 正则层面能补的是「导入名不得被 `as` 改写 + 路径必须精确匹配(锚 `["']` 前缀)+ executor 分支也要核调用点」;
> 想根治得上 AST(仓内已有 `ast-grep`)。

### P1

4. **判据 0b 自检有盲区**(AC3/B4++、B5++)。探针每种注释各只有一处,
   两条正则各自丢 `g` 标志 → 自检看不见 → 真走私全线放行,门恒绿。
   最小补法:探针里每种注释各放两处,断言第二处也被剥掉。
5. **误红:executor 调用折行带尾逗号 / storageKey 抽成具名常量**(AC2/L9、L10)。
   两种都是日常重构,门直接红,且误红信息把人引向「你没传 storageKey」这个错误结论。
   同一条正则被迁移契约测试复用,会同时打红两处。

### P2

6. **`import type` 走私**(AC1/M3)。哨兵放行,靠 tsc 的 TS1361 兜底。判据里的 `(?:type\s*)?`
   是主动放行——若本意是支持 `{ type Foo, createX }` 这种**花括号内**的混合写法,
   那不需要 `import type` 前缀这条分支(L2 已证明混合写法本来就过)。
7. **协议相对 URL 与承重代码同行 → 误红**(AC2/L11)。剥注释器只护 `://`。
   同族还有 `split("//")` 一类含裸 `//` 的字面量。
8. **剥注释器 `html` 分支零自检**(AC3/B6)。摘掉后三门全绿;唯一消费者
   `uni-storage-key-sentinel.mjs` 没有 0b 式自检。
9. **红测 ⑫⑬ 空注入,零判别力**;⑫ 声称验的「台账反解析不被破坏」实际没被验(AC5-1)。
10. **红测 harness 只断言退出码,不断言哪条判据红**(AC5-2)。
11. **红测「还原完整性」检查只抓残留备份文件,抓不到内容没还原**(AC5-3),与其注释不符。
12. **MIGRATED 反解析对哨兵排版有隐含依赖**(AC4)。改缩进 / 加行尾注释会让清单**静默缩短**,
    只有 `>= 28` 的下限兜底,且这个下限离实际值 30 只差 2。

---

## 环境事实(非本包缺陷,但影响读数)

- **验收期间该 worktree 被另一路并发写入并 commit。** 会话开始时 `HEAD = 6e26993`,
  工作树 3 个 ` M` + 3 个 `??`;验收过程中先出现了 `lib/admin/pending-mutation-store.ts` 的重构
  (内存镜像从「读缓存」改成「降级兜底」,14:32 落盘)、`tests/pending-mutation-store-contract.test.mjs`
  (测试 7 → 10)、新增 `lib/admin/outcome-classification.ts` 与
  `docs/changes/2026-08-06-f-version-cas-spec.md`,随后被提交成两个 commit:

  ```
  461903b fix(admin): 命令号 store 内存兜底 + TTL 硬上限(存储被禁时防重复整体失效)
  ef202b0 fix(sentinel): 幂等哨兵结构判定改跑剥注释正文 + import 绑定收紧(29 迁移面共有走私路径)
  ```

  即**被验对象在验收进行中被 commit 了**。这些改动**不是我的探针残留**
  (已 `find` + `grep` 双向确认无 `t5probe` / `probe-*` / `_probe-old-sentinel` / 注入串残留)。
- **全部结论已在 `HEAD = 461903b`(含并发改动)上完整复跑,与并发改动前逐条一致**:
  AC1 仍是 M1/M2/M3/M4/M5 绿、M6/M7/M8 红;AC2 仍是 L9/L10/L11 误红、其余 9 条绿;
  AC3 补测仍是 B4++/B5++ 静默绿、C1/C2/B7 红;AC4 四项仍全绿。
  仓内红测在并发改动后扩到 **21 项**(新增 T3①–⑤ / T4①–③ 的 store 降级与 TTL 用例),
  仍 `红测全部按预期(21 项)`、退出码 0;本报告 AC5 的审计针对其中 T5① – T5⑬ 十三项,
  新增的 T3/T4 八项不在本次委派范围内,未审。
- 本机无兄弟仓 `nexion-backend`,`npm run verify` 如实跳过 5 个齿轮(已知限制)。
- `npm run verify` 的管道退出码不可信,判定取 `.verify-exit.code`(= 0)。

## 还原确认

所有变异均已还原;仓内无 `.t5probe-bak*` / `probe-*.ts` / `_probe-old-sentinel.mjs` 残留
(`find` 与 `grep` 双向确认)。探针脚本全部落在会话 scratchpad,未入仓。

验收结束时 `git status --porcelain`(此时并发会话已把被验改动 commit,故工作树只剩三条未跟踪;
其中 `docs/changes/2026-08-06-idem-hardening-t5-test.md` 是本报告,另两条来自并发会话,与本次验收无关):

```
?? docs/changes/2026-08-06-f-version-cas-spec.md
?? docs/changes/2026-08-06-idem-hardening-t5-test.md
?? lib/admin/outcome-classification.ts
```

收尾复跑(`HEAD = 461903b`):`node scripts/pending-idempotency-key-sentinel.mjs` → `PASS`,退出码 0。
我本次验收**未 commit、未 push、未改动 docs/ 下任何既有文件**,只新建了本报告一个文件。
