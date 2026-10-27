export type TableNode={type:string;content?:string;children:TableNode[];index?:number};
function rows(node:TableNode):TableNode[]{
 if(node.type==='tr')return [node];
 return node.children.flatMap(rows);
}
function plain(node:TableNode):string {
 return node.children.length?node.children.map(plain).join(''):(node.content??'');
}
/** Shared widths per column, not per cell: all rows stay aligned as text wraps.
 * Estimates affect layout only; content remains intact, selectable and scalable.
 */
export function markdownTableWidths(table:TableNode,viewport:number,fontScale=1):number[]{
 const values=rows(table),count=values.reduce((max,row)=>Math.max(max,row.children.length),0);
 if(!count)return [];
 const available=Math.max(1,Number.isFinite(viewport)?viewport:300),scale=Number.isFinite(fontScale)?Math.max(1,fontScale):1;
 const cap=Math.max(160,Math.min(280,available*.7));
 const widths=Array.from({length:count},(_,index)=>{
  const chars=values.reduce((max,row)=>{
   const cell=row.children[index];return cell?plain(cell).split('\n').reduce((longest,line)=>Math.max(longest,Array.from(line).length),max):max;
  },0);
  return Math.ceil(Math.min(cap,Math.max(108,chars*7.5*scale+24)));
 });
 const extra=Math.max(0,available-widths.reduce((sum,width)=>sum+width,0));
 return widths.map(width=>width+extra/count);
}
export function markdownCodeLanguage(info:unknown):string {
 const language=typeof info==='string'?info.trim().split(/\s+/)[0]:'';
 return /^[\w#+.-]{1,32}$/.test(language)?language:'Code';
}
