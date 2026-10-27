import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {BackHandler,Keyboard,ToastAndroid,Platform} from 'react-native';
import {useBackNavigation} from '../use-back-navigation';
import {recordAppEvent} from '../app-diagnostics';
jest.mock('../app-diagnostics',()=>({recordAppEvent:jest.fn()}));
afterEach(()=>{jest.restoreAllMocks();jest.clearAllMocks();});
test('repeated Back events at the chat root never exit, minimize, or arm a later exit',async()=>{
 jest.replaceProperty(Platform,'OS','android');let listener!:()=>boolean;const remove=jest.fn();
 jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{listener=callback as any;return{remove};});
 const exit=jest.spyOn(BackHandler,'exitApp').mockImplementation(()=>{}),toast=jest.spyOn(ToastAndroid,'show').mockImplementation(()=>{});
 jest.spyOn(Keyboard,'isVisible').mockReturnValue(false);
 function Harness(){useBackNavigation(()=>false);return null;}let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness/>);});act(()=>{for(let index=0;index<100;index++)expect(listener()).toBe(true);});
 expect(exit).not.toHaveBeenCalled();expect(toast).not.toHaveBeenCalled();expect(recordAppEvent).toHaveBeenCalledWith('back.root-ignored');
 await act(async()=>tree.unmount());expect(remove).toHaveBeenCalledTimes(1);
});
test('Back still dismisses open UI and the keyboard before being consumed at root',async()=>{
 jest.replaceProperty(Platform,'OS','android');let listener!:()=>boolean;
 jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{listener=callback as any;return{remove:jest.fn()};});
 const exit=jest.spyOn(BackHandler,'exitApp').mockImplementation(()=>{}),visible=jest.spyOn(Keyboard,'isVisible').mockReturnValue(false),dismiss=jest.spyOn(Keyboard,'dismiss').mockImplementation(()=>{});
 const close=jest.fn(()=>true);function Harness(){useBackNavigation(close);return null;}let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness/>);});act(()=>{expect(listener()).toBe(true);});expect(recordAppEvent).toHaveBeenLastCalledWith('back.ui');expect(dismiss).not.toHaveBeenCalled();
 close.mockReturnValue(false);visible.mockReturnValue(true);act(()=>{expect(listener()).toBe(true);});expect(dismiss).toHaveBeenCalledTimes(1);expect(recordAppEvent).toHaveBeenLastCalledWith('back.keyboard');
 visible.mockReturnValue(false);act(()=>{listener();listener();});expect(exit).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('a changed screen uses the newest close callback without replacing the native Back subscription',async()=>{
 jest.replaceProperty(Platform,'OS','android');let listener!:()=>boolean;
 const subscribe=jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{listener=callback as any;return{remove:jest.fn()};});jest.spyOn(Keyboard,'isVisible').mockReturnValue(false);
 const first=jest.fn(()=>false),next=jest.fn(()=>true);function Harness({close}:{close:()=>boolean}){useBackNavigation(close);return null;}let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness close={first}/>);});await act(async()=>tree.update(<Harness close={next}/>));act(()=>{expect(listener()).toBe(true);});
 expect(next).toHaveBeenCalledTimes(1);expect(first).not.toHaveBeenCalled();expect(subscribe).toHaveBeenCalledTimes(1);await act(async()=>tree.unmount());
});
