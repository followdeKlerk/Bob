import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {PeerAdmission} from '../components/peer-admission';
import {toolResultPreview} from '../tool-presentation';
jest.mock('lucide-react-native',()=>({Check:()=>null,ChevronDown:()=>null,ChevronRight:()=>null,Users:()=>null}));
const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
test('peer admission has a dedicated receipt card with destination, state and expandable recorded details',async()=>{
 const data={peerId:'backend',conversationId:781,requestId:'request-identity',result:{backendId:'backend',conversationId:781,admission:{status:'placed',entry:1375}}};
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<PeerAdmission data={data} peerName="Laptop"/>);});
 const content=flatten(tree.toJSON());for(const label of ['Peer admission','Message admission recorded','Laptop · Conversation 781','Receipt confirmed','placed','not a completed reply'])expect(content).toContain(label);
 expect(content).not.toContain('request-identity');
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Peer admission details'})[0].props.onPress());
 expect(flatten(tree.toJSON())).toContain('request-identity');await act(async()=>tree.unmount());
});
test('peer tool preview summarizes the admission instead of exposing a raw JSON blob',()=>{
 expect(toolResultPreview(JSON.stringify({requestId:'request',admitted:{conversationId:781,admission:{status:'placed'}}}))).toBe('Admission recorded for conversation 781. Receipt is not reply completion.');
});
