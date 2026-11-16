import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text as NativeText} from 'react-native';
import {Text} from '../components/app-text';
import {StreamingText} from '../components/streaming-text';

jest.mock('../chat-motion',()=>({useChatMotion:()=>true}));
jest.mock('../components/app-text',()=>({Text:jest.fn(({children,...props})=>require('react').createElement(require('react-native').Text,props,children))}));
const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
beforeEach(()=>{jest.useFakeTimers();jest.mocked(Text).mockClear();});
afterEach(()=>jest.useRealTimers());

test('bounded render-work sample: one changed span among 64 unchanged styled spans',async()=>{
 const sample=(tail:string,start:number|null)=> <>{Array.from({length:64},(_,index)=><StreamingText key={index} text={index===63?tail:`Stable ${index}`} start={index===63?start:null} style={[{color:'#222'},{fontSize:15,lineHeight:25}]}/>)}</>;
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(sample('Growing',null));});
 jest.mocked(Text).mockClear();
 await act(async()=>tree.update(sample('Growing tail',7)));
 const immediate=jest.mocked(Text).mock.calls.length;
 await act(async()=>{jest.advanceTimersByTime(70);});
 await act(async()=>{jest.advanceTimersByTime(70);});
 // Baseline f59180f: 67 Text calls immediately, 71 after both 70ms steps.
 expect(immediate).toBe(1);expect(jest.mocked(Text)).toHaveBeenCalledTimes(1);
 jest.runAllTicks();expect(jest.getTimerCount()).toBe(0);
 expect(flatten(tree.toJSON())).toContain('Growing tail');
 await act(async()=>tree.unmount());
});

test('every burst, same-length correction, Unicode and finalization is present immediately with stable native identity',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<StreamingText text="Start" start={null}/>);});
 const native=tree.root.findByType(NativeText);
 for(const text of ['Start 👩🏽‍💻','Start 👩🏽‍💻 e\u0301','Same length A','Same length B','短い','']){
  await act(async()=>tree.update(<StreamingText text={text} start={1}/>));
  expect(flatten(tree.toJSON())).toBe(text);
  expect(tree.root.findByType(NativeText)===native).toBe(true);
 }
 await act(async()=>tree.update(<StreamingText text="Final 🇳🇿 answer" start={null}/>));
 expect(flatten(tree.toJSON())).toBe('Final 🇳🇿 answer');
 jest.runAllTicks();expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.unmount());
});

test('equivalent recreated styles do not suppress a genuine font/color change',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<StreamingText text="Stable" start={null} style={{color:'#222',fontSize:15}}/>);});
 await act(async()=>tree.update(<StreamingText text="Stable" start={null} style={[{color:'#eee'},{fontSize:23}]}/>));
 expect(StyleSheet.flatten(tree.root.findByType(NativeText).props.style)).toMatchObject({color:'#eee',fontSize:23});
 await act(async()=>tree.unmount());
});
