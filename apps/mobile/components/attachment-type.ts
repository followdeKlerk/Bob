/** Labels are presentation hints, not permission to execute/open an attachment. */
export type AttachmentKind = 'image'|'audio'|'video'|'apk'|'pdf'|'text'|'code'|'archive'|'document'|'sheet'|'slides'|'file';
export type AttachmentType = {kind:AttachmentKind; badge:string};
const extensions:Record<string,AttachmentType>={
 apk:{kind:'apk',badge:'APK'},pdf:{kind:'pdf',badge:'PDF'},
 txt:{kind:'text',badge:'TXT'},md:{kind:'text',badge:'MD'},csv:{kind:'sheet',badge:'CSV'},
 mp3:{kind:'audio',badge:'MP3'},m4a:{kind:'audio',badge:'M4A'},aac:{kind:'audio',badge:'AAC'},wav:{kind:'audio',badge:'WAV'},ogg:{kind:'audio',badge:'OGG'},flac:{kind:'audio',badge:'FLAC'},opus:{kind:'audio',badge:'OPUS'},
 mp4:{kind:'video',badge:'MP4'},m4v:{kind:'video',badge:'M4V'},webm:{kind:'video',badge:'WEBM'},mov:{kind:'video',badge:'MOV'},mkv:{kind:'video',badge:'MKV'},
 jpg:{kind:'image',badge:'JPG'},jpeg:{kind:'image',badge:'JPG'},png:{kind:'image',badge:'PNG'},gif:{kind:'image',badge:'GIF'},webp:{kind:'image',badge:'WEBP'},heic:{kind:'image',badge:'HEIC'},
 zip:{kind:'archive',badge:'ZIP'},gz:{kind:'archive',badge:'GZ'},tar:{kind:'archive',badge:'TAR'},'7z':{kind:'archive',badge:'7Z'},rar:{kind:'archive',badge:'RAR'},
 doc:{kind:'document',badge:'DOC'},docx:{kind:'document',badge:'DOCX'},odt:{kind:'document',badge:'ODT'},rtf:{kind:'document',badge:'RTF'},
 xls:{kind:'sheet',badge:'XLS'},xlsx:{kind:'sheet',badge:'XLSX'},ods:{kind:'sheet',badge:'ODS'},ppt:{kind:'slides',badge:'PPT'},pptx:{kind:'slides',badge:'PPTX'},
 json:{kind:'code',badge:'JSON'},js:{kind:'code',badge:'JS'},ts:{kind:'code',badge:'TS'},py:{kind:'code',badge:'PY'},html:{kind:'code',badge:'HTML'},xml:{kind:'code',badge:'XML'},css:{kind:'code',badge:'CSS'},sh:{kind:'code',badge:'SH'},
};
const mimes:Record<string,AttachmentType>={
 'application/vnd.android.package-archive':extensions.apk,'application/pdf':extensions.pdf,
 'text/plain':extensions.txt,'text/markdown':extensions.md,'text/csv':extensions.csv,
 'application/json':extensions.json,'application/xml':extensions.xml,'text/html':extensions.html,
 'application/zip':extensions.zip,'application/gzip':extensions.gz,'application/x-7z-compressed':extensions['7z'],
 'application/msword':extensions.doc,'application/vnd.openxmlformats-officedocument.wordprocessingml.document':extensions.docx,
 'application/vnd.ms-excel':extensions.xls,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':extensions.xlsx,
 'application/vnd.ms-powerpoint':extensions.ppt,'application/vnd.openxmlformats-officedocument.presentationml.presentation':extensions.pptx,
};
export function attachmentType(name:string,mime:string):AttachmentType {
 const normalized=mime.split(';',1)[0].trim().toLowerCase();
 const ext=extensions[name.split('.').pop()?.toLowerCase()??''];
 // Only absent/generic MIME can borrow an extension's authority. Never let song.mp3
 // override a server-declared PDF (or let an arbitrary suffix become a badge).
 if(!normalized||['application/octet-stream','binary/octet-stream','application/binary'].includes(normalized))return ext??{kind:'file',badge:'FILE'};
 if(mimes[normalized])return mimes[normalized];
 const family=normalized.split('/')[0];
 if(family==='image'||family==='audio'||family==='video')return ext?.kind===family?ext:{kind:family,badge:family.toUpperCase()};
 if(family==='text')return ext?.kind==='code'?ext:{kind:'text',badge:'TXT'};
 return {kind:'file',badge:'FILE'};
}
