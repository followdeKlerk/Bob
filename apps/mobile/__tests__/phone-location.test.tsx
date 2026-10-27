import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules,PermissionsAndroid,Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {startPhoneLocation,stopPhoneLocation,usePhoneLocation} from '../use-phone-location';
jest.mock('react-native-keychain',()=>({getGenericPassword:jest.fn(async()=>({password:'device-secret'}))}));
jest.mock('react-native/Libraries/AppState/AppState',()=>({__esModule:true,default:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
const backend={backendId:'owner-backend',endpoint:'https://owner.tail.ts.net',name:'Owner'};
const decisions=(overrides:Partial<Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>>={})=>Object.fromEntries(Object.values(PermissionsAndroid.PERMISSIONS).map(permission=>[permission,overrides[permission]??'denied'])) as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>;
beforeEach(()=>{
 jest.replaceProperty(Platform,'OS','android');jest.spyOn(Platform,'Version','get').mockReturnValue(36);
 NativeModules.BobLocation={enabled:jest.fn(async()=>false),start:jest.fn(async()=>true),stop:jest.fn(async()=>true)};
 (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({password:'device-secret'});
 jest.spyOn(PermissionsAndroid,'check').mockResolvedValue(true);jest.spyOn(PermissionsAndroid,'requestMultiple').mockResolvedValue(decisions());jest.spyOn(PermissionsAndroid,'request').mockResolvedValue('granted');
});
afterEach(()=>jest.restoreAllMocks());
test('explicit enable requests precise/coarse together, allows approximate choice, and starts the private native service',async()=>{
 jest.mocked(PermissionsAndroid.check).mockImplementation(async(permission)=>permission===PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
 jest.mocked(PermissionsAndroid.requestMultiple).mockResolvedValue(decisions({[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]:'granted',[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]:'denied'}));
 await startPhoneLocation(backend,true);
 expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]);
 expect(NativeModules.BobLocation.start).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'device-secret',true);
});
test('a denied location permission never starts GPS or its service',async()=>{
 jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
 await expect(startPhoneLocation(backend,true)).rejects.toThrow('Allow Android location');expect(NativeModules.BobLocation.start).not.toHaveBeenCalled();
});
test('resume never prompts for permission and cannot re-enable an owner-stopped service',async()=>{
 await startPhoneLocation(backend,false);expect(NativeModules.BobLocation.start).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'device-secret',false);
 expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();expect(PermissionsAndroid.request).not.toHaveBeenCalled();
 jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
 await expect(startPhoneLocation(backend,false)).rejects.toThrow('permission was removed');expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
});
test('notification refusal prevents hidden background location availability',async()=>{
 jest.mocked(PermissionsAndroid.check).mockImplementation(async(permission)=>permission!==PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
 jest.mocked(PermissionsAndroid.request).mockResolvedValue('denied');
 await expect(startPhoneLocation(backend,true)).rejects.toThrow('notifications');expect(NativeModules.BobLocation.start).not.toHaveBeenCalled();
});
test('Stop still stops the local service if the credential store has failed',async()=>{
 jest.mocked(Keychain.getGenericPassword).mockRejectedValue(Error('Keystore unavailable'));
 await stopPhoneLocation(backend);expect(NativeModules.BobLocation.stop).toHaveBeenCalledWith(backend.endpoint,backend.backendId,'');
});

test('a visible Disable action stays a Stop even if native state changed, and rapid double taps cannot re-enable it',async()=>{
 NativeModules.BobLocation.enabled.mockResolvedValue(true);
 let api!:ReturnType<typeof usePhoneLocation>;function Harness(){api=usePhoneLocation(backend);return null;}let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<Harness/>);});expect(api.enabled).toBe(true);
 const starts=NativeModules.BobLocation.start.mock.calls.length;NativeModules.BobLocation.enabled.mockResolvedValue(false);
 await act(async()=>{await Promise.all([api.toggle(),api.toggle()]);});
 expect(NativeModules.BobLocation.stop).toHaveBeenCalledTimes(1);expect(NativeModules.BobLocation.start).toHaveBeenCalledTimes(starts);expect(api.enabled).toBe(false);
 await act(async()=>tree.unmount());
});
