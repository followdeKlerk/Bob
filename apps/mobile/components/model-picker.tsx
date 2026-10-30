import {Text,TextInput} from './app-text';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Modal,View,FlatList,ScrollView,Pressable,StyleSheet,KeyboardAvoidingView,Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Check,Search,Star,X} from 'lucide-react-native';
import {Button} from './ui/button';
import {colors} from '../theme';
export type ModelOption={provider:string;modelId:string;name:string;available?:boolean;thinkingLevels?:string[]};
export type ModelChoice={model?:{provider:string;modelId:string};thinkingLevel?:string};
const favoriteKey='model-favorites:v1';
const key=(m:{provider:string;modelId:string})=>JSON.stringify([m.provider,m.modelId]);
const labels:Record<string,string>={off:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum'};
export function ModelPicker({visible,models,current,onClose,onApply,loading=false}:{visible:boolean;loading?:boolean;models:ModelOption[];current:ModelChoice;onClose:()=>void;onApply:(choice:Required<ModelChoice>)=>Promise<void>}){
 const [query,setQuery]=useState(''),[provider,setProvider]=useState(''),[selected,setSelected]=useState(''),[thinking,setThinking]=useState('medium'),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [favorites,setFavorites]=useState<string[]>([]),[favoritesReady,setFavoritesReady]=useState(false),[favoriteSaving,setFavoriteSaving]=useState(false);
 const favoriteBusy=useRef(false);
 useEffect(()=>{if(!visible)return;let active=true;setFavoritesReady(false);void AsyncStorage.getItem(favoriteKey).then(raw=>{const parsed:unknown=raw===null?[]:JSON.parse(raw);if(!Array.isArray(parsed)||!parsed.every(v=>typeof v==='string'))throw Error('Invalid favourites');if(active){setFavorites(parsed);setFavoritesReady(true);}}).catch(()=>{if(active)setError('Could not load favourites. Reopen model selection to retry.');});return()=>{active=false;};},[visible]);
 useEffect(()=>{if(visible){setQuery('');setProvider('');setSelected(current.model?key(current.model):'');const supported=models.find(m=>current.model&&key(m)===key(current.model))?.thinkingLevels??[];setThinking(supported.includes(current.thinkingLevel??'')?current.thinkingLevel!:supported.includes('medium')?'medium':supported[0]??'off');setError('');setSaving(false);}},[visible,current]);
 const available=models.filter(m=>m.available!==false);
 const providers=[...new Set(available.map(m=>m.provider))];
 const chosen=models.find(m=>key(m)===selected);
 const currentModel=models.find(m=>current.model&&key(m)===key(current.model));
 const levels=chosen?.thinkingLevels??[];
 const rows=useMemo(()=>models.filter(m=>m.available!==false&&(!provider||m.provider===provider)&&`${m.name} ${m.modelId} ${m.provider}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Number(favorites.includes(key(b)))-Number(favorites.includes(key(a)))||a.name.localeCompare(b.name)||key(a).localeCompare(key(b))),[models,provider,query,favorites]);
 const choose=(m:ModelOption)=>{setSelected(key(m));const supported=m.thinkingLevels??[];if(!supported.includes(thinking))setThinking(supported.includes('medium')?'medium':supported[0]??'off');setError('');};
 async function toggleFavorite(m:ModelOption){
  if(favoriteBusy.current||!favoritesReady)return;favoriteBusy.current=true;setFavoriteSaving(true);
  const id=key(m),next=favorites.includes(id)?favorites.filter(v=>v!==id):[...favorites,id];
  try{await AsyncStorage.setItem(favoriteKey,JSON.stringify(next));setFavorites(next);setError('');}catch{setError('Could not save favourites. Please try again.');}finally{favoriteBusy.current=false;setFavoriteSaving(false);}
 }
 return <Modal visible={visible} transparent animationType="slide" onRequestClose={()=>{if(!saving)onClose();}}>
  <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS==='ios'?'padding':'height'}>
   <Pressable style={StyleSheet.absoluteFill} onPress={()=>{if(!saving)onClose();}} accessibilityLabel="Close model selection"/>
   <SafeAreaView edges={['top','bottom']} style={s.sheet}>
    <View style={s.heading}><Text style={s.title}>Model & thinking</Text><Button variant="ghost" size="icon" style={s.touch} accessibilityLabel="Close model selection" disabled={saving} onPress={onClose}><X size={22} color={colors.foreground}/></Button></View>
    <FlatList data={rows} keyExtractor={key} style={s.models} keyboardShouldPersistTaps="handled" extraData={[selected,favorites,favoriteSaving,saving,loading]} ListHeaderComponent={<View style={s.header}>
     <View style={s.summary}><Text style={s.label}>Current model</Text><Text selectable style={s.text}>{loading?'Loading…':currentModel?.name??current.model?.modelId??'Not configured'}</Text><Text style={s.caption}>{current.model?.provider}{current.thinkingLevel?` · ${labels[current.thinkingLevel]??current.thinkingLevel} thinking`:''}</Text></View>
     <View style={s.search}><Search size={19} color={colors.muted}/><TextInput style={s.input} value={query} onChangeText={setQuery} editable={!saving} placeholder="Search models" placeholderTextColor={colors.muted} accessibilityLabel="Search models" autoCapitalize="none"/></View>
     {providers.length>1&&<ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.filters}>{['',...providers].map(p=><Button key={p||'all'} variant={provider===p?'secondary':'ghost'} style={s.filter} disabled={saving||loading} onPress={()=>setProvider(p)} accessibilityLabel={p||'All providers'} accessibilityState={{selected:provider===p}}><Text style={s.text}>{p||'All providers'}</Text></Button>)}</ScrollView>}
    </View>} renderItem={({item:m,index})=>{const favorite=favorites.includes(key(m));return <View>
     {(index===0||favorite!==favorites.includes(key(rows[index-1])))&&<Text style={s.group}>{favorite?'Favourites':'All models'}</Text>}
     <View style={[s.row,selected===key(m)&&s.selected]}>
      <Pressable style={s.model} disabled={saving||loading} onPress={()=>choose(m)} accessibilityLabel={`Select ${m.name} (${m.provider})`} accessibilityRole="radio" accessibilityState={{checked:selected===key(m)}}><View style={s.modelText}><Text style={s.text}>{m.name}</Text><Text style={s.caption}>{m.provider}</Text></View>{selected===key(m)&&<Check size={18} color={colors.accent}/>}</Pressable>
      <Pressable style={s.touch} disabled={!favoritesReady||favoriteSaving||saving||loading} onPress={()=>{void toggleFavorite(m);}} accessibilityRole="button" accessibilityLabel={`${favorite?'Unfavourite':'Favourite'} ${m.name} (${m.provider})`} accessibilityState={{selected:favorite,disabled:!favoritesReady||favoriteSaving||saving||loading}}><Star size={20} color={favorite?colors.accent:colors.muted} fill={favorite?colors.accent:'transparent'}/></Pressable>
     </View>
    </View>;}} ListEmptyComponent={<Text style={s.caption}>{loading?'Loading available models…':available.length?'No matching models.':'Connect a provider in Settings to choose a model.'}</Text>} ListFooterComponent={<View style={s.section}><Text style={s.label}>Thinking effort</Text><View style={s.wrap}>{levels.map(level=><Button key={level} variant={thinking===level?'secondary':'ghost'} style={[s.filter,thinking===level&&s.choice]} disabled={saving||loading} onPress={()=>setThinking(level)} accessibilityLabel={`${labels[level]??level} thinking`} accessibilityRole="radio" accessibilityState={{checked:thinking===level}}><Text style={s.text}>{labels[level]??level}</Text></Button>)}</View>{!chosen&&<Text style={s.caption}>Choose a model first.</Text>}</View>}/>
    {!!error&&<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    <Button accessibilityLabel="Apply model selection" disabled={saving||loading||!chosen||!levels.includes(thinking)} style={s.apply} onPress={()=>{if(!chosen)return;setSaving(true);setError('');void onApply({model:{provider:chosen.provider,modelId:chosen.modelId},thinkingLevel:thinking}).catch(e=>setError(String(e.message??e))).finally(()=>setSaving(false));}}><Text style={s.applyText}>{saving?'Saving…':'Apply'}</Text></Button>
   </SafeAreaView>
  </KeyboardAvoidingView>
 </Modal>;
}
const s=StyleSheet.create({overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},sheet:{height:'94%',backgroundColor:colors.background,borderTopLeftRadius:24,borderTopRightRadius:24,paddingHorizontal:16,paddingTop:8,gap:8},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:21,fontWeight:'600',color:colors.foreground,flex:1},text:{color:colors.foreground,fontSize:15,flexShrink:1},label:{color:colors.foreground,fontSize:14,fontWeight:'600'},caption:{fontSize:12,color:colors.muted,lineHeight:18},header:{gap:10},summary:{paddingHorizontal:12,paddingVertical:10,gap:3,backgroundColor:colors.surface,borderRadius:12},search:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.surface,borderRadius:12,paddingHorizontal:12},input:{flex:1,color:colors.foreground,minHeight:48,fontSize:15},models:{flex:1},row:{flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderColor:colors.border},model:{flex:1,minHeight:52,flexDirection:'row',alignItems:'center',gap:8,paddingVertical:5,paddingLeft:10},modelText:{flex:1,gap:1},touch:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},selected:{backgroundColor:colors.surface,borderRadius:10},group:{color:colors.muted,fontSize:12,fontWeight:'600',paddingTop:14,paddingBottom:6,paddingLeft:10},filters:{gap:4},filter:{height:'auto',minHeight:44,paddingHorizontal:12,paddingVertical:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:4},choice:{borderWidth:1,borderColor:colors.accent},section:{gap:8,paddingVertical:16},error:{color:colors.foreground,fontSize:13},apply:{backgroundColor:colors.accent,borderRadius:24,minHeight:48,marginBottom:8},applyText:{color:colors.onAccent,fontWeight:'600',fontSize:15}});
