import React,{useState} from 'react';
import {Linking,Pressable,StyleSheet,View} from 'react-native';
import type {MarkdownLink} from '../markdown-links';
import {safeHttpDestination} from '../markdown-links';
import {themed,useThemedValue} from '../theme';
import {Text} from './app-text';

const INITIAL_LINKS=3;
/** Source labels and destination domains only. No metadata requests, favicons,
 * WebViews, remote images or automatic navigation. Kept inside the prose bubble. */
export function LinkPreviewFooter({links}:{links:MarkdownLink[]}) {
 const styles=useThemedValue(stylesTheme),[expanded,setExpanded]=useState(false);
 if(!links.length)return null;
 return <View testID="assistant-link-footer" style={styles.footer}>
  <Text style={styles.heading}>Links</Text>
  {(expanded?links:links.slice(0,INITIAL_LINKS)).map(link=><Pressable key={link.key} accessibilityRole="link" accessibilityLabel={`${link.label}, ${link.domain}`} accessibilityHint="Opens in your browser" style={styles.link} onPress={()=>{
   const destination=safeHttpDestination(link.url);
   if(destination)void Linking.openURL(destination.url).catch(()=>{});
  }}>
   <Text numberOfLines={1} style={styles.label}>{link.label}</Text>
   <Text numberOfLines={1} style={styles.domain}>{link.domain}</Text>
  </Pressable>)}
  {links.length>INITIAL_LINKS&&<Pressable accessibilityRole="button" accessibilityLabel={expanded?'Show fewer links':`Show ${links.length-INITIAL_LINKS} more links`} accessibilityState={{expanded}} style={styles.expand} onPress={()=>setExpanded(value=>!value)}>
   <Text style={styles.more}>{expanded?'Show fewer':`Show ${links.length-INITIAL_LINKS} more links`}</Text>
  </Pressable>}
 </View>;
}
const stylesTheme=themed(({colors})=>StyleSheet.create({
 footer:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border,marginTop:2,paddingTop:8,minWidth:0},
 heading:{fontSize:11,lineHeight:16,color:colors.muted},
 link:{minHeight:44,justifyContent:'center',paddingVertical:4,minWidth:0},
 label:{color:colors.accent,fontSize:12,lineHeight:18},
 domain:{color:colors.muted,fontSize:11,lineHeight:16},
 expand:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},
 more:{color:colors.accent,fontSize:12,lineHeight:18},
}));
