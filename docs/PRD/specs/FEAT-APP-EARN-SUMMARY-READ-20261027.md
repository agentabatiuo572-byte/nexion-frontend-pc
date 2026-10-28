# Earn 汇总普通进入与失败展示（2026-10-27）

## 适用范围

仅 App 主 Earn 页收益汇总的 Today / Week / Month / All 数字，以及其共用 Home overview 只读请求协调。已知同账号、同绑定代次、同语言和服务环境的数据可以留在内存中显示；不新增持久缓存，不缓存资金或设备/任务命令。

## 普通进入与显式读取

- Earn 普通进入使用 ensureHomeTruth：同 owner 的未完成请求合并；成功完成后的 15 秒内复用现有汇总，15 秒到期后的下一次进入重新读取。
- 手动汇总重试、原有登录/启动、任务同步、钱包、Me、海报及 Home 显式重试仍走 refreshHomeTruth，不套用 15 秒。原有同时在途读取合并保留。
- 当前读取收到明确 HTTP 类型的 429，全部 overview 读取入口遵守该错误的 RetryAfterMs（包含 0）；已知HTTP status优先，只有status缺失才用明确http的code429回退。HTTP404/body429仍严格清且无冷却；HTTP503/body429仅保只读历史而无429冷却。未提供有效值时默认冷却 30 秒。冷却期间点击重试或普通进入不发新 overview 请求，不自动循环重试。到期后下一次真实读取成功才恢复 ready。

## 只读展示与实时资格

- 首次未知仍显示静态壳和 —；已确认的零保持 0.00 / 0 UVT / 已确认任务数。
- 当前明确 HTTP 429、ApiError network/timeout 或 HTTP 类型 status 500–599 时，Earn 的已知四个周期数字保留，同时保留真实失败说明及重试入口。homeTruthStatus 保持 error；不会用旧数字把状态恢复 ready。
- 401/403、认证、所有业务拒绝、协议/schema、配置错误、未识别错误类型和其它非暂时错误清除 overview；页面显示未知与失败重试。auth/business/protocol/configuration 类型即使携带 429 或 5xx 数字，也不能保留历史或生成限流冷却。network/timeout 类型仅用于暂留，不从其数字生成429冷却。旧数字不恢复设备运行、任务执行、分享生成或资金交易资格；现有这些入口的独立实时守卫不变。
- 账号及绑定代次变化清除历史与读取状态；语言变化同步清除并递增只读 owner 代次，包含 en→vi→en 的 ABA。旧成功、旧失败和旧429不能更新新 owner。语言变化保留当前账号已经收到的429 deadline，不能绕冷却。
- 环境/baseUrl 变化同步清除，旧 API client 停止读取直到重新初始化；丢失或不匹配的当前 session 清除历史，过期账号 request 不能触发当前账号请求。当前 owner 的正常新读可以恢复。

## 证据边界

原生实际观察到 Earn 原有数字回到未知并显示汇总刷新失败，随后自然恢复；当时 HTTP code 未取得，原因不能标为已证429。本轮 actual Earn SFC + real app store 已验证重复普通进入、429和明确暂时失败、严格拒绝、旧 owner 与恢复路径；仍需 root 在最终原生候选复验原操作路径。未修改服务端限流配置或其它 store 请求策略。
