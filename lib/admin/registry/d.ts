/** 域 D 资金与财务 — 注册表(D1/D3/D4 真实页;D2 提现队列 / D5 提现参数为独立旗舰)。accent=--admin-domain-d。 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { LEDGER } from "@/lib/mock/admin/ledger";

// D3 资金池口径派生自 LEDGER 单源(储备/应付/覆盖率/红线/黄线),杜绝 B1/D3/L3 互相脱节
const _resM = (LEDGER.reserveUsd / 1e6).toFixed(2); // "5.64"
const _liabM = (LEDGER.liabilitiesUsd / 1e6).toFixed(2); // "5.37"
const _netK = Math.round((LEDGER.reserveUsd - LEDGER.liabilitiesUsd) / 1e3); // +270
const _netLabel = _netK >= 0 ? `+$${_netK}K` : `−$${Math.abs(_netK)}K`;
const _cov = LEDGER.coverageRatio.toFixed(1); // "118.1"

export const DOMAIN_D: ModuleEntry[] = [
  {
    path: "/finance/recon",
    summary:
      "充值订单与链上到账逐笔对账(D1)。订单金额 vs 链上确认金额自动比对,差异 / 未达账自动挂起;补单 / 强制对平需 财务 + 风控 双签并写入 A2 审计。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日充值", value: "$214.8K", sub: "642 笔", accent: "var(--admin-domain-d)", hint: "今日成功入账的充值总额(USDT 折算)。", delta: { dir: "up", text: "+6.2%", good: true } },
        { label: "已对平", value: "634", sub: "98.8%", accent: "var(--v5-success)", hint: "订单金额与链上到账金额一致并已入账的笔数。" },
        { label: "待对账", value: "6", sub: "未达账 / 确认中", accent: "var(--v5-warning)", hint: "链上未达足够确认数或尚未匹配到订单的挂起笔数。" },
        { label: "差异挂起", value: "2", sub: "金额不符", accent: "var(--v5-danger)", hint: "到账金额与订单金额不一致,已自动冻结待人工核销。" },
      ],
      search: "搜索订单号 / 地址 / 链上哈希",
      filterKey: "state",
      filters: ["全部", "正常对平", "待对账", "差异冻结", "已退回"],
      columns: [
        { key: "order", header: "充值订单", mono: true },
        { key: "user", header: "用户", mono: true },
        { key: "chain", header: "通道" },
        { key: "txhash", header: "链上哈希", mono: true },
        { key: "amount", header: "金额", mono: true, align: "right" },
        { key: "conf", header: "确认", mono: true, align: "right" },
        { key: "state", header: "对账状态", status: true },
      ],
      rows: [
        { order: "RC-2606-10428", user: "U-88421", chain: "TRC20-USDT", txhash: "0x7af3…c19d", amount: "$1,000.00", conf: "32/20", state: "正常对平" },
        { order: "RC-2606-10427", user: "U-90233", chain: "ERC20-USDT", txhash: "0x2c8b…41fa", amount: "$500.00", conf: "64/64", state: "正常对平" },
        { order: "RC-2606-10426", user: "U-77310", chain: "TRC20-USDT", txhash: "0x9e10…7b22", amount: "$2,400.00", conf: "11/20", state: "待对账" },
        { order: "RC-2606-10425", user: "U-83019", chain: "BSC-USDT", txhash: "0x5d44…aa08", amount: "$300.00", conf: "0/15", state: "待对账" },
        { order: "RC-2606-10424", user: "U-71902", chain: "TRC20-USDT", txhash: "0xb7c2…ef31", amount: "$1,200.00", conf: "20/20", state: "差异冻结" },
        { order: "RC-2606-10421", user: "U-66845", chain: "ERC20-USDT", txhash: "0x0a91…3d6e", amount: "$5,000.00", conf: "64/64", state: "正常对平" },
        { order: "RC-2606-10418", user: "U-90011", chain: "TRC20-USDT", txhash: "0xf3e8…12bc", amount: "$80.00", conf: "20/20", state: "已退回" },
        { order: "RC-2606-10412", user: "U-84477", chain: "BSC-USDT", txhash: "0x6b29…90a4", amount: "$760.00", conf: "15/15", state: "正常对平" },
      ],
      detail: true,
      rowActions: [
        { label: "核销差异", tone: "primary", whenStatus: "差异冻结" },
        { label: "挂账" },
        { label: "标记复核" },
      ],
      note:
        "对账以链上到账金额为权威源;差异挂起项不计入用户余额。补单 / 强制对平 / 退回需 财务 + 风控 双签,发起人不可自审,操作写入 A2 审计并联动 B1 储备口径。",
    },
  },
  {
    path: "/finance/pool",
    summary:
      `资金池储备 vs 应付负债实时水位(D3)。兑付覆盖率=储备÷应付负债,红线 ${LEDGER.redlinePct}% / 健康 ${LEDGER.healthyPct}%,当前 ${_cov}%;储备 / 负债口径与 B1 双账本一致,只读聚合,阈值改动在 D5 / J 域。`,
    content: {
      kind: "dashboard",
      metrics: [
        { label: "可用储备", value: `$${_resM}M`, sub: "USDT 资金池", accent: "var(--admin-domain-d)", hint: "可即时用于兑付的链上 + 平台储备总额。", delta: { dir: "up", text: "净流入 +$0.12M / 24h", good: true } },
        { label: "应付负债", value: `$${_liabM}M`, sub: "用户可提总额", accent: "var(--v5-warning)", hint: "余额 + 已解锁收益 + 待结算分红等所有对用户的应付口径合计。", delta: { dir: "up", text: "+$31.0K / 24h", good: false } },
        { label: "净敞口", value: _netLabel, sub: "储备 − 负债", accent: "var(--v5-success)", hint: "储备减应付负债;当前储备高于应付(绿区盈余),扩张期净流入、储备持续累积。" },
        { label: "兑付覆盖率", value: `${_cov}%`, sub: `红线 ${LEDGER.redlinePct}% · 健康 ${LEDGER.healthyPct}%`, accent: "var(--v5-warning)", hint: `储备÷应付负债。跌破 ${LEDGER.redlinePct}% 红线触发 J 域限流 / 提现降速。`, delta: { dir: "down", text: "−0.9pt / 24h", good: false } },
      ],
      charts: [
        {
          type: "area",
          title: "兑付覆盖率趋势",
          sub: `近 14 日 · 红线 ${LEDGER.redlinePct}%`,
          color: "var(--admin-domain-d)",
          refLine: LEDGER.redlinePct,
          data: [110.0, 111.0, 112.0, 113.0, 114.0, 115.0, 115.5, 116.0, 116.5, 117.0, 117.3, 117.6, 117.9, 118.1],
        },
        {
          type: "donut",
          title: "应付负债结构",
          sub: "合计 $5.37M",
          unit: "万",
          segments: [
            { label: "可提现余额", value: 248, color: "var(--admin-domain-d)" },
            { label: "已解锁收益", value: 139, color: "var(--v5-warning)" },
            { label: "待结算分红", value: 86, color: "var(--v5-success)" },
            { label: "Staking 本息", value: 41, color: "#818CF8" },
            { label: "佣金应付", value: 23, color: "var(--v5-danger)" },
          ],
        },
        {
          type: "bars",
          title: "应付到期预测",
          sub: "未来 7 日可提现释放规模",
          color: "var(--v5-warning)",
          unit: "K",
          labels: ["D+1", "D+2", "D+3", "D+4", "D+5", "D+6", "D+7"],
          data: [92, 78, 110, 64, 138, 71, 96],
        },
        {
          type: "area",
          title: "24h 净流入/流出",
          sub: "正=净流入 · 当前 +$0.12M",
          color: "var(--v5-danger)",
          data: [12, 4, -8, -15, -22, -19, -27, -34, -41, -38, -52, -67, -79, -86],
        },
      ],
      controlLink: { label: "调提现参数", href: "/finance/params" },
      note:
        `本页为只读聚合,储备 / 负债口径与 B1 双账本同源(server 权威)。覆盖率跌破 ${LEDGER.redlinePct}% 红线时自动前置 J 域 Kill / 限流,提现降速由 D5 参数承接;阈值与限流比例改动需双签。`,
    },
  },
  {
    path: "/finance/ledger",
    summary:
      "双账本逐笔流水审计(D4)。每笔资金动作同时记 bill(用户账单)与内部账本,借贷方向 + 引用单据 + 余额快照 append-only;调整 / 红冲需 财务 + 审计 双签并留痕,账目不可编辑删除。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日流水", value: "8,142", sub: "全币种", accent: "var(--admin-domain-d)", hint: "今日写入双账本的 bill 条数(借贷各计一条)。" },
        { label: "借贷平衡", value: "已平", sub: "日切自动核验", accent: "var(--v5-success)", hint: "当日借方合计=贷方合计,日切对账通过。" },
        { label: "USDT 净额", value: "+$0.12M", sub: "今日方向", accent: "var(--v5-success)", hint: "今日 USDT 账本借贷净额,与 D3 净流入口径一致。" },
        { label: "调整/红冲", value: "3", sub: "需双签", accent: "var(--v5-danger)", hint: "今日发起的人工调账 / 红冲笔数,均需 Maker-Checker 双签。" },
      ],
      search: "搜索账单号 / 用户 / 引用单据",
      filterKey: "btype",
      filters: ["全部", "充值入账", "提现出账", "收益结算", "分红派发", "佣金结算", "调整红冲"],
      columns: [
        { key: "bill", header: "账单号", mono: true },
        { key: "btype", header: "账单类型" },
        { key: "ccy", header: "币种" },
        { key: "amount", header: "金额", mono: true, align: "right" },
        { key: "dir", header: "方向", status: true },
        { key: "ref", header: "引用单据", mono: true },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { bill: "BL-2606-552108", btype: "充值入账", ccy: "USDT", amount: "+$1,000.00", dir: "贷", ref: "RC-2606-10428", state: "已完成" },
        { bill: "BL-2606-552107", btype: "提现出账", ccy: "USDT", amount: "−$2,300.00", dir: "借", ref: "WD-2606-0142", state: "已结算" },
        { bill: "BL-2606-552103", btype: "收益结算", ccy: "USDT", amount: "+$24.10", dir: "贷", ref: "YD-2606-77310", state: "已完成" },
        { bill: "BL-2606-552099", btype: "分红派发", ccy: "NEX", amount: "+128.0 NEX", dir: "贷", ref: "GD-2606-0091", state: "已完成" },
        { bill: "BL-2606-552094", btype: "佣金结算", ccy: "USDT", amount: "+$56.40", dir: "贷", ref: "CM-2606-4471", state: "已完成" },
        { bill: "BL-2606-552090", btype: "提现出账", ccy: "USDT", amount: "−$5,000.00", dir: "借", ref: "WD-2606-0138", state: "复核中" },
        { bill: "BL-2606-552081", btype: "调整红冲", ccy: "USDT", amount: "−$120.00", dir: "借", ref: "ADJ-2606-0007", state: "待复核" },
        { bill: "BL-2606-552077", btype: "充值入账", ccy: "USDT", amount: "+$5,000.00", dir: "贷", ref: "RC-2606-10421", state: "已完成" },
      ],
      detail: true,
      rowActions: [
        { label: "导出凭证" },
        { label: "标记复核" },
      ],
      note:
        "双账本 append-only,server 端权威,每笔同记用户 bill 与内部账本且借贷必平;调整 / 红冲需 财务 + 审计 双签,发起人不可自审。账目不可编辑或删除,留痕同步 A2 审计并联动 B1 负债口径。",
    },
  },
];
