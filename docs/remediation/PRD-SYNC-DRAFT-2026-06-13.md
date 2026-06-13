# PRD Sync Draft — 2026-06-13 L5 Closure

> 状态: draft-only, waiting-owner-confirmation
> 边界: 本文件是可执行同步草案,不改 canonical PRD 正文。主人确认后,再按 `nexion-prd-sync` 将正文片段写入 `D:\WORKS\PLAN\PRD\...`。

## 1. 产品 PRD v3.7 同步草案

Target: `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v3.7.md`

### 1.1 §3.3 完整路由清单 — UniApp 交付主体说明

建议位置: §3.3 路由代码块之后、`## 4. 账户与身份` 之前。

```md
#### UniApp 交付主体路由覆盖

用户端交付主体为 `Nexion-uniapp`。截至 L5 终验,Next.js 参考源 80 个路由已全部映射到 UniApp 81 个 pages;唯一新增页为 `/onboarding/terms`,用于承接服务条款确认。Next.js 版本仅作为行为参考源保留,后续业务验收以 UniApp 路由覆盖、i18n 镜像、运行时动作 proof 与三端 canon gate 为准。

验收口径:
- Next reference routes: 80/80 covered.
- UniApp pages: 81 pages.
- 路由缺口: 0.
- 阻断类动作缺口: 0.
```

### 1.2 §4.4 KYC-Express / §9.2 Top-up / §9.3 Withdraw — 充值与提现闭环

建议位置 A: §4.4.2 流程之后。
建议位置 B: §9.2.4 业务规则之后。
建议位置 C: §9.3.1 流程之后。

```md
KYC-Express 与充值共用 `/me/wallet/topup?kyc=1` 入口。用户从提现触发 KYC 时,top-up 页面必须显示 KYC 状态、验证金额、当前链路和验证完成后的提现解锁说明;完成后返回提现流程继续填写网络、地址、金额与风险披露确认。
```

```md
充值记录写入规则:
- regular top-up 写入钱包账单,保留 channel / network / amount / txHash / status。
- KYC top-up 同步写入 KYC verification 状态,并把已验证钱包地址作为提现地址一致性校验依据。
- 充值页必须区分 regular top-up 与 KYC-Express top-up,不得只展示静态说明。
```

```md
提现提交闭环:
- 未 KYC 用户先进入 KYC-Express,完成后回到提现页继续提交。
- 提现提交必须生成 tracking record、wallet bill 与 contribution points 事件。
- `/me/wallet/withdraw/tracking` 必须展示 pending / review / paid / rejected 等状态轨迹,并允许从 bill hash 反查。
```

### 1.3 §8 Team — 四个 finance 入口必须真导航

建议位置: §8.1 团队主页或 §8.6 佣金事件之后。

```md
Team finance controls:
- Commissions: 展示 5 类佣金事件明细,入口必须可从 Team 主页到达。
- V Rank: 展示 V0-V12 进度、晋升条件、维持期与奖品/培育奖。
- Balance Match: 展示双轨 balance、弱区/强区、日封顶与 spillover 逻辑。
- Leadership Pool: 展示全球领导奖池、参与资格、分配周期与说明页。

以上四入口不得为占位按钮;点击后必须进入对应业务页面或任务式说明页,并保留 i18n copy。
```

### 1.4 §9.4 / §9.5 / §9.6 — Exchange、Repurchase、Staking 资金动作

建议位置: 分别追加到 §9.4.1、§9.5.3、§9.6.2。

```md
NEX↔USDT 兑换确认必须展示 from/to amount、rate、fee、KYC/cap 状态与兑换后余额预估。确认后写入 swap record、wallet bill 与 points/cap 变化;失败时不得只 toast,必须保留原余额并展示失败原因。
```

```md
复投确认必须展示复投金额、获得 points、进入 stake/cap 的影响与账单摘要。确认后写入 repurchase event、wallet bill、points delta 与 active stake/cap 变化。
```

```md
Staking 开仓必须展示档位 APY、锁期、提前退出 penalty、预计收益和最小质押额。确认后写入 active position 与 wallet bill;用户端展示值必须与后台 G1 参数源一致。
```

### 1.5 §9.11c / §13 关键参数集 — canon 数字口径

建议位置: §9.11c 参数清单之后,并在 §13 业务规则中交叉引用。

```md
核心数字口径必须三端同源:
- staking: APY / penalty / minStake / lockDays.
- Genesis: slot price $24.08、年化 87.9%、royalty/dividend、一级/二级市场开关。
- 设备生命周期: decay -4% / -6% / -23.7%, floor 22%, salvage formula.
- 商品与收益: SKU price、daily earning、route threshold、trial price。
- Team: unilevel 7 层、V Rank 条件、binary cap、leadership pool rule。
- Wallet: withdraw min / fee / cap / KYC gate。

任何端修改上述数字必须同步更新机读 canon source,否则验收失败。
```

### 1.6 §14 国际化 — 双语镜像验收

建议位置: §14 国际化章节的验收规则处。

```md
i18n 验收规则:
- zh/en key mirror 必须 0 diff。
- 语言切换必须在 top-up、staking、team、wallet 等核心业务页即时改变可见 copy。
- 用户可见文本不得出现裸 key、mock/demo/simulated/fake 等开发态词。
- 新增业务页必须先补双语 key,再进入验收。
```

## 2. 运营后台 PRD / 开发规格同步草案

Targets:
- `D:\WORKS\PLAN\PRD\Nexion_运营控制后台PRD_v4.md`
- `D:\WORKS\PLAN\PRD\Nexion_运营控制后台_开发落地规格.md`
- `D:\WORKS\PLAN\PRD\Nexion_运营后台_交互与确认机制改写SPEC.md`

### 2.1 全局弹窗契约 — 业务字段不是通用壳

建议位置:
- Dev spec §0.3 操作确认之后。
- Dev spec §9 弹窗交互规格总表之前。
- 交互与确认 SPEC §2 模板之后。

```md
业务弹窗契约:
- 每个弹窗必须声明 trigger、business target、required input、validation、write action、audit reason、success feedback、persisted echo。
- 弹窗内容必须匹配按钮语义:改角色必须有 role selector;改授权必须有 permission diff;编辑文案必须有 zh/en 字段;创建课程必须有 title/body/category/duration;提现处置必须有 approve/reject/delay/freeze 业务选项。
- 只有 reason textarea 的 edit/create/repair/role/permission/action 弹窗视为 business-incomplete-modal。
- 纯展示弹窗必须显式标 readonly,不得出现可执行主按钮。
- 高敏动作仍使用 confirm-with-reason 外壳,但业务表单体必须在确认外壳内可操作。
```

### 2.2 全后台列表能力五件套

建议位置: Dev spec §0 全局铁律新增一小节,或 §8 现状↔目标差异表之后。

```md
列表能力基线:
- 数据列表必须提供分页或显式小表豁免。
- 默认五件套: pagination、search、filter、sort/status、empty state。
- 小表豁免只允许用于固定短列表、配置摘要、KPI 摘要;豁免必须在页面或规格中声明理由。
- 资金、提现、账单、工单、用户、审计、内容记录类列表不得豁免分页。
```

### 2.3 `/content/support` 支持后台

建议位置:
- v4 §14 内容与合规 CMS 的 I 域控制面。
- Dev spec §2 域 I 数据模型、§3 域 I API、§9.9 I 弹窗规格。

```md
Support CMS / Ticket Ops:
- FAQ 管理: 创建、编辑、发布、下架、排序、分类。
- Ticket 分类/SLA: category、priority、owner、SLA target。
- 工单处理: 回复、关闭、重开、改 owner、改 priority、写 audit reason。
- 工单列表必须支持分页、搜索、状态筛选、owner/priority 筛选和空态。
- 所有写动作必须刷新后仍可见,并写入 audit feed。
```

### 2.4 平台参数寄存器 owner-link

建议位置: Dev spec §4 参数配置总表前言或 §4.X 易混淆/校验铁律。

```md
平台参数寄存器只做索引和导航,不复制 owner module 的权威配置表。每个参数必须有 owner domain、owner module、canonical field、read source、write route 与 owner-link。用户从参数寄存器点击 owner-link 后,必须能进入 owner 页面完成真实业务操作;例如 G1 staking APY/penalty/minStake 的写入口归 G1 owner module,寄存器只展示并跳转。
```

### 2.5 PRD 唯一性治理

建议位置: Dev spec 附录维护约定,或 v4 §17.5 跨文档一致性。

```md
PRD canonical 治理:
- 产品 PRD canonical 路径固定为 `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v3.7.md`。
- 运营后台 canonical 文档固定为 `D:\WORKS\PLAN\PRD\Nexion_运营控制后台PRD_v4.md` 与 `D:\WORKS\PLAN\PRD\Nexion_运营控制后台_开发落地规格.md`。
- `_bak/`、`_bakF/`、remediation backups 不参与唯一性判断。
- hook、verify gate 与同步流程只认 canonical 文件。
```

## 3. 不同步项

以下只留在 remediation/spec/verify 文档中,不进入 PRD 正文:

- `l5-final-sweep.mjs`、`canon-sentinel.mjs`、verify 日志与具体脚本命令。
- Next `middleware.ts` -> `proxy.ts`、`metadataBase`、SSR no-op storage、route handler runtime 等技术清理。
- Windows/WSL fallback、PowerShell/curl/node 兼容说明。

## 4. 建议执行顺序

1. 主人确认 PRD 同步范围。
2. 批 1: 同步产品 PRD v3.7 的用户端业务闭环、Team/Wallet/i18n/canon 参数。
3. 批 2: 同步运营后台 PRD/开发规格的弹窗契约、列表能力、支持后台、参数 owner-link、PRD 唯一性治理。
4. 同步后运行 PRD guard + L5 final sweep,确认 canonical 路径、feature mapping 与三端 verify 仍全绿。
