import {PageSearch} from './page-search';
import {menuButtonChrome} from '../menu-button-style';
import {Text} from './app-text';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Modal,View,FlatList,ScrollView,Pressable,StyleSheet,KeyboardAvoidingView,Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Check,Star} from 'lucide-react-native';
import {Button} from './ui/button';
import {menuRadii,themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionActions,SectionBody,SectionAction} from './section-ui';
export type ModelOption={provider:string;modelId:string;name:string;available?:boolean;thinkingLevels?:string[]};
export type ModelChoice={model?:{provider:string;modelId:string};thinkingLevel?:string};
const favoriteKey='model-favorites:v1';
const key=(m:{provider:string;modelId:string})=>JSON.stringify([m.provider,m.modelId]);
const labels:Record<string,string>={off:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum'};
export function ModelPicker({visible,models,current,onClose,onApply,loading=false}:{visible:boolean;loading?:boolean;models:ModelOption[];current:ModelChoice;onClose:()=>void;onApply:(choice:Required<ModelChoice>)=>Promise<void>}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const [query,setQuery]=useState(''),[provider,setProvider]=useState(''),[selected,setSelected]=useState(''),[thinking,setThinking]=useState('medium'),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [favorites,setFavorites]=useState<string[]>([]),[favoritesReady,setFavoritesReady]=useState(false),[favoriteSaving,setFavoriteSaving]=useState(false);
 const favoriteBusy=useRef(false),effortStrip=useRef<React.ComponentRef<typeof ScrollView>>(null);
 useEffect(()=>{if(!visible)return;let active=true;setFavoritesReady(false);void AsyncStorage.getItem(favoriteKey).then(raw=>{const parsed:unknown=raw===null?[]:JSON.parse(raw);if(!Array.isArray(parsed)||!parsed.every(v=>typeof v==='string'))throw Error('Invalid favourites');if(active){setFavorites(parsed);setFavoritesReady(true);}}).catch(()=>{if(active)setError('Could not load favourites. Reopen model selection to retry.');});return()=>{active=false;};},[visible]);
 useEffect(()=>{if(visible){setQuery('');setProvider('');setSelected(current.model?key(current.model):'');const supported=models.find(m=>current.model&&key(m)===key(current.model))?.thinkingLevels??[];setThinking(supported.includes(current.thinkingLevel??'')?current.thinkingLevel!:supported.includes('medium')?'medium':supported[0]??'off');setError('');setSaving(false);}},[visible,current]);
 const available=models.filter(m=>m.available!==false);
 const providers=[...new Set(available.map(m=>m.provider))];
 const chosen=models.find(m=>key(m)===selected);
 const levels=chosen?.thinkingLevels??[];
 const rows=useMemo(()=>models.filter(m=>m.available!==false&&(!provider||m.provider===provider)&&`${m.name} ${m.modelId} ${m.provider}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Number(favorites.includes(key(b)))-Number(favorites.includes(key(a)))||a.name.localeCompare(b.name)||key(a).localeCompare(key(b))),[models,provider,query,favorites]);
 const choose=(m:ModelOption)=>{setSelected(key(m));const supported=m.thinkingLevels??[];if(!supported.includes(thinking))setThinking(supported.includes('medium')?'medium':supported[0]??'off');setError('');};
 async function toggleFavorite(m:ModelOption){
  if(favoriteBusy.current||!favoritesReady)return;favoriteBusy.current=true;setFavoriteSaving(true);
  const id=key(m),next=favorites.includes(id)?favorites.filter(v=>v!==id):[...favorites,id];
  try{await AsyncStorage.setItem(favoriteKey,JSON.stringify(next));setFavorites(next);setError('');}catch{setError('Could not save favourites. Please try again.');}finally{favoriteBusy.current=false;setFavoriteSaving(false);}
 }
 return <Modal visible={visible} transparent animationType="slide" onRequestClose={()=>{if(!saving)onClose();}}>
  {/* Android RN Modal already resizes its dialog for the IME; only iOS needs JS avoidance. */}
  <KeyboardAvoidingView style={s.overlay} enabled={Platform.OS==='ios'} behavior="padding">
   <Pressable style={StyleSheet.absoluteFill} onPress={()=>{if(!saving)onClose();}} accessibilityLabel="Close model selection"/>
   <SafeAreaView edges={['top','bottom']} style={s.sheet}>
    <SectionHeading title="Model & thinking"/>
    <View testID="model-search-header" style={s.searchHeader}>
     <PageSearch label="Search models" placeholder="Search models" value={query} onChangeText={setQuery} editable={!saving}/>

    </View>
    <SectionBody footer={<SectionActions overlay leading={<SectionAction label="Close model selection" text="Cancel" disabled={saving} onPress={onClose}/>}><SectionAction label="Apply model selection" text={saving?'Saving…':'Apply'} busy={saving} primary disabled={saving||loading||!chosen||!levels.includes(thinking)} onPress={()=>{if(!chosen)return;setSaving(true);setError('');void onApply({model:{provider:chosen.provider,modelId:chosen.modelId},thinkingLevel:thinking}).catch(e=>setError(String(e.message??e))).finally(()=>setSaving(false));}}/></SectionActions>}>{clearance=><>
    <FlatList data={rows} keyExtractor={key} style={s.models} keyboardShouldPersistTaps="handled" extraData={[selected,favorites,favoriteSaving,saving,loading]} ListHeaderComponent={<View style={s.header}>

     {providers.length>1&&<ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.filters}>{['',...providers].map(p=><Button key={p||'all'} variant={provider===p?'secondary':'ghost'} style={[s.filter,provider===p&&s.choice]} disabled={saving||loading} onPress={()=>setProvider(p)} accessibilityLabel={p||'All providers'} accessibilityState={{selected:provider===p}}>{provider===p&&<Check size={18} color={colors.accent}/>}<Text typography="ui" style={[s.text,s.buttonLabel]}>{p||'All providers'}</Text></Button>)}</ScrollView>}
    </View>} renderItem={({item:m,index})=>{const favorite=favorites.includes(key(m));return <View>
     {(index===0||favorite!==favorites.includes(key(rows[index-1])))&&<Text typography="ui" style={s.group}>{favorite?'Favourites':'All models'}</Text>}
     <View style={[s.row,current.model&&key(m)===key(current.model)&&s.current,selected===key(m)&&s.selected]}>
      <Pressable style={s.model} disabled={saving||loading} onPress={()=>choose(m)} accessibilityLabel={`Select ${m.name} (${m.provider})`} accessibilityRole="radio" accessibilityHint={current.model&&key(m)===key(current.model)?"Currently applied model":"Applies only after tapping Apply"} accessibilityState={{checked:selected===key(m)}}><View style={s.modelText}><Text typography="ui" style={s.text}>{m.name}</Text><Text typography="ui" style={s.caption}>{m.provider}{current.model&&key(m)===key(current.model)?' · Current':''}</Text></View>{selected===key(m)&&<Check size={18} color={colors.accent}/>}</Pressable>
      <Pressable style={s.touch} disabled={!favoritesReady||favoriteSaving||saving||loading} onPress={()=>{void toggleFavorite(m);}} accessibilityRole="button" accessibilityLabel={`${favorite?'Unfavourite':'Favourite'} ${m.name} (${m.provider})`} accessibilityState={{selected:favorite,disabled:!favoritesReady||favoriteSaving||saving||loading}}><Star size={20} color={favorite?colors.accent:colors.muted} fill={favorite?colors.accent:'transparent'}/></Pressable>
     </View>
    </View>;}} ListEmptyComponent={<Text typography="ui" style={s.caption}>{loading?'Loading available models…':available.length?'No matching models.':'Connect a provider in Settings to choose a model.'}</Text>}/>
    {/* Keep thinking controls reachable outside the catalog; swipe choices sideways and allow vertical overflow only on short screens. */}
    <View testID="selected-model-panel" style={s.selection}>
     <ScrollView testID="selected-model-controls" style={s.controls} contentContainerStyle={[s.section,{paddingBottom:clearance+8}]} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      <Text typography="ui" style={s.label}>Thinking effort</Text>
      <ScrollView ref={effortStrip} testID="thinking-level-strip" horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.effortScroll} contentContainerStyle={s.effortStrip}>{levels.map(level=><Button key={level} variant={thinking===level?'secondary':'ghost'} style={[s.filter,thinking===level&&s.choice]} disabled={saving||loading} onPress={()=>setThinking(level)} onLayout={({nativeEvent:{layout}})=>{if(thinking===level)effortStrip.current?.scrollTo({x:Math.max(0,layout.x-8),animated:false});}} accessibilityLabel={`${labels[level]??level} thinking`} accessibilityRole="radio" accessibilityState={{checked:thinking===level}}>{thinking===level&&<Check size={18} color={colors.accent}/>}<Text typography="ui" style={[s.text,s.buttonLabel]}>{labels[level]??level}</Text></Button>)}</ScrollView>
      {!chosen&&<Text typography="ui" style={s.caption}>Choose a model first.</Text>}
      {!!error&&<Text typography="ui" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
     </ScrollView>

    </View>
    </>}</SectionBody>
   </SafeAreaView>
  </KeyboardAvoidingView>
 </Modal>;
}
const sTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000088'},sheet:{...shadows.popup,height:'94%',backgroundColor:colors.background,borderTopLeftRadius:menuRadii.card,borderTopRightRadius:menuRadii.card,borderWidth:1,borderColor:colors.border,gap:8},buttonLabel:{...menuButtonChrome({colors,shadows}).label},text:{color:colors.foreground,fontSize:15,flexShrink:1},label:{color:colors.foreground,fontSize:14,fontWeight:'600'},caption:{fontSize:14,color:colors.muted,lineHeight:20},header:{gap:10},searchHeader:{paddingHorizontal:16,gap:10},summary:{paddingVertical:4,gap:2},models:{flex:1,minHeight:0,marginHorizontal:20},row:{flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderColor:colors.border,borderLeftWidth:3,borderLeftColor:'transparent'},current:{borderLeftColor:colors.accent},model:{flex:1,minHeight:52,flexDirection:'row',alignItems:'center',gap:8,paddingVertical:5,paddingLeft:10},modelText:{flex:1,gap:1},touch:{...menuButtonChrome({colors,shadows}).circle,minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},selected:{backgroundColor:colors.selectedSurface,borderRadius:menuRadii.control},group:{color:colors.muted,fontSize:14,fontWeight:'600',paddingTop:14,paddingBottom:6,paddingLeft:10},filters:{gap:4},filter:{...menuButtonChrome({colors,shadows}).pill,borderRadius:999,height:'auto',minHeight:48,minWidth:48,paddingHorizontal:12,paddingVertical:8,flexShrink:0},effortScroll:{flexGrow:0,flexShrink:0},effortStrip:{gap:6,paddingVertical:4,paddingHorizontal:2},choice:{...menuButtonChrome({colors,shadows}).selected},selection:{paddingHorizontal:20,maxHeight:'55%',flexShrink:1,minHeight:0,paddingTop:12,gap:8},controls:{flexGrow:0,flexShrink:1},section:{gap:8,paddingBottom:8},error:{color:colors.foreground,fontSize:14},}));
