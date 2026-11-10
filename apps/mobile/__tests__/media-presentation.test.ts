import {initialMediaState,mediaBusy,mediaBytes,mediaStateFromProgress,mediaStatus,mediaTime} from '../components/media-presentation';
const event={sessionId:'media-1',positionMs:1234,durationMs:30000,paused:false,buffering:false};
test('admission begins as connecting, never fictitious playing or a percentage',()=>{
 expect(initialMediaState(5000,true)).toEqual({phase:'connecting',positionMs:5000,durationMs:0,paused:true,receivedBytes:0,videoReady:false});
 expect(mediaStatus('connecting',false)).toBe('Connecting…');expect(mediaStatus('loading',true)).toBe('Loading video…');
 expect(mediaStatus('buffering',false)).toBe('Buffering…');expect(mediaBusy('playing')).toBe(false);expect(mediaBusy('seeking')).toBe(true);
});
test('native progress has bounded time and monotonic actual received bytes, not invented buffered duration',()=>{
 const first=mediaStateFromProgress({...event,phase:'loading',receivedBytes:65536},initialMediaState())!;
 expect(first.phase).toBe('loading');expect(first.receivedBytes).toBe(65536);
 const next=mediaStateFromProgress({...event,phase:'playing',receivedBytes:1,videoReady:true},first)!;
 expect(next.receivedBytes).toBe(65536);expect(next.videoReady).toBe(true);expect(next.positionMs).toBe(1234);
 expect(mediaStateFromProgress({...event,positionMs:NaN},next)).toBeUndefined();
 expect(mediaStateFromProgress({...event,positionMs:-1},next)).toBeUndefined();
 expect(mediaStateFromProgress({...event,positionMs:2147483648},next)).toBeUndefined();
 expect(mediaStateFromProgress({...event,durationMs:NaN,receivedBytes:Infinity},next)?.durationMs).toBe(30000);
});
test('legacy native callbacks retain sensible playing/paused/buffering status',()=>{
 expect(mediaStateFromProgress(event,initialMediaState())?.phase).toBe('playing');
 expect(mediaStateFromProgress({...event,paused:true},initialMediaState())?.phase).toBe('paused');
 expect(mediaStateFromProgress({...event,buffering:true},initialMediaState())?.phase).toBe('buffering');
});
test('time and bytes remain readable without pretending a download has completed',()=>{
 expect(mediaTime(0)).toBe('0:00');expect(mediaTime(30000)).toBe('0:30');expect(mediaTime(125000)).toBe('2:05');
 expect(mediaBytes(0)).toBe('0 bytes');expect(mediaBytes(1)).toBe('1 byte');expect(mediaBytes(65536)).toBe('64 KB');
 expect(mediaBytes(1770955)).toBe('1.7 MB');expect(mediaBytes(NaN)).toBe('Size unknown');
});
