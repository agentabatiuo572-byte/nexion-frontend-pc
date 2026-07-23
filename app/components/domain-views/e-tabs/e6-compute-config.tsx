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

// 收益估算只使用服务端返回的正数；缺失或非法时显式展示不可用。
function yieldValue(yields: E6YieldView[], key: string): number | null {
  const next = Number(yields.find((y) => y.key === key)?.value);
  return Number.isFinite(next) && next > 0 ? next : null;
}
// tops → 日 USDT = (tops / 基准算力) × 基准日产。
function dailyUsdt(tops: number | null, yields: E6YieldView[]): number | null {
  const baseline = yieldValue(yields, "topsBaseline");
  const daily = yieldValue(yields, "dailyUsdtPerBaseline");
  if (tops == null || !(tops > 0) || baseline == null || daily == null) return null;
  return +((tops / baseline) * daily).toFixed(2);
}
// 日 USDT → 日 NEX = USDT × NEX 折算系数。
function dailyNex(usdt: number | null, yields: E6YieldView[]): number | null {
  const rate = yieldValue(yields, "nexPerUsdt");
  return usdt == null || rate == null ? null : +(usdt * rate).toFixed(1);
}

function firstFreeKeywordSlot(keywords: E6GpuTierView["keywords"]): string | null {
  const occupied = new Set(keywords.map((keyword) => keyword.slot));
  for (let index = 1; index <= KEYWORD_SLOT_COUNT; index += 1) {
    const slot = keywordField(index);
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export function E6ComputeConfig({ ctx }: { ctx: EViewCtx }) {
  const {
    canWriteE6, canToggleE6, e6Config, e6Loading, e6Error, refreshE6, openActionConfirm,
  } = ctx;
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
      detail: `${next ? "开启" : "关闭"}「${label}」。批准后保存服务端开关并同步用户端配置缓存;PC 载体入口与下载页显隐属于后续 SPEC,当前不会出现新入口。`,
    });
  };

  // 在线系数调整 → param(number edit)。
  const editCoefficient = (c: (typeof coefficients)[number]) => {
    openActionConfirm({
      name: `${c.label}调整`,
      op: "param",
      paramKey: e6CoeffKey(c.key),
      edit: {
        kind: "number", current: c.value, unit: c.unit,
        min: Number.MIN_VALUE, max: c.key === "h5BaseFactor" ? 1 : undefined,
        disallowCurrent: true,
      },
      detail: `${c.label}: ${c.desc} 调整后对后续结算生效,不回溯已结算收益。${c.frontendEffect}`,
    });
  };

  // 收益估算系数调整 → param(number edit)。
  const editYield = (p: (typeof yields)[number]) => {
    openActionConfirm({
      name: `${p.label}调整`,
      op: "param",
      paramKey: e6YieldKey(p.key),
      edit: { kind: "number", current: p.value, unit: p.unit, min: Number.MIN_VALUE, disallowCurrent: true },
      detail: `${p.label}用于本页电脑显卡收益预览,并供后续 PC 载体 SPEC 读取;不回溯已结算收益。`,
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
        hint: "档位名称与 TOPS 用于本页预览,并为后续 PC 载体 SPEC 提供服务端配置。关键词在表格中逐个新增、修改或删除。",
        fields: [
          { key: "label", label: "档位展示名称", current: tier.label, inputKind: "text", wide: true, required: true },
          { key: "tops", label: "算力 TOPS", current: tier.tops, inputKind: "number", min: Number.MIN_VALUE, step: 1, required: true },
        ],
      },
      detail: `调整「${tier.label}」的展示名称与算力标尺。批准后本页按新 TOPS 预览;后续 PC 载体 SPEC 可读取同一配置。`,
    });
  };

  // 关键词编辑/新增按后端返回的真实 slot 定位，不用压缩后的显示下标回写。
  const editKeyword = (tier: E6GpuTierView, slot: string, current = "") => {
    openActionConfirm({
      name: current ? `修改${tier.label}识别词` : `新增${tier.label}识别词`,
      op: "param",
      paramKey: e6GpuTierKey(tier.id, slot),
      edit: { kind: "text", current, unit: "单个显卡型号关键词", disallowCurrent: true },
      detail: `每次只编辑一个识别词,不要把多个型号塞进同一输入框。该映射供后续 PC 载体 SPEC 使用,当前用户端没有显卡识别入口。`,
    });
  };

  // 关键词删除 → param-fixed 空串。
  const deleteKeyword = (tier: E6GpuTierView, slot: string, current: string) => {
    openActionConfirm({
      name: `删除${tier.label}识别词`,
      op: "param-fixed",
      paramKey: e6GpuTierKey(tier.id, slot),
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
      edit: { kind: "text", current, unit: "HTTPS 下载地址", disallowCurrent: true },
      detail: "为后续 PC 载体 SPEC 预置真实下载地址。留空不会产生占位链接,当前用户端没有下载入口。",
    });
  };
  const clearDownloadUrl = () => {
    openActionConfirm({
      name: "清空客户端下载地址",
      op: "param-fixed",
      paramKey: e6DownloadKey("url"),
      fixedVal: "",
      detail: "清空后服务端保持未配置状态,不会向当前用户端或后续载体提供假下载链接。",
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

  if (e6Loading && !e6Config) {
    return <section className="pane"><div className="empty">正在读取服务端 E6 配置...</div></section>;
  }
  if (e6Error) {
    return (
      <section className="pane" data-proof="e6-load-error">
        <div className="empty">E6 配置读取失败:{e6Error}</div>
        <div className="row" style={{ justifyContent: "center", paddingBottom: 16 }}>
          <button type="button" className="adj" onClick={() => void refreshE6()}>重新加载</button>
        </div>
      </section>
    );
  }
  if (!e6Config) {
    return <section className="pane"><div className="empty">服务端尚未返回 E6 配置，当前不显示可操作控件。</div></section>;
  }

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
        { k: "下载地址", v: downloadUrl ? "已填写" : "未配置", sub: downloadUrl ? "服务端已保存真实地址" : "不会生成占位链接", tone: downloadUrl ? "ok" : "" },
        { k: "在线系数", v: coefficients.length, sub: "H5 / App 稳定性", tone: "cyan" },
      ]} />

      <section className="pane">
        <div className="pane-h">
          <span className="ttl">电脑算力入口开关</span>
          <span className="sub">切换需理由 + A2 审计</span>
          <span className="r"><CodeTag tone="electric">服务端配置</CodeTag></span>
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
                {canToggleE6 && <button
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
                </button>}
              </div>
            </div>
          );
        })}
        <div className="tint cyan tiny" style={{ margin: "0 16px 14px" }}>
          <AutoGloss>此处保存服务端开关并同步用户端配置缓存。PC 载体入口与下载页显隐属于后续 SPEC,当前不会出现新入口;历史设备也不会因切换开关而被隐藏或删除。</AutoGloss>
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
            {canWriteE6 && <button type="button" className="adj" data-proof={`e6-coeff-${c.key}`} onClick={() => editCoefficient(c)}>调整</button>}
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
              {canWriteE6 && <button type="button" className="adj" onClick={() => editYield(p)}>调整</button>}
            </div>
          ))}
        </div>
        <div className="e6-gpu-table">
          {gpuTiers.map((tier, index) => {
            const nextSlot = firstFreeKeywordSlot(tier.keywords);
            const topsCandidate = Number(tier.tops);
            const topsNum = Number.isFinite(topsCandidate) && topsCandidate > 0 ? topsCandidate : null;
            const dailyUsdtValue = dailyUsdt(topsNum, yields);
            const dailyNexValue = dailyNex(dailyUsdtValue, yields);
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
                  <span><b>{topsNum == null ? "—" : numberFmt.format(topsNum)}</b> TOPS</span>
                  <span>{dailyUsdtValue == null ? "收益参数不可用" : `约 $${dailyUsdtValue.toFixed(2)} / 日`}</span>
                  <span>{dailyNexValue == null ? "NEX 折算不可用" : `约 ${numberFmt.format(dailyNexValue)} NEX / 日`}</span>
                </div>
                <div className="e6-keyword-wrap">
                  {tier.keywords.map((kw) => (
                    <span className="e6-keyword-chip" key={`${tier.id}-${kw.slot}`}>
                      <span>{kw.value}</span>
                      {canWriteE6 && <button type="button" onClick={() => editKeyword(tier, kw.slot, kw.value)}>改</button>}
                      {canWriteE6 && <button type="button" className="danger" onClick={() => deleteKeyword(tier, kw.slot, kw.value)}>删</button>}
                    </span>
                  ))}
                  {canWriteE6 && nextSlot ? (
                    <button type="button" className="e6-inline-add" onClick={() => editKeyword(tier, nextSlot)}>新增识别词</button>
                  ) : canWriteE6 ? (
                    <span className="e6-slot-full">识别词槽位已满</span>
                  ) : null}
                </div>
                <div className="e6-row-actions">
                  {canWriteE6 && <button type="button" className="adj" onClick={() => editTier(tier)}>编辑档位</button>}
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
          <span className="r"><CodeTag>后续 SPEC 预置</CodeTag></span>
        </div>
        <div className="e6-download-box">
          <div className="e6-download-url">
            <span className="k">客户端下载地址</span>
            <span className={downloadUrl ? "v" : "v muted"}>{downloadUrl || "暂未填写 · 当前用户端无下载入口"}</span>
            {canWriteE6 && <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="adj" onClick={editDownloadUrl}>{downloadUrl ? "修改地址" : "填写地址"}</button>
              <button type="button" className="adj" onClick={clearDownloadUrl} disabled={!downloadUrl}>清空地址</button>
            </div>}
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
          {canWriteE6 && <button type="button" className="adj" onClick={editDownloadCopy}>编辑双语文案</button>}
        </div>
      </section>

      <p className="f-foot">
        <b>配置边界</b>:<AutoGloss>本页维护服务端入口开关、在线系数、显卡映射和下载内容,所有改动都进入 A2 待确认并留审计。App/H5 每 60 秒刷新公共配置缓存;PC 载体入口与下载页属于后续 SPEC,当前不会出现新入口。</AutoGloss>
      </p>
    </div>
  );
}
