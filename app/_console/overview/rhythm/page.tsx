"use client";

/**
 * B4 运营阶段状态。先答「现在是哪个阶段、第几个月、下一步是什么」：一句结论和阶段线；
 * 再看用户按注册时长落在哪些阶段、这个月的八项参数和下个月要变的项、钱进得多还是出得多和本月预算；
 * 每月重点参数收进折叠，去别的页核查放在最后。这页只能查看，参数都到运营阶段设置去改。
 * 读取、导出、跳转运营阶段设置的请求和权限判断沿用改版前的写法，只换界面。
 */
import "./rhythm.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Ban, Download, Filter, Flag, RefreshCw, Target } from "lucide-react";
import {
  BlockState, Button, Conclusion, Explain, FilterBar, Fold, Notice, PageHeader, RdPage, Segments, Select, StatusTag,
} from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useToast } from "@/app/components/domain-views/design-kit";
import {
  exportB4Distribution,
  recordB4H1Jump,
  useB4PhaseOverview,
  type B4Filters,
} from "@/lib/admin/b4-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { fetchH1Phases } from "@/lib/admin/h-client";
import { DialsPanel, Distribution, StagePanel, nextMonthPhase, phaseRanges } from "./parts";
import { PhaseMoney } from "./money";

const ALL = "ALL";

/** 去别的页核查：后端给的四个去向，D3 那张保留 key B2。 */
const TARGET_NOTE: Record<string, string> = {
  B3: "用户转化概览",
  B1: "资金与应付款总览",
  B2: "资金储备与应付款",
};

/** 全页时间一种写法：2026-11-13 14:30（北京时间），和风险提醒一致。 */
const timeText = (value: string) => `${formatBusinessTimeCompact(value, "—")}（${businessZone().label}）`;

export default function RhythmPage() {
  const [filters, setFilters] = useState<B4Filters>({
    granularity: "PHASE",
    month: "",
    phase: ALL,
  });
  const [busy, setBusy] = useState<"export" | "jump" | "">("");
  // 界面状态：哪一次导出、跳转没有成功（B4-PD02：如实提示重试，不套结果未知的恢复流程），点的是哪一项。
  const [failure, setFailure] = useState<{ kind: "export" | "jump"; message: string; dial?: string } | null>(null);
  const [jumping, setJumping] = useState("");
  const [leverOpen, setLeverOpen] = useState(false);
  const [, setToast] = useToast();
  const session = useAdminAuth((state) => state.session);
  const { data, loading, error, reload } = useB4PhaseOverview(filters);
  const authorities = session?.authorities ?? [];
  const superAdmin = session?.role === "superadmin";
  const canExport = superAdmin || authorities.includes("overview_b4_export");
  const canCross = useReach();
  const canJump = (superAdmin || authorities.includes("overview_b4_jump")) && canCross("/growth/phase");
  const canReadNames = authorities.includes("growth_h1_read");
  const [phaseNames, setPhaseNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    setPhaseNames({});
    if (canReadNames) void fetchH1Phases().then((catalog) => {
      if (alive) setPhaseNames(Object.fromEntries(catalog.attribution.map((item) => [item.phase, item.name])));
    }).catch(() => { if (alive) setPhaseNames({}); }); // Optional catalog: B4 still works with phase codes.
    return () => { alive = false; };
  }, [canReadNames]);

  async function downloadDistribution() {
    if (!canExport || busy || loading || !data?.available || !data.distribution.length) return;
    setBusy("export");
    setFailure(null);
    try {
      const file = await exportB4Distribution(filters);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast("已导出，文件不含用户个人信息。", "success");
    } catch (value) {
      setFailure({ kind: "export", message: value instanceof Error ? displayAdminReadError(value) : "导出失败，请刷新后重试。" });
    } finally {
      setBusy("");
    }
  }

  async function openH1(dial: string) {
    if (!canJump || busy || loading || !data) return;
    setBusy("jump");
    setFailure(null);
    setJumping(dial);
    try {
      const phase = dial === "phaseAttribution" ? (filters.phase === ALL ? data.rhythm.currentPhase : filters.phase) : data.rhythm.currentPhase;
      const target = await recordB4H1Jump(dial, phase);
      window.location.assign(target.href);
    } catch (value) {
      setFailure({ kind: "jump", dial, message: value instanceof Error ? displayAdminReadError(value) : "跳转失败，请重试。" });
      setBusy("");
      setJumping("");
    }
  }

  const filtered = filters.phase !== ALL;
  const current = data?.rhythm.currentPhase;
  const exportBlocked = busy !== "" || loading || !data?.available || !data.distribution.length;
  const exportReason = !data ? (loading ? "正在读取各阶段人数" : "这页没有读到数据，先重试") : busy === "export" ? undefined
    : busy ? "正在打开运营阶段设置" : !data.available ? "还没有注册用户，没有可导出的人数" : !data.distribution.length ? "没有可导出的人数" : undefined;

  const header = (
    <PageHeader
      pageId="B4"
      title="运营阶段状态"
      summary="看当前运营阶段、用户分布和本月参数，只能查看。"
      meta={data ? (
        <span className="b4-meta">
          数据时间 {timeText(data.asOf)}
          <Explain label="数据从哪来、多久更新" rows={[
            { k: "来源", v: operatorCopyText(data.sourceStatement) },
            { k: "更新", v: "打开页面、换查看方式或阶段、点刷新时重读阶段和人数；钱的进出和预算只在打开页面时读一次，点刷新不重读。" },
            { k: "记录", v: "读取阶段和人数、导出、点进运营阶段设置会记一条操作记录，不改数据；钱的进出和在新标签页打开不记。" },
          ]} />
        </span>
      ) : undefined}
      readOnly={!canExport && !canJump ? "你只能查看；导出和去运营阶段设置需要对应权限。" : undefined}
      actions={<>
        <Button icon={<RefreshCw size={14} aria-hidden />} loading={loading} loadingText="正在读取…" onClick={() => void reload()}>刷新</Button>
        {canExport && (
          <Button icon={<Download size={14} aria-hidden />} loading={busy === "export"} loadingText="正在导出…"
            disabled={exportBlocked && busy === "export"}
            disabledReason={exportBlocked && busy !== "export" ? exportReason ?? "暂时不能导出" : undefined}
            onClick={() => void downloadDistribution()}>导出各阶段用户数</Button>
        )}
      </>}
    />
  );

  const failureNotice = failure && (
    <Notice tone="danger" title={failure.kind === "export" ? "没有导出成功" : "没有打开运营阶段设置"}
      action={<Button size="sm" disabled={busy !== ""}
        onClick={() => void (failure.kind === "export" ? downloadDistribution() : openH1(failure.dial ?? "phaseAttribution"))}>重试</Button>}>
      {failure.message.replace(/[。.]$/, "")}。可以直接重试，不会改任何数据。
    </Notice>
  );

  if (!data) {
    return (
      <RdPage className="rhythmpage">
        {header}
        {failureNotice}
        {error ? (
          <>
            <Conclusion state="unknown" icon={Flag}>运营阶段：读取失败，暂时无法判断</Conclusion>
            <BlockState state="error" title="运营阶段状态没有读到" detail={<>{error} 旧数据和导出已暂停。</>} onRetry={() => void reload()} />
          </>
        ) : (
          <>
            <Conclusion state="unknown" icon={Flag}>运营阶段：正在读取</Conclusion>
            <BlockState state="loading" title="正在读取运营阶段状态…" />
          </>
        )}
      </RdPage>
    );
  }

  // ---------- 结论 ----------
  const ranges = phaseRanges(data.monthDistribution);
  const { currentMonth, totalMonths } = data.rhythm;
  const last = data.nextPivot.atMonth == null;
  const nextPhase = nextMonthPhase(data.monthDistribution, currentMonth);
  const changes = data.nextPivot.changes.length;
  const hint = last
    ? "已是最后一个月，后面没有要切换的参数。"
    : `下个月${nextPhase && nextPhase !== current ? `进入 ${nextPhase}` : `还在 ${current}`}，${changes ? `${changes} 项参数会变` : "参数不变"}。`;

  const phaseOptions = [{ value: ALL, label: "全部阶段" }, ...data.filters.phaseOptions.map((phase) => ({ value: phase, label: phase === current ? `${phase}（当前阶段）` : phase }))];
  const monthValue = filters.month || String(data.filters.month);

  return (
    <RdPage className="rhythmpage">
      {header}
      {failureNotice}

      <Conclusion state="neutral" icon={Flag} hint={hint} explainTitle="这句话从哪来"
        explain="当前阶段、月份和进度都按运营阶段设置里的记录，和下面选的查看方式、阶段无关。月份不会自动往后切，到运营阶段设置里切换。">
        运营阶段：<b>{current}</b>，第 {currentMonth} 个月（共 {totalMonths} 个月）
      </Conclusion>

      <StagePanel data={data} ranges={ranges} nextPhase={nextPhase} phaseNames={phaseNames} />

      <FilterBar
        scope={<Segments label="查看方式" value={filters.granularity}
          onChange={(granularity) => setFilters((value) => ({ ...value, granularity }))}
          items={[{ value: "PHASE", label: "按运营阶段" }, { value: "MONTH", label: "按月" }]} />}
        onClear={filtered ? () => setFilters((value) => ({ ...value, phase: ALL })) : undefined}
        canClear
        clearLabel="看全部阶段"
        sort={<span className="b4-filter-end">
          {filtered && <StatusTag tone="progress" icon={Filter}>{filters.phase === current ? `正在看 ${filters.phase}，就是当前阶段` : `正在看 ${filters.phase}，当前阶段是 ${current}`}</StatusTag>}
          <Select aria-label="运营阶段" value={filters.phase} onChange={(phase) => setFilters((value) => ({ ...value, phase }))} options={phaseOptions} />
        </span>}
      />

      <Distribution data={data} ranges={ranges} phase={filters.phase} phaseNames={phaseNames} />

      <DialsPanel data={data} canJump={canJump} busy={busy} jumping={jumping} filteredPhase={filtered ? filters.phase : null}
        onJump={(dial) => { if (!busy) void openH1(dial); }} phaseNames={phaseNames} />

      <PhaseMoney />

      <Fold title={`第 ${data.filters.month} 个月的重点参数`} icon={Target} tone="role-4" open={leverOpen} onOpenChange={setLeverOpen}
        summary={`${data.monthLeverCombo.length} 项：${data.monthLeverCombo.map((lever) => lever.key).join("、")}`}
        explain="按这个月倍率大于 1 的加成、加强合规审查，再加固定的提现和结算两项，依次取前 3 项。用途是固定说明，不是效果统计，也不表示这个月实际改了这几项。">
        <div className="b4-lever">
          <label className="b4-lever-month">
            <span>看第几个月</span>
            <Select aria-label="查看月份" value={monthValue} onChange={(month) => setFilters((value) => ({ ...value, month }))}
              options={data.filters.monthOptions.map((month) => ({ value: String(month), label: month === currentMonth ? `第 ${month} 月（当前）` : `第 ${month} 月` }))} />
          </label>
          <ol className="b4-lever-list">
            {data.monthLeverCombo.map((lever) => (
              <li key={`${lever.key}-${lever.label}`}>
                <span className="b4-lever-key" title={lever.key}>{lever.key}</span>
                <b>{operatorCopyText(lever.label)}</b>
                <span className="b4-muted">{lever.purpose}</span>
                {lever.key === "提现" && <StatusTag tone="neutral" icon={Ban}>其中提现惩罚费率已退役，现在不收</StatusTag>}
              </li>
            ))}
          </ol>
        </div>
      </Fold>

      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {data.attributionLinks.map((item) => (
          item.key === "H1" ? (
            canJump && (
              <a key={item.key} href={item.href} className="rd-link" aria-disabled={busy !== ""}
                onClick={(event) => {
                  event.preventDefault();
                  if (!busy) void openH1("phaseAttribution");
                }}>
                {jumping === "phaseAttribution" ? "正在打开运营阶段设置…" : `运营阶段设置 · ${filtered ? `看 ${filters.phase} 的阶段归因` : "看阶段归因"}`}
              </a>
            )
          ) : canCross(item.href) ? (
            <Link key={item.key} href={item.href} className="rd-link" prefetch={false}>
              {item.key === "B3" ? `${TARGET_NOTE.B3} · 按${filtered ? ` ${filters.phase} ` : "全部阶段"}看` : TARGET_NOTE[item.key] ?? operatorCopyText(item.label)}
            </Link>
          ) : (
            <span key={item.key} aria-disabled="true">{TARGET_NOTE[item.key] ?? operatorCopyText(item.label)} · 无访问权限</span>
          )
        ))}
        <Explain label="相关页面是什么" content="这几页只给链接，这页不算效果。运营阶段设置的入口会先记一条跳转记录再打开；其余直接打开，不带这页的阶段之外的条件。" />
      </nav>
    </RdPage>
  );
}
