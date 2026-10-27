"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { supportEnhancements, type SupportLink } from "@/lib/admin/m-support-enhancements";
import { displayAdminError } from "@/lib/admin/error-messages";
import { catalogSkuBrandText } from "@/lib/admin/brand-copy";
import { supportPhraseClient, type SupportPersonalPhrase } from "@/lib/admin/m-support-client";
import type { MCtx } from "./types";
import { Icon, Modal } from "../design-kit";
import { HDSelect } from "./hd-ui";
import "./support-content-tools.css";
export type SelectedSupportContent = { kind: "SKU"; skuId: string; name: string } | { kind: "LINK"; linkTarget: SupportLink; name: string };
export function SupportContentTools({ ctx, disabled, onInsert, onSelect, popover = false }: { ctx: MCtx; disabled: boolean; onInsert: (text: string) => void; onSelect: (content: SelectedSupportContent) => void; popover?: boolean }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>();
  const [templateType, setTemplateType] = useState("reply"), [keyword, setKeyword] = useState(""), [group, setGroup] = useState("");
  const [picker, setPicker] = useState<"template" | "sku" | "link" | "faq" | null>(null), [skuPage, setSkuPage] = useState(1), [skuQuery, setSkuQuery] = useState(""), [skuRetry, setSkuRetry] = useState(0);
  const [skus, setSkus] = useState<Array<{ id: string; name: string }> | null>(null), [total, setTotal] = useState(0), [error, setError] = useState("");
  const [skuBusy, setSkuBusy] = useState(false);
  const [templateBusy,setTemplateBusy]=useState(false),[templateError,setTemplateError]=useState("");
  const [phrases, setPhrases] = useState<SupportPersonalPhrase[] | null>(null), [phraseDraft, setPhraseDraft] = useState(""), [phraseError, setPhraseError] = useState(""), [phraseBusy, setPhraseBusy] = useState(false);
  const mine = templateType === "mine";
  useEffect(() => {
    if (picker !== "template" || !mine) return;
    const controller = new AbortController(); setPhraseError("");
    supportPhraseClient.list(controller.signal).then(rows => { if (!controller.signal.aborted) setPhrases(rows); }).catch(e => { if (!controller.signal.aborted) setPhraseError(displayAdminError(e)); });
    return () => controller.abort();
  }, [picker, mine]);
  async function changePhrases(action: () => Promise<SupportPersonalPhrase[]>) {
    setPhraseBusy(true); setPhraseError("");
    try { setPhrases(await action()); setPhraseDraft(""); } catch (e) { setPhraseError(displayAdminError(e)); } finally { setPhraseBusy(false); }
  }
  // M-47: published FAQ answers can be looked up and inserted without leaving the conversation.
  const faqs: Array<{ id: string; question: string; answer: string; status: string; language: string }> = (() => { try { const rows = JSON.parse(ctx.pget("I.support.faqs") ?? "[]"); return Array.isArray(rows) ? rows.filter(r => r.status === "published" && typeof r.answer === "string" && (r.language ?? "zh-CN") === "zh-CN") : []; } catch { return []; } })();
  const [faqQuery, setFaqQuery] = useState("");
  const faqMatches = faqs.filter(f => !faqQuery.trim() || `${f.question}${f.answer}`.includes(faqQuery.trim()));
  const source = templateType === "reply" ? "I.session.replyTemplates" : "I.session.scripts";
  const available = ctx.pget("I.session.templatesAvailable") === "1";
  async function retryTemplates(){setTemplateBusy(true);setTemplateError("");try{await ctx.refreshContent();}catch(e){setTemplateError(displayAdminError(e));}finally{setTemplateBusy(false);}}
  const templates: Array<{ id: string; group?: string; type?: string; text: string }> = (() => { try { const rows = JSON.parse(ctx.pget(source) ?? "[]"); return Array.isArray(rows) ? rows.filter(r => r.status === "published" && typeof r.text === "string") : []; } catch { return []; } })();
  const groups = [...new Set(templates.map(t => t.group || (t.type === "advisor" ? "专属客服" : "客服")))];
  const filtered = templates.filter(t => (!group || (t.group || (t.type === "advisor" ? "专属客服" : "客服")) === group) && (!keyword.trim() || t.text.includes(keyword.trim())));
  useEffect(() => {
    if (picker !== "sku" || disabled) return;
    const controller = new AbortController(); setSkus(null); setError(""); setSkuBusy(true);
    supportEnhancements.skus(skuPage, skuQuery, controller.signal).then(p => { if (!controller.signal.aborted) { setSkus(p.records); setTotal(p.total); } }).catch(e => { if (!controller.signal.aborted) setError(displayAdminError(e)); }).finally(() => { if (!controller.signal.aborted) setSkuBusy(false); });
    return () => { controller.abort(); setSkuBusy(false); };
  }, [picker, skuPage, skuQuery, skuRetry, disabled]);
  useEffect(() => {
    const close = () => { setPicker(null); setKeyword(""); setGroup(""); setTemplateType("reply"); setSkus(null); setTotal(0); setSkuQuery(""); setSkuPage(1); setError(""); setTemplateError(""); };
    window.addEventListener("support-scope-invalidated", close);
    return () => window.removeEventListener("support-scope-invalidated", close);
  }, []);
  useLayoutEffect(() => {
    if (!picker || !popover) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const chat = triggerRef.current?.closest(".m3-col-chat");
      const top = Math.max(12, chat?.querySelector("header")?.getBoundingClientRect().bottom ?? 12);
      const available = rect.top - top - 18;
      if (available < 180 || rect.bottom > window.innerHeight - 12) { setPosition(undefined); return; }
      const width = Math.min(420, chat?.clientWidth ?? 420, window.innerWidth - 24);
      setPosition({ "--picker-left": `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`, "--picker-bottom": `${window.innerHeight - rect.top + 9}px`, "--picker-width": `${width}px`, "--picker-height": `${Math.min(460, available)}px` } as CSSProperties);
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [picker, popover]);
  return <div className="support-content-tools" ref={triggerRef}>
    <button type="button" className="support-content-trigger" aria-label="回复模板与专属客服话术" aria-expanded={picker==="template"} disabled={disabled} onClick={()=>setPicker("template")}><span>{popover?"快捷回复":"回复模板与专属客服话术"}</span><Icon name="doc" size={16}/></button>
    <button type="button" className="support-content-trigger" aria-label="查找知识库答案" aria-expanded={picker==="faq"} disabled={disabled} onClick={()=>setPicker("faq")}><span>知识库</span><Icon name="search" size={16}/></button>
    <button type="button" className="support-content-trigger" aria-label="推荐在售商品" aria-expanded={picker==="sku"} disabled={disabled} onClick={()=>setPicker("sku")}><span>{popover?"推荐商品":"推荐在售商品"}</span><Icon name="box" size={16}/></button>
    <button type="button" className="support-content-trigger" aria-label="发送页面链接" aria-expanded={picker==="link"} disabled={disabled} onClick={()=>setPicker("link")}><span>{popover?"页面链接":"发送页面链接"}</span><Icon name="arrow" size={16}/></button>
    {disabled&&<p className="support-content-state" role="status">当前暂不能选择发送内容：当前状态不可发送，或操作尚未结束。请恢复可用后再试。</p>}
    {/* Portal keeps the bulk composer dialog from also handling the picker Escape key. */}
    {picker && createPortal(<div className={popover && position ? "support-composer-popover" : undefined} style={position}><Modal title={picker==="template"?"回复模板与专属客服话术":picker==="faq"?"知识库":picker==="sku"?"推荐在售商品":"发送页面链接"} onClose={()=>setPicker(null)} footer={<button type="button" className="l-btn" onClick={()=>setPicker(null)}>取消</button>}>
      <div className="mdom support-content-tools" onKeyDown={e=>{if(e.key==="Enter")e.stopPropagation();}}>
      {picker==="template" ? <div className="support-content-body">
        <fieldset disabled={disabled} className="support-content-fields" style={{border:0,padding:0,margin:0}}>
          <label className="support-content-field"><span>模板类型</span><HDSelect value={templateType} width="100%" onChange={value=>{setTemplateType(value);setGroup("");}} options={[{value:"reply",label:"普通回复模板"},{value:"script",label:"专属客服话术"},{value:"mine",label:"我的常用语"}]}/></label>
          {!mine&&<label className="support-content-field"><span>分组</span><HDSelect value={group} width="100%" onChange={setGroup} options={[{value:"",label:"全部分组"},...groups.map(g=>({value:g,label:g}))]}/></label>}
          <label className="support-content-field support-content-search"><span>搜索模板</span><input className="fld" value={keyword} disabled={disabled} onChange={e=>setKeyword(e.target.value)}/></label>
        </fieldset>
        {mine ? <>
          <div className="support-phrase-add"><textarea className="fld" rows={2} maxLength={500} placeholder="新增一条常用语，仅自己可见" value={phraseDraft} disabled={disabled||phraseBusy} onChange={e=>setPhraseDraft(e.target.value)}/><button type="button" className="l-btn sm primary" disabled={disabled||phraseBusy||!phraseDraft.trim()} onClick={()=>void changePhrases(()=>supportPhraseClient.add(phraseDraft.trim()))}>保存</button></div>
          {phraseError&&<p className="support-content-state" role="alert">{phraseError}</p>}
          {!phrases ? <p className="support-content-state" role="status">{phraseError?"常用语暂不可读取。":"正在读取常用语…"}</p> : !phrases.filter(p=>!keyword.trim()||p.content.includes(keyword.trim())).length ? <p className="support-content-state">{phrases.length?"没有匹配的常用语。":"还没有常用语。保存后点一下即可插入输入框。"}</p> : <div className="sku-pop-list" style={{maxHeight:300}}>{phrases.filter(p=>!keyword.trim()||p.content.includes(keyword.trim())).map(p=><div className="support-phrase-row" key={p.id}><button type="button" className="l-btn sm sku-pop-item support-content-result" disabled={disabled} onClick={()=>{onInsert(p.content);setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-title">{p.content}</span></span><Icon name="arrow" size={15}/></button><button type="button" className="l-btn sm" aria-label="删除这条常用语" disabled={disabled||phraseBusy} onClick={()=>void changePhrases(()=>supportPhraseClient.remove(p.id))}>删除</button></div>)}</div>}
        </> : <>
        <p className="support-content-meta">{available ? filtered.length : "-"} 条已发布内容</p>
        {!available && !templates.length ? <div className="support-content-state" role="status">模板暂不可读取。<button type="button" className="l-btn sm" disabled={templateBusy||disabled} onClick={()=>void retryTemplates()}>{templateBusy?"正在读取模板…":"重试模板与话术"}</button>{templateError&&<span role="alert">{templateError}</span>}</div> : !filtered.length ? <p className="support-content-state">暂无匹配的已发布内容。</p> : <div className="sku-pop-list" style={{maxHeight:300}}>{filtered.map(t=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={t.id} disabled={disabled} onClick={()=>{onInsert(t.text);setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-sub">{t.group || (t.type==="advisor"?"专属客服":"客服")}</span><span style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{t.text}</span></span><Icon name="arrow" size={15}/></button>)}</div>}
        </>}
      </div> : picker==="faq" ? <div className="support-content-body">
        <label className="support-content-field support-content-search"><span>搜索常见问题</span><input className="fld" value={faqQuery} autoFocus disabled={disabled} onChange={e=>setFaqQuery(e.target.value)}/></label>
        <p className="support-content-meta">{faqMatches.length} 条已发布问答 · 点一下把答案插入输入框</p>
        {!faqMatches.length ? <p className="support-content-state">{faqs.length ? "没有匹配的问答。" : "知识库暂无已发布的中文问答。"}</p> : <div className="sku-pop-list" style={{maxHeight:300}}>{faqMatches.map(f=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={f.id} disabled={disabled} onClick={()=>{onInsert(f.answer);setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-title">{f.question}</span><span className="sku-pop-sub" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.answer}</span></span><Icon name="arrow" size={15}/></button>)}</div>}
      </div> : picker==="sku" ? <div className="support-content-body">
        <label className="support-content-field"><span>搜索商品名称或编号</span><input className="fld" value={skuQuery} disabled={disabled} onChange={e=>{setSkuQuery(e.target.value);setSkuPage(1);}}/></label>
        {disabled&&!skus?<p className="support-content-state" role="status">当前暂不能推荐商品：当前状态不可发送，或操作尚未结束。请恢复可用后再试。</p>:error?<div className="support-content-state" role="alert">{error}<button className="l-btn sm" disabled={disabled} onClick={()=>setSkuRetry(n=>n+1)}>重试商品</button></div>:!skus?<p className="support-content-state" role="status">{skuBusy?"正在读取在售商品…":"在售商品尚未读取。"}</p>:<>
          {!skus.length&&<p className="support-content-state">没有匹配的在售商品。</p>}
          <div className="sku-pop-list" style={{maxHeight:300}}>{skus.map(s=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={s.id} disabled={disabled} onClick={()=>{onSelect({kind:"SKU",skuId:s.id,name:catalogSkuBrandText(s.id,s.name)});setPicker(null);}}><span className="sku-pop-thumb"><Icon name="box" size={19}/></span><span className="sku-pop-info"><span className="sku-pop-title">{catalogSkuBrandText(s.id,s.name)}</span><span className="sku-pop-sub">{s.id}</span></span><Icon name="arrow" size={15}/></button>)}</div>
          <div className="support-content-pager"><button className="l-btn sm" disabled={skuPage<=1||disabled} onClick={()=>setSkuPage(n=>n-1)}>上一页</button><span>第 {skuPage} 页 · {total} 件</span><button className="l-btn sm" disabled={skuPage*10>=total||disabled} onClick={()=>setSkuPage(n=>n+1)}>下一页</button></div>
        </>}
      </div> : <div className="sku-pop-list">{(["HOME","WALLET","SUPPORT"] as const).map(type=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={type} disabled={disabled} onClick={()=>{onSelect({kind:"LINK",linkTarget:{type,params:{}},name:{HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[type]});setPicker(null);}}>{ {HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[type]}<Icon name="arrow" size={15}/></button>)}</div>}
      </div>
    </Modal></div>, document.body)}
  </div>;
}
