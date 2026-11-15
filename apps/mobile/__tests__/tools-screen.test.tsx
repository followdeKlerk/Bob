jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Modal,ScrollView,StyleSheet,Text as NativeText} from 'react-native';
import {ToolsScreen,type ToolsScreenProps} from '../components/tools-screen';
import {ThemeContext,tokens} from '../theme-context';
import {TouchTarget} from '../components/touch-target';
import {SectionSegments} from '../components/section-ui';

const moduleItem=(id='coding',extra:Record<string,unknown>={})=>({id,name:`${id} tools`,packageName:`@bob-local/${id}`,version:'0.1.0',durable:'1.0.0',dependencies:{},requires:[],available:true,installed:true,registered:true,defaultSelected:true,selected:false,...extra});
const connection=(extra:Record<string,unknown>={})=>({id:'docs',endpoint:'https://docs.example/mcp',allowedTools:['lookup','read'],enabled:false,...extra});
const text=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType(NativeText).map(n=>React.Children.toArray(n.props.children).filter(child=>typeof child==='string'||typeof child==='number').join('')).join(' ');
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const selectPage=async(tree:Renderer.ReactTestRenderer,page:'modules'|'connections')=>{await act(async()=>tree.root.findByType(SectionSegments).props.onChange(page));};
const press=async(tree:Renderer.ReactTestRenderer,label:string)=>{
 // Exercise section navigation before an action, as a user would. Dedicated
 // selector tests below assert visibility and that switching itself does no IO.
 if(!button(tree,label)){
  if(/^(Add connection|Refresh connections|Retry connections|Details for connection )/.test(label))await selectPage(tree,'connections');
  else if(/^(Details for |Refresh modules|Retry modules)/.test(label))await selectPage(tree,'modules');
 }
 expect(button(tree,label)).toBeDefined();await act(async()=>button(tree,label).props.onPress());
};
const input=(tree:Renderer.ReactTestRenderer,label:string,value:string)=>act(()=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onChangeText==='function')[0].props.onChangeText(value));
const deferred=()=>{let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;const promise=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
let nextBackend=0;
function setup(options:{modules?:ReturnType<typeof moduleItem>[];connections?:ReturnType<typeof connection>[];props?:Partial<ToolsScreenProps>;request?:ToolsScreenProps['request']}={}){
 let modules=options.modules??[moduleItem()],connections=options.connections??[connection()];
 const request=jest.fn(options.request??(async(path:string,method='GET',body?:unknown)=>{
  if(method==='GET')return path==='mcp-connections'?connections:modules;
  if(path==='mcp-connections'){
   if(method==='PUT'){const next=body as ReturnType<typeof connection>;connections=[...connections.filter(item=>item.id!==next.id),next];return next;}
   connections=connections.filter(item=>item.id!==(body as {id:string}).id);return {removed:(body as {id:string}).id};
  }
  modules=modules.map(item=>({...item,selected:(body as {ids:string[]}).ids.includes(item.id)}));return modules;
 }));
 const props:ToolsScreenProps={backendId:`tools-test-${++nextBackend}`,workstationName:'Work PC',conversationId:7,conversationTitle:'My chat',scopeKey:'pc:epoch-1',active:true,readOnly:false,request,...options.props};
 return {request,props};
}
let trees:Renderer.ReactTestRenderer[]=[];
async function render(props:ToolsScreenProps){let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ToolsScreen {...props}/>);});trees.push(tree);return tree;}
afterEach(async()=>{await act(async()=>{for(const tree of trees)tree.unmount();});trees=[];jest.useRealTimers();});

test('compact catalog has independent sections, custom module fallback and tap-only details',async()=>{
 const {props,request}=setup({modules:[moduleItem(),moduleItem('new-custom',{name:'Team research'})]});const tree=await render(props);
 expect(request.mock.calls.map(call=>call[0])).toEqual(['chats/7/modules','mcp-connections']);
 expect(text(tree)).toContain('Team research');expect(text(tree)).toContain('My chat');expect(text(tree)).toContain('Work PC');
 expect(text(tree)).not.toContain('Package:');expect(text(tree)).not.toContain('sandboxed');
 await press(tree,'Details for Team research');expect(text(tree)).toContain('@bob-local/new-custom');expect(text(tree)).toContain('not sandboxed');
 await press(tree,'Details for connection docs');expect(text(tree)).toContain('Shared across chats');expect(text(tree)).toContain('Work PC');expect(text(tree)).toContain('2 allowed tools');expect(text(tree)).toContain('lookup, read');expect(text(tree)).toContain('not a health check');
 expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
});
test('no chat uses the workstation catalog, never invents per-chat off, and still manages connections',async()=>{
 const {props,request}=setup({props:{conversationId:undefined},modules:[moduleItem('coding',{selected:undefined})]});const tree=await render(props);
 expect(request.mock.calls[0][0]).toBe('modules');expect(text(tree)).toContain('Installed');expect(text(tree)).not.toContain('Off in this chat');
 await press(tree,'Details for Coding');expect(button(tree,'Turn on Coding')).toBeUndefined();await selectPage(tree,'connections');expect(button(tree,'Add connection')).toBeDefined();
});
test.each(['modules','connections'] as const)('%s load failure does not hide the other section and retries independently',async kind=>{
 let fail=true;const {props,request}=setup({request:async path=>{if(fail&&(kind==='modules'?path.includes('modules'):path==='mcp-connections'))throw Error('Offline');return path==='mcp-connections'?[connection()]:[moduleItem()];}});
 const tree=await render(props);await selectPage(tree,kind);expect(text(tree)).toContain(`${kind==='modules'?'Modules':'Connections'} could not be loaded.`);
 expect(text(tree)).not.toContain(kind==='modules'?'No modules':'No connections');await selectPage(tree,kind==='modules'?'connections':'modules');
 expect(button(tree,kind==='modules'?'Details for connection docs':'Details for Coding')).toBeDefined();
 fail=false;await press(tree,`Retry ${kind}`);
 expect(request).toHaveBeenCalledTimes(3);expect(text(tree)).not.toContain('could not be loaded');
});
test('malformed chat selection is an error, not unchecked success',async()=>{
 const {props}=setup({modules:[moduleItem('coding',{selected:undefined})]});const tree=await render(props);
 expect(text(tree)).toContain('Module status response is incomplete');expect(button(tree,'Details for Coding')).toBeUndefined();
});
test('request identity changes do not refetch; explicit refresh uses latest callback and active transition refreshes',async()=>{
 const {props,request}=setup();const tree=await render(props);const next=jest.fn(async(path:string)=>path==='mcp-connections'?[]:[moduleItem('extra')]);
 await act(async()=>tree.update(<ToolsScreen {...props} request={next}/>));expect(request).toHaveBeenCalledTimes(2);expect(next).not.toHaveBeenCalled();
 await press(tree,'Refresh modules');expect(next).toHaveBeenCalledTimes(1);expect(text(tree)).toContain('extra tools');
 await act(async()=>tree.update(<ToolsScreen {...props} request={next} active={false}/>));expect(tree.toJSON()).toBeNull();
 await act(async()=>tree.update(<ToolsScreen {...props} request={next} active/>));expect(next).toHaveBeenCalledTimes(3);
});
test('inactive initial view performs no request; scope changes discard drafts and old reads',async()=>{
 const slow=deferred();const {props,request}=setup({request:async path=>path==='mcp-connections'?slow.promise:[moduleItem()]});
 const tree=await render({...props,active:false});expect(request).not.toHaveBeenCalled();await act(async()=>tree.update(<ToolsScreen {...props}/>));
 const oldSignal=request.mock.calls[1][3];const newer=jest.fn(async(path:string)=>path==='mcp-connections'?[]:[moduleItem('new')]);
 await act(async()=>tree.update(<ToolsScreen {...props} scopeKey="new-epoch" request={newer}/>));expect(oldSignal?.aborted).toBe(true);
 await act(async()=>slow.resolve([connection({id:'stale'})]));expect(text(tree)).not.toContain('stale');
 await press(tree,'Add connection');input(tree,'Connection ID','draft');
 await act(async()=>tree.update(<ToolsScreen {...props} conversationId={8} scopeKey="new-epoch" request={newer}/>));expect(button(tree,'Review connection')).toBeUndefined();expect(newer.mock.calls.map(call=>call[0])).toContain('chats/8/modules');
});
test('chat selection requires confirmation and verified GET, never optimistic truth or workstation mutation',async()=>{
 const readback=deferred();let saved=false;const {props,request}=setup({request:async(path,method='GET')=>{if(path==='mcp-connections')return [];if(method==='PUT'){saved=true;return [moduleItem('coding',{selected:true})];}return saved?readback.promise:[moduleItem()];}});
 const tree=await render(props);await press(tree,'Details for Coding');await press(tree,'Turn on Coding');expect(request).toHaveBeenCalledTimes(2);
 await press(tree,'Cancel tool change');expect(request).toHaveBeenCalledTimes(2);
 await press(tree,'Turn on Coding');await press(tree,'Confirm tool change');expect(request.mock.calls[2]).toEqual(['chats/7/modules','PUT',{ids:['coding']}]);expect(text(tree)).not.toContain('Chat selection saved.');
 await act(async()=>readback.resolve([moduleItem('coding',{selected:true})]));expect(text(tree)).toContain('Chat selection saved.');expect(text(tree)).toContain('On in this chat');
});
test('dependency guards neither auto-enable requirements nor cascade disables',async()=>{
 const {props,request}=setup({modules:[moduleItem(),moduleItem('custom',{requires:['coding']})]});const tree=await render(props);
 await press(tree,'Details for custom tools');await press(tree,'Turn on custom tools');expect(text(tree)).toContain('Required modules: coding');expect(button(tree,'Confirm tool change')).toBeUndefined();expect(request).toHaveBeenCalledTimes(2);
 const next=setup({modules:[moduleItem('coding',{selected:true}),moduleItem('custom',{selected:true,requires:['coding']})]});
 await act(async()=>tree.update(<ToolsScreen {...next.props} scopeKey="other"/>));await press(tree,'Details for Coding');await press(tree,'Turn off Coding');expect(text(tree)).toContain('Required modules: coding');expect(next.request).toHaveBeenCalledTimes(2);
});
test('busy backend rejection requires explicit reconciliation, never stops work or retries mutation',async()=>{
 const {props,request}=setup({request:async(path,method='GET')=>{if(method!=='GET')throw Error('Stop and settle this conversation and its background work before changing modules');return path==='mcp-connections'?[]:[moduleItem()];}});
 const tree=await render(props);await press(tree,'Details for Coding');await press(tree,'Turn on Coding');await press(tree,'Confirm tool change');
 expect(text(tree)).toContain('Not confirmed saved. Refresh');expect(text(tree)).toContain('Stop and settle');expect(button(tree,'Turn on Coding').props.disabled).toBe(true);
 await press(tree,'Turn on Coding');expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
 await press(tree,'Refresh modules');expect(button(tree,'Turn on Coding').props.disabled).toBe(false);expect(request.mock.calls.every(call=>call[0].includes('modules')||call[0]==='mcp-connections')).toBe(true);
});
test.each(['hidden','unmounted','scope','readOnly'] as const)('confirmation callback is fenced after %s',async change=>{
 const {props,request}=setup();const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Enable docs');const callback=button(tree,'Confirm tool change').props.onPress;
 await act(async()=>{if(change==='unmounted')tree.unmount();else tree.update(<ToolsScreen {...props} active={change!=='hidden'} scopeKey={change==='scope'?'new':props.scopeKey} readOnly={change==='readOnly'}/>);});
 await act(async()=>callback());expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(0);
});
test('cancelled confirmation cannot be submitted by a retained callback; double taps submit only once',async()=>{
 const write=deferred();const {props,request}=setup({request:async(path,method='GET')=>method==='PUT'?write.promise:path==='mcp-connections'?[connection()]:[moduleItem()]});const tree=await render(props);
 await press(tree,'Details for connection docs');await press(tree,'Enable docs');const stale=button(tree,'Confirm tool change').props.onPress;await press(tree,'Cancel tool change');await act(async()=>stale());expect(request).toHaveBeenCalledTimes(2);
 await press(tree,'Enable docs');const submit=button(tree,'Confirm tool change').props.onPress;await act(async()=>{submit();submit();});expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
 await act(async()=>write.reject(Error('Connection lost')));expect(text(tree)).toContain('Not confirmed saved.');
});
test('read-only conversation can inspect but cannot edit or start setup',async()=>{
 const onAskBob=jest.fn();const {props}=setup({props:{readOnly:true,onAskBob}});const tree=await render(props);await press(tree,'Details for Coding');await press(tree,'Details for connection docs');await press(tree,'Adding tools');
 for(const label of ['Turn on Coding','Add connection','Edit docs','Enable docs','Remove docs','Ask Bob about adding tools'])expect(button(tree,label)).toBeUndefined();expect(text(tree)).toContain('View only');
});
test('new connections start disabled, save the whole object and verify workstation readback',async()=>{
 const {props,request}=setup();const tree=await render(props);await press(tree,'Add connection');input(tree,'Connection ID','research');input(tree,'HTTPS endpoint','https://research.example/mcp');input(tree,'Exact allowed tool names','search\nread');
 await press(tree,'Review connection');expect(text(tree)).toContain('Allow only these exact tools: search, read');await press(tree,'Confirm tool change');
 expect(request.mock.calls.find(call=>call[1]==='PUT')).toEqual(['mcp-connections','PUT',{id:'research',endpoint:'https://research.example/mcp',allowedTools:['search','read'],enabled:false}]);
 expect(text(tree)).toContain('Connection change saved.');expect(button(tree,'Details for connection research')).toBeDefined();expect(button(tree,'Review connection')).toBeUndefined();
});
test.each([
 ['Connection ID','docs','already exists'],['Connection ID','bad ID','lowercase ID'],
 ['HTTPS endpoint','http://localhost/mcp','Use HTTPS'],['HTTPS endpoint','relative/path','absolute HTTPS'],
 ['HTTPS endpoint','https://user:pass@example.com/mcp','Use HTTPS'],['HTTPS endpoint','https://example.com/mcp?key=secret','Use HTTPS'],['HTTPS endpoint','https://example.com/mcp#secret','Use HTTPS'],
 ['Exact allowed tool names','*','no wildcards'],['Exact allowed tool names','','exact tool names'],['Exact allowed tool names','read,read','duplicate tool names'],['Exact allowed tool names','read write','exact tool names'],
])('validation rejects %s = %s without a write',async(label,value,error)=>{
 const {props,request}=setup();const tree=await render(props);await press(tree,'Add connection');input(tree,'Connection ID','new');input(tree,'HTTPS endpoint','https://example.com/mcp');input(tree,'Exact allowed tool names','read');input(tree,label,value);
 await press(tree,'Review connection');expect(text(tree)).toContain(error);expect(button(tree,'Confirm tool change')).toBeUndefined();expect(request).toHaveBeenCalledTimes(2);
});
test('editing endpoint warns about cleared credentials and expanded exact grants',async()=>{
 const {props,request}=setup();const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Edit docs');expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Connection ID')[0].props.editable).toBe(false);
 input(tree,'HTTPS endpoint','https://new.example/mcp');input(tree,'Exact allowed tool names','lookup\nwrite');await press(tree,'Review connection');expect(text(tree)).toContain('clears the stored credential');expect(text(tree)).toContain('lookup, write');await press(tree,'Confirm tool change');
 expect(request.mock.calls.find(call=>call[1]==='PUT')?.[2]).toEqual({id:'docs',endpoint:'https://new.example/mcp',allowedTools:['lookup','write'],enabled:false});
});
test('enable, disable and remove are explicit confirmed workstation mutations',async()=>{
 const {props,request}=setup();const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Enable docs');expect(text(tree)).toContain('does not test credentials');await press(tree,'Confirm tool change');expect(button(tree,'Disable docs')).toBeDefined();
 await press(tree,'Disable docs');await press(tree,'Confirm tool change');expect(button(tree,'Enable docs')).toBeDefined();await press(tree,'Remove docs');await press(tree,'Cancel tool change');expect(request.mock.calls.filter(call=>call[1]==='DELETE')).toHaveLength(0);
 await press(tree,'Remove docs');await press(tree,'Confirm tool change');expect(request.mock.calls.find(call=>call[1]==='DELETE')).toEqual(['mcp-connections','DELETE',{id:'docs'}]);expect(text(tree)).toContain('No connections yet.');
});
test('mismatched readback is not saved, and failed refresh cannot unlock resubmission',async()=>{
 let failRead=false;const {props,request}=setup({request:async(path,method='GET')=>{if(method==='PUT')return {};if(failRead&&path==='mcp-connections')throw Error('Offline');return path==='mcp-connections'?[connection()]:[moduleItem()];}});
 const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Enable docs');await press(tree,'Confirm tool change');expect(text(tree)).toContain('Readback did not verify');expect(button(tree,'Enable docs')).toBeUndefined();expect(button(tree,'Add connection').props.disabled).toBe(true);
 failRead=true;await press(tree,'Retry connections');expect(text(tree)).toContain('Connections could not be loaded.');expect(button(tree,'Add connection').props.disabled).toBe(true);expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
});
test('reads time out independently and late results cannot replace error; unmount aborts observers',async()=>{
 jest.useFakeTimers();const slow=deferred();const {props,request}=setup({request:async path=>path==='mcp-connections'?slow.promise:[moduleItem()]});const tree=await render(props);
 await act(async()=>jest.advanceTimersByTime(15001));expect(button(tree,'Details for Coding')).toBeDefined();await selectPage(tree,'connections');expect(text(tree)).toContain('Connections could not be loaded.');expect(request.mock.calls[1][3]?.aborted).toBe(true);
 await act(async()=>slow.resolve([connection()]));expect(button(tree,'Details for connection docs')).toBeUndefined();
});
test('unknown write timeout blocks repeat submissions until explicit refresh',async()=>{
 jest.useFakeTimers();const slow=deferred();const {props,request}=setup({request:async(path,method='GET')=>method==='PUT'?slow.promise:path==='mcp-connections'?[connection()]:[moduleItem()]});const tree=await render(props);
 await press(tree,'Details for connection docs');await press(tree,'Enable docs');await press(tree,'Confirm tool change');await act(async()=>jest.advanceTimersByTime(20001));expect(text(tree)).toContain('result is unknown');expect(button(tree,'Enable docs').props.disabled).toBe(true);expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);await act(async()=>slow.resolve({}));expect(text(tree)).not.toContain('Connection change saved.');
});
test('late mutation after hide performs no readback and never restores a form in a new scope',async()=>{
 const slow=deferred();const {props,request}=setup({request:async(path,method='GET')=>method==='PUT'?slow.promise:path==='mcp-connections'?[connection()]:[moduleItem()]});const tree=await render(props);
 await press(tree,'Details for connection docs');await press(tree,'Enable docs');await press(tree,'Confirm tool change');await act(async()=>tree.update(<ToolsScreen {...props} active={false}/>));await act(async()=>slow.resolve({}));expect(request).toHaveBeenCalledTimes(3);
 await act(async()=>tree.update(<ToolsScreen {...props} scopeKey="new"/>));expect(text(tree)).not.toContain('saved');expect(button(tree,'Review connection')).toBeUndefined();
});
test('setup callback only follows optional help and an explicit tap, and is fenced when hidden',async()=>{
 const onAskBob=jest.fn();const {props,request}=setup({props:{onAskBob}});const tree=await render(props);expect(button(tree,'Ask Bob about adding tools')).toBeUndefined();await press(tree,'Adding tools');expect(onAskBob).not.toHaveBeenCalled();const callback=button(tree,'Ask Bob about adding tools').props.onPress;await press(tree,'Ask Bob about adding tools');expect(onAskBob).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(2);
 await act(async()=>tree.update(<ToolsScreen {...props} active={false}/>));await act(async()=>callback());expect(onAskBob).toHaveBeenCalledTimes(1);
});
test.each(['light','dark'] as const)('%s cards and form use theme colors, 48px targets, wrapping scalable text and no nested scroll',async scheme=>{
 const {props}=setup();let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><ToolsScreen {...props}/></ThemeContext.Provider>);});trees.push(tree);
 await press(tree,'Add connection');expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
 for(const target of tree.root.findAllByType(TouchTarget))expect(StyleSheet.flatten(target.props.style).minHeight).toBeGreaterThanOrEqual(48);
 for(const node of tree.root.findAllByType(NativeText)){expect(node.props.allowFontScaling).not.toBe(false);expect(node.props.adjustsFontSizeToFit).not.toBe(true);// Only secondary endpoint/description summaries may be bounded; titles,
  // permissions, failures and confirmation text remain fully scalable.
  if(node.props.numberOfLines!==undefined)expect(node.props.numberOfLines).toBe(2);}
 await selectPage(tree,'modules');const row=button(tree,'Details for Coding');expect(StyleSheet.flatten(row.props.style).height).toBeUndefined();expect(StyleSheet.flatten(tree.root.findByProps({testID:'tools-screen'}).props.style).minWidth).toBe(0);
});
test('new ID is checked again before PUT so a connection added during editing is not overwritten',async()=>{
 let added=false;const {props,request}=setup({request:async path=>path==='mcp-connections'?(added?[connection({id:'new'})]:[]):[moduleItem()]});const tree=await render(props);
 await press(tree,'Add connection');input(tree,'Connection ID','new');input(tree,'HTTPS endpoint','https://other.example/mcp');input(tree,'Exact allowed tool names','read');await press(tree,'Review connection');added=true;await press(tree,'Confirm tool change');
 expect(text(tree)).toContain('ID now exists; no write was sent');expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(0);
});
test('module changes preserve unrelated selections and confirmation stays beside the tapped details',async()=>{
 const {props,request}=setup({modules:[moduleItem(),moduleItem('web',{selected:true})]});const tree=await render(props);await press(tree,'Details for Coding');await press(tree,'Turn on Coding');
 const confirm=tree.root.findByProps({testID:'tools-confirmation'});expect(confirm.parent?.findAll(n=>n.props.accessibilityLabel==='Turn on Coding').length).toBeGreaterThan(0);
 await press(tree,'Confirm tool change');expect(request.mock.calls.find(call=>call[1]==='PUT')?.[2]).toEqual({ids:['web','coding']});
});
test('unavailable or uninstalled modules cannot be selected, but details stay readable',async()=>{
 const {props,request}=setup({modules:[moduleItem('coding',{installed:false,registered:false,available:false})]});const tree=await render(props);await press(tree,'Details for Coding');expect(button(tree,'Turn on Coding').props.disabled).toBe(true);expect(text(tree)).toContain('Installed: No');await press(tree,'Turn on Coding');expect(request).toHaveBeenCalledTimes(2);
});
test('legacy loopback connection may be disabled but not enabled from the phone',async()=>{
 const {props,request}=setup({connections:[connection({endpoint:'http://localhost:8080/mcp',enabled:true})]});const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Disable docs');await press(tree,'Confirm tool change');expect(text(tree)).toContain('Connection change saved.');
 await press(tree,'Enable docs');expect(text(tree)).toContain('Use HTTPS');expect(button(tree,'Confirm tool change')).toBeUndefined();expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
});
test('hidden pending reads are aborted, including a transport that ignores cancellation',async()=>{
 const slow=deferred();const {props,request}=setup({request:async()=>slow.promise});const tree=await render(props);expect(text(tree)).toContain('Loading modules');await selectPage(tree,'connections');expect(text(tree)).toContain('Loading connections');
 await act(async()=>tree.update(<ToolsScreen {...props} active={false}/>));expect(request.mock.calls.every(call=>call[3]?.aborted)).toBe(true);await act(async()=>slow.resolve([]));expect(tree.toJSON()).toBeNull();
});
test.each(['active','readOnly'] as const)('stale Add and setup callbacks stay fenced after a full %s round trip',async transition=>{
 const onAskBob=jest.fn();const {props,request}=setup({props:{onAskBob}});const tree=await render(props);
 await selectPage(tree,'connections');const add=button(tree,'Add connection').props.onPress;await press(tree,'Adding tools');const ask=button(tree,'Ask Bob about adding tools').props.onPress;
 await act(async()=>tree.update(<ToolsScreen {...props} active={transition!=='active'} readOnly={transition==='readOnly'}/>));
 await act(async()=>{add();ask();});expect(onAskBob).not.toHaveBeenCalled();
 await act(async()=>tree.update(<ToolsScreen {...props}/>));await act(async()=>{add();ask();});
 expect(button(tree,'Review connection')).toBeUndefined();expect(button(tree,'Ask Bob about adding tools')).toBeUndefined();expect(onAskBob).not.toHaveBeenCalled();
 await press(tree,'Add connection');expect(button(tree,'Review connection')).toBeDefined();expect(request.mock.calls.every(call=>call[1]==='GET')).toBe(true);
});
test('unknown profile is inspect-only until writable, then reverting to read-only cancels edits and confirmations',async()=>{
 const onAskBob=jest.fn();const {props,request}=setup({props:{onAskBob}});const tree=await render({...props,readOnly:true});
 expect(button(tree,'Add connection')).toBeUndefined();await press(tree,'Details for Coding');expect(button(tree,'Turn on Coding')).toBeUndefined();
 await act(async()=>tree.update(<ToolsScreen {...props}/>));await press(tree,'Add connection');input(tree,'Connection ID','draft');input(tree,'HTTPS endpoint','https://example.com/mcp');input(tree,'Exact allowed tool names','read');await press(tree,'Review connection');const confirm=button(tree,'Confirm tool change').props.onPress;
 await act(async()=>tree.update(<ToolsScreen {...props} readOnly/>));await act(async()=>confirm());expect(button(tree,'Review connection')).toBeUndefined();expect(button(tree,'Confirm tool change')).toBeUndefined();
 expect(request.mock.calls.filter(call=>call[1]!=='GET')).toHaveLength(0);expect(onAskBob).not.toHaveBeenCalled();
});
test.each(['empty','missing-selection'] as const)('incomplete %s module readback never confirms an all-off save',async incomplete=>{
 let wrote=false;const {props,request}=setup({request:async(path,method='GET')=>{
  if(path==='mcp-connections')return [];
  if(method==='PUT'){wrote=true;return [moduleItem('coding',{selected:false})];}
  return wrote?(incomplete==='empty'?[]:[moduleItem('coding',{selected:undefined})]):[moduleItem('coding',{selected:true})];
 }});const tree=await render(props);await press(tree,'Details for Coding');await press(tree,'Turn off Coding');await press(tree,'Confirm tool change');
 expect(text(tree)).not.toContain('Chat selection saved.');expect(text(tree)).not.toContain('No modules in this workstation catalog.');expect(text(tree)).toContain('Not confirmed saved.');expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
});
test('an unknown save is reconciled by read only; retry requires another explicit confirmation',async()=>{
 let wrote=false;const {props,request}=setup({request:async(path,method='GET')=>{
  if(method==='PUT'){wrote=true;throw Error('Network response lost');}
  return path==='mcp-connections'?[connection({enabled:wrote})]:[moduleItem()];
 }});const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Enable docs');await press(tree,'Confirm tool change');expect(text(tree)).toContain('Not confirmed saved.');
 await press(tree,'Refresh connections');expect(button(tree,'Disable docs').props.disabled).toBe(false);expect(text(tree)).not.toContain('Connection change saved.');expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
 await press(tree,'Disable docs');expect(button(tree,'Confirm tool change')).toBeDefined();expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
});
test('top selectors expose Connections directly, retain independent reads and show workstation alias in both modes',async()=>{
 const {props,request}=setup({modules:['coding','resources','subagents','web','interactive','peers','memory'].map(id=>moduleItem(id)),props:{workstationName:'Studio laptop'}});const tree=await render(props);
 expect(tree.root.findAllByProps({testID:'tools-modules'})).not.toHaveLength(0);expect(tree.root.findAllByProps({testID:'tools-connections'})).toHaveLength(0);expect(text(tree)).toContain('Studio laptop');
 await press(tree,'Connections');expect(tree.root.findAllByProps({testID:'tools-modules'})).toHaveLength(0);expect(button(tree,'Details for connection docs')).toBeDefined();expect(text(tree)).toContain('Studio laptop');expect(text(tree)).not.toContain('Read, edit and run code.');
 await press(tree,'Modules');expect(button(tree,'Details for Coding')).toBeDefined();expect(button(tree,'Details for connection docs')).toBeUndefined();expect(request).toHaveBeenCalledTimes(2);expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
});
test('technical custom identity has a readable title and uninstalled description stays neutral',async()=>{
 const {props}=setup({modules:[moduleItem('greeting',{name:'example.greeting',installed:false,registered:false})]});const tree=await render(props);
 expect(button(tree,'Details for Example greeting')).toBeDefined();expect(text(tree)).not.toContain('example.greeting');expect(text(tree)).not.toContain('installed by');expect(text(tree)).toContain('Custom tools for this workstation.');
 await press(tree,'Details for Example greeting');expect(text(tree)).toContain('ID: greeting');expect(text(tree)).toContain('Extension: example.greeting');expect(text(tree)).toContain('Installed: No');
});
test('Resources reflects composition and installation/default guidance is optional detail only',async()=>{
 const {props}=setup({modules:[moduleItem('resources')]});const tree=await render(props);expect(text(tree)).toContain('Use skills, notes and prompt guidance.');expect(text(tree)).not.toContain('installation and defaults');
 await press(tree,'Details for Resources');expect(text(tree)).toContain('Workstation installation and defaults are managed separately');expect(text(tree)).toContain('Chat selections do not change those defaults');
});
test.each([
 [{selected:false},'Interactive tools are off in this chat.'],
 [{selected:true,registered:false},'Interactive tools are unavailable in this chat.'],
 [{selected:true,available:false},'Interactive tools are unavailable in this chat.'],
 [{selected:true},undefined],
])('Connections gives conditional chat availability guidance for %j',async(extra,expected)=>{
 const {props}=setup({modules:[moduleItem('interactive',extra)]});const tree=await render(props);expect(text(tree)).not.toContain('Interactive tools are off');await press(tree,'Connections');
 if(expected)expect(text(tree)).toContain(expected);else expect(text(tree)).not.toMatch(/Interactive tools are (off|unavailable)/);
 expect(button(tree,'Add connection').props.disabled).toBe(false);
});
test('unknown module status and no-chat catalog never pretend interactive is off or unavailable',async()=>{
 const {props}=setup({request:async path=>{if(path==='mcp-connections')return [];throw Error('Offline');}});const tree=await render(props);await press(tree,'Connections');expect(text(tree)).not.toMatch(/Interactive tools are (off|unavailable)/);
 const next=setup({props:{conversationId:undefined}});await act(async()=>tree.update(<ToolsScreen {...next.props}/>));await press(tree,'Connections');expect(text(tree)).not.toMatch(/Interactive tools are (off|unavailable)/);
});
test('page switches fence stale confirmation, Add and setup callbacks without losing read state',async()=>{
 const onAskBob=jest.fn();const {props,request}=setup({props:{onAskBob}});const tree=await render(props);await press(tree,'Connections');const add=button(tree,'Add connection').props.onPress;await press(tree,'Adding tools');const ask=button(tree,'Ask Bob about adding tools').props.onPress;
 await press(tree,'Details for connection docs');await press(tree,'Enable docs');const confirm=button(tree,'Confirm tool change').props.onPress;
 await press(tree,'Modules');await act(async()=>{confirm();add();ask();});await press(tree,'Connections');await act(async()=>{confirm();add();ask();});
 expect(button(tree,'Confirm tool change')).toBeUndefined();expect(button(tree,'Review connection')).toBeUndefined();expect(onAskBob).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(2);
 await press(tree,'Add connection');expect(button(tree,'Review connection')).toBeDefined();
});
test('switching pages while new-connection preflight reads cannot submit from the hidden editor',async()=>{
 const preflight=deferred();let reads=0;const {props,request}=setup({request:async(path,method='GET')=>{
  if(path==='mcp-connections'&&method==='GET')return ++reads===1?[]:preflight.promise;
  return [moduleItem()];
 }});const tree=await render(props);await press(tree,'Add connection');input(tree,'Connection ID','new');input(tree,'HTTPS endpoint','https://example.com/mcp');input(tree,'Exact allowed tool names','read');await press(tree,'Review connection');await press(tree,'Confirm tool change');await press(tree,'Modules');await act(async()=>preflight.resolve([]));expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(0);
});
test.each(['constructor','toString'])('inherited registry name %s renders a generic custom module card',async id=>{
 const {props}=setup({modules:[moduleItem(id,{name:'example.inherited'})]});const tree=await render(props);
 expect(button(tree,'Details for Example inherited')).toBeDefined();expect(text(tree)).toContain('Custom tools for this workstation.');
 await press(tree,'Details for Example inherited');expect(text(tree)).toContain(`ID: ${id}`);expect(text(tree)).toContain('Extension: example.inherited');
});
test.each(['resolve','reject'] as const)('timed-out pending write survives refresh and late raw %s still needs a fresh ordered reconciliation',async outcome=>{
 jest.useFakeTimers();const raw=deferred(),oldRead=deferred();let writes=0,readMode:'normal'|'held'|'fail'='normal',enabled=false;
 const {props,request}=setup({request:async(path,method='GET')=>{
  if(path!=='mcp-connections')return [moduleItem()];
  if(method==='PUT'){if(++writes===1)return raw.promise;enabled=true;return {};}
  if(readMode==='held')return oldRead.promise;if(readMode==='fail')throw Error('Offline');return [connection({enabled})];
 }});const tree=await render(props);await press(tree,'Details for connection docs');await press(tree,'Enable docs');await press(tree,'Confirm tool change');
 await act(async()=>jest.advanceTimersByTime(20001));expect(text(tree)).toContain('still pending');await press(tree,'Refresh connections');expect(button(tree,'Enable docs').props.disabled).toBe(true);
 await press(tree,'Enable docs');expect(button(tree,'Confirm tool change')).toBeUndefined();expect(writes).toBe(1);
 readMode='held';await press(tree,'Refresh connections');await act(async()=>{if(outcome==='resolve')raw.resolve({});else raw.reject(Error('Late transport failure'));});
 await act(async()=>oldRead.resolve([connection()]));expect(text(tree)).toContain('outcome is not confirmed');expect(button(tree,'Enable docs').props.disabled).toBe(true);expect(text(tree)).not.toContain('Connection change saved.');
 readMode='fail';await press(tree,'Refresh connections');expect(button(tree,'Add connection').props.disabled).toBe(true);
 readMode='normal';await press(tree,'Retry connections');expect(button(tree,'Enable docs').props.disabled).toBe(false);expect(writes).toBe(1);
 await press(tree,'Enable docs');expect(writes).toBe(1);await press(tree,'Confirm tool change');expect(writes).toBe(2);expect(text(tree)).toContain('Connection change saved.');expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(2);
});
test.each(['hide','unmount','credentials','readOnly'] as const)('pending ownership survives %s and reopening the same backend',async transition=>{
 jest.useFakeTimers();const raw=deferred();const {props,request}=setup({request:async(path,method='GET')=>method==='PUT'?raw.promise:path==='mcp-connections'?[connection()]:[moduleItem()]});let tree=await render(props);
 await press(tree,'Details for connection docs');await press(tree,'Enable docs');await press(tree,'Confirm tool change');
 if(transition==='unmount'){await act(async()=>tree.unmount());tree=await render(props);}
 else if(transition==='credentials')await act(async()=>tree.update(<ToolsScreen {...props} scopeKey="new-credentials"/>));
 else{await act(async()=>tree.update(<ToolsScreen {...props} active={transition!=='hide'} readOnly={transition==='readOnly'}/>));await act(async()=>tree.update(<ToolsScreen {...props}/>));}
 await press(tree,'Details for connection docs');expect(button(tree,'Enable docs').props.disabled).toBe(true);expect(text(tree)).toContain('still pending');
 await act(async()=>jest.advanceTimersByTime(20001));await press(tree,'Refresh connections');expect(button(tree,'Enable docs').props.disabled).toBe(true);expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
 await act(async()=>raw.resolve({}));expect(button(tree,'Enable docs').props.disabled).toBe(true);await press(tree,'Refresh connections');expect(button(tree,'Enable docs').props.disabled).toBe(false);
});
test('two retained chats share connection admission, including confirmations prepared before another host submits',async()=>{
 const raw=deferred();const {props,request}=setup({request:async(path,method='GET')=>method==='PUT'?raw.promise:path==='mcp-connections'?[connection()]:[moduleItem()]});const first=await render(props),second=await render({...props,conversationId:8,scopeKey:'second-chat'});
 for(const tree of [first,second]){await press(tree,'Details for connection docs');await press(tree,'Enable docs');}
 const staleConfirm=button(second,'Confirm tool change').props.onPress;await press(first,'Confirm tool change');await act(async()=>staleConfirm());
 expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);expect(button(second,'Enable docs').props.disabled).toBe(true);expect(text(second)).toContain('still pending');await act(async()=>raw.resolve({}));
});
test('a connection write does not block other backends or this backend\'s module selection',async()=>{
 const raw=deferred();let selected=false;const {props,request}=setup({request:async(path,method='GET')=>{
  if(path==='mcp-connections')return method==='PUT'?raw.promise:[connection()];
  if(method==='PUT')selected=true;return [moduleItem('coding',{selected})];
 }});const first=await render(props);await press(first,'Details for connection docs');await press(first,'Enable docs');await press(first,'Confirm tool change');
 await press(first,'Details for Coding');expect(button(first,'Turn on Coding').props.disabled).toBe(false);await press(first,'Turn on Coding');await press(first,'Confirm tool change');expect(text(first)).toContain('Chat selection saved.');
 const other=setup();const second=await render(other.props);await press(second,'Details for connection docs');await press(second,'Enable docs');await press(second,'Confirm tool change');expect(text(second)).toContain('Connection change saved.');
 expect(request.mock.calls.filter(call=>call[0]==='mcp-connections'&&call[1]==='PUT')).toHaveLength(1);await act(async()=>raw.resolve({}));
});
test('module admission is shared for the same backend/chat but independent for another chat',async()=>{
 const raw=deferred();let otherSelected=false;const {props,request}=setup({request:async(path,method='GET')=>{
  if(path==='mcp-connections')return [];
  if(path==='chats/7/modules')return method==='PUT'?raw.promise:[moduleItem()];
  if(method==='PUT')otherSelected=true;return [moduleItem('coding',{selected:otherSelected})];
 }});const first=await render(props),same=await render({...props,scopeKey:'credential-other'}),other=await render({...props,conversationId:8});
 await press(first,'Details for Coding');await press(first,'Turn on Coding');await press(first,'Confirm tool change');
 await press(same,'Details for Coding');expect(button(same,'Turn on Coding').props.disabled).toBe(true);
 await press(other,'Details for Coding');expect(button(other,'Turn on Coding').props.disabled).toBe(false);await press(other,'Turn on Coding');await press(other,'Confirm tool change');expect(text(other)).toContain('Chat selection saved.');
 expect(request.mock.calls.filter(call=>call[0]==='chats/7/modules'&&call[1]==='PUT')).toHaveLength(1);await act(async()=>raw.resolve({}));
});
test('a GET begun before a newer write cannot authorize stale controls in another retained host',async()=>{
 const oldRead=deferred();let gets=0,enabled=false;const {props,request}=setup({request:async(path,method='GET')=>{
  if(path!=='mcp-connections')return [moduleItem()];
  if(method==='PUT'){enabled=true;return {};}
  if(++gets===2)return oldRead.promise;return [connection({enabled})];
 }});const first=await render(props),second=await render({...props,conversationId:8});await press(first,'Details for connection docs');await press(first,'Enable docs');await press(first,'Confirm tool change');expect(text(first)).toContain('Connection change saved.');
 await act(async()=>oldRead.resolve([connection()]));await press(second,'Details for connection docs');expect(button(second,'Enable docs').props.disabled).toBe(true);expect(text(second)).toContain('latest configuration');
 await press(second,'Refresh connections');expect(button(second,'Disable docs').props.disabled).toBe(false);expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(1);
});
test('failed Add preflight releases admission without claiming an uncertain committed write',async()=>{
 let reads=0;const {props,request}=setup({request:async(path)=>{
  if(path!=='mcp-connections')return [moduleItem()];if(++reads===2)throw Error('Preflight offline');return [];
 }});const tree=await render(props);await press(tree,'Add connection');input(tree,'Connection ID','new');input(tree,'HTTPS endpoint','https://example.com/mcp');input(tree,'Exact allowed tool names','read');await press(tree,'Review connection');await press(tree,'Confirm tool change');
 expect(text(tree)).toContain('No change was sent.');expect(text(tree)).not.toContain('Not confirmed saved.');expect(text(tree)).not.toContain('still pending');expect(request.mock.calls.filter(call=>call[1]==='PUT')).toHaveLength(0);
 const other=await render({...props,conversationId:8});await press(other,'Connections');expect(button(other,'Add connection').props.disabled).toBe(false);
});

test.each(['light','dark'] as const)('%s integration lists use one rounded group, inset separators and honest bounded summaries without clamping titles',async scheme=>{
 const longTitle='An intentionally long custom extension name that must remain readable';
 const longId='a-connection-with-a-long-server-name-for-wrapping';
 const endpoint='https://docs.example/a/long/service/path/that/is/fully/available/in/details';
 const {props,request}=setup({modules:[moduleItem('custom',{name:longTitle,selected:true}),moduleItem('missing',{installed:false,registered:false,available:false})],connections:[connection({id:longId,endpoint,enabled:true}),connection({id:'second'})]});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><ToolsScreen {...props}/></ThemeContext.Provider>);});trees.push(tree);
 const list=tree.root.findByProps({testID:'tools-module-list'});
 expect(StyleSheet.flatten(list.props.style)).toMatchObject({backgroundColor:tokens[scheme].colors.panel,borderRadius:24});
 expect(StyleSheet.flatten(list.props.style).borderWidth).toBeUndefined();
 const row=button(tree,`Details for ${longTitle}`);
 expect(StyleSheet.flatten(row.props.style)).toMatchObject({minWidth:48,minHeight:80});
 expect(StyleSheet.flatten(row.parent!.props.style).borderWidth).toBeUndefined();
 const title=row.findAllByType(NativeText).find(node=>node.props.children===longTitle)!;
 expect(title.props.numberOfLines).toBeUndefined();expect(title.props.allowFontScaling).not.toBe(false);
 expect(text(tree)).toContain('2 · 1 on');expect(text(tree)).toContain('Not installed · Not registered · Unavailable');
 const separators=list.findAll(node=>node.props.testID==='tools-row-separator'&&typeof node.type==='string');expect(separators).toHaveLength(1);
 expect(StyleSheet.flatten(separators[0].props.style)).toMatchObject({marginHorizontal:16,height:StyleSheet.hairlineWidth});
 await selectPage(tree,'connections');
 expect(text(tree)).toContain('availability is not tested here');expect(text(tree)).toContain('2 · 1 enabled');expect(text(tree)).toContain('HTTPS');
 const server=button(tree,`Details for connection ${longId}`);
 expect(server.findAllByType(NativeText).find(node=>node.props.children===longId)!.props.numberOfLines).toBeUndefined();
 const summary=server.findAllByType(NativeText).find(node=>node.props.children==='docs.example/a/long/service/path/that/is/fully/available/in/details')!;
 expect(summary.props.numberOfLines).toBe(2);
 await press(tree,`Details for connection ${longId}`);expect(text(tree)).toContain(`Endpoint: ${endpoint}`);expect(text(tree)).toContain('Credentials are not shown here');
 const detail=tree.root.findAllByType(NativeText).find(node=>typeof node.props.children==='string'&&node.props.children.startsWith('Endpoint:'))!;
 expect(detail.props.numberOfLines).toBeUndefined();
 // Disclosure remains inspect-only; status capsules are not bypass toggles.
 expect(request.mock.calls.every(call=>call[1]==='GET')).toBe(true);
});
