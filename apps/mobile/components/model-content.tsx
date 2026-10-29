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
import {colors} from '../theme';
type Group={kind:'text';text:string;key:number}|{kind:'block';block:any;key:number};
function Content({value,results,showTools=true,quietTools=false,speakable=true}:{value:unknown;results?:Map<string,LinkedResult>;showTools?:boolean;quietTools?:boolean;speakable?:boolean}){
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
 return <View style={{gap:CHAT_CONTENT_GAP}}>{groups.map(group=>{
  if(group.kind==='text')return <View key={group.key} style={{gap:4}}><ChatMarkdown text={group.text}/><ActionRow><CopyAction text={group.text}/>{speakable&&<SpeechAction text={group.text}/>}</ActionRow></View>;
  const block=group.block;
  if(block?.type==='toolCall')return <ToolContent quiet={quietTools} key={block.id??group.key} name={block.name??'Tool'} content={JSON.stringify(block.arguments)??''} result={results?.get(block.id)}/>;
  return <Text key={group.key} selectable style={{fontSize:15,lineHeight:26,color:colors.body}}>{JSON.stringify(block)}</Text>;
 })}</View>;
}

export const ModelContent=React.memo(Content,(before,after)=>{
 if(before.speakable!==after.speakable)return false;
 if(before.value!==after.value||before.showTools!==after.showTools||before.quietTools!==after.quietTools)return false;
 if(after.showTools===false)return true;
 if(before.results===after.results)return true;
 if(!Array.isArray(before.value))return true;
 for(const block of before.value)if(block?.type==='toolCall'){
  const a=before.results?.get(block.id),b=after.results?.get(block.id);
  if(a?.status!==b?.status||a?.isError!==b?.isError||a?.content!==b?.content)return false;
 }
 return true;
});
