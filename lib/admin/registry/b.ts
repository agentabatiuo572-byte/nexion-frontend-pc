/** 域 B 总览驾驶舱 — 注册表(dashboard archetype)。accent=--admin-domain-b。
 *  数值与 B1 双账本总览 mock(lib/mock/admin/ledger.ts)对齐:储备 $6.34M / 应付 $5.37M / 覆盖率 118.1% 绿区 / 红线 100% / 健康 110%(派生自 LEDGER 单源·越南基准 m7)。
 *  漏斗与 12 月节奏对齐:注册 1240→绑卡 769→首购 223→复购 78→提现 41;当前 P3 扩张期(第 7/12 月)。 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { LEDGER } from "@/lib/mock/admin/ledger";

// 覆盖率 / 储备 / 应付派生自 LEDGER 单源,与 D3 / L3 / B1 双账本一致
const _bResM = (LEDGER.reserveUsd / 1e6).toFixed(2);
const _bLiabM = (LEDGER.liabilitiesUsd / 1e6).toFixed(2);
const _bCov = LEDGER.coverageRatio.toFixed(1);

export const DOMAIN_B: ModuleEntry[] = [
  {
    path: "/overview/liquidity",
    summary:
      "资金池水位 — 真实储备 vs 8 科目应付负债的实时缺口与到期分布。覆盖率为 B5 风险雷达与 J 域 Kill-Switch 的核心入参,口径与 B1 双账本一致(server 权威)。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "兑付覆盖率",
          value: `${_bCov}%`,
          sub: "储备 / 应付",
          accent: "var(--v5-success)",
          hint: `真实储备 $${_bResM}M ÷ 应付负债 $${_bLiabM}M。绿区(≥健康线 ${LEDGER.healthyPct}%);跌破红线 ${LEDGER.redlinePct}% 才触发流出收紧。`,
          delta: { dir: "up", text: "+0.6pt / 窗口", good: true },
        },
        {
          label: "可用储备",
          value: `$${_bResM}M`,
          sub: "可即时兑付",
          accent: "var(--admin-domain-b)",
          hint: "扣除冷钱包与运营预留后的可调度储备。",
          delta: { dir: "down", text: "$0.10M", good: false },
        },
        {
          label: "应付负债",
          value: "$5.37M",
          sub: "8 科目合计",
          accent: "var(--v5-ink-3)",
          hint: "余额 + 质押本息 + Genesis 分红 + NEX 兑付 + 提现队列 + 佣金冷却 + 锁仓。",
        },
        {
          label: "24h 净流入",
          value: "+$0.12M",
          sub: "流入 > 流出",
          accent: "var(--v5-success)",
          hint: "净额为正表示储备累积;扩张期毛流入 ≫ payout。",
          delta: { dir: "up", text: "流入扩张", good: true },
        },
      ],
      charts: [
        {
          type: "area",
          title: "覆盖率趋势",
          sub: `近 8 窗口 · 红线 ${LEDGER.redlinePct}%`,
          color: "var(--admin-domain-b)",
          data: LEDGER.coverageSeries,
          refLine: LEDGER.redlinePct,
          unit: "%",
        },
        {
          type: "donut",
          title: "应付负债构成",
          sub: "8 科目 · 合计 $5.37M",
          unit: "万",
          segments: [
            { label: "USDT 质押本金", value: 164, color: "var(--admin-cat-2)" },
            { label: "可提余额", value: 118, color: "var(--admin-cat-1)" },
            { label: "NEX v2 未来兑付", value: 88, color: "var(--admin-cat-5)" },
            { label: "待提现队列", value: 43, color: "var(--admin-cat-6)" },
            { label: "佣金冷却未解锁", value: 41, color: "var(--admin-cat-7)" },
            { label: "质押应付利息", value: 31, color: "var(--admin-cat-3)" },
            { label: "Genesis 日分红承诺", value: 27, color: "var(--admin-cat-4)" },
            { label: "锁仓本息 / 其他", value: 25, color: "var(--admin-cat-8)" },
          ],
        },
        {
          type: "bars",
          title: "未来 7 日到期兑付预测",
          sub: "需准备的可兑付头寸 · 万 USDT",
          color: "var(--v5-warning)",
          data: [38, 52, 47, 61, 55, 73, 49],
          labels: ["D+1", "D+2", "D+3", "D+4", "D+5", "D+6", "D+7"],
          unit: "万",
        },
        {
          type: "bars",
          title: "近 8 窗口净流入 / 流出",
          sub: "正=净流入 · 万 USDT",
          color: "var(--admin-domain-b)",
          data: [12, 4, -9, -5, -3, -7, -5, -9],
          labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
          unit: "万",
        },
      ],
      controlLink: { label: "调资金/提现参数", href: "/finance/params" },
      note: `覆盖率连续 8 窗口缓升,当前 ${_bCov}% 高于健康线 ${LEDGER.healthyPct}%(绿区);扩张期储备累积、出金压力比 ${(LEDGER.pressureRatio * 100).toFixed(0)}% 远低 70% 红线;D+6 到期峰值 $73 万常规调度即可。储备 / 负债口径与 B1 双账本一致,数据源为 server 端结算账本。`,
    },
  },
  {
    path: "/overview/funnel",
    summary:
      "转化漏斗 — 用户生命周期 L1 注册 → L5 提现各阶段转化与流失,叠加首购周 cohort 留存。指标派生自 A4 事件流(服务端权威),用于增长运营定位漏斗瓶颈。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "注册→绑卡",
          value: "62.0%",
          sub: "1,240 → 769",
          accent: "var(--admin-domain-b)",
          hint: "完成 $1 验证(绑卡)的注册用户占比。L1→L2 转化。",
        },
        {
          label: "绑卡→首购",
          value: "29.0%",
          sub: "769 → 223",
          accent: "var(--v5-warning)",
          hint: "绑卡后完成首次购机的占比。L2→L3,漏斗最大流失环节。",
          delta: { dir: "down", text: "环比 -2.4pt", good: false },
        },
        {
          label: "首购→复购",
          value: "35.0%",
          sub: "223 → 78",
          accent: "var(--admin-domain-b)",
          hint: "首购用户产生第二次购机 / 加仓的占比。L3→L4 复购率。",
          delta: { dir: "up", text: "环比 +3.1pt", good: true },
        },
        {
          label: "整体转化",
          value: "18.0%",
          sub: "注册 → 首购",
          accent: "var(--v5-success)",
          hint: "L1→L3 端到端转化(223 / 1,240)。北极星拉新质量指标。",
        },
      ],
      charts: [
        {
          type: "bars",
          title: "生命周期漏斗 L1 → L5",
          sub: "近 30 日新增用户口径",
          color: "var(--admin-domain-b)",
          data: [1240, 769, 223, 78, 41],
          labels: ["注册", "绑卡", "首购", "复购", "提现"],
        },
        {
          type: "bars",
          title: "首购周 Cohort 留存",
          sub: "首购后第 N 周仍有活跃产出",
          color: "var(--v5-success)",
          data: [100, 86, 74, 68, 61, 57, 54, 52],
          labels: ["W0", "W1", "W2", "W3", "W4", "W5", "W6", "W7"],
          unit: "%",
        },
        {
          type: "donut",
          title: "首购渠道来源",
          sub: "223 首购用户归因",
          unit: "%",
          segments: [
            { label: "推荐裂变(V-Rank)", value: 42, color: "var(--admin-cat-1)" },
            { label: "自然 / 直接访问", value: 26, color: "var(--admin-cat-2)" },
            { label: "试用转付费", value: 18, color: "var(--admin-cat-4)" },
            { label: "投放广告", value: 14, color: "var(--admin-cat-6)" },
          ],
        },
        {
          type: "area",
          title: "每日首购转化率",
          sub: "近 8 日 · 目标 18%",
          color: "var(--admin-domain-b)",
          data: [17.2, 16.8, 18.1, 19.0, 18.4, 17.6, 18.2, 18.0],
          refLine: 18,
          unit: "%",
        },
      ],
      controlLink: { label: "调 Phase dial", href: "/growth/phase" },
      note: "绑卡→首购(29.0%)为最大流失环节,环比下滑 2.4pt,建议联动 H 域试用 / 首购促销定向干预。复购率回升 +3.1pt,留存曲线第 7 周稳定在 52%。所有阶段口径来自 A4 事件流。",
    },
  },
  {
    path: "/overview/rhythm",
    summary:
      "节奏状态 — 12 月运营节奏 P1 拉新 → P6 软退场 的当前阶段、阶段进度与关键节奏仪表。供决策层判断扩张 / 收紧时机,与 F 域参数中枢联动。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "当前阶段",
          value: "P3 扩张期",
          sub: "第 7 / 12 月",
          accent: "var(--admin-domain-b)",
          hint: "12 月节奏:P1 拉新 / P2 加速 / P3 扩张 / P4 平台期 / P5 收紧 / P6 软退场。",
        },
        {
          label: "阶段进度",
          value: "58%",
          sub: "P3 已进行",
          accent: "var(--admin-domain-b)",
          hint: "本阶段时间进度;距 P4 平台期切换约 2.5 个月。",
        },
        {
          label: "新增 / 流出比",
          value: "1.42",
          sub: "扩张健康 ≥ 1.2",
          accent: "var(--v5-success)",
          hint: "新增入金 ÷ 兑付流出。> 1 表示规模仍在净扩张。",
          delta: { dir: "down", text: "上窗 1.51", good: false },
        },
        {
          label: "建议动作",
          value: "维持扩张",
          sub: "暂不收紧",
          accent: "var(--v5-success)",
          hint: `覆盖率 ${_bCov}% 仍在红线上方且新增 > 流出;节奏引擎建议保持当前放量。`,
        },
      ],
      charts: [
        {
          type: "bars",
          title: "12 月节奏阶段强度",
          sub: "拉新 / 激励投放强度(指数)· 当前 P3",
          color: "var(--admin-domain-b)",
          data: [55, 78, 92, 70, 40, 18],
          labels: ["P1", "P2", "P3", "P4", "P5", "P6"],
        },
        {
          type: "area",
          title: "新增 / 流出比趋势",
          sub: "近 8 月 · 扩张健康线 1.2",
          color: "var(--admin-domain-b)",
          data: [2.1, 1.95, 1.82, 1.7, 1.62, 1.55, 1.51, 1.42],
          refLine: 1.2,
        },
        {
          type: "donut",
          title: "本月运营预算分配",
          sub: "P3 扩张期投放结构",
          unit: "%",
          segments: [
            { label: "拉新激励 / 试用补贴", value: 38, color: "var(--admin-cat-1)" },
            { label: "推荐返佣", value: 27, color: "var(--admin-cat-7)" },
            { label: "Genesis 分红池注入", value: 20, color: "var(--admin-cat-4)" },
            { label: "运营储备金", value: 15, color: "var(--admin-cat-8)" },
          ],
        },
        {
          type: "bars",
          title: "近 8 月月新增入金",
          sub: "万 USDT · M1–M7 + 本月",
          color: "var(--v5-success)",
          data: [62, 84, 118, 142, 168, 190, 205, 198],
          labels: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
          unit: "万",
        },
      ],
      controlLink: { label: "调 Phase dial", href: "/growth/phase" },
      note: `当前处于 P3 扩张期(第 7/12 月,阶段进度 58%),新增 / 流出比 1.42 仍高于扩张健康线 1.2 但较上窗 1.51 回落。节奏引擎建议维持放量,并在比率跌破 1.2 或覆盖率触红线 ${LEDGER.redlinePct}% 时切入 P5 收紧。阶段切换需 F1 参数中枢 + 决策层确认。`,
    },
  },
  {
    path: "/overview/risk-radar",
    summary:
      "风险雷达 — 挤兑压力、异常账户、Kill-Switch 状态与全域告警分布的统一风险面板。红色信号联动 J 域熔断与 D 域提现收紧,数据来自 G/D/J 域实时聚合。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "出金压力比",
          value: "32%",
          sub: "(payout+佣金) / 毛流入",
          accent: "var(--v5-success)",
          hint: "模型 §5.3 庞氏度量。> 70% 触发收紧 / 退出预案;m7 基准 32% 远低红线。",
          delta: { dir: "up", text: "上窗 31%", good: true },
        },
        {
          label: "异常账户",
          value: "37",
          sub: "命中风控规则",
          accent: "var(--v5-warning)",
          hint: "命中多开 / 自循环刷返 / 异常提现规则的账户数,待 G2 风控复核。",
          delta: { dir: "up", text: "+9", good: false },
        },
        {
          label: "Kill-Switch",
          value: "7 / 7",
          sub: "在线 · nexv2 核查中",
          accent: "var(--v5-warning)",
          hint: "7 道熔断闸(提现 / 兑换 / 质押 / NEX v2 / Genesis / 试用 / Premium)全部在线(正常营业);口径与 J1 矩阵一致。",
        },
        {
          label: "未处理告警",
          value: "6",
          sub: "P0:1 · P1:2 · P2:3",
          accent: "var(--v5-danger)",
          hint: "全域待处置告警;P0 为覆盖率逼近健康线下方预警。",
          delta: { dir: "up", text: "+2", good: false },
        },
      ],
      charts: [
        {
          type: "area",
          title: "出金压力比趋势",
          sub: "近 8 窗口 · 收紧线 15%",
          color: "var(--v5-warning)",
          data: [3.2, 3.6, 4.1, 4.8, 5.5, 6.4, 7.2, 8.0],
          refLine: 15,
          unit: "%",
        },
        {
          type: "donut",
          title: "告警严重度分布",
          sub: "全域 · 含已处置",
          segments: [
            { label: "P0 严重(覆盖率 / 储备)", value: 1, color: "var(--v5-danger)" },
            { label: "P1 高(异常提现 / 风控)", value: 2, color: "var(--v5-warning)" },
            { label: "P2 中(参数 / 队列积压)", value: 3, color: "var(--admin-cat-4)" },
            { label: "P3 低(信息提示)", value: 8, color: "var(--admin-cat-2)" },
          ],
        },
        {
          type: "bars",
          title: "异常账户命中规则分布",
          sub: "近 7 日 · 命中账户数",
          color: "var(--v5-warning)",
          data: [14, 9, 7, 5, 2],
          labels: ["多开", "自循环刷返", "异常提现", "设备指纹", "IP 聚集"],
        },
        {
          type: "bars",
          title: "近 7 日告警量",
          sub: "每日新增告警(全域)",
          color: "var(--admin-domain-b)",
          data: [3, 5, 4, 6, 8, 7, 9],
          labels: ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "今日"],
        },
      ],
      controlLink: { label: "Kill-Switch 矩阵", href: "/emergency/kill-switch" },
      note: "出金压力比 32%(模型口径)远低 70% 红线、扩张健康;异常账户 +9 主要来自多开与自循环刷返。Kill-Switch 7 闸全部在线(0 / 7 熔断,正常营业)。熔断触发需 J 域 Maker-Checker 双签 + 全站广播。",
    },
  },
];
