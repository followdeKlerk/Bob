import {Text} from './app-text';
import React,{useEffect,useState} from 'react';
import {Image,Pressable,StyleSheet,View,type ImageSourcePropType} from 'react-native';
import {Download,FileText,Info,X,File,FileArchive,FileCode,FileSpreadsheet,FileVideo,FileAudio,FileImage,FileType,Package,Presentation} from 'lucide-react-native';
import {attachmentType,type AttachmentKind} from './attachment-type';
import * as Keychain from 'react-native-keychain';
import {themed,useTheme,useThemedValue} from '../theme';

const icons:Record<AttachmentKind,typeof FileText>={image:FileImage,audio:FileAudio,video:FileVideo,apk:Package,pdf:FileType,text:FileText,code:FileCode,archive:FileArchive,document:FileText,sheet:FileSpreadsheet,slides:Presentation,file:File};

export type DraftAttachment={id:string;uri:string;name:string;mime:string;drawingData?:string};
export function AttachmentThumbnail({name,mime,source,onOpen,openLabel,onRemove,onDetails,onSave,hideFilename=false,disabled=false}:{name:string;mime:string;source?:ImageSourcePropType;onOpen?:()=>void;openLabel?:string;onRemove?:()=>void;onDetails?:()=>void;onSave?:()=>void;hideFilename?:boolean;disabled?:boolean}) {
 const {colors}=useTheme();
 const styles=useThemedValue(stylesTheme);

 const type=attachmentType(name,mime),TypeIcon=icons[type.kind]??FileText;
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[source]);
 return <View style={styles.tile}>
  <Pressable accessibilityRole={onOpen?'button':'image'} accessibilityLabel={openLabel??(hideFilename?(onOpen?'Open attachment':'Attachment'):onOpen?`Open ${name}`:name)} onPress={onOpen} disabled={!onOpen} style={styles.preview}>
   {type.kind==='image'&&source&&!failed?<Image source={source} resizeMode="cover" resizeMethod="resize" style={styles.image} onError={()=>setFailed(true)}/>:<View style={styles.fallback}><TypeIcon size={26} color={colors.foreground}/><Text style={styles.badge}>{type.badge}</Text>{!hideFilename&&<Text numberOfLines={2} style={styles.label}>{name}</Text>}</View>}
  </Pressable>
  {(onDetails||onSave)&&<View style={styles.actions} testID="attachment-actions">
   {onDetails&&<Pressable accessibilityRole="button" accessibilityLabel={`Attachment details: ${name}`} onPress={onDetails} style={styles.details}><Info size={15} color={colors.muted}/></Pressable>}
   {onSave&&<Pressable accessibilityRole="button" accessibilityLabel={`Save ${name}`} onPress={onSave} style={styles.details}><Download size={15} color={colors.muted}/></Pressable>}
  </View>}
  {onRemove&&<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} accessibilityState={{disabled}} disabled={disabled} onPress={onRemove} style={styles.remove}><View style={styles.removeCircle}><X size={18} color={colors.foreground}/></View></Pressable>}
 </View>;
}
export function SentAttachmentThumbnail({backend,artifact,onOpen,openLabel,onDetails,onSave,hideFilename=false}:{backend:{backendId:string;endpoint:string};artifact:{id:string;conversationId:number;name:string;mime:string};onOpen:()=>void;openLabel?:string;onDetails?:()=>void;onSave?:()=>void;hideFilename?:boolean}) {
 const styles=useThemedValue(stylesTheme);

 const [source,setSource]=useState<ImageSourcePropType>();
 useEffect(()=>{
  let cancelled=false;setSource(undefined);
  if(attachmentType(artifact.name,artifact.mime).kind==='image')void Keychain.getGenericPassword({service:`bob.${backend.backendId}`}).then(credential=>{
   if(!cancelled&&credential)setSource({uri:`${backend.endpoint}/v1/chats/${artifact.conversationId}/artifacts/${artifact.id}`,headers:{Authorization:`Bearer ${credential.password}`,'x-bob-backend':backend.backendId}});
  }).catch(()=>{});
  return ()=>{cancelled=true;};
 },[backend.backendId,backend.endpoint,artifact.id,artifact.conversationId,artifact.mime,artifact.name]);
 return <View style={styles.sentRow}>
  <AttachmentThumbnail name={artifact.name} mime={artifact.mime} source={source} onOpen={onOpen} openLabel={openLabel} onDetails={onDetails} onSave={onSave} hideFilename={hideFilename}/>
 </View>;
}
const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 tile:{width:96,minHeight:136,position:'relative',alignItems:'center'},
 sentRow:{alignSelf:'flex-start'},
 actions:{flexDirection:'row',alignItems:'center',justifyContent:'center'},
 preview:{...menuChrome.card,width:96,height:112,overflow:'hidden',backgroundColor:colors.surface},
 details:{width:48,height:48,alignItems:'center',justifyContent:'center',marginTop:0},
 image:{width:'100%',height:'100%'},
 fallback:{flex:1,alignItems:'center',justifyContent:'center',padding:8,gap:6},
 badge:{fontSize:12,fontWeight:'700',color:colors.foreground,textAlign:'center'},
 label:{fontSize:11,color:colors.foreground,textAlign:'center'},
 remove:{position:'absolute',top:-4,right:-4,width:44,height:44,alignItems:'center',justifyContent:'center'},
 removeCircle:{width:28,height:28,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
}));
