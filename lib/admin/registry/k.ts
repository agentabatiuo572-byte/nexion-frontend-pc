/**
 * 域 K 风控与反作弊 — 注册表。accent=--admin-domain-k(高危/拦截类用语义 danger/warning)。
 * ⚠️ K ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = k-view.tsx + k-tabs/),仅 summary 经 DomainHeader 渲染。
 * 改 K 域数据/动作请改 k-tabs/data.ts 与 lib/mock/admin/design-data.ts(K_RISK),勿在此处改 content。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

export const DOMAIN_K: ModuleEntry[] = [
  {
    path: "/risk/multi-account",
    summary: "反多账户引擎(K1)。IP / 设备指纹 / 支付工具三层去重聚成关联簇(强度≥0.7 标红建议冻结);批量冻结 / 解除误判 / 判正常均 操作确认,冻结台账落 C2;IP 白名单权威归 K1。",
    content: {
      kind: "list",
      metrics: [
        { label: "活跃关联簇", value: "57", sub: "≥2 账户", accent: "var(--admin-domain-k)", hint: "由设备 / IP / 资金 / 行为信号聚合出的多账户群组数。" },
        { label: "高危簇", value: "9", sub: "待处置", accent: "var(--v5-danger)", hint: "命中分≥80、疑似批量注册或对敲套利的关联簇。" },
        { label: "异常账户", value: "342", sub: "入簇账户", accent: "var(--v5-warning)", hint: "进入任一关联簇、被标记需观察的账户总数。" },
        { label: "今日新增簇", value: "4", sub: "近 24h", accent: "var(--admin-domain-k)" },
      ],
      search: "搜索簇号 / 账户 / 设备指纹",
      filterKey: "disposal",
      filters: ["全部", "高危拦截", "限制提现", "观察", "已通过"],
      columns: [
        { key: "cluster", header: "关联簇", mono: true },
        { key: "accounts", header: "账户数", align: "right", mono: true },
        { key: "signal", header: "关联信号" },
        { key: "device", header: "共享设备 / IP", mono: true },
        { key: "fundlink", header: "资金往来", mono: true, align: "right" },
        { key: "score", header: "命中分", align: "right", mono: true },
        { key: "disposal", header: "处置", status: true },
      ],
      rows: [
        { cluster: "CLS-2606-018", accounts: "14", signal: "同设备指纹 + 资金对敲", device: "fp:7a3c·1 / 3 IP", fundlink: "$4,820", score: "92", disposal: "高危拦截" },
        { cluster: "CLS-2606-017", accounts: "8", signal: "同 WiFi 网段 + 推荐闭环", device: "fp:4 / IP:203.0.* ", fundlink: "$1,240", score: "84", disposal: "高危拦截" },
        { cluster: "CLS-2606-015", accounts: "6", signal: "资金归集到同一收款地址", device: "fp:6 / 6 IP", fundlink: "$2,070", score: "76", disposal: "限制提现" },
        { cluster: "CLS-2606-012", accounts: "5", signal: "设备指纹相似 + 同时段活跃", device: "fp:3 / 5 IP", fundlink: "$310", score: "63", disposal: "限制提现" },
        { cluster: "CLS-2606-009", accounts: "4", signal: "同 IP 批量注册", device: "fp:4 / IP:198.51.* ", fundlink: "$0", score: "58", disposal: "观察" },
        { cluster: "CLS-2606-006", accounts: "3", signal: "行为轨迹高度同步", device: "fp:3 / 3 IP", fundlink: "$45", score: "41", disposal: "观察" },
        { cluster: "CLS-2606-003", accounts: "2", signal: "家庭共享设备(申诉通过)", device: "fp:1 / 1 IP", fundlink: "$0", score: "22", disposal: "已通过" },
        { cluster: "CLS-2605-291", accounts: "2", signal: "同设备先后登录(已澄清)", device: "fp:1 / 2 IP", fundlink: "$0", score: "18", disposal: "已通过" },
      ],
      detail: true,
      rowActions: [
        { label: "确认关联", tone: "danger", whenStatus: "高危拦截" },
        { label: "解除关联" },
        { label: "封禁全簇", tone: "danger" },
      ],
      note: "关联簇由 K4 评分与设备指纹引擎实时聚合;簇级处置(冻结 / 限制提现 / 放行)需 操作确认 + A2 留痕,操作理由必填。家庭共享、同公司网络等正常场景经申诉可标记白名单。",
    },
  },
  {
    path: "/risk/abuse",
    summary: "套利 & 刷量检测(K2)。闭环分级判定(≥2 层预警转人工 / 3 层全中判闭环):试用循环 / 换新套利(门槛归 E3 只读)/ 新人礼刷取 / 排行榜刷榜(处置归 F8);K2 只标记 + 产信号,批量冻结复用 K1 操作链。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日命中", value: "14", sub: "待确认 5", accent: "var(--admin-domain-k)", hint: "今日检测模型命中的疑似套利 / 刷量事件数。" },
        { label: "高危事件", value: "6", sub: "置信度≥0.85", accent: "var(--v5-danger)", hint: "高置信、建议直接拦截的套利事件。" },
        { label: "拦截金额", value: "$3,180", sub: "近 7 日", accent: "var(--v5-success)", hint: "近 7 日因命中而暂缓 / 冻结的疑似套利资金。" },
        { label: "误报率", value: "4.2%", sub: "申诉转正常", accent: "var(--v5-ink-3)" },
      ],
      search: "搜索账户 / 事件类型",
      filterKey: "state",
      filters: ["全部", "拦截", "待确认", "观察", "已通过"],
      columns: [
        { key: "evt", header: "事件号", mono: true },
        { key: "type", header: "类型" },
        { key: "account", header: "账户", mono: true },
        { key: "feature", header: "异常特征" },
        { key: "amount", header: "涉及金额", mono: true, align: "right" },
        { key: "conf", header: "置信度", align: "right", mono: true },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { evt: "AB-2606-204", type: "试用套利", account: "U-88421", feature: "批量领试用后集中提取抵扣", amount: "$640", conf: "0.93", state: "拦截" },
        { evt: "AB-2606-198", type: "对敲返佣", account: "U-77310", feature: "关联账户互购刷返佣层级", amount: "$1,120", conf: "0.88", state: "拦截" },
        { evt: "AB-2606-191", type: "收益刷量", account: "U-90233", feature: "设备产出曲线异常陡增", amount: "$420", conf: "0.86", state: "拦截" },
        { evt: "AB-2606-187", type: "提现套现", account: "U-66155", feature: "充值后即满额提现、零持有", amount: "$2,000", conf: "0.79", state: "待确认" },
        { evt: "AB-2606-182", type: "设备空转", account: "U-81044", feature: "无登录但持续产出 30d", amount: "$310", conf: "0.74", state: "待确认" },
        { evt: "AB-2606-176", type: "推荐刷量", account: "U-72980", feature: "短时绑定大量空壳下线", amount: "$0", conf: "0.69", state: "观察" },
        { evt: "AB-2606-170", type: "试用套利", account: "U-69500", feature: "多设备同人脸试用", amount: "$180", conf: "0.61", state: "观察" },
        { evt: "AB-2606-161", type: "收益刷量", account: "U-58233", feature: "波动在正常区间(申诉通过)", amount: "$95", conf: "0.34", state: "已通过" },
      ],
      detail: true,
      rowActions: [
        { label: "确认违规", tone: "danger", whenStatus: "待确认" },
        { label: "标记误报", whenStatus: "待确认" },
        { label: "冻结账户", tone: "danger" },
      ],
      note: "检测特征由 A4 事件流 + 设备指纹实时计算;置信度≥0.85 自动进入拦截队列、暂缓相关提现,其余进入人工确认。拦截 / 解除均写入 A2,误报经申诉回滚并回灌模型训练样本。",
    },
  },
  {
    path: "/risk/withdrawal-rules",
    summary: "提现风控规则引擎(K3)。金额 / 速度 / 新账户 / 地址信誉四维规则 → pass/delay/freeze/manual 路由,结论 D2 照单消费且优先级高于小额快速通道;规则 CRUD 与启停操作确认,archived 终态(激活返 409),pass 不产事件。",
    content: {
      kind: "config",
      metrics: [
        { label: "生效规则", value: "23", sub: "开 21 / 关 2", accent: "var(--admin-domain-k)", hint: "当前已启用的提现风控规则条数。" },
        { label: "今日触发", value: "61", sub: "拦截 14", accent: "var(--v5-warning)", hint: "今日命中任一规则的提现单数,其中触发拦截 / 暂缓的数量。" },
        { label: "高危拦截", value: "14", sub: "转人工确认", accent: "var(--v5-danger)" },
        { label: "黑名单地址", value: "38", sub: "链上 + 内部", accent: "var(--v5-ink-3)" },
      ],
      groups: [
        {
          title: "阈值规则",
          note: "命中即触发对应动作,可叠加;金额以 USDT 计。",
          fields: [
            { label: "单笔大额阈值", value: "$1,000", range: "$500–$10,000", effect: "超过 → 转人工确认" },
            { label: "单日累计上限", value: "$5,000", range: "$1,000–$50,000", effect: "超过 → 暂缓至次日 + 确认" },
            { label: "高危评分阈值", value: "≥70 分", range: "50–90", effect: "命中 → 暂缓并进入操作确认(联动 K4)" },
            { label: "新账户提现门槛", value: "持有≥7 天", range: "0–30 天", effect: "未达 → 拒绝,防试用套现" },
          ],
        },
        {
          title: "速率规则",
          note: "防短时高频套现与脚本批量提现。",
          fields: [
            { label: "提现频率", value: "≤3 次 / 24h", range: "1–10 次", effect: "超频 → 暂缓 + 确认" },
            { label: "提现间隔", value: "≥30 min", range: "5–120 min", effect: "过密 → 进入观察队列" },
            { label: "充提比下限", value: "持有≥30%", range: "0–80%", effect: "充值后即提 → 拦截(联动 K2)" },
          ],
        },
        {
          title: "黑名单 & 行为",
          note: "命中黑名单或高危行为直接拦截。",
          fields: [
            { label: "收款地址黑名单", value: "启用 · 38 条", range: "开 / 关", effect: "命中 → 拒绝并标记账户" },
            { label: "关联簇连带", value: "启用", range: "开 / 关", effect: "同簇高危 → 全簇暂缓(联动 K1)" },
            { label: "异地登录提现", value: "启用 · 跨国拦截", range: "开 / 关", effect: "新地区首次 → 暂缓 + 二次验证" },
          ],
        },
      ],
      confirmPolicy: "规则阈值 / 开关变更需风控 lead / 超管执行操作确认;阈值放宽(上调上限 / 下调评分门槛)即时影响放行口径,变更前后值写入 A2 审计。",
      impact: [
        "上调单笔 / 单日上限 → 放行更快但资金外流风险上升,联动 D 域净流出监控",
        "下调高危评分阈值 → 更多提现进入人工确认,D 域积压与处理时延增加",
        "关闭关联簇连带 → K1 高危簇成员可独立提现,套利绕过风险上升",
      ],
    },
  },
  {
    path: "/risk/scoring",
    summary: "风险评分模型(K4)。六维权重(和=1 双端校验)合成 0–100 分,低<40/中 40–69/高≥70,≥85 自动建议转人工;全平台唯一评分源(D2/C1/B5 只引用不重算),每分可解释;权重/分档变更 = 平台管理员执行门槛。",
    content: {
      kind: "config",
      metrics: [
        { label: "评分均值", value: "38", sub: "/ 100 · 在审提现", accent: "var(--admin-domain-k)", hint: "当前在审提现单的风险评分均值,与首页风控雷达同源。" },
        { label: "高危占比", value: "6.1%", sub: "≥70 分账户", accent: "var(--v5-danger)", hint: "风险分≥70、被判定高危的账户占比。" },
        { label: "评分维度", value: "6", sub: "加权合成", accent: "var(--admin-domain-k)", hint: "纳入综合评分的一级风险维度数量。" },
        { label: "模型版本", value: "v2.3", sub: "近 7 日校准", accent: "var(--v5-ink-3)" },
      ],
      groups: [
        {
          title: "评分维度与权重",
          note: "各维度 0–100 子分,按权重加权合成总分;权重和为 100%。",
          fields: [
            { label: "设备 / 指纹异常", value: "权重 25%", range: "0–40%", effect: "多账户共享设备 → 子分拉高(联动 K1)" },
            { label: "资金行为", value: "权重 25%", range: "0–40%", effect: "充提比异常 / 即充即提 → 子分拉高" },
            { label: "套利 / 刷量信号", value: "权重 20%", range: "0–35%", effect: "命中 K2 检测 → 子分拉高" },
            { label: "账户年龄 / 持有", value: "权重 15%", range: "0–30%", effect: "新账户 / 零持有 → 子分拉高" },
            { label: "关联网络", value: "权重 10%", range: "0–25%", effect: "处于高危簇 → 子分拉高" },
            { label: "KYC / 身份", value: "权重 5%", range: "0–20%", effect: "未实名 / 资料异常 → 子分拉高" },
          ],
        },
        {
          title: "分段阈值与动作",
          note: "总分映射到风险分段,驱动 K3 提现规则与账户处置。",
          fields: [
            { label: "低危 0–39", value: "正常放行", range: "0–50", effect: "无额外限制" },
            { label: "中危 40–69", value: "加验 / 限额", range: "40–70", effect: "提现需二次验证、单日限额收紧" },
            { label: "高危 70–100", value: "暂缓 + 人工确认", range: "60–90", effect: "命中 → 提现暂缓,进入 D 域确认(联动 K3)" },
          ],
        },
      ],
      confirmPolicy: "维度权重 / 分段阈值调整需平台管理员执行操作确认;阈值下调(放宽高危判定)与权重重分配会改变全平台风险口径,变更写入 A2 并触发一次全量重算。",
      impact: [
        "上调高危分段下限(如 70→80)→ 高危账户减少、放行变松,套现与套利漏过风险上升",
        "提高资金行为权重 → 即充即提类账户评分上升,K3 暂缓量增加",
        "权重 / 阈值变更触发全量重算 → K1 簇命中分、D 域在审评分均值同步刷新",
      ],
    },
  },
  {
    path: "/risk/kyc-review",
    summary: "大额 KYC 复审 & 告警(K5)。大额提现 ≥$1,000 / 累计 $100 lifetime / 大额兑换(阈值归 G2)/ K4 分 ≥85 触发增强复审,复审期提现单 D2 冻结;裁决操作确认回写 C4(K5 不持 KYC 状态),SLA 7 工作日超时自动告警。",
    content: {
      kind: "list",
      metrics: [
        { label: "待复审", value: "5", sub: "大额 + 高危", accent: "var(--admin-domain-k)", hint: "等待人工 KYC 复审的工单数。" },
        { label: "今日告警", value: "14", sub: "风险命中触发", accent: "var(--v5-warning)", hint: "今日因大额 / 高危评分触发的 KYC 复审告警数。" },
        { label: "驳回", value: "3", sub: "近 7 日", accent: "var(--v5-danger)", hint: "近 7 日 KYC 复审未通过、被驳回的工单数。" },
        { label: "平均时效", value: "2.4h", sub: "受理→结案", accent: "var(--v5-ink-3)" },
      ],
      search: "搜索工单 / 用户",
      filterKey: "state",
      filters: ["全部", "高危告警", "待复审", "通过", "拒绝"],
      columns: [
        { key: "ticket", header: "工单号", mono: true },
        { key: "user", header: "用户", mono: true },
        { key: "amount", header: "涉及金额", mono: true, align: "right" },
        { key: "kyc", header: "KYC 等级" },
        { key: "alert", header: "告警来源" },
        { key: "score", header: "风险分", align: "right", mono: true },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { ticket: "KR-2606-051", user: "U-66155", amount: "$2,000", kyc: "L1 基础", alert: "大额提现 + 零持有", score: "81", state: "高危告警" },
        { ticket: "KR-2606-049", user: "U-90233", amount: "$1,800", kyc: "L1 基础", alert: "K2 收益刷量命中", score: "78", state: "高危告警" },
        { ticket: "KR-2606-047", user: "U-88421", amount: "$3,200", kyc: "L2 进阶", alert: "关联簇高危(K1)", score: "74", state: "待复审" },
        { ticket: "KR-2606-044", user: "U-54120", amount: "$5,500", kyc: "L2 进阶", alert: "超单日上限", score: "62", state: "待复审" },
        { ticket: "KR-2606-040", user: "U-47833", amount: "$2,400", kyc: "L1 基础", alert: "异地登录提现", score: "57", state: "待复审" },
        { ticket: "KR-2606-035", user: "U-33910", amount: "$4,100", kyc: "L3 完整", alert: "大额提现例行复审", score: "29", state: "通过" },
        { ticket: "KR-2606-031", user: "U-28744", amount: "$2,600", kyc: "L2 进阶", alert: "大额充值核验", score: "24", state: "通过" },
        { ticket: "KR-2606-022", user: "U-19055", amount: "$1,900", kyc: "L1 基础", alert: "证件与人脸不符", score: "88", state: "拒绝" },
      ],
      detail: true,
      rowActions: [
        { label: "KYC 通过", tone: "primary", whenStatus: "待复审" },
        { label: "驳回", tone: "danger", whenStatus: "待复审" },
        { label: "要求补件", whenStatus: "待复审" },
      ],
      note: "大额阈值与触发条件由 K3 提现规则给定;复审结论(通过 / 驳回 / 补件)需经办 + 确认并写入 A2,驳回联动 K3 暂缓提现与 C 域账户限制。补件超时自动转催办告警。",
    },
  },
];
