import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState,Linking,NativeModules,StyleSheet,Text} from 'react-native';
import {MarkdownIt} from 'react-native-markdown-display';
import {ChatMotionProvider} from '../chat-motion';
import {ChatMarkdown} from '../components/chat-markdown';
import {ModelContent} from '../components/model-content';
import {StreamingText} from '../components/streaming-text';
import {ChatBubble} from '../components/chat-bubble';
import {CopyAction} from '../components/message-actions';
import {LinkPreviewFooter} from '../components/link-preview-footer';
jest.mock('lucide-react-native',()=>({Copy:()=>null,Check:()=>null,Volume2:()=>null,Square:()=>null}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('../components/tool-content',()=>({ToolContent:()=>require('react').createElement(require('react-native').Text,null,'TOOL')}));
const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
const linkButtons=(root:Renderer.ReactTestInstance)=>root.findAll(node=>node.props.accessibilityRole==='link'&&typeof node.props.onPress==='function'&&!node.children.some(child=>typeof child!=='string'&&child.props.accessibilityRole==='link'&&typeof child.props.onPress==='function'));
const currentState=Object.getOwnPropertyDescriptor(AppState,'currentState');
let appChange:(state:any)=>void,reduceChange:(value:boolean)=>void;
beforeEach(()=>{
 jest.clearAllMocks();
 jest.useFakeTimers({doNotFake:['queueMicrotask','nextTick','setImmediate']});
 Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{appChange=callback;return {remove:jest.fn()};});
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((event,callback)=>{if(event==='reduceMotionChanged')reduceChange=callback;return {remove:jest.fn()};});
});
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();jest.restoreAllMocks();if(currentState)Object.defineProperty(AppState,'currentState',currentState);});
const advance=async(ms:number)=>{await act(async()=>jest.advanceTimersByTime(ms));};

test('progressive text and finalization stay immediate, selectable and keyed without timer-driven reparses',async()=>{
 const parse=jest.spyOn(MarkdownIt.prototype,'parse');
 let tree!:Renderer.ReactTestRenderer;
 const render=(text:string,streaming=true)=><ChatMotionProvider active><ChatMarkdown text={text} streaming={streaming}/></ChatMotionProvider>;
 await act(async()=>{tree=Renderer.create(render('Hello'));});
 const markdown=()=>tree.root.find(node=>!!node.props.markdownit&&!!node.props.rules);
 const rules=markdown().props.rules;
 const originalLeaf=tree.root.findByType(StreamingText),textGroup=tree.root.findAllByType(Text).find(node=>node.props.selectable);
 for(const text of ['Hello world','Hello world, all here','Hello world, all here immediately']){
  await act(async()=>tree.update(render(text)));
  expect(tree.root.findByType(StreamingText)===originalLeaf).toBe(true);
  expect(tree.root.findAllByType(Text).find(node=>node.props.selectable)===textGroup).toBe(true);
  expect(flatten(tree.toJSON())).toBe(text);
  expect(markdown().props.rules).toBe(rules);
  expect(StyleSheet.flatten(textGroup!.props.style).opacity).toBeUndefined();
  expect(tree.root.findAllByProps({testID:'streaming-text-edge'})).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
 }
 const parses=parse.mock.calls.length;
 await advance(1000);expect(parse).toHaveBeenCalledTimes(parses);
 await act(async()=>tree.update(render('Hello world, all here immediately',false)));
 expect(parse).toHaveBeenCalledTimes(parses); // No parse on streaming -> done alone.
 expect(tree.root.findByType(StreamingText)===originalLeaf).toBe(true);
 expect(flatten(tree.toJSON())).toBe('Hello world, all here immediately');
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});
test('replacement, partial syntax completion and fast whole-answer completion never replay old prose',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(text:string,streaming=true)=><ChatMotionProvider active><ChatMarkdown text={text} streaming={streaming}/></ChatMotionProvider>;
 await act(async()=>{tree=Renderer.create(render('**Open'));});
 await act(async()=>tree.update(render('**Open**')));expect(flatten(tree.toJSON())).toBe('Open');
 await act(async()=>tree.update(render('Replacement response')));expect(flatten(tree.toJSON())).toBe('Replacement response');
 await act(async()=>tree.update(render('A complete answer received at once',false)));
 expect(flatten(tree.toJSON())).toBe('A complete answer received at once');
 expect(tree.root.findAllByProps({testID:'streaming-text-edge'})).toHaveLength(0);
 expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.unmount());
});
test('reduced motion/background/hidden changes never fade, queue or replay already received text',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(text:string,active=true)=><ChatMotionProvider active={active}><ChatMarkdown streaming text={text}/></ChatMotionProvider>;
 const stable=()=>{expect(jest.getTimerCount()).toBe(0);expect(tree.root.findAllByProps({testID:'streaming-text-edge'})).toHaveLength(0);};
 await act(async()=>{tree=Renderer.create(render('First'));});
 await act(async()=>tree.update(render('First append')));stable();
 await act(async()=>reduceChange(true));stable();
 await act(async()=>reduceChange(false));stable();
 await act(async()=>tree.update(render('First append more')));stable();
 await act(async()=>appChange('background'));stable();
 await act(async()=>appChange('active'));stable();
 await act(async()=>tree.update(render('First append more now',false)));stable();
 await act(async()=>tree.update(render('First append more now')));stable();
 expect(flatten(tree.toJSON())).toBe('First append more now');
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});
test('screen-reader appends render all text immediately without opacity timers',async()=>{
 jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
 let tree!:Renderer.ReactTestRenderer;
 const render=(text:string)=><ChatMotionProvider active><ChatMarkdown streaming text={text}/></ChatMotionProvider>;
 await act(async()=>{tree=Renderer.create(render('Start'));});
 await act(async()=>tree.update(render('Start and all of the rest')));
 expect(flatten(tree.toJSON())).toBe('Start and all of the rest');
 expect(tree.root.findAllByProps({testID:'streaming-text-edge'})).toHaveLength(0);expect(jest.getTimerCount()).toBe(0);
 await act(async()=>tree.unmount());
});
test('same-length correction, scope replacement and unmount have no stale suffix work to complete',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(text:string,scope='first')=><ChatMotionProvider active><ChatMarkdown key={scope} streaming text={text}/></ChatMotionProvider>;
 await act(async()=>{tree=Renderer.create(render('Start'));});
 for(const text of ['Start append','Start amend!','Entirely replaced','Entirely replaced 👩🏽‍💻']){
  await act(async()=>tree.update(render(text)));
  expect(flatten(tree.toJSON())).toBe(text);expect(jest.getTimerCount()).toBe(0);
 }
 await act(async()=>tree.update(render('New scope','second')));
 await advance(1000);expect(flatten(tree.toJSON())).toBe('New scope');
 await act(async()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
 await advance(1000);expect(jest.getTimerCount()).toBe(0);
});
test('actual assistant links footer is inside only prose bubbles; copy retains complete source and tools remain outside',async()=>{
 const source='Read [**Docs**](https://example.com/docs) and [Guide][ref].\n\n[ref]: https://guide.example';
 const value=[{type:'text',text:source},{type:'toolCall',id:'tool',name:'read',arguments:{}},{type:'text',text:'No references here.'}];
 NativeModules.BobPlatform={copyText:jest.fn().mockResolvedValue(undefined)};
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(undefined);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelContent bubbleText speakable={false} streaming value={value}/>);});
 const bubbles=tree.root.findAllByType(ChatBubble);expect(bubbles).toHaveLength(2);
 expect(bubbles[0].findAll(node=>node.props.testID==='assistant-link-footer'&&!node.children.some(child=>typeof child!=='string'&&child.props.testID==='assistant-link-footer'))).toHaveLength(1);
 expect(bubbles[1].findAllByProps({testID:'assistant-link-footer'})).toHaveLength(0);
 expect(bubbles[0].findAllByType(CopyAction)).toHaveLength(0);
 const footer=bubbles[0].findByType(LinkPreviewFooter);
 expect(footer.findAllByType(Text).map(node=>flatten(node.props.children)).join('')).not.toContain('TOOL');
 const buttons=linkButtons(footer);
 expect(buttons.map(node=>node.props.accessibilityLabel)).toEqual(['Docs, example.com','Guide, guide.example']);
 expect(buttons.every(node=>StyleSheet.flatten(node.props.style).minHeight>=44)).toBe(true);
 expect(open).not.toHaveBeenCalled();
 await act(async()=>buttons[0].props.onPress());expect(open).toHaveBeenCalledWith('https://example.com/docs');
 const copies=tree.root.findAllByType(CopyAction);expect(copies[0].props.text).toBe(source);
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Copy reply'}).find(node=>typeof node.props.onPress==='function')!.props.onPress());
 expect(NativeModules.BobPlatform.copyText).toHaveBeenCalledWith(source);
 // Prop changes must pass ModelContent's memo comparator even with value stable.
 await act(async()=>tree.update(<ModelContent bubbleText speakable={false} value={value}/>));
 expect(tree.root.findAllByType(ChatMarkdown).every(node=>node.props.streaming===false)).toBe(true);
 await act(async()=>tree.update(<ModelContent speakable={false} value={value}/>));
 expect(tree.root.findAllByProps({testID:'assistant-link-footer'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});
test('links footer starts bounded, expands accessibly, and does not fetch or open anything on render',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(undefined);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMarkdown linkPreviews text={Array.from({length:5},(_,index)=>`[Link ${index}](https://example.com/${index})`).join(' ')}/>);});
 const footer=tree.root.findByType(LinkPreviewFooter);
 const count=()=>linkButtons(footer).length;
 expect(count()).toBe(3);expect(open).not.toHaveBeenCalled();
 const expand=footer.findByProps({accessibilityLabel:'Show 2 more links'});
 expect(expand.props.accessibilityState).toEqual({expanded:false});
 await act(async()=>expand.props.onPress());expect(count()).toBe(5);
 await act(async()=>footer.findByProps({accessibilityLabel:'Show fewer links'}).props.onPress());expect(count()).toBe(3);
 await act(async()=>tree.unmount());
});
