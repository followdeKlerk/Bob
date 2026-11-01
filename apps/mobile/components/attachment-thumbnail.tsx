import {Text} from './app-text';
import React,{useEffect,useState} from 'react';
import {Image,Pressable,StyleSheet,View,type ImageSourcePropType} from 'react-native';
import {Download,FileText,Info,X} from 'lucide-react-native';
import * as Keychain from 'react-native-keychain';
import {colors} from '../theme';

export type DraftAttachment={id:string;uri:string;name:string;mime:string;drawingData?:string};
export function AttachmentThumbnail({name,mime,source,onOpen,onRemove,onDetails,hideFilename=false,disabled=false}:{name:string;mime:string;source?:ImageSourcePropType;onOpen?:()=>void;onRemove?:()=>void;onDetails?:()=>void;hideFilename?:boolean;disabled?:boolean}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[source]);
 return <View style={styles.tile}>
  <Pressable accessibilityRole={onOpen?'button':'image'} accessibilityLabel={hideFilename?(onOpen?'Open attachment':'Attachment'):onOpen?`Open ${name}`:name} onPress={onOpen} disabled={!onOpen} style={styles.preview}>
   {mime.startsWith('image/')&&source&&!failed?<Image source={source} resizeMode="cover" resizeMethod="resize" style={styles.image} onError={()=>setFailed(true)}/>:<View style={styles.fallback}><FileText size={26} color={colors.muted}/>{!hideFilename&&<Text numberOfLines={2} style={styles.label}>{name}</Text>}</View>}
  </Pressable>
  {onDetails&&<Pressable accessibilityRole="button" accessibilityLabel={`Attachment details: ${name}`} onPress={onDetails} style={styles.details}><Info size={15} color={colors.muted}/></Pressable>}
  {onRemove&&<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} accessibilityState={{disabled}} disabled={disabled} onPress={onRemove} style={styles.remove}><View style={styles.removeCircle}><X size={18} color={colors.foreground}/></View></Pressable>}
 </View>;
}
export function SentAttachmentThumbnail({backend,artifact,onOpen,onDetails,onSave,hideFilename=false}:{backend:{backendId:string;endpoint:string};artifact:{id:string;conversationId:number;name:string;mime:string};onOpen:()=>void;onDetails?:()=>void;onSave?:()=>void;hideFilename?:boolean}) {
 const [source,setSource]=useState<ImageSourcePropType>();
 useEffect(()=>{
  let cancelled=false;setSource(undefined);
  if(artifact.mime.startsWith('image/'))void Keychain.getGenericPassword({service:`bob.${backend.backendId}`}).then(credential=>{
   if(!cancelled&&credential)setSource({uri:`${backend.endpoint}/v1/chats/${artifact.conversationId}/artifacts/${artifact.id}`,headers:{Authorization:`Bearer ${credential.password}`,'x-bob-backend':backend.backendId}});
  }).catch(()=>{});
  return ()=>{cancelled=true;};
 },[backend.backendId,backend.endpoint,artifact.id,artifact.conversationId,artifact.mime]);
 return <View style={styles.sentRow}>
  <AttachmentThumbnail name={artifact.name} mime={artifact.mime} source={source} onOpen={onOpen} onDetails={onDetails} hideFilename={hideFilename}/>
  {onSave&&<Pressable accessibilityRole="button" accessibilityLabel={`Save ${artifact.name}`} onPress={onSave} style={styles.save}><Download size={18} color={colors.foreground}/></Pressable>}
 </View>;
}
const styles=StyleSheet.create({
 tile:{width:96,minHeight:136,position:'relative',alignItems:'center'},
 sentRow:{flexDirection:'row',alignItems:'flex-end',gap:6},
 save:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,marginBottom:28},
 preview:{width:96,height:112,borderRadius:16,overflow:'hidden',backgroundColor:colors.surface},
 details:{width:36,height:24,alignItems:'center',justifyContent:'center',marginTop:0},
 image:{width:'100%',height:'100%'},
 fallback:{flex:1,alignItems:'center',justifyContent:'center',padding:8,gap:6},
 label:{fontSize:11,color:colors.foreground,textAlign:'center'},
 remove:{position:'absolute',top:-4,right:-4,width:44,height:44,alignItems:'center',justifyContent:'center'},
 removeCircle:{width:28,height:28,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
});
