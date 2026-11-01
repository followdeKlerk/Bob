import React from 'react';
import {Alert,View} from 'react-native';
import {SentAttachmentThumbnail} from './attachment-thumbnail';
export function FileAttachment({backend,artifact,fromBob,onOpen,onSave}:{backend:{backendId:string;endpoint:string};artifact:{id:string;conversationId:number;name:string;mime:string;size:number};fromBob:boolean;onOpen:()=>void;onSave?:()=>void}){
 const details=()=>Alert.alert('Attachment details',`${artifact.name}\n${artifact.mime}\n${artifact.size===0?'0 bytes':`${Math.max(1,Math.ceil(artifact.size/1024))} KB`}`);
 return <View>
  <SentAttachmentThumbnail backend={backend} artifact={artifact} onOpen={onOpen} onDetails={details} onSave={fromBob?onSave:undefined} hideFilename/>
 </View>;
}
