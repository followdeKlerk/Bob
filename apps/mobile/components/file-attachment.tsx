import React,{useCallback,useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {SentAttachmentThumbnail} from './attachment-thumbnail';
import {AttachmentDetails} from './attachment-details';
import {attachmentType} from './attachment-type';
import {StreamingMedia} from './streaming-media';
export function FileAttachment({backend,artifact,fromBob,onOpen,onSave,active=true}:{backend:{backendId:string;endpoint:string};artifact:{id:string;conversationId:number;name:string;mime:string;size:number};fromBob:boolean;onOpen:()=>void;onSave?:()=>void;active?:boolean}){
 const scope=JSON.stringify([backend.backendId,backend.endpoint,artifact.conversationId,artifact.id,artifact.name,artifact.mime,artifact.size]);
 const [detailsScope,setDetailsScope]=useState<string>();
 const current=useRef({scope,active});current.current={scope,active};
 useEffect(()=>setDetailsScope(undefined),[scope,active]);
 const details=useCallback(()=>{
  if(current.current.active&&current.current.scope===scope)setDetailsScope(scope);
 },[scope]);
 const closeDetails=useCallback(()=>{
  if(current.current.scope===scope)setDetailsScope(undefined);
 },[scope]);
 const type=attachmentType(artifact.name,artifact.mime);
 return <>
  {type.kind==='audio'||type.kind==='video'?<StreamingMedia backend={backend} artifact={artifact} video={type.kind==='video'} active={active} onOpen={onOpen} onSave={fromBob?onSave:undefined} onDetails={details}/>:<View style={{alignSelf:'flex-start'}}>
   <SentAttachmentThumbnail backend={backend} artifact={artifact} onOpen={onOpen} onDetails={details} onSave={fromBob?onSave:undefined} hideFilename/>
  </View>}
  {active&&detailsScope===scope&&<AttachmentDetails artifact={artifact} onClose={closeDetails}/>}
 </>;
}
