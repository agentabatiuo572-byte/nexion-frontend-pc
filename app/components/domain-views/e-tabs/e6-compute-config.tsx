/**
 * E6 · 算力与设备配置。
 * SPEC-2: 电脑算力入口开关、在线系数、显卡档位映射、客户端下载内容。
 * 所有写入都经 OperationConfirmModal,由 shell 统一落 A2 审计。
 */
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";
import { EStats } from "./stats";
import {
  COMPUTE_COEFFICIENTS,
  COMPUTE_DOWNLOAD_CONTENT,
  COMPUTE_FLAGS,
  COMPUTE_GPU_KEYWORD_SLOTS,
  COMPUTE_GPU_TIERS,
  COMPUTE_YIELD_ESTIMATE,
  computeCoeffParamKey,
  computeDownloadParamKey,
  computeFlagParamKey,
  computeGpuTierParamKey,
  computeYieldEstimateParamKey,
  type ComputeCoefficientDef,
  type ComputeFlagDef,
  type ComputeGpuTierDef,
  type ComputeGpuTierField,
  type ComputeYieldEstimateDef,
} from "@/lib/mock/admin/compute-config";

const numberFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

type Pget = EViewCtx["pget"];

function paramOrDefault(pget: Pget, key: string, fallback: string): string {
  const value = pget(key);
  return value == null ? fallback : value;
}

function numericParamOrDefault(pget: Pget, key: string, fallback: number): number {
  const next = Number(pget(key));
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function yieldEstimateValue(pget: Pget, p: ComputeYieldEstimateDef): number {
  return numericParamOrDefault(pget, computeYieldEstimateParamKey(p.key), p.defaultVal);
}

function dailyUsdt(tops: number, pget: Pget): number {
  const baseline = yieldEstimateValue(pget, COMPUTE_YIELD_ESTIMATE.find((p) => p.key === "topsBaseline")!);
  const daily = yieldEstimateValue(pget, COMPUTE_YIELD_ESTIMATE.find((p) => p.key === "dailyUsdtPerBaseline")!);
  return +((tops / baseline) * daily).toFixed(2);
}

function dailyNex(usdt: number, pget: Pget): number {
  const nexPerUsdt = yieldEstimateValue(pget, COMPUTE_YIELD_ESTIMATE.find((p) => p.key === "nexPerUsdt")!);
  return +(usdt * nexPerUsdt).toFixed(1);
}

function keywordSlot(tier: ComputeGpuTierDef, field: ComputeGpuTierField, pget: Pget) {
  const index = COMPUTE_GPU_KEYWORD_SLOTS.indexOf(field as (typeof COMPUTE_GPU_KEYWORD_SLOTS)[number]);
  const value = paramOrDefault(pget, computeGpuTierParamKey(tier.id, field), tier.keywords[index] ?? "");
  return { field, value: value.trim() };
}

function tierView(tier: ComputeGpuTierDef, pget: Pget) {
  const label = paramOrDefault(pget, computeGpuTierParamKey(tier.id, "label"), tier.label).trim() || tier.label;
  const tops = numericParamOrDefault(pget, computeGpuTierParamKey(tier.id, "tops"), tier.defaultTops);
  const slots = COMPUTE_GPU_KEYWORD_SLOTS.map((field) => keywordSlot(tier, field, pget));
  const keywords = slots.filter((slot) => slot.value.length > 0);
  return { label, tops, slots, keywords };
}

function downloadValue(pget: Pget, field: keyof typeof COMPUTE_DOWNLOAD_CONTENT): string {
  const spec = COMPUTE_DOWNLOAD_CONTENT[field];
  return paramOrDefault(pget, computeDownloadParamKey(field), spec.defaultVal);
}

function tierTopsBounds(tier: ComputeGpuTierDef, pget: Pget): { gt?: number; lt?: number } {
  const index = COMPUTE_GPU_TIERS.findIndex((item) => item.id === tier.id);
  const prev = index > 0 ? tierView(COMPUTE_GPU_TIERS[index - 1], pget).tops : undefined;
  const next = index >= 0 && index < COMPUTE_GPU_TIERS.length - 1 ? tierView(COMPUTE_GPU_TIERS[index + 1], pget).tops : undefined;
  return { gt: prev ?? 0, lt: next };
}

export function E6ComputeConfig({ ctx }: { ctx: EViewCtx }) {
  const { pget, hydrated, openActionConfirm } = ctx;

  const flagOn = (f: ComputeFlagDef): boolean => {
    const value = pget(computeFlagParamKey(f.key));
    return value ? value === "on" : f.defaultOn;
  };

  const coeffValue = (c: ComputeCoefficientDef): string =>
    String(pget(computeCoeffParamKey(c.key)) ?? c.defaultVal);

  const coeffValueByLabel = (labelToken: string): string => {
    const coeff = COMPUTE_COEFFICIENTS.find((item) => item.label.includes(labelToken));
    return coeff ? coeffValue(coeff) : "—";
  };

  const requestToggle = (f: ComputeFlagDef, current: boolean) => {
    const next = !current;
    openActionConfirm({
      name: `${next ? "开启" : "关闭"}${f.label}`,
      op: "param-fixed",
      paramKey: computeFlagParamKey(f.key),
      fixedVal: next ? "on" : "off",
      detail: `${next ? "开启" : "关闭"}「${f.label}」。确认后客户端会按新状态显示或隐藏对应入口;本操作需要填写理由并写入审计。`,
    });
  };

  const editCoefficient = (c: ComputeCoefficientDef) => {
    const isRatio = c.unit.includes("0–1");
    openActionConfirm({
      name: `${c.label}调整`,
      op: "param",
      paramKey: computeCoeffParamKey(c.key),
      edit: { kind: "number", current: coeffValue(c), unit: c.unit, min: isRatio ? 0 : undefined, gt: isRatio ? undefined : 0, max: isRatio ? 1 : undefined },
      detail: `${c.label}: ${c.desc} 调整后对后续结算生效,不回溯已结算收益。${c.frontendEffect}`,
    });
  };

  const editYieldEstimate = (p: ComputeYieldEstimateDef) => {
    openActionConfirm({
      name: `${p.label}调整`,
      op: "param",
      paramKey: computeYieldEstimateParamKey(p.key),
      edit: { kind: "number", current: String(yieldEstimateValue(pget, p)), unit: p.unit, gt: 0 },
      detail: `${p.label}用于电脑显卡收益估算展示。调整后影响后台与客户端下一次估算,不回溯已结算收益。`,
    });
  };

  const editTier = (tier: ComputeGpuTierDef) => {
    const view = tierView(tier, pget);
    const bounds = tierTopsBounds(tier, pget);
    openActionConfirm({
      name: `${view.label}档位设置`,
      op: "param-multi",
      paramKeys: [
        { key: "label", paramKey: computeGpuTierParamKey(tier.id, "label") },
        { key: "tops", paramKey: computeGpuTierParamKey(tier.id, "tops") },
      ],
      businessForm: {
        kind: "multi-field",
        title: "编辑显卡档位",
        hint: "档位名称用于后台和客户端展示;TOPS 用于客户端估算每日产出。关键词在表格中逐个新增、修改或删除。",
        fields: [
          { key: "label", label: "档位展示名称", current: view.label, placeholder: tier.label, inputKind: "text", wide: true, maxLength: 24 },
          { key: "tops", label: "算力 TOPS", current: String(view.tops), placeholder: String(tier.defaultTops), inputKind: "number", gt: bounds.gt, lt: bounds.lt },
        ],
      },
      detail: `调整「${view.label}」的展示名称与算力标尺。确认后同一档位的客户端收益估算会按新 TOPS 派生。`,
    });
  };

  const editKeyword = (tier: ComputeGpuTierDef, field: ComputeGpuTierField, current = "") => {
    const view = tierView(tier, pget);
    const blocked = view.slots
      .filter((slot) => slot.field !== field)
      .map((slot) => slot.value)
      .filter(Boolean);
    openActionConfirm({
      name: current ? `修改${view.label}识别词` : `新增${view.label}识别词`,
      op: "param",
      paramKey: computeGpuTierParamKey(tier.id, field),
      edit: { kind: "text", current, unit: "单个显卡型号关键词", pattern: "single-keyword", maxLength: 48, disallowValues: blocked },
      detail: `每次只编辑一个识别词,不要把多个型号塞进同一输入框。客户端按识别词把电脑显卡映射到「${view.label}」。`,
    });
  };

  const deleteKeyword = (tier: ComputeGpuTierDef, field: ComputeGpuTierField, current: string) => {
    const view = tierView(tier, pget);
    openActionConfirm({
      name: `删除${view.label}识别词`,
      op: "param-fixed",
      paramKey: computeGpuTierParamKey(tier.id, field),
      fixedVal: "",
      detail: `删除识别词「${current}」。删除后该词不再把电脑显卡映射到「${view.label}」;本操作写入审计。`,
    });
  };

  const editDownloadUrl = () => {
    const current = downloadValue(pget, "url").trim();
    openActionConfirm({
      name: current ? "修改客户端下载地址" : "填写客户端下载地址",
      op: "param",
      paramKey: computeDownloadParamKey("url"),
      edit: { kind: "text", current, unit: "HTTPS 下载地址", pattern: "url", maxLength: 300 },
      detail: "配置电脑客户端的真实下载地址。留空状态下客户端展示「即将开放」,不会复制占位链接。",
    });
  };

  const clearDownloadUrl = () => {
    openActionConfirm({
      name: "清空客户端下载地址",
      op: "param-fixed",
      paramKey: computeDownloadParamKey("url"),
      fixedVal: "",
      detail: "清空后客户端回到「即将开放」状态,不会向前台展示假下载链接。",
    });
  };

  const editDownloadCopy = () => {
    openActionConfirm({
      name: "编辑下载页双语文案",
      op: "param-multi",
      paramKeys: [
        { key: "zhTitle", paramKey: computeDownloadParamKey("zhTitle") },
        { key: "zhGuide", paramKey: computeDownloadParamKey("zhGuide") },
        { key: "enTitle", paramKey: computeDownloadParamKey("enTitle") },
        { key: "enGuide", paramKey: computeDownloadParamKey("enGuide") },
      ],
      businessForm: {
        kind: "multi-field",
        title: "下载页双语内容",
        hint: "四个字段分别编辑,禁止把中英文或多段内容塞进同一个输入框。",
        fields: [
          { key: "zhTitle", label: COMPUTE_DOWNLOAD_CONTENT.zhTitle.label, current: downloadValue(pget, "zhTitle"), placeholder: COMPUTE_DOWNLOAD_CONTENT.zhTitle.placeholder, inputKind: "text", wide: true, allowEmpty: true, maxLength: 80 },
          { key: "zhGuide", label: COMPUTE_DOWNLOAD_CONTENT.zhGuide.label, current: downloadValue(pget, "zhGuide"), placeholder: COMPUTE_DOWNLOAD_CONTENT.zhGuide.placeholder, inputKind: "text", wide: true, allowEmpty: true, maxLength: 240 },
          { key: "enTitle", label: COMPUTE_DOWNLOAD_CONTENT.enTitle.label, current: downloadValue(pget, "enTitle"), placeholder: COMPUTE_DOWNLOAD_CONTENT.enTitle.placeholder, inputKind: "text", wide: true, allowEmpty: true, maxLength: 120 },
          { key: "enGuide", label: COMPUTE_DOWNLOAD_CONTENT.enGuide.label, current: downloadValue(pget, "enGuide"), placeholder: COMPUTE_DOWNLOAD_CONTENT.enGuide.placeholder, inputKind: "text", wide: true, allowEmpty: true, maxLength: 320 },
        ],
      },
      detail: "编辑客户端下载页的中文与英文内容。确认后写入配置审计,前台按语言分别读取。",
    });
  };

  const onCount = COMPUTE_FLAGS.filter(flagOn).length;
  const tierRows = COMPUTE_GPU_TIERS.map((tier) => ({ tier, view: tierView(tier, pget) }));
  const downloadUrl = downloadValue(pget, "url").trim();
  const keywordCount = tierRows.reduce((sum, row) => sum + row.view.keywords.length, 0);

  return (
    <div>
      <EStats items={[
        { k: "入口开关", v: COMPUTE_FLAGS.length, sub: hydrated ? `${onCount} 个开启` : "水合中", tone: "cyan" },
        { k: "显卡档位", v: COMPUTE_GPU_TIERS.length, sub: `${keywordCount} 个识别词`, tone: "ok" },
        { k: "下载地址", v: downloadUrl ? "已填写" : "待开放", sub: downloadUrl ? "客户端可复制真实地址" : "前台显示即将开放", tone: downloadUrl ? "ok" : "" },
        { k: "在线系数", v: COMPUTE_COEFFICIENTS.length, sub: "H5 / App 稳定性", tone: "cyan" },
      ]} />

      <section className="pane">
        <div className="pane-h">
          <span className="ttl">电脑算力入口开关</span>
          <span className="sub">切换需理由 + A2 审计</span>
          <span className="r"><CodeTag tone="electric">客户端联动</CodeTag></span>
        </div>
        {COMPUTE_FLAGS.map((f) => {
          const on = flagOn(f);
          return (
            <div className="e6-flag-row" key={f.key}>
              <div className="e6-flag-meta">
                <span className="e6-flag-name">{f.label}</span>
                <span className="e6-flag-desc"><AutoGloss>{f.desc}</AutoGloss></span>
              </div>
              <div className="e6-flag-ctl">
                <span className="e6-flag-state" style={{ color: on ? "var(--success)" : "var(--ink-4)" }}>
                  {hydrated ? (on ? "已开启" : "已关闭") : "—"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${f.label}:${on ? "已开启,点击关闭" : "已关闭,点击开启"}`}
                  className="e6-switch"
                  data-on={on}
                  data-proof="e6-flag-toggle"
                  onClick={() => requestToggle(f, on)}
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
        {COMPUTE_COEFFICIENTS.map((c) => (
          <div className="pkv" key={c.key}>
            <div className="lhs">
              <span className="zh">{c.label}</span>
              <span className="desc"><AutoGloss>{c.desc}</AutoGloss></span>
            </div>
            <span className="v">{hydrated ? coeffValue(c) : "—"}<span className="u">{c.unit}</span></span>
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
        <div className="param-list" data-proof="e6-yield-estimate-params" style={{ margin: "0 16px 14px" }}>
          {COMPUTE_YIELD_ESTIMATE.map((p) => (
            <div className="p" key={p.key}>
              <div className="txt">
                <div className="k">{p.label}</div>
                <div className="s">用于把显卡算力换算成每日 USDT 与 NEX 估算,全部后台可调</div>
              </div>
              <span className="v">{hydrated ? yieldEstimateValue(pget, p) : "—"} {p.unit}</span>
              <button type="button" className="adj" onClick={() => editYieldEstimate(p)}>调整</button>
            </div>
          ))}
        </div>
        <div className="e6-gpu-table">
          {tierRows.map(({ tier, view }, index) => {
            const nextSlot = view.slots.find((slot) => slot.value.length === 0);
            const dailyUsdtValue = dailyUsdt(view.tops, pget);
            return (
              <div className="e6-gpu-row" key={tier.id}>
                <div className="e6-tier-main">
                  <div className="e6-tier-head">
                    <span className="e6-tier-badge">第 {numberFmt.format(index + 1)} 档</span>
                    <span className="e6-tier-name">{view.label}</span>
                  </div>
                  <span className="e6-tier-desc"><AutoGloss>{tier.desc}</AutoGloss></span>
                  <span className="e6-tier-model">默认型号: {tier.defaultModel}</span>
                </div>
                <div className="e6-tier-yield">
                  <span><b>{numberFmt.format(view.tops)}</b> TOPS</span>
                  <span>约 ${dailyUsdtValue.toFixed(2)} / 日</span>
                  <span>约 {numberFmt.format(dailyNex(dailyUsdtValue, pget))} NEX / 日</span>
                </div>
                <div className="e6-keyword-wrap">
                  {view.keywords.map((slot) => (
                    <span className="e6-keyword-chip" key={`${tier.id}-${slot.field}`}>
                      <span>{slot.value}</span>
                      <button type="button" onClick={() => editKeyword(tier, slot.field, slot.value)}>改</button>
                      <button type="button" className="danger" onClick={() => deleteKeyword(tier, slot.field, slot.value)}>删</button>
                    </span>
                  ))}
                  {nextSlot ? (
                    <button type="button" className="e6-inline-add" onClick={() => editKeyword(tier, nextSlot.field)}>新增识别词</button>
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
              <span className="v">{downloadValue(pget, "zhTitle")}</span>
            </div>
            <div>
            <span className="k">英文标题</span>
              <span className="v">{downloadValue(pget, "enTitle")}</span>
            </div>
            <div>
              <span className="k">中文说明</span>
              <span className="v">{downloadValue(pget, "zhGuide")}</span>
            </div>
            <div>
            <span className="k">英文说明</span>
              <span className="v">{downloadValue(pget, "enGuide")}</span>
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
