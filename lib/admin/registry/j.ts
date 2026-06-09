/** 域 J 紧急与合规控制 — 注册表。accent=--admin-domain-j(红/danger)。
 * Kill-Switch 矩阵 / Geo-block / 篡改防御监控 / 监管点名应急 SOP。
 * 闸门状态与处置均 server-canonical;kill 即时生效但需双签复核留痕(A2)。内容 mock,结构 backend-replaceable。 */
import type { ModuleEntry } from "@/lib/admin/module-content";

export const DOMAIN_J: ModuleEntry[] = [
  {
    path: "/emergency/kill-switch",
    summary:
      "7 大业务闸门紧急熔断矩阵。当前 7/7 在线(全闸正常营业)。熔断即时全站生效,但发起需 风控主管 + 总管理员 双签并写入 A2 审计;恢复同样双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "闸门状态", value: "0 / 7", sub: "已熔断 / 总数", accent: "var(--v5-success)", hint: "当前处于熔断态的业务闸门数;7 闸全部在线(正常营业)。" },
        { label: "全局总闸", value: "正常", sub: "未触发", accent: "var(--v5-success)", hint: "一键停摆全部资金类业务的最高级开关。" },
        { label: "自动触发阈值", value: "已布防", sub: "4 条规则", accent: "var(--admin-domain-j)", hint: "命中即自动熔断对应闸门并告警值班的风控规则。" },
        { label: "最近演练", value: "5 天前", sub: "exchange 闸", accent: "var(--v5-ink-3)", hint: "上一次熔断演练时间;演练同样留痕 A2。" },
      ],
      groups: [
        {
          title: "资金 / 兑付闸",
          note: "直接关联资金流出或兑付负债;熔断即时阻断对应能力、在途请求冻结待恢复;恢复前置核验 B1 兑付覆盖率(放大流出/增兑付负债)。",
          fields: [
            { label: "提现闸 (withdraw)", value: "开启 · 正常", range: "开启 / 熔断", effect: "熔断 → 全部提现暂停,在途请求冻结;恢复前置 B1 覆盖率核验" },
            { label: "兑换闸 (exchange)", value: "开启 · 正常", range: "开启 / 熔断", effect: "熔断 → NEX↔USDT 兑换停摆,联动 G2 价格;恢复前置 B1" },
            { label: "算力质押闸 (staking)", value: "开启 · 正常", range: "开启 / 熔断", effect: "熔断 → 新增质押停止,存量产出按 R-A 衰减续算;恢复增未来兑付负债前置 B1" },
            { label: "NEX v2 Lock 闸 (nexv2)", value: "开启 · P6/m11 上线", range: "开启 / 熔断", effect: "熔断 → NEX v2 锁仓新开停止;恢复增未来兑付负债前置 B1" },
            { label: "Genesis 闸 (genesis)", value: "开启 · 正常", range: "开启 / 熔断", effect: "熔断 → 节点挂单/成交冻结,联动 G4;恢复前置 B1" },
          ],
        },
        {
          title: "获客 / 收入闸",
          note: "影响拉新与订阅收入;熔断停用对应入口但不直接放大资金流出,恢复不挂 B1。",
          fields: [
            { label: "试用闸 (trial)", value: "开启 · 正常", range: "开启 / 熔断", effect: "熔断 → 免费试用领取关闭,联动 H 域名额" },
            { label: "Premium 订阅闸 (premium)", value: "开启 · 正常", range: "开启 / 熔断", effect: "熔断 → Premium 订阅购买 / 续费关闭" },
          ],
        },
        {
          title: "熔断触发与生效",
          note: "熔断为即时动作,不走灰度;恢复需二次双签确认业务已具备恢复条件。",
          fields: [
            { label: "生效方式", value: "即时全站", range: "即时 / —", effect: "签核通过瞬间下发至所有边缘节点" },
            { label: "自动触发", value: "启用 · 4 规则", range: "开 / 关", effect: "命中提现激增/对账缺口/篡改告警/监管指令自动熔断" },
            { label: "在途请求处置", value: "冻结待恢复", range: "冻结 / 退回", effect: "熔断时锁定在途资金请求,恢复后重新排队" },
            { label: "恢复确认", value: "双签 + 复核", range: "双签固定", effect: "恢复需确认根因已消除,留痕 A2" },
          ],
        },
      ],
      approval:
        "熔断 / 恢复任一闸门均需 风控主管(Maker)+ 总管理员(Checker)双签,发起人不可自审;熔断即时生效,操作全程写入 A2 不可篡改审计。自动触发熔断免预签,但须值班人 30 分钟内补签确认。",
      impact: [
        "提现 / 兑换闸熔断 → D 域资金对账实时标记暂停区间,客服侧同步话术",
        "Genesis 闸熔断 → G4 二级市场挂单冻结,价格快照定格,防止恐慌踩踏",
        "staking / nexv2 闸熔断 → F 域佣金与 R-A 产出结算暂挂,恢复后按暂停时长补算",
        "全局总闸触发 → 等价于全部 7 闸熔断 + 维护模式,用于监管强制停业或重大风险事件",
      ],
    },
  },
  {
    path: "/emergency/geo-block",
    summary:
      "按司法辖区的地域准入控制。当前屏蔽 3 个高合规风险地区,新用户注册 / KYC / 资金类操作按 IP + KYC 国籍双重判定。名单变更需 风控 + 合规审计 双签。",
    content: {
      kind: "config",
      metrics: [
        { label: "屏蔽地区", value: "3", sub: "全功能封禁", accent: "var(--v5-danger)", hint: "完全禁止注册与资金操作的司法辖区数。" },
        { label: "受限地区", value: "5", sub: "仅只读", accent: "var(--v5-warning)", hint: "允许浏览但禁止新增资金类操作的地区。" },
        { label: "判定方式", value: "IP + KYC", sub: "双重", accent: "var(--admin-domain-j)", hint: "以接入 IP 与 KYC 国籍交叉判定,任一命中即拦截。" },
        { label: "今日拦截", value: "212", sub: "次", accent: "var(--admin-domain-j)", hint: "今日因地域规则被拦截的请求次数。" },
      ],
      groups: [
        {
          title: "黑名单(全功能封禁)",
          note: "命中即阻断注册、登录、KYC 与全部资金操作;已有账户转入只读并停止产出。",
          fields: [
            { label: "地区 KP", value: "封禁 · 制裁名单", range: "封禁 / 受限 / 放行", effect: "全功能不可用,资金冻结待合规处置" },
            { label: "地区 IR", value: "封禁 · 制裁名单", range: "封禁 / 受限 / 放行", effect: "全功能不可用,IP + KYC 双重拦截" },
            { label: "地区 SY", value: "封禁 · 制裁名单", range: "封禁 / 受限 / 放行", effect: "全功能不可用,新注册直接拒绝" },
          ],
        },
        {
          title: "灰名单(受限只读)",
          note: "允许登录浏览,禁止新增充值 / 购买 / 提现;视监管动态可升级为封禁。",
          fields: [
            { label: "受限地区组", value: "5 个辖区 · 只读", range: "受限 / 放行", effect: "禁止新增资金操作,存量可提现退出" },
            { label: "新用户注册", value: "禁止", range: "允许 / 禁止", effect: "受限地区不开放拉新,B 域漏斗不计入" },
            { label: "升级触发", value: "监管指令", range: "手动 / 自动", effect: "升级为封禁需走 J1 流程联动冻结" },
          ],
        },
        {
          title: "判定与兜底",
          note: "判定优先级:KYC 国籍 > 接入 IP;VPN / 代理出口命中高风险段位时按从严处置。",
          fields: [
            { label: "判定优先级", value: "KYC 国籍优先", range: "固定", effect: "已 KYC 用户以国籍为准,未 KYC 以 IP 为准" },
            { label: "VPN / 代理", value: "从严拦截", range: "从严 / 放行", effect: "高风险代理出口段位等同黑名单处置" },
            { label: "误判申诉", value: "人工复核", range: "开 / 关", effect: "用户可提交 KYC 佐证转 C 域工单复核" },
          ],
        },
      ],
      approval:
        "黑/灰名单地区增删与升降级需 风控(Maker)+ 合规审计(Checker)双签;名单变更即时生效并写入 A2 审计,同步触发受影响存量账户的状态重算。",
      impact: [
        "新增封禁地区 → 该辖区存量账户即时转只读、停止产出,资金进入合规冻结待处置",
        "受限地区升级封禁 → 联动 J1 资金闸对该辖区做定向冻结,客服侧准备退出话术",
        "判定规则变更 → B 域拉新漏斗按地域重算口径,L 域报表回溯标记",
      ],
    },
  },
  {
    path: "/emergency/tamper",
    summary:
      "篡改防御监控流水。前端为展示层,余额 / 产出 / 节点权属 / 价格等关键值以 server-canonical 为唯一权威;客户端上报与服务端基线不一致即生成告警并自动处置。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日告警", value: "9", sub: "全类型", accent: "var(--admin-domain-j)", hint: "今日触发的篡改/校验失败告警条数。" },
        { label: "待处置", value: "2", sub: "需研判", accent: "var(--v5-warning)", hint: "等待风控研判的高风险告警。" },
        { label: "已自动拦截", value: "7", sub: "server 拒绝", accent: "var(--v5-success)", hint: "服务端校验直接驳回、无资金影响的尝试。" },
        { label: "资金影响", value: "$0", sub: "净敞口", accent: "var(--v5-success)", hint: "因篡改造成的实际资金损失;server 权威下应为 0。" },
      ],
      search: "搜索对象 / 账户 / 类型",
      filterKey: "type",
      filters: ["全部", "余额篡改", "产出伪造", "权属冒用", "价格越权", "请求重放"],
      columns: [
        { key: "ts", header: "时间", mono: true },
        { key: "type", header: "类型" },
        { key: "obj", header: "对象", mono: true },
        { key: "client", header: "客户端值", mono: true, align: "right" },
        { key: "server", header: "Server 基线", mono: true, align: "right" },
        { key: "disp", header: "处置", status: true },
      ],
      rows: [
        { ts: "14:18:32", type: "余额篡改", obj: "U-88421", client: "$12,400.00", server: "$1,240.00", disp: "已拦截" },
        { ts: "13:52:07", type: "产出伪造", obj: "U-77310 / NB-0091", client: "+$240/日", server: "+$24/日", disp: "已拦截" },
        { ts: "13:11:45", type: "请求重放", obj: "WD-2606-0188", client: "重复提交 ×3", server: "幂等去重", disp: "已拦截" },
        { ts: "12:40:19", type: "价格越权", obj: "NEX/USDT", client: "0.50", server: "0.0312", disp: "已拦截" },
        { ts: "11:58:33", type: "权属冒用", obj: "U-90233 / GEN-0420", client: "claim node", server: "非持有人", disp: "待研判" },
        { ts: "11:02:50", type: "余额篡改", obj: "U-66104", client: "$8,800.00", server: "$880.00", disp: "已拦截" },
        { ts: "10:24:11", type: "产出伪造", obj: "U-51288 / NB-0042", client: "lvl 9 加速", server: "无加速权益", disp: "待研判" },
        { ts: "09:47:28", type: "请求重放", obj: "EX-2606-1422", client: "时间戳漂移", server: "窗口外拒绝", disp: "已拦截" },
      ],
      detail: true,
      rowActions: [
        { label: "确认拦截", tone: "danger", whenStatus: "待研判" },
        { label: "标记误报", whenStatus: "待研判" },
        { label: "封禁账户", tone: "danger" },
      ],
      note: "所有关键值以 server-canonical 基线为准,客户端上报仅作展示;不一致一律以服务端为权威并记 A2 审计。「待研判」项点开可标记升级 J1 冻结或转 K 域风控建档。处置(确认拦截 / 误报 / 封禁)需 Maker-Checker 双签并写入 A2。",
    },
  },
  {
    path: "/emergency/sop",
    summary:
      "监管点名 / 突发事件应急 SOP 剧本库。每个剧本绑定触发场景、标准步骤、责任人与 SLA;演练与实战执行均按步骤勾选并留痕,确保合规响应可审计、可回溯。",
    content: {
      kind: "list",
      metrics: [
        { label: "SOP 剧本", value: "8", sub: "已发布", accent: "var(--admin-domain-j)", hint: "纳入应急体系的标准剧本数。" },
        { label: "演练就绪", value: "6", sub: "近 90 日已演练", accent: "var(--v5-success)", hint: "近 90 日内完成演练、状态有效的剧本。" },
        { label: "待演练", value: "2", sub: "超期", accent: "var(--v5-warning)", hint: "演练周期已超期、需重新走查的剧本。" },
        { label: "平均响应", value: "23 min", sub: "首步达成", accent: "var(--admin-domain-j)", hint: "从触发到完成首个关键步骤的平均时长。" },
      ],
      search: "搜索剧本 / 场景 / 责任人",
      filterKey: "scene",
      filters: ["全部", "监管点名", "资金异常", "数据泄露", "舆情挤兑", "技术故障"],
      columns: [
        { key: "code", header: "编号", mono: true },
        { key: "name", header: "剧本" },
        { key: "scene", header: "触发场景" },
        { key: "steps", header: "关键步骤" },
        { key: "owner", header: "责任人" },
        { key: "sla", header: "SLA", mono: true, align: "right" },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { code: "SOP-01", name: "监管问询应答", scene: "监管点名", steps: "冻结取证 → 法务对接 → 数据封存 → 回函", owner: "合规主管", sla: "≤ 2h", state: "有效" },
        { code: "SOP-02", name: "资金对账缺口", scene: "资金异常", steps: "熔断提现 → D 域核账 → 定位敞口 → 恢复", owner: "财务主管", sla: "≤ 1h", state: "有效" },
        { code: "SOP-03", name: "提现挤兑", scene: "舆情挤兑", steps: "限流降速 → 公告披露 → 分批放行 → 复盘", owner: "风控主管", sla: "≤ 30m", state: "有效" },
        { code: "SOP-04", name: "数据泄露响应", scene: "数据泄露", steps: "隔离系统 → 影响评估 → 通知 → 加固", owner: "安全主管", sla: "≤ 1h", state: "待演练" },
        { code: "SOP-05", name: "篡改告警升级", scene: "资金异常", steps: "J3 研判 → 定向冻结 → K 域建档 → 报告", owner: "风控主管", sla: "≤ 45m", state: "有效" },
        { code: "SOP-06", name: "Genesis 价格异常", scene: "资金异常", steps: "熔断二级市场 → 快照定格 → 核因 → 恢复", owner: "风控主管", sla: "≤ 30m", state: "有效" },
        { code: "SOP-07", name: "全站技术故障", scene: "技术故障", steps: "维护模式 → 根因定位 → 灰度恢复 → 通告", owner: "技术值班", sla: "≤ 20m", state: "有效" },
        { code: "SOP-08", name: "地域合规收紧", scene: "监管点名", steps: "J2 升级封禁 → 存量只读 → 退出引导 → 留痕", owner: "合规主管", sla: "≤ 4h", state: "待演练" },
      ],
      detail: true,
      rowActions: [
        { label: "启动演练", whenStatus: "待演练" },
        { label: "标记完成", whenStatus: "待演练" },
      ],
      note: "剧本执行按关键步骤逐项勾选,演练与实战全程写入 A2 审计;「待演练」剧本超期会在此标黄并阻断挂为「演练就绪」。点开可查看完整步骤清单与上次执行记录。",
    },
  },
];
