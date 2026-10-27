import test from 'node:test';
import assert from 'node:assert/strict';
import {noteSnapshot,noteLoadedEntries,takeStreamDiagnostics} from '../apps/mobile/stream-diagnostics.js';
import {reuseSnapshotEntries} from '../apps/mobile/snapshot-cache.js';

test('stream diagnostics retain bounded numbers only and reset interval peaks',()=>{
 takeStreamDiagnostics();noteLoadedEntries(250);
 for(let i=0;i<10000;i++)noteSnapshot(500000+i, i%100);
 assert.deepEqual(takeStreamDiagnostics(),{updates:10000,lastChars:509999,maxChars:509999,maxCallbackMs:99,loadedEntries:250});
 assert.deepEqual(takeStreamDiagnostics(),{updates:0,lastChars:509999,maxChars:509999,maxCallbackMs:0,loadedEntries:250});
 noteSnapshot(Infinity,NaN);noteLoadedEntries(-1);
 const sample=takeStreamDiagnostics();assert.equal(sample.lastChars,0);assert.equal(sample.loadedEntries,0);
 assert.ok(Object.values(sample).every(value=>typeof value==='number'&&Number.isFinite(value)));
});
test('synthetic large tool snapshots retain entry identity without diagnostic payload retention',()=>{
 let previous:any;const output='x'.repeat(250000);
 for(let index=0;index<80;index++){
  const raw=JSON.stringify({entries:Array.from({length:200},(_,id)=>({id,kind:'pi.assistant'})),docs:{'pi.live':{tools:[{callId:'fixture',status:'running',output:output+index}]}}});
  const start=performance.now(),next=JSON.parse(raw),current=reuseSnapshotEntries(previous,next);
  if(previous)assert.equal(current.entries,previous.entries);
  noteSnapshot(raw.length,performance.now()-start);noteLoadedEntries(current.entries.length);previous=current;
 }
 const sample=takeStreamDiagnostics();assert.equal(sample.updates,80);assert.equal(sample.loadedEntries,200);
 assert.ok(sample.maxChars>250000);assert.ok(JSON.stringify(sample).length<200);
 // This is synthetic workload/instrumentation coverage, not a phone memory/leak benchmark.
});
