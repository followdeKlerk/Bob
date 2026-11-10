import {attachmentType} from '../components/attachment-type';
test.each([
 ['release.apk','application/octet-stream','apk','APK'],['notes.TXT','application/octet-stream','text','TXT'],['CV.pdf','application/pdf','pdf','PDF'],
 ['voice.m4a','application/octet-stream','audio','M4A'],['clip.webm','video/webm','video','WEBM'],['photo.jpg','image/jpeg','image','JPG'],
 ['archive.zip','application/zip','archive','ZIP'],['source.ts','application/octet-stream','code','TS'],['unknown.strange','application/octet-stream','file','FILE'],
 ['unknown','application/x-unknown','file','FILE'],['fake.mp3','application/pdf','pdf','PDF'],['fake.apk','audio/mpeg','audio','AUDIO'],
 ['fake.mp4','application/x-unknown','file','FILE'],['notes.txt',' TEXT/PLAIN; charset=UTF-8','text','TXT'],['blob','video/mp4','video','VIDEO'],
])('%s with %s gets a meaningful honest badge',(name,mime,kind,badge)=>expect(attachmentType(name,mime)).toEqual({kind,badge}));
