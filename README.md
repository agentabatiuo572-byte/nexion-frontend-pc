# Nexion 运营控制后台 · 原型

Nexion 平台的**运营控制后台（Ops Console）高保真原型**。覆盖 12 个业务域、69 个模块，每个模块都配有「可控可配」的后台操作面（不只是看板展示），用于演示运营侧的全链路控制能力。

> 数据全部为本地 mock（结构对齐 server-canonical），**不接真实后端 / 真实前端原型**，仅作交互演示。

---

## 技术栈

| 维度 | 选型 |
|---|---|
| 框架 | Next.js 16.2.6（App Router） |
| UI | React 19.2 + TypeScript 5 |
| 样式 | Tailwind CSS v4（`@tailwindcss/postcss`） |
| 状态 | Zustand 5 |
| 动效 | Framer Motion 12 |
| 图标 | lucide-react |

---

## 快速开始

要求 Node.js ≥ 20。

```bash
# 安装依赖
npm install

# 开发模式（默认端口 3002）
npm run dev
# → http://localhost:3002

# 生产构建 / 启动
npm run build
npm run start
```

> 端口固定为 **3002**（dev / start 均通过 `-p 3002` 指定）。

---

## 目录结构

```
app/
├── (console)/              # 后台主框架（路由组）
│   ├── layout.tsx          # 侧边导航 + 顶栏 shell
│   ├── overview/           # B 总览驾驶舱 / 指挥台
│   ├── users/              # C 用户检索 + 深度档案 (search/[id])
│   ├── finance/            # D 资金财务（提现参数 / 双账本旗舰页）
│   └── [domain]/[module]/  # A–L 各域通用动态路由
├── components/
│   ├── shell/              # 导航、顶栏、布局骨架
│   ├── scaffold/           # archetype 脚手架（config / list / dashboard）
│   ├── domain-views/       # 各域设计稿整页视图
│   ├── archetypes/         # 控制原语组件
│   ├── dashboard/          # 总览看板组件
│   └── kit/                # 通用 UI 套件（含 charts）
├── globals.css             # 设计 token / 暗色系统
├── layout.tsx              # 根布局
└── not-found.tsx

lib/
├── admin/
│   ├── registry/           # A–L 12 域 × 模块注册表（单一真源）
│   └── module-content.ts   # 模块内容装配
├── nav/console-nav.ts      # 导航树（路由生成单一真源）
├── mock/admin/             # mock 数据（账本 / 用户 / 提现 / 运营者 …）
├── store/                  # Zustand store（鉴权 / 角色 / UI / 主题 …）
└── format.ts

docs/                       # 控制核对表 / 杠杆映射 / 评审 rubric
scripts/                    # verify.sh 回测 + nav-routes.mjs 路由生成
```

---

## 控制模型（archetype）

每个模块归属三种控制原语之一，外加少量旗舰 bespoke 页：

| 类型 | 说明 |
|---|---|
| **config** | 可编辑参数页：受控输入 + 脏检测 + 重置 + 应用变更 |
| **list** | 行详情抽屉 `rowActions`（按真实状态门控）+ `primaryAction` 新增入口 |
| **dashboard** | 只读分析 + `controlLink` 跳关联 config |
| **旗舰** | B1 双账本 / C1 用户检索 / D2 提现队列 / D5 提现参数（bespoke 完整控制） |

**权限模型**：总管理员全权限 + 全面免双签；其余角色走 **Maker-Checker 双签**（发起人不可自审，A2 全程留痕）。

12 域 / 69 模块的逐项控制核对见 [`docs/CONTROL-MAP.md`](docs/CONTROL-MAP.md)。

---

## 校验

`scripts/verify.sh` 是回测 tripwire：`tsc` 类型检查 + 全路由 HTTP 200 + 脚手架/旗舰页内容 needle 断言。路由清单由 `nav-routes.mjs` 从 `console-nav.ts` 自动生成（单一真源）。

```bash
# 需先启动 dev server（:3002）
npm run dev

# 另开终端运行回测
npm run verify
```

---

## 安全基线

`next.config.ts` 对全站路由注入安全响应头：CSP（prod 关闭 `unsafe-eval`）、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`、HSTS。属内部后台原型的演示级加固基线。

---

## 说明

- 本仓库为**源码分发包**，不含 `node_modules` 与 `.next` 构建产物，解压后执行 `npm install` 即可。
- 所有业务数据为 mock，无真实资金 / 用户 / 后端调用。
