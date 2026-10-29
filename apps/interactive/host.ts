import {AppBridge, PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult} from '@modelcontextprotocol/client';
import type {McpUiStyles} from '@modelcontextprotocol/ext-apps';

declare global {
  interface Window {
    BobNative?: { request(payload: string, nonce: string): void };
    startBobSurface(payload: Surface, nonce: string, inline?: boolean, inlineMeasureSource?: string, fontFaceCss?: string): Promise<void>;
    __bobReply(id: string, payload: {result?: CallToolResult; error?: string}): void;
    __bobVisualData?(value: VisualValue): void;
  }
}
type VisualValue={revision:number;data:Record<string,unknown>|null;updatedAt:number|null};
type Surface={kind:'visual'|'mcp';title:string;html:string;input?:Record<string,unknown>;result?:CallToolResult;allowedTools:string[];visualData?:VisualValue};
// Shared by the Bob-owned host and visual document. MCP apps receive these
// preferences through the SDK host context instead of forced third-party CSS.
const surfaceFontFamily='"Nordwand Mono", monospace';
const surfaceTypographyCss=`html,body,body *,body *::before,body *::after,body *::placeholder{font-family:${surfaceFontFamily}!important}`;
// The SDK models optional variable values as a required-key Record. Unset
// variables remain undefined; Bob only supplies its two font preferences.
const surfaceFontVariables={'--font-sans':surfaceFontFamily,'--font-mono':surfaceFontFamily} as McpUiStyles;
const pending=new Map<string,{resolve:(value:CallToolResult)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
window.__bobReply=(id,payload)=>{
  const item=pending.get(id);if(!item)return;
  clearTimeout(item.timer);pending.delete(id);
  if(payload.error)item.reject(Error(payload.error));else item.resolve(payload.result??{content:[]});
};
window.startBobSurface=async(payload,nonce,inline=false,inlineMeasure='',fontFaceCss='')=>{
  // Native supplies only bundled data-URL fonts, never a network origin or grant.
  const typographyStyle=document.createElement('style');
  typographyStyle.textContent=fontFaceCss+surfaceTypographyCss;document.head.append(typographyStyle);
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
  let stopped=false,requestedHeight:number|undefined;
  let layoutTimeout:ReturnType<typeof setTimeout>|undefined;
  const fullView=(reason:'content-overflow'|'measurement-timeout')=>{
    if(stopped)return;
    stopped=true;clearTimeout(layoutTimeout);frame.style.visibility='hidden';
    frame.dataset.bobLayoutReason=reason;
    status.textContent='Open full view to see this content.';
    window.BobNative?.request(JSON.stringify({method:'overflow',reason}),nonce);
  };
  const awaitFit=()=>{
    if(!inline||stopped)return;
    frame.style.opacity='0';frame.style.pointerEvents='none';
    // One deadline per unsettled layout, not an endlessly extended resize loop.
    layoutTimeout??=setTimeout(()=>fullView('measurement-timeout'),3000);
  };
  const layoutMessage=(event:MessageEvent)=>{
    if(!inline||stopped||event.source!==frame.contentWindow||event.data?.bobLayout!==layoutKey)return;
    const report=event.data,bounds=frame.getBoundingClientRect();
    // Ignore stale pre-resize reports, including stale overflow. A new measured
    // report must arrive before revealing; no content is scaled or clipped to fit.
    if(!Number.isFinite(report.viewportWidth)||!Number.isFinite(report.viewportHeight)||Math.abs(report.viewportWidth-bounds.width)>1||Math.abs(report.viewportHeight-bounds.height)>1){awaitFit();return;}
    const height=report.contentHeight;
    if(report.fits!==true||!Number.isInteger(height)||height<1||height>420){fullView('content-overflow');return;}
    if(requestedHeight!==height){requestedHeight=height;window.BobNative?.request(JSON.stringify({method:'layout',height}),nonce);}
    if(report.viewportFits!==true||Math.abs(report.viewportHeight-height)>1){awaitFit();return;}
    clearTimeout(layoutTimeout);layoutTimeout=undefined;
    frame.style.opacity='1';frame.style.pointerEvents='auto';status.textContent='';
  };
  if(inline){
    awaitFit();frame.setAttribute('scrolling','no');
    window.addEventListener('message',layoutMessage);
    window.addEventListener('pagehide',()=>{clearTimeout(layoutTimeout);window.removeEventListener('message',layoutMessage);},{once:true});
  }
  const measureScript=inline?`<script>${inlineMeasure.replace('__BOB_INLINE_LAYOUT_KEY__',JSON.stringify(layoutKey))}</script>`:'';
  const dataKey=crypto.randomUUID();
  let value:VisualValue={revision:0,data:null,updatedAt:null};
  const publishData=()=>{if(payload.kind==='visual')frame.contentWindow?.postMessage({bobVisual:dataKey,value},'*');};
  window.__bobVisualData=next=>{
    if(payload.kind!=='visual'||!next||!Number.isSafeInteger(next.revision)||next.revision<=value.revision||next.revision<0||!(next.data===null||typeof next.data==='object'&&!Array.isArray(next.data)))return;
    value={revision:next.revision,data:next.data,updatedAt:next.updatedAt};
    awaitFit();publishData();
  };
  if(payload.visualData)window.__bobVisualData(payload.visualData);
  frame.addEventListener('load',publishData);
  // Read-only data API. Its key identifies host messages, not native authority.
  // The child gets no credentials, fetching primitive or backend tool interface.
  const dataScript=payload.kind==='visual'?`<script>(()=>{
    const key=${JSON.stringify(dataKey)},listeners=new Set();
    let current=Object.freeze({revision:0,data:null,updatedAt:null});
    Object.defineProperty(window,'bobVisual',{value:Object.freeze({get current(){return current;},subscribe(callback){
      if(typeof callback!=='function')throw Error('A visual data callback is required');
      listeners.add(callback);callback(current);return ()=>listeners.delete(callback);
    }}),writable:false,configurable:false});
    addEventListener('message',event=>{
      if(event.source!==parent||event.data?.bobVisual!==key)return;
      const next=event.data.value;if(!next||!Number.isSafeInteger(next.revision)||next.revision<=current.revision)return;
      current=Object.freeze({revision:next.revision,data:next.data,updatedAt:next.updatedAt});
      for(const callback of listeners){try{callback(current);}catch(error){console.error('Visual data handler failed');}}
      dispatchEvent(new Event('bob:visual-data'));
    });
  })();</script>`:'';
  if(payload.kind==='mcp') {
    const bridge=new AppBridge(null,{name:'Bob Android',version:'0.1.0'},{serverTools:{}},{hostContext:{theme:'dark',styles:{variables:surfaceFontVariables,css:{fonts:fontFaceCss}},displayMode:inline?'inline':'fullscreen',availableDisplayModes:[inline?'inline':'fullscreen']}});
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
  frame.srcdoc='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'none\'">'+(payload.kind==='visual'?'<style>'+fontFaceCss+'</style>':'')+measureScript+dataScript+payload.html+'<style>html{overflow-anchor:none}'+scrollbarCss+(payload.kind==='visual'?surfaceTypographyCss:'')+'</style>';
};
