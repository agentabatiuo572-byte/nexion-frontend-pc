"use client";
import { useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { guardedFetch } from "@/lib/admin/error-messages";
export const advisorAvatarPath = (adminId: number, customerId?: string) => `/api/admin/content/support-agents/${adminId}/avatar${customerId ? "?customerId="+encodeURIComponent(customerId) : ""}`;
export const customerAvatarPath = (customerId: string) => `/api/admin/content/support-workbench/customers/${encodeURIComponent(customerId)}/avatar`;
export function SupportAvatar({ name, path, version, size = 34 }: { name: string; path?: string; version?: number; size?: number }) {
  const epoch = useAdminAuth(s=>s.authEpoch);
  const [url, setUrl] = useState(""), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(()=>{
    const controller = new AbortController(); let objectUrl = ""; setUrl(""); setFailed(false);
    if (!path) return;
    if (!/^\/api\/admin\/(content\/(support-agents\/\d+\/avatar(?:\?customerId=\d+)?|support-workbench\/customers\/\d+\/avatar)|platform\/accounts\/(\d+\/avatar|avatar-assets\/[^/?#]+))$/.test(path)) { setFailed(true); return; }
    guardedFetch(path, { credentials:"same-origin", cache:"no-store", signal:controller.signal }).then(async r=>{
      if(r.status===404)return;
      if(!r.ok||!(path.includes("/support-workbench/customers/")?["image/jpeg","image/png","image/webp"]:["image/jpeg","image/png"]).includes((r.headers.get("Content-Type")??"").split(";")[0].toLowerCase()))throw new Error("avatar unavailable");
      const blob=await r.blob(); if(controller.signal.aborted)return;
      objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path,version,epoch,retry]);
  return <span className="support-avatar" style={{display:"inline-flex",gap:4,alignItems:"center",flexShrink:0}}>{url?<img src={url} alt={`${name}头像`} width={size} height={size} style={{objectFit:"cover",borderRadius:"50%"}} onError={()=>{setUrl("");setFailed(true);}}/>:<span aria-label={`${name}姓名占位`} style={{width:size,height:size,borderRadius:"50%",display:"inline-grid",placeItems:"center",background:"var(--v5-brand-soft)",color:"var(--v5-ink)",fontSize:14}}>{name.trim().slice(0,1)||"?"}</span>}{failed&&<button type="button" className="l-btn sm" aria-label={`重试${name}头像`} onClick={()=>setRetry(n=>n+1)}>重试</button>}</span>;
}
