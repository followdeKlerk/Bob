import React,{memo} from 'react';
import {Linking, ScrollView, StyleSheet, Text} from 'react-native';
import Markdown, {MarkdownIt} from 'react-native-markdown-display';
import {colors} from '../theme';

const parser=new MarkdownIt({html:false,linkify:false,typographer:false});
// Native text rendering only: no HTML/WebView, remote images, or automatic URL loads.
export const ChatMarkdown=memo(function ChatMarkdown({text}:{text:string}) {
 return <Markdown markdownit={parser} style={styles} mergeStyle onLinkPress={url=>{
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(()=>{});
  return false;
 }} rules={{
  textgroup:(node,children,_parents,style)=> <Text key={node.key} selectable style={style.textgroup}>{children}</Text>,
  code_block:(node,_children,_parents,style)=> <Text key={node.key} selectable style={style.code_block}>{node.content.replace(/\n$/,'')}</Text>,
  fence:(node,_children,_parents,style)=> <Text key={node.key} selectable style={style.fence}>{node.content.replace(/\n$/,'')}</Text>,
  image:(node)=> <Text key={node.key} style={styles.body}>[Image: {node.attributes.alt || 'image'}]</Text>,
  table:(node,children)=> <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator contentContainerStyle={{paddingBottom:8}}><>{children}</></ScrollView>,
 }}>{text}</Markdown>;
});
const styles=StyleSheet.create({
 body:{color:colors.body,fontSize:16,lineHeight:25},
 text:{color:colors.body},
 paragraph:{marginTop:0,marginBottom:10},
 heading1:{color:colors.foreground,fontSize:25,lineHeight:33,fontWeight:'700',marginTop:14,marginBottom:10},
 heading2:{color:colors.foreground,fontSize:22,lineHeight:29,fontWeight:'700',marginTop:12,marginBottom:8},
 heading3:{color:colors.foreground,fontSize:19,lineHeight:27,fontWeight:'600',marginTop:10,marginBottom:6},
 heading4:{color:colors.foreground,fontSize:17,fontWeight:'600'},
 heading5:{color:colors.foreground,fontSize:16,fontWeight:'600'},
 heading6:{color:colors.foreground,fontSize:16,fontWeight:'600'},
 strong:{fontWeight:'700'},em:{fontStyle:'italic'},s:{textDecorationLine:'line-through'},
 link:{color:colors.accent,textDecorationLine:'underline'},
 code_inline:{fontFamily:'monospace',backgroundColor:colors.surface,color:colors.foreground},
 code_block:{fontFamily:'monospace',fontSize:14,lineHeight:21,color:colors.body,backgroundColor:colors.surface,borderColor:colors.border,padding:12,borderRadius:8},
 fence:{fontFamily:'monospace',fontSize:14,lineHeight:21,color:colors.body,backgroundColor:colors.surface,borderColor:colors.border,padding:12,borderRadius:8},
 blockquote:{backgroundColor:colors.surface,borderColor:colors.accent,borderLeftWidth:3,paddingHorizontal:12},
 hr:{backgroundColor:colors.border,height:1,marginVertical:12},
 table:{borderColor:colors.border,borderWidth:1},
 tr:{borderColor:colors.border,flexDirection:'row',borderBottomWidth:1},
 th:{padding:8,minWidth:100,maxWidth:240,flexShrink:1},
 td:{padding:8,minWidth:100,maxWidth:240,flexShrink:1},
 bullet_list:{marginBottom:10},ordered_list:{marginBottom:10},
});
