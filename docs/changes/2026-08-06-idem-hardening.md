# 共享幂等基建硬化(六项独立弱点)

状态:Implemented(待收尾审计结论)· 分支 pkg/idem-hardening(基底 = feat/batch12-vnd01b-payout-config @ 6e26993)· 定级 L(资金路径 + 跨模块共享层)

## 验收轮次总览(四轮独立验收 + 收尾多镜头审计)

| 轮 | 镜头 | P0 | P1 | 关键发现 |
|---|---|---|---|---|
| R1 | 机制正确性(哨兵) | 3 | 2 | 判据判「名字出现过」而非「绑定去向」:别名 import / 自造同名文件 / 悬空 executor 三条路全通,连 tsc 与既有契约一并骗过 |
| R2 | 机制正确性(store/清扫) | 2 | 4 | **T2 等于没做**:清扫接在 401 自动重置上,而退出按钮走另一条路;内存兜底又把清扫结果同步复活 |
| R3 | 运行时行为 | 2 | 6 | 漏:不退出直接刷新而登录态已换人;**自伤**:会话抖动触发登出逻辑,清掉同一个人自己的命令号 |
| R4 | 运行时行为 + 认证链 | **0** | 6 | **本包两处改动互相抵消**:存储可读不可写时,身份认领每次续期都把内存兜底刚保住的命令号清掉 |
| 收尾 | 运营视角 / 红队组合 / 长期运维·跨端 | 见收尾节 | | 换镜头(前四轮同属「机制正确性」一个镜头) |

P0 走势 3 → 2 → 2 → 0。四轮全部由独立 agent 自造变异证伪,不采信我的实现叙述。

主人拍板记录:
1. **基底** = batch12 顶开包(F 面 / 参照红测 / G4 version 范本在树,与 batch12 已改的哨兵、verify、k-client、g4-client 零冲突)。
2. **第 1 项口径** = 全家族统一「5xx + 在途命令号 → 结果未知,保号重试」(优势策略,论证见下)。
3. **顺序** = 5 → 3 → 4 → 2 → 1 → 6,一项一 commit 一红测,每项过 tsc + verify;6 只出规格另设签字门。

工艺偏离说明一句:基建硬化无新产品面,不走 nexion-spec 三件套,以每包内嵌可证伪 Done-when 代替(nexion-workflow §3 工艺裁量)。

## Why

出处:pkg/restore-mid-tiers 包 f-pending-store 对抗审计「记档不修(既有面/共享设计)」节 + 换号交接 HANDOFF 任务 B。六项全部回源坐实(2026-08-06,批次基底源码):

1. 同一物理场景两套归类:`a2-client.ts` a2Request 把「结构化 5xx JSON(无 `X-Nexion-Upstream-Outcome: unknown` 头)」归确定性失败→弃命令号;`stable-mutation.ts` 把一切 5xx 归 outcome-unknown→保号。后端若「提交后才 500」,弃号重试 = 资金动作双发。
2. `auth-session.ts` resetAdminSession 只清 auth 键即 reload;sessionStorage 的命令号记录(27 把 `*-commands-*` 键)原样留给同 tab 下一个登录者 → B 复用 A 的命令号,后端回放 A 的提案(操作被吞 + 审计归属错位)。
3. `pending-mutation-store.ts` SlotAttemptStore.resolve 只读 sessionStorage(list()→readAll() 不经内存 Map);隐私模式/配额满时 writeAll 静默吞异常 → 同会话连续重试也每次铸新号,防重复整体失效且无告警。
4. 同文件 remember() 每次 `Date.now()+ttl` 滑动续期 expiresAt;后端幂等窗是**从首次请求起固定 24h**(开发落地规格 §0.4)→ 客户端记录可存活超窗,窗外复用给虚假去重信心。
5. `pending-idempotency-key-sentinel.mjs` 判据 3(MIGRATED 不得回退)在未剥注释原文上做子串/正则匹配 → 删真店换桩 + 注释走私声明即可骗绿(29 个迁移面共有;F 面已由表达式级契约门补位,其余 28 面裸奔)。
6. F 域契约无 version 字段(f1-client 全文 0 处,大小写不敏感)→「基于旧快照的同输入重提被误判为重试」不可防;铁律「并发≠重复:要 CAS 不是幂等键」。依赖后端补契约,先规格后动码。

## 对派单修法的两处偏离(以回源事实为准)

1. **第 2 项不按键名清扫,改按记录形状清扫**。派单设想的谓词是 `nexion-admin-*-commands-*`;回源发现
   H9 的命令号表键叫 **`nexion-admin-h9-public-stats-attempt`** —— 既不含 `commands` 也无 `v1` 后缀,
   按名字判会**整张漏掉**。命名约定是会漂的,记录形状不会:四字段签名(fingerprint / commandKey /
   createdAt / expiresAt,且 commandKey === 行键)足以把命令号表与别的 sessionStorage 数据分开
   (实测同域另一把键 `nexion-sidebar-scroll` 存的是数字,不会误伤)。这样将来新增任何键都自动被覆盖,
   不需要有人记得回来改谓词。
2. **第 5 项不加 CRLF 归一**。派单要求「CRLF 先归一」,实测(node 复现)`(^|[^:])//.*$` 配 `/gm`
   在 CRLF 上**本来就有效** —— 多行模式下 `$` 匹配 `\r` 之前;真正的死形态是
   `split("\n").map(l => l.replace(/\/\/.*$/, ""))`(无 `m` 标志、按行切),f-pending-store 上一轮踩的
   正是后者。加一行归一属冗余,改为**用 CRLF 探针把这条不变量焊进哨兵自检**(判据 0b):
   谁把剥除器改回按行形态,门当场红。红测 T5⑦ 双向验证过。

回源新发现(相对派单增量):
- **D 域存储键前缀是 `nexgrid-`**(`nexgrid-admin-d1-uncertain-commands-v1`),非派单所述 `nexion-admin-*` 一种 → 第 2 项清扫谓词必须覆盖两种前缀,并配「字面量必须落在清扫射程内」的机器门防将来漂移。
- **第 1 项同形面 ≥13 个 client 模块**(a1/a2/a3/j/k/k6/user360/d/b2/b3/b5/i/a6/a7…引用 unknown 头或自带 uncertain 归类),修法必须是共享归类谓词 + 全舰队接线 + 舰队级契约门,不是逐文件补丁。
- **同族第二个洞:传输层错误也被当确定失败**(派单未提,回源发现)。`b2-client.ts:374` 起的 fetch
  **没有 try/catch**,网络断抛裸 TypeError → 页面 catch 里判 `!(caught instanceof B2OutcomeUnknownError)`
  → 弃号。「网络断」恰恰是结果未知的头号场景。b3/b5 同形。根因与 5xx 归类同一条:
  **只认 `X-Nexion-Upstream-Outcome: unknown` 头才叫结果未知**。故 T1 的口径统一必须同时覆盖
  「5xx」与「传输层失败」两支,只修 5xx 等于修了一半(铁律:修一处必全站排查同类)。
- **仓内已有正解可作范本**:`i-client.ts:52` 的 `if (res.status < 500 && isWrite) forget(...)` 就是目标口径
  ——它只在确定性拒绝时弃号。T1 是把这条规则抽成共享谓词后推平全舰队,不是发明新规则。

## 第 1 项舰队地图(2026-08-06 逐文件回源,施工按此清单)

「弃号」= 在途命令号被 forget,下次重试铸新号,后端去重失效。判据应为:**弃号 ⇔ 4xx ∨ (2xx ∧ 业务码≠0)**。

| 档 | 模块 | 现状 | 要改什么 |
|---|---|---|---|
| ✅ 已正确 | `i-client.ts:52` | `res.status < 500 && isWrite` 才 forget | 改接共享谓词(统一来源,行为不变) |
| ⚠️ 半措施 | `d-client.ts:589`、`user360-client.ts:779` | 仅当「本次不是复用已有号」才 forget —— 重试链受保护,但**首次**撞结构化 5xx 仍弃号 | 换成按谓词判定 |
| 🔴 有洞 | `a1`(:155)、`a2`(:355)、`a3`(:256)、`k-client`(:112)、`k6`(:178) | 只认 `X-Nexion-Upstream-Outcome: unknown` 头;结构化 5xx 走 `throw new Error` / 无条件 forget | 5xx + 在途命令号 → 抛各自的 OutcomeUncertain 类 / 不 forget |
| 🔴 有洞×2 | `b2`(:374/:383)、`b3`(:90/:116)、`b5`(:212/:217) | ①同上;②**fetch 无 try/catch**,断网抛裸 TypeError → 页面 catch 判非 OutcomeUnknown → 弃号 | 补 try/catch 归 uncertain + 5xx 按谓词 |

传输层已处理的模块(a1 重试后归 uncertain / a2 / d / user360 / k / k6 / j / i)不动那半。

## 第 1 项口径的决策依据(记档防翻案)

PRD 开发落地规格已写死后端契约:「写入失败则目标域无副作用」「幂等记录与高敏写同事务落库」「server 24h dedup,retry 返 200 + 原结果不重复生效」。据此:
- 契约成立世界:后端 5xx ⇒ 已回滚且幂等记录一并回滚 ⇒ 同号重试 = 干净重执行,保号**零代价**;
- 契约破缺世界(提交后才 500 的实现瑕疵):保号重试被后端 dedup 挡住,**防资金双发**;弃号重试 = 双倍打款。
两种世界保号均不劣于弃号 ⇒ 优势策略,无需先验证后端(本机缺 nexion-backend 仓)。附带收益:`X-Nexion-Upstream-Outcome: unknown` 头从唯一保险丝降级为增强信号,代理漏打头不再致命。

## What changes(逐项)

| # | 包 | 改动面 | 修法 |
|---|---|---|---|
| 5 | 哨兵剥注释 | `scripts/pending-idempotency-key-sentinel.mjs` | 判据 3/4 改跑在剥注释文本上(CRLF 先归一→剥块注释→逐行剥行注释,行注释谓词排除 `://` 协议串);**保持 MIGRATED 台账排版**(migration-contract 用 `/^\s{2}"([^"]+\.tsx?)",$/gm` 反解析台账,不得破坏) |
| 3 | 内存兜底 | `lib/admin/pending-mutation-store.ts` | 内存层从 `Map<fingerprint,commandKey>` 升级为完整记录镜像;readAll() 在 storage 抛错/不可用时回退内存镜像(TTL 照剪);写失败/读失败一次性 console.warn 降级告警;storage 正常时行为与现状逐语义一致 |
| 4 | TTL 硬上限 | 同上 | `expiresAt = (previous?.createdAt ?? now) + ttl`,不再滑动续期;同步改头注释与接口 JSDoc |
| 2 | 登出清扫 | `lib/admin/auth-session.ts` + store 模块 | store 模块导出 `clearPendingCommandRecords(storage)`,**按记录形状**(每行都有 fingerprint/commandKey/createdAt/expiresAt 且 commandKey 与行键相等)判定该表是不是命令号表,而非按键名;resetAdminSession 在 reload 前调用;门 = 静态钉接线 + 运行时用**源码里解析出的全部真实键**做联验 |
| 1 | 统一 5xx | `lib/admin/*-client.ts` 全家族 + `stable-mutation.ts` | 共享归类谓词单源化(deterministic ⇔ 4xx ∨ (2xx ∧ apiCode≠0);其余带在途命令号一律 outcome-uncertain);逐 client 接线;重钉 a2-outcome-uncertain 等既有契约门到新口径;舰队级契约门(剥注释)钉「带命令号的 client 无一把 5xx 归确定失败」 |
| 6 | version 规格 | `docs/changes/`(纯文档) | F 域 version/expectedVersion CAS 契约规格:字段、端点清单、409 语义、前端织入点(槽位或指纹)、迁移次序;范本 = 同树 G4 expectedTiersVersion;**主人签字后另开实现任务** |

红测统一落 `scripts/_redtest-idem-hardening.mjs`(房内 `_redtest-restore-mid-tiers.mjs` 同款:合取项逐个隔离注入 + `.redtest-bak` finally 还原 + 单行锚防 CRLF 失配),常驻不挂 verify,改判据后必须重跑。

## Done-when(逐项可证伪,P6 逐条回测)

- [ ] **5a** 变异「删真店换桩 + 把 import/create 声明挪进注释」→ 哨兵必红(现状:绿 = 漏洞实证)。
- [ ] **5b** 含 `https://` 字符串的行不被行注释剥除器误伤(负控绿测)。
- [ ] **5c** migration-contract 的台账反解析在改后哨兵源码上仍解析出 29 个 MIGRATED 面。
- [ ] **3a** storage 全抛错(隐私模式模拟)下:同槽同输入 resolve×2 返回同一命令号;换输入换号;forget 后铸新。
- [ ] **3b** 降级路径恰好告警一次(不刷屏);storage 可用时既有 store 契约测试逐条保持绿。
- [ ] **4a** 重复 remember 同 commandKey:createdAt 不变(既有断言)且 expiresAt 不再延长(新断言,现状红)。
- [ ] **2a** 预置两种前缀命令键 + 无关键 → 清扫后命令键全消失、无关键原样(运行时半)。
- [ ] **2b** resetAdminSession 清扫接线钉到表达式级(剥注释静态半);全仓 27 处 storageKey 字面量全部落在谓词射程(哨兵判据,漂移即红)。
- [ ] **1a** 全家族无一处把「5xx + 在途命令号」归确定失败;变异改回 a2 旧口径 → 舰队门必红。
- [ ] **1b** a2-outcome-uncertain 契约门重钉后:结构化 5xx JSON(无 unknown 头)+ commandKey → 抛 outcome-uncertain 类错误且保号语义成立。
- [ ] **6a** 规格文档过 ponytail 精简 + 含 GWT 级验收(含「旧快照重提 → 409 CONFLICT 非幂等回放」异常路径);标记待主人签字。
- [ ] **全程** 每包 commit 前:tsc 0 错 + `npm run verify` 全绿(缺兄弟仓齿轮如实跳过 = 既有环境限制)+ 红测按预期红/绿 + 还原字节一致。

## 实施拆解(一项一 commit,顺序固定;勾选须附独立 tester 报告)

- [ ] T5 哨兵剥注释硬化 + 红测 —— commit `fix(sentinel): …`
- [ ] T3 store 内存兜底 + 告警 + 红测 —— commit `fix(admin): …`
- [ ] T4 TTL 硬上限 + 红测 —— commit `fix(admin): …`
- [x] T2 登出清扫 + 形状判据门 + 红测(6 变异)—— 待独立验收
- [x] T1 统一失败归类 + 舰队门 + 重钉既有门 + 红测(7 变异)—— 待独立验收
- [ ] T6 F 域 version/CAS 规格文档 —— 已落盘过 spec-lint,待主人签字
- [ ] 收尾:全量门 + 多镜头 audit(nexion-audit)+ done-review + 大白话汇报

### T1 实施记录(舰队 12 个模块)

统一口径落在 `lib/admin/outcome-classification.ts` 单源,12 个 client 全部接线
(a1 / a2 / a3 / b2 / b3 / b5 / d / i / j / k / k6 / user360)。新增 verify 齿轮
「outcome classification contract」7 条断言:谓词真值表 + 互补性 + 全舰队接线 +
不许自搓 5xx 门槛(带 `classification-ok:` 显式豁免)+ 谓词必须真管着命令号去留 +
认 unknown 头的必须另有谓词路径 + 传输层失败必须有兜底。

**施工中被门抓到的三处**(都是我自己的疏漏,记档防复发):
1. **j-client 整域漏改** —— 摸底地图漏列它,舰队门第一次跑就抓出来。
2. **批量补 import 的脚本被自己写的注释骗过** —— 用「文件里是否提到模块名」判断该不该补,
   而那 6 个文件的**注释里**正好提到了模块名。与本轮修的哨兵漏洞同一个病:子串判定不看语境。
3. 🔴 **改 d-client / user360 打破了既有 store 契约断言** —— 它俩的弃号条件加了第三个合取项,
   而 `pending-mutation-store-contract` 里钉的是旧表达式。**干净树上契约就是红的**,
   是红测跑 T4③ 时顺带暴露的(那条本身与此无关)。已按加强后的完整表达式重钉,不是放宽判据。
   教训:改被契约门钉住的表达式,必须同步复跑**所有**引用它的门,不能只跑新写的那个。

## Out of scope

- E 域 28 处 / H8 半措施 / f1-client 直写通道迁移(交接文档「任务 A」,另开)。
- param-multi 循环 mid-loop 记忆、驳回后 24h 回放对账面(平台级,记档在 f-pending-store 文档)。
- 后端 version 字段实现(第 6 项只出前端侧规格)。
- `updateF*TeamConfig` 死代码清理(任务 A 附带项)。

## 环境事实(复跑须知)

- worktree 宿主目录已垫 junction:`admin-ops\.claude\worktrees\{PRD,Nexion-uniapp}` → 工作区真目录(相对路径型门脚本在 worktree 内解析 `ROOT/..` 所需;PLAN 级 worktrees 同款先例)。
- 本机无 `nexion-backend` 仓:verify 依赖它的齿轮如实跳过,属既有环境限制(memory: nexion-backend-not-in-workspace)。
- 管道会吞 verify 退出码:一律读 `.verify-exit.code`(WF-7/WF-10)。

## 验收留痕(每包完成后回填;未回填 = 未完成)

| 包 | 红测 | tester 报告 | 回源三问 |
|---|---|---|---|
| T5 | 32 变异按预期(含 R1–R10 回归钉) | [t5-test](2026-08-06-idem-hardening-t5-test.md) —— **首轮 3×P0 + 2×P1,已全修并回归** | ✅ 仍服务目标 / 偏差=实现错已修 / 计划成立 |
| T3 | 见上(T3①–⑤) | 待独立验收 | 待回填 |
| T4 | 见上(T4①–③) | 待独立验收 | 待回填 |
| T2 | 见下(R2 六条 + T2 六条) | [t1234-test](2026-08-06-idem-hardening-t1234-test.md) —— **2×P0 全修** | ✅ |
| T1 | 见下(T1 七条 + R2 三条) | 同上 —— P1 全修 | ✅ |

### 第二轮独立验收发现与处置(判 AC3 FAIL:2×P0 / 4×P1 / 6×P2)

**这轮抓到的是本包最核心的失误:T2 等于没做。** 全部回源复核属实,已修 + 已进红测常驻。

| 级 | 发现 | 根因 | 处置 |
|---|---|---|---|
| **P0-1** | 清扫压根没接在登出上 —— 只接了 `resetAdminSession`(撞 401 的自动重置),而真正的退出按钮走 `useAdminAuth.signOut()`,纯状态重置、不清存储也不 reload。A 退出 → B 登录 → 29 张命令号表原样留给 B | 我把「会话失效自动重置」当成了「登出」。**没有回源确认退出按钮到底走哪条路** | 清扫改接 `signOut`(退出按钮 / 会话失活 / 401 全汇于此)+ `signIn` 里**仅当操作员真的换人**才清。🔴 绝不能在 signIn 上无条件清:它每次页面加载与定时续期都会调用,无条件清会毁掉「命令号跨刷新存活」这个根本机制 |
| **P0-2** | 就算走到清扫,**T3 的内存兜底会当场把它复活**,且是同步必然序列不是竞态:`d-client` / `user360` 在同一个同步块里先清空存储、后 `forget()`,而 forget 走 readAll(内存有货)再整表写回 | T3 的 store 注释写着「内存镜像由随后的整页 reload 一并清掉」——**这个前提被本仓自己的调用点推翻了**(reload 在这段同步代码之后,退出按钮压根不 reload) | 引入清扫代次:清一次 +1,各实例读到代次变了就作废自己的内存镜像。代次在读存储之前推进,降级态(内存即唯一真源)同样生效 |
| P1-1 | TTL 硬上限只钉在写路径,把续期藏进读路径即可击穿而门全绿 | 契约只从 `remember` 一侧验 | 补「降级态下读多少次都不得延寿」;探针把读**穿插在等待里**(第一版先读完再等,证明不了任何事,红测当场抓到) |
| P1-2 | 归类门可绕过:参数不叫 `status` 的 helper、`!(500 > res.status)` 反转操作数,配一条永假的谓词死分支充数即可退化,tsc 也绿 | 判据认**变量名** | 改判**裸状态码阈值常量**:4xx/5xx 三位字面量与比较运算符同行即红(业务码 `code >= 400` 是仓内既有惯例,显式放行;5xx 一律不放行) |
| P1-3 | 「全仓单源」实际是两源:`stable-mutation.ts` 有一份逐字等价副本,局部常量还与共享函数同名,g1/g2/g3/g4/g7 五个域走的是它,且不在门的扫描面里 | 扫描面只筛 `-client.ts` | 该副本改为 import 共享谓词;扫描面从「自己读 response」扩到「或收 status 形参替别人判」——**红测 R2-P1-3 第一次跑就证明我这条扩面还漏了它** |
| P1-4 | j 域双缺口:401 走 signOut(已随 P0-1 一并覆盖);但 j 域本身没有 pending store,每次开弹窗现铸命令号 | j 域迁移属交接文档「任务 A」范围 | 清扫已覆盖;**把注释里「宁可保号重试」的表述改成如实说明**(P2-5 同条):j 域目前给的是正确的失败分类与话术,不是同号重试的保证 |
| P2-1 | `extra` 展开在公共字段**之前**,调用方元数据能覆盖 `commandKey` → 与行键不符 → 记录被判非法丢弃 = 命令号静默丢失 | 字段顺序无门钉 | 四个公共字段全部挪到 `extra` 之后 + 契约钉死顺序 + 敌对覆盖用例 |
| P2-3 | 反误删诱饵只有单行表,`every → some` 这种放宽抓不到 | 诱饵不够刁 | 补混合表诱饵(一行像命令号、一行是业务字段) |
| P2-4 | 门的扫描面漏掉 `d-client` / `i-client` | 靠「文件里有 Outcome*Error」筛 | 随 P1-3 扩面一并覆盖 |
| P2-6 | 三个同族契约测试没挂进 verify 齿轮表 | 遗漏 | 已挂(a2-outcome-uncertain / b23-outcome-unknown / i4-a2-pending-visibility) |
| P2-2 | 形状判据会误删「四字段恰好齐全」的业务缓存 | 形状判据的固有代价 | **接受并记档,不修**:修法(加标记位)会让升级前已存在的表在 24h 窗口内清不掉,而漏清正是本轮 P0 的病根;形状误判需要外来表每一行都恰好四字段齐全且 commandKey===行键,实测全仓 29 把真键 + 多种诱饵均无此形态 |

本轮红测又抓到我三处自身问题:① 新写的 TTL 探针没有判别力(读完再等);② 扩面后仍漏了 `stable-mutation`;③ 两条用例的失败关键词写错(断言消息 vs 测试名)。
| T6 | spec-lint 7/7 块 | (规格签字门代) | 待主人签字 |

### T5 独立验收发现与处置(2026-08-06,首轮判 AC1/AC2/AC3 FAIL)

验收方自造变异证伪,抓到的都是**真缺陷**,逐条已修 + 已进红测常驻:

| 级 | 发现 | 根因 | 处置 |
|---|---|---|---|
| P0 | 别名 import(`{ X as _unused }`)+ 同名本地桩 → 三门全绿 | 判据认「花括号里出现过这个名字」,与「调用点用的是哪个绑定」之间**没有连线** | 新增 `runtimeBindings()`:解析真绑定,`as` 改名 / `import type` / 内联 type 一律不算(红测 T5-R1/R3) |
| P0 | import 路径指向自造的 `probe-pending-mutation-store.ts` | 路径是**子串**判据 `[^"']*pending-mutation-store` | 改为按 `@/` 与相对路径**精确解析到目标文件**再比对(T5-R2) |
| P0 | 一个从不调用的悬空 executor 常量换整文件免检 | viaExecutor 命中即 `continue`,跳过含判据 3b 在内的后续全部判据 —— 与 3b「悬空 const 没人删」的立意自相矛盾 | 撤掉免检金牌,逐个 executor 常量核储存键 + 核调用点(T5-R4) |
| P1 | 判据 0b 自检有盲区:两条正则各自丢 `g` 标志时自检看不见 | 探针里每种注释**只有一处**,区分不了「全局替换」与「只替换第一处」 | 每种注释放两处、且名字互不为子串(T5-R8/R9) |
| P1 | 误红:executor 调用折行带尾逗号 / storageKey 抽具名常量 | 单条正则要求「第二实参是字符串字面量且其后直接 `)`」 | 改为顶层逗号拆参 + 具名常量回查定义;空串常量仍红(T5-R5/R6/R7) |
| P2 | 剥注释器 `html` 分支零自检(摘掉后三门全绿) | 自检只覆盖非 html 路径 | 判据 0b 代管该分支(T5-R10) |
| P2 | 红测 ⑫⑬ 是空注入(`from === to`),零判别力 | `inject()` 只在锚点缺失时 throw | 加空注入守卫(from===to 直接炸)+ 换成真变异 |
| P2 | 红测只断言退出码,不断言「红在哪条判据上」 | `gateRed` 吞掉输出 | `gate()` 回传输出,用例可声明 `expectText` |
| P2 | 「还原完整性」只抓残留备份文件,抓不到内容没还原 | 被注入文件本就处在 ` M` 态 | 升级为逐文件 sha1 指纹前后比对 |
| P2 | 台账反解析对哨兵排版有隐含依赖,少一条会静默缩短 | `/^\s{2}"..."$/` 硬绑缩进;契约只有 `>= 28` 下限(实际 30,有 2 条余量) | 反解析改为只认台账段、段内不挑排版;**并新增判据 5**「用了共享 store 就必须在台账里」由哨兵直接咬(T5⑭) |

本轮红测自身也抓到我两个 bug(升级 harness 的直接回报):① T5⑭ 暴露契约下限有余量 → 催生判据 5;
② T5-R8「红了但理由不对」暴露自检探针名 `x` / `x2` 互为子串导致分支串味 → 改为 head/tail 命名。
