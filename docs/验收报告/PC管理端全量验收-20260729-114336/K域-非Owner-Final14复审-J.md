# K 域非 Owner Final14 对抗复审

候选 Final14；PC `3002`、后端 `8110`、真实 Chromium、`workers=1 --trace=on`。

## 复审结论

**通过，98.4/100。P0–P3=0。** 非 Owner 从真实登录及可见 K 侧栏，独立验证 K1–K6 权限五层和刷新/重登终态；未发现菜单、路由、按钮、接口或数据层的权限绕过。

`k-domain-permission-fixtures-20260728.spec.ts` 退出码 0，4/4：

- readonly、nowrite：K1–K6 均可读，写按钮不渲染，写 API 均 403；
- maker：菜单及只读数据可达，刷新/重登不漂移，未执行写入；
- nomenu：菜单、直接路由、读 API、写 API 均为 403，刷新/重登后未恢复菜单。

这覆盖 K4 的越权写入/CAS 防线与 K5 的复核权限边界：预期 403 由服务端权限门拒绝，不按产品缺陷计。Owner Final14 已在同一锁定构建完成 K4 两人并发/CAS、K5 复核、K1/K2/K3/K6 生命周期、unknown/fail-closed 与清理；本复审以新构建真实权限哨兵独立反证，没有观察到与 Owner 结论相反的越权或状态漂移。

证据：[K final14 nonowner](D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260729-114336\K\final14-nonowner-j)；命令日志 `permission.log` 与 trace 位于 `permission-playwright`。
