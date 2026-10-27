import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {QuestionCard} from '../components/question-card';
jest.mock('lucide-react-native',()=>({Check:()=>null,ChevronRight:()=>null}));
const question={id:'question-1',text:'Who can edit notes?',options:['Only me','Me and Bob']};
test.each([false,true])('inline question supports accessible selection and explicit send (multiple: %s)',async(multiple)=>{
 const onAnswer=jest.fn(async()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<QuestionCard question={{...question,multiple}} onAnswer={onAnswer}/>);});
 const option=(label:string)=>tree.root.findByProps({accessibilityLabel:label});
 expect(option('Send selected answer').props.disabled).toBe(true);
 act(()=>option('Only me').props.onPress());act(()=>option('Me and Bob').props.onPress());
 expect(option('Me and Bob').props.accessibilityState.checked).toBe(true);
 expect(option('Only me').props.accessibilityState.checked).toBe(multiple);
 expect(option('Me and Bob').props.accessibilityRole).toBe(multiple?'checkbox':'radio');
 expect(onAnswer).not.toHaveBeenCalled();
 await act(async()=>option('Send selected answer').props.onPress());
 expect(onAnswer).toHaveBeenCalledWith(multiple?'Only me\nMe and Bob':'Me and Bob');
 await act(async()=>tree.unmount());
});
test('double tap sends only once while answer is being queued',async()=>{
 let release!:()=>void;const onAnswer=jest.fn(()=>new Promise<void>(resolve=>{release=resolve;}));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<QuestionCard question={question} onAnswer={onAnswer}/>);});
 act(()=>tree.root.findByProps({accessibilityLabel:'Only me'}).props.onPress());
 act(()=>{const send=tree.root.findByProps({accessibilityLabel:'Send selected answer'}).props.onPress;send();send();});
 expect(onAnswer).toHaveBeenCalledTimes(1);
 expect(tree.root.findByProps({accessibilityLabel:'Only me'}).props.disabled).toBe(true);
 await act(async()=>release());await act(async()=>tree.unmount());
});
test('old questions without options still show the question and free-text guidance',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<QuestionCard question={{id:'old',text:'What do you prefer?'}} onAnswer={jest.fn()}/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Type your reply in the message box.');
 expect(tree.root.findAllByProps({accessibilityLabel:'Send selected answer'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});
