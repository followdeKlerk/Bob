// Warm ivory is shared by text, icons, primary controls and bottom navigation.
const warmWhite='#e8e0d2' as const;
export const colors = {background:'#000000', navigationSurface:warmWhite, panel:'#191919', iconSurface:'#262626', selectedSurface:'#303030', selectedBorder:'#737373', surface:'#272727', composer:'#242424', foreground:warmWhite, body:warmWhite, muted:'#a1a1a1', border:'#3f3f3f', subtle:'#2b2b2b', accent:warmWhite, onAccent:'#000000'} as const;

// Menu geometry is semantic: panels/cards share one shape, controls another.
// Switch tracks, colour swatches and the liquid navigation silhouette are not cards.
export const menuRadii={card:20,control:14,icon:10} as const;
export const menuChrome={
 card:{borderRadius:menuRadii.card,borderWidth:1,borderColor:colors.border,backgroundColor:colors.panel},
 control:{borderRadius:menuRadii.control,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 input:{borderRadius:menuRadii.control,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 icon:{borderRadius:menuRadii.icon,backgroundColor:colors.iconSurface},
 selected:{borderColor:colors.selectedBorder,backgroundColor:colors.selectedSurface},
} as const;
