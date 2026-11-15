import {selectionHaptic} from '../haptics';
import {TouchTarget} from './touch-target';
import {menuButtonChrome} from '../menu-button-style';
import {Text} from './app-text';
import React from 'react';
import {ActivityIndicator,StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
import {ArrowLeft,ChevronRight,type LucideIcon} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {Button} from './ui/button';
import {Tabs,TabsList,TabsTrigger} from './ui/tabs';
import {Text as ControlText} from './ui/text';
import {EdgeFade} from './edge-fade';

export const SECTION_HEADING_TOP=28;

/** Shared chrome for non-chat destinations. Keep content readable as text grows. */
export const sectionStylesTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({
 heading:{paddingHorizontal:16,paddingTop:SECTION_HEADING_TOP,paddingBottom:8,flexShrink:0},
 footer:{paddingHorizontal:16,paddingVertical:8,flexDirection:'row',alignItems:'flex-end',gap:8,flexShrink:0,backgroundColor:colors.background,borderTopWidth:0,borderTopColor:colors.subtle},
 headingRow:{flexDirection:'row',alignItems:'flex-start',minHeight:30},
 menu:{flexShrink:0,minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
 toolbar:{flex:1,minWidth:0,flexDirection:'row',flexWrap:'wrap',alignItems:'flex-end',gap:8},
 leading:{flexShrink:0,maxWidth:'100%'},
 actions:{flexDirection:'row',flexWrap:'wrap',flexGrow:1,flexShrink:1,maxWidth:'100%',justifyContent:'flex-end',alignItems:'flex-start',gap:8,marginLeft:'auto'},
 titleBox:{flex:1,minWidth:0,minHeight:30,justifyContent:'center'},
 title:{color:colors.foreground,fontSize:24,lineHeight:30,fontWeight:'600',letterSpacing:-.5,flexShrink:1},
 subtitle:{color:colors.muted,fontSize:13,lineHeight:20,marginTop:4},
}));
/** Orientation stays at the top; thumb-reachable controls live in SectionActions. */
export function SectionHeading({title,subtitle,style}:{title:string;subtitle?:string;style?:StyleProp<ViewStyle>}){
 const s=useThemedValue(sectionStylesTheme);
 return <View pointerEvents="box-none" testID="section-heading" style={[s.heading,style]}>
  <View pointerEvents="box-none" testID="section-heading-row" style={s.headingRow}>
   <View pointerEvents="none" style={s.titleBox}><Text typography="ui" accessibilityRole="header" style={s.title}>{title}</Text></View>
  </View>
  {!!subtitle&&<Text typography="ui" testID="section-heading-subtitle" style={s.subtitle}>{subtitle}</Text>}
 </View>;
}
/** Full-height scroll host: the footer is absolute, never an in-flow cutoff.
 * Render functions are called normally (not mounted as component types), so
 * measurements update padding without replacing lists, inputs or draft state.
 * Insets belong to the existing screen/Modal parent, not this inner frame.
 * Include every persistent footer row in `footer` so its full height is measured.
 * Disable fadeTop on non-scrolling document canvases: never tint editable pixels. */
export function SectionBody({footer,children,surfaceColor,style,fadeTop=true}:{fadeTop?:boolean;footer:React.ReactNode;children:(clearance:number)=>React.ReactNode;surfaceColor?:string;style?:StyleProp<ViewStyle>}){
 const [height,setHeight]=React.useState(80);
 const clearance=height+12;
 return <View testID="section-scroll-host" style={[{flex:1,minHeight:0},style]}>
  {children(clearance)}
  {fadeTop&&<EdgeFade edge="top" height={16} color={surfaceColor}/>}
  <EdgeFade edge="bottom" height={clearance} color={surfaceColor}/>
  <View testID="section-footer-overlay" pointerEvents="box-none" style={{position:'absolute',left:0,right:0,bottom:0}} onLayout={event=>{
   const next=event.nativeEvent.layout.height;
   if(Number.isFinite(next)&&next>0)setHeight(next);
  }}>{footer}</View>
 </View>;
}
/** Controls use natural flow, including wrapped large text. Normal screen hosts
 * reserve this below an expanding body; floating hosts must reserve its measured
 * height in scroll clearance. Overlay mode leaves the host fade visible and
 * removes the hard divider. The host owns safe-area/IME insets once.
 * Return stays left, page actions follow, and Menu stays at the bottom right. */
export function SectionActions({onBack,leading,children,menu,overlay=false}:{onBack?:()=>void;leading?:React.ReactNode;children?:React.ReactNode;menu?:React.ReactNode;overlay?:boolean}){
 const s=useThemedValue(sectionStylesTheme);
 const hasActions=React.Children.toArray(children).length>0;
 const returnControl=leading??(onBack?<RoundAction label="Back to previous menu" icon={ArrowLeft} onPress={onBack}/>:undefined);
 if(!returnControl&&!hasActions&&!menu)return null;
 return <View pointerEvents="box-none" testID="section-footer" style={[s.footer,overlay&&{backgroundColor:'transparent',borderTopWidth:0}]}>
  <View pointerEvents="box-none" testID="section-footer-toolbar" style={s.toolbar}>
   {!!returnControl&&<View pointerEvents="box-none" testID="section-footer-leading" style={s.leading}>{returnControl}</View>}
   {hasActions&&<View pointerEvents="box-none" testID="section-footer-actions" style={s.actions}>{children}</View>}
  </View>
  {!!menu&&<View pointerEvents="box-none" testID="section-footer-menu" style={s.menu}>{menu}</View>}
 </View>;
}
/** Use the licensed React Native Reusables asset, not bespoke boxed buttons.
 * Only palette and accessible sizing are adapted; selection adds no glyph or
 * font-weight change that could reflow the labels. Native text remains scalable. */
export function SectionSegments<T extends string>({label,options,value,onChange,style}:{label:string;options:readonly {value:T;label:string}[];value:T;onChange:(value:T)=>void;style?:StyleProp<ViewStyle>}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 return <Tabs value={value} onValueChange={next=>{const option=options.find(item=>item.value===next);if(option){if(option.value!==value)selectionHaptic();onChange(option.value);}}} style={style}><TabsList accessibilityRole="tablist" accessibilityLabel={label} style={s.segments}>{options.map(option=><TabsTrigger key={option.value} value={option.value} accessibilityRole="tab" accessibilityLabel={option.label} style={[s.segment,{backgroundColor:value===option.value?colors.selectedSurface:colors.surface,borderColor:value===option.value?colors.foreground:colors.border}]}><ControlText style={[s.segmentLabel,{color:colors.foreground}]}>{option.label}</ControlText></TabsTrigger>)}</TabsList></Tabs>;
}
export function RoundAction({label,icon:Icon,onPress,disabled=false,primary=false,selected}:{label:string;selected?:boolean;icon:LucideIcon;onPress:()=>void;disabled?:boolean;primary?:boolean;compact?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 return <Button variant="outline" size="icon" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled,...(selected===undefined?{}:{selected})}} disabled={disabled} onPress={onPress} className="rounded-full" style={[s.roundTarget,primary&&s.actionPrimary,selected&&s.actionSelected,disabled&&{opacity:.4}]}><View pointerEvents="none"><Icon size={21} color={colors.foreground}/></View></Button>;
}
/** Text page actions share geometry; keep their full accessible names. */
export function SectionAction({label,text=label,onPress,disabled=false,busy=false,primary=false}:{label:string;text?:string;onPress:()=>void;disabled?:boolean;busy?:boolean;primary?:boolean}){
 const {colors}=useTheme(),s=useThemedValue(sTheme),off=disabled||busy;
 return <Button variant="outline" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:off,busy}} disabled={off} onPress={onPress} style={[s.action,primary&&s.actionPrimary,off&&{opacity:.4}]}>{busy?<ActivityIndicator color={colors.foreground}/>:<ControlText style={[s.actionText,primary&&{fontWeight:'600'}]}>{text}</ControlText>}</Button>;
}
/** Direct rows share inset dividers without wrapper components or changing keys.
 * Keep arbitrary form/help children mounted and permission warnings in place. */
export function SettingsGroup({title,children}:{title:string;children:React.ReactNode}){
 const s=useThemedValue(sTheme);
 const items=React.Children.toArray(children);
 const grouped=items.map((child,index)=>{
  const previous=items[index-1];
  return React.isValidElement<React.ComponentProps<typeof SettingsRow>>(child)&&child.type===SettingsRow?React.cloneElement(child,{separator:React.isValidElement(previous)&&previous.type===SettingsRow}):child;
 });
 return <View style={s.group}><Text typography="ui" accessibilityRole="header" style={s.groupTitle}>{title}</Text><View testID="settings-group-body" style={s.groupBody}>{grouped}</View></View>;
}
/** Detail copy stays below by default; only short actual values opt into trailing.
 * Both layouts wrap naturally at narrow widths and with native text scaling. */
export function SettingsRow({title,label=title,icon:Icon,onPress,disabled=false,value,valuePlacement='below',checked,loading=false,separator=false}:{title:string;label?:string;icon:LucideIcon;onPress:()=>void;disabled?:boolean;value?:string;valuePlacement?:'below'|'trailing';checked?:boolean;loading?:boolean;separator?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);
 const off=disabled||loading,trailing=valuePlacement==='trailing';
 return <TouchTarget accessibilityRole={checked===undefined?"button":"switch"} accessibilityLabel={label} accessibilityValue={trailing&&value?{text:value}:undefined} accessibilityState={{disabled:off,busy:loading,...(checked===undefined?{}:{checked})}} disabled={off} onPress={onPress} style={[s.row,off&&{opacity:.4}]}>
  {separator&&<View testID="settings-row-separator" pointerEvents="none" accessible={false} style={s.rowSeparator}/>}
  <View pointerEvents="none" style={s.rowIcon}><Icon size={23} color={colors.foreground}/></View>
  <View style={[s.rowText,trailing&&s.rowTextTrailing]}><Text typography="ui" style={[s.rowTitle,trailing&&s.rowTitleTrailing]}>{title}</Text>{!!value&&<Text typography="ui" style={[s.value,trailing&&s.valueTrailing]}>{value}</Text>}</View>
  <View pointerEvents="none" style={s.rowAccessory}>{loading?<ActivityIndicator size="small" color={colors.accent}/>:checked===undefined?<ChevronRight size={18} color={colors.muted}/>:<View style={[s.switch,{backgroundColor:checked?colors.accent:colors.border,alignItems:checked?'flex-end':'flex-start'}]}><View style={[s.thumb,{backgroundColor:checked?colors.onAccent:colors.foreground}]}/></View>}</View>
 </TouchTarget>;
}
const sTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({
 action:{...menuButtonChrome({colors,shadows}).pill,height:'auto',minHeight:48,minWidth:48,maxWidth:'100%',flexShrink:1,paddingHorizontal:12,paddingVertical:8,justifyContent:'center'},
 actionSelected:{...menuButtonChrome({colors,shadows}).selected},
 actionPrimary:{...menuButtonChrome({colors,shadows}).primary},
 actionText:{...menuButtonChrome({colors,shadows}).label,color:colors.foreground,fontSize:15,lineHeight:23,fontWeight:'500',flexShrink:1,textAlign:'center'},
 switch:{width:44,height:28,borderRadius:14,padding:3,justifyContent:'center'},thumb:{width:22,height:22,borderRadius:11},
 segments:{height:'auto',minHeight:54,width:'100%',marginRight:0,alignItems:'stretch',backgroundColor:'transparent',gap:8,padding:0},
 segment:{...menuButtonChrome({colors,shadows}).pill,height:'auto',flex:1,minWidth:48,minHeight:48,paddingHorizontal:4,paddingVertical:8,justifyContent:'center'},
 segmentLabel:{...menuButtonChrome({colors,shadows}).label,fontSize:15,lineHeight:23,fontWeight:'500',textAlign:'center',flexShrink:1,minWidth:0},
 roundRaised:{...shadows.floating},
 roundTarget:{...menuButtonChrome({colors,shadows}).circle},
 group:{gap:10,marginBottom:20},groupTitle:{color:colors.muted,fontSize:14,lineHeight:21,fontWeight:'500',paddingHorizontal:4},
 groupBody:{...menuChrome.card,paddingHorizontal:16,paddingVertical:4,gap:0},
 row:{position:'relative',flexDirection:'row',alignItems:'center',gap:12,minHeight:60,paddingVertical:14,paddingHorizontal:0},
 rowSeparator:{position:'absolute',top:0,left:44,right:0,height:StyleSheet.hairlineWidth,backgroundColor:colors.subtle},
 rowIcon:{width:28,minHeight:32,alignItems:'center',justifyContent:'center',flexShrink:0},
 rowAccessory:{flexShrink:0,alignItems:'center',justifyContent:'center'},
 rowText:{flex:1,minWidth:0,gap:4},rowTextTrailing:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',columnGap:8},
 rowTitle:{color:colors.foreground,fontSize:16,lineHeight:24},rowTitleTrailing:{flexGrow:1,flexShrink:1},
 value:{color:colors.muted,fontSize:13,lineHeight:20,flexShrink:1},valueTrailing:{fontSize:15,lineHeight:24,maxWidth:'100%'},
}));
