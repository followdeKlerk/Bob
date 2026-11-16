jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View},LinearTransition:{duration:(duration:number)=>({reduceMotion:(reduceMotion:string)=>({duration,reduceMotion})})},ReduceMotion:{System:'system'}}));
import React,{useState} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Keyboard,Modal,StyleSheet,TextInput,View} from 'react-native';
import {DraftInput} from '../components/draft-input';
import {ThemeContext,tokens} from '../theme-context';
import {useKeyboardInset} from '../keyboard-inset';
jest.mock('../keyboard-inset',()=>({useKeyboardInset:jest.fn(()=>0)}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({bottom:0})}));
jest.mock('lucide-react-native',()=>({Maximize2:require('react-native').View,Minimize2:require('react-native').View}));
beforeEach(()=>{
 jest.mocked(useKeyboardInset).mockReturnValue(0);
 // Compact-layout fixtures are explicitly normal-size; scale coverage is below.
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:361,height:754,scale:1,fontScale:1});
});
afterEach(()=>jest.restoreAllMocks());
test('overflow opens a full editor sharing the same draft; collapsing never clears it',async()=>{
 function Harness({scope}:{scope:string}){const [value,setValue]=useState('hello');return <DraftInput scope={scope} value={value} onChangeText={setValue}/>;}
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness scope="chat1"/>);});
 expect(tree.root.findAllByProps({accessibilityLabel:'Expand message editor'})).toHaveLength(0);
 act(()=>tree.root.findByType(TextInput).props.onContentSizeChange({nativeEvent:{contentSize:{height:240}}}));
 act(()=>tree.root.findByProps({accessibilityLabel:'Expand message editor'}).props.onPress());expect(tree.root.findByType(Modal)).toBeDefined();
 act(()=>tree.root.findByProps({accessibilityLabel:'Expanded message draft'}).props.onChangeText('A long edited draft\nwith another line'));
 expect(tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!.props.value).toContain('long edited draft');
 act(()=>tree.root.findByProps({accessibilityLabel:'Collapse message editor'}).props.onPress());expect(tree.root.findAllByType(Modal)).toHaveLength(0);expect(tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!.props.value).toContain('long edited draft');
 act(()=>tree.root.findByProps({accessibilityLabel:'Expand message editor'}).props.onPress());await act(async()=>tree.update(<Harness scope="chat2"/>));expect(tree.root.findAllByType(Modal)).toHaveLength(0);await act(async()=>tree.unmount());
});

test('draft grows inline across the full width, with every button in a separate bottom row',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<DraftInput scope="chat" value="A paragraph that should wrap naturally across the composer." onChangeText={()=>{}} leading={<View testID="plus-control"/>} trailing={<View testID="send-control"/>}/>);});
 const input=()=>tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!;
 act(()=>input().props.onContentSizeChange({nativeEvent:{contentSize:{height:126}}}));
 const style=StyleSheet.flatten(input().props.style);expect(style.height).toBe(126);expect(style.paddingRight).toBeUndefined();expect(input().props.textAlignVertical).toBe('top');expect(input().props.scrollEnabled).toBe(false);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 const controls=tree.root.findByProps({testID:'composer-controls'});expect(controls.findAllByType(TextInput)).toHaveLength(0);expect(controls.findByProps({testID:'plus-control'})).toBeDefined();expect(controls.findByProps({testID:'send-control'})).toBeDefined();expect(controls.findByProps({accessibilityLabel:'Expand message editor'})).toBeDefined();
 expect(StyleSheet.flatten(controls.props.style).flexDirection).toBe('row');await act(async()=>tree.unmount());
});
test('long drafts scroll only at the available-height cap, and shrink again when text is deleted',async()=>{
 let tree!:Renderer.ReactTestRenderer;const editor=(maxHeight:number)=><DraftInput scope="chat" value="draft" onChangeText={()=>{}} maxHeight={maxHeight}/>;await act(async()=>{tree=Renderer.create(editor(260));});
 const input=()=>tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!;
 act(()=>input().props.onContentSizeChange({nativeEvent:{contentSize:{height:230}}}));expect(StyleSheet.flatten(input().props.style).height).toBe(230);expect(input().props.scrollEnabled).toBe(false);
 await act(async()=>tree.update(editor(96)));expect(StyleSheet.flatten(input().props.style).height).toBe(96);expect(input().props.scrollEnabled).toBe(true);
 await act(async()=>tree.update(editor(260)));expect(StyleSheet.flatten(input().props.style).height).toBe(230);expect(input().props.scrollEnabled).toBe(false);
 act(()=>input().props.onContentSizeChange({nativeEvent:{contentSize:{height:46}}}));expect(StyleSheet.flatten(input().props.style).height).toBe(48);expect(input().props.scrollEnabled).toBe(false);expect(tree.root.findAllByProps({accessibilityLabel:'Expand message editor'})).toHaveLength(0);await act(async()=>tree.unmount());
});
test('zero and invalid content measurements do not collapse the draft',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<DraftInput scope="chat" value="draft" onChangeText={()=>{}}/>);});const input=()=>tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!;
 act(()=>input().props.onContentSizeChange({nativeEvent:{contentSize:{height:120}}}));
 for(const height of [0,-1,NaN,Infinity])act(()=>input().props.onContentSizeChange({nativeEvent:{contentSize:{height}}}));expect(StyleSheet.flatten(input().props.style).height).toBe(120);await act(async()=>tree.unmount());
});

test('keyboard-hidden composer is one compact row; opening it preserves the native input and draft',async()=>{
 let tree!:Renderer.ReactTestRenderer;const value='A retained draft\nwith more than one line';const editor=(compact:boolean)=><DraftInput scope="chat" value={value} onChangeText={()=>{}} compact={compact} leading={<View testID="plus-control"/>} trailing={<View testID="send-control"/>}/>;
 await act(async()=>{tree=Renderer.create(editor(true));});const input=tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!;
 act(()=>input.props.onContentSizeChange({nativeEvent:{contentSize:{height:180}}}));expect(StyleSheet.flatten(input.props.style).height).toBe(48);expect(StyleSheet.flatten(input.props.style)).toMatchObject({marginLeft:56,marginRight:56});expect(tree.root.findAllByProps({accessibilityLabel:'Expand message editor'})).toHaveLength(0);
 const controls=tree.root.findByProps({testID:'composer-controls'});expect(StyleSheet.flatten(controls.props.style).position).toBe('absolute');expect(controls.props.pointerEvents).toBe('box-none');expect(controls.findByProps({testID:'plus-control'})).toBeDefined();expect(controls.findByProps({testID:'send-control'})).toBeDefined();
 await act(async()=>tree.update(editor(false)));expect(tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!).toBe(input);expect(input.props.value).toBe(value);expect(StyleSheet.flatten(input.props.style).height).toBe(180);expect(StyleSheet.flatten(input.props.style).marginHorizontal).toBeUndefined();expect(StyleSheet.flatten(controls.props.style).position).toBeUndefined();expect(controls.findByProps({accessibilityLabel:'Expand message editor'})).toBeDefined();
 await act(async()=>tree.update(editor(true)));expect(tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!).toBe(input);expect(input.props.value).toBe(value);expect(StyleSheet.flatten(input.props.style).height).toBe(48);await act(async()=>tree.unmount());
});

test('dismissing the keyboard blurs the native input and hides its caret without changing the draft',async()=>{
 let hide!:()=>void;const remove=jest.fn();jest.spyOn(Keyboard,'addListener').mockImplementation((event,callback)=>{if(event==='keyboardDidHide')hide=callback as any;return{remove};});
 const change=jest.fn();let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<DraftInput scope="chat" value="Retain my draft" onChangeText={change}/>);});
 const input=tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!,blur=jest.spyOn(input.instance,'blur');blur.mockClear();
 act(()=>input.props.onFocus());expect(input.props.caretHidden).toBe(false);
 act(()=>hide());expect(blur).toHaveBeenCalled();expect(input.props.caretHidden).toBe(true);expect(input.props.value).toBe('Retain my draft');expect(change).not.toHaveBeenCalled();
 act(()=>input.props.onFocus());expect(input.props.caretHidden).toBe(false);await act(async()=>tree.unmount());expect(remove).toHaveBeenCalled();
});
test('native IME inset going to zero also clears focus when no keyboard event is delivered',async()=>{
 jest.mocked(useKeyboardInset).mockReturnValue(300);let tree!:Renderer.ReactTestRenderer;const editor=(compact:boolean)=><DraftInput scope="chat" value="Still here" onChangeText={()=>{}} compact={compact}/>;
 await act(async()=>{tree=Renderer.create(editor(false));});const input=tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!,blur=jest.spyOn(input.instance,'blur');blur.mockClear();
 act(()=>input.props.onFocus());jest.mocked(useKeyboardInset).mockReturnValue(0);await act(async()=>tree.update(editor(true)));
 expect(blur).toHaveBeenCalled();expect(input.props.caretHidden).toBe(true);expect(tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Message draft')!).toBe(input);expect(input.props.value).toBe('Still here');await act(async()=>tree.unmount());
});
test('composer resizing uses a short native layout transition with system reduced motion',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<DraftInput scope="chat" value="Draft" onChangeText={()=>{}}/>);});
 expect(tree.root.findByProps({testID:'draft-editor'}).props.layout).toMatchObject({duration:180,reduceMotion:'system'});
 expect(tree.root.findByProps({testID:'composer-controls'}).props.layout).toMatchObject({duration:180,reduceMotion:'system'});await act(async()=>tree.unmount());
});

test.each([337,361])('two 48dp trailing actions reserve their full width at %sdp without replacing the input',async width=>{
 let tree!:Renderer.ReactTestRenderer;const change=jest.fn();
 const editor=(compact:boolean)=><View style={{width}}><DraftInput scope="same" value="Unsent edited draft" onChangeText={change} compact={compact} trailingWidth={104} leading={<View style={{width:48}}/>} trailing={<><View testID="voice" style={{width:48,height:48}}/><View testID="send" style={{width:48,height:48}}/></>}/></View>;
 await act(async()=>{tree=Renderer.create(editor(true));});const input=tree.root.findByType(TextInput),style=StyleSheet.flatten(input.props.style);
 expect(style.marginLeft).toBe(56);expect(style.marginRight).toBe(112);expect(width-26-style.marginLeft-style.marginRight).toBeGreaterThan(100);
 const controls=tree.root.findByProps({testID:'composer-controls'});expect(StyleSheet.flatten(controls.props.style).gap).toBe(8);
 for(const id of ['voice','send'])expect(StyleSheet.flatten(controls.findByProps({testID:id}).props.style)).toMatchObject({width:48,height:48});
 await act(async()=>tree.update(editor(false)));expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('Unsent edited draft');
 expect(StyleSheet.flatten(input.props.style).marginRight).toBeUndefined();expect(change).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});


test.each([337,361].flatMap(width=>[1,2].flatMap(fontScale=>[false,true].flatMap(keyboardOpen=>(['dark','light'] as const).map(theme=>({width,fontScale,keyboardOpen,theme}))))))(
 'composer preserves its input and one-line font fit at $width dp / $fontScale× / $theme / keyboard=$keyboardOpen',async({width,fontScale,keyboardOpen,theme})=>{
 const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:1,fontScale});
 jest.mocked(useKeyboardInset).mockReturnValue(keyboardOpen?280:0);
 const change=jest.fn(),value='Retained draft';
 const control=(id:string)=><View testID={id} style={{width:48,height:48}}/>;
 const editor=(compact:boolean)=><ThemeContext.Provider value={tokens[theme]}><View style={{width:width-26}}><DraftInput scope="same" value={value} onChangeText={change} compact={compact} maxHeight={48} trailingWidth={104} leading={control('plus')} trailing={<>{control('voice')}{control('send')}</>}/></View></ThemeContext.Provider>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(editor(!keyboardOpen));});
 try{
  const input=tree.root.findByType(TextInput),controls=tree.root.findByProps({testID:'composer-controls'});
  const style=StyleSheet.flatten(input.props.style),row=StyleSheet.flatten(controls.props.style);
  expect(style.height).toBeGreaterThanOrEqual(style.lineHeight*fontScale+2*style.paddingVertical);
  for(const id of ['plus','voice','send'])expect(StyleSheet.flatten(controls.findByProps({testID:id}).props.style)).toMatchObject({width:48,height:48});
  if(fontScale===2||keyboardOpen){expect(row.position).toBeUndefined();expect(style.marginLeft).toBeUndefined();expect(style.marginRight).toBeUndefined();}
  else{expect(row.position).toBe('absolute');expect(style.marginLeft).toBe(56);expect(style.marginRight).toBe(112);}
  // Three actions plus expansion and the flexible spacer fit in the stacked row.
  expect(4*48+4*row.gap).toBeLessThanOrEqual(width-26);
  act(()=>input.props.onContentSizeChange({nativeEvent:{contentSize:{height:160}}}));
  if(fontScale===2||keyboardOpen){
   act(()=>controls.findByProps({accessibilityLabel:'Expand message editor'}).props.onPress());
   expect(tree.root.findByProps({accessibilityLabel:'Expanded message draft'}).props.value).toBe(value);
   act(()=>tree.root.findByProps({accessibilityLabel:'Collapse message editor'}).props.onPress());
  }
  await act(async()=>tree.update(editor(keyboardOpen)));expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe(value);expect(change).not.toHaveBeenCalled();
  dimensions.mockReturnValue({width,height:754,scale:1,fontScale:fontScale===2?1:2});
  await act(async()=>tree.update(editor(!keyboardOpen)));expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe(value);
 }finally{await act(async()=>tree.unmount());}
});
