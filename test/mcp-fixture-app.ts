import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'Bob real MCP fixture',version:'1.0.0'},{});
const count=document.getElementById('count')!,button=document.getElementById('increment') as HTMLButtonElement;
const show=(result:any)=>{count.textContent='MCP counter: '+String(result.structuredContent?.count??'?');};
app.ontoolresult=show;
(async()=>{
  await app.connect();
  document.getElementById('connection')!.textContent='Official MCP Apps handshake connected';
  button.disabled=false;
  button.onclick=async()=>{
    button.disabled=true;
    try {show(await app.callServerTool({name:'increment',arguments:{amount:1}}));}
    catch(error){document.getElementById('error')!.textContent=String(error);}
    finally{button.disabled=false;}
  };
})().catch(error=>{document.getElementById('error')!.textContent=String(error);});
let parentBlocked=false,storageBlocked=false;
try {void window.parent.document.cookie;} catch {parentBlocked=true;}
try {localStorage.setItem('escape','no');} catch {storageBlocked=true;}
(window as any).fixtureIsolation={parentBlocked,storageBlocked};
fetch('https://example.invalid/denied').then(()=>{(window as any).fixtureIsolation.networkBlocked=false;}).catch(()=>{(window as any).fixtureIsolation.networkBlocked=true;});
// A sandboxed Android frame also sees Java interfaces; a forged host nonce must have no effect.
if((window as any).BobNative)(window as any).BobNative.request(JSON.stringify({id:crypto.randomUUID(),method:'callTool',params:{name:'increment',arguments:{amount:7}}}),'wrong-nonce');
