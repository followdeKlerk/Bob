import React from 'react';
import {Palette,MessageCircle,Bell,Volume2,Smartphone,Wifi,Clock3,Settings,Blocks} from 'lucide-react-native';
import {SettingsGroup,SettingsRow} from './section-ui';

export {SETTINGS_PAGES} from '../settings-routes';
/** A navigation index only. Forms and permission actions belong to their page. */
export function SettingsHome({onOpen,readOnly}:{onOpen:(name:string)=>void;readOnly:boolean}){
 return <>
  <SettingsGroup title="Preferences">
   <SettingsRow title="Appearance" icon={Palette} value="Light, dark or system" onPress={()=>onOpen('Appearance')}/>
   <SettingsRow title="Notifications" icon={Bell} value="Reply alerts and Android permissions" onPress={()=>onOpen('Notifications')}/>
   <SettingsRow title="Voice" icon={Volume2} value="Read-aloud voice and speed" onPress={()=>onOpen('Voice')}/>
  </SettingsGroup>
  <SettingsGroup title="Conversation & tools">
   <SettingsRow title="Conversation settings" icon={MessageCircle} value="Instructions and working folder" onPress={()=>onOpen('Conversation settings')}/>
   <SettingsRow title="Schedules" label="Reminders & recurring checks" icon={Clock3} value="Saved reminders and recurring checks" onPress={()=>onOpen('Schedules')}/>
   {!readOnly&&<SettingsRow title="Phone & location" icon={Smartphone} value="Phone tools, permissions and location" onPress={()=>onOpen('Phone & location')}/>}
  </SettingsGroup>
  <SettingsGroup title="App & workstation">
   <SettingsRow title="Connection" icon={Wifi} value="Keep connected and battery settings" onPress={()=>onOpen('Connection')}/>
   <SettingsRow title="App & updates" icon={Settings} value="Build, install and diagnostics" onPress={()=>onOpen('App & updates')}/>
   {!readOnly&&<SettingsRow title="Advanced" icon={Blocks} value="Modules and provider credentials" onPress={()=>onOpen('Advanced')}/>}
  </SettingsGroup>
 </>;
}
