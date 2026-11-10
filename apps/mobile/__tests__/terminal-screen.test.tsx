import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,AppState,NativeModules,Platform,StyleSheet,type AppStateStatus} from 'react-native';
import {TerminalScreen} from '../components/terminal-screen';
import {terminalConnection,terminalStatus,terminalKeyLayout,terminalHostname} from '../terminal';
import {ThemeContext,tokens} from '../theme-context';
jest.mock('uuid',()=>({v4:jest.fn(()=> '11111111-1111-4111-8111-111111111111')}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('react-native/Libraries/ReactNative/requireNativeComponent',()=>({__esModule:true,default:(name:string)=>name}));
// Exercise the same NativeWind Pressable registration as production.
require('react-native-css-interop/dist/runtime/components');
const target={backendId:'backend-a',conversationId:7,title:'Project chat is not a terminal heading'};
const status={available:true,cwd:'/tmp/project',session:undefined};
const connection={sessionId:'session-1',host:'100.64.0.1',port:60001,key:'abcdefghijklmnopqrstuv',cwd:'/tmp/project'};
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const press=(tree:Renderer.ReactTestRenderer,label:string)=>button(tree,label).props.onPress();
const output=(tree:Renderer.ReactTestRenderer)=>JSON.stringify(tree.toJSON());
const nativeView=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType('BobTerminalView' as any)[0];
const running=(tree:Renderer.ReactTestRenderer)=>nativeView(tree).props.onState({nativeEvent:{session:nativeView(tree).props.session,phase:'running'}});
const makeRequest=()=>jest.fn(async(_path:string,method?:string)=>method==='POST'?connection:method==='DELETE'?{ended:true}:status);
let appState:(state:AppStateStatus)=>void;
beforeEach(()=>{
 jest.replaceProperty(Platform,'OS','android');
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,handler)=>{appState=handler;return {remove:jest.fn()};});
 NativeModules.BobTerminal={capabilities:jest.fn(async()=>({available:true})),prepare:jest.fn(async()=> 'opaque-handle'),releasePrepared:jest.fn(async()=>{})};
});
afterEach(()=>{delete NativeModules.BobTerminal;jest.restoreAllMocks();});

test('menu entry directly embeds terminal: no launch page, Activity, chat title, key props or secret-bearing content',async()=>{
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} workstation="workstation" allowed request={request} onBack={()=>{}}/>);});
 expect(request.mock.calls.map(c=>c[1])).toEqual(['GET','POST']);
 expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledWith({...connection,...target,title:'Terminal'});
 expect(nativeView(tree).props).toMatchObject({session:'opaque-handle',active:true});
 expect(nativeView(tree).props).not.toHaveProperty('key');expect(nativeView(tree).props).not.toHaveProperty('source');
 expect(output(tree)).not.toContain('/tmp/project');expect(output(tree)).not.toContain(connection.key);expect(output(tree)).not.toContain(target.title);
 expect(output(tree)).not.toMatch(/Open terminal|Linux prototype|This is a separate shell|Going back leaves/);
 await act(async()=>running(tree));expect(output(tree)).not.toContain('Connected');
 await act(async()=>tree.unmount());expect(NativeModules.BobTerminal.releasePrepared).toHaveBeenCalledWith('opaque-handle');
});

test('uncertain bootstrap never retries automatically; deliberate reconnect reuses request identity and hides raw errors',async()=>{
 const request=jest.fn(async(_path:string,method?:string)=>{if(method==='POST')throw Error(`private ${connection.key}`);return status;});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);expect(output(tree)).not.toContain(connection.key);
 await act(async()=>press(tree,'Reconnect'));
 const calls=request.mock.calls.filter(c=>c[1]==='POST');expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
 await act(async()=>tree.unmount());
});

test('unavailable client/host never starts a shell, and read-only or missing conversation performs no IO',async()=>{
 delete NativeModules.BobTerminal;const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 expect(output(tree)).toContain('Update Bob');expect(request.mock.calls.map(c=>c[1])).toEqual(['GET']);expect(nativeView(tree)).toBeUndefined();
 await act(async()=>tree.update(<TerminalScreen visible target={target} allowed={false} request={request} onBack={()=>{}}/>));
 expect(output(tree)).toContain('read-only');expect(request).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<TerminalScreen visible allowed request={request} onBack={()=>{}}/>));
 expect(output(tree)).toContain('Select a conversation');expect(request).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});

test('late bootstrap cannot prepare after leaving or switching scopes',async()=>{
 let resolve!:(v:unknown)=>void;
 const request=jest.fn((_path:string,method?:string)=>method==='POST'?new Promise(r=>{resolve=r;}):Promise.resolve(status));
 const props={target,allowed:true,request,onBack:()=>{}};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible {...props}/>);});
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);
 await act(async()=>tree.update(<TerminalScreen visible={false} {...props}/>));
 await act(async()=>resolve(connection));expect(NativeModules.BobTerminal.prepare).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});

test('quick leave/re-entry shares the original in-flight bootstrap; double reconnect taps cannot duplicate it',async()=>{
 let resolve!:(v:unknown)=>void;
 const request=jest.fn((_path:string,method?:string)=>method==='POST'?new Promise(r=>{resolve=r;}):Promise.resolve(status));
 const props={target,allowed:true,request,onBack:()=>{}};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible {...props}/>);});
 await act(async()=>tree.update(<TerminalScreen visible={false} {...props}/>));
 await act(async()=>tree.update(<TerminalScreen visible {...props}/>));
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);
 await act(async()=>resolve(connection));expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledTimes(1);
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'failed',message:connection.key}}));
 expect(output(tree)).not.toContain(connection.key);
 act(()=>{press(tree,'Reconnect');press(tree,'Reconnect');});
 expect(request.mock.calls.filter(c=>c[1]==='GET')).toHaveLength(3);
 await act(async()=>tree.unmount());await act(async()=>resolve(connection));
});

test('late native preparation is released, never mounted into a different conversation',async()=>{
 let resolve!:(handle:string)=>void;NativeModules.BobTerminal.prepare.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const request=makeRequest(),props={target,allowed:true,request,onBack:()=>{}};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible {...props}/>);});
 await act(async()=>tree.update(<TerminalScreen visible {...props} target={{...target,conversationId:8}} allowed={false}/>));
 await act(async()=>resolve('stale-handle'));
 expect(nativeView(tree)).toBeUndefined();expect(NativeModules.BobTerminal.releasePrepared).toHaveBeenCalledWith('stale-handle');
 await act(async()=>tree.unmount());
});

test('background closes local view only; resume requires explicit reconnect and rejects stale events',async()=>{
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 await act(async()=>running(tree));const oldEvent=nativeView(tree).props.onState;
 await act(async()=>appState('background'));
 expect(nativeView(tree)).toBeUndefined();expect(request.mock.calls.filter(c=>c[1]==='DELETE')).toHaveLength(0);
 await act(async()=>appState('active'));
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);expect(output(tree)).toContain('Session paused');
 await act(async()=>oldEvent({nativeEvent:{session:'opaque-handle',phase:'running'}}));expect(output(tree)).toContain('Session paused');
 await act(async()=>press(tree,'Reconnect'));expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(2);
 await act(async()=>tree.unmount());
});

test('keys, Ctrl, keyboard and secondary actions reach only the opaque mounted view',async()=>{
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 await act(async()=>running(tree));const view=nativeView(tree);
 await act(async()=>press(tree,'Control key'));expect(nativeView(tree).props.control).toEqual({sequence:1,action:'ctrl',enabled:true});
 expect(button(tree,'Control key').props.accessibilityState.selected).toBe(true);
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',ctrl:true,acknowledged:1}}));
 await act(async()=>press(tree,'Tab'));expect(nativeView(tree).props.control).toEqual({sequence:2,action:'input',text:'\t'});
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',ctrl:false,acknowledged:2}}));
 expect(button(tree,'Control key').props.accessibilityState.selected).toBe(false);
 await act(async()=>press(tree,'Show terminal keyboard'));expect(nativeView(tree).props.control).toEqual({sequence:3,action:'keyboard'});
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',acknowledged:3}}));
 await act(async()=>press(tree,'Terminal controls'));await act(async()=>press(tree,'History'));
 expect(nativeView(tree).props.control).toEqual({sequence:4,action:'history'});expect(nativeView(tree)).toBe(view);
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});

test.each(['dark','light'] as const)('IME resize and %s theme keep the native view identity and a single inset owner',async scheme=>{
 const request=makeRequest(),props={visible:true,target,allowed:true,request,onBack:()=>{}};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens.dark}><TerminalScreen {...props}/></ThemeContext.Provider>);});
 const view=nativeView(tree);
 await act(async()=>tree.update(<ThemeContext.Provider value={tokens[scheme]}><TerminalScreen {...props} bottomInset={280}/></ThemeContext.Provider>));
 expect(nativeView(tree)).toBe(view);expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledTimes(1);
 const root=tree.root.findAll(n=>n.props.testID==='terminal-screen')[0];expect(StyleSheet.flatten(root.props.style)).toMatchObject({bottom:280,backgroundColor:tokens[scheme].colors.background});
 const key=button(tree,'Tab');expect(StyleSheet.flatten(key.props.style).minHeight).toBeGreaterThanOrEqual(48);
 await act(async()=>tree.unmount());
});

test('End is a confirmed exact-session action; Back merely leaves the host shell running',async()=>{
 const request=makeRequest(),back=jest.fn(),alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={back}/>);});
 await act(async()=>running(tree));await act(async()=>press(tree,'Back to previous menu'));expect(back).toHaveBeenCalledTimes(1);
 expect(request.mock.calls.filter(c=>c[1]==='DELETE')).toHaveLength(0);
 await act(async()=>press(tree,'Terminal controls'));await act(async()=>press(tree,'End session'));
 expect(request.mock.calls.filter(c=>c[1]==='DELETE')).toHaveLength(0);
 await act(async()=>alert.mock.calls[0][2]![1].onPress!());
 expect(request).toHaveBeenCalledWith('chats/7/terminal','DELETE',{sessionId:'session-1'});
 expect(nativeView(tree)).toBeUndefined();expect(output(tree)).toContain('Session ended');
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});

test('uncertain End requires read-only status check, never auto-replays End or starts a new connection',async()=>{
 const request=jest.fn(async(_path:string,method?:string)=>{if(method==='DELETE')throw Error(connection.key);return method==='POST'?connection:status;}),alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 await act(async()=>running(tree));await act(async()=>press(tree,'Terminal controls'));await act(async()=>press(tree,'End session'));
 await act(async()=>alert.mock.calls[0][2]![1].onPress!());
 expect(output(tree)).not.toContain(connection.key);expect(output(tree)).toContain('Check status');
 await act(async()=>press(tree,'Check status'));
 expect(request.mock.calls.map(c=>c[1])).toEqual(['GET','POST','DELETE','GET']);
 await act(async()=>tree.unmount());
});

test('response validation rejects malformed input without echoing secret-bearing values',()=>{
 expect(terminalConnection(connection)).toEqual(connection);
 for(const change of [{port:22},{port:60000.5},{key:'bad-secret'},{host:'https://wrong.example'},{cwd:'relative'},{sessionId:'../../wrong'}])expect(()=>terminalConnection({...connection,...change})).toThrow('Invalid terminal connection response');
 expect(()=>terminalStatus({cwd:'/',available:'yes'})).toThrow('Could not read terminal status');
});

test('batched key presses stay FIFO; only the exact head acknowledgment advances and Ctrl toggles do not collapse',async()=>{
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 await act(async()=>running(tree));
 act(()=>{press(tree,'Tab');press(tree,'Escape');press(tree,'Control key');press(tree,'Control key');});
 expect(nativeView(tree).props.control).toEqual({sequence:1,action:'input',text:'\t'});
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'wrong-handle',phase:'running',acknowledged:1}}));
 expect(nativeView(tree).props.control.sequence).toBe(1);
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',acknowledged:2}}));
 expect(nativeView(tree).props.control.sequence).toBe(1);
 for(const [ack,expected] of [[1,{sequence:2,action:'input',text:'\u001b'}],[2,{sequence:3,action:'ctrl',enabled:true}],[3,{sequence:4,action:'ctrl',enabled:false}]] as const){
  await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',acknowledged:ack}}));
  expect(nativeView(tree).props.control).toEqual(expected);
 }
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',acknowledged:4,ctrl:false}}));
 expect(nativeView(tree).props.control).toBeUndefined();expect(button(tree,'Control key').props.accessibilityState.selected).toBe(false);
 expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});

test('input delivery timeout and saturation close visibly without reconnecting or replaying keys',async()=>{
 jest.useFakeTimers();const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
  await act(async()=>running(tree));await act(async()=>press(tree,'Tab'));
  await act(async()=>jest.advanceTimersByTime(5000));
  expect(nativeView(tree)).toBeUndefined();expect(output(tree)).toContain('Terminal input stalled');
  expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);
  await act(async()=>press(tree,'Reconnect'));await act(async()=>running(tree));
  act(()=>{for(let i=0;i<33;i++)press(tree,'Tab');});
  expect(nativeView(tree)).toBeUndefined();expect(output(tree)).toContain('Terminal input queue is full');
  expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(2);
 }finally{await act(async()=>tree?.unmount());jest.useRealTimers();}
});

test('compact header and native view stay mounted through keyboard resize; Menu dismisses the native IME',async()=>{
 const request=makeRequest(),props={visible:true,target,workstation:'Test host',allowed:true,request,onBack:()=>{}};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen {...props}/>);});await act(async()=>running(tree));
 const view=nativeView(tree),header=tree.root.findAllByProps({testID:'terminal-header'})[0];
 await act(async()=>tree.update(<TerminalScreen {...props} bottomInset={300} menuOpen/>));
 expect(tree.root.findAllByProps({testID:'terminal-header'})[0]).toBe(header);expect(output(tree)).toContain('Test host');
 expect(nativeView(tree)).toBe(view);expect(button(tree,'Terminal controls')).toBeDefined();
 expect(nativeView(tree).props.control).toEqual({sequence:1,action:'keyboard',enabled:false});
 expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});

test.each(['unmount','re-entry'] as const)('End confirmation loses authority after %s',async transition=>{
 const request=makeRequest(),props={visible:true,target,allowed:true,request,onBack:()=>{}},alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen {...props}/>);});await act(async()=>running(tree));
 await act(async()=>press(tree,'Terminal controls'));await act(async()=>press(tree,'End session'));
 const staleConfirm=alert.mock.calls[0][2]![1].onPress!;
 if(transition==='unmount')await act(async()=>tree.unmount());
 else{
  await act(async()=>tree.update(<TerminalScreen {...props} visible={false}/>));
  await act(async()=>tree.update(<TerminalScreen {...props}/>));
 }
 await act(async()=>staleConfirm());
 expect(request.mock.calls.filter(c=>c[1]==='DELETE')).toHaveLength(0);
 if(transition!=='unmount')await act(async()=>tree.unmount());
});

test.each([337,361,400])('all seven compact keys fit at %s dp without smaller text or horizontal scrolling',async width=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width,height:754,scale:2.75,fontScale:1});
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 await act(async()=>running(tree));const view=nativeView(tree);
 await act(async()=>tree.root.findAllByProps({testID:'terminal-key-row'})[0].props.onLayout({nativeEvent:{layout:{width}}}));
 const row=tree.root.findAllByProps({testID:'terminal-key-row'})[0];
 expect(row.props.horizontal).toBeUndefined();
 const expected=terminalKeyLayout(width,1);expect(expected.columns).toBe(7);
 const label=['Control key','Escape','Tab','Arrow up','Arrow down','Arrow left','Arrow right'];
 for(const key of label){
  const style=StyleSheet.flatten(button(tree,key).props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(48);
  expect(style.width).toBeGreaterThanOrEqual(44);
  expect(style.width).toBe(expected.basis);
  expect(button(tree,key).props.className).toBeUndefined();
 }
 expect(7*expected.basis+6*2+16).toBeLessThanOrEqual(width+0.01);
 expect(nativeView(tree)).toBe(view);expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});

test('large text and narrow windows wrap keys into balanced rows instead of clipping or shrinking labels',()=>{
 for(const [width,scale] of [[320,1],[337,1.5],[361,2],[240,2]]){
  const layout=terminalKeyLayout(width,scale);
  expect(layout.columns).toBeLessThanOrEqual(4);expect(layout.columns).toBeGreaterThanOrEqual(1);
  expect(layout.basis*layout.columns+(layout.columns-1)*2+16).toBeLessThanOrEqual(width+0.01);
 }
});

test('header shortens only MagicDNS suffix and preserves the full hostname for accessibility',async()=>{
 expect(terminalHostname('nathan-omarchy.tail7d5b8e.ts.net')).toBe('nathan-omarchy');
 expect(terminalHostname('host.example.com')).toBe('host.example.com');
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} workstation="nathan-omarchy.tail7d5b8e.ts.net" allowed request={request} onBack={()=>{}}/>);});
 const header=tree.root.findAllByProps({testID:'terminal-header'})[0];
 const host=header.findAll(n=>n.props.accessibilityLabel==='nathan-omarchy.tail7d5b8e.ts.net')[0];
 expect(host.props.children).toBe('nathan-omarchy');
 const title=header.findAll(n=>n.props.accessibilityRole==='header')[0];
 expect(StyleSheet.flatten(title.props.style).fontSize).toBe(18);
 expect(output(tree)).not.toContain('/tmp/project');
 await act(async()=>tree.unmount());
});

test.each([1,1.5,2])('key faces share numeric dimensions at font scale %s',async fontScale=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:361,height:754,scale:3,fontScale});
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} allowed request={request} onBack={()=>{}}/>);});
 const row=tree.root.findAllByProps({testID:'terminal-key-row'})[0];
 expect(StyleSheet.flatten(row.props.style).rowGap).toBe(4);
 const layout=terminalKeyLayout(361,fontScale);
 for(const label of ['Control key','Escape','Tab','Arrow up','Arrow down','Arrow left','Arrow right']){
  const key=button(tree,label),face=key.findAll(n=>n.props.pointerEvents==='none')[0],style=StyleSheet.flatten(face.props.style);
  expect(style.width).toBe(layout.basis-4);expect(style.minHeight).toBe(layout.faceHeight);
  expect(StyleSheet.flatten(key.props.style).minHeight).toBeGreaterThanOrEqual(48);
 }
 for(const label of ['Ctrl','Esc','Tab'])expect(row.findAll(n=>n.props.children===label&&n.props.typography==='ui')[0].props.numberOfLines).toBe(1);
 await act(async()=>tree.unmount());
});

test.each([{height:120,fontScale:1},{height:300,fontScale:2}])('short viewport $height at scale $fontScale keeps keys reachable without replacing the native view',async({height,fontScale})=>{
 jest.spyOn(require('react-native'),'useWindowDimensions').mockReturnValue({width:361,height:754,scale:3,fontScale});
 const request=makeRequest();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<TerminalScreen visible target={target} workstation="workstation" allowed request={request} onBack={()=>{}}/>);});
 await act(async()=>running(tree));const view=nativeView(tree);
 const frame=()=>tree.root.findAllByProps({testID:'terminal-screen'})[0];
 await act(async()=>frame().props.onLayout({nativeEvent:{layout:{width:361,height}}}));
 expect(tree.root.findAllByProps({testID:'terminal-key-row'})).toHaveLength(0);
 const header=()=>tree.root.findAllByProps({testID:'terminal-header-container'})[0];
 expect(StyleSheet.flatten(header().props.style)?.display).toBe(height<240?'none':undefined);
 await act(async()=>press(tree,'Terminal controls'));
 expect(nativeView(tree).props.control).toEqual({sequence:1,action:'keyboard',enabled:false});
 await act(async()=>nativeView(tree).props.onState({nativeEvent:{session:'opaque-handle',phase:'running',acknowledged:1}}));
 await act(async()=>press(tree,'Tab'));
 expect(nativeView(tree).props.control).toEqual({sequence:2,action:'input',text:'\t'});
 expect(tree.root.findAllByProps({testID:'terminal-controls'})).toHaveLength(0);
 await act(async()=>frame().props.onLayout({nativeEvent:{layout:{width:361,height:754}}}));
 expect(button(tree,'Control key')).toBeDefined();expect(StyleSheet.flatten(header().props.style)?.display).toBeUndefined();
 expect(nativeView(tree)).toBe(view);expect(NativeModules.BobTerminal.prepare).toHaveBeenCalledTimes(1);
 expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});
