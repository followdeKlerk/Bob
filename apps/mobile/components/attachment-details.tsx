import React from 'react';
import {Modal,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {Text} from './app-text';
import {SectionHeading,SectionBody,SectionActions,SectionAction} from './section-ui';
import {attachmentType,type AttachmentKind} from './attachment-type';
import {themed,useTheme,useThemedValue} from '../theme';

const typeLabels:Record<AttachmentKind,string>={image:'Image',audio:'Audio',video:'Video',apk:'Android app',pdf:'PDF document',text:'Text document',code:'Code',archive:'Archive',document:'Document',sheet:'Spreadsheet',slides:'Presentation',file:'File'};
function readableSize(bytes:number){
 if(bytes<1024)return `${bytes} ${bytes===1?'byte':'bytes'}`;
 const units=['KB','MB','GB','TB'],unit=Math.min(Math.floor(Math.log(bytes)/Math.log(1024))-1,units.length-1);
 return `${Number((bytes/1024**(unit+1)).toFixed(2))} ${units[unit]}`;
}

/** Local display metadata only: opening details never authorizes a file request. */
export function AttachmentDetails({artifact,onClose}:{artifact:{name:string;mime:string;size:number};onClose:()=>void}){
 const {colors}=useTheme(),styles=useThemedValue(stylesTheme);
 const type=attachmentType(artifact.name,artifact.mime);
 return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
  <SafeAreaProvider style={styles.backdrop}>
   <SafeAreaView edges={['top','right','bottom','left']} style={styles.safe}>
    <View testID="attachment-details-sheet" accessibilityViewIsModal style={styles.sheet}>
     <SectionHeading title="Attachment details"/>
     <SectionBody surfaceColor={colors.panel} style={{flex:undefined,flexShrink:1}} footer={<SectionActions overlay leading={<SectionAction label="Close attachment details" text="Close" onPress={onClose}/>}/>}>{clearance=>
     <ScrollView style={styles.scroll} contentContainerStyle={[styles.content,{paddingBottom:clearance+24}]} showsVerticalScrollIndicator={false}>
      <Text typography="ui" selectable style={styles.filename}>{artifact.name}</Text>
      <View style={styles.field}><Text typography="ui" style={styles.label}>Type</Text><Text typography="ui" style={styles.value}>{typeLabels[type.kind]}</Text></View>
      <View style={styles.field}><Text typography="ui" style={styles.label}>MIME type</Text><Text selectable style={styles.value}>{artifact.mime}</Text></View>
      <View style={styles.field}><Text typography="ui" style={styles.label}>Size</Text><Text typography="ui" style={styles.value}>{readableSize(artifact.size)}</Text></View>
     </ScrollView>
     }</SectionBody>
    </View>
   </SafeAreaView>
  </SafeAreaProvider>
 </Modal>;
}
const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 backdrop:{flex:1,backgroundColor:'rgba(0,0,0,0.45)'},
 safe:{flex:1,padding:16,justifyContent:'flex-end'},
 sheet:{...menuChrome.card,borderWidth:0,width:'100%',maxWidth:520,maxHeight:'85%',alignSelf:'center'},
 scroll:{flexGrow:0,flexShrink:1},
 content:{paddingHorizontal:16,paddingTop:16,paddingBottom:24,gap:16},
 filename:{color:colors.foreground,fontSize:20,lineHeight:28,fontWeight:'600'},
 field:{gap:4},
 label:{color:colors.muted,fontSize:12,lineHeight:18},
 value:{color:colors.body,fontSize:15,lineHeight:23},
}));
