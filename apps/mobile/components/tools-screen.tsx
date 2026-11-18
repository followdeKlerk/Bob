import React,{useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {StyleSheet,View} from 'react-native';
import {Boxes,Code,BookOpen,Users,Globe,PanelsTopLeft,Network,Brain,Plug,ChevronDown,type LucideIcon} from 'lucide-react-native';
import {ModuleInfo,McpConnection} from '../../../src/contracts';
import {Text,TextInput} from './app-text';
import {TouchTarget} from './touch-target';
import {SectionAction,SectionSegments} from './section-ui';
import {themed,useTheme,useThemedValue} from '../theme';
import {toolsMutationOwner,type ToolsMutationOwner} from '../tools-mutations';

type Module=ReturnType<typeof ModuleInfo.parse>;
type Connection=ReturnType<typeof McpConnection.parse>;
/** Presentation only: one transport scope, at most its two catalog resources.
 * No cached revision may authorize a write; every visit still reads the backend. */
export class ToolsPresentationCache {
 private scope='';private items=new Map<string,unknown>();
 forScope(scope:string){if(this.scope!==scope){this.scope=scope;this.items=new Map();}return this.items;}
}
export type ToolsScreenProps={
 presentation?:ToolsPresentationCache;
 backendId:string;workstationName:string;conversationId?:number;conversationTitle?:string;
 scopeKey:string;active:boolean;readOnly:boolean;
 request:(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<unknown>;
 onAskBob?:()=>void;
};
const descriptions:Record<string,{title:string;description:string;icon:LucideIcon}>={
 coding:{title:'Coding',description:'Read, edit and run code.',icon:Code},
 resources:{title:'Resources',description:'Use skills, notes and prompt guidance.',icon:BookOpen},
 subagents:{title:'Helpers',description:'Delegate work to helper agents.',icon:Users},
 web:{title:'Web',description:'Search and read the web.',icon:Globe},
 interactive:{title:'Interactive tools',description:'Use interactive views and connected tools.',icon:PanelsTopLeft},
 peers:{title:'Peers',description:'Collaborate with connected Bob workstations.',icon:Network},
 memory:{title:'Memory',description:'Keep useful context across conversations.',icon:Brain},
};
function customTitle(value:string){
 const name=value.trim();
 if(/\s/.test(name)&&!/[._/@:-]/.test(name))return name;
 const words=name.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[._/@:-]+/g,' ').trim();
 return words?words[0].toLocaleUpperCase()+words.slice(1):'Custom tools';
}
const presentation=(item:Module)=>Object.prototype.hasOwnProperty.call(descriptions,item.id)?descriptions[item.id]:{title:customTitle(item.name||item.id),description:'Custom tools for this workstation.',icon:Boxes};
const errorText=(error:unknown)=>error instanceof Error?error.message:'Request failed. Please refresh.';
const sameIds=(a:string[],b:string[])=>a.length===b.length&&a.every(id=>b.includes(id));
function timed<T>(promise:Promise<T>,milliseconds:number,onTimeout?:()=>void,signal?:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(Error('Read cancelled.'));};
  const timer=setTimeout(()=>{cleanup();reject(Error('Request timed out; the result is unknown.'));onTimeout?.();},milliseconds);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
}
function parseModules(value:unknown,chat:boolean){
 const items=ModuleInfo.array().parse(value);
 if(new Set(items.map(item=>item.id)).size!==items.length||chat&&items.some(item=>typeof item.selected!=='boolean'))throw Error('Module status response is incomplete.');
 return items;
}
function parseConnections(value:unknown){
 const items=McpConnection.array().parse(value);
 if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('Connection response contains duplicate IDs.');
 return items;
}
function endpointSummary(endpoint:string){try{const url=new URL(endpoint);return {address:`${url.host}${url.pathname==='/'?'':url.pathname}`,protocol:url.protocol.replace(':','').toUpperCase()};}catch{return {address:'Endpoint unavailable',protocol:undefined};}}
function validateConnection(draft:Draft,entries:Connection[]):Connection{
 const id=draft.id.trim(),endpoint=draft.endpoint.trim(),allowedTools=draft.tools.split(/[\n,]/).map(value=>value.trim()).filter(Boolean);
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))throw Error('Use a lowercase ID with letters, numbers or hyphens (up to 64 characters).');
 if(draft.original&&id!==draft.original.id)throw Error('Connection IDs cannot be renamed. Add a separate connection instead.');
 if(!draft.original&&entries.some(item=>item.id===id))throw Error('That connection ID already exists. Edit it instead.');
 let url:URL;try{url=new URL(endpoint);}catch{throw Error('Enter an absolute HTTPS endpoint.');}
 if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash||/[?#]/.test(endpoint))throw Error('Use HTTPS without embedded credentials, a query or a fragment.');
 // MCP tool names are exact names, never patterns. This conservative UI accepts
 // the standard interoperable name alphabet, not wildcard or whitespace grants.
 if(!allowedTools.length||allowedTools.length>100||allowedTools.some(name=>!/^[a-zA-Z0-9_.-]{1,128}$/.test(name)))throw Error('Enter 1–100 exact tool names (letters, numbers, dots, underscores or hyphens); no wildcards.');
 if(new Set(allowedTools).size!==allowedTools.length)throw Error('Remove duplicate tool names.');
 return McpConnection.parse({id,endpoint,allowedTools,enabled:draft.enabled});
}
type Draft={id:string;endpoint:string;tools:string;enabled:boolean;original?:Connection};
type Resource<T>={items?:T[];loading:boolean;error?:string;revision?:number};
/** Ownership is scoped separately from App's retained chat/session owner. Hiding
 * Tools unmounts only this observer/editor, never any parent conversation state. */
export function ToolsScreen(props:ToolsScreenProps){
 const request=useRef(props.request);request.current=props.request;
 const transport=useCallback<ToolsScreenProps['request']>((...args)=>request.current(...args),[]);
 const [local]=useState(()=>new ToolsPresentationCache());
 const key=JSON.stringify([props.backendId,props.scopeKey,props.conversationId,props.readOnly]);
 const cached=(props.presentation??local).forScope(key);
 if(!props.active)return null;
 return <ToolsContent key={key} {...props} cached={cached} request={transport}/>;
}
function useResource<T>(path:string,parse:(value:unknown)=>T[],request:ToolsScreenProps['request'],alive:React.RefObject<boolean>,owner:ToolsMutationOwner,cached:Map<string,unknown>){
 const [state,setState]=useState<Resource<T>>(()=>{try{return {loading:true,items:cached.has(path)?parse(cached.get(path)):undefined};}catch{return {loading:true};}});
 const observer=useRef<{controller:AbortController;generation:number}|undefined>(undefined);
 const generation=useRef(0);
 const load=async(verify?:(items:T[])=>boolean)=>{
  if(!alive.current)return undefined;
  observer.current?.controller.abort();const controller=new AbortController(),ticket=++generation.current;observer.current={controller,generation:ticket};
  // A post-write verification is not a presentation refresh: clear the old
  // pre-write rows so uncertain/mismatched outcomes cannot look committed.
  if(verify)cached.delete(path);
  setState(previous=>({items:verify?undefined:previous.items,loading:true}));const readTicket=owner.beginRead();
  try{
   const items=parse(await timed(request(path,'GET',undefined,controller.signal),15000,()=>controller.abort(),controller.signal));
   if(!alive.current||ticket!==generation.current||controller.signal.aborted)return undefined;
   if(verify&&!verify(items))throw Error('Readback did not verify the requested change.');
   const fresh=owner.acceptRead(readTicket);
   if(fresh)cached.set(path,items);
   setState({items,loading:false,revision:fresh?readTicket.revision:undefined});return {items,fresh};
  }catch(error){if(alive.current&&ticket===generation.current)setState(previous=>({items:previous.items,loading:false,error:errorText(error)}));return undefined;}
 };
 useEffect(()=>{void load();return()=>{++generation.current;observer.current?.controller.abort();};},[]); // Scoped owner + latest transport; never keyed by callback identity.
 return {...state,load};
}
type Confirmation={anchor:string;title:string;message:string;run:()=>void};
function ToolsContent({backendId,workstationName,conversationId,conversationTitle,readOnly,request,onAskBob,cached}:ToolsScreenProps&{cached:Map<string,unknown>}){
 const s=useThemedValue(styles),{colors}=useTheme();
 const alive=useRef(true);
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;confirmationRef.current=undefined;};},[]);
 const modulePath=conversationId===undefined?'modules':`chats/${conversationId}/modules`;
 const moduleOwner=toolsMutationOwner(backendId,'modules',conversationId),connectionOwner=toolsMutationOwner(backendId,'connections');
 const moduleWrite=useSyncExternalStore(moduleOwner.subscribe,moduleOwner.getSnapshot),connectionWrite=useSyncExternalStore(connectionOwner.subscribe,connectionOwner.getSnapshot);
 const modules=useResource(modulePath,value=>parseModules(value,conversationId!==undefined),request,alive,moduleOwner,cached);
 const connections=useResource('mcp-connections',parseConnections,request,alive,connectionOwner,cached);
 const owners={modules:moduleOwner,connections:connectionOwner};
 const blocked=(kind:'modules'|'connections')=>{const owner=owners[kind],resource=kind==='modules'?modules:connections;return owner.getSnapshot().phase!=='idle'||resource.revision!==owner.getSnapshot().revision;};
 const [page,setPage]=useState<'modules'|'connections'>('modules');
 const pageVisit=useRef(0),visit=pageVisit.current;
 const [openModule,setOpenModule]=useState<string>(),[openConnection,setOpenConnection]=useState<string>();
 const [help,setHelp]=useState(false),[draft,setDraft]=useState<Draft>(),[formError,setFormError]=useState('');
 const [confirmation,setConfirmation]=useState<Confirmation>();const confirmationRef=useRef<Confirmation|undefined>(undefined);
 const [busy,setBusy]=useState<{modules?:boolean;connections?:boolean}>({});const busyRef=useRef(new Set<'modules'|'connections'>());
 const [messages,setMessages]=useState<{modules?:string;connections?:string}>({});
 const uncertain={modules:blocked('modules'),connections:blocked('connections')};
 const currentVisit=()=>alive.current&&visit===pageVisit.current;
 const canAct=()=>currentVisit()&&!readOnly&&!confirmationRef.current;
 const cancel=()=>{confirmationRef.current=undefined;if(alive.current)setConfirmation(undefined);};
 const selectPage=(next:'modules'|'connections')=>{if(!currentVisit()||next===page)return;++pageVisit.current;cancel();setPage(next);};
 const confirm=(anchor:string,title:string,message:string,run:()=>void)=>{if(!canAct())return;const next={anchor,title,message,run};confirmationRef.current=next;setConfirmation(next);};
 const refresh=async(kind:'modules'|'connections')=>{
  if(!alive.current||busyRef.current.has(kind)||confirmationRef.current)return;
  const result=await (kind==='modules'?modules.load():connections.load());
  if(result?.fresh&&alive.current){setMessages(old=>({...old,[kind]:undefined}));if(kind==='connections'){setDraft(undefined);setFormError('');}}
 };
 const mutate=async<T extends Module|Connection>(kind:'modules'|'connections',method:string,body:unknown,verify:(items:T[])=>boolean,beforeWrite?:()=>Promise<void>)=>{
  if(!canAct()||blocked(kind)||busyRef.current.has(kind))return;
  const owner=owners[kind],reservation=owner.reserve((kind==='modules'?modules:connections).revision!);
  if(!reservation)return;
  let sent=false;
  busyRef.current.add(kind);setBusy(old=>({...old,[kind]:true}));setMessages(old=>({...old,[kind]:'Saving…'}));
  try{
   await beforeWrite?.();
   if(!currentVisit()){
    if(alive.current)setMessages(old=>({...old,[kind]:'Not submitted. Review the change again when you return.'}));
    return;
   }
   sent=true;
   await timed(owner.send(reservation,()=>request(kind==='modules'?modulePath:'mcp-connections',method,body)),20000);
   if(!alive.current)return;
   const result=kind==='modules'?await modules.load(items=>verify(items as T[])):await connections.load(items=>verify(items as T[]));
   if(!alive.current)return;
   if(!result?.fresh)throw Error('Readback did not verify the requested change.');
   setMessages(old=>({...old,[kind]:kind==='modules'?'Chat selection saved.':'Connection change saved.'}));
   if(kind==='connections'){setDraft(undefined);setFormError('');}
  }catch(error){
   if(alive.current)setMessages(old=>({...old,[kind]:sent?`${errorText(error)} Not confirmed saved. Refresh to reconcile after the request settles; do not assume the change failed.`:`${errorText(error)} No change was sent. Refresh before reviewing again.`}));
  }finally{
   if(!sent)owner.cancel(reservation);
   busyRef.current.delete(kind);if(alive.current)setBusy(old=>({...old,[kind]:false}));
  }
 };
 const changeModule=(item:Module)=>{
  if(!canAct()||conversationId===undefined||blocked('modules')||!modules.items)return;
  const selected=modules.items.filter(entry=>entry.selected).map(entry=>entry.id),ids=item.selected?selected.filter(id=>id!==item.id):[...selected,item.id];
  const missing=modules.items.filter(entry=>ids.includes(entry.id)).flatMap(entry=>entry.requires.filter(id=>!ids.includes(id)));
  if(missing.length){setMessages(old=>({...old,modules:`Required modules: ${[...new Set(missing)].join(', ')}. Change these explicitly first; dependencies are never changed automatically.`}));return;}
  if(!item.selected&&(!item.installed||!item.registered||!item.available))return;
  const catalogIds=modules.items.map(entry=>entry.id);
  confirm(`module:${item.id}`,`${item.selected?'Turn off':'Turn on'} ${presentation(item).title}?`,'Changes only this chat. Bob requires this conversation and its background work to be settled; nothing will be stopped automatically.',()=>void mutate<Module>('modules','PUT',{ids},items=>catalogIds.every(id=>items.some(entry=>entry.id===id))&&sameIds(items.filter(entry=>entry.selected).map(entry=>entry.id),ids)));
 };
 const saveConnection=(next:Connection,original?:Connection,anchor=`connection:${next.id}`)=>{
  if(!canAct()||blocked('connections'))return;
  // Existing entries may have been configured by the development CLI. Do not
  // silently enable a URL or permission grant the phone editor would reject.
  const onlyDisabling=original&&original.enabled&&!next.enabled&&next.endpoint===original.endpoint&&sameIds(next.allowedTools,original.allowedTools);
  try{if(!onlyDisabling)validateConnection({id:next.id,endpoint:next.endpoint,tools:next.allowedTools.join('\n'),enabled:next.enabled,original},connections.items??[]);}
  catch(error){setMessages(old=>({...old,connections:errorText(error)}));return;}
  const warnings=[!original?'Add this connection to the workstation?':`Save ${next.id} on this workstation?`];
  if(next.enabled&&!original?.enabled)warnings.push('Enabling permits the listed tools to be used. This does not test credentials or service availability.');
  if(next.allowedTools.some(name=>!original?.allowedTools.includes(name)))warnings.push(`Allow only these exact tools: ${next.allowedTools.join(', ')}.`);
  if(original&&next.endpoint!==original.endpoint)warnings.push('Changing the endpoint clears the stored credential. Configure it again using the backend CLI.');
  confirm(anchor,'Save connection?',warnings.join('\n\n'),()=>void mutate<Connection>('connections','PUT',next,items=>items.some(item=>item.id===next.id&&item.endpoint===next.endpoint&&item.enabled===next.enabled&&sameIds(item.allowedTools,next.allowedTools)),!original?async()=>{
   // PUT is an upsert. Check again at the explicit submit boundary so a new
   // draft cannot knowingly overwrite an ID added since the list was loaded.
   const current=(await connections.load())?.items;
   if(!current)throw Error('Could not check connection IDs; no write was sent.');
   if(current.some(item=>item.id===next.id))throw Error('That connection ID now exists; no write was sent. Refresh and edit it instead.');
  }:undefined));
 };
 const openEditor=(item?:Connection)=>{
  if(!canAct()||blocked('connections'))return;
  setFormError('');setDraft(item?{id:item.id,endpoint:item.endpoint,tools:item.allowedTools.join('\n'),enabled:item.enabled,original:item}:{id:'',endpoint:'',tools:'',enabled:false});
 };
 const controlsOff=readOnly||!!busy[page]||!!confirmation;
 const notice=(kind:'modules'|'connections')=>{
  const write=kind==='modules'?moduleWrite:connectionWrite;
  const shared=write.phase==='pending'?'A change request is still pending. Its outcome is unknown; refreshing cannot permit another write yet.':write.phase==='reserved'?'A change is being prepared.':write.phase==='reconcile'?'The transport request has settled, but its outcome is not confirmed. Refresh before another change.':blocked(kind)&&!(kind==='modules'?modules:connections).loading?'Refresh to read the latest configuration before another change.':undefined;
  const local=shared&&messages[kind]?.endsWith('saved.')?undefined:messages[kind];
  return local||shared?<Text typography="ui" accessibilityLiveRegion="polite" style={s.caption}>{[local,shared].filter(Boolean).join(' ')}</Text>:null;
 };
 const action=(label:string,onPress:()=>void,disabled=false,text=label)=><SectionAction label={label} text={text} onPress={()=>{if(currentVisit()&&!disabled)onPress();}} disabled={disabled}/>;
 const interactive=modules.items?.find(item=>item.id==='interactive');
 const connectionNote=conversationId===undefined||!modules.items?undefined:!interactive||!interactive.available||!interactive.installed||!interactive.registered?'Interactive tools are unavailable in this chat. You can still manage workstation connections.':!interactive.selected?'Interactive tools are off in this chat. Select them in Modules to use connections here.':undefined;
 const confirmationPanel=(anchor:string)=>confirmation?.anchor===anchor?<View testID="tools-confirmation" style={s.editor}>
  <Text typography="ui" accessibilityRole="header" style={s.title}>{confirmation.title}</Text><Text typography="ui" style={s.caption}>{confirmation.message}</Text>
  <View style={s.actions}>{action('Cancel tool change',cancel,false,'Cancel')}{action('Confirm tool change',()=>{if(!alive.current||confirmationRef.current!==confirmation)return;cancel();confirmation.run();},false,'Confirm')}</View>
 </View>:null;
 return <View testID="tools-screen" style={s.screen}>
  <View style={s.section}>
   <Text typography="ui" style={s.caption}>Workstation · {workstationName}</Text>
   <SectionSegments label="Tools sections" options={[{value:'modules',label:'Modules'},{value:'connections',label:'Connections'}]} value={page} onChange={selectPage}/>
  </View>
  {page==='modules'&&<View testID="tools-modules" style={s.section}>
   <View style={s.scope}><Text typography="ui" style={s.scopeTitle}>{conversationId===undefined?'Workstation catalog':`This chat · ${conversationTitle||`Chat ${conversationId}`}`}{readOnly?' · View only':''}</Text><Text typography="ui" style={s.caption}>{conversationId===undefined?'Choose a chat to change its tools.':'Selections affect this chat, not workstation defaults.'}</Text></View>
   {modules.items&&modules.revision===undefined&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.caption}>Last loaded modules · {modules.loading?'refreshing…':'refresh to verify.'}</Text>}
   {modules.loading&&!modules.items&&<Text typography="ui" style={s.caption}>Loading modules…</Text>}
   {!!modules.error&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.caption}>Modules could not be loaded. {modules.error}</Text>}
   {modules.items?.length===0&&<Text typography="ui" style={s.caption}>No modules in this workstation catalog.</Text>}
   {!!modules.items?.length&&<View style={s.listHeading}><Text typography="ui" accessibilityRole="header" style={s.sectionTitle}>Modules</Text><Text typography="ui" style={s.caption}>{modules.items.length}{conversationId===undefined?'':` · ${modules.items.filter(item=>item.selected).length} on`}</Text></View>}
   <View testID="tools-module-list" style={s.list}>{modules.items?.map((item,index)=>{const info=presentation(item),Icon=info.icon,expanded=openModule===item.id;return <View key={item.id} style={s.card}>
    <TouchTarget accessibilityRole="button" accessibilityLabel={`Details for ${info.title}`} accessibilityState={{expanded}} onPress={()=>{if(currentVisit()&&!confirmationRef.current)setOpenModule(expanded?undefined:item.id);}} style={s.cardTarget}>
     <Icon size={22} color={colors.foreground}/><View style={s.cardText}><Text typography="ui" style={s.title}>{info.title}</Text><Text typography="ui" numberOfLines={2} style={s.caption}>{info.description}</Text><Text typography="ui" style={[s.status,item.selected&&s.activeStatus]}>{conversationId===undefined?(item.installed?'Installed':'Not installed'):(item.selected?'On in this chat':'Off in this chat')}{conversationId!==undefined&&!item.installed?' · Not installed':''}{!item.registered?' · Not registered':''}{!item.available?' · Unavailable':''}</Text></View><ChevronDown size={18} color={colors.muted} style={expanded?s.expanded:undefined}/>
    </TouchTarget>
    {expanded&&<View style={s.details}>
     <Text typography="ui" style={s.caption}>{`ID: ${item.id}\nExtension: ${item.name}\nPackage: ${item.packageName} · ${item.version}\nDurable: ${item.durable}\nInstalled: ${item.installed?'Yes':'No'} · Registered: ${item.registered?'Yes':'No'}\nDefault for new chats: ${item.defaultSelected?'On':'Off'}\nRequires: ${item.requires.join(', ')||'None'}\nPackage dependencies: ${Object.entries(item.dependencies).map(([name,version])=>`${name} ${version}`).join(', ')||'None'}`}</Text>
     <Text typography="ui" style={s.caption}>Workstation installation and defaults are managed separately by the owner. Chat selections do not change those defaults.</Text>
     <Text typography="ui" style={s.caption}>Modules run trusted backend code, not sandboxed plugins. Installed or registered does not prove credentials or services work.</Text>
     {conversationId!==undefined&&!readOnly&&action(`${item.selected?'Turn off':'Turn on'} ${info.title}`,()=>changeModule(item),controlsOff||!!uncertain.modules||!item.selected&&(!item.installed||!item.registered||!item.available))}
     {confirmationPanel(`module:${item.id}`)}
    </View>}
    {index<(modules.items?.length??0)-1&&<View testID="tools-row-separator" pointerEvents="none" style={s.separator}/>}
   </View>;})}</View>
   {notice('modules')}
   <View style={s.actions}>{action(modules.error?'Retry modules':'Refresh modules',()=>void refresh('modules'),!!busy.modules||modules.loading||!!confirmation)}</View>
  </View>}
  {page==='connections'&&<View testID="tools-connections" style={s.section}>
   <View style={s.scope}><Text typography="ui" style={s.scopeTitle}>Shared across chats{readOnly?' · View only':''}</Text><Text typography="ui" style={s.caption}>Workstation configuration · availability is not tested here.</Text></View>
   {!!connectionNote&&<Text typography="ui" style={s.caption}>{connectionNote}</Text>}
   {connections.items&&connections.revision===undefined&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.caption}>Last loaded connections · {connections.loading?'refreshing…':'refresh to verify.'}</Text>}
   {connections.loading&&!connections.items&&<Text typography="ui" style={s.caption}>Loading connections…</Text>}
   {!!connections.error&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.caption}>Connections could not be loaded. {connections.error}</Text>}
   {connections.items?.length===0&&<Text typography="ui" style={s.caption}>No connections yet.</Text>}
   {!!connections.items?.length&&<View style={s.listHeading}><Text typography="ui" accessibilityRole="header" style={s.sectionTitle}>Servers</Text><Text typography="ui" style={s.caption}>{connections.items.length} · {connections.items.filter(item=>item.enabled).length} enabled</Text></View>}
   <View testID="tools-connection-list" style={s.list}>{connections.items?.map((item,index)=>{const expanded=openConnection===item.id,endpoint=endpointSummary(item.endpoint);return <View key={item.id} style={s.card}>
    <TouchTarget accessibilityRole="button" accessibilityLabel={`Details for connection ${item.id}`} accessibilityState={{expanded}} onPress={()=>{if(currentVisit()&&!confirmationRef.current)setOpenConnection(expanded?undefined:item.id);}} style={s.cardTarget}>
     <Plug size={22} color={colors.foreground}/><View style={s.cardText}><View style={s.connectionHeading}><Text typography="ui" style={s.title}>{item.id}</Text>{!!endpoint.protocol&&<Text typography="ui" style={s.protocol}>{endpoint.protocol}</Text>}</View><Text typography="ui" numberOfLines={2} style={s.caption}>{endpoint.address}</Text><Text typography="ui" style={[s.status,item.enabled&&s.activeStatus]}>{item.enabled?'Enabled':'Disabled'} · {item.allowedTools.length} allowed {item.allowedTools.length===1?'tool':'tools'}</Text></View><ChevronDown size={18} color={colors.muted} style={expanded?s.expanded:undefined}/>
    </TouchTarget>
    {expanded&&<View style={s.details}>
     <Text typography="ui" style={s.caption}>{`Endpoint: ${item.endpoint}\nExact allowed tools: ${item.allowedTools.join(', ')}`}</Text>
     <Text typography="ui" style={s.caption}>Enabled is configuration, not a health check. Credentials are not shown here. Configure them on the backend with bob mcp key {item.id} (stdin).</Text>
     {!readOnly&&<View style={s.actions}>
      {action(`Edit ${item.id}`,()=>openEditor(item),controlsOff||!!uncertain.connections,'Edit')}
      {action(`${item.enabled?'Disable':'Enable'} ${item.id}`,()=>saveConnection({...item,enabled:!item.enabled},item),controlsOff||!!uncertain.connections,item.enabled?'Disable':'Enable')}
      {action(`Remove ${item.id}`,()=>confirm(`connection:${item.id}`,'Remove connection?',`Remove ${item.id} and its stored credential from this workstation? This affects all chats.`,()=>void mutate<Connection>('connections','DELETE',{id:item.id},items=>!items.some(entry=>entry.id===item.id))),controlsOff||!!uncertain.connections,'Remove')}
     </View>}
     {confirmationPanel(`connection:${item.id}`)}
    </View>}
    {index<(connections.items?.length??0)-1&&<View testID="tools-row-separator" pointerEvents="none" style={s.separator}/>}
   </View>;})}</View>
   {notice('connections')}
   <View style={s.actions}>{action(connections.error?'Retry connections':'Refresh connections',()=>void refresh('connections'),!!busy.connections||connections.loading||!!confirmation)}{!readOnly&&action('Add connection',()=>openEditor(),controlsOff||!connections.items||!!uncertain.connections)}</View>
   {!!draft&&<View style={s.editor}>
    <Text typography="ui" accessibilityRole="header" style={s.title}>{draft.original?'Edit connection':'Add connection'}</Text>
    <Text typography="ui" style={s.caption}>Workstation configuration only. New connections start disabled. No credentials belong in these fields.</Text>
    <TextInput typography="ui" accessibilityLabel="Connection ID" placeholder="Connection ID" value={draft.id} editable={!draft.original&&!controlsOff&&!uncertain.connections} autoCapitalize="none" autoCorrect={false} multiline style={s.input} onChangeText={id=>{if(canAct())setDraft({...draft,id});}}/>
    <TextInput typography="ui" accessibilityLabel="HTTPS endpoint" placeholder="https://example.com/mcp" value={draft.endpoint} editable={!controlsOff&&!uncertain.connections} autoCapitalize="none" autoCorrect={false} multiline style={s.input} onChangeText={endpoint=>{if(canAct())setDraft({...draft,endpoint});}}/>
    <TextInput typography="ui" accessibilityLabel="Exact allowed tool names" placeholder="Exact tool names, one per line" value={draft.tools} editable={!controlsOff&&!uncertain.connections} autoCapitalize="none" autoCorrect={false} multiline style={s.input} onChangeText={tools=>{if(canAct())setDraft({...draft,tools});}}/>
    {!!formError&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.caption}>{formError}</Text>}
    <View style={s.actions}>{action('Cancel connection editing',()=>{if(canAct()){setDraft(undefined);setFormError('');}},controlsOff,'Cancel')}{action('Review connection',()=>{if(!canAct())return;try{saveConnection(validateConnection(draft,connections.items??[]),draft.original,'editor');setFormError('');}catch(error){setFormError(errorText(error));}},controlsOff||!!uncertain.connections,'Review')}</View>
    {confirmationPanel('editor')}
   </View>}
  </View>}
  <View style={s.section}>
   <View style={s.actions}>{action(help?'Close adding tools help':'Adding tools',()=>{if(alive.current)setHelp(!help);},!!confirmation)}</View>
   {help&&<View style={s.details}><Text typography="ui" style={s.caption}>MCP connects an external service using an HTTPS endpoint and exact tool permissions. Trusted custom modules add backend code and require owner-managed installation; they are not sandboxed. Neither option is installed or enabled by opening a setup draft.</Text>{onAskBob&&!readOnly&&action('Ask Bob about adding tools',()=>{if(canAct())onAskBob();},controlsOff)}</View>}
  </View>
 </View>;
}
const styles=themed(({colors,menuChrome})=>StyleSheet.create({
 screen:{gap:24,minWidth:0},section:{gap:12,minWidth:0},
 scope:{backgroundColor:colors.panel,borderRadius:24,padding:16,gap:4,minWidth:0},
 scopeTitle:{fontSize:15,lineHeight:23,fontWeight:'500',color:colors.foreground,flexShrink:1},
 listHeading:{flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',justifyContent:'space-between',gap:8,paddingHorizontal:4,paddingTop:4},
 sectionTitle:{fontSize:14,lineHeight:22,fontWeight:'600',color:colors.muted},
 list:{borderRadius:24,backgroundColor:colors.panel,overflow:'hidden',minWidth:0},
 card:{minWidth:0},
 cardTarget:{minHeight:80,minWidth:48,padding:16,flexDirection:'row',alignItems:'center',gap:12},
 cardText:{flex:1,minWidth:0,gap:4},title:{fontSize:17,lineHeight:25,fontWeight:'500',color:colors.foreground,flexShrink:1,minWidth:0},
 caption:{fontSize:14,lineHeight:21,color:colors.muted,flexShrink:1},
 status:{fontSize:13,lineHeight:20,color:colors.muted,flexShrink:1,alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:3,borderRadius:10,backgroundColor:colors.surface},
 activeStatus:{color:colors.foreground,backgroundColor:colors.selectedSurface},
 connectionHeading:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8,minWidth:0},
 protocol:{fontSize:11,lineHeight:17,fontWeight:'600',color:colors.muted,paddingHorizontal:6,paddingVertical:2,borderRadius:6,borderWidth:StyleSheet.hairlineWidth,borderColor:colors.border},
 expanded:{transform:[{rotate:'180deg'}]},
 separator:{height:StyleSheet.hairlineWidth,backgroundColor:colors.border,marginHorizontal:16},
 details:{paddingHorizontal:16,paddingBottom:16,gap:12,minWidth:0},actions:{flexDirection:'row',flexWrap:'wrap',gap:8,minWidth:0},
 editor:{padding:16,gap:12,borderRadius:20,minWidth:0,backgroundColor:colors.surface},
 input:{...menuChrome.input,minHeight:48,padding:12,fontSize:16,lineHeight:24,color:colors.foreground,textAlignVertical:'top'},
}));
