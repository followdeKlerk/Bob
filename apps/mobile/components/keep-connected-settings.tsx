import React from 'react';
import {View} from 'react-native';
import {Battery,Wifi} from 'lucide-react-native';
import {Text} from './app-text';
import {SettingsGroup,SettingsRow,SectionAction} from './section-ui';
import {useTheme} from '../theme';
import type {KeepConnectedState} from '../keep-connected';
const labels={off:'Off',connecting:'Connecting',connected:'Connected',reconnecting:'Offline · reconnecting',attention:'Needs attention'};
export function KeepConnectedSettings({state}:{state:KeepConnectedState}){
 const {colors}=useTheme(),caption={color:colors.muted,fontSize:13,lineHeight:20,paddingBottom:8};
 return <SettingsGroup title="Keep connected">
  <SettingsRow title="Keep connected" label={state.enabled?'Disable keep connected':'Enable keep connected'} icon={Wifi} checked={state.enabled} loading={state.busy} disabled={!state.supported||!state.enabled&&!state.canEnable} onPress={()=>void state.toggle()}/>
  <Text typography="ui" accessibilityLiveRegion="polite" style={caption}>{state.enabled?(state.status==='off'?'Paused · open a conversation to resume':labels[state.status]):labels.off}</Text>
  <Text typography="ui" style={caption}>Keeps a small native connection alive while Bob is in the background or your phone is locked, with a persistent Android notification. Follows the selected workstation and conversation; the full transcript catches up when you reopen Bob.</Text>
  <Text typography="ui" style={caption}>This does not allow phone tools while locked. Uses more battery. Android, force-stop, a lost network or a stopped VPN can still interrupt it; reopen Bob if Android stops the service.</Text>
  {state.supported?<>
   {!state.enabled&&!state.canEnable&&<Text typography="ui" style={caption}>Select a workstation and open a conversation before enabling Keep connected.</Text>}
   <SettingsRow title="App & battery" label="Keep connected battery settings" icon={Battery} value={state.batteryRestricted?'Battery restrictions may apply':'Android battery optimization is off'} onPress={()=>void state.openBatterySettings()}/>
   <Text typography="ui" style={caption}>For better reliability, allow unrestricted background use for Bob and, if you connect through Tailscale, Tailscale too. Phone makers may have additional battery restrictions.</Text>
   <View style={{alignItems:'flex-start',paddingBottom:8}}><SectionAction label="Refresh connection status" text="Refresh status" disabled={state.busy} onPress={()=>void state.refresh()}/></View>
  </>:<Text typography="ui" style={caption}>Keep connected requires the updated Android app.</Text>}
  {!!state.error&&<Text typography="ui" accessibilityLiveRegion="polite" style={{...caption,color:colors.foreground}}>{state.error}</Text>}
 </SettingsGroup>;
}
