# H 域 Owner Final12 初审验收报告

Run ID：`pc-full-acceptance-20260729-114336`  
验收范围：H1、H2、H3、H4、H5、H7、H8（H6 按产品定义并入 H5）  
锁定候选：`FINAL12-RUNTIME-LOCK.json`；PC `http://127.0.0.1:3002`，Build `ABZKW7393ECWjhkaA_btM`；后端 `http://127.0.0.1:8110`，JAR `2A3EEC48ACCE273CFDEA32AAA2D0ADC69CC7F9EA07B66126BDC42D5482083DD2`；App `D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master@0e2178b59af`。

## 初审结论

**通过，98.6/100。** 未发现产品 P0/P1/P2/P3。H8 已补齐 Final12 锁定运行时的真实 App inviter→invitee、maker→A2 checker 结算、钱包/D4/A2/A4/outbox、限额与精确恢复闭环；不是以静态合同替代。

本轮不使用隐藏 URL、mock 成功态、DOM 改写或 localStorage 作为权威态。所有 PC 证据均从真实登录页、可见“增长与运营节奏”侧栏入口开始，由 Playwright Chromium `workers=1`、`trace=on` 驱动。

## 已核验闭环

| 覆盖 | 结果 | 关键事实 |
|---|---:|---|
| Final12 前后端/App 静态合同 | 57/57 PASS | H1–H8 权限、CAS、A2/A4、App remote consumer 与 H8 结算不可绕过 A2 均通过。 |
| 首次用户侧栏走查 | 7/7 PASS | H1–H5、H7、H8 逐页可见进入，真实 GET 均 `200/code=0`；逐页刷新后仍可用；pageerror、非预期 console error、API request failure 均为 0。 |
| H1 生命周期 | 1/1 PASS | 从可见“设定位置”写入、刷新回读、A2/A4 留痕、精确回退。 |
| H2 生命周期 | 1/1 PASS | 可见修改 `trialOffsetCap`，刷新和重新登录后保留，最终恢复原值。 |
| H3 双运营员与未知结果 | 1/1 PASS | 两名独立 H 账号同旧值提交得到 `[200,422 QUEST_CONFIG_STALE]`；unknown 同键回放 `200`；值恢复为 `4`。 |
| H4 | PASS | 侧栏进入、权威读、刷新回读通过。 |
| H5/H7 生命周期 | 2/2 PASS | H5 主链/刷新/异常恢复；H7 新建、编辑、暂停、重新登录和删除清理。 |
| H8 可见边界 | 1/1 PASS | 真实入口、刷新、重登、401 与未允许路由失败关闭通过。 |
| H8 App 与真实结算补验 | 1/1 PASS | App 真实 OTP 注册 inviter→invitee；H-only maker 经可见 H8 “执行真实结算”提案，独立 superadmin checker 从可见 A2 审批；结算后 D4 三笔账、钱包、A2、A4、outbox、B1 红线及非目标指纹均为 PASS。 |
| 五层权限 | 3/3 PASS | readonly、no-write、no-menu 均覆盖 H1–H5/H7/H8 菜单、路由、按钮、接口和数据；no-menu 刷新重登后不由缓存恢复。 |
| 墨菲读取故障 | 3/3 PASS | 畸形 200、500、timeout 下七模块均清空不可信快照、冻结写入口，恢复后可继续。 |
| 401/403/404/409/422、幂等/CAS | PASS | H1 墨菲探针及 H3 对抗链覆盖；H3 loser 未产生成功副作用。 |

## App、关联域与审计核对

- App 锁定候选的 H3/H4/H5/H7/H8 remote contract 全部纳入 57 项静态门禁：远端模式不在客户端伪造奖励；H8 推荐归因写入服务端 `sponsor_user_id`；PC 无直接 settlement API，只能进入 A2 approved replay。
- H1 生命周期实际确认 A2/A4 留痕；H3 以 H-only maker 确认 A4 原始跨域端点 `403`；H8 页面明确展示 A2、A4、D4 验证入口和 `REAL_WALLET_LEDGER` 权威模式。
- H8 补验使用锁定 App 根、主候选 PC `3002`/后端 `8110`、真实 OTP/MFA 和受控 loopback JP carrier。首波因 H-only checker 不具 D4 只读权限在 D4 查询得到真实 `403`，未掩盖；该波已精确清理。重跑改用独立具全局只读权限的 superadmin checker（maker 仍为 H-only），完整 UI 链 `1/1 PASS`，随后数据库独立核验目标 settlement `1`、钱包 `2`、D4 `3`、A2 approved `1`、A4 `1`、outbox `1`、活动 object lock `0`。

## 清理、快照与载具问题

- H3 当前两波 CAS 的 7 条可变幂等记录已按精确 row ID soft-delete：更新 `7`，残留 `0`；审计/outbox 不可变记录保留。
- H7 本轮临时代金券由真实 UI 测试自行删除。H8 两波均按身份精确清理 App 用户、钱包、会话、安全、OTP、settlement、D4、A2 operation/object lock 和 B1 reserve fixture；B1 五字段快照精确恢复，审计/outbox 保留为不可变证据。B1 singleton lock 已以可恢复 release record 释放。
- 证据目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\H\final12-owner\`，2587 文件，聚合 SHA-256 `563C789CA59ED9DF30B754BB13E65FF2A7DE56FAC17D44C26E7B2C6025071E83`。H8 最终通过证据为 `h8-final12-retry2`；首波失败/清理证据保留在 `h8-final12`，不计入通过结果。
- 初始批量 Playwright 曾有 4 个 MFA OTP 重放失败；已改为每个业务用例独立进程并等待新的 TOTP 窗口，最终上述通过证据不含失败波次。旧权限 fixture setup 不支持 MFA 根账号、且用 superadmin 代替 H-only maker 会使 A4 读取断言误报；均定性为验收载具问题，未记产品缺陷。

## 命令与退出码

| 命令 | 退出码 |
|---|---:|
| `node --test tests/h-domain-contract...h8-owner-closure-contract.test.mjs` | 0（57/57） |
| `playwright ... h-domain-failclosed ... --workers=1 --trace=on` | 0（3/3） |
| `playwright ... h3-two-operator-cas ... --workers=1 --trace=on` | 0（1/1） |
| H1、H2、H5、H7 生命周期单例 Playwright 波次 | 0（各 1/1） |
| `playwright ... h-domain-permission-fixtures ... --workers=1 --trace=on` | 0（3/3） |
| `playwright ... h8-owner-acceptance ... --workers=1 --trace=on` | 0（1/1） |
| `node h8-app-referral-chain-final3.mjs`（retry2） | 0（PASS，真实 OTP inviter→invitee） |
| `playwright h8-real-settlement-20260728.spec.ts`（retry2，maker→checker） | 0（1/1） |
| H8 目标/钱包/D4/A2/A4/outbox/B1/非目标指纹 Verify 与精确 Cleanup | 0 / 0 |

最终硬错误：产品 `0`；已关闭验收载具错误 `4`（MFA 竞争、MFA setup 不兼容、superadmin 误作 H-only actor、H-only checker 不具 D4 只读权限）。  
Owner 初审评分：**98.6/100**。
