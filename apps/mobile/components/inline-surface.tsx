import React,{useCallback,useEffect,useState} from 'react';
import {DeviceEventEmitter,NativeModules,requireNativeComponent,View,Text,type ViewProps} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {Maximize2} from 'lucide-react-native';
import {ActionIcon,ActionRow} from './message-actions';
import {colors} from '../theme';
const NativeSurface=requireNativeComponent<ViewProps&{session:string}>('BobInlineSurface');
type Backend={backendId:string;endpoint:string};
type Props={backend:Backend;surface:{id:string;conversationId:number;title:string;kind:string;presentation?:'inline'|'fullscreen'};onExpand:()=>void};
function Content({backend,surface,onOverflow}:{backend:Backend;surface:Props['surface'];onOverflow:()=>void}) {
 const [handle,setHandle]=useState<string>();const [error,setError]=useState('');
 const [height,setHeight]=useState(420),[dataStatus,setDataStatus]=useState('');
 useEffect(()=>{
  let active=true;let prepared:string|undefined;
  setHandle(undefined);setError('');setHeight(420);setDataStatus('');
  const matches=(event:any)=>active&&prepared!==undefined&&event.session===prepared&&event.backendId===backend.backendId&&event.conversationId===surface.conversationId&&event.id===surface.id;
  const listener=DeviceEventEmitter.addListener('BobSurfaceOverflow',event=>{if(matches(event))onOverflow();});
  const layout=DeviceEventEmitter.addListener('BobSurfaceLayout',event=>{
   if(matches(event)&&Number.isInteger(event.height)&&event.height>=1&&event.height<=420)setHeight(event.height);
  });
  const data=DeviceEventEmitter.addListener('BobSurfaceDataStatus',event=>{if(matches(event)&&typeof event.message==='string')setDataStatus(event.message.slice(0,160));});
  void (async()=>{
   const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
   if(!credential)throw Error('Pairing credential unavailable.');
   if(!active)return;
   prepared=await NativeModules.BobInteractive.prepare(backend.endpoint,backend.backendId,credential.password,surface.conversationId,surface.id);
   if(active)setHandle(prepared);else if(prepared)NativeModules.BobInteractive.releasePrepared(prepared);
  })().catch(e=>{if(active)setError(String(e.message??'Content unavailable'));});
  return ()=>{active=false;listener.remove();layout.remove();data.remove();if(prepared)NativeModules.BobInteractive.releasePrepared(prepared);};
 },[backend.backendId,backend.endpoint,surface.id,surface.conversationId,onOverflow]);
 return error?<Text style={{color:colors.muted,paddingVertical:16}}>{error}</Text>:handle?<><NativeSurface testID="bob-inline-native-surface" collapsable={false} session={handle} style={{height,width:'100%'}}/>{!!dataStatus&&<Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:13}}>{dataStatus}</Text>}</>:<Text style={{paddingVertical:16,color:colors.muted}}>Loading visual…</Text>;
}
export function InlineSurface({backend,surface,onExpand}:Props) {
 const [overflow,setOverflow]=useState(false);
 const onOverflow=useCallback(()=>setOverflow(true),[]);
 // Old content has no fit contract; preserve it in the full viewer rather than guessing.
 const inline=surface.kind==='visual'&&surface.presentation==='inline'&&!overflow;
 return <View testID="inline-surface-container" collapsable={false} style={{marginVertical:12}}>
  {inline&&<Content backend={backend} surface={surface} onOverflow={onOverflow}/>}
  {(!inline||surface.kind==='visual')&&<ActionRow>
   <ActionIcon icon={Maximize2} label={`${surface.kind==='visual'?'Expand visual':'Open app'}: ${surface.title}`} onPress={onExpand}/>
   {!inline&&<Text numberOfLines={2} style={{color:colors.muted,fontSize:14,flexShrink:1}}>{surface.title}</Text>}
  </ActionRow>}
 </View>;
}
