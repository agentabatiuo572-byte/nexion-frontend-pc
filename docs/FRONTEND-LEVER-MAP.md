# H5 前端杠杆 ↔ 运营后台控制 · 逐一核对表(grounded)

> 当前口径 · 对着 **UniApp 前端真实路由**(`D:\WORKS\PLAN\Nexion-uniapp\src\pages\**`)逐个用户可见杠杆核对后台是否有对应控制面。
> 不再凭 PRD 臆测;每行 = 一个真实前端页面/杠杆 → 它在 admin 的控制入口(域·模块·路由)→ 控制动作。
> 状态:✅ 有控制面 · ⚠️ 薄弱/建议补强 · ❌ 缺口。

## 资金与钱包(/me/wallet · /staking · /genesis)
| H5 前端杠杆(用户页) | 用户能做什么 | 后台控制(admin 路由 · 模块) | 控制动作 | 状态 |
|---|---|---|---|---|
| /me/wallet/withdraw(+tracking) | 发起提现 | /finance/withdrawals(D2)+ /finance/params(D5) | 受理/放行/延迟/冻结(操作确认,红线核验)+ 日限/费率/冷却 调整 | ✅ |
| /me/wallet/topup | 充值入金 | /finance/recon(D1) | 逐笔对账/核销/挂账 + (充值通道开关见 A3 特性开关) | ✅ |
| /me/wallet/cards(+/new) | 绑定支付方式 | /finance/recon(D1)支付渠道/PSP 配置 | PSP 通道启停(Toggle)+ BIN 风险规则/路由/限额 调整(操作确认) | ✅(2026-06-03 已补) |
| /me/wallet/exchange | NEX↔USDT 兑换 | /finance-products/exchange(G2) | 单笔/日/月 cap 调整(操作确认·放大流出)+ 超阈值 gate | ✅ |
| /me/wallet/nex · /market | NEX 行情/持有 | /finance-products/market(G3) | 做市参数调整 + 紧急 pause(操作确认) | ✅ |
| /me/wallet/nex-v2-lock | NEX v2 锁仓 | /finance-products/nex-v2(G6)+ /emergency/kill-switch(J1) | 锁期/APY 配置 + kill 开关(已熔断) | ✅ |
| /me/wallet/premium | Premium 订阅 | /finance-products/premium(G5) | 档位/权益/kill 调整 | ✅ |
| /me/wallet/repurchase | 复投 | /finance-products/repurchase(G7) | 奖励率/门槛调整 | ✅ |
| /me/wallet/bills | 账单流水 | /finance/ledger(D4) | 账本/6 类 bill 审计 + 冲正联动 | ✅ |
| /me/wallet(余额) | 余额/资产 | /users/assets(C3) | 余额调整(操作确认) | ✅ |
| /staking(+how-it-works) | 质押 | /finance-products/staking(G1) | 各档 APY/罚金/单档 kill(操作确认·放大利息负债) | ✅ |
| /genesis(+marketplace/holder) | 创世节点一二级 + 排放 | /finance-products/genesis(G4) | 供给/排放率/二级版税/紧急 pause(操作确认) | ✅ |

## 设备与商城 / 收益(/store · /earn · /me/devices)
| H5 前端杠杆 | 用户能做什么 | 后台控制 | 控制动作 | 状态 |
|---|---|---|---|---|
| /store(+/[productId]/bundle/checkout) | 浏览/购买设备 | /devices/pricing(E1) | 新增 SKU(拖拽+1:1)+ 定价/上下架 + 代际发布门 · **字段级✅**(OpsSku 镜像前端 Product 26 字段,2026-06-04) | ✅ |
| /store/orders(+/[id]) | 订单状态 | /devices/orders(E4) | 状态机 + 退款/取消/补建终态(操作确认) | ✅ |
| /me/devices | 我的设备/算力 | /devices/trade-in(E3 含生命周期)+ /devices/ops(E5) | 衰减/到期 + DC pause/恢复 | ✅ |
| /earn | 算力任务赚收益 | /devices/tasks(E2) | 6 类任务定价 + 队列饱和度调度(操作确认) | ✅ |

## 分销与团队(/team/**)
| H5 前端杠杆 | 用户能做什么 | 后台控制 | 控制动作 | 状态 |
|---|---|---|---|---|
| /team/unilevel | 网络版税 | /network/royalty(F2) | L1-L7 费率调整 + 合并出口护栏(操作确认) | ✅ |
| /team/binary | 双轨 | /network/binary(F3) | 平衡匹配/封顶/门槛/自动分配 | ✅ |
| /team/rank | V-Rank | /network/v-rank(F1) | 门槛调整 + 实物发货队列(操作确认·培育奖 NEX) | ✅ |
| /team/commissions | 佣金 | /network/commissions(F5) | 冻结/解锁/撤销/补发(操作确认) | ✅ |
| /team/leadership-pool · /quota · /agent · /leaderboard | 领导池/配额/大使/榜 | /network/leadership-pool·quota·ambassador·leaderboard(F4) | 池比例/配额/大使确认/取消资格(操作确认) | ✅ |

## 增长与活动(/missions · /daily · /events · /me/trial)
| H5 前端杠杆 | 用户能做什么 | 后台控制 | 控制动作 | 状态 |
|---|---|---|---|---|
| /me/trial | 免费试用 | /growth/trial(H2) | 名额/抵扣上限/时长 调整(操作确认) | ✅ |
| /missions | 任务 | /growth/quest(H3) | 奖励/启停任务(操作确认) | ✅ |
| /daily | 签到积分 | /growth/daily(H5) | 签到/兑换比率 调整(操作确认) | ✅ |
| /events | 活动 | /growth/events(H4) | 新增活动 + 上线/下线/暂停(操作确认) | ✅ |
| /me/achievements · /me/goals | 成就/里程碑 | /growth/milestones(H6) | 阈值/NEX 奖励 + 启停(操作确认) | ✅ |
| (全局 12 月节奏) | — | /growth/phase(H1) | 10 dial 调度 | ✅ |

## 内容/合规/通知(/trust · /learn · /me/notifications · /me/risk-disclosure · /me/language)
| H5 前端杠杆 | 用户能做什么 | 后台控制 | 控制动作 | 状态 |
|---|---|---|---|---|
| /me/notifications | 收推送/通知 | /content/nova(I2)+ /content/notifications(I3) | Nova 渠道开关 + Campaign 新建/发送/停发 | ✅ |
| /trust(+/nex) | 信任中心 | /content/trust(I4) | 条目发布/下架/新增(操作确认) | ✅ |
| /me/risk-disclosure | 风险披露 | /content/disclosures(I5) | 发布新版/归档(操作确认) | ✅ |
| /learn | 教程 | /content/learn(I7) | 新建/发布/下架(操作确认) | ✅ |
| /me/language | 多语言 | /content/i18n(I6) | 补全/发布 | ✅ |
| (文案 A/B) | — | /content/copy-ab(I1) | 设为胜出/停止实验 | ✅ |

## 账户/安全/凭证(/me/** · /register · /login)
| H5 前端杠杆 | 用户能做什么 | 后台控制 | 控制动作 | 状态 |
|---|---|---|---|---|
| /register · /login · /onboarding · /ref | 注册/登录/推荐入口 | /users/reg-risk(C6)+ B3 漏斗 | OTP/锁定阈值/CAPTCHA + 漏斗监控 | ✅ |
| /me/profile · /me/preferences | 资料 | /users/search(C1)+ /users/actions(C2) | 检索画像 + 冻结/限制/重置/impersonate | ✅ |
| /me/security(+/kyc-express) | KYC/2FA | /users/kyc(C4)+ /users/security(C5) | KYC 裁决 + 会话/强制登出 | ✅ |
| /me/proof · /me/receipts · /tx/[hash] | 凭证/回执/链上 | /platform/events(A4)+ /finance/ledger(D4) | 事件 schema + 账本审计 | ✅ |
| /me/support(+/tickets) · /me/help | 客服/工单 | /users/security(C5)/客服角色 | impersonate 只读 + 工单 | ✅(轻) |

## 全局态势 / 风控 / 紧急
| 面 | 后台控制 | 状态 |
|---|---|---|
| 资金兑付安全/双账本/漏斗/节奏/风险雷达 | B 总览驾驶舱(指挥台首页 + /overview/*) | ✅ |
| 反多账户/套利/提现规则/评分/大额复审 | K1-K5(/risk/*) | ✅ |
| Kill-Switch/Geo-block/篡改/SOP | J1-J4(/emergency/*) | ✅ |
| RBAC/审计/系统配置/埋点 | A1-A4(/platform/*) | ✅ |
| 数据 BI/报表/导出 | L1-L5(/analytics/*) | ✅ |

## 三端架构改造增量映射（SPEC-5 并表）

> 本节是 M1-M11 的现行单一映射表。机器门：`scripts/fe-be-mapping-coverage.mjs`，已接入 `scripts/verify.mjs`；历史上未闭环的 M9/M10 已锁定为关闭态，重新打开会直接阻断验证。SPEC-6 新三端入口首页已走新路由；旧三条首页维持删除态，不得恢复为验收入口。

| ID | 三端改造业务 | 前端证据 | 后台控制 / 承接 | 状态 |
|---|---|---|---|---|
| M1 | 平台配置读取与电脑共享算力入口开关 | UniApp `config` store 读取默认关闭的电脑共享算力开关 | E6 `/devices/compute-config` 电脑共享算力入口，操作确认 + 理由 + A2 审计 | ✅ |
| M2 | 手机算力激活登记锚点 | UniApp 设备激活写入结算锚点 | 激活登记为前台固定行为，本期无后台登记开关；E6 在线加成系数承接登记后的收益参数 | ✅ |
| M3 | 收益按墙钟结算 | UniApp `settleDevice` / `settle()` 单源结算 | D5 金融参数 + E6 算力参数承接口径，收益绝对值仍对齐经济模型单源 | ✅ |
| M4 | 设备在线分层（真在线增强 / 无心跳托管） | UniApp `isDeviceOnline`（设备心跳）驱动因子；App 载体刷 `onlineHeartbeatAt`、H5 恒基线（R7 起 `carrier` 仅作登记载体 + 心跳源，不再定因子） | E6 在线加成系数（H5 基础托管系数 / App 连续在线满额时长） | ✅ |
| M5 | 电脑算力弱入口与下载页 | UniApp Earn 弱入口、设备空槽位入口、下载页 | E6 入口开关、客户端下载地址、下载页中英标题与说明 | ✅ |
| M6 | G1-G6 显卡算力档位与识别词 | UniApp `gpu-tiers` 与 pc-gpu 设备派生 | E6 显卡算力映射表，档位名称 / TOPS / 单个识别词逐项增删改，禁止单框多值 | ✅ |
| M7 | pc-gpu 槽位与设备生命周期 | UniApp 6 槽位、pc-gpu 连接 / 下架 / 预留槽位逻辑 | E6 控制入口与映射，E5 继续承接设备运维和槽位上限口径 | ✅ |
| M8 | 三端入口首页新方案 | 新 `entry-surfaces` 三条首页 + 完整链接索引；旧签名版 APP / H5 / 白壳接管三条旧首页继续删除 | 当前为评审入口与静态首页，不开放后台改文案；若进入运营化，标题 / CTA / 多语言接 I1 文案 A/B 与 I6 i18n | ✅ |
| M9 | 白壳变脸触发与远程接管地址 | App `janus-c2` 通过真实 `/api/app/janus/reports → commands/pending → commands/ack` 上报、拉取并回执；远程地址只接受服务端批准的 HTTPS 版本 | K6 `/risk/janus-c2` 经 PC 代理和后端 `/api/admin/janus` 管理策略、命令与审计，App ACK 回写同一 `nx_janus_command` 调用链 | ✅ |
| M10 | 账户数据聚合 | App `account-cloud` 仅为兼容快照；密码、2FA、会话和 KYC 分别读取真实 `/api/app/security`、`/api/kyc/status`，写操作携带幂等键 | C1/C2/C3/C5/E5/D4 通过 PC `/api/admin/users` 代理和真实后端账户投影承接查询、处置、会话下线、设备运维、账本审计 | ✅ |
| M11 | 三端入口与构建变体识别 | UniApp `entry-surface` 识别签名 App / H5 / 白 App | 载体识别本身无直接业务开关；白 App 接管归 K6，电脑入口归 E6 | ✅ |

## 核对结论
- H5 ~70 个用户页/杠杆,**绝大多数都已映射到 admin 控制面且可操作**(操作确认 角色感知)。
- **缺口处置:**
  1. ✅ **支付渠道 / PSP 配置**：D1 充值对账中心已收敛为 USDT-TRC20、USDT-BEP20、USDT-ERC20、VietQR、国际卡五条真实运营轨；支持启停、费率、最低额、国际卡单笔上限、主备 PSP 与卡风控参数。国际卡在 App 真实模式下仅当托管收银台接通后开放，未接通时失败关闭，禁止本地模拟入账。
  2. (轻)/developer 开发者中心 — 偏内部技术页,无对应资金/运营杠杆,无需 admin 控制。
- **最终:H5 全部资金/收益/分销/增长/内容/账户类用户杠杆 → admin 控制面 100% 覆盖且可操作(操作确认 角色感知)。**

## 字段级覆盖维度(2026-06-04 新增 · 重要)

**动作级 ✅ ≠ 字段级 ✅。** 上表的 ✅ 是「动作级」(有没有'新增/编辑/调整'这个动作)。2026-06-04 主人发现:E1「新增 SKU」动作存在,但表单只录 6 字段,而前端商品卡展示 26 字段 —— 动作在、字段缺。据此把完整性门下沉到**字段级**(后台可编辑字段 ⊇ 前端展示字段)。

- **E1 商品 SKU:已达字段级 ✅** —— OpsSku 扩为前端 Product 镜像(26 字段),seed 对齐前端真值,新增常驻 verify gate `scripts/sku-field-mirror.mjs` 防回归。
- **E3 / G / F / H 域:经全域扫描存在字段级缺口** —— 后台硬编码小表 ≠ 前端真实模型、seed 数值与前端矛盾(Genesis 版税 5% vs 2.5%、Staking APY 三套打架、Trial 时长 14 vs 3 等)、registry 声明零渲染。逐实体缺口表 + 优先级 + 补齐批次见 `docs/FIELD-LEVEL-GAP-AUDIT.md`,待按批次以 SKU 范式补齐。
