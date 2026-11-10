import {SETTINGS_PAGES} from './settings-routes';
const destinations=['Notes','Workstations','Chat','Agents','Sessions','Terminal','Settings'] as const;
export function menuDestination(screen:string,trail:readonly string[]):typeof destinations[number]{
 const isDestination=(value:string):value is typeof destinations[number]=>destinations.some(item=>item===value);
 if(screen==='Sessions')return 'Agents';
 if(SETTINGS_PAGES.includes(screen)||screen==='Modules')return 'Settings';
 if(isDestination(screen))return screen;
 for(let i=trail.length-1;i>=0;i--)if(isDestination(trail[i]))return trail[i]==='Sessions'?'Agents':trail[i] as typeof destinations[number];
 return 'Settings';
}
