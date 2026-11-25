"use client";
import { useEffect,useRef,useState } from 'react';
import { ConversationRealtime, type RealtimeSocket } from './conversation-realtime';
import { installAdminRealtime,updateAdminRealtime,receiveAdminPresence } from './admin-conversation-realtime';
import { useAdminAuth } from '@/lib/store/admin-auth';
import { isAdminAuthFailure,resetAdminSession } from './auth-session';
export interface UseConversationStreamOptions {
  onEvent:(conversationNo:string,signal:AbortSignal)=>Promise<true|void>;
  onReconnectSnapshot:(signal:AbortSignal)=>Promise<void>;enabled?:boolean;lifecycleSignal?:AbortSignal;
  onScopeInvalidated?:(conversationNo?:string,customerId?:string)=>void;
}
/** Every connection first reconciles a full authorized snapshot, then consumes invalidations. */
export function useConversationStream({onEvent,onReconnectSnapshot,onScopeInvalidated,enabled=true,lifecycleSignal}:UseConversationStreamOptions){
  const onConversation=useRef(onEvent);onConversation.current=onEvent;
  const reconcile=useRef(onReconnectSnapshot);reconcile.current=onReconnectSnapshot;
  const invalidate=useRef(onScopeInvalidated);invalidate.current=onScopeInvalidated;
  const [ready,setReady]=useState(false);const [reconnectExhausted,setExhausted]=useState(false);
  const [reconnecting,setReconnecting]=useState(false);
  const [reconnectReason,setReconnectReason]=useState("");
  const [nonce,setNonce]=useState(0);
  const clientRef=useRef<ConversationRealtime|null>(null);
  const authEpoch=useAdminAuth(s=>s.authEpoch);
  const authorized=useAdminAuth(s=>s.isAuthenticated&&!s.logoutPending);
  useEffect(()=>{
    if(!enabled||!authorized||typeof window==='undefined'||lifecycleSignal?.aborted){setReady(false);return;}
    const socket=new ConversationRealtime({url:`${location.origin.replace(/^http/,'ws')}/ws/conversations`,
      socket:url=>{const native=new WebSocket(url);const adapter:RealtimeSocket={onopen:null,onmessage:null,onclose:null,onerror:null,send:data=>native.send(data),close:()=>native.close()};native.onopen=()=>adapter.onopen?.();native.onmessage=e=>adapter.onmessage?.({data:String(e.data)});native.onclose=e=>adapter.onclose?.({code:e.code});native.onerror=()=>adapter.onerror?.();return adapter;},
      ticket:async signal=>{
        const response=await fetch('/api/admin/content/conversations/realtime-ticket',{method:'POST',credentials:'same-origin',cache:'no-store',signal});
        const result=await response.json();
        // 取票也是客服侧的请求出口：会话失效同样交外壳重新登录（BUG-715）。
        if(isAdminAuthFailure(response.status,result?.message)||result?.code===401)resetAdminSession();
        if(!response.ok||result.code!==0)throw Object.assign(new Error('CONVERSATION_AUTH_FAILED'),{status:response.ok?result.code:response.status});
        return result.data;
      },
      reconcile:signal=>reconcile.current(signal),
      onEvent:(no,signal)=>onConversation.current(no,signal),
      state:(value,terminal,reason,interrupted)=>{setReady(value);setReconnecting(interrupted);setExhausted(terminal||!!reason);setReconnectReason(reason??"");updateAdminRealtime(value);},
      presence:receiveAdminPresence,
      scopeInvalidated:(conversationNo,customerId)=>invalidate.current?.(conversationNo,customerId),
    });
    clientRef.current=socket;
    let stopped=false;
    const visibility=()=>{if(stopped)return;if(document.visibilityState==='hidden'){socket.stop();installAdminRealtime(null);}else{installAdminRealtime(socket);socket.start();}};
    const stop=()=>{stopped=true;socket.stop();installAdminRealtime(null);clientRef.current=null;};
    lifecycleSignal?.addEventListener('abort',stop,{once:true});document.addEventListener('visibilitychange',visibility);visibility();
    return()=>{stop();lifecycleSignal?.removeEventListener('abort',stop);document.removeEventListener('visibilitychange',visibility);};
  },[enabled,authorized,authEpoch,lifecycleSignal,nonce]);
  return {ready,reconnecting,reconnectExhausted,reconnectReason,retry:()=>{
    // 手动重试优先走同一实例的即时重连(不重建 socket 对象,保留快照轮询);
    // 实例已销毁(生命周期/可见性停表)时才用 nonce 重建。
    const client=clientRef.current;
    if(client){setExhausted(false);setReconnectReason("");client.retry();return;}
    setNonce(n=>n+1);
  }};
}
