# FEAT-DEV01 任务产能节奏

## 目标与边界

E3 只配置“设备可接任务产能随月龄变化”的节奏，不直接修改 E2 单任务价格，也不把“新机补贴”计入结算。服务端与用户端必须读取同一组 `nx_compute_e3_config` 权威值；历史 `degradeEarly/degradeMid/degradeLate/minEfficiency` 仅用于一次迁移，运行时禁止读取或写入。

## 权威配置

- 三段月变化：`capacityBand1DeltaPct`、`capacityBand2DeltaPct`、`capacityBand3DeltaPct`，范围 -100%～100%。
- 分界：`stageEarlyEnd < stageMidEnd < cycleMonths`，均为正整数；`cycleMonths` 只决定管理端图表视窗，不参与用户收益截断。
- 下限与展示：`capacityFloorPct` 为 0%～100%；`capacitySubsidyDays` 只控制前端标注，不进入收益公式。
- SKU 开关：`capacityApplyToPhone/CloudShare/PcGpu/S1/Pro/ProV2/RackP1/RackP2`。
- 任务锁定提示阈：`taskLockS1/Pro/Rack`，非负整数 USDT，仅供金额提示；不表示分钟、完成后冷却或执行并发数，不得写入派单等待时间。不得沿用旧实现的 10080 分钟上限限制金额。

月龄 `m` 的运行时产能从 100% 开始逐月复利：每月乘以 `1 + 当段 DeltaPct/100`，再与 `capacityFloorPct` 取较大值。段 1 为 `[1, stageEarlyEnd]`，段 2 为 `[stageEarlyEnd+1, stageMidEnd]`，段 3 从 `stageMidEnd+1` 起开区间持续到下限；即使 `m > cycleMonths` 也继续计算。前端不得另写加法曲线或在视窗末月封顶。

服务端按购买时间与 server 时钟计算 `capacitySubsidized`。补贴期内用户端只显示补贴标注，不显示产能百分比，但服务端结算仍连续使用上述曲线。用户端须持久化本次 canonical snapshot 中的 `capacitySchedule`，任务锁定提示读取 `taskLockS1/Pro/Rack`；缺键或无效值 fail-closed，不回退到 40/140/450 等硬编码。

## 管理操作闭环

`PATCH /api/admin/devices/e3/config` 必须携带 `Idempotency-Key`、理由和已登录管理员身份。服务端拒绝未知键、退役键、无变化提交、越界值和分段顺序错误；增加资金流出的变化在 B1 低于红线时拒绝。成功写入同一事务中的持久幂等记录、required 审计与 A4 `admin.tradein_config_changed` 事件。

## 验收准则

- 任一页面展示字段缺失时 E3 fail-closed，明确显示“E3 配置不完整”，不可用前端默认值伪装成功。
- 单字段和组合编辑均展示当前值，禁止原值提交；数值边界在前后端同时校验。
- 变更后重新读取 E3，曲线、补贴标注、任务锁定提示、SKU 参与状态和用户端节奏使用相同持久值；账号切换必须先清空上一用户 canonical cache，同一用户周期刷新失败才可保留最后一次成功快照。
- A2 可锁定和重放 E3 配置对象；A4、B1、L4 可追踪本次变化。
- 新任务的兼容字段 `task_lock_minutes` 固定为 0；完成旧任务时忽略该字段的历史错误分钟快照，并在完成审计中保留被忽略值，不改原报价、结果或已结算收益。
- 已存在的设备锁继续校验；仅可按设备、实例、原任务、原完成审计和精确旧锁值证明由本次金额误用产生的锁，进行有审计的定向恢复。来源不明、停用、退款、未知请求等限制不得随之解除。
- 自动执行按 60 秒周期轮询下一项，完成后的轮询间隙可暂时等待派单；该间隙与金额提示阈值无关，不能以持续显示运行中作为金额阈值修复的验收条件。

本次多设备真实并行、资金当前读及限定回滚恢复合同见 [taskLock金额阈值与并行执行 TEST](UVEL_taskLock金额阈值与并行执行_TEST_20261030.md)。

2026-10-30 TEST 验收：后端 `4da9634e` / Jenkins 411 已发布，9 台设备的严格 41 笔新任务和 3 组真实推理重叠均通过产物及唯一结算核验；六条可证明来源的错误锁已按审计精确恢复。E3 原金额 `taskLockS1=30`、`taskLockPro=150`、`taskLockRack=480` USDT 及完整配置读回未变，运行时仍读取这些服务端配置值。410 曾暴露 RR 钱包旧快照并产生两笔 UNKNOWN；411 修复当前读后，两笔仅按明确 SYSTEM 裁定与独立一次预算恢复，保留原 UNKNOWN 记录。详细证据和持续运行边界见上述专题。
