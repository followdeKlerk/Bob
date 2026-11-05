import {composerActivity} from '../composer-activity';
const connected={connection:'Connected',hasConversation:true};
const current=(extra:Record<string,unknown>={})=>({...connected,live:{run:{taskId:7,first:1},generation:{},...extra}});
const message=(content:unknown)=>current({generation:{message:{content}}});

test.each([
 [connected,'idle','Connected'],
 [current({generation:undefined}),'preparing','Preparing response…'],
 [current(),'waiting','Waiting for model…'],
 [current({generation:{deferred:{pollAt:42}}}),'waiting','Waiting for model…'],
 [current({generation:{retry:{at:42,error:'secret provider failure'}}}),'retry','Retrying response…'],
 [message([{type:'thinking',thinking:'private reasoning never copied'}]),'thinking','Thinking…'],
 [message([{type:'thinking',thinking:'private'},{type:'text',text:'Public answer'}]),'writing','Writing response…'],
 [message([{type:'thinking',thinking:'opaque',redacted:true}]),'waiting','Waiting for model…'],
 [message([{type:'thinking',thinking:''}]),'waiting','Waiting for model…'],
 [message([{type:'text',text:'   '}]),'waiting','Waiting for model…'],
 [message([{type:'future-type',secret:'secret'}]),'waiting','Waiting for model…'],
 [message([{type:'text',text:'Earlier commentary'},{type:'toolCall',name:'read',arguments:{path:'secret'}}]),'preparing','Preparing response…'],
 [current({tools:[{status:'running',name:'bash',output:'private command output'}]}),'working','Working…'],
 [current({nestedTools:[{status:'pending',name:'read',arguments:{path:'private'}}]}),'working','Working…'],
 [current({run:{taskId:7,afterRun:{tasks:[99]}}}),'finishing','Finishing up…'],
 [{...connected,live:{compactions:[{taskId:1}] }},'compaction','Condensing conversation…'],
 [{...connected,live:{compactions:[{retry:{error:'secret',at:1}}]}},'compaction','Retrying summary…'],
 [{...current(),waitingForAnswer:true},'question','Waiting for your answer'],
 [{...current(),work:[{background:false,abortRequested:true}]},'stopping','Stopping…'],
 [{...connected,work:[{background:false,kind:'bob.mcp-ui-action'}]},'working','Working…'],
] as const)('coarse literal phase %s → %s',(input,phase,text)=>{
 expect(composerActivity(input)).toMatchObject({phase,text});
 expect(composerActivity(input).text).not.toMatch(/private|secret|command output|path|bash|read/);
});

test('health/admission priorities remain above response phases and actionable errors do not animate',()=>{
 const busy={...current(),sending:true,waitingForAnswer:true,work:[{background:false,abortRequested:true}]};
 expect(composerActivity({...busy,storageError:true})).toMatchObject({phase:'connection',text:'Device storage issue • keep Bob open',animate:false});
 expect(composerActivity({...busy,connection:'identity mismatch'})).toMatchObject({text:'Connection needs attention • pair again',animate:false});
 expect(composerActivity({...busy,connection:'Reconnecting after offline'}).text).toBe('Reconnecting…');
 expect(composerActivity({...busy,connection:'Connecting from cached history'}).text).toBe('Connecting…');
 expect(composerActivity(busy).phase).toBe('sending');
 expect(composerActivity({...busy,sending:false}).phase).toBe('stopping');
 expect(composerActivity({...current({compactions:[{}],generation:{retry:{}}}),waitingForAnswer:true}).phase).toBe('question');
 expect(composerActivity(current({compactions:[{}],generation:{retry:{}}})).phase).toBe('compaction');
});

test('generation content cannot override real tool execution or provider retry/deferred states',()=>{
 const generation={message:{content:[{type:'text',text:'stale streaming output'}]}};
 expect(composerActivity(current({generation,tools:[{status:'running',name:'web_search'}]})).phase).toBe('working');
 expect(composerActivity(current({generation:{...generation,retry:{at:1}},tools:[{status:'done'}]})).phase).toBe('retry');
 expect(composerActivity(current({generation:{...generation,deferred:{pollAt:1}}})).phase).toBe('waiting');
});

test.each([undefined,null,[],{},'private-invalid'])('unknown and retained idle data never imply working/thinking/completion (%s)',live=>{
 expect(composerActivity({...connected,live})).toMatchObject({phase:'idle',text:'Connected'});
 expect(composerActivity({...connected,live:{generation:{message:{content:[{type:'thinking',thinking:'old'}]}},tools:[{status:'running'}],runFailure:{reason:'model_error',detail:'secret'}}})).toMatchObject({phase:'idle',text:'Connected'});
 expect(composerActivity({...connected,work:[{background:true,abortRequested:true,kind:'watcher'}]}).phase).toBe('idle');
 expect(composerActivity({...connected,hasConversation:false,live:current().live})).toMatchObject({phase:'idle',text:'Select a conversation',animate:false});
});

test('tool arguments, names, helper counts, progress percentages and private content never enter the animation',()=>{
 const input=current({tools:[{status:'running',name:'DO_NOT_DISPLAY',arguments:{private:'DO_NOT_DISPLAY'},output:'DO_NOT_DISPLAY'}],nestedTools:[{status:'running',name:'DO_NOT_DISPLAY'}]});
 const before=JSON.stringify(input);expect(composerActivity(input)).toEqual({phase:'working',text:'Working…',animate:true});expect(JSON.stringify(input)).toBe(before);
});


test('explicitly nonblocking compaction does not obscure foreground writing, but remains visible when it is the only activity',()=>{
 const compactions=[{taskId:5,blocking:false}];
 expect(composerActivity(current({generation:{message:{content:[{type:'text',text:'Answer'}]}},compactions})).phase).toBe('writing');
 expect(composerActivity({...connected,live:{compactions}}).phase).toBe('compaction');
 expect(composerActivity(current({generation:{message:{content:[{type:'text',text:'Answer'}]}},compactions:[{taskId:5,blocking:true}]})).phase).toBe('compaction');
});


test('a completed tool-calling generation is not mistaken for fresh answer streaming when commentary follows its call',()=>{
 const generation={message:{stopReason:'toolUse',content:[{type:'toolCall',id:'call',name:'read'},{type:'text',text:'Old commentary'}]}};
 expect(composerActivity(current({generation,tools:[{status:'done',entry:9}]})).phase).toBe('preparing');
 expect(composerActivity(current({generation,tools:[{status:'running'}]})).phase).toBe('working');
});
