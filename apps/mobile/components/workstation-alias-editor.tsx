import {withMenuTheme} from '../menu-theme';
import React,{useState} from 'react';
import {Modal,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Text,TextInput} from './app-text';
import {TouchTarget} from './touch-target';
import {cleanWorkstationAlias,type Workstation} from '../workstation-label';
import {themed,useThemedValue} from '../theme';
function WorkstationAliasEditorContent({workstation,onSave,onClose}:{workstation:Workstation;onSave:(alias:string)=>Promise<void>;onClose:()=>void}){
 const s=useThemedValue(styles),[value,setValue]=useState(workstation.alias??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){if(busy)return;setError('');try{const alias=cleanWorkstationAlias(value);setBusy(true);await onSave(alias);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Modal visible transparent animationType="fade" onRequestClose={()=>{if(!busy)onClose();}}><SafeAreaView style={s.overlay}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}><View accessibilityViewIsModal style={s.card}>
  <Text typography="ui" accessibilityRole="header" style={s.title}>Workstation alias</Text>
  <Text typography="ui" style={s.body}>{workstation.name}</Text>
  <TextInput typography="ui" accessibilityLabel="Workstation alias" autoFocus value={value} onChangeText={setValue} editable={!busy} placeholder="e.g. Desktop or Laptop" style={s.input}/>
  <Text typography="ui" style={s.body}>Up to 24 characters. Used on this phone and in notifications. Leave blank to use the short workstation name. Pairing and the computer’s name stay unchanged.</Text>
  {!!error&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.body}>{error}</Text>}
  <View style={s.actions}><TouchTarget accessibilityRole="button" accessibilityLabel="Cancel workstation alias" disabled={busy} onPress={onClose} style={s.button}><Text typography="ui" style={s.body}>Cancel</Text></TouchTarget><TouchTarget accessibilityRole="button" accessibilityLabel="Save workstation alias" disabled={busy} onPress={()=>void save()} style={s.button}><Text typography="ui" style={s.body}>{busy?'Saving…':'Save'}</Text></TouchTarget></View>
 </View></ScrollView></SafeAreaView></Modal>;
}
const styles=themed(({colors,menuChrome})=>StyleSheet.create({overlay:{flex:1,backgroundColor:'#00000088'},scroll:{flexGrow:1,justifyContent:'center',padding:20},card:{...menuChrome.card,backgroundColor:colors.background,padding:16,gap:12},title:{fontSize:19,lineHeight:27,color:colors.foreground},body:{fontSize:14,lineHeight:22,color:colors.foreground},input:{...menuChrome.input,minHeight:48,padding:12,fontSize:16,color:colors.foreground},actions:{flexDirection:'row',justifyContent:'space-between',gap:12},button:{minHeight:48,minWidth:64,padding:12,justifyContent:'center'}}));

export const WorkstationAliasEditor=withMenuTheme(WorkstationAliasEditorContent);
