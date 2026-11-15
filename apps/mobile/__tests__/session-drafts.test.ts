import AsyncStorage from '@react-native-async-storage/async-storage';
import {SessionDrafts} from '../session-drafts';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
beforeEach(()=>{jest.resetAllMocks();(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);});

test('a new session view reads after a write admitted by an evicted view',async()=>{
 const drafts=new SessionDrafts(),pending=deferred<void>();
 (AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(pending.promise);
 const write=drafts.write('workstation-a:7','Latest text');
 let settled=false;const read=drafts.read('workstation-a:7').then(value=>{settled=true;return value;});
 await Promise.resolve();expect(settled).toBe(false);
 pending.resolve();await write;
 expect(await read).toEqual({value:'Latest text',saved:true});
 expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('failed persistence preserves text for a later view and an explicit retry',async()=>{
 const drafts=new SessionDrafts();
 (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('storage unavailable'));
 await expect(drafts.write('workstation-a:7','Unsaved text')).rejects.toThrow('storage unavailable');
 expect(await drafts.read('workstation-a:7')).toEqual({value:'Unsaved text',saved:false});
 await drafts.write('workstation-a:7','Unsaved text');
 expect(await drafts.read('workstation-a:7')).toEqual({value:'Unsaved text',saved:true});
});

test('same conversation number on different workstations cannot mix text or wait on each other',async()=>{
 const drafts=new SessionDrafts(),pending=deferred<void>();
 (AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(pending.promise);
 const first=drafts.write('workstation-a:7','A');await Promise.resolve();
 await drafts.write('workstation-b:7','B');
 expect(await drafts.read('workstation-b:7')).toEqual({value:'B',saved:true});
 pending.resolve();await first;
 expect(await drafts.read('workstation-a:7')).toEqual({value:'A',saved:true});
});

test('a late disk read cannot replace a newer in-process draft',async()=>{
 const drafts=new SessionDrafts(),disk=deferred<string>();
 (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(disk.promise);
 const read=drafts.read('workstation-a:7');await Promise.resolve();
 await drafts.write('workstation-a:7','Newer text');disk.resolve('Old disk text');
 expect(await read).toEqual({value:'Newer text',saved:true});
});

test('a failed initial read propagates without writing a blank replacement',async()=>{
 const drafts=new SessionDrafts();(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(Error('read failed'));
 await expect(drafts.read('workstation-a:7')).rejects.toThrow('read failed');
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();
 (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('Recovered text');
 expect(await drafts.read('workstation-a:7')).toEqual({value:'Recovered text',saved:true});
});
