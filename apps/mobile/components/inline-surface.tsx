import {Text} from './app-text';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {DeviceEventEmitter,NativeModules,requireNativeComponent,View,type ViewProps} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {Maximize2,RefreshCw} from 'lucide-react-native';
import {ActionIcon,ActionRow} from './message-actions';
import {useTheme} from '../theme';
import {MAX_INLINE_HEIGHT,initialInlineHeight,rememberInlineHeight,forgetInlineHeight} from '../inline-visual-policy';
const NativeSurface=requireNativeComponent<ViewProps&{session:string}>('BobInlineSurface');
type Backend={backendId:string;endpoint:string};
type Props={backend:Backend;surface:{id:string;conversationId:number;title:string;kind:string;presentation?:'inline'|'fullscreen'};onExpand:()=>void};
function Content({backend,surface,onOverflow}:{backend:Backend;surface:Props['surface'];onOverflow:()=>void}) {
 const {colors}=useTheme();

 const [handle,setHandle]=useState<string>();const [error,setError]=useState('');
 const [attempt,setAttempt]=useState(0),preparing=useRef(true);
 const retry=()=>{if(preparing.current)return;preparing.current=true;setError('');setAttempt(value=>value+1);};
 const scope={backendId:backend.backendId,conversationId:surface.conversationId,id:surface.id};
 const [height,setHeight]=useState(()=>initialInlineHeight(scope)),[dataStatus,setDataStatus]=useState('');
 useEffect(()=>{
  let active=true;let prepared:string|undefined;
  preparing.current=true;setHandle(undefined);setError('');setHeight(initialInlineHeight(scope));setDataStatus('');
  const matches=(event:any)=>active&&prepared!==undefined&&event.session===prepared&&event.backendId===backend.backendId&&event.conversationId===surface.conversationId&&event.id===surface.id;
  const listener=DeviceEventEmitter.addListener('BobSurfaceOverflow',event=>{if(matches(event)){forgetInlineHeight(scope);onOverflow();}});
  const layout=DeviceEventEmitter.addListener('BobSurfaceLayout',event=>{
   if(matches(event)&&Number.isInteger(event.height)&&event.height>=1&&event.height<=MAX_INLINE_HEIGHT){rememberInlineHeight(scope,event.height);setHeight(event.height);}
  });
  const data=DeviceEventEmitter.addListener('BobSurfaceDataStatus',event=>{if(matches(event)&&typeof event.message==='string')setDataStatus(event.message.slice(0,160));});
  void (async()=>{
   const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
   if(!credential)throw Error('Pairing credential unavailable.');
   if(!active)return;
   prepared=await NativeModules.BobInteractive.prepare(backend.endpoint,backend.backendId,credential.password,surface.conversationId,surface.id);
   if(active)setHandle(prepared);else if(prepared)NativeModules.BobInteractive.releasePrepared(prepared);
  })().catch(e=>{if(active){preparing.current=false;setError(String(e?.message??'Content unavailable').slice(0,240)||'Content unavailable');}});
  return ()=>{active=false;listener.remove();layout.remove();data.remove();if(prepared)NativeModules.BobInteractive.releasePrepared(prepared);};
 },[backend.backendId,backend.endpoint,surface.id,surface.conversationId,onOverflow,attempt]);
 return error?<View><Text accessibilityLiveRegion="polite" style={{fontSize:13,color:colors.muted,paddingVertical:16}}>{error}</Text><ActionRow><ActionIcon icon={RefreshCw} label={`Retry visual: ${surface.title}`} onPress={retry}/><Text style={{fontSize:13,color:colors.muted}}>Retry loading visual</Text></ActionRow></View>:handle?<><NativeSurface testID="bob-inline-native-surface" collapsable={false} session={handle} style={{height,width:'100%'}}/>{!!dataStatus&&<Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:12}}>{dataStatus}</Text>}</>:<Text style={{fontSize:13,paddingVertical:16,color:colors.muted}}>Loading visual…</Text>;
}
export function InlineSurface({backend,surface,onExpand}:Props) {
 const {colors}=useTheme();

 // Overflow and preparation belong to this exact card/session/backend scope.
 const scopeKey=JSON.stringify([backend.backendId,backend.endpoint,surface.conversationId,surface.id]);
 const [overflow,setOverflow]=useState<string>();
 const onOverflow=useCallback(()=>setOverflow(scopeKey),[scopeKey]);
 // Old content has no fit contract; preserve it in the full viewer rather than guessing.
 const inline=surface.kind==='visual'&&surface.presentation==='inline'&&overflow!==scopeKey;
 return <View testID="inline-surface-container" collapsable={false} style={{marginVertical:12}}>
  {inline&&<Content key={scopeKey} backend={backend} surface={surface} onOverflow={onOverflow}/>}
  {(!inline||surface.kind==='visual')&&<ActionRow>
   <ActionIcon icon={Maximize2} label={`${surface.kind==='visual'?'Expand visual':'Open app'}: ${surface.title}`} onPress={onExpand}/>
   {!inline&&<Text numberOfLines={2} style={{color:colors.muted,fontSize:13,flexShrink:1}}>{surface.title}</Text>}
  </ActionRow>}
 </View>;
}
