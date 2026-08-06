# 错误文案咽喉旁路扫描(2026-08-06)

> 独立扫描 agent 穷尽核查「后端错误 → 运营屏幕文案」全路径的结论存档。
> 产生背景:pkg/restore-mid-tiers 修复 503 归因文案时,验证 formatAdminApiError 是否唯一咽喉。
> 本文件是「错误文案咽喉覆盖专项」的输入材料;行号为本分支当日快照,专项启动时以重扫为准。

## 结论:咽喉不通用,存在三类旁路

### 1. 网络异常不进咽喉(专项 P0)

31 个 `lib/admin/*-client.ts` 中 48 处 fetch 无网络异常捕获(仅 12 处有 try)。断网/后端不可达时
fetch 抛 TypeError 直接冒泡到页面层 `error.message` 直显 → 运营看到英文 "Failed to fetch"。
仅 3 处页面自建了网络正则拦截:`c5-security.tsx:142`、`k1-multiaccount.tsx:76`、`m-view.tsx:209`。

⚠️ 写路径语义雷区:网络失败时请求**可能已到服务器**(响应丢失),不得统一转成「本次提交未生效」。
b2/b3/b5/k6/user360/a2/j 等 client 的 OutcomeUncertain 类(「结果未知,沿用同一幂等键重试」)是
既有正确处理,接线时必须保留该语义,只把「裸 TypeError 冒泡」的路径转成咽喉的网络中文文案
(咽喉已备:「网络连接失败或后台服务不可达;请检查网络后重试,提交类操作请先刷新核对是否已生效。」)。

英文泄露实证路径:`a2-client.ts:337`(读路径 rethrow)、`i-client.ts:44-50`(rethrow + 裸 JSON.parse)、
`k-client.ts:93-95`(读路径 rethrow)、`b-client.ts:526`(裸 fetch)、`topbar.tsx:38`、
`dual-ledger/page.tsx:85,91`(组件内裸 fetch 裸展示)。

### 2. 裸机器码可直接上屏(专项 P1)

131 处 `throw new Error("<机器码>")` 契约校验不经咽喉,页面层直接展示 `error.message`。
映射表**没有条目**的码会原样出现在运营屏幕(违反「页面文案禁错误码」不变量),已核实 0 命中的例子:
`L6_RESPONSE_INVALID`、`L2_RESPONSE_PROTOCOL_ERROR`、`B_DOMAIN_EMPTY_RESPONSE`、`M2_TICKET_PAGE_MALFORMED`、
`L1_DATA_PROTOCOL_INVALID`、`H7_VOUCHER_RESPONSE_INVALID`、`USER360_RESPONSE_INVALID`、`E1_SKU_PAGE_INVALID`。
密集文件:`m-client.ts`(21)、`ops-dashboard-client.ts`(15)、`b-client.ts`(11)、
`l1-kpi-contract.ts`(10)、`m-view.tsx`(9)、`f-view.tsx`(8)。
修法方向:这些码补进映射表,或让页面展示层过一遍咽喉(咽喉对未知机器码已有通用兜底)。

### 3. 写死中文与二次格式化(评估后不动)

- 34 处 client 写死中文(a5/a6/a7/d/j/k6/l/ops-dashboard/i-overview/g3/platform-contracts/b2/b3/b5/user360
  的域专属「结果未知/服务不可用」文案)——归因全部正确,是散落债非误导债,2026-08-06 决议不动。
- 14 处页面层裸 catch 写死文案(多为「写后回读失败」场景)+ 7 个页面级二次格式化器
  (c1/c4/c5/d5/k1/m-view/janus-c2-store)——归因正确,不动。
- `operation-confirm-error.ts` 透传非空 Error.message,非旁路。
- `.message || 写死兜底` 全仓仅 3 处,均不构成输入归因误导,不动。

## 已闭环部分(本包 c7168c7)

HTTP 非 2xx 路径(`!response.ok` → `formatAdminApiError`)已闭环:503/UNAVAILABLE(未生效)、
502/504(结果尚未确认)、其余 5xx(服务异常)、未知机器码(通用兜底)。
契约测试 `tests/error-messages-backend-unavailable.test.mjs` 守住该行为。
