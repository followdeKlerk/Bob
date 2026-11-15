// Semantic palettes. Never recolor drawing paper or user-generated visuals.
// Chat gets dedicated deeper-beige surfaces, not the shared selection/panel colors.
const warmWhite='#e8e0d2' as const;
export const darkColors={background:'#1b1c1d',navigationSurface:warmWhite,assistantBubble:'#292a2c',ownerBubble:'#424346',bubbleMuted:'#b6b5b1',panel:'#292a2c',iconSurface:'#333436',selectedSurface:'#424346',selectedBorder:'#91918d',surface:'#333436',composer:'#333436',foreground:warmWhite,body:warmWhite,muted:'#b6b5b1',border:'#545557',subtle:'#3b3c3e',accent:warmWhite,onAccent:'#000000',navigationInk:'#111111',destructive:'#5c5c5c',danger:'#efa99e'} as const;
export type ThemeColors={[K in keyof typeof darkColors]:string};
export const lightColors:ThemeColors={background:'#e8dfd0',navigationSurface:'#e5dfd4',assistantBubble:'#d5c5ae',ownerBubble:'#ddcfbb',bubbleMuted:'#554d40',panel:'#f0e8dc',iconSurface:'#e9e4da',selectedSurface:'#e2ddd2',selectedBorder:'#736b5e',surface:'#eee5d8',composer:'#f0e8dc',foreground:'#292720',body:'#343129',muted:'#655f54',border:'#958d7f',subtle:'#e6e0d5',accent:'#302d27',onAccent:'#fffdf8',navigationInk:'#3e382e',destructive:'#e2ddd2',danger:'#9b3428'};
// Compatibility for non-rendering consumers; app components use useTheme.
export const colors=darkColors;
export const menuRadii={card:24,control:24,icon:14} as const;
export function makeMenuChrome(colors:ThemeColors){return {
 card:{borderRadius:menuRadii.card,borderWidth:1,borderColor:colors.subtle,backgroundColor:colors.panel},
 control:{borderRadius:menuRadii.control,minHeight:48,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 input:{borderRadius:menuRadii.control,minHeight:48,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
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
