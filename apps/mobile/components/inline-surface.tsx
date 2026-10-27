import React,{useEffect,useState} from 'react';
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
 useEffect(()=>{
  let active=true;let prepared:string|undefined;
  const listener=DeviceEventEmitter.addListener('BobSurfaceOverflow',event=>{
   if(active&&event.backendId===backend.backendId&&event.conversationId===surface.conversationId&&event.id===surface.id)onOverflow();
  });
  void (async()=>{
   const credential=await Keychain.getGenericPassword({service:`bob.${backend.backendId}`});
   if(!credential)throw Error('Pairing credential unavailable.');
   if(!active)return;
   prepared=await NativeModules.BobInteractive.prepare(backend.endpoint,backend.backendId,credential.password,surface.conversationId,surface.id);
   if(active)setHandle(prepared);else if(prepared)NativeModules.BobInteractive.releasePrepared(prepared);
  })().catch(e=>{if(active)setError(String(e.message??'Content unavailable'));});
  return ()=>{active=false;listener.remove();if(prepared)NativeModules.BobInteractive.releasePrepared(prepared);};
 },[backend.backendId,backend.endpoint,surface.id,surface.conversationId,onOverflow]);
 return error?<Text style={{color:colors.muted,paddingVertical:16}}>{error}</Text>:handle?<NativeSurface session={handle} style={{height:420,width:'100%'}}/>:<Text style={{paddingVertical:16,color:colors.muted}}>Loading visual…</Text>;
}
export function InlineSurface({backend,surface,onExpand}:Props) {
 const [overflow,setOverflow]=useState(false);
 const onOverflow=React.useCallback(()=>setOverflow(true),[]);
 // Old content has no fit contract; preserve it in the full viewer rather than guessing.
 const inline=surface.kind==='visual'&&surface.presentation==='inline'&&!overflow;
 return <View style={{marginVertical:12}}>
  {inline&&<Content backend={backend} surface={surface} onOverflow={onOverflow}/>}
  <ActionRow>
   <ActionIcon icon={Maximize2} label={`Expand visual: ${surface.title}`} onPress={onExpand}/>
   {!inline&&<Text numberOfLines={2} style={{color:colors.muted,fontSize:14,flexShrink:1}}>{surface.title}</Text>}
  </ActionRow>
 </View>;
}
