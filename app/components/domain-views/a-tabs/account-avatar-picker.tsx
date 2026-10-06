"use client";
import {useEffect,useRef,useState} from "react";
import {useAdminAuth} from "@/lib/store/admin-auth";
import {uploadA1Avatar,cancelA1Avatar,type A1Operator} from "@/lib/admin/a1-client";
import {supportClient} from "@/lib/admin/m-support-client";
import {displayAdminError} from "@/lib/admin/error-messages";
import {SupportAvatar} from "../m-tabs/support-avatar";
export function AccountAvatarPicker({account,name,disabled,onChange,onBlocking}:{account?:A1Operator;name:string;disabled?:boolean;onChange:(assetId?:string)=>void;onBlocking:(blocking:boolean)=>void}) {
  const session=useAdminAuth(s=>s.session),epoch=useAdminAuth(s=>s.authEpoch);
  const canUpload=session?.role==="super"||session?.role==="superadmin";
  const [selected,setSelected]=useState<{file:File;url:string;id:string;key:string;assetId?:string;previewRef?:string;expiresAt?:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [invalidSelection,setInvalidSelection]=useState(false);
  const current=useRef(selected);current.current=selected;
  const generation=useRef(0),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{generation.current++;controller.current?.abort();if(current.current)URL.revokeObjectURL(current.current.url);},[]);
  useEffect(()=>{generation.current++;controller.current?.abort();if(current.current)URL.revokeObjectURL(current.current.url);setSelected(null);setInvalidSelection(false);setBusy(false);setError("");onChange(undefined);onBlocking(false);},[epoch]);
  async function clear(){generation.current++;controller.current?.abort();const old=current.current;if(old)URL.revokeObjectURL(old.url);setSelected(null);current.current=null;setInvalidSelection(false);setError("");setBusy(false);onChange(undefined);onBlocking(false);if(old?.assetId)try{await cancelA1Avatar(old.assetId,crypto.randomUUID());}catch{setError("未使用素材的取消结果未确认；原账号头像保持不变。");}}
  async function choose(file?:File){if(!file||!canUpload||disabled||busy)return;const token=++generation.current;onBlocking(true);setInvalidSelection(true);setError("");
    try{const policy=await supportClient.attachmentPolicy();if(token!==generation.current)return;if(!policy.available||!policy.allowedMimeTypes.includes(file.type as "image/png"|"image/jpeg")||policy.maxBytes!==null&&file.size>policy.maxBytes)throw new Error("请选择符合当前格式及大小要求的 JPG 或 PNG 图片。");const decoded=await createImageBitmap(file);const pixels=decoded.width*decoded.height;decoded.close();if(policy.maxPixels!==null&&pixels>policy.maxPixels)throw new Error("图片像素超过当前上限。");if(token!==generation.current)return;const old=current.current;if(old)URL.revokeObjectURL(old.url);if(old?.assetId)void cancelA1Avatar(old.assetId,crypto.randomUUID()).catch(()=>{if(token===generation.current)setError("旧未使用素材的取消结果未确认，原账号头像保持不变。");});const next={file,url:URL.createObjectURL(file),id:crypto.randomUUID(),key:crypto.randomUUID()};current.current=next;setSelected(next);setInvalidSelection(false);onChange(undefined);}
    catch(e){if(token===generation.current){setError(e instanceof Error&&(e.message.startsWith("图片")||e.message.startsWith("请选择"))?e.message:"图片无法读取，请重新选择。");onBlocking(true);}}
  }
  async function upload(){if(!selected||selected.assetId||busy||disabled||!canUpload)return;const old=selected,token=generation.current;const abort=new AbortController();controller.current=abort;setBusy(true);onBlocking(true);setError("");
    try{const result=await uploadA1Avatar(old.file,old.id,old.key,abort.signal);if(token!==generation.current||abort.signal.aborted)return;setSelected({...old,...result});onChange(result.assetId);onBlocking(false);}
    catch(e){if(token===generation.current&&!abort.signal.aborted)setError(displayAdminError(e));}
    finally{if(token===generation.current)setBusy(false);}
  }
  return <fieldset style={{margin:"14px 0",border:"1px solid var(--border)",borderRadius:10,padding:14}}><legend>账号头像（可选）</legend><div style={{display:"flex",gap:20,alignItems:"center"}}><div><p>原头像</p><SupportAvatar name={name||"运营账号"} path={account?.avatarAssetId?`/api/admin/platform/accounts/${account.id}/avatar`:undefined} version={account?.avatarVersion??undefined} size={64}/></div>{selected&&<div><p>新头像 · 尚未保存到账号</p>{selected.previewRef?<SupportAvatar name={name||"运营账号"} path={selected.previewRef} size={64}/>:<img src={selected.url} alt="待上传账号头像" width={64} height={64} style={{objectFit:"cover",borderRadius:"50%"}}/>}</div>}</div><p>仅超管可上传；头像与账号资料一起提交。失败、取消或冲突不会替换原图。</p>{canUpload?<label>选择 JPG / PNG 头像<input type="file" accept="image/jpeg,image/png" disabled={disabled||busy} onChange={e=>{void choose(e.target.files?.[0]);e.target.value="";}}/></label>:<p>需要超管权限，现有头像只读。</p>}{invalidSelection&&!selected&&<button type="button" className="l-btn" disabled={disabled||busy} onClick={()=>void clear()}>取消失败的头像选择</button>}{selected&&<div><button type="button" className="l-btn" disabled={disabled||busy||Boolean(selected.assetId)} onClick={()=>void upload()}>{busy?"正在上传…":selected.assetId?"上传成功":"上传或使用原命令重试"}</button><button type="button" className="l-btn" disabled={disabled||busy} onClick={()=>void clear()}>取消新头像</button>{selected.expiresAt&&<small>素材有效期至 {new Date(selected.expiresAt).toLocaleString("zh-CN")}</small>}</div>}{error&&<p role="alert">{error}</p>}</fieldset>;
}
