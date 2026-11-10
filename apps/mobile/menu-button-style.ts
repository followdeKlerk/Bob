import type {ThemeTokens} from './theme-context';

/** Reference-button chrome for non-chat controls only. Never apply to content,
 * fields, drawing pixels or the chat composer/attachment controls. */
export function menuButtonChrome({colors,shadows}:Pick<ThemeTokens,'colors'|'shadows'>){
 const surface={backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,...shadows.floating};
 return {
  circle:{...surface,width:48,height:48,minWidth:48,minHeight:48,borderRadius:24,flexShrink:0,alignItems:'center' as const,justifyContent:'center' as const},
  pill:{...surface,minWidth:48,minHeight:48,maxWidth:'100%' as const,borderRadius:999,flexShrink:1,paddingHorizontal:16,paddingVertical:10,alignItems:'center' as const,justifyContent:'center' as const},
  label:{textAlign:'center' as const,textAlignVertical:'center' as const,includeFontPadding:false},
  selected:{backgroundColor:colors.selectedSurface,borderColor:colors.foreground},
  primary:{borderColor:colors.foreground},
 };
}
