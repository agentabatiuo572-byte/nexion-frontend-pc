"use client";

/**
 * E 批小图形件样例。上半页是每个组件的各种状态，下半页是按设计方向拼的四页小样。
 * 数都是写死的，取后端真能给出的形状（任务池四个等级、设备概览四个数、手机五档、商品目录）。
 */
import "./gallery.css";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, CircleCheck, Layers, ListChecks, MonitorSmartphone, Package, PackageX, Smartphone, TriangleAlert } from "lucide-react";
import {
  Button, Cell, Conclusion, Explain, InlineRetry, LevelStrip, MoreMenu, PageHeader, Panel, RatioBar, RdPage, ScaleBar, StageLine, Stat, StatBand,
  StatusDistributionBar, StatusTag, StepBar, Table, TaskClassTag, Td, Th, Tr, useTabIds, levelTone, type Level, type TaskClass,
} from "@/app/components/rd";
import { useTheme } from "@/app/components/rd/theme-switch";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { TASK_CLASSES } from "@/lib/admin/task-classes";

const LEVELS: readonly Level[] = [
  { key: "L1", label: "L1", name: "初级" }, { key: "L2", label: "L2", name: "中级" },
  { key: "L3", label: "L3", name: "高级" }, { key: "L4", label: "L4", name: "旗舰" },
];
const TIERS: readonly Level[] = ["T1", "T2", "T3", "T4", "T5"].map((key) => ({ key, label: key }));
const MINUTES = [{ value: 0, text: "0" }, { value: 60, text: "60" }, { value: 120, text: "120" }];

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return <figure className="gx-demo"><figcaption>{title}</figcaption>{children}</figure>;
}

/* ── E2：四张等级卡。这一段就是 README「等级卡」的排法 ── */
interface Pool { code: string; name: string; enabled: number; total: number; avg: string | null; perDay: string | null; products: readonly [number, number, number] }
const POOLS: readonly Pool[] = [
  { code: "L1", name: "初级", enabled: 18, total: 20, avg: "22.5", perDay: "64.0", products: [3, 1, 0] },
  { code: "L2", name: "中级", enabled: 12, total: 20, avg: "47.0", perDay: "30.6", products: [2, 0, 1] },
  { code: "L3", name: "高级", enabled: 0, total: 16, avg: null, perDay: null, products: [1, 0, 0] },
  { code: "L4", name: "旗舰", enabled: 9, total: 9, avg: "96.5", perDay: "14.9", products: [0, 0, 0] },
];

function LevelCards() {
  const [current, setCurrent] = useState("L2");
  const ids = useTabIds();
  const codes = POOLS.map((pool) => pool.code);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabValue(codes, current, event.key);
    if (next === null) return;
    event.preventDefault();
    setCurrent(next);
    document.getElementById(ids.tab(next))?.focus();
  };
  const pool = POOLS.find((item) => item.code === current) ?? POOLS[0];
  return (
    <>
      <StatBand cards role="tablist" label="任务等级">
        {POOLS.map((item) => {
          const [published, draft, delisted] = item.products;
          const used = published + draft + delisted > 0;
          return (
            <Stat
              key={item.code}
              head={<>{item.code} {item.name}<LevelStrip variant="mini" quiet label="等级位置" levels={LEVELS} selectedKeys={[item.code]} /></>}
              label="启用任务" value={String(item.enabled)} unit="个" sub={`共 ${item.total} 个`} tone="role-2"
              surface={item.enabled === 0 ? "warn" : undefined}
              selected={item.code === current} selectedText="当前等级"
              onOpen={() => setCurrent(item.code)}
              openLabel={`${item.code} ${item.name}，启用 ${item.enabled} 个，共 ${item.total} 个${item.code === current ? "，当前等级" : ""}`}
              role="tab" id={ids.tab(item.code)} aria-selected={item.code === current} aria-controls={ids.panelId(current)}
              tabIndex={item.code === current ? 0 : -1} onKeyDown={onKeyDown}
            >
              {item.enabled === 0
                ? <span className="gx-warn-line"><StatusTag tone="warn" icon={TriangleAlert}>没有启用的任务</StatusTag></span>
                : <RatioBar quiet label="启用占比" value={item.enabled} total={item.total} valueText={`启用 ${item.enabled} 个，共 ${item.total} 个`} tone="role-2" />}
              <dl className="rd-stat-rows">
                <div className="rd-stat-row">
                  <dt>平均时长{item.avg === null && <Explain label="平均时长为什么是空的" content="没有启用任务，无法计算。" />}</dt>
                  <dd data-empty={item.avg === null ? "" : undefined}>{item.avg === null ? "—" : `${item.avg} 分钟`}</dd>
                </div>
                {item.avg !== null && <ScaleBar quiet label="平均时长" valueText={`${item.avg} 分钟，刻度 0 到 120 分钟`} max={120} value={Number(item.avg)} ticks={MINUTES} tone="role-2" />}
                <div className="rd-stat-row">
                  <dt>约每天单数</dt>
                  <dd data-empty={item.perDay === null ? "" : undefined}>{item.perDay === null ? "—" : `约 ${item.perDay} 单/台/天`}</dd>
                </div>
              </dl>
              <dl className="rd-stat-rows">
                <div className="rd-stat-row" data-stack="">
                  <dt>使用它的商品{used && <Explain label={`${item.code} ${item.name}被哪些商品使用`} rows={[{ k: "已发布", v: "Nexion Box S1、Nexion Pro V2" }, { k: "草稿", v: "Rack P1" }]} />}</dt>
                  <dd data-empty={used ? undefined : ""}>
                    {used
                      ? <span className="gx-products"><span data-zero={published ? undefined : ""}>已发布 <b>{published}</b></span><span className="gx-sep">·</span><span data-zero={draft ? undefined : ""}>草稿 <b>{draft}</b></span><span className="gx-sep">·</span><span data-zero={delisted ? undefined : ""}>已下架有设备 <b>{delisted}</b></span></span>
                      : "还没有商品使用"}
                  </dd>
                </div>
              </dl>
            </Stat>
          );
        })}
      </StatBand>
      <Panel {...ids.panel(current)} title={`${pool.code} ${pool.name}任务`} sub={`共 ${pool.total} 个`} flush actions={<Button variant="primary" size="sm">随机添加任务</Button>}>
        <Table label={`${pool.code} ${pool.name}任务`}>
          <thead><tr><Th>任务名称</Th><Th>类型</Th><Th align="right">时长</Th><Th>状态</Th></tr></thead>
          <tbody>
            {TASK_ROWS.map((row) => (
              <Tr key={row.name}>
                <Td grow><Cell main={row.name} title={row.name} /></Td>
                <Td><TaskClassTag taskClass={row.taskClass} /></Td>
                <Td align="right"><Cell num main={`${row.minutes} 分钟`} sub={<RatioBar compact quiet label="时长" value={row.minutes} total={120} valueText={`${row.minutes} 分钟，上限 120 分钟`} tone="role-2" />} /></Td>
                <Td><StatusTag tone={row.enabled ? "ok" : "done"}>{row.enabled ? "已启用" : "已停用"}</StatusTag></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

const TASK_ROWS: readonly { name: string; taskClass: TaskClass; minutes: number; enabled: boolean }[] = [
  { name: "Multilingual sentence embedding batch 2048", taskClass: "EM", minutes: 18, enabled: true },
  { name: "Call-center audio transcription zh-vi", taskClass: "SP", minutes: 35, enabled: true },
  { name: "SDXL product render 1024px x 40", taskClass: "IG", minutes: 52, enabled: true },
  { name: "LLM inference 13B chat completion", taskClass: "LL", minutes: 75, enabled: false },
  { name: "LoRA fine-tune retail intent classifier", taskClass: "FT", minutes: 110, enabled: true },
  { name: "Short video generation 6s 720p", taskClass: "VG", minutes: 120, enabled: true },
];

/* ── E5：分布条加设备表 ── */
const DEVICES = [
  { name: "Nexion Box S1", no: "DEV-20261018-00412", user: "Minh Tran", userNo: "U100283", status: <StatusTag tone="ok">运行中</StatusTag>, credited: "312.40", value: 312.4, low: 405, high: 495, task: { taskClass: "LL" as TaskClass, elapsed: 23, total: 45, left: "距应完成 22 分钟" } },
  { name: "Nexion Pro V2", no: "DEV-20260930-00087", user: "Lan Pham", userNo: "U100117", status: <StatusTag tone="ok">运行中</StatusTag>, credited: "512.75", value: 512.75, low: 405, high: 495, task: { taskClass: "IG" as TaskClass, elapsed: 50, total: 52, left: "距应完成 2 分钟" } },
  { name: "Rack P1", no: "DEV-20261102-00631", user: "Quang Vo", userNo: "U100455", status: <StatusTag tone="danger" explain="上游节点超时。下次自动重试 14:32，系统每 30 秒自动重试。">出错重试中</StatusTag>, credited: "0.00", value: 0, low: 1180, high: 1420, task: null },
];

function DeviceBoard() {
  const [filter, setFilter] = useState<string | null>("running");
  const toggle = (key: string) => () => setFilter((now) => (now === key ? null : key));
  return (
    <>
      <Conclusion state="neutral">35 台商城设备，9 台运行中，11 台等待启动</Conclusion>
      <StatBand label="商城设备概览">
        <Stat icon={MonitorSmartphone} tone="role-2" label="设备总数" value="35" unit="台" onOpen={() => setFilter(null)} openLabel="设备总数 35 台，清除状态筛选" />
        <Stat icon={ListChecks} tone="ok" label="运行中" value="9" unit="台" selected={filter === "running"} selectedText="已筛选" onOpen={toggle("running")} aria-pressed={filter === "running"} openLabel="运行中 9 台，按它筛选" />
        <Stat icon={Layers} tone="progress" label="等待启动" value="11" unit="台" explain="含待激活、等待初始化、旧任务未结清。" />
        <Stat icon={Box} tone="done" label="已停用" value="6" unit="台" selected={filter === "stopped"} selectedText="已筛选" onOpen={toggle("stopped")} aria-pressed={filter === "stopped"} openLabel="已停用 6 台，按它筛选" />
      </StatBand>
      <Panel title="状态分布" explain="总数不等于前三类之和：其他包含等待配置、已暂停、停用中、已解绑、出错重试中、模拟任务已关闭。这四个数不随筛选变。">
        <StatusDistributionBar label="商城设备状态分布" selectedKey={filter} segments={[
          { key: "running", label: "运行中", value: 9, text: "9 台", tone: "ok", onSelect: toggle("running") },
          { key: "waiting", label: "等待启动", value: 11, text: "11 台", tone: "progress" },
          { key: "stopped", label: "已停用", value: 6, text: "6 台", tone: "done", onSelect: toggle("stopped") },
          { key: "other", label: "其他", value: 9, text: "9 台", tone: "role-other" },
        ]} />
      </Panel>
      <Panel title="商城设备" sub="共 35 台" flush>
        <Table label="商城设备">
          <thead><tr><Th>设备</Th><Th>用户</Th><Th>状态</Th><Th align="right">本月收益（USDT）</Th><Th>当前任务</Th><Th sticky="end">操作</Th></tr></thead>
          <tbody>
            {DEVICES.map((device) => (
              <Tr key={device.no}>
                <Td><Cell main={device.name} sub={<span data-mono>{device.no}</span>} /></Td>
                <Td><Cell main={device.user} sub={device.userNo} /></Td>
                <Td>{device.status}</Td>
                <Td align="right">
                  <Cell num main={device.credited} sub={(
                    <span className="gx-cell-line">
                      预估 {device.low.toLocaleString("en-US")}–{device.high.toLocaleString("en-US")}
                      <ScaleBar compact quiet label="本月收益" valueText={`已到账 ${device.credited} USDT，预估 ${device.low} 到 ${device.high} USDT`} max={Math.max(device.high, device.value)} value={device.value} fill range={{ low: device.low, high: device.high }} tone="role-2" />
                    </span>
                  )} />
                </Td>
                <Td>
                  {device.task
                    ? <Cell main={<TaskClassTag taskClass={device.task.taskClass} />} sub={<span className="gx-cell-line"><RatioBar compact quiet label="当前任务的时间位置" value={device.task.elapsed} total={device.task.total} valueText={`已过 ${device.task.elapsed} 分钟，共 ${device.task.total} 分钟`} tone="progress" />{device.task.left}</span>} />
                    : <span className="rd-weak">—</span>}
                </Td>
                <Td sticky="end"><MoreMenu items={[{ key: "off", label: "取消激活", onSelect: () => undefined }, { key: "unbind", label: "解绑", danger: true, onSelect: () => undefined }]} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

/* ── E6：五档阶梯和分界轴 ── */
const PHONE_TIERS = [
  { key: "T1", name: "入门", value: 0.12, valueText: "0.12", uvt: "4.0" },
  { key: "T2", name: "基础", value: 0.2, valueText: "0.20", uvt: "6.5" },
  { key: "T3", name: "标准", value: 0.36, valueText: "0.36", uvt: "12.5" },
  { key: "T4", name: "进阶", value: 0.52, valueText: "0.52", uvt: "18.0" },
  { key: "T5", name: "旗舰", value: 0.8, valueText: "0.80", uvt: "27.5" },
];
const tierItems = (tiers: typeof PHONE_TIERS, withActions: boolean) => tiers.map((tier) => ({
  key: tier.key, label: tier.key, name: tier.name, value: tier.value, valueText: tier.valueText, secondary: `${tier.uvt} UVT/天`,
  mark: tier.key === "T3" ? "当前引导档" : undefined,
  actions: withActions ? <><Button size="sm">调 USDT</Button><Button size="sm">调 UVT</Button></> : undefined,
}));
const boundary = (marks: readonly string[]) => ({ labels: ["T1", "T2", "T3", "T4", "T5"], openEnd: true, marks: marks.map((text) => ({ value: Number(text), text })) });
const boundaryText = (m: readonly string[]) => `T1 低于 ${m[0]}；T2 ${m[0]} 到 ${m[1]}；T3 ${m[1]} 到 ${m[2]}；T4 ${m[2]} 到 ${m[3]}；T5 ${m[3]} 及以上`;
const NOW = ["1.200", "2.500", "4.800", "8.000"];
const NEXT = ["1.200", "2.800", "5.200", "9.500"];

/* ── E1：商品卡 ── */
const PRODUCTS = [
  { name: "Nexion Box S1", sku: "box-s1", tier: "入门档", price: "299.00", levels: ["L1", "L2"], target: { text: "45.00", value: 45, low: 40.5, high: 49.5, lowText: "40.50", highText: "49.50", band: "±10%" }, stock: { sold: 38, left: 62 }, room: "Singapore SG-2", status: <StatusTag tone="neutral" icon={CircleCheck}>在售</StatusTag> },
  { name: "Nexion Pro V2", sku: "pro-v2", tier: "进阶档", price: "1,299.00", levels: ["L2", "L3", "L4"], target: { text: "210.00", value: 210, low: 147, high: 273, lowText: "147.00", highText: "273.00", band: "±30%" }, stock: { sold: 412, left: 0 }, room: "Ho Chi Minh HCM-1", status: <StatusTag tone="neutral" icon={CircleCheck}>在售</StatusTag> },
  { name: "Compute Share", sku: "share-01", tier: "份额", price: "50.00", levels: [] as string[], target: null, stock: null, room: null, status: <StatusTag tone="warn" explain="还没有选任务等级，至少选一个等级才能上架。">上架受阻</StatusTag> },
];

export function Gallery() {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>("running");
  return (
    <div className="gx-theme" data-theme={theme}>
      <RdPage>
        <PageHeader title="E 批图形件样例" summary="只在开发时用。上面是每个组件的各种状态，下面是四页的小样。" />

        <Panel title="等级色阶" sub="level-1…level-4，五档 level-1…level-5">
          <div className="gx-grid" data-wide="">
            <Demo title="四档：商城任务等级 L1–L4">
              <div className="gx-swatches">{LEVELS.map((level, index) => <span key={level.key}><i data-fill={levelTone(index)} />{level.label} {level.name}</span>)}</div>
            </Demo>
            <Demo title="五档：手机档位 T1–T5">
              <div className="gx-swatches" data-levels="5">{TIERS.map((tier, index) => <span key={tier.key}><i data-fill={levelTone(index)} />{tier.label}</span>)}</div>
            </Demo>
          </div>
        </Panel>

        <Panel title="LevelStrip 等级条">
          <div className="gx-grid">
            <Demo title="选了两级"><LevelStrip label="任务等级" levels={LEVELS} selectedKeys={["L1", "L2"]} /></Demo>
            <Demo title="隔着选"><LevelStrip label="任务等级" levels={LEVELS} selectedKeys={["L2", "L4"]} /></Demo>
            <Demo title="全选"><LevelStrip label="任务等级" levels={LEVELS} selectedKeys={["L1", "L2", "L3", "L4"]} /></Demo>
            <Demo title="一个都没选，页面在旁边写一句"><LevelStrip label="任务等级" levels={LEVELS} selectedKeys={[]} /><span className="rd-gfx-note">未配置任务等级</span></Demo>
            <Demo title="五格"><LevelStrip label="手机档位" levels={TIERS} selectedKeys={["T3", "T4", "T5"]} /></Demo>
            <Demo title="mini：卡头，等级名写在旁边">
              <div className="gx-line">{LEVELS.map((level) => <span key={level.key} className="gx-pair"><b className="rd-stat-head" style={{ margin: 0 }}>{level.label} {level.name}</b><LevelStrip variant="mini" quiet label="等级位置" levels={LEVELS} selectedKeys={[level.key]} /></span>)}</div>
            </Demo>
            <Demo title="读取中"><LevelStrip state="loading" label="任务等级" levels={LEVELS} selectedKeys={[]} /></Demo>
            <Demo title="读失败"><LevelStrip state="failed" failedText={<>任务等级读取失败 <InlineRetry onRetry={() => undefined} /></>} label="任务等级" levels={LEVELS} selectedKeys={[]} /></Demo>
            <Demo title="数不合法：等级码不认识"><LevelStrip label="任务等级" levels={LEVELS} selectedKeys={["L7"]} invalidText="等级码 L7 不在四个固定等级里" /></Demo>
          </div>
          <div className="gx-grid" data-full="" style={{ marginTop: 24 }}>
            <Demo title="够宽（340 起）时 L 号后面写等级名"><LevelStrip label="任务等级" levels={LEVELS} selectedKeys={["L1", "L2", "L3"]} /></Demo>
          </div>
        </Panel>

        <Panel title="RatioBar 比例条">
          <div className="gx-grid">
            <Demo title="12 / 20"><RatioBar label="启用占比" value={12} total={20} valueText="启用 12 个，共 20 个" /></Demo>
            <Demo title="0 / 20：不画主段"><RatioBar label="启用占比" value={0} total={20} valueText="启用 0 个，共 20 个" /></Demo>
            <Demo title="20 / 20：整条上色"><RatioBar label="启用占比" value={20} total={20} valueText="启用 20 个，共 20 个" /></Demo>
            <Demo title="3 / 2,000：很小的一段"><RatioBar label="已售和剩余" value={3} total={2000} valueText="已售 3 件，剩余 1,997 件" /></Demo>
            <Demo title="拦截占命中：6 / 40，注意色"><RatioBar label="命中里被拦截的占比" value={6} total={40} valueText="命中 40 次，拦截 6 次" tone="warn" /></Demo>
            <Demo title="超长数字：1,284,560 / 2,147,483,647"><RatioBar label="已售和剩余" value={1284560} total={2147483647} valueText="已售 1,284,560 件，剩余 2,146,199,087 件" /></Demo>
            <Demo title="steps：3 / 6、0 / 6、6 / 6">
              <div className="gx-line">
                <span className="gx-pair"><RatioBar steps label="激活名额" value={3} total={6} valueText="已激活 3 台，上限 6 台（含手机）" />3/6</span>
                <span className="gx-pair"><RatioBar steps label="激活名额" value={0} total={6} valueText="已激活 0 台，上限 6 台（含手机）" />0/6</span>
                <span className="gx-pair"><RatioBar steps label="激活名额" value={6} total={6} valueText="已激活 6 台，上限 6 台（含手机）" />6/6</span>
              </div>
            </Demo>
            <Demo title="compact：表格一格里，和辅助字一行">
              <div className="gx-line">
                <span className="gx-pair"><RatioBar compact label="时间位置" value={23} total={45} valueText="已过 23 分钟，共 45 分钟" tone="progress" />距应完成 22 分钟</span>
                <span className="gx-pair"><RatioBar compact label="时长" value={75} total={120} valueText="75 分钟，上限 120 分钟" />75 分钟</span>
              </div>
            </Demo>
            <Demo title="读取中"><RatioBar state="loading" label="启用占比" value={0} total={0} valueText="" /></Demo>
            <Demo title="空：0 / 0"><RatioBar state="empty" emptyText="还没有任务" label="启用占比" value={0} total={0} valueText="" /></Demo>
            <Demo title="读失败"><RatioBar state="failed" label="启用占比" value={0} total={0} valueText="" /></Demo>
            <Demo title="数不合法：7 / 6，不画成满格"><RatioBar steps label="激活名额" value={7} total={6} valueText="" invalidText="已激活 7 台，超过上限 6 台，不能再激活" /></Demo>
          </div>
        </Panel>

        <Panel title="ScaleBar 刻度条">
          <div className="gx-grid">
            <Demo title="一个值：平均 75.0 分钟，刻度 0–120"><ScaleBar label="平均时长" valueText="75.0 分钟，刻度 0 到 120 分钟" max={120} value={75} ticks={MINUTES} /></Demo>
            <Demo title="值在起点：0"><ScaleBar label="平均时长" valueText="0 分钟，刻度 0 到 120 分钟" max={120} value={0} ticks={MINUTES} /></Demo>
            <Demo title="值在终点：120"><ScaleBar label="平均时长" valueText="120 分钟，刻度 0 到 120 分钟" max={120} value={120} ticks={MINUTES} /></Demo>
            <Demo title="值对区间：到账 312.40，预估 405–495"><ScaleBar label="本月收益" valueText="已到账 312.40 USDT，预估 405.00 到 495.00 USDT" max={495} value={312.4} fill range={{ low: 405, high: 495 }} /></Demo>
            <Demo title="值落在区间里：到账 451.20"><ScaleBar label="本月收益" valueText="已到账 451.20 USDT，预估 405.00 到 495.00 USDT" max={495} value={451.2} fill range={{ low: 405, high: 495 }} /></Demo>
            <Demo title="值超过区间：页面把轴扩到 512.75"><ScaleBar label="本月收益" valueText="已到账 512.75 USDT，预估 405.00 到 495.00 USDT" max={512.75} value={512.75} fill range={{ low: 405, high: 495 }} /></Demo>
            <Demo title="区间两端相等：一条刻线"><ScaleBar label="本月收益" valueText="已到账 120.00 USDT，预估 300.00 USDT" max={300} value={120} fill range={{ low: 300, high: 300 }} /></Demo>
            <Demo title="目标和波动：450.00 ±10%"><ScaleBar label="月收益目标" valueText="目标 450.00 USDT/月，范围 405.00 到 495.00" max={495} target={450} range={{ low: 405, high: 495 }} tone="neutral" /></Demo>
            <Demo title="目标和波动：450.00 ±50%"><ScaleBar label="月收益目标" valueText="目标 450.00 USDT/月，范围 225.00 到 675.00" max={675} target={450} range={{ low: 225, high: 675 }} tone="neutral" /></Demo>
            <Demo title="值是 0：点是空心的"><ScaleBar label="本月收益" valueText="已到账 0.00 USDT，预估 405.00 到 495.00 USDT" max={495} value={0} fill range={{ low: 405, high: 495 }} /></Demo>
            <Demo title="compact：表格一格里，120 宽">
              <span className="gx-pair"><ScaleBar compact label="本月收益" valueText="已到账 312.40 USDT，预估 405 到 495 USDT" max={495} value={312.4} fill range={{ low: 405, high: 495 }} />还没到区间：312.40</span>
              <span className="gx-pair"><ScaleBar compact label="本月收益" valueText="已到账 451.20 USDT，预估 405 到 495 USDT" max={495} value={451.2} fill range={{ low: 405, high: 495 }} />在区间里：451.20</span>
              <span className="gx-pair"><ScaleBar compact label="本月收益" valueText="已到账 512.75 USDT，预估 405 到 495 USDT" max={512.75} value={512.75} fill range={{ low: 405, high: 495 }} />超过上限：512.75</span>
              <span className="gx-pair"><ScaleBar compact label="本月收益" valueText="已到账 0.00 USDT，预估 405 到 495 USDT" max={495} value={0} fill range={{ low: 405, high: 495 }} />还是 0：0.00</span>
              <span className="gx-pair"><ScaleBar compact state="loading" label="本月收益" valueText="" max={495} />读取中</span>
            </Demo>
            <Demo title="读取中"><ScaleBar state="loading" label="平均时长" valueText="" max={120} /></Demo>
            <Demo title="空：没有启用任务"><ScaleBar state="empty" emptyText="没有启用任务，无法计算" label="平均时长" valueText="" max={120} /></Demo>
            <Demo title="读失败"><ScaleBar state="failed" failedText="任务节奏暂不可读" label="平均时长" valueText="" max={120} /></Demo>
            <Demo title="数不合法：135 分钟超过 120 的轴"><ScaleBar label="平均时长" valueText="" max={120} value={135} ticks={MINUTES} invalidText="平均时长 135 分钟超过上限 120 分钟，等后端核对" /></Demo>
            <Demo title="数不合法：区间反序"><ScaleBar label="本月收益" valueText="" max={495} range={{ low: 495, high: 405 }} invalidText="预估区间上下限反了" /></Demo>
          </div>
          <div className="gx-stack" style={{ marginTop: 24 }}>
            <div className="gx-two">
              <Demo title="分界：四个分界分成 T1–T5，T5 没有上限"><ScaleBar label="档位分界" valueText={boundaryText(NOW)} max={8} bands={boundary(NOW)} /></Demo>
              <Demo title="分界挨得近：后一个换到第二行，再近的不写"><ScaleBar label="档位分界" valueText={boundaryText(["0.800", "1.050", "1.300", "8.000"])} max={8} bands={boundary(["0.800", "1.050", "1.300", "8.000"])} /></Demo>
              <Demo title="读取中"><ScaleBar state="loading" label="档位分界" valueText="" max={8} bands={boundary(NOW)} /></Demo>
              <Demo title="数不合法：分界不是从小到大"><ScaleBar label="档位分界" valueText="" max={8} bands={boundary(["1.200", "4.800", "2.500", "8.000"])} invalidText="分界要从小到大：T3/T4 分界小于 T2/T3 分界" /></Demo>
            </div>
          </div>
        </Panel>

        <Panel title="StatusDistributionBar 状态分布条">
          <div className="gx-grid" data-wide="">
            <Demo title="能点的类和选中（点图例或段）">
              <StatusDistributionBar label="商城设备状态分布" selectedKey={picked} segments={[
                { key: "running", label: "运行中", value: 9, text: "9 台", tone: "ok", onSelect: () => setPicked(picked === "running" ? null : "running") },
                { key: "waiting", label: "等待启动", value: 11, text: "11 台", tone: "neutral" },
                { key: "stopped", label: "已停用", value: 6, text: "6 台", tone: "done", onSelect: () => setPicked(picked === "stopped" ? null : "stopped") },
                { key: "other", label: "其他", value: 9, text: "9 台", tone: "role-other" },
              ]} />
            </Demo>
            <Demo title="有一类是 0：不画段，留在图例里">
              <StatusDistributionBar label="商城设备状态分布" segments={[
                { key: "running", label: "运行中", value: 24, text: "24 台", tone: "ok" }, { key: "waiting", label: "等待启动", value: 0, text: "0 台", tone: "neutral" },
                { key: "stopped", label: "已停用", value: 3, text: "3 台", tone: "done" }, { key: "other", label: "其他", value: 1, text: "1 台", tone: "role-other" },
              ]} />
            </Demo>
            <Demo title="只有一类不是 0：退成一句话">
              <StatusDistributionBar label="商城设备状态分布" segments={[
                { key: "running", label: "运行中", value: 12, text: "12 台", tone: "ok", onSelect: () => undefined }, { key: "waiting", label: "等待启动", value: 0, text: "0 台", tone: "neutral" },
                { key: "stopped", label: "已停用", value: 0, text: "0 台", tone: "done", onSelect: () => undefined }, { key: "other", label: "其他", value: 0, text: "0 台", tone: "role-other" },
              ]} />
            </Demo>
            <Demo title="超长数字">
              <StatusDistributionBar label="商城设备状态分布" segments={[
                { key: "running", label: "运行中", value: 128456, text: "128,456 台", tone: "ok" }, { key: "waiting", label: "等待启动", value: 20312, text: "20,312 台", tone: "neutral" },
                { key: "stopped", label: "已停用", value: 96004, text: "96,004 台", tone: "done" }, { key: "other", label: "其他", value: 1207, text: "1,207 台", tone: "role-other" },
              ]} />
            </Demo>
            <Demo title="读取中"><StatusDistributionBar state="loading" label="商城设备状态分布" segments={[]} /></Demo>
            <Demo title="全是 0"><StatusDistributionBar emptyText="暂无商城设备" label="商城设备状态分布" segments={[{ key: "running", label: "运行中", value: 0, text: "0 台", tone: "ok" }]} /></Demo>
            <Demo title="读失败"><StatusDistributionBar state="failed" failedText={<>状态分布暂时无法核对 <InlineRetry onRetry={() => undefined} /></>} label="商城设备状态分布" segments={[]} /></Demo>
            <Demo title="数不合法：其他算出来是负数"><StatusDistributionBar label="商城设备状态分布" invalidText="四个数对不上（其他为 −2 台），等后端核对" segments={[{ key: "running", label: "运行中", value: 9, text: "9 台", tone: "ok" }, { key: "other", label: "其他", value: -2, text: "−2 台", tone: "role-other" }]} /></Demo>
          </div>
        </Panel>

        <Panel title="TaskClassTag 任务类型标签">
          <div className="gx-line">{TASK_CLASSES.map((taskClass) => <TaskClassTag key={taskClass} taskClass={taskClass} />)}</div>
        </Panel>

        <Panel title="StepBar 阶梯条">
          <div className="gx-grid" data-full="">
            <Demo title="五档，带标记和按钮"><StepBar label="五档每日收益" unit="USDT/天" items={tierItems(PHONE_TIERS, true)} /></Demo>
            <Demo title="值相等就同高（T2 和 T3 相等），有一档是 0，只读没有按钮">
              <StepBar label="五档每日收益" unit="USDT/天" items={tierItems(PHONE_TIERS.map((tier) => (tier.key === "T1" ? { ...tier, value: 0, valueText: "0.00" } : tier.key === "T2" ? { ...tier, value: 0.36, valueText: "0.36" } : tier)), false)} />
            </Demo>
            <Demo title="超长数字：提早折成三列，数字不缩不折">
              <StepBar label="五档每日收益" unit="USDT/天" items={tierItems(PHONE_TIERS.map((tier) => ({ ...tier, value: tier.value * 10000, valueText: `${(tier.value * 10000).toLocaleString("en-US")}.123456`, uvt: "1,250,000.5" })), true)} />
            </Demo>
            <Demo title="读取中"><StepBar state="loading" label="五档每日收益" items={[]} /></Demo>
            <Demo title="读失败"><StepBar state="failed" failedText="档位收益数据不完整，暂不能调整" label="五档每日收益" items={[]} /></Demo>
          </div>
        </Panel>

        <Panel title="StageLine 阶段线">
          <div className="gx-grid" data-full="">
            <Demo title="四个阶段，当前在第二个"><StageLine label="开放阶段" currentId="p2" stages={[{ id: "p1", label: "启动期" }, { id: "p2", label: "增长期", sub: "运营第 7 个月" }, { id: "p3", label: "成熟期" }, { id: "p4", label: "扩张期" }]} /></Demo>
            <Demo title="阶段多：这一块里横向滚动，当前阶段滚进可见范围"><StageLine label="开放阶段" currentId="s9" stages={Array.from({ length: 12 }, (_, index) => ({ id: `s${index + 1}`, label: `第 ${index + 1} 阶段`, sub: index === 8 ? "运营第 21 个月" : undefined }))} /></Demo>
            <Demo title="当前阶段对不上：整条不高亮，页面在旁边写一句"><StageLine label="开放阶段" currentId="unknown" stages={[{ id: "p1", label: "启动期" }, { id: "p2", label: "增长期" }, { id: "p3", label: "成熟期" }]} /><span className="rd-gfx-note">当前阶段待核实</span></Demo>
          </div>
          <div className="gx-grid" style={{ marginTop: 24 }}>
            <Demo title="只有一个阶段：不画连线"><StageLine label="开放阶段" currentId="p1" stages={[{ id: "p1", label: "启动期", sub: "运营第 0 个月" }]} /></Demo>
            <Demo title="读取中"><StageLine state="loading" label="开放阶段" stages={[]} /></Demo>
            <Demo title="空"><StageLine emptyText="尚未配置阶段" label="开放阶段" stages={[]} /></Demo>
            <Demo title="读失败"><StageLine state="failed" failedText="阶段读取失败" label="开放阶段" stages={[]} /></Demo>
          </div>
        </Panel>

        <Panel plain title="小样 E2 任务池：四张等级卡（可选择的 Stat）加选中等级的任务" />
        <Conclusion state="warn">L3 高级没有启用的任务，1 个商品的设备之后接不到新任务</Conclusion>
        <LevelCards />
        <StatBand cards label="等级卡的读取中和读失败">
          <Stat head={<>L1 初级<LevelStrip variant="mini" state="loading" label="等级位置" levels={LEVELS} selectedKeys={[]} /></>} label="启用任务" value={<span className="rd-skeleton" style={{ width: 72, height: 20, marginTop: 6 }} />}>
            <RatioBar state="loading" label="启用占比" value={0} total={0} valueText="" />
          </Stat>
          <Stat head="L2 中级" label="启用任务" value="—" sub="读取失败">
            <RatioBar state="failed" failedText={<>任务等级暂时读不到 <InlineRetry onRetry={() => undefined} /></>} label="启用占比" value={0} total={0} valueText="" />
          </Stat>
          <Stat head={<>L3 高级<LevelStrip variant="mini" quiet label="等级位置" levels={LEVELS} selectedKeys={["L3"]} /></>} label="启用任务" value="1,284" unit="个" sub="共 2,000 个" tone="role-2">
            <RatioBar quiet label="启用占比" value={1284} total={2000} valueText="启用 1,284 个，共 2,000 个" tone="role-2" />
          </Stat>
          <Stat head={<>L4 旗舰<LevelStrip variant="mini" quiet label="等级位置" levels={LEVELS} selectedKeys={["L4"]} /></>} label="启用任务" value="0" unit="个" sub="共 0 个">
            <RatioBar state="empty" emptyText="还没有任务" label="启用占比" value={0} total={0} valueText="" />
          </Stat>
        </StatBand>

        <Panel plain title="小样 E5 设备管理：四个数、分布条、设备表的一行" />
        <DeviceBoard />

        <Panel plain title="小样 E6 手机算力配置：五档阶梯和分界轴" />
        <Conclusion state="ok">五档收益已配置，引导使用 T3 档</Conclusion>
        <Panel title="五档每日收益" icon={Smartphone} tone="role-1" sub="USDT/天" explain="柱高只按每天的 USDT。UVT 是另一种币，不进柱高。">
          <StepBar label="五档每日收益" unit="USDT/天" items={tierItems(PHONE_TIERS, true)} />
        </Panel>
        <Panel title="档位分界" sub="平台算力值" explain="分界左闭右开：算力值等于分界时归到高的一档。T5 没有上限。">
          <div className="gx-stack">
            <div className="gx-two">
              <div><div className="gx-axis-title"><b>当前</b>第 7 版</div><ScaleBar label="当前档位分界" valueText={boundaryText(NOW)} max={9.5} bands={boundary(NOW)} /></div>
              <div><div className="gx-axis-title"><b>预约</b>第 8 版 · 2026-11-15 08:00 生效</div><ScaleBar label="预约档位分界" valueText={boundaryText(NEXT)} max={9.5} bands={boundary(NEXT)} /></div>
            </div>
          </div>
        </Panel>

        <Panel plain title="小样 E1 商品管理：商品卡" />
        <Panel title="开放阶段" sub="运营第 7 个月">
          <StageLine label="开放阶段" currentId="p2" stages={[{ id: "p1", label: "启动期" }, { id: "p2", label: "增长期" }, { id: "p3", label: "成熟期" }, { id: "p4", label: "扩张期" }]} />
        </Panel>
        <div className="gx-cards">
          {PRODUCTS.map((product) => (
            <article key={product.sku} className="gx-card">
              <div className="gx-card-top">
                <span className="gx-thumb"><Package size={28} strokeWidth={1.5} aria-hidden /></span>
                <div>
                  <div className="gx-card-name">{product.name}{product.status}</div>
                  <div className="gx-card-meta"><span data-mono>{product.sku}</span><span>{product.tier}</span></div>
                  <div className="gx-price">{product.price}<span>USD</span></div>
                </div>
              </div>
              <div className="gx-block">
                <div className="gx-block-head"><span>任务等级</span></div>
                <LevelStrip label="任务等级" levels={LEVELS} selectedKeys={product.levels} />
                {product.levels.length === 0 && <span className="rd-gfx-note" data-kind="problem"><TriangleAlert size={13} strokeWidth={1.9} aria-hidden /><span>未配置任务等级</span></span>}
              </div>
              <div className="gx-block">
                <div className="gx-block-head"><span>月收益目标</span>{product.target ? <b>{product.target.text}<span>USDT/月</span></b> : <span>未设月收益目标</span>}</div>
                {product.target && (
                  <>
                    <ScaleBar quiet label="月收益目标" valueText={`目标 ${product.target.text} USDT/月，范围 ${product.target.lowText} 到 ${product.target.highText}`} max={product.target.high} target={product.target.value} range={{ low: product.target.low, high: product.target.high }} tone="neutral" />
                    <span className="gx-block-note">{product.target.lowText} – {product.target.highText} · {product.target.band}</span>
                  </>
                )}
              </div>
              <div className="gx-block">
                <div className="gx-block-head"><span>库存</span>{product.stock ? (product.stock.left === 0 ? <StatusTag tone="warn" icon={PackageX}>售罄</StatusTag> : null) : <span>不限（非实物）</span>}</div>
                {product.stock && (
                  <>
                    <RatioBar quiet label="已售和剩余" value={product.stock.sold} total={product.stock.sold + product.stock.left} valueText={`已售 ${product.stock.sold} 件，剩余 ${product.stock.left} 件`} tone="role-2" />
                    <span className="gx-block-note">已售 {product.stock.sold} · 剩余 {product.stock.left}</span>
                  </>
                )}
              </div>
              <div className="gx-card-foot">
                <Button size="sm">改价 / 编辑</Button>
                <Button size="sm">{product.levels.length ? "下架" : "上架"}</Button>
                <span className="gx-block-note">{product.room ? `托管 ${product.room}` : "托管 — · 未填写"}</span>
              </div>
            </article>
          ))}
        </div>
      </RdPage>
    </div>
  );
}
