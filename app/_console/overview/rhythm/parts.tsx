"use client";

/**
 * B4 的阶段线、用户分布和八项参数。只画接口给的数：阶段管哪几个月取自按月的人数分布（后端按运营阶段设置的月份映射给出），
 * 人数是按注册时长归到阶段的账户数，八项参数是运营阶段设置当前月的值，下个月的值取自后端给的「下个月变化」。
 * 原来的 data-testid（b4-distribution-row、b4-dial-row）照旧挂在每一行上。
 */
import type { ReactNode } from "react";
import { Ban, CalendarRange, CircleSlash, SlidersHorizontal, Users } from "lucide-react";
import {
  Change, Explain, Panel, RatioBar, ScaleBar, StageLine, StatusTag, Table, Td, Th, Tr,
} from "@/app/components/rd";
import type { B4DistributionRow, B4PhaseOverview } from "@/lib/admin/b4-client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

type Range = { from: number; to: number };


/** 每个阶段管哪几个月：按月的人数分布里每个月带着它属于哪个阶段。 */
export function phaseRanges(months: readonly B4DistributionRow[]) {
  const ranges = new Map<string, Range>();
  for (const row of months) {
    if (row.month == null) continue;
    const range = ranges.get(row.phase);
    ranges.set(row.phase, range ? { from: Math.min(range.from, row.month), to: Math.max(range.to, row.month) } : { from: row.month, to: row.month });
  }
  return ranges;
}

export function nextMonthPhase(months: readonly B4DistributionRow[], currentMonth: number) {
  return months.find((row) => row.month === currentMonth + 1)?.phase ?? null;
}

const span = (range: Range) => (range.from === range.to ? `第 ${range.from} 月` : `第 ${range.from}–${range.to} 月`);

// ---------- 阶段线 ----------

export function StagePanel({ data, ranges, nextPhase, phaseNames }: { data: B4PhaseOverview; ranges: Map<string, Range>; nextPhase: string | null; phaseNames: Record<string, string> }) {
  const named = (phase: string) => phaseNames[phase] ? `${phase} ${phaseNames[phase]}` : phase;
  const { currentPhase, currentMonth, phaseProgressPct } = data.rhythm;
  const phases = data.filters.phaseOptions;
  const mapped = data.monthDistribution.find((row) => row.month === currentMonth)?.phase;
  const after = phases.slice(phases.indexOf(currentPhase) + 1).find((phase) => ranges.has(phase));
  const next = data.nextPivot.atMonth == null
    ? { value: "没有了", sub: "已是最后一个月" }
    : nextPhase && nextPhase !== currentPhase
      ? { value: named(nextPhase), sub: `第 ${ranges.get(nextPhase)?.from ?? data.nextPivot.atMonth} 个月起，就是下个月` }
      : after
        ? { value: named(after), sub: `第 ${ranges.get(after)!.from} 个月起；下个月还在 ${currentPhase}` }
        : { value: "没有了", sub: `已是最后一个阶段，下个月还在 ${currentPhase}` };
  return (
    <Panel title="阶段时间线" icon={CalendarRange} tone="role-3" className="b4-stage"
      explain="阶段线只表示先后，不代表时长。每个阶段管哪几个月，按运营阶段设置的总月数推算；当前阶段按运营阶段设置里记录的值。">
      <StageLine label="阶段时间线" currentId={currentPhase}
        stages={phases.map((phase) => ({ id: phase, label: named(phase), sub: ranges.has(phase) ? span(ranges.get(phase)!) : "不占月份" }))} />
      {mapped && mapped !== currentPhase && (
        <p className="b4-stage-note">运营阶段设置里记的当前阶段是 {currentPhase}；按月份推算，第 {currentMonth} 个月属于 {mapped}。这页以记的为准。</p>
      )}
      <dl className="b4-stage-facts">
        <div>
          <dt>阶段进度<Explain label="阶段进度是什么" content="运营阶段设置里人工填的 0–100% 进度，不按日期或人数算，也不会自动推进阶段。" /></dt>
          <dd>
            <strong data-empty={phaseProgressPct === 0 ? "" : undefined}>{phaseProgressPct}<small>%</small></strong>
            <ScaleBar quiet label="阶段进度" valueText={`阶段进度 ${phaseProgressPct}%`} max={100} value={phaseProgressPct} fill tone="role-3"
              ticks={[{ value: 0, text: "0%" }, { value: 100, text: "100%" }]} />
          </dd>
        </div>
        <div>
          <dt>下一个阶段</dt>
          <dd>
            {next.value === "没有了" ? <span className="b4-line">没有下一个阶段了</span> : <strong>{next.value}</strong>}
            <span className="b4-muted">{next.sub}</span>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

// ---------- 用户分布 ----------

const share = (count: number, total: number) => `${((count / total) * 100).toFixed(1)}%`;

function BarRow({ row, label, total }: { row: B4DistributionRow; label: ReactNode; total: number }) {
  return (
    <li data-testid="b4-distribution-row" data-out={row.inScope ? undefined : ""}>
      <span className="rd-barlist-label">{label}</span>
      <span className="b4-track">
        {total > 0 && <RatioBar quiet label="占全部用户" value={row.userCount} total={total} valueText={`${row.userCount.toLocaleString()} 人，共 ${total.toLocaleString()} 人`} tone={row.inScope ? "role-3" : "role-other"} />}
      </span>
      <span className="rd-barlist-text">
        <span data-zero={row.userCount === 0 ? "" : undefined}>{row.userCount.toLocaleString()} 人</span>
        {total > 0 && <span className="b4-share">{share(row.userCount, total)}</span>}
      </span>
    </li>
  );
}

export function Distribution({ data, ranges, phase, phaseNames }: { data: B4PhaseOverview; ranges: Map<string, Range>; phase: string; phaseNames: Record<string, string> }) {
  const named = (phase: string) => phaseNames[phase] ? `${phase} ${phaseNames[phase]}` : phase;
  const byMonth = data.filters.granularity === "MONTH";
  const total = data.phaseDistribution.reduce((sum, row) => sum + row.userCount, 0);
  const totalMonths = data.rhythm.totalMonths;
  const filtered = phase !== "ALL";
  const top = data.phaseDistribution.reduce<B4DistributionRow | null>((best, row) => (!best || row.userCount > best.userCount ? row : best), null);
  const picked = filtered ? data.phaseDistribution.find((row) => row.phase === phase) : undefined;
  const ageText = (range?: Range) => !range ? "不占月份" : range.to === totalMonths
    ? `注册第 ${range.from} 个月及以后`
    : range.from === range.to ? `注册第 ${range.from} 个月` : `注册第 ${range.from}–${range.to} 个月`;
  return (
    <Panel title="用户按注册时长落在哪些阶段" icon={Users} tone="role-3" className="b4-dist"
      sub={`${byMonth ? "按月" : "按运营阶段"}${filtered ? ` · 已筛选 ${phase}` : ""}`}
      explain={<>
        <p>把每个账户的注册时长（满几个月）对应到运营阶段设置的月份和阶段，算全部未删除的账户。注册超过最后一个月的都算在最后一个月。</p>
        <p>这是用户结构，不是各人用哪套参数：八项参数按平台当前月份统一取值，不按每个人的注册时长分别取。人数和用户转化概览按行为统计的不同。</p>
      </>}>
      {total === 0 ? (
        <p className="b4-line">还没有注册用户，各阶段都是 0 人，暂时不能导出。</p>
      ) : (
        <div className="b4-dist-body">
          <p className="b4-line">
            共 <b className="b4-strong">{total.toLocaleString()}</b> 人；{top && <>{top.phase} 最多（{ageText(ranges.get(top.phase))}），{top.userCount.toLocaleString()} 人，占 {share(top.userCount, total)}</>}
            {picked && picked !== top && <>；你选的 {picked.phase} 有 {picked.userCount.toLocaleString()} 人，占 {share(picked.userCount, total)}</>}
          </p>
          {byMonth ? (
            <ul className="b4-groups" aria-label="各月份用户数，按阶段分组">
              {data.filters.phaseOptions.map((group) => {
                const rows = data.distribution.filter((row) => row.phase === group);
                return (
                  <li key={group} className="b4-group" data-out={filtered && group !== phase ? "" : undefined}>
                    <span className="b4-group-name">{named(group)}<span className="b4-muted">{rows.length ? ` · ${rows.reduce((sum, row) => sum + row.userCount, 0).toLocaleString()} 人` : " · 不占月份"}</span></span>
                    {rows.length > 0 && (
                      <ul className="rd-barlist b4-bars">
                        {rows.map((row) => (
                          <BarRow key={`${row.phase}-${row.month}`} row={row} total={total}
                            label={row.month === totalMonths ? `第 ${row.month} 个月及以后` : `第 ${row.month} 个月`} />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="rd-barlist b4-bars" aria-label="各运营阶段用户数">
              {data.distribution.map((row) => (
                <BarRow key={row.phase} row={row} total={total}
                  label={<span className="b4-bar-name"><b>{named(row.phase)}</b><span>{ageText(ranges.get(row.phase))}</span></span>} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------- 八项参数 ----------

/** 名字和单位照运营阶段设置（H1）；「管什么」一句话常显，细节进问号。后端 label 只用来对上「下个月变化」那几行。 */
const DIALS: Record<string, { name: string; what: string; detail: string; retired?: true }> = {
  newUserBonusMultiplier: { name: "新用户加成", what: "新用户奖励的倍率", detail: "这个月新用户相关奖励按这个倍率算；改了不追溯已结算的奖励。" },
  inviteRewardMultiplier: { name: "邀请加成", what: "邀请奖励的倍率", detail: "这个月邀请奖励按这个倍率算；改了不重算已有的邀请结算。" },
  reinvestMultiplier: { name: "锁定计划加成", what: "锁定计划的阶段倍率", detail: "参与锁定计划时用的阶段倍率。" },
  withdrawPenaltyFeeRate: { name: "提现惩罚费率", what: "已停用，现在不收", retired: true,
    detail: "这项已经停用：新提现的惩罚费现在是 0，运营阶段设置里也没有这一项。这里只显示配置里还留着的数，不会向用户收。" },
  withdrawCooldownDays: { name: "到账审查窗口", what: "大额提现要等的天数",
    detail: "加强合规审查开启时，USDT 提现每笔人工审查，本金大于 1,000 USDT 的还要等这些天；0 天也要人工审查。不是所有提现都要等。" },
  binaryDailyCap: { name: "团队平衡奖励每日上限", what: "团队平衡奖励每天封顶", detail: "每天团队平衡奖励最多发这么多，要大于 0。以前存成 0 的月份不结算这项奖励，App 里也读不到。" },
  questBonusMultiplier: { name: "任务加成", what: "任务奖励的倍率", detail: "任务奖励按这个倍率算，有当周设置时按当周的；改了不重算已结算的任务。" },
  complianceHoldEnabled: { name: "加强合规审查", what: "USDT 提现人工审查开关",
    detail: "开启时 USDT 三个网络的提现每笔人工审查。开着不等于每一笔都会被挂起等待。" },
};

/** 值的写法：开关写已开启、未开启；USDT 金额加千分位、至少两位小数，不舍入；其余照后端原值加单位。 */
function dialText(value: string | number | boolean, unit: string) {
  if (typeof value === "boolean" || value === "true" || value === "false") return value === true || value === "true" ? "已开启" : "未开启";
  if (String(value) === "是" || String(value) === "否") return String(value);
  if (unit === "USDT" && Number.isFinite(Number(value))) {
    return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 20 })} USDT`;
  }
  if (unit === "%") return `${value}%`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

/** 后端的变化行是「后端标签 旧值单位 → 新值单位」，按这一项的标签对上，拆出前后值再按本页写法写。 */
function changeFor(changes: readonly string[], label: string, unit: string) {
  const line = changes.find((item) => item.startsWith(`${label} `));
  if (!line) return null;
  const parts = line.slice(label.length + 1).split(" → ");
  if (parts.length !== 2) return { from: "", to: line };
  const strip = (text: string) => (unit && text.endsWith(unit) ? text.slice(0, -unit.length).trim() : text.trim());
  return { from: dialText(strip(parts[0]), unit), to: dialText(strip(parts[1]), unit) };
}

export function DialsPanel({ data, canJump, busy, jumping, filteredPhase, onJump, phaseNames }: {
  data: B4PhaseOverview;
  canJump: boolean;
  busy: string;
  jumping: string;
  filteredPhase: string | null;
  onJump: (dial: string) => void;
  phaseNames: Record<string, string>;
}) {
  const named = (phase: string) => phaseNames[phase] ? `${phase} ${phaseNames[phase]}` : phase;
  const { currentPhase } = data.rhythm;
  const pivot = data.nextPivot;
  const last = pivot.atMonth == null;
  const changed = pivot.changes.length;
  const source = data.dials[0]?.source;
  return (
    <Panel title="现在的八项参数" icon={SlidersHorizontal} tone="role-4" flush className="b4-dials-panel"
      sub={`${named(currentPhase)} · ${source ? operatorCopyText(source) : `第 ${data.rhythm.currentMonth} 个月`}`}
      explain={<>
        <p>按运营阶段设置当前月份的值，和上面选的查看方式、阶段、月份无关。要改到运营阶段设置去改，这页只能看。</p>
        <p>标「已停用」的那项系统不再执行；其余各项按「现在」的值执行，开关看开没开。</p>
      </>}>
      <p className="b4-panel-note">
        {last ? "已是最后一个月，后面没有要切换的参数。"
          : changed ? <>第 {pivot.atMonth} 个月配好的值有 <b>{changed}</b> 项和现在不同；{pivot.daysLeft == null ? "还没设切换时间，不会自动换过去" : `离切换还有 ${pivot.daysLeft} 天`}。</>
            : <>下个月（第 {pivot.atMonth} 个月）参数不变。</>}
        {filteredPhase && filteredPhase !== currentPhase && <span className="b4-muted"> 这里是当前阶段 {currentPhase} 的参数，不随上面选的 {filteredPhase} 变。</span>}
      </p>
      <Table label="现在的八项参数" className="b4-dials">
        <thead>
          <Tr>
            <Th>参数</Th>
            <Th className="b4-col-what">管什么</Th>
            <Th align="right">现在</Th>
            {!last && (
              <Th align="right">
                <span className="b4-th">第 {pivot.atMonth} 个月<Explain label="下个月的值" content={<>
                  <p>运营阶段设置里第 {pivot.atMonth} 个月配好的值，和现在不一样的标成「现在 → 下个月」。</p>
                  <p>{pivot.basis ? `${operatorCopyText(pivot.basis)}；` : ""}月份不会自动往后切，到运营阶段设置里切换。</p>
                </>} /></span>
              </Th>
            )}
            {canJump && <Th align="right">操作</Th>}
          </Tr>
        </thead>
        <tbody>
          {data.dials.map((dial) => {
            const meta = DIALS[dial.key] ?? { name: dial.label, what: "—", detail: "" };
            const retired = dial.executionStatus === undefined ? meta.retired : dial.executionStatus === "RETIRED";
            const change = changeFor(pivot.changes, dial.label, dial.unit);
            return (
              <Tr key={dial.key} data-testid="b4-dial-row" data-retired={retired ? "" : undefined}>
                <Td>
                  <span className="b4-dial-name">
                    <b>{meta.name}</b>
                    {meta.detail && <Explain label={`${meta.name}管什么`} content={meta.detail} />}
                  </span>
                  {retired && <span className="b4-retired-inline"><StatusTag tone="neutral" icon={Ban}>已停用，现在不收</StatusTag></span>}
                </Td>
                <Td className="b4-col-what">{retired ? <StatusTag tone="neutral" icon={Ban}>已停用，现在不收</StatusTag> : <span className="b4-muted">{meta.what}</span>}</Td>
                <Td align="right"><span className="b4-value" data-retired={retired ? "" : undefined}>{dial.key === "binaryDailyCap" && dial.currentValue != null && String(dial.currentValue).trim() !== "" && Number(dial.currentValue) === 0 && <StatusTag tone="warn" icon={CircleSlash} explain="这是以前存的 0，现在不能再设成 0；上限是 0 的月份不结算团队平衡奖励。">以前存的</StatusTag>}{dialText(dial.currentValue, dial.unit)}</span></Td>
                {!last && (
                  <Td align="right">
                    {retired ? <span className="b4-muted">{change ? `${change.from} → ${change.to}` : "不变"}</span>
                      : change ? (change.from ? <Change from={change.from} to={change.to} /> : change.to) : <span className="b4-muted">不变</span>}
                  </Td>
                )}
                {canJump && (
                  <Td align="right" data-fit="">
                    {retired ? (
                      <span className="b4-muted" aria-label={`${meta.name}已停用，没有调整入口`}>—</span>
                    ) : (
                      <a href={dial.adjustHref} className="rd-link b4-nowrap" aria-disabled={busy !== ""} aria-label={`去运营阶段设置调整${meta.name}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onJump(dial.key);
                        }}>
                        {jumping === dial.key ? "正在打开…" : "去调整"}
                      </a>
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}
