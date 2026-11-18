import React from 'react';
import {Pressable,ScrollView,Text,useColorScheme} from 'react-native';
import {captureJsFault} from '../js-fault';
import {darkColors,lightColors} from '../theme-tokens';
import {APP_FONT_FAMILY} from '../typography';

// Do not infer recoverability from arbitrary error messages. Known invariant
// violations and explicitly fatal errors must not be retried in this runtime.
function isFatal(error:unknown){
 try{const value=error as {name?:unknown;fatal?:unknown};return value?.fatal===true||value?.name==='Invariant Violation'||value?.name==='InvariantViolation';}
 catch{return true;}
}
function Failure({fatal,retried,onRetry}:{fatal:boolean;retried:boolean;onRetry:()=>void}){
 // The boundary wraps both providers: recovery must not depend on either one.
 const colors=useColorScheme()==='light'?lightColors:darkColors;
 const text={fontFamily:APP_FONT_FAMILY,color:colors.foreground,fontSize:16,lineHeight:25};
 return <ScrollView testID="diagnostic-fallback" style={{flex:1,backgroundColor:colors.background}} contentContainerStyle={{flexGrow:1,justifyContent:'center',paddingHorizontal:24,paddingVertical:64,gap:16}}>
  <Text accessibilityRole="header" style={[text,{fontSize:24,lineHeight:32,fontWeight:'600'}]}>Bob could not display this screen</Text>
  <Text accessibilityLiveRegion="polite" style={text}>{fatal?'An internal safety check failed. Retrying in this runtime is not safe.':retried?'The screen failed again. No more retries will run in this session.':'An unexpected display error stopped the app. You can try reopening the screen once.'}</Text>
  <Text style={text}>No stored data has been cleared by this recovery screen. Unsaved edits may not be recoverable.</Text>
  {!fatal&&!retried&&<Pressable accessibilityRole="button" accessibilityLabel="Retry app once" onPress={onRetry} style={{minHeight:48,padding:12,borderWidth:1,borderColor:colors.border,borderRadius:12,alignItems:'center',justifyContent:'center'}}><Text style={text}>Retry once</Text></Pressable>}
  <Text style={text}>{fatal||retried?'Close and reopen Bob. If this continues, report it and request app diagnostics.':'If retry does not help, close and reopen Bob. If this continues, report it and request app diagnostics.'}</Text>
 </ScrollView>;
}
/** Contain render faults without resetting storage or automatically remounting. */
export class DiagnosticBoundary extends React.Component<{children:React.ReactNode},{failed:boolean;fatal:boolean;retried:boolean}> {
 state={failed:false,fatal:false,retried:false};
 static getDerivedStateFromError(error:unknown){return{failed:true,fatal:isFatal(error)};}
 componentDidCatch(error:Error){captureJsFault(error,'render');}
 private retry=()=>{this.setState(state=>state.failed&&!state.fatal&&!state.retried?{failed:false,fatal:false,retried:true}:null);};
 render(){return this.state.failed?<Failure fatal={this.state.fatal} retried={this.state.retried} onRetry={this.retry}/>:this.props.children;}
}
