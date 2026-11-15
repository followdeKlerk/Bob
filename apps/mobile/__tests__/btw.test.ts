import {BtwSession,btwCommand,btwThread,type BtwThread} from '../btw';
const id='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222';
const thread=(extra:Partial<BtwThread>={}):BtwThread=>({id,revision:0,model:{provider:'fixture',modelId:'example'},createdAt:1,expiresAt:2,snapshot:{characters:100,truncated:false,omitsLive:true},messages:[],...extra});
test('only standalone leading /btw commands become side questions',()=>{
 expect(btwCommand('/btw')).toBe('');expect(btwCommand(' /BTW Why that approach? ')).toBe('Why that approach?');
 expect(btwCommand('/btwfoo test')).toBeNull();expect(btwCommand('Use /btw for this')).toBeNull();expect(btwCommand('https://example.test/btw')).toBeNull();
});
test('unknown paid admission is never automatically retried; GET reconciles the same receipt',async()=>{
 const view=thread();let admitted=false;
 const request=jest.fn(async(path:string,method?:string,body?:any)=>{
  if(method==='POST'&&path.endsWith('/messages')){admitted=true;throw Error('network lost');}
  if(method==='POST')return view;
  return admitted?thread({revision:1,messages:[{requestId:op,question:'Why?',status:'running'}]}):view;
 });
 const session=new BtwSession('chats/7/btw',request,()=>op);
 await session.open();expect(await session.send('Why?')).toBe(false);expect(session.state.uncertain).toBe(true);
 expect(await session.send('Why again?')).toBe(false);
 await session.check();expect(session.state.uncertain).toBe(false);expect(session.state.thread?.messages[0].requestId).toBe(op);
 expect(await session.send('Another?')).toBe(false);
 expect(request.mock.calls.filter(([,method])=>method==='POST')).toHaveLength(2);
 expect(request.mock.calls.at(-1)![0]).not.toContain('revision=');
});
test('revision polls do not retransmit history and never send model requests',async()=>{
 const request=jest.fn(async(_path:string,method?:string)=>method==='POST'?thread():{unchanged:true});
 const session=new BtwSession('chats/7/btw',request,()=>op);await session.open();await session.check();await session.check();
 expect(request.mock.calls.slice(1).every(([path,method])=>path.endsWith('?revision=0')&&method===undefined)).toBe(true);
 expect(session.state.thread).toEqual(thread());
});
test('missing unknown receipt stays blocked, and an explicit new thread is required to discard it',async()=>{
 let creating=0;
 const request=jest.fn(async(_path:string,method?:string)=>{
  if(method==='POST'&&_path.endsWith('/messages'))throw Error('lost');
  if(method==='POST'){creating++;return thread();}return thread();
 });
 const session=new BtwSession('chats/7/btw',request,()=>op);await session.open();await session.send('question');await session.check();
 expect(session.state.uncertain).toBe(true);await session.reset();expect(session.state.uncertain).toBe(false);expect(creating).toBe(2);
 expect(request.mock.calls.some(([,method])=>method==='DELETE')).toBe(true);
});
test('late reads cannot overwrite newer receipts and invalid thread identities are rejected',async()=>{
 let resolve!:(x:unknown)=>void;
 const request=jest.fn(async(path:string,method?:string)=>{
  if(method==='POST'&&path.endsWith('/messages'))return thread({revision:2,messages:[{requestId:op,question:'Why?',status:'done',answer:'Because.'}]});
  if(method==='POST')return thread();
  return new Promise(r=>{resolve=r;});
 });
 const session=new BtwSession('chats/7/btw',request,()=>op);await session.open();const reading=session.check();await session.send('Why?');resolve(thread());await reading;
 expect(session.state.thread?.revision).toBe(2);
 expect(()=>btwThread({...thread(),id:'not-a-thread'})).toThrow();
});
test('dispose blocks delayed results from a previous mounted conversation',async()=>{
 let resolve!:(x:unknown)=>void;const request=jest.fn(()=>new Promise(r=>{resolve=r;}));
 const session=new BtwSession('chats/7/btw',request,()=>op),changed=jest.fn();session.subscribe(changed);
 const opening=session.open();session.dispose();resolve(thread());await opening;
 expect(session.state.thread).toBeUndefined();
});
test('explicit device cleanup frees inaccessible temporary threads and starts a fresh unbilled workspace',async()=>{
 const request=jest.fn(async(path:string,method?:string)=>path.endsWith('/discard')?{discarded:4}:thread());
 const session=new BtwSession('chats/7/btw',request,()=>op);await session.open();await session.discardAll();
 expect(request.mock.calls.map(([path])=>path)).toEqual(['chats/7/btw','chats/7/btw/discard','chats/7/btw']);
 expect(request.mock.calls.some(([path])=>path.endsWith('/messages'))).toBe(false);
 expect(session.state.thread?.id).toBe(id);
});
