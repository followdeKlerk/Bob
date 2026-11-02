const destinations=['Notes','Workstations','Chat','Agents','Sessions','Settings'] as const;
export function menuDestination(screen:string,trail:readonly string[]):typeof destinations[number]{
 const isDestination=(value:string):value is typeof destinations[number]=>destinations.some(item=>item===value);
 if(isDestination(screen))return screen;
 for(let i=trail.length-1;i>=0;i--)if(isDestination(trail[i]))return trail[i] as typeof destinations[number];
 return 'Settings';
}
