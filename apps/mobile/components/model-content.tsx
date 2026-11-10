import {Text} from './app-text';
import React from 'react';
import {View} from 'react-native';
import {ChatMarkdown} from './chat-markdown';
import {ActionRow,CopyAction} from './message-actions';
import {SpeechAction} from './speech-action';
import {ToolContent} from './tool-content';
import {replyText} from '../reply-text';
import {CHAT_CONTENT_GAP} from '../tool-presentation';
import type {LinkedResult} from '../tool-results';
import {ChatBubble,needsWideBubble} from './chat-bubble';
type Group={kind:'text';text:string;key:number}|{kind:'block';block:any;key:number};
function Content({value,results,showTools=true,quietTools=false,speakable=true,bubbleText=false,streaming=false}:{value:unknown;results?:Map<string,LinkedResult>;showTools?:boolean;quietTools?:boolean;speakable?:boolean;bubbleText?:boolean;streaming?:boolean}){

 const groups:Group[]=[];
 const blocks=Array.isArray(value)?value:[{type:'text',text:replyText(value)}];
 for(const [index,block] of blocks.entries()){
  if(block?.type==='thinking'||block?.type==='redactedThinking'||(!showTools&&block?.type==='toolCall'))continue;
  if(block?.type==='text'){
   if(!replyText(block.text))continue;
   const last=groups[groups.length-1];
   if(last?.kind==='text')last.text+='\n'+block.text;
   else groups.push({kind:'text',text:block.text,key:index});
  }else groups.push({kind:'block',block,key:index});
 }
 if(!groups.length)return null;
 return <View>{groups.map((group,index)=>{
  const previous=groups[index-1];
  const tool=(value:Group|undefined)=>value?.kind==='block'&&value.block?.type==='toolCall';
  const gap=index>0&&!(tool(previous)&&tool(group))?CHAT_CONTENT_GAP:0;
  const key=group.kind==='block'?group.block?.id??group.key:group.key;
  let body:React.ReactNode;
  if(group.kind==='text'){
   const text=<ChatMarkdown text={group.text} streaming={streaming} linkPreviews={bubbleText}/>;
   body=<View style={{gap:0}}>{bubbleText?<ChatBubble wide={needsWideBubble(group.text)}>{text}</ChatBubble>:text}<ActionRow><CopyAction text={group.text}/>{speakable&&<SpeechAction text={group.text}/>}</ActionRow></View>;
  }
  else {
   const block=group.block;
   body=block?.type==='toolCall'?<ToolContent quiet={quietTools} name={block.name??'Tool'} content={JSON.stringify(block.arguments)??''} result={results?.get(block.id)}/>:<Text selectable style={{fontSize:15,lineHeight:26}}>{JSON.stringify(block)}</Text>;
  }
  return <View key={key} testID={`model-group-${key}`} style={{paddingTop:gap}}>{body}</View>;
 })}</View>;
}

export const ModelContent=React.memo(Content,(before,after)=>{
 if(before.speakable!==after.speakable||before.bubbleText!==after.bubbleText||before.streaming!==after.streaming)return false;
 if(before.value!==after.value||before.showTools!==after.showTools||before.quietTools!==after.quietTools)return false;
 if(after.showTools===false)return true;
 if(before.results===after.results)return true;
 if(!Array.isArray(before.value))return true;
 for(const block of before.value)if(block?.type==='toolCall'){
  const a=before.results?.get(block.id),b=after.results?.get(block.id);
  if(a?.status!==b?.status||a?.isError!==b?.isError||a?.content!==b?.content||a?.nested!==b?.nested)return false;
 }
 return true;
});
