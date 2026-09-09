import type { ConversationRealtime,RealtimePresence } from './conversation-realtime';
let client:ConversationRealtime|null=null;
let watched:string|null=null;
const listeners=new Set<()=>void>();
let snapshot:{ready:boolean;presence:RealtimePresence|null}={ready:false,presence:null};
let typingExpiry:ReturnType<typeof setTimeout>|undefined;
export function installAdminRealtime(value:ConversationRealtime|null){client=value;client?.watch(watched);if(!value)updateAdminRealtime(false,null);}
export function updateAdminRealtime(ready:boolean,presence:RealtimePresence|null=snapshot.presence){snapshot={ready,presence};listeners.forEach(fn=>fn());}
export function receiveAdminPresence(presence:RealtimePresence|null){
  clearTimeout(typingExpiry);updateAdminRealtime(snapshot.ready,presence);
  if(presence?.typing)typingExpiry=setTimeout(()=>updateAdminRealtime(snapshot.ready,{...presence,typing:false}),presence.expiresIn??5000);
}
export function subscribeAdminRealtime(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)};}
export function getAdminRealtimeSnapshot(){return snapshot;}
export function watchAdminConversation(no:string|null){watched=no;client?.watch(no);receiveAdminPresence(null);}
export function sendAdminTyping(active:boolean){client?.typing(active);}
export function adminConversationCommand(operation:string,no:string|undefined,body:unknown,key?:string,signal?:AbortSignal){return client?.command(operation,no,body,key,signal)??null;}
