/** 域 G 金融产品 — 注册表(Staking / 兑换 / 行情 / Genesis / Premium / NEX v2 / 复投)。accent=--admin-domain-g。 */
import type { ModuleEntry } from "@/lib/admin/module-content";

export const DOMAIN_G: ModuleEntry[] = [
  {
    path: "/finance-products/staking",
    summary:
      "Staking 质押池产品参数 — APY / 锁期 / 池容量 / 赎回规则。APY 与池容量改动联动 C 域资金成本与 L 域产品报表;参数变更需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "池内 TVL", value: "$1.64M", sub: "全部锁仓档位", accent: "var(--admin-domain-g)", hint: "当前所有 Staking 档位锁定本金合计(USDT 计价)。" },
        { label: "加权 APY", value: "8.4%", sub: "按 TVL 加权", accent: "var(--admin-domain-g)", hint: "各档位 APY 按锁仓金额加权后的综合年化。" },
        { label: "池容量占用", value: "82%", sub: "$1.64M / $2.00M", accent: "var(--v5-warning)", hint: "已用 TVL 占池容量上限比例,接近上限将停止新增申购。" },
        { label: "待赎回队列", value: "$96K", sub: "未来 7 日到期", accent: "var(--v5-ink-3)", hint: "锁期到期进入赎回窗口的本金,需保障兑付流动性。" },
      ],
      groups: [
        {
          title: "收益与锁期档位",
          note: "APY 为年化名义收益;锁期越长 APY 越高。任一档位 APY 调整即时影响新申购与续期。",
          fields: [
            { label: "活期(无锁期)APY", value: "4.0%", range: "1.0%–6.0%", effect: "上调 → 资金成本上升,联动 C 域储备" },
            { label: "30 日锁期 APY", value: "7.0%", range: "4.0%–10.0%", effect: "主力档位,影响加权 APY 与转化" },
            { label: "90 日锁期 APY", value: "10.0%", range: "6.0%–14.0%", effect: "长锁高息,沉淀长期 TVL" },
            { label: "180 日锁期 APY", value: "13.5%", range: "8.0%–18.0%", effect: "封顶档位,上调显著抬高资金成本" },
            { label: "提前赎回罚息", value: "已计利息 30%", range: "0%–50%", effect: "下调 → 提前赎回增多,流动性承压" },
          ],
        },
        {
          title: "池容量与申购约束",
          note: "控制单池规模与单户敞口,防止集中度过高。",
          fields: [
            { label: "池容量上限", value: "$2,000,000", range: "$0.5M–$5M", effect: "达上限自动停申购,联动入口灰度" },
            { label: "单户申购上限", value: "$20,000", range: "$1K–$100K", effect: "下调 → 分散敞口,大户分流" },
            { label: "最低申购额", value: "$50", range: "$10–$500", effect: "门槛,影响零门槛入口转化" },
            { label: "新申购开关", value: "开启", range: "开 / 关", effect: "关 → Staking 入口停止接单" },
          ],
        },
        {
          title: "赎回与兑付",
          note: "赎回窗口与到账节奏影响用户体验与流动性安排。",
          fields: [
            { label: "到期赎回到账", value: "T+0 即时", range: "T+0 / T+1 / T+3", effect: "联动 D 域兑付流动性调度" },
            { label: "赎回手续费", value: "0%", range: "0%–1%", effect: "上调 → 提升留存,降低赎回意愿" },
            { label: "利息结算频率", value: "每日 UTC 00:00", range: "每日 / 每周", effect: "联动 A 域结算时区基准" },
          ],
        },
      ],
      approval: "Staking 产品参数变更需 财务 + 风控 双签;APY / 池容量 / 赎回到账节奏即时影响新申购与兑付,发起人不可自审。",
      impact: [
        "APY 上调 → 资金成本上升,联动 C 域储备充足率与平台收支模型",
        "池容量达上限 → 自动停止新申购,联动入口灰度与 H 域拉新转化",
        "赎回到账提速 / 罚息下调 → 提前赎回增多,联动 D 域兑付流动性调度",
      ],
    },
  },
  {
    path: "/finance-products/exchange",
    summary:
      "USDT ↔ NEX 兑换风控 — 费率 / 滑点保护 / 单笔与日限额 / 冷却期。限额与冷却联动 D 域反洗钱与 J 域 Kill-Switch;参数变更需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "今日兑换量", value: "$284K", sub: "双向合计", accent: "var(--admin-domain-g)", hint: "今日 USDT↔NEX 双向兑换成交额(USDT 计价)。" },
        { label: "净流向", value: "USDT→NEX", sub: "净 +$42K", accent: "var(--v5-tech-cyan)", hint: "今日净兑换方向,持续单向流出需关注 NEX 储备。" },
        { label: "滑点拦截", value: "37", sub: "今日超阈触发", accent: "var(--v5-warning)", hint: "因超出滑点保护阈值被拒绝的兑换请求数。" },
        { label: "限额命中", value: "12", sub: "日限 / 单笔", accent: "var(--v5-ink-3)", hint: "今日触达单笔或日限额上限的账户数。" },
      ],
      groups: [
        {
          title: "兑换费率",
          note: "费率按方向分别设定;改动即时作用于新发起的兑换。",
          fields: [
            { label: "USDT → NEX 费率", value: "0.30%", range: "0.10%–1.00%", effect: "上调 → 买入成本升,联动行情深度" },
            { label: "NEX → USDT 费率", value: "0.50%", range: "0.10%–1.50%", effect: "上调 → 抑制赎回卖压" },
            { label: "VIP 费率折扣", value: "Premium 7 折", range: "5–10 折", effect: "联动 G5 订阅权益" },
          ],
        },
        {
          title: "滑点保护",
          note: "防止极端行情下成交价大幅偏离报价。",
          fields: [
            { label: "默认滑点容忍", value: "0.5%", range: "0.1%–3.0%", effect: "下调 → 拦截增多,成交率下降" },
            { label: "滑点硬上限", value: "2.0%", range: "0.5%–5.0%", effect: "超限强制拒绝,保护用户与池" },
            { label: "报价有效期", value: "15 秒", range: "5–60 秒", effect: "过期需重新报价,防套利" },
          ],
        },
        {
          title: "限额与冷却",
          note: "控制单户兑换频率与规模,联动反洗钱监控。",
          fields: [
            { label: "单笔上限", value: "$10,000", range: "$1K–$50K", effect: "下调 → 大额拆分,联动 D 域风控" },
            { label: "单户日限额", value: "$30,000", range: "$5K–$100K", effect: "达限当日停兑,防异常搬砖" },
            { label: "兑换冷却期", value: "60 秒", range: "0–600 秒", effect: "两次兑换最小间隔,抗高频套利" },
            { label: "大额人工复核线", value: "$8,000", range: "$1K–$50K", effect: "超线转 D 域人工审,联动审计" },
          ],
        },
      ],
      approval: "兑换风控参数变更需 财务 + 风控 双签;费率 / 限额 / 冷却即时生效并联动 D 域反洗钱,发起人不可自审。",
      impact: [
        "费率上调 → 兑换成本升,联动 G3 行情深度与成交活跃度",
        "日限额 / 单笔上限下调 → 大额拆分增多,联动 D 域反洗钱与人工复核台",
        "兑换通道关闭 → 联动 A 域特性开关与 J 域 Kill-Switch,USDT↔NEX 即时停摆",
      ],
    },
  },
  {
    path: "/finance-products/market",
    summary:
      "NEX 行情引擎运行态 — 价格 / 成交 / 盘口深度 / 波动率。数据派生自 A4 事件流与撮合快照,口径服务端权威;用于监控做市健康度。",
    content: {
      kind: "dashboard",
      metrics: [
        { label: "NEX 现价", value: "$1.286", sub: "USDT 锚定", accent: "var(--admin-domain-g)", hint: "NEX 对 USDT 最新成交价。", delta: { dir: "up", text: "+1.8% 24h", good: true } },
        { label: "24h 成交额", value: "$612K", sub: "双向撮合", accent: "var(--v5-tech-cyan)", hint: "近 24 小时 NEX 撮合成交额(USDT 计价)。", delta: { dir: "up", text: "+9.2%", good: true } },
        { label: "盘口深度", value: "$148K", sub: "±2% 区间", accent: "var(--admin-domain-g)", hint: "买卖一档 ±2% 价格区间内的累计挂单深度。" },
        { label: "24h 波动率", value: "3.6%", sub: "已实现波动", accent: "var(--v5-warning)", hint: "近 24 小时已实现波动率,偏高时收紧滑点保护。", delta: { dir: "down", text: "-0.4pp", good: true } },
      ],
      charts: [
        {
          type: "area",
          title: "NEX 价格走势(24h)",
          sub: "每小时收盘价 · USDT",
          color: "var(--admin-domain-g)",
          unit: "$",
          refLine: 1.26,
          data: [1.252, 1.258, 1.249, 1.255, 1.263, 1.271, 1.268, 1.274, 1.281, 1.277, 1.286, 1.291],
        },
        {
          type: "bars",
          title: "分时成交额",
          sub: "近 8 小时 · 千 USDT",
          color: "var(--v5-tech-cyan)",
          unit: "K",
          labels: ["08", "10", "12", "14", "16", "18", "20", "22"],
          data: [62, 48, 71, 95, 84, 58, 67, 77],
        },
        {
          type: "donut",
          title: "净流向构成(24h)",
          sub: "兑换方向占比",
          unit: "%",
          segments: [
            { label: "USDT → NEX 买入", value: 54, color: "var(--v5-success)" },
            { label: "NEX → USDT 卖出", value: 41, color: "var(--v5-warning)" },
            { label: "内部划转", value: 5, color: "var(--v5-ink-3)" },
          ],
        },
        {
          type: "bars",
          title: "盘口深度分布",
          sub: "距中间价档位 · 千 USDT",
          color: "var(--admin-domain-g)",
          unit: "K",
          labels: ["-2%", "-1%", "-0.5%", "中", "+0.5%", "+1%", "+2%"],
          data: [38, 52, 41, 0, 39, 48, 36],
        },
      ],
      controlLink: { label: "调兑换风控", href: "/finance-products/exchange" },
      note: "行情数据派生自撮合快照与 A4 事件流,server 端权威;价格 / 深度异常将联动 G2 滑点保护与 J 域熔断阈值。本页只读,做市参数在 G2 / G4 调整。",
    },
  },
  {
    path: "/finance-products/genesis",
    summary:
      "Genesis 创世节点经济 — 节点供给 / 分红率 / 二级市场版税 2.5% / 流转开关。分红率与供给联动 C 域分红支出与 F 域权益;参数变更需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "节点流通量", value: "1,872", sub: "上限 2,100", accent: "var(--admin-domain-g)", hint: "已铸造并流通的 Genesis 节点数量。" },
        { label: "本期分红池", value: "$58.4K", sub: "待分配", accent: "var(--admin-domain-g)", hint: "本结算周期内归集、待向节点持有人分配的分红额。" },
        { label: "二级市场版税", value: "2.5%", sub: "每笔成交", accent: "var(--v5-tech-cyan)", hint: "Genesis 节点二级市场每笔转让按成交额抽取的平台版税。" },
        { label: "30 日地板价", value: "$1,240", sub: "二级市场", accent: "var(--v5-ink-3)", hint: "近 30 日 Genesis 节点二级市场最低成交价。" },
      ],
      groups: [
        {
          title: "节点供给",
          note: "控制创世节点总量与新增释放,稀缺性影响二级市场定价。",
          fields: [
            { label: "节点总量上限", value: "2,100", range: "固定 / 仅治理可改", effect: "硬顶,上调需治理签批" },
            { label: "本期新增释放", value: "0", range: "0–50 / 期", effect: "增发 → 稀释存量,压低地板价" },
            { label: "铸造单价", value: "$1,000", range: "$500–$2,000", effect: "一级发行价,影响认购热度" },
          ],
        },
        {
          title: "分红参数",
          note: "分红来自平台收入按比例归集;分红率即时影响节点持有人收益预期。",
          fields: [
            { label: "收入归集比例", value: "15%", range: "5%–30%", effect: "上调 → 分红池增厚,联动 C 域支出" },
            { label: "单节点本期分红", value: "$31.2", range: "随分红池浮动", effect: "派息口径,联动持有人收益" },
            { label: "分红结算频率", value: "每周 UTC 周一", range: "每日 / 每周 / 每月", effect: "联动 A 域结算时区" },
            { label: "未激活节点参与分红", value: "否", range: "是 / 否", effect: "关 → 仅激活节点分红,激励持有" },
          ],
        },
        {
          title: "二级市场",
          note: "节点可在二级市场转让;版税与流转开关控制市场活跃度与平台抽成。",
          fields: [
            { label: "二级市场流转", value: "开启", range: "开 / 关", effect: "关 → 节点锁定不可转让,联动 A 域开关" },
            { label: "成交版税", value: "2.5%", range: "0%–5%", effect: "上调 → 平台抽成增,抑制高频转让" },
            { label: "挂单价格区间", value: "地板价 50%–300%", range: "可配", effect: "防恶意抛压 / 哄抬" },
            { label: "最短持有期", value: "7 日", range: "0–90 日", effect: "防短炒,联动套利防护" },
          ],
        },
      ],
      approval: "Genesis 经济参数变更需 财务 + 风控 双签;节点供给增发与分红率即时影响持有人收益与二级市场,发起人不可自审。",
      impact: [
        "分红归集比例上调 → 分红池增厚,联动 C 域分红支出与平台收支模型",
        "节点增发 → 稀释存量收益,压低二级市场地板价,联动 F 域权益与持有信心",
        "二级市场流转关闭 → 节点锁定不可转让,联动 A 域特性开关与版税收入归零",
      ],
    },
  },
  {
    path: "/finance-products/premium",
    summary:
      "Premium 订阅产品 — 档位 / 价格 / 续费 / 权益矩阵。价格与权益联动 G2 兑换折扣与 C 域订阅收入;档位与权益变更需 财务 + 增长运营 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "活跃订阅", value: "2,140", sub: "全档位", accent: "var(--admin-domain-g)", hint: "当前处于有效订阅期内的账户总数。" },
        { label: "月订阅收入", value: "$31.6K", sub: "MRR", accent: "var(--admin-domain-g)", hint: "当月经常性订阅收入(USDT 计价)。" },
        { label: "续费率", value: "76%", sub: "近 30 日到期", accent: "var(--v5-success)", hint: "近 30 日到期订阅中完成续费的比例。" },
        { label: "年付占比", value: "34%", sub: "年 / 月付", accent: "var(--v5-ink-3)", hint: "选择年付档位的订阅占比,越高现金流越稳。" },
      ],
      groups: [
        {
          title: "档位与价格",
          note: "档位价格即时作用于新订阅与续费;存量订阅按原价直至到期。",
          fields: [
            { label: "Plus 月付", value: "$9.9 / 月", range: "$4.9–$19.9", effect: "入门档,影响订阅转化漏斗" },
            { label: "Plus 年付", value: "$99 / 年", range: "8.3–10 折月价", effect: "年付优惠,锁定长期现金流" },
            { label: "Pro 月付", value: "$29.9 / 月", range: "$19.9–$49.9", effect: "高阶档,联动权益深度" },
            { label: "Pro 年付", value: "$299 / 年", range: "8.3–10 折月价", effect: "高价值用户主力档" },
          ],
        },
        {
          title: "权益矩阵",
          note: "权益与其他产品域联动;调整即时影响在订用户感知。",
          fields: [
            { label: "兑换费率折扣", value: "Plus 9 折 / Pro 7 折", range: "5–10 折", effect: "联动 G2 兑换费率" },
            { label: "Staking APY 加成", value: "Pro +0.5pp", range: "0–2.0pp", effect: "联动 G1 收益,提升订阅价值" },
            { label: "提现优先通道", value: "Pro 专属", range: "开 / 关", effect: "联动 D 域提现排队" },
            { label: "复投奖励加成", value: "Pro +2%", range: "0%–5%", effect: "联动 G7 复投激励率" },
          ],
        },
        {
          title: "续费与试用",
          note: "续费与试用策略影响留存与拉新转化。",
          fields: [
            { label: "自动续费", value: "默认开启", range: "开 / 关", effect: "关 → 续费率下降,联动 MRR" },
            { label: "续费提醒提前量", value: "7 日", range: "1–30 日", effect: "影响主动续费与流失挽回" },
            { label: "新用户试用期", value: "7 日", range: "0–30 日", effect: "联动 H 域拉新与零门槛入口" },
            { label: "降档冷静期", value: "24 小时", range: "0–72 小时", effect: "防误操作,留存挽回窗口" },
          ],
        },
      ],
      approval: "Premium 订阅档位 / 价格 / 权益变更需 财务 + 增长运营 双签;价格调整即时作用于新订阅与续费,发起人不可自审。",
      impact: [
        "价格上调 → 影响订阅转化漏斗与续费率,联动 C 域订阅收入与 MRR",
        "权益深度调整 → 联动 G1 APY 加成 / G2 兑换折扣 / G7 复投加成等下游产品",
        "自动续费关闭 → 续费率下降,联动 MRR 与 H 域留存 KPI",
      ],
    },
  },
  {
    path: "/finance-products/nex-v2",
    summary:
      "NEX v2 Founders Vault — 24 月锁期金库 / 线性释放曲线 / 认购额度 / 节奏。释放节奏联动流通供给与 G3 行情;锁期与额度变更需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "金库锁仓", value: "8.6M NEX", sub: "未释放", accent: "var(--admin-domain-g)", hint: "Founders Vault 内尚未线性释放的 NEX 总量。" },
        { label: "已释放", value: "1.4M NEX", sub: "累计 14%", accent: "var(--admin-domain-g)", hint: "自释放启动以来已按曲线解锁进入流通的 NEX。" },
        { label: "认购席位", value: "412 / 500", sub: "已认购 / 上限", accent: "var(--v5-warning)", hint: "Founders Vault 认购席位占用情况,满额停止认购。" },
        { label: "下次释放", value: "T-6 日", sub: "每月解锁", accent: "var(--v5-ink-3)", hint: "距下一次月度线性释放的天数。" },
      ],
      groups: [
        {
          title: "锁期与释放曲线",
          note: "Vault 采用长锁期 + 线性释放,平滑供给冲击;曲线参数影响流通节奏与行情。",
          fields: [
            { label: "锁定期", value: "24 个月", range: "12–36 个月", effect: "缩短 → 释放加速,联动流通供给" },
            { label: "释放曲线", value: "线性 · 按月", range: "线性 / 阶梯 / 悬崖", effect: "决定每期解锁量分布" },
            { label: "悬崖期(Cliff)", value: "3 个月", range: "0–6 个月", effect: "前 N 月不解锁,稳定早期供给" },
            { label: "每月释放比例", value: "约 4.76%", range: "随曲线计算", effect: "单期入流通量,联动 G3 抛压" },
          ],
        },
        {
          title: "认购额度",
          note: "控制 Vault 总募集规模与单户敞口,保障稀缺性。",
          fields: [
            { label: "认购席位上限", value: "500", range: "100–1,000", effect: "满额停止认购,稀缺定位" },
            { label: "单户认购上限", value: "50,000 NEX", range: "1K–200K NEX", effect: "下调 → 分散持有,防巨鲸" },
            { label: "最低认购额", value: "5,000 NEX", range: "1K–20K NEX", effect: "Founders 门槛,筛选长期持有" },
            { label: "认购单价", value: "$0.95 / NEX", range: "$0.50–$2.00", effect: "早鸟折价,低于现价激励早投" },
          ],
        },
        {
          title: "释放与流转",
          note: "已释放部分的流转与归属规则,影响二级流动性。",
          fields: [
            { label: "释放后锁定", value: "无", range: "无 / 7 日 / 30 日", effect: "已解锁即可流转,联动行情深度" },
            { label: "提前退出", value: "不支持", range: "支持 / 不支持", effect: "锁期内不可赎回,保障供给稳定" },
            { label: "释放开关", value: "开启", range: "开 / 关", effect: "关 → 暂停解锁,联动 A 域特性开关" },
          ],
        },
      ],
      approval: "NEX v2 Founders Vault 锁期 / 释放曲线 / 认购额度变更需 财务 + 风控 双签;释放节奏直接影响流通供给与行情,发起人不可自审。",
      impact: [
        "锁期缩短 / 每月释放比例上调 → 流通供给加速,联动 G3 行情抛压与价格",
        "认购席位增配 → 募集规模扩大但稀释稀缺定位,联动一级认购热度",
        "释放开关关闭 → 暂停月度解锁,联动 A 域特性开关与流通供给预期",
      ],
    },
  },
  {
    path: "/finance-products/repurchase",
    summary:
      "复投激励 — 收益复投奖励率 / 触发门槛 / 单户与全局上限 / 资金来源约束。奖励率联动 C 域激励预算与 G1 Staking 沉淀;参数变更需 财务 + 风控 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "本月复投额", value: "$214K", sub: "收益再投入", accent: "var(--admin-domain-g)", hint: "本月用户将收益复投至 Staking / 节点的本金合计。" },
        { label: "复投率", value: "41%", sub: "收益复投占比", accent: "var(--v5-success)", hint: "可提现收益中选择复投而非提现的比例。" },
        { label: "本月奖励支出", value: "$6.4K", sub: "复投奖励", accent: "var(--v5-warning)", hint: "本月按复投奖励率发放的额外激励合计。" },
        { label: "预算占用", value: "64%", sub: "$6.4K / $10K", accent: "var(--v5-ink-3)", hint: "复投奖励月度预算占用,达上限暂停发放。" },
      ],
      groups: [
        {
          title: "奖励率",
          note: "按复投金额比例发放额外激励;奖励率即时影响复投意愿与激励支出。",
          fields: [
            { label: "基础复投奖励率", value: "3.0%", range: "0%–8%", effect: "上调 → 复投率升,联动 C 域激励预算" },
            { label: "Premium 加成", value: "Pro +2.0pp", range: "0–5.0pp", effect: "联动 G5 订阅权益" },
            { label: "连续复投阶梯", value: "每连投 +0.5pp", range: "0–3.0pp", effect: "封顶后停增,激励长期复投" },
            { label: "奖励发放形式", value: "NEX 入账", range: "NEX / USDT", effect: "NEX 形式沉淀生态,联动行情" },
          ],
        },
        {
          title: "触发门槛",
          note: "控制可享受奖励的复投行为范围,过滤微额刷量。",
          fields: [
            { label: "最低复投额", value: "$100", range: "$10–$1,000", effect: "门槛,过滤微额薅奖励" },
            { label: "可复投资金来源", value: "仅平台收益", range: "收益 / 收益+本金", effect: "限收益复投,防本金套奖励" },
            { label: "复投锁定期", value: "30 日", range: "0–180 日", effect: "复投本金最短锁期,防即投即赎" },
            { label: "奖励归属确认", value: "锁期满后", range: "即时 / 锁期满", effect: "提前赎回则奖励作废,防套利" },
          ],
        },
        {
          title: "上限与预算",
          note: "限制单户与全局奖励规模,防预算击穿与异常套取。",
          fields: [
            { label: "单户月奖励上限", value: "$200", range: "$50–$1,000", effect: "封顶,防大户集中套取" },
            { label: "全局月奖励预算", value: "$10,000", range: "$2K–$50K", effect: "达上限暂停发放,联动 C 域预算" },
            { label: "单户日复投次数", value: "5 次", range: "1–20 次", effect: "防高频刷复投奖励" },
            { label: "奖励开关", value: "开启", range: "开 / 关", effect: "关 → 复投激励停发,联动 A 域开关" },
          ],
        },
      ],
      approval: "复投激励参数变更需 财务 + 风控 双签;奖励率与预算上限即时影响激励支出与复投意愿,发起人不可自审。",
      impact: [
        "奖励率上调 → 复投率提升带动 TVL 沉淀,但联动 C 域激励预算支出上升",
        "可复投资金来源放宽至本金 → 复投额放大但套奖励风险升,联动风控与预算占用",
        "奖励开关关闭 / 预算击穿 → 复投激励停发,联动 G1 Staking 沉淀与 A 域特性开关",
      ],
    },
  },
];
