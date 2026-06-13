/**
 * 域 H 增长与运营节奏 — 注册表(H1 Phase / H2 试用 / H3 Quest / H4 活动 / H5 签到 / H6 里程碑)。accent=--admin-domain-h。
 * ⚠️ H ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = h-view.tsx + h-tabs/),仅 summary 经 DomainHeader 渲染。
 * 改 H 域数据/动作请改 h-tabs/data.ts,勿在此处改 content。
 * FOLD: H4→H3(任务与活动同页) / H6→H5(签到与里程碑同页)。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = (note: string): ModuleEntry["content"] => ({ kind: "dashboard", metrics: [], note });

export const DOMAIN_H: ModuleEntry[] = [
  {
    path: "/growth/phase",
    summary:
      "12 月运营节奏的唯一操作面,Phase 模型 10 项 dial 的权威源。前端只消费 server 下发的当前 dial 值;改 dial / 手动 pin / cohort override 需 操作确认,放大流出方向(降冷却 / 降积分门 / 升封顶)先核 B1 兑付覆盖率,低于红线 422。下游 D5/F3/E2/G5/G6/H3 只读。",
    content: placeholder("死代码:H1 真渲染面在 h-tabs/h1-phase.tsx(DIAL_MATRIX 12×10 + LOOSEN_DIR + NEW_USER_ONLY + PHASE_CONTROLS 3 类)。"),
  },
  {
    path: "/growth/trial",
    summary:
      "免费试用引擎 · 19 参数操作面 + 7 态会话监控 + 4 道前置闸(资格统一裁决 / 30 天冷却 / K2 循环阻断 / 扣款幂等)。Model A:购前试用收益仅抵购机款(上限 $50)不可提现,购后剩余入余额。敏感项(机价 🔥 / chargeFailRate 🔥 server-only 永不下发 / 自动扣款 🔥)走 操作确认;其余增长直改必填原因;auto-push 急停实时。amplifies 不挂(收益是折扣不是负债)。",
    content: placeholder("死代码:H2 真渲染面在 h-tabs/h2-trial.tsx(TRIAL_CONFIG 19 + 7 态 SS + 4 行 sessions + 4 道闸)。"),
  },
  {
    path: "/growth/quest",
    summary:
      "三层任务体系(首日 Day-One 6 / 每周 Weekly Tier1×9 + Tier2×8 + 周冠军 / 月度 5 主题账龄派发)+ 6 阶段乘数曲线 P1 1.0 → P6 1.5。questBonusMultiplier 由 H1 派发只读消费,H3 只持任务清单写权。升任务奖励 = 放大 NEX 流出 → 提交即过 B1 红线 422。in-flight 按入窗 / 入周 / 跨档快照锁定(改窗 A/B 方案二选一)。",
    content: placeholder("死代码:H3 真渲染面在 h-tabs/h3-quest-events.tsx(任务部分;FOLD 同页含 H4 活动)。"),
  },
  {
    path: "/growth/events",
    summary:
      "限时活动 CMS · 8 种 EventKind(discount/referral/wheel/regional/onboarding/boost/seasonal/holding)+ Featured 唯一 422 + Trackable 4 行只读消费 E/F/G 状态 + Lucky Spin 转盘治理。转盘三护栏(weight 和=100 / 档位∈[2,12] / 真实奖过 B1)+ B1 自动降级(<100% 暂停真钱档)+ 转盘 spin 日桶 eventId×userId×spinDate 409;featured 唯一 422;ended 优先 409。geo 改区改高敏走超管。",
    content: placeholder("死代码:H4 已合并到 H3 真渲染面 h-tabs/h3-quest-events.tsx(EVENTS_CMS 8 玩法 + WHEEL 8 档 + GUARDS 3 行 + TRACKABLES 4 行)。"),
  },
  {
    path: "/growth/daily",
    summary:
      "每日签到引擎 · 6 条规则 + Lucky 概率倍率(server-canonical RNG)+ 30 天连胜里程碑 7 阶 + Streak Saver 复活卡 + Streak Power-Ups 4 档跨域增益(F2/G5/G1/G4)。Lucky 两档和 ≤100% 422 + 升概率 / 升奖励 / 升 Power-Up 阈值放大流出过 B1;命中率实测 vs 配置 ±1pt 告警;Day-30 发 spin 票转盘归 H4。",
    content: placeholder("死代码:H5 真渲染面在 h-tabs/h5-daily-milestones.tsx(签到部分;FOLD 同页含 H6 里程碑)。"),
  },
  {
    path: "/growth/milestones",
    summary:
      "收益累计里程碑 · 5 档阈值与 NEX 奖励的配置 + 监控。被动触发:累计入账(earnings.total + today)跨阈值自动 fire 庆祝 + 自动派 NEX,一次一档。升奖励 / 降阈值 = 放大 NEX 流出过 B1 红线 422;阈值严格保序违反 422;fire + creditNex + bill 单事务原子,幂等粒度 milestoneId × userId,crash 不出现 firedIds 置位而 NEX 未入账的部分态;cascade 跨多档按当时配置串行(快照锁定)。",
    content: placeholder("死代码:H6 已合并到 H5 真渲染面 h-tabs/h5-daily-milestones.tsx(EARN_MS 5 档 + 三规矩 + TICK_INTERVAL)。"),
  },
];
