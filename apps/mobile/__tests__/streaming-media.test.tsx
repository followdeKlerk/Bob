import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,Modal,Platform,StyleSheet,UIManager} from 'react-native';
import {ThemeContext,tokens} from '../theme-context';
import * as Keychain from 'react-native-keychain';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn()}));
jest.mock('lucide-react-native',()=>({Play:()=>null,Pause:()=>null,FileAudio:()=>null,FileVideo:()=>null,Square:()=>null,RotateCcw:()=>null,Download:()=>null,Info:()=>null,ExternalLink:()=>null,Maximize:()=>null,X:()=>null}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaProvider:'SafeAreaProvider',SafeAreaView:'SafeAreaView'}));
jest.mock('../components/attachment-thumbnail',()=>({SentAttachmentThumbnail:()=>null}));
jest.mock('react-native/Libraries/ReactNative/requireNativeComponent',()=>({__esModule:true,default:()=> 'BobInlineMedia'}));
Platform.OS='android';
jest.spyOn(UIManager,'getViewManagerConfig').mockReturnValue({} as any);
const {StreamingMedia}=require('../components/streaming-media');
const backend={backendId:'paired',endpoint:'https://owner.ts.net'},artifact={id:'5aaee20e-e260-4403-80da-b97ce80664a1',conversationId:7,name:'clip.mp4',mime:'video/mp4',size:12345678};
const props={backend,artifact,video:true,onOpen:jest.fn(),onSave:jest.fn(),onDetails:jest.fn()};
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const players=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType('BobInlineMedia' as any).filter(node=>node.props.source?.sessionId);
beforeEach(()=>{jest.clearAllMocks();jest.spyOn(AppState,'addEventListener').mockImplementation(()=>({remove:jest.fn()}));(Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'owner-secret'});});
test('no credential access or media request until owner taps Play; Open and Save are independent',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 expect(Keychain.getGenericPassword).not.toHaveBeenCalled();expect(players(tree)).toHaveLength(0);
 await act(async()=>button(tree,'Open clip.mp4 externally').props.onPress());expect(props.onOpen).toHaveBeenCalledTimes(1);expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
 await act(async()=>button(tree,'Save clip.mp4').props.onPress());expect(props.onSave).toHaveBeenCalledTimes(1);expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 expect(Keychain.getGenericPassword).toHaveBeenCalledWith({service:'bob.paired'});
 expect(players(tree)[0].props.source).toEqual(expect.objectContaining({endpoint:backend.endpoint,identity:'paired',token:'owner-secret',conversation:'7',artifact:artifact.id,size:artifact.size,video:true,initialPositionMs:0,initialPaused:false}));
 expect(players(tree)[0].props.source.endpoint).not.toContain('owner-secret');await act(async()=>tree.unmount());
});
test('off-chat, backend switch, and background discard native player and never resume automatically',async()=>{
 let background:((state:string)=>void)|undefined;
 const listener=jest.spyOn(AppState,'addEventListener').mockImplementation((_name,callback)=>{background=callback as any;return {remove:jest.fn()};});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 const play=async()=>act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 await play();expect(players(tree)).toHaveLength(1);
 await act(async()=>tree.update(<StreamingMedia {...props} active={false}/>));expect(players(tree)).toHaveLength(0);
 await act(async()=>tree.update(<StreamingMedia {...props} active/>));expect(players(tree)).toHaveLength(0);
 await play();await act(async()=>background?.('background'));expect(players(tree)).toHaveLength(0);
 await act(async()=>background?.('active'));expect(players(tree)).toHaveLength(0);
 await play();await act(async()=>tree.update(<StreamingMedia {...props} backend={{...backend,backendId:'different'}}/>));expect(players(tree)).toHaveLength(0);
 await act(async()=>tree.unmount());listener.mockRestore();
});
test('late keychain result after hiding cannot start playback; failures are explicit and retry needs another owner tap',async()=>{
 let resolve!:(value:unknown)=>void;(Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>{button(tree,'Play video: clip.mp4').props.onPress();});
 await act(async()=>tree.update(<StreamingMedia {...props} active={false}/>));
 await act(async()=>resolve({password:'too-late'}));expect(players(tree)).toHaveLength(0);
 await act(async()=>tree.update(<StreamingMedia {...props} active/>));
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 await act(async()=>players(tree)[0].props.onStopped({nativeEvent:{sessionId:players(tree)[0].props.source.sessionId,positionMs:0,paused:true,message:'Unsupported codec. Retry or Save.'}}));
 expect(players(tree)).toHaveLength(0);expect(button(tree,'Retry video: clip.mp4')).toBeDefined();expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(2);
 await act(async()=>button(tree,'Retry video: clip.mp4').props.onPress());expect(players(tree)).toHaveLength(1);await act(async()=>tree.unmount());
});

test('text stays in natural React layout and surface resizing does not reauthorize playback',async()=>{
 const dimensions=jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:352,height:800,scale:1,fontScale:1});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 const source=players(tree)[0].props.source;
 expect(players(tree)[0].props.sizing).toEqual({videoHeight:167,seekHeight:48,height:215});
 dimensions.mockReturnValue({width:352,height:800,scale:1,fontScale:2});
 await act(async()=>tree.update(<StreamingMedia {...props}/>));
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'media-card'}).props.style).height).toBeUndefined();
 expect(players(tree)[0].props.sizing.seekHeight).toBe(48);
 expect(players(tree)[0].props.source).toBe(source);expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);
 const layout=tree.root.findAll(node=>typeof node.props.onLayout==='function')[0];
 await act(async()=>layout.props.onLayout({nativeEvent:{layout:{width:640}}}));
 expect(players(tree)[0].props.sizing).toEqual({videoHeight:360,seekHeight:48,height:408});
 expect(players(tree)[0].props.source).toBe(source);
 await act(async()=>tree.unmount());dimensions.mockRestore();
});

const modal=(tree:Renderer.ReactTestRenderer)=>tree.root.findByType(Modal);
const report=(player:any,positionMs:number,paused:boolean)=>({nativeEvent:{sessionId:player.props.source.sessionId,positionMs,durationMs:120000,paused,buffering:false}});
test('full view is tap-only, waits for the modal window, preserves progress/pause, and retires old native callbacks',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 expect(tree.root.findAllByType(Modal)).toHaveLength(0);expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());const inline={props:players(tree)[0].props};const oldStopped=inline.props.onStopped,oldProgress=inline.props.onProgress;
 await act(async()=>oldProgress(report(inline,35000,true)));
 await act(async()=>button(tree,'Full video: clip.mp4').props.onPress());
 expect(players(tree)).toHaveLength(0);expect(tree.root.findAllByType(Modal)).toHaveLength(1);
 await act(async()=>oldStopped(report(inline,90000,false)));expect(tree.root.findAllByType(Modal)).toHaveLength(1);
 await act(async()=>modal(tree).props.onShow());const full={props:players(tree)[0].props};
 expect(full.props.source.sessionId).not.toBe(inline.props.source.sessionId);expect(full.props.source.initialPositionMs).toBe(35000);expect(full.props.source.initialPaused).toBe(true);
 expect(tree.root.findByType('SafeAreaView' as any).props.edges).toEqual(['top','right','bottom','left']);
 await act(async()=>oldProgress(report(inline,99999,false)));
 await act(async()=>full.props.onProgress(report(full,50000,false)));
 const fullStopped=full.props.onStopped,lateBack=modal(tree).props.onRequestClose;
 await act(async()=>modal(tree).props.onRequestClose());expect(players(tree)).toHaveLength(0);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(2);
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());const resumed=players(tree)[0];
 expect(resumed.props.source.initialPositionMs).toBe(50000);expect(resumed.props.source.initialPaused).toBe(false);
 await act(async()=>{fullStopped(report(full,110000,true));lateBack();});
 expect(players(tree)[0].props.source.sessionId).toBe(resumed.props.source.sessionId);
 await act(async()=>tree.unmount());
});
test('closing full view while authorization is pending invalidates the late credential',async()=>{
 let resolve!:(value:unknown)=>void;(Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>{button(tree,'Full video: clip.mp4').props.onPress();});expect(players(tree)).toHaveLength(0);
 await act(async()=>{modal(tree).props.onShow();});expect(players(tree)).toHaveLength(0);
 await act(async()=>button(tree,'Close full video').props.onPress());
 await act(async()=>resolve({password:'late-secret'}));expect(players(tree)).toHaveLength(0);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 await act(async()=>tree.unmount());
});
test.each(['scope','inactive','background'])('full view releases on %s and old authorization/callbacks cannot affect a new scope',async(reason)=>{
 let background:((state:string)=>void)|undefined;
 jest.spyOn(AppState,'addEventListener').mockImplementation((_name,callback)=>{background=callback as any;return {remove:jest.fn()};});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>button(tree,'Full video: clip.mp4').props.onPress());await act(async()=>modal(tree).props.onShow());
 const old={props:players(tree)[0].props},oldStopped=old.props.onStopped,oldProgress=old.props.onProgress,lateBack=modal(tree).props.onRequestClose;
 const next={...props,backend:{...backend,backendId:'other-paired'},artifact:{...artifact,conversationId:8}};
 if(reason==='inactive')await act(async()=>tree.update(<StreamingMedia {...props} active={false}/>));
 if(reason==='background')await act(async()=>background?.('background'));
 if(reason==='scope')await act(async()=>tree.update(<StreamingMedia {...next}/>));
 expect(players(tree)).toHaveLength(0);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
 await act(async()=>tree.update(<StreamingMedia {...next}/>));
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());const fresh=players(tree)[0];
 await act(async()=>{oldStopped(report(old,99000,false));oldProgress(report(old,99000,false));lateBack();});
 expect(players(tree)[0].props.source.sessionId).toBe(fresh.props.source.sessionId);expect(fresh.props.source.initialPositionMs).toBe(0);
 expect(fresh.props.source.identity).toBe('other-paired');expect(fresh.props.source.conversation).toBe('8');
 await act(async()=>tree.unmount());
});
test('a late full-view keychain result cannot restart or stop a newly admitted scope',async()=>{
 let resolve!:(value:unknown)=>void;(Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>{button(tree,'Full video: clip.mp4').props.onPress();});
 const next={...props,backend:{...backend,backendId:'new-pair'}};
 await act(async()=>tree.update(<StreamingMedia {...next}/>));
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());const source=players(tree)[0].props.source;
 await act(async()=>resolve({password:'obsolete-secret'}));
 expect(players(tree)).toHaveLength(1);expect(players(tree)[0].props.source).toBe(source);expect(source.identity).toBe('new-pair');
 expect(tree.root.findAllByType(Modal)).toHaveLength(0);await act(async()=>tree.unmount());
});

const renderedText=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>typeof node.props.children==='string').map(node=>node.props.children as string);
test('authorization, connection, received bytes, real playback and buffering are visible rather than an optimistic Pause label',async()=>{
 let resolve!:(value:unknown)=>void;(Keychain.getGenericPassword as jest.Mock).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>{button(tree,'Play video: clip.mp4').props.onPress();});
 expect(renderedText(tree)).toContain('Authorizing…');expect(players(tree)).toHaveLength(0);
 await act(async()=>resolve({password:'fixture-secret'}));
 expect(renderedText(tree)).toContain('Connecting…');expect(button(tree,'Loading video: clip.mp4').props.disabled).toBe(true);
 const player=players(tree)[0],sessionId=player.props.source.sessionId;
 await act(async()=>player.props.onProgress({nativeEvent:{sessionId,positionMs:0,durationMs:0,paused:false,buffering:true,phase:'loading',receivedBytes:65536,videoReady:false}}));
 expect(renderedText(tree)).toContain('Loading video…');expect(renderedText(tree)).toContain('64 KB received');expect(renderedText(tree)).toContain('—:—');
 await act(async()=>player.props.onProgress({nativeEvent:{sessionId,positionMs:1500,durationMs:30000,paused:false,buffering:false,phase:'playing',receivedBytes:262144,videoReady:true}}));
 expect(renderedText(tree)).toContain('Playing');expect(renderedText(tree)).toContain('0:01');expect(renderedText(tree)).toContain('0:30');expect(button(tree,'Pause video: clip.mp4')).toBeDefined();
 await act(async()=>player.props.onProgress({nativeEvent:{sessionId,positionMs:1500,durationMs:30000,paused:false,buffering:true,phase:'buffering',receivedBytes:262144,videoReady:true}}));
 expect(renderedText(tree)).toContain('Buffering…');expect(renderedText(tree)).not.toContain('100%');
 await act(async()=>tree.unmount());
});
test('React controls send scoped, monotonic commands without reacquiring credentials or claiming pause before acknowledgement',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 const player=players(tree)[0],source=player.props.source;
 await act(async()=>player.props.onProgress(report(player,2000,false)));
 await act(async()=>button(tree,'Pause video: clip.mp4').props.onPress());
 expect(players(tree)[0].props.control).toEqual({sessionId:source.sessionId,sequence:1,action:'pause'});expect(renderedText(tree)).toContain('Playing');
 await act(async()=>player.props.onProgress(report(player,2100,true)));
 expect(renderedText(tree)).toContain('Paused');
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 expect(players(tree)[0].props.control).toEqual({sessionId:source.sessionId,sequence:2,action:'play'});expect(players(tree)[0].props.source).toBe(source);expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);
 await act(async()=>button(tree,'Stop video: clip.mp4').props.onPress());expect(players(tree)).toHaveLength(0);await act(async()=>tree.unmount());
});
test('both themes explicitly style player chrome and seek tints without remounting the native session',async()=>{
 const view=(scheme:'light'|'dark')=><ThemeContext.Provider value={tokens[scheme]}><StreamingMedia {...props}/></ThemeContext.Provider>;
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(view('light'));});
 await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());
 const player=players(tree)[0],source=player.props.source;
 for(const scheme of ['light','dark'] as const){
  await act(async()=>tree.update(view(scheme)));
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'media-card'}).props.style).backgroundColor).toBe(tokens[scheme].colors.panel);
  expect(players(tree)[0].props.palette).toEqual({foreground:tokens[scheme].colors.foreground,background:tokens[scheme].colors.panel,muted:tokens[scheme].colors.border});
  expect(players(tree)[0]).toBe(player);expect(players(tree)[0].props.source).toBe(source);
 }
 expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1);await act(async()=>tree.unmount());
});
test('a missing native response becomes a visible retry, not a permanent empty player',async()=>{
 jest.useFakeTimers();let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<StreamingMedia {...props}/>);});
  await act(async()=>button(tree,'Play video: clip.mp4').props.onPress());expect(players(tree)).toHaveLength(1);
  await act(async()=>jest.advanceTimersByTime(35000));
  expect(players(tree)).toHaveLength(0);expect(button(tree,'Retry video: clip.mp4')).toBeDefined();expect(renderedText(tree)).toContain('The player did not respond. Tap Retry, or use Open / Save.');
 }finally{await act(async()=>tree?.unmount());jest.useRealTimers();}
});
