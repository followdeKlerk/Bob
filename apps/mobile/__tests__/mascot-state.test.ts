import {mascotSignals as readSignals,observeMascot} from '../mascot-state';
// Native-connected is explicit test evidence; production callers must supply their real status.
const mascotSignals=(input:Parameters<typeof readSignals>[0])=>readSignals({status:'Connected',...input});
const answer=(id:number,stopReason='stop')=>({id,kind:'pi.assistant',model:[{role:'assistant',stopReason,content:[{type:'text',text:'An answer'}]}]});
test('signals distinguish real work, offline/authorization/storage trouble and stale failures',()=>{
 expect(mascotSignals({live:undefined}).activity).toBe('idle');
 for(const status of ['Offline • cached history','Reconnecting…','Pair again: device credential missing','Identity mismatch','Cached • reconnecting'])expect(mascotSignals({live:{run:{taskId:1}},status}).activity).toBe('attention');
 expect(mascotSignals({live:{},storageError:true}).activity).toBe('attention');
 for(const input of [{busy:true},{activeAgents:2},{sending:true},{live:{compactions:[{}]}},{live:{run:{taskId:3},runFailure:{reason:'model_error'}}}])expect(mascotSignals({live:{},...input}).activity).toBe('working');
 expect(mascotSignals({live:{runFailure:{reason:'aborted'}}}).activity).toBe('attention');
 expect(mascotSignals({live:{compactionFailure:{error:'private'}}}).activity).toBe('attention');
 expect(mascotSignals({live:{run:{taskId:1,first:4}}}).runKey).toBe('first:4');
});
test('only committed assistant text counts, never tools, partial failures or empty answers',()=>{
 expect(mascotSignals({live:{},entries:[answer(4),answer(9,'aborted'),answer(10,'error'),{id:11,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'Checking'},{type:'toolCall',id:'call'}]}]},{id:12,kind:'bob.user',model:[{role:'assistant',content:'Not an assistant entry'}]}]}).answerId).toBe(4);
 expect(mascotSignals({live:{},entries:[{id:13,kind:'pi.assistant',model:[{role:'assistant',content:'Final answer'}]}]}).answerId).toBe(13);
});
test('finished requires a locally observed run and a newer final answer, not simple idleness or cached history',()=>{
 let state=observeMascot(undefined,'a',mascotSignals({live:{},entries:[answer(4)]}));
 expect(state.completionKey).toBeUndefined();
 state=observeMascot(state,'a',mascotSignals({live:{run:{first:5,taskId:1}},entries:[answer(4)]}));
 // Tool-round task handoff preserves native run.first and the baseline.
 state=observeMascot(state,'a',mascotSignals({live:{run:{first:5,taskId:2}},entries:[answer(4),answer(6)]}));
 state=observeMascot(state,'a',mascotSignals({live:{},entries:[answer(4),answer(6)]}));
 expect(state.completionKey).toBe('a:6');
 expect(observeMascot(state,'a',mascotSignals({live:{},entries:[answer(6)]}))).toBe(state);
 expect(observeMascot(state,'b',mascotSignals({live:{},entries:[answer(50)]})).completionKey).toBeUndefined();
 expect(observeMascot(undefined,'a',mascotSignals({live:{},entries:[answer(100)]})).completionKey).toBeUndefined();
});
test.each(['model_error','aborted','turn_limit'])('failed or stopped run never celebrates (%s)',reason=>{
 const working=observeMascot(undefined,'a',mascotSignals({live:{run:{taskId:1}},entries:[]}));
 expect(observeMascot(working,'a',mascotSignals({live:{runFailure:{reason}},entries:[answer(4)]})).completionKey).toBeUndefined();
});
test('work ending without a new final answer or while disconnected never celebrates',()=>{
 const working=observeMascot(undefined,'a',mascotSignals({live:{run:{taskId:1}},entries:[answer(4)]}));
 expect(observeMascot(working,'a',mascotSignals({live:{},entries:[answer(4)]})).completionKey).toBeUndefined();
 expect(observeMascot(working,'a',mascotSignals({live:{},entries:[answer(6)],status:'Offline'})).completionKey).toBeUndefined();
});

test('an older answer hydrating after a run starts is not completion evidence for that run',()=>{
 const working=observeMascot(undefined,'a',mascotSignals({live:{run:{first:100,taskId:1}},entries:[]}));
 expect(observeMascot(working,'a',mascotSignals({live:{},entries:[answer(40)]})).completionKey).toBeUndefined();
});

test('cached running state followed by a first live completed snapshot never celebrates',()=>{
 let state=observeMascot(undefined,'a',mascotSignals({live:{},entries:[]}));
 const cached=mascotSignals({live:{run:{first:5,taskId:1}},entries:[answer(4)],status:'Cached • reconnecting'});
 expect(cached.runKey).toBeUndefined();
 state=observeMascot(state,'a',cached);
 state=observeMascot(state,'a',mascotSignals({live:{},entries:[answer(6)],status:'Connected'}));
 expect(state.completionKey).toBeUndefined();
 expect(readSignals({live:{run:{first:5}}}).runKey).toBeUndefined();
});
test('losing a live connection disarms a run until another running snapshot is observed live',()=>{
 let state=observeMascot(undefined,'a',mascotSignals({live:{run:{first:5}},entries:[answer(4)]}));
 state=observeMascot(state,'a',mascotSignals({live:{run:{first:5}},entries:[answer(4)],status:'Offline'}));
 state=observeMascot(state,'a',mascotSignals({live:{},entries:[answer(6)],status:'Connected'}));
 expect(state.completionKey).toBeUndefined();
});
