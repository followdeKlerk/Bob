import {Text} from './app-text';
import React from 'react';
import {ActivityIndicator,Pressable,StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
import {ArrowLeft,ChevronRight,type LucideIcon} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {Button} from './ui/button';
import {Tabs,TabsList,TabsTrigger} from './ui/tabs';
import {Text as ControlText} from './ui/text';
import {EdgeFade} from './edge-fade';

/** Shared chrome for non-chat destinations. Keep content readable as text grows. */
export const sectionStylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 heading:{paddingHorizontal:20,paddingTop:16,paddingBottom:12,flexShrink:0},
 footer:{paddingHorizontal:16,paddingVertical:8,flexDirection:'row',alignItems:'flex-end',gap:8,flexShrink:0,backgroundColor:colors.background,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.subtle},
 headingRow:{flexDirection:'row',alignItems:'flex-start',minHeight:35},
 menu:{flexShrink:0,minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
 toolbar:{flex:1,minWidth:0,flexDirection:'row',flexWrap:'wrap',alignItems:'flex-end',gap:8},
 leading:{flexShrink:0,maxWidth:'100%'},
 actions:{flexDirection:'row',flexWrap:'wrap',flexGrow:1,flexShrink:1,maxWidth:'100%',justifyContent:'flex-end',alignItems:'flex-start',gap:8,marginLeft:'auto'},
 titleBox:{flex:1,minWidth:0,minHeight:35,justifyContent:'center'},
 title:{color:colors.foreground,fontSize:27,lineHeight:35,fontWeight:'600',letterSpacing:-.5,flexShrink:1},
 subtitle:{color:colors.muted,fontSize:12,lineHeight:20,marginTop:3},
}));
/** Orientation stays at the top; thumb-reachable controls live in SectionActions. */
export function SectionHeading({title,subtitle}:{title:string;subtitle?:string}){
 const s=useThemedValue(sectionStylesTheme);
 return <View pointerEvents="box-none" testID="section-heading" style={s.heading}>
  <View pointerEvents="box-none" testID="section-heading-row" style={s.headingRow}>
   <View pointerEvents="none" style={s.titleBox}><Text accessibilityRole="header" style={s.title}>{title}</Text></View>
  </View>
  {!!subtitle&&<Text testID="section-heading-subtitle" style={s.subtitle}>{subtitle}</Text>}
 </View>;
}
/** Full-height scroll host: the footer is absolute, never an in-flow cutoff.
 * Render functions are called normally (not mounted as component types), so
 * measurements update padding without replacing lists, inputs or draft state.
 * Insets belong to the existing screen/Modal parent, not this inner frame.
 * Include every persistent footer row in `footer` so its full height is measured. */
export function SectionBody({footer,children,surfaceColor,style}:{footer:React.ReactNode;children:(clearance:number)=>React.ReactNode;surfaceColor?:string;style?:StyleProp<ViewStyle>}){
 const [height,setHeight]=React.useState(80);
 const clearance=height+12;
 return <View testID="section-scroll-host" style={[{flex:1,minHeight:0},style]}>
  {children(clearance)}
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

 return <Tabs value={value} onValueChange={next=>{const option=options.find(item=>item.value===next);if(option)onChange(option.value);}} style={style}><TabsList accessibilityRole="tablist" accessibilityLabel={label} style={s.segments}>{options.map(option=><TabsTrigger key={option.value} value={option.value} accessibilityRole="tab" accessibilityLabel={option.label} style={[s.segment,{backgroundColor:value===option.value?colors.accent:'transparent'}]}><ControlText style={[s.segmentLabel,{color:value===option.value?colors.onAccent:colors.foreground}]}>{option.label}</ControlText></TabsTrigger>)}</TabsList></Tabs>;
}
export function RoundAction({label,icon:Icon,onPress,disabled=false,primary=false}:{label:string;icon:LucideIcon;onPress:()=>void;disabled?:boolean;primary?:boolean;compact?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 return <Button variant={primary?'default':'ghost'} size="icon" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} className="rounded-full" style={[s.roundTarget,primary&&{backgroundColor:colors.accent},disabled&&{opacity:.4}]}><View pointerEvents="none"><Icon size={21} color={primary?colors.onAccent:colors.foreground}/></View></Button>;
}
/** Text page actions share geometry; keep their full accessible names. */
export function SectionAction({label,text=label,onPress,disabled=false,busy=false,primary=false}:{label:string;text?:string;onPress:()=>void;disabled?:boolean;busy?:boolean;primary?:boolean}){
 const {colors}=useTheme(),s=useThemedValue(sTheme),off=disabled||busy;
 return <Button variant={primary?'default':'secondary'} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:off,busy}} disabled={off} onPress={onPress} style={[s.action,primary&&s.actionPrimary,off&&{opacity:.4}]}>{busy?<ActivityIndicator color={primary?colors.onAccent:colors.foreground}/>:<ControlText style={[s.actionText,primary&&{color:colors.onAccent}]}>{text}</ControlText>}</Button>;
}
export function SettingsGroup({title,children}:{title:string;children:React.ReactNode}){
 const s=useThemedValue(sTheme);

 return <View style={s.group}><Text accessibilityRole="header" style={s.groupTitle}>{title}</Text><View style={s.groupBody}>{children}</View></View>;
}
export function SettingsRow({title,label=title,icon:Icon,onPress,disabled=false,value,checked,loading=false}:{title:string;label?:string;icon:LucideIcon;onPress:()=>void;disabled?:boolean;value?:string;checked?:boolean;loading?:boolean}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const off=disabled||loading;
 return <Pressable accessibilityRole={checked===undefined?"button":"switch"} accessibilityLabel={label} accessibilityState={{disabled:off,busy:loading,...(checked===undefined?{}:{checked})}} disabled={off} onPress={onPress} style={[s.row,off&&{opacity:.4}]}><View style={s.rowIcon}><Icon size={20} color={colors.accent}/></View><Text style={s.rowTitle}>{title}</Text>{!!value&&<Text style={s.value}>{value}</Text>}<>{loading?<ActivityIndicator size="small" color={colors.accent}/>:checked===undefined?<ChevronRight size={17} color={colors.muted}/>:<View pointerEvents="none" style={[s.switch,{backgroundColor:checked?colors.accent:colors.border,alignItems:checked?'flex-end':'flex-start'}]}><View style={[s.thumb,{backgroundColor:checked?colors.onAccent:colors.foreground}]}/></View>}</></Pressable>;
}
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 action:{...menuChrome.control,height:'auto',minHeight:48,minWidth:48,maxWidth:'100%',flexShrink:1,paddingHorizontal:12,paddingVertical:8,justifyContent:'center'},
 actionPrimary:{backgroundColor:colors.accent,borderColor:colors.accent},
 actionText:{color:colors.foreground,fontSize:15,lineHeight:23,fontWeight:'500',flexShrink:1,textAlign:'center'},
 switch:{width:36,height:22,borderRadius:11,padding:3,justifyContent:'center'},thumb:{width:16,height:16,borderRadius:8},
 segments:{height:'auto',minHeight:54,width:'100%',marginRight:0,alignItems:'stretch'},
 segment:{height:'auto',flex:1,minWidth:48,minHeight:48,paddingHorizontal:4,paddingVertical:8,justifyContent:'center'},
 segmentLabel:{fontSize:15,lineHeight:23,fontWeight:'500',textAlign:'center',flexShrink:1,minWidth:0},
 roundTarget:{width:48,height:48,minWidth:48,minHeight:48,borderRadius:24,alignItems:'center',justifyContent:'center'},
 group:{gap:9,marginBottom:10},groupTitle:{color:colors.muted,fontSize:12,fontWeight:'600',paddingHorizontal:4,letterSpacing:.3},
 groupBody:{...menuChrome.card,paddingHorizontal:12,paddingVertical:4,gap:2},
 row:{flexDirection:'row',alignItems:'center',gap:12,minHeight:62,paddingVertical:10,paddingHorizontal:2},
 rowIcon:{...menuChrome.icon,width:34,height:34,alignItems:'center',justifyContent:'center',backgroundColor:colors.iconSurface},
 rowTitle:{flex:1,flexShrink:1,color:colors.foreground,fontSize:15,lineHeight:23},value:{color:colors.muted,fontSize:12,flexShrink:1,maxWidth:'28%'},
}));
