# E域 非 Owner Final14 对抗复审报告

## 结论

**通过。** 初审 **99/100**，复审 **99/100**；P0/P1/P2/P3 均为 0。复审使用与 Owner 一致的 Final14 主运行时：PC `3002`、构建 `0OZ66wYtIYX6qJHhZUvQK`、后端 JAR `F54932E72C272E14247439DC32ECC9165FD741E7A25C7E3D60464FB4FACA7399`。

## 非 Owner 权限与可见入口

- readonly、menu-no-write、no-menu 三种独立会话完整走查 E1–E6：共 **3/3** 通过。
- readonly / menu-no-write：六个模块菜单、可见页面、权威读、刷新和重新登录均成立；全部写接口均为 `403`，页面不显示写按钮。
- no-menu：无 E 菜单，直链不可进入；E1–E6 全部读写均 `403`，刷新与重登后仍不能恢复权限。
- E3 自定义 maker、第二运营员和 A2 checker：**2/2** 通过。canonical 对象锁、同载荷幂等、异载荷冲突、并发直写、checker 直写、自审、终态重放和 unknown-result 都失败关闭；批准后页面刷新可见且按原值精确恢复。
- E6 独立 maker/checker：**1/1** 通过。拒绝探针、pending 直写 `409`、maker 自审 `403`、unknown 工单 `403`、终态重放 `409`、批准与精确恢复均成立；checker 的 A4 读取为 `403`。
- E6 故障对抗：**1/1** 通过。匿名 `401`、注入 `500`、畸形 `200`、以及前一账号迟到成功响应，均不显示控制项、不会把旧结果带入 no-menu 会话，撤销注入后可恢复。

## H5 首次打开与刷新

独立搭建与 Final14 主后端同源代理的临时 H5 载体并在结束后停止；8 个新浏览器上下文，每轮均清空存储、首次打开一次并刷新一次。**8/8** 通过：每轮两次 `/api/config/platform` 均 `200`、`code=0`、`h5BaseFactor=0.6`，`#app` 均挂载，无 pageerror、无平台配置请求失败。

## A2、A4、outbox 与恢复

只读数据库复核（主验收库）：

- 本轮 E3/E6 五张工单：`approved=4`、`rejected=1`；E/E3/E6 `pending=0`。
- 本轮 E6 临时文案标记在实时配置中计数为 `0`，确认精确恢复。
- E6 对应 `compute.config_changed` outbox 为 `PENDING=2`，符合异步投递；A2 审计在授权 checker 路径为 `200`，A4 越权 checker 为 `403`。

## 证据

- 权限：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final14-nonowner-d/permission-main`
- E3：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final14-nonowner-d/e3-cas/e006-result.json`
- E6：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final14-nonowner-d/e6-maker-checker/result.json`
- H5：`bug-pic/.restricted/pc-full-acceptance-20260729-114336/E/final14-nonowner-d/h5-eight-rounds/final14-h5-eight-rounds.json`

## 载体记录

首次将旧 Final7 专用 maker/checker fixture 误指向 disposable child `3304`，密码登录得到 `401`；同一 fixture 在 Final14 Owner 所绑定的主运行时 `3002` 立即可用并完成 E3 `2/2`。这是 fixture 与运行时作用域不匹配，未记为产品缺陷，也未创建或修改账号。
