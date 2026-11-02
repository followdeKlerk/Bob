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
 NativeModules.BobNotifications={watchUpdates:jest.fn().mockResolvedValue(true),activatePush:jest.fn().mockResolvedValue(true),syncPushBackends:jest.fn().mockResolvedValue(true)};
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

test('successful pairing registration republishes the foreground barrier snapshot afterwards',async()=>{
 const registered=jest.fn(async()=>{});expect(await enableUpdateNotifications([backend],true,registered)).toBe(true);
 expect(registered).toHaveBeenCalledWith(backend.backendId);
 expect((NativeModules.BobNotifications.watchUpdates as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(registered.mock.invocationCallOrder[0]);
});
test('a failed pairing registration never publishes a misleading ready snapshot',async()=>{
 NativeModules.BobNotifications.watchUpdates.mockRejectedValue(Error('revoked'));const registered=jest.fn(async()=>{});
 await expect(enableUpdateNotifications([backend],true,registered)).rejects.toThrow('revoked');expect(registered).not.toHaveBeenCalled();
});


test('activation schedules push using paired credentials and reconciles removed identities',async()=>{
 await enableUpdateNotifications([backend],false);
 expect(NativeModules.BobNotifications.syncPushBackends).toHaveBeenCalledWith([backend.backendId]);
 expect(NativeModules.BobNotifications.activatePush).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'device-token');
 expect(NativeModules.BobNotifications.watchUpdates).toHaveBeenCalled(); // Registration never disables polling.
});
test('permission denial still reconciles native push deregistration without starting polling',async()=>{
 (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
 expect(await enableUpdateNotifications([backend],false)).toBe(false);
 expect(NativeModules.BobNotifications.activatePush).toHaveBeenCalled();
 expect(NativeModules.BobNotifications.watchUpdates).not.toHaveBeenCalled();
});
test('push scheduling failure does not block fallback polling',async()=>{
 NativeModules.BobNotifications.activatePush.mockRejectedValue(Error('unavailable'));
 expect(await enableUpdateNotifications([backend],false)).toBe(true);
 expect(NativeModules.BobNotifications.watchUpdates).toHaveBeenCalled();
});

test('permission granted after pre-dialog deregistration schedules registration again',async()=>{
 let permission=false;
 (PermissionsAndroid.check as jest.Mock).mockImplementation(async()=>permission);
 const mutations:string[]=[];
 NativeModules.BobNotifications.activatePush.mockImplementation(async()=>{mutations.push(permission?'POST':'DELETE');return true;});
 jest.spyOn(PermissionsAndroid,'request').mockImplementation(async()=>{expect(mutations).toEqual(['DELETE']);permission=true;return 'granted';});
 expect(await enableUpdateNotifications([backend],true)).toBe(true);
 expect(mutations).toEqual(['DELETE','POST']);
 expect(NativeModules.BobNotifications.watchUpdates).toHaveBeenCalled();
});
