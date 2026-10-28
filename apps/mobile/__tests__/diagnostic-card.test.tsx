import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules} from 'react-native';
import {DiagnosticCard} from '../components/diagnostic-card';
const request={id:'request-1',purpose:'Investigate inline fallback',expiresAt:Date.now()+180000,status:'pending',canRespond:true};
let capture:jest.Mock;
beforeEach(()=>{capture=jest.fn(async()=>JSON.stringify({schema:1,collectedAt:Date.now()}));NativeModules.BobPlatform={...NativeModules.BobPlatform,approvedDiagnostics:capture};});
test('request arrival captures nothing; approval must be acknowledged before capture and upload',async()=>{
 let tree!:Renderer.ReactTestRenderer;let release!:(value:unknown)=>void;
 const respond=jest.fn((value:any)=>value.action==='approve'?new Promise(resolve=>{release=resolve;}):Promise.resolve({accepted:true}));
 await act(async()=>{tree=Renderer.create(<DiagnosticCard request={request} respond={respond}/>);});
 expect(capture).not.toHaveBeenCalled();expect(respond).not.toHaveBeenCalled();
 act(()=>{const approve=tree.root.findByProps({accessibilityLabel:'Approve and send diagnostics'}).props.onPress;approve();approve();});
 expect(respond).toHaveBeenCalledTimes(1);expect(capture).not.toHaveBeenCalled();
 await act(async()=>{release({status:'approved'});});
 expect(capture).toHaveBeenCalledTimes(1);expect(respond.mock.calls[1][0]).toEqual(expect.objectContaining({action:'upload',id:request.id,report:expect.objectContaining({schema:1})}));
 await act(async()=>tree.unmount());
});
test('decline, expiry and a different phone never capture',async()=>{
 for(const value of [request,{...request,expiresAt:Date.now()-1},{...request,canRespond:false}]){
  let tree!:Renderer.ReactTestRenderer;const respond=jest.fn(async()=>({}));
  await act(async()=>{tree=Renderer.create(<DiagnosticCard request={value} respond={respond}/>);});
  const decline=tree.root.findAllByProps({accessibilityLabel:'Decline diagnostics'});
  if(decline.length)await act(async()=>decline[0].props.onPress());
  expect(capture).not.toHaveBeenCalled();
  expect(respond.mock.calls.length).toBe(value===request?1:0);
  await act(async()=>tree.unmount());
 }
});
test('failed approval does not capture; already approved remount does not auto-capture or retry',async()=>{
 let tree!:Renderer.ReactTestRenderer;const respond=jest.fn(async()=>{throw Error('offline');});
 await act(async()=>{tree=Renderer.create(<DiagnosticCard request={request} respond={respond}/>);});
 await act(async()=>tree.root.findByProps({accessibilityLabel:'Approve and send diagnostics'}).props.onPress());
 expect(capture).not.toHaveBeenCalled();expect(respond).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<DiagnosticCard request={{...request,status:'approved'}} respond={respond}/>));
 expect(capture).not.toHaveBeenCalled();expect(respond).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
