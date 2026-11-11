"use client";
import { avatarFileHash } from "@/lib/admin/account-avatar-pending";
import { userNicknameText } from "@/lib/admin/brand-copy";

import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportEnhancements, parseBulkJob, type BulkFilters, type BulkCandidatePage, type BulkPreview, type BulkContent, type BulkJob, type BulkRecipient, type SupportProfile } from "@/lib/admin/m-support-enhancements";
import { supportClient, SupportClientError, isIndeterminateSupportError } from "@/lib/admin/m-support-client";
import { RETRY_EXPIRED_TEXT, createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Modal } from "../design-kit";
import { Button, Check, Explain, Fact, Facts, Field, Fold, Input, Notice, Pager, RecordList, Select, StatusTag, Table, Td, Textarea, Th, Tr } from "@/app/components/rd";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { useReasonRule } from "@/lib/admin/use-reason-rule";
import { businessOffsetMinutes, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { SupportContentTools, type SelectedSupportContent } from "./support-content-tools";
import type { MCtx } from "./types";
type Stored = PendingMutationRecord & { actorId:number; payload:BulkContent; batchId?:string; readOnlyRecovery?:boolean; action?:"cancel"|"retry"; mutation?:{expectedVersion:number;reason:string} };
type UploadPending = PendingMutationRecord & { actorId: number; clientUploadId: string; hash: string; fileName: string; fileMime: string; assetExpiresAt?: number };
const uploads = createPendingMutationStore<UploadPending>({ storageKey: "nexion-support-bulk-attachment-v1", retainExpiredRecords: true, isValidRecord: r => Number.isSafeInteger(r.actorId) && typeof r.clientUploadId === "string" && typeof r.hash === "string" && typeof r.fileName === "string" && typeof r.fileMime === "string" });
const commands=createPendingMutationStore<Stored>({storageKey:"nexion-support-bulk-pending",retainExpiredRecords:true,isValidRecord:r=>Number.isSafeInteger(r.actorId)&&Boolean(r.payload?.selectionId)});
const conversationReasonText:Record<string,string>={
  // Kept for batches created before closed conversations were included (D-6); customer threads are now resumed.
  CONVERSATION_CLOSED:"原会话已结束，本次未发送（旧批次记录）。现在重新圈选会在该客户的会话中继续发送。",
  CONVERSATION_TRANSFERRED:"原会话正在转接，本次不发送。请等待接待归属确定后重新圈选。",
  CONVERSATION_ARCHIVED:"原会话已归档，本次不发送。请查看原会话并核对归档状态，恢复为可发送状态后重新圈选。",
  CONVERSATION_CONVERTED:"原会话已转工单，本次不发送。请查看原会话并继续处理关联工单。",
  CONVERSATION_NOT_WRITABLE:"原会话正在转接或不可发送，本次不发送。请查看原会话，确认有可发送会话后重新圈选。",
  SUPPORT_BULK_CONVERSATION_CHANGED:"客户会话已变化，本次不发送。请核对当前会话后重新圈选。",
};
const reasonText:Record<string,string>={...conversationReasonText,STOPPED:"不再维护",MAINTENANCE_STOPPED:"不再维护",NOT_CURRENT_CUSTOMER:"当前非本人客户",EXPLICITLY_EXCLUDED:"手动排除",FILTER_MISMATCH:"不符合筛选",ACTIVITY_UNKNOWN:"活动状态未知",LEVEL_UNKNOWN:"等级未知",MAINTENANCE_UNKNOWN:"维护状态未知",REGISTRATION_UNKNOWN:"注册时间未知",FINANCE_UNKNOWN:"资金来源未知",FINANCE_ERROR:"资金加载失败"};
const stateText:Record<string,string>={QUEUED:"等待执行",RUNNING:"正在执行",COMPLETED:"执行结束",CANCELLED:"已取消剩余",PENDING:"待处理",SENT:"已提交",FAILED:"失败",SKIPPED:"跳过"};
// 日期框按业务时区算当天 0 点，全站时间口径一致。
const dayStart=(v:string)=>v?new Date(Date.parse(v+"T00:00:00Z")-businessOffsetMinutes()*60000).toISOString():undefined;
const dayOf=(v:unknown)=>typeof v==="string"?new Date(Date.parse(v)+businessOffsetMinutes()*60000).toISOString().slice(0,10):"";
const recipientTone=(r:BulkRecipient)=>r.resultCertainty==="UNKNOWN"?"warn" as const:r.state==="SENT"?"ok" as const:r.state==="FAILED"?"danger" as const:r.state==="PENDING"?"progress" as const:"done" as const;
const isBulkPreviewDenied = (error: unknown) => error instanceof SupportClientError && error.status === 403
  && ["SUPPORT_AGENT_UNAVAILABLE", "SUPPORT_SCOPE_FORBIDDEN", "SUPPORT_WRITE_FORBIDDEN"].includes(error.backendMessage ?? "");
const bulkPreviewError = (error: unknown) => error instanceof SupportClientError
  && error.status === 403 && error.backendMessage === "SUPPORT_AGENT_UNAVAILABLE"
  ? "当前账号没有可用的专属客服资格，暂不能圈选群发。请联系客服主管核对接待资格，再由可接待的专属客服账号操作。"
  : error instanceof SupportClientError && error.status === 403 && error.backendMessage === "SUPPORT_SCOPE_FORBIDDEN"
  ? "你没有权限查看这位专属客服的客户名单。群发只能发给你当前本人的客户，请由对应的专属客服操作；主管可以继续查看会话。"
  : error instanceof SupportClientError && error.status === 403 && error.backendMessage === "SUPPORT_WRITE_FORBIDDEN"
  ? "当前账号的群发操作权限已失效，已清除原客户名单和选择。请由具有群发权限的专属客服操作。"
  : displayAdminError(error);
export const hasBulkPending=(actorId:number)=>commands.list().some(r=>r.actorId===actorId) || uploads.list().some(r=>r.actorId===actorId);
export function SupportBulkComposer({ctx,onClose,createBlocked}:{ctx:MCtx;onClose:()=>void;createBlocked?:string}) {
  const session=useAdminAuth(s=>s.session),epoch=useAdminAuth(s=>s.authEpoch),actorId=session?.adminId??0;
  const canWrite=session?.role==="super"||session?.role==="superadmin"||Boolean(session?.authorities.includes("service_m3_write"));
  const scopeKey=`${epoch}:${actorId}:${session?.role}:${session?.authorities.join(",")}`, [scopeOwner,setScopeOwner]=useState(scopeKey);
  const [historyOpen,setHistoryOpen]=useState(Boolean(createBlocked)),[previewList,setPreviewList]=useState("included");
  const [step,setStep]=useState(1),[filters,setFilters]=useState<BulkFilters>({}),[storedQuery,setQuery]=useState<(BulkCandidatePage & {requestKey:string})|null>(null),[selection,setSelection]=useState<BulkPreview|null>(null);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[page,setPage]=useState(1),[profiles,setProfiles]=useState<Record<string,SupportProfile>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0),[filterDraft,setFilterDraft]=useState<BulkFilters>({});
  const [previewUnknown,setPreviewUnknown]=useState(false),[notReceived,setNotReceived]=useState(false);
  const [previewDenied,setPreviewDenied]=useState(false),[identities,setIdentities]=useState<Record<string,{nickname:string;userNo:string}>>({});
  const [text,setText]=useState(""),[intent,setIntent]=useState<"SERVICE"|"MAINTENANCE">("SERVICE"),[choice,setChoice]=useState<SelectedSupportContent|null>(null),[reason,setReason]=useState(""),[reasonLeft,setReasonLeft]=useState(false),[ack,setAck]=useState(false);
  const [draftOwner,setDraftOwner]=useState(0);
  const [image,setImage]=useState<{file:File;url:string;id:string;key:string;hash:string;assetId?:string;ttlSeconds:number|null;assetExpiresAt?:number}|null>(null),[uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState("");
  const [job,setJob]=useState<BulkJob|null>(null),[jobs,setJobs]=useState<BulkJob[]|null>(null),[jobsTotal,setJobsTotal]=useState(0),[jobsPage,setJobsPage]=useState(1),[jobsError,setJobsError]=useState("");
  const [recipients,setRecipients]=useState<BulkRecipient[]|null>(null),[recipientTotal,setRecipientTotal]=useState(0),[recipientPage,setRecipientPage]=useState(1),[resultRetry,setResultRetry]=useState(0),[resultError,setResultError]=useState("");
  const [pending,setPending]=useState<Stored|null>(null),[mutationAction,setMutationAction]=useState<"cancel"|"retry"|null>(null),[mutationReason,setMutationReason]=useState("");
  const generation=useRef(0),stamp=useRef("");stamp.current=`${scopeKey}:${generation.current}`;
  const queryKey=JSON.stringify([scopeKey,filters,page]),requestKey=useRef(queryKey);requestKey.current=queryKey;
  const query=storedQuery?.requestKey===queryKey?storedQuery:null;
  const imageRef=useRef(image);imageRef.current=image;
  const imageSelection=useRef(0);
  const composerRef=useRef<HTMLTextAreaElement>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{const handle=()=>{generation.current++;for(const record of commands.list())if(record.actorId===actorId)commands.remember(record.fingerprint,record.commandKey,{actorId:record.actorId,payload:record.payload,batchId:record.batchId,action:record.action,mutation:record.mutation,readOnlyRecovery:true});try{sessionStorage.removeItem(`nexion-bulk-draft:${actorId}`);}catch{}setDraftOwner(0);setPending(null);stamp.current=`${scopeKey}:${generation.current}`;setSelected(new Set());setIdentities({});setProfiles({});setSelection(null);setQuery(null);setText("");setChoice(null);setJob(null);setRecipients(null);onClose();};window.addEventListener("support-scope-invalidated",handle);return()=>window.removeEventListener("support-scope-invalidated",handle);},[actorId,epoch,onClose]);
  useEffect(()=>{if(scopeOwner===scopeKey)return;setScopeOwner(scopeKey);setSelected(new Set());setIdentities({});setProfiles({});setSelection(null);setQuery(null);setJob(null);setRecipients(null);setJobs(null);setPending(null);setStep(1);setBusy(false);setUploading(false);setFilters({});setFilterDraft({});setPage(1);setChoice(null);setReason("");setAck(false);setUploadError("");imageSelection.current++;if(imageRef.current)URL.revokeObjectURL(imageRef.current.url);setImage(null);},[scopeKey]);
  useEffect(()=>{const old=commands.list().find(r=>r.actorId===actorId);if(old){setPending(old);setStep(3);setError(isRetryExpired(old)?RETRY_EXPIRED_TEXT:"原操作结果待确认，请查询原命令。");}},[scopeKey]);
  useEffect(()=>{if(!actorId)return;try{const saved=JSON.parse(sessionStorage.getItem(`nexion-bulk-draft:${actorId}`)??"{}");setText(typeof saved.text==="string"?saved.text:"");setIntent(saved.intent==="MAINTENANCE"?"MAINTENANCE":"SERVICE");}catch{setError("群发草稿暂不能恢复，请在本页核对。");}setDraftOwner(actorId);},[actorId,epoch]);
  useEffect(()=>{if(!actorId||draftOwner!==actorId)return;try{sessionStorage.setItem(`nexion-bulk-draft:${actorId}`,JSON.stringify({text,intent}));}catch{setError("群发草稿无法保存在浏览器里，请在本页一次完成。");}},[actorId,draftOwner,text,intent]);
  // 开发模式的重挂载也走这里：重新挂上时先把 stamp 对回来，不然后面的读取都被判成过期，名单一直停在加载中。
  useEffect(()=>{stamp.current=`${scopeKey}:${generation.current}`;return()=>{generation.current++;stamp.current=`unmounted:${generation.current}`;imageSelection.current++;const current=imageRef.current;if(current)URL.revokeObjectURL(current.url);imageRef.current=null;};},[]);
  useEffect(()=>{
    if(createBlocked)return;
    const controller=new AbortController(),saved=queryKey,owner=stamp.current;setQuery(null);setError("");setPreviewDenied(false);
    supportEnhancements.bulkCandidates(filters,page,controller.signal).then(v=>{if(controller.signal.aborted||saved!==requestKey.current||owner!==stamp.current)return;if(v.actorId!==actorId)throw new SupportClientError(403,403,"SUPPORT_SCOPE_FORBIDDEN");if(v.pageNum!==page)throw new Error("SUPPORT_CANDIDATE_PAGE_INVALID");if(page>1&&page>Math.max(1,Math.ceil(v.total/10))){setPage(Math.max(1,Math.ceil(v.total/10)));return;}setQuery({...v,requestKey:saved});setIdentities(old=>({...old,...Object.fromEntries(v.records.map(c=>[c.id,{nickname:c.nickname,userNo:c.userNo}]))}));}).catch(e=>{if(!controller.signal.aborted&&saved===requestKey.current&&owner===stamp.current){setError(bulkPreviewError(e));setPreviewUnknown(!isBulkPreviewDenied(e));setPreviewDenied(isBulkPreviewDenied(e));if(isBulkPreviewDenied(e)){setSelected(new Set());setIdentities({});setProfiles({});setSelection(null);}}});
    return()=>controller.abort();
  },[filters,page,retry,scopeKey,createBlocked]);
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending]);
  const reasonRule=useReasonRule(step>=3&&!pending);
  const moreCount=(["level","currency","registeredFrom","registeredTo","activityFrom","activityTo","depositMin","depositMax","withdrawalMin","withdrawalMax"] as const).filter(key=>filters[key]!==undefined&&filters[key]!=="").length+(filters.tagIds?.length?1:0)+(filters.includeUnknown?1:0);
  const pageRows=query?.records??[];
  useEffect(()=>{
    if(!query)return;const controller=new AbortController(),owner=stamp.current;
    Promise.allSettled(pageRows.map(c=>supportEnhancements.profile(c.id,controller.signal))).then(results=>{if(controller.signal.aborted||owner!==stamp.current)return;setProfiles(old=>{const next={...old};results.forEach((r,i)=>{if(r.status==="fulfilled")next[pageRows[i].id]=r.value;else delete next[pageRows[i].id];});return next;});});
    return()=>controller.abort();
  },[query,scopeKey]);
  useEffect(()=>{
    const controller=new AbortController(),owner=stamp.current;setJobs(null);setJobsError("");
    supportEnhancements.bulkJobs(jobsPage,controller.signal).then(p=>{if(!controller.signal.aborted&&owner===stamp.current){setJobs(p.records);setJobsTotal(p.total);}}).catch(e=>{if(!controller.signal.aborted&&owner===stamp.current)setJobsError(displayAdminError(e));});
    return()=>controller.abort();
  },[jobsPage,resultRetry,scopeKey]);
  useEffect(()=>{
    if(!job)return;const controller=new AbortController(),owner=stamp.current;let timer:ReturnType<typeof setTimeout>|undefined;
    const read=async()=>{const results=await Promise.allSettled([supportEnhancements.bulkJob(job.batchId,controller.signal),supportEnhancements.bulkRecipients(job.batchId,recipientPage,controller.signal)]);if(controller.signal.aborted||owner!==stamp.current)return;
      let failure="";if(results[0].status==="fulfilled"){setJob(results[0].value);if(["QUEUED","RUNNING"].includes(results[0].value.state))timer=setTimeout(()=>void read(),3000);}else failure=displayAdminError(results[0].reason);
      if(results[1].status==="fulfilled"){setRecipients(results[1].value.records);setRecipientTotal(results[1].value.total);}else{setRecipients(null);failure=displayAdminError(results[1].reason);}setResultError(failure);
    };setRecipients(null);void read();return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[job?.batchId,recipientPage,resultRetry,scopeKey]);
  // 逐客结果只给客户编号，名字用已有资料，缺的按这一页去读。
  useEffect(()=>{
    const missing=(recipients??[]).map(r=>r.customerId).filter(id=>!identities[id]);if(!missing.length)return;
    const controller=new AbortController(),owner=stamp.current;
    Promise.allSettled(missing.map(id=>supportEnhancements.profile(id,controller.signal))).then(results=>{if(controller.signal.aborted||owner!==stamp.current)return;setIdentities(old=>{const next={...old};results.forEach((r,i)=>{const data=r.status==="fulfilled"?r.value.identity.data:null;if(data?.userNo)next[missing[i]]={nickname:String(data.nickname??"客户"),userNo:String(data.userNo)};});return next;});});
    return()=>controller.abort();
  },[recipients,scopeKey]);
  const setFilter=(key:keyof BulkFilters,value:unknown)=>setFilterDraft(f=>({...f,[key]:value===""?undefined:value}));
  const levels=[...new Set(Object.values(profiles).flatMap(p=>typeof p.identity.data?.level==="string"?[p.identity.data.level]:[]))];
  const currencies=[...new Set(Object.values(profiles).flatMap(p=>Array.isArray(p.finance.data?.byCurrency)?p.finance.data.byCurrency.map((v:Record<string,unknown>)=>v.currency).filter((v):v is string=>typeof v==="string"):[]))];
  const insert=(value:string)=>{const start=composerRef.current?.selectionStart??text.length,end=composerRef.current?.selectionEnd??start;setText(text.slice(0,start)+value+text.slice(end));requestAnimationFrame(()=>{composerRef.current?.focus();composerRef.current?.setSelectionRange(start+value.length,start+value.length);});};
  async function selectAll(){if(busy||previewDenied||!query)return;const saved=stamp.current,key=requestKey.current;setBusy(true);setError("");setSelection(null);setAck(false);setPreviewUnknown(false);try{await supportEnhancements.bulkCandidates(filters,1);const next=await supportEnhancements.bulkPreview({filters,customerIds:[],excludedIds:[],selectionMode:"ALL_FILTERED"});if(saved!==stamp.current||key!==requestKey.current)return;if(next.actorId!==actorId)throw new SupportClientError(403,403,"SUPPORT_SCOPE_FORBIDDEN");setIdentities(old=>({...old,...Object.fromEntries(next.customers.filter(c=>c.userNo).map(c=>[c.id,{nickname:c.nickname??"客户",userNo:c.userNo!}]))}));setSelected(old=>new Set([...old,...next.customers.map(c=>c.id)]));}catch(e){if(saved===stamp.current&&key===requestKey.current){setError(bulkPreviewError(e));setPreviewUnknown(!isBulkPreviewDenied(e));setPreviewDenied(isBulkPreviewDenied(e));if(isBulkPreviewDenied(e)){setQuery(null);setSelected(new Set());setIdentities({});setProfiles({});setSelection(null);}}}finally{if(saved===stamp.current)setBusy(false);}}
  async function freeze(){if(!selected.size||busy||previewDenied)return;const saved=stamp.current;setBusy(true);setError("");setSelection(null);setAck(false);setPreviewUnknown(false);try{await supportEnhancements.bulkCandidates(filters,1);const next=await supportEnhancements.bulkPreview({filters:{...filters,keyword:undefined},customerIds:[...selected],excludedIds:[],selectionMode:"CROSS_PAGE"});if(saved!==stamp.current)return;if(next.actorId!==actorId)throw new SupportClientError(403,403,"SUPPORT_SCOPE_FORBIDDEN");if(!next.count){setSelection(next);setError("所选客户均被排除，请核对名单。已保留选择，可逐项移除或清空。");return;}setIdentities(old=>({...old,...Object.fromEntries(next.customers.filter(c=>c.userNo).map(c=>[c.id,{nickname:c.nickname??"客户",userNo:c.userNo!}]))}));setSelection(next);setAck(false);setStep(2);}catch(e){if(saved===stamp.current){setError(bulkPreviewError(e));setPreviewUnknown(!isBulkPreviewDenied(e));setPreviewDenied(isBulkPreviewDenied(e));if(isBulkPreviewDenied(e)){setQuery(null);setSelected(new Set());setIdentities({});setProfiles({});setSelection(null);}}}finally{if(saved===stamp.current)setBusy(false);}}
  async function chooseFile(file?: File) {
    if (!file || busy || uploading) return;
    const chosen = ++imageSelection.current, saved = stamp.current; setUploadError("");
    try {
      const original = uploads.list().find(r => r.actorId === actorId);
      if (original && (isRetryExpired(original) || original.assetExpiresAt === undefined || Date.now() >= original.assetExpiresAt)) throw new Error("原图片上传已超过图片有效期或 24 小时，只能核对原结果，不能重新上传。");
      const policy = await supportClient.attachmentPolicy();
      if (saved !== stamp.current || chosen !== imageSelection.current) return;
      if (!policy.available || !policy.allowedMimeTypes.includes(file.type as "image/png" | "image/jpeg") || policy.maxBytes !== null && file.size > policy.maxBytes) throw new Error("请选择符合当前格式及大小要求的图片。");
      const decoded = await createImageBitmap(file); const pixels = decoded.width * decoded.height; decoded.close();
      if (policy.maxPixels !== null && pixels > policy.maxPixels) throw new Error("图片像素超过当前上限。");
      const hash = await avatarFileHash(file);
      if (saved !== stamp.current || chosen !== imageSelection.current) return;
      if (original && (original.hash !== hash || original.fileMime !== file.type)) throw new Error("原上传结果待确认，请选择首次上传的同一张图片，不能换图重发。");
      const exactFile = original ? new File([file], original.fileName, { type: original.fileMime }) : file;
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.url); setChoice(null);
      setImage({ file: exactFile, url: URL.createObjectURL(exactFile), id: original?.clientUploadId ?? crypto.randomUUID(), key: original?.commandKey ?? crypto.randomUUID(), hash, ttlSeconds: policy.ttlSeconds, assetExpiresAt: original?.assetExpiresAt });
    } catch (e) { if (saved === stamp.current && chosen === imageSelection.current) setUploadError(e instanceof Error && /^(原|图片|请选择)/.test(e.message) ? e.message : displayAdminError(e)); }
  }
  async function upload() {
    if (!image || uploading || image.assetId) return;
    const saved = stamp.current, current = image, fingerprint = `bulk-attachment:${actorId}`;
    const old = uploads.list().find(r => r.actorId === actorId);
    if (old && (old.commandKey !== current.key || isRetryExpired(old) || old.assetExpiresAt === undefined || Date.now() >= old.assetExpiresAt)) { setUploadError("原上传结果仍待确认或已超过图片有效期，不能另发上传；请联系管理员核对。"); return; }
    if (!old && current.ttlSeconds === null) { setUploadError("图片有效期尚未确认，请重读发送规则后再上传。"); return; }
    const assetExpiresAt = old?.assetExpiresAt ?? Date.now() + current.ttlSeconds! * 1000;
    uploads.remember(fingerprint, current.key, { actorId, clientUploadId: current.id, hash: current.hash, fileName: current.file.name, fileMime: current.file.type, assetExpiresAt });
    if (!uploads.isDurablyStored(fingerprint, current.key)) { uploads.forget(fingerprint, current.key); setUploadError("无法保存原上传记录，还未上传；请恢复会话存储后重试。"); return; }
    setUploading(true); setUploadError("");
    try {
      const asset = await supportEnhancements.bulkUpload(current.file, current.id, current.key);
      if (saved !== stamp.current || imageRef.current?.id !== current.id) return;
      uploads.forget(fingerprint, current.key); setImage({ ...current, assetId: asset.assetId, assetExpiresAt });
    } catch (e) { if (saved === stamp.current) { if (!old && isExplicitRejection(e)) uploads.forget(fingerprint, current.key); setUploadError("图片上传结果待确认，原文件校验、上传编号和命令号已保留。" + displayAdminError(e)); } }
    finally { if (saved === stamp.current) setUploading(false); }
  }
  const input:BulkContent|undefined=selection?{selectionId:selection.selectionId,intent,kind:image?"IMAGE":choice?.kind??"TEXT",content:text.trim(),skuId:choice?.kind==="SKU"?choice.skuId:undefined,linkTarget:choice?.kind==="LINK"?choice.linkTarget:undefined,assetId:image?.assetId,reason:reason.trim()}:undefined;
  const ready=Boolean(!uploads.list().some(r=>r.actorId===actorId)&&input&&selection?.count&&Date.parse(selection.expiresAt)>Date.now()&&reasonRule.ok(reason)&&ack&&(image?image.assetId&&image.assetExpiresAt!==undefined&&Date.now()<image.assetExpiresAt:text.trim()));
  async function submit(recover=false,replay=false,original?:Stored){
    if(!recover&&!original&&image?.assetId&&image.assetExpiresAt!==undefined&&Date.now()>=image.assetExpiresAt){setError("图片已过有效期，请返回编写内容移除旧图并重新准备。");return;}
    if(busy||!recover&&!original?.action&&!ready)return;
    const record=original??pending??(input?{fingerprint:`${actorId}:create`,commandKey:crypto.randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+86400000,actorId,payload:input}:null);if(!record)return;
    commands.remember(record.fingerprint,record.commandKey,{actorId:record.actorId,payload:record.payload,batchId:record.batchId,action:record.action,mutation:record.mutation,readOnlyRecovery:record.readOnlyRecovery});setPending(record);if(!commands.isDurablyStored(record.fingerprint,record.commandKey)){setError("原命令暂不能持久保存，尚未提交；请恢复浏览器存储后用此命令重试。");return;}setBusy(true);setError("");const saved=stamp.current;
    let submitted=false;
    try{
      const recovered=recover?await supportClient.command(record.commandKey).catch(e=>{if(e instanceof SupportClientError&&e.status===404&&e.backendMessage==="SUPPORT_COMMAND_NOT_FOUND")return null;throw e;}):null;
      if(saved!==stamp.current)return;
      if(recovered&&recovered.status!=="SUCCEEDED"&&recovered.status!=="FAILED"){setError("发送结果仍待确认，请稍后查询原命令。");return;}
      if(record.readOnlyRecovery&&recovered?.status!=="SUCCEEDED"&&recovered?.status!=="FAILED"){setError("原操作尚未确认；因归属变化只查询结果，暂不能重新创建或发送。");return;}
      if(recovered?.status==="FAILED"){commands.forget(record.fingerprint);setPending(null);setError("原操作确认失败，输入已保留，请重新核对。");return;}
      if(recover&&!recovered&&!replay){setNotReceived(!isRetryExpired(record));setError(isRetryExpired(record)?RETRY_EXPIRED_TEXT:"尚未找到原回执，原名单与内容仍保留。可在 24 小时内按原操作重试。");return;}
      if(!recovered&&isRetryExpired(record)){setError(RETRY_EXPIRED_TEXT);return;}
      if(!recovered&&(!canWrite||createBlocked)){setError("原操作尚未确认；当前账号没有可用的群发资格，只能查询结果，不能重新发送。");return;}
      if(!recovered)submitted=true;
      const next=recovered?parseBulkJob(recovered.result):record.action&&record.batchId&&record.mutation?await supportEnhancements.bulkMutate(record.batchId,record.action,record.mutation,record.commandKey):await supportEnhancements.bulkCreate(record.payload,record.commandKey);
      if(saved!==stamp.current)return;commands.forget(record.fingerprint);setPending(null);setJob(next);setStep(4);setHistoryOpen(false);setRecipientPage(1);setMutationAction(null);setMutationReason("");setResultRetry(n=>n+1);window.dispatchEvent(new Event("support-todo-changed"));
    }catch(e){if(saved===stamp.current){setError(displayAdminError(e));if(submitted&&!recover&&isExplicitRejection(e)){commands.forget(record.fingerprint);setPending(null);}}}finally{if(saved===stamp.current)setBusy(false);}
  }
  async function mutate(){if(!job||!mutationAction||!reasonRule.ok(mutationReason)||busy||pending)return;const payload=input??{selectionId:"result",intent:"SERVICE" as const,kind:"TEXT" as const,content:"",reason:mutationReason.trim()};const record:Stored={fingerprint:`${actorId}:${job.batchId}:${mutationAction}`,commandKey:crypto.randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+86400000,actorId,payload,batchId:job.batchId,action:mutationAction,mutation:{expectedVersion:job.version,reason:mutationReason.trim()}};commands.remember(record.fingerprint,record.commandKey,{actorId,payload,batchId:record.batchId,action:record.action,mutation:record.mutation});setPending(record);if(!commands.isDurablyStored(record.fingerprint,record.commandKey)){setError("原命令暂不能持久保存，尚未提交，请恢复存储后查询原操作。");return;}await submit(false,false,record);}

  const customerName=(id:string)=>identities[id]?`${userNicknameText(identities[id].nickname,undefined)} · ${identities[id].userNo}`:`系统编号 ${id}`;
  const userCode=(id:string)=>identities[id]?.userNo??`U${id.padStart(8,"0")}`;
  const listName=(id:string)=>identities[id]?userNicknameText(identities[id].nickname,undefined):`系统编号 ${id}`;
  const recipientRecords=(preview:BulkPreview)=>preview.customers.map(c=>{const p=profiles[c.id];return {
    id:c.id, value:userNicknameText(String(identities[c.id]?.nickname??p?.identity.data?.nickname??"客户"),p?.identity.data?.phoneMasked),
    object:<>当前专属客服 {String(p?.service.data?.agentName??"当前本人（已核对）")}</>, reference:String(p?.identity.data?.userNo??userCode(c.id)),
  };});
  const excluded=(preview:BulkPreview)=>preview.excluded.length>0&&<Fold inset title="排除的客户" open={previewList === "excluded"} onOpenChange={open=>setPreviewList(open ? "excluded" : "")} summary={`${preview.excluded.length} 位`}><RecordList label="排除的客户" records={preview.excluded.map(c=>({id:c.id,value:listName(c.id),object:reasonText[c.reason]??"资料或资格不符，需核对",reference:userCode(c.id)}))}/></Fold>;
  if(scopeOwner!==scopeKey)return <Modal title="圈选客户群发" icon="users" onClose={onClose}><p role="status">正在核对当前身份…</p></Modal>;
  const dateFields=[["registeredFrom","注册起日"],["registeredTo","注册止日（不含）"],["activityFrom","活动起日"],["activityTo","活动止日（不含）"]] as const;
  const moneyFields=[["depositMin","累计充值至少"],["depositMax","累计充值至多"],["withdrawalMin","累计提现至少"],["withdrawalMax","累计提现至多"]] as const;
  const uploadPending = uploads.list().find(r => r.actorId === actorId);
  const cancelBlocked=job&&(job.actorId!==actorId?"只有发起人能操作这个批次":!canWrite?"当前账号只能查看":!job.counts.pending?"没有未提交的客户":pending?"先查询原操作结果":undefined);
  const retryBlocked=job&&(job.actorId!==actorId?"只有发起人能操作这个批次":!canWrite?"当前账号只能查看":!(job.counts.failed||job.counts.unknown)?"没有失败或待确认的客户":pending?"先查询原操作结果":undefined);
  return <Modal title="圈选客户群发" icon="users" wide busy={busy||uploading} onClose={onClose} footer={<div className="m-admin-toolbar"><Button size="sm" disabled={busy||uploading} onClick={onClose}>{step===4?"关闭结果":"退出群发"}</Button>{!historyOpen&&<>{step>1&&step<4&&!pending&&<Button size="sm" disabled={busy} onClick={()=>setStep(n=>n-1)}>上一步</Button>}{step===1&&!createBlocked&&<Button variant="primary" size="sm" disabledReason={!selected.size?"先勾选客户":undefined} disabled={busy||previewDenied||Boolean(pending)} onClick={()=>void freeze()}>{busy?"核对名单…":"下一步：编写内容"}</Button>}{step===2&&<Button variant="primary" size="sm" disabledReason={uploadPending?"先核对原图片上传结果":(image?!image.assetId:!text.trim())?(image?"先上传图片":"先写发送内容"):undefined} onClick={()=>{setStep(3);setAck(false);setPreviewList("included");}}>下一步：确认名单</Button>}{step===3&&!pending&&<Button variant="primary" size="sm" disabled={busy} disabledReason={!ready&&!busy?"先写操作理由并勾选核对":undefined} onClick={()=>void submit()}>{busy?"提交中…":"确认提交群发"}</Button>}</>}{pending&&notReceived&&!isRetryExpired(pending)&&!pending.readOnlyRecovery&&<Button size="sm" disabled={busy} onClick={()=>void submit(true,true)}>按原操作重试</Button>}{pending&&<Button variant="primary" size="sm" disabled={busy} onClick={()=>void submit(true)}>查询原操作结果</Button>}</div>}>
    <div className="ui-support-workflow ui-support-contact-picker rd-stack"><ol className="ui-workflow-steps" aria-label="群发步骤">{["圈选客户","编写内容","确认提交","逐客结果"].map((title,index) => <li key={title} aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "current" : step > index + 1 ? "complete" : ""}><span>{index + 1}</span>{title}</li>)}</ol><p className="rd-sr-only" role="status">第 {step} 步：{["","圈选客户","编写内容","确认提交","逐客结果"][step]}</p>{error&&<Notice tone={pending?"warn":"danger"}>{error}</Notice>}{uploadPending && <Notice tone="warn">原图片上传结果待确认。请选择同一张图片后按原命令重试；超过图片有效期或 24 小时，请联系管理员核对原结果。原命令号 {uploadPending.commandKey}</Notice>}
    {!historyOpen&&<>
    {previewUnknown&&!pending&&<Notice tone="warn" action={<Button disabled={busy} onClick={()=>void freeze()}>重新生成预览</Button>}>重新读取原名单后生成新快照，旧预览的确认作废；这会生成新的预览。</Notice>}
    {step===1&&createBlocked&&<Notice tone="warn">{createBlocked}</Notice>}
    {step===1&&!createBlocked&&<><p className="m-bulk-head">筛选 <Explain label="哪些客户能群发" content="只发送当前本人客户；两种主动群发均排除“不再维护”。选择保持原名单，新匹配客户不会自动加入。"/></p><div className="m-bulk-filters">
      <Field label="搜索昵称、手机号或用户编码">{control=><Input {...control} aria-label="搜索昵称、手机号或用户编码" value={filterDraft.keyword??""} onChange={e=>setFilter("keyword",e.target.value)}/>}</Field>
      <Field label="账户活动">{control=><Select {...control} aria-label="账户活动" value={filterDraft.accountState??""} onChange={value=>setFilter("accountState",value)} options={[{value:"",label:"全部"},{value:"ACTIVE",label:"活跃"},{value:"DORMANT",label:"沉睡"},{value:"UNKNOWN",label:"未知"}]}/>}</Field>
      <Field label="维护状态">{control=><Select {...control} aria-label="维护状态" value={filterDraft.maintenanceState??""} onChange={value=>setFilter("maintenanceState",value)} options={[{value:"",label:"全部"},{value:"ENABLED",label:"正常维护"},{value:"DUE",label:"待维护"},{value:"STOPPED",label:"不再维护（仅核对）"}]}/>}</Field>
    </div><Fold inset title="更多筛选" explain={`日期按${businessZone().label}算。`} summary={moreCount?`${moreCount} 项已生效`:"等级、币种、时间、金额、标签"}><div className="m-bulk-filters">
      <Field label="等级" explain="下拉里只有这一页客户的等级，别的等级直接输入，比如 V1。留空是全部。">{control=><><Input {...control} list="bulk-level-options" placeholder="全部已知及未知" value={filterDraft.level??""} onChange={e=>setFilter("level",e.target.value.trim())}/><datalist id="bulk-level-options">{levels.map(v=><option key={v} value={v}>{nexGridBrandText(v)}</option>)}</datalist></>}</Field>
      <Field label="币种" explain="下拉里只有这一页客户的币种，别的币种直接输入，比如 USDT。按金额筛选时必填。">{control=><><Input {...control} list="bulk-currency-options" placeholder="选择实际币种" value={filterDraft.currency??""} onChange={e=>setFilter("currency",e.target.value.trim().toUpperCase())}/><datalist id="bulk-currency-options">{currencies.map(v=><option key={v} value={v}/>)}</datalist></>}</Field>
      <Field label="自定义标签" explain="写完整的标签名，多个用逗号隔开，客户要同时有这些标签。">{control=><Input {...control} value={(filterDraft.tagIds??[]).join("，")} onChange={e=>setFilter("tagIds",e.target.value?e.target.value.split(/[,，]/).map(v=>v.trimStart()):undefined)}/>}</Field>
      {dateFields.map(([key,label])=><Field key={key} label={label}>{control=><Input {...control} type="date" value={dayOf(filterDraft[key])} onChange={e=>setFilter(key,dayStart(e.target.value))}/>}</Field>)}
      {moneyFields.map(([key,label])=><Field key={key} label={label}>{control=><Input {...control} type="number" min="0" step="any" value={filterDraft[key] as string??""} onChange={e=>setFilter(key,e.target.value)}/>}</Field>)}
    </div><Check label="明确纳入未知来源；未知不等于零金额" checked={filterDraft.includeUnknown===true} onChange={e=>setFilter("includeUnknown",e.target.checked)}/></Fold><div className="m-bulk-row"><Button size="sm" disabled={busy||previewDenied} onClick={()=>{setFilters({...filterDraft,tagIds:filterDraft.tagIds?.map(v=>v.trim()).filter(Boolean)});setPage(1);setQuery(null);}}>查询筛选结果</Button></div>
      <div className="m-bulk-row"><span className="ui-contact-count">已选 {selected.size} 位 <Explain label="已选客户怎么保留" content="翻页、换搜索条件都保留已选客户。"/></span><Button size="sm" disabled={busy||!selected.size} onClick={()=>{setSelected(new Set());setSelection(null);setPreviewList("included");}}>清空选择</Button></div>
      {selected.size>0&&<Fold inset title={`查看已选客户 ${selected.size} 位`} open={previewList === "selected"} onOpenChange={open=>setPreviewList(open ? "selected" : "included")} summary={`当前页外 ${Array.from(selected).filter(id=>!pageRows.some(c=>c.id===id)).length} 位`}><RecordList label="已选客户" records={Array.from(selected).map(id=>({id,value:listName(id),reference:userCode(id),status:<Button size="sm" disabled={busy} aria-label={`移除已选客户 ${id}`} onClick={()=>{if(selected.size===1)setPreviewList("included");setSelected(old=>{const next=new Set(old);next.delete(id);return next;});}}>移除</Button>}))}/></Fold>}
      {previewList !== "selected" && <>{!query?<p role="status">{error?!previewDenied&&<Button size="sm" onClick={()=>setRetry(n=>n+1)}>重新加载名单</Button>:"正在加载名单…"}</p>:<><div className="m-bulk-row"><span>当前筛选可选 {query.selectableCount} 位 · 匹配 {query.total} 位</span><span className="m-bulk-row-tools"><Button size="sm" disabled={busy||!pageRows.some(c=>!c.reason)} onClick={()=>setSelected(old=>new Set([...old,...pageRows.filter(c=>!c.reason).map(c=>c.id)]))}>选择本页</Button><Button size="sm" disabled={busy||!query.selectableCount} onClick={()=>void selectAll()}>选择当前全部筛选结果</Button></span></div>
      {!pageRows.length?<p role="status">没有匹配的客户，已选名单保留。</p>:<ul className="ui-contact-list ui-bulk-contact-list">{pageRows.map(c=><li key={c.id}><label><input type="checkbox" aria-label={`选择客户 ${c.id}`} checked={selected.has(c.id)} disabled={busy||Boolean(c.reason)} onChange={e=>setSelected(old=>{const n=new Set(old);if(e.target.checked)n.add(c.id);else n.delete(c.id);return n;})}/><span className="ui-contact-identity"><strong>{userNicknameText(c.nickname,undefined)}</strong><small>{c.userNo}</small><small>{c.reason?reasonText[c.reason]??"不符合当前范围":profiles[c.id]?.service.data?.agentName?String(profiles[c.id]?.service.data?.agentName):"当前本人归属（已核对）"}</small></span></label></li>)}</ul>}
      {query.total>0&&<Pager label="客户名单" total={query.total} page={page} pageSize={10} sizes={[10]} loading={busy} onPage={setPage} onPageSize={()=>undefined}/>}</>}
      {selection&&excluded(selection)}
    </>}</>}
    {step===2&&selection&&<><p className="m-bulk-head">名单已确定，共 {selection.count} 位 <Explain label="返回修改" content="内容返回修改时保留。"/></p><Field label="本条消息用途" explain="普通服务不计维护；联系维护仅在消息成功提交后计一次，后续新的有效活动才形成成功维护。群发不清待回复。">{control=><Select {...control} aria-label="本条消息用途" value={intent} onChange={value=>setIntent(value as "SERVICE"|"MAINTENANCE")} options={[{value:"SERVICE",label:"普通服务"},{value:"MAINTENANCE",label:"联系维护"}]}/>}</Field><SupportContentTools ctx={ctx} disabled={uploading || Boolean(uploadPending)} onInsert={insert} onSelect={v=>{if(image)URL.revokeObjectURL(image.url);setImage(null);setChoice(v);if(!text.trim())setText(v.kind==="SKU"?"推荐商品："+v.name:"查看："+v.name);}}/>{choice&&<div className="m-bulk-row"><span>已选：{choice.name}</span><Button size="sm" onClick={()=>setChoice(null)}>取消推荐</Button></div>}<Field label="发送文案">{control=><Textarea {...control} ref={composerRef} aria-label="群发文案" rows={4} maxLength={10000} value={text} onChange={e=>setText(e.target.value)}/>}</Field><Field label="群发图片">{control=><><input {...control} ref={fileRef} type="file" hidden accept="image/jpeg,image/png" disabled={uploading} onChange={e=>{void chooseFile(e.target.files?.[0]);e.target.value="";}}/><div><Button size="sm" disabled={uploading} onClick={()=>fileRef.current?.click()}>选择图片</Button></div></>}</Field>{image&&<div><img src={image.url} alt="群发图片预览" className="rd-thumb"/><p>{image.assetId?"已上传，尚未发送":uploading?"正在上传…":"尚未上传"}</p><div className="m-bulk-row-tools"><Button size="sm" disabled={uploading||Boolean(image.assetId)} onClick={()=>void upload()}>上传或重试图片</Button><Button size="sm" disabled={uploading || Boolean(uploadPending)} onClick={()=>{URL.revokeObjectURL(image.url);setImage(null);}}>移除图片</Button></div></div>}{uploadError&&<p role="alert">{uploadError}</p>}{excluded(selection)}</>}
    {step===3&&<>{pending?<div className="rd-stack"><Notice tone="warn">{isRetryExpired(pending)?RETRY_EXPIRED_TEXT:"已保存原操作号，查询和重试使用完全相同的名单及内容。"}</Notice><Facts><Fact k="原操作">{pending.action === "cancel" ? "取消未提交项" : pending.action === "retry" ? "核对重试失败项" : "创建群发批次"}</Fact><Fact k={pending.batchId ? "原批次" : "原名单快照"}><span data-mono>{pending.batchId ?? pending.payload.selectionId}</span></Fact><Fact k="原理由">{pending.mutation?.reason ?? pending.payload.reason}</Fact>{pending.mutation && <Fact k="原批次版本">{pending.mutation.expectedVersion}</Fact>}{!pending.action && !pending.readOnlyRecovery && <><Fact k="原用途">{pending.payload.intent === "MAINTENANCE" ? "联系维护" : "普通服务"}</Fact><Fact k="原发送内容"><span className="rd-pre">{pending.payload.content}</span></Fact></>}</Facts><Fold inset title="原命令与内容编号" summary="保留原资料"><Facts><Fact k="原命令号"><span data-mono>{pending.commandKey}</span></Fact>{pending.payload.assetId && <Fact k="原图片编号"><span data-mono>{pending.payload.assetId}</span></Fact>}</Facts></Fold></div>:selection&&<><Facts><Fact k="发送给" lead unit="位客户">{selection.count}</Fact><Fact k="发送身份">当前专属客服本人</Fact><Fact k="用途">{intent==="SERVICE"?"普通服务":"联系维护"}</Fact><Fact k="内容类型">{image?"图片":choice?.kind==="SKU"?"商品推荐":choice?.kind==="LINK"?"页面链接":"文字"}</Fact><Fact k="发送内容"><span className="rd-pre">{text}</span>{choice&&<div>{choice.name}</div>}{image&&<img src={image.url} alt="确认群发图片" className="rd-thumb"/>}</Fact><Fact k="预览有效期至">{formatBusinessTimeCompact(selection.expiresAt)}（{businessZone().label}）<Explain label="预览过期怎么办" content="过期请返回选人重新核对。"/></Fact></Facts><Fold inset title="发送名单" open={previewList === "included"} onOpenChange={open=>setPreviewList(open ? "included" : "")} summary={`${selection.count} 位`}><RecordList label="发送名单" records={recipientRecords(selection)}/></Fold>{excluded(selection)}<Field label="操作理由" required hint={`至少 ${reasonRule.min} 字`} error={reasonLeft?reasonRule.hint(reason)||undefined:undefined}>{control=><Textarea {...control} rows={3} value={reason} maxLength={reasonRule.max} disabled={busy} count={`${visibleReasonLength(reason)}/${reasonRule.max}`} onChange={e=>setReason(e.target.value)} onBlur={()=>setReasonLeft(true)}/>}</Field><Check label="已核对名单、当前专属客服、用途和内容，确认逐客独立发送。" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/></>}</>}
    {step===4&&job&&<><Facts><Fact k="批次状态">{stateText[job.state]??"未知"}<Explain label="执行结束是什么意思" content="执行结束不代表全部成功，逐客结果看下面。"/></Fact><Fact k="批次"><span data-mono="">{job.batchId}</span></Fact><Fact k="名单">共 {job.frozenCount} 位 · 当前可读 {job.visibleCount} 位</Fact><Fact k="发送内容">{job.contentRestricted?"客户归属已变化，部分内容、附件和明细受限；不显示旧缓存。":job.content}</Fact></Facts>
      <div className="m-bulk-counts"><span>总数 <b>{job.counts.total}</b></span>{job.counts.failed>0&&<StatusTag tone="danger">失败 {job.counts.failed}</StatusTag>}{job.counts.unknown>0&&<StatusTag tone="warn">待确认 {job.counts.unknown}</StatusTag>}<span>已提交 <b>{job.counts.sent}</b></span>{job.counts.failed===0&&<span>失败 <b>0</b></span>}<span>跳过 <b>{job.counts.skipped}</b></span><span>取消 <b>{job.counts.cancelled}</b></span><span>待处理（已知）<b>{job.counts.pending-job.counts.unknown}</b></span></div>
      <div className="m-bulk-row"><Button size="sm" onClick={()=>setResultRetry(n=>n+1)}>刷新原批次</Button><span className="m-bulk-row-tools"><Button size="sm" disabledReason={cancelBlocked||undefined} onClick={()=>setMutationAction("cancel")}>取消未提交项</Button><Button size="sm" disabledReason={retryBlocked||undefined} onClick={()=>setMutationAction("retry")}>核对并重试失败项</Button></span></div>
      {mutationAction&&<div className="rd-stack"><p>{mutationAction==="cancel"?"取消只影响未提交项，已经提交的消息保留。":"先核对原消息，已提交、已转绑或不再维护项不重发。"}</p><Field label="操作理由" required hint="至少 8 字" explain="提交中或原结果未确认时暂不能重复操作。">{control=><Textarea {...control} rows={3} minLength={8} maxLength={200} value={mutationReason} count={`${visibleReasonLength(mutationReason)}/200`} onChange={e=>setMutationReason(e.target.value)}/>}</Field><div className="m-bulk-row-tools"><Button variant="primary" size="sm" disabled={busy||Boolean(pending)||!reasonRule.ok(mutationReason)||mutationReason.trim().length>200} onClick={()=>void mutate()}>确认{mutationAction==="cancel"?"取消剩余":"核对重试"}</Button><Button size="sm" disabled={busy} onClick={()=>setMutationAction(null)}>返回结果</Button></div></div>}
      {resultError&&<Notice tone="danger">结果加载失败，以上为上次已核对值：{resultError}</Notice>}
      {!recipients?<p role="status">逐客明细暂未读取</p>:<Table label="逐客结果"><thead><tr><Th>客户</Th><Th>结果</Th><Th>原因</Th><Th>原会话</Th></tr></thead><tbody>{recipients.map((r,i)=><Tr key={r.customerId+":"+i}><Td>{customerName(r.customerId)}</Td><Td><StatusTag tone={recipientTone(r)}>{r.resultCertainty==="UNKNOWN"?"结果待确认":stateText[r.state]??"未知"}</StatusTag></Td><Td>{r.failureCode?{...conversationReasonText,SUPPORT_ASSIGNMENT_CHANGED:"客户已转绑，本次不再发送",SUPPORT_MAINTENANCE_STOPPED:"客户已停止维护",SUPPORT_AGENT_UNAVAILABLE:"专属客服当前不可发送",RESULT_UNKNOWN:"需核对原提交结果",SUPPORT_BULK_PAYLOAD_REVIEW_REQUIRED:"原内容需核对，暂不自动重发"}[r.failureCode]??"执行未通过，请核对客户与原消息":"—"}{r.retryable?" · 可核对重试":""}</Td><Td>{r.conversationNo?<a className="rd-link" href={`/service/sessions?conversationNo=${encodeURIComponent(r.conversationNo)}`}>打开原客户会话</a>:"—"}</Td></Tr>)}</tbody></Table>}
      {recipientTotal>0&&<Pager label="逐客结果" total={recipientTotal} page={recipientPage} pageSize={10} sizes={[10]} onPage={setRecipientPage} onPageSize={()=>undefined}/>}</>}
    </>}
    <Fold inset title="已提交批次" explain="关闭后可以在这里恢复查看。" open={historyOpen} onOpenChange={setHistoryOpen} summary={jobsError?"加载失败":jobs?`${jobsTotal} 批`:"正在加载…"}>{jobsError?<div role="alert" className="m-bulk-row"><span>{jobsError}</span><Button size="sm" onClick={()=>setResultRetry(n=>n+1)}>重试批次列表</Button></div>:!jobs?<p role="status">正在加载…</p>:<>{jobs.map(j=><div className="m-bulk-row" key={j.batchId}><span>{stateText[j.state]??"未知"} · {j.frozenCount} 位{j.counts.failed>0?` · 失败 ${j.counts.failed}`:""}</span><Button size="sm" disabled={Boolean(pending)||busy} onClick={()=>{setJob(j);setStep(4);setRecipientPage(1);setHistoryOpen(false);}}>查看结果</Button></div>)}{jobsTotal>0&&<Pager label="已提交批次" total={jobsTotal} page={jobsPage} pageSize={10} sizes={[10]} onPage={setJobsPage} onPageSize={()=>undefined}/>}</>}</Fold>
    </div>
  </Modal>;
}
