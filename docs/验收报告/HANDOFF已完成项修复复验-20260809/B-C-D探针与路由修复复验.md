# B/C/D 探针与路由修复复验

## 裁决

**PASS。** B/C/D 锁定范围开放 P0/P1/P2/P3 = 0。

## 问题—证据—修复

| 族 | 原问题 | 最终修复 | 复验证据 |
|---|---|---|---|
| B | 5 个探针可能验到外壳、无关/浅伪造 HTML 或陈旧页面栈后报绿 | 统一直渲 App；模块源码 marker 回取校验；Vue/Uni/page stack/runtime identity；预期 route 与实时 hash 双绑定；console/pageerror fail-closed | `test:probe-safety` 19/19；正常 5/5；空/无关/console/pageerror 对抗 25/25；empty-hash 五探针全部判红 |
| C | 截图、DOM sweep、鉴权在零覆盖、缺图或崩溃时仍可能退出 0 | 覆盖计数、目标集合、成对截图、probe crash 和逐值路由全部进入裁决 | 零图/缺图/零路由/崩溃负例全部失败关闭 |
| D | `..`、多层编码、同文档 hash 与陈旧页面栈造成越权或白屏 | 有限解码、dot-segment 折叠、hash 优先、750ms 自愈重试；无 canonical identity 时落 onboarding | auth runtime 15/15；默认/未登录、16/17 层、above-root、同文档连续三次均通过 |

## 旧 KYC 深链连续性

`#/pages/me/kyc` 仅作为退役迁移键，不构成 KYC 能力。冷启、刷新、浏览器返回、同文档连续三次均落到 `/pages/me/security?from=retired-flow`；安全页持久显示 `This flow has been retired.`。瞬时 toast 消失后说明仍存在，移除冷启或同文档 notice 的负例 2/2 判红。

## 最终门

- probe safety / static route：19/19。
- auth/route runtime：15/15。
- 五个直接 DOM 探针：5/5。
- 隔离总门：20 场景 + 5 直接探针。
- console error、pageerror：0。

范围不包含原生 App 真机路由栈和生产 Janus 链路；二者继续 HOLD。
