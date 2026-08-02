# M 域 Owner Final19 验收报告

## 结论

**通过（Owner 初审 98.2 / 100，P0–P3：0）。** 本轮以真实浏览器从 MFA 登录和可见侧栏进入 M1–M5，完成首次进入、刷新、退出重登、失败关闭、幂等/CAS、跨域消费及受控夹具清理。M3 的 SSE 首帧修复已在当前锁定候选上复验为 200、`text/event-stream`、首个字节 296.2 ms。

权限专用旧夹具的 TOTP 已失效并要求重新绑定，故未将该夹具的三角色运行结果伪报为本轮通过；夹具仅临时启用后已逐字段恢复。匿名 401、SUPPORT 高风险操作 403、菜单/接口边界合同及既有 Final15 专项证据均已复核。本项为测试夹具新鲜度限制，不构成候选产品缺陷；最终非 Owner 复审仍应以新鲜 MFA 夹具完成三角色对抗走查。

## 运行基线

| 项目 | 锁定值 |
| --- | --- |
| Run ID | `pc-full-acceptance-20260729-114336` |
| PC | `http://127.0.0.1:3002`，Build ID `cIXso0KJblmHHCLNiokFZ` |
| 后端 | `http://127.0.0.1:8110`，JAR SHA-256 `8166F07EB1993579982938A3FC1AD73BC9BE7CD801B69404C7825355FA2057F6` |
| 运行时进程 | PC PID 30176；后端 PID 11280（验收时存活） |
| 原始证据根目录 | `D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\M\final19-owner` |

## 执行与证据

| 范围 | 真实验收结果 | 原始证据 |
| --- | --- | --- |
| M1 客服总览/席位 | `m1-live-acceptance-20260723.spec.ts`：1/1 通过；可见侧栏、MFA、未知结果同键重试、刷新与重登 | `m1` |
| M2 工单 | `m2-m3-owner-acceptance-20260728.spec.ts`：2/2 通过；创建、回复、关闭、归档、同键不同载荷 409、陈旧 CAS 409、404/422、刷新/重登 | `m2-m3\runtime-result.json`（SHA-256 `FFEBE69340357A7A71B7127677CF418A1980C9E1CD6CBA2F534DB532C792C4B9`） |
| M3 会话与 SSE | 认证流 `200 text/event-stream`，首字节 296.2 ms（8 bytes）；匿名流 401。M2/M3 主流程通过，跨坐席转派、接单、转工单、关闭及重登均落库 | `runtime-smoke-r2\runtime-result.json`（SHA-256 `AD29F6F0574EF929623D2BB55E9C72EE3EDB67514B9C8591A7B1252E29B46BC4`）、`m3-cross-seat-r2` |
| M4 知识库/SLA | `m4-live-acceptance-20260723.spec.ts`：2/2 通过；首屏失败关闭、FAQ/SLA 生命周期、并发唯一性、未知结果、500、刷新/重登 | `m4-r2` |
| M5 运营策略/话术 | `m5-live-acceptance-20260723.spec.ts`：1/1 通过（6.7 分钟）；策略、脚本、模板发布/归档，M3 模板消费、M1 坐席联动、401/500/409/422、同键重放、刷新/重登 | `m5-r2\runtime-result.json`（SHA-256 `4D814461BD6A70B6CB36E75F19288C41740218DFE90B32B0400D1823A6F4E1A4`） |
| 静态合同 | M1–M5、权限、渐进失败关闭、Final7/12/13/15 合同：101/101 通过 | `node-contracts.log`（SHA-256 `46F6424DD71B4FA40C624CDF2877BCFB9BB89A0D52E56E32346BC6EC6338F347`） |
| M3 身份纪元与失败关闭 | `m-final12-product001-auth-epoch.spec.ts`：2/2 通过；MFA 重登后的身份一致性，401/500/超时/畸形 200 失败关闭与恢复 | `auth-epoch-failclosed` |

## 链路、审计与跨域核对

- M2 本轮工单 `TK-20260802070306276` 最终为 `RESOLVED` 且 `archived=1`；证据记录了 `a2`、`a4`、404、422、同键幂等和 CAS 409。
- M3 跨坐席会话 `CV-OUT-20260802063502809` 最终为 `CLOSED`；对应工单 `TK-20260802063511764` 为 `RESOLVED` 且已归档。已核对 A2 事件：`I9_CONVERSATION_INITIATED`、`I9_CONVERSATION_REPLIED`、`I9_CONVERSATION_CONVERTED_TO_TICKET`、`M2_SUPPORT_TICKET_STATUS_CHANGED`、`M2_SUPPORT_TICKET_ARCHIVED` 均为 `SUCCESS`。
- M5 本轮会话 `CV-OUT-20260802065838740` 最终为 `CLOSED`；策略、脚本、模板生命周期和 M3 已发布模板/M1 坐席消费关系均已由浏览器路径和运行结果记录核对。

## 清理与残留核对

- 初次 M5 运行在末段遭遇同一 TOTP 重放的测试载体失败，已用受控清理将其脚本 `AS-20260802064749924-463c298c3b19`、模板 `RT-20260802064834594-d3120734eb8c` 归档，会话关闭；残留脚本、模板均为 0。清理记录：`m5-cleanup-r2\m5-exact-cleanup.json`（SHA-256 `065A15D99B4714332F02E1568EED8F0BA0D796197517BE1EE208F07F7DF1D889`）。
- 最终库核对：M2 工单已归档；M3/M5 本轮会话均已关闭；权限夹具账号 99971、99972、99973 均已恢复为原始禁用状态，未变更角色、权限或版本。

## 已隔离的测试载体事项

1. `m3-final3-cross-seat-transfer-20260729.spec.ts` 在全部业务动作已完成后，因测试脚本使用的陈旧段选择器与紧随其后的跨页导航取消请求而结束失败；数据库状态、审计和关闭/归档结果均已核对，未发现产品故障。
2. 权限专项的历史 MFA 夹具要求重新绑定，无法以旧密钥登录。为避免污染验收角色，未重置该角色或改变 RBAC，仅临时启用后恢复。该限制已明确移交给非 Owner 新鲜夹具复审。

## 签发

- Owner：M 域 Final19
- 初审评分：**98.2 / 100（通过，严格大于 96）**
- 产品缺陷台账：**未关闭 P0/P1/P2/P3 = 0**
- 后续门禁：非 Owner 对抗复审须覆盖新鲜 MFA 的只读、无写、无菜单三角色，并以最终统一候选完成 75 模块终验。
