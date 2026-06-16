# Nexion 运营控制后台 — 投产就绪 Checklist

> 本清单是运营控制后台(Ops Console,12 域 / 68 个 8 段功能子模块 / V1–V4 四卷 PRD)从**规格定稿 → 工程实装 → 正式上线**的就绪总账。逐项核对、签核后方可投产。来源:PRD V1–V4 + Ch17 全局总收口 + 附录 A + nexion-audit 实战经验。
>
> **状态图例**:`✅ 已就绪` / `🔧 待开发`(规格已定,代码未实装)/ `🔴 Blocking`(投产前 must-finish,不做则降级或事故)/ `🟡 待确认`(需 PM / 法务 / 运营拍板)/ `—` 不适用。
> **核对方式**:每项 `- [ ]` 勾选即视为通过;`PRD §` 为可追溯依据;`负责` 为建议责任方。

---

## 0. 投产门禁(GO / NO-GO 总闸)

**下列任一未满足 = NO-GO,不得上线:**

- [ ] 🔴 A4 事件 domain/schema 扩展四批工单全部完成(见 §B.1,BI 与漏斗的地基)
- [ ] 🔴 资金类操作(提现放行 / 余额调整 / 各类派发)credit/debit + 账单 + 失败回滚链路实装并通过对账(见 §D)
- [ ] 🔴 B1 兑付覆盖率红线前置硬门在所有"放大流出"写操作上生效(见 §D.2)
- [ ] 🔴 操作确认(Confirm-with-Reason)在全部高敏动作上 server 强制:reason 非空 400 + 审计落 A2 + 放大流出 B1 红线 422 + 高敏流水/实时告警(见 §C.2)
- [ ] 🔴 server-canonical:所有门禁/资金/状态判定服务端权威,client 不可篡改(见 §C.1)
- [ ] 🟡 5 项 PM 决策全部落地确认(见 §A.2,当前文档层已闭环)

---

## A. 文档与决策就绪

### A.1 规格完整性
- [ ] 12 域 68 个 8 段功能子模块规格齐全,每子模块可追溯前端 §锚点 + 业务目标 + 数据 + 接口 + 状态机(PRD V1–V4)
- [ ] 全局数据模型 / API / 横切机制总表已收口(PRD §17.1 / §17.2 / §17.3)
- [ ] 完整 §3.14 跨域归属总表无冲突、每能力权威唯一(PRD §17.4)
- [ ] 四卷 lint 全绿(中性运营语言 + 8 段结构)

### A.2 PM 决策闭环(PRD §17.6)
- [ ] Genesis 日分红率 = **0.1%/日**(§A.1 row5;前端 §10.3=1.5% 笔误待订正)
- [ ] Lucky Spin 转盘奖池 + 概率已裁定(8 档 / 档位可增删 2–12 / server 校验和=100)(V3 Ch13 H4)
- [ ] reinvestMultiplier 复投倍率消费面 = **G7**(V3 已订正)
- [ ] B1 红线拒绝码全卷统一 = **422**(auth/authz 类 403 保持)
- [ ] 应急熔断 = **2026-06 操作确认决议**:授权角色(风控/财务/超管)单人经确认弹窗+理由必填即时执行 + 全运营广播 + A2 审计;恢复 = 仅超管 + B1 红线前置(422);`emergency.breakglass` 权限位不登记(确认契约已覆盖)

---

## B. 投产前技术 Blocking 🔴(最高优先级)

### B.1 A4 事件 domain/schema 扩展四批工单(BI cutover 前 must-finish,PRD §17.5c / 附录 A.2)
- [ ] 🔴 V3 批:`event` / `milestone` / `nex` / `premium` / `repurchase`(#14)
- [ ] 🔴 V4-I 批:`content` / `notification` / `disclosure` / `learn`(#16)
- [ ] 🔴 V4-J 批:`risk.tamper_detected` / `admin.emergency_playbook_*` + `admin.killswitch_toggled` 属性扩展(#19)
- [ ] 🔴 V4-L 批:`admin.report_exported` / `admin.bi_query_run`(#21)
- [ ] 每批经 A4 schema 变更确认弹窗(A2-MD1,§2.4.8);扩展前占位事件已迁回正式 domain
- [ ] BI(L 域)对占位期事件的 union 兜底已切换至正式 domain

### B.2 前端 PRD 内部矛盾上报订正(PRD 附录 A.1,后台不擅改前端)
- [ ] Phase dial 数前端补 newUserBonusMultiplier + questBonusMultiplier(后台权威 10-dial)
- [ ] 双轨日封顶前端 §8.4 改为可变描述(月1-6=5000/月7+=2000)
- [ ] 提现冷却前端补月8=35d 中间档
- [ ] KPI 章节序号统一 §18.2
- [ ] Genesis 分红率前端 §10.3=1.5% 订正为 0.1%
- [ ] 前端文档编号瑕疵簇(§14/§15 子节号、§11.3 计数、§11.0A wrapped、§5.1.1 软锚)
- [ ] `evt-spring-spin` subtitle 删「or a Genesis Node」(已在原型订正)

---

## C. 横切机制实装验证

### C.1 server-canonical(PRD §9.11d / §17.3a)
- [ ] 所有状态机推进 / eligibility / 结算 / 价格费率 / 锁仓到期 / 晋升判定 / kill 状态 server 权威
- [ ] 概率型机制(Lucky 倍率 / 转盘 RNG / chargeFailRate)server 裁决 + `NODE_ENV` guard,生产不落客户端随机函数
- [ ] localStorage / client 不持任何门禁/资金/安全判定字段(免费次数、ack 态、phase override 等均服务端)
- [ ] §9.11d.2 列举的篡改路径(伪造老化设备 / phase pin / 重置试用 / 伪造里程碑)server 拦截 + J3 可观测

### C.2 操作确认与理由留痕(PRD §2.x A2 / §17.3b)
- [ ] 余额/资产调整 · 大额提现放行 · 参数批改 · kill-switch · impersonate · 内容/披露发布 · 佣金撤销补发 · 含 PII/资金/监管批量导出 —— 全部经业务专属确认弹窗 + 理由必填即时执行(A2③ 高敏动作清单全量覆盖,弹窗规格=各卷 ④a + 落地规格第 9 章总表 204 弹窗)
- [ ] 高敏端点 reason 缺失 server 返 400 `REASON_REQUIRED`(下限 8 字);写入与审计同事务,失败无副作用
- [ ] 高敏动作落审计同时进入 A2②b 高敏操作流水(资金/大额置顶)+ 实时告警超管与对应域 lead(单人执行的事后监督补偿)

### C.3 幂等与原子性(PRD §9.11e)
- [ ] 资金/资产写入端点强制 `Idempotency-Key`(24h dedup);retry 不重复扣款/入账/放行
- [ ] 放行的目标域写入经事务边界一次性提交;失败工单保持 pending、目标域无副作用

### C.4 审计(PRD §2.4.5⑥ A2)
- [ ] 统一审计 schema(who/when/action/object/before→after/reason/IP)append-only,无编辑/删除入口
- [ ] 各域新增 admin.* / risk.* 事件全部在 A4 registry 注册并由 A2 承载留痕(§9.3④ 待注册清单清零)

### C.5 埋点优先(PRD §2.4 / §17.3c)
- [ ] 所有看板/KPI/漏斗/资金口径派生自 A4 事件流,只认 `is_server_authoritative=true` + §2.4.6/§2.4.7 锁定口径事件
- [ ] 身份模型 anon_id→user_id 贯通;通用属性(ts/phase/cohort)齐全

---

## D. 资金与兑付安全 🔴

### D.1 双账本(PRD B1/B2 + D3 / §17.3e)
- [ ] 真实储备聚合口径实装(topup+注入−已确认出金−未到期 staking 本金)
- [ ] 应付负债 8 科目实装;trial shadow 按 Model A 仅 remainderUSD+全额NEX 入余额成应付(offsetUSD 是购机折扣非负债)
- [ ] 兑付覆盖率 = 储备÷负债 由 B1 计算裁决;`withdraw.confirmed` 储备与负债同时核减

### D.2 兑付覆盖率红线前置(PRD §1.8 原则一 / §17.3b)
- [ ] 🔴 所有"放大流出"写操作(降 cooldown/points、升 cap/APY/分红率/费率、kill 恢复、升活动/转盘奖励)提交即 server 核 B1 覆盖率
- [ ] 🔴 覆盖率低于 `coverageRedLine`(默认 100%)server 拒绝提交(统一返 **422** + 当前覆盖率)
- [ ] NEX 计价负债以拟生效新价重估(含锁仓本金 USDT 等值)后再判红线

### D.3 资金操作 credit/debit 原子性(PRD D 域 / nexion-audit 规则#6)
- [ ] 提现放行 / 余额调整 / 各类派发(commission/trial/staking/genesis 分红/quest/milestone/event/转盘)实际 credit/debit + 账单 + 失败回滚 + 失败提示,非仅 toast
- [ ] 全站同形 credit*/debit* 调用点逐个补全(grep 验证无遗漏)
- [ ] 提现状态机(submitted→review→processing→sent→confirmed + 失败态)全 server canonical

---

## E. 权限 / RBAC / 审计

- [ ] 7 角色(超管/财务/风控/增长/内容/客服/只读审计)+ member/lead 层级实装(PRD §1.1)
- [ ] 角色×动作矩阵 server 强制(无权角色绕过前端调 endpoint 仍 403)
- [ ] 合规复核职能映射明确(V1 由风控承担,KYC复审/风险披露/监管报送/法务审批执行=风控 lead/超管)
- [ ] impersonate 只读 + ≤30min 限时 + 全审计 + 确认弹窗(理由必填)
- [ ] 运营账号 session 时限独立于用户侧(滑动 30min / 绝对 8h)
- [ ] 各域 ⑥ 段旧角色命名统一映射 §1.1(附录 A.2 #6)

---

## F. 合规

- [ ] 风险披露 version × jurisdiction 双维 re-ack;ack 态 server-canonical,改版触发受影响法域用户 re-ack(I5)
- [ ] disclosure ack 与 KYC 为两道独立 gate(C4 仅供 jurisdiction 输入)
- [ ] geo-block 国家级屏蔽 + per-endpoint 派生(genesis/exchange/trade-in)+ 边缘 IP 判定(J2)
- [ ] 信任中心财报数字 / NEX 叙事 / Stella 宣传语经 CMS + 确认弹窗(I4-MD1,执行=内容/风控 lead,合规审查前置)管理,无未授权虚假宣传(I2/I4)
- [ ] 用户侧全程中性真平台语言,0 meta(无 phase id / MLM 词 / mock 暴露)

---

## G. 风控与反作弊(K 域)

- [ ] 反多账户引擎 K1(IP/设备指纹/支付工具三层去重)产 `risk.multi_account_flagged`
- [ ] 套利/刷量检测 K2(trade-in套利/welcome gift刷取/刷榜)产 `risk.arbitrage_suspected`
- [ ] 提现风控规则引擎 K3(速度阈值/大额路由)
- [ ] 风险评分 K4 为权威源,B5 雷达 / D2 路由只读引用
- [ ] 组合攻击三层叠加分级预警(§9.11e.1:≥2 层预警转人工 / 3 层判闭环)
- [ ] trial 循环养号 K2 产 / H2 消(`risk.trial_cycle_detected`);冷却期边界守卫 server canStart()
- [ ] 排行榜取消资格执行归 F8,复用 K1 去重 + 消费 K2 信号

---

## H. 应急与 Kill-Switch(J 域)

- [ ] Kill-Switch 矩阵 J1:6 闸(staking/genesis/exchange/trial/nexv2/premium)统一权威面,各域 endpoint server enforce kill 态
- [ ] kill 默认 enabled=true(未熔断常态);熔断=单人确认弹窗(理由+触发依据)+ 广播 + 审计
- [ ] kill 恢复(disable→enable)= 放大流出,仅超管 + 前置核 B1(低于红线 422)
- [ ] kill 状态 V1 A3 存储 → V4 J1/J2 管理面迁移完成;B5 状态灯单一源
- [ ] V3 G 域 per-product kill 事件收敛为 `admin.killswitch_toggled`(载荷迁移,附录 A.2 #20)
- [ ] 篡改防御监控 J3 看板(client 篡改尝试被 server 拦截的计数/告警)
- [ ] 监管点名应急 SOP J4 剧本(kill+geo+披露切换+提现暂停+通知 组合处置)
- [ ] kill / geo / 篡改事件落 A4 + A2 + B4/B5/K4

---

## I. 数据与 BI(L 域)

- [ ] L1 KPI 看板八项口径锁定 §2.4.6(不在 L1 重定义);各 KPI server 聚合锚点正确
- [ ] L2 漏斗/cohort/留存完整下钻(兑现 B3 预声明的 V4 下钻);与 B3 驾驶舱同口径单一源
- [ ] L3 财务报表只读引用 B1/D3/B2(不重算储备/负债/覆盖率);`genesisDividendUsdt` 字段名全卷统一
- [ ] L5 导出全部落 `admin.report_exported` 审计;含 PII/资金/监管批量导出经确认弹窗+理由必填(超限/解密仅超管)+ 脱敏
- [ ] BI 聚合非临时 SQL,由 A4 事件库预聚合/物化;任何数字可追溯到事件 + 口径

---

## J. 12 域子模块验收 gate

> 每域所有子模块通过:参数有默认+范围+生效时机 · 操作有审批+审计 · 接口 server-canonical 说明 · 失败态/边界/并发覆盖 · 开发可直接实现。

- [ ] A 平台基础(A1 RBAC / A2 审计&操作确认 / A3 系统配置 / A4 埋点体系)
- [ ] B 总览驾驶舱(B1 双账本 / B2 负债 / B3 漏斗 / B4 节奏 / B5 风险雷达)
- [ ] C 用户与账户(C1–C6)
- [ ] D 资金与财务(D1–D5 提现审核队列 / §9.11f 状态机)
- [ ] E 设备与商城(E1–E5)
- [ ] F 分销与团队(F1–F5)
- [ ] G 金融产品(G1–G7)
- [ ] H 增长与节奏(H1 Phase 调度 10-dial / H2 Trial / H3–H6 增长活动)
- [ ] I 内容与合规 CMS(I1–I7)
- [ ] J 紧急与合规控制(J1–J4)
- [ ] K 风控与反作弊(K1–K5)
- [ ] L 数据与分析 BI(L1–L5)

---

## K. 上线 / 灰度 / 回滚

- [ ] 后台与前端真后台对接联调(前端 §9.11a–f endpoint 全链路打通,占位 endpoint 收敛 §9.2⑥ 单一路径)
- [ ] 各域 kill-switch / feature flag 上线即可用(应急可一键止血)
- [ ] 灰度发布方案(分批放量 + 关键 KPI/覆盖率/风控信号实时监控)
- [ ] 回滚预案(配置回滚 / kill 全量 / 数据快照);高敏操作流水与审计在回滚后可追溯
- [ ] 监控告警:兑付覆盖率红线、异常账户簇、提现速度、kill 触发、篡改告警接入值班
- [ ] 压测:提现队列 / 转盘派彩 / 签到峰值 / 事件流写入

---

## L. 签核

| 维度 | 责任方 | 签核 | 日期 |
|---|---|---|---|
| 规格与决策(A/B) | 产品 PM | ☐ | |
| 资金与兑付安全(D) | 财务负责人 | ☐ | |
| 权限/合规(E/F) | 合规/风控负责人 | ☐ | |
| 风控/应急(G/H) | 风控负责人 | ☐ | |
| 技术实装与横切(C/I/J/K) | 技术负责人 | ☐ | |
| 投产 GO/NO-GO | 超级管理员 | ☐ | |

---

> **一句话**:四批 A4 工单(§B.1)+ 资金 credit/debit 链路(§D.3)+ B1 红线前置(§D.2)+ 操作确认 server 强制(§C.2)+ server-canonical(§C.1)是五条 NO-GO 红线;其余按域 gate 逐项核对。全套 PRD(V1–V4)是规格权威,本清单是其投产映射。
