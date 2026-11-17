import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {NativeModules,Alert} from 'react-native';
import {ModelContent} from '../components/model-content';
import {ToolContent} from '../components/tool-content';
import {CopyAction} from '../components/message-actions';
jest.mock('lucide-react-native',()=>({Copy:()=>null,Check:()=>null,ChevronDown:()=>null,ChevronRight:()=>null,SquareTerminal:()=>null}));
jest.mock('../components/chat-markdown',()=>({ChatMarkdown:()=>null}));
jest.mock('../components/speech-action',()=>({SpeechAction:()=>null}));
const original=NativeModules.BobPlatform;
let clipboard:string,copy:jest.Mock;
beforeEach(()=>{clipboard='original';copy=jest.fn(async text=>{clipboard=text;});NativeModules.BobPlatform={copyText:copy};});
afterEach(()=>{NativeModules.BobPlatform=original;jest.restoreAllMocks();});
async function press(tree:Renderer.ReactTestRenderer,label:string){await act(async()=>{tree.root.findAll(node=>(node.props.accessibilityRole==='button'||node.props.role==='button')&&node.props.accessibilityLabel===label)[0].props.onPress();});}
test('actual reply Copy control sends the complete source, preserving literal Markdown and Unicode, but never hidden reasoning',async()=>{
 const text='**Bold** and literal a*b / *****\n```txt\nkeep * exactly\n```\n'+('界😀\n'.repeat(30000))+'COMPLETE END';let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelContent value={[{type:'thinking',thinking:'PRIVATE REASONING'},{type:'redactedThinking',data:'PRIVATE'},{type:'text',text}]}/>);});
 await press(tree,'Copy reply');expect(copy).toHaveBeenCalledTimes(1);expect(clipboard).toBe(text);expect(clipboard.endsWith('COMPLETE END')).toBe(true);expect(clipboard).not.toContain('PRIVATE');
 await act(async()=>tree.unmount());
});
test('expanded tool result copies the complete result, not the 320-character preview',async()=>{
 const text='**literal tool output**\n'+('row\n'.repeat(30000))+'COMPLETE TOOL END';let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ToolContent name="bash" content={'{"command":"synthetic"}'} result={{status:'done',content:[{type:'text',text}]}}/>);});
 await press(tree,'Tool details: bash');await press(tree,'Tool result: bash');await press(tree,'Copy result: bash');expect(clipboard).toBe(text);expect(clipboard.endsWith('COMPLETE TOOL END')).toBe(true);
 await act(async()=>tree.unmount());
});
test('copy failure reports failure rather than false success',async()=>{
 copy.mockRejectedValueOnce(Error('clipboard unavailable'));const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<CopyAction text="complete"/>);});await press(tree,'Copy reply');expect(alert).toHaveBeenCalledWith('Copy failed',expect.any(String));expect(clipboard).toBe('original');await act(async()=>tree.unmount());
});
