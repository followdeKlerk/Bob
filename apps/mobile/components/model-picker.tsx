import {Text,TextInput} from './app-text';
import React,{useEffect,useMemo,useState} from 'react';
import {Modal,View,ScrollView,Pressable,StyleSheet,KeyboardAvoidingView,Platform} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Check,Search,X,Zap} from 'lucide-react-native';
import {Button} from './ui/button';
import {colors} from '../theme';
export type ModelOption={provider:string;modelId:string;name:string;available?:boolean;thinkingLevels?:string[]};
export type ModelChoice={model?:{provider:string;modelId:string};thinkingLevel?:string};
const labels:Record<string,string>={off:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum'};
const hints:Record<string,string>={off:'Direct answers without extra reasoning.',minimal:'Light reasoning for simple requests.',low:'Quicker answers for everyday work.',medium:'A balance of speed and reasoning.',high:'More reasoning for difficult tasks.',xhigh:'Extended reasoning for complex problems.',max:'The most reasoning this model supports.'};
export function ModelPicker({visible,models,current,onClose,onApply,loading=false}:{visible:boolean;loading?:boolean;models:ModelOption[];current:ModelChoice;onClose:()=>void;onApply:(choice:Required<ModelChoice>)=>Promise<void>}){
 const [query,setQuery]=useState(''),[provider,setProvider]=useState(''),[selected,setSelected]=useState(''),[thinking,setThinking]=useState('medium'),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const key=(m:{provider:string;modelId:string})=>m.provider+'/'+m.modelId;
 useEffect(()=>{if(visible){setQuery('');setProvider(current.model?.provider??'');setSelected(current.model?key(current.model):'');const supported=models.find(m=>current.model&&key(m)===key(current.model))?.thinkingLevels??[];setThinking(supported.includes(current.thinkingLevel??'')?current.thinkingLevel!:supported.includes('medium')?'medium':supported[0]??'off');setError('');setSaving(false);}},[visible,current]);
 const available=models.filter(m=>m.available!==false);
 const providers=[...new Set(available.map(m=>m.provider))];
 const chosen=models.find(m=>key(m)===selected);
 const levels=chosen?.thinkingLevels??[];
 const rows=useMemo(()=>available.filter(m=>(!provider||m.provider===provider)&&`${m.name} ${m.modelId}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(key(b)===selected)-Number(key(a)===selected)||a.name.localeCompare(b.name)),[models,provider,query,selected]);
 const choose=(m:ModelOption)=>{setSelected(key(m));const supported=m.thinkingLevels??[];if(!supported.includes(thinking))setThinking(supported.includes('medium')?'medium':supported[0]??'off');setError('');};
 return <Modal visible={visible} transparent animationType="slide" onRequestClose={()=>{if(!saving)onClose();}}>
  <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS==='ios'?'padding':'height'}>
   <Pressable style={StyleSheet.absoluteFill} onPress={()=>{if(!saving)onClose();}} accessibilityLabel="Close model selection"/>
   <SafeAreaView edges={['bottom']} style={s.sheet}>
    <View style={s.heading}><Text style={s.title}>Model & thinking</Text><Button variant="ghost" size="icon" accessibilityLabel="Close model selection" disabled={saving||loading} onPress={onClose}><X size={22} color={colors.foreground}/></Button></View>
    <Text style={s.caption}>{loading?'Loading available models…':'For this conversation'}</Text>
    <View style={s.search}><Search size={19} color={colors.muted}/><TextInput style={s.input} value={query} onChangeText={setQuery} editable={!saving} placeholder="Search models" placeholderTextColor={colors.muted} accessibilityLabel="Search models" autoCapitalize="none"/></View>
    {providers.length>1&&<View style={s.wrap}>{providers.map(p=><Button key={p} variant={provider===p?'secondary':'ghost'} disabled={saving||loading} onPress={()=>setProvider(p)} accessibilityState={{selected:provider===p}}><Text style={s.text}>{p==='openai'?'OpenAI':p==='anthropic'?'Anthropic':p}</Text></Button>)}</View>}
    <ScrollView style={s.models} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
     {rows.map(m=><Button key={key(m)} variant="ghost" style={[s.model,selected===key(m)&&s.selected]} disabled={saving||loading} onPress={()=>choose(m)} accessibilityRole="radio" accessibilityState={{checked:selected===key(m)}}><View style={{flex:1}}><Text style={s.text}>{m.name}</Text>{m.name!==m.modelId&&<Text style={s.small}>{m.modelId}</Text>}</View>{selected===key(m)&&<Check size={20} color={colors.accent}/>}</Button>)}
     {!loading&&!rows.length&&<Text style={s.caption}>{available.length?'No matching models.':'Connect a provider in Settings to choose a model.'}</Text>}
    </ScrollView>
    <View style={s.section}><Text style={s.label}>Thinking effort</Text><View style={s.wrap}>{levels.map(level=><Button key={level} variant={thinking===level?'secondary':'ghost'} style={thinking===level?s.choice:undefined} disabled={saving||loading} onPress={()=>setThinking(level)} accessibilityRole="radio" accessibilityState={{checked:thinking===level}}><Text style={s.text}>{labels[level]??level}</Text></Button>)}</View><Text style={s.caption}>{chosen?(hints[thinking]??'Choose how much reasoning to use.'):'Choose a model first.'}</Text></View>
    <View style={s.speed}><Zap size={17} color={colors.muted}/><View style={{flex:1}}><Text style={s.label}>Standard speed</Text><Text style={s.small}>Fast mode is not verified on this connection. Thinking effort is a separate setting.</Text></View></View>
    {!!error&&<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    <Button disabled={saving||loading||!chosen||!levels.includes(thinking)} style={s.apply} onPress={()=>{if(!chosen)return;setSaving(true);setError('');void onApply({model:{provider:chosen.provider,modelId:chosen.modelId},thinkingLevel:thinking}).catch(e=>setError(String(e.message??e))).finally(()=>setSaving(false));}}><Text style={s.applyText}>{saving?'Saving…':'Apply'}</Text></Button>
   </SafeAreaView>
  </KeyboardAvoidingView>
 </Modal>;
}
const s=StyleSheet.create({overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},sheet:{maxHeight:'90%',backgroundColor:colors.background,borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:22,paddingTop:16,gap:10},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:23,fontWeight:'600',color:colors.foreground},text:{color:colors.foreground,fontSize:16},label:{color:colors.foreground,fontSize:15,fontWeight:'600'},caption:{fontSize:14,color:colors.muted,lineHeight:20},small:{fontSize:12,color:colors.muted,lineHeight:18},search:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.surface,borderRadius:16,paddingHorizontal:14},input:{flex:1,color:colors.foreground,minHeight:48,fontSize:16},models:{maxHeight:260,flexShrink:1},model:{height:'auto',minHeight:60,justifyContent:'flex-start',paddingHorizontal:14,paddingVertical:10,borderRadius:16},selected:{backgroundColor:colors.surface},wrap:{flexDirection:'row',flexWrap:'wrap',gap:4},choice:{borderWidth:1,borderColor:colors.accent},section:{gap:8,paddingTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderColor:colors.border},speed:{flexDirection:'row',gap:9,alignItems:'flex-start',paddingVertical:8},error:{color:colors.foreground,fontSize:14},apply:{backgroundColor:colors.accent,borderRadius:24,minHeight:48,marginBottom:8},applyText:{color:colors.onAccent,fontWeight:'600',fontSize:16}});
