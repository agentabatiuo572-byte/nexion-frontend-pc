# 运营后台 · 交互完整性自查方案

> 目的:把「运营者点了没反应 / 动作错配 / 跳错地方 / 刷新就丢」这类**反复被主人逐个揪出**的问题,固化成**可重复的自动门**,每次 `verify.sh` 跑一遍,残留即 FAIL。不再打地鼠。

## 1. 问题根因分类(本会话踩坑归纳)

| 类 | 名称 | 典型实例 | 根因 | 检测 |
|---|---|---|---|---|
| **A** | 死控件 / 假交互 | 360 卡按钮 `confirm→toast` 不改状态;commerce 取消订单空壳 | 控件看着能点,实际无状态写 | 静态(脚本) |
| **B** | 上下文错配 | E3 任务页头挂「新增 SKU」;K4 评分页挂「新建提现规则」 | 多-Tab 组件页头「创建」动作硬编码,不随 Tab | 静态(脚本) |
| **C** | 链接目标错 | per-user KPI 跳全局看板;360 HUB 建在孤岛路由 | per-entity 元素链到全局/不可达/数据不匹配 | 静态(详情页链全局)+ 人审(可达性) |
| **D** | 数据源割裂 | 列表 `usr_84F2` vs 详情 `U-88421` 两套数据 | 同实体多套 mock + id 体系不一 | 人审 + `findUser` 兼容兜底 |
| **E** | persist 不显 | 改完刷新丢(SSR 水合时序) | 读 persist store 缺 mounted 水合门 | 静态(脚本) |
| **F** | 文档/版本漂移 | v3.5/v3.0/v3.7 三处不一;「拉盘」混过中性门 | 版本号/禁用词跨文件不一致 | 静态(脚本 + cgm-coverage) |
| **G** | 凭据反模式 | 新增运营账号想加明文密码框 | 管理员设/收他人明文密码(违最小知悉 + 抗抵赖)| 静态(脚本) |

## 2. 「真交互」标准(写控件前自检)

任何**运营动作控件**(按钮/行操作/抽屉动作)必须满足:
1. **真状态写**:点击 → 改一个持久 store(`user-ops-store` per-user / `platform-config-store` 平台级),不是只 `toast`。
2. **即时反映**:UI 立即反映新状态(行状态/计数/横幅)。
3. **审计留痕**:高敏动作写入审计流(store 的 `withAudit` / `log`)。
4. **持久**:`persist` + 读取侧 `useOpsHydrated()` 水合门(SSR 安全)。
5. **上下文正确**:多-Tab 组件的「创建」动作随 Tab 切换(每 Tab 对应实体,或无)。
6. **目标正确**:per-entity 元素点击 → 锚点/跳到**本实体**明细,不跳全局看板;详情路由对每个列表实体可达(`findUser` 兼容兜底)。

7. **凭据安全**:运营账号/任何身份创建**绝不在后台设/收明文密码**(无 `type=password` 输入);走邀请链接 / SSO / 临时密码强制改 + 强制 2FA;密码仅 server 侧 hash。

只读展示元素(纯 `<Link>` 跳转、无 `onClick`)豁免,但若放了动作按钮就必须满足上面 7 条。

## 3. 自动门(`scripts/admin-interaction-audit.mjs`)

`verify.sh all` 末段调用。覆盖可机检的 A/B/C/E/F:

- **A 死控件**:`app/components/hub/*` 卡含 `onClick` 动作 + `toast/confirm` 但未 import 真状态 store → FAIL。
- **B 页头错配**:`domain-views/*-view.tsx` 多-Tab 且页头 `right=` 是「新增/新建」类硬编码 `<Btn>`(未引用 `tab`)→ FAIL。
- **C 详情链全局**:`(console)/**/[id]/**page.tsx` 的 KPI/stat 用 `href:"/<域>/…"` 跳全局 → FAIL(应 `scrollToHub` 锚点)。
- **E persist 水合**:组件读 admin persist store 的 state 字段但无 `useOpsHydrated/mounted` → FAIL。
- **F 版本漂移**:前端 PRD 文件名 vs prd-guard 守护版本不一致 → 提示。
- **G 凭据反模式**:`domain-views/hub/(console)` 出现 `type="password"` 或 密码 placeholder → FAIL。运营账号凭据走**邀请链接 / SSO / 临时密码强制改**(操作员自设,管理员永不知晓);确属 step-up 再认证标 `// audit-ok:password`。

**豁免**:确属合理(如域级通用导出),在该文件加注释 `// audit-ok:<类>`(`no-store`/`header-action`/`detail-link`/`hydration`)即放行。

配套门(已存在):
- `cgm-coverage.mjs` — 字段级覆盖(0 gap)+ 中性语言(禁 拉盘/砸盘/庞氏…)。
- `admin-prd-lint.mjs` — PRD 中性语言 + 7 段结构。

## 4. 人审补充(脚本难判的语义项)

每个功能性任务完成后,除自动门外,人工过一遍:
- **C 可达性**:新建的详情页/旗舰是否从**自然导航路径**(列表点击 / 抽屉 / 侧栏)可达?别建孤岛。
- **D 数据一致**:列表与详情是否同一数据源 + id 体系?新 mock 实体先查是否已有另一套。
- **B 语义**:页头/行动作的语义是否真匹配当前上下文(不止「是不是 create 类」)。

## 5. 现有真状态 store(扩展时复用)

| Store(localStorage key) | 层级 | 覆盖 |
|---|---|---|
| `user-ops-store`(`nexion-admin-ops-v1`) | per-user | 设备 CRUD / 收益增删改 / 冻结 / 会话 / 2FA / 通知 / 取消订单 / 审计 |
| `platform-config-store`(`nexion-admin-platform-v1`) | 平台级 | E3 任务引擎(可扩展 SKU/质押档/phase 拨盘…) |

新运营动作:优先接这两个 store 之一(per-user 还是平台级),按 §2 六条标准实现,自动门会守住不回退。
