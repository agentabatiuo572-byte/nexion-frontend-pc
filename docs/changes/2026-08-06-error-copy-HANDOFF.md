# 交接文档 · 错误文案咽喉覆盖专项(2026-08-06)

> 本文件是**唯一续做入口**。
> 权威计划:`docs/changes/2026-08-06-error-copy-coverage.plan.md`(主人已签字,不必重新征求)。
> 输入材料:`docs/changes/2026-08-06-error-copy-bypass-scan.md`(旁路扫描全清单,行号为快照)。

## 🔵 第二轮进度(2026-08-06 下午,续做后)

**T1–T7 全部完成并提交**:`0900806`(client 层接线)+ `9cd6299`(展示边界 + 咽喉加固 + 哨兵)。
机器门:tsc 0 · 咽喉契约 15/15(13→15,新增两条先红后绿)· 哨兵 PASS(291 文件取材)。

**剩 T8**:实景断网矩阵(Done-when 1–3)+ nexion-audit 至 P0=P1=0。
T8 已做掉登录面的真断网实测(dev 3032 + 浏览器内注入 `TypeError("Failed to fetch")`):
屏幕落中文咽喉文案,English 泄漏=0、机器码=0。**多域矩阵与 audit 未做**——
登录接口反代 `127.0.0.1:8110` 的 nexion-backend,该仓在本环境缺席,进不去后台各域页面
(与卡住 5 个 verify 齿轮同一环境缺件)。⚠️ 记忆里的 `NEXT_PUBLIC_ADMIN_AUTH_BYPASS`
本地预览开关**在本分支已不存在**(全仓 `NEXT_PUBLIC` 零命中),别再按它绕登录。
补齐路径:接上 nexion-backend 后跑多域矩阵 + nexion-audit。
本 worktree 的 dev 配置已加进根 `.claude/launch.json`(名 `pkg-error-copy`,端口 3032)。

**接手第一步**:跑 `node scripts/error-copy-throat-sentinel.mjs`(应 PASS/291)+
`npm run test:error-messages-contract`(应 15/15);不一致说明有人动过。

### 本轮的关键认知(比代码更重要)

1. **展示出口是开放集合,人肉圈范围必漏**。原始扫描圈了「client + domain-views」,四轮后仍连续查出
   范围外出口:确认弹窗 `operation-confirm-error.ts`(原判「非旁路」是错的)、B 域藏在 client 内 hook 里的
   页面级错误横幅(页面最显眼那块)、后台首页 `app/_console/page.tsx`、通知铃、用户详情页。
   **结论:这类覆盖任务必须先焊机器门再收存量,而不是收完存量再补门。**
2. **咽喉用枚举特征拦截必漏**。实测漏过三族:`H8_RESPONSE_INVALID:字段名`(冒号+小写后缀破坏全大写
   机器码正则)、`response.json()` 撞网关 HTML 页的英文 SyntaxError、英文 DOMException。
   已改为构造性判据:**展示边界输出不含中文 → 落中性兜底**。同理 5xx 环境归因不再认单一命名前缀。
3. **验收独立性反复兑现价值**:三个真 P0/P1 全部由独立验收 agent 查出,实现方(含两轮 agent)自查全绿。
   其中 `l-client` 503 重放裸奔那条,是第三个 agent 逐行读才发现的。

### 遗留待办(下轮)

- **T6b(K/L/M 展示面 + 补表 18 条)的独立验收未完成**——其 agent 被会话额度杀在中途。该范围现由哨兵
  四判据机器覆盖(全仓不分域),但**补表 18 条的文案口径、与既有条目的 includes 命中顺序**仍缺独立核。
- `tests/m3-acceptance-contract.test.mjs:123` 断言「英文网络正则必须存在于 m-view 源码」——该正则已按
  原压制意图改判中文,此断言在守已删的死代码,需同步为中文判据(属门与实现同提交,未做)。
- P2-3 一族:c1 的隐私提示 `C1_RAW_PHONE_SEARCH_FORBIDDEN`、d5 的 `CONFIG_VERSION_CONFLICT`/`REASON_REQUIRED`
  定制文案分支,因 client 已翻译成中文而**永不命中**(c1 那条是功能性损失:该显示的隐私提示显示不出来)。
  修法:补映射表条目 + 删死分支,或把判据改判中文。
- `lib/admin/h-client.ts:39/57` 抛的 `H1 后端数据缺少字段:${field}` 含工程名词与字段名,违反
  「页面文案禁工程名词/字段名」——中文所以躲过咽喉的构造性兜底。
- A2 提案失败会弹两条 toast(`propose-or-execute.ts` 一条 + `e-view` 一条),消重涉及业务流程。

## 0. 落脚点

- 仓:`D:\WORKS\PLAN\.claude\worktrees\pkg-error-copy`(worktree,分支 `pkg/n-error-copy`,基线 main 05960c4)
- 依赖已装(node_modules 就绪);dev 端口用 3012 或 3022,**勿占 3002**(另一 checkout 在用)
- 主线只收合并,一切改动留在本分支

## 🔴 1. 接手第一步:完整性核查(不许跳过)

4 路 agent 是**执行中途被杀**的,最后一笔提交 `1444a74` 是终止瞬间快照。
它 tsc 0 + 契约测试 13/13 绿(可编译可运行),但**没有任何独立 tester 验收过**,
且可能存在「改了一半的文件」——某文件前 3 处 fetch 换了、后 2 处没换,而这**不会报错**。

必跑三条,拿到数字再决定续做范围:

```bash
npx tsc --noEmit
npm run test:error-messages-contract
for f in lib/admin/*-client.ts app/components/shell/topbar.tsx app/_console/overview/dual-ledger/page.tsx; do n=$(grep -cE "(^|[^a-zA-Z])fetch\(" "$f"); [ "$n" != "0" ] && echo "$f: $n"; done
```

第三条 = 尚未接线的裸 fetch 台账。**交接时刻的基线数字**(新会话应先复现它,不一致说明有人动过):

```
b2-client 2 · b3-client 3 · b4-client 3 · b5-client 1 · i-client 1 · j-client 2 · k-client 1
k6-client 2 · l-client 5 · m-client 1 · media-client 1 · ops-dashboard-client 4
user360-client 4 · topbar.tsx 1 · dual-ledger/page.tsx 1
```

## 2. 进度真相表

| 子任务 | 状态 | 已落地 | 剩余 |
|---|---|---|---|
| T1 基建 | ✅ 已验收(独立 verifier 红测 4/4) | 咽喉三出口 + 13 契约用例,提交 2dc5cc3 | — |
| T2 A–B client | ⚠️ 部分 | a1–a8 / auth / b-client 已接 | **b2 / b3 / b4 / b5-client**(4 文件,9 处) |
| T3 C–H client | ✅ 自查绿(未经独立 tester) | 16 guardedFetch + 1 rawFetch(d-client) | 独立验收 |
| T4 I–M client + 组件 | ❌ 未开始 | — | i/j/k/k6/l/m/media/ops-dashboard/user360 + topbar + dual-ledger(共 23 处) |
| T5 A–F 展示面 | ⚠️ 部分 | a-tabs 6 文件 | b/c/d/e/f 域全部 |
| T6 G–M 展示面 | ⚠️ 部分 | **补表 8 条已完成** + g-tabs 6 文件 | h/i/j/k/l/m 域展示面 |
| T7 哨兵 | ⏸ 未开始 | — | 两枚哨兵 + 红测 + 挂 verify |
| T8 实景+audit | ⏸ 未开始 | — | 断网矩阵 + audit |

## 3. 判定规则(派 implementer 时原样转述)

咽喉 `lib/admin/error-messages.ts` 已导出三出口:
- `guardedFetch(input, init)` — 包网络异常,转运营中文(翻译失败强制网络归因)
- `rawFetch` — 透明别名,给**自管异常语义**的调用点,兼作哨兵白名单锚点
- `displayAdminError(error: unknown)` — 展示边界唯一通道(中文透传幂等/裸码落兜底/垃圾输入不 crash)

每处 fetch 逐一判定(先读所在函数全文):
1. reject 没人 catch(冒泡出 client)→ `guardedFetch`
2. 外层 catch **依赖原始异常形态**(instanceof TypeError / error.name / 英文 message 字符串判断 / 转 OutcomeUncertain)→ `rawFetch`,catch 逻辑与文案一字不动
3. catch 只 log/原样 rethrow 且无英文 message 判断 → `guardedFetch`
4. 其余 → 不改,上报

🔴 **T3 修正的规则漏洞(务必带上)**:规则 2 原文把「OutcomeUncertain 类」写成触发词,
但真判据是「**catch 是否依赖网络异常的原始形态**」。g1–g4/g7 经共享执行器 `stable-mutation.ts`,
有幂等键记账、看似该 rawFetch,但其 catch 只 instanceof 自家 `StableMutationFailure`
(仅由 `!response.ok` 抛出),从不判 TypeError/name/message,网络异常在那里原样 rethrow
——这正是英文上屏的漏点。故 g 系判 `guardedFetch`。**存在「有幂等键但不依赖异常形态」的第四形态,
按字面硬套会保留病灶。** T7 哨兵的 rawFetch 白名单要按「catch 里真有 instanceof TypeError /
name / message 判断」收紧。

🔴 禁动:`!response.ok` 分支、formatAdminApiError 调用、OutcomeUncertain 类及其文案、业务逻辑。
并发多 agent 时一律内容匹配 Edit,禁整文件 Write。

### 🔴 3.1 终局裁决(2026-08-06,四路独立验收后):rawFetch 白名单清空

**规则 2 收紧为唯一硬判据**:只有「catch 内真有 `instanceof TypeError` / `error.name` / 英文 message 字符串判断」才配 rawFetch。
经全仓核查,**当前无任何此类点**,故全部调用点判 guardedFetch,rawFetch 调用数 = 0
(导出与契约用例保留,作哨兵锚点与未来出口)。

推翻的中间立场:曾有两轮 agent 主张「bare catch 全量吞异常并自转中文 = 自管语义 → rawFetch」(援引 a5/d-client 先例)。
**证伪它的实锤**:`l-client.ts:177` 与 `:680` 的 503 幂等重放是第三次 `execute()`,**裸奔在所有 try/catch 之外**——
bare catch 看着全包,实际漏了重放路径,断网重放时英文原样上屏。人肉判「全量自管」在两轮 agent 手里都没看出这条缝。

裁决依据(三条,后续批次沿用):
1. **失败模式不对称**:guardedFetch 错用 = 翻译被吞的无害死功;rawFetch 错用 = 英文上屏(真缺陷)。不对称时取安全侧。
2. **哨兵可机器化**:白名单为空 → T7 哨兵判据退化成纯 grep 的「裸 fetch=0 且 rawFetch=0」,无语义判断、无例外腐化。有例外的白名单必然随时间被塞进新条目。
3. 一条规则通吃 g 系(标记类 catch)与 bare catch 系,消除「自管判得越彻底越该 raw」的倒挂。

## 4. 遗留上报项

**4.1 body 读取阶段仍在咽喉之外(一族,四路验收独立发现同一根因)**
guardedFetch 按定义只包 fetch promise 的 reject。**响应体读取**若中途断连,照样抛英文 TypeError:
`await res.text()`(l-client:178/193/681、m-client:479、i-client:49、j-client:82)、
`await res.blob()`(l-client:463/713、user360-client:995/1335)、
`await response.json()`(dual-ledger/page.tsx:80)。
改前改后行为相同,非本轮引入。**现有缓解**:凡走 displayAdminError 的展示面,英文网络短语被
error-messages.ts:575 正则兜转中文——故 T5/T6 展示面收口后大部分路径已闭合;未走展示边界的
(如 client 内部再包装)仍留缝。是否把 body 读取一并纳入咽喉,归后续批次。

**4.2 `lib/admin/h-client.ts:82`**(T3 提出)
`(await response.json()) as ApiResult<T>` 是范围内唯一没有 `.catch(() => null)` 兜底的 JSON 解析:
2xx 但响应体非 JSON(网关 HTML 错误页)会抛英文 SyntaxError 上屏。补 catch 会改动
`!response.ok || result.code!==0` 的判定输入,属禁动区边缘,故未动。建议归后续批次统一对齐兄弟文件写法。

**4.3 b2/b3/b5 写路径网络失败不保幂等键槽位**(T2 验收提出,改前既有设计)
网络层 reject 时 catch 因异常非 OutcomeUnknown 标记类而遗忘幂等键——而网络失败的 POST 实际可能已达服务端。
咽喉网络文案含「提交类操作请先刷新核对是否已生效」对冲。是否把网络 reject 纳入保键重放属产品决策。

**4.4 英文网络正则死分支一族(本轮 T5/T6 已派修)**
`c5-security.tsx:142`、`m-view.tsx:209`、`k1-multiaccount.tsx:58` 三处页面级格式化器用
`/failed to fetch|networkerror/i` 压制网络细节。client 层接咽喉后英文永不再到达,正则成死分支
(fallthrough 输出中文,不破不漏,但原压制意图失效)。修法:判据改为咽喉中文文案,输出文案不动。

## 5. 完成门(未变)

tsc 0 · `npm run verify`(本机缺 nexion-backend,5/38 齿会跳过,如实列出勿称全绿)·
契约测试全绿 · 每子任务独立 tester 验收后才打勾 · T8 实景断网矩阵 + nexion-audit 至 P0=P1=0 ·
done-review 6 维 + 大白话收尾。

## 6. Done-when(P6 逐条回测)

1. Playwright route abort 断网:≥3 域读路径屏幕全中文,全仓实景零 "Failed to fetch";
2. 断网写路径:有幂等保护的域仍显「结果未知+同幂等键重试」;无保护写路径显中性「先刷新核对」;
3. 模拟触发 ≥2 个表外机器码,屏幕落中文兜底不显裸码;
4. 契约测试(中文透传幂等/NETWORK_FAILURE/fetch-guard/裸码兜底)全绿;
5. 两哨兵红测通过后挂进 verify。
