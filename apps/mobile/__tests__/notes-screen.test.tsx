import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {NotesScreen} from '../components/notes-screen';
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:jest.fn(async(key:string)=>{values.delete(key);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('uuid',()=>{let next=1;return{v4:()=>`00000000-0000-4000-8000-${String(next++).padStart(12,'0')}`};});
const backend='11111111-1111-4111-8111-111111111111';
const press=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0].props.onPress();
const input=(tree:Renderer.ReactTestRenderer,label:string,text:string)=>tree.root.findByProps({accessibilityLabel:label}).props.onChangeText(text);
const offline=async()=>{throw Error('Offline');};
beforeEach(async()=>{await AsyncStorage.clear();});
test('real Notes UI creates a category and formatted checklist offline, saves once, and reopens from cache',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const mount=async()=>{await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={72} onBack={()=>{}}/>);});};
 await mount();
 try{
  act(()=>press(tree,'Categories'));act(()=>input(tree,'Category name','Work'));
  await act(async()=>press(tree,'Create category'));act(()=>press(tree,'Close categories'));
  act(()=>press(tree,'Create note'));act(()=>input(tree,'Note title','My checklist'));act(()=>input(tree,'Note body','Milk'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Note body'}).props.onSelectionChange({nativeEvent:{selection:{start:0,end:4}}}));
  act(()=>press(tree,'Bold'));expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('**Milk**');
  act(()=>input(tree,'Note body','## Shopping\n- [ ] Milk\n\n**Remember this**'));
  act(()=>press(tree,'Assign category Work'));act(()=>press(tree,'Note color blue'));act(()=>press(tree,'Preview note'));
  const task=tree.root.findAll(node=>node.props.accessibilityLabel==='Milk'&&node.props.accessibilityRole==='checkbox')[0];
  expect(task.props.accessibilityState.checked).toBe(false);act(()=>task.props.onPress());
  await act(async()=>{const save=()=>press(tree,'Save note');save();save();});
  expect(tree.root.findAllByProps({accessibilityLabel:'Note body'})).toHaveLength(0);
  expect(tree.root.findAllByProps({accessibilityLabel:'Open note My checklist'}).length).toBeGreaterThan(0);
  const cached=JSON.parse((await AsyncStorage.getItem(`notes:v1:${backend}`))!);
  expect(cached.pending.filter((op:any)=>op.kind==='note')).toHaveLength(1);
  expect(cached.pending.find((op:any)=>op.kind==='note').value.body).toContain('- [x] Milk');
  expect(await AsyncStorage.getItem(`note-editor:v1:${backend}`)).toBeNull();
  await act(async()=>tree.unmount());await mount();
  act(()=>press(tree,'Open note My checklist'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toContain('**Remember this**');
  const assigned=tree.root.findAll(node=>node.props.accessibilityLabel==='Assign category Work'&&node.props.accessibilityRole==='checkbox')[0];expect(assigned.props.accessibilityState.checked).toBe(true);
  act(()=>input(tree,'Note body','A draft that is not yet saved'));
  await act(async()=>press(tree,'Close note editor and keep draft'));
  await act(async()=>tree.unmount());await mount();
  act(()=>press(tree,'Resume unsaved note'));
  expect(tree.root.findByProps({accessibilityLabel:'Note body'}).props.value).toBe('A draft that is not yet saved');
 }finally{await act(async()=>tree.unmount());}
});
test('search, pinning, trash and restore work on locally cached notes without a server connection',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<NotesScreen backendId={backend} request={offline} visible topInset={72} onBack={()=>{}}/>);});
 try{
  act(()=>press(tree,'Create note'));act(()=>input(tree,'Note title','Find me'));act(()=>input(tree,'Note body','Offline content'));await act(async()=>press(tree,'Save note'));
  act(()=>input(tree,'Search notes','no match'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'})).toHaveLength(0);
  act(()=>input(tree,'Search notes','offline content'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'}).length).toBeGreaterThan(0);
  await act(async()=>press(tree,'Pin note Find me'));expect(tree.root.findAllByProps({accessibilityLabel:'Unpin note Find me'}).length).toBeGreaterThan(0);
  await act(async()=>press(tree,'Trash note Find me'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'})).toHaveLength(0);
  act(()=>press(tree,'Show trash'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'}).length).toBeGreaterThan(0);
  await act(async()=>press(tree,'Restore note Find me'));act(()=>press(tree,'Show notes'));expect(tree.root.findAllByProps({accessibilityLabel:'Open note Find me'}).length).toBeGreaterThan(0);
 }finally{await act(async()=>tree.unmount());}
});
