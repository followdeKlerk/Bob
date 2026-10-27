export type NoteFormat='bold'|'italic'|'heading'|'bullet'|'checklist';
export function formatNote(text:string,start:number,end:number,format:NoteFormat){
 start=Math.max(0,Math.min(start,text.length));end=Math.max(start,Math.min(end,text.length));
 if(format==='bold'||format==='italic'){
  const marker=format==='bold'?'**':'*',selected=text.slice(start,end)||'text';
  return {text:text.slice(0,start)+marker+selected+marker+text.slice(end),selection:{start:start+marker.length,end:start+marker.length+selected.length}};
 }
 const lineStart=start>0?text.lastIndexOf('\n',start-1)+1:0;
 const prefix=format==='heading'?'## ':format==='bullet'?'- ':'- [ ] ';
 const lines=text.slice(lineStart,end).split('\n').map(line=>prefix+line).join('\n');
 const updated=text.slice(0,lineStart)+lines+text.slice(end);
 return {text:updated,selection:{start:lineStart+prefix.length,end:lineStart+lines.length}};
}
export function toggleNoteTask(text:string,line:number){
 return text.split('\n').map((value,index)=>index===line?value.replace(/^(\s*[-*] \[)([ xX])(\])/,(_match,before,checked,after)=>before+(checked===' '?'x':' ')+after):value).join('\n');
}
export function noteSnippet(text:string){return text.replace(/^\s*[-*] \[([ xX])\]/gm,(_match,checked)=>checked===' '?'☐':'☑').replace(/^#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1');}
