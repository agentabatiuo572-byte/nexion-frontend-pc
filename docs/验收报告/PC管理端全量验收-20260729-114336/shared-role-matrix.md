# 共享权限载具矩阵盘点

Run ID：`pc-full-acceptance-20260729-114336`  
盘点方式：只读检查 `tests/e2e`、`lib/nav/console-nav.ts` 与本 Run 的受限域 manifest；未调用写 API，未读取或展示任何账号凭据。

## 结论

现有 `A/domain-permission-fixtures/{A..M}.json` 不能作为“域专属最小权限”载具的事实来源。13 个 manifest 的 `readonly`、`nowrite` 和 `nomenu` 都带有同一套跨 A–M 的全局只读权限；`maker` 则带有同一套跨域高权权限（其中包含 `*_approve`、`*_decrypt_export`、RBAC 授权等职责分离权限）。`nomenu` 虽然当前有效菜单为空，但其权限码并非空数组。因此这些 manifest 只能证明菜单隐藏，不能证明域隔离或最小权限，不能用于 maker/checker 对抗验收。

目标不变式如下，后续任何专属载具脚本和 manifest 都必须按此校验：

- `nomenu.permissionCodes = []` 且 `nomenu.menuIds = []`；登录后的 session 也必须没有本域菜单和本域权限。
- `readonly` / `nowrite` 仅含本域 `READ_PERMISSIONS`，菜单仅含本域 `MENU_CODES`。
- `maker` = 本域 `READ_PERMISSIONS` 加经测试明确需要的本域发起/编辑权限；不得含 `checker`、`approve`、`decrypt`、RBAC 授权/角色管理、跨域业务权限。批准、复核、解密必须由独立 checker 账号承担。
- 所有数组应做**等集**断言，不能只做 `toContain`；否则全局超集会假绿。

## 应采用的域矩阵

`MENU_CODES` 以 `console-nav.ts` 的侧栏真源为准（域根 + 可见 L2 id）。`READ_PERMISSIONS` 以现有专属脚本的显式常量为准；没有专属常量时，按现有域权限命名及权限用例列为待落实的精确最小集合，不能把当前全局 manifest 视为替代。

| 域 | MENU_CODES | READ_PERMISSIONS | MAKER_PERMISSIONS | 现状 |
|---|---|---|---|---|
| A | `A,A1,A2,A3,A4,A5,A6,A7,A8` | `platform_a1_read,platform_a2_read,platform_a3_read,platform_a4_read,platform_a5_read,platform_a6_read,platform_a7_read,platform_a8_read` | 缺少；应另建最小发起集，排除 `platform_a2_operation_approve`、`platform_a1_rbac_grants_update`、`platform_a6_role_grants_update` 及任何 `*_approve/*decrypt*` | 无专属 setup；仅有共享 manifest。 |
| B | `B,B1,B2,B3,B4,B5` | `overview_b1_read,overview_b2_read,overview_b3_read,overview_b4_read,overview_b5_read` | 缺少 | 有 `b-domain-permission-fixture-setup`，只创建精确只读角色，未建 maker。 |
| C | `C,C1,C2,C3,C4,C5,C6` | `user_c1_read,user_c2_read,user_c3_read,user_c4_read,user_c5_read,user_c6_read` | 缺少；C3 调整的 maker 必须排除 `user_c3_adjust_approve`，C2/C5 亦不得含审批/解密职责 | 无专属 setup；`c-domain-nonowner-b` 只验证只读/无写/无菜单。 |
| D | `D,D1,D2,D3,D4,D5,D6` | `finance_d1_read,finance_d2_read,finance_d3_read,finance_d4_read,finance_d5_read,finance_d6_read` | 缺少；D2 maker 必须排除 `finance_d2_withdrawal_approve` | 无专属 setup；既有 D 用例为消费 manifest。 |
| E | `E,E1,E2,E3,E4,E5,E6` | `device_e1_read,device_e2_read,device_e3_read,device_e4_read,device_e5_read,device_e6_read` | 缺少（E6 有单独 maker setup，但不是 E 全域 maker 常量） | 有 E 全域只读 setup；缺全域 maker 常量/账户。 |
| F | `F,F1,F2,F3,F4,F5` | `network_f1_read,network_f2_read,network_f3_read,network_f4_read,network_f5_read` | `READ_PERMISSIONS + network_f1_write,network_f2_royalty_rate,network_f3_write,network_f4_pool_fund,network_f5_commission_dispose,platform_a2_read,platform_a2_proposal_create` | 有 setup，但常量散落在 session 断言中；应提升为显式 `MENU_CODES/READ_PERMISSIONS/MAKER_PERMISSIONS`。 |
| G | `G,G1,G2,G3,G4,G7` | `finprod_g1_read,finprod_g2_read,finprod_g3_read,finprod_g4_read,finprod_g7_read` | 缺少；不得混入价格审批、跨域审批或解密权限 | 无专属 setup；仅共享 manifest。 |
| H | `H,H1,H2,H3,H4,H5,H7,H8` | `growth_h1_read,growth_h2_read,growth_h3_read,growth_h4_read,growth_h5_read,growth_h7_read,growth_h8_read` | 缺少 | 有 setup，但仅创建 readonly/nowrite/nomenu；未声明菜单等集，也没有 maker。 |
| I | `I,I1,I2,I3,I4,I5,I6` | `content_i1_read,content_i2_read,content_i3_read,content_i4_read,content_i5_read,content_i6_read` | 缺少；发布 maker 不得含其他域审批/解密职责 | 无专属 setup；当前实际 manifest 菜单还出现 `MENU_CONTENT_I4/MENU_CONTENT_I5`，与导航 id 需在脚本中显式映射或修正。 |
| J | `J,J1,J2,J3,J4` | `emergency_j1_read,emergency_j2_read,emergency_j3_read,emergency_j4_read` | `READ_PERMISSIONS + emergency_j1_gate_kill,emergency_j1_gate_resume,emergency_j1_batch_kill,emergency_j1_write,emergency_j2_country_manage,emergency_j2_write,emergency_j2_edge_source_manage,emergency_j2_emergency_block,emergency_j3_alert_config,emergency_j3_export,emergency_j4_write,emergency_j4_playbook_execute,platform_a2_proposal_create` | 有完整显式常量；数组未包含 checker/approve/decrypt。 |
| K | `K,K1,K2,K3,K4,K5,K6` | `risk_k1_read,risk_k2_read,risk_k3_read,risk_k4_read,risk_k5_read,risk_k6_read` | `READ_PERMISSIONS + risk_k1_write,risk_k1_cluster_freeze,risk_k1_cluster_release,risk_k1_cluster_cleared,risk_k1_cluster_flag,risk_k2_write,risk_k2_row_freeze,risk_k2_row_flag,risk_k2_row_blockgift,risk_k2_row_boardflag,risk_k3_write,risk_k3_rule_create,risk_k3_rule_toggle,risk_k3_rule_archive,risk_k4_write,risk_k4_user_override,risk_k4_user_recompute,risk_k5_write,risk_k5_ticket_pass,risk_k5_ticket_reject,risk_k5_ticket_manual,risk_k6_write,risk_k6_senior,risk_k6_target_manage,platform_a2_read,platform_a2_proposal_create` | 有完整显式常量；数组未包含 checker/approve/decrypt。 |
| L | `L,L1,L2,L3,L4,L5,L6` | `bi_l1_read,bi_l2_read,bi_l3_read,bi_l4_read,bi_l5_read,bi_l6_read` | 现名 `OWNER_PERMISSIONS`：`READ_PERMISSIONS + bi_l1_write,bi_l2_write,bi_l3_write,bi_l3_export_detail,bi_l4_write,bi_l4_export_tree,bi_l5_write,bi_l5_regulatory_generate,bi_l6_export,platform_a2_read,platform_a2_proposal_create`；应更名为 maker 或明确其非 maker 语义 | 有显式常量；无 `approve/decrypt`，但角色名 `owner` 与全局矩阵不一致。 |
| M | `M,M1,M2,M3,M4,M5` | `service_m1_read,service_m2_read,service_m3_read,service_m4_read,service_m5_read` | 缺少 | 有 setup，但仅创建 readonly/nowrite/nomenu；未声明菜单等集，也没有 maker。 |

## 专属脚本与常量缺口

1. **完全没有域专属 setup 脚本**：A、C、D、G、I。它们当前仅消费共享 `A/domain-permission-fixtures/*.json`，而该 manifest 是全局角色快照，非域隔离角色。
2. **有 setup 但缺全套常量/角色**：B、E、H、M 缺 maker；F 缺顶层显式常量和等集菜单授权；L 使用 `OWNER_PERMISSIONS`/`l_owner`，与统一 maker 语义不一致。
3. **脚本存在但仍须补强**：J、K 的 permission 常量可复用，但应增加“maker 不含 checker/approve/decrypt/跨域权限”的等集否定断言；所有脚本都应写出并验证 `nomenu.permissionCodes=[]`、`nomenu.menuIds=[]`，而不是仅验证 session 内无菜单。
4. **共享 recovery 载具不适合作为修复**：`domain-permission-fixture-recovery.spec.ts` 以全局 role template 复制 A–M；它会把同一个超权限 maker、全局只读权限复制到每个域。该机制只能用于账号生命周期恢复，不能生成合格的域权限载具。

## 当前 manifest 的可复核问题

- 每个 `A.json` 至 `M.json` 都有 `maker/readonly/nowrite/nomenu` 四个账号，但 `readonly/nowrite/nomenu` 的权限数组为全局跨域读集合，违反“仅本域 READ”要求。
- `nomenu` 的有效菜单为空，但权限数组仍为全局跨域读集合，违反本报告定义的空 `permissionCodes` 不变式。
- `maker` 是同一套跨域高权集合，包含至少批准、解密导出、RBAC 授权等职责分离操作；不可用于任一域的 maker 验收。
- I 域实际 session 菜单代码存在 `MENU_CONTENT_I4`、`MENU_CONTENT_I5`，而导航真源为 `I4`、`I5`。授权脚本必须明确做规范化映射或修复菜单编码，不能静默跳过。

## 建议的后续落地顺序

1. 先替换/隔离 shared recovery 的全局 role template，按上表逐域创建真实 RBAC 角色并进行等集查询校验。
2. 先补 A、C、D、G、I 五个专属 setup；再补 B/E/H/M maker，统一 F/L 的常量和角色命名。
3. 每域固定四个账号：readonly、nowrite、nomenu、maker；另用跨域独立 checker，任何 maker 不得与 checker 共享账号、权限或角色。
4. 重新生成受限 manifest 后，逐域从登录页执行五层权限、刷新、重登、403/路由拒绝与 maker-checker 职责分离验收；旧 manifest 的通过记录不得继承。
