import {AppState,NativeEventEmitter,NativeModules,PermissionsAndroid,Platform,type AppStateStatus} from 'react-native';
import {VoiceInputSession,connectVoiceInput,type VoiceProvider} from '../voice-input';
import {stopSpeech,subscribeSpeech,speechSnapshot} from '../speech';
jest.mock('../speech',()=>({stopSpeech:jest.fn(async()=>true),subscribeSpeech:jest.fn(()=>jest.fn()),speechSnapshot:jest.fn(()=>null)}));
const native={windowFocused:jest.fn(async()=>true),availability:jest.fn(),start:jest.fn(),finish:jest.fn(),cancel:jest.fn(),addListener:jest.fn(),removeListeners:jest.fn()};
let changed:jest.Mock,transcript:jest.Mock,error:jest.Mock,session:VoiceInputSession;
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
beforeEach(()=>{
 jest.useFakeTimers();jest.clearAllMocks();jest.replaceProperty(Platform,'OS','android');
 NativeModules.BobVoiceInput=native;delete (native as any).options;delete (native as any).startConfigured;
 native.windowFocused.mockResolvedValue(true);native.availability.mockResolvedValue('onDevice');native.start.mockResolvedValue(null);native.finish.mockResolvedValue(null);native.cancel.mockResolvedValue(null);
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
const namedProvider={mode:'platform' as const,key:'selected-service|en-PL',label:'Selected service',language:'en-PL',networkCapable:true};
function namedNetwork(){const startConfigured=jest.fn(async(_id:string,_key:string,_language:string,_consent:boolean)=>{});Object.assign(native,{options:jest.fn(async()=>[namedProvider]),startConfigured});return startConfigured;}
test('unapproved native configuration requires informed approval before permission or start',async()=>{
 const startConfigured=namedNetwork();const decisions=[deferred<boolean>(),deferred<boolean>()];let request=0;const consent=jest.fn((_provider:VoiceProvider,_signal:AbortSignal):Promise<boolean>=>decisions[request++].promise);
 session.setConsent(consent);const work=session.press();await flush();expect(consent).toHaveBeenCalledWith(namedProvider,expect.any(AbortSignal));
 expect(PermissionsAndroid.request).not.toHaveBeenCalled();expect(startConfigured).not.toHaveBeenCalled();
 decisions[0].resolve(true);await work;expect(startConfigured).toHaveBeenCalledWith(expect.any(String),namedProvider.key,'en-PL',true);
 session.cancel();const again=session.press();await flush();expect(consent).toHaveBeenCalledTimes(2);decisions[1].resolve(false);await again;expect(startConfigured).toHaveBeenCalledTimes(1);
});
test('stale consent, changed scope and unavailable named provider never approve a hidden fallback',async()=>{
 const startConfigured=namedNetwork();const decision=deferred<boolean>();session.setConsent(()=>decision.promise);
 const work=session.press();await flush();session.configure('new',true);decision.resolve(true);await work;expect(startConfigured).not.toHaveBeenCalled();
 delete (native as any).options;delete (native as any).startConfigured;native.availability.mockResolvedValue('platform');
 await session.press();expect(native.start).not.toHaveBeenCalled();expect(error).toHaveBeenLastCalledWith(expect.stringContaining('Named speech-provider consent'));
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
 jest.spyOn(AppState,'addEventListener').mockImplementation((name,callback)=>{if(name==='change')app=callback;return {remove};});
 jest.spyOn(NativeEventEmitter.prototype,'addListener').mockImplementation((_name,callback)=>{event=callback;return {remove};});
 const disconnect=connectVoiceInput(session);await session.press();const first=currentId();app('background');event({id:first,state:'final',text:'stale'});expect(transcript).not.toHaveBeenCalled();
 await session.press();jest.mocked(speechSnapshot).mockReturnValue('reply');jest.mocked(subscribeSpeech).mock.calls.at(-1)![0]();expect(native.cancel).toHaveBeenCalledWith(currentId());jest.mocked(speechSnapshot).mockReturnValue(null);
 disconnect();expect(remove).toHaveBeenCalledTimes(5);await session.press();expect(native.start).toHaveBeenCalledTimes(2);
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
test.each(['pre-ready','listening','finishing'])('Android blur cancels %s capture, ignores late callbacks, and never restarts on focus return',async phase=>{
 await session.press();const id=currentId();
 if(phase!=='pre-ready')session.receive({id,state:'listening'});
 if(phase==='finishing')await session.press();
 session.blur();session.receive({id,state:'listening'});session.receive({id,state:'final',text:'late private words'});
 expect(native.cancel).toHaveBeenCalledWith(id);expect(transcript).not.toHaveBeenCalled();expect(changed).toHaveBeenLastCalledWith('idle');
 await flush();expect(native.start).toHaveBeenCalledTimes(1);
});
test('blur before native admission and during a queued start fences both late resolve and results',async()=>{
 const availability=deferred<any>();native.availability.mockReturnValueOnce(availability.promise);
 const pending=session.press();session.blur();availability.resolve('onDevice');await pending;expect(native.start).not.toHaveBeenCalled();
 const started=deferred<any>();native.start.mockReturnValueOnce(started.promise);const queued=session.press();await flush();const id=currentId();
 session.blur();started.resolve(null);await queued;session.receive({id,state:'final',text:'stale queued result'});
 expect(native.cancel).toHaveBeenCalledWith(id);expect(transcript).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
});
test('own platform consent and microphone dialogs can blur safely; admission waits for verified native window focus',async()=>{
 const listeners:Record<string,Function>={};const remove=jest.fn();
 jest.spyOn(AppState,'addEventListener').mockImplementation((name,callback)=>{listeners[name]=callback;return {remove};});
 const disconnect=connectVoiceInput(session);const startConfigured=namedNetwork(),permission=deferred<any>(),consent=deferred<boolean>();
 session.setConsent(()=>consent.promise);native.windowFocused.mockResolvedValue(false);jest.mocked(PermissionsAndroid.request).mockReturnValueOnce(permission.promise);
 const work=session.press();await flush();listeners.blur();expect(startConfigured).not.toHaveBeenCalled();
 consent.resolve(true);await flush();listeners.blur();permission.resolve(PermissionsAndroid.RESULTS.GRANTED);await flush();
 expect(native.windowFocused).toHaveBeenCalled();expect(startConfigured).not.toHaveBeenCalled();expect(native.cancel).not.toHaveBeenCalled();
 native.windowFocused.mockResolvedValue(true);listeners.focus();await work;
 expect(startConfigured).toHaveBeenCalledWith(expect.any(String),namedProvider.key,'en-PL',true);
 listeners.blur();session.receive({id:startConfigured.mock.calls[0][0],state:'final',text:'after shade'});listeners.focus();await flush();
 expect(transcript).not.toHaveBeenCalled();expect(startConfigured).toHaveBeenCalledTimes(1);disconnect();
});
test.each(['background','scope','cancel','unmount'])('%s while own dialog focus is returning aborts the wait and cannot later start',async cause=>{
 const listeners:Record<string,Function>={};const removed=jest.fn();
 jest.spyOn(AppState,'addEventListener').mockImplementation((name,callback)=>{listeners[name]=callback;return {remove:removed};});
 const disconnect=connectVoiceInput(session);native.windowFocused.mockResolvedValue(false);
 const work=session.press();await flush();expect(native.start).not.toHaveBeenCalled();
 if(cause==='background')listeners.change('background');else if(cause==='scope')session.configure('other',true);else if(cause==='unmount')disconnect();else session.cancel();
 await work;native.windowFocused.mockResolvedValue(true);listeners.focus();await flush();
 expect(native.start).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();expect(removed).toHaveBeenCalled();if(cause!=='unmount')disconnect();
});
test('failure to restore focus is bounded, and focus verification failure does not capture',async()=>{
 native.windowFocused.mockResolvedValue(false);const work=session.press();await flush();jest.advanceTimersByTime(2000);await work;
 expect(native.start).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith('Return to Bob, then tap the mic again.');
 native.windowFocused.mockRejectedValue(Error('unavailable'));await session.press();expect(native.start).not.toHaveBeenCalled();expect(error).toHaveBeenLastCalledWith(expect.stringContaining('window focus'));
});
test('30-second setup does not consume listening/finalization budgets',async()=>{
 const permission=deferred<any>();jest.mocked(PermissionsAndroid.request).mockReturnValueOnce(permission.promise);
 const work=session.press();await flush();jest.advanceTimersByTime(30000);permission.resolve(PermissionsAndroid.RESULTS.GRANTED);await work;
 const id=currentId();session.receive({id,state:'listening'});
 jest.advanceTimersByTime(12000);session.receive({id,state:'finishing'});jest.advanceTimersByTime(3000);
 session.receive({id,state:'final',text:'A complete fifteen-second recognition after setup.'});
 expect(transcript).toHaveBeenCalledTimes(1);expect(error).not.toHaveBeenCalled();expect(native.cancel).not.toHaveBeenCalled();
});
test('each setup, ready, listening and finalization wait is bounded independently',async()=>{
 await session.press();jest.advanceTimersByTime(15000);expect(error).toHaveBeenCalledTimes(1);
 await session.press();session.receive({id:currentId(),state:'listening'});jest.advanceTimersByTime(25000);expect(error).toHaveBeenCalledTimes(2);
 await session.press();const id=currentId();session.receive({id,state:'listening'});session.receive({id,state:'finishing'});jest.advanceTimersByTime(8000);
 session.receive({id,state:'final',text:'late'});expect(error).toHaveBeenCalledTimes(3);expect(transcript).not.toHaveBeenCalled();
});
test('configured selected service receives provider-specific disclosure and a pinned key; partials are visible but never final',async()=>{
 const provider={mode:'platform',key:'selected-provider-v2|en-US',label:'Selected non-Google service',language:'en-US',networkCapable:true};
 const options=jest.fn(async()=>[provider]),startConfigured=jest.fn(async(_id:string,_key:string,_consent:boolean)=>{});
 Object.assign(native,{options,startConfigured});const details=jest.fn(),approval=deferred<boolean>(),request=jest.fn(()=>approval.promise);
 const configured=new VoiceInputSession(changed,transcript,error,undefined,details);configured.configure('selected/chat',true);configured.setConsent(request);
 const work=configured.press();await flush();expect(request).toHaveBeenCalledWith(provider,expect.any(AbortSignal));expect(startConfigured).not.toHaveBeenCalled();
 approval.resolve(true);await work;const id=startConfigured.mock.calls[0][0];
 expect(startConfigured).toHaveBeenCalledWith(id,provider.key,provider.language,true);expect(native.start).not.toHaveBeenCalled();
 configured.receive({id,state:'partial',text:'Visible partial'});expect(details).toHaveBeenCalledWith(expect.objectContaining({partial:'Visible partial'}));expect(transcript).not.toHaveBeenCalled();
 configured.receive({id,state:'error',message:'No model. Use Speech options.'});expect(startConfigured).toHaveBeenCalledTimes(1);expect(error).toHaveBeenCalledWith(expect.stringContaining('Speech options'));
 configured.dispose();delete (native as any).options;delete (native as any).startConfigured;
});
test('activity-only provider handoff is explicit, bounded and revocable; focus regain never restarts capture',async()=>{
 const provider={mode:'activity',key:'speech-screen-v1|en-US',label:'Activity-only speech',language:'en-US',networkCapable:true};
 const startConfigured=jest.fn(async(_id:string,_key:string,_consent:boolean)=>{});Object.assign(native,{options:jest.fn(async()=>[provider]),startConfigured});
 session.setConsent(async()=>true);await session.press();
 const id=startConfigured.mock.calls[0][0];expect(session.ownsExternal()).toBe(true);session.background();session.blur();
 expect(native.cancel).not.toHaveBeenCalled();session.configure('new/chat',true);expect(native.cancel).toHaveBeenCalledWith(id);expect(session.ownsExternal()).toBe(false);
 session.receive({id,state:'final',text:'revoked external result'});expect(transcript).not.toHaveBeenCalled();expect(startConfigured).toHaveBeenCalledTimes(1);
 delete (native as any).options;delete (native as any).startConfigured;
});

test('Speech options cancels the old capture without starting a replacement until explicit selection',async()=>{
 await session.press();const id=currentId();session.receive({id,state:'listening'});
 await session.press(true);
 expect(native.finish).not.toHaveBeenCalled();expect(native.cancel).toHaveBeenCalledWith(id);expect(native.start).toHaveBeenCalledTimes(1);
 session.receive({id,state:'final',text:'Discarded old utterance'});expect(transcript).not.toHaveBeenCalled();
 expect(error).toHaveBeenCalledWith(expect.stringContaining('updated Bob Android build'));
});

test.each((['onDevice','platform','activity'] as const).flatMap(mode=>['en-US','en-GB'].map(language=>({mode,language}))))('en-PL default, explicit $language on $mode route, retained next tap; cancellation and consent fenced',async({mode,language})=>{
 const plan=(language:string)=>({mode,key:`${mode}|provider|${language}`,label:`Provider ${mode}`,language,networkCapable:mode!=='onDevice'});
 let saved='en-PL';const options=jest.fn(async(language:string|null)=>[plan(language??saved)]);const startConfigured=jest.fn(async(_id:string,_key:string,language:string,_consent:boolean)=>{saved=language;});
 Object.assign(native,{options,startConfigured});
 const select=deferred<any>();const picker=jest.fn(async(_initial:string,load:(language:string)=>Promise<any[]>,signal:AbortSignal)=>{
  expect(_initial).toBe('en-GB');expect(signal.aborted).toBe(false);const [choice]=await load(language);select.resolve(choice);return choice;
 });session.setPicker(picker);
 const decisions=[deferred<boolean>(),deferred<boolean>()];let request=0;const consent=jest.fn(():Promise<boolean>=>decisions[request++].promise);session.setConsent(consent);
 const first=session.press(true);await flush();expect(picker).toHaveBeenCalledTimes(1);
 expect(options).toHaveBeenCalledWith('en-GB');expect(options).toHaveBeenCalledWith(language);
 if(mode!=='onDevice'){expect(consent).toHaveBeenCalledTimes(1);expect(startConfigured).not.toHaveBeenCalled();decisions[0].resolve(true);}
 await first;expect(startConfigured).toHaveBeenCalledWith(expect.any(String),plan(language).key,language,mode!=='onDevice');
 session.receive({id:startConfigured.mock.calls[0][0],state:'error',message:'No installed model. Download a model in Android settings or choose another language explicitly.'});
 const again=session.press();await flush();if(mode!=='onDevice'){expect(consent).toHaveBeenCalledTimes(2);decisions[1].resolve(false);}await again;
 expect(options).toHaveBeenLastCalledWith(null);expect(startConfigured).toHaveBeenCalledTimes(mode==='onDevice'?2:1);expect(native.start).not.toHaveBeenCalled();
 delete (native as any).options;delete (native as any).startConfigured;
});

test('cancel, scope A-B-A and late picker choice never start recognition',async()=>{
 const plan={mode:'onDevice' as const,key:'local|en-US',label:'Local',language:'en-US',networkCapable:false};
 Object.assign(native,{options:jest.fn(async()=>[plan]),startConfigured:jest.fn(async()=>{})});
 const selected=deferred<any>();session.setPicker(async()=>selected.promise);
 const work=session.press(true);await flush();session.configure('other',true);session.configure('backend/chat',true);selected.resolve(plan);await work;
 expect((native as any).startConfigured).not.toHaveBeenCalled();expect(native.start).not.toHaveBeenCalled();expect(transcript).not.toHaveBeenCalled();
 delete (native as any).options;delete (native as any).startConfigured;
});


test('native remembered approval skips only Bob consent, never runtime microphone permission; changed config asks again',async()=>{
 const startConfigured=namedNetwork(),consent=jest.fn(async()=>true);session.setConsent(consent);
 (native as any).options.mockResolvedValue([{...namedProvider,approved:true}]);
 await session.press();expect(consent).not.toHaveBeenCalled();
 expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1);
 expect(startConfigured).toHaveBeenLastCalledWith(expect.any(String),namedProvider.key,'en-PL',false);
 session.cancel();(native as any).options.mockResolvedValue([{...namedProvider,key:'provider-update|en-PL',approved:false}]);
 await session.press();expect(consent).toHaveBeenCalledTimes(1);
 expect(startConfigured).toHaveBeenLastCalledWith(expect.any(String),'provider-update|en-PL','en-PL',true);
 session.cancel();jest.mocked(PermissionsAndroid.request).mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
 (native as any).options.mockResolvedValue([{...namedProvider,approved:true}]);await session.press();
 expect(startConfigured).toHaveBeenCalledTimes(2);expect(error).toHaveBeenLastCalledWith(expect.stringContaining('denied'));
});

test('forgetting approval cancels pending Allow; later capture rereads native approval and requires review',async()=>{
 const startConfigured=namedNetwork(),decision=deferred<boolean>();session.setConsent(()=>decision.promise);
 const revokeApprovals=jest.fn(async()=>{});Object.assign(native,{revokeApprovals});
 const work=session.press();await flush();await session.revokeApprovals();decision.resolve(true);await work;
 expect(revokeApprovals).toHaveBeenCalledTimes(1);expect(startConfigured).not.toHaveBeenCalled();
 session.setConsent(jest.fn(async()=>false));await session.press();expect(startConfigured).not.toHaveBeenCalled();
 delete (native as any).revokeApprovals;
});

test('a native saved explicit non-UK choice survives a new session; no JS system-locale migration overwrites it',async()=>{
 const startConfigured=namedNetwork();(native as any).options.mockResolvedValue([{...namedProvider,approved:true}]);
 session.dispose();const next=new VoiceInputSession(changed,transcript,error);next.configure('new/chat',true);
 await next.press();expect((native as any).options).toHaveBeenCalledWith(null);
 expect(startConfigured).toHaveBeenLastCalledWith(expect.any(String),namedProvider.key,'en-PL',false);next.dispose();
});
