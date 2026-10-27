import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import {enableUpdateNotifications,useUpdateNotifications} from '../use-update-notifications';
import * as Keychain from 'react-native-keychain';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn().mockResolvedValue({password:'device-token'})}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn().mockResolvedValue('true'),setItem:jest.fn().mockResolvedValue(null)}));
const backend={backendId:'paired-backend',endpoint:'https://paired.ts.net',name:'Laptop'};
let os:PropertyDescriptor,version:PropertyDescriptor,current:PropertyDescriptor;
beforeEach(()=>{
 os=Object.getOwnPropertyDescriptor(Platform,'OS')!;version=Object.getOwnPropertyDescriptor(Platform,'Version')!;current=Object.getOwnPropertyDescriptor(AppState,'currentState')!;
 Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});Object.defineProperty(Platform,'Version',{configurable:true,value:34});Object.defineProperty(AppState,'currentState',{configurable:true,value:'active'});
 NativeModules.BobNotifications={watchUpdates:jest.fn().mockResolvedValue(true)};
 jest.spyOn(PermissionsAndroid,'check').mockResolvedValue(true);
});
afterEach(()=>{jest.restoreAllMocks();Object.defineProperty(Platform,'OS',os);Object.defineProperty(Platform,'Version',version);Object.defineProperty(AppState,'currentState',current);});
test('update monitoring registers without a chat request or Updates screen',async()=>{
 function Harness(){useUpdateNotifications([backend]);return null;}
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness/>);});
 expect(Keychain.getGenericPassword).toHaveBeenCalledWith({service:'bob.paired-backend'});
 expect(NativeModules.BobNotifications.watchUpdates).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'device-token','Laptop');
 await act(async()=>tree.unmount());
});
test('permission denial does not start a monitor or falsely report success',async()=>{
 (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
 const request=jest.spyOn(PermissionsAndroid,'request').mockResolvedValue('denied');
 expect(await enableUpdateNotifications([backend])).toBe(false);expect(request).toHaveBeenCalled();expect(NativeModules.BobNotifications.watchUpdates).not.toHaveBeenCalled();
});
test('background app does not attempt an Android foreground-service launch',async()=>{
 Object.defineProperty(AppState,'currentState',{configurable:true,value:'background'});
 expect(await enableUpdateNotifications([backend])).toBe(false);expect(NativeModules.BobNotifications.watchUpdates).not.toHaveBeenCalled();
});
