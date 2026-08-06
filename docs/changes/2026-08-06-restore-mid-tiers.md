# 恢复三条中间挡位:G4 阶梯定价 / F5 单笔冻结·解锁·解冻 / K1 簇收益释放参数

- **状态**:Aligned(主人 2026-08-06 派单即拍板;依据 `PRD/specs/ADMIN-MERGE-BASELINE-20260804.md` §二 1/4/5 + §六「逐条显式决定要不要恢复」的决议)
- **分支**:`pkg/restore-mid-tiers`(worktree,完成后提交本分支,不合并不推送)
- **源(只读)**:`D:\WORKS\PLAN\Nexion-admin-prototype`(rhythm-configurable 分支)

## Why

合并底账 §二 实测:admin-ops 相对原型有 8 条功能退化,共性是「文件在、tab 名在,行级动作被静默削减」。
主人拍板恢复其中 3 条「中间挡位」:

| # | 底账条目 | 域 | 退化后现状 | 恢复目标 |
|---|---|---|---|---|
| 1 | 创世节点阶梯定价档位(P1) | G4 | 只剩一口价 | 多档递进定价的增开/编辑/删除 |
| 4 | 单笔佣金冻结/解锁/解冻(P2) | F5 | 只剩不可逆红冲(冲正) | 可逆的「先按住观察」三动作 |
| 5 | 簇收益释放参数(P2) | K1 | 只剩整簇冻结 | 与冻结分开的放行细调参数面 |

## What changes(按 admin-ops 现行范式重接)

统一范式:确认弹窗(openActionConfirm / K1 Modal)+ 理由必填 + A2 审计(服务端随命令落)+ 幂等键(Idempotency-Key)。
**双签已废除,不搬回**;原型的 `pget/setParam` 本地参数范式不搬,一律重接到「client → 代理路由 → 后端契约」。
后端边界沿用主人 2026-08-04 指令(见 g4-invite-client.ts 头注):**不写后端服务接口实现**,本轮交付 admin-ops 侧
契约 + UI + 代理 allowlist + 静态契约门(GEN10b market-open-state 同款先例:契约先行,后端缺席时页面 fail-closed)。

### A · G4 阶梯档位定价(底账 §四:G4 分叉最深,逐动作核对)
- `lib/admin/g4-client.ts`:`G4Tier {id,from,to,priceUSDT}` 类型;overview 契约扩展 `tiers`(类型守卫,坏形/缺失 → null = fail-closed);
  三个 mutation(create/update/delete tier),g4OverviewMutation 通道(自带 Idempotency-Key + 回读 overview)。
- `app/api/admin/market/[...path]/route.ts`:allowlist 增 `/nex/genesis/tiers`(POST)与 `/nex/genesis/tiers/:id`(PATCH/DELETE)。
- `g4-genesis.tsx`:恢复「阶梯档位定价」卡(表格 档位/起始/截止/单价 + 增档/编辑/删档),区间连续性语义照原型
  (from 由上档截止派生、删档相邻补齐、末档总量 ≥ 已售——客户端提示,服务端权威校验);权限沿用 G4 现有 authority 体系。
- tiers 数据未下发/坏形时:卡片显示「服务端尚未下发档位数据」,不渲染增/编/删入口(钱路径 fail-closed)。

### B · F5 单笔佣金冻结/解锁/解冻
**接线核实后改走既有 A2 管线(比新开 REST 更贴现行范式,且把 manifest OPS-F-10 的虚标做实)**:
高敏操作注册表 `f_commission_status` 条目、`resolveFOp` 映射、f-view dispose 分支(`op:"dispose"` → `updateF5Config` →
`proposeFConfig` → A2 票 + 幂等 + 服务端审计)全部现存,**只有行内按钮被删**——恢复 = 在 `f5-audit.tsx` 加回按钮与
dispose 规格,`paramKey` 用行上现成的 `auditKey`(`F.commission.{id}.status`)。
- 零改动层:high-ops-registry / f1-client / teams proxy / f-view shell(全部现存)。
- `f5-audit.tsx` 行内动作(状态机照原型语义):
  - `cooling` → 「冻结」(可逆,先按住观察,不放大流出)+「提前解锁」(跳过剩余冷却 → 可提,amplify)
  - `frozen` → 「解冻」(恢复冷却/解锁链路,放行方向 amplify)
  - 权限:三动作均挂现有 `network_f5_commission_dispose`(处置族),不造新键。
  - A2 票 amplifies 由注册表 op 级决定(`f_commission_status` = true,解锁放大可提余额);弹窗 amplify 按方向标
    (冻结 false / 解锁·解冻 true),票比弹窗更保守是注册表既有决策,不改。
- 状态枚举/badge/筛选已含 `frozen`,零改动;`unfreeze` 目标值照原型 = `unlocked`(服务端权威裁决最终态),
  detail 文案如实写「恢复可提链路,等效提前解锁」。
- manifest `OPS-F-10` 补一句恢复出处 note(锚 `f_commission_status` 本就通过,行内入口恢复后由虚转实)。

### C · K1 簇收益释放参数(SPEC-7 搬回;底账 §四:原型 K1 弹窗未走统一封装 → 正好重接现行范式)
- **定性核实:释放参数是全局风控参数(原型 SPEC-7 无 clusterId),不是簇级处置**——走 `updateK1Param` 同族直连管线,
  不走 A2 簇处置路。`lib/admin/k-client.ts`:overview 契约扩展 `releaseParams`(缺席 → [] 向后兼容;在场坏形 →
  K1_RESPONSE_INVALID 严格抛,K1 契约纪律);新 mutation `updateK1ReleaseParam(key, value, reason, commandKey?)` →
  PATCH `/multi-account/release-params/{key}`(risk 代理按 head 放行,**零代理改动**);commandKey 走共享
  `commandAttempt` pending store(scope `release-param:{key}`),不继承 paramDraft 裸 useState 丢键洞。
- `k1-multiaccount.tsx`:「拦截阈值」卡下方恢复「收益释放参数」卡:
  正常释放槽位 / 待审起点 / 锁定起点 / 放行时限 / 释放模式(在线证明或人工放行 · 仅人工放行,select 禁自由文本)/
  免费槽绑定要求 等;enum/boolean 运营可读中文(禁裸工程串);number 带范围校验;
  编辑走 K1 现行 Modal 草稿范式(理由 8-200 字 + commandKey + outcome-uncertain 保留弹窗重试)。
- 簇详情补「收益影响」提示条:簇状态 → 收益桶结论(正常槽内可提 / 审核中 / 锁定奖励 / 恢复正常 / 正常释放)+ 当前参数一行。
- 「落地规则」说明条(审核中不随时间自动放行;释放只认在线证明 / 人工放行;超槽批量释放熔断)。

### 配套门(与实现同一提交落地)
- 三个**新建**本仓独立契约测试(g4-tier-pricing / f5-commission-hold / k1-release-params,任何机器真跑,
  不依赖兄弟仓)+ f-ui-permission-contract 扩展,全部注册进 `scripts/verify.mjs` GEARS(带一句为什么);
  存量 f5/k1 closure 测试因顶层硬读 nexion-backend 在本机不可运行,故不作为承载面。
- 每条新判据做红测(`scripts/_redtest-restore-mid-tiers.mjs`:逐合取项注入 → 门必红 → 工程内备份还原 → 复绿)。
- 登记义务:ops-actions manifest 三行(OPS-G-13 新增 / OPS-F-10 做实 / OPS-K-01d 新增);FE-BE map 与
  QUEST map 经探查确认不适用(前者门钉死 11 行 M 域,后者无脚本消费)。

## Out of scope
- 底账 §二 #2(二级挂单管理)、#3(H3 行内编辑)、#6(权益文案编辑器)、#7(商城显隐)、#8(D2 流程图)——未获拍板,本轮不动。
- 双签/MakerChecker 痕迹——已废除,禁止回流。
- nexion-backend 后端实现与联调(仓不在本机;verify 跨仓齿轮按「检测而非预测」如实跳过)。
- PRD 同步——P7 待主人确认后另走 `nexion-admin-prd`。
- 主副本 `D:\WORKS\PLAN\admin-ops` ——另有会话在用,全程不碰。

## Impact
- 页面:G4(g4-genesis)、F5(f5-audit)、K1(k1-multiaccount)三个 tab;不动路由/IA。
- 契约:G4/K1 overview 向后兼容扩展(新字段可缺席);F5 三个新命令端点(代理 allowlist)。
- 不变量风险:钱/风控路径 → 全动作确认+理由+幂等;fail-closed;运营可读中文;i18n 不涉及(admin 中文单语);
  颜色/组件全复用 l-card/l-btn/bdg/Modal,零新视觉。
- 预存脏改动 `package-lock.json`(devOptional→dev 元数据翻转)为环境产物,不入本包提交。

## Done-when(P6 逐条回测)
1. G4 页出现「阶梯档位定价」卡:契约注入 3 档数据时表格渲染 3 行且增/编/删各自弹确认(理由必填);
   tiers 缺席/坏形时显示未下发且**无**任何 CRUD 按钮(fail-closed 实测)。
2. F5 注入 `cooling` 行出现「冻结/提前解锁」、`frozen` 行出现「解冻」,各弹确认+理由,提交调用对应新 client 函数
   (幂等前缀正确);`unlocked/withdrawn/reversed` 行不出现这三个按钮。
3. K1 页「收益释放参数」卡渲染全部释放参数(enum/bool 显示中文标签);编辑弹窗理由 <8 字保存禁用;
   releaseMode 编辑为 select 选项集(无自由文本输入);簇详情出现「收益影响」提示条且引用当前参数值。
4. `npx tsc --noEmit` = 0;`npm run verify` 可跑齿轮全绿、跳过齿轮如实列出;新契约测试在 GEARS 且红测证明会咬人。
5. 全仓 grep 双签/二人确认词汇 0 新增(no-double-sign-terms 门绿)。

## 实施拆解(M 级,3 子任务 + 门收口;[x] 以独立 tester 报告落盘为准)
- [x] A. G4 阶梯档位定价搬回(g4-client / market proxy / g4-genesis / g4-tier-pricing 契约测试)
  - AC = Done-when 1;敏感度:钱(定价)→ tester + skeptic
  - 测试指令:node --test tests/g4-tier-pricing-contract.test.mjs;UI 走 Playwright + 契约注入
  - tester 报告:`docs/changes/2026-08-06-restore-mid-tiers-tA-test.md` — **A1-A5 全 PASS**(三档渲染/编辑弹窗/增删弹窗/缺席坏形双 fail-closed/单档不渲染删档)
  - 回源三问:恢复面=底账#1 阶梯档位 CRUD + skeptic P1 补强(读侧区间不变量 + 整表 CAS);无规格偏差;B 计划成立
- [x] B. F5 冻结/解锁/解冻搬回(既有 A2 dispose 管线 / f5-audit 行内三动作 / 新契约门 + 权限测试扩展)
  - AC = Done-when 2;敏感度:钱(佣金)→ tester + skeptic
  - tester 报告:`docs/changes/2026-08-06-restore-mid-tiers-tB-test.md` — **B1-B4 全 PASS**(状态机按钮/护栏视觉差异/A2 票请求体逐字段捕获 op=f_commission_status·value=frozen|unlocked·amplifies/503 失败态存活)
  - 回源三问:恢复面=底账#4 可逆三动作,与不可逆冲正并存分层;权限复用处置族键无新面;C 计划成立
- [x] C. K1 收益释放参数搬回(k-client / k1-multiaccount / 新契约门)
  - AC = Done-when 3;敏感度:风控放行 → tester + skeptic
  - tester 报告:`docs/changes/2026-08-06-restore-mid-tiers-tC-test.md` — **C1-C5 全 PASS**(7 参数中文化零裸枚举/下拉契约/范围门+PATCH 幂等头捕获/缺席 fail-closed/收益影响条含参数引用与兜底)
  - 回源三问:恢复面=底账#5 放行细调,SPEC-7 七参数全量(逐动作核对补回第 7 个)、语义照原型;编辑范式重接 K1 Modal(未走统一 openActionConfirm 是 K1 参数面现行惯例,与底账§四3 假阴性教训一致);无偏差
- 验收独立性备注:实现方(main)≠验收方 —— 实景验收由独立 tester agent 执行(合并三 tab 一个 agent,报告分三份);
  证伪由两个独立 skeptic 执行(diff 对抗 / 原型逐动作),main 仅回源裁决。
- 已知违纪记录:skeptic P1 修复与 tester 实景验收时间窗重叠,违反「审计期间冻结被审文件」;tester 以末态三连跑
  +HMR 供码确认补救,最终判定基于修复后末态。已记工作流进化台账,下不为例(先收齐审计→再修→复测)。
- [x] 门:tsc + verify 基线先行(记录 skip 集)→ 实现 → 全量门 + 红测 + 独立 tester×3 + skeptic 证伪 → done-review → commit

## 审计裁决记录(parity skeptic:无 P0/P1,15 条发现;main 回源逐条裁决)

**当场已修**:
- K1 数值下界无据收紧(pendingFrom/freezeFrom min 2→1,对齐原型可编辑域;上界保留为防御护栏并注明权威在服务端)——收紧的下界会让读校验误拒合法服务端值(如「第 1 个账号即待审」严格模式)。
- K1 弹窗兜底文案补回「注册」分桶口径(原型三分桶:注册、结算、提现分诊)。
- G4 档号唯一化语义(删中间档再增不撞号)补进 g4-client 契约注释,后端实现有据可依。
- 两句关键钱/风控口径(G4「在锁购买按开锁档价结算不追溯」、K1「不随时间自动放行」)补进契约门钉扎 + 红测(22/22)。

## 审计裁决记录(diff skeptic:P1×2 + P2×11;main 回源逐条裁决)

**P1 全修**:
- P1-1 tiers 读侧守卫补齐区间不变量(整数/价>0/to>from/从 0 连续/id 唯一/末档≥已售),任一违反整组
  fail-closed + console.error 留样本——只查字段级会让「显示取整、编辑拒存」三处契约互相矛盾,并对
  乱序档渲染假「顺移」声明。契约门同步钉住全部不变量 + 红测。
- P1-2 档位三 mutation 契约补 `expectedTiersVersion` 整表 CAS(overview 带 tiersVersion 回传);
  幂等键只防重复防不了两运营基于旧档表并发互踩(项目铁律「并发≠重复:要 CAS 不是幂等键」)。
  gtint 明示「后提交的会被拒绝并需重读」。契约门 + 红测钉住。

**P2 当场修**:dispose 完成 toast 由「已生效」改「已提交 · A2 待执行队列」(冻结是抢时间动作,
谎报完成会让运营提前撤场;契约门 + 红测钉住诚实话术)· K1「冻结建议线」一词两义补限定词
(簇冻结建议强度 0-1 vs 重复账号冻结线第 N 个账号)· F5 金额格式钉 en-US(防运营机 locale 渲染
成 1.234,5)· OPS-K-01d note 补两条后端契约约束(七键原子上线禁部分数组;跨字段 待审起点≤冻结线
服务端校验)· OPS-G-07/G-13 互指仲裁注记 + view 后缀对齐 · 增开档位 detail 补 B1 负债预检句 +
amplifies 挂 coverage.redlineBreached · 本文档措辞与勾选卫生修正。

**记档不修(既有面/后续包)**:F 域 propose 无稳定命令号(不确定失败重试=换新号,F1-F4 同病,
需整域接 pending store,另开任务;已由同分支后续提交落地,见 `2026-08-06-f-pending-store.md`)· dispose 后行不即时刷新(票在队列,页面状态靠重读,与 F 域
现行为一致)· 红测未覆盖全部合取项(已覆盖 27 项含全部新增判据,余为采样覆盖)。

**拍板结果(主人 2026-08-06「按建议做」)**:
- 单价仲裁 → 方案 A:tiers 在场时「一级单价」只读 + 标「按阶梯派生」+ 函数级双保险,调价唯一入口=档位卡;
  OPS-G-07/G-13 note 双向记决议;契约门 ③b + 红测 G4⑪ 钉住。
- 冻结线语义 → 方案 A「仅建议」:达线只生成人工冻结建议,收益自动落锁定桶仅由超槽熔断触发;
  落地规则 tint 改写消除分叉;OPS-K-01d note ③ 记后端契约;契约门补「仅生成冻结建议」needle。
- PRD 同步 → 方案 B:留待分支合并主线时随合并批次走 nexion-admin-prd,后台产品更新日志届时一并定。

拍板落地的实景复证(main 以 Playwright 网络层契约注入实测,2026-08-06):
- 单价仲裁:tiers 在场 → 单价行「按阶梯派生」徽标 ×1、说明替换为派生口径、调整按钮 0;tiers 缺席 →
  徽标 0、调整按钮 1、原说明恢复。两变体切换实测通过。
- 冻结线口径:K1 页 10/10(七参数行、「仅生成冻结建议」在场、旧「或人工冻结后进入锁定奖励」绝迹、
  卡 sub「簇冻结建议强度(0-1)」消歧、中文标签零裸枚举、收益影响条引用 fixture 三值逐字命中)。
- 附带复证:档位卡 3 档 + 增/编/删入口、缺席变体全 fail-closed(增开/编辑/删档 = 0/0/0)。
- 备注:本轮探针曾因两处 harness 自身问题假红(路由通配把演练子端点劫持成 overview 形状;
  K1 读端点实为 /multi-account/overview 带后缀),均为探针修正,非应用缺陷。

**记档不修(有意取舍,汇报主人)**:
- K1 释放参数编辑无 amplifies/B1 机器标记——与 K1 现行拦截参数 Modal 范式一致(该范式本身无此概念),以落地规则 tint 文字补偿;若日后 K1 参数面升级 amplifies,释放参数应一并挂上。
- F5 按钮级 ⚡ 放大标记未保留(admin-ops F 域现行按钮无此视觉语言,放大护栏在弹窗层);F5 rail「处置口径」汇总卡未搬(现版页面无 rail 结构,口径在各弹窗 detail)。
- G4 原型 gtint 两句「前端 tierForSold 单源/前端 fail-closed 回退」用户端镜像口径未搬——uniapp 侧当前语义待产品确认后再定去留。
- per-param 中文说明/前端影响说明移交服务端 name/sub/note 字段(契约钉字段在场,不钉内容)——契约先行架构的固有取舍。
