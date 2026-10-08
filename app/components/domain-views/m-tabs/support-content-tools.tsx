"use client";
import { useEffect, useState } from "react";
import { supportEnhancements, type SupportLink } from "@/lib/admin/m-support-enhancements";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { MCtx } from "./types";
import "./support-content-tools.css";
export type SelectedSupportContent = { kind: "SKU"; skuId: string; name: string } | { kind: "LINK"; linkTarget: SupportLink; name: string };
export function SupportContentTools({ ctx, disabled, onInsert, onSelect }: { ctx: MCtx; disabled: boolean; onInsert: (text: string) => void; onSelect: (content: SelectedSupportContent) => void }) {
  const [templateType, setTemplateType] = useState("reply"), [keyword, setKeyword] = useState(""), [group, setGroup] = useState("");
  const [skuOpen, setSkuOpen] = useState(false), [skuPage, setSkuPage] = useState(1), [skuQuery, setSkuQuery] = useState(""), [skuRetry, setSkuRetry] = useState(0);
  const [skus, setSkus] = useState<Array<{ id: string; name: string }> | null>(null), [total, setTotal] = useState(0), [error, setError] = useState("");
  const [skuBusy, setSkuBusy] = useState(false);
  const [templateBusy,setTemplateBusy]=useState(false),[templateError,setTemplateError]=useState("");
  const source = templateType === "reply" ? "I.session.replyTemplates" : "I.session.scripts";
  const available = ctx.pget("I.session.templatesAvailable") === "1";
  async function retryTemplates(){setTemplateBusy(true);setTemplateError("");try{await ctx.refreshContent();}catch(e){setTemplateError(displayAdminError(e));}finally{setTemplateBusy(false);}}
  const templates: Array<{ id: string; group?: string; type?: string; text: string }> = (() => { try { const rows = JSON.parse(ctx.pget(source) ?? "[]"); return Array.isArray(rows) ? rows.filter(r => r.status === "published" && typeof r.text === "string") : []; } catch { return []; } })();
  const groups = [...new Set(templates.map(t => t.group || (t.type === "advisor" ? "顾问" : "客服")))];
  const filtered = templates.filter(t => (!group || (t.group || (t.type === "advisor" ? "顾问" : "客服")) === group) && (!keyword.trim() || t.text.includes(keyword.trim())));
  useEffect(() => {
    if (!skuOpen || disabled) return;
    const controller = new AbortController(); setSkus(null); setError(""); setSkuBusy(true);
    supportEnhancements.skus(skuPage, skuQuery, controller.signal).then(p => { if (!controller.signal.aborted) { setSkus(p.records); setTotal(p.total); } }).catch(e => { if (!controller.signal.aborted) setError(displayAdminError(e)); }).finally(() => { if (!controller.signal.aborted) setSkuBusy(false); });
    return () => { controller.abort(); setSkuBusy(false); };
  }, [skuOpen, skuPage, skuQuery, skuRetry, disabled]);
  return <div className="support-content-tools">
    <details className="support-content-section">
      <summary className="support-content-trigger"><span>回复模板与顾问话术</span><span className="support-content-chevron" aria-hidden="true" /></summary>
      <div className="support-content-body">
        <div className="support-content-fields">
          <label className="support-content-field"><span>模板类型</span><select className="fld" value={templateType} disabled={disabled} onChange={e=>{setTemplateType(e.target.value);setGroup("");}}><option value="reply">普通回复模板</option><option value="script">顾问话术</option></select></label>
          <label className="support-content-field"><span>分组</span><select className="fld" value={group} disabled={disabled} onChange={e=>setGroup(e.target.value)}><option value="">全部分组</option>{groups.map(g=><option key={g}>{g}</option>)}</select></label>
          <label className="support-content-field support-content-search"><span>搜索模板</span><input className="fld" value={keyword} disabled={disabled} onChange={e=>setKeyword(e.target.value)}/></label>
        </div>
        <p className="support-content-meta">{filtered.length} 条已发布内容</p>
        {!available && !templates.length ? <div className="support-content-state" role="status">模板暂不可读取。<button className="l-btn sm" disabled={templateBusy} onClick={()=>void retryTemplates()}>{templateBusy?"正在读取模板…":"重试模板与话术"}</button>{templateError&&<span role="alert">{templateError}</span>}</div> : !filtered.length ? <p className="support-content-state">暂无匹配的已发布内容。</p> : <div className="support-content-results">{filtered.map(t=><button className="l-btn sm support-content-result" key={t.id} disabled={disabled} onClick={()=>onInsert(t.text)}>{t.group || (t.type==="advisor"?"顾问":"客服")} · {t.text}</button>)}</div>}
      </div>
    </details>
    <details className="support-content-section" onToggle={e=>setSkuOpen(e.currentTarget.open)}>
      <summary className="support-content-trigger"><span>推荐在售商品</span><span className="support-content-chevron" aria-hidden="true" /></summary>
      <div className="support-content-body">
        <label className="support-content-field"><span>搜索商品名称或编号</span><input className="fld" value={skuQuery} disabled={disabled} onChange={e=>{setSkuQuery(e.target.value);setSkuPage(1);}}/></label>
        {disabled&&!skus?<p className="support-content-state" role="status">当前暂不能推荐商品：当前状态不可发送，或操作尚未结束。请恢复可用后再试。</p>:error?<div className="support-content-state" role="alert">{error}<button className="l-btn sm" onClick={()=>setSkuRetry(n=>n+1)}>重试商品</button></div>:!skus?<p className="support-content-state" role="status">{skuBusy?"正在读取在售商品…":"在售商品尚未读取。"}</p>:<>
          {!skus.length&&<p className="support-content-state">没有匹配的在售商品。</p>}
          <div className="support-content-results">{skus.map(s=><button className="l-btn sm support-content-result" key={s.id} disabled={disabled} onClick={()=>onSelect({kind:"SKU",skuId:s.id,name:s.name})}>{s.name} · {s.id}</button>)}</div>
          <div className="support-content-pager"><button className="l-btn sm" disabled={skuPage<=1||disabled} onClick={()=>setSkuPage(n=>n-1)}>上一页</button><span>第 {skuPage} 页 · {total} 件</span><button className="l-btn sm" disabled={skuPage*10>=total||disabled} onClick={()=>setSkuPage(n=>n+1)}>下一页</button></div>
        </>}
      </div>
    </details>
    <label className="support-content-field support-content-link"><span>发送页面链接</span><select className="fld" defaultValue="" disabled={disabled} onChange={e=>{const type=e.target.value as SupportLink["type"];if(type)onSelect({kind:"LINK",linkTarget:{type,params:{}},name:{HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[type]});e.target.value="";}}><option value="">选择目标页面</option><option value="HOME">首页</option><option value="WALLET">钱包</option><option value="SUPPORT">在线客服</option></select></label>
  </div>;
}
