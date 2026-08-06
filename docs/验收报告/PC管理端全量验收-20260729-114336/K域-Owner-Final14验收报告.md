# K 域 Owner Final14 验收报告

- Run：`pc-full-acceptance-20260729-114336`；候选锁：`candidate-rebuild-final14/FINAL14-RUNTIME-LOCK.json`。
- 候选：PC build `0OZ66wYtIYX6qJHhZUvQK`；Backend SHA-256 `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`；主实例 `127.0.0.1:3002/8110`；MySQL `nexion_acceptance_20260729_114336`、Redis DB 13；MFA bypass=false。
- 结论：**Owner 初审通过，97.4/100（>96）。** 无 P0/P1/P2/P3 产品缺陷；可交由映射的 L1-L6 非 Owner 复审。

## Final14 新候选补验

| 范围 | 真实运行结果 | 覆盖 |
| --- | --- | --- |
| K5 | `k5-live-acceptance-20260722.spec.ts`：4/4，exit 0 | 从登录页和可见侧栏进入；订阅、并发合并、未知结果同键重试、驳回/通过与 C4 恢复；只读/匿名拒绝；503、断网、畸形成功失败关闭后恢复。 |
| K1-K6 终态哨兵 | `k-domain-permission-fixtures-20260728.spec.ts`：4/4，exit 0 | readonly、nowrite、maker、nomenu 均从登录入口经可见侧栏覆盖 K1-K6；逐模块读取、写 API 拒绝/菜单边界、刷新、退出及重登后的终态不漂移。 |

## 继承的完整 K 业务链及本次确认

Final13 已完成 K1 `4/4`、K2 `6/6`、K3 `1/1`、K4 正常及逆向各 `1/1`、K6 `4/4`，均为真实 Chromium、MFA、`workers=1 --trace=on` 的完整业务 carrier。本轮 Final14 不是把旧构建当作当前结论：以上 Final14 全 K 登录/侧栏/刷新/重登哨兵已在新的 build 与后端 JAR 上重新执行，并将唯一当时未闭环的 K5 完整业务链补齐。

K2/K5 使用的正式最小权限角色按 A1/A6 创建、A2 审批并完成账户首登 MFA 验证；K2 已在其完整 carrier 中验证 K2、A2、H2/H8/F4、CAS、幂等、503 与刷新重登。K5 使用同一正式最小 Owner，验证 K5/C4 跨域闭环、权限和墨菲分支。

## 精确清理与终态

- A cleanup actor `ffix.k4.final7.p.6aa8e40123` 完成账户重置 MFA、解绑、停用、撤销会话；独立 superadmin 正常 MFA `ffix.a.final7.x.6aa8e40123` 审批角色删除。
- 本轮 role `4548/4549/4550`（`ACC_K2_CK_F13RL0802`、`ACC_K2_XR_F13RL0802`、`ACC_K5_OWN_F13RL0802`）活跃残留为 `0`；账号 `99965/99966/99967` 均 `status=0`、无活跃角色关系。
- K2/K5 清理 Playwright：`k-minimal-role-cleanup.spec.ts` 1/1，exit 0。不可变审计保留（本轮关联审计 34 条）；未删除审计或 outbox。
- 没有修改产品源码、没有提交或推送。首次登录 OTP→改密页面的等待仅修复于 restricted 派生验收 carrier，非产品代码。

## 评分与签发

初审：**97.4/100**，通过；扣分仅来自受限首次登录载具的异步页面适配风险，非产品缺陷。按要求进入 L1-L6 映射非 Owner 复审；复审必须独立达到 >98 才可签发最终复审通过。
