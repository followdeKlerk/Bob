import React from 'react';
import {View} from 'react-native';
import {Smartphone,ShieldCheck} from 'lucide-react-native';
import {Text} from './app-text';
import {SettingsGroup,SettingsRow,SectionAction} from './section-ui';
import {useTheme} from '../theme';
import type {PhoneToolsState} from '../phone-tools';

export function PhoneToolsSettings({state}:{state:PhoneToolsState}){
 const {colors}=useTheme();
 return <SettingsGroup title="Phone tools">
  <SettingsRow title="Phone tools" label={state.enabled?'Disable phone tools':'Enable phone tools'} icon={Smartphone} checked={state.enabled} loading={state.busy} disabled={!state.supported} onPress={()=>void state.toggle()}/>
  <Text style={{color:colors.muted,fontSize:12,lineHeight:20,paddingBottom:8}}>Personal prototype. When enabled, this backend can run routine phone actions automatically, without asking for each command. Tools work only while Bob is open in the foreground.</Text>
  <Text style={{color:colors.muted,fontSize:12,lineHeight:20,paddingBottom:8}}>Requested phone data and action results are shared with the connected backend and its configured model, and may remain in chat history. Enable only for a backend and model you trust.</Text>
  {state.supported?<>
   <SettingsRow title="Android permissions" label="Request phone tools permissions" icon={ShieldCheck} value={state.permissions} disabled={state.busy} onPress={()=>void state.requestPermissions()}/>
   <Text style={{color:colors.muted,fontSize:12,lineHeight:20,paddingBottom:8}}>Calendar, contacts and camera access are requested when enabling. Denied permissions affect only related tools. Android may still open its own app screens for calls, messages or sharing.</Text>
   <View style={{alignItems:'flex-start',paddingBottom:8}}><SectionAction label="Refresh phone tools status" text="Refresh status" disabled={state.busy} onPress={()=>void state.refresh()}/></View>
  </>:<Text style={{color:colors.muted,fontSize:12,lineHeight:20,paddingBottom:8}}>Phone tools require the updated Android app.</Text>}
  {!!state.error&&<Text accessibilityLiveRegion="polite" style={{color:colors.foreground,fontSize:13,lineHeight:20,paddingBottom:8}}>{state.error}</Text>}
 </SettingsGroup>;
}
