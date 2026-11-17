import {Alert,NativeModules} from 'react-native';
import {startSpeech,stopSpeech,speechSnapshot} from '../speech';
import {VoiceInputSession} from '../voice-input';
jest.mock('react-native',()=>({
 Alert:{alert:jest.fn()},AppState:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))},Platform:{OS:'android'},
 PermissionsAndroid:{request:jest.fn(async()=>'granted'),PERMISSIONS:{RECORD_AUDIO:'microphone'},RESULTS:{GRANTED:'granted'}},
 NativeModules:{BobSpeech:{speak:jest.fn(async()=>{}),stop:jest.fn(async()=>{})},BobVoiceInput:{windowFocused:jest.fn(async()=>true),availability:jest.fn(async()=>'onDevice'),start:jest.fn(async()=>{}),cancel:jest.fn(async()=>{})}},
 NativeEventEmitter:jest.fn().mockImplementation(()=>({addListener:()=>({remove:jest.fn()})})),
}));
beforeEach(async()=>{NativeModules.BobSpeech.stop.mockResolvedValue(undefined);await stopSpeech();jest.clearAllMocks();});
test.each(['stop ERROR','stop throw','shutdown throw'])('native %s rejects explicit stop and prevents recognition on repeated uncertain cleanup attempts',async failure=>{
 await startSpeech('reply','Do not transcribe this reply');expect(speechSnapshot()).toBe('reply');
 NativeModules.BobSpeech.stop.mockRejectedValueOnce(Error(failure)).mockRejectedValueOnce(Error(failure));
 const error=jest.fn(),transcript=jest.fn(),session=new VoiceInputSession(jest.fn(),transcript,error);session.configure('backend/chat',true);
 await session.press();expect(NativeModules.BobVoiceInput.start).not.toHaveBeenCalled();expect(transcript).not.toHaveBeenCalled();expect(speechSnapshot()).toBe('reply');
 await session.press();expect(NativeModules.BobSpeech.stop).toHaveBeenCalledTimes(2);expect(NativeModules.BobVoiceInput.start).not.toHaveBeenCalled();
 expect(error).toHaveBeenCalledTimes(2);expect(error).toHaveBeenCalledWith('Read aloud could not stop. Stop playback before dictating.');expect(Alert.alert).toHaveBeenCalledWith('Unable to stop speech','Try Stop again. If it still fails, close Bob completely before dictating.');
 session.dispose();
});
test('successful stop still clears Read aloud and returns admission safety to the caller',async()=>{
 await startSpeech('reply','Read normally');expect(await stopSpeech()).toBe(true);expect(speechSnapshot()).toBeNull();
});
