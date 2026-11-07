"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { supportEnhancements, type SupportLink } from "@/lib/admin/m-support-enhancements";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportPhraseClient, type SupportPersonalPhrase } from "@/lib/admin/m-support-client";
import { scriptGroupLabel } from "@/lib/admin/m-client";
import type { MCtx } from "./types";
import { Icon, Modal } from "../design-kit";
import { BlockState, Button, Explain, Field, Input, Select, Textarea } from "@/app/components/rd";
import "./support-content-tools.css";
export type SelectedSupportContent = { kind: "SKU"; skuId: string; name: string } | { kind: "LINK"; linkTarget: SupportLink; name: string };
export function SupportContentTools({ ctx, disabled, onInsert, onSelect, popover = false, textOnly = false }: { ctx: MCtx; disabled: boolean; onInsert: (text: string) => void; onSelect: (content: SelectedSupportContent) => void; popover?: boolean; textOnly?: boolean }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>();
  const [templateType, setTemplateType] = useState("reply"), [keyword, setKeyword] = useState(""), [group, setGroup] = useState("");
  const [picker, setPicker] = useState<"template" | "sku" | "link" | "faq" | null>(null), [skuPage, setSkuPage] = useState(1), [skuQuery, setSkuQuery] = useState(""), [skuRetry, setSkuRetry] = useState(0);
  const [skus, setSkus] = useState<Array<{ id: string; name: string; price?: number }> | null>(null), [total, setTotal] = useState(0), [error, setError] = useState("");
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
  const faqAvailable = ctx.pget("I.support.knowledgeAvailable") === "1";
  const [faqBusy, setFaqBusy] = useState(false), [faqError, setFaqError] = useState("");
  async function retryFaqs() { setFaqBusy(true); setFaqError(""); try { await ctx.refreshKnowledge(); } catch (e) { setFaqError(displayAdminError(e)); } finally { setFaqBusy(false); } }
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
      // 整个落在对话头和编辑器之间：不盖半行，要边看客户的话边选（DT-11）。
      const chat = triggerRef.current?.closest(".m3s-chat");
      const top = Math.max(12, chat?.querySelector("header")?.getBoundingClientRect().bottom ?? 12);
      const floor = chat?.querySelector(".m3s-composer")?.getBoundingClientRect().top ?? rect.top;
      const available = floor - top - 8;
      if (available < 180 || rect.bottom > window.innerHeight - 12) { setPosition(undefined); return; }
      // 和消息列同宽，消息不从旁边露出半截。
      const width = Math.min(chat ? chat.clientWidth - 32 : 420, window.innerWidth - 24);
      setPosition({ "--picker-left": `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`, "--picker-bottom": `${window.innerHeight - floor + 8}px`, "--picker-width": `${width}px`, "--picker-height": `${Math.min(460, available)}px` } as CSSProperties);
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [picker, popover]);
  return <div className="support-content-tools" ref={triggerRef}>
    <button type="button" className="support-content-trigger" aria-label="回复模板与专属客服话术" aria-expanded={picker==="template"} disabled={disabled} onClick={()=>setPicker("template")}><span>{popover?"快捷回复":"回复模板与专属客服话术"}</span><Icon name="doc" size={16}/></button>
    <button type="button" className="support-content-trigger" aria-label="查找知识库答案" aria-expanded={picker==="faq"} disabled={disabled} onClick={()=>setPicker("faq")}><span>知识库</span><Icon name="search" size={16}/></button>
    <button type="button" className="support-content-trigger" aria-label="推荐在售商品" aria-expanded={picker==="sku"} disabled={disabled||textOnly} title={textOnly?"首次联系只能发文字，发送后再推荐商品":undefined} onClick={()=>setPicker("sku")}><span>{popover?"推荐商品":"推荐在售商品"}</span><Icon name="box" size={16}/></button>
    <button type="button" className="support-content-trigger" aria-label="发送页面链接" aria-expanded={picker==="link"} disabled={disabled||textOnly} title={textOnly?"首次联系只能发文字，发送后再发页面链接":undefined} onClick={()=>setPicker("link")}><span>{popover?"页面链接":"发送页面链接"}</span><Icon name="arrow" size={16}/></button>
    {disabled&&<p className="support-content-state" role="status">当前暂不能选择发送内容：当前状态不可发送，或操作尚未结束。请恢复可用后再试。</p>}
    {/* Portal keeps the bulk composer dialog from also handling the picker Escape key. */}
    {picker && createPortal(<div className={popover && position ? "support-composer-popover" : undefined} style={position}><Modal className={popover&&position?"m3s-pop":undefined} style={position} icon={picker==="template"?"doc":picker==="faq"?"search":picker==="sku"?"box":"arrow"} title={picker==="template"?"回复模板与专属客服话术":picker==="faq"?"知识库":picker==="sku"?"推荐在售商品":"发送页面链接"} onClose={()=>setPicker(null)}>
      <div className="mdom support-content-tools" onKeyDown={e=>{if(e.key==="Enter")e.stopPropagation();}}>
      {picker==="template" ? <div className="support-content-body">
        <fieldset disabled={disabled} className="support-content-fields">
          <Field label="模板类型"><Select aria-label="模板类型" disabled={disabled} value={templateType} onChange={value=>{setTemplateType(value);setGroup("");}} options={[{value:"reply",label:"普通回复模板"},{value:"script",label:"专属客服话术"},{value:"mine",label:"我的常用语"}]}/></Field>
          {!mine&&templates.length>0&&<Field label="分组"><Select aria-label="分组" disabled={disabled} value={group} onChange={setGroup} options={[{value:"",label:"全部分组"},...groups.map(g=>({value:g,label:scriptGroupLabel(g)}))]}/></Field>}
          {(mine?Boolean(phrases?.length):templates.length>0)&&<div className="support-content-search"><Field label="搜索模板">{control=><Input {...control} data-search placeholder="输入模板里的词" value={keyword} disabled={disabled} onChange={e=>setKeyword(e.target.value)}/>}</Field></div>}
        </fieldset>
        {mine ? <>
          <div className="support-phrase-add"><Textarea aria-label="新增常用语" rows={2} maxLength={500} placeholder="新增一条常用语，仅自己可见" value={phraseDraft} disabled={disabled||phraseBusy} onChange={e=>setPhraseDraft(e.target.value)}/><Button size="sm" variant="primary" disabled={disabled||phraseBusy||!phraseDraft.trim()} onClick={()=>void changePhrases(()=>supportPhraseClient.add(phraseDraft.trim()))}>保存</Button></div>
          {phraseError&&<p className="support-content-state" role="alert">{phraseError}</p>}
          {!phrases ? <p className="support-content-state" role="status">{phraseError?"常用语加载失败。":"正在加载常用语…"}</p> : !phrases.filter(p=>!keyword.trim()||p.content.includes(keyword.trim())).length ? <p className="support-content-state">{phrases.length?"没有匹配的常用语。":<>还没有常用语。 <Explain label="常用语怎么用" content="保存后点一下即可插入输入框。"/></>}</p> : <div className="sku-pop-list" data-short="">{phrases.filter(p=>!keyword.trim()||p.content.includes(keyword.trim())).map(p=><div className="support-phrase-row" key={p.id}><button type="button" className="l-btn sm sku-pop-item support-content-result" title="插入输入框，不会直接发送" disabled={disabled} onClick={()=>{onInsert(p.content);setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-title">{p.content}</span></span><Icon name="arrow" size={15}/></button><Button size="sm" aria-label="删除这条常用语" disabled={disabled||phraseBusy} onClick={()=>void changePhrases(()=>supportPhraseClient.remove(p.id))}>删除</Button></div>)}</div>}
        </> : <>
        {templates.length>0&&<p className="support-content-meta">{filtered.length} 条已发布内容</p>}
        {!available && !templates.length ? <div className="support-content-state" role="status">模板加载失败。<Button size="sm" disabled={templateBusy||disabled} onClick={()=>void retryTemplates()}>{templateBusy?"正在加载模板…":"重试模板与话术"}</Button>{templateError&&<span role="alert">{templateError}</span>}</div> : !filtered.length ? templates.length ? <p className="support-content-state">没有匹配的内容，换个词或分组再试。</p> : <BlockState state="empty" title={`还没有已发布的${templateType === "reply" ? "回复模板" : "专属客服话术"}`} detail="要新增，找主管到「服务规则与话术」发布；也可以切到「我的常用语」自己存。" /> : <div className="sku-pop-list" data-short="">{filtered.map(t=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={t.id} title="插入输入框，不会直接发送" disabled={disabled} onClick={()=>{onInsert(t.text);setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-sub">{scriptGroupLabel(t.group || (t.type==="advisor"?"专属客服":"客服"))}</span><span className="sku-pop-body">{t.text}</span></span><Icon name="arrow" size={15}/></button>)}</div>}
        </>}
      </div> : picker==="faq" ? <div className="support-content-body">
        <div className="support-content-search"><Field label="搜索常见问题">{control=><Input {...control} data-search placeholder="输入问题或答案里的词" value={faqQuery} autoFocus disabled={disabled} onChange={e=>setFaqQuery(e.target.value)}/>}</Field></div>
        <p className="support-content-meta">{faqAvailable ? faqMatches.length : "-"} 条已发布问答 <Explain label="怎么用问答" content="点一下把答案插入输入框，不会直接发送。"/></p>
        {!faqAvailable ? (ctx.contentLoading ? <p className="support-content-state" role="status">正在加载知识库…</p> : <div className="support-content-state" role="alert">知识库加载失败。<Button size="sm" disabled={faqBusy||disabled} onClick={()=>void retryFaqs()}>{faqBusy?"正在加载知识库…":"重试知识库"}</Button>{faqError&&<span>{faqError}</span>}</div>) : !faqMatches.length ? <p className="support-content-state">{faqs.length ? "没有匹配的问答。" : "知识库暂无已发布的中文问答。"}</p> : <div className="sku-pop-list" data-short="">{faqMatches.map(f=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={f.id} title="插入输入框，不会直接发送" disabled={disabled} onClick={()=>{onInsert(f.answer);setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-title">{f.question}</span><span className="sku-pop-sub">{f.answer}</span></span><Icon name="arrow" size={15}/></button>)}</div>}
      </div> : picker==="sku" ? <div className="support-content-body">
        <Field label="搜索商品名称或编号">{control=><Input {...control} data-search placeholder="输入商品名称或编号" value={skuQuery} disabled={disabled} onChange={e=>{setSkuQuery(e.target.value);setSkuPage(1);}}/>}</Field>
        {disabled&&!skus?<p className="support-content-state" role="status">现在不能推荐商品：当前不能发消息，或上一个操作还没结束。</p>:error?<div className="support-content-state" role="alert">{error}<Button size="sm" disabled={disabled} onClick={()=>setSkuRetry(n=>n+1)}>重试商品</Button></div>:!skus?<p className="support-content-state" role="status">{skuBusy?"正在加载在售商品…":"在售商品还没加载。"}</p>:<>
          {!skus.length&&<p className="support-content-state">没有匹配的在售商品。</p>}
          <div className="sku-pop-list" data-short="">{skus.map(s=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={s.id} title="选这件商品，发送前可以取消" disabled={disabled} onClick={()=>{onSelect({kind:"SKU",skuId:s.id,name:(s.name)});setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-title">{(s.name)}</span></span>{s.price!==undefined&&<span className="support-content-price">{s.price.toLocaleString("en-US",{minimumFractionDigits:2})} USDT</span>}<Icon name="arrow" size={15}/></button>)}</div>
          {total>10&&<div className="support-content-pager"><Button size="sm" disabled={skuPage<=1||disabled} onClick={()=>setSkuPage(n=>n-1)}>上一页</Button><span>第 {skuPage} 页 · {total} 件</span><Button size="sm" disabled={skuPage*10>=total||disabled} onClick={()=>setSkuPage(n=>n+1)}>下一页</Button></div>}
        </>}
      </div> : <div className="sku-pop-list">{(["HOME","WALLET","SUPPORT"] as const).map(type=><button type="button" className="l-btn sm sku-pop-item support-content-result" key={type} title="选这个页面，发送前可以取消" disabled={disabled} onClick={()=>{onSelect({kind:"LINK",linkTarget:{type,params:{}},name:{HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[type]});setPicker(null);}}><span className="sku-pop-info"><span className="sku-pop-title">{ {HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[type]}</span></span><Icon name="arrow" size={15}/></button>)}</div>}
      </div>
    </Modal></div>, document.body)}
  </div>;
}
