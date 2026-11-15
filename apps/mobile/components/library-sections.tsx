import React,{useMemo,useState} from 'react';
import {StyleSheet,View} from 'react-native';
import {BookOpen,Check,ChevronRight,Plus,type LucideIcon} from 'lucide-react-native';
import {Text} from './app-text';
import {TouchTarget} from './touch-target';
import {PageSearch} from './page-search';
import {EmptyState} from './empty-state';
import {RoundAction} from './section-ui';
import {themed,useTheme,useThemedValue} from '../theme';

/** Presentation only: editor drafts and saves keep their existing App ownership. */
export function LibraryCard({title,icon:Icon,description,children}:{title:string;icon:LucideIcon;description?:string;children:React.ReactNode}){
 const {colors}=useTheme(),s=useThemedValue(styles);
 return <View style={s.card}><View style={s.heading}><Icon size={22} color={colors.muted}/><Text typography="ui" accessibilityRole="header" style={s.headingText}>{title}</Text></View>{!!description&&<Text typography="ui" style={s.description}>{description}</Text>}{children}</View>;
}
export type LibrarySkill={markdown:string;description?:string;enabled:boolean};
export function SkillLibraryList({skills,selected,onSelect,onNew}:{skills:Record<string,LibrarySkill>;selected:string;onSelect:(name:string,value:LibrarySkill)=>void;onNew:()=>void}){
 const {colors}=useTheme(),s=useThemedValue(styles),[query,setQuery]=useState('');
 const all=useMemo(()=>Object.entries(skills).sort(([a],[b])=>a.localeCompare(b)),[skills]);
 const rows=useMemo(()=>{const term=query.trim().toLocaleLowerCase();return all.filter(([name,value])=>`${name} ${value.description??''}`.toLocaleLowerCase().includes(term));},[all,query]);
 return <View style={s.library}>
  <PageSearch label="Search installed skills" placeholder="Search skills" value={query} onChangeText={setQuery}/>
  <View style={s.card}>
   <View style={s.heading}><BookOpen size={22} color={colors.muted}/><View style={s.headingCopy}><Text typography="ui" accessibilityRole="header" style={s.headingText}>Installed</Text><Text typography="ui" style={s.count}>{all.length} skills · {all.filter(([,value])=>value.enabled).length} enabled</Text></View><RoundAction icon={Plus} label="New skill" onPress={onNew}/></View>
   {rows.length?rows.map(([name,value],index)=><TouchTarget key={name} testID={`library-skill-${name}`} accessibilityRole="button" accessibilityLabel={`Edit skill ${name}`} accessibilityHint={`${value.enabled?'Enabled':'Disabled'}. ${value.description??''}`} accessibilityState={{selected:selected===name}} onPress={()=>onSelect(name,value)} style={[s.skill,index>0&&s.divider,selected===name&&s.selected]}>
    <View style={s.skillCopy}><Text typography="ui" style={s.name}>{name}</Text>{!!value.description&&<Text typography="ui" numberOfLines={2} style={s.description}>{value.description}</Text>}<Text typography="ui" style={s.count}>{value.enabled?'Enabled':'Disabled'}</Text></View>
    {selected===name?<Check size={20} color={colors.accent}/>:<ChevronRight size={18} color={colors.muted}/>}
   </TouchTarget>):<EmptyState icon={BookOpen} title={query?'No matching skills':'No skills yet'} description={query?'Try another name or description.':'Add a reusable way of working with Bob.'}/>}
  </View>
 </View>;
}
const styles=themed(({colors,menuChrome})=>StyleSheet.create({
 library:{gap:16},card:{...menuChrome.card,padding:16,gap:12},heading:{flexDirection:'row',alignItems:'center',gap:12,minHeight:32},headingCopy:{flex:1,minWidth:0,gap:2},headingText:{fontSize:17,lineHeight:25,fontWeight:'600',color:colors.foreground,flexShrink:1},
 description:{fontSize:14,lineHeight:22,color:colors.muted},count:{fontSize:12,lineHeight:20,color:colors.muted},
 skill:{minHeight:72,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,paddingHorizontal:8,borderRadius:12},divider:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.subtle},selected:{backgroundColor:colors.selectedSurface},skillCopy:{flex:1,minWidth:0,gap:4},name:{fontSize:16,lineHeight:24,color:colors.foreground},
}));
