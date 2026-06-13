/** 域 E 设备与商城 — 注册表(config / dashboard / list archetype 混合)。accent=--admin-domain-e。
 *  NexionBox 矿机商城与设备生命周期。数值与前端 PRD device specs 对齐(server 权威):
 *  - SKU 7 个管理对象(V2 补 Pro v2 后 6→7);Pro Gen-1 权威定价 $2,399(原型 stray $2,639 已修),Pro v2 为独立 Gen-2 SKU $2,639。
 *  - 衰减模型 -4% / -6% / -10% 月分段 + MIN_EFFICIENCY(P3 档 month12 ≈ 22% 效能)。
 *  - TradeInConfig:minHoldingMonths / salvage(月12 归零约束),salvage 不入余额。
 *  - Order 状态机:placed → paid → provisioning → activated + 失败态;退款核减 cumulativeDepositUsdt。
 *  baseRate / 衰减 / 任务奖励均 server-canonical;本后台改参数走 操作确认 + A2 审计。 */
import type { ModuleEntry } from "@/lib/admin/module-content";

export const DOMAIN_E: ModuleEntry[] = [
  {
    path: "/devices/pricing",
    summary:
      "NexionBox 商品目录与定价中枢(E1)— SKU 目录(售价 / 日产 / 库存 / 上下架 / 促销)+ 新增 SKU。价格与 baseRate 为 server 权威,新增 SKU / 改价 / 上下架均需 增长运营 + 财务 操作确认并写入 A2 审计,联动 E4 订单与 E2 收益引擎。",
    content: {
      kind: "list",
      metrics: [
        { label: "在售 SKU", value: "4 / 6", sub: "2 个待发布", accent: "var(--admin-domain-e)", hint: "已上架可购机型;Gen-2 SKU 预热中未上架。" },
        { label: "目录均价", value: "$1,149", sub: "加权在售", accent: "var(--admin-domain-e)", hint: "按近 30 日成交结构加权的在售机型均价。" },
        { label: "在售库存", value: "3,420", sub: "可下单台数", accent: "var(--v5-success)", hint: "全 SKU 可立即下单的虚拟库存合计。" },
        { label: "促销中", value: "1", sub: "限时折扣", accent: "var(--v5-warning)", hint: "当前生效的促销活动数;到期自动回原价。" },
      ],
      search: "搜索机型 / 代际",
      filterKey: "state",
      filters: ["全部", "上架", "促销中", "待发布"],
      primaryAction: { label: "新增 SKU", fields: ["型号 / 档位 / 标语 / 角标 badge", "售价", "GPU / VRAM / 算力 / 功率 / 数据中心", "日产 USDT / 日产 NEX / Share 年化", "AI 图像·张/min / LLM·tok/s / 视频·s/min / LoRA·min / 解锁池", "累计销量 / 评分 / 评论数 / 库存", "代际 / 生命周期 / 解锁 Phase / 换新折扣 / 特性清单"] },
      columns: [
        { key: "sku", header: "机型" },
        { key: "gen", header: "代际" },
        { key: "price", header: "售价", mono: true, align: "right" },
        { key: "rate", header: "日产", mono: true },
        { key: "stock", header: "库存", mono: true, align: "right" },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { sku: "NexionBox S1", gen: "Gen-1", price: "$1,299", rate: "$14.20 + 24 NEX", stock: "47", state: "上架" },
        { sku: "NexionBox Pro", gen: "Gen-1", price: "$2,399", rate: "$26.30 + 74 NEX", stock: "23", state: "上架" },
        { sku: "NexionBox Pro v2", gen: "Gen-2", price: "$2,639", rate: "$28.90 + 84 NEX", stock: "38", state: "待发布" },
        { sku: "NexionRack P1", gen: "Gen-1", price: "$8,999", rate: "$98.60 + 650 NEX", stock: "8", state: "上架" },
        { sku: "NexionRack P2", gen: "Gen-2", price: "$14,999", rate: "$164.40 + 1,200 NEX", stock: "4", state: "待发布" },
        { sku: "Cloud Share", gen: "Gen-1", price: "$199", rate: "8–15% 年化 + 30 NEX", stock: "∞", state: "上架" },
      ],
      detail: true,
      rowActions: [
        { label: "下架", tone: "danger", whenStatus: "上架" },
        { label: "上架", tone: "primary", whenStatus: "待发布" },
        { label: "改价" },
        { label: "新建促销" },
      ],
      note: "Pro Gen-1 权威价 $2,399(非 $2,639);Standard 早购促销 9 折剩 3 天。新增 SKU / 改价 / 上下架 / 新建促销需 增长运营 发起 + 财务 确认(总管理员仍需操作确认),写入 A2;Gen-2 上架受 E1 代际门约束。改价即时改写 E4 下单金额与 E2 日产计提。",
    },
  },
  {
    path: "/devices/tasks",
    summary:
      "收益与任务引擎(E2)— 设备日产 baseRate、NEX 配比与每日任务奖励的 server-canonical 参数中枢。改费率即时影响全网在网设备次日计酬,需 增长运营 + 财务 操作确认,联动 B 域应付负债与 D 域提现压力。",
    content: {
      kind: "config",
      metrics: [
        { label: "全网日产 USDT", value: "$9,840", sub: "在网设备聚合", accent: "var(--admin-domain-e)", hint: "全部在网设备当日计提的 USDT 产出合计(应付侧)。" },
        { label: "全网日产 NEX", value: "54.2K", sub: "在网设备聚合", accent: "var(--admin-cat-5)", hint: "全部在网设备当日计提的 NEX 产出合计。" },
        { label: "任务完成率", value: "73.5%", sub: "近 24h 领取", accent: "var(--v5-success)", hint: "当日有效设备完成每日任务并领取收益的占比。" },
        { label: "未领取产出", value: "$1,260", sub: "待用户 claim", accent: "var(--v5-warning)", hint: "已计提但用户未完成任务领取的当日收益。" },
      ],
      groups: [
        {
          title: "基础产出 baseRate",
          note: "baseRate / baseRateNEX 为设备日产基准,server 权威;改动从次日计酬窗口生效。",
          fields: [
            { label: "Lite baseRate", value: "$0.62 / 日", range: "$0.40–$0.90", effect: "入门款日产基准,影响回本周期话术" },
            { label: "Standard baseRate", value: "$2.85 / 日", range: "$2.00–$3.80", effect: "主力款,直接影响全网日产大头" },
            { label: "Pro baseRate", value: "$7.80 / 日", range: "$5.50–$10.00", effect: "高客单日产,牵动应付负债增速" },
            { label: "NEX 配比 baseRateNEX", value: "Standard 16 NEX / 日", range: "8–24 NEX", effect: "NEX 产出基准,联动 G3 行情与 G6 兑付" },
          ],
        },
        {
          title: "每日任务",
          note: "任务为收益领取门槛(领取式收益,降低纯被动观感);未完成则当日产出滚存不灭失。",
          fields: [
            { label: "每日任务数", value: "3 个 / 日", range: "1–5 个", effect: "签到 / 浏览 / 互动,完成方可 claim 当日产出" },
            { label: "任务奖励倍率", value: "1.0×", range: "1.0–4.0×", effect: "H1 Phase 月1-2 可调 4× 拉激活(questBonus)" },
            { label: "连续完成加成", value: "+2% / 连续 7 天", range: "0–10%", effect: "streak 激励,断签清零,提升日活粘性" },
            { label: "未领取滚存上限", value: "7 天", range: "1–30 天", effect: "超期未 claim 的产出冻结进 monthly-task-lock 召回" },
          ],
        },
        {
          title: "收益结算口径",
          note: "结算基准 UTC 日切,与 B1 双账本一致;产出计入应付负债,claim 后转可提余额。",
          fields: [
            { label: "计酬日切", value: "UTC 00:00", range: "UTC 固定", effect: "全网统一日切,跨域结算基准一致" },
            { label: "USDT / NEX 入账", value: "claim 后入可提余额", range: "自动 / claim", effect: "未 claim 计应付,claim 后转 D 域可提" },
            { label: "衰减联动", value: "按 E3 月段衰减", range: "联动 E3", effect: "在网产出 = baseRate × 当月效能系数(E3)" },
            { label: "封顶日产", value: "单设备 ≤ baseRate × 1.5", range: "1.0–2.0×", effect: "含加成的单设备日产上限,防异常刷返" },
          ],
        },
      ],
      confirmPolicy: "baseRate / baseRateNEX / 任务奖励倍率改动需 增长运营 发起 + 财务 确认;封顶与滚存规则额外知会风控,改动写入 A2 审计。",
      impact: [
        "上调 baseRate / 奖励倍率 → B 域应付负债与日产承诺即时抬升,挤兑压力上行",
        "改 NEX 配比 → G3 行情供给与 G6 NEX v2 兑付负债联动变化",
        "缩短滚存上限 → 更多未领取产出进 monthly-task-lock 召回,影响用户体感",
      ],
    },
  },
  {
    path: "/devices/trade-in",
    summary:
      "生命周期 & Trade-in(E3)— 旧机折抵率、最短持有期与残值规则。受全局/独立 geo_block 派生约束(Ch17 核验);salvage 不入余额,折抵原子化,改规则需 增长运营 + 财务 操作确认,联动 E1 抵扣叠加与 E3 退役流转。",
    content: {
      kind: "config",
      metrics: [
        { label: "Trade-in 状态", value: "灰度 · 30%", sub: "A1 特性开关", accent: "var(--v5-warning)", hint: "当前按 30% 灰度对用户开放,与 A1 系统配置联动。" },
        { label: "近 30 日折抵", value: "428", sub: "成功升级", accent: "var(--admin-domain-e)", hint: "完成旧机折抵并购入新机的订单数。" },
        { label: "平均折抵额", value: "$214", sub: "抵新机款", accent: "var(--admin-domain-e)", hint: "单笔 trade-in 折抵进新机货款的平均金额。" },
        { label: "折抵渗透率", value: "31.6%", sub: "到期机转化", accent: "var(--v5-success)", hint: "到期 / 低效能设备中走 trade-in 升级的占比。" },
      ],
      groups: [
        {
          title: "折抵率与残值",
          note: "残值随持有月段递减,month12 归零;salvage 仅抵新机货款,不入可提余额(资金不变量)。",
          fields: [
            { label: "基础折抵率", value: "剩余效能 × 60%", range: "40%–80%", effect: "折抵额 = 旧机剩余效能价值 × 该比例" },
            { label: "salvage 残值上限", value: "原价 35%", range: "0%–50%", effect: "单台折抵封顶,防高残值套利" },
            { label: "month12 残值", value: "归零", range: "固定 0", effect: "触底 MIN_EFFICIENCY 后残值清零,只能退役" },
            { label: "salvage 资金去向", value: "仅抵货款 · 不入余额", range: "固定", effect: "折抵不可提现,仅冲抵新机应付(不变量)" },
          ],
        },
        {
          title: "持有期与资格",
          note: "最短持有期防快进快出套利;K2 风控只读消费 minHoldingMonths。",
          fields: [
            { label: "minHoldingMonths", value: "3 月", range: "1–6 月", effect: "持有不足 → 不可 trade-in,防套利刷折抵" },
            { label: "折抵冷却", value: "P3-P4 60 min · P5-P6 24h", range: "phase-keyed", effect: "随 Phase 切换的折抵触发冷却(§11.0A.2a)" },
            { label: "单账户折抵上限", value: "3 台 / 月", range: "1–10 台", effect: "防批量倒机刷新机促销" },
            { label: "代际折抵约束", value: "仅可换同代或更高代", range: "同代 / 升代", effect: "Gen-1 可换 Gen-1 或 Gen-2,不可降代" },
          ],
        },
        {
          title: "升级钩子与流转",
          note: "trade-in 升级钩子(tradein-nudge)由 P3-P4 15min tick 触发;折抵与 E1 早购促销可叠加。",
          fields: [
            { label: "升级钩子触发", value: "效能 ≤ 40% 时推送", range: "30%–60%", effect: "对低效能设备弹 trade-in 升级引导" },
            { label: "促销叠加", value: "可叠加 E1 早购促销", range: "可 / 不可", effect: "折抵 + 早购立减叠加,自动扣款全价无叠加" },
            { label: "旧机流转", value: "折抵即退役(E3)", range: "固定", effect: "折抵成功 → 旧机在 E3 置退役,停止计酬" },
            { label: "折抵原子性", value: "折抵 + 下单单事务", range: "固定", effect: "新机下单与旧机退役原子提交,失败整体回滚" },
          ],
        },
      ],
      confirmPolicy: "折抵率 / minHoldingMonths / salvage 规则改动需 增长运营 发起 + 财务 确认;灰度比例联动 A1,启用前须 Ch17 核验前端对应 endpoint 已实装 geo_block,改动写入 A2 审计。",
      impact: [
        "上调折抵率 → E1 新机净收款下降,但提升 E3 到期设备升级渗透与复投",
        "缩短 minHoldingMonths → 套利风险上升,K2 风控告警阈值需同步收紧",
        "折抵成功 → E3 旧机原子退役停酬 + cumulativeDepositUsdt 按新机净付计入",
      ],
    },
  },
  {
    path: "/devices/orders",
    summary:
      "购机订单状态机(E4)— 用户 / SKU / 金额 / 支付方式 / 状态流转的全量订单台。状态机 placed → paid → provisioning → activated + 失败态;退款核减累计入金,资金侧走 D1/D4,异常订单点开可查全字段。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日订单", value: "142", sub: "全 SKU", accent: "var(--admin-domain-e)", hint: "今日新建的购机订单数(含未支付)。" },
        { label: "已激活", value: "118", sub: "正常计酬", accent: "var(--v5-success)", hint: "已完成 activated、设备已开始计提产出的订单。" },
        { label: "待支付 / 处理中", value: "16", sub: "placed / provisioning", accent: "var(--v5-warning)", hint: "停留在下单或开通中、尚未激活的订单。" },
        { label: "失败 / 退款", value: "8", sub: "支付失败 / 已退", accent: "var(--v5-danger)", hint: "支付失败或已退款的订单;退款核减累计入金口径。" },
      ],
      search: "搜索订单号 / 用户 / SKU",
      filterKey: "state",
      filters: ["全部", "已激活", "开通中", "已支付", "待支付", "支付失败", "已退款"],
      columns: [
        { key: "oid", header: "订单号", mono: true },
        { key: "uid", header: "用户", mono: true },
        { key: "sku", header: "机型" },
        { key: "amount", header: "金额", mono: true, align: "right" },
        { key: "pay", header: "支付" },
        { key: "state", header: "状态", status: true },
        { key: "ts", header: "下单时间", mono: true, align: "right" },
      ],
      rows: [
        { oid: "ORD-2606-1142", uid: "U-88421", sku: "Standard (Gen-1)", amount: "$899", pay: "USDT 余额", state: "已激活", ts: "14:08" },
        { oid: "ORD-2606-1141", uid: "U-90233", sku: "Pro (Gen-1)", amount: "$2,399", pay: "链上充值", state: "开通中", ts: "13:52" },
        { oid: "ORD-2606-1140", uid: "U-77310", sku: "Lite (Gen-1)", amount: "$199", pay: "USDT 余额", state: "已激活", ts: "13:40" },
        { oid: "ORD-2606-1139", uid: "U-91002", sku: "Standard (Gen-1)", amount: "$809", pay: "USDT 余额 + trade-in", state: "已激活", ts: "13:21" },
        { oid: "ORD-2606-1138", uid: "U-83771", sku: "Pro (Gen-1)", amount: "$2,199", pay: "链上充值", state: "已支付", ts: "12:55" },
        { oid: "ORD-2606-1137", uid: "U-88210", sku: "Standard (Gen-1)", amount: "$899", pay: "USDT 余额", state: "待支付", ts: "12:33" },
        { oid: "ORD-2606-1136", uid: "U-79944", sku: "Lite (Gen-1)", amount: "$199", pay: "链上充值", state: "支付失败", ts: "11:58" },
        { oid: "ORD-2606-1135", uid: "U-90577", sku: "Pro (Gen-1)", amount: "$2,399", pay: "链上充值", state: "已退款", ts: "10:42" },
      ],
      detail: true,
      rowActions: [
        { label: "退款", tone: "danger", whenStatus: "已激活" },
        { label: "重试开通", whenStatus: "开通中" },
        { label: "取消", whenStatus: "待支付" },
      ],
      note: "状态机:placed → paid → provisioning → activated;失败态(支付失败 / 超时 / 退款)不计酬。退款由财务发起,核减用户 cumulativeDepositUsdt 累计入金口径,资金侧走 D1 余额 / D4 链上;状态流转 server 权威,本台只读 + 异常订单人工介入需 A2 留痕。",
    },
  },
  {
    path: "/devices/ops",
    summary:
      "设备运维(E5)— 在网设备健康度、算力波动、告警与工单台。监控设备产出异常(掉线 / 算力骤降 / 计酬偏差),告警分级处置;干预性运维(强制下线 / 补偿计酬)需操作确认并写入 A2 审计。",
    content: {
      kind: "list",
      metrics: [
        { label: "在网健康", value: "98.6%", sub: "正常计酬", accent: "var(--v5-success)", hint: "当前产出正常、无告警的在网设备占比。" },
        { label: "算力告警", value: "23", sub: "波动超阈值", accent: "var(--v5-warning)", hint: "日产偏离 baseRate × 当月效能超过阈值的设备数。" },
        { label: "掉线设备", value: "11", sub: "暂停产出", accent: "var(--v5-danger)", hint: "心跳超时、当前未计提产出的设备数。" },
        { label: "待处理工单", value: "7", sub: "P0:1 · P1:3 · P2:3", accent: "var(--v5-warning)", hint: "运维侧待处置工单;P0 为批量计酬偏差。" },
      ],
      search: "搜索设备号 / 用户 / 机型",
      filterKey: "level",
      filters: ["全部", "正常", "提示", "告警", "严重"],
      columns: [
        { key: "did", header: "设备号", mono: true },
        { key: "uid", header: "用户", mono: true },
        { key: "sku", header: "机型" },
        { key: "eff", header: "当前效能", mono: true, align: "right" },
        { key: "yield", header: "日产偏差", mono: true, align: "right" },
        { key: "issue", header: "告警事项" },
        { key: "level", header: "级别", status: true },
      ],
      rows: [
        { did: "DEV-S1-44821", uid: "U-88421", sku: "Standard", eff: "82%", yield: "+0.2%", issue: "—", level: "正常" },
        { did: "DEV-S1-44790", uid: "U-90233", sku: "Pro", eff: "31%", yield: "-1.1%", issue: "效能逼近 MIN,建议 trade-in", level: "提示" },
        { did: "DEV-S1-44755", uid: "U-77310", sku: "Lite", eff: "0%", yield: "停产", issue: "心跳超时 6h,暂停计酬", level: "严重" },
        { did: "DEV-S1-44712", uid: "U-91002", sku: "Standard", eff: "74%", yield: "-9.4%", issue: "日产骤降超阈值,核查计酬", level: "告警" },
        { did: "DEV-S2-10044", uid: "U-90577", sku: "Pro v2", eff: "96%", yield: "+0.1%", issue: "—", level: "正常" },
        { did: "DEV-S1-44680", uid: "U-83771", sku: "Pro", eff: "58%", yield: "-12.8%", issue: "计酬偏差,疑似衰减系数漂移", level: "告警" },
        { did: "DEV-S1-44603", uid: "U-79944", sku: "Lite", eff: "0%", yield: "停产", issue: "掉线 12h,工单待派", level: "严重" },
        { did: "DEV-S1-44521", uid: "U-88210", sku: "Standard", eff: "67%", yield: "-0.3%", issue: "—", level: "正常" },
      ],
      detail: true,
      rowActions: [
        { label: "强制下线", tone: "danger" },
        { label: "补偿计酬" },
        { label: "派工单" },
      ],
      note: "算力波动以 baseRate × E3 当月效能为基准比对;日产偏差超阈值或心跳超时即升级告警。强制下线 / 补偿计酬 / 批量计酬修正为干预性操作,需 风控 + 增长运营 操作确认并写入 A2 审计;监控数据 server 权威,本台只读展示 + 工单流转。",
    },
  },
];
