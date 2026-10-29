import {Text} from './app-text';
import React,{useEffect,useState} from 'react';
import {Image,Pressable,StyleSheet,View,type ImageSourcePropType} from 'react-native';
import {FileText,X} from 'lucide-react-native';
import * as Keychain from 'react-native-keychain';
import {colors} from '../theme';

export type DraftAttachment={id:string;uri:string;name:string;mime:string};
export function AttachmentThumbnail({name,mime,source,onOpen,onRemove,disabled=false}:{name:string;mime:string;source?:ImageSourcePropType;onOpen?:()=>void;onRemove?:()=>void;disabled?:boolean}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[source]);
 return <View style={styles.tile}>
  <Pressable accessibilityRole={onOpen?'button':'image'} accessibilityLabel={onOpen?`Open ${name}`:name} onPress={onOpen} disabled={!onOpen} style={styles.preview}>
   {mime.startsWith('image/')&&source&&!failed?<Image source={source} resizeMode="cover" resizeMethod="resize" style={styles.image} onError={()=>setFailed(true)}/>:<View style={styles.fallback}><FileText size={26} color={colors.muted}/><Text numberOfLines={2} style={styles.label}>{name}</Text></View>}
  </Pressable>
  {onRemove&&<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} accessibilityState={{disabled}} disabled={disabled} onPress={onRemove} style={styles.remove}><View style={styles.removeCircle}><X size={18} color={colors.foreground}/></View></Pressable>}
 </View>;
}
export function SentAttachmentThumbnail({backend,artifact,onOpen}:{backend:{backendId:string;endpoint:string};artifact:{id:string;conversationId:number;name:string;mime:string};onOpen:()=>void}) {
 const [source,setSource]=useState<ImageSourcePropType>();
 useEffect(()=>{
  let cancelled=false;setSource(undefined);
  if(artifact.mime.startsWith('image/'))void Keychain.getGenericPassword({service:`bob.${backend.backendId}`}).then(credential=>{
   if(!cancelled&&credential)setSource({uri:`${backend.endpoint}/v1/chats/${artifact.conversationId}/artifacts/${artifact.id}`,headers:{Authorization:`Bearer ${credential.password}`,'x-bob-backend':backend.backendId}});
  }).catch(()=>{});
  return ()=>{cancelled=true;};
 },[backend.backendId,backend.endpoint,artifact.id,artifact.conversationId,artifact.mime]);
 return <AttachmentThumbnail name={artifact.name} mime={artifact.mime} source={source} onOpen={onOpen}/>;
}
const styles=StyleSheet.create({
 tile:{width:96,height:112,position:'relative'},
 preview:{width:96,height:112,borderRadius:16,overflow:'hidden',backgroundColor:colors.surface},
 image:{width:'100%',height:'100%'},
 fallback:{flex:1,alignItems:'center',justifyContent:'center',padding:8,gap:6},
 label:{fontSize:11,color:colors.foreground,textAlign:'center'},
 remove:{position:'absolute',top:-4,right:-4,width:44,height:44,alignItems:'center',justifyContent:'center'},
 removeCircle:{width:28,height:28,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
});
