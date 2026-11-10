import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,Animated,AppState,Image,PanResponder,StyleSheet,Text as NativeText,type PanResponderCallbacks} from 'react-native';
import {ImageAttachmentStack,type ImageStackItem} from '../components/image-attachment-stack';
import {ChatMotionProvider} from '../chat-motion';
import {APP_FONT_FAMILY} from '../typography';
import {ThemeContext,tokens} from '../theme-context';

jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
let mockMotion:boolean|undefined=false;
jest.mock('../chat-motion',()=>{
 const actual=jest.requireActual('../chat-motion');
 return {...actual,useChatMotion:()=>{const permitted=actual.useChatMotion();return mockMotion??permitted;}};
});
const images:ImageStackItem[]=['a','b','c','d'].map(id=>({id,name:`${id}.jpg`,source:{uri:`file:///${id}.jpg`}}));
const originalState=Object.getOwnPropertyDescriptor(AppState,'currentState');
let tree:Renderer.ReactTestRenderer|undefined;
let changes:Set<(state:any)=>void>;
let appRemovals:jest.Mock[];
let preferences:Record<string,(enabled:boolean)=>void>;
type Pending={value:Animated.Value;config:any;finish:(finished?:boolean)=>void;stop:jest.Mock};
let pending:Pending[];
let pan:jest.SpyInstance;
const defaults={images:images.slice(0,3),onOpen:jest.fn(),onDetails:jest.fn(),onSave:jest.fn()};
const node=(id:string)=>tree!.root.findByProps({testID:id});
const button=(label:string)=>tree!.root.findAll(item=>item.props.accessibilityLabel===label&&typeof item.props.onPress==='function')[0];
const press=async(label:string)=>{await act(async()=>button(label).props.onPress());};
const count=()=>node('image-stack-front').props.accessibilityValue.text.replace('Image ','').replace(' of ',' / ');
const gestures=()=>pan.mock.calls[pan.mock.calls.length-1][0] as PanResponderCallbacks;
const gesture=(dx:number,dy=0)=>({dx,dy,vx:0,vy:0,moveX:dx,moveY:dy,x0:0,y0:0,stateID:1,numberActiveTouches:1});
const call=async(name:keyof PanResponderCallbacks,dx=0,dy=0)=>{await act(async()=>{(gestures()[name] as any)?.({},gesture(dx,dy));});};
const render=async(props:Partial<React.ComponentProps<typeof ImageAttachmentStack>>={})=>{
 await act(async()=>{tree=Renderer.create(<ImageAttachmentStack {...defaults} {...props}/>);});
};
const update=async(props:Partial<React.ComponentProps<typeof ImageAttachmentStack>>={})=>{
 await act(async()=>tree!.update(<ImageAttachmentStack {...defaults} {...props}/>));
};
const load=async(id:string,width=200,height=200)=>{
 await act(async()=>node(`image-stack-image-${id}`).props.onLoad({nativeEvent:{source:{width,height}}}));
};
const finish=async(index:number,finished=true)=>{await act(async()=>pending[index].finish(finished));};
beforeEach(()=>{
 jest.clearAllMocks();mockMotion=false;pending=[];changes=new Set();appRemovals=[];preferences={};
 Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{
  changes.add(callback);const remove=jest.fn(()=>changes.delete(callback));appRemovals.push(remove);return {remove};
 });
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((name,callback)=>{preferences[name]=callback;return {remove:jest.fn()};});
 const animate=(value:any,config:any)=>{
  let callback:((result:{finished:boolean})=>void)|undefined;
  const stop=jest.fn(()=>callback?.({finished:false}));
  pending.push({value,config,stop,finish:(finished=true)=>{if(finished)value.setValue(config.toValue);callback?.({finished});}});
  return {start:jest.fn(done=>{callback=done;}),stop,reset:jest.fn()};
 };
 jest.spyOn(Animated,'timing').mockImplementation(animate);
 jest.spyOn(Animated,'spring').mockImplementation(animate);
 pan=jest.spyOn(PanResponder,'create');
});
afterEach(async()=>{
 if(tree){await act(async()=>tree!.unmount());tree=undefined;}
 jest.restoreAllMocks();if(originalState)Object.defineProperty(AppState,'currentState',originalState);
});

// These are JS state/responder simulations and style assertions, NOT native gesture/render proof.
test('one image is a large rounded card, opens on tap, with small equal unboxed info/save targets',async()=>{
 await render({images:images.slice(0,1)});
 expect(count()).toBe('1 / 1');expect(button('Next image')).toBeUndefined();expect(button('Previous image')).toBeUndefined();
 const rootStyle=StyleSheet.flatten(node('image-attachment-stack').props.style);
 expect(rootStyle).toMatchObject({width:'100%',maxWidth:280,overflow:'hidden'});expect(rootStyle.alignSelf).toBeUndefined();
 const front=StyleSheet.flatten(node('image-stack-card-a').props.style);
 expect(front).toMatchObject({left:16,right:16,top:20,height:248});
 const card=node('image-stack-card-a').findAll(item=>{const style=StyleSheet.flatten(item.props.style);return style?.borderRadius===20&&style.overflow==='hidden';})[0];
 expect(StyleSheet.flatten(card.props.style)).toMatchObject({overflow:'hidden',borderRadius:20});
 const info=StyleSheet.flatten(button('Attachment details: a.jpg').props.style),save=StyleSheet.flatten(button('Save a.jpg').props.style);
 expect(info).toEqual(save);expect(info).toMatchObject({width:48,height:48});expect(info.borderWidth).toBeUndefined();expect(info.backgroundColor).toBeUndefined();
 await press('Open a.jpg');await press('Attachment details: a.jpg');await press('Save a.jpg');
 expect(defaults.onOpen).toHaveBeenCalledWith(images[0]);expect(defaults.onDetails).toHaveBeenCalledWith(images[0]);expect(defaults.onSave).toHaveBeenCalledWith(images[0]);
 for(const text of tree!.root.findAllByType(NativeText))expect(StyleSheet.flatten(text.props.style).fontFamily).toBe(APP_FONT_FAMILY);
});

test.each(['loading','failed','missing'] as const)('%s placeholder hides visible filenames but retains accessible names and Info',async status=>{
 const image=status==='missing'?{id:images[0].id,name:images[0].name}:images[0];
 await render({images:[image]});if(status==='failed')await act(async()=>node('image-stack-image-a').props.onError());
 const visible=tree!.root.findAllByType(NativeText).map(text=>text.props.children);
 expect(visible).not.toContain(image.name);expect(visible).toContain(status==='loading'?'Loading image…':'Preview unavailable');
 expect(button(`Open ${image.name}`)).toBeDefined();expect(button(`Attachment details: ${image.name}`)).toBeDefined();
 if(status==='failed')expect(button(`Retry preview: ${image.name}`)).toBeDefined();
 await press(`Attachment details: ${image.name}`);expect(defaults.onDetails).toHaveBeenCalledWith(image);
});

test.each(['light','dark'] as const)('cards use the existing restrained floating shadow and inset unclipped wrapper in %s',async scheme=>{
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><ImageAttachmentStack {...defaults}/></ThemeContext.Provider>);});
 for(const id of ['a','b','c']){
  const wrapper=StyleSheet.flatten(node(`image-stack-card-${id}`).props.style);
  expect(wrapper.boxShadow).toBe(tokens[scheme].shadows.floating.boxShadow);expect(wrapper.borderRadius).toBe(tokens[scheme].menuChrome.card.borderRadius);
  expect(wrapper).toMatchObject({left:16,right:16});expect(wrapper.top).toBeGreaterThanOrEqual(10);expect(wrapper.overflow).toBeUndefined();
 }
 const front=StyleSheet.flatten(node('image-stack-card-a').props.style),stage=StyleSheet.flatten(node('image-stack-stage').props.style);
 expect(stage.height-front.top-front.height).toBe(20);
 // These are token/inset assertions; the parent's native render checks shadow pixels/clipping.
});

test('navigation and actions share a footer without visible image numbers',async()=>{
 await render();const footer=node('image-stack-footer');
 expect(StyleSheet.flatten(footer.props.style)).toMatchObject({flexDirection:'row',flexWrap:'wrap',alignItems:'center'});
 expect(tree!.root.findAllByProps({testID:'image-stack-count'})).toHaveLength(0);
 expect(footer.findAllByType(NativeText)).toHaveLength(0);
 expect(node('image-stack-front').props.accessibilityValue).toEqual({text:'Image 1 of 3'});
 for(const label of ['Previous image','Next image','Attachment details: a.jpg','Save a.jpg']){
  const control=button(label);expect(footer.findAll(item=>item===control)).toHaveLength(1);expect(typeof control.props.style).not.toBe('function');
  expect(StyleSheet.flatten(control.props.style)).toMatchObject({width:48,height:48});
 }

 // Style assertions only: actual Yoga wrapping and large-font geometry need native rendering.
 expect(StyleSheet.flatten(node('image-attachment-stack').props.style).alignSelf).toBeUndefined();
});

test('multi-image stage height stays fixed across image loads, swipes, and selection changes',async()=>{
 mockMotion=true;await render();const stageHeight=()=>StyleSheet.flatten(node('image-stack-stage').props.style).height;
 expect(stageHeight()).toBe(288);await load('a',1000,100);expect(stageHeight()).toBe(288);await load('b',100,1000);expect(stageHeight()).toBe(288);
 await call('onPanResponderGrant');await call('onPanResponderRelease',-90);await finish(0);expect(count()).toBe('2 / 3');expect(stageHeight()).toBe(288);
 await press('Previous image');await finish(1);expect(count()).toBe('1 / 3');expect(stageHeight()).toBe(288);
 await update({images});await load('d',200,1000);expect(stageHeight()).toBe(288);
 await act(async()=>node('image-attachment-stack').props.onLayout({nativeEvent:{layout:{width:220}}}));expect(stageHeight()).toBe(228);
 await load('a',2000,100);expect(stageHeight()).toBe(228);await press('Next image');await finish(2);expect(stageHeight()).toBe(228);
});

test('next/previous loop consistently and all actions address the current item',async()=>{
 await render();await press('Next image');expect(count()).toBe('2 / 3');
 await press('Open b.jpg');await press('Attachment details: b.jpg');await press('Save b.jpg');
 expect(defaults.onOpen).toHaveBeenLastCalledWith(images[1]);expect(defaults.onDetails).toHaveBeenLastCalledWith(images[1]);expect(defaults.onSave).toHaveBeenLastCalledWith(images[1]);
 await press('Previous image');expect(count()).toBe('1 / 3');await press('Previous image');expect(count()).toBe('3 / 3');await press('Next image');expect(count()).toBe('1 / 3');
});

test('at most three overlapping cards, only front interactive/accessibility-visible; no grid',async()=>{
 await render({images});
 const cards=tree!.root.findAll(item=>typeof item.props.testID==='string'&&/^image-stack-card-/.test(item.props.testID));
 // Animated.View has a wrapper and a host node; inspect distinct card ids.
 expect(new Set(cards.map(item=>item.props.testID)).size).toBe(3);
 for(const id of ['b','d']){
  const rear=node(`image-stack-card-${id}`);expect(rear.props.pointerEvents).toBe('none');expect(rear.props.accessibilityElementsHidden).toBe(true);expect(rear.props.importantForAccessibility).toBe('no-hide-descendants');
  const geometry=StyleSheet.flatten(rear.props.style);expect(geometry.position).toBe('absolute');if(id==='d')expect(geometry.transform[0].rotate.__getValue()).toBe('3deg');
  await press(`Open ${id}.jpg`);
 }
 expect(defaults.onOpen).not.toHaveBeenCalled();expect(node('image-stack-card-a').props.accessibilityElementsHidden).toBe(false);
 for(const label of ['Next image','Previous image'])expect(StyleSheet.flatten(button(label).props.style)).toMatchObject({width:48,height:48});
});

test('horizontal intent only: initial touch and vertical or diagonal moves stay with the chat',async()=>{
 await render();const config=gestures();
 expect(config.onStartShouldSetPanResponder?.({} as any,gesture(0))).toBe(false);
 for(const [dx,dy] of [[0,90],[5,0],[30,50],[30,30]])expect(config.onMoveShouldSetPanResponder?.({} as any,gesture(dx,dy))).toBe(false);
 expect(config.onMoveShouldSetPanResponder?.({} as any,gesture(20,2))).toBe(true);
 expect(config.onMoveShouldSetPanResponderCapture?.({} as any,gesture(20,2))).toBe(true);
 expect(config.onMoveShouldSetPanResponderCapture?.({} as any,gesture(20,40))).toBe(false);
 expect(config.onPanResponderTerminationRequest?.({} as any,gesture(0))).toBe(true);
 expect(config.onShouldBlockNativeResponder?.({} as any,gesture(0))).toBe(true);
});

test('short gestures and cancelled swipes spring back without changing item or opening it',async()=>{
 mockMotion=true;await render();
 await call('onPanResponderGrant');await call('onPanResponderMove',25);await call('onPanResponderRelease',25);
 expect(Animated.spring).toHaveBeenCalledTimes(1);expect(count()).toBe('1 / 3');await finish(0);
 await press('Open a.jpg');expect(defaults.onOpen).not.toHaveBeenCalled();
 await call('onPanResponderGrant');await call('onPanResponderMove',100);await call('onPanResponderTerminate',100);await finish(1);
 expect(count()).toBe('1 / 3');expect(Animated.timing).not.toHaveBeenCalled();
 await act(async()=>button('Open a.jpg').props.onPressIn());await press('Open a.jpg');expect(defaults.onOpen).toHaveBeenCalledWith(images[0]);
});

test('full horizontal swipes animate next/previous with native transform driver and cannot also open',async()=>{
 mockMotion=true;await render();
 await call('onPanResponderGrant');await call('onPanResponderMove',-90);await call('onPanResponderRelease',-90);
 expect(count()).toBe('1 / 3');expect(pending[0].config).toMatchObject({toValue:-280,duration:136,useNativeDriver:true,isInteraction:false});
 await press('Next image');await press('Open a.jpg');expect(pending).toHaveLength(1);expect(defaults.onOpen).not.toHaveBeenCalled();
 await finish(0);expect(count()).toBe('2 / 3');expect(pending).toHaveLength(1);expect(Animated.spring).not.toHaveBeenCalled();
 await press('Open b.jpg');expect(defaults.onOpen).not.toHaveBeenCalled();
 await call('onPanResponderGrant');await call('onPanResponderRelease',90);expect(pending[1].config.toValue).toBe(280);await finish(1);expect(count()).toBe('1 / 3');
});

test('vertical release after horizontal capture does not advance, and an ungranted release is ignored',async()=>{
 await render();await call('onPanResponderRelease',-100);expect(count()).toBe('1 / 3');
 await call('onPanResponderGrant');await call('onPanResponderRelease',-80,100);expect(count()).toBe('1 / 3');
 await call('onPanResponderGrant');await call('onPanResponderRelease',-57,0);expect(count()).toBe('2 / 3');
});

test('load/layout rerenders retain one native PanResponder and preserve a swipe in progress',async()=>{
 mockMotion=true;await render();const original=gestures();
 await call('onPanResponderGrant');await call('onPanResponderMove',-30);await load('a',400,200);
 expect(pan).toHaveBeenCalledTimes(1);expect(gestures()).toBe(original);
 await call('onPanResponderRelease',-90);await finish(0);expect(count()).toBe('2 / 3');
});

test('id-keyed children retain native Image identity/loading state on reordering and depth changes',async()=>{
 await render();await load('b');const nativeB=node('image-stack-image-b').findByType(Image);
 await press('Next image');expect(node('image-stack-image-b').findByType(Image)).toBe(nativeB);
 expect(StyleSheet.flatten(node('image-stack-image-b').props.style).opacity).not.toBe(0);
 await update({images:[{...images[2]},{...images[1],source:{uri:'file:///b.jpg'}},{...images[0]}]});
 expect(count()).toBe('2 / 3');expect(node('image-stack-image-b').findByType(Image)).toBe(nativeB);
 await press('Open b.jpg');expect(defaults.onOpen).toHaveBeenLastCalledWith(images[1]);
});

test('append/reorder preserves the selected id; removal falls back; empty and later-filled lists are safe',async()=>{
 await render();await press('Next image');await update({images});expect(count()).toBe('2 / 4');
 await update({images:[images[3],images[2],images[1],images[0]]});expect(count()).toBe('3 / 4');
 await update({images:[images[2],images[0]]});expect(count()).toBe('1 / 2');await press('Open c.jpg');expect(defaults.onOpen).toHaveBeenLastCalledWith(images[2]);
 await update({images:[]});expect(tree!.toJSON()).toBeNull();await update({images:[images[1]]});expect(count()).toBe('1 / 1');await press('Open b.jpg');expect(defaults.onOpen).toHaveBeenLastCalledWith(images[1]);
});

test('stale action handlers cannot address a new front card or an unmounted scope',async()=>{
 await render();const open=button('Open a.jpg').props.onPress,info=button('Attachment details: a.jpg').props.onPress,save=button('Save a.jpg').props.onPress;
 await press('Next image');await act(async()=>{open();info();save();});expect(defaults.onOpen).not.toHaveBeenCalled();expect(defaults.onDetails).not.toHaveBeenCalled();expect(defaults.onSave).not.toHaveBeenCalled();
 const next=button('Next image').props.onPress;await act(async()=>tree!.unmount());tree=undefined;await act(async()=>{open();next();});expect(defaults.onOpen).not.toHaveBeenCalled();
});

test('item/source change cancels exit and ignores deliberately late native animation completion',async()=>{
 mockMotion=true;await render();await press('Next image');
 await update({images:[{...images[0],source:{uri:'file:///replacement.jpg'}},images[2]]});expect(pending[0].stop).toHaveBeenCalled();
 await finish(0);expect(count()).toBe('1 / 2');expect(pending).toHaveLength(1);await press('Open a.jpg');expect(defaults.onOpen).toHaveBeenCalledWith(expect.objectContaining({source:{uri:'file:///replacement.jpg'}}));
});

test('a benign equivalent rerender does not interrupt animation, but append safely invalidates it',async()=>{
 mockMotion=true;await render();await press('Next image');await update({images:defaults.images.map(image=>({...image,source:{...(image.source as object)}}))});
 expect(pending[0].stop).not.toHaveBeenCalled();await update({images});expect(pending[0].stop).toHaveBeenCalled();await finish(0);expect(count()).toBe('1 / 4');
});

test('missing source and failed preview remain readable/openable; retry remounts only the native image',async()=>{
 await render({images:[{id:'missing',name:'missing.jpg'}]});expect(tree!.root.findAllByType(Image)).toHaveLength(0);
 expect(tree!.root.findAllByType(NativeText).some(text=>text.props.children==='Preview unavailable')).toBe(true);await press('Open missing.jpg');expect(defaults.onOpen).toHaveBeenCalledWith({id:'missing',name:'missing.jpg'});
 await update({images:[images[0]]});expect(tree!.root.findAllByType(NativeText).some(text=>text.props.children==='Loading image…')).toBe(true);
 const old=node('image-stack-image-a'),oldLoad=old.props.onLoad,oldError=old.props.onError;
 await act(async()=>oldError());expect(button('Retry preview: a.jpg')).toBeDefined();await press('Open a.jpg');expect(defaults.onOpen).toHaveBeenLastCalledWith(images[0]);
 await press('Retry preview: a.jpg');expect(node('image-stack-image-a')).not.toBe(old);expect(button('Retry preview: a.jpg')).toBeUndefined();
 await act(async()=>{oldError();oldLoad({nativeEvent:{source:{width:200,height:1000}}});});expect(button('Retry preview: a.jpg')).toBeUndefined();
 expect(StyleSheet.flatten(node('image-stack-card-a').props.style).height).toBe(248);await load('a');expect(tree!.root.findAllByType(NativeText).some(text=>text.props.children==='Loading image…')).toBe(false);
});

test('late old-source/unmounted image events cannot replace the new request state or geometry',async()=>{
 await render({images:[images[0]]});const old=node('image-stack-image-a').props;
 await update({images:[{...images[0],source:{uri:'file:///new.jpg'}}]});
 await act(async()=>{old.onError();old.onLoad({nativeEvent:{source:{width:200,height:1000}}});});expect(button('Retry preview: a.jpg')).toBeUndefined();expect(StyleSheet.flatten(node('image-stack-card-a').props.style).height).toBe(248);
 const current=node('image-stack-image-a').props;await act(async()=>tree!.unmount());tree=undefined;await act(async()=>{current.onError();current.onLoad({nativeEvent:{source:{width:10,height:20}}});});
});

test('source A -> B -> A is a fresh request, not a route for stale A callbacks',async()=>{
 await render({images:[images[0]]});const firstA=node('image-stack-image-a').props;
 await load('a');await update({images:[{...images[0],source:{uri:'file:///other.jpg'}}]});await update({images:[images[0]]});
 expect(StyleSheet.flatten(node('image-stack-image-a').props.style).opacity).toBe(0);
 await act(async()=>{firstA.onError();firstA.onLoad({nativeEvent:{source:{width:20,height:2000}}});});
 expect(button('Retry preview: a.jpg')).toBeUndefined();expect(StyleSheet.flatten(node('image-stack-image-a').props.style).opacity).toBe(0);expect(StyleSheet.flatten(node('image-stack-card-a').props.style).height).toBe(248);
 await load('a');expect(StyleSheet.flatten(node('image-stack-image-a').props.style).opacity).not.toBe(0);
});

test('native style geometry follows natural aspect with bounded height and responsive width, never fetching metadata',async()=>{
 await render({images:[images[0]]});await load('a',400,200);expect(StyleSheet.flatten(node('image-stack-card-a').props.style).height).toBe(160);
 await load('a',200,800);expect(StyleSheet.flatten(node('image-stack-card-a').props.style).height).toBe(300);
 await act(async()=>node('image-attachment-stack').props.onLayout({nativeEvent:{layout:{width:220}}}));await load('a',200,200);
 const card=StyleSheet.flatten(node('image-stack-card-a').props.style);expect(card).toMatchObject({height:188,left:16,right:16});expect(StyleSheet.flatten(node('image-stack-stage').props.style).height).toBe(228);
 expect(node('image-stack-image-a').props.resizeMode).toBe('contain');expect(node('image-stack-image-a').props.source).toEqual(images[0].source);
 await load('a',0,0);expect(StyleSheet.flatten(node('image-stack-card-a').props.style).height).toBe(188);
});

for(const preference of ['reduceMotionChanged','screenReaderChanged'])test(`${preference} disables motion, stops in-flight animation, keeps navigation usable`,async()=>{
 mockMotion=undefined;
 await act(async()=>{tree=Renderer.create(<ChatMotionProvider active><ImageAttachmentStack {...defaults}/></ChatMotionProvider>);});
 await press('Next image');expect(pending).toHaveLength(1);
 await act(async()=>preferences[preference](true));expect(pending[0].stop).toHaveBeenCalled();await finish(0);expect(count()).toBe('1 / 3');
 await press('Next image');expect(count()).toBe('2 / 3');await call('onPanResponderGrant');await call('onPanResponderRelease',-90);expect(count()).toBe('3 / 3');expect(pending).toHaveLength(1);
});

test('outside motion provider defaults to static navigation and no entrance animation',async()=>{
 mockMotion=undefined;await render();expect(pending).toHaveLength(0);await press('Next image');expect(count()).toBe('2 / 3');expect(pending).toHaveLength(0);
});

test('inactive cleanup cancels drag/animation, removes lifecycle listener, and ignores stale callbacks',async()=>{
 mockMotion=true;await render();await call('onPanResponderGrant');await call('onPanResponderMove',-70);await call('onPanResponderRelease',-70);
 const oldOpen=button('Open a.jpg').props.onPress;await update({active:false});expect(pending[0].stop).toHaveBeenCalled();expect(appRemovals.every(remove=>remove.mock.calls.length===1)).toBe(true);
 await finish(0);await press('Next image');await act(async()=>oldOpen());expect(count()).toBe('1 / 3');expect(defaults.onOpen).not.toHaveBeenCalled();expect(button('Next image').props.disabled).toBe(true);
 await update({active:true});await press('Next image');await finish(1);expect(count()).toBe('2 / 3');
});

test('deactivation in the middle of a drag cannot commit a later release or accidentally open',async()=>{
 mockMotion=true;await render();await call('onPanResponderGrant');await call('onPanResponderMove',-90);
 await update({active:false});await call('onPanResponderRelease',-90);await update({active:true});await call('onPanResponderRelease',-90);
 expect(count()).toBe('1 / 3');expect(pending).toHaveLength(0);await press('Open a.jpg');expect(defaults.onOpen).not.toHaveBeenCalled();
 await act(async()=>button('Open a.jpg').props.onPressIn());await press('Open a.jpg');expect(defaults.onOpen).toHaveBeenCalledWith(images[0]);
});

test('background cancels immediately, foreground resumes safely, unmount stops entry and late completions',async()=>{
 mockMotion=true;await render();await press('Next image');
 await act(async()=>{for(const callback of changes)callback('background');});expect(pending[0].stop).toHaveBeenCalled();await finish(0);expect(count()).toBe('1 / 3');await press('Next image');expect(pending).toHaveLength(1);
 await act(async()=>{for(const callback of changes)callback('active');});await press('Next image');await finish(1);expect(count()).toBe('2 / 3');
 await press('Next image');await act(async()=>tree!.unmount());tree=undefined;expect(pending[2].stop).toHaveBeenCalled();await finish(2);expect(appRemovals.every(remove=>remove.mock.calls.length===1)).toBe(true);
});

test('exit resets only after the next front image commits, with no second entrance jump',async()=>{
 mockMotion=true;await render();await press('Next image');
 const value=pending[0].value,original=value.setValue.bind(value),resetFronts:string[]=[];
 jest.spyOn(value,'setValue').mockImplementation(next=>{if(next===0)resetFronts.push(node('image-stack-front').props.accessibilityLabel);original(next);});
 await finish(0);
 expect(resetFronts).toEqual(['Open b.jpg']);expect(count()).toBe('2 / 3');expect(pending).toHaveLength(1);expect(Animated.spring).not.toHaveBeenCalled();jest.mocked(value.setValue).mockRestore();
});
test('rightward drag promotes the previous neighbour and keeps the outgoing photo opaque',async()=>{
 mockMotion=true;await render({images});await call('onPanResponderGrant');await call('onPanResponderMove',80,20);
 const incoming=StyleSheet.flatten(node('image-stack-card-d').props.style);expect(incoming.opacity.__getValue()).toBe(1);expect(StyleSheet.flatten(node('image-stack-card-b').props.style).opacity.__getValue()).toBe(0);
 expect(StyleSheet.flatten(node('image-stack-card-a').props.style).opacity).toBeUndefined();
 expect(gestures().onPanResponderTerminationRequest?.({} as any,gesture(80,20))).toBe(false);
 await call('onPanResponderRelease',80,20);await finish(0);expect(count()).toBe('4 / 4');
});
test('fallback drag follows the finger beyond the former 45-percent stop and multi-touch cancels',async()=>{
 mockMotion=true;await render();await call('onPanResponderGrant');await call('onPanResponderMove',-200);
 const translation=StyleSheet.flatten(node('image-stack-card-a').props.style).transform[0].translateX;
 expect(translation.__getValue()).toBe(-200);
 await act(async()=>{gestures().onPanResponderMove?.({} as any,{...gesture(-200),numberActiveTouches:2});});
 await finish(0);await call('onPanResponderRelease',-200);expect(count()).toBe('1 / 3');expect(defaults.onOpen).not.toHaveBeenCalled();
});

test('native translation alone reveals the correct neighbour without a React direction update',async()=>{
 mockMotion=true;await render({images});
 const value=StyleSheet.flatten(node('image-stack-card-a').props.style).transform[0].translateX;
 const next=()=>StyleSheet.flatten(node('image-stack-card-b').props.style).opacity.__getValue();
 const previous=()=>StyleSheet.flatten(node('image-stack-card-d').props.style).opacity.__getValue();
 await act(async()=>value.setValue(100));expect(previous()).toBe(1);expect(next()).toBe(0);
 await act(async()=>value.setValue(-100));expect(next()).toBe(1);expect(previous()).toBe(0);
 expect(count()).toBe('1 / 4');
});
test('a two-photo deck keeps its shared neighbour visible in either direction',async()=>{
 mockMotion=true;await render({images:images.slice(0,2)});
 expect(StyleSheet.flatten(node('image-stack-card-b').props.style).opacity).toBe(1);
 await call('onPanResponderGrant');await call('onPanResponderMove',90);await call('onPanResponderRelease',90);await finish(0);expect(count()).toBe('2 / 2');
});
