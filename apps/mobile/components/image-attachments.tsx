import React,{useEffect,useMemo,useRef,useState} from 'react';
import {View} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {ImageAttachmentStack,type ImageStackItem} from './image-attachment-stack';
import {AttachmentDetails} from './attachment-details';
import type {ImageArtifact} from '../image-attachment-rows';

type Props={backend:{backendId:string;endpoint:string};artifacts:readonly ImageArtifact[];fromBob:boolean;active?:boolean;onOpen:(artifact:ImageArtifact)=>void;onSave?:(artifact:ImageArtifact)=>void};
/** Authenticated thumbnail sources only; preview/save remain the existing native
 * attachment actions. Never borrow credentials or a selected image across scopes. */
export function ImageAttachments({backend,artifacts,fromBob,active=true,onOpen,onSave}:Props){
 const conversation=artifacts[0]?.conversationId;
 const scope=JSON.stringify([backend.backendId,backend.endpoint,conversation]);
 const valid=useMemo(()=>artifacts.filter(item=>item.conversationId===conversation),[artifacts,conversation]);
 const [auth,setAuth]=useState<{scope:string;password:string}>();
 const [detail,setDetail]=useState<{scope:string;id:string}>();
 const detailArtifact=active&&detail?.scope===scope?valid.find(item=>item.id===detail.id):undefined;
 const mounted=useRef(true),current=useRef({scope,active,valid,fromBob});current.current={scope,active:active&&!detailArtifact,valid,fromBob};
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let alive=true;setAuth(undefined);
  if(conversation!==undefined)void Keychain.getGenericPassword({service:`bob.${backend.backendId}`}).then(value=>{
   if(alive&&value)setAuth({scope,password:value.password});
  }).catch(()=>{});
  return ()=>{alive=false;};
 },[scope,backend.backendId,conversation]);
 useEffect(()=>{setDetail(value=>value&&(!active||value.scope!==scope||!valid.some(item=>item.id===value.id))?undefined:value);},[scope,active,valid]);
 const images=useMemo(()=>valid.map(artifact=>({id:artifact.id,name:artifact.name,...(auth?.scope===scope?{source:{uri:`${backend.endpoint}/v1/chats/${artifact.conversationId}/artifacts/${encodeURIComponent(artifact.id)}`,headers:{Authorization:`Bearer ${auth.password}`,'x-bob-backend':backend.backendId}}}:{})})),[valid,auth,scope,backend.endpoint,backend.backendId]);
 const resolve=(item:ImageStackItem)=>mounted.current&&current.current.active&&current.current.scope===scope?current.current.valid.find(artifact=>artifact.id===item.id):undefined;
 return <View testID="image-attachments" style={{width:'100%',alignItems:fromBob?'flex-start':'flex-end'}}>
  <ImageAttachmentStack key={scope} images={images} active={active&&!detailArtifact} onOpen={item=>{const artifact=resolve(item);if(artifact)onOpen(artifact);}} onDetails={item=>{const artifact=resolve(item);if(artifact)setDetail({scope,id:artifact.id});}} onSave={fromBob&&onSave?item=>{const artifact=resolve(item);if(artifact&&current.current.fromBob)onSave(artifact);}:undefined}/>
  {detailArtifact&&<AttachmentDetails artifact={detailArtifact} onClose={()=>{if(current.current.scope===scope)setDetail(undefined);}}/>}
 </View>;
}
