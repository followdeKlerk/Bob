import {Text} from './app-text';
import React,{useEffect,useRef,useState} from 'react';
import {NativeModules,Pressable,View} from 'react-native';
import {colors} from '../theme';
export type DiagnosticRequest={id:string;purpose:string;expiresAt:number;status:string;canRespond:boolean};
export function DiagnosticCard({request,respond}:{request:DiagnosticRequest;respond:(value:object)=>Promise<unknown>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now());
 const lock=useRef(false),mounted=useRef(true),captured=useRef<object|undefined>(undefined);
 useEffect(()=>{mounted.current=true;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{mounted.current=false;clearInterval(timer);};},[]);
 const active=['pending','approved'].includes(request.status)&&request.expiresAt>now;
 const send=async(approve:boolean)=>{
  if(lock.current||!active||!request.canRespond)return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   if(!approve){await respond({id:request.id,action:'decline'});if(mounted.current)setMessage('Declined. No report sent.');return;}
   if(request.status==='pending')await respond({id:request.id,action:'approve'});
   // No mount effect, background worker or mere request arrival can capture.
   if(Date.now()>=request.expiresAt)throw Error('Request expired before capture. No report sent.');
   if(!captured.current){
    if(!NativeModules.BobPlatform?.approvedDiagnostics)throw Error('Capture requires the updated Android app.');
    const raw=await NativeModules.BobPlatform.approvedDiagnostics();
    if(typeof raw!=='string'||raw.length>60000)throw Error('Diagnostic capture unavailable or too large.');
    captured.current=JSON.parse(raw);
   }
   await respond({id:request.id,action:'upload',report:captured.current});
   if(mounted.current)setMessage('Report received by this backend.');
  }catch{if(mounted.current)setMessage('Could not confirm completion. The request status will refresh; nothing is retried automatically. If still approved, tap Capture and send to try explicitly.');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 return <View testID="diagnostic-card" style={{padding:16,gap:12,borderWidth:1,borderColor:colors.border,borderRadius:16,backgroundColor:colors.composer}}>
  <Text style={{color:colors.foreground,fontSize:17,fontWeight:'600'}}>Share app diagnostics?</Text>
  <Text style={{color:colors.foreground,fontSize:15}}>{request.purpose}</Text>
  <Text style={{color:colors.muted,fontSize:13,lineHeight:21}}>Shares app/build and WebView versions, recent sanitized lifecycle/exit metadata, and inline-widget sizing/fallback events from this phone. No messages, widget HTML/data, credentials, location, screenshots or raw Android logs. The report goes to this chat and its configured model and remains in chat history.</Text>
  {active&&request.canRespond?<>
   <Pressable accessibilityRole="button" accessibilityLabel={request.status==='approved'?'Capture and send diagnostics':'Approve and send diagnostics'} disabled={busy} onPress={()=>void send(true)} style={{padding:14,minHeight:48,borderRadius:12,backgroundColor:colors.accent,opacity:busy?0.5:1}}><Text style={{color:colors.onAccent,fontSize:15,fontWeight:'600'}}>{busy?'Sending…':request.status==='approved'?'Capture and send':'Approve and send'}</Text></Pressable>
   {request.status==='pending'&&<Pressable accessibilityRole="button" accessibilityLabel="Decline diagnostics" disabled={busy} onPress={()=>void send(false)} style={{padding:12,minHeight:48}}><Text style={{color:colors.foreground,fontSize:15}}>Decline</Text></Pressable>}
  </>:<Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:13}}>{request.status==='received'?'Report received.':active?'Approval is available only on the phone that sent the request.':`Request ${['pending','approved'].includes(request.status)?'expired':request.status}.`}</Text>}
  {!!message&&<Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:13}}>{message}</Text>}
  {active&&<Text style={{color:colors.muted,fontSize:12}}>Expires in {Math.max(0,Math.ceil((request.expiresAt-now)/1000))} seconds. Capture starts only after approval.</Text>}
 </View>;
}
