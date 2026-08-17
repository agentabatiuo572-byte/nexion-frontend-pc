# CLAUDE.md — Nexion-admin-prototype

This file provides guidance to Claude Code when working in this repository.

Nexion **运营控制后台原型**（独立工程，dev 在 :3002）。任意 Nexion 任务先加载 `nexion-workflow` skill 判工作线；本工程代码任务走 `nexion-sprint`，运营后台 PRD 续写走 `nexion-admin-prd`。

## Heads-up: Next.js 16 + React 19 + Tailwind v4

APIs/约定与训练数据不同。触 Next 内部（App Router params、async route handlers、server actions）先读 `node_modules/next/dist/docs/`。Tailwind v4 用 `globals.css` 的 `@theme`，不是 `tailwind.config.js`。状态用 **Zustand 5** + localStorage persist；动效 Framer Motion 12；图标 lucide-react。

## Common commands

```bash
npm run dev                  # dev → http://localhost:3002
npm run build                # 生产构建
npm run verify               # 静态 tripwire（无需 dev；齿轮清单=verify.mjs 顶部 GEARS 表，序号自动派生）：tsc / mock 越界 / 工作区路径 / canon 数字口径 / 死控件 / M 客服面 / CGM 字段覆盖（默认 B9=全量，CGM_BATCH 降批）/ 旧确认残留 / 动作完整性（OPS_BATCH 收紧）/ MC 弹窗契约 / 列表分页 / 渠道+存储键 parity / 契约×8（D1·B4·J1·J2·K2–K5）/ FE-BE 映射 / kill-switch / rhythm / A2 覆盖 / 生产构建
# 亚门（可选收紧）：
npm run verify:owner-review          # 验收包闭合检查；:live 变体才探 3002/uniapp 首屏
npm run remediation:preflight        # 步步全绿后追跑 l5-final-sweep 12 检查（SKU 镜像 / uniapp port 覆盖 / 账本联验 / 走查证据聚合）
```

`verify` 是 tripwire，不是 typecheck：tsc 过 ≠ verify 过。**run-all，不 fail-fast**：红齿照记账、后面的齿继续跑，收尾一张汇总表（PASS / FAIL / SKIP / SCOPED-SKIP / NOT-RUN + 耗时），**退出码非零 ⟺ 有 FAIL 或 NOT-RUN**。档位：默认全量；`--static`（或 `VERIFY_MODE=static`）只跳生产构建（本机 131s → 77s），**scoped 绿 ≠ 全量绿**，合并守卫只认 `mode=full`；`--only <子串>` 调试用（未命中记 NOT-RUN，故必然非零退出）。缺兄弟仓 `nexion-backend` 的机器（本机即是）有 8 齿整齿 SKIP、另有 4 齿齿内跳跨仓断言 —— 汇总会逐条列出，**跳过 ≠ 通过**（memory: nexion-backend-not-in-workspace）。落盘：`.verify-exit.code`（真实退出码）/ `.verify-chain.code`（退出码 + 一行计数）/ `.verify-cache/last-run.json`（给合并守卫比树对象）。

## 完成门（宣布 done 前必走）

1. `npx tsc --noEmit` → 0 错。
2. `npm run verify` → 全绿(GEARS 全表,清单见上;必须是**全量档**,`--static` 不算,且看汇总里 FAIL=0 / NOT-RUN=0)。verify 之外、改到对应面必单跑的门:SKU 字段镜像 / uniapp port 覆盖 → `npm run remediation:preflight`。已退役：68 路由 HTTP200、旗舰 needle（旧 verify.sh 齿轮，live 探活仅剩 `verify:owner-review:live`）；「4 镜头回归」不是脚本齿轮 = 下条第 3 步。
3. 多镜头 audit：4 并行 reviewer（技术 / 初次运营者 / PM 价值 / 交互打磨），rubric 见 `docs/REVIEW-RUBRIC.md`，修到 P0=0。
4. Browser self-check（Playwright）：路由 navigate + console error=0 + 截图。**verify 绿 ≠ 渲染 OK**。
5. 清理 `.playwright-mcp/` + `*.png`。
6. PRD sync：确认后走 `nexion-admin-prd`；产品功能日志追条。

## 架构 big-picture

13 域（A–M）后台原型，mock 驱动，但**每个 store/action 必须 backend-replaceable**。

**三大单一真源（改前必认）**：
- **IA 单源** = `lib/nav/console-nav.ts`（`CONSOLE_NAV`：13 域(A–M)，L2 入口数以文件为准，每条带 id/name/path/prdAnchor/batch/status）。驱动侧边栏 + 路由解析 + 面包屑 + `scripts/nav-routes.mjs` 路由清单提取。
- **内容单源** = `lib/admin/registry/{a..m}.ts`（每模块 ListSpec/ConfigSpec/DashboardSpec），archetype 脚手架从此装配。⚠️ registry summary 是**真渲染面**（非死代码）；改枚举数必 grep 全仓「N 类」。
- **财务单源** = `lib/mock/admin/ledger.ts`（B1 双账本 LedgerSnapshot）。**所有 B1/D 域金额、覆盖率、压力比从它派生，无二源**；改阈值必 import LEDGER，禁散落硬编码。庞氏度量优先用出金压力比 e(t)（<0.7 红线），与 phase 同向。

**关键铁律**：
- **确认弹窗显式 edit 契约**：`design-kit.tsx` 操作确认弹窗「目标新值」框只看是否传 `edit`（`spec = edit ?? null`），不靠动作名正则。调参传 `edit{kind,current}`，处置不传。（旧名 MakerCheckerModal 已随双签取消退役）
- **操作确认**：高敏动作（资金/风控/合规/止血）必走确认弹窗 + 理由（≥8 字）+ A2 append-only 审计 + 24h 幂等（Idempotency-Key）。**双签已全量取消**（单人确认，2026-06 决议；B1 红线保留）。
- **字段级镜像门**：后台可编辑字段 ⊇ 前端展示字段（`sku-field-mirror.mjs` 哨兵）。
- **canon 数字口径**：staking/genesis/device/product 三端同源（`canon-sentinel.mjs`）。
- **设计系统**：V5 暗色（`html[data-theme="dark"]` 主推）+ 13 域色板 `--admin-domain-{a..m}` + 8 数据色 + 状态机色。颜色用 token 不写 hex；admin `--brand-2` 是**橙**非紫。
- 运营面串必**运营可读中文**（开发代号 / 英文标识 `ab.xxx` 降小号 mono 副标）。

**渲染结构**：`app/(console)/` shell + 旗舰页 bespoke（B1/C1/D2/D5…）；其余走 `components/archetypes/`（list/config/dashboard 3 种）+ `components/domain-views/{x}-view.tsx`（设计稿 port 整页 tab）。持久化 localStorage `nexion-admin-*` 命名空间；hydration 安全靠 `theme-provider.tsx`。改 persist 的 seed 不刷新已 persist 的浏览器（验证须清 localStorage）。

## docs（局部协议，写代码前查相关项）

- `REVIEW-RUBRIC.md` — 4 镜头评审 rubric
- `OPS-ACTIONS-MATRIX.md` — 运营动作完整性台账（动作门校验源）
- `FIELD-LEVEL-GAP-AUDIT.md` + `cgm/CGM-{A..L}.md` — 字段级覆盖审计
- `CONTROL-MAP.md` / `FRONTEND-LEVER-MAP.md` — 前端杠杆 ↔ 后台控制映射
- `ADMIN-INTERACTION-AUDIT.md` / `UI-RUNTIME-AUDIT.md` — 交互 / 运行时审计
- `remediation/` — 整改 MASTER-PLAN + PRD 同步草稿；`audit/` — 回测证据库

## 工作约定

- 代码任务走 `nexion-sprint`（单点 vs 横向组件两路径）；设计/UI/文案前加载 `nexion-design`；功能后走 `nexion-audit`；完成走 `done-review`。
- 运营后台 PRD 走 `nexion-admin-prd` skill（权威 `PRD/NexGrid_运营控制后台PRD_v4.md`；配套 admin-prd-lint hook，按 skill 约定操作）。
- 删除文件先 Move 到 `<root>\.trash\<时间戳>`，禁 `Remove-Item -Force`（用户级 PreToolUse 守卫 hook 兜底，缓存目录放行）。
