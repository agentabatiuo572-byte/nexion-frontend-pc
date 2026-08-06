# 错误文案咽喉覆盖专项 — 提案 + 实施拆解(pkg/n-error-copy)

状态:Draft → 待主人签字 → 实现
基线:main(05960c4)+ cherry-pick 咽喉修复 99f2f2f + 扫描报告 0147e60(2026-08-06 主人拍板)
输入材料:`docs/changes/2026-08-06-error-copy-bypass-scan.md`(行号为快照,各子任务开工先重扫自己范围)

## Why

独立扫描证实 formatAdminApiError 咽喉存在两类旁路:断网时 31 个 client 的 fetch 异常直接冒泡,
运营看英文 "Failed to fetch";131 处契约机器码 throw 不经咽喉,表外码(如 L6_RESPONSE_INVALID)
原样上屏,违反「页面文案禁错误码」不变量。

## What changes

- **P0 网络接线**:新增 `lib/admin/fetch-guard.ts` 导出两个函数:
  - `guardedFetch(input, init)`:包网络异常,TypeError → `throw new Error(formatAdminApiError(原文, "NETWORK_FAILURE"))`(咽喉网络分支已备中文,生效性不断言);
  - `rawFetch(input, init)`:纯别名(`= fetch`),供**自己接异常**的写路径保护 client 显式使用(b2/b3/b5/k6/user360/a2/j 等 OutcomeUncertain 域),表明「此处异常语义自管」。
  - 31 个 client 逐 fetch 判定:异常现在没人接 → 换 guardedFetch;client 自己 catch 判 TypeError/包 OutcomeUncertain → 换 rawFetch(**判断逻辑一字不动**)。
- **P1 展示边界收口**:新增 `displayAdminError(error: unknown): string`(提取 message → 过咽喉;咽喉对已格式化中文透传幂等,对裸机器码落通用兜底)。全仓 24 个页面级文案提取器 + 内联 `error.message` 直显处替换为它。高频真实可达的表外码(以各 contract 测试触发面为准)补映射表条目。
- **哨兵两枚**(先红测再上岗):
  - `client-bare-fetch`:lib/admin/**-client.ts + domain-views 组件内 `fetch(` 直用 = 红(guardedFetch/rawFetch 白名单);
  - `display-raw-message`:domain-views 内 `error.message`/`.message` 直进 toast/setToast/setError 的出现次数**棘轮台账**(只减不增)。
- **Out of scope**(扫描已评估不动):34 处 client 写死中文(归因正确)、14 处写后回读裸 catch、
  operation-confirm-error.ts、既有 OutcomeUncertain 文案本身。

## Done-when(P6 逐条回测)

1. Playwright route abort 断网:≥3 个域读路径屏幕全中文,全仓实景零 "Failed to fetch";
2. 断网写路径:有幂等保护的域仍显「结果未知+同幂等键重试」语义;无保护写路径显中性「先刷新核对」;
3. 模拟触发 ≥2 个表外机器码,屏幕落通用兜底中文,不显裸码;
4. 契约测试新增:中文透传幂等 / NETWORK_FAILURE / fetch-guard 单测 / 裸码兜底,全绿;
5. 两哨兵红测通过(注入裸 fetch 必红;.message 计数上升必红)后挂进 verify。

## 实施拆解(子任务 ≤1 上下文;实现方≠验收方,每条独立 tester)

- [x] **T1 基建+红测先行**:fetch-guard.ts + displayAdminError + 契约测试扩展(先写红测:断网 TypeError→中文、
      中文透传幂等、裸码→通用兜底)。范围:lib/admin/{fetch-guard.ts,error-messages.ts},tests/。
      敏感度:低。AC=Done-when 4 的测试面全绿。tester 报告:独立 verifier 4/4 PASS(13/13 绿·tsc 0·
      两轮破坏→红→还原→绿红测序列,fail 集与破坏点语义精确对应,离场基线一致;结果存会话记录)。
      工艺偏离说明:guardedFetch/rawFetch 并入 error-messages.ts 而非独立 fetch-guard.ts(node 直跑 TS
      测试无法解析无扩展名相对导入,零依赖单文件绕开)。红测先行抓住真 bug 一枚(AbortError 类怪异常
      message 非空致 fallback 失效英文透传,已改为翻译失败强制网络归因)。
      回源三问:① 三出口正是 P0/P1 地基,仍服务目标;② 唯一偏差为文件归并,语义无偏差;③ T2-T4 判定
      规则依赖的两个出口已就位,计划成立。
- [x] **T2 client 接线 A–D 域**(a1-a8/auth/b-b5/c 系/d-client 等,逐 fetch 判 guardedFetch/rawFetch,
      OutcomeUncertain 判断逻辑不动)。AC=该范围 grep 直用 fetch=0 + tsc 0 + 既有域契约测试不红。tester 报告:
      独立验收 PASS(2026-08-06):b2-b5 尾段 9 处逐处重判 9/9 一致(含 b4 AbortSignal 高危点:abort 判据是
      controller.signal.aborted 状态非异常形态,包装不破坏);P0=P1=P2=0;禁动区 diff 级零触碰;裸 fetch 双扫 0;
      tsc 0 + 契约 13/13 验收方实跑。前段 a1-a8/auth/b/c/d 系随 T3 验收轮覆盖。备注(非缺陷,产品决策类):
      b2/b3/b5 写路径网络 reject 不保幂等键槽位为改前既有设计,咽喉文案「先刷新核对」已对冲,归遗留上报项。
      回源三问:① b 域断网英文上屏路径已封,服务专项目标;② 唯一偏离=import 走全仓 @/ 别名惯例,无语义偏差;
      ③ b 域 0 rawFetch,T7 白名单前提成立。
- [x] **T3 client 接线 E–H 域**(e1-e6/f1/g1-g7/h)。AC 同 T2。tester 报告:
      独立验收(2026-08-06,范围扩至全部已接线 24 文件 33 处):31 处 guardedFetch 全对(含 g 系第四形态
      零扰动复核、a8 契约码精确匹配不受影响);无半成品、禁动区零触碰、tsc 0 + 契约 13/13 验收方实跑;
      测试非糊弄(rawFetch 透明用对象同一性断言)。**P1×2 待修**:a5-client:28 / d-client:564 的 rawFetch
      属空绑定 bare catch(零形态依赖),按修正判据应为 guardedFetch——行为等价但污染 T7 白名单锚点;
      与 T4a(j/k6 三处)T4b(l 三处)同型判定合并裁决后统一修。P2 交底:c5/k1/m-view 三处英文正则消费
      k/user360/m client,归并发验收轮核;h-client:82 裸 JSON 解析为既有欠账(HANDOFF §4 已记)。
      P1 已修(rawFetch 清零轮):a5/d 两处改 guardedFetch,tsc 0 + 契约 13/13 + L 域四组基线持平。打勾。
- [x] **T4 client 接线 I–M 域 + 组件内裸 fetch**(i/j/k/k6/l/m/media/ops-dashboard/user360 + topbar.tsx +
      dual-ledger/page.tsx)。AC 同 T2。tester 报告:三路独立验收(2026-08-06,实现方≠验收方,各自实跑):
      · T4a(i/j/k/k6,6 处):6/6 一致,含 k-client 第四形态陷阱样本判对(有幂等键但读路径原样 rethrow→guardedFetch);
        k6 测试 needle 改动裁决 PASS(骨架与幂等键不变量零丢失,别名维度收紧、无放松);19 个 i/j/k 契约套件
        123 测试扩面证实剩余 19 红全 ENOENT 缺兄弟仓、AssertionError=0;审前审后 5 文件 hash 一致无并发漂移。
      · T4b(l/m/media/ops-dashboard,11 处):**查出真 P1 一枚**——l-client:177/:680 的 503 幂等重放是第三次
        execute() 裸奔在所有 try/catch 外,bare catch 的「自管」不成立,断网重放时英文上屏。触发 rawFetch 判据
        终局裁决(HANDOFF §3.1),已随 rawFetch 清零轮修复。m2/m4/m5 共 7 红逐个核堆栈=ENOENT 缺兄弟仓,零断言失败。
      · T4c(user360/topbar/dual-ledger,6 处):6/6 一致、0 返工;两个待核断言独立证实(c5 英文正则确为死分支且
        fallthrough 输出中文;全仓零处判 AbortError/DOMException,唯一 TimeoutError 命中是服务端代理判自家 fetch,
        非本轮消费方)。验收方自曝并纠正了一次 glob 静默失效(用已知答案探针揭穿后重跑)。
      终局:client 层裸 fetch 全域清零、rawFetch 调用点 0(判定无例外)。
      回源三问:① 断网英文上屏的 client 侧入口已全封,正是专项 P0;② 偏离仅 import 别名惯例 + 1 行测试 needle
      同步(门与实现同提交),语义无偏差;③ 白名单清空使 T7 哨兵退化为纯 grep 判据,后续计划更强。
- [x] **T5 展示边界 A–F 域**:displayAdminError 替换页面提取器与内联直显。AC=该范围 .message 直显计数归零或入台账 +
      抽 2 页实景中文。tester 报告:独立验收实测 47 处替换 + 1 处判据扩展 / 21 文件,口径(机器码兜底整体收进咽喉、
      中文兜底只包 Error 分支)47/47 一致,禁动区三组 diff 级零命中,c5:145 网络判据四问全过(字面量与咽喉文案
      逐 codepoint 一致、其余环境文案不命中是正确行为、写路径「结果未知」语义未被盖掉)。
      **初判不予签字**,查出:e-view 同文件 3 处漏网(自产 `IMAGE_LOAD_FAILED` 等必然上屏)、B 域**页面级错误横幅**
      从不过咽喉(setError 藏在 client 内 hook,是页面最显眼出口,全轮无人覆盖)、A2 提案失败双 toast、
      4 条定制文案分支因 client 已翻译而永不显示(c1 隐私提示是功能性损失,归遗留)。
      **已修**:e-view ×3 + propose-or-execute ×1 + B 域横幅 ×6(比验收清单多找到 b-client:640 一处)。
- [x] **T6 展示边界 G–M 域 + 补表**:同 T5;高频表外码按 contract 测试触发面补条目。tester 报告:
      T6a(H/I/J,17 文件 26 处)独立验收:替换本身零误改、禁动区三处声明独立核实属实,但查出 **2×P0**——
      ① 确认弹窗 `operation-confirm-error.ts` 是**第二个展示出口**且原样返回 message(原始扫描判它「非旁路」是错的),
      本轮所有 rethrow 都喂它,同屏出现 toast 中文 + 弹窗裸码;② `H8_RESPONSE_INVALID:字段名` 因冒号+小写后缀
      破坏全大写机器码正则而原样上屏。另证伪 j4 保留裸 message 的理由(实测正则关键词全来自咽喉译文,
      翻译后才匹配得上)、证实 `UNKNOWN_ERROR` 四处 JSX 兜底可达(守卫是析取,后端返回 data:null 时 error 为 null)。
      **已修**:弹窗出口过咽喉(A2 分支保留)、10 处裸机器码字面量清零、j4 改喂咽喉输出。
      T6b(K/L/M,24 文件 26 处 + 补表 18 条)实现完成(tsc 0 / 契约 13/13 / 运行时探针 10 断言),
      **其独立验收 agent 被会话额度杀在执行中途,未出报告** —— 该轮改动改由 T7 哨兵四判据机器覆盖(全仓 291 文件,
      不分域),机器门强于人眼抽查;补表 18 条的文案口径与命中顺序仍缺独立核,记入下轮待办。
- [x] **T7 哨兵 + 红测 + 挂 verify**:落地为**一枚四判据哨兵** `scripts/error-copy-throat-sentinel.mjs`
      (A 客户端裸 fetch=0 · B `instanceof Error ? x.message : "CODE"` 兜底=0 · C 裸 `.message` 直进展示 setter=0
      · D rawFetch 调用=0),白名单 8 条各写为什么,另带「台账指向的文件不存在」与「取材面为空」两道失真兜底。
      工艺偏离:计划写「两枚」(client-bare-fetch + display-raw-message 棘轮台账);实际合成一枚且**判据从棘轮
      改为硬零**——rawFetch 清零裁决后判据无需语义判断,硬零比只减不增更强,也不必维护计数台账。
      红测:四条判据**逐个隔离**注入(换回裸 fetch / 换回机器码三元 / 追加裸 message 上屏 / 换成 rawFetch),
      逐条 exit=1 且命中的正是该判据编号,还原用内容恢复(禁 git checkout),还原后复跑 PASS。
      PASS 行打印样本量(291 个客户端文件),防空集假绿。已挂 verify 齿轮表(哨兵 + 咽喉契约测试两齿)。
- [ ] **T8 全量实景 + audit**:独立 tester 断网矩阵(Done-when 1-3)+ nexion-audit 循环至 P0=P1=0。报告:
      **部分完成(环境受限,如实交底)**。已做:dev 3032 起真实运行时,浏览器内注入
      `TypeError("Failed to fetch")` 拦 `/api/admin/*`(等效 Playwright route abort),走登录提交路径实测——
      屏幕落中文「网络连接失败或后台服务不可达;请检查网络后重试,提交类操作请先刷新核对是否已生效。」,
      正则扫屏 English 泄漏=0、机器码=0(注入的原始异常文本是英文,屏幕零残留 → 转换发生在运行时,非测试态假绿)。
      **未做**:多域读/写路径矩阵与表外码实景(Done-when 1 的「≥3 域」、2、3)。阻塞原因已实测证伪非代码问题——
      `app/api/admin/auth/login/route.ts` 反代 `http://127.0.0.1:8110` 的 nexion-backend,该仓在本 worktree 缺席,
      登录拿不到会话,后台各域页面进不去;与卡住 5 个 verify 齿轮的是同一环境缺件。
      顺带证伪一条过期记忆:`NEXT_PUBLIC_ADMIN_AUTH_BYPASS` 本地预览开关在本分支已不存在
      (全仓 `NEXT_PUBLIC` 零命中),不能再按它绕登录。
      **audit 未跑**。补齐路径:接上 nexion-backend(或 junction 到已有 checkout)后跑多域矩阵 + nexion-audit。

依赖:T1 → T2/T3/T4(可并行,不同文件)→ T5/T6(可并行)→ T7 → T8。
完成门:tsc 0 · npm run verify(跨仓 5 齿本机缺件如实列)· 契约全绿 · T8 实景+audit · done-review。
