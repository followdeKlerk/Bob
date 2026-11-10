import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,Platform,StyleSheet,UIManager} from 'react-native';
import {ThemeContext,tokens} from '../theme-context';
import * as Keychain from 'react-native-keychain';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('lucide-react-native',()=>({Play:()=>null,Pause:()=>null,FileAudio:()=>null,FileVideo:()=>null,Square:()=>null,RotateCcw:()=>null,Download:()=>null,Info:()=>null,ExternalLink:()=>null,Maximize:()=>null,X:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:'SafeAreaProvider',SafeAreaView:'SafeAreaView'}));
jest.mock('react-native/Libraries/ReactNative/requireNativeComponent',()=>({__esModule:true,default:()=> 'BobInlineMedia'}));
Platform.OS='android';
jest.spyOn(UIManager,'getViewManagerConfig').mockReturnValue({} as any);
// NativeWind intentionally skips this registration in NODE_ENV=test. Without it,
// Pressable style callbacks work in Jest even when production interop discards them.
require('react-native-css-interop/dist/runtime/components');
const {StreamingMedia}=require('../components/streaming-media');
const backend={backendId:'synthetic',endpoint:'https://fixture.invalid'};
const artifact={id:'5aaee20e-e260-4403-80da-b97ce80664a1',conversationId:7,name:'sample.mp3',mime:'audio/mpeg',size:481165};
const hostButton=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>typeof node.type==='string'&&node.props.accessibilityRole==='button'&&node.props.accessibilityLabel===label)[0];
const actionButton=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const press=(tree:Renderer.ReactTestRenderer,label:string)=>actionButton(tree,label).props.onPress();
const player=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType('BobInlineMedia' as any).find(node=>node.props.source?.sessionId);
beforeEach(()=>{jest.clearAllMocks();jest.spyOn(AppState,'addEventListener').mockImplementation(()=>({remove:jest.fn()}));(Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'synthetic-only'});});

test.each(['light','dark'] as const)('audio has a visible, labelled 48dp Play target through production interop in %s',async(scheme)=>{
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><StreamingMedia backend={backend} artifact={artifact} video={false} onOpen={jest.fn()} onDetails={jest.fn()}/></ThemeContext.Provider>);});
  expect(Keychain.getGenericPassword).not.toHaveBeenCalled();expect(player(tree)).toBeUndefined();
  const control=hostButton(tree,'Play audio: sample.mp3');expect(control).toBeDefined();
  const style=StyleSheet.flatten(control.props.style);
  expect(style?.backgroundColor).toBe(tokens[scheme].colors.accent);
  expect(style.minHeight??style.height).toBeGreaterThanOrEqual(48);
  expect(style.minWidth??style.width).toBeGreaterThanOrEqual(48);
  const label=control.findAll(node=>typeof node.type==='string'&&node.props.children==='Play')[0];
  expect(label).toBeDefined();expect(StyleSheet.flatten(label.props.style).color).toBe(tokens[scheme].colors.onAccent);
  await act(async()=>actionButton(tree,'Play audio: sample.mp3').props.onPressIn());
  expect(StyleSheet.flatten(hostButton(tree,'Play audio: sample.mp3').props.style).opacity).toBe(0.75);
  expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  await act(async()=>actionButton(tree,'Play audio: sample.mp3').props.onPressOut());
  expect(hostButton(tree,'Play audio: sample.mp3')).toBe(control);
  expect(StyleSheet.flatten(control.props.style).opacity).toBeUndefined();
  await act(async()=>press(tree,'Play audio: sample.mp3'));
  expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);
  expect(player(tree)?.props.source).toEqual(expect.objectContaining({video:false,initialPositionMs:0,initialPaused:false,identity:'synthetic'}));
  expect(StyleSheet.flatten(hostButton(tree,'Loading audio: sample.mp3').props.style).backgroundColor).toBe(tokens[scheme].colors.accent);
  const source=player(tree)!.props.source;
  await act(async()=>player(tree)!.props.onProgress({nativeEvent:{sessionId:source.sessionId,positionMs:1200,durationMs:30000,paused:false,phase:'playing',receivedBytes:262144,videoReady:false}}));
  expect(hostButton(tree,'Pause audio: sample.mp3')).toBeDefined();
  await act(async()=>press(tree,'Pause audio: sample.mp3'));
  expect(player(tree)!.props.control).toEqual({sessionId:source.sessionId,sequence:1,action:'pause'});
  expect(player(tree)!.props.source).toBe(source);expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>tree?.unmount());}
});

test('inactive audio retains visible controls but cannot authorize playback',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<StreamingMedia backend={backend} artifact={artifact} video={false} active={false} onOpen={jest.fn()} onDetails={jest.fn()}/>);});
  const control=hostButton(tree,'Play audio: sample.mp3');expect(control.props.accessibilityState.disabled).toBe(true);
  expect(StyleSheet.flatten(control.props.style)?.backgroundColor).toBe(tokens.dark.colors.accent);
  await act(async()=>press(tree,'Play audio: sample.mp3'));
  expect(Keychain.getGenericPassword).not.toHaveBeenCalled();expect(player(tree)).toBeUndefined();
 }finally{await act(async()=>tree?.unmount());}
});
