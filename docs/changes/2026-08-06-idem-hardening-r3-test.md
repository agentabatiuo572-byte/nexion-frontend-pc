# 独立验收 R3 · 幂等基建硬化包(pkg/idem-hardening)

审计人:独立 tester(第三轮),不参与实现。方法:回源 Read + 自造变异证伪 + **运行时探针驱动真实模块**,不采信任何叙述。

## 0. 审计基线与一处流程事故(先说,因为它影响所有结论的解读)

派单说「相关改动 = 最近 5 个 commit(ef202b0…f72791d)」。**审计过程中工作树被并发修改了两次**:

| 时刻 | 状态 |
|---|---|
| 我开审时 | `git status` 干净,HEAD = `f72791d` |
| 跑到第 2 步(redtest)时 | 工作树变脏:`lib/admin/login-completion.ts` / `scripts/_redtest-idem-hardening.mjs` / `tests/pending-mutation-migration-contract.test.mjs` 被改,新增 `docs/changes/2026-08-06-idem-hardening-reflection.md` |
| 那一刻的红测脚本 | **语法错误跑不起来**(`SyntaxError: Invalid or unexpected token`,line 290:R3①/R3② 两条新用例用了带真实换行的多行字符串锚,违反脚本自己开头写的「锚必须单行」) |
| 我收尾时 | 已提交为 `7cd74e1`,工作树重新干净,红测语法已修复 |

处置:为了给「5 个 commit」一个稳定结论,我在 scratchpad 建了一个 **detached worktree(HEAD=f72791d)** 跑第一轮取证;新提交落地后,**全部关键结论在真仓 `7cd74e1` 上重跑复核过**。下文所有证据都标注了跑在哪个 tip 上;未标注的默认是 `7cd74e1`。detached worktree 与临时 `node_modules` junction 收尾时已删除(`git worktree list` 已确认)。

> ⚠️ 这条本身是发现之一(见 P0-3):红测脚本**不在 verify 齿轮表里,自己也没有语法自检**,它坏掉时没有任何门会响。

---

## AC1 · 前两轮 P0/P1 的回归 + 每条一个新变体

### 原始手法回归:全绿

`node scripts/_redtest-idem-hardening.mjs`

- f72791d(detached worktree):`红测全部按预期(54 项)` exit 0
- 7cd74e1(真仓):`红测全部按预期(56 项)` exit 0

两轮 P0/P1 的原始攻击手法(T5-R1…R10 / R2-P0-1…P2-3)**逐条复现且逐条被挡**,含 `expectText` 的 29 条都红在正确判据上。**AC1 原始手法部分 PASS。**

### 我自造的变体:11 条里 8 条绕过

跑器:scratchpad `r3-mutate.mjs`(与红测同纪律:单行锚 / 空注入即抛 / finally 逐字节还原 + sha1 校验;每条跑完 `git status --porcelain` 为空)。

| # | 变体(与哪条旧 P 同族) | 期望 | 实得 | 判定 |
|---|---|---|---|---|
| V1 | R1-P1「合法重构误红」变体:`import * as X` + `X.createPendingMutationStore(...)` | 绿 | **红** | 误红 → P2-2 |
| V2 | R1-P0-1 同族:import 与 create 全留,**删光 `.get(`**,每次提交现铸新号 | 红 | **绿** | 绕过 → P1-1 |
| V3 | 合法重构:显式 `.ts` 后缀 import | 绿 | 绿 | 挡对了 |
| V3b | 合法重构:相对路径 import | 绿 | 绿 | 挡对了 |
| V4 | R1-P0-3 变体:内联 `import { type X }` | 红 | 红 | 挡住了 |
| V5 | R1-P0-4 变体:executor 常量留着**装饰性调用一次**,真实写路径改内联铸号 | 红 | **绿** | 绕过 → P1-2 |
| V6 | R1-P1「自检探针盲区」变体:剥除器对 >2000 字符输入直接返回原文 | 红 | **绿** | 绕过 → P1-3 |
| V6b | 同 V6 → `uni-storage-key-sentinel`(真仓,兄弟仓在位) | 红 | **绿** | 同上 |
| V6c | 同 V6 → `h9-public-stats-parity`(真仓) | 红 | **绿** | 同上 |
| V7 | R2-P0-1 变体:`signIn` 换人分支前插恒真早退(清扫那行文本原样留着) | 红 | **绿** | 绕过 → P1-4 |
| V7c | 同上打在新增的登录侧兜底闸 `login-completion.ts` | 红 | 红 | 挡住了(它比了 `indexOf` 顺序) |
| V8 | R2-P0-2 变体:`clearGeneration += 1` → `= 1`(第二次登出不再作废内存) | 红 | 红 | 挡住了 |
| V9 | R2-P1-1 变体:`Math.max(createdAt+ttl, now+60s)` 兜底延寿 | 红 | 红 | 挡住了 |
| V10 | R2-P1-2 变体:5xx 阈值提成具名常量 `const HARD_FAIL_FLOOR = 500` | 红 | **绿** | 绕过 → P1-5 |
| V10b | 同上改算术 `Math.trunc(status/100) < 5` | 红 | **绿** | 同上 |

**AC1 变体部分 FAIL**:8 条绕过 / 1 条误红。

---

## AC2 · 清扫链完整性(运行时走链,不是读源码)

上一轮的门全是**源码正则断言**(V7 证明它匹得到死代码),所以我写了运行时探针 `r3-authchain-probe.mjs`:用 `module.registerHooks` 解 `@/` 别名,直接 import 真实的 `lib/store/admin-auth.ts` + `lib/admin/pending-mutation-store.ts`,喂逐 tab 的 sessionStorage 替身,按真实调用序列驱动。

命令(7cd74e1 真仓):
```
node --experimental-strip-types --import <scratchpad>/r3-alias-hook.mjs <scratchpad>/r3-authchain-probe.mjs
```

### 全部登出/换人路径枚举与实测

| 分支 | 代码路径 | 命令号会不会残留 | 实测 |
|---|---|---|---|
| 退出按钮 | `topbar.tsx handleSignOut → signOut()` | 不残留 | **S1 PASS** |
| 会话恢复失败 | `console-shell` mount `.catch(() => signOut())` | 不残留(**但见 P0-2:同一人也被清**) | S6 |
| 定时/focus 续期失活 | `console-shell refreshSession → signOut()` | 不残留 | S1 同路 |
| 撞 401 自动重置 | 各 client → `resetAdminSession()` | 不残留 | 红测 T2①②③ |
| j 域 401 | `j-client → useAdminAuth.getState().signOut()` | 不残留 | S1 同路 |
| 同 tab 续期发现换人 | `signIn` 换人分支 | 不残留 | **S3 PASS** |
| 交互式登录(第 6 个 commit 新补) | `completeInteractiveLogin → clearPendingCommandRecords()` | 不残留 | V7c |
| 同一人刷新 | `signIn` 同名不清 | **应当残留**(跨刷新存活) | **S2 PASS** |
| 关标签页 / 关浏览器 | sessionStorage 随 tab 销毁 | 不残留 | 平台保证 |
| **刷新后恢复到另一个人的会话** | `console-shell` mount → `signIn(B)`,而刷新后 `state.operator === ""` | **残留 → 泄漏给 B** | **S4 FAIL** |
| **显示名重名的两个账号** | `signIn` 用 `operator` 比 | **残留 → 泄漏** | **S5 FAIL** |
| 浏览器「恢复上次会话」(sessionStorage 被恢复) | 走登录表单 → 第 6 个 commit 的兜底闸 | 不残留 | V7c 覆盖 |
| 隐私模式(纯内存兜底)下换人 | 代次作废内存镜像 | 不残留 | **S7 PASS** |

**第三/第四条路径**:第 6 个 commit 自己找到了「交互式登录」这条(登录表单),补上了。**但 S4 那条它盖不住** —— 那条根本不经过登录表单,走的是 `console-shell` 的会话恢复。这是我找到的、目前**仍然开着**的换人路径。

**AC2 FAIL**(S4 / S5 两条泄漏路径)。

---

## AC3 · 新机制的副作用

### ① 清扫代次会不会误伤正常使用 —— 会,而且伤在最要命的地方

**S6 实测 FAIL**:同一个操作员,会话失效(cookie 过期 / 会话端点 5xx / 断网)→ `console-shell` mount 的 `.catch(() => signOut())` → 清光自己的在途命令号 → 重新登录后重试 → **必然铸新号** → 后端当第二条命令。

回源确认这条 catch 真的会被普通抖动触发:`lib/admin/auth-client.ts:87` 的 `currentAdminSession()` 是**裸 fetch 无 try**,并且 `!response.ok` 直接 `throw`。所以断网或会话端点一次 502 就走这条。对照 `console-shell:86` 的定时续期分支写着「Keep the current session on transient network errors」并**刻意不 signOut** —— 两条路对同一种抖动的处置是相反的。

连带后果:`d-client` 的 `listD1PendingTopupCommands()` 读的就是这张表,清空后运营连「在途命令重试清单」这个正确重试入口都没了。

反方观点(我先抛):可以主张「会话结束就该放弃在途命令」。**这不成立** —— 后端幂等窗是 24h 且与登录会话无关,而整套设计的价值就是「结果未知时用同一个号重试」;同一个人会话过期后重新登录,恰恰是最典型的重试场景。

### ② 「换人才清」的判断依据可靠吗 —— 不可靠

- **重名**:`operator = session.operator || session.username`(`auth-client.ts:124`)。`operator` 是显示名,运营岗位名极易撞(「运营专员」)。S5 实测:两个不同 `adminId` 只要显示名相同,判据 `state.operator !== session.operator` 为 false → 不清 → 串号。
- **为空**:`state.operator &&` 这个短路守卫是 S4 的直接成因 —— 刷新后内存态必为空,于是「换人」永远判不出来。
- **异步竞态**:`signIn` 在 zustand `set` 的同步 updater 里调清扫,同步序列,无竞态。这一点没问题。
- 现成的唯一位:`session.adminId` 与 `session.username` 都在 store 里躺着,没被用。

### ③ 内存兜底会不会泄漏到不该用的地方 —— 未发现新泄漏路径

- 内存镜像逐 `storageKey` 逐实例,`readAll` 对内存记录同样跑 `usable()`(TTL + `isValidRecord`),不存在跨域串号。
- 降级态下换人清扫也作废内存(**S7 PASS**)。
- 唯一残留:`clearPendingCommandRecords` 在降级态返回 0,调用方不看返回值也不告警 —— 属信息缺失,不是泄漏。

**AC3 FAIL**(①②)。

---

## AC4 · 归类统一后的用户可见行为(挑 3 个域推演两种世界)

先做了全量普查:12 个接了共享谓词的 client 分成两种形态。

| 形态 | 5xx 时做什么 | client |
|---|---|---|
| **抛未知型** | 保号 + 抛 `*Outcome{Unknown,Uncertain}*Error` → 运营看到「结果未知/未确认 + 请求号 + 先核对再用同号重试」 | b2 / b3 / b5 / j / k / k6 / a1 / a2 / a3 |
| **只保号型** | 保号,但抛的是普通失败 `Error` → 运营看到「××失败」 | **d-client** / user360-client / i-client |

### 域一:B2 预测配置(抛未知型)✓

- 后端 5xx 已落库:`b2-client.ts:391` → `B2OutcomeUnknownError`,文案「本次配置保存结果未知,可能已经生效。请先刷新核对;如需按原输入重试,将继续使用同一请求号:xxx」;`liquidity/page.tsx:167-169` 保号 + 把弹窗退回 `confirm` 步(原输入还在)。运营按提示核对 → 发现已生效 → 不重复提交。**正确。**
- 后端 5xx 已回滚:同样文案,运营重试 → 同号 → 后端无记录 → 执行成功。**正确。**

### 域二:K5 KYC 裁决(抛未知型)✓

- 已落库:`k-client.ts:118` → `K1OutcomeUncertainError`;`k5-kyc.tsx:355` toast「K5 结果未知 · 请保留确认框并使用同一请求重试或先核对 · 请求号 xxx」,且 `commandAttempts.forget` 只在 else 分支。运营重试 → 同号 → 幂等回放。**正确。**
- 已回滚:同上,重试真正执行。**正确。**

### 域三:D2 提现复核 / 批量放行(只保号型)✗ —— 资金域恰好是掉队的那个

`d-client.ts:594-598`:

```ts
if (mutationFingerprint && !pendingKeyBeforeRequest
  && !outcomeStaysUnknown(response.status, result?.code)) {
  pendingMutations.forget(mutationFingerprint);
}
throw new Error(formatAdminApiError(result?.message, `D_REQUEST_FAILED_${response.status}`));
```

命令号保住了(`outcomeStaysUnknown(500)` 为真 → 不 forget)✓,但抛出去的是**普通失败**。那句「操作结果未知,可能已经生效。请先刷新核对,并使用同一请求号重试:xxx」(`:574` / `:585`)只在 `X-Nexion-Upstream-Outcome: unknown` 头出现或传输层抛错时才走到 —— **而本轮的立意正是「unknown 头只是增强信号,不再是唯一保险丝」**。`d2-withdrawals.tsx:287` 原样 toast 这条消息。

两种世界推演:

- **已落库**:运营看到「D2 审核失败」。若沿原路重开弹窗再点确认,`reviewScope(单号, 动作)` 指纹不变 → 同号重放 → 机制上安全。但文案把人往「这笔没生效」引:更可能改走别的路补救(改判、D3 手工注资、重新勾一批批量放行)。**批量那条最危险** —— `batchScope(action, ids)` 把 ids 编进指纹,重试时勾选集合只要变一行就是新指纹新命令号 → **已放行的那部分重复放行**。
- **已回滚**:运营看到「失败」→ 重试 → 同号 → 后端无记录 → 正常执行。**正确。**

结论:**机制安全,文案有害,且有害的是三个域里唯一涉资金的那个。** user360(用户处置)与 i(内容)同型。

**AC4 FAIL**(P1-6)。

---

## AC5 · 全量门

| 门 | 命令 | 结果 |
|---|---|---|
| tsc | `npx tsc --noEmit` | **0 错**(f72791d 与 7cd74e1 各跑一次) |
| verify | `npm run verify` → `cat .verify-exit.code` | **0**;`verify DEGRADED (40/45 gears ran, 5 skipped)`,跳过的 5 齿全部 `← 缺 nexion-backend`(既有环境限制) |
| 本包新增齿轮 | verify 日志 `[37]`–`[43]` | 全绿:`in-memory idempotency-key sentinel`(扫 354 文件 / 命中 5 / 台账 5 / 欠账 0 / 已迁 30 面 30 个标识符逐个核过)、`pending mutation store contract`、`outcome classification contract`、`a2 outcome-uncertain`、`b2/b3 outcome-unknown`、`i4 A2 pending visibility`、`pending mutation migration contract` |
| 红测 | `node scripts/_redtest-idem-hardening.mjs` | **56/56 按预期** exit 0 |
| tests/ 全量 | `node --experimental-strip-types --test tests/*.test.mjs` | `tests 738 / pass 646 / fail 92`,exit 1 |

### tests/ 全量失败的归因(逐条查过)

92 条失败集中在 16 个文件,**全部可归因于缺兄弟仓**:`nexion-backend` 146 处引用、`NX1.0` 33 处。唯一一条非 ENOENT 的断言失败(`b2-liquidity-acceptance-contract.test.mjs: missing overview_b2_read`)也是同一个原因 —— 该文件用 `existsSync ? readFileSync : ""` 把缺仓降级成空串,断言才变成这句。**没有一条失败由本包造成。**

### 顺带查到的两件事(不是本包引入,但影响本包的回归保护)

1. **`npm run verify` 只跑 tests/ 下 127 个文件中的 23 个。** 其余 104 个不在任何齿轮上。
2. 上面那 16 个环境阻塞的文件在本机**永远给不出信号** —— 其中就包括 `k1-multiaccount-contract.test.mjs`(下面 P1-1 会用到)。

### 审红测脚本本身有没有新的假红测

- **有过一条真的**:审计开始时红测脚本处于语法错误状态跑不起来(见 §0),已随 `7cd74e1` 修复。
- **结构性弱点**:46 条 `red` 用例里 **17 条没有 `expectText`**(T5①②③④⑤⑥⑦⑧⑨、T3①②③④⑤、T4①②、T1④)。没有 expectText 时,「门自己崩了」也会被记成 ✓。
- **抽验了其中 8 条**(T1④ / T3①②③ / T4① / T5①⑤⑥),重跑并打印输出尾部:全部红在正确判据上(sentinel 打的是精确条目,node:test 打的是 `AssertionError` 而非 `SyntaxError`)。**当前没有实际生效的假红测**,但这 17 条属于纸糊的防线。
- 另:红测本身不在 verify 齿轮里,坏了没人知道(P0-3)。

**AC5 PASS(机器门口径)**,附上述三条结构性欠账。

---

## 问题清单(按 P 分级,全部上报)

### P0

**P0-1 · 换人链还有一条开着:刷新后恢复到另一个人的会话,命令号原样留给 B**
证据:运行时探针 S4(7cd74e1 与 f72791d 均复现)。
机制:`lib/store/admin-auth.ts:50` 的 `if (state.operator && state.operator !== session.operator)`。整页刷新后 zustand 回初始态 `operator: ""`,短路守卫直接为 false。链路:A 在 tab1 留下命令号 → A 未点退出 → A 在别处退出/B 登录(cookie 变 B)→ tab1 按 F5 → `console-shell` mount 恢复会话拿到 B → `signIn(B)` 不清 → B 复用 A 的号 → 后端幂等回放 A 的提案:B 的操作被静默吞掉、审计记在 A 头上。
`7cd74e1` 新补的登录侧兜底闸盖不住这条(不经过登录表单)。
建议修法:把清扫判据从「内存态 operator」换成**与命令号同寿命的持久化会话身份**——登录/恢复会话时把 `adminId`(或 `username`)写进 sessionStorage,`signIn` 拿存的身份与新会话比,不一致就清;刷新后这个身份还在,判据才成立。

**P0-2 · 同一个人的会话失效会销毁自己的在途命令号 → 重试必然铸新号 → 重复入账/重复打款**
证据:运行时探针 S6;回源 `console-shell.tsx:61-63` + `auth-client.ts:87-96`(裸 fetch、`!response.ok` 直接 throw)。
连带:`listD1PendingTopupCommands()` 读同一张表,清空后运营连正确重试的入口都没了。
注意这是**本包引入的新路径** —— 修 P0(清扫接到 signOut)时把「会话结束」当成了「换人」。
建议修法:清扫条件收紧成「操作员身份确实变了」;身份未变或身份未知(网络失败时根本不知道对面是谁)时**保留**。与 P0-1 是同一处改动。

**P0-3 · 红测脚本没有任何门守着,坏掉时无人发现**
证据:§0 —— 审计中途它处于 `SyntaxError` 状态,`npm run verify` 照样全绿。
它是本包唯一验证「门本身有判别力」的东西,却既不在 verify 齿轮表里,也没有自检。
建议修法:最省事的一步是在 verify 里加一齿 `node --check scripts/_redtest-idem-hardening.mjs`(纯语法检查,不跑注入,不会与并行齿轮踩)。

### P1

**P1-1 · 删光 `.get(` = 每次提交现铸新号,全门放行**
证据:V2 / V2-mig(哨兵绿 + 迁移契约绿 + 不在任何 verify 齿轮)。
机制:判据 3b 对 `createSlotAttemptStore` 要求 `resolve` + `forget` **成对**,对 `createPendingMutationStore` 只要求「任意一次方法调用」—— 而 30 个迁移面绝大多数是后者。删掉取号点,`remember`/`forget` 还在,持久化彻底失效而门全绿。
补充:`tests/k1-multiaccount-contract.test.mjs:113` 对这一面的断言只有 `assert.match(component, /commandAttempt/)`(一个名字出现过),而且该文件不是 verify 齿轮、本机还因缺兄弟仓红着 —— 也就是说**这条退化在本机与 CI 都不会被任何门抓到**。
建议修法:判据 3b 对 command 形态也要求成对 —— `.get(` 与 `.forget(` 都必须存在。

**P1-2 · executor 装饰性调用即可换免检**
证据:V5(哨兵绿 + 迁移契约绿)。
机制:R1-P0-4 修成「executor 常量必须被调用过」,但没要求「被调用的是真实写路径」。留一个 `void executorForTheGate(...)` 预热调用,真实写路径改内联铸号即可。这是 R1-P0-4 的同族新外衣。
建议修法:禁止同文件里再出现自造执行器形态(`async (…) => ok(await cmd(`),或要求 executor 调用点数 ≥ 该文件的写请求数。

**P1-3 · 剥注释器可以在判据 0b 自检眼皮底下失效,三道门同时瞎掉**
证据:V6 / V6b / V6c —— 让 `stripComments` 对 >2000 字符输入直接返回原文,`pending-idempotency-key-sentinel` / `uni-storage-key-sentinel` / `h9-public-stats-parity` **三道门全绿**。
机制:0b 探针只有 ~400 字符,照常被剥;仓内每个真实文件都远超 2000 字符 → 注释走私全线放行。
哨兵头部写着「剥除器自身由判据 0b 自检钉住:它一死,整张门就是摆设」—— **这句承诺当前不成立**。
建议修法:0b 探针的走私锚放在一段 ≥ 典型文件长度的填充文本**尾部**;或直接抽一个真实仓内文件断言 `stripComments(src).length < src.length`。

**P1-4 · `signIn` 的换人门只是正则匹文本,匹得到死代码**
证据:V7(在 `set((state) => {` 后插一条恒真早退,清扫那行原样留着,迁移契约门全绿)。
对照:`signOut` 那条因为正则要求清扫紧跟 `{` 而挡住了(V7b 红);新增的登录侧兜底闸因为比了 `indexOf` 顺序也挡住了(V7c 红)。三条路径里 `signIn` 这条是**唯一没有行为覆盖**的,而它恰好是 P0-1 的出事点。
建议修法:迁移契约里补一段**运行时**用例(我的 S3 探针是现成的):import `useAdminAuth` → `signIn(A)` → remember → `signIn(B)` → 断言清空。三条路径都换成行为断言。

**P1-5 · 归类门的「裸三位字面量」判据可绕**
证据:V10(具名常量 `const HARD_FAIL_FLOOR = 500`)与 V10b(算术 `Math.trunc(status/100) < 5`),两种写法均全绿。
语义后果:等于把 5xx 重新判成确定失败 → 弃号 → 资金动作双发,正是 R2-P1-2 想根治的。
坦白说这条在文本层抓不干净(判据在文本、退化在语义)。建议换个方向:把各 client 的 `apiRequest` 做成可注入 fetch 的形状,喂 `(500, 无 code)` 断言抛的是 Outcome-unknown 家族错误;文本判据降为辅助。

**P1-6 · 归类统一了「命令号去留」,没统一「运营看到什么」,掉队的是资金域**
证据:AC4 全量普查 + `d-client.ts:594-598`。`d-client` / `user360-client` / `i-client` 三个只保号不改文案;其余九个都抛专用未知错误。
最危险的具体面:D2 批量放行 —— 文案说「失败」,运营重勾一批重试,`batchScope(action, ids)` 指纹变了 → 新命令号 → 已放行的那部分重复放行。
建议修法:d-client 现成就有那句正确文案(`:574`/`:585`),把触发条件从「只认 `X-Nexion-Upstream-Outcome: unknown` 头」放宽到「`outcomeStaysUnknown(status, code)` 为真」即可,基本是一行;user360 / i 同理。

**P1-7 · 换人判据用显示名而非唯一身份**
证据:运行时探针 S5;`auth-client.ts:124` `operator: payload.session.operator || payload.session.username`。
两个不同 `adminId` 的账号只要显示名相同(运营岗位名极易撞)就判不出换人。`session.adminId` / `session.username` 都是现成的唯一位。与 P0-1 是同一处改动。

**P1-8 · j1 / j2 / j4 仍未接共享 store,且没有任何门提醒**
证据:`j1-killswitch.tsx:94/120/142/175/188/200`、`j2-geoblock.tsx:121/171/226/241`、`j4-sop.tsx:85/185/222/235/312/325` 全部在按钮 handler 里 `createJEmergencyCommandKey()` 现铸并闭包捕获 —— 同一个弹窗里反复点确认能复用,**刷新即丢**。j3 已迁。
哨兵 `MIGRATED` 不含这三个面,`KNOWN` 台账也没有它们(形态是函数局部 const,扫描面扫不到),所以**没有任何门会提醒它们还没迁**。
`j-client.ts:70-74` 的注释自述了这件事,属于已知;但「已知」和「有门守着」是两回事。应急止血(kill-switch / 地域封锁 / SOP 执行)重复执行代价极高。

### P2

**P2-1 · 一条脏行否决整表清扫**
证据:运行时探针 S8。`isPendingCommandTable` 用 `every`:表里混进一条 `commandKey ≠ 行键` 的残留(旧版本写的、或手工污染),整张表被判「不是我们的表」→ 逃过换人清扫。
`every` 是 R2-P2-3 为了不误删别人的表选的,方向对,但粒度应该是**逐行删**,不是整表要么删要么不删。当前 store 自己写不出这种行,所以只有历史残留才触发。

**P2-2 · 命名空间 import 被误红**
证据:V1。`runtimeBindings` 只解析 `import { } from`,`import * as X` + `X.create...()` 这种合法重构被判「没 import 共享 store」。同族还有 barrel re-export 与动态 import。不是安全洞,是把合法写法挡死(R1-P1 的新变体)。

**P2-3 · 红测 46 条 red 用例里 17 条没有 `expectText`**
抽验 8 条全部红在正确判据上,当前无实际假红测;但结构上容许「门自己崩了也算红」。建议补齐。

**P2-4 · `ttlMs` 无上限校验**
`createPendingMutationStore({ ttlMs })` 允许调用方传任意值。本轮把 TTL 焊成「首次起算硬上限」的立意是「客户端记录不许活过后端固定 24h 窗」,一个域传 7 天就整个绕过。全仓当前无人传 `ttlMs`(测试除外),属潜在欠账。建议在 store 里 clamp 到 `PENDING_MUTATION_TTL_MS`。

**P2-5 · `npm run verify` 只覆盖 tests/ 下 23/127 个文件**
不是本包引入,但直接决定本包的回归保护强度(P1-1 就栽在这上面)。

---

## AC6 · 剩余风险:已知接受 vs 真欠账

**已知接受(有据、可解释)**
- 5 个跨仓齿轮跳过(缺 `nexion-backend`),`verify` 自己会打印 `🔴 在这台机器上「verify 通过」只覆盖 40 个齿`。
- 「`resolve` 出来的键有没有真塞进 `Idempotency-Key` 头」静态判不了 —— 哨兵注释里已用 ponytail 声明,靠契约测试 + 评审补。
- j 域弹窗内复用、刷新即丢 —— `j-client` 注释自述。**但「已知」不等于「有门」**,见 P1-8。

**真欠账(建议纳入下一轮)**
P0-1 / P0-2 / P0-3;P1-1 … P1-8;P2-1 … P2-5。

其中 **P0-1 与 P0-2 与 P1-7 是同一处改动**(把清扫判据从「内存态显示名 + 会话结束」换成「持久化的唯一身份 + 身份变更」),优先级最高:它同时关掉一条泄漏路径、去掉一条自伤路径、并去掉重名歧义。

**关于「同型复发」的一句话**:`7cd74e1` 附带的结构性反思把根因归为「用表面证据替代回源事实」,判断是对的。但本轮 8 条绕过里有 6 条属于**另一条根因**——**门判的是「文本里有没有这个形状」,而缺陷发生在「这个形状有没有在真实执行路径上」**(V2 装饰性 `.get` 缺失、V5 装饰性调用、V7 死代码、V10 语义等价改写、V6 自检探针不代表真实输入)。这条根因目前没有对应的机制,而它正是「正则门 vs 行为门」的分界。我的运行时探针(`r3-authchain-probe.mjs`,可直接搬进 tests/)是这一类的最小可行样例。

---

## 收尾

- 临时 detached worktree 与 `node_modules` junction 已删除,`git worktree list` 已确认只剩既有 5 个。
- 所有变异实验均在 `finally` 中逐字节还原并经 sha1 校验;每批跑完检查 `git status --porcelain`。
- 未 commit / 未 push;未改 `docs/` 下除本报告外的任何文件。

```
$ git status --porcelain
?? docs/changes/2026-08-06-idem-hardening-r3-test.md
```
(仅本报告一个未跟踪文件。)
