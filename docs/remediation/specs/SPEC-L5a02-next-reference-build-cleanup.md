# SPEC-L5a02-next-reference-build-cleanup

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L5 delivery cleanup |
| 端 | frontend(参考源) |
| 模型层级 | spec=T0; 实现=T0 |
| 关联缺陷 id | L5-CLEAN-001 |
| 关联规格卡 | `SPEC-L5a01-final-sweep-gate` |

## 1. 背景与问题

`SPEC-L5a01` 已让 L5 12 条机器终验全绿,但 Next.js 参考源 production build 仍输出交付噪音:

1. `middleware.ts` 文件约定在 Next 16 中已提示迁移到 `proxy.ts`。
2. `metadataBase` 未配置,社交图 metadata 回退到 `http://localhost:3000`。
3. `nexion-achievements-v1` 在静态生成期间触发 zustand persist storage unavailable warning。
4. `/api/gate/*` route handler 强制 `runtime="edge"` 触发 edge runtime warning。

这些不是 L5 业务阻断,但会降低交付级原型的干净度,所以作为 L5 后清理项处理。

## 2. 目标与非目标

目标:

1. Next `npm run build` 0 warning 完成。
2. 不改变 reviewer gate 行为、业务路由、页面文案或 L5 route/action 口径。
3. 清理旧 `middleware.ts` 维护注释。

非目标:

1. 不重构全站 persist store;仅修当前 build 会触发写入的 achievements store。
2. 不改 auth/gate 产品语义。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-prototype\proxy.ts`
- `D:\WORKS\PLAN\Nexion-prototype\app\layout.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\lib\store\achievements.ts`
- `D:\WORKS\PLAN\Nexion-prototype\app\api\gate\login\route.ts`
- `D:\WORKS\PLAN\Nexion-prototype\app\api\gate\logout\route.ts`
- `D:\WORKS\PLAN\Nexion-prototype\app\login\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\me\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\me\security\page.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`

## 4. 方案

- `middleware.ts` 移动为 `proxy.ts`,导出函数从 `middleware` 改为 `proxy`,保留 matcher 和 gate 逻辑不变。
- `app/layout.tsx` 增加 `metadataBase`,默认 `http://localhost:3001`,生产可由 `NEXT_PUBLIC_SITE_URL` 覆盖。
- `useAchievements` persist storage 改为 SSR no-op storage + browser `localStorage`,避免静态生成触发不可写 storage warning。
- 删除 gate login/logout route 的 `runtime="edge"`,使用默认 Node route handler runtime。
- 注释中的 `middleware.ts` / middleware redirect 迁移为 `proxy.ts` / proxy redirect。

## 5. 同形全站扫描范围

- `rg "middleware.ts|export function middleware|runtime = \"edge\"|nexion-achievements-v1"` 复核旧约定与 warning 源。
- `npm run build` 作为强证明:Next build 输出无 warnings。
- `bash scripts/verify.sh all` 和 L5 总闸证明业务与终验口径未回归。

## 6. 验收断言

1. `npm run build`(Next): 0 warning,0 error。
2. `bash scripts/verify.sh all`(Next): 230 passed,0 failed。
3. `node scripts\l5-final-sweep.mjs --run-verifiers`(Admin): 12/12 passed。

## 7. 拟新增哨兵

本单不新增独立 gate;Next build warning 本身作为交付清洁哨兵,并由 L5 总闸覆盖业务不回归。

---

## 完成回执

- `npm run build`(Next): PASS,无 warnings。
- `bash scripts/verify.sh all`(Next): PASS,230 passed,0 failed。
- `node scripts\l5-final-sweep.mjs --run-verifiers`: PASS,12/12 checks passed; routeCounts Admin 66 / Next 80 / UniApp 81。
