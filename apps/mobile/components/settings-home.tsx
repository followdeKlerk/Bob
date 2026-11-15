import React from 'react';
import {Palette,MessageCircle,Bell,Volume2,Smartphone,Wifi,Clock3,Settings,Blocks,Database,BookOpen,FileText} from 'lucide-react-native';
import {SettingsGroup,SettingsRow} from './section-ui';
import {useTheme} from '../theme';

export {SETTINGS_PAGES} from '../settings-routes';
/** A navigation index only. Forms and permission actions belong to their page. */
export function SettingsHome({onOpen,readOnly}:{onOpen:(name:string)=>void;readOnly:boolean}){
 const {preference}=useTheme();
 const appearance={system:'System',light:'Light',dark:'Dark'}[preference];
 return <>
  <SettingsGroup title="Preferences">
   <SettingsRow title="Appearance" icon={Palette} value={appearance} valuePlacement="trailing" onPress={()=>onOpen('Appearance')}/>
   <SettingsRow title="Notifications" icon={Bell} onPress={()=>onOpen('Notifications')}/>
   <SettingsRow title="Voice" icon={Volume2} onPress={()=>onOpen('Voice')}/>
  </SettingsGroup>
  <SettingsGroup title="Conversation & tools">
   <SettingsRow title="Conversation settings" icon={MessageCircle} onPress={()=>onOpen('Conversation settings')}/>
   <SettingsRow title="Schedules" label="Reminders & recurring checks" icon={Clock3} onPress={()=>onOpen('Schedules')}/>
   {!readOnly&&<SettingsRow title="Phone & location" icon={Smartphone} onPress={()=>onOpen('Phone & location')}/>}
  </SettingsGroup>
  {!readOnly&&<SettingsGroup title="Knowledge">
   <SettingsRow title="Skills" icon={BookOpen} onPress={()=>onOpen('Skills')}/>
   <SettingsRow title="Instructions & templates" icon={FileText} onPress={()=>onOpen('Prompts')}/>
  </SettingsGroup>}
  <SettingsGroup title="App & workstation">
   <SettingsRow title="Connection" icon={Wifi} onPress={()=>onOpen('Connection')}/>
   <SettingsRow title="Storage & cache" icon={Database} onPress={()=>onOpen('Storage & cache')}/>
   <SettingsRow title="App & updates" icon={Settings} onPress={()=>onOpen('App & updates')}/>
   {!readOnly&&<SettingsRow title="Advanced" icon={Blocks} onPress={()=>onOpen('Advanced')}/>}
  </SettingsGroup>
 </>;
}
