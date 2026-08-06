# E 域非 Owner 对抗复审（D）

## 结论

**通过。** Final6 候选为 PC Build `njacAG-OYV84-mfOdWA9v`、后端 JAR SHA-256 `93A9B39EB8C3F1F9C425D34F6D68ECBCEEF87744794A0F7D684C14F0307AF92C`，MFA bypass 为 `false`。D 未参与 E 域修复，以当前 E 专属 maker、只读/无写/无菜单账号及独立 E3/E6 checker 完成复审；发现产品 RED 0，未关闭 P0/P1/P2/P3 0。

评分：初审 `99.2`，非 Owner 复审 `99.4`（严格大于 98），血量 `100`。

## 覆盖与结果

| 范围 | 执行与结果 |
| --- | --- |
| 首次用户真实走查 | `e-domain-final-nowrite-owner-20260729.spec.ts`，4/4 通过。由登录页与可见 E 侧栏进入 E1–E6；权威读取均 200/code=0；刷新、退出重登、E-001/E-002、空态与无跨域预取均通过；pageerror、非预期管理接口错误、成功业务写均为 0。 |
| 权限五层 | `e-domain-permission-fixtures-20260728.spec.ts`，3/3 通过。readonly 与 menu-no-write 的 E1–E6 读均 200、写均 403；no-menu 的菜单、直链、读、写均拒绝；刷新/重登不漂移。 |
| 失败关闭 | Final6 MFA readonly 账号执行 `e-final6-mfa-failclosed.spec.ts`，1/1 通过。E1、E4、E5、E6 对畸形 200 均停止展示可信数据；E1 使用可见重试恢复，E4/E5/E6 用用户可见刷新恢复；无 pageerror。E2/E3 在无写首轮已验证畸形/故障响应关闭并由可见重试恢复。 |
| E3 对抗写链路 | `e-domain-nonowner-d-20260728.spec.ts`，2/2 通过。可见入口提案→A2→独立 checker；同键同体重放 200、同键异体 409、第二写者与待审直写 409、maker 自批 403；unknown 的 503/畸形 200 不丢失对话状态且同键重试，精确恢复。 |
| E6 对抗写链路 | `e6-maker-checker-20260728.spec.ts`，1/1 通过。maker/checker 隔离；跨域已知/未知 A2 决策均 403，拒绝探针无副作用，终态重放 409，无重复副作用，五个下载键精确恢复。 |
| 前后端合同 | 10 份 E1–E6 合同测试共 62/62 通过，覆盖 DTO/参数白名单、状态机、CAS、幂等、严格聚合与 App 公共投影。 |
| App 消费投影 | `GET http://127.0.0.1:8110/api/config/platform` 以受信边缘头 `X-Nexion-Edge-Country=JP`、`CF-IPCountry=JP` 返回 200/code=0；`computerCompute.download` 恰为 `url/zhTitle/zhGuide/enTitle/enGuide` 五键，来源为 `nx_config_item:E.compute.*`。无边缘国家头返回 `503 GEO_COUNTRY_UNRESOLVED`，为 J2 的预期失败关闭。 |

## A2 / A4 / 数据库与恢复

受控写仅使用 `E_REVIEW_FINAL6_njac_20260730T0259JST`、`E3_REVIEW_FINAL6_20260730T0259JST`、`E6_REVIEW_FINAL6_20260730T0259JST`，未写 E4 资金或其他全局配置。

- E3：前向 `WO-260730030807377-800`、精确恢复 `WO-260730030810624-500`，均终态；对象锁别名未进入 canonical lock。
- E6：拒绝探针 `WO-260730030918999-700`、前向 `WO-260730030920405-600`、精确恢复 `WO-260730030922489-800`，均终态。
- DB 复核：本轮 E 票据 5 条且全部终态；E3 A4/outbox 2 条、E6 A4/outbox 2 条；`active_e_locks=0`、下载文案复验标记数=0。outbox 的不可变证据保持 `PENDING`，不作为未清理业务夹具。

## 原始证据

证据根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\E\final6-njacAG-OYV84-mfOdWA9v\nonowner-d`。

| 文件 | SHA-256 |
| --- | --- |
| `nowrite-r2/owner-nowrite-result.json` | `36C055CC0533FC399EAA9CEEDC3096A80AF45FFAC9AB986171FB4EC51975B1A9` |
| `permission-r2/readonly-five-layers.json` | `F38868A4F37A53F041331A64BB425DD9A0E8CBDFBC556244D23DFC0D6CC9108C` |
| `permission-r2/menu-no-write-five-layers.json` | `368CFCFA2D6BB4234FC1A641362FE8E7D75FC9B34B5E6E09DE98DE127FD854EF` |
| `permission-r2/no-menu-five-layers.json` | `D596F3DBDB6472A7C5780B81419439DDAF48AD1C711C1F3DCF011B105F671CF9` |
| `e3-write/e006-result.json` | `E97D7002B006777A2D9B6E8955EDB166EC8D2FDBD500636440D6C3F5C50CA6A9` |
| `e3-write/e3-unknown-result.json` | `382B73FD5A5054300647E6A7BC3E325B35BA1BBFC28B8ED8EDADA98FF2A82CD9` |
| `e6-write/result.json` | `BB276E88DC32565FFFC0F15A065EF15AA812C041E9D4AA3F5286E7A166C00195` |
| `failclosed-e1456-mfa/result.json` | `0E627FC70FD5A3C89F02FE2316A2C21A894B31DBB6D167AAD986AECCBA29392C` |
| `playwright-output/.../trace.zip` | `8AD44388CAF526965514AB9F5069CC5480CB74B373468D08DE5EE052B9D9A6CB` |

## 载体备注

历史 `e-domain-owner-20260728.spec.ts` 将 `superadmin` 当作免 MFA 账号，因 Final6 的 MFA bypass=false 在登录门禁处 6/6 停止。它不是产品 RED，且未用于本次签发；已以 Final6 `final75_readonly` + MFA 的独立证据脚本补齐 E1/E4/E5/E6 动态失败关闭。后续若将该历史脚本重新纳入默认回归，应改为读取当前 MFA fixture，避免把认证策略当作页面故障。
