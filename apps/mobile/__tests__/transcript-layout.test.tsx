import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,View} from 'react-native';
import {useTranscriptLayout,TranscriptGaps,TranscriptSeparator} from '../transcript-layout';
import {withLiveResponse,type ReplyEntry} from '../chat-replies';
import {CHAT_CONTENT_GAP} from '../tool-presentation';
jest.mock('../chat-replies',()=>({...jest.requireActual('../chat-replies'),withLiveResponse:jest.fn(jest.requireActual('../chat-replies').withLiveResponse)}));
const user:ReplyEntry={id:1,kind:'bob.user',data:{text:'Hello'}};
const memory:ReplyEntry={id:2,kind:'bob.memory-status',data:{phase:'save-queued'}};
const tool:ReplyEntry={id:3,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'read',name:'read',arguments:{path:'file'}}]}]};
type Layout=ReturnType<typeof useTranscriptLayout>;
let result:Layout;
function Harness({output,raw,live,tick=0}:{output:readonly ReplyEntry[];raw:readonly ReplyEntry[];live?:unknown;tick?:number}){
 result=useTranscriptLayout(output,raw,live);
 return <TranscriptGaps value={result.gaps}><View accessibilityLabel={String(tick)}>{result.entries.map(entry=><TranscriptSeparator key={entry.displayKey??entry.id} leadingItem={entry}/>)}</View></TranscriptGaps>;
}
beforeEach(()=>jest.clearAllMocks());
test('composer-only renders retain display data, gaps and native separators without reprocessing history',async()=>{
 const output=Object.freeze([tool,memory,user]),raw=Object.freeze([user,memory,tool]);
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness output={output} raw={raw}/>);});
 const initial=result!,separators=tree.root.findAllByType(View).filter(node=>node.props.testID==='chat-entry-separator');
 expect(initial.entries.map(row=>row.id)).toEqual([3,2,1]);expect(initial.gaps.get(3)).toBe(0);expect(initial.gaps.get(2)).toBe(CHAT_CONTENT_GAP);
 for(let tick=1;tick<=4;tick++)await act(async()=>tree.update(<Harness output={output} raw={raw} tick={tick}/>));
 expect(result!).toBe(initial);expect(withLiveResponse).toHaveBeenCalledTimes(1);
 const current=tree.root.findAllByType(View).filter(node=>node.props.testID==='chat-entry-separator');
 current.forEach((node,i)=>expect(node).toBe(separators[i]));expect(output.map(row=>row.id)).toEqual([3,2,1]);
 await act(async()=>tree.unmount());
});
test('new generation text is immediate and the live-to-recorded handoff keeps its separator identity',async()=>{
 const raw=[user],output=[user];let tree!:Renderer.ReactTestRenderer;
 const generation=(content:string)=>({run:{taskId:99},generation:{message:{content}}});
 await act(async()=>{tree=Renderer.create(<Harness output={output} raw={raw} live={generation('First')}/>);});
 const first=result!,separator=tree.root.findAllByType(View).find(node=>node.props.testID==='chat-entry-separator');
 expect(first.entries[0]).toMatchObject({displayKey:'generation:99',liveResponse:true,model:[{content:'First'}]});
 await act(async()=>tree.update(<Harness output={output} raw={raw} live={generation('First and second')}/>));
 expect(result!).not.toBe(first);expect(result!.entries[0].model![0].content).toBe('First and second');
 const answer:ReplyEntry={id:4,kind:'pi.assistant',byTaskId:99,model:[{role:'assistant',content:'Finished'}]};
 await act(async()=>tree.update(<Harness output={[answer,user]} raw={[user,answer]}/>));
 expect(result!.entries[0]).toMatchObject({id:4,displayKey:'generation:99'});
 expect(tree.root.findAllByType(View).find(node=>node.props.testID==='chat-entry-separator')).toBe(separator);
 await act(async()=>tree.unmount());
});
test('spacing updates in place when adjacent activities change or a surface is inserted',async()=>{
 let tree!:Renderer.ReactTestRenderer;const raw=[memory,tool];
 await act(async()=>{tree=Renderer.create(<Harness output={[tool,memory]} raw={raw}/>);});
 const separator=tree.root.findAllByType(View).find(node=>node.props.testID==='chat-entry-separator')!;
 expect(StyleSheet.flatten(separator.props.style).height).toBe(0);
 const surface:ReplyEntry={id:8,kind:'bob.inline-surface',inlineSurfaceId:'visual'};
 await act(async()=>tree.update(<Harness output={[tool,surface,memory]} raw={raw}/>));
 expect(tree.root.findAllByType(View).find(node=>node.props.testID==='chat-entry-separator')).toBe(separator);
 expect(StyleSheet.flatten(separator.props.style).height).toBe(CHAT_CONTENT_GAP);
 expect(result!.gaps.get(8)).toBe(CHAT_CONTENT_GAP);await act(async()=>tree.unmount());
});
test('legacy live slots and independent child histories retain their original behavior',async()=>{
 const raw=[user];let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness output={raw} raw={raw} live={{run:{},generation:{message:{content:'Legacy'}}}}/>);});
 expect(result!.legacyLive).toBe(true);expect(result!.entries).toHaveLength(1);
 const old=result!;const child=[memory];await act(async()=>tree.update(<Harness output={child} raw={child}/>));
 expect(result!).not.toBe(old);expect(result!.entries.map(row=>row.id)).toEqual([2]);expect(result!.legacyLive).toBe(false);
 await act(async()=>tree.unmount());
});
