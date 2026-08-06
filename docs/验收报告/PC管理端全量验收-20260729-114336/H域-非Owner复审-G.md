# H 域非 Owner 对抗复审报告（G）

执行日期：2026-07-30  
Run ID：`pc-full-acceptance-20260729-114336`  
复审波次：`pc-full-acceptance-20260729-114336-H-FINAL3-20260729T154821Z`  
页面：H1、H2、H3、H4、H5、H7、H8（H6 已按产品定义并入 H5）  
业务对象：运营节奏、试用、任务事件、活动与转盘、签到与收益里程碑、代金券、邀请奖励与真实结算  
走查 Agent：G 域智能体，未参与 H 域修复  
结论：**非 Owner 对抗复审通过，99.4/100，无未关闭 P0/P1/P2/P3**

## 1. 冻结环境

| 项目 | 锁定值 |
|---|---|
| PC 基线 | `main@1d9dc8dffa40`，冻结运行实例含本轮工作树修复 |
| PC 实例 | `http://127.0.0.1:3302` |
| PC Build ID | `B9Ondo82Dj7NKNNE6ZcgB` |
| PC PID | `25128` |
| 后端基线 | `main@f4a943ec1fe5`，冻结 JAR 含本轮工作树修复 |
| 后端实例 | `http://127.0.0.1:18110` |
| 后端 JAR SHA-256 | `54B25D49CC36BAB02E1E36627CE5D9296AE92717FBACEFD5F222EE04528E59E4` |
| 后端 PID | `26424` |
| MFA | `temporary-superadmin-bypass=false`，真实密码与 TOTP |
| 数据库 | `nexion_acceptance_20260729_114336_irreversible` |
| Redis | DB 15 |
| App 基线 | `master@0e2178b59af9` |
| H 权限夹具 SHA-256 | `B2DEC27654B2422B373165F5EB4CE109B9C05B9D38567447F943E8E3FAE112B8` |

预检真实核对了 Build Manifest、PC/JAR 启动先后关系、端口唯一进程、后端 JAR、MFA bypass、数据库身份、OTP sink、Playwright 用例发现和权限夹具。预检报告 SHA-256：`A9DC6D51042A54FEB3080E0771315DF17F56EABB1A61E0ED316EC8A6F6FBBFA8`。

## 2. 独立执行结果

复审没有只认可 Owner 报告，而是在冻结 final3 候选上重新机械执行完整 H 范围，再由 G 独立解读原始证据：

| 波次 | 结果 | 对抗重点 |
|---|---:|---|
| 静态合同 | `60/60` | 权威数据源、前后端合同、H8 A2-only、CAS、unknown、App remote 边界 |
| 五层权限 | `3/3` | readonly、nowrite、nomenu；菜单、路由、按钮、接口、数据；刷新重登 |
| 读取故障 | `3/3` | 畸形 200、500、超时；七模块失败关闭与恢复 |
| H1 | `4/4` | 首次用户、跨域读、真实写入/恢复、401/404/422/幂等冲突 |
| H2 | `4/4` | 试用生命周期、刷新重登、读取失败、异常参数与同键冲突 |
| H3 可见主链 | `1/1` | 任务事件与 H1 关联 |
| H3 CAS/unknown | `1/1` | 双运营员 CAS、结果未知同键重放、审计/outbox、精确恢复 |
| H4 | `1/1` | 活动中心可见入口和只读真值 |
| H5/H7 | `2/2` | H5/H6 主链；H7 创建、编辑、暂停、刷新、重登、删除 |
| H8 可见/认证 | `1/1` | 可见入口、刷新重登、App/ADMIN/未认证失败关闭 |
| 真实 App 邀请链 | `1/1` | inviter canonical code、invitee 归因注册、退出 |
| H8 maker/checker | `1/1` | A2 提案、独立审批、钱包、D4、A2、A4/outbox |

Playwright 合计 `21/21`，`unexpected=0`、`skipped=0`、`flaky=0`；真实 App 链 `1/1`；产品缺陷 `P0/P1/P2/P3=0/0/0/0`。

## 3. 首次用户真实走查

1. 从真实登录页输入账号、密码和 TOTP，等待侧栏出现。
2. 只通过可见的“增长与运营节奏 H”侧栏逐个进入 H1、H2、H3、H4、H5、H7、H8。
3. 核对页面标题、当前状态、结构化字段、操作入口和上下游说明；不使用隐藏 URL 代替首次用户主链。
4. 执行 H1/H2/H5/H7 的真实写入、服务器回读、刷新、返回、退出和重登；恢复原值或删除临时对象。
5. 使用只读、无写和无菜单角色重复进入七个模块，验证菜单、路由、按钮、接口和数据同时失败关闭。
6. 逐模块注入畸形 200、500 和 timeout，确认不展示伪真值、不开放写按钮，并可从页面重试恢复。
7. 使用两名独立 H3 运营员基于同一旧值并发提交；仅一方成功，另一方返回 `422 QUEST_CONFIG_STALE`。
8. H3 首次结果表现为 unknown 后使用同一 Idempotency-Key 重放，返回 200，数据库仍只有 `1/1/1` 的幂等、审计和 outbox 副作用。
9. 从真实 App 调用链注册 inviter，读取其 canonical referral code，再注册 invitee 并建立唯一归因。
10. PC maker 从可见 H8 入口提交 A2 提案，独立 checker 审批；核对唯一 SETTLED 结算、三笔钱包台账、D4、A2 和 A4/outbox。

## 4. 墨菲矩阵结论

- 权限绕过：readonly、nowrite、nomenu、未认证、ADMIN、same actor、越域和未知对象均失败关闭。
- 失败关闭：畸形 200、500、timeout 不留下旧数据伪成功，不开放业务写入口，恢复后可继续。
- 结果未知：H3 使用同一命令号重放，未制造第二次业务副作用。
- 幂等：winner 与 unknown replay 均为幂等/审计/outbox `1/1/1`；stale loser 为确定性记录且审计/outbox `0/0`。
- CAS：双运营员结果稳定为 `200/422`，无 500/deadlock，最终恢复 `promoBanner.countdownDays=4`。
- 刷新重登：配置、权限哈希、H7 状态、H8 页面和真实后端结果保持一致。
- App/H8 跨域：App canonical code、注册归因、H8 A2-only 结算、钱包/D4/A2/A4 合同一致。

## 5. 载具 RED 与清理

本轮出现两个验收载具 RED，均没有放宽产品断言：

1. 首次读取故障波次遗漏 `A_PERMISSION_FIXTURE` 别名，在登录前停止，零登录、零写；R2 显式将 A/H 两个变量绑定同一夹具后 `3/3` 通过。
2. 旧 nonOwner 脚本期待已被 Owner final3 清理的历史 H8 settlement 继续存在；只读断言处停止，所有 POST 尚未执行。R2 重新创建隔离 App/H8 对象，完成真实闭环后 exact cleanup。

两项均定性为验收载具问题，不计产品缺陷。载具 RED 与清理报告 SHA-256：`5FC42CBFDC7004F58E75FE8656DC0D43FF583B40641D81A300EEAA3BFC6AD02B`。

最终清理哨兵：

| 检查项 | 结果 |
|---|---:|
| H3 `countdownDays` | `4` |
| H3 本轮 active 幂等 | `0` |
| H3 exact soft-delete 幂等 | `3` |
| H7 临时代金券 | `0` |
| H8 用户/钱包/会话/security/settlement/ledger/ticket | `0/0/0/0/0/0/0` |
| 隔离准备金夹具 | `0` |
| H8 不可变审计/outbox | `4/3`，按审计边界保留 |
| 共享 checker `99531` | active，保留，未扩权 |

## 6. 评分

| 维度 | 得分 |
|---|---:|
| 页面定位与业务对象 | 10.0/10 |
| 数据来源与一致性 | 15.0/15 |
| 操作闭环 | 15.0/15 |
| 真实用户走查与路径可达性 | 10.0/10 |
| 状态机 | 10.0/10 |
| 权限与安全 | 10.0/10 |
| 表单及控件合理性 | 7.8/8 |
| 文案、状态反馈与多语言 | 6.7/7 |
| 异常处理 | 5.0/5 |
| 审计、幂等和回滚 | 9.9/10 |
| **复审总分** | **99.4/100** |

严格大于 98；无硬性不通过项。结合 Owner 初审 `99.2/100`，H 域两轮较低分为 `99.2/100`，允许进入全局最终候选终验。

## 7. 证据与校验值

原始证据目录：

`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\nonowner-G-final3\full-r2`

关键 SHA-256：

- 72 文件证据清单：`9B5435A5C89C9CFE04D897D1518952D496A4FA35873A3B2A7B0C4CFEB61E7A8B`
- 非 Owner summary：`67FAA9DA500AF84E6236A840C01F2707741A452F21117EBEFD043AAC2AE7C104`
- 静态合同 JUnit：`B1B2FE0B8DE02E12584E630F81420DFDC47258FDA9BCB5711B7E693F1343ED3E`
- H3 数据库证明：`4EABB6482D879A72AF31BF5714E4496D49B801E6FF1D3527E2F67E1023BA25DE`
- App 邀请链：`DA1A5C3308BDE5A7B4293F1E92321B9CB1BF7D34577062C42FBAFA3C18E55FAC`
- H8 真实结算：`4DE61D9AD1842A1B83B7DEC55DBDAC8750CA397C37D223CBBA6B4E5050F4D119`

## 8. 最终判断

- 非 Owner 复审：通过。
- 是否允许 H 域进入全局终验：是。
- 未关闭产品缺陷：0。
- 待补验项目：0。
- 本报告未提交、未推送 GitHub。
