import {composerGeometry,draftMetrics,voicePanelMetrics} from '../composer-geometry';

test.each([337,361].flatMap(width=>[1,2].flatMap(fontScale=>[0,280].flatMap(keyboard=>[false,true].flatMap(attachments=>[false,true].map(recovery=>({width,fontScale,keyboard,attachments,recovery})))))))('entire composer is bounded: $width / $fontScale / ime $keyboard / files $attachments / recovery $recovery',fixture=>{
 const layout=composerGeometry({height:754,top:24,bottom:16,heading:76,voice:!fixture.recovery,...fixture});
 const editor=draftMetrics(fixture.fontScale,fixture.keyboard===0),essential=voicePanelMetrics(fixture.fontScale);
 expect(layout.maximum).toBeLessThanOrEqual(layout.available);
 expect(layout.draftMax).toBeGreaterThanOrEqual(editor.input);
 expect(layout.voiceMax||layout.recoveryMax).toBeGreaterThanOrEqual(essential.phase+essential.actions);
 if(fixture.fontScale===2&&fixture.keyboard&&fixture.attachments){expect(layout.constrained).toBe(true);expect(layout.attachmentHeight).toBe(0);expect(layout.heading).toBe(48);}
});
test('accounts for separate control row and scaled text minimum, not a fictitious 48dp editor',()=>{
 expect(draftMetrics(2,false)).toMatchObject({input:72,controls:52,minimum:124,inline:false});
 expect(draftMetrics(1,true)).toMatchObject({minimum:48,inline:true});
});
