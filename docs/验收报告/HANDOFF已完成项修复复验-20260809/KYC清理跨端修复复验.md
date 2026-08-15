# KYC 清理跨端修复复验

## 裁决

**代码、合同和当前已验证运行态 PASS；总体生产发布 HOLD。**

## 三端结果

| 范围 | 结果 | 说明 |
|---|---:|---|
| UniApp | 4/4 | active runtime 不含 KYC 能力；大小写/标识符/CSS/路径门禁；旧深链仅做可解释迁移 |
| PC 运营后台 | 5/5 | 页面、导航、BFF、client 与 runtime 0 KYC；当前源码和构建产物非 map 扫描 0 命中 |
| 后端 | 4/4 | `KycRemovalContractTest` BUILD SUCCESS；原 `OpsTreasuryService` 残留已移除 |
| PC K4/J3 | 12/12、18/18 | K4 风险评分与 J3 防篡改能力保留，未被 KYC 清理误删 |

后端独立聚焦复审还执行了 64/64 相关测试并确认 KYC/K5 源码及编译产物 0 残留；此前后端全量 2,979 项通过、5 跳过。

## 页面连续性

旧 `pages/me/kyc` 深链没有恢复认证能力，而是精确迁移至安全设置页：

- 冷启、等待 6 秒、刷新、浏览器返回、同文档连续三次均有持久退役说明。
- toast 可以结束，但页内 `retired-flow-notice` 必须继续可见。
- “我的”和安全页不存在旧 KYC 功能入口。
- 两 fresh context 均无白屏、console error、pageerror、failed request 或 HTTP 4xx/5xx。

## PC 运行态

- 3002 PID：21564；HTTP 200。
- 磁盘/服务 BUILD_ID：`7ZYIeYwAEFrXuBQDpqaED`，一致。
- 源码 `app/components/lib` KYC 命中：0。
- `.next/server` 与 `.next/static/chunks` 非 map KYC 命中：0。
- 未登录登录壳可用；真实登录到 MFA，未绕过；合法 MFA 后 J3/K4 用户可见 UI 继续 HOLD。

## 发布边界

本轮未提交、未推送、未发布。真实 MySQL 迁移和数据保全、PC 合法 MFA 后可见路径、原生真机与生产链路仍需在冻结候选 SHA 上完成，才能签总体生产发布。

