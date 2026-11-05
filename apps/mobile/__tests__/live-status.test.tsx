import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {LiveStatus} from '../components/live-status';
import {liveStatuses} from '../live-status';
import {linkToolResults} from '../tool-results';

test.each([undefined,null,{},[],{'run':{taskId:1}},{generation:{message:{content:[]}}}])('legacy/empty live state has no invented outcome (%j)',value=>{expect(liveStatuses(value)).toEqual([]);});
test.each(['model_error','no_model','aborted','reset','faulted','orphaned','interrupted','restart_limit','nothing_to_answer','turn_limit','unknown','__proto__'])('terminal %s is bounded, distinct from assistant text and excludes provider detail',reason=>{
 const result=liveStatuses({runFailure:{taskId:7,reason,detail:'private-token raw provider error'}});
 expect(result).toHaveLength(1);expect(result[0].text.length).toBeLessThan(120);expect(result[0].text).not.toMatch(/private-token|raw provider error|success/i);
 expect(result[0].tone).toBe(['aborted','reset','nothing_to_answer','turn_limit'].includes(reason)?'neutral':'failure');
});
test('new work hides retained earlier run failure; retry/deferred/compaction remain explicit',()=>{
 const runFailure={reason:'model_error'};
 expect(liveStatuses({run:{taskId:2},runFailure})).toEqual([]);
 expect(liveStatuses({run:{},runFailure,generation:{retry:{error:'secret',at:1},deferred:{pollAt:2}}}).map(s=>s.text)).toEqual(['Retrying the response…']);
 expect(liveStatuses({run:{},generation:{deferred:{pollAt:2}}})[0].text).toMatch(/Waiting/);
 expect(liveStatuses({compactions:[{taskId:3,trigger:'manual',retry:{error:'secret'}}],compactionFailure:{error:'old'}}).map(s=>s.text)).toEqual(['Retrying context compaction…']);
 expect(liveStatuses({compactions:[{taskId:3,reason:'manual'}]})[0].text).toBe('Compacting conversation context…');
 expect(liveStatuses({compactionFailure:{error:'secret'}})[0].text).toMatch(/compaction failed/);
});
test('status component wraps scalable text, is passive, and clears across scope/data changes',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<LiveStatus live={{runFailure:{reason:'aborted'}}}/>);});
 const label=tree.root.find(node=>node.props.accessibilityLiveRegion==='polite'&&node.props.children==='Stopped. This run was cancelled before it answered.');
 expect(label.props.numberOfLines).toBeUndefined();expect(label.props.allowFontScaling).not.toBe(false);
 expect(StyleSheet.flatten(label.props.style).lineHeight).toBeGreaterThanOrEqual(20);
 expect(tree.root.findAll(node=>typeof node.props.onPress==='function')).toHaveLength(0);
 await act(async()=>tree.update(<LiveStatus live={undefined}/>));expect(tree.toJSON()).toBeNull();await act(async()=>tree.unmount());
});
test('orphaned tool completion never looks successful and a real result wins by exact call ID',()=>{
 const live={tools:[{callId:'lost',status:'done'},{callId:'saved',status:'done',entry:4},{callId:'pending',status:'pending'}]};
 const results=linkToolResults([],live).results;
 expect(results.get('lost')).toMatchObject({status:'failed',isError:true,content:'Tool ended without a recorded result.'});
 expect(results.get('saved')).toMatchObject({status:'done',isError:false});expect(results.get('pending')).toMatchObject({status:'pending',isError:false});
 const stored={id:5,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'lost',toolName:'read',content:'actual result',isError:false}]};
 expect(linkToolResults([stored],live).results.get('lost')).toMatchObject({content:'actual result',status:'done',isError:false});
});


test('main-chat progress moves to the composer, but terminal outcomes and compaction failures stay in chat',async()=>{
 const live={run:{taskId:1},generation:{retry:{error:'private',at:5}},compactions:[{taskId:2}]};
 expect(liveStatuses(live,false)).toEqual([]);
 expect(liveStatuses(live,true)).toHaveLength(2); // Child transcripts have no dedicated phase strip.
 for(const reason of ['model_error','aborted','reset','nothing_to_answer','turn_limit'])expect(liveStatuses({runFailure:{reason}},false)).toHaveLength(1);
 expect(liveStatuses({compactionFailure:{error:'private'}},false)[0].text).toMatch(/compaction failed/);
 expect(liveStatuses({...live,compactionFailure:{error:'old'}},false)).toEqual([]);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<LiveStatus live={live} showProgress={false}/>);});expect(tree.toJSON()).toBeNull();
 await act(async()=>tree.update(<LiveStatus live={live} showProgress/>));expect(tree.root.findAllByProps({testID:'native-run-status'}).length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
});
