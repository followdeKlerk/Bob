import {applySnapshotPatch} from '../snapshot-patch';
const patch=(values:Record<string,unknown>={})=>JSON.stringify({base:0,sequence:1,prefix:3,remove:2,insert:'xy',length:7,...values});
test('rebuilds only a connection-local read model, including unicode',()=>{
 expect(applySnapshotPatch('abcdefg',0,patch())).toEqual({json:'abcxyfg',sequence:1});
 expect(applySnapshotPatch('a😀z',0,patch({prefix:1,remove:2,insert:'🦊',length:4})).json).toBe('a🦊z');
});
test.each([{base:1},{sequence:2},{prefix:-1},{prefix:8},{remove:9},{length:6},{prefix:0.5},{insert:{}},{sequence:1e30}])('rejects gaps and invalid ranges %j',value=>{
 expect(()=>applySnapshotPatch('abcdefg',0,patch(value))).toThrow();
});
test('requires an initial snapshot and a parseable patch',()=>{
 expect(()=>applySnapshotPatch(undefined,0,patch())).toThrow();
 expect(()=>applySnapshotPatch('abcdefg',0,'null')).toThrow();
 expect(()=>applySnapshotPatch('abcdefg',0,'{')).toThrow();
});
