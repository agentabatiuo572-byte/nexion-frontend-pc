/**
 * A2 里 F 域配置申请（f_config、f_ui_config、f_unilevel_rule）的显示名。后端的申请单写的是
 * 「F 域配置调整 · 配置键」，对象是配置键，修改前是后端读到的原值（读不到时写「未知（当前值不可用）」），
 * 修改后是发起时的新值（AuditReplayBusinessPermissionGuard.delegatedFDescriptor）。
 * 这里把键换成 F1–F4 页面上这一项的名字，值带上页面用的单位；每一句「批准后」和发起人那页的确认框同一句。
 * 页面上没有的键返回 undefined，A2 写「未识别的配置项」，原键放技术信息，不猜。
 */

const F1 = "团队等级晋升";
const F2 = "团队奖励设置";
const F3 = "团队平衡奖励";
const F4 = "奖励池、名额与排行榜";

export type FConfigSpec = {
  page: string;
  item: string;
  /** 动作名，默认「调整 + 这一项」。 */
  action: string;
  /** 往哪个方向改会让平台多付钱（后端 loosensPayoutControlUiKey 的方向）；没有的这一项批准时不查兑付覆盖率。 */
  loosen?: string;
  unit?: string;
  values?: Record<string, string>;
  /** 值是一组 JSON 时每一项的名字。 */
  json?: Record<string, string>;
  cron?: boolean;
  impact: string;
  detail?: string;
};

const F2_LATER = "批准后对之后新算的订单生效，已经算好的不重算。";
const RANKS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`V${i}`, `V${i}`]));
const LAYERS = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`L${i + 1}`, `L${i + 1}`]));

function spec(page: string, item: string, rest: Partial<FConfigSpec> & { impact: string }): FConfigSpec {
  // 名字以 L3、V3 这类编号开头时和「调整」之间空一格，和 F 页确认框的标题一致。
  return { page, item, action: `调整${/^[A-Za-z0-9]/.test(item) ? " " : ""}${item}`, ...rest };
}

export function fConfigSpec(key: string, after?: string): FConfigSpec | undefined {
  const next = after?.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^F\.unilevel\.(L[2-7])$/.exec(key))) return spec(F2, `${m[1]} USDT 奖励比例`, { unit: "%", loosen: "调高",
    impact: "批准后，之后新算的订单这一层按新比例；已算好的不重算。" });
  if ((m = /^F\.unilevel\.nex\.(L[1-7])$/.exec(key))) return spec(F2, `${m[1]} UVT 奖励系数`, { unit: "UVT / 1 USDT", loosen: "调高",
    impact: "批准后，之后新算的订单按新系数另发 UVT；已算好的不重算。" });
  if ((m = /^F\.pool\.votes\.(V\d)$/.exec(key))) return spec(F4, `${m[1]} 票数`, { unit: "票", loosen: "调高",
    impact: "批准后，还没结算的团队激励池按新票数分；已发的不变。",
    detail: "票数改成 0 后这个等级不再显示在「奖励池、名额与排行榜」，也不能在那页改回。" });
  if ((m = /^F\.quota\.tier\.(.+)\.monthlyQuota$/.exec(key))) return spec(F4, `商品月额度 ${m[1]}`, { unit: "台",
    impact: "批准后限制这个商品之后的购买；已用的记录不删，也不退单。", detail: "新额度不能低于本月已用，额度已被别人改过也会被拒绝。" });
  if ((m = /^F\.quota\.usage\.(\d+)\.status$/.exec(key))) return spec(F4, `名额记录 #${m[1]}`, { action: `回收名额 #${m[1]}`, values: { recycled: "已回收" },
    impact: "批准后这条记录改为已回收，名额退回所属月份；不退款、不删订单。", detail: "只有还在占用的记录能回收；已回收或不存在的会被拒绝。" });
  if ((m = /^F\.leaderboard\.week\.user\.(\d+)\.status$/.exec(key))) return spec(F4, `周榜成员 ${m[1]}`, { action: "取消周榜资格", values: { disqualified: "取消资格" },
    impact: "批准后这个人移出周榜排名和派奖；不冻结账号，不追回已发的。",
    detail: "之后每一周的周榜都一直不算这个人。批准时还要找到这个人本周的风险记录或生效中的关联账户簇，找不到会被拒绝。" });
  switch (key) {
    case "F.vrank.permanent": return spec(F1, "不降级保护", { action: next === "off" ? "关闭不降级保护" : next === "on" ? "开启不降级保护" : "调整不降级保护",
      values: { on: "开启", off: "关闭", "": "未设置（按关闭执行）" },
      impact: next === "off" ? "批准后，用户下次评估没达标就降级；已发的奖励不收回。" : "批准后，用户下次评估没达标也保留等级；已降过级的不恢复。",
      detail: next === "off" ? "降到实际达到的等级，团队激励池票数按所在等级算。不是批准时一次扫描全部用户。" : "人工降级不受影响。不是批准时一次扫描全部用户。" });
    case "F.prize.name": return spec(F1, "奖品名称", { impact: "只改显示的名字，不影响晋升和奖励发放。" });
    case "F.vrank.titles": return spec(F1, "各级头衔", { json: RANKS, impact: "只改头衔文字，不影响晋升条件和奖励；App 现在不显示头衔。" });
    case "F.cooldown": return spec(F2, "购买与其他奖励冷却", { unit: "天", loosen: "缩短",
      impact: "批准后，之后新算的团队奖励按新天数冷却；已在冷却的到期日不变。",
      detail: "缩短会让钱更早能提。好友设备收益奖励的冷却单独设置，不受影响。" });
    case "F.unilevel.depthGate": return spec(F2, "等级解锁起点", { values: LAYERS, loosen: "往后挪", impact: F2_LATER,
      detail: "从这一层起，上级要到解锁等级才拿得到这一层的奖励。" });
    case "F.unilevel.depthGateRank": return spec(F2, "解锁等级", { values: RANKS, loosen: "调低", impact: F2_LATER,
      detail: "等级不够的上级这一层记 0。" });
    case "F.influence.clampMin": return spec(F2, "影响分下限", { impact: F2_LATER, detail: "影响分乘进 L2–L7 的奖励；L1 不受影响。" });
    case "F.influence.clampMax": return spec(F2, "影响分上限", { impact: F2_LATER, detail: "影响分乘进 L2–L7 的奖励；L1 不受影响。" });
    case "F.promo.weekMultiplier": return spec(F2, "活动周倍率", { unit: "倍", loosen: "调高", impact: F2_LATER, detail: "活动周每层奖励再乘的倍数，含 L1。" });
    case "F.unilevel.mergeExitMaxPct": return spec(F2, "奖励总额上限（占订单）", { unit: "%", impact: F2_LATER,
      detail: "一笔订单七层 USDT 奖励最多占订单的比例，超出时从 L1 往下分完为止。" });
    case "F.partner.tiers": return spec(F2, "合作伙伴权益门槛", { json: { standard: "基础", verified: "认证", premium: "高级", diamond: "钻石" },
      impact: "批准后只保存四档门槛，不会自动开通权益，也不影响奖励。" });
    case "F.binary.threshold": return spec(F3, "每组订单额门槛", { unit: "USDT", loosen: "调低", impact: "批准后，之后的结算按新门槛判断两组过没过；已经记账的奖励不变。" });
    case "F.binary.matchRate": return spec(F3, "匹配比例", { unit: "%", loosen: "调高",
      impact: "批准后，之后的结算按新比例算，仍受每期上限限制；已记账的不变。" });
    case "F.binary.spillover": return spec(F3, "自动分组", { values: { on: "已启用", off: "已关闭" },
      impact: "批准后，之后的结算按新设置决定是否自动分组；已分好的组不变。",
      detail: "关闭后没分组的邀请人结算会被拦下，要在「成员分组」手动分。" });
    case "F.binary.gvResetCron": return spec(F3, "归零说明", { impact: "批准后只换说明文字；归零时点、业务日历和历史结算都不变。" });
    case "F.binary.paused": return spec(F3, "发放", { action: next === "on" ? "暂停团队平衡奖励发放" : next === "off" ? "恢复团队平衡奖励发放" : "调整团队平衡奖励发放",
      values: { on: "已暂停", off: "发放中" },
      impact: next === "on" ? "批准后，之后的结算全部被拦下；已经记账的奖励不受影响。" : "批准后，之后的结算不再被拦下；暂停期间没结的周期不自动补。" });
    case "F.pool.ratio": return spec(F4, "团队激励池比例", { unit: "%", loosen: "调高", impact: "批准后，本周未结算的和之后的结算按新比例放钱；已发的不重算。" });
    case "F.pool.monthlyCap": return spec(F4, "团队激励池每月上限", { impact: "批准后影响这个月还没结算的部分；已经发出的不追回。", detail: "写错格式会让池不能结算。" });
    case "F.pool.settleCron": return spec(F4, "团队激励池结算时间", { cron: true, impact: "批准后，下一次到点就按新时间结算最近结束的一周；已结算的不变。" });
    case "F.pool.unlockVRank": return spec(F4, "团队激励池参与等级", { values: RANKS, impact: "批准后，之后的结算只分给达到新等级的人；已经发出的不追溯。" });
    case "F.pool.periodPrize": return spec(F4, "各榜奖池", { unit: "USDT", loosen: "调高", json: { today: "日榜", week: "周榜", month: "月榜", allTime: "总榜" },
      impact: "批准后，日周月榜从下个未结算周期起用新金额；已派的不改。", detail: "总榜在人工派奖时读这个金额。" });
    case "F.pool.top1MaxPct": return spec(F4, "第 1 名最高占比", { unit: "%", loosen: "调高", impact: "批准后，之后排行榜派奖第 1 名最多拿奖池的这个比例。", detail: "超出的部分不再分给别人；不影响团队激励池。" });
    case "F.pool.top5MaxPct": return spec(F4, "前 5 名最高占比", { unit: "%", loosen: "调高", impact: "批准后，之后排行榜派奖前 5 名合计最多拿奖池的这个比例。", detail: "超出的部分不再分给别人；不影响团队激励池。" });
    case "F.leaderboard.paused": return spec(F4, "排行榜", { action: next === "on" ? "暂停排行榜" : next === "off" ? "恢复排行榜" : "调整排行榜",
      values: { on: "已暂停", off: "实时运行" },
      impact: next === "on" ? "批准后四个榜停在这一刻的名次，到期的榜单派奖不发、也不补。" : "批准后四个榜重新实时更新，之后到期的照常派奖；暂停期间的不补。",
      detail: next === "on" ? "暂停期间到期的日、周、月榜不派奖，恢复后也不补发；总榜派奖不能提交，团队激励池照常结算。" : undefined });
    case "F.leaderboard.poolUsd": return spec(F4, "本周榜单奖池", { unit: "USDT", impact: "批准后，还没结算的周榜按新金额派奖。", detail: "填 0 表示改回用各榜奖池里的周榜金额，不是关掉。" });
    case "F.leaderboard.minComputePoints": return spec(F4, "上榜门槛", { unit: "点", impact: "批准后，本期算力点低于新门槛的人不参与排名和派奖；已发的不变。" });
    case "F.leaderboard.minUsd": return spec(F4, "上榜最低奖励（已停用）", { unit: "USDT", impact: "这一项已经停用，批准会被拒绝，不会生效；请驳回。" });
    default: return undefined;
  }
}

const WEEKDAYS: Record<string, string> = { "0": "日", "7": "日", SUN: "日", "1": "一", MON: "一", "2": "二", TUE: "二", "3": "三", WED: "三", "4": "四", THU: "四", "5": "五", FRI: "五", "6": "六", SAT: "六" };
/**
 * 结算时间的定时写法翻成人话，规则同 F4 页（f4-shared parseSettleCron）。申请单里没有结算时区，
 * F4 页按读到的时区换算，这里只写「结算时区」，不换算成北京时间。认不出的返回 null。
 */
function cronText(raw: string) {
  const parts = raw.trim().split(/\s+/);
  const fields = parts.length === 5 ? ["0", ...parts] : parts;
  if (fields.length !== 6) return null;
  const [sec, min, hour, dom, month, dow] = fields.map((f) => f.toUpperCase());
  if (sec !== "0" || !/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour) || month !== "*" || Number(min) > 59 || Number(hour) > 23) return null;
  const any = (f: string) => f === "*" || f === "?";
  const day = any(dom) && any(dow) ? "每天" : /^\d{1,2}$/.test(dom) && Number(dom) >= 1 && Number(dom) <= 28 && any(dow) ? `每月 ${Number(dom)} 日`
    : any(dom) && WEEKDAYS[dow] ? `每周${WEEKDAYS[dow]}` : null;
  return day && `${day} ${hour.padStart(2, "0")}:${min.padStart(2, "0")}（结算时区）`;
}

/** 后端把 10 写成 1E+1（BigDecimal.stripTrailingZeros().toString()）：只改写法，不舍入。 */
function plain(text: string) {
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!m) return text;
  const digits = m[2] + (m[3] ?? "");
  const point = m[2].length + Number(m[4]);
  const body = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return m[1] + body.replace(/^0+(?=\d)/, "");
}

const grouped = (text: string) => text.replace(/^-?\d{4,}/, (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const UNIT_TAIL = /\s*(?:%|UVT\s*\/\s*(?:1\s*)?USDT|USDT|天|台|倍|票|点)$/;

function withUnit(text: string, unit?: string) {
  const bare = text.trim().replace(UNIT_TAIL, "");
  if (!unit || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(bare)) return text.trim();
  const value = grouped(plain(bare));
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

/** 修改前、修改后的显示值。值是一组 JSON 时返回带名字的 JSON，交给「完整变更内容」逐项比。 */
export function fConfigValue(item: FConfigSpec | undefined, raw: string): string {
  const text = raw.trim();
  if (text === "未知（当前值不可用）") return "提交时没读到";
  const named = item?.values && (Object.hasOwn(item.values, text.toLowerCase()) ? item.values[text.toLowerCase()] : Object.hasOwn(item.values, text) ? item.values[text] : undefined);
  if (named !== undefined) return named;
  if (!text || text === "—") return "未设置";
  if (item?.cron) return cronText(text) ?? "自定义时间（原文在技术信息里）";
  if (item?.json) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify(Object.fromEntries(Object.entries(parsed).map(([k, v]) => [item.json![k] ?? k, withUnit(String(v), item.unit)])));
      }
    } catch { /* 不是 JSON 的旧值照原文显示。 */ }
    return text;
  }
  return withUnit(text, item?.unit);
}
