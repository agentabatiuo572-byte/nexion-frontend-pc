"use client";

/**
 * 六块的首屏一览：一块一张卡，卡上是 App 上这块现在的展示值和它的状态；卡也是页签，选中的卡指着下面的内容。
 * 只排版：数字由页面从主配置、排名配置读来，这里不发请求、不算业务口径以外的数。
 */
import type { KeyboardEvent } from "react";
import { Activity, Globe2, History, ListChecks, Trophy, Users } from "lucide-react";
import { Stat, StatBand, StatusTag, type TabIds } from "@/app/components/rd";
import type { DeviceRankConfig } from "@/lib/admin/device-rank-config";
import type { H9PublicStatsOverview } from "@/lib/admin/h9-client";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { count, membersAt, usd } from "./h9-parts";

export type H9Module = "home" | "network" | "jobs" | "globe" | "rank" | "history";

/** 页上和确认框里统一用的名字。 */
export const MODULES: readonly { id: H9Module; label: string }[] = [
  { id: "home", label: "首页数字增长" },
  { id: "network", label: "网络脉搏注册人数" },
  { id: "jobs", label: "全球作业基座" },
  { id: "globe", label: "全球网络" },
  { id: "rank", label: "设备预估排名" },
  { id: "history", label: "历史估算" },
];

export const moduleLabel = (id: H9Module) => MODULES.find((item) => item.id === id)!.label;

/** 排名读到没有：独立的模型，失败不影响主配置。 */
export type RankSnapshot = { state: "loading" } | { state: "failed" } | { state: "ready"; config: DeviceRankConfig };

export function H9ModuleCards({ data, failed, rank, module, onSelect, ids, readAt }: {
  data: H9PublicStatsOverview | null;
  /** 主配置读取失败：五块写「—」，排名照常。 */
  failed: boolean;
  rank: RankSnapshot;
  module: H9Module;
  onSelect: (next: H9Module) => void;
  ids: TabIds;
  /** 网络脉搏人数按这个时刻推算。 */
  readAt: number;
}) {
  const order = MODULES.map((item) => item.id);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabValue(order, module, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(ids.tab(next))?.focus();
  };
  const tab = (id: H9Module, openLabel: string) => ({
    selected: id === module, selectedText: "正在查看", onOpen: () => onSelect(id), openLabel,
    role: "tab" as const, id: ids.tab(id), "aria-selected": id === module, "aria-controls": ids.panelId(id),
    tabIndex: id === module ? 0 : -1, onKeyDown,
  });
  const values = data?.values;
  const unread = failed ? "读取失败" : "读取中";
  const unreadTag = <StatusTag tone={failed ? "danger" : "neutral"}>{unread}</StatusTag>;

  const tick = values && values.registeredUsersTickIntervalSec !== undefined && values.registeredUsersTickStepMin !== undefined && values.registeredUsersTickStepMax !== undefined
    ? { intervalSec: values.registeredUsersTickIntervalSec, stepMin: values.registeredUsersTickStepMin, stepMax: values.registeredUsersTickStepMax } : undefined;
  const members = values ? membersAt({ base: values.registeredUsersBase, anchorAt: values.registeredUsersAnchorAt, monthlyPct: values.registeredUsersMonthlyGrowthPct, tick }, readAt) : null;
  const globe = values?.globeDisplay;
  const shares = globe?.centers.every((center) => center.sharePct !== undefined);
  const shareTotal = globe && shares ? globe.centers.reduce((sum, center) => sum + Math.round((center.sharePct ?? 0) * 100), 0) / 100 : null;
  const jobs = values?.activeJobsBase;

  return (
    <div className="h9-cards">
      <StatBand cards role="tablist" label="六块展示数字">
        <Stat {...tab("home", "首页数字增长")} icon={Activity} tone="role-2"
          head={<>首页数字增长{values ? <StatusTag tone={values.homeDisplayEnabled ? "progress" : "neutral"}>{values.homeDisplayEnabled ? "增长中" : "已暂停"}</StatusTag> : unreadTag}</>}
          label="在线设备 · 设定值" value={values ? count(values.homeOnlineCurrent) : "—"} unit={values ? "台" : undefined}
          explain="最近一次设定的当前值。增长开着时 App 上的数每秒在涨，通常比这里大；这页读不到 App 此刻的数。">
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>累计已发放 · 设定值</dt><dd data-empty={values ? undefined : ""}>{values ? `${usd(values.homePaidCurrent)} USD` : "—"}</dd></div>
            <div className="rd-stat-row"><dt>每秒增加</dt><dd data-empty={values ? undefined : ""}>{values ? `${count(values.homeOnlineStepMin)}–${count(values.homeOnlineStepMax)} 台 · ${usd(values.homePaidStepMin)}–${usd(values.homePaidStepMax)} USD` : "—"}</dd></div>
          </dl>
        </Stat>

        <Stat {...tab("network", "网络脉搏注册人数")} icon={Users} tone="role-3"
          surface={values && !tick ? "warn" : undefined}
          head={<>网络脉搏注册人数{values ? tick ? <StatusTag tone="progress">按跳动增长</StatusTag> : <StatusTag tone="warn">部分位置不显示</StatusTag> : unreadTag}</>}
          label="现在约" value={members == null ? "—" : count(members)} unit={members == null ? undefined : "人"}
          explain={tick ? "按读取这页的时刻、用后端同一个公式推算；App 上的数会比这里多几人（每次跳动的固定随机偏移）。" : "只配了月增长率：网络脉搏卡片照常显示这个数，网络快照等位置会显示「不可用」。"}>
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>增长方式</dt><dd data-empty={values ? undefined : ""}>{!values ? "—" : tick ? `每 ${count(tick.intervalSec)} 秒 +${count(tick.stepMin)}–${count(tick.stepMax)} 人` : `每月 +${values.registeredUsersMonthlyGrowthPct}%`}</dd></div>
          </dl>
        </Stat>

        <Stat {...tab("jobs", "全球作业基座")} icon={ListChecks} tone="role-2"
          head={<>全球作业基座{values ? jobs == null ? <StatusTag tone="neutral">未发布</StatusTag> : <StatusTag tone="ok">已发布</StatusTag> : unreadTag}</>}
          label="加在真实作业数上" value={values && jobs != null ? `+${count(jobs)}` : "—"} unit={values && jobs != null ? "个" : undefined}
          explain="App 赚取页任务中心和全球网络页显示「真实进行中作业数 + 基座」。未发布时只显示真实数。">
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>App 显示</dt><dd data-empty={values ? undefined : ""}>{!values ? "—" : jobs == null ? "只显示真实进行中作业数" : `真实进行中作业数 + ${count(jobs)}`}</dd></div>
          </dl>
        </Stat>

        <Stat {...tab("globe", "全球网络")} icon={Globe2} tone="role-2"
          head={<>全球网络{!values ? unreadTag : !globe ? <StatusTag tone="neutral">未配置</StatusTag> : shares ? <StatusTag tone="ok">8 个中心</StatusTag> : <StatusTag tone="warn">比例只读</StatusTag>}</>}
          label="8 个中心占比合计" value={shareTotal == null ? "—" : `${shareTotal.toFixed(2)}%`}
          explain="在线设备和进行中作业按这 8 个比例分到各中心，合计要等于 100%。">
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>数据变化间隔</dt><dd data-empty={globe ? undefined : ""}>{globe ? `${count(globe.intervalMs / 1000)} 秒` : "—"}</dd></div>
          </dl>
        </Stat>

        <Stat {...tab("rank", "设备预估排名")} icon={Trophy} tone="role-4"
          head={<>设备预估排名{rank.state === "ready" ? <StatusTag tone={rank.config.enabled ? "ok" : "neutral"}>{rank.config.enabled ? "已开启" : "已关闭"}</StatusTag> : <StatusTag tone={rank.state === "failed" ? "danger" : "neutral"}>{rank.state === "failed" ? "读取失败" : "读取中"}</StatusTag>}</>}
          label="档位" value={rank.state === "ready" ? String(rank.config.tiers.length) : "—"} unit={rank.state === "ready" ? "档" : undefined}
          explain="独立的一套设置：自己的版本、自己保存，和其余五块互不影响。">
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>排名设置版本</dt><dd data-empty={rank.state === "ready" ? undefined : ""}>{rank.state === "ready" ? `v${rank.config.version}` : "—"}</dd></div>
          </dl>
        </Stat>

        <Stat {...tab("history", "历史估算")} icon={History} tone="role-other"
          head={<>历史估算{values ? <StatusTag tone="neutral">目前不生效</StatusTag> : unreadTag}</>}
          label="历史估算分母" value={data ? count(data.realUserCount + data.values.virtualUserCount) : "—"} unit={data ? "人" : undefined}
          explain="App 正式页面不读这组参数，只在这页做历史估算。分母 = 注册账号总数 + 虚拟人口。">
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>App 上</dt><dd data-empty={values ? undefined : ""}>{values ? "不显示" : "—"}</dd></div>
          </dl>
        </Stat>
      </StatBand>
    </div>
  );
}
