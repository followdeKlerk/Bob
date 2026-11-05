import React,{memo,useState} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Appearance,NativeModules,Platform,StyleSheet,Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ThemeProvider} from '../theme-provider';
import {useTheme,useThemedValue,themed,darkColors,lightColors} from '../theme';
import {AppearanceSettings} from '../components/appearance-settings';
import {DraftInput} from '../components/draft-input';
import {ChatMarkdown} from '../components/chat-markdown';
jest.unmock('react-native/Libraries/Utilities/useColorScheme');
jest.mock('@react-native-async-storage/async-storage',()=>{const values=new Map();return{getItem:jest.fn(async(key:string)=>values.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{values.set(key,value);}),clear:jest.fn(async()=>values.clear())};});
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:require('react-native').View},LinearTransition:{duration:()=>({reduceMotion:()=>({})})},ReduceMotion:{System:'system'}}));
let tree:Renderer.ReactTestRenderer|undefined,api:ReturnType<typeof useTheme>,scheme:'light'|'dark',listeners:Set<()=>void>;
const styles=themed(({colors})=>({body:{color:colors.foreground,backgroundColor:colors.background}}));
const Probe=memo(function Probe(){api=useTheme();const s=useThemedValue(styles);return <View testID="probe" style={s.body}/>;});
function Stateful(){const [draft,setDraft]=useState('Keep my draft');return <><Probe/><AppearanceSettings/><DraftInput value={draft} onChangeText={setDraft} scope="test"/><ChatMarkdown text={'```txt\nReadable code\n```'}/></>;}
const radio=(name:string)=>tree!.root.findAll(node=>node.props.accessibilityLabel===`${name} theme`&&typeof node.props.onPress==='function')[0];
async function mount(children:React.ReactNode=<Probe/>){await act(async()=>{tree=Renderer.create(<ThemeProvider>{children}</ThemeProvider>);});}
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();scheme='light';listeners=new Set();jest.spyOn(Appearance,'getColorScheme').mockImplementation(()=>scheme);jest.spyOn(Appearance,'addChangeListener').mockImplementation(listener=>{const change=()=>listener({colorScheme:scheme});listeners.add(change);return{remove:()=>listeners.delete(change)};});jest.spyOn(Appearance,'setColorScheme').mockImplementation(()=>{});NativeModules.BobPlatform={setAppearance:jest.fn(async()=>{})};});
afterEach(async()=>{if(tree){await act(async()=>tree!.unmount());tree=undefined;}jest.restoreAllMocks();});

test('loads a saved choice before mounting chat and restores it after reopening',async()=>{
 let resolve!:(value:string|null)=>void;const get=(AsyncStorage.getItem as jest.Mock).getMockImplementation();
 (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await mount();expect(tree!.root.findAllByProps({testID:'probe'})).toHaveLength(0);
 await act(async()=>resolve('dark'));expect(api.preference).toBe('dark');expect(api.colors).toBe(darkColors);
 await act(async()=>api.setPreference('light'));expect(await AsyncStorage.getItem('appearance')).toBe('light');expect(api.colors).toBe(lightColors);
 await act(async()=>tree!.unmount());tree=undefined;(AsyncStorage.getItem as jest.Mock).mockImplementation(get);
 await mount();expect(api.preference).toBe('light');expect(api.colors).toBe(lightColors);
});

test('System follows phone changes, while an explicit choice stays fixed',async()=>{
 await mount();expect(api.preference).toBe('system');expect(api.scheme).toBe('light');
 await act(async()=>{scheme='dark';listeners.forEach(listener=>listener());});expect(api.scheme).toBe('dark');
 await act(async()=>api.setPreference('light'));expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('light');
 await act(async()=>{scheme='dark';listeners.forEach(listener=>listener());});expect(api.scheme).toBe('light');
 await act(async()=>api.setPreference('system'));expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified');expect(api.scheme).toBe('dark');
});

test('appearance radios update memoized content without remounting or losing the focused draft',async()=>{
 await mount(<Stateful/>);const input=tree!.root.findByProps({accessibilityLabel:'Message draft'}),probe=tree!.root.findByProps({testID:'probe'}),code=tree!.root.findByProps({testID:'markdown-code-block'});
 const lightStyle=probe.props.style,markdown=tree!.root.findByProps({testID:'markdown-content'});
 await act(async()=>{input.props.onFocus();input.props.onChangeText('Unsent\nmessage');});
 for(const mode of ['Dark','Light','System']){
  const button=radio(mode);expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48);
  await act(async()=>button.props.onPress());
  expect(api.preference).toBe(mode.toLowerCase());expect(radio(mode).props.accessibilityState.checked).toBe(true);
  expect(tree!.root.findByProps({accessibilityLabel:'Message draft'})).toBe(input);expect(input.props.value).toBe('Unsent\nmessage');expect(input.props.caretHidden).toBe(false);
  expect(tree!.root.findByProps({testID:'probe'})).toBe(probe);expect(tree!.root.findByProps({testID:'markdown-content'})).toBe(markdown);
  const text=tree!.root.findByProps({testID:'markdown-code-block'}).findAllByType(Text).find(node=>node.props.children==='Readable code')!;
  expect(StyleSheet.flatten(text.props.style).color).toBe(api.colors.foreground);
  expect(tree!.root.findAllByProps({accessibilityLabel:'Message draft'}).some(node=>node.props.keyboardAppearance===api.scheme)).toBe(true);
 }
 expect(probe.props.style).toBe(lightStyle);
});

test('a failed save leaves the prior choice intact and shows an honest retry message',async()=>{
 await mount(<><Probe/><AppearanceSettings/></>);(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('storage unavailable'));
 await act(async()=>radio('Dark').props.onPress());expect(api.preference).toBe('system');expect(api.scheme).toBe('light');
 expect(tree!.root.findAllByType(Text).some(node=>node.props.children==='Could not save appearance. Please try again.')).toBe(true);
 await act(async()=>radio('Dark').props.onPress());expect(api.preference).toBe('dark');expect(await AsyncStorage.getItem('appearance')).toBe('dark');
});

test('serializes rapid choices so the persisted and visible final choices agree',async()=>{
 await mount();const write=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;let finish!:()=>void;
 (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
 let first!:Promise<void>,last!:Promise<void>;await act(async()=>{first=api.setPreference('dark');last=api.setPreference('light');});
 expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
 await act(async()=>{finish();await first;await last;});expect(api.preference).toBe('light');expect(await AsyncStorage.getItem('appearance')).toBe('light');
 (AsyncStorage.setItem as jest.Mock).mockImplementation(write);
});


test('Android updates owned native chrome without changing platform night mode or recreating its Activity',async()=>{
 jest.replaceProperty(Platform,'OS','android');await mount();
 await act(async()=>api.setPreference('dark'));expect(api.scheme).toBe('dark');
 expect(NativeModules.BobPlatform.setAppearance).toHaveBeenLastCalledWith('dark');
 await act(async()=>api.setPreference('system'));expect(api.scheme).toBe('light');
 expect(NativeModules.BobPlatform.setAppearance).toHaveBeenLastCalledWith('system');
 expect(Appearance.setColorScheme).not.toHaveBeenCalled();
});
