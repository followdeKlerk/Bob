import {Alert,AppState,NativeEventEmitter,NativeModules,PermissionsAndroid,Platform,type AppStateStatus} from 'react-native';
import {VoiceInputSession,connectVoiceInput,PLATFORM_VOICE_NOTICE} from '../voice-input';
import {stopSpeech,subscribeSpeech,speechSnapshot} from '../speech';
jest.mock('../speech',()=>({stopSpeech:jest.fn(async()=>true),subscribeSpeech:jest.fn(()=>jest.fn()),speechSnapshot:jest.fn(()=>null)}));
const native={availability:jest.fn(),start:jest.fn(),finish:jest.fn(),cancel:jest.fn(),addListener:jest.fn(),removeListeners:jest.fn()};
let changed:jest.Mock,transcript:jest.Mock,error:jest.Mock,session:VoiceInputSession;
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
beforeEach(()=>{
 jest.useFakeTimers();jest.clearAllMocks();jest.replaceProperty(Platform,'OS','android');
 NativeModules.BobVoiceInput=native;
 native.availability.mockResolvedValue('onDevice');native.start.mockResolvedValue(null);native.finish.mockResolvedValue(null);native.cancel.mockResolvedValue(null);
 jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
 Object.defineProperty(AppState,'currentState',{configurable:true,value:'active',writable:true});
 changed=jest.fn();transcript=jest.fn();error=jest.fn();session=new VoiceInputSession(changed,transcript,error);session.configure('backend/chat',true);
});
afterEach(()=>{session.dispose();jest.useRealTimers();jest.restoreAllMocks();});
const currentId=()=>native.start.mock.calls.at(-1)![0];
test('a mic tap asks permission, stops TTS, and admits one on-device utterance; no partial or duplicate draft writes',async()=>{
 expect(native.start).not.toHaveBeenCalled();await session.press();
 expect(PermissionsAndroid.request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
 expect(stopSpeech).toHaveBeenCalledTimes(1);
 expect(jest.mocked(stopSpeech).mock.invocationCallOrder[0]).toBeLessThan(native.start.mock.invocationCallOrder[0]);
 expect(native.start).toHaveBeenCalledWith(expect.any(String),'onDevice',false);
 const id=currentId();session.receive({id,state:'listening'});expect(changed).toHaveBeenLastCalledWith('listening');
 session.receive({id,state:'partial',text:'not a draft'});expect(transcript).not.toHaveBeenCalled();await session.press();expect(native.finish).toHaveBeenCalledWith(id);
 session.receive({id,state:'final',text:'  Hello Bob  '});session.receive({id,state:'final',text:'duplicate'});
 expect(transcript).toHaveBeenCalledTimes(1);expect(transcript).toHaveBeenCalledWith('Hello Bob');expect(changed).toHaveBeenLastCalledWith('idle');
});
test.each(['scope','inactive','disabled','dispose','background'])('%s cancellation fences final callbacks',async reason=>{
 await session.press();const id=currentId();
 if(reason==='scope')session.configure('other/chat',true);
 else if(reason==='inactive'||reason==='disabled')session.configure('backend/chat',false);
 else if(reason==='dispose')session.dispose();
 else {Object.defineProperty(AppState,'currentState',{value:'background',configurable:true,writable:true});session.cancel();}
 session.receive({id,state:'final',text:'old words'});expect(transcript).not.toHaveBeenCalled();expect(native.cancel).toHaveBeenCalledWith(id);
});
test('pending permission cannot start after scope switch, background or cancellation',async()=>{
 const permission=deferred<any>();jest.mocked(PermissionsAndroid.request).mockReturnValue(permission.promise);
 const work=session.press();await flush();session.configure('new/chat',true);permission.resolve(PermissionsAndroid.RESULTS.GRANTED);await work;
 expect(native.start).not.toHaveBeenCalled();expect(stopSpeech).not.toHaveBeenCalled();
});
test.each([PermissionsAndroid.RESULTS.DENIED,PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN])('permission %s never captures',async result=>{
 jest.mocked(PermissionsAndroid.request).mockResolvedValue(result);await session.press();expect(native.start).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith(expect.stringContaining(result==='never_ask_again'?'Settings':'denied'));
});
test('platform recognition has a clear, per-utterance network disclosure before permission and start',async()=>{
 native.availability.mockResolvedValue('platform');const alert=jest.spyOn(Alert,'alert');
 const work=session.press();await flush();expect(alert).toHaveBeenCalledWith('Use Android speech engine?',PLATFORM_VOICE_NOTICE,expect.any(Array),expect.any(Object));
 expect(PLATFORM_VOICE_NOTICE).toContain('may send audio');expect(PermissionsAndroid.request).not.toHaveBeenCalled();expect(native.start).not.toHaveBeenCalled();
 alert.mock.calls[0][2]![1].onPress!();await work;expect(native.start).toHaveBeenCalledWith(expect.any(String),'platform',true);
 session.cancel();const again=session.press();await flush();expect(alert).toHaveBeenCalledTimes(2);alert.mock.calls[1][2]![0].onPress!();await again;expect(native.start).toHaveBeenCalledTimes(1);
});
test('cancelled/stale platform disclosure and native rejection never trigger hidden fallback',async()=>{
 native.availability.mockResolvedValue('platform');const alert=jest.spyOn(Alert,'alert');const work=session.press();await flush();session.configure('new',true);alert.mock.calls[0][2]![1].onPress!();await work;expect(native.start).not.toHaveBeenCalled();
 native.availability.mockResolvedValue('onDevice');native.start.mockRejectedValue(Error('No installed model'));await session.press();expect(native.start).toHaveBeenCalledTimes(1);expect(error).toHaveBeenLastCalledWith('No installed model');
});
test('unavailable bridge/engine provide guidance without permission or capture',async()=>{
 native.availability.mockResolvedValue('unavailable');await session.press();expect(error).toHaveBeenCalledWith(expect.stringContaining('No Android speech recognizer'));expect(PermissionsAndroid.request).not.toHaveBeenCalled();
 delete NativeModules.BobVoiceInput;await session.press();expect(error).toHaveBeenCalledWith(expect.stringContaining('Android Bob build'));expect(native.start).not.toHaveBeenCalled();
});
test.each(['No speech','Network failure','busy','interrupted'])('terminal %s clears state once and permits deliberate retry',async message=>{
 await session.press();const id=currentId();session.receive({id,state:'error',message});session.receive({id,state:'error',message});expect(error).toHaveBeenCalledTimes(1);expect(transcript).not.toHaveBeenCalled();
 await session.press();expect(currentId()).not.toBe(id);session.receive({id,state:'final',text:'stale'});expect(transcript).not.toHaveBeenCalled();
});
test('a second setup tap cancels, and a finishing tap cancels without inserting partial text',async()=>{
 const availability=deferred<any>();native.availability.mockReturnValueOnce(availability.promise);const work=session.press();await session.press();availability.resolve('onDevice');await work;expect(native.start).not.toHaveBeenCalled();
 await session.press();const id=currentId();session.receive({id,state:'listening'});await session.press();await session.press();session.receive({id,state:'final',text:'cancelled'});expect(transcript).not.toHaveBeenCalled();expect(native.cancel).toHaveBeenCalledWith(id);
});
test('hung availability is bounded and late completion cannot resurrect capture',async()=>{
 const availability=deferred<any>();native.availability.mockReturnValueOnce(availability.promise);const work=session.press();jest.advanceTimersByTime(40000);availability.resolve('onDevice');await work;expect(native.start).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith(expect.stringContaining('timed out'));
});
test('event and AppState subscriptions are removed; background and new TTS cancel listening',async()=>{
 const remove=jest.fn();let app!:(state:AppStateStatus)=>void;let event!:(event:any)=>void;
 jest.spyOn(AppState,'addEventListener').mockImplementation((_name,callback)=>{app=callback;return {remove};});
 jest.spyOn(NativeEventEmitter.prototype,'addListener').mockImplementation((_name,callback)=>{event=callback;return {remove};});
 const disconnect=connectVoiceInput(session);await session.press();const first=currentId();app('background');event({id:first,state:'final',text:'stale'});expect(transcript).not.toHaveBeenCalled();
 await session.press();jest.mocked(speechSnapshot).mockReturnValue('reply');jest.mocked(subscribeSpeech).mock.calls.at(-1)![0]();expect(native.cancel).toHaveBeenCalledWith(currentId());jest.mocked(speechSnapshot).mockReturnValue(null);
 disconnect();expect(remove).toHaveBeenCalledTimes(2);await session.press();expect(native.start).toHaveBeenCalledTimes(2);
});
test('empty or excessive final results are rejected, never silently truncated',async()=>{
 for(const text of ['  ','x'.repeat(16001)]){await session.press();session.receive({id:currentId(),state:'final',text});}
 expect(transcript).not.toHaveBeenCalled();expect(error).toHaveBeenCalledTimes(2);
});
test('scope cancellation while stopping TTS prevents listening, and late rejection cannot disturb a newer utterance',async()=>{
 const stopped=deferred<boolean>();jest.mocked(stopSpeech).mockReturnValueOnce(stopped.promise);
 const first=session.press();await flush();session.configure('new/chat',true);stopped.resolve(true);await first;expect(native.start).not.toHaveBeenCalled();
 let reject!:(error:Error)=>void;native.start.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
 const old=session.press();await flush();const id=currentId();session.configure('third/chat',true);await session.press();const next=currentId();
 reject(Error('Old failure'));await old;session.receive({id,state:'error',message:'old'});session.receive({id:next,state:'final',text:'Current words'});
 expect(error).not.toHaveBeenCalled();expect(transcript).toHaveBeenCalledTimes(1);expect(transcript).toHaveBeenCalledWith('Current words');
});
