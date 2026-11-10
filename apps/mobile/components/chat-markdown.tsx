import {APP_FONT_FAMILY,APP_MONO_FONT_FAMILY} from '../typography';
import {Text} from './app-text';
import React,{memo,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Linking,ScrollView,StyleSheet,View,useWindowDimensions} from 'react-native';
import Markdown,{type ASTNode,type RenderRules} from 'react-native-markdown-display';
import {themed,useThemedValue} from '../theme';
import {markdownTableWidths,markdownCodeLanguage} from '../markdown-layout';
import {CopyAction} from './message-actions';

import {createStreamingMarkdownParser,proseText,arrivingTextStart} from '../streaming-markdown';
import {markdownLinks,safeHttpDestination} from '../markdown-links';
import {StreamingText} from './streaming-text';
import {LinkPreviewFooter} from './link-preview-footer';

function openLink(url:string){
 const destination=safeHttpDestination(url);
 if(destination)void Linking.openURL(destination.url).catch(()=>{});
 return false;
}
function CodeBlock({content,info}:{content:string;info?:unknown}) {
 const layout=useThemedValue(layoutTheme);

 return <View testID="markdown-code-block" style={layout.codeBlock}>
  <View style={layout.codeHeader}><Text style={layout.codeLabel}>{markdownCodeLanguage(info)}</Text><CopyAction text={content} label="Copy code"/></View>
  <ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator style={layout.horizontal} contentContainerStyle={layout.codeContent}>
   <Text typography="mono" selectable style={layout.codeText}>{content.replace(/\n$/,'')}</Text>
  </ScrollView>
 </View>;
}
// Native rendering only: never execute code/HTML or load remote images.
export const ChatMarkdown=memo(function ChatMarkdown({text,streaming=false,linkPreviews=false}:{text:string;streaming?:boolean;linkPreviews?:boolean}) {
 const layout=useThemedValue(layoutTheme);
 const styles=useThemedValue(stylesTheme);
 const [parser]=useState(createStreamingMarkdownParser);
 const ast=useMemo(()=>parser.parse(text),[parser,text]);
 const prose=useMemo(()=>proseText(ast),[ast]);
 const previous=useRef<{source:string;prose:string;streaming:boolean}|null>(null);
 const start=arrivingTextStart(previous.current,text,prose,streaming);
 const edges=useMemo(()=>{
  const result=new Map<string,number>();let offset=0;
  const visit=(nodes:ASTNode[])=>nodes.forEach(node=>{
   if(node.type==='text'){
    if(start!==null&&offset+node.content.length>start)result.set(node.key,Math.max(0,start-offset));
    offset+=node.content.length;
   }else visit(node.children);
  });
  visit(ast);return result;
 },[ast,start]);
 useLayoutEffect(()=>{previous.current={source:text,prose,streaming};},[text,prose,streaming]);
 const links=useMemo(()=>linkPreviews?markdownLinks(ast):[],[ast,linkPreviews]);
 const window=useWindowDimensions(),[measured,setMeasured]=useState(0);
 const width=measured||Math.max(1,window.width-48);
 const rules=useMemo<RenderRules>(()=>{
  const columns=new WeakMap<ASTNode,number[]>();
  const widths=(table:ASTNode)=>{
   let value=columns.get(table);
   if(!value){value=markdownTableWidths(table,Math.max(1,width-2),window.fontScale);columns.set(table,value);}
   return value;
  };
  const cell=(node:ASTNode,children:React.ReactNode[],parents:ASTNode[],header:boolean)=>{
   const table=parents.find(parent=>parent.type==='table');
   return <View key={node.key} testID={header?'markdown-th':'markdown-td'} style={[layout.cell,header&&layout.headerCell,{width:table?widths(table)[node.index]:160}]}>{children}</View>;
  };
  return {
   // The library's default body uses a fresh random key on every render. A
   // stable root/AST path keeps existing native text mounted during appends.
   body:(_node,children,_parents,style)=><View key="markdown-body" style={style._VIEW_SAFE_body}>{children}</View>,
   text:(node,_children,_parents,style,inherited)=>
    <StreamingText key={node.key} text={node.content} start={edges.get(node.key)??null} style={[inherited,style.text]}/>,
   textgroup:(node,children,parents,style)=>{
    const alignment=parents.find(parent=>parent.type==='th'||parent.type==='td')?.attributes.style;
    const textAlign=typeof alignment==='string'&&alignment.includes('center')?'center':typeof alignment==='string'&&alignment.includes('right')?'right':'left';
    return <Text key={node.key} selectable style={[style.textgroup,layout.textGroup,{textAlign}]}>{children}</Text>;
   },
   code_inline:(node,_children,_parents,style,inherited)=><Text key={node.key} typography="mono" style={[inherited,style.code_inline]}>{node.content}</Text>,
   code_block:node=><CodeBlock key={node.key} content={node.content}/>,
   fence:node=><CodeBlock key={node.key} content={node.content} info={(node as ASTNode&{sourceInfo?:string}).sourceInfo}/>,
   image:node=><Text key={node.key} style={styles.body}>[Image: {node.attributes.alt||'image'}]</Text>,
   table:(node,children)=>{
    const tableWidth=widths(node).reduce((sum,column)=>sum+column,0);
    return <View key={node.key} testID="markdown-table" style={layout.tableBlock}>
     {tableWidth>width&&<Text style={layout.hint}>Swipe horizontally for more columns</Text>}
     <ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator style={layout.horizontal}>
      <View testID="markdown-table-grid" style={[layout.table,{width:tableWidth+2}]}>{children}</View>
     </ScrollView>
    </View>;
   },
   // A horizontal ScrollView lays out direct children side by side. Keep both
   // sections inside ONE column-oriented table, and every cell inside a row.
   thead:(node,children)=><View key={node.key} testID="markdown-thead" style={layout.section}>{children}</View>,
   tbody:(node,children)=><View key={node.key} testID="markdown-tbody" style={layout.section}>{children}</View>,
   tr:(node,children)=><View key={node.key} testID="markdown-tr" style={layout.row}>{children}</View>,
   th:(node,children,parents)=>cell(node,children,parents,true),
   td:(node,children,parents)=>cell(node,children,parents,false),
  };
 },[width,window.fontScale,layout,styles,edges]);
 return <View testID="markdown-content" style={layout.root} onLayout={event=>{const next=event.nativeEvent.layout.width;if(Number.isFinite(next)&&next>0)setMeasured(previous=>Math.abs(previous-next)>.5?next:previous);}}>
  <Markdown markdownit={parser.markdownit} style={styles} mergeStyle rules={rules} onLinkPress={openLink}>{ast as any}</Markdown>
  {linkPreviews&&<LinkPreviewFooter links={links}/>}
 </View>;
});
const layoutTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 root:{width:'100%',minWidth:0,alignSelf:'stretch'},
 textGroup:{flexShrink:1},
 horizontal:{width:'100%',flexGrow:0},
 tableBlock:{width:'100%',minWidth:0,marginVertical:10},
 hint:{color:colors.muted,fontSize:11,lineHeight:18,marginBottom:6},
 table:{flexDirection:'column',borderWidth:1,borderColor:colors.border,borderRadius:8,overflow:'hidden'},
 section:{flexDirection:'column'},
 row:{flexDirection:'row',alignItems:'stretch',borderBottomWidth:1,borderColor:colors.border},
 cell:{flexGrow:0,flexShrink:0,padding:10,borderRightWidth:1,borderColor:colors.border,justifyContent:'flex-start'},
 headerCell:{backgroundColor:colors.surface},
 codeBlock:{width:'100%',minWidth:0,marginVertical:10,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,overflow:'hidden'},
 codeHeader:{minHeight:44,paddingLeft:12,paddingRight:4,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderColor:colors.border},
 codeLabel:{color:colors.muted,fontSize:11,lineHeight:18,flexShrink:1},
 codeContent:{padding:12},
 codeText:{fontFamily:APP_MONO_FONT_FAMILY,fontSize:13,lineHeight:22,color:colors.foreground,flexShrink:0},
}));
const stylesTheme=themed(({colors,menuChrome})=>StyleSheet.create({
 body:{fontFamily:APP_FONT_FAMILY,color:colors.body,fontSize:15,lineHeight:25,minWidth:0,width:'100%'},
 text:{color:colors.body},textgroup:{flexShrink:1},
 paragraph:{marginTop:0,marginBottom:10,flexShrink:1},
 heading1:{flexDirection:'column',color:colors.foreground,fontSize:24,lineHeight:33,fontWeight:'700',marginTop:14,marginBottom:10},
 heading2:{flexDirection:'column',color:colors.foreground,fontSize:21,lineHeight:29,fontWeight:'700',marginTop:12,marginBottom:8},
 heading3:{flexDirection:'column',color:colors.foreground,fontSize:18,lineHeight:27,fontWeight:'600',marginTop:10,marginBottom:6},
 heading4:{flexDirection:'column',color:colors.foreground,fontSize:16,lineHeight:25,fontWeight:'600',marginTop:8,marginBottom:6},
 heading5:{flexDirection:'column',color:colors.foreground,fontSize:15,lineHeight:24,fontWeight:'600',marginTop:8,marginBottom:6},
 heading6:{flexDirection:'column',color:colors.foreground,fontSize:15,lineHeight:24,fontWeight:'600',marginTop:8,marginBottom:6},
 strong:{fontWeight:'700'},em:{fontStyle:'italic'},s:{textDecorationLine:'line-through'},
 link:{color:colors.accent,textDecorationLine:'underline'},
 code_inline:{fontFamily:APP_MONO_FONT_FAMILY,backgroundColor:colors.surface,color:colors.foreground,borderWidth:0,padding:0,borderRadius:3},
 blockquote:{backgroundColor:colors.surface,borderColor:colors.accent,borderLeftWidth:3,paddingHorizontal:12,paddingVertical:8,marginLeft:0,marginVertical:8},
 hr:{backgroundColor:colors.border,height:1,marginVertical:12},
 th:{fontWeight:'600'},
 bullet_list:{marginBottom:10},ordered_list:{marginBottom:10},
 list_item:{marginBottom:4},bullet_list_icon:{marginLeft:0,marginRight:8},ordered_list_icon:{marginLeft:0,marginRight:8},
}));
