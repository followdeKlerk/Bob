import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {Message,INLINE_VISUAL_EMERGENCY_HEIGHT} from '@bob-local/core/contracts';
import {MAX_INLINE_HEIGHT,INITIAL_INLINE_HEIGHT} from '../apps/mobile/inline-visual-policy.js';
import {displayContext} from '../src/display-context.js';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {serve} from '../src/server.js';

const display=(height:number)=>({inline:{width:313,height},fullscreen:{width:361,height:754}});
const message=(height:number)=>({requestId:randomUUID(),text:'Make a card',mode:'steer',display:display(height)});

test('display metadata accepts legacy and content-sized clients, not arbitrary ceiling claims',()=>{
 assert.equal(MAX_INLINE_HEIGHT,INLINE_VISUAL_EMERGENCY_HEIGHT);assert.equal(INITIAL_INLINE_HEIGHT,420);
 for(const height of [420,8192])assert.equal(Message.parse(message(height)).display!.inline.height,height);
 for(const height of [0,419,421,8191,8193,Infinity,NaN])assert.equal(Message.safeParse(message(height)).success,false);
 assert.equal(Message.safeParse({...message(8192),display:{...display(8192),inline:{width:0,height:8192}}}).success,false);
 assert.equal(Message.safeParse({requestId:randomUUID(),text:'No viewer metadata',mode:'steer'}).success,true);
});

test('request guidance distinguishes natural chat-scrolled height from the legacy cap',()=>{
 const natural=displayContext(display(8192)),legacy=displayContext(display(420));
 assert.match(natural,/height grows and shrinks naturally/);assert.match(natural,/CHAT scrolls/);
 assert.match(natural,/emergency total-height ceiling including native action buttons/);
 assert.match(natural,/Ordinary tall cards should stay inline/);assert.doesNotMatch(natural,/only for compact/);
 assert.match(legacy,/legacy fixed inline height limit/);assert.match(legacy,/choose fullscreen for taller content/);
 for(const text of [natural,legacy]){assert.ok(text.startsWith('[Bob display context for this request:'));assert.match(text,/Full screen|Fullscreen opens on user tap/);}
});

test('authenticated requests deliver viewer-specific guidance without rewriting stored owner text',{timeout:20000},async()=>{
 const state=new State(mkdtempSync(join(process.env.TMPDIR!,'bob-dynamic-inline-display-'))),models=createModels(),faux=fauxProvider({tokensPerSecond:1000000});models.setProvider(faux.provider);
 const runtime=await openRuntime(state,models),app=await serve(state,{port:0,runtime}),paired=state.pair(state.invite().token,'Display test');
 const base=`http://127.0.0.1:${(app.server.address() as any).port}/v1`,headers={authorization:`Bearer ${paired.credential}`,'x-bob-backend':state.id,'content-type':'application/json'};
 try{
  const seen:string[]=[];
  faux.setResponses([8192,420].map(()=>request=>{seen.push(JSON.stringify(request.messages.filter(m=>m.role==='user').at(-1)));return fauxAssistantMessage('Fixture complete');}));
  for(const height of [8192,420]){
   const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
   const snapshotResponse=await fetch(base+`/chats/${chat.id}`,{headers});assert.equal(snapshotResponse.status,200);
   const snapshot=await snapshotResponse.json() as any;assert.deepEqual(snapshot.view.docs['bob.display'],{inlineHeight:8192});
   const rawView=await chat.viewState(ctx);try{assert.equal(rawView.value.docs['bob.display'],undefined,'capability is read-only presentation metadata, not persisted state');}finally{rawView.dispose();}
   const request={...message(height),text:'Show a card #nomem'};
   const response=await fetch(base+`/chats/${chat.id}/messages`,{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,202);
   const accepted=await response.json() as any;await(await runtime.harness.submission(accepted.id,ctx))!.wait(ctx);
   const entry=(await chat.entries({},100,undefined,ctx)).items.find(e=>e.id===accepted.entry)!;
   assert.equal(entry.kind,'bob.user');assert.equal(entry.data?.text,request.text);assert.doesNotMatch(JSON.stringify(entry.data),/display context|emergency ceiling/);
  }
  assert.match(seen[0],/Ordinary tall cards should stay inline/);assert.match(seen[1],/legacy fixed inline height limit/);
 }finally{await app.close();state.close();}
});
