import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,PermissionsAndroid,Platform,StyleSheet} from 'react-native';
import {ThemeContext,tokens} from '../theme-context';
import {VoiceInputSession} from '../voice-input';

jest.mock('../speech',()=>({stopSpeech:jest.fn(async()=>true),subscribeSpeech:()=>()=>{},speechSnapshot:()=>null}));
jest.mock('lucide-react-native',()=>({Mic:'Mic',Square:'Square',X:'X'}));
declare const __dirname:string;
Platform.OS='android';
// Production NativeWind button utilities, including directional px/py: no mocked Button.
require('react-native-css-interop/dist/runtime/components');
const {useSpeechOptions}=require('../components/speech-options');
const {VoiceInputButton}=require('../components/voice-input-button');
function Harness({session}:{session:VoiceInputSession}){return useSpeechOptions(session);}
const host=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>typeof node.type==='string'&&node.props.accessibilityLabel===label)[0];
const action=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const dimensions=require('react-native');
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
beforeAll(()=>{
 const script=`const fs=require('node:fs'),path=require('node:path');
 const config={...require('./tailwind.config.js'),content:[{raw:fs.readFileSync('components/ui/button.tsx','utf8'),extension:'tsx'}]};
 require('postcss')([require('tailwindcss')(config)]).process('@tailwind base; @tailwind components; @tailwind utilities;',{from:path.resolve('global.css')}).then(css=>{
 process.stdout.write(JSON.stringify(require('react-native-css-interop/css-to-rn').cssToReactNativeRuntime(css.css,{inlineRem:14})));
 }).catch(error=>{console.error(error);process.exitCode=1;});`;
 const process=require('node:process'),root=require('node:path').join(__dirname,'..');
 const css=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,NATIVEWIND_OS:'android'},encoding:'utf8',timeout:15000}));
 require('react-native-css-interop').StyleSheet.registerCompiled(css);
});
afterEach(()=>jest.restoreAllMocks());
const matrix=([337,361] as const).flatMap(width=>['light','dark'].flatMap(scheme=>[1,2].map(fontScale=>({width,scheme:scheme as 'light'|'dark',fontScale}))));
test.each(matrix)('compiled voice options/consent $width $scheme $fontScale keep actions legible and bounded',async({width,scheme,fontScale})=>{
 jest.spyOn(dimensions,'useWindowDimensions').mockReturnValue({width,height:fontScale===2?440:754,fontScale,scale:1});
 (AppState as any).currentState='active';jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 const provider={mode:'platform' as const,key:'named-service|en-GB',label:'Named speech service',language:'en-GB',networkCapable:true};
 NativeModules.BobVoiceInput={options:jest.fn(async()=>[provider]),availability:jest.fn(async()=>provider.mode),windowFocused:jest.fn(async()=>true),startConfigured:jest.fn(async()=>{}),cancel:jest.fn(async()=>{}),addListener:jest.fn(),removeListeners:jest.fn()};
 const session=new VoiceInputSession(()=>{},()=>{},()=>{});session.configure('chat-visit',true);
 let tree:Renderer.ReactTestRenderer|undefined;
 try{
  await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><Harness session={session}/></ThemeContext.Provider>);});
  const work=session.press(true);await act(flush);
  const card=tree!.root.findByProps({testID:'speech-options'}),cardStyle=StyleSheet.flatten(card.props.style);
  expect(cardStyle.backgroundColor).toBe(tokens[scheme].colors.background);expect(cardStyle.maxHeight).toBeLessThanOrEqual(fontScale===2?440:754);
  const language=host(tree!,'English (UK) · en-GB');const languageStyle=StyleSheet.flatten(language.props.style);
  expect(languageStyle).toMatchObject({minHeight:56,paddingTop:10,paddingBottom:10,paddingLeft:12,paddingRight:12});
  await act(async()=>{action(tree!,'English (UK) · en-GB').props.onPress();await flush();});
  const back=host(tree!,'Back to languages'),backStyle=StyleSheet.flatten(back.props.style);
  expect(backStyle.minHeight).toBeGreaterThanOrEqual(48);expect(backStyle.paddingTop).toBe(10);
  await act(async()=>{action(tree!,'Named speech service · en-GB').props.onPress();await flush();});
  const consent=tree!.root.findByProps({testID:'speech-network-consent'});
  expect(StyleSheet.flatten(consent.props.style).backgroundColor).toBe(tokens[scheme].colors.background);
  const text=(node:any):string=>node.children.map((child:any)=>typeof child==='string'?child:text(child)).join(' ');
  expect(text(consent)).toContain('Named speech service');expect(text(consent)).toContain('en-GB');
  const body=consent.findAll(node=>typeof node.type==='string'&&StyleSheet.flatten(node.props.style)?.lineHeight===24)[0];
  expect(StyleSheet.flatten(body.props.style).color).toBe(tokens[scheme].colors.foreground);
  const allow=host(tree!,'Allow and remember network speech'),allowStyle=StyleSheet.flatten(allow.props.style);
  expect(allowStyle).toMatchObject({minHeight:48,paddingTop:8,paddingBottom:8,paddingLeft:8,paddingRight:8});
  const staleAllow=action(tree!,'Allow and remember network speech').props.onPress;
  await act(async()=>{
   if(fontScale===2)tree!.root.findAll(node=>node.props.visible===true&&typeof node.props.onRequestClose==='function')[0].props.onRequestClose();
   else action(tree!,'Cancel network speech').props.onPress();
   await flush();staleAllow();await flush();
  });await work;
  const again=session.press(true);await act(flush);
  const close=host(tree!,'Close speech options'),closeStyle=StyleSheet.flatten(close.props.style);
  expect(closeStyle).toMatchObject({minHeight:48,paddingTop:8,paddingBottom:8,paddingLeft:12,paddingRight:12});
  await act(async()=>{action(tree!,'Close speech options').props.onPress();await flush();});await again;
  expect(NativeModules.BobVoiceInput.startConfigured).not.toHaveBeenCalled();
 }finally{session.dispose();await act(async()=>tree?.unmount());}
});

test.each(['light','dark'] as const)('compiled draft recovery %s remains high-contrast and reaches speech options without capture',async scheme=>{
 jest.spyOn(dimensions,'useWindowDimensions').mockReturnValue({width:337,height:440,fontScale:2,scale:1});
 (AppState as any).currentState='active';jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 NativeModules.BobVoiceInput={options:jest.fn(async()=>[{mode:'onDevice',key:'local|en-PL',label:'Local',language:'en-PL',networkCapable:false}]),availability:jest.fn(async()=>'onDevice'),windowFocused:jest.fn(async()=>true),startConfigured:jest.fn(async()=>{}),cancel:jest.fn(async()=>{}),addListener:jest.fn(),removeListeners:jest.fn()};
 let session!:VoiceInputSession;const original=VoiceInputSession.prototype.press;
 jest.spyOn(VoiceInputSession.prototype,'press').mockImplementation(function(this:VoiceInputSession,choose?:boolean){session=this;return original.call(this,choose);});
 let tree:Renderer.ReactTestRenderer|undefined;
 try{
  await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><VoiceInputButton disabled={false} active scope="chat-visit" onTranscript={()=>{}}/></ThemeContext.Provider>);});
  await act(async()=>{action(tree!,'Dictate message').props.onPress();await flush();});
  const id=(NativeModules.BobVoiceInput.startConfigured as jest.Mock).mock.calls[0][0];
  await act(async()=>session.receive({id,state:'error',message:'Requested model unavailable. Use Speech options.'}));
  const card=tree!.root.findByProps({testID:'dictation-recovery'});
  expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(tokens[scheme].colors.background);
  const body=card.findAll(node=>typeof node.type==='string'&&StyleSheet.flatten(node.props.style)?.lineHeight===24)[0];
  expect(StyleSheet.flatten(body.props.style).color).toBe(tokens[scheme].colors.foreground);
  const recoveryAction=host(tree!,'Open speech options from dictation recovery'),style=StyleSheet.flatten(recoveryAction.props.style);
  expect(style).toMatchObject({minHeight:48,paddingTop:8,paddingBottom:8,paddingLeft:8,paddingRight:8});
  await act(async()=>{tree!.root.findAll(node=>node.props.accessibilityLabel==='Open speech options from dictation recovery'&&typeof node.props.onPress==='function')[0].props.onPress();await flush();});expect(tree!.root.findByProps({testID:'speech-options'})).toBeTruthy();
  await act(async()=>{action(tree!,'Close speech options').props.onPress();await flush();});
  expect(NativeModules.BobVoiceInput.startConfigured).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>tree?.unmount());}
});
