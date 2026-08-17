# Tester C 独立验收:admin-ops `verify.mjs` run-all 分档(2026-08-17)

**身份**:独立黑盒 tester(未参与实现)。**仓**:`D:/WORKS/PLAN/admin-ops`,分支 `pkg/as-verify-runall`。
**约束遵守**:全程未 commit / 未 stage / 未 `git checkout` / 未 `git stash` 任何文件;未触碰 `Nexion-uniapp`。
唯一一次写操作(AC-C2 注入)已**逐字节还原**,证据见下。

## 大白话三行

| 做了啥 | 结果咋样 | 要主人拍板啥 |
|---|---|---|
| 7 条验收标准逐条真跑(全量 / static / --only / 注入红齿 / 合并守卫 / 去重 / 忽略规则) | **6 条 PASS,1 条(AC-C6)一半 FAIL**:g4 测试里 `D:/workspace/nexion-backend` 的 grep 计数是 **1 不是 0**,那 1 处在注释里,代码本身已走解析器 | AC-C6 那 1 处注释:**改验收判据**(改成「代码里 0 处」)还是**删注释里的路径**?我推荐改判据(见文末) |

## 逐条结论

| AC | 结论 | 一句话证据 |
|---|---|---|
| C1 全量 run-all + 汇总表 | **PASS** | exit 0 · 128s · 64 行表 · 计数 56+0+8+0+0=64 · 8 个跨仓齿记 SKIP 带原因(非 FAIL) |
| C2 不 fail-fast | **PASS** | 注入红齿在第 2 位 → 其后 54 个齿照跑、末齿 [65/65] 跑到 · exit 1 · 汇总列出 FAIL · `verdict:"fail"` |
| C3 static / --only 档位 | **PASS** | static 只 SCOPED-SKIP 生产构建 1 个、exit 0;`--only a2-outcome` 跑 1 个、63 个 NOT-RUN、exit 1 |
| C4 合并守卫记录契约 | **PASS** | 10 个键齐 · `headTree` 与 `git rev-parse HEAD^{tree}` 全等无尾空白 · `.verify-chain.code` 2 行 · 钩子行为与预判一致 |
| C5 齿轮去重 / 计数 | **PASS** | a2-outcome-uncertain 只挂 1 次(另 3 处是注释)· 静态 64 条 = 运行时 64 |
| C6 硬编码路径 + 显式 skip | **半 FAIL / 半 PASS** | grep 计数 **1 ≠ 0**(注释里);`node --test` 的 skip 显式带原因、`skipped 2`,非静默通过 |
| C7 产物已忽略 | **PASS** | `.gitignore:74` / `:73` 命中,两者皆 ignored |

---

## AC-C1 全量 `npm run verify` —— PASS

- **退出码 0**,墙钟 **128s**(runner 自报 `用时 125.2s`)。收尾复跑一次:exit 0 / 152s(148.3s)。
  两次同一棵树耗时差 24s = 并发 agent 抢 CPU(生产构建 78.3s → ~100s),非不稳定判据。
- **每个齿都在表里**:64 行,序号 1..64 **distinct=64、无重复、无缺号**。
- **计数行相加等于齿总数**:`PASS 56 · FAIL 0 · SKIP 8 · SCOPED-SKIP 0 · NOT-RUN 0 / 64` → 56+0+8+0+0 = **64** ✅
- **跨仓齿记 SKIP 带原因,不是 FAIL**:8 个,逐条列出 `← 缺 nexion-backend`,并给出补救(克隆到 `../nexion-backend` 或设 `NEXION_BACKEND_ROOT`)。
- **额外核实「SKIP 分类是否诚实」**(这是唯一能把真缺陷藏成环境问题的机制,故不只看有没有原因,还核原因真假):
  8 个齿的原始输出**逐个**都含真解析器报错 `未找到 Nexion Backend 项目`,且 skip 标记指的仓名**全部**是 `nexion-backend`;
  `nexion-backend` 在两个候选路径(`D:\WORKS\PLAN\nexion-backend`、`D:\WORKS\nexion-backend`)**确实不存在**。无一个错指仓、无一个把真缺陷误记成环境事实。

  | 齿 | 名称 | 输出含后端报错 | skip 标记指的仓 |
  |---|---|---|---|
  | 6 | canon sentinel | YES | nexion-backend |
  | 9 | M1 pending/failure state contract | YES | nexion-backend |
  | 13 | ops-actions integrity | YES | nexion-backend |
  | 14 | PC remaining-development status contract | YES | nexion-backend |
  | 18 | H9 public-stats cross-repo parity | YES | nexion-backend |
  | 57 | real recharge-channel parity | YES | nexion-backend |
  | 60 | FE/BE mapping closure ratchet | YES | nexion-backend |
  | 63 | K2 contract | YES | nexion-backend |

  (齿 18 的代码注释写它读 `Nexion-uniapp`,但它在 `h9-public-stats-parity.mjs:53` 先解析 backend 根就崩了 —— 所以标记指 `nexion-backend` 是**对的**,不是错指。)
- 机器可读末行:`verify DEGRADED (mode=full, 56/64 gears ran, 8 skipped, 0 scoped-skipped)` —— exit 0 但不自称 OK,「跳过 ≠ 放宽」这条在末行成立。

## AC-C2 不 fail-fast —— PASS

先读 `GEARS` 数组形状再照抄,插在第 1 齿之后:

```js
  ["typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]],
  ["tester force-fail", process.execPath, ["-e", "process.exit(7)"]],   // ← 本次注入
```

`node scripts/verify.mjs --static` 结果:

- **exit 1**(非零)✅
- **后面的齿照旧全跑**:序号 ≥3 的 PASS **54** 个,末齿 `PASS [65/65] E3 acceptance contract` 跑到,`NOT-RUN 0`,末行 `56/65 gears ran`。红齿**没有**再让其后几十道门失声。
- **汇总列出该 FAIL**:表内 `FAIL [ 2/65] tester force-fail 0.2s`;专段 `❌ FAIL(1 个,必须修): [2/65] tester force-fail ← 退出码 7`。
- **`.verify-cache/last-run.json` 为 `verdict:"fail"`** ✅,且 `steps[1] = {"step":"tester force-fail","status":"fail","ms":155}`;`.verify-exit.code` = `1`。

**还原(逐字节,未用 git)**:按整行内容精确匹配删除(含 CRLF),不按行号:

| 判据 | 注入前 | 还原后 |
|---|---|---|
| sha256 | `a7597e27…d9bbd4e3` | `a7597e27…d9bbd4e3` ✅ |
| git blob hash | `512378a85b505e03ff366988209660aba4a366cf` | 同 ✅ |
| 行数 | 452 | 452 ✅ |
| `cmp` 与注入前备份 | – | **identical** ✅ |
| `git diff scripts/verify.mjs \| grep tester` | – | **无输出**(grep exit 1)✅ |

别人在该文件里的未提交 WIP 因此一字未损(全程未 `git checkout` / `git stash`)。

> ⚠️ 方法论坑(留给后来者):本仓 `scripts/verify.mjs` 是**全 CRLF**(453/453 行),但本机 Git Bash 的
> `grep -c` 配 CR 模式报 0、`cat -A` 也不显示 `^M` —— 两个探针都在骗人。只有 node 的字节视图
> (`(s.match(/\r\n/g)||[]).length`)是准的。**用 `sed -i` 插行会静默混入 LF 行尾**;本次改用 node 按行尾探测插入,才拿到逐字节还原。

## AC-C3 档位 —— PASS

- `node scripts/verify.mjs --static`:**exit 0**,SCOPED-SKIP **恰好 1 个**且正是重齿 `[56/64] production build`;
  其余齿照跑(`PASS 55 · FAIL 0 · SKIP 8 · SCOPED-SKIP 1 · NOT-RUN 0 / 64`)。
  收尾专段点明「**没跑**,不是通过」+「合并守卫只认 mode=full」。
- `node scripts/verify.mjs --only a2-outcome`:**exit 1**(非零),只跑 `PASS [27/64] A2 outcome-uncertain contract`,
  其余 **63 个 NOT-RUN**;NOT-RUN 专段列前 10 条 + `…还有 53 个`(不刷屏但表内一条不少)。
  (`--only a2-outcome` 命中的是**参数里的文件名** `tests/a2-outcome-…`,不是齿名 —— 干草堆含齿名+命令+参数,如设计所述。)

## AC-C4 合并守卫记录契约 —— PASS

全量跑完后 `.verify-cache/last-run.json`:

- **键**:`mode, verdict, treeMoved, tree, headTree, dirty, head, at, totalMs, steps` —— 要求的 10 个**齐**,**无缺、无多余**。
- **`headTree` 与 `git rev-parse HEAD^{tree}` 全等**:两边都是 `b022742c25c95de04c630313cb5c1dcdb3814629`,
  长度 40、**无任何空白字符**(含尾换行)。这正是守卫 `rec.headTree !== refTree` 全等比较能对上的前提。
- **`.verify-chain.code` 恰好 2 行**(76 字节):第 1 行 `0`,第 2 行 `mode=full pass=56 fail=0 skip=8 scoped_skip=0 not_run=0 tree=f2913ef6f396`。
- 记录归属自证:`totalMs=125169` 与本轮自报 `125.2s` 吻合、`at` 与开跑时刻吻合 → 读到的是**我这轮**的记录,不是别的 agent 的。

**钩子实测 —— 先按头部契约预判,再跑,再比对**:

- **预判(动手前写下)**:命令 `git -C D:/WORKS/PLAN/admin-ops merge --no-ff pkg/as-verify-runall`,
  HEAD 在 `pkg/as-verify-runall`,`MAINLINE_RE = /^(master|main|UniApp)$/` 不匹配 → `onMainline=false`;
  钩子第 170 行 `if (intent.kind === "merge" && !onMainline) process.exit(0)` 命中 →
  **exit 0,且无任何输出**;`dirty` / `mode` **根本不会被读到**。
- **实测**:`exit=0`,零输出。**与预判逐项一致** ✅(与任务提示「非主线分支上守卫不管 merge」一致)。
- **但这条 probe 证不到 `judge()`** —— 它在 `judge()` 之前就短路了。故我补了一条真能走到 `judge()` 的
  只读 probe(只把 JSON 喂给钩子脚本,**没有真的 push**):
  `git -C D:/WORKS/PLAN/admin-ops push origin HEAD:main` → **exit 2**,拦截理由:
  `最近一次 full 跑时工作树不干净(2026-08-17T10:48:02.960Z)—— 绿的是「HEAD + 未提交改动」,不是任何一个提交`。
  说明 `judge()` 真读到了我这份记录,且**正确拒绝**了一份 `mode=full + verdict=pass` 但 `dirty=true` 的绿 —— 门不是空转的。
- 记录里 `dirty=true` 是**对的**(工作树有 5 个文件的既存 WIP),因此这份 pass 记录**无法授权任何主线合并**。

## AC-C5 去重 / 齿数 —— PASS

- `a2-outcome-uncertain` 在 `verify.mjs` 中 4 处,其中**只有 1 处是真齿**:第 268 行
  `["A2 outcome-uncertain contract", "node", ["--test", "tests/a2-outcome-uncertain-contract.test.mjs"]]`;
  第 266 / 299 / 342 行均为注释(266 与 299 正是记录这次去重的两条注释,342 是 `--only` 的说明)。允许注释,故 PASS。
- **齿数 64**,两个独立来源互证:① 静态数 `GEARS` 块内条目 = 64,且块内无「既非注释也非单行齿」的残行(无多行条目);
  ② 运行时每行都是 `/64`、计数行 `/ 64`。

## AC-C6 —— grep 半条 **FAIL(按字面)**;skip 半条 **PASS**

**① `grep -c "D:/workspace/nexion-backend" tests/g4-invite-registry-contract.test.mjs` → `1`,不是 `0`。按字面判据 FAIL。**

那唯一 1 处在**第 15 行的 JSDoc 注释**里,是在**记录这次修法的历史**:

```
15: *   原来这三个文件硬编码 `D:/workspace/nexion-backend/…` —— 那是某一台机器的目录布局,后果两条:
```

可执行代码已走共用解析器(第 23 行 `const backendRoot = optionalNexionBackendRoot({ adminRoot });`),
**运行期不含任何硬编码绝对路径** —— 判据的**意图**成立,**字面**不成立。两个事实都摆在这里,不替主人合并结论。
`tests/e3-acceptance-contract.test.mjs` 侧为 `0`,字面通过。

**② `node --test tests/g4-invite-registry-contract.test.mjs tests/e3-acceptance-contract.test.mjs` → PASS。**

exit 0,计数 `tests 12 · pass 10 · fail 0 · skipped 2 · todo 0`。**跨仓断言是显式 skip 且带原因**,不是静默通过:

```
﹣ E3 A2 object locks use the same canonical key as backend direct-write checks (0.7244ms) # 本机无 nexion-backend:仅跨仓断言跳过(设 NEXION_BACKEND_ROOT 或克隆到 ../nexion-backend)
﹣ G4 invite state is server-enforced unused to used or void only (0.1214ms) # 本机无 nexion-backend:仅跨仓断言跳过(设 NEXION_BACKEND_ROOT 或克隆到 ../nexion-backend)
```

且这两条 skip 在 verify 汇总里**也看得见**(齿 31 `⚠ 齿内 1 条断言 skip`、齿 64 `⚠ 齿内 1 条断言 skip`)——
两个来源计数一致(单跑两文件共 2 条 = 每文件 1 条),齿内 skip 的会计**对得上**。

## AC-C7 产物忽略 —— PASS

```
.gitignore:74:/.verify-cache/     .verify-cache/last-run.json
.gitignore:73:/.verify-chain.code .verify-chain.code
```

`git check-ignore` exit 0,两者皆 ignored(`.verify-exit.code` 由 `:72` 兜住)。
注:这两条规则本身属于 `.gitignore` 的**未提交 WIP**,随该 WIP 一起提交才长期有效。

---

## AC 之外的观察(不属本次判据,列出供裁决)

1. **同族硬编码路径仍在两个文件的代码里,且是孤儿门**(P2,建议主人裁决):
   `tests/b3-funnel-closure-contract.test.mjs`(3 处)与 `tests/cd-legacy-closure-contract.test.mjs`(2 处)
   **在代码里**(非注释)硬编码 `D:/workspace/nexion-backend` / `D:/workspace/nexion-ops-console`,且**都不用解析器**。
   两者**既不在 `GEARS` 也不在 `package.json` scripts** —— 即 g4 注释所批评的那个形态(「孤儿门 = 没有门」),
   而 g4/e3 这轮只治了挂在链上的两个。是该一起收敛、还是这两个已判退役,需实现方/主人定,我不替判。
2. **`--only` 调试跑会把 `mode:"full"` 写进 `last-run.json`**(P2,当前不可利用):
   本次 `--only a2-outcome` 落盘 `mode=full · verdict=fail`。因 `verdict=fail`,守卫照旧拦,今天无害。
   结构上也自洽:任何更窄的 `--only` 必留 `NOT-RUN>0` → exit 1 → `verdict=fail`;
   而能命中全部 64 齿的 `--only` 实际上**把 64 个齿全跑了**,所以拿不到「假的 full 绿」。**结论:不是漏洞,是命名歧义**
   (`mode` 记的是档位开关,不是覆盖面)。写在这里只为免得下一个人把它当洞查一遍。
3. **齿内 skip 计数只在「有兄弟仓缺失」时才生效**:`run()` 仅在 `anyRepoMissing` 为真时截流 stdout 才数得到
   `skipped N`(代码注释已自陈)。若哪天所有兄弟仓齐全,则**任何**成因的齿内 skip 都数不到 —— 那时缺仓型 skip 也不复存在,
   但**非缺仓成因**的 skip(比如条件跳过)会隐形。当前环境不受影响。
4. **本轮全程有其他 agent 并发在同仓跑 verify**:`.verify-cache/last-run.json` 是共享单文件。
   我用 `totalMs`/`at` 与自报耗时对账确认读到的是自己的记录;耗时数字(128s vs 152s)受并发影响,不可当性能基线。
   另:AC-C2 注入期间(约 60s)若有别的 agent 读了该记录,会看到 65 齿 + 一条 `tester force-fail` —— 那是本测试的产物,不是缺陷。

## 收尾状态(交回时)

- `scripts/verify.mjs`:**与注入前逐字节一致**(sha256 / blob hash / `cmp` 三重确认)。
- `git status --short` 与开工时**完全相同**:`M .gitignore` · `M CLAUDE.md` · `M scripts/verify.mjs` · `M tests/e3-acceptance-contract.test.mjs` · `M tests/g4-invite-registry-contract.test.mjs` · `?? .claude/`。未 commit / 未 stage。
- 仓内门记录已由**收尾那次干净全量跑**覆盖(非我的注入测试产物):
  `mode=full · verdict=pass · treeMoved=false · dirty=true · steps=64 · headTree=b022742c…`(与 `HEAD^{tree}` 相符)。
  **我没有用手工拷贝去「恢复」任何 pass 记录** —— 门的状态只能由真跑产生。
- 新增文件:仅本报告。

## 待主人拍板(自带选项 / 推荐 / 不做会怎样)

**AC-C6 的 1 处 grep 命中怎么处理?**

| 选项 | 代价 / 风险 | 不做会怎样 |
|---|---|---|
| **A(推荐)改验收判据**:把 AC 写成「**代码里** 0 处硬编码」(grep 先剔掉注释行再数) | 几乎无代价;判据从「文件里没这串字」变成「运行期不吃这串字」,更贴真正要防的事 | 判据与事实长期对不上,每个 tester 都要重报一次同一条「FAIL」,门失去信噪比 |
| B 删注释里的路径 | 会删掉事故叙事(「原来硬编码 → 两条后果」),而那正是防复发的记忆;主人定的降噪规则要求删事故叙事**先经点头** | 注释还在,grep 判据继续字面红 |
| C 两条都不动 | 零成本 | 同 A 的「不做」栏 |

**推荐 A**:要防的是「运行期吃某台机器的目录布局」,注释里的字符串既不被执行也不会漂移;
而观察 1 里 b3 / cd-legacy 那 5 处**在代码里**的同族路径才是真风险面 —— 判据校准到「代码」正好把它们框进来。
