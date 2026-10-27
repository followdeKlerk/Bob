import {AppBridge, PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult} from '@modelcontextprotocol/client';

declare global {
  interface Window {
    BobNative?: { request(payload: string, nonce: string): void };
    startBobSurface(payload: Surface, nonce: string, inline?: boolean): Promise<void>;
    __bobReply(id: string, payload: {result?: CallToolResult; error?: string}): void;
  }
}
type Surface={kind:'visual'|'mcp';title:string;html:string;input?:Record<string,unknown>;result?:CallToolResult;allowedTools:string[]};
const pending=new Map<string,{resolve:(value:CallToolResult)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
window.__bobReply=(id,payload)=>{
  const item=pending.get(id);if(!item)return;
  clearTimeout(item.timer);pending.delete(id);
  if(payload.error)item.reject(Error(payload.error));else item.resolve(payload.result??{content:[]});
};
window.startBobSurface=async(payload,nonce,inline=false)=>{
  const scrollbarCss='*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
  const scrollbarStyle=document.createElement('style');scrollbarStyle.textContent=scrollbarCss;document.head.append(scrollbarStyle);
  const status=document.getElementById('status')!;
  const frame=document.createElement('iframe');
  frame.title=payload.title;frame.setAttribute('sandbox','allow-scripts');
  frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'");
  frame.style.cssText='display:block;width:100%;height:100%;border:0;background:#000000';
  document.getElementById('surface')!.append(frame);
  // Layout telemetry is untrusted child data, never a tool grant. Only the parent
  // knows the native bridge nonce; failure can only demote this surface to full view.
  const layoutKey=crypto.randomUUID();
  let stopped=false;
  let fitReceived=false;
  const fullView=()=>{
    if(stopped)return;
    stopped=true;frame.style.visibility='hidden';
    status.textContent='Open full view to see this content.';
    window.BobNative?.request(JSON.stringify({method:'overflow'}),nonce);
  };
  const layoutMessage=(event:MessageEvent)=>{
    if(!inline||stopped||event.source!==frame.contentWindow||event.data?.bobLayout!==layoutKey)return;
    if(event.data.fits!==true){fullView();return;}
    fitReceived=true;frame.style.opacity='1';frame.style.pointerEvents='auto';status.textContent='';
  };
  let layoutTimeout:ReturnType<typeof setTimeout>|undefined;
  if(inline){
    frame.style.opacity='0';frame.style.pointerEvents='none';frame.setAttribute('scrolling','no');
    window.addEventListener('message',layoutMessage);
    layoutTimeout=setTimeout(()=>{if(!fitReceived)fullView();},3000);
    window.addEventListener('pagehide',()=>{clearTimeout(layoutTimeout);window.removeEventListener('message',layoutMessage);},{once:true});
  }
  const measureScript=inline?`<script>(()=>{
    const key=${JSON.stringify(layoutKey)};
    let last;
    function check(){
      const root=document.documentElement,body=document.body;
      if(!body)return;
      const w=innerWidth,h=innerHeight;
      const elements=Array.from(body.querySelectorAll('*'));
      let fits=w>0&&h>0&&elements.length<=10000&&root.scrollWidth<=w+1&&root.scrollHeight<=h+1&&body.scrollWidth<=w+1;
      for(const el of [body,...elements]){
        if(!fits)break;
        if(!(el instanceof HTMLElement)||!el.getClientRects().length)continue;
        const style=getComputedStyle(el);
        if(style.display==='none'||style.visibility==='hidden')continue;
        const r=el.getBoundingClientRect();
        if(r.right>w+1||r.bottom>h+1||r.left< -1||r.top< -1||(el.clientWidth>0&&el.scrollWidth>el.clientWidth+1)||(el.clientHeight>0&&el.scrollHeight>el.clientHeight+1))fits=false;
      }
      if(fits!==last){last=fits;parent.postMessage({bobLayout:key,fits},'*');}
    }
    addEventListener('load',()=>{requestAnimationFrame(check);setInterval(check,300);});
    addEventListener('resize',check);
    addEventListener('scroll',()=>{parent.postMessage({bobLayout:key,fits:false},'*');},true);
    addEventListener('DOMContentLoaded',()=>{
      let queued=false;
      new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;check();});}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
    });
  })();</script>`:'';
  if(payload.kind==='mcp') {
    const bridge=new AppBridge(null,{name:'Bob Android',version:'0.1.0'},{serverTools:{}},{hostContext:{theme:'dark',displayMode:inline?'inline':'fullscreen',availableDisplayModes:[inline?'inline':'fullscreen']}});
    bridge.oncalltool=async(params)=>{
      if(!payload.allowedTools.includes(params.name))throw Error('Tool is not granted to this surface');
      if(!window.BobNative)throw Error('Authenticated native bridge unavailable');
      const id=crypto.randomUUID();
      return new Promise<CallToolResult>((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('Tool outcome unknown; no automatic resend'));},45000);
        pending.set(id,{resolve,reject,timer});
        window.BobNative!.request(JSON.stringify({id,method:'callTool',params:{name:params.name,arguments:params.arguments??{}}}),nonce);
      });
    };
    bridge.onrequestdisplaymode=async()=>({mode:inline?'inline':'fullscreen'});
    bridge.addEventListener('initialized',()=>{
      status.textContent='';
      void bridge.sendToolInput({arguments:payload.input??{}});
      if(payload.result)void bridge.sendToolResult(payload.result);
    });
    bridge.onerror=error=>{status.textContent='Interactive app error: '+error.message;};
    await bridge.connect(new PostMessageTransport(frame.contentWindow!,frame.contentWindow!));
    window.addEventListener('pagehide',()=>{void bridge.teardownResource({}, {timeout:1000}).catch(()=>{}).finally(()=>bridge.close());},{once:true});
  } else status.textContent='';
  // The child remains an opaque origin. CSP is additive and cannot be weakened by later app markup.
  frame.srcdoc='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'none\'">'+measureScript+payload.html+'<style>'+scrollbarCss+'</style>';
};
