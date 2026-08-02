# L 域非 Owner 对抗复审（K，Final6 未通过）

- Run ID：`pc-full-acceptance-20260729-114336`
- 锁定候选：PC Build `njacAG-OYV84-mfOdWA9v`（PID `22220`）；后端 JAR `93A9B39EB8C3F1F9C425D34F6D68ECBCEEF87744794A0F7D684C14F0307AF92C`（PID `24648`）；`3002/8110`，隔离 MySQL/Redis `nexion_acceptance_20260729_114336` / DB 13，MFA bypass=`false`。
- 执行者：K 域非 Owner；K 未参与 L-006/L-007 的修复。Playwright 全程 `workers=1`，每个包使用本域独立 `--output`。

## 结论

**不通过，不能签发 L 域最终通过。** PC/后端 L1–L6 的 Final6 对抗链均通过并精确清理；但范围真源 App `D:\workspace\NX1.0` 缺少 L6 行为事件 producer，确认 `L-008/P1`。按轮换，M 修复后，L Owner 必须以新候选从真实登录和可见侧栏完整重跑，K 再独立复审。

初审 `95/100`（未达到 96）；复审不触发签发。当前血量按失败规则记为 `90`。

## 已通过的 Final6 运行时证据

| 范围 | 结果 |
|---|---|
| 最小 MFA/RBAC 预检 | `1/1`。maker、readonly、nowrite、nomenu 与两个 L3 checker 全部完成真实 MFA；maker 无审批/解密权限，checker 仅 `A2+L3` 与三项精确 authority。 |
| 首次用户与导航 | `1/1`。从登录页、可见“数据与分析 BI”侧栏进入 L1–L6，逐页刷新，退出重登后 L1/L6 入口稳定。 |
| 五层权限 | `3/3`。readonly/nowrite 对 L1–L6 均可读但写接口 `403`、无启用写按钮；nomenu 的菜单、直链、读写接口均拒绝，刷新重登不从缓存恢复。 |
| 失败关闭 | `3/3`。L4/L5/L6 注入畸形 HTTP 200 后显示加载失败且导出入口关闭。 |
| 写入与结果未知 | `1/1`。L1 503 后同键恢复；L2 六阶段与 CSV 六行同源、回放 `200`、异载荷 `409`、空切片 `422`；L4 depth `1→2` 为 `2→3` 行；L5 监管报告、L6 直接导出完成。 |
| L3 双运营员 | `1/1`。创建/回放/冲突/自批/竞争审批/下载分别为 `200/200/409/403/409+200/200`。 |
| 浏览器质量 | Owner 写入 manifest：pageerror、非预期 console error、管理请求失败、非预期 5xx 均为 `0`。 |

L1/L2/L4/L5/L6 共 6 份治理报告，另加 L3 1 份，共 7 份；业务清理确认 7 份报告、11 条幂等、下载授权、artifact 和 MinIO 对象均无残留，A2/A4 依边界保留。L4 受控 3 user/3 KYC/2 sponsorship/5 team row 夹具已删除，非夹具 team fingerprint 已恢复。

## L-008 / P1

本轮 App 范围是 `D:\workspace\NX1.0`，不得用另一 checkout 替代。该目录内预期的 L6 API、service 均不存在，且 `src` 对行为 producer 标记检索结果为 0。故 PC 已有热力结果和 L6 导出只能说明后端/PC 可消费既有事实，不能证明当前 App 会持续写入受最小化和非权威边界约束的 `app.page_viewed`、`app.element_clicked`。

原始证明：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\L\final6-nonowner-k\l008-cross-app-proof.json`。

## 产物哈希

- Owner 写入 manifest：`A460BEF4A40D35612F5144456BFD6F7E22B7D4D8A4DC996D4A4D37DAA31B8FCE`
- L3 maker/checker：`7F19E85DFC0635713F6877C2978BF0506C53D029933261F522EC4C243022D26F`
- 业务精确清理：`8486B753D4C03E66E22569E6B2DC7E95B75049F9407E18D5C663FCEA860D3D1E`
- L4 夹具精确清理：`4922CF981758197C9938059AD6511D4DD6AE60F50A6EC256EC9A883099258778`
- Playwright trace/截图哈希清单：`L/final6-nonowner-k/playwright-artifact-hashes.json`

## 静态核对

L 合同先跑 `65` 项，其中 `64` 项通过；旧 Final4 token 常量合同已改为必须传入 `L_FINAL_EXPECTED_WRITE_TOKEN`，对应 L4 合同重跑 `7/7` 通过。余下失败就是 L-008：L6 跨端合同读取当前 App 缺失文件而停止，非载具路径漂移。

## 后续

1. M 在 `D:\workspace\NX1.0` 实现并验证 L6 最小化、非权威的行为事件 API/service/chassis 生产链，禁止采集文本或让分析阻塞业务。
2. 同步后端 A4 schema、去重/乱序/节流、L6 聚合与 App 端测试。
3. 重新锁定候选；L Owner 完整重跑 L1–L6、L3 双 checker、L4 夹具、刷新重登、权限/异常与精确清理；K 再次非 Owner 对抗复审。
