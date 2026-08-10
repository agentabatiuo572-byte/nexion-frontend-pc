# D7 法币提现参数服务端配置能力

状态：`PARAMETER_MANAGEMENT_PASS / CHANNEL_BLOCKED`

本文件取代 `2026-08-06-d7-payout-vnd-config.md` 中“浏览器本地假数据配置面”的现行实现结论；旧文件只保留为历史决策记录，不再作为运行时契约。

## CAPABILITY

- 运营可在 PC 管理端读取 D7 的服务端权威配置，调整卖出点差、提现报价时效、重报价容差、手续费和单笔限额。
- D6 继续唯一维护 VND/USDT 基准价和买入点差；D7 只读引用，不复制第二套可写值。
- 所有变更必须具备权限、稳定幂等键、版本 CAS、操作理由和必写审计；刷新或重新登录后仍读取同一服务端状态。
- 通道总开关属于独立高风险权限。真实出款供应商未就绪或就绪状态读取失败时，服务端拒绝开启；即使读取供应商状态异常，存量开启通道的关闭动作仍保留为止损路径。

## CONSTRAINTS

- 当前没有已验收的真实越南银行卡出款供应商适配器，禁止把“参数可配置”解释成“提现通道已可用”。
- `providerReady=false` 与 `providerStatusAvailable` 是服务端受控状态，不允许 PC 页面或普通配置接口修改；读取来源异常时必须显式标记不可用，不能把异常冒充正常的“未就绪”。
- 放大资金流出的配置变更和通道开启必须经过资金覆盖率可靠性/红线校验；收紧动作不得被覆盖率故障锁死。
- 价差倒挂默认拒绝，仅持有专门强制权限的管理员可带风险声明提交。
- 浏览器不得用 `localStorage`、硬编码回退值或前端成功提示替代服务端事实。

## IMPLEMENTATION CONTRACT

- `GET /api/admin/finance/payout-vnd/config`：返回 D6 单源字段、D7 聚合、版本、默认值、供应商就绪状态及其可用性、更新时间与来源。
- `PATCH /api/admin/finance/payout-vnd/config`：整包校验后以 CAS 原子更新 D7 聚合；缺字段、越界、交叉约束错误、旧版本、覆盖率不可靠均失败关闭。
- `PATCH /api/admin/finance/payout-vnd/channel`：仅处理通道启停；开启还要求 `providerReady=true` 和资金覆盖率健康，关闭不受该门阻断。
- 权限：`finance_d7_read`、`finance_d7_manage`、`finance_d7_channel_toggle`、`finance_d7_force_inverted`。
- 配置单元：`finance.payout_vnd.values`、`finance.payout_vnd.version`、`finance.payout_vnd.provider_ready`；首发供应商状态固定为未就绪、通道固定关闭。迁移只补缺失项，不复活被软删除的配置、菜单、权限或角色授权。

## NON-GOALS

- 本轮不实现用户侧银行卡提现订单、出款回调、账本冻结/付款/退回和供应商对账。
- 本轮不选择、模拟或伪造出款供应商，不生成假订单，不开放真实资金出口。
- 本轮不修改 D6 的基准价/买入点差写入口，也不恢复已删除的本地假配置仓库。

## OPEN QUESTIONS

- 真实供应商、签名协议、回调鉴权、幂等字段和失败重试 SLA 尚未确定。
- 产品规格提到“日限”，但当前 D7 数据字典没有日限字段；未获得正式字段与口径前不擅自实现。

## HANDOFF

管理配置能力完成后，D7 页面状态从“整个页面 HOLD”调整为“参数管理可用、通道启用 HOLD”。只有真实供应商、订单状态机、账本和回调全链验收通过后，才允许把 `providerReady` 迁移为真并开放通道。
