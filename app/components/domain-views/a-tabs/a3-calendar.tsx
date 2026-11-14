"use client";

/**
 * A3 业务日历（W03 安排、W04 撤销）。请求、命令号、校验沿用旧 business-calendar-config.tsx：
 * 安排在打开确认时铸一次命令号（a3-business-zone-*），撤销每点一次新号（a3-business-zone-cancel-*），理由 trim 后 8–200。
 * 主图是两条轨道的版本时间线：现在用的、已安排的、切换那一天变长还是变短。
 * 切换时刻以后端 effectiveStorageAt 为准；表单里的预览按同一规则（新旧时区当天零点里最早的那个）现算。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarPlus, CalendarX2, History } from "lucide-react";
import { BlockState, Button, Cell, Change, Fact, Facts, Field, Fold, Modal, Notice, Panel, Select, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr, Input } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessDay, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { cancelBusinessZone, fetchBusinessCalendar, scheduleBusinessZone, zoneOptionLabel, type BusinessCalendarVersion, type BusinessCalendarView } from "@/lib/admin/business-calendar-client";

export type A3CalendarSummary = { zone?: string; sub?: string; pending?: string; failed?: boolean };

/** "UTC+7" for a zone id, from the browser's tz data; the backend only offers zones without daylight saving. */
function offsetOf(zoneId: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zoneId, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "";
    return name === "GMT" ? "UTC+0" : name.replace("GMT", "UTC");
  } catch { return ""; }
}

function offsetMinutes(offset: string): number | null {
  const match = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset);
  if (!match) return null;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function previousDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** 当天零点在各时区的时刻里取最早的（后端 BusinessCalendar.switchStorageAt），返回毫秒。 */
function switchInstant(date: string, offsets: number[]) {
  const base = Date.parse(`${date}T00:00:00Z`);
  return Math.min(...offsets.map((minutes) => base - minutes * 60_000));
}

/** 切换前一天有多长：从这条轨道旧时区的零点，到新时区当天零点。 */
function lastDayHours(oldMinutes: number, newMinutes: number) {
  return 24 + (oldMinutes - newMinutes) / 60;
}

function hoursText(hours: number) {
  const whole = Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${whole} 小时`;
}

function dayChange(hours: number) {
  if (hours === 24) return "长度不变";
  return hours > 24 ? `多 ${hoursText(hours - 24)}` : `少 ${hoursText(24 - hours)}`;
}

const TRACKS = [
  { key: "LEGACY", name: "其他模块", hint: "增长与团队以外" },
  { key: "GROWTH_TEAM", name: "增长与团队", hint: "增长、团队相关的统计和奖励" },
] as const;

const TRACK_LABEL: Record<BusinessCalendarVersion["track"], string> = { LEGACY: "其他模块", GROWTH_TEAM: "增长与团队", GLOBAL: "全部模块" };
const dateText = (date: string) => date === "1970-01-01" ? "初始" : date;
const operatorText = (value: string) => value === "migration:r1" ? "系统迁移" : value || "—";
const appliesTo = (row: BusinessCalendarVersion, track: string) => row.track === track || row.track === "GLOBAL";

export function A3Calendar({ nonce, onSummary, toast }: { nonce: number; onSummary: (summary: A3CalendarSummary | null) => void; toast: (text: string, kind?: "success" | "error" | "warn" | "info") => void }) {
  const session = useAdminAuth((state) => state.session);
  const canWrite = session?.role === "superadmin";
  const [view, setView] = useState<BusinessCalendarView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirming, setConfirming] = useState<{ key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await fetchBusinessCalendar();
      setView(next);
      setEffectiveDate((value) => value && value >= next.earliestEffectiveDate ? value : next.earliestEffectiveDate);
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, nonce]);

  const zoneLabel = useCallback((id: string) => id === "Asia/Shanghai" ? "北京时间" : view?.options.find((option) => option.zoneId === id)?.label ?? id, [view]);
  const countries = useMemo(() => {
    const seen = new Map<string, string>();
    view?.options.forEach((option) => { const key = option.countryCode ?? "UTC"; if (!seen.has(key)) seen.set(key, option.countryName); });
    return [...seen.entries()];
  }, [view]);
  const zones = view?.options.filter((option) => (option.countryCode ?? "UTC") === country) ?? [];
  const selected = zones.find((option) => option.zoneId === zoneId);
  const reasonValid = reason.trim().length >= 8 && reason.trim().length <= 200;
  const formReady = Boolean(selected && view && effectiveDate >= view.earliestEffectiveDate && reasonValid);
  const growthZone = view?.trackZones.GROWTH_TEAM;
  const pending = view?.pending ?? null;

  useEffect(() => {
    if (!view) { onSummary(error ? { failed: true } : null); return; }
    const growthDiffers = !view.unified && growthZone;
    onSummary({
      zone: view.currentZoneLabel,
      sub: pending
        ? `${pending.effectiveDate} 起改${zoneLabel(pending.zoneId)}`
        : growthDiffers ? `增长与团队按${zoneLabel(growthZone)}` : `${view.currentOffset} · 没有安排`,
      pending: pending ? `${pending.effectiveDate} 起改用${zoneLabel(pending.zoneId)}（${pending.offset}）` : undefined,
    });
  }, [view, error, pending, growthZone, zoneLabel, onSummary]);

  const pickCountry = (code: string) => {
    setCountry(code);
    setZoneId(view?.options.find((option) => (option.countryCode ?? "UTC") === code)?.zoneId ?? "");
  };

  const submit = async () => {
    if (!confirming || !selected || saving) return;
    setSaving(true); setError(null);
    try {
      setView(await scheduleBusinessZone({ countryCode: selected.countryCode, zoneId: selected.zoneId, effectiveDate, reason }, confirming.key));
      setConfirming(null); setReason(""); setFormOpen(false); setTouched(false);
      setSuccess(`已安排：${effectiveDate} 起改用${selected.label}。生效前可以撤销。`);
      toast(`已安排业务时区：${effectiveDate} 起改用${selected.label}`, "success");
    } catch (cause) { setError(displayAdminError(cause)); setConfirming(null); }
    finally { setSaving(false); }
  };

  const cancel = async (target: BusinessCalendarVersion) => {
    if (saving) return;
    if (cancelReason.trim().length < 8 || cancelReason.trim().length > 200) { setError("撤销理由必须填写 8-200 个字符。"); return; }
    setSaving(true); setError(null);
    try {
      setView(await cancelBusinessZone(target.id, cancelReason, `a3-business-zone-cancel-${crypto.randomUUID()}`));
      setCancelReason(""); setCancelOpen(false); setSuccess("已撤销待生效的时区安排，现行时区不变。");
      toast("已撤销待生效的时区安排", "success");
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setSaving(false); }
  };

  /* 现在每条轨道用的版本：已生效里生效时刻最晚的一条。 */
  const history = view?.history ?? [];
  const currentOf = (track: string) => [...history].filter((row) => appliesTo(row, track) && !row.pending)
    .sort((a, b) => a.effectiveStorageAt.localeCompare(b.effectiveStorageAt)).at(-1);
  const trackOffset = (track: string) => {
    const row = currentOf(track);
    return row ? offsetMinutes(row.offset) : null;
  };

  /* 时间线的列：每个生效日一列，「现在」插在已生效和安排中之间；太早的版本收进版本记录。 */
  const dates = [...new Set(history.map((row) => row.effectiveDate))].sort();
  const pastDates = dates.filter((date) => history.some((row) => row.effectiveDate === date && !row.pending));
  const futureDates = dates.filter((date) => !pastDates.includes(date));
  const shownPast = pastDates.slice(-3);
  const hiddenPast = pastDates.length - shownPast.length;
  const columns: Array<{ key: string; date?: string; now?: boolean }> = [...shownPast.map((date) => ({ key: date, date })), { key: "now", now: true }, ...futureDates.map((date) => ({ key: date, date }))];

  /* 已安排的那一次：切换时刻读后端，切换前一天的长度按两条轨道各算。 */
  const pendingDays = pending ? TRACKS.map((track) => {
    const before = trackOffset(track.key);
    const after = offsetMinutes(pending.offset);
    return { track, hours: before === null || after === null ? null : lastDayHours(before, after) };
  }) : [];

  /* 表单预览：切换时刻按同一规则现算；两条轨道现在的时区就是那天的旧时区（有安排时不能再安排）。 */
  const previewOffsets = selected ? [offsetMinutes(offsetOf(selected.zoneId)), ...TRACKS.map((track) => trackOffset(track.key))] : [];
  const previewReady = Boolean(selected && effectiveDate && view && effectiveDate >= view.earliestEffectiveDate && previewOffsets.every((value) => value !== null));
  const previewSwitch = previewReady ? switchInstant(effectiveDate, previewOffsets as number[]) : null;
  const previewDays = previewReady ? TRACKS.map((track) => ({ track, hours: lastDayHours(trackOffset(track.key) as number, previewOffsets[0] as number) })) : [];
  const stampOf = (ms: number) => formatBusinessTimeCompact(new Date(ms).toISOString(), "—");

  const openForm = () => { setError(null); setSuccess(null); setTouched(false); setFormOpen(true); };
  const zoneText = businessZone().label;

  if (!view) {
    return loading || (!error && !view)
      ? <BlockState state="loading" title="正在读取业务日历…" />
      : <BlockState state="error" title="业务日历读取失败" detail={<>{error} 读到之前，后台时间按北京时间显示。</>} onRetry={() => void refresh()} />;
  }

  const timeline = (
    <div className="a3-cal" data-cols={columns.length} role="table" aria-label="业务时区版本时间线">
      <div className="a3-cal-row a3-cal-head" role="row">
        <span role="columnheader" className="a3-cal-lane">适用模块</span>
        {columns.map((column) => <span key={column.key} role="columnheader" className="a3-cal-date" data-now={column.now ? "" : undefined}>
          {column.now ? <>现在<small className="a3-cal-today">{businessDay()}</small></> : dateText(column.date ?? "")}
          {!column.now && futureDates.includes(column.date ?? "") && <small>安排中</small>}
        </span>)}
      </div>
      {TRACKS.map((track) => {
        const current = currentOf(track.key);
        return <div key={track.key} className="a3-cal-row" role="row">
          <span role="rowheader" className="a3-cal-lane">{track.name}<small>{track.hint}</small></span>
          {columns.map((column) => {
            if (column.now) {
              return <span key={column.key} role="cell" className="a3-cal-cell" data-now="" aria-label={current ? `现在用${zoneLabel(current.zoneId)}` : "现在用的版本读不到"}>
                <span className="a3-cal-now" aria-hidden />
              </span>;
            }
            const row = history.find((item) => item.effectiveDate === column.date && appliesTo(item, track.key));
            return <span key={column.key} role="cell" className="a3-cal-cell">
              {row ? <span className="a3-cal-node" data-pending={row.pending ? "" : undefined} data-current={row.id === current?.id ? "" : undefined} data-past={!row.pending && row.id !== current?.id ? "" : undefined}>
                <b>{zoneLabel(row.zoneId)}</b><small>{row.offset}{row.pending ? " · 安排中" : row.id === current?.id ? " · 现在用" : ""}</small>
              </span> : <span className="a3-cal-gap" aria-label="沿用前一个版本" />}
            </span>;
          })}
        </div>;
      })}
    </div>
  );

  return <div className="rd-tab-stack" data-testid="business-calendar-config">
    {error && !formOpen && !cancelOpen && <Notice tone="danger">{error}</Notice>}
    {success && <Notice tone="ok">{success}</Notice>}

    <Panel title="业务时区" icon={CalendarClock} tone="role-3"
      sub={view.unified ? `${view.currentZoneLabel} · ${view.currentOffset}` : `两条轨道不一致 · 日期按各自时区`}
      explain={<>
        <p>按日、周、月统计、结算和榜单切分「一天」用的时区。改的是以后：从安排的那一天起按新时区切日，已经过去的日子不重算。</p>
        <p>不跟着变的：数据库存储时间（仍是北京时间）、会话过期、转盘按 UTC 零点重置、越南银行日和 D5 单日提现限额按越南时间。</p>
      </>}
      actions={canWrite ? (pending
        ? <Button size="sm" variant="danger-outline" icon={<CalendarX2 size={14} aria-hidden />} disabledReason={saving ? "正在提交" : undefined} onClick={() => { setError(null); setSuccess(null); setCancelOpen(true); }}>撤销这次安排</Button>
        : <Button size="sm" variant="primary" icon={<CalendarPlus size={14} aria-hidden />} onClick={openForm}>安排新的业务时区</Button>)
        : <span className="rd-note">只有超级管理员能安排和撤销</span>}>
      {!view.unified && growthZone && <Notice tone="neutral">现在增长与团队按{zoneLabel(growthZone)}（{offsetOf(growthZone)}），其他模块按{view.currentZoneLabel}（{view.currentOffset}）。下一次安排对两条轨道同时生效，生效后统一。</Notice>}
      {timeline}
      {hiddenPast > 0 && <p className="rd-note a3-cal-note">更早的 {hiddenPast} 个版本在下面的版本记录里</p>}
      {pending ? <div className="a3-switch">
        <h3 className="a3-switch-title">切换那一天<StatusTag tone="progress">安排中</StatusTag></h3>
        <Facts>
          <Fact k="新时区">{zoneLabel(pending.zoneId)}（{pending.offset}）</Fact>
          <Fact k="生效日">{pending.effectiveDate}</Fact>
          <Fact k="切换时刻">{formatBusinessTimeCompact(pending.effectiveStorageAt, "—")}（{zoneText}）</Fact>
          {pendingDays.map(({ track, hours }) => <Fact key={track.key} k={`${track.name}的 ${previousDay(pending.effectiveDate)}`} tone={hours !== null && hours !== 24 ? "warn" : undefined}>
            {hours === null ? "—" : `${hoursText(hours)}，${dayChange(hours)}`}
          </Fact>)}
          <Fact k="安排人">{operatorText(pending.operator)} · {formatBusinessTimeCompact(pending.createdAt, "—")}</Fact>
          <Fact k="理由">{pending.reason || "—"}</Fact>
        </Facts>
        <p className="rd-note">切换时刻取新旧时区当天零点里最早的那个，不一定是新时区的 00:00；那一天之前的日子不重算。生效前可以撤销，生效后只能再安排新的。</p>
      </div> : <p className="rd-note a3-cal-note">没有安排中的时区变更。同一时间只能有一个安排，最早可以安排 {view.earliestEffectiveDate} 生效。</p>}
    </Panel>

    <Fold title="版本记录" icon={History} tone="role-other" summary={`${history.length} 条 · 最新在上 · 已撤销的不显示`}>
      <Table label="业务时区版本记录">
        <thead><tr><Th>适用模块</Th><Th>时区</Th><Th>生效日</Th><Th>状态</Th><Th>操作人</Th><Th>理由</Th></tr></thead>
        <tbody>
          {[...history].reverse().map((row) => {
            const current = TRACKS.some((track) => currentOf(track.key)?.id === row.id);
            return <Tr key={row.id}>
              <Td><Cell main={TRACK_LABEL[row.track] ?? row.track} /></Td>
              <Td><Cell main={zoneLabel(row.zoneId)} sub={row.offset} /></Td>
              <Td><Cell num main={dateText(row.effectiveDate)} /></Td>
              <Td><Cell main={row.pending ? <StatusTag tone="progress">安排中</StatusTag> : current ? <StatusTag tone="ok">现在用</StatusTag> : <StatusTag tone="done">已被替换</StatusTag>} /></Td>
              <Td><Cell main={operatorText(row.operator)} sub={formatBusinessTimeCompact(row.createdAt, "—")} /></Td>
              <Td grow><Cell main={row.reason || "—"} title={row.reason} /></Td>
            </Tr>;
          })}
          {history.length === 0 && <TableMessage columns={6}>还没有版本记录</TableMessage>}
        </tbody>
      </Table>
    </Fold>

    {formOpen && !confirming && <Modal title="安排新的业务时区" icon={CalendarPlus} busy={saving} dirty={Boolean(country || reason)} onClose={() => setFormOpen(false)}
      sub={<StatusTag tone="progress" filled>到生效日才生效</StatusTag>}
      footer={<>
        <Button onClick={() => setFormOpen(false)}>取消</Button>
        <Button variant="primary" disabledReason={!selected ? "先选国家或地区" : effectiveDate < view.earliestEffectiveDate ? `生效日期最早 ${view.earliestEffectiveDate}` : !reasonValid ? "理由要写 8–200 字" : undefined}
          onBlockedClick={() => setTouched(true)}
          onClick={() => setConfirming({ key: `a3-business-zone-${crypto.randomUUID()}` })}>下一步：核对</Button>
      </>}>
      {error && <Notice tone="danger" title="安排没有成功">{error}</Notice>}
      <div className="rd-form-grid" data-cols="2" data-dense="">
        <Field label="国家或地区" required help="选好后自动带出时区，货币和语言不跟着变">
          {(control) => <Select {...control} aria-label="国家或地区" placeholder="请选择" value={country} onChange={pickCountry} options={countries.map(([code, name]) => ({ value: code, label: name }))} />}
        </Field>
        <Field label="时区" required>
          {(control) => <Select {...control} aria-label="时区" disabled={!country} placeholder="先选国家" value={zoneId} onChange={setZoneId} options={zones.map((option) => ({ value: option.zoneId, label: zoneOptionLabel(option, offsetOf(option.zoneId)) }))} />}
        </Field>
      </div>
      <Field label="生效日期" required hint={`最早 ${view.earliestEffectiveDate}`} error={effectiveDate && effectiveDate < view.earliestEffectiveDate ? `最早只能安排 ${view.earliestEffectiveDate}` : undefined}>
        {(control) => <Input {...control} aria-label="生效日期" type="date" min={view.earliestEffectiveDate} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />}
      </Field>
      {previewReady && selected && previewSwitch !== null && <Facts>
        <Fact k="切换时刻">{stampOf(previewSwitch)}（{zoneText}）</Fact>
        {previewDays.map(({ track, hours }) => <Fact key={track.key} k={`${track.name}的 ${previousDay(effectiveDate)}`} tone={hours !== 24 ? "warn" : undefined}>{hoursText(hours)}，{dayChange(hours)}</Fact>)}
      </Facts>}
      <Field label="理由" required hint="8–200 字" error={touched && !reasonValid ? "理由要写 8–200 字" : undefined}>
        {(control) => <Textarea {...control} aria-label="业务时区修改理由" value={reason} maxLength={200} rows={2} count={`${reason.trim().length}/200`} placeholder="例如：主要市场改到越南，工单号" onBlur={() => setTouched(true)} onChange={(event) => setReason(event.target.value)} />}
      </Field>
    </Modal>}

    {confirming && selected && <Modal title="确认安排业务时区" tone="danger" busy={saving} onClose={() => setConfirming(null)}
      sub={<StatusTag tone="progress" filled>{effectiveDate} 起生效</StatusTag>}
      footer={<>
        <Button disabled={saving} onClick={() => setConfirming(null)}>返回修改</Button>
        <Button variant="danger" loading={saving} onClick={() => void submit()}>安排生效</Button>
      </>}>
      <Facts>
        <Fact k="业务时区"><Change from={view.unified ? `${view.currentZoneLabel}（${view.currentOffset}）` : `${view.currentZoneLabel} / ${zoneLabel(growthZone ?? "")}`} to={`${selected.label}（${offsetOf(selected.zoneId)}）`} /></Fact>
        <Fact k="生效日">{effectiveDate}</Fact>
        {previewSwitch !== null && <Fact k="切换时刻">{stampOf(previewSwitch)}（{zoneText}）</Fact>}
        {previewDays.map(({ track, hours }) => <Fact key={track.key} k={`${track.name}的 ${previousDay(effectiveDate)}`} tone={hours !== 24 ? "warn" : undefined}>{hoursText(hours)}，{dayChange(hours)}</Fact>)}
        <Fact k="理由">{reason.trim()}</Fact>
      </Facts>
      <Notice tone="warn" title="影响全平台">从切换时刻起，所有用业务日历的模块（统计、每日结算、每周奖励池、月度榜单）按新时区切日；{previousDay(effectiveDate)} 及以前已结算的周期不变。生效前可以撤销。</Notice>
    </Modal>}

    {cancelOpen && pending && <Modal title="撤销这次时区安排" tone="danger" icon={CalendarX2} busy={saving} dirty={Boolean(cancelReason)} onClose={() => setCancelOpen(false)}
      sub={<StatusTag tone="progress" filled>立即生效</StatusTag>}
      footer={<>
        <Button disabled={saving} onClick={() => setCancelOpen(false)}>取消</Button>
        <Button variant="danger" loading={saving} disabledReason={cancelReason.trim().length < 8 || cancelReason.trim().length > 200 ? "撤销理由要写 8–200 字" : undefined} onClick={() => void cancel(pending)}>确认撤销</Button>
      </>}>
      {error && <Notice tone="danger" title="撤销没有成功">{error}</Notice>}
      <Facts>
        <Fact k="要撤销的安排">{pending.effectiveDate} 起改用{zoneLabel(pending.zoneId)}（{pending.offset}）</Fact>
        <Fact k="撤销后">现行时区不变，这条安排从版本记录里去掉</Fact>
      </Facts>
      <Field label="撤销理由" required hint="8–200 字">
        {(control) => <Textarea {...control} aria-label="撤销理由" value={cancelReason} maxLength={200} rows={2} count={`${cancelReason.trim().length}/200`} onChange={(event) => setCancelReason(event.target.value)} />}
      </Field>
    </Modal>}
  </div>;
}
