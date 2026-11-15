import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {BtwSheet} from '../components/btw-sheet';
import {TextInput} from '../components/app-text';
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('uuid',()=>({v4:()=> '22222222-2222-4222-8222-222222222222'}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('../components/ui/text',()=>({Text:require('react-native').Text,TextClassContext:require('react').createContext(undefined)}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../app-motion',()=>({...jest.requireActual('../app-motion'),useAppMotion:()=>false}));
jest.mock('../components/chat-markdown',()=>({ChatMarkdown:({text}:{text:string})=>require('react').createElement(require('react-native').Text,null,text)}));
const id='11111111-1111-4111-8111-111111111111';
const thread={id,revision:0,model:{provider:'fixture',modelId:'same-as-main'},createdAt:1,expiresAt:2,snapshot:{characters:200,truncated:false,omitsLive:true},messages:[]};
test('initial /btw question makes one side request, never a parent-message request; closing and reopening never repeats it',async()=>{
 const request=jest.fn(async(path:string,method?:string,body?:any)=>{
  if(path.endsWith('/messages'))return {...thread,revision:1,messages:[{requestId:body.requestId,question:body.text,status:'done',answer:'Side answer'}]};
  if(method==='POST')return thread;
  return {unchanged:true};
 });
 const initial={id:'command-one',text:'Why that plan?'},close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const render=(visible=true)=><BtwSheet active visible={visible} conversationId={7} initial={initial} request={request} onClose={close}/>;
 await act(async()=>{tree=Renderer.create(render());});
 expect(request.mock.calls.filter(([path,method])=>path.endsWith('/messages')&&method==='POST')).toHaveLength(1);
 expect(request.mock.calls.every(([path])=>path.startsWith('chats/7/btw'))).toBe(true);
 expect(tree.root.findByType(TextInput).props.value).toBe('');
 await act(async()=>tree.update(render(false)));await act(async()=>tree.update(render()));
 expect(request.mock.calls.filter(([path,method])=>path.endsWith('/messages')&&method==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});
test('bare /btw opens without a model request and keeps an unsent side draft on reopen',async()=>{
 const request=jest.fn(async(_path:string,method?:string)=>method==='POST'?thread:{unchanged:true});
 const initial={id:'open-one',text:''};let tree!:Renderer.ReactTestRenderer;
 const render=(visible=true)=><BtwSheet active visible={visible} conversationId={7} initial={initial} request={request} onClose={()=>{}}/>;
 await act(async()=>{tree=Renderer.create(render());});
 const input=tree.root.findByType(TextInput);act(()=>input.props.onChangeText('Keep my side draft'));
 await act(async()=>tree.update(render(false)));await act(async()=>tree.update(render()));
 expect(tree.root.findByType(TextInput).props.value).toBe('Keep my side draft');
 expect(request.mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});
test('receipt reconciliation clears an unconfirmed but accepted question instead of leaving it ready to send twice',async()=>{
 let receipt:any;
 const request=jest.fn(async(path:string,method?:string,body?:any)=>{
  if(path.endsWith('/messages')){receipt={...thread,revision:1,messages:[{requestId:body.requestId,question:body.text,status:'done',answer:'Accepted despite lost response'}]};throw Error('Lost transport');}
  if(method==='POST')return thread;
  return receipt??thread;
 });
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<BtwSheet active visible conversationId={7} initial={{id:'command',text:'A side question'}} request={request} onClose={()=>{}}/>);});
 expect(tree.root.findByType(TextInput).props.value).toBe('A side question');
 await act(async()=>tree.root.findAll(node=>node.props.accessibilityLabel==='Check side-chat status'&&typeof node.props.onPress==='function')[0].props.onPress());
 expect(tree.root.findByType(TextInput).props.value).toBe('');
 expect(request.mock.calls.filter(([path,method])=>path.endsWith('/messages')&&method==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});
