# 第四轮独立验收 —— 共享幂等基建硬化包(pkg/idem-hardening @ 278b21c)

- 验收对象:`pkg/idem-hardening`,HEAD `278b21c`(重点面:该 commit 动的认证链)
- 验收方式:**运行时探针驱动真模块**(`lib/admin/pending-mutation-store.ts` + `lib/store/admin-auth.ts` 的真 zustand store + `lib/admin/auth-session.ts` + `lib/admin/login-completion.ts`)+ 自造门级变异 battery(不复用红测里的任何一条)+ 全量门
- 环境:Node v24.15.0;本机无兄弟仓 `nexion-backend`(verify 5 齿如实跳过,既有限制)

## 0 · 验收过程中的两件事实(先交底)

**(1) 工作树在验收期间被本会话之外的改动污染。**
开工时 `git status --porcelain` 为空。跑完红测后出现 ` M lib/admin/pending-mutation-store.ts`,内容是**纯注释**(6 行),给 `claimPendingCommandOwner` 的 `!ownerId` 早退加了一段「代价不对称」的辩护。**不是我改的**(我的探针只 import 不写;门级 battery 每条都做 sha1 逐字节还原,且自查通过)。同会话另有 `main` / `t-round3` / `t1234-tester` / `t5-tester` 在跑。我**不还原别人的改动**,原样留在树上并在末尾贴出。因为是注释,tsc / verify / 行为结论均不受影响;下文 §2.3 会正面回应那段辩护。

**(2) 红测的「还原完整性」检查看不出这类污染。**
`_redtest-idem-hardening.mjs` 的 digest 比的是**本次运行前后**,树本来就脏时两端一致照样打绿;`git status` 那道只 filter `.redtest-bak` / `probe-`。

## 1 · 结论速览

| 项 | 结果 |
|---|---|
| AC1 身份认领正确性 | **FAIL**(a/b 全 PASS;c/d/e 共 8 条实测不符预期) |
| AC2 撤掉三处清扫后的新缺口 | **FAIL**(找到 1 条此前未列的路径:会话端点抖动期认领根本不发生) |
| AC3 前三轮 P0 回归 | **部分 FAIL**(可回归的 7 条原始手法**全部仍被挡**;13 条自造新变体里 1 条穿透;另发现 R3 的 P0-3 与两条 P1 **根本没修**) |
| AC4 归类统一的用户可见行为 | **部分 FAIL**(D 域资金面口径已对齐;C1 用户面标题仍说「失败」;D2 批量失败后不回读) |
| AC5 全量门 | **PASS**(tsc 0 / verify 40+5跳过 / 红测 57 按预期 / 相关测试全绿);**红测脚本自身审出 3 处弱点** |
| AC6 签不签 | **不签**。见 §7 |

新增问题:**P0 × 0 · P1 × 6 · P2 × 12**。其中 3 条 P1 是**前三轮已上报、至今未修**的存量(含 R3 原评 P0 的一条)。

> 派单交底里写「前三轮共抓到 7 个 P0,已全部修复」。实测:R3 报告写的是 **P0-1 / P0-2 / P0-3 三条**,commit `278b21c` 只修了前两条;**P0-3(红测脚本没有任何门守着)至今无门**(§5.1)。所以是「8 条里修了 7 条」,不是「7 条全修」。

## 2 · AC1 身份认领的正确性(运行时探针)

探针:`newPage()` = 用 `?epoch=N` 打断模块缓存重建**整张模块图**(等价于浏览器整页 reload:`clearGeneration` 与各 store 的内存镜像全部重建),而 sessionStorage 替身跨 epoch 保留。存储键 ground truth 从哨兵台账 + 源码解析得出,**29 把真实键**全部播种。

```
$ PROBE_ROOT=<repo> node --experimental-strip-types --import ./register.mjs probe-ac1.mjs
[环境] 真实存储键 29 把,迁移面 30 个
```

### 2.1 (a) 同一个人 —— 8/8 PASS

```
✓ a1 首次登录后归属标记落盘
✓ a2 刷新后 29 把键全部存活
✓ a3 连续 5 次续期后键全部存活
✓ a4 signOut → 同一人重新登录后键全部存活
✓ a5-1 resetAdminSession 真跑后命令号一把不少
✓ a5-2 resetAdminSession 确实触发了 reload(证明上一条不是因为函数早退)
✓ a5-3 401 重置 + reload + 同一人重新登录后键全部存活
✓ a6 同一人刷新后重试复用同一命令号(重复打款的根本防线)
```

a5 是**真跑** `resetAdminSession()`(stub 掉 fetch / location.reload),不是读源码断言;a5-2 是它的负控——证明 a5-1 的「一把不少」不是因为函数提前 return 了。

### 2.2 (b) 换人 —— 6/6 PASS

```
✓ b1 退出→B 登录:A 的键 0 残留
✓ b2 不退出直接 F5 且 cookie 已换 B:A 的键 0 残留      ← R3-P0-1 的原始攻击
✓ b3 401 重置后 B 登录:A 的键 0 残留
✓ b4 新 tab(sessionStorage 全新):无任何前人命令号
✓ b4' 克隆 tab(target=_blank 时浏览器会复制 sessionStorage,含 marker)里 B 登录:A 的键 0 残留
✓ b5 B 提交同指纹动作拿到自己的新号(不复用 A 的)
```

### 2.3 (c) adminId 边界 —— 4/8 FAIL

```
✓ adminId = 0(合法但 falsy) → 清空
✓ adminId 数字 101 → 字符串 "101"(同一个人) → 保留
✗ adminId = 空字符串(A=101 → B="")   → 残留 29 把;marker 仍 "101"
✓ adminId = undefined(A=101 → B=undefined) → 清空
✓ adminId = null(A=101 → B=null) → 清空
✗ 两个不同人 adminId 都缺失(undefined → undefined) → 残留 29 把;marker="undefined"
✗ 两个不同人 adminId 都为 null → 残留 29 把;marker="null"
✗ A=null → B="null"(字符串化撞车) → 残留 29 把
```

**P1-A · 身份认领对「不可用的 adminId」一律 fail-open,且没有任何信号**

- `String(session.adminId)` 之后:`""` 命中 `!ownerId` 早退 → **既不清也不写 marker,claim 整体成为 no-op**;`undefined` / `null` 变成非空字符串 `"undefined"` / `"null"` → 两个不同的人**共用同一个归属**,永远判不出换人。
- 取值链上**零校验**:`app/api/admin/auth/session/route.ts` 把后端 `/api/admin/auth/me` 的 `data` 原样透传;`lib/admin/auth-client.ts:normalizeLoginPayload` 对 `operator` / `authorities` / `role` 都做了兜底与归一,**唯独 `adminId` 逐字段照抄**。TS 里的 `adminId: number` 在运行时不校验任何东西。
- 失败方向错了:此时应当 fail-**closed**(归属不明 ⇒ 不许下一个人复用),现在是 fail-**open**(归属不明 ⇒ 谁都能用),而且**静默** —— 一旦后端换个字段名,整包的核心保护会在没有任何红灯的情况下永久关闭。
- 可达性我**无法在本机确认**(缺 `nexion-backend`)。反向证据:`tests/e2e/*.spec.ts` 的会话 fixture 都带 `adminId`,M 域 `m1-overview.tsx:152` 用 `?? 0`、`a1-accounts.tsx:124` 用 `?? null` —— 说明契约上有这个字段,真缺了 M 域会先坏掉。所以定 P1 不定 P0。
- **正面回应树上那段新注释的辩护**:「这里若清,一次畸形回包就会让所有人每次刷新都被清空」——这个代价不对称的判断**在畸形是瞬时的时候成立**;畸形是**系统性**的时候(字段改名、代理裁剪)结论反转:marker 永远比不出换人,保护永久关闭且无声。两难有第三条路:**不清、也不写 marker、但同时拒绝把已有命令号发给调用方**(或写一个 `tainted` 哨兵值),既不毁掉跨刷新存活,也不把前人的号交出去。现行代码只做了前半句。

### 2.4 (d) 归属标记被清 / 被篡改 / 写入失败 —— 4/7 FAIL

```
✓ d1 marker 被清 → 保守清扫(宁可多清)
✗ d2 marker 被篡改成 B 的 id 后 B 登录 → 残留 29 把
✓ d3-1 降级态(存储写不进)同一 tick 内仍复用同号
✗ d3-2 降级态下同一个人的定时续期把他自己的在途命令号清掉了
✓ d4 clearPendingCommandRecords 不误删归属标记
✓ d5 存储完全不可读时 signIn 不抛异常
✓ d6 removeItem 抛错时代次仍推进(内存镜像作废)
✗ d7 表里混入一条坏记录 → 换人后整张表逃过清扫,B 仍能复用 A 的号(实测取到 `cmd-A-live`)
```

**P1-B · 降级态(存储可读不可写)下,同一个人的定时续期会销毁他自己的在途命令号 → 重试必然铸新号 = 重复打款**

复现序列(全部真模块):

1. sessionStorage `getItem` 正常、`setItem` 抛 `QuotaExceededError`(隐私模式 / 配额满 —— **正是本包改动 ②「内存兜底」宣称要覆盖的那个态**)。
2. `signIn(101)` → `claimPendingCommandOwner("101")` → marker 写不进去 → 下次读回来是 `null`。
3. 运营提交高敏动作 → `resolve` 铸号 `CMD-DEGRADED-1`,落不了盘,只活在内存镜像里(降级告警喊了 1 次,符合设计)。
4. 60 秒后 `console-shell` 的 `setInterval` / `focus` 续期 → `signIn(101)` → claim 读到 `previous === null` ≠ `"101"` → **保守清扫** → `clearGeneration += 1` → **内存镜像被作废**。
5. 运营重试 → `resolve` 取不到旧号 → 铸 `CMD-DEGRADED-3`。**后端收到第二条命令。**

`pending-mutation-store.ts` 头部写着「降级期间同会话重试仍复用同号,只是刷新即丢」——在有续期的真实外壳里,这句话**不成立**;而「超时 → 想清楚 → 重试」这段人类时间几乎必然跨过 60 秒。触发前提(存储可读不可写)确实是边角浏览器态,故定 P1 不定 P0;但它把改动 ② 的承诺整个抵消掉了,而两个改动在同一个包里。

**P2-A · 清扫失败时仍写 marker,把失败的交接记成成功的**
`claimPendingCommandOwner` 不看 `clearPendingCommandRecords` 的返回值。`removeItem` 抛错(或删到一半抛)时,清扫在 try 里被吞掉返回 0,**marker 照样更新成 B** —— 于是这张残留表此后永远不会再被清(marker 已经是 B 了)。d6 只证明了内存镜像会作废,持久层没有。

**P2-B · marker 被篡改即可继承前人全部命令号**
同源脚本 / devtools 把 `nexion-admin-command-owner` 改成自己的 id,29 把键原样继承。威胁模型上,能开 devtools 的运营本来就能直接调 store,不算权限升级;但**后台 XSS 会因此从「偷 token」多出一条「静默继承在途命令号」**的路。定 P2。

**P2-C · 一条坏记录保住整张表(`every` 谓词的代价)**
`isPendingCommandTable` 要求**每一行**都合规(这是为了不误删别人的业务表,合理)。副作用:表里混进一条 `createdAt: "坏字符串"` 的记录,整张表就逃过换人清扫,而 `readAll` 只会剔掉那一行、**其余行照常可用** —— 实测 B 换人后仍取到 `cmd-A-live`。当前无自然代码路径能写出坏行(`remember` 里四个公共字段排在 extra 之后,恒定合规),需要外部污染 / 版本错位才可达,故 P2。可选缓解:混合表**只删合规的那些行**而不是整张跳过。

### 2.5 (e) 认领的时机 —— 2/4 FAIL

```
✓ e1 认领发生在 zustand set 之前(读 marker 的那一刻 isAuthenticated 仍为 false)
✓ e2 认领是同步的(signIn 返回时已完成)
✗ e3 旧 tab 在续期前提交仍复用 A 的号
✓ e4 旧 tab 一旦续期到 B,立刻换成新号
```

**单 tab 内的答案是「不可能」**:`ConsoleShell` 在 `isAuthenticated` 为真之前只渲染 `LoginGate`,而 `isAuthenticated` 只由 `signIn` 置位,`signIn` 的第一句就是认领(e1 实测)。另外全仓 **每个路由 `page.tsx` 都包了 `ConsoleLayout`**(实测遍历:0 个例外),没有绕过外壳的写面。

**P2-D · 跨 tab 有一个窗口:已登录的旧 tab 在下一次续期之前**
B 在别处登录(cookie 全局共享)后,旧 tab 仍以 A 的状态渲染、`isAuthenticated` 仍为真,认领要等 `setInterval`(60s)或 `focus` 触发的**异步**会话查询才发生。这段窗口里从旧 tab 提交,带的是 B 的 cookie、A 的命令号 → 后端按 A 的号幂等回放:B 的操作被吞、审计记在 A 头上。触发要「同浏览器换人 + 旧 tab 还开着 + 60s 内在旧 tab 上提交 + 指纹恰好撞上 A 的在途项」,概率低,定 P2。

## 3 · AC2 撤掉三处清扫后的缺口普查

`signOut` / `resetAdminSession` / `completeInteractiveLogin` 三处清扫全部撤掉,现在只剩 `signIn` 一个认领点。逐条走「操作员身份可能改变」的路径:

| # | 路径 | 是否经 signIn | 命令号会不会残留 | 证据 |
|---|---|---|---|---|
| 1 | 登录表单(含 MFA / 改密完成)→ `completeInteractiveLogin` | 是 | 换人清 / 同人留 | AC2 探针路径1、1'(**真跑** `completeInteractiveLogin`) |
| 2 | 冷启动会话恢复 `console-shell` mount | 是 | 不残留 | b2 |
| 3 | 60s 定时续期 / focus 续期 | 是 | 不残留 | a3 / e4 |
| 4 | 撞 401 → `resetAdminSession` → reload → 恢复 | 是(reload 后) | 不残留 | a5 / b3 |
| 5 | 顶栏退出按钮 → `signOut` → LoginGate → 下一人登录 | 是 | 不残留 | b1 |
| 6 | 退出请求失败(不 `signOut`)→ 直接刷新且已换人 | 是 | 不残留 | AC3 新变体 4' |
| 7 | `j-client` 401 → 只 `signOut()` 不 reload | 是(下次登录) | 不残留 | 同 5 |
| 8 | 会话恢复返回 null → `signOut` → 停在登录页 | 否(无人登录) | **残留在本 tab** | AC2 探针路径3 |
| 9 | 关标签页再开 | — | sessionStorage 全新,无可残留 | b4 |
| 10 | `target=_blank` 克隆 tab(浏览器复制 sessionStorage) | 是 | 不残留 | b4' |
| 11 | 浏览器会话恢复(重开崩溃的窗口,sessionStorage 会还原) | 是 | 不残留(同 2) | 推理,与 2 同链 |
| 12 | 须改密的账号登录(`signIn` 未被调用,但 cookie 已是 B) | 否,直到改密完成 | 残留,**但 B 进不了控制台** | AC3 新变体 6' |
| 13 | 用户模拟登录(C2 impersonation) | — | 改的是被查看用户,不是操作员 adminId | 源码核对 |
| 14 | **会话端点持续抖动** | **否** | **残留且会被复用** | 见下 |

路径 8 是设计预期(同一个人回来还要用),风险在于「该 tab 转手给别人」,由下一次 `signIn` 认领兜底 —— 只要下一个人真的登录就安全。

**P2-E ·（第 14 条,此前三轮均未列）会话端点抖动期间认领根本不会发生**
`console-shell.tsx:86` 的续期 `catch` 刻意「保留当前会话」(注释:*Keep the current session on transient network errors*)——那是修 R3-P0-2 的正确方向。副作用:**只要 `/api/admin/auth/session` 持续失败,认领就一次也不会跑**,而 cookie 已经换成 B 的话,这段窗口不是 60 秒而是「抖动持续多久就多久」。实测:抖动期间同槽位 `resolve` 仍返回 `CMD-A`。这是 P2-D 的放大器,同一族,一起定 P2。

## 4 · AC3 前三轮 P0 的回归 + 自造新变体

### 4.1 原始手法逐条重放:7/7 仍被挡

门级(红测 57 项 exit 0,全部按预期)与**行为级**(不改源码,直接驱动真模块)两半都做了:

| # | 原始 P0 | 门级 | 行为级 |
|---|---|---|---|
| 1 | 哨兵:别名 import + 同名本地桩 | T5-R1 红 ✓ | — |
| 2 | 哨兵:import 路径指向自造同名文件 | T5-R2 红 ✓ | — |
| 3 | 哨兵:`import type`(运行时无绑定) | T5-R3 红 ✓ | — |
| 4 | 清扫接错路径(顶栏退出不走 resetAdminSession) | R2-P0-1e 红 ✓ | ✓ 顶栏退出 → B 登录,A 表清空 |
| 5 | 清扫被存活实例的内存镜像复活 | R2-P0-2 / 2b 红 ✓ | ✓ clear 后 forget 不复活 |
| 6 | 刷新后恢复到另一个人的会话 | R2-P0-1 / 1b 红 ✓ | ✓ F5 换 B 清空 |
| 7 | signOut 误伤同一个人 | R2-P0-1c 红 ✓ | ✓ 抖 10 次同号存活 |

### 4.2 自造新变体 13 条(每条 P0 至少一条):12 挡 / 1 穿

```
✓ P0#4 新变体:退出请求失败 → 不 signOut → 直接刷新换到 B,仍清空
✓ P0#5 新变体:换人后老实例 remember 不得把 A 的号带回来
✗ P0#5 新变体(异步窗口):清扫落在 fetch 往返中间时 A 的号被写回   ← 实测表内容 cmd-A
✓ P0#5 新变体(双实例):清扫后任一实例的读都不得把号写回
✓ P0#6 新变体:换到「须改密」的 B(未进控制台)也先清掉 A 的号
✓ P0#6 新变体:A→B→A 往返后 A 拿到新号(旧号已作废)
✓ P0#7 新变体:抖动 + 401 重置 + reload 后同一人重试仍是同号
✓ P0#7 新变体:同一 adminId 改了显示名 / 角色后重登,命令号仍存活
✓ P0#7 新变体:显示名重名的两个账号必须判成换人(P1-7 回归)
```

**P2-F · 清扫的「代次作废」防不住调用方跨 await 抓在手里的命令号**
`clearGeneration` 作废的是 **store 的内存镜像**;命令号一旦被调用方存进局部变量并**在 await 之后**再 `remember` 回去,清扫就被绕过。探针形态:`get()` → `await`(期间发生换人清扫)→ `remember(旧号)` → A 的号原样落回 B 的 tab。

**可达性(我逐个核过全部 20 个 `remember` / `resolve` 调用点)**:现有代码里**没有**这种形态 —— d-client / user360 / k6 / i / stable-mutation 的 `remember` 都在 fetch **之前**;唯一的 await 之后 `remember` 是 `k1-multiaccount.tsx:513`,而它记的是一个**从未发出过的新号**(无害)。所以这是**潜在结构缺陷、当前不可达**,定 P2。真正的问题是:这条不变量(「命令号不得跨 await 回写」)**没有任何门守着**,将来谁写一行 await 后的 `remember(oldKey)`,清扫就静默漏一条,而所有门全绿。

### 4.3 存量复核:前三轮报过但**没修**的三条

| 编号 | 出处 | 现状 | 我的复现 |
|---|---|---|---|
| R3-P0-3 红测脚本没有任何门守着 | R3 报告,原评 **P0** | **未修**:`scripts/verify.mjs` 的 GEARS 表里没有它,全仓 grep 也没有任何脚本引用它 | 见 §5.1 |
| R3-P1-1 删光 `.get(` → 每次提交现铸新号 | R3 报告 | **未修** | M2 实测绿 |
| R3-P1-5 5xx 门槛提成具名常量即可绕过归类门 | R3 报告 | **未修** | M11 实测绿 |

## 5 · AC5 全量门 + 红测脚本自审

### 5.1 门的执行结果

```
$ npx --no-install tsc --noEmit                              → TSC_EXIT=0
$ npm run verify ; cat .verify-exit.code                     → 0
   verify DEGRADED (40/45 gears ran, 5 skipped)  ← 5 齿缺 nexion-backend,既有限制
$ node scripts/_redtest-idem-hardening.mjs                   → exit 0,红测全部按预期(57 项)
$ node scripts/pending-idempotency-key-sentinel.mjs          → PASS(扫 354 文件 / 命中 5 / 台账 5 / 已迁 30,30 个 store 标识符逐个核过)
$ node --test tests/pending-mutation-store-contract          → PASS
              tests/pending-mutation-migration-contract      → PASS
              tests/f-pending-store-contract                 → PASS
              tests/outcome-classification-contract          → pass 7 / fail 0
              tests/a2-outcome-uncertain-contract            → PASS
              tests/b23-outcome-unknown-contract             → PASS
              tests/i4-a2-pending-visibility-contract        → PASS
              tests/rbac-platform-contract                   → PASS
              tests/admin-auth-password-change-gate          → PASS
```

**P1-C(存量,R3 原评 P0)· 红测脚本本身没有任何门**
`_redtest-idem-hardening.mjs` 是全包唯一验证「门有没有判别力」的东西,它 57 条判据全靠人手跑。它坏掉(语法错、锚点漂移、被误删)时,`npm run verify` 照样全绿。R3 报告已经给出一行修法(`node --check` 加一齿),至今未加。

### 5.2 红测脚本自审(找假红测)

好的部分,先说清楚:空注入守卫(`from === to` 直接 throw)、锚点不存在即 throw、`.redtest-bak` + finally 还原、内容 sha1 指纹自查、29 条带 `expectText` 的「红在正确判据上」——这几道都是真的在起作用,我按它们的语义各挑一条验过。

三处弱点:

- **P2-G · 57 条里有 16 条期望红的用例没有 `expectText`**(T5①–⑨、T3①–⑤、T4①②)。脚本自己的抬头就写着「用例声明 expectText 后才算真的钉住判据」,这 16 条落在自己定的标准之外:它们只要门退出码非 0 就打勾,门因语法错误自爆也算数。
- **P2-H · T4③ 是注释注入,名不副实。** 用例名叫「反误红:`ttlMs` 仍可由调用方覆盖(降级 TTL 用例依赖它)」,实际注入是在 `expiresAt: createdAt + ttlMs,` 后面加一句 `// ponytail: 窗口口径见 §0.4`。加个注释当然不会让门变红 —— 它验的是「加注释不报错」,不是「ttlMs 仍可覆盖」。判别力接近零,且名字会让下一个读的人以为那条不变量有门。
- **P2-I · 还原完整性查不出「树本来就脏」。** 见 §0(2)。本轮的污染就是这么溜过去的。

## 6 · AC4 归类统一后,运营看到什么、会做什么

推演两种世界:**W1 = 5xx 但后端已落库**,**W2 = 5xx 且已回滚**。

### D 域(d-client:D1 充值确认 / D2 提现审核 / D3 到账)—— 口径对齐,PASS

5xx → `outcomeStaysUnknown` 为真 → **保号**,并抛
`操作结果未知，可能已经生效。请先刷新核对，并使用同一请求号重试：{命令号}`。
确认弹窗 `handleConfirm` 的 catch **保持弹窗打开**并把这句话显示在框内(`design-kit.tsx:3233`),运营原地再点一次「确认提交」→ 指纹不变 → 从 sessionStorage 取回同号 → W1 被后端幂等吞掉(无副作用)、W2 正常执行。**两种世界都不会双发。**

D2 单笔 `runReview` 的 catch 里还有 `await load()`,失败后列表状态会刷新,运营看到的是服务端权威状态。

### D2 批量放行 —— 两个残留

**P2-J · 批量失败后不回读,而话术让运营「先刷新核对」**
`confirmBatch` 的 `run` **只有 `finally { setSubmitting("") }`,没有 catch,也就没有 `await load()`**(单笔那条有)。于是 5xx 之后:弹窗里写着「请先刷新核对」,而背后的列表仍是**失败前的旧数据**。运营若照做去刷新,弹窗关闭、勾选丢失。

推演:
- W1(已落库):刷新后那批已变 `APPROVED`,`submittableRows` 把它们筛掉 → 运营无可再提交 → 安全。
- W2(已回滚):刷新后仍 `PENDING` → 重新勾同一批 → `ids` 相同 → `batchScope` 相同 → **取回同号** → 安全。
- **W1 但运营不刷新、改筛选条件重来**:UI 上那批仍显示 `PENDING`,新的 `ids` 子集 → 新指纹 → **新命令号** → 已放行的那部分被再放行一次。此时唯一的防线是后端提现状态机拒绝对 `APPROVED` 再放行 —— 客户端幂等在这条路上**不生效**。
  最省事的封堵:批量那条也补 catch + `await load()`(与单笔一致),让「结果未知」之后运营看到的必定是权威状态。

### C1 用户面(user360-client)—— 话术掉队的残留

**P2-K · 提示标题说「失败」,正文说「可能已经生效」**
`user360-client` 抛的 `UsersOutcomeUnknownError` 消息本身是对的(「本次操作结果未知,可能已经生效…请求号:xxx」),但 C1 页面的接法是:

```
catch (err) { if (!(err instanceof UsersOutcomeUnknownError)) c1UserCommands.forget(slot);
              toast.error("支付方式解绑失败", errorMessage(err)); return false; }
```

标题写死「解绑失败 / 换绑通知失败 / 昵称重置失败」,正文才说「可能已经生效」。运营扫标题就会当成没生效。这正是 R3-P1-6 那一类(命令号去留统一了、运营看到的没统一),资金域已改、**用户域没改**。
资金后果有限:这几个动作的输入指纹用 `String(method.version)`,W1 里版本会变 → 重试时指纹变 → 换新号,但同时后端会因版本不符拒绝,不会双发。所以定 P2 而不是 P1 —— 问题在于**误导**,不在于会双发。

## 7 · AC6 结论:签不签

**不签。**

不是因为发现了新的 P0(**没有**:AC1 的 (a)(b) 两组共 14 条主干场景全绿,前三轮 7 条 P0 的原始手法逐条仍被挡,13 条自造新变体只穿透 1 条且当前不可达)。不签是因为下面这三类东西加在一起,让「这个包已经收口」这句话现在还说不出口:

**(甲)存量欠账没清,而派单的前提写的是「已全部修复」。** R3 的 P0-3 与 P1-1 / P1-5 三条至今未修(§4.3、§5.1)。其中两条我这轮**重新实测复现**(M2 / M11 都是绿),不是照抄旧报告。

**(乙)包自己的两个改动互相抵消,而且没有门看得见。** 改动 ②(降级内存兜底)承诺「隐私模式下同会话重试仍复用同号」;改动 ④(身份认领)在同一个态下每 60 秒把它清一次(P1-B)。两个改动都在这个包里,单看各自的契约测试都绿。

**(丙)新面的门有两个洞,能让核心保证被静默删掉。** M7(marker 键名不稳定 → 每次页面加载都保守清扫 = 跨刷新存活整体失效)与 M2(删光 `.get(` = 每次提交现铸新号)都是**一行改动能造成系统性重复打款**、而**全部门保持绿**。M7 这一条的根因值得单说:迁移契约的行为断言在**同一个进程内**反复调 `claimPendingCommandOwner`,而模块级常量只求值一次,所以「marker 必须跨页面加载稳定」这条不变量它天生看不见 —— 我的探针用 `?epoch=N` 重建模块图才抓得到。这是**验证工具用错维度**,不是判据写松。

### 门级自造变异 battery(11 条,不复用红测任何一条)

```
✗ [期望红] M1  死分支走私:import 与调用全留,真店挂在恒假分支上,运行时用内存桩
✗ [期望红] M2  R3-P1-1 遗留:删光 .get( → 每次提交现铸新号
✗ [期望绿] M3  合法重构:命名空间 import(import * as ...)被误红
✗ [期望绿] M4  合法重构:经诚实 re-export 转一手被误红
✓ [期望红] M5  认领实参加 ?? "" 兜底 → adminId 缺失时静默不清
✓ [期望红] M6  清扫照做但不写 marker → 同一个人每次续期都被清
✗ [期望红] M7  marker 键名改成每次随机 → 永远判不出同一个人
✗ [期望红] M8  认领比对改成前缀匹配(101 与 1010 判成同一人)
✓ [期望红] M9  认领整体挪到 set 之后(存在写请求早于认领的窗口)
✗ [期望红] M10 数量判据走私:真恢复路径改坏 + 死代码里补一个 signIn(auth) 凑数
✗ [期望红] M11 R3-P1-5 遗留:5xx 门槛提成具名常量(行内无三位字面量)
```

对应问题:

- **P1-D · M7**:`COMMAND_OWNER_KEY` 的稳定性没有门。行为断言的进程内视角看不见「跨页面加载」这一维。修法:迁移契约里加一条**重新 import 模块**(query 打断缓存)的用例,断言 marker 跨「reload」仍认得同一个人。
- **P1-E · M2**:`createPendingMutationStore` 的消费面只被要求「至少调过一个方法」,删光读路径(`.get(` / `.list(`)照样绿,而删光读路径 = 持久化白做。修法:判据 3b 对 `createPendingMutationStore` 也分「读 + 写」两半,像 `createSlotAttemptStore` 要求 `resolve` + `forget` 那样要求至少一处读。
- **P1-F · M11**:归类门判「与比较运算符同行的 4xx/5xx 三位字面量」,把 500 提成具名常量即可整条绕开。修法:把具名常量的值也解析进来(哨兵里 `nonEmptyStringLiteral` 已有同款「回本文件查常量定义」的先例,照抄即可)。
- **P2-L · M1**:静态门判不了可达性(store 的 ponytail 注释自己也承认了这条天花板)。威胁模型上更像「不会有人这么写」,记为已知天花板。
- **P2-M · M3 / M4**:两条**合法重构被误红** —— `import * as` 与诚实 re-export。这是 R1-P0 修法(判绑定去向)的必然代价,本身可接受;风险在于下一个撞上它的人可能去**放宽判据**来让自己的重构过门。建议在哨兵注释里明写「这两种写法故意不支持,要用请扩解析器,不要放宽判据」。
- **P2-N · M8**:换人行为断言的样本(101 / 202 / 303)里没有**互为前缀**的一对,`startsWith` 式退化测不出来。补一对 `101 / 1010` 即可。
- **P2-O · M10**:`signIn(auth)` 的**数量**判据仍是文本计数,死代码里补一个就能凑数。R3 从「存在」升到「数量」只提高了一点点门槛。真解要行为级(渲染 hook),成本高;折中是判定前先剥死分支,或改为断言恢复回调链。

### 我会在什么条件下签

1. P1-B(降级态自清)与 P1-A(adminId fail-open)有明确处置 —— 修掉,或者主人**书面标为已知接受**并写清代价。
2. 三条存量(P1-C / P1-E / P1-F)修掉,或降级为有台账的欠账。
3. P1-D 的那条「跨 reload」用例补进迁移契约(它是防止 P1-B / P1-A 同族问题复发的唯一机器手段)。
4. P2 全部记台账即可,不阻塞。

## 8 · 收尾

```
$ git status --porcelain
 M lib/admin/pending-mutation-store.ts     ← 非本轮验收所改,见 §0(1);纯注释,未还原(不动别人的改动)
?? docs/changes/2026-08-06-idem-hardening-r4-test.md   ← 本报告
```

探针与变异脚本全部落在会话 scratchpad,未进仓;门级 battery 每条 finally 逐字节还原并做 sha1 自查(通过)。
