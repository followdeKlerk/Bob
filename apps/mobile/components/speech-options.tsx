import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Alert,NativeModules,KeyboardAvoidingView,Modal,ScrollView,View,useWindowDimensions} from 'react-native';
import {Button} from './ui/button';
import {Text,TextInput} from './app-text';
import {useTheme} from '../theme';
import {openSpeechSettings} from '../speech';
import type {VoiceProvider,VoiceInputSession} from '../voice-input';

/** Shared with Settings → Voice; never shown in the live capture panel. */
export const SPEECH_CAPTURE_HELP='Voice Chat sends final words once and reads the reply; dictation only edits your draft. Tap for each new turn. Bob requests a 3-second pause, but Android providers may end sooner. Bob never restarts the mic automatically.';

type Pending={initial:string;generation:number;language?:string;providers?:VoiceProvider[];error?:string;resolve:(value:VoiceProvider|undefined)=>void;signal:AbortSignal};
type NetworkConsent={provider:VoiceProvider;resolve:(value:boolean)=>void;signal:AbortSignal};
/** Ephemeral selection UI. Closing, backgrounding or replacing the owner resolves without capture. */
export function useSpeechOptions(session:VoiceInputSession){
 const [pending,setPending]=useState<Pending|null>(null);
 const [consent,setConsent]=useState<NetworkConsent|null>(null);
 const [custom,setCustom]=useState('');
 const owner=useRef<Pending|null>(null);
 const consentOwner=useRef<NetworkConsent|null>(null);
 const loadGeneration=useRef(0);
 const {colors}=useTheme();const {height}=useWindowDimensions();
 const close=useCallback((expected?:Pending|null)=>{const old=owner.current;if(expected&&old?.resolve!==expected.resolve)return;loadGeneration.current++;owner.current=null;setPending(null);old?.resolve(undefined);},[]);
 const settleConsent=useCallback((allow=false,expected?:NetworkConsent|null)=>{const old=consentOwner.current;if(expected&&old!==expected)return;consentOwner.current=null;setConsent(null);old?.resolve(allow&&!old.signal.aborted);},[]);
 useEffect(()=>{
  session.setPicker((initial,load,signal)=>new Promise(resolve=>{
   if(owner.current)close();
   const entry:Pending={initial,generation:++loadGeneration.current,resolve,signal};owner.current=entry;
   const abort=()=>{if(owner.current===entry)close();};signal.addEventListener('abort',abort,{once:true});
   setCustom('');setPending(entry);
   // Load is only invoked by a deliberate language choice, never by rendering the modal.
   entryLoad.current=async language=>{
    if(owner.current!==entry||signal.aborted)return;
    const generation=++loadGeneration.current;
    setPending({...entry,generation,language});
    try{const providers=await load(language);if(owner.current===entry&&!signal.aborted&&generation===loadGeneration.current)setPending({...entry,generation,language,providers});}
    catch{if(owner.current===entry&&!signal.aborted&&generation===loadGeneration.current)setPending({...entry,generation,language,error:'Could not inspect speech providers. Close and try again.'});}
   };
  }));
  session.setConsent((provider,signal)=>new Promise(resolve=>{
   if(consentOwner.current)settleConsent();
   const entry:NetworkConsent={provider,resolve,signal};consentOwner.current=entry;
   signal.addEventListener('abort',()=>{if(consentOwner.current===entry)settleConsent();},{once:true});
   setConsent(entry);
  }));
  return()=>{session.setPicker(undefined);session.setConsent(undefined);close();settleConsent();};
 },[session,close,settleConsent]);
 const entryLoad=useRef<(language:string)=>Promise<void>>(async()=>{});
 const choose=(provider:VoiceProvider,expected:Pending)=>{const old=owner.current;if(!old||old.resolve!==expected.resolve||expected.generation!==loadGeneration.current||old.signal.aborted)return;loadGeneration.current++;owner.current=null;setPending(null);old.resolve(provider);};
 const request=(tag:string)=>{if(pending&&pending.resolve===owner.current?.resolve&&pending.generation===loadGeneration.current)void entryLoad.current(tag);};
 const row=(label:string,description:string,onPress:()=>void,key=label)=><Button variant="ghost" key={key} accessibilityLabel={label} accessibilityHint={description} onPress={onPress} style={{minHeight:56,height:'auto',alignItems:'flex-start',paddingLeft:12,paddingRight:12,paddingTop:10,paddingBottom:10,borderWidth:1,borderColor:colors.border,borderRadius:12,flexDirection:'column'}}>
  <Text style={{color:colors.foreground,fontSize:16,flexShrink:1}}>{label}</Text><Text style={{color:colors.muted,fontSize:13,flexShrink:1}}>{description}</Text>
 </Button>;
 const manage=(action:()=>void)=>{
  if(!pending||pending.resolve!==owner.current?.resolve||pending.generation!==loadGeneration.current||pending.signal.aborted)return;
  action();
 };
 const voicePreference=async(system:boolean)=>{
  session.cancel();
  try{
   if(system)await openSpeechSettings();
   else{
    if(!NativeModules.BobSpeech?.useDefaultVoice)throw Error('Install an updated Bob Android build.');
    await NativeModules.BobSpeech.useDefaultVoice();
   }
  }catch(error){Alert.alert('Speech options',error instanceof Error?error.message:'Could not change voice preferences.');}
 };
 const language=pending?.language;
 return <><Modal visible={!!pending} transparent animationType="fade" onRequestClose={()=>close(pending)} accessibilityViewIsModal>
  <KeyboardAvoidingView style={{flex:1,justifyContent:'center',paddingHorizontal:16,backgroundColor:'rgba(0,0,0,0.7)'}}>
   <View testID="speech-options" style={{backgroundColor:colors.background,borderRadius:16,borderWidth:1,borderColor:colors.border,maxHeight:Math.max(0,height-48),padding:16,gap:8}}>
    <Text accessibilityRole="header" style={{fontSize:20,color:colors.foreground}}>Speech options</Text>
    <Text style={{color:colors.muted}}>Choose a language, then a provider. Choices are remembered on this phone; models depend on the provider.</Text>
    <ScrollView style={{flexShrink:1,minHeight:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8,paddingBottom:8}}>
     {!language?<>
      {row('English (UK) · en-GB','Request UK English; availability depends on the selected provider.',()=>request('en-GB'))}
      {row('English (US) · en-US','Request US English; availability depends on the selected provider.',()=>request('en-US'))}
      <Text style={{color:colors.foreground}}>Other Android language tag</Text>
      <TextInput accessibilityLabel="Other speech language tag" value={custom} onChangeText={setCustom} autoCapitalize="none" autoCorrect={false} placeholder="e.g. en-AU or zh-Hant-TW" style={{color:colors.foreground,minHeight:48,borderWidth:1,borderColor:colors.border,borderRadius:12,paddingLeft:12,paddingRight:12}}/>
      {row('Request entered language','Only a request; the provider checks whether its model is available.',()=>{const tag=custom.trim();if(pending?.resolve!==owner.current?.resolve||pending?.generation!==loadGeneration.current)return;if(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(tag)&&tag.length<=100)request(tag);else setPending({...pending!,error:'Enter a valid BCP-47 language tag, such as en-AU.'});})}
      {!!pending?.error&&<Text style={{color:colors.foreground}}>{pending.error}</Text>}
     </>:<>
      <Text style={{color:colors.foreground}}>Requested language: {language}</Text>
      {pending?.error?<Text style={{color:colors.foreground}}>{pending.error}</Text>:pending?.providers?.length?pending.providers.map(plan=>row(`${plan.label} · ${language}`,plan.networkCapable?(plan.approved?'Network speech approved on this phone.':'May send audio over the network; approval is remembered.'):'On-device route; model checked when starting.',()=>choose(plan,pending!),plan.key)):<Text style={{color:colors.muted}}>Checking installed providers…</Text>}
      {row('Back to languages','No microphone is started.',()=>{if(pending?.resolve!==owner.current?.resolve||pending?.generation!==loadGeneration.current)return;const generation=++loadGeneration.current;setPending({...pending!,generation,language:undefined,providers:undefined,error:undefined});})}
     </>}
     {!language&&<>
      {row('Forget network speech approval','Ask again before any network-capable provider receives audio. Keeps your language/provider choice.',()=>manage(()=>void session.revokeApprovals()))}
      {row('Use Google UK voice','Read replies with Google’s installed offline en-GB voice where available.',()=>manage(()=>void voicePreference(false)))}
      {row('Android voice & speed','Use Android’s chosen engine, voice and speed instead of Bob’s Google UK default.',()=>manage(()=>void voicePreference(true)))}
      <Text style={{color:colors.muted}}>{SPEECH_CAPTURE_HELP}</Text>
     </>}
    </ScrollView>
    <Button variant="ghost" accessibilityLabel="Close speech options" onPress={()=>close(pending)} style={{minHeight:48,paddingLeft:12,paddingRight:12,paddingTop:8,paddingBottom:8}}><Text style={{color:colors.accent}}>Close</Text></Button>
   </View>
  </KeyboardAvoidingView>
 </Modal>
 <Modal visible={!!consent} transparent animationType="fade" onRequestClose={()=>settleConsent(false,consent)} accessibilityViewIsModal>
  <View style={{flex:1,justifyContent:'center',paddingHorizontal:16,backgroundColor:'rgba(0,0,0,0.7)'}}>
   <View testID="speech-network-consent" style={{backgroundColor:colors.background,borderRadius:16,borderWidth:1,borderColor:colors.border,maxHeight:Math.max(0,height-48),padding:16,gap:12}}>
    <Text accessibilityRole="header" style={{fontSize:20,color:colors.foreground}}>Allow network speech?</Text>
    <ScrollView style={{flexShrink:1,minHeight:0}} keyboardShouldPersistTaps="always">
     <Text style={{color:colors.foreground,fontSize:16,lineHeight:24}}>{consent?.provider.label} ({consent?.provider.language}). May send microphone audio to this provider over the network. Bob does not save or upload audio. Remember approval on this phone? Revoke in Speech options.</Text>
    </ScrollView>
    <View style={{flexDirection:'row',gap:8}}>
     <Button variant="outline" accessibilityLabel="Cancel network speech" onPress={()=>settleConsent(false,consent)} style={{flex:1,minWidth:48,minHeight:48,height:'auto',paddingLeft:8,paddingRight:8,paddingTop:8,paddingBottom:8,borderColor:colors.border}}><Text style={{color:colors.foreground}}>Cancel</Text></Button>
     <Button variant="outline" accessibilityLabel="Allow and remember network speech" onPress={()=>settleConsent(true,consent)} style={{flex:1,minWidth:48,minHeight:48,height:'auto',paddingLeft:8,paddingRight:8,paddingTop:8,paddingBottom:8,borderColor:colors.border}}><Text style={{color:colors.foreground}}>Allow & remember</Text></Button>
    </View>
   </View>
  </View>
 </Modal></>;
}
