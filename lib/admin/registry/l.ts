/** 域 L 数据与分析 BI — 注册表(dashboard ×4 + list ×1)。accent=--admin-domain-l。
 *  数据均派生自 A4 server-authoritative 事件流(schema v3.7),与 B 域驾驶舱口径一致:
 *  八项验收 KPI(Day-0 接入 87% / Day-7 留存 58% / 首购转化 18% / 复购 35% / 推广 22% /
 *  Nova CTR 31% / Staking TVL $1.64M / Genesis 售罄 84%)。漏斗与 12 月节奏对齐:
 *  注册 1240→绑卡 769→首购 223→复购 78→提现 41;储备 $6.34M / 应付 $5.37M / 覆盖率 118.1% 绿区(派生自 LEDGER 单源·越南基准 m7)。 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { LEDGER } from "@/lib/mock/admin/ledger";

// L3 财务 BI 口径派生自 LEDGER 单源,与 D3 / B1 双账本一致
const _lResM = (LEDGER.reserveUsd / 1e6).toFixed(2);
const _lLiabM = (LEDGER.liabilitiesUsd / 1e6).toFixed(2);
const _lNetRaw = LEDGER.reserveUsd - LEDGER.liabilitiesUsd;
const _lNetLabel = _lNetRaw >= 0 ? `+$${(_lNetRaw / 1e6).toFixed(2)}M` : `-$${Math.abs(_lNetRaw / 1e6).toFixed(2)}M`;
const _lCov = LEDGER.coverageRatio.toFixed(1);

export const DOMAIN_L: ModuleEntry[] = [
  {
    path: "/analytics/kpi",
    summary:
      "KPI 看板 — 八项验收指标的当期值、达标状态与趋势。全部指标派生自 A4 事件流(服务端权威),为决策层判断北极星健康度的统一口径,与 B 域驾驶舱一致。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "Day-0 接入率",
          value: "87%",
          sub: "目标 ≥ 85%",
          accent: "var(--v5-success)",
          hint: "注册当日完成 $1 验证(绑卡)的用户占比。来源:user_register / kyc_pass 事件配对。",
          delta: { dir: "up", text: "环比 +1.4pt", good: true },
        },
        {
          label: "首购转化",
          value: "18%",
          sub: "目标 ≥ 18%",
          accent: "var(--v5-success)",
          hint: "注册 → 首购端到端转化(223 / 1,240)。来源:first_purchase 事件。北极星拉新质量。",
          delta: { dir: "up", text: "环比 +0.6pt", good: true },
        },
        {
          label: "Day-7 留存",
          value: "58%",
          sub: "目标 ≥ 60%",
          accent: "var(--v5-warning)",
          hint: "首购后第 7 日仍有活跃产出的用户占比。来源:device_yield_tick 活跃判定。未达标 2pt。",
          delta: { dir: "down", text: "环比 -1.1pt", good: false },
        },
        {
          label: "Genesis 售罄",
          value: "84%",
          sub: "目标 100% 售罄",
          accent: "var(--admin-domain-l)",
          hint: "Genesis 创世节点已售份额。来源:G4 二级市场 + 一级发行台账。距售罄缺口 16%。",
          delta: { dir: "up", text: "环比 +5pt", good: true },
        },
      ],
      charts: [
        {
          type: "bars",
          title: "八项验收 KPI 达标度",
          sub: "当期值 / 目标值 × 100 · ≥ 100 为达标",
          color: "var(--admin-domain-l)",
          data: [102, 100, 97, 100, 110, 103, 109, 84],
          labels: ["接入", "首购", "留存", "复购", "推广", "Nova", "TVL", "Genesis"],
          refLine: 100,
          unit: "%",
        },
        {
          type: "area",
          title: "首购转化率趋势",
          sub: "近 8 窗口 · 目标线 18%",
          color: "var(--admin-domain-l)",
          data: [17.2, 16.8, 17.5, 18.1, 18.4, 17.9, 18.2, 18.0],
          refLine: 18,
          unit: "%",
        },
        {
          type: "donut",
          title: "八项 KPI 健康分布",
          sub: "达标 / 接近 / 未达标",
          segments: [
            { label: "达标(≥ 目标)", value: 6, color: "var(--admin-cat-1)" },
            { label: "接近(95–99%)", value: 1, color: "var(--admin-cat-4)" },
            { label: "未达标(< 目标)", value: 1, color: "var(--admin-cat-5)" },
          ],
        },
        {
          type: "area",
          title: "Day-7 留存趋势",
          sub: "近 8 窗口 · 目标线 60%",
          color: "var(--v5-warning)",
          data: [61.2, 60.4, 59.8, 59.1, 58.6, 58.9, 58.3, 58.0],
          refLine: 60,
          unit: "%",
        },
      ],
      controlLink: { label: "KPI 口径(A4 埋点)", href: "/platform/events" },
      note: "八项验收 KPI 中六项达标,Nova CTR(31%)与 Staking TVL($1.64M)表现领先;Day-7 留存 58% 连续下行、距目标 60% 缺口 2pt 为当前唯一红线项,建议联动 H 域留存激励干预。所有指标口径来自 A4 事件 schema v3.7,日切基准 UTC。",
    },
  },
  {
    path: "/analytics/funnel-cohort",
    summary:
      "漏斗 / Cohort / 留存 — 用户生命周期 L1 注册 → L5 提现各阶段转化与流失,叠加首购周 cohort 多周留存矩阵。指标派生自 A4 事件流,用于增长运营定位漏斗瓶颈与留存衰减拐点。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "注册→绑卡",
          value: "62.0%",
          sub: "1,240 → 769",
          accent: "var(--admin-domain-l)",
          hint: "完成 $1 验证(绑卡)的注册用户占比。L1→L2 转化,即 Day-0 接入。",
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
          accent: "var(--admin-domain-l)",
          hint: "首购用户产生第二次购机 / 加仓的占比。L3→L4 复购率,达标项。",
          delta: { dir: "up", text: "环比 +3.1pt", good: true },
        },
        {
          label: "推广参与率",
          value: "22.0%",
          sub: "绑定上线占比",
          accent: "var(--v5-success)",
          hint: "完成推荐绑定(referral_bind)的用户占比。L 域 / B 域推广 KPI 同源。",
          delta: { dir: "up", text: "环比 +1.8pt", good: true },
        },
      ],
      charts: [
        {
          type: "bars",
          title: "生命周期漏斗 L1 → L5",
          sub: "近 30 日新增用户口径",
          color: "var(--admin-domain-l)",
          data: [1240, 769, 223, 78, 41],
          labels: ["注册", "绑卡", "首购", "复购", "提现"],
        },
        {
          type: "bars",
          title: "首购周 Cohort 留存",
          sub: "首购后第 N 周仍有活跃产出",
          color: "var(--v5-success)",
          data: [100, 86, 74, 68, 61, 58, 55, 53],
          labels: ["W0", "W1", "W2", "W3", "W4", "W5", "W6", "W7"],
          unit: "%",
        },
        {
          type: "donut",
          title: "各阶段流失归因",
          sub: "L1 → L5 累计流失结构",
          unit: "%",
          segments: [
            { label: "绑卡→首购流失", value: 46, color: "var(--admin-cat-4)" },
            { label: "首购→复购流失", value: 31, color: "var(--admin-cat-7)" },
            { label: "注册→绑卡流失", value: 15, color: "var(--admin-cat-5)" },
            { label: "复购→提现流失", value: 8, color: "var(--admin-cat-2)" },
          ],
        },
        {
          type: "area",
          title: "Day-7 留存趋势",
          sub: "近 8 周 cohort · 目标线 60%",
          color: "var(--admin-domain-l)",
          data: [61.0, 60.2, 59.6, 59.0, 58.7, 58.4, 58.2, 58.0],
          refLine: 60,
          unit: "%",
        },
      ],
      controlLink: { label: "埋点事件体系", href: "/platform/events" },
      note: "绑卡→首购(29.0%)为最大流失环节并环比下滑 2.4pt,贡献累计流失 46%;复购率回升 +3.1pt、推广参与 22% 达标。首购周 cohort 留存第 7 周收敛至 53%,Day-7 留存 58% 仍低于目标 60%。所有阶段口径来自 A4 事件 schema v3.7。",
    },
  },
  {
    path: "/analytics/financial",
    summary:
      "财务报表 — 平台收入、成本、兑付支出与净敞口的周期汇总。储备 / 应付口径与 B1 双账本一致(server 权威),供财务与决策层评估可持续性与挤兑安全边际。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "本月收入",
          value: "$1.98M",
          sub: "购机 + 加仓入金",
          accent: "var(--v5-success)",
          hint: "first_purchase + repurchase 入金合计(本月)。来源:A4 资金事件流。",
          delta: { dir: "down", text: "环比 -3.4%", good: false },
        },
        {
          label: "兑付支出",
          value: "$1.62M",
          sub: "提现 + 分红 + 利息",
          accent: "var(--v5-warning)",
          hint: "提现放行 + Genesis 分红 + 质押利息 + NEX 兑付(本月)。",
          delta: { dir: "up", text: "环比 +6.1%", good: false },
        },
        {
          label: "净敞口",
          value: _lNetLabel,
          sub: "储备 − 应付",
          accent: "var(--v5-warning)",
          hint: `可用储备 $${_lResM}M − 应付负债 $${_lLiabM}M。储备高于应付(绿区盈余),与覆盖率 ${_lCov}% 对应。`,
        },
        {
          label: "Staking TVL",
          value: "$1.64M",
          sub: "目标 ≥ $1.5M",
          accent: "var(--admin-domain-l)",
          hint: "当前质押锁仓总价值。来源:G3 质押台账。验收 KPI 之一,已达标。",
          delta: { dir: "up", text: "环比 +9.3%", good: true },
        },
      ],
      charts: [
        {
          type: "bars",
          title: "近 8 月收入 vs 兑付",
          sub: "万 USDT · 收入为正向 / 兑付为支出",
          color: "var(--admin-domain-l)",
          data: [62, 84, 118, 142, 168, 190, 205, 198],
          labels: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
          unit: "万",
        },
        {
          type: "area",
          title: "净敞口趋势",
          sub: "近 8 窗口 · 万 USDT · 0 为收支平衡",
          color: "var(--v5-warning)",
          data: [72, 64, 56, 48, 41, 35, 30, 27],
          refLine: 0,
          unit: "万",
        },
        {
          type: "donut",
          title: "本月成本 / 兑付构成",
          sub: "支出结构 · 合计 $1.62M",
          unit: "万",
          segments: [
            { label: "提现放行", value: 58, color: "var(--admin-cat-6)" },
            { label: "Genesis 日分红", value: 41, color: "var(--admin-cat-4)" },
            { label: "质押应付利息", value: 33, color: "var(--admin-cat-3)" },
            { label: "推荐返佣", value: 18, color: "var(--admin-cat-7)" },
            { label: "运营 / 投放", value: 12, color: "var(--admin-cat-8)" },
          ],
        },
        {
          type: "bars",
          title: "近 8 月兑付覆盖率",
          sub: `储备 / 应付 · 红线 ${LEDGER.redlinePct}%`,
          color: "var(--admin-domain-l)",
          data: LEDGER.coverageSeries.map((v) => Math.round(v)),
          labels: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
          refLine: LEDGER.redlinePct,
          unit: "%",
        },
      ],
      controlLink: { label: "调提现/资金参数", href: "/finance/params" },
      note: `本月收入 $1.98M 而兑付 $1.62M,净敞口 ${_lNetLabel}(盈余),覆盖率口径(${_lCov}%)与 B1 双账本一致、高于健康线 ${LEDGER.healthyPct}%(绿区),扩张期储备累积。Staking TVL $1.64M 达标。报表为周期汇总,资金口径以 server 端结算账本为权威。`,
    },
  },
  {
    path: "/analytics/operations",
    summary:
      "运营报表 — 设备在役、任务完成与网络增长的运营侧汇总。数据来自 E 域设备台账、任务引擎与 F 域网络结构,经 A4 事件流聚合,供运营评估履约能力与裂变质量。",
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "设备在役",
          value: "9,140",
          sub: "正在产出",
          accent: "var(--admin-domain-l)",
          hint: "处于有效产出周期的算力设备总数。来源:E 域设备台账 / device_yield_tick。",
          delta: { dir: "up", text: "+186", good: true },
        },
        {
          label: "任务完成率",
          value: "76.4%",
          sub: "日任务 / 应完成",
          accent: "var(--v5-success)",
          hint: "当日已完成任务占应完成任务比。来源:任务引擎事件。反映用户活跃履约。",
          delta: { dir: "up", text: "环比 +2.2pt", good: true },
        },
        {
          label: "Nova 点击率",
          value: "31%",
          sub: "目标 ≥ 28%",
          accent: "var(--v5-success)",
          hint: "Nova 智能推荐位的点击转化率。来源:Nova 曝光 / 点击事件。验收 KPI,已达标。",
          delta: { dir: "up", text: "环比 +1.0pt", good: true },
        },
        {
          label: "网络新增节点",
          value: "769",
          sub: "近 30 日绑定",
          accent: "var(--admin-domain-l)",
          hint: "新绑定到推荐网络的活跃节点数。来源:referral_bind 事件 / F 域网络结构。",
          delta: { dir: "down", text: "环比 -34", good: false },
        },
      ],
      charts: [
        {
          type: "area",
          title: "设备在役趋势",
          sub: "近 8 窗口 · 台",
          color: "var(--admin-domain-l)",
          data: [8420, 8560, 8690, 8780, 8870, 8960, 9020, 9140],
          unit: "台",
        },
        {
          type: "bars",
          title: "近 7 日任务完成量",
          sub: "已完成任务数(全端)",
          color: "var(--v5-success)",
          data: [6.2, 6.8, 7.1, 6.9, 7.4, 7.0, 7.6],
          labels: ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "今日"],
          unit: "千",
        },
        {
          type: "donut",
          title: "设备状态构成",
          sub: "全量设备 · 按生命周期",
          unit: "%",
          segments: [
            { label: "产出中", value: 71, color: "var(--admin-cat-1)" },
            { label: "冷却 / 维护", value: 14, color: "var(--admin-cat-3)" },
            { label: "临近衰减期", value: 9, color: "var(--admin-cat-4)" },
            { label: "已失效 / 待置换", value: 6, color: "var(--admin-cat-8)" },
          ],
        },
        {
          type: "bars",
          title: "近 8 月网络节点增长",
          sub: "每月新增绑定节点",
          color: "var(--admin-domain-l)",
          data: [420, 510, 640, 720, 805, 860, 803, 769],
          labels: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
        },
      ],
      controlLink: { label: "调设备/任务参数", href: "/devices/tasks" },
      note: "设备在役升至 9,140 台(产出中占 71%,临近衰减 9%),任务完成率 76.4% 与 Nova CTR 31% 双双向好。网络新增节点环比 -34 略有回落,需关注裂变动能;设备失效 6% 联动 E5 Trade-in 置换。口径来自 E/F 域台账经 A4 聚合。",
    },
  },
  {
    path: "/analytics/export",
    summary:
      "导出 & 监管报告 — 标准化报表与监管报送的生成、周期与下载管理。报告内容快照自 A4 事件流与结算账本;敏感报告导出需经 A2 审计留痕,生成任务不可篡改。",
    content: {
      kind: "list",
      metrics: [
        { label: "报告类型", value: "8", sub: "已配置模板", accent: "var(--admin-domain-l)", hint: "纳入排程的标准报表模板数。" },
        { label: "今日已生成", value: "5", sub: "成功 5 / 失败 0", accent: "var(--v5-success)", hint: "今日完成生成并可下载的报告数。" },
        { label: "排程中", value: "2", sub: "等待周期触发", accent: "var(--v5-warning)", hint: "已配置但尚未到生成周期的报告。" },
        { label: "监管报送", value: "3", sub: "本月待报送", accent: "var(--admin-domain-l)", hint: "需按监管周期对外报送的报告数。" },
      ],
      search: "搜索报告名 / 类型",
      filterKey: "type",
      filters: ["全部", "KPI 汇总", "财务报表", "运营报表", "监管报送", "明细导出"],
      columns: [
        { key: "name", header: "报告名" },
        { key: "type", header: "类型" },
        { key: "cycle", header: "周期" },
        { key: "format", header: "格式", mono: true },
        { key: "updated", header: "数据截至", mono: true, align: "right" },
        { key: "state", header: "生成状态", status: true },
      ],
      rows: [
        { name: "八项验收 KPI 周报", type: "KPI 汇总", cycle: "每周一", format: "PDF", updated: "06-01 24:00", state: "已生成" },
        { name: "兑付覆盖率与净敞口月报", type: "财务报表", cycle: "每月 1 日", format: "XLSX", updated: "06-01 24:00", state: "已生成" },
        { name: "生命周期漏斗 / Cohort 月报", type: "运营报表", cycle: "每月 1 日", format: "PDF", updated: "06-01 24:00", state: "已生成" },
        { name: "设备 / 任务 / 网络运营周报", type: "运营报表", cycle: "每周一", format: "XLSX", updated: "06-01 24:00", state: "已生成" },
        { name: "资金流水监管报送(KYC/AML)", type: "监管报送", cycle: "每月 5 日", format: "CSV", updated: "05-31 24:00", state: "排程中" },
        { name: "大额提现与异常账户报送", type: "监管报送", cycle: "每月 5 日", format: "CSV", updated: "05-31 24:00", state: "排程中" },
        { name: "用户事件明细导出(A4)", type: "明细导出", cycle: "按需", format: "CSV", updated: "06-02 14:00", state: "生成中" },
        { name: "Genesis 发行与分红台账", type: "财务报表", cycle: "每月 1 日", format: "XLSX", updated: "05-01 24:00", state: "已失败" },
      ],
      primaryAction: { label: "新建报告", fields: ["报告名", "类型", "周期"] },
      rowActions: [
        { label: "生成报告" },
        { label: "下载" },
        { label: "重跑" },
      ],
      note: "报告内容快照自 A4 事件流与 server 端结算账本,口径与 KPI 看板 / 财务报表一致。监管报送类报告导出需经 A2 审计留痕;生成失败项可重跑,生成任务记录 append-only 不可篡改。",
    },
  },
];
