import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {SpeechAction} from '../components/speech-action';
import {startSpeech,stopSpeech,speechSnapshot} from '../speech';
jest.mock('../speech',()=>({speechSnapshot:jest.fn(()=>null),subscribeSpeech:()=>()=>{},startSpeech:jest.fn(),stopSpeech:jest.fn(),speechText:(text:string)=>text.trim()}));
jest.mock('lucide-react-native',()=>({Volume2:'Volume2',Square:'Square'}));
jest.mock('../components/message-actions',()=>({ActionIcon:({label,onPress,disabled}:any)=>require('react').createElement(require('react-native').Pressable,{accessibilityLabel:label,onPress,disabled})}));
beforeEach(()=>{jest.clearAllMocks();jest.mocked(speechSnapshot).mockReturnValue(null);});
test('speech requires a tap, exposes Stop while active, and stops its own session on unmount',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SpeechAction text="Reply"/>);});expect(startSpeech).not.toHaveBeenCalled();
 act(()=>tree.root.findByProps({accessibilityLabel:'Read aloud'}).props.onPress());
 const id=jest.mocked(startSpeech).mock.calls[0][0];expect(startSpeech).toHaveBeenCalledWith(id,'Reply');
 jest.mocked(speechSnapshot).mockReturnValue(id);
 await act(async()=>tree.update(<SpeechAction text="Reply"/>));
 act(()=>tree.root.findByProps({accessibilityLabel:'Stop reading'}).props.onPress());expect(stopSpeech).toHaveBeenCalledWith(id);
 jest.mocked(stopSpeech).mockClear();await act(async()=>tree.unmount());expect(stopSpeech).toHaveBeenCalledWith(id);
});
test('replaced text cancels old playback without automatically speaking the replacement',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SpeechAction text="First"/>);});
 await act(async()=>tree.update(<SpeechAction text="Second"/>));
 expect(stopSpeech).toHaveBeenCalledTimes(1);expect(startSpeech).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});
