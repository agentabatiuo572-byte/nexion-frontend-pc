# F 域 Owner Final13/Final14 等价验收报告

执行时间：2026-08-02  
候选锁：`candidate-rebuild-final13/FINAL13-RUNTIME-LOCK.json`  
PC / 后端：`http://127.0.0.1:3002` / `http://127.0.0.1:8110`  
真实交互：Playwright Chromium，`workers=1`，`trace=on`  
原始证据：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\F\final13-owner`

## 初审

结论：不通过（P1）。得分：94/100。

已通过的真实链路：

- 从登录与可见侧栏逐一进入 F1–F5，真实读取权威数据、空态、取消、跨域入口、刷新、退出重登均通过；匿名读写失败关闭。
- 五层权限：只读、可见但无写、Maker、无菜单四种夹具均通过菜单、路由、按钮、接口、数据与刷新重登检查。
- SHARED-003 已用修复后的最小权限四账号夹具复验：合规 A6 reviewer 能可见批准精确无差量 A6 工单；F1 checker 看不到且以 403 拒绝 A6/未知工单，只能可见并批准自身 F1 工单。无业务值漂移。
- F1 Maker/Checker 生命周期通过：对象锁、幂等、CAS、结果未知安全重试、DB/A2/A4/outbox/关联域检查与精确恢复均通过。
- F1–F5 的 500、超时、404、422、畸形 200 均失败关闭并恢复；8/8 通过。

阻断缺陷：F2、F3、F4 的可见页面提交经专属 `f25_checker` A2 批准后，A2 工单和 A4 审计最终一致性存在，但关联 outbox 始终为 0。F5 同轮 A4=1 且 outbox=1，说明不是查询或环境整体失效。

- F2/F3/F4 工单：`WO-260802031904483-100`、`WO-260802031907474-400`、`WO-260802031909464-500`、`WO-260802031911253-700`、`WO-260802031914099-500`、`WO-260802031916151-0`。
- 六张工单均为 `approved`；A4 计数依次为 `4/3/4/3/4/3`；outbox 均为 `0`。
- 同轮 F5 `F5-CFG-d4fadb42650746eeb3aa` 与 `F5-CFG-de7612ff354b41999a05`：A4=1、outbox=1。
- 初次 F25 脚本在批准后立即查询 A4 曾得到 0；有界复查后 A4 已落库，属异步投影等待不足，不改变 outbox 缺失的 P1 判断。

## 精确恢复

F25 失败后仍执行独立 finally：F2–F5 API/数据库快照恢复，F5 两条临时物理配置行已按精确主键删除，无待决工单，非目标配置指纹不变。见 `f25-rerun/f25-success-cleanup.json`。

## 复审

结论：不通过（P1）。得分：94/100。

墨菲复审确认该缺陷在“批准成功、页面值已更新、审计稍后可见”时仍会漏掉跨域事件投递；不能以成功提示或最终 A4 代替 outbox 闭环。修复要求：F2/F3/F4 A2 approved 的真实配置变更必须产生关联 outbox，再从登录入口完整重跑本报告范围。

## 证据索引

- `visible.log`、`visible/`：F1–F5 可见入口、刷新、重登、匿名失败关闭。
- `permissions.log`、`permissions/`：四类最小权限五层验证。
- `shared003.log`、`shared003/`：SHARED-003 运行时门禁。
- `f1.log`、`f1/`：F1 生命周期、DB/A2/A4/outbox、CAS、幂等与恢复。
- `faults.log`、`faults/`：异常矩阵。
- `f25-rerun.log`、`f25-rerun-trace/`、`f25-rerun/f25-success-cleanup.json`：F2–F5 生命周期、失败点与独立恢复。

