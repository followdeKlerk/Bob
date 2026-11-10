import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState,Text} from 'react-native';
import {ChatMotionProvider,useChatMotion} from '../chat-motion';

const deferred=()=>{let resolve!:(value:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done;});return {promise,resolve};};
function Probe(){return <Text testID="motion">{String(useChatMotion())}</Text>;}
let appChange:(state:any)=>void;
let preferences:Record<string,(value:boolean)=>void>;
let removals:jest.Mock[],appRemove:jest.Mock;
const currentState=Object.getOwnPropertyDescriptor(AppState,'currentState');
beforeEach(()=>{
 jest.clearAllMocks();
 preferences={};removals=[];appRemove=jest.fn();
 Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_name,callback)=>{appChange=callback;return {remove:appRemove};});
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((name,callback)=>{
  preferences[name]=callback;const remove=jest.fn();removals.push(remove);return {remove};
 });
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(()=>{jest.restoreAllMocks();if(currentState)Object.defineProperty(AppState,'currentState',currentState);});
const value=(tree:Renderer.ReactTestRenderer)=>tree.root.findByProps({testID:'motion'}).props.children;

test('motion defaults off outside a provider, and waits for both accessibility preferences',async()=>{
 const reduce=deferred(),reader=deferred();
 jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(reduce.promise);
 jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValue(reader.promise);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Probe/>);});expect(value(tree)).toBe('false');
 await act(async()=>tree.update(<ChatMotionProvider active><Probe/></ChatMotionProvider>));expect(value(tree)).toBe('false');
 await act(async()=>reduce.resolve(false));expect(value(tree)).toBe('false');
 await act(async()=>reader.resolve(false));expect(value(tree)).toBe('true');
 await act(async()=>preferences.reduceMotionChanged(true));expect(value(tree)).toBe('false');
 await act(async()=>preferences.reduceMotionChanged(false));expect(value(tree)).toBe('true');
 await act(async()=>preferences.screenReaderChanged(true));expect(value(tree)).toBe('false');
 await act(async()=>tree.unmount());expect(removals.every(remove=>remove.mock.calls.length===1)).toBe(true);expect(appRemove).toHaveBeenCalledTimes(1);
});
test('background and hidden chat clean up; foreground re-resolves instead of reusing stale preferences',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(active=true)=><ChatMotionProvider active={active}><Probe/></ChatMotionProvider>;
 await act(async()=>{tree=Renderer.create(render());});expect(value(tree)).toBe('true');
 await act(async()=>appChange('background'));expect(value(tree)).toBe('false');expect(removals.every(remove=>remove.mock.calls.length===1)).toBe(true);
 const reader=deferred();jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValue(reader.promise);
 await act(async()=>appChange('active'));expect(value(tree)).toBe('false');
 await act(async()=>reader.resolve(false));expect(value(tree)).toBe('true');
 await act(async()=>tree.update(render(false)));expect(value(tree)).toBe('false');expect(appRemove).toHaveBeenCalledTimes(1);
 expect(removals.every(remove=>remove.mock.calls.length===1)).toBe(true);
 await act(async()=>tree.unmount());
});
test('new preference events win over older asynchronous query results, and query failures stay disabled',async()=>{
 const reduce=deferred();jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(reduce.promise);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMotionProvider active><Probe/></ChatMotionProvider>);});
 await act(async()=>preferences.reduceMotionChanged(true));
 await act(async()=>reduce.resolve(false));expect(value(tree)).toBe('false');
 await act(async()=>tree.unmount());
 jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValue(new Error('Unavailable'));
 await act(async()=>{tree=Renderer.create(<ChatMotionProvider active><Probe/></ChatMotionProvider>);});expect(value(tree)).toBe('false');
 await act(async()=>tree.unmount());
});
test('initial background and inactive chat never query preferences',async()=>{
 Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'background'});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMotionProvider active><Probe/></ChatMotionProvider>);});
 expect(value(tree)).toBe('false');expect(AccessibilityInfo.isReduceMotionEnabled).not.toHaveBeenCalled();
 await act(async()=>tree.update(<ChatMotionProvider active={false}><Probe/></ChatMotionProvider>));
 expect(AccessibilityInfo.isScreenReaderEnabled).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('duplicate foreground notifications do not strand resolved motion preferences',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMotionProvider active><Probe/></ChatMotionProvider>);});expect(value(tree)).toBe('true');
 await act(async()=>appChange('active'));expect(value(tree)).toBe('true');expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
 await act(async()=>preferences.reduceMotionChanged(true));await act(async()=>appChange('active'));expect(value(tree)).toBe('false');
 await act(async()=>appChange('background'));await act(async()=>appChange('background'));expect(value(tree)).toBe('false');
 await act(async()=>appChange('active'));expect(value(tree)).toBe('true');expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(2);
 await act(async()=>tree.unmount());
});
