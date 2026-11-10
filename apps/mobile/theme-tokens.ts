// Semantic palettes. Never recolor drawing paper or user-generated visuals.
// Chat gets dedicated deeper-beige surfaces, not the shared selection/panel colors.
const warmWhite='#e8e0d2' as const;
export const darkColors={background:'#000000',navigationSurface:warmWhite,assistantBubble:'#191919',ownerBubble:'#303030',bubbleMuted:'#a1a1a1',panel:'#191919',iconSurface:'#262626',selectedSurface:'#303030',selectedBorder:'#737373',surface:'#272727',composer:'#242424',foreground:warmWhite,body:warmWhite,muted:'#a1a1a1',border:'#3f3f3f',subtle:'#2b2b2b',accent:warmWhite,onAccent:'#000000',navigationInk:'#111111',destructive:'#5c5c5c'} as const;
export type ThemeColors={[K in keyof typeof darkColors]:string};
export const lightColors:ThemeColors={background:'#e8dfd0',navigationSurface:'#e5dfd4',assistantBubble:'#d5c5ae',ownerBubble:'#ddcfbb',bubbleMuted:'#554d40',panel:'#f0e8dc',iconSurface:'#e9e4da',selectedSurface:'#e2ddd2',selectedBorder:'#736b5e',surface:'#eee5d8',composer:'#f0e8dc',foreground:'#292720',body:'#343129',muted:'#655f54',border:'#958d7f',subtle:'#e6e0d5',accent:'#302d27',onAccent:'#fffdf8',navigationInk:'#3e382e',destructive:'#e2ddd2'};
// Compatibility for non-rendering consumers; app components use useTheme.
export const colors=darkColors;
export const menuRadii={card:20,control:14,icon:10} as const;
export function makeMenuChrome(colors:ThemeColors){return {
 card:{borderRadius:menuRadii.card,borderWidth:1,borderColor:colors.border,backgroundColor:colors.panel},
 control:{borderRadius:menuRadii.control,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 input:{borderRadius:menuRadii.control,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 icon:{borderRadius:menuRadii.icon,backgroundColor:colors.iconSurface},
 selected:{borderColor:colors.selectedBorder,backgroundColor:colors.selectedSurface},
} as const;}
export const menuChrome=makeMenuChrome(colors);

// Preserve stored note shade IDs and their relative light/dark ordering.
export const noteShades={
 dark:{neutral:darkColors.surface,sage:'#303030',sand:'#383838',blue:'#202020',rose:'#444444'},
 light:{neutral:lightColors.surface,sage:'#ded7cb',sand:'#e9e3d9',blue:'#d3ccbf',rose:'#f1ede6'},
} as const;

// Optical depth only: boxShadow avoids Android elevation changing stacking order.
// Keep ordinary cards, transcript bubbles and transparent icon targets flat.
export function makeSurfaceShadows(scheme:'light'|'dark'){
 const ink=scheme==='light'?'62, 56, 46':'0, 0, 0';
 return {
  floating:{boxShadow:`0 2px 7px rgba(${ink}, ${scheme==='light'?0.11:0.08})`},
  popup:{boxShadow:`0 3px 11px rgba(${ink}, ${scheme==='light'?0.13:0.10})`},
 };
}

// Quiet task-state accents, separate from the app's neutral navigation palette.
export const activityTones={
 light:{running:{ink:'#315c82',fill:'#e4edf4'},done:{ink:'#35634b',fill:'#e4eee5'},failed:{ink:'#904034',fill:'#f6e8e3'}},
 dark:{running:{ink:'#adcbe3',fill:'#192c3b'},done:{ink:'#a9c9b1',fill:'#1b3023'},failed:{ink:'#efb5ab',fill:'#3c2422'}},
} as const;
