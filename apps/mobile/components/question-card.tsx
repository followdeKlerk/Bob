import {Text} from './app-text';
import React,{useRef,useState} from 'react';
import {Alert,Pressable,StyleSheet,View} from 'react-native';
import {Check,ChevronRight} from 'lucide-react-native';
import {colors} from '../theme';
export type Question={id:string;text:string;options?:string[];multiple?:boolean};
/** Native inline controls, not an isolated visual: answers enter the real outbox. */
export function QuestionCard({question,onAnswer,disabled=false}:{question:Question;onAnswer:(text:string)=>Promise<void>;disabled?:boolean}){
 const [selected,setSelected]=useState<string[]>([]),[sending,setSending]=useState(false);
 const submitting=useRef(false);
 const locked=disabled||sending;
 const choose=(option:string)=>{
  if(locked)return;
  setSelected(previous=>question.multiple?(previous.includes(option)?previous.filter(value=>value!==option):[...previous,option]):[option]);
 };
 const send=async()=>{
  if(locked||submitting.current||!selected.length)return;
  submitting.current=true;setSending(true);
  try{await onAnswer((question.options??[]).filter(option=>selected.includes(option)).join('\n'));}
  catch(error){Alert.alert('Bob',String((error as Error).message??error));}
  finally{submitting.current=false;setSending(false);}
 };
 return <View testID="question-card" style={s.card}>
  <Text style={s.eyebrow}>YOUR CHOICE</Text>
  <Text accessibilityLiveRegion="polite" style={s.question}>{question.text}</Text>
  {!!question.options?.length&&<>
   <Text style={s.hint}>{question.multiple?'Select one or more':'Select one'}</Text>
   <View accessibilityRole={question.multiple?'list':'radiogroup'} style={s.options}>
    {question.options.map(option=>{
     const checked=selected.includes(option);
     return <Pressable key={option} accessibilityRole={question.multiple?'checkbox':'radio'} accessibilityLabel={option} accessibilityState={{checked,disabled:locked}} disabled={locked} onPress={()=>choose(option)} style={[s.option,checked&&s.chosen,locked&&s.disabled]}>
      <View style={[s.mark,!question.multiple&&s.radio,checked&&s.markChosen]}>{checked&&<Check size={15} color={colors.onAccent}/>}</View>
      <Text style={s.optionText}>{option}</Text>
     </Pressable>;
    })}
   </View>
   <Pressable accessibilityRole="button" accessibilityLabel="Send selected answer" accessibilityState={{disabled:locked||!selected.length}} disabled={locked||!selected.length} onPress={()=>{void send();}} style={[s.send,(locked||!selected.length)&&s.disabled]}><Text style={s.sendText}>Send answer</Text><ChevronRight size={18} color={colors.onAccent}/></Pressable>
  </>}
  <Text style={s.hint}>{question.options?.length?'Or type your own reply in the message box.':'Type your reply in the message box.'}</Text>
 </View>;
}
const s=StyleSheet.create({card:{backgroundColor:colors.composer,borderColor:colors.border,borderWidth:1,borderRadius:20,padding:16,gap:12},eyebrow:{fontSize:12,fontWeight:'600',letterSpacing:1.2,color:colors.accent},question:{color:colors.foreground,fontSize:18,lineHeight:26},hint:{color:colors.muted,fontSize:14,lineHeight:21},options:{gap:8},option:{minHeight:48,padding:12,flexDirection:'row',alignItems:'center',gap:12,borderRadius:12,borderWidth:1,borderColor:colors.border},chosen:{borderColor:colors.accent},optionText:{color:colors.foreground,fontSize:16,lineHeight:23,flex:1},mark:{height:22,width:22,borderRadius:5,borderWidth:1,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},radio:{borderRadius:11},markChosen:{backgroundColor:colors.accent,borderColor:colors.accent},send:{minHeight:48,borderRadius:24,paddingHorizontal:18,paddingVertical:12,backgroundColor:colors.accent,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},sendText:{fontSize:16,fontWeight:'600',color:colors.onAccent},disabled:{opacity:0.45}});
