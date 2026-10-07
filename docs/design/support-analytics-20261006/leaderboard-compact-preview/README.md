# 专属客服业绩榜设计预览

入口为 `fixture.html`；同目录保留 `fixture.js`。使用合成演示数据，点击用于展示界面与交互，不代表真实排行、客户访问权限或业务写入。

采用[横向设计](../LEADERBOARD-ROW-BASELINE.md)、[绑定客户数](../LEADERBOARD-BOUND-CUSTOMERS.md)、[紧凑数字](../LEADERBOARD-COMPACT-DISPLAY.md)、[公共统计期](../LEADERBOARD-COMMON-PERIOD.md)和[公共单位与字体](../LEADERBOARD-COMMON-UNITS.md)。月份与单位集中在列标题下，普通行不重复；客户规模榜采用当前月参考，绑定客户数采用当前快照。三列数字共用 30px / 600 / 40px，含冠军与普通行；字体使用 3012 原型同源 Manrope，字体字节与完整 OFL 许可已内嵌 HTML，无联网字体依赖。

导出来源：视觉组件快照 `ed20affbfd2a4c7aff60eae70927398bd451aaea626138c0e73a207c771791a2`，短清单运行 `manual-1791355949283/manual`，255 项检查通过并经独立审查。公共日期阶段已关闭的 r5 记录保留，未被本次短清单替换。发布文件仅清除生成器行尾空格/制表符以通过提交检查，源、脚本语句、字体字节和许可文字不变；原始验收产物保留。发布字节为：

- `fixture.html` SHA256：`e1221a6aa3717bc89a5756a37421e06ba47347ea97831768b3f77066304dd40a`
- `fixture.js` SHA256：`e472573690d6bb39b4f6e5cef8401de6690101db046c5c51f66a24b6b581b773`
- 内嵌 Manrope SHA256：`e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f`

设计验证覆盖四榜、双币、历史月份与当前参考切换、短名称、大数字、精确值键盘查看、异常统计期/币种。独立检查 1000/1346/1415 宽度；主线已在 33106 实际刷新，21 个数字均为 30px / 600 / 40px，三列实际使用 Manrope Semibold，切榜切币与 Enter/Esc 回归通过，控制台无错误。中文按工程系统字体回退，不宣称跨平台字形完全一致。此设计预览验收不等同于后台业务集成通过。
