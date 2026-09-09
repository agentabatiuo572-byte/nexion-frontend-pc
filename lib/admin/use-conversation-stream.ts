"use client";
import { useEffect,useRef,useState } from 'react';
import { ConversationRealtime, type RealtimeSocket } from './conversation-realtime';
import { installAdminRealtime,updateAdminRealtime,receiveAdminPresence } from './admin-conversation-realtime';
import { useAdminAuth } from '@/lib/store/admin-auth';
export type ConversationEventType='MESSAGE'|'TRANSFER'|'STATUS'|'INITIATE'|'RECEIPT';
export interface ConversationStreamEvent {conversationNo:string;messageId?:number;eventType:ConversationEventType;senderType:string;senderName?:string;body?:string;ts?:string;ownerAgentId?:string;ownerAgentName?:string}
export interface UseConversationStreamOptions {
  onEvent:(event:ConversationStreamEvent,signal:AbortSignal)=>void|Promise<void>;
  onReconnectSnapshot:(signal:AbortSignal)=>Promise<void>;enabled?:boolean;lifecycleSignal?:AbortSignal;
}
/** Every connection first reconciles a full authorized snapshot, then consumes invalidations. */
export function useConversationStream({onReconnectSnapshot,enabled=true,lifecycleSignal}:UseConversationStreamOptions){
  const reconcile=useRef(onReconnectSnapshot);reconcile.current=onReconnectSnapshot;
  const [ready,setReady]=useState(false);const [reconnectExhausted,setExhausted]=useState(false);
  const [nonce,setNonce]=useState(0);
  const authEpoch=useAdminAuth(s=>s.authEpoch);
  const authorized=useAdminAuth(s=>s.isAuthenticated&&!s.logoutPending);
  useEffect(()=>{
    if(!enabled||!authorized||typeof window==='undefined'||lifecycleSignal?.aborted){setReady(false);return;}
    const socket=new ConversationRealtime({url:`${location.origin.replace(/^http/,'ws')}/ws/conversations`,
      socket:url=>{const native=new WebSocket(url);const adapter:RealtimeSocket={onopen:null,onmessage:null,onclose:null,onerror:null,send:data=>native.send(data),close:()=>native.close()};native.onopen=()=>adapter.onopen?.();native.onmessage=e=>adapter.onmessage?.({data:String(e.data)});native.onclose=e=>adapter.onclose?.({code:e.code});native.onerror=()=>adapter.onerror?.();return adapter;},
      ticket:async signal=>{
        const response=await fetch('/api/admin/content/conversations/realtime-ticket',{method:'POST',credentials:'same-origin',cache:'no-store',signal});
        const result=await response.json();
        if(!response.ok||result.code!==0)throw Object.assign(new Error('CONVERSATION_AUTH_FAILED'),{status:response.ok?result.code:response.status});
        return result.data;
      },
      reconcile:signal=>reconcile.current(signal),
      state:(value,terminal)=>{setReady(value);setExhausted(terminal);updateAdminRealtime(value);},
      presence:receiveAdminPresence,
    });
    let stopped=false;
    const visibility=()=>{if(stopped)return;if(document.visibilityState==='hidden'){socket.stop();installAdminRealtime(null);}else{installAdminRealtime(socket);socket.start();}};
    const stop=()=>{stopped=true;socket.stop();installAdminRealtime(null);};
    lifecycleSignal?.addEventListener('abort',stop,{once:true});document.addEventListener('visibilitychange',visibility);visibility();
    return()=>{stop();lifecycleSignal?.removeEventListener('abort',stop);document.removeEventListener('visibilitychange',visibility);};
  },[enabled,authorized,authEpoch,lifecycleSignal,nonce]);
  return {ready,reconnectExhausted,retry:()=>setNonce(n=>n+1)};
}
