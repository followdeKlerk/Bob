import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {ModelContent} from '../components/model-content';
import {SpeechAction} from '../components/speech-action';
import {CopyAction} from '../components/message-actions';
jest.mock('../components/chat-markdown',()=>({ChatMarkdown:({text}:{text:string})=>require('react').createElement(require('react-native').Text,null,text)}));
jest.mock('../components/tool-content',()=>({ToolContent:({name}:{name:string})=>require('react').createElement(require('react-native').Text,null,`TOOL:${name}`)}));
jest.mock('../components/message-actions',()=>({ActionRow:require('react-native').View,CopyAction:({text}:{text:string})=>require('react').createElement(require('react-native').Text,null,`COPY:${text}`)}));
jest.mock('../components/speech-action',()=>({SpeechAction:({text}:{text:string})=>require('react').createElement(require('react-native').Text,null,`SPEAK:${text}`)}));
const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
test('reply copy action stays directly with its text, before subsequent tool cards',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelContent value={[{type:'text',text:'I am checking this.'},{type:'toolCall',id:'tool',name:'bash',arguments:{command:'npm test'}}]}/>);});
 const output=flatten(tree.toJSON());expect(output.indexOf('COPY:I am checking this.')).toBeLessThan(output.indexOf('TOOL:bash'));
 expect(tree.root.findAllByType(CopyAction)).toHaveLength(1);await act(async()=>tree.unmount());
});
test('tool-only and hidden-reasoning messages never produce orphan copy buttons',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelContent value={[{type:'thinking',thinking:'hidden'},{type:'text',text:'  '},{type:'toolCall',id:'tool',name:'read',arguments:{path:'file'}}]}/>);});
 expect(tree.root.findAllByType(CopyAction)).toHaveLength(0);
 await act(async()=>tree.update(<ModelContent value={[{type:'thinking',thinking:'hidden'}]}/>));expect(tree.toJSON()).toBeNull();
 await act(async()=>tree.unmount());
});
test('separate visible text groups copy their own text rather than unrelated text across tool cards',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelContent value={[{type:'text',text:'Before'},{type:'text',text:'More context'},{type:'toolCall',id:'tool',name:'bash',arguments:{}},{type:'text',text:'After'}]}/>);});
 expect(tree.root.findAllByType(CopyAction).map(copy=>copy.props.text)).toEqual(['Before\nMore context','After']);
 await act(async()=>tree.unmount());
});

test('quiet transcript renders replies without tool cards or gaps and still copies visible text',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const value=[{type:'text',text:'Before'},{type:'toolCall',id:'tool',name:'bash',arguments:{command:'echo test'}},{type:'text',text:'After'}];
 await act(async()=>{tree=Renderer.create(<ModelContent showTools={false} value={value}/>);});
 expect(flatten(tree.toJSON())).not.toContain('TOOL:');
 expect(tree.root.findAllByType(CopyAction).map(copy=>copy.props.text)).toEqual(['Before\nAfter']);
 await act(async()=>tree.update(<ModelContent showTools={false} value={[value[1]]}/>));expect(tree.toJSON()).toBeNull();
 await act(async()=>tree.unmount());
});


test('read aloud only receives visible text and is absent from streaming or non-assistant content',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const value=[{type:'thinking',thinking:'private'},{type:'toolCall',id:'t',name:'bash',arguments:{secret:'value'}},{type:'text',text:'Visible reply'}];
 await act(async()=>{tree=Renderer.create(<ModelContent value={value}/>);});
 expect(tree.root.findAllByType(SpeechAction).map(action=>action.props.text)).toEqual(['Visible reply']);
 await act(async()=>tree.update(<ModelContent value={value} speakable={false}/>));
 expect(tree.root.findAllByType(SpeechAction)).toHaveLength(0);
 await act(async()=>tree.unmount());
});
