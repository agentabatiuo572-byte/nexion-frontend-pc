/** 域 F 分销与团队 — 注册表。V-Rank 等级 / 网络版税 / 平衡匹配结算 / 领导奖池 / 佣金审计 / 硬件配额 / 区域大使 / 排行榜反欺诈。accent=--admin-domain-f。 */
import type { ModuleEntry } from "@/lib/admin/module-content";

export const DOMAIN_F: ModuleEntry[] = [
  {
    path: "/network/v-rank",
    summary: "V-Rank 等级体系 V0–V12 晋升门槛与权益。等级判定 server 端权威;门槛 / 权益改动需 增长运营 + 风控 双签并写入 A2 审计。",
    content: {
      kind: "config",
      metrics: [
        { label: "等级阶数", value: "13", sub: "V0–V12", accent: "var(--admin-domain-f)", hint: "V-Rank 体系的全部等级阶数。" },
        { label: "已达 V5+", value: "412", sub: "活跃用户", accent: "var(--admin-domain-f)", hint: "当前达到 V5 及以上的用户数。" },
        { label: "本月晋升", value: "1,083", sub: "净晋升", accent: "var(--v5-success)", delta: { dir: "up", text: "环比 +6.4%", good: true } },
        { label: "判定口径", value: "server", sub: "每日日切重算", accent: "var(--v5-ink-3)" },
      ],
      groups: [
        {
          title: "晋升门槛(阶梯)",
          note: "团队业绩按日切聚合重算;达标即升,回落保级一个结算周期。",
          fields: [
            { label: "V1 入门", value: "直推 2 · 团队规模 5", range: "门槛可配", effect: "解锁基础网络版税" },
            { label: "V3 进阶", value: "直推 4 · 团队规模 30", range: "门槛可配", effect: "解锁更高版税层" },
            { label: "V6 骨干", value: "直推 6 · 团队规模 200", range: "门槛可配", effect: "进入领导奖池候选" },
            { label: "V9 核心", value: "直推 8 · 团队规模 1,200", range: "门槛可配", effect: "领导奖池更高占比" },
            { label: "V12 顶阶", value: "直推 10 · 团队规模 6,000", range: "门槛可配", effect: "全权益解锁" },
          ],
        },
        {
          title: "等级权益",
          note: "权益随等级解锁;调整即时影响新结算周期。",
          fields: [
            { label: "网络版税层级", value: "随 V 级开放 L1–L7", range: "L1–L7", effect: "联动 F2 费率层" },
            { label: "领导奖池资格", value: "V6 起候选", range: "V4–V8 起", effect: "联动 F4 分配" },
            { label: "硬件配额额度", value: "随 V 级递增", range: "额度可配", effect: "联动 F6 配额池" },
            { label: "可见性 gating", value: "按等级渐进展示", range: "开 / 关", effect: "前端等级可见范围" },
          ],
        },
        {
          title: "保级与降级",
          note: "防止业绩短期波动造成等级抖动。",
          fields: [
            { label: "保级宽限", value: "1 个结算周期", range: "0–3 周期", effect: "回落后延迟降级" },
            { label: "降级步长", value: "每次降 1 阶", range: "1–2 阶", effect: "避免断崖式降级" },
            { label: "重算频率", value: "每日日切", range: "日 / 周", effect: "等级刷新节奏" },
          ],
        },
      ],
      approval: "门槛 / 权益 / 保级规则变更需 增长运营 + 风控 双签;改动写入 A2 审计,下一结算周期生效。",
      impact: [
        "上调晋升门槛 → 高阶用户占比下降,网络版税与领导奖池支出收缩",
        "放宽保级宽限 → 等级稳定性上升,但权益支出口径随之增加",
        "等级权益联动 F2 费率层 / F4 奖池 / F6 配额,任一调整需同步评估下游成本",
      ],
    },
  },
  {
    path: "/network/royalty",
    summary: "网络版税费率体系。Direct Royalty 固定 10%(不可调);Rate-Tier 作为 Partner Status 权益层(L1–L7),佣金计提受 30 天冷却约束。费率改动需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "Direct Royalty", value: "10%", sub: "固定 · 不可调", accent: "var(--admin-domain-f)", hint: "直接网络版税固定比例,产品锁定值。" },
        { label: "权益层级", value: "L1–L7", sub: "Partner Status", accent: "var(--admin-domain-f)", hint: "Rate-Tier 作为合伙人权益层,非费率叠加。" },
        { label: "冷却期", value: "30 天", sub: "佣金解锁", accent: "var(--v5-warning)", hint: "佣金计提后进入冷却,期满方可解锁。" },
        { label: "本月版税计提", value: "$1.84M", sub: "USDT + NEX", accent: "var(--v5-ink-3)", delta: { dir: "up", text: "环比 +3.1%", good: true } },
      ],
      groups: [
        {
          title: "Direct Royalty(固定)",
          note: "产品锁定比例,不开放调整;此处仅供查阅与审计追溯。",
          fields: [
            { label: "直接版税比例", value: "10%", range: "固定", effect: "锁定值,不可调" },
            { label: "计提基数", value: "下级有效产出", range: "口径固定", effect: "USDT / NEX 双币计提" },
            { label: "结算币种", value: "USDT + NEX", range: "口径固定", effect: "按产出币种原币计提" },
          ],
        },
        {
          title: "Partner Status 权益层(L1–L7)",
          note: "权益层级随 V-Rank 开放;调整影响层级权益范围,不改变 Direct Royalty 比例。",
          fields: [
            { label: "L1–L2 基础层", value: "标准权益", range: "权益可配", effect: "基础结算优先级" },
            { label: "L3–L5 进阶层", value: "增强权益", range: "权益可配", effect: "更高配额 / 优先解锁" },
            { label: "L6–L7 顶层", value: "全权益", range: "权益可配", effect: "联动 F4 领导奖池占比" },
            { label: "层级判定来源", value: "F1 V-Rank", range: "口径固定", effect: "随等级日切刷新" },
          ],
        },
        {
          title: "佣金冷却",
          note: "防止短期套利;冷却期内佣金不可解锁、不可提现。",
          fields: [
            { label: "冷却天数", value: "30 天", range: "7–60 天", effect: "下调 → 解锁加快,套利风险上升" },
            { label: "冷却起算", value: "计提次日 0 点", range: "口径固定", effect: "按结算日切起算" },
            { label: "提前解锁", value: "不开放", range: "开 / 关", effect: "需 风控 单独审批" },
          ],
        },
      ],
      approval: "Direct Royalty 为产品锁定值不开放调整;权益层 / 冷却天数变更需 财务 + 风控 双签,写入 A2 审计。",
      impact: [
        "缩短佣金冷却 → 解锁加速,短期套利与异常增长风险上升,联动 F8 反欺诈监控",
        "调整 Partner Status 权益层 → 影响顶层用户配额与领导奖池占比,需同步 F4 评估",
        "版税计提口径变动 → 直接影响 D4 commission bill 计提与 B5 头部集中度",
      ],
    },
  },
  {
    path: "/network/binary",
    summary: "平衡匹配结算引擎。按 Track A / Track B 两路业绩取较小侧匹配计酬,auto-placement 自动归位,设日封顶。封顶与匹配比例改动需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "匹配比例", value: "10%", sub: "min(A,B)", accent: "var(--admin-domain-f)", hint: "取两路较小侧业绩的计酬比例。" },
        { label: "日封顶(月1–6)", value: "$5,000", sub: "单用户 / 日", accent: "var(--v5-warning)", hint: "前 6 个月单用户每日匹配计酬上限。" },
        { label: "日封顶(月7+)", value: "$2,000", sub: "单用户 / 日", accent: "var(--v5-warning)", hint: "第 7 个月起单用户每日匹配计酬上限。" },
        { label: "今日匹配计提", value: "$268K", sub: "全网", accent: "var(--v5-ink-3)" },
      ],
      groups: [
        {
          title: "平衡匹配规则",
          note: "取 Track A / Track B 两路较小侧业绩匹配计酬,结余结转下一周期。",
          fields: [
            { label: "匹配比例", value: "10%", range: "5–15%", effect: "上调 → 匹配支出线性放大" },
            { label: "计酬基数", value: "min(Track A, Track B)", range: "口径固定", effect: "较小侧业绩" },
            { label: "结余结转", value: "较大侧结转下周期", range: "开 / 关", effect: "关 → 结余清零" },
            { label: "结算周期", value: "每日日切", range: "日 / 周", effect: "匹配计提节奏" },
          ],
        },
        {
          title: "Auto-placement(自动归位)",
          note: "新成员按平衡策略自动归入两路,维持双侧业绩均衡。",
          fields: [
            { label: "归位策略", value: "弱侧优先", range: "弱侧 / 轮替", effect: "维持双轨平衡" },
            { label: "归位时点", value: "绑定即归位", range: "口径固定", effect: "联动 F5 推荐绑定事件" },
            { label: "手动改位", value: "需审批", range: "开 / 关", effect: "改位写入 A2 审计" },
          ],
        },
        {
          title: "日封顶(分段)",
          note: "封顶随平台月龄分段下调,防止结算敞口随网络扩张失控。封顶主控归 H1 阶段拨盘。",
          fields: [
            { label: "月 1–6 封顶", value: "$5,000 / 日", range: "$1,000–$8,000", effect: "前期较高激励" },
            { label: "月 7+ 封顶", value: "$2,000 / 日", range: "$500–$5,000", effect: "后期收敛敞口" },
            { label: "超额处理", value: "当日截断不结转", range: "截断 / 结转", effect: "结转 → 敞口累积" },
          ],
        },
      ],
      approval: "匹配比例 / 封顶 / auto-placement 策略变更需 财务 + 风控 双签;封顶分段与 H1 阶段拨盘联动,改动写入 A2 审计。",
      impact: [
        "上调匹配比例或封顶 → 结算支出与资金敞口同步放大,需同步 D4 计提评估",
        "放宽超额结转 → 单用户累积敞口上升,联动 B5 头部集中度监控",
        "auto-placement 改位需审批留痕,防止人为操纵双侧业绩均衡",
      ],
    },
  },
  {
    path: "/network/leadership-pool",
    summary: "领导奖池。按平台版税收入计提固定比例入池,在达标领导层间按权重分配,周期结算。奖池比例 / 分配权重改动需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "奖池比例", value: "5%", sub: "周 GMV 计提", accent: "var(--admin-domain-f)", hint: "从周交易额(GMV)计提入池的比例(基准 5%)。" },
        { label: "本期奖池", value: "$96,400", sub: "待分配", accent: "var(--admin-domain-f)", hint: "本结算周期累计入池金额。" },
        { label: "达标领导", value: "84", sub: "V6+ 候选", accent: "var(--v5-success)" },
        { label: "结算周期", value: "周结", sub: "每周一日切", accent: "var(--v5-ink-3)" },
      ],
      groups: [
        {
          title: "奖池计提",
          note: "按平台版税收入比例入池;计提即时,分配按周期。",
          fields: [
            { label: "入池比例", value: "5%", range: "1–5%", effect: "上调 → 奖池规模放大" },
            { label: "计提来源", value: "网络版税收入", range: "口径固定", effect: "联动 F2 版税计提" },
            { label: "入池币种", value: "USDT", range: "口径固定", effect: "统一以 USDT 入池" },
          ],
        },
        {
          title: "分配权重",
          note: "在达标领导层间按等级与团队贡献加权分配。",
          fields: [
            { label: "资格门槛", value: "V6 及以上", range: "V4–V8", effect: "联动 F1 等级判定" },
            { label: "等级权重", value: "V6:1 / V9:2 / V12:3", range: "权重可配", effect: "高阶占比更大" },
            { label: "团队贡献权重", value: "团队 GMV 占比", range: "权重可配", effect: "贡献越大份额越高" },
            { label: "单人封顶", value: "奖池 8%", range: "5–15%", effect: "防止单人独占" },
          ],
        },
        {
          title: "结算",
          note: "周期结算后入用户佣金账户,受 F2 冷却约束。",
          fields: [
            { label: "结算周期", value: "周结", range: "周 / 月", effect: "分配节奏" },
            { label: "结算日", value: "每周一日切", range: "口径固定", effect: "按 UTC 日切" },
            { label: "未达标余额", value: "结转下期", range: "结转 / 清零", effect: "清零 → 奖池不累积" },
          ],
        },
      ],
      approval: "奖池比例 / 分配权重 / 单人封顶变更需 财务 + 风控 双签;分配名单按 F1 等级日切快照,改动写入 A2 审计。",
      impact: [
        "上调入池比例 → 奖池规模放大,平台版税净留存下降",
        "放宽资格门槛 → 分配人数上升,人均份额摊薄,需评估激励效果",
        "单人封顶与团队贡献权重联动 B5 头部集中度,防止奖池过度集中",
      ],
    },
  },
  {
    path: "/network/commissions",
    summary: "佣金事件审计流水。按 kind 记录每笔佣金计提(network / binary / peer / cultivation / leadership / genesis / leaderboard_prize),含层级 / 金额 / 冷却 / 状态。异常事件冻结需 风控 单签 + A2 留痕。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日佣金事件", value: "3,142", sub: "全 kind", accent: "var(--admin-domain-f)", hint: "今日写入的佣金计提事件总数。" },
        { label: "冷却中", value: "1,886", sub: "30 天未解锁", accent: "var(--v5-warning)", hint: "处于冷却期、尚未解锁的事件数。" },
        { label: "今日计提额", value: "$412K", sub: "USDT + NEX", accent: "var(--admin-domain-f)" },
        { label: "异常拦截", value: "7", sub: "待风控复核", accent: "var(--v5-danger)", hint: "命中风控规则被冻结的事件。" },
      ],
      search: "搜索用户 / 事件号",
      filterKey: "kind",
      filters: ["全部", "network", "binary", "peer", "cultivation", "leadership", "genesis", "leaderboard_prize"],
      columns: [
        { key: "ts", header: "时间", mono: true },
        { key: "evt", header: "事件号", mono: true },
        { key: "uid", header: "用户", mono: true },
        { key: "kind", header: "类型" },
        { key: "layer", header: "层级" },
        { key: "amount", header: "金额", mono: true, align: "right" },
        { key: "cooling", header: "冷却" },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { ts: "14:06:22", evt: "CM-2606-9921", uid: "U-44218", kind: "network", layer: "L2", amount: "+$48.20", cooling: "剩 22 天", state: "冷却中" },
        { ts: "14:03:51", evt: "CM-2606-9920", uid: "U-77310", kind: "binary", layer: "—", amount: "+$216.00", cooling: "剩 30 天", state: "冷却中" },
        { ts: "13:59:08", evt: "CM-2606-9918", uid: "U-21044", kind: "leadership", layer: "—", amount: "+$1,148.00", cooling: "已解锁", state: "已解锁" },
        { ts: "13:50:30", evt: "CM-2606-9915", uid: "U-90233", kind: "peer", layer: "L1", amount: "+$12.50", cooling: "已解锁", state: "已解锁" },
        { ts: "13:42:17", evt: "CM-2606-9912", uid: "U-88421", kind: "cultivation", layer: "L3", amount: "+$30.00", cooling: "剩 18 天", state: "冷却中" },
        { ts: "13:31:44", evt: "CM-2606-9908", uid: "U-50127", kind: "genesis", layer: "—", amount: "+$24.00", cooling: "已解锁", state: "已解锁" },
        { ts: "13:20:05", evt: "CM-2606-9903", uid: "U-66390", kind: "leaderboard_prize", layer: "—", amount: "+$200.00", cooling: "剩 30 天", state: "冷却中" },
        { ts: "13:08:39", evt: "CM-2606-9899", uid: "U-31882", kind: "binary", layer: "—", amount: "+$340.00", cooling: "—", state: "已冻结" },
      ],
      detail: true,
      rowActions: [
        { label: "冻结佣金", tone: "danger", whenStatus: "冷却中" },
        { label: "解锁" },
        { label: "驳回" },
      ],
      note: "佣金事件 append-only,server 端权威;冷却中事件不可解锁 / 提现。命中风控规则的事件自动冻结,解冻需 风控 复核 + A2 留痕。",
    },
  },
  {
    path: "/network/quota",
    summary: "硬件配额池。按 V-Rank 等级分配可购 / 可激励硬件额度,设回收规则。配额额度 / 回收策略改动需 增长运营 + 财务 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "总配额池", value: "12,000", sub: "台 · 本季", accent: "var(--admin-domain-f)", hint: "本季度硬件配额总额度。" },
        { label: "已分配", value: "8,640", sub: "占 72%", accent: "var(--admin-domain-f)", hint: "已下放至各等级的额度。" },
        { label: "已回收", value: "1,204", sub: "过期 / 未用", accent: "var(--v5-warning)", hint: "因过期或未使用回收入池的额度。" },
        { label: "剩余可用", value: "2,156", sub: "待分配", accent: "var(--v5-success)" },
      ],
      groups: [
        {
          title: "配额额度",
          note: "按 V-Rank 等级阶梯分配;额度随等级递增。",
          fields: [
            { label: "V1–V3 额度", value: "5 台 / 季", range: "额度可配", effect: "基础采购权益" },
            { label: "V4–V6 额度", value: "20 台 / 季", range: "额度可配", effect: "进阶采购权益" },
            { label: "V7–V9 额度", value: "60 台 / 季", range: "额度可配", effect: "骨干采购权益" },
            { label: "V10–V12 额度", value: "150 台 / 季", range: "额度可配", effect: "顶阶采购权益" },
          ],
        },
        {
          title: "分配规则",
          note: "额度按季度下放;来源为总配额池,联动 F1 等级判定。",
          fields: [
            { label: "分配周期", value: "按季下放", range: "季 / 月", effect: "额度刷新节奏" },
            { label: "等级判定来源", value: "F1 V-Rank", range: "口径固定", effect: "随等级日切快照" },
            { label: "超额申请", value: "需审批", range: "开 / 关", effect: "超额写入 A2 审计" },
          ],
        },
        {
          title: "回收",
          note: "未使用额度按规则回收入池,避免额度沉淀。",
          fields: [
            { label: "过期回收", value: "季末未用全回收", range: "开 / 关", effect: "防止额度沉淀" },
            { label: "降级回收", value: "降级超额部分回收", range: "开 / 关", effect: "联动 F1 降级" },
            { label: "回收去向", value: "回总配额池", range: "口径固定", effect: "可再分配" },
          ],
        },
      ],
      approval: "配额额度 / 分配周期 / 回收策略变更需 增长运营 + 财务 双签;超额申请与回收动作写入 A2 审计。",
      impact: [
        "上调各等级配额 → 硬件采购上限放大,联动 E 域库存与履约评估",
        "关闭过期回收 → 额度沉淀,总池可分配量下降",
        "降级回收联动 F1 等级判定,等级回落即触发超额部分回收",
      ],
    },
  },
  {
    path: "/network/ambassador",
    summary: "区域大使申请审批台。按地区受理大使资质申请,审核资质材料与团队规模,通过后授予区域权益。审批为双人复核,授予 / 驳回写入 A2 审计。",
    content: {
      kind: "list",
      metrics: [
        { label: "待审批", value: "9", sub: "本周提交", accent: "var(--v5-warning)", hint: "等待复核的大使申请数。" },
        { label: "在任大使", value: "63", sub: "覆盖 28 区域", accent: "var(--admin-domain-f)", hint: "当前在任的区域大使总数。" },
        { label: "本月通过", value: "14", sub: "已授予", accent: "var(--v5-success)", delta: { dir: "up", text: "环比 +2", good: true } },
        { label: "本月驳回", value: "5", sub: "资质不足", accent: "var(--v5-ink-3)" },
      ],
      search: "搜索申请人 / 地区",
      filterKey: "state",
      filters: ["全部", "待审批", "已通过", "已驳回", "已撤销"],
      columns: [
        { key: "appid", header: "申请号", mono: true },
        { key: "name", header: "申请人" },
        { key: "region", header: "地区" },
        { key: "vrank", header: "V 级" },
        { key: "team", header: "团队规模", mono: true, align: "right" },
        { key: "qual", header: "资质" },
        { key: "state", header: "审批", status: true },
      ],
      rows: [
        { appid: "AMB-2606-031", name: "陈*辉", region: "东南亚 · 越南", vrank: "V7", team: "1,420", qual: "材料齐备", state: "待审批" },
        { appid: "AMB-2606-030", name: "Putra W.", region: "东南亚 · 印尼", vrank: "V6", team: "880", qual: "材料齐备", state: "待审批" },
        { appid: "AMB-2606-028", name: "Lopez M.", region: "拉美 · 墨西哥", vrank: "V8", team: "2,160", qual: "材料齐备", state: "已通过" },
        { appid: "AMB-2606-026", name: "Okafor N.", region: "西非 · 尼日利亚", vrank: "V7", team: "1,540", qual: "材料齐备", state: "已通过" },
        { appid: "AMB-2606-024", name: "Kumar R.", region: "南亚 · 印度", vrank: "V5", team: "420", qual: "团队规模不足", state: "已驳回" },
        { appid: "AMB-2606-022", name: "Sari D.", region: "东南亚 · 马来", vrank: "V6", team: "760", qual: "材料补充中", state: "待审批" },
        { appid: "AMB-2606-019", name: "Costa F.", region: "拉美 · 巴西", vrank: "V9", team: "3,080", qual: "材料齐备", state: "已通过" },
        { appid: "AMB-2606-015", name: "Yusuf A.", region: "中东 · 阿联酋", vrank: "V8", team: "1,990", qual: "资质存疑", state: "已撤销" },
      ],
      detail: true,
      rowActions: [
        { label: "批准", tone: "primary", whenStatus: "待审批" },
        { label: "驳回", tone: "danger", whenStatus: "待审批" },
        { label: "要求补充资质", whenStatus: "待审批" },
      ],
      note: "大使资质审核含 V 级 / 团队规模 / 材料合规三项;授予与驳回为双人复核,结果写入 A2 审计。授予后区域权益与 F4 奖池资格联动。",
    },
  },
  {
    path: "/network/leaderboard",
    summary: "排行榜与反欺诈监控。展示团队 / 业绩排行,叠加异常增长与刷量检测;命中项产出套利嫌疑风险信号,取消资格执行联动 K2 / K1。",
    content: {
      kind: "dashboard",
      metrics: [
        { label: "上榜用户", value: "200", sub: "本期榜单", accent: "var(--admin-domain-f)", hint: "进入本期排行榜的用户数。" },
        { label: "异常增长命中", value: "11", sub: "待复核", accent: "var(--v5-warning)", hint: "团队增长曲线异常、待人工复核的账号。" },
        { label: "刷量命中", value: "4", sub: "K2 信号", accent: "var(--v5-danger)", hint: "命中刷量检测、已产出风控信号的账号。" },
        { label: "已取消资格", value: "3", sub: "本期执行", accent: "var(--v5-ink-3)", hint: "经复核取消上榜资格的账号。" },
      ],
      charts: [
        {
          type: "bars",
          title: "团队业绩 Top 8",
          sub: "本期 · 千 USDT",
          color: "var(--admin-domain-f)",
          data: [328, 296, 271, 244, 218, 190, 173, 152],
          labels: ["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"],
          unit: "K",
        },
        {
          type: "area",
          title: "异常增长监控",
          sub: "近 14 日命中数 · 红线=告警阈值",
          color: "var(--v5-warning)",
          data: [2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 8, 7, 9, 11],
          refLine: 8,
        },
        {
          type: "donut",
          title: "反欺诈命中构成",
          sub: "本期 · 按检测维度",
          unit: "",
          segments: [
            { label: "异常增长", value: 11, color: "var(--v5-warning)" },
            { label: "刷量(K2)", value: 4, color: "var(--v5-danger)" },
            { label: "去重指纹(K1)", value: 6, color: "var(--admin-domain-f)" },
            { label: "正常上榜", value: 179, color: "var(--v5-ink-4)" },
          ],
        },
        {
          type: "bars",
          title: "近 7 日取消资格执行",
          sub: "经复核执行数",
          color: "var(--v5-danger)",
          data: [0, 1, 0, 2, 1, 0, 3],
          labels: ["一", "二", "三", "四", "五", "六", "日"],
        },
      ],
      controlLink: { label: "反刷量检测", href: "/risk/abuse" },
      note: "排行榜为只读展示;反欺诈命中由 K2 检测产出 risk.arbitrage_suspected 信号,去重复用 K1 引擎。取消上榜资格为双人复核执行,结果写入 A2 审计。",
    },
  },
];
