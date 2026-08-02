# I 域 H 非 Owner 对抗复审报告

Run ID：`pc-full-acceptance-20260729-114336`  
复审人：H 域智能体（未参与 I 域产品缺陷修复）  
范围：I1 转化文案 A/B、I2 Nova 推送运营、I3 通知 Campaign、I4 信任中心、I5 风险披露、I6 i18n 文案。

## 最终结论

I 域 H 非 Owner 对抗复审通过，复审评分 **99.3 / 100**，严格大于 98。

- Owner 初审：**99.2 / 100，通过**。
- H 非 Owner 复审：**99.3 / 100，通过**。
- 五轮共 `8/8` 个 Playwright 用例通过：权限 `4/4`、失败关闭 `1/1`、I1–I5 写生命周期 `1/1`、I6 双运营员 CAS `1/1`、I6 完整生命周期 `1/1`。
- 未关闭 P0/P1/P2/P3：`0/0/0/0`。
- 无硬性不通过项；I 域可以进入 A–M 最终候选串行终验。

本报告仅签发 I 域，不替代 13 域总报告及 75 模块最终候选终验。

## 锁定候选与门禁

H 非 Owner 复审运行于最终候选 final4：

| 项目 | 锁定值 |
|---|---|
| PC | `http://127.0.0.1:3002`，Build ID `1znYVcf5Jn3HxNvPctH1v`，PID `7040` |
| 后端 | `http://127.0.0.1:8110`，PID `21360` |
| 后端 JAR SHA-256 | `76D17B09663DBE435D92D0ED129CDABBDA7FE93F0B40F2090669739F01466DBB` |
| MFA 临时超级管理员绕过 | `false` |
| MySQL | `nexion_acceptance_20260729_114336` |
| I 域权限夹具 SHA-256 | `0A03F940902DC9C75D37C7E4AA73006CEFE4187DE574DE44BF08388CDA181E35` |

预检核对 PC Build/PID、后端 JAR/PID/启动时间、MFA bypass、数据库身份、权限夹具哈希和 Playwright 发现数。首次完整预检发现 `8` 个测试、`5` 个文件；I6 续跑预检只发现获准补跑的 `2` 个测试、`2` 个文件，没有扩大或重复已通过波次。

## 对抗复审结果

### 四角色五层权限

权限矩阵 `4/4` 通过。

- maker：I1–I6 菜单、路由、页面读取和真实 API 均可用。
- readonly、nowrite：页面可读，写按钮不可见，六模块真实写探针均被 403 拒绝。
- nomenu：六个菜单不可见，直链无法进入，读写 API 均为 403。
- 四角色刷新、退出和 fresh MFA 重登后权限边界不漂移。

### 失败关闭与恢复

失败关闭用例 `1/1` 通过，覆盖 I1–I6。

- 每个模块均验证 500、超时和畸形 200，失败时不展示伪造权威数据，也不保留危险写入口。
- 移除故障注入后真实读取恢复。
- 匿名读取为 401；已认证未知管理路由为 404。
- pageerror 为 0。

### I1–I5 真实写生命周期

生命周期用例 `1/1` 通过。

- I1：从可见入口新建位置、版本选项和发布文案，App 权威接口可回读，随后归档并清理。
- I2：通道完成 create→enable→disable→delete，模板完成 draft→published→archived→delete。
- I3：Campaign 完成 draft→send-now→sent，隔离 App 用户收到且可标记已读，实际投递数为 1。
- I4：创建并删除隔离草稿，公共 current 仍读取原发布版，线上 singleton 未改变。
- I5：创建隔离法域及七章披露草稿并删除，已发布法域矩阵未改变。
- 退出后使用 fresh MFA 重登，I5 可见入口和真实读取恢复。
- 本轮保留不可变审计 19 条；按合同无 outbox 事件，实测为 0。

### I6 双运营员 CAS 与结果未知防线

双运营员 CAS 用例 `1/1` 通过。

- 两个独立 MFA 会话以不同幂等键、相同 `expectedVersion` 并发提交。
- 返回严格为 `200` 和 `409 I18N_MESSAGE_VERSION_CONFLICT`。
- 最终仅赢家版本生效；message、version、idempotency 可变夹具均清理为 0。

### I6 完整生命周期

生命周期用例 `1/1` 通过。

- 从可见入口创建 v1；v2 同键回放稳定，同键异载荷 409，旧 expectedVersion 409。
- 完成发布 v2、发布 v3、App 权威语言包消费、归档 v3、回滚生成 v4、归档 v4。
- 数据核对为审计 8、outbox 5、待审票 0、对象锁 0。
- finally 后 I6 message、version、idempotency 可变夹具均为 0。

## 载具异常、修复与受控补跑

首次 I6 CAS 波次出现一次载具 RED：测试先启动 20 秒响应等待，再等待下一个 30 秒 TOTP 时间窗，导致响应等待在第二账号实际点击 MFA 提交前超时。失败发生在并发业务请求发出之前，不构成 I 域产品缺陷。

处理闭环：

1. 原始 RED 证据完整保存在 `i6-two-writer-cas-red-carrier`，没有覆盖或删除。
2. 增加 MFA 等待顺序合同测试，先得到 `0/2` RED，再在修复后得到 `2/2` GREEN。
3. 将 TOTP 生成移到 `waitForResponse` 之前；补强精确清理和幂等回收。
4. 清理异步晚到的唯一 I6 version 残留，随后对 I 域全部可变前缀做 SQL 哨兵核对。
5. 使用新的单次令牌仅补跑 I6 CAS 和 I6 生命周期；此前已经通过的权限、失败关闭、I1–I5 生命周期没有重复执行。

续跑结果为 I6 CAS `1/1`、I6 生命周期 `1/1`。stderr 仅有 MySQL CLI 的密码命令行安全提示，不是产品错误、浏览器 console error 或测试失败。

## 清理与审计边界

最终 SQL 哨兵均为 0：

- I6 message、version、idempotency；
- pending ticket、active object lock；
- I1 position、copy；
- I2 Nova；
- I3 campaign；
- I 域写操作幂等记录。

Redis 逻辑库 13 按五个 I 域专用 adminId 精确清除 10 个 session；清理后账号成员关系和 session key 均为 0，未执行 flush。不可变审计与应保留 outbox 按审计边界保留。

## 证据索引

原始证据根目录：  
`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\I\review-H-final3`

证据清单：`SHA256SUMS.json`，共 52 个文件。  
证据清单 SHA-256：`F586CCFCC24F4484CCBD5B15D805A5C32A256FF0A627814EAA5C4E4720CBD167`。

关键续跑约束：

- 首次完整预检 SHA-256：`EE43A1C3B648449107C1E2CE1D0A3E86FC1A0CF9C392F5B34F58803766328352`。
- 载具 RED 精确清理 SHA-256：`8670B36F9E94BAD25C7060AFB9143D3C9DF87099BF6F2EEC13FF1C039ED685AD`。
- I6-only 预检 SHA-256：`575AB2F509CAC529A3C6A07CCBE9005CF705BC1BEEF80307ED62720800B99243`。

未提交或推送 Git。
