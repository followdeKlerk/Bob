import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,PermissionsAndroid,Platform,StyleSheet} from 'react-native';
import {VoiceInputButton} from '../components/voice-input-button';
import {TouchTarget} from '../components/touch-target';
import {ThemeContext,tokens} from '../theme-context';
import {VoiceInputSession} from '../voice-input';
jest.mock('../speech',()=>({stopSpeech:jest.fn(async()=>true),subscribeSpeech:()=>()=>{},speechSnapshot:()=>null}));
jest.mock('../theme',()=>require('../theme-context'));
jest.mock('lucide-react-native',()=>({Mic:'Mic',Square:'Square',X:'X'}));
const bridge={windowFocused:jest.fn(async()=>true),availability:jest.fn(async()=>'onDevice'),start:jest.fn(async(_id:string,_mode:string,_consent:boolean)=>{}),cancel:jest.fn(async(_id:string)=>{}),finish:jest.fn(async(_id:string)=>{}),addListener:jest.fn(),removeListeners:jest.fn()};
const props={disabled:false,active:true,scope:'backend/chat',onTranscript:jest.fn(),onError:jest.fn()};
let tree:Renderer.ReactTestRenderer;
const button=(label:string)=>tree.root.findAllByType(TouchTarget).find(node=>node.props.accessibilityLabel===label)!;
beforeEach(()=>{
 jest.clearAllMocks();jest.replaceProperty(Platform,'OS','android');NativeModules.BobVoiceInput=bridge;
 Object.defineProperty(AppState,'currentState',{configurable:true,value:'active',writable:true});
 jest.spyOn(PermissionsAndroid,'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());jest.restoreAllMocks();});
test.each(['dark','light'] as const)('%s: real button is a static 48dp target, no capture on mount, no input/send authority',async scheme=>{
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><VoiceInputButton {...props}/></ThemeContext.Provider>);});
 expect(bridge.start).not.toHaveBeenCalled();const target=button('Dictate message');expect(target).toBeDefined();
 const style=StyleSheet.flatten(target.props.style);expect(style.width).toBe(48);expect(style.height).toBe(48);expect(style.flexShrink).toBe(0);
 expect(target.props.accessibilityHint).toContain('Nothing is sent');
 await act(async()=>target.props.onPress({}));expect(bridge.start).toHaveBeenCalledTimes(1);
 expect(button('Cancel dictation setup')).toBeDefined();expect(props.onTranscript).not.toHaveBeenCalled();
 await act(async()=>button('Cancel dictation setup').props.onPress({}));expect(bridge.cancel).toHaveBeenCalledWith(bridge.start.mock.calls[0][0]);
});
test('scope/disabled/inactive updates immediately cancel without remounting the button',async()=>{
 await act(async()=>{tree=Renderer.create(<VoiceInputButton {...props}/>);});const retained=button('Dictate message');
 await act(async()=>retained.props.onPress({}));await act(async()=>tree.update(<VoiceInputButton {...props} scope="other/chat"/>));
 expect(bridge.cancel).toHaveBeenCalledWith(bridge.start.mock.calls[0][0]);expect(button('Dictate message')===retained).toBe(true);
 await act(async()=>button('Dictate message').props.onPress({}));await act(async()=>tree.update(<VoiceInputButton {...props} scope="other/chat" disabled/>));
 expect(bridge.cancel).toHaveBeenCalledTimes(2);expect(button('Dictate message').props.disabled).toBe(true);
 await act(async()=>tree.update(<VoiceInputButton {...props} active={false}/>));expect(button('Dictate message').props.disabled).toBe(true);
});
test('listening has an explicit Finish label and visible square, final delivery is once, finishing can cancel',async()=>{
 const receive=jest.spyOn(VoiceInputSession.prototype,'receive');let session!:VoiceInputSession;
 const original=VoiceInputSession.prototype.press;
 jest.spyOn(VoiceInputSession.prototype,'press').mockImplementation(function(this:VoiceInputSession){session=this;return original.call(this);});
 await act(async()=>{tree=Renderer.create(<VoiceInputButton {...props}/>);});await act(async()=>button('Dictate message').props.onPress({}));
 const id=bridge.start.mock.calls[0][0];act(()=>session.receive({id,state:'listening'}));expect(button('Finish dictation').props.accessibilityHint).toContain('Microphone on');expect(tree.root.findAllByType('Square' as any)).toHaveLength(1);
 await act(async()=>button('Finish dictation').props.onPress({}));expect(bridge.finish).toHaveBeenCalledWith(id);
 expect(button('Cancel dictation')).toBeDefined();act(()=>session.receive({id,state:'final',text:'A draft'}));act(()=>session.receive({id,state:'final',text:'duplicate'}));expect(props.onTranscript).toHaveBeenCalledTimes(1);expect(props.onTranscript).toHaveBeenCalledWith('A draft');expect(receive).toHaveBeenCalled();
});
test('unmount cancels; StrictMode effect replay still permits a later deliberate mic tap',async()=>{
 await act(async()=>{tree=Renderer.create(<React.StrictMode><VoiceInputButton {...props}/></React.StrictMode>);});
 await act(async()=>button('Dictate message').props.onPress({}));expect(bridge.start).toHaveBeenCalledTimes(1);await act(async()=>tree.unmount());expect(bridge.cancel).toHaveBeenCalledWith(bridge.start.mock.calls[0][0]);
});
