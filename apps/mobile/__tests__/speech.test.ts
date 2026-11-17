import {Alert,NativeModules} from 'react-native';
let callback:(event:object)=>void;
jest.mock('react-native',()=>({
 Alert:{alert:jest.fn()},NativeModules:{BobSpeech:{speak:jest.fn(),stop:jest.fn(),openSettings:jest.fn()}},
 NativeEventEmitter:jest.fn().mockImplementation(()=>({addListener:jest.fn((_name:string,listener:(event:object)=>void)=>{callback=listener;return{remove:jest.fn()};})})),
}));
import {speechText,startSpeech,stopSpeech,speechSnapshot,subscribeSpeech,openSpeechSettings} from '../speech';
const native=NativeModules.BobSpeech;
beforeEach(async()=>{await stopSpeech();jest.clearAllMocks();native.speak.mockResolvedValue(null);native.stop.mockResolvedValue(null);});
test('normalizes visible Markdown while omitting fenced code and URL targets',()=>{
 expect(speechText('# Hello\n**World** [guide](https://private.example)\n```sh\nsecret-command\n```')).toBe('Hello\nWorld guide\n\nCode block omitted.');
 expect(speechText('   ')).toBe('');
});
test('manual read admission is not completion; native completion clears playback',async()=>{
 const changed=jest.fn(),unsubscribe=subscribeSpeech(changed);
 await startSpeech('reply-a','Hello');expect(native.speak).toHaveBeenCalledTimes(1);expect(speechSnapshot()).toBe('reply-a');
 const request=native.speak.mock.calls[0][1];callback({id:request,state:'done'});expect(speechSnapshot()).toBeNull();expect(changed).toHaveBeenCalled();unsubscribe();
});
test('new playback supersedes old events, even on the same reply; unmount cannot stop another reply',async()=>{
 const unsubscribe=subscribeSpeech(()=>{});
 await startSpeech('reply-a','First');const old=native.speak.mock.calls[0][1];
 await startSpeech('reply-a','Again');const next=native.speak.mock.calls[1][1];expect(next).not.toBe(old);
 callback({id:old,state:'stopped'});expect(speechSnapshot()).toBe('reply-a');
 await startSpeech('reply-b','Second');const current=native.speak.mock.calls[2][1];
 await stopSpeech('reply-a');expect(native.stop).not.toHaveBeenCalled();expect(speechSnapshot()).toBe('reply-b');
 callback({id:next,state:'error',message:'Old failure'});expect(Alert.alert).not.toHaveBeenCalled();
 await stopSpeech('reply-b');expect(native.stop).toHaveBeenCalledWith(current);expect(speechSnapshot()).toBeNull();unsubscribe();
});
test('native errors are surfaced once and rejected requests cannot resurrect stopped playback',async()=>{
 const unsubscribe=subscribeSpeech(()=>{});
 let reject!:(error:Error)=>void;native.speak.mockImplementationOnce(()=>new Promise((_resolve,rejecter)=>{reject=rejecter;}));
 const work=startSpeech('reply','Read');const id=native.speak.mock.calls[0][1];
 callback({id,state:'error',message:'Install an offline voice'});reject(Error('Install an offline voice'));await work;
 expect(Alert.alert).toHaveBeenCalledTimes(1);expect(speechSnapshot()).toBeNull();unsubscribe();
});
test('blank content is not spoken and opening speech settings stops current playback',async()=>{
 await startSpeech('empty','  ');expect(native.speak).not.toHaveBeenCalled();
 await startSpeech('reply','Read');await openSpeechSettings();expect(speechSnapshot()).toBeNull();expect(native.openSettings).toHaveBeenCalledTimes(1);
});
test('Markdown speech preserves literal math and inline code, handles balanced links/emphasis, and omits block code',()=>{
 expect(speechText('Dose calculation: 2*3 = 6.')).toBe('Dose calculation: 2*3 = 6.');
 expect(speechText('[Guide](https://example.org/a_(b))')).toBe('Guide');
 expect(speechText('__Important__ and ~~obsolete~~')).toBe('Important and obsolete');
 expect(speechText('Literal `2*3` and a_b, with \\*literal stars\\*.')).toBe('Literal 2*3 and a_b, with *literal stars*.');
 expect(speechText('Before\n\n    code_that_should_be_omitted()\n\nAfter')).toBe('Before\n\nCode block omitted.\nAfter');
});
test('failed native Stop keeps a visible recovery owner, fences old events and retries all native leases',async()=>{
 const unsubscribe=subscribeSpeech(()=>{});await startSpeech('reply-stop','Read');const old=native.speak.mock.calls[0][1];
 native.stop.mockRejectedValueOnce(Error('cleanup unresolved'));expect(await stopSpeech('reply-stop')).toBe(false);
 expect(speechSnapshot()).toBe('reply-stop');callback({id:old,state:'done'});expect(speechSnapshot()).toBe('reply-stop');
 expect(await stopSpeech('reply-stop')).toBe(true);expect(native.stop).toHaveBeenLastCalledWith('');expect(speechSnapshot()).toBeNull();unsubscribe();
});

test('numeric operators remain literal across repeated expressions and inside real Markdown code/emphasis',()=>{
 expect(speechText('Dose: 2*3 = 6. Again: 2*3 = 6.')).toBe('Dose: 2*3 = 6. Again: 2*3 = 6.');
 expect(speechText('`2*3` and **important** and 2**3, then 2**3')).toBe('2*3 and important and 2**3, then 2**3');
});
