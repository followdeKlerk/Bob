import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {useTranscriptLiveTools} from '../transcript-live-tools';
import {reuseSnapshotEntries} from '../snapshot-cache';
import {linkToolResults} from '../tool-results';
import {surfaceAnchors} from '../surface-placement';
const app='11111111-1111-4111-8111-111111111111';
const entries:any[]=[
 {id:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'toolCall',id:'visual',name:'render_visual'},{type:'toolCall',id:'code',name:'codemode'}]}]},
 {id:2,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'unloaded',content:'Unmatched saved result'}]},
 {id:3,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'saved',content:'Persisted authority',isError:true}]},
];
test('narrow live projection is equivalent for tool identity, results, nested progress and surface authority',()=>{
 let selected:any;function Probe({live}:{live:any}){selected=useTranscriptLiveTools(live);return null;}
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<Probe live={undefined}/>);});
 try{
  const cases=[undefined,{},
   {generation:{message:{content:[{type:'text',text:'Prose'},{type:'thinking',thinking:'Hidden'},{type:'toolCall',id:'unloaded',name:'any',arguments:{changing:1}}]}},tools:[]},
   {generation:{message:{content:[{type:'toolCall',id:'changed'}]}},tools:[{callId:'saved',status:'running',output:'Must lose to stored result'},{callId:'orphan',status:'done'}]},
   {tools:[{callId:'visual',status:'done',entry:99,output:`Isolated visual ${app}: preview`}]},
   {tools:[{callId:'visual',status:'failed',output:`Isolated visual ${app}: preview`}]},
   {tools:[{callId:'code',taskId:8,status:'running'}],nestedTools:[{callId:'child',taskId:9,parentCallId:'code',parentTaskId:8,name:'read',status:'running',arguments:{path:'fixture'}}]},
   {tools:[{callId:'code',taskId:8,status:'running'}],nestedTools:[{callId:'child',taskId:9,parentCallId:'code',parentTaskId:8,name:'read',status:'done',summary:{isError:true,error:'fixture failure'}}]},
  ];
  for(const live of cases){act(()=>tree.update(<Probe live={live}/>));expect(linkToolResults(entries,selected)).toEqual(linkToolResults(entries,live));expect(surfaceAnchors(entries,selected)).toEqual(surfaceAnchors(entries,live));}
 }finally{act(()=>tree.unmount());}
});
test('only tool-state and call-identity changes invalidate history; prose, thinking and arguments still reach the full live path',()=>{
 let selected:any;function Probe({live}:{live:any}){selected=useTranscriptLiveTools(live);return null;}
 const initial={entries:[],docs:{'pi.live':{tools:[],nestedTools:[],generation:{message:{content:[{type:'toolCall',id:'call',arguments:{text:'A'}},{type:'text',text:'A'}]}}}}};
 let tree!:Renderer.ReactTestRenderer;act(()=>{tree=Renderer.create(<Probe live={initial.docs['pi.live']}/>);});
 try{
  const old=selected,next=JSON.parse(JSON.stringify(initial));next.docs['pi.live'].generation.message.content[0].arguments.text='AB';next.docs['pi.live'].generation.message.content[1].text='AB';
  const reused=reuseSnapshotEntries(initial,next);act(()=>tree.update(<Probe live={reused.docs['pi.live']}/>));expect(selected).toBe(old);expect(reused.docs['pi.live'].generation).toBe(next.docs['pi.live'].generation);
  const changed=JSON.parse(JSON.stringify(next));changed.docs['pi.live'].generation.message.content[0].id='different';const current=reuseSnapshotEntries(reused,changed);act(()=>tree.update(<Probe live={current.docs['pi.live']}/>));expect(selected).not.toBe(old);
  act(()=>tree.update(<Probe live={undefined}/>));expect(linkToolResults(entries,selected)).toEqual(linkToolResults(entries,undefined));
 }finally{act(()=>tree.unmount());}
});
