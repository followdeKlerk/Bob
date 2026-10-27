import React from 'react';
import {Pressable,Text,View,StyleSheet} from 'react-native';
import {SentAttachmentThumbnail} from './attachment-thumbnail';
import {colors} from '../theme';
export function FileAttachment({backend,artifact,fromBob,onOpen,onSave}:{backend:{backendId:string;endpoint:string};artifact:{id:string;conversationId:number;name:string;mime:string;size:number};fromBob:boolean;onOpen:()=>void;onSave:()=>void}){
 return <View style={{gap:8}}>
  {fromBob&&<Text style={styles.caption}>File from Bob</Text>}
  <Text selectable style={styles.name}>{artifact.name}</Text>
  <Text style={styles.caption}>{artifact.size===0?'0 bytes':`${Math.max(1,Math.ceil(artifact.size/1024))} KB`}</Text>
  <SentAttachmentThumbnail backend={backend} artifact={artifact} onOpen={onOpen}/>
  <Pressable accessibilityRole="button" accessibilityLabel={`Save ${artifact.name}`} onPress={onSave} style={styles.button}><Text style={styles.action}>Save file</Text></Pressable>
 </View>;
}
const styles=StyleSheet.create({caption:{fontSize:13,color:colors.muted},name:{fontSize:16,lineHeight:22,color:colors.foreground},button:{minHeight:48,paddingHorizontal:16,paddingVertical:12,borderRadius:14,backgroundColor:colors.surface,justifyContent:'center',alignItems:'center'},action:{fontSize:16,color:colors.foreground}});
