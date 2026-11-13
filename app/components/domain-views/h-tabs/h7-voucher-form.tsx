"use client";

/**
 * H7 新增、编辑代金券的填写抽屉：左边按券的类型切换要填的项，右边随填随看「这张券最后是什么意思」。
 * 只收集表单值（和原来共用确认框里 voucher-config 表单同样的键和字符串值），校验规则照原表单一条不改；
 * 点「下一步」后由页面打开确认框写理由，提交内容仍由页面原来的 parseVoucher 生成。
 */
import { useMemo, useState } from "react";
import { BellOff, Layers, Ticket } from "lucide-react";
import { Button, Check, CheckGroup, Decision, Drawer, Field, Fold, Input, Modal, Notice, NumberInput, Segments, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { AUDIENCE_LABEL, SURFACE_LABEL, UNIT, VoucherFace, countText, voucherSentence, type H7Voucher } from "./h7-voucher-parts";

export type H7FormValue = Record<string, string>;
const SURFACES = ["home", "store", "me", "earn"] as const;

/** 和原 voucher-config 表单 initBusinessForm 同样的初值（新增用默认值，编辑用当前值）。 */
export function initialForm(v?: H7Voucher, toDateInput?: (ms: number) => string): H7FormValue {
  if (!v || !toDateInput) {
    return { name: "", type: "fixed", amountUSD: "", percent: "", minPurchaseUSD: "", maxDiscountUSD: "", issuanceLimit: "0", applicableSkus: "", claimSurfaces: "", audience: "all", status: "active", startDate: "", endDate: "", popupEnabled: "true", popupCadenceEnabled: "true", popupDelayMs: "1300", popupCooldownHours: "24", popupMaxPerSession: "1", stackWithTrial: "false", stackWithOthers: "false", splittable: "false" };
  }
  return {
    name: v.name,
    type: v.type,
    amountUSD: v.amountUSD != null ? String(v.amountUSD) : "",
    percent: v.percent != null ? String(v.percent) : "",
    minPurchaseUSD: v.minPurchaseUSD != null ? String(v.minPurchaseUSD) : "",
    maxDiscountUSD: v.maxDiscountUSD != null ? String(v.maxDiscountUSD) : "",
    issuanceLimit: String(v.issuanceLimit),
    applicableSkus: v.applicableSkus.join(","),
    claimSurfaces: v.claimSurfaces.join(","),
    audience: v.audience,
    status: v.status,
    startDate: toDateInput(v.startAt),
    endDate: toDateInput(v.endAt),
    popupEnabled: v.popupEnabled ? "true" : "false",
    popupCadenceEnabled: v.popupCadenceEnabled ? "true" : "false",
    popupDelayMs: String(v.popupDelayMs),
    popupCooldownHours: String(v.popupCooldownHours),
    popupMaxPerSession: String(v.popupMaxPerSession),
    stackWithTrial: v.stackWithTrial ? "true" : "false",
    stackWithOthers: v.stackWithOthers ? "true" : "false",
    splittable: v.splittable ? "true" : "false",
  };
}

/** 原表单的校验，一条不改；按字段归位，好写在字段下面。 */
export function formErrors(state: H7FormValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!state.name?.trim()) e.name = "请填写名称";
  if (!state.type?.trim()) e.type = "请选择类型";
  if (!state.audience?.trim()) e.audience = "请选择发给谁";
  if (!state.status?.trim()) e.status = "请选择状态";
  if (state.type === "fixed") {
    const a = Number(state.amountUSD);
    if (!Number.isFinite(a) || a < 1 || a > 1_000_000) e.amountUSD = `面额要填 1–1,000,000 ${UNIT}`;
  } else if (state.type === "percent") {
    const p = Number(state.percent);
    if (!Number.isInteger(p) || p < 1 || p > 99) e.percent = "要填 1–99 的整数";
  }
  const surfs = (state.claimSurfaces ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (surfs.some((s) => !(SURFACES as readonly string[]).includes(s))) e.claimSurfaces = "领取入口只能选首页、商城、我的、收益";
  const issuanceLimit = Number(state.issuanceLimit);
  if (!Number.isSafeInteger(issuanceLimit) || issuanceLimit < 0 || issuanceLimit > 10_000_000) e.issuanceLimit = "要填 0–10,000,000 的整数";
  const delay = Number(state.popupDelayMs), cooldown = Number(state.popupCooldownHours), cap = Number(state.popupMaxPerSession);
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > 60000) e.popupDelayMs = "要填 0–60,000 的整数";
  if (!Number.isSafeInteger(cooldown) || cooldown < 0 || cooldown > 720) e.popupCooldownHours = "要填 0–720 的整数";
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 10) e.popupMaxPerSession = "要填 1–10 的整数";
  return e;
}

const list = (csv: string | undefined) => (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const num = (s: string | undefined) => (s && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);
/** 日期框的值按原逻辑转成 UTC 当天 0 点，再按业务时区写给人看。 */
const dateStamp = (date: string, toMs: (date: string) => number) => { const ms = toMs(date); return ms ? businessStamp(ms) : ""; };

/** 填写中的值拼成一张券的样子，给预览用；不进提交。 */
function previewVoucher(state: H7FormValue, toMs: (date: string) => number) {
  return {
    type: state.type === "percent" ? "percent" as const : "fixed" as const,
    amountUSD: num(state.amountUSD),
    percent: num(state.percent),
    minPurchaseUSD: num(state.minPurchaseUSD) ?? 0,
    maxDiscountUSD: num(state.maxDiscountUSD) ?? 0,
    applicableSkus: list(state.applicableSkus),
    audience: state.audience === "new" ? "new" as const : "all" as const,
    startAt: toMs(state.startDate),
    endAt: toMs(state.endDate),
  };
}

const FIELD_LABEL: Record<string, string> = {
  name: "名称", type: "类型", amountUSD: "面额", percent: "减百分之几", minPurchaseUSD: "使用门槛", maxDiscountUSD: "最多减", issuanceLimit: "发行上限",
  applicableSkus: "适用商品", claimSurfaces: "领取入口", audience: "发给谁", status: "状态", startDate: "开始", endDate: "结束",
  popupEnabled: "参与首页弹窗", popupCadenceEnabled: "弹窗节奏开关", popupDelayMs: "进入后多久弹出", popupCooldownHours: "再次弹出间隔", popupMaxPerSession: "单次打开最多弹出",
  stackWithTrial: "可与试用收益叠加", stackWithOthers: "可与其它优惠叠加", splittable: "可拆分",
};
/** 改了这些项，已发出还没用的券也按新值使用（领取记录不存券的定义）。 */
const AFFECTS_ISSUED = new Set(["amountUSD", "percent", "minPurchaseUSD", "maxDiscountUSD", "applicableSkus", "startDate", "endDate"]);

/** 表单值写成给人看的话，确认框的前后值用。 */
export function displayValue(key: string, state: H7FormValue, skuLabels: Record<string, string>, toMs: (date: string) => number): string {
  const raw = state[key] ?? "";
  switch (key) {
    case "type": return raw === "percent" ? "折扣券" : "满减券";
    case "amountUSD": case "minPurchaseUSD": case "maxDiscountUSD": {
      const n = num(raw);
      if (n === undefined) return key === "amountUSD" ? "—" : key === "minPurchaseUSD" ? "无门槛" : "不封顶";
      if (n === 0 && key !== "amountUSD") return key === "minPurchaseUSD" ? "无门槛" : "不封顶";
      return `${raw} ${UNIT}`;
    }
    case "percent": return raw ? `${raw}%` : "—";
    case "issuanceLimit": return Number(raw) === 0 ? "不限量" : `${countText(Number(raw))} 张`;
    case "applicableSkus": { const ids = list(raw); return ids.length ? ids.map((id) => skuLabels[id] ?? `已不在目录（${id}）`).join("、") : "全部商品"; }
    case "claimSurfaces": { const ids = list(raw); return ids.length ? ids.map((id) => SURFACE_LABEL[id] ?? "其他页面").join("、") : "不限入口"; }
    case "audience": return AUDIENCE_LABEL[raw === "new" ? "new" : "all"];
    case "status": return raw === "paused" ? "已暂停" : "投放中";
    case "startDate": return raw ? dateStamp(raw, toMs) || raw : "立即";
    case "endDate": return raw ? dateStamp(raw, toMs) || raw : "长期有效";
    case "popupDelayMs": return `${raw} 毫秒`;
    case "popupCooldownHours": return `${raw} 小时`;
    case "popupMaxPerSession": return `${raw} 次`;
    case "popupEnabled": case "popupCadenceEnabled": case "stackWithTrial": case "stackWithOthers": case "splittable": return raw === "true" ? "是" : "否";
    default: return raw || "—";
  }
}

/** 编辑时改了哪些项：只比实际会提交的项（满减不交比例、折扣不交面额，和 parseVoucher 一致）。 */
export function changedRows(before: H7FormValue, after: H7FormValue, skuLabels: Record<string, string>, toMs: (date: string) => number, issued: number) {
  const keys = Object.keys(FIELD_LABEL).filter((key) => !(key === "amountUSD" && after.type !== "fixed") && !(key === "percent" && after.type !== "percent"));
  return keys
    .map((key) => ({ key, label: FIELD_LABEL[key], before: displayValue(key, before, skuLabels, toMs), after: displayValue(key, after, skuLabels, toMs) }))
    .filter((row) => row.before !== row.after)
    .map((row) => issued > 0 && AFFECTS_ISSUED.has(row.key) ? { ...row, note: "已发出还没用的券也按改后的值使用" } : row);
}

export function H7VoucherForm({ voucher, initial, skuOptions, skuLabels, toMs, onClose, onReview }: {
  voucher?: H7Voucher;
  initial: H7FormValue;
  skuOptions: string[];
  skuLabels: Record<string, string>;
  toMs: (date: string) => number;
  onClose: () => void;
  onReview: (value: H7FormValue) => void;
}) {
  const [value, setValue] = useState<H7FormValue>(initial);
  const [attempted, setAttempted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [folds, setFolds] = useState({ popup: false, stack: false });
  const typeLocked = !!voucher && voucher.issuedCount > 0;
  const errors = useMemo(() => formErrors(value), [value]);
  const shown = attempted ? errors : {};
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const set = (key: string, next: string) => setValue((state) => ({ ...state, [key]: next }));
  // 多选和原表单一样：点一项加到末尾，再点去掉。
  const toggle = (key: string, item: string) => setValue((state) => {
    const sel = list(state[key]);
    return { ...state, [key]: (sel.includes(item) ? sel.filter((x) => x !== item) : [...sel, item]).join(",") };
  });
  const bool = (key: string) => value[key] === "true";
  const preview = previewVoucher(value, toMs);
  const percent = value.type === "percent";
  const showMax = percent || (num(value.maxDiscountUSD) ?? 0) > 0;
  const selectedSkus = list(value.applicableSkus);
  const orphanSkus = selectedSkus.filter((id) => !skuOptions.includes(id));
  const selectedSurfaces = list(value.claimSurfaces);
  const missing = Object.values(errors);
  const close = () => { if (dirty) setLeaving(true); else onClose(); };
  const review = () => { setAttempted(true); if (missing.length === 0) onReview(value); };
  const issued = voucher?.issuedCount ?? 0;
  const zone = businessZone().label;
  const startAt = dateStamp(value.startDate, toMs), endAt = dateStamp(value.endDate, toMs);
  const changed = voucher ? changedRows(initial, value, skuLabels, toMs, issued) : [];
  const touchesIssued = changed.some((row) => AFFECTS_ISSUED.has(row.key));

  return (
    <>
      <Drawer open wide className="h7-form-drawer" onClose={close} title={voucher ? "编辑代金券" : "新增代金券"} sub={voucher?.name ?? "保存后立即生效"} icon={Ticket} tone="role-4"
        explain="左边填，右边随时看这张券最后是什么意思。点「下一步」后核对改动、写理由再保存；保存后立即生效，不走审批。"
        footer={<Decision note={attempted && missing.length ? `还有 ${missing.length} 项要改：${missing.join("；")}` : voucher ? (changed.length ? `改了 ${changed.length} 项` : "还没有改动") : undefined}
          primary={<Button variant="primary" onClick={review}>下一步：核对并保存</Button>}
          others={<Button onClick={close}>取消</Button>} />}>
        <div className="rd-split h7-form-split" data-detail="" data-preview="">
          <div className="h7-form">
            <section className="h7-form-section" aria-labelledby="h7-f-face">
              <h3 id="h7-f-face" className="h7-form-title">券面</h3>
              <Field label="名称" required hint="最多 80 字" error={shown.name}>
                {(control) => <Input {...control} value={value.name} placeholder="如 新人专享券" onChange={(e) => set("name", e.target.value)} />}
              </Field>
              <Field label="类型" required help={typeLocked ? `已经发出过 ${countText(issued)} 张，类型不能改；其余各项都能改。` : "满减券减固定金额；折扣券按订单金额减一个百分比。"}>
                {typeLocked
                  ? <span className="h7-locked-type"><StatusTag tone="neutral">{value.type === "percent" ? "折扣券" : "满减券"}</StatusTag></span>
                  : <Segments label="类型" value={value.type} onChange={(next) => set("type", next)} items={[{ value: "fixed", label: "满减券" }, { value: "percent", label: "折扣券" }]} />}
              </Field>
              <div className="rd-form-grid" data-cols={showMax ? "3" : "2"} data-dense="">
                {percent
                  ? <Field label="减百分之几" required hint="1–99 的整数" error={shown.percent} help="8 表示按订单金额减 8%，不是八折；App 上显示「8% 折扣」。">
                    {(control) => <NumberInput {...control} unit="%" min={1} max={99} step={1} value={value.percent} onChange={(e) => set("percent", e.target.value)} />}
                  </Field>
                  : <Field label="面额" required hint="1–1,000,000" error={shown.amountUSD} help="下单时直接减这么多，最多减到 0。">
                    {(control) => <NumberInput {...control} unit={UNIT} min={1} max={1_000_000} value={value.amountUSD} onChange={(e) => set("amountUSD", e.target.value)} />}
                  </Field>}
                <Field label="使用门槛" hint="不填或 0 为无门槛" help="订单满这个金额才能用。">
                  {(control) => <NumberInput {...control} unit={UNIT} min={0} value={value.minPurchaseUSD} onChange={(e) => set("minPurchaseUSD", e.target.value)} />}
                </Field>
                {showMax && <Field label="最多减" hint="不填或 0 为不封顶" help={percent ? "一单最多减这么多。" : "满减券也按这一项封顶；比面额小时，一单最多只减这么多。"}>
                  {(control) => <NumberInput {...control} unit={UNIT} min={0} value={value.maxDiscountUSD} onChange={(e) => set("maxDiscountUSD", e.target.value)} />}
                </Field>}
              </div>
            </section>

            <section className="h7-form-section" aria-labelledby="h7-f-who">
              <h3 id="h7-f-who" className="h7-form-title">谁能用、在哪领</h3>
              <CheckGroup legend="适用商品" summary={selectedSkus.length ? `已选 ${selectedSkus.length} 个` : "不选＝全部商品可用"}
                explain="商品名和「商品管理与上架条件」一致，这里只列在售的商品。只选一个时，用户点「使用」直接去这个商品；选多个或不选去商城。">
                {skuOptions.map((id) => <Check key={id} label={skuLabels[id] ?? id} checked={selectedSkus.includes(id)} onChange={() => toggle("applicableSkus", id)} />)}
                {orphanSkus.map((id) => <Check key={id} label={`已不在当前目录（${id}）`} checked onChange={() => toggle("applicableSkus", id)} />)}
                {skuOptions.length === 0 && orphanSkus.length === 0 && <p className="h7-form-note">没有读到在售商品；不选就是全部商品可用。</p>}
              </CheckGroup>
              <Field label="发给谁" required error={shown.audience} help={value.audience === "new" ? "新用户指注册不满 1 个月的账号；不是没下过单的人。" : undefined}>
                <Segments label="发给谁" value={value.audience} onChange={(next) => set("audience", next)} items={[{ value: "all", label: AUDIENCE_LABEL.all }, { value: "new", label: AUDIENCE_LABEL.new }]} />
              </Field>
              <CheckGroup legend="领取入口" summary={selectedSurfaces.length ? `已选 ${selectedSurfaces.length} 个` : "不选＝不限"}
                help="App 目前只有首页和商城能手动领券；选「我的」「收益」不会多出领券入口。">
                {SURFACES.map((id) => <Check key={id} label={SURFACE_LABEL[id]} checked={selectedSurfaces.includes(id)} onChange={() => toggle("claimSurfaces", id)} />)}
              </CheckGroup>
              {shown.claimSurfaces && <p className="rd-form-error" role="alert">{shown.claimSurfaces}</p>}
            </section>

            <section className="h7-form-section" aria-labelledby="h7-f-when">
              <h3 id="h7-f-when" className="h7-form-title">什么时候能领能用</h3>
              <div className="rd-form-grid" data-cols="2" data-dense="">
                <Field label="开始日期" hint="不填＝立即" help={startAt ? `从 ${startAt}（${zone}）起` : "保存后立即可领"}>
                  {(control) => <Input {...control} type="date" value={value.startDate} onChange={(e) => set("startDate", e.target.value)} />}
                </Field>
                <Field label="结束日期" hint="不填＝长期" help={endAt ? `到 ${endAt}（${zone}）为止，已领没用的也不能再用` : "长期有效"}>
                  {(control) => <Input {...control} type="date" value={value.endDate} onChange={(e) => set("endDate", e.target.value)} />}
                </Field>
              </div>
            </section>

            <section className="h7-form-section" aria-labelledby="h7-f-issue">
              <h3 id="h7-f-issue" className="h7-form-title">发行和状态</h3>
              <div className="rd-form-grid" data-cols="2" data-dense="">
                <Field label="发行上限" hint="0–10,000,000，0＝不限" error={shown.issuanceLimit}
                  help={issued > 0 ? `已发出 ${countText(issued)} 张；用掉和作废的也占上限，改小不收回已发的券。` : "发满后用户领不到；用掉和作废的也占上限。"}>
                  {(control) => <NumberInput {...control} unit="张" min={0} max={10_000_000} step={1} value={value.issuanceLimit} onChange={(e) => set("issuanceLimit", e.target.value)} />}
                </Field>
                <Field label={voucher ? "状态" : "保存后的状态"} required error={shown.status}>
                  <Segments label="状态" value={value.status} onChange={(next) => set("status", next)} items={[{ value: "active", label: "投放中" }, { value: "paused", label: "已暂停" }]} />
                </Field>
              </div>
            </section>

            <Fold title="首页弹窗" icon={BellOff} tone="role-other" inset summary={`App 目前不自动弹出 · ${bool("popupEnabled") ? "参与" : "不参与"}`}
              alert={!!(shown.popupDelayMs || shown.popupCooldownHours || shown.popupMaxPerSession)}
              open={folds.popup || !!(shown.popupDelayMs || shown.popupCooldownHours || shown.popupMaxPerSession)} onOpenChange={(open) => setFolds((f) => ({ ...f, popup: open }))}>
              <Notice tone="neutral">App 目前不自动弹出：这些设置会保存，但现在不会让券自动弹出来。</Notice>
              <div className="rd-form-grid" data-cols="2" data-dense="">
                <Check label="参与首页弹窗" checked={bool("popupEnabled")} onChange={(e) => set("popupEnabled", e.target.checked ? "true" : "false")} />
                <Check label="弹窗节奏开关" explain="这张券自己的开关，不是全平台的总开关。" checked={bool("popupCadenceEnabled")} onChange={(e) => set("popupCadenceEnabled", e.target.checked ? "true" : "false")} />
              </div>
              <div className="rd-form-grid" data-cols="3" data-dense="">
                <Field label="进入后多久弹出" hint="0–60,000" error={shown.popupDelayMs}>
                  {(control) => <NumberInput {...control} unit="毫秒" min={0} max={60000} step={1} value={value.popupDelayMs} onChange={(e) => set("popupDelayMs", e.target.value)} />}
                </Field>
                <Field label="再次弹出间隔" hint="0–720" error={shown.popupCooldownHours}>
                  {(control) => <NumberInput {...control} unit="小时" min={0} max={720} step={1} value={value.popupCooldownHours} onChange={(e) => set("popupCooldownHours", e.target.value)} />}
                </Field>
                <Field label="单次打开最多弹出" hint="1–10" error={shown.popupMaxPerSession}>
                  {(control) => <NumberInput {...control} unit="次" min={1} max={10} step={1} value={value.popupMaxPerSession} onChange={(e) => set("popupMaxPerSession", e.target.value)} />}
                </Field>
              </div>
            </Fold>

            <Fold title="叠加与拆分" icon={Layers} tone="role-other" inset summary={[bool("splittable") && "可拆分", bool("stackWithTrial") && "可与试用收益叠加", bool("stackWithOthers") && "可与其它优惠叠加"].filter(Boolean).join("、") || "都不勾"}
              open={folds.stack} onOpenChange={(open) => setFolds((f) => ({ ...f, stack: open }))}>
              <Check label="可拆分" help="目前整张核销：用一次就整张用掉，勾了也不会分次使用。" checked={bool("splittable")} onChange={(e) => set("splittable", e.target.checked ? "true" : "false")} />
              <Check label="可与试用收益叠加" help="下单时后端目前不检查这一项，只有 App 选券时会参考。" checked={bool("stackWithTrial")} onChange={(e) => set("stackWithTrial", e.target.checked ? "true" : "false")} />
              <Check label="可与其它优惠叠加" help="下单时按这一项判断能不能和促销活动一起用；不是一单能用两张券。" checked={bool("stackWithOthers")} onChange={(e) => set("stackWithOthers", e.target.checked ? "true" : "false")} />
            </Fold>
          </div>

          <aside className="h7-preview" aria-label="这张券最后是这样">
            <h3 className="h7-form-title">这张券最后是这样</h3>
            <div className="h7-preview-ticket">
              <VoucherFace v={preview} size="large" />
              <div className="h7-preview-name">{value.name.trim() || "（还没填名称）"}</div>
            </div>
            <p className="h7-preview-sentence">{voucherSentence(preview, skuLabels)}</p>
            <ul className="h7-preview-notes">
              <li>{value.status === "paused" ? "保存后是已暂停：用户还领不到。" : "保存后是投放中：符合条件的用户可以领。"}</li>
              <li>{`领取入口：${selectedSurfaces.length ? selectedSurfaces.map((id) => SURFACE_LABEL[id]).join("、") : "不限"}`}</li>
            </ul>
            {voucher && issued > 0 && (touchesIssued
              ? <Notice tone="warn" title="会影响已发出的券">{`已发出还没用的 ${countText(voucher.availableCount)} 张也按改后的面额、门槛、商品和有效期使用；已用掉的 ${countText(voucher.redeemedCount)} 张和已完成的订单不变。`}</Notice>
              : <Notice tone="neutral">{`已发出 ${countText(issued)} 张。改面额、门槛、适用商品或有效期时，还没用的券也会跟着变；已用掉的不变。`}</Notice>)}
          </aside>
        </div>
      </Drawer>
      {leaving && <Modal title="放弃这次填写？" onClose={() => setLeaving(false)} footer={<>
        <Button onClick={() => setLeaving(false)}>继续填写</Button>
        <Button variant="danger-outline" onClick={() => { setLeaving(false); onClose(); }}>放弃并关闭</Button>
      </>}><p>填的内容还没保存，关闭后不保留。</p></Modal>}
    </>
  );
}
