# FEAT-DEV01 任务产能节奏

## 目标与边界

E3 只配置“设备可接任务产能随月龄变化”的节奏，不直接修改 E2 单任务价格，也不把“新机补贴”计入结算。服务端与用户端必须读取同一组 `nx_compute_e3_config` 权威值；历史 `degradeEarly/degradeMid/degradeLate/minEfficiency` 仅用于一次迁移，运行时禁止读取或写入。

## 权威配置

- 三段月变化：`capacityBand1DeltaPct`、`capacityBand2DeltaPct`、`capacityBand3DeltaPct`，范围 -100%～100%。
- 分界：`stageEarlyEnd < stageMidEnd < cycleMonths`，均为正整数；`cycleMonths` 只决定管理端图表视窗，不参与用户收益截断。
- 下限与展示：`capacityFloorPct` 为 0%～100%；`capacitySubsidyDays` 只控制前端标注，不进入收益公式。
- SKU 开关：`capacityApplyToPhone/CloudShare/PcGpu/S1/Pro/ProV2/RackP1/RackP2`。
- 任务锁定提示阈：`taskLockS1/Pro/Rack`，非负整数 USDT。

月龄 `m` 的运行时产能从 100% 开始逐月复利：每月乘以 `1 + 当段 DeltaPct/100`，再与 `capacityFloorPct` 取较大值。段 1 为 `[1, stageEarlyEnd]`，段 2 为 `[stageEarlyEnd+1, stageMidEnd]`，段 3 从 `stageMidEnd+1` 起开区间持续到下限；即使 `m > cycleMonths` 也继续计算。前端不得另写加法曲线或在视窗末月封顶。

服务端按购买时间与 server 时钟计算 `capacitySubsidized`。补贴期内用户端只显示补贴标注，不显示产能百分比，但服务端结算仍连续使用上述曲线。用户端须持久化本次 canonical snapshot 中的 `capacitySchedule`，任务锁定提示读取 `taskLockS1/Pro/Rack`；缺键或无效值 fail-closed，不回退到 40/140/450 等硬编码。

## 管理操作闭环

`PATCH /api/admin/devices/e3/config` 必须携带 `Idempotency-Key`、理由和已登录管理员身份。服务端拒绝未知键、退役键、无变化提交、越界值和分段顺序错误；增加资金流出的变化在 B1 低于红线时拒绝。成功写入同一事务中的持久幂等记录、required 审计与 A4 `admin.tradein_config_changed` 事件。

## 验收准则

- 任一页面展示字段缺失时 E3 fail-closed，明确显示“E3 配置不完整”，不可用前端默认值伪装成功。
- 单字段和组合编辑均展示当前值，禁止原值提交；数值边界在前后端同时校验。
- 变更后重新读取 E3，曲线、补贴标注、任务锁定提示、SKU 参与状态和用户端节奏使用相同持久值；账号切换必须先清空上一用户 canonical cache，同一用户周期刷新失败才可保留最后一次成功快照。
- A2 可锁定和重放 E3 配置对象；A4、B1、L4 可追踪本次变化。
