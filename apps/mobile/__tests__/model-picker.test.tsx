import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {FlatList,Modal,StyleSheet,View,Platform,KeyboardAvoidingView} from 'react-native';
import {SectionHeading,SectionActions,RoundAction} from '../components/section-ui';
import {colors} from '../theme';
import {ModelPicker,type ModelOption} from '../components/model-picker';
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('lucide-react-native',()=>({Check:()=>null,Search:()=>null,Star:()=>null,X:()=>null}));
const models:ModelOption[]=[{provider:'openai',modelId:'alpha',name:'Alpha',thinkingLevels:['off','medium']},{provider:'other',modelId:'soul',name:'Soul',thinkingLevels:['medium','high']}];
const current={model:{provider:'openai',modelId:'alpha'},thinkingLevel:'medium'};
const find=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const radios=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(n=>n.props.accessibilityRole==='radio'&&n.props.accessibilityLabel?.startsWith('Select ')&&typeof n.props.onPress==='function');
beforeEach(async()=>{await AsyncStorage.clear();});
test('current model is shown above compact rows and all providers are visible initially',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 expect(tree.root.findAll(n=>typeof n.props.children==='string').map(n=>n.props.children).join(' ')).toContain('Current model');expect(radios(tree).map(n=>n.props.accessibilityLabel)).toEqual(['Select Alpha (openai)','Select Soul (other)']);
 await act(async()=>tree.unmount());
});
test('favourite is saved, pinned before alphabetical models, and restored after remount',async()=>{
 let tree!:Renderer.ReactTestRenderer;const props={visible:true,models,current,onClose:()=>{},onApply:jest.fn()};
 await act(async()=>{tree=Renderer.create(<ModelPicker {...props}/>);});
 await act(async()=>find(tree,'Favourite Soul (other)').props.onPress());
 expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Soul (other)');
 expect(await AsyncStorage.getItem('model-favorites:v1')).toContain('soul');
 await act(async()=>tree.unmount());await act(async()=>{tree=Renderer.create(<ModelPicker {...props}/>);});
 expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Soul (other)');
 await act(async()=>find(tree,'Unfavourite Soul (other)').props.onPress());
 expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Alpha (openai)');
 await act(async()=>tree.unmount());
});
test('selection preserves supported thinking and applies exact model identity',async()=>{
 const apply=jest.fn(async()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={apply}/>);});
 await act(async()=>find(tree,'Select Soul (other)').props.onPress());await act(async()=>find(tree,'High thinking').props.onPress());await act(async()=>find(tree,'Apply model selection').props.onPress());
 expect(apply).toHaveBeenCalledWith({model:{provider:'other',modelId:'soul'},thinkingLevel:'high'});await act(async()=>tree.unmount());
});
test('failed favourite save is reported without pinning an unsaved choice',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 const original=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
 const fail=(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('Disk full'));
 await act(async()=>find(tree,'Favourite Soul (other)').props.onPress());expect(radios(tree)[0].props.accessibilityLabel).toBe('Select Alpha (openai)');expect(tree.root.findAll(n=>typeof n.props.children==='string').map(n=>n.props.children).join(' ')).toContain('Could not save favourites');fail.mockImplementation(original);await act(async()=>tree.unmount());
});
test('favourites obey search and provider filters without losing their saved identity',async()=>{
 await AsyncStorage.setItem('model-favorites:v1',JSON.stringify([JSON.stringify(['other','soul'])]));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 await act(async()=>find(tree,'openai').props.onPress());expect(radios(tree).map(n=>n.props.accessibilityLabel)).toEqual(['Select Alpha (openai)']);
 await act(async()=>find(tree,'All providers').props.onPress());
 await act(async()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Search models'&&typeof n.props.onChangeText==='function')[0].props.onChangeText('soul'));
 expect(radios(tree).map(n=>n.props.accessibilityLabel)).toEqual(['Select Soul (other)']);expect(await AsyncStorage.getItem('model-favorites:v1')).toContain('soul');await act(async()=>tree.unmount());
});

// Read text once from the native leaves, including mixed provider/status captions.
const textContent=(node:Renderer.ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:textContent(child)).join(' ');

test('thinking and selected summary are independently scrollable while Apply stays in a persistent bottom footer, never in the catalog footer',async()=>{
 const catalog=[...models,...Array.from({length:80},(_,i)=>({provider:'other',modelId:`extra-${i}`,name:`Extra ${i}`,thinkingLevels:['medium']}))];
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={catalog} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
 const list=tree.root.findByType(FlatList);
 const panel=tree.root.findByProps({testID:'selected-model-panel'});
 const controls=tree.root.findByProps({testID:'selected-model-controls'});
 expect(list.props.data).toHaveLength(catalog.length);
 expect(StyleSheet.flatten(list.props.style)).toMatchObject({flex:1,minHeight:0});
 expect(tree.root.findByType(SectionHeading).props.children).toBeUndefined();
 expect(tree.root.findByType(SectionActions).parent).toBe(list.parent);
 expect(list.parent!.children.indexOf(list)).toBeLessThan(list.parent!.children.indexOf(tree.root.findByType(SectionActions)));
 expect(list.findAllByProps({testID:'section-footer'})).toHaveLength(0);
 expect(list.props.ListFooterComponent).toBeUndefined();
 expect(list.findAll(n=>n.props.testID==='selected-model-panel')).toHaveLength(0);
 expect(textContent(controls)).toContain('Selected model');
 expect(textContent(controls)).toContain('Alpha');
 expect(textContent(controls)).toContain('Thinking effort');
 expect(panel.findAll(n=>n.props.accessibilityLabel==='Apply model selection')).toHaveLength(0);
 expect(tree.root.findByType(SectionActions).findByProps({testID:'section-footer-actions'}).findAll(n=>n.props.accessibilityLabel==='Apply model selection').length).toBeGreaterThan(0);
 // The bounded panel can shrink with the keyboard; its controls scroll while Apply stays outside that scroll.
 expect(StyleSheet.flatten(panel.props.style)).toMatchObject({maxHeight:'55%',flexShrink:1,minHeight:0});
 expect(StyleSheet.flatten(controls.props.style)).toMatchObject({flexShrink:1});
 expect(controls.props.keyboardShouldPersistTaps).toBe('handled');
 expect(controls.findAll(n=>n.props.accessibilityLabel==='Apply model selection')).toHaveLength(0);
 for(const label of ['All providers','openai','Off thinking','Medium thinking']){
  const chip=StyleSheet.flatten(find(tree,label).props.style);
  expect(chip.minHeight).toBeGreaterThanOrEqual(48);
  expect(chip.minWidth).toBeGreaterThanOrEqual(48);
  expect(chip.height).toBe('auto');
 }
 expect(StyleSheet.flatten(find(tree,'Apply model selection').props.style)).toMatchObject({height:'auto',minHeight:48});
 await act(async()=>tree.unmount());
});

test('staged model and effort stay reachable through an empty search without changing current until Apply',async()=>{
 const apply=jest.fn(async()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={apply}/>);});
 await act(async()=>find(tree,'Select Soul (other)').props.onPress());
 await act(async()=>find(tree,'High thinking').props.onPress());
 expect(find(tree,'Select Alpha (openai)').props.accessibilityState.checked).toBe(false);
 expect(find(tree,'Select Soul (other)').props.accessibilityState.checked).toBe(true);
 expect(find(tree,'High thinking').props.accessibilityState.checked).toBe(true);
 expect(textContent(tree.root.findByProps({testID:'current-model-summary'}))).toContain('Alpha');
 expect(textContent(tree.root.findByProps({testID:'current-model-summary'}))).toContain('Medium thinking');
 const controls=tree.root.findByProps({testID:'selected-model-controls'});
 expect(textContent(controls)).toContain('Soul');
 expect(textContent(controls)).toContain('Changes not applied');
 await act(async()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Search models'&&typeof n.props.onChangeText==='function')[0].props.onChangeText('no matching model'));
 expect(radios(tree)).toHaveLength(0);
 expect(find(tree,'High thinking').props.accessibilityState.checked).toBe(true);
 expect(find(tree,'Apply model selection').props.disabled).toBe(false);
 expect(apply).not.toHaveBeenCalled();
 await act(async()=>find(tree,'Apply model selection').props.onPress());
 expect(apply).toHaveBeenCalledTimes(1);
 expect(apply).toHaveBeenCalledWith({model:{provider:'other',modelId:'soul'},thinkingLevel:'high'});
 // Resolving the callback alone must not invent a new authoritative current model.
 expect(textContent(tree.root.findByProps({testID:'current-model-summary'}))).toContain('Alpha');
 await act(async()=>tree.update(<ModelPicker visible models={models} current={{model:{provider:'other',modelId:'soul'},thinkingLevel:'high'}} onClose={()=>{}} onApply={apply}/>));
 expect(textContent(tree.root.findByProps({testID:'current-model-summary'}))).toContain('Soul');
 expect(textContent(tree.root.findByProps({testID:'selected-model-controls'}))).toContain('Current selection');
 await act(async()=>tree.unmount());
});

test('closing without Apply discards staged changes on reopen',async()=>{
 const apply=jest.fn(async()=>{}),close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const props={models,current,onClose:close,onApply:apply};
 await act(async()=>{tree=Renderer.create(<ModelPicker visible {...props}/>);});
 await act(async()=>find(tree,'Select Soul (other)').props.onPress());
 await act(async()=>find(tree,'High thinking').props.onPress());
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());
 expect(close).toHaveBeenCalledTimes(1);
 expect(apply).not.toHaveBeenCalled();
 await act(async()=>tree.update(<ModelPicker visible={false} {...props}/>));
 await act(async()=>tree.update(<ModelPicker visible {...props}/>));
 expect(find(tree,'Select Alpha (openai)').props.accessibilityState.checked).toBe(true);
 expect(find(tree,'Medium thinking').props.accessibilityState.checked).toBe(true);
 expect(textContent(tree.root.findByProps({testID:'selected-model-controls'}))).toContain('Current selection');
 await act(async()=>tree.unmount());
});

test('effort-only edits are marked pending and unsupported effort resets when choosing another model',async()=>{
 let tree!:Renderer.ReactTestRenderer;const apply=jest.fn(async()=>{});
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={apply}/>);});
 await act(async()=>find(tree,'Off thinking').props.onPress());
 expect(textContent(tree.root.findByProps({testID:'selected-model-controls'}))).toContain('Changes not applied');
 await act(async()=>find(tree,'Select Soul (other)').props.onPress());
 expect(find(tree,'Medium thinking').props.accessibilityState.checked).toBe(true);
 expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Off thinking')).toHaveLength(0);
 expect(apply).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});

test('failed Apply retains the staged choice and exposes a retry beside the effort controls',async()=>{
 const apply=jest.fn().mockRejectedValueOnce(Error('Server rejected selection')).mockResolvedValueOnce(undefined);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={apply}/>);});
 await act(async()=>find(tree,'Select Soul (other)').props.onPress());
 await act(async()=>find(tree,'High thinking').props.onPress());
 await act(async()=>find(tree,'Apply model selection').props.onPress());
 expect(textContent(tree.root.findByProps({testID:'selected-model-controls'}))).toContain('Server rejected selection');
 expect(textContent(tree.root.findByProps({testID:'current-model-summary'}))).toContain('Alpha');
 expect(find(tree,'High thinking').props.accessibilityState.checked).toBe(true);
 expect(find(tree,'Apply model selection').props.disabled).toBe(false);
 await act(async()=>find(tree,'Apply model selection').props.onPress());
 expect(apply).toHaveBeenCalledTimes(2);
 expect(apply).toHaveBeenLastCalledWith({model:{provider:'other',modelId:'soul'},thinkingLevel:'high'});
 await act(async()=>tree.unmount());
});

test('Apply locks editing and dismissal while the authoritative callback is pending',async()=>{
 let finish!:()=>void;const apply=jest.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),close=jest.fn();
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={close} onApply={apply}/>);});
 await act(async()=>find(tree,'Apply model selection').props.onPress());
 for(const label of ['Apply model selection','Medium thinking','Select Soul (other)','openai'])expect(find(tree,label).props.disabled).toBe(true);
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());
 expect(close).not.toHaveBeenCalled();
 await act(async()=>finish());
 expect(find(tree,'Apply model selection').props.disabled).toBe(false);
 await act(async()=>tree.unmount());
});


test('model modal keeps Close left and Apply right in a separate bottom footer with outlined summaries, input and controls, not every model row',async()=>{
 const close=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={close} onApply={jest.fn()}/>);});
 try{
  const heading=tree.root.findByType(SectionHeading);
  expect(heading.props.title).toBe('Model & thinking');
  expect(heading.props.onBack).toBeUndefined();
  expect(heading.findAllByType(RoundAction)).toHaveLength(0);
  const footer=tree.root.findByType(SectionActions);
  const leading=footer.findByProps({testID:'section-footer-leading'});
  expect(leading.findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Close model selection']);
  expect(footer.findByProps({testID:'section-footer-actions'}).findAll(node=>node.props.accessibilityLabel==='Apply model selection').length).toBeGreaterThan(0);
  const headerView=heading.findAllByType(View)[0];
  expect(StyleSheet.flatten(headerView.props.style)).toMatchObject({paddingHorizontal:20,paddingTop:16,paddingBottom:12});
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'current-model-summary'}).props.style)).toMatchObject({borderRadius:20,borderWidth:1,borderColor:colors.border});
  expect(StyleSheet.flatten(find(tree,'openai').props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.border});
  for(const label of ['All providers','Medium thinking'])expect(StyleSheet.flatten(find(tree,label).props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.selectedBorder,backgroundColor:colors.selectedSurface});
  expect(StyleSheet.flatten(find(tree,'Apply model selection').props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.accent,backgroundColor:colors.accent});
  const plainRow=find(tree,'Select Soul (other)').parent!;
  expect(StyleSheet.flatten(plainRow.props.style).borderWidth).toBeUndefined();
  expect(tree.root.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.flexDirection==='row'&&style.borderRadius===14&&style.borderWidth===1&&style.borderColor===colors.border;})).toBe(true);
  await act(async()=>find(tree,'Close model selection').props.onPress());expect(close).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>tree.unmount());}
});


test.each(['android','ios'])('model dialog uses native Android resize or iOS avoidance, never both (%s)',async os=>{
 const originalOS=Object.getOwnPropertyDescriptor(Platform,'OS')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:os});
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<ModelPicker visible models={models} current={current} onClose={()=>{}} onApply={jest.fn()}/>);});
  const modal=tree.root.findByType(Modal),avoidance=tree.root.findByType(KeyboardAvoidingView);
  expect(modal.props.statusBarTranslucent).not.toBe(true);
  expect(modal.props.navigationBarTranslucent).not.toBe(true);
  expect(avoidance.props.enabled).toBe(os==='ios');
  expect(avoidance.props.behavior).toBe('padding');
  expect(StyleSheet.flatten(avoidance.props.style).paddingBottom).toBeUndefined();
 }finally{
  if(tree)await act(async()=>tree.unmount());
  Object.defineProperty(Platform,'OS',originalOS);
 }
});
