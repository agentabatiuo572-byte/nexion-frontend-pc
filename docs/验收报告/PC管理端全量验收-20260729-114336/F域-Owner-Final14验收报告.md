# F 域 Owner Final14 验收报告

执行时间：2026-08-02  
候选锁：`candidate-rebuild-final14/FINAL14-RUNTIME-LOCK.json`  
PC / 后端：`http://127.0.0.1:3002` / `http://127.0.0.1:8110`  
锁定身份：PC Build ID `0OZ66wYtIYX6qJHhZUvQK`；后端 JAR SHA-256 `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`。  
真实交互：Playwright Chromium，`workers=1`、`trace=on`，均从登录和可见侧栏进入。  
原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final14-owner`

## 初审

结论：通过。得分：98/100。

- F1–F5 登录入口、权威读取、空态、确认取消、跨域入口、刷新、退出重登和匿名读写失败关闭：4/4 通过。
- 最小权限五层：readonly、nowrite、maker、nomenu 四组夹具覆盖菜单、路由、按钮、接口、数据及刷新重登：4/4 通过。
- SHARED-003：合规 A6 reviewer 可批准自身无差量工单；F checker 对跨域及未知工单均 403，只可处理自身 F 工单：1/1 通过。
- F1 真正 Maker/Checker 生命周期：自批拒绝、跨域拒绝、对象锁、幂等、CAS 单一终态、真实结果未知同键安全重试、A2/A4/outbox、关联域隔离与独立精确恢复：1/1 通过。
- F2/F3/F4/F5 500、超时/结果未知、404、422、畸形 200 均失败关闭并可恢复：8/8 通过。
- F2–F5 专属成功闭环与独立 finally：1/1 通过；F2/F3/F4/F5 API 和数据库快照精确恢复，F5 两条临时物理配置行精确删除、无待决工单、非目标配置指纹不变。

### F25 六张工单精确闭环

Final14 的 F2/F3/F4 每张批准工单均同时具备 A2 `approved`、A4 审计和一条且仅一条 outbox；event 为 `F_TEAM_UI_CONFIG_APPROVED`，aggregate type 为 `A2_OPERATION`，aggregate ID 与 operation ID 完全相等。

| 模块 | 阶段 | operationId | A4 审计条数 | outbox 条数 |
| --- | --- | --- | ---: | ---: |
| F2 | 临时 | `WO-260802041457098-700` | 4 | 1 |
| F2 | 恢复 | `WO-260802041459231-300` | 3 | 1 |
| F3 | 临时 | `WO-260802041501004-900` | 4 | 1 |
| F3 | 恢复 | `WO-260802041504972-0` | 3 | 1 |
| F4 | 临时 | `WO-260802041507406-400` | 4 | 1 |
| F4 | 恢复 | `WO-260802041509137-800` | 3 | 1 |

完整 operationId、object、状态、event type、aggregate type 和 aggregate ID 见 `f25-rerun/operationid-a2-a4-outbox-closure.json`；该载具已将 F2–F4 outbox 断言收紧为严格等于一，随后从可见入口完整重跑通过。

### 载具校正

首次 F1 重跑发现旧载具仍断言“所有 operation-linked outbox 必须为 0”，而 Final14 对批准的 F1 UI 配置操作也已合法投递 `F_TEAM_UI_CONFIG_APPROVED/A2_OPERATION` 事件。数据库逐 operationId 复核后，变更、恢复、CAS 批准三张工单各一条，结果未知后拒绝清理工单为零条；配置精确恢复且无待决工单。因此这是陈旧验收断言，不是产品缺陷。已将载具改为逐 operationId 严格校验并用新 nonce 重跑 F1 通过；未放宽任何产品断言。

## 复审

结论：通过。得分：99/100。

墨菲复审从“页面显示成功但事件丢失/重复”“结果未知后重复提交”“恢复操作自身遗漏事件”“权限会话刷新后越权”“CAS 双写”逐项复核。F25 六张 F2/F3/F4 工单均为一对一 operationId/aggregateId 关联，F1 的未知、对象锁、幂等与 CAS 均保持失败关闭或单一终态；独立 finally 已验证所有可变状态回到快照。因此 Final13 的 F2–F4 outbox P1 已在 Final14 闭环消除。

## 证据索引

- `f-contract.log`：8 项 F 域契约。
- `f-owner-visible.log`、`visible/`、`visible-trace/`：登录入口、可见导航、刷新、重登、匿名。
- `f-permissions.log`、`permissions-trace/`：四类夹具的五层权限。
- `f-shared003.log`、`shared003/`：SHARED-003 门禁。
- `f1-rerun2.log`、`f1-rerun2/`、`f1-rerun2-trace/`：F1 未知、对象锁、幂等、CAS、逐工单 outbox 和恢复。
- `f-faults.log`、`fault-trace/`：8 项故障/畸形响应失败关闭。
- `f25-rerun.log`、`f25-rerun/`、`f25-rerun-trace/`：F2–F5 成功生命周期和独立恢复。
- `f25-rerun/operationid-a2-a4-outbox-closure.json`：F2/F3/F4 六张 operationId 的 A2/A4/outbox 精确闭环。
