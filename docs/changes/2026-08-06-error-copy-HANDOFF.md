# 交接文档 · 错误文案咽喉覆盖专项(2026-08-06 账号切换)

> 上一会话额度耗尽,5 路 implementer 中 4 路被强制终止。本文件是**唯一续做入口**。
> 权威计划:`docs/changes/2026-08-06-error-copy-coverage.plan.md`(主人已签字,不必重新征求)。
> 输入材料:`docs/changes/2026-08-06-error-copy-bypass-scan.md`(旁路扫描全清单,行号为快照)。

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

## 4. 遗留上报项(T3 提出,尚未处理)

`lib/admin/h-client.ts:82` 的 `(await response.json()) as ApiResult<T>` 是范围内唯一没有
`.catch(() => null)` 兜底的 JSON 解析:2xx 但响应体非 JSON(网关 HTML 错误页)会抛英文
SyntaxError 上屏。补 catch 会改动 `!response.ok || result.code!==0` 的判定输入,属禁动区边缘,
故未动。建议归入后续批次统一对齐兄弟文件写法。

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
