# M 域非 Owner Final19 对抗复审（L）

## 结论

通过。复审严格评分 **99.3**（大于 98），初审 **99.1**；P0–P3 均为 0。复审者未修改产品源码、未提交或推送。

候选固定为 Final19：PC `127.0.0.1:3002`，Build ID `cIXso0KJblmHHCLNiokFZ`；后端 `127.0.0.1:8110`，JAR SHA-256 `8166F07EB1993579982938A3FC1AD73BC9BE7CD801B69404C7825355FA2057F6`。测试均为 `workers=1`、`trace=on` 串行执行。

## 复审范围与结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| M1–M5 可见侧栏、返回、刷新、退出重登 | 通过；三轮均为 M1、M2、M3、M4、M5 | `read-relogin/`、`pw-read-relogin/` |
| 五层权限：只读、无写、无菜单 | 3/3 通过；可读角色五页 GET 200，全部写接口 403，控件关闭；无菜单角色直链及读写均 403，刷新重登不漂移 | `pw-permission-readonly/`、`pw-permission-nowrite-r2/`、`pw-permission-nomenu/` |
| 技术 write 与业务门禁 | 通过；精确 M checker 对 M1/M5 写探针均返回 403，前后快照一致 | `business-gate/business-gate-result.json`、`pw-business-gate-r2/` |
| 失败关闭 | 通过；M1 500，M2 的 401/403/404/409/422，M3 的 500/超时/畸形 200，M4 畸形 200，M5 500 与读取结果未知均关闭写入口，恢复后重新得到权威数据 | `failclosed/`、`pw-failclosed/` |
| M3 SSE | 通过；匿名流 401；登录后 200、`text/event-stream`、首帧 8 bytes、5.9 ms；离开 M3 后重入，流响应重新建立 | `strict-sse-r2/strict-sse-navigation-result.json`、`strict-sse-r2/m3-sse-reconnected.png`、`pw-strict-sse-r2/` |
| 真实请求失败与导航取消 | 通过；pageerror 0、非预期 console error 0。受控复跑记录 61 条 `ERR_ABORTED`，全部按“发起阶段 + 方法 + 路径”的后续成功响应严格配对，未配对为 0 | `strict-sse-r2/strict-sse-navigation-result.json` |

## 身份与清理

为避免复用 Owner 的 MFA 时隙，复审使用隔离库的最小权限新鲜 MFA 身份：M checker、M read-only 与 M no-menu。其 MFA 首绑及权限范围均留存在受限证据目录；凭据未写入报告。

复审结束后，已精确清理/软删除账号 `99748`、`99996`、`99997` 以及本次 no-menu 角色 `4594`：活跃账号、活跃角色关系、活跃 MFA 绑定均为 0；Redis DB 13 的五个精确 RBAC/会话键已删除；本轮幂等记录为 0。清理浏览器载体因 superadmin MFA 页面与旧脚本假设不兼容未完成登录，但不影响已由数据库与 Redis 的精确复核结果。

## 证据根

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final19-nonowner-l`

历史首轮 SSE 证据中的无等待导航取消已标为载体限制，未用于签发；Final19 结论仅依据本报告列出的严格受控复跑。
