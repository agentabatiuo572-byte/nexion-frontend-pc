/** Wire contract shared with the M3 client. No tokens in URLs or persistent message cache. */
export interface RealtimeSocket {
  onopen: (()=>void)|null; onmessage: ((event:{data:string})=>void)|null;
  onclose: ((event:{code:number})=>void)|null; onerror: (()=>void)|null;
  send(data:string):void; close():void;
}
export interface RealtimeEnvelope { code:number; message?:string; data:unknown }
export interface RealtimePresence { conversationNo:string; online:boolean; typing:boolean; expiresIn?:number }
interface Options {
  url:string; ticket:(signal:AbortSignal)=>Promise<{ticket:string}>; socket:(url:string)=>RealtimeSocket;
  reconcile:(signal:AbortSignal)=>Promise<void>; state?:(ready:boolean,terminal:boolean,reason?:string)=>void;
  presence?:(value:RealtimePresence|null)=>void;
}
type Timer=ReturnType<typeof setTimeout>;
/**
 * 连续重连上限。到顶后不再无限重试,而是进入「降级」态:停自动重连、保留 5s 快照轮询、
 * 由运营面给出可操作原因 + 手动「重新连接」。没有这个上限时,WS 升级被拦 / 后端不可达 /
 * 握手卡死都会让状态永久停在「正在重连」,运维台既拿不到数据也拿不到原因。
 */
const MAX_RECONNECT_ATTEMPTS = 6;
export class ConversationRealtime {
  ready=false;
  private stopped=true; private terminal=false; private exhausted=false; private epoch=0; private attempts=0; private lifecycle=0;
  private connection:RealtimeSocket|null=null; private controller=new AbortController(); private fallback=new AbortController();
  private retryTimer?:Timer; private pollTimer?:Timer; private heartbeatTimer?:Timer; private deadline?:Timer; private eventTimer?:Timer;private stableTimer?:Timer;
  private pending=new Map<string,{resolve:(value:RealtimeEnvelope)=>void;reject:(error:Error)=>void;timer:Timer}>();
  private eventIds=new Set<string>(); private dirty=false; private syncing=false; private authenticated=false;
  private watched:string|null=null; private lastTyping=0; private lastPong=0; private sequence=0; private lastFailure="";
  constructor(private readonly options:Options){}
  start(){if(!this.stopped)return;this.stopped=false;this.terminal=false;this.exhausted=false;this.lastFailure="";this.attempts=0;this.lifecycle++;this.fallback=new AbortController();this.connect();this.poll(this.lifecycle);}
  stop(){this.stopped=true;this.lifecycle++;this.disconnect(false);this.fallback.abort();clearTimeout(this.pollTimer);this.options.presence?.(null);}
  watch(no:string|null){this.watched=no;if(this.authenticated)this.send({type:'watch',conversationNo:no});}
  typing(active:boolean){
    if(!this.ready||!this.watched)return;
    if(active && Date.now()-this.lastTyping<1200)return;
    this.lastTyping=Date.now();this.send({type:'typing',conversationNo:this.watched,active});
  }
  command(operation:string,conversationNo:string|undefined,body:unknown,idempotencyKey?:string,signal?:AbortSignal):Promise<RealtimeEnvelope>|null {
    if(!this.ready||!this.connection)return null;
    if(signal?.aborted)return Promise.reject(new Error('CONVERSATION_DELIVERY_UNKNOWN'));
    const requestId=`c${Date.now()}_${++this.sequence}`;
    return new Promise((resolve,reject)=>{
      const abort=()=>{const p=this.pending.get(requestId);if(p){this.pending.delete(requestId);p.reject(new Error('CONVERSATION_DELIVERY_UNKNOWN'));}};
      const timer=setTimeout(abort,12000);
      const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      this.pending.set(requestId,{resolve:v=>{done();resolve(v)},reject:e=>{done();reject(e)},timer});
      signal?.addEventListener('abort',abort,{once:true});
      try{this.send({type:'command',requestId,operation,conversationNo,body,idempotencyKey});}catch{abort();}
    });
  }
  private send(value:unknown){this.connection?.send(JSON.stringify(value));}
  private setReady(value:boolean){this.ready=value;this.options.state?.(value,this.terminal,this.exhausted?this.lastFailure:undefined);}
  private disconnect(retry:boolean,terminal=false,reason=""){
    if(reason)this.lastFailure=reason;
    this.epoch++;this.controller.abort();this.fallback.abort();this.fallback=new AbortController();this.connection?.close();this.connection=null;
    this.authenticated=false;this.syncing=false;this.dirty=false;this.terminal=terminal;
    for(const timer of [this.retryTimer,this.heartbeatTimer,this.deadline,this.eventTimer,this.stableTimer])clearTimeout(timer);
    this.pending.forEach(p=>p.reject(new Error('CONVERSATION_DELIVERY_UNKNOWN')));this.pending.clear();
    if(retry&&!this.stopped&&!terminal&&this.attempts>=MAX_RECONNECT_ATTEMPTS){
      // 连续重连到顶:停自动重连,进入可操作的降级态。5s 快照轮询仍在跑,
      // 页面能继续读到服务端事实;运营面据此给出原因 + 手动重新连接。
      this.exhausted=true;
      this.setReady(false);this.options.presence?.(null);
      return;
    }
    this.setReady(false);this.options.presence?.(null);
    if(retry&&!this.stopped&&!terminal){const delay=Math.min(30000,1000*2**Math.min(this.attempts++,5)*(0.8+Math.random()*0.4));this.retryTimer=setTimeout(()=>this.connect(),delay);}
  }
  /** 运营面手动「重新连接」:清空连续失败计数后立刻重试,快照轮询不中断。 */
  retry(){
    if(this.stopped)return;
    this.terminal=false;this.exhausted=false;this.lastFailure="";this.attempts=0;
    this.fallback=new AbortController();
    this.connect();
  }
  private async connect(){
    if(this.stopped||this.terminal||this.exhausted)return;
    const epoch=++this.epoch;this.controller=new AbortController();const signal=this.controller.signal;
    const current=()=>!this.stopped&&epoch===this.epoch&&!signal.aborted;
    this.deadline=setTimeout(()=>{if(current())this.disconnect(true,false,"实时通道握手超时")},15000);
    try{
      const ticket=await this.options.ticket(signal);if(!current())return;
      const socket=this.options.socket(this.options.url);this.connection=socket;
      socket.onopen=()=>{if(current())this.send({type:'auth',ticket:ticket.ticket})};
      socket.onclose=()=>{if(current())this.disconnect(true,false,"实时通道已断开")};
      socket.onerror=()=>{if(current())this.disconnect(true,false,"实时通道连接失败")};
      socket.onmessage=e=>{
        if(!current())return;
        try{
          const f=JSON.parse(e.data);
          switch(f.type){
            case 'ready':
              clearTimeout(this.deadline);this.fallback.abort();this.authenticated=true;this.lastPong=Date.now();this.watch(this.watched);
              this.dirty=true;void this.sync(epoch);this.heartbeat(epoch);break;
            case 'pong':this.lastPong=Date.now();break;
            case 'ack':{const p=this.pending.get(f.requestId);if(p){this.pending.delete(f.requestId);p.resolve(f.result)}break;}
            case 'event':
              if(typeof f.eventId!=='string'||this.eventIds.has(f.eventId))break;
              this.eventIds.add(f.eventId);if(this.eventIds.size>2048)this.eventIds.delete(this.eventIds.values().next().value!);
              this.dirty=true;if(!this.syncing){clearTimeout(this.eventTimer);this.eventTimer=setTimeout(()=>void this.sync(epoch),80)}break;
            case 'presence':if(f.conversationNo===this.watched)this.options.presence?.(f);break;
            case 'error':{
              const denied=f.code===401||f.code===403;
              this.disconnect(true,denied,denied?"当前账号无权接入实时通道":"实时通道返回错误");
              break;
            }
          }
        }catch{this.disconnect(true,false,"实时通道返回了无法解析的帧");}
      };
    }catch(e){
      if(current()){
        const code=(e as {status?:number;code?:number}).status??(e as {code?:number}).code;
        const denied=code===401||code===403||code===428;
        this.disconnect(true,denied,denied?"实时通道鉴权被拒":"实时通道鉴权请求失败");
      }
    }
  }
  private async sync(epoch:number){
    if(this.syncing||!this.authenticated)return;
    this.syncing=true;const signal=this.controller.signal;
    try{
      do{this.dirty=false;await this.options.reconcile(signal);}while(this.dirty&&epoch===this.epoch&&!signal.aborted);
      if(epoch===this.epoch&&!signal.aborted){
        const wasReady=this.ready;this.setReady(true);
        if(!wasReady)this.stableTimer=setTimeout(()=>{if(epoch===this.epoch)this.attempts=0;},30000);
      }
    }catch{if(epoch===this.epoch)this.disconnect(true,false,"会话快照补拉失败");}
    finally{if(epoch===this.epoch)this.syncing=false;}
  }
  private heartbeat(epoch:number){
    this.heartbeatTimer=setTimeout(()=>{
      if(epoch!==this.epoch||this.stopped)return;
      if(Date.now()-this.lastPong>45000){this.disconnect(true,false,"实时通道心跳超时");return;}
      try{this.send({type:'ping'});this.heartbeat(epoch);}catch{this.disconnect(true,false,"实时通道心跳发送失败");}
    },15000);
  }
  private poll(lifecycle:number){
    this.pollTimer=setTimeout(async()=>{
      if(this.stopped||this.terminal||lifecycle!==this.lifecycle)return;
      if(!this.ready&&!this.authenticated){
        // The fallback has its own cancellation scope; connection recovery cancels stale snapshots.
        const signal=this.fallback.signal;
        if(!signal.aborted)try{await this.options.reconcile(signal);}catch{/* next bounded poll retries */}
      }
      if(!this.stopped&&lifecycle===this.lifecycle)this.poll(lifecycle);
    },5000);
  }
}
