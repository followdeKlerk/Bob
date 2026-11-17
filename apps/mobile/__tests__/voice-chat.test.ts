import {Alert,NativeModules} from 'react-native';
import {VoiceChatSession,completedVoiceText,type VoiceInterest} from '../voice-chat';
import {subscribeSpeech,stopSpeech,speechSnapshot} from '../speech';
let speechEvent:(event:any)=>void;
jest.mock('react-native',()=>({
 Alert:{alert:jest.fn()},AppState:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))},Platform:{OS:'android'},
 PermissionsAndroid:{request:jest.fn(async()=>'granted'),PERMISSIONS:{RECORD_AUDIO:'microphone'},RESULTS:{GRANTED:'granted'}},
 NativeModules:{BobSpeech:{speak:jest.fn(async()=>{}),stop:jest.fn(async()=>{}),configuration:jest.fn(async()=>({key:'tts-v1',provider:'Chosen TTS'})),speakConfigured:jest.fn(async()=>{})},BobVoiceInput:{windowFocused:jest.fn(async()=>true),availability:jest.fn(async()=>'onDevice'),start:jest.fn(async(_id:string,_mode:string,_consent:boolean)=>{}),finish:jest.fn(async()=>{}),cancel:jest.fn(async()=>{})}},
 NativeEventEmitter:jest.fn().mockImplementation(()=>({addListener:(_name:string,listener:any)=>{speechEvent=listener;return{remove:jest.fn()};}})),
}));
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const backend={backendId:'backend-a',endpoint:'https://example.invalid',name:'Test'};
const interest:VoiceInterest={backend,chat:7,requestId:'request-a',deviceId:'device-a'};
const settlement=(answer=42,status='done')=>({admission:{type:'input',status,conversationId:7,requestId:'device:device-a:request-a',entry:40,answer}});
const answer=(text='The completed reply.',id=42)=>({backendId:backend.backendId,conversationId:7,coverage:'stored-entry',entry:{id,conversationId:7,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'thinking',thinking:'Hidden'},{type:'text',text},{type:'toolCall',name:'write',arguments:{secret:'never say'}}],stopReason:'stop'}]}});
let session:VoiceChatSession,send:jest.Mock,read:jest.Mock,sameDevice:jest.Mock,changed:jest.Mock,disconnect:()=>void;
beforeEach(async()=>{
 NativeModules.BobSpeech.stop.mockResolvedValue(undefined);await stopSpeech();jest.clearAllMocks();jest.useFakeTimers();
 send=jest.fn(async()=>interest);read=jest.fn(async(path:string)=>path.includes('/operations/')?settlement():answer());sameDevice=jest.fn(async()=>true);changed=jest.fn();
 session=new VoiceChatSession(changed,{send,read,sameDevice});session.configure('backend-a|pairing-1|chat7|visit1',true,true);
 disconnect=subscribeSpeech(()=>session.speechChanged());
});
afterEach(async()=>{session.dispose();disconnect();await stopSpeech();jest.useRealTimers();});
async function speak(text='One spoken turn'){
 await session.press();const id=NativeModules.BobVoiceInput.start.mock.calls.at(-1)[0];
 session.capture.receive({id,state:'listening'});session.capture.receive({id,state:'final',text});await flush();return id;
}
test('two explicit turns submit once apiece and automatically read only exact completed answers once',async()=>{
 let number=0;send.mockImplementation(async()=>({...interest,requestId:`request-${++number}`}));
 read.mockImplementation(async(path:string,i:VoiceInterest)=>path.includes('/operations/')?{admission:{...settlement(40+number).admission,requestId:`device:device-a:${i.requestId}`}}:answer(`Reply ${number}`,40+number));
 await speak('First');expect(send).toHaveBeenCalledTimes(1);expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);expect(NativeModules.BobSpeech.speak.mock.calls[0][0]).toBe('Reply 1');
 session.wake();session.wake();await flush();expect(read).toHaveBeenCalledTimes(2);
 const playback=NativeModules.BobSpeech.speak.mock.calls[0][1];speechEvent({id:playback,state:'done'});await flush();
 expect(NativeModules.BobVoiceInput.start).toHaveBeenCalledTimes(1);expect(session.snapshot().phase).toBe('idle');
 await speak('Second');expect(send).toHaveBeenCalledTimes(2);expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(2);expect(NativeModules.BobSpeech.speak.mock.calls[1][0]).toBe('Reply 2');
});
test('queued/placed and streaming appearances do not count as completion; polling is coalesced and read-only',async()=>{
 read.mockImplementation(async()=>settlement(42,'placed'));await speak();expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();
 for(let i=0;i<20;i++)session.wake();expect(read).toHaveBeenCalledTimes(1);
 read.mockImplementation(async(path:string)=>path.includes('/operations/')?settlement():answer());jest.advanceTimersByTime(2000);await flush();
 expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);
 expect(read.mock.calls.every(([path])=>path.includes('/operations/')||path.includes('/history?entryId='))).toBe(true);
});
test('shared settlement answers are read once per scoped voice visit',async()=>{
 await speak();const playback=NativeModules.BobSpeech.speak.mock.calls[0][1];speechEvent({id:playback,state:'done'});await speak();
 expect(send).toHaveBeenCalledTimes(2);expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);expect(session.snapshot().message).toContain('already read');
});
test('a full answer outside the loaded window is fetched, not its 4000-character notification preview',async()=>{
 const full='Full public reply. '.repeat(700);
 read.mockImplementation(async(path:string)=>path.includes('/operations/')?{...settlement(),reply:'truncated preview'}:answer(full));await speak();
 expect(NativeModules.BobSpeech.speak.mock.calls[0][0]).toBe(full.trim());expect(full.length).toBeGreaterThan(4000);
 expect(read.mock.calls[1][0]).toBe('chats/7/history?entryId=42');
});
test.each(['stop','background','scope','exit','unmount'])('%s racing receipt/exact-history lookup cannot auto-read later',async cause=>{
 let release!:(value:any)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await speak();
 if(cause==='stop')await session.stop();else if(cause==='background')session.background();else if(cause==='scope')session.configure('other-pairing',true,true);else if(cause==='exit')session.cancel(true);else session.dispose();
 release(settlement());await flush();expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
});
test('Stop racing the exact-answer fetch fences playback even if the server ignores abort',async()=>{
 let release!:(value:any)=>void;read.mockImplementation(async(path:string)=>path.includes('/operations/')?settlement():new Promise(resolve=>{release=resolve;}));await speak();
 await session.stop();release(answer());await flush();expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);
});
test.each(['unanswered','tool-only','aborted','wrong-chat','wrong-request','wrong-backend','re-paired'])('%s never turns unrelated or unsafe content into spoken output',async kind=>{
 if(kind==='unanswered')read.mockResolvedValueOnce(settlement(42,'unanswered'));
 if(kind==='tool-only')read.mockImplementation(async path=>path.includes('/operations/')?settlement():{...answer(),entry:{...answer().entry,model:[{role:'assistant',content:[{type:'toolCall',name:'run',arguments:'secret'}]}]}});
 if(kind==='aborted')read.mockImplementation(async path=>path.includes('/operations/')?settlement():{...answer(),entry:{...answer().entry,model:[{role:'assistant',content:'partial unsafe',stopReason:'aborted'}]}});
 if(kind==='wrong-chat')read.mockResolvedValueOnce({admission:{...settlement().admission,conversationId:8}});
 if(kind==='wrong-request')read.mockResolvedValueOnce({admission:{...settlement().admission,requestId:'device:other:request-a'}});
 if(kind==='wrong-backend')read.mockImplementation(async path=>path.includes('/operations/')?settlement():{...answer(),backendId:'other'});
 if(kind==='re-paired')sameDevice.mockResolvedValue(false);
 await speak();expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);
});
test('transient receipt/history errors retry only reads of the same operation, never the speech submission',async()=>{
 read.mockRejectedValueOnce(Error('Offline'));await speak();jest.advanceTimersByTime(2000);await flush();
 expect(send).toHaveBeenCalledTimes(1);expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);
});
test('an exact-history fetch failure retains its own answer claim and can recover without double-reading',async()=>{
 let attempts=0;read.mockImplementation(async path=>{if(path.includes('/operations/'))return settlement();if(++attempts===1)throw Error('Offline history');return answer();});
 await speak();expect(NativeModules.BobSpeech.speak).not.toHaveBeenCalled();jest.advanceTimersByTime(2000);await flush();expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);
});
test('native playback failure stays visible without offering an unprovable provider-network override',async()=>{
 NativeModules.BobSpeech.speak.mockRejectedValueOnce(Error('No offline voice'));await speak();
 expect(session.snapshot().phase).toBe('error');expect(session.snapshot().message).toBe('No offline voice');
 expect(NativeModules.BobSpeech.configuration).not.toHaveBeenCalled();expect(NativeModules.BobSpeech.speakConfigured).not.toHaveBeenCalled();
});
test('recorded public-text projection never reads hidden reasoning, tool results, status or images',()=>{
 expect(completedVoiceText({id:1,kind:'pi.assistant',model:[{role:'toolResult',content:'secret result'},{role:'assistant',content:[{type:'text',text:'Visible'}, {type:'thinking',thinking:'hidden'},{type:'redactedThinking',data:'hidden'}, {type:'image',data:'image'}]}]},1,7)).toBe('Visible');
 expect(completedVoiceText({id:1,kind:'bob.status',model:[{role:'assistant',content:'status'}]},1,7)).toBe('');
});

test('a stalled read that ignores AbortSignal is still bounded, and only the same receipt is retried',async()=>{
 read.mockImplementation(()=>new Promise(()=>{}));await speak();const signal=read.mock.calls[0][2];
 jest.advanceTimersByTime(10000);await flush();expect(signal.aborted).toBe(true);expect(send).toHaveBeenCalledTimes(1);
 jest.advanceTimersByTime(2000);await flush();expect(read).toHaveBeenCalledTimes(2);expect(read.mock.calls[1][0]).toBe(read.mock.calls[0][0]);
 jest.advanceTimersByTime(600000);await flush();expect(session.snapshot().phase).toBe('error');expect(session.snapshot().message).toContain('timed out');
});
test('manual playback during receipt wait revokes the automatic reply interest',async()=>{
 let release!:(value:any)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await speak();
 await require('../speech').startSpeech('manual-reading','Owner-chosen historical reply');release(settlement());await flush();
 expect(NativeModules.BobSpeech.speak).toHaveBeenCalledTimes(1);expect(session.snapshot().open).toBe(false);
});
test('a delayed interruption Stop cannot start capture in a newly selected voice scope',async()=>{
 await speak();let release!:()=>void;NativeModules.BobSpeech.stop.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 const pressing=session.press();session.configure('other-chat/visit',true,true);release();await pressing;
 expect(NativeModules.BobVoiceInput.start).toHaveBeenCalledTimes(1);
});
