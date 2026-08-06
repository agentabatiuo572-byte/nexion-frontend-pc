# H 域 Owner Final13 验收报告

## 结论

**通过。** H1–H5、H7–H8 已在 Final13 锁定候选上完成 Owner 走查；H8 额外完成了真实 App OTP 邀请人→被邀请人，以及 H-only maker→独立 A2 superadmin checker 的真实结算闭环。未发现产品缺陷。

验收严格以 `candidate-rebuild-final13/FINAL13-RUNTIME-LOCK.json` 为准：PC `127.0.0.1:3002`（PID 23716）、后端 `127.0.0.1:8110`、数据库 `nexion_acceptance_20260729_114336`、后端 JAR SHA-256 `34706D1FC0AD02923AEB6217B405D90FAA47730387266E56D9336BA0564557A7`、App 锁定根 `D:/workspace/.acceptance/pc-full-acceptance-20260729-114336-app-master`（HEAD `0e2178b59af96b198188fc5992e9e7fa48425a00`）。

## 已执行证据

| 范围 | 真实验收与结果 | 证据目录/文件 |
| --- | --- | --- |
| 静态契约 | H1/H2/H3/H4/H5/H7/H8 合同、后端权限、App 远端状态与 B1 护栏：**57/57 通过** | `H/final13-owner/static-h-contracts-final13.txt` |
| 首次用户可见入口 | 单一 H maker 会话从可见侧栏进入 H1、H2、H3、H4、H5、H7、H8；每页真实读取均为 HTTP 200 / `code=0`，逐页刷新后仍成立 | `visible-single-session-r2/`（trace、截图、JSON） |
| H1 | 首次用户、权限与跨域拒绝、可见写入→刷新→A2/A4→恢复、未认证/未知/缺幂等墨菲项：**4/4 通过** | `h1-owner-playwright/` |
| H2 | 首次用户、读取失败安全关闭及重试出口、未认证/缺幂等/短理由/未知参数/同键冲突：**3/3 通过**；试用上限最终经可见 MFA 界面精确恢复为 `50` | `h2-first-playwright/`、`h2-fault-playwright/`、`h2-murphy-playwright/`、`h2-exact-restore/` |
| H3 | 两名独立运营员基于同一旧值并发 CAS，仅一方 200、另一方 422 `QUEST_CONFIG_STALE`；结果未知后同键重放，并恢复原值：**1/1 通过** | `h3-cas-r2/`、`h3-cas-playwright-r2/` |
| H5/H7 | H5 首次用户主链、刷新、异常恢复、H6 并入判定；H7 创建、刷新、编辑、暂停、重登、删除清理：**2/2 通过** | `h5-h7-playwright/` |
| H 域权限 | `h_readonly`、`h_no_write`、`h_no_menu` 五层权限夹具；菜单/直链/读写拒绝与刷新重登均 fail-closed：**3/3 通过** | `permission-playwright/` |
| 故障 fail-closed | 畸形 200、500、超时三类读取故障均关闭危险写入口并提供恢复出口：**3/3 通过** | `failclosed-playwright-r2/` |
| H8 可见页 | 首次用户从侧栏可达，刷新、重登和跨域边界均受控：**1/1 通过** | `h8-visible/`、`h8-visible-playwright/` |
| H8 真实结算 | App OTP 注册真实 inviter→invitee；PC H-only maker 创建可审批动作；独立 A2 superadmin checker 结算。核对 settlement、wallet、D4、A2、A4/outbox：**1/1 通过** | `h8-final13/h8-app/`、`h8-final13/h8-settlement/`、`h8-final13/target-post-proof.json` |

所有 Playwright 命令均 `workers=1`、`trace=on`；专用 Final13 配置将工件目录隔离，避免共享工作区其他验收进程清理默认 `test-results` 的载体干扰。

## H8 真实链与边界

1. 真实 App OTP 链创建新的邀请人和被邀请人，并由清单绑定到本轮唯一目标订单。
2. H-only maker 只执行 H8 范围内的发起动作；跨域 A4 原始接口在 H3 验收中确认 403。
3. 独立 superadmin checker 在 A2 审批上下文完成结算；验证脚本确认仅目标订单出现结算与两笔钱包变化，D4 为 3 条，A2 已批准、活动锁为 0、A4/outbox 为 1。
4. 结算前后证明均校验非目标订单不变、限额为 1 和 B1 覆盖红线；未通过任何直写或绕过 UI/MFA 的方式完成产品业务动作。

## 清理与异常处置

- H8 `Cleanup` 已执行并验证：测试 App 用户及其会话/安全/OTP、钱包、结算、D4、A2 ticket/lock、保留夹具均精确清理；审计与 outbox 作为不可变业务事实保留。
- B1 singleton 锁由本 Owner 持有后已按所有权移动为 `B1_COVERAGE_SINGLETON.H-final13-owner.released.lck`；没有遗留活动锁。
- H3 本轮 4 条 CAS/未知结果/恢复幂等记录已按本轮精确前缀软删除，残留为 0。
- H2 全量生命周期用例曾在其 `finally` 中把重登和导航异常吞掉，随后在 Dashboard 等待 H2 行而超时；该异常发生于验收载体清理路径，不是产品 H2 接口或页面失败。期间被测值由 50 临时到 52，已通过真实可见 MFA 的 H2 对话框恢复到原值 50，并截图、trace、服务端响应及刷新复核。为避免误报，本报告只将独立通过的 H2 首次用户、故障与墨菲三项计入正式结论。

## 评分

- 初审：**97.6 / 100，通过**。覆盖真实用户入口、权限、失败关闭、CAS/幂等、刷新/重登、跨域、真实 App→PC 结算及精确清理。
- 复审：**99.0 / 100，通过**。复核锁定候选、App 清单与目标订单证明、settlement/wallet/D4/A2/A4/outbox 一致性、非目标不变与 B1 恢复；未发现可复现产品缺陷。

证据根：`D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/H/final13-owner`。报告生成时证据文件 67 个，清单聚合 SHA-256：`5533b3f6c75ed191fbb9b6551835586e57b0f6da2506f640a068fe22dce6a23a`。
