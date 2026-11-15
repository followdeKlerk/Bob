import {AppState,NativeModules,Platform} from 'react-native';

/** A best-effort selection tick, not a success receipt. Never falls back to a
 * timed vibration or delays the selected action; older app builds are a no-op. */
export function selectionHaptic():void{
 if(Platform.OS!=='android'||AppState.currentState!=='active')return;
 try{NativeModules.BobPlatform?.selectionHaptic?.();}catch{/* Tactile feedback must never block an action. */}
}
