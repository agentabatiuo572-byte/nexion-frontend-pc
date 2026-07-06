/**
 * E6 · 算力与设备配置(server-canonical 聚合视图)。
 * 4 区块:电脑算力入口开关 / 在线加成系数 / 电脑显卡映射表(G1-G6) / 客户端下载配置。
 * 所有写入经 OperationConfirmModal,由 shell(e-view)统一落 A2 审计 + Idempotency-Key。
 *
 * 数据源:ctx.e6Config(后端 GET /api/admin/devices/compute-config 聚合视图),
 * 已含元数据 + 当前值,前端直接渲染,不再依赖本地 mock / pget 派生。
 * 写入:paramKey 由 e6-client 生成函数产出(与后端 ComputeConfigRegistry 1:1),
 * 值规则权威校验在后端 validateComputeValue。
 */
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";
import {
  e6FlagKey,
  e6CoeffKey,
  e6YieldKey,
  e6GpuTierKey,
  e6DownloadKey,
  type E6YieldView,
  type E6GpuTierView,
} from "@/lib/admin/e6-client";

const numberFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

// 显卡关键词固定 6 槽(keyword1..6),与后端 ComputeConfigRegistry.KEYWORD_SLOTS 一致。
const KEYWORD_SLOT_COUNT = 6;
const keywordField = (slotIndex: number): string => `keyword${slotIndex}`;

// 收益估算派生:从 yieldEstimate 视图按 key 取值,缺失/非法回落 fallback。
function yieldValue(yields: E6YieldView[], key: string, fallback: number): number {
  const next = Number(yields.find((y) => y.key === key)?.value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}
// tops → 日 USDT = (tops / 基准算力) × 基准日产。
function dailyUsdt(tops: number, yields: E6YieldView[]): number {
  const baseline = yieldValue(yields, "topsBaseline", 28);
  const daily = yieldValue(yields, "dailyUsdtPerBaseline", 0.06);
  return +((tops / baseline) * daily).toFixed(2);
}
// 日 USDT → 日 NEX = USDT × NEX 折算系数。
function dailyNex(usdt: number, yields: E6YieldView[]): number {
  return +(usdt * yieldValue(yields, "nexPerUsdt", 166.67)).toFixed(1);
}

export function E6ComputeConfig({ ctx }: { ctx: EViewCtx }) {
  const { e6Config, e6Loading, openActionConfirm } = ctx;
  const flags = e6Config?.flags ?? [];
  const coefficients = e6Config?.coefficients ?? [];
  const yields = e6Config?.yieldEstimate ?? [];
  const gpuTiers = e6Config?.gpuTiers ?? [];
  const download = e6Config?.download;
  const ready = !!e6Config; // 后端聚合视图已加载

  // 入口开关切换 → param-fixed on/off。
  const requestToggle = (key: string, label: string, current: boolean) => {
    const next = !current;
    openActionConfirm({
      name: `${next ? "开启" : "关闭"}${label}`,
      op: "param-fixed",
      paramKey: e6FlagKey(key),
      fixedVal: next ? "on" : "off",
      detail: `${next ? "开启" : "关闭"}「${label}」。确认后客户端会按新状态显示或隐藏对应入口;本操作需要填写理由并写入审计。`,
    });
  };

  // 在线系数调整 → param(number edit)。
  const editCoefficient = (c: (typeof coefficients)[number]) => {
    openActionConfirm({
      name: `${c.label}调整`,
      op: "param",
      paramKey: e6CoeffKey(c.key),
      edit: { kind: "number", current: c.value, unit: c.unit },
      detail: `${c.label}: ${c.desc} 调整后对后续结算生效,不回溯已结算收益。${c.frontendEffect}`,
    });
  };

  // 收益估算系数调整 → param(number edit)。
  const editYield = (p: (typeof yields)[number]) => {
    openActionConfirm({
      name: `${p.label}调整`,
      op: "param",
      paramKey: e6YieldKey(p.key),
      edit: { kind: "number", current: p.value, unit: p.unit },
      detail: `${p.label}用于电脑显卡收益估算展示。调整后影响后台与客户端下一次估算,不回溯已结算收益。`,
    });
  };

  // 显卡档位(label + tops)→ param-multi。
  const editTier = (tier: E6GpuTierView) => {
    openActionConfirm({
      name: `${tier.label}档位设置`,
      op: "param-multi",
      paramKeys: [
        { key: "label", paramKey: e6GpuTierKey(tier.id, "label") },
        { key: "tops", paramKey: e6GpuTierKey(tier.id, "tops") },
      ],
      businessForm: {
        kind: "multi-field",
        title: "编辑显卡档位",
        hint: "档位名称用于后台和客户端展示;TOPS 用于客户端估算每日产出。关键词在表格中逐个新增、修改或删除。",
        fields: [
          { key: "label", label: "档位展示名称", current: tier.label, inputKind: "text", wide: true },
          { key: "tops", label: "算力 TOPS", current: tier.tops, inputKind: "number", min: 0, step: 1 },
        ],
      },
      detail: `调整「${tier.label}」的展示名称与算力标尺。确认后同一档位的客户端收益估算会按新 TOPS 派生。`,
    });
  };

  // 关键词编辑/新增 → param(text edit)。slotIndex 为 1-based 槽位号(按后端返回顺序映射)。
  const editKeyword = (tier: E6GpuTierView, slotIndex: number, current = "") => {
    openActionConfirm({
      name: current ? `修改${tier.label}识别词` : `新增${tier.label}识别词`,
      op: "param",
      paramKey: e6GpuTierKey(tier.id, keywordField(slotIndex)),
      edit: { kind: "text", current, unit: "单个显卡型号关键词" },
      detail: `每次只编辑一个识别词,不要把多个型号塞进同一输入框。客户端按识别词把电脑显卡映射到「${tier.label}」。`,
    });
  };

  // 关键词删除 → param-fixed 空串。
  const deleteKeyword = (tier: E6GpuTierView, slotIndex: number, current: string) => {
    openActionConfirm({
      name: `删除${tier.label}识别词`,
      op: "param-fixed",
      paramKey: e6GpuTierKey(tier.id, keywordField(slotIndex)),
      fixedVal: "",
      detail: `删除识别词「${current}」。删除后该词不再把电脑显卡映射到「${tier.label}」;本操作写入审计。`,
    });
  };

  // 下载地址编辑/清空。
  const editDownloadUrl = () => {
    const current = (download?.url ?? "").trim();
    openActionConfirm({
      name: current ? "修改客户端下载地址" : "填写客户端下载地址",
      op: "param",
      paramKey: e6DownloadKey("url"),
      edit: { kind: "text", current, unit: "HTTPS 下载地址" },
      detail: "配置电脑客户端的真实下载地址。留空状态下客户端展示「即将开放」,不会复制占位链接。",
    });
  };
  const clearDownloadUrl = () => {
    openActionConfirm({
      name: "清空客户端下载地址",
      op: "param-fixed",
      paramKey: e6DownloadKey("url"),
      fixedVal: "",
      detail: "清空后客户端回到「即将开放」状态,不会向前台展示假下载链接。",
    });
  };

  // 下载页双语文案 → param-multi(中英标题/说明 4 字段)。
  const editDownloadCopy = () => {
    const dl = download ?? { url: "", zhTitle: "", zhGuide: "", enTitle: "", enGuide: "" };
    openActionConfirm({
      name: "编辑下载页双语文案",
      op: "param-multi",
      paramKeys: [
        { key: "zhTitle", paramKey: e6DownloadKey("zhTitle") },
        { key: "zhGuide", paramKey: e6DownloadKey("zhGuide") },
        { key: "enTitle", paramKey: e6DownloadKey("enTitle") },
        { key: "enGuide", paramKey: e6DownloadKey("enGuide") },
      ],
      businessForm: {
        kind: "multi-field",
        title: "下载页双语内容",
        hint: "四个字段分别编辑,禁止把中英文或多段内容塞进同一个输入框。",
        fields: [
          { key: "zhTitle", label: "中文标题", current: dl.zhTitle, inputKind: "text", wide: true },
          { key: "zhGuide", label: "中文说明", current: dl.zhGuide, inputKind: "text", wide: true },
          { key: "enTitle", label: "英文标题", current: dl.enTitle, inputKind: "text", wide: true },
          { key: "enGuide", label: "英文说明", current: dl.enGuide, inputKind: "text", wide: true },
        ],
      },
      detail: "编辑客户端下载页的中文与英文内容。确认后写入配置审计,前台按语言分别读取。",
    });
  };

  const onCount = flags.filter((f) => f.enabled).length;
  const downloadUrl = (download?.url ?? "").trim();
  const keywordCount = gpuTiers.reduce((sum, t) => sum + t.keywords.length, 0);
  const coeffValueByLabel = (labelToken: string): string => {
    const c = coefficients.find((item) => item.label.includes(labelToken));
    return c ? c.value : "—";
  };

  return (
    <div>
      <EStats items={[
        { k: "入口开关", v: flags.length, sub: e6Loading ? "加载中" : `${onCount} 个开启`, tone: "cyan" },
        { k: "显卡档位", v: gpuTiers.length, sub: `${keywordCount} 个识别词`, tone: "ok" },
        { k: "下载地址", v: downloadUrl ? "已填写" : "待开放", sub: downloadUrl ? "客户端可复制真实地址" : "前台显示即将开放", tone: downloadUrl ? "ok" : "" },
        { k: "在线系数", v: coefficients.length, sub: "H5 / App 稳定性", tone: "cyan" },
      ]} />

      <section className="pane">
        <div className="pane-h">
          <span className="ttl">电脑算力入口开关</span>
          <span className="sub">切换需理由 + A2 审计</span>
          <span className="r"><CodeTag tone="electric">客户端联动</CodeTag></span>
        </div>
        {flags.map((f) => {
          const on = f.enabled;
          return (
            <div className="e6-flag-row" key={f.key}>
              <div className="e6-flag-meta">
                <span className="e6-flag-name">{f.label}</span>
                <span className="e6-flag-desc"><AutoGloss>{f.desc}</AutoGloss></span>
              </div>
              <div className="e6-flag-ctl">
                <span className="e6-flag-state" style={{ color: on ? "var(--success)" : "var(--ink-4)" }}>
                  {ready ? (on ? "已开启" : "已关闭") : "—"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${f.label}:${on ? "已开启,点击关闭" : "已关闭,点击开启"}`}
                  className="e6-switch"
                  data-on={on}
                  data-proof="e6-flag-toggle"
                  onClick={() => requestToggle(f.key, f.label, on)}
                >
                  <span className="e6-switch-knob" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
        <div className="tint cyan tiny" style={{ margin: "0 16px 14px" }}>
          <AutoGloss>默认关闭。开启后客户端出现电脑算力弱入口和下载页;关闭后入口、下载页和历史电脑设备都会从可见槽位中退出。</AutoGloss>
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }}>
        <div className="pane-h">
          <span className="ttl">在线加成系数</span>
          <span className="sub">调整后只影响后续结算</span>
          <span className="r"><CodeTag>可审计调参</CodeTag></span>
        </div>
        {coefficients.map((c) => (
          <div className="pkv" key={c.key}>
            <div className="lhs">
              <span className="zh">{c.label}</span>
              <span className="desc"><AutoGloss>{c.desc}</AutoGloss></span>
            </div>
            <span className="v">{ready ? c.value : "—"}<span className="u">{c.unit}</span></span>
            <button type="button" className="adj" data-proof={`e6-coeff-${c.key}`} onClick={() => editCoefficient(c)}>调整</button>
          </div>
        ))}
        <div className="tint cyan tiny" data-proof="e6-h5-app-impact" style={{ margin: "12px 16px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <b>H5 基础托管</b> · 当前 {coeffValueByLabel("基础托管")} 倍。网页登录只拿保守基线,页面关闭后仍按账户托管结算,不吃连续在线加成。
            </div>
            <div>
              <b>App 在线加成</b> · 当前满额时长 {coeffValueByLabel("满额时长")} 小时。App 连续在线达到该时长后爬满在线收益,用于承接 H5 升级动机。
            </div>
          </div>
        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px 14px" }}>
          <AutoGloss>H5 基础托管系数决定网页登录态的保守产出;连续在线满额时长决定 App 稳定性加成爬满需要多久。两个值都不回溯已结算收益。</AutoGloss>
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-gpu-tier-table">
        <div className="pane-h">
          <span className="ttl">电脑显卡映射表</span>
          <span className="sub">档位可改;识别词可新增、修改、删除</span>
          <span className="r"><CodeTag>六档显卡</CodeTag><CodeTag>单词一格</CodeTag></span>
        </div>
        <div className="tint cyan tiny" style={{ margin: "12px 16px 0" }}>
          <AutoGloss>以下参数用于把显卡算力换算成每日 USDT / NEX 估算,全部后台可调。</AutoGloss>
        </div>
        <div data-proof="e6-yield-estimate-params" style={{ margin: "0 16px 14px" }}>
          {yields.map((p) => (
            <div className="pkv" key={p.key}>
              <div className="lhs">
                <span className="zh">{p.label}</span>
              </div>
              <span className="v">{ready ? p.value : "—"}<span className="u">{p.unit}</span></span>
              <button type="button" className="adj" onClick={() => editYield(p)}>调整</button>
            </div>
          ))}
        </div>
        <div className="e6-gpu-table">
          {gpuTiers.map((tier, index) => {
            // 关键词槽位映射:后端按 keyword1..6 顺序读非空返回数组,前端按显示索引回映射槽位。
            // 新增落到首个空闲槽位(keywords.length+1);删除/编辑按当前显示位置取槽位。
            const nextSlotIndex = tier.keywords.length + 1;
            const canAdd = nextSlotIndex <= KEYWORD_SLOT_COUNT;
            const topsNum = Number(tier.tops) || 0;
            const dailyUsdtValue = dailyUsdt(topsNum, yields);
            return (
              <div className="e6-gpu-row" key={tier.id}>
                <div className="e6-tier-main">
                  <div className="e6-tier-head">
                    <span className="e6-tier-badge">第 {numberFmt.format(index + 1)} 档</span>
                    <span className="e6-tier-name">{tier.label}</span>
                  </div>
                  <span className="e6-tier-desc"><AutoGloss>{tier.desc}</AutoGloss></span>
                  <span className="e6-tier-model">默认型号: {tier.defaultModel}</span>
                </div>
                <div className="e6-tier-yield">
                  <span><b>{numberFmt.format(topsNum)}</b> TOPS</span>
                  <span>约 ${dailyUsdtValue.toFixed(2)} / 日</span>
                  <span>约 {numberFmt.format(dailyNex(dailyUsdtValue, yields))} NEX / 日</span>
                </div>
                <div className="e6-keyword-wrap">
                  {tier.keywords.map((kw, i) => (
                    <span className="e6-keyword-chip" key={`${tier.id}-${i + 1}`}>
                      <span>{kw}</span>
                      <button type="button" onClick={() => editKeyword(tier, i + 1, kw)}>改</button>
                      <button type="button" className="danger" onClick={() => deleteKeyword(tier, i + 1, kw)}>删</button>
                    </span>
                  ))}
                  {canAdd ? (
                    <button type="button" className="e6-inline-add" onClick={() => editKeyword(tier, nextSlotIndex)}>新增识别词</button>
                  ) : (
                    <span className="e6-slot-full">识别词槽位已满</span>
                  )}
                </div>
                <div className="e6-row-actions">
                  <button type="button" className="adj" onClick={() => editTier(tier)}>编辑档位</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="pane" style={{ marginTop: 14 }} data-proof="e6-download-config">
        <div className="pane-h">
          <span className="ttl">客户端下载配置</span>
          <span className="sub">地址与双语内容分别编辑</span>
          <span className="r"><CodeTag>前台空态保护</CodeTag></span>
        </div>
        <div className="e6-download-box">
          <div className="e6-download-url">
            <span className="k">客户端下载地址</span>
            <span className={downloadUrl ? "v" : "v muted"}>{downloadUrl || "暂未填写 · 客户端显示即将开放"}</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="adj" onClick={editDownloadUrl}>{downloadUrl ? "修改地址" : "填写地址"}</button>
              <button type="button" className="adj" onClick={clearDownloadUrl} disabled={!downloadUrl}>清空地址</button>
            </div>
          </div>
          <div className="e6-copy-grid">
            <div>
              <span className="k">中文标题</span>
              <span className="v">{download?.zhTitle ?? ""}</span>
            </div>
            <div>
              <span className="k">英文标题</span>
              <span className="v">{download?.enTitle ?? ""}</span>
            </div>
            <div>
              <span className="k">中文说明</span>
              <span className="v">{download?.zhGuide ?? ""}</span>
            </div>
            <div>
              <span className="k">英文说明</span>
              <span className="v">{download?.enGuide ?? ""}</span>
            </div>
          </div>
          <button type="button" className="adj" onClick={editDownloadCopy}>编辑双语文案</button>
        </div>
      </section>

      <p className="f-foot">
        <b>前后台一致</b>:<AutoGloss>本页维护电脑算力的入口开关、在线系数、显卡映射和下载内容。所有改动都走操作确认和审计;客户端读取服务端配置后生效。</AutoGloss>
      </p>
    </div>
  );
}
