export const CHAT_CONTENT_GAP=16;
export function toolText(value:unknown):string {
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(block=>block?.type==='text'?block.text:JSON.stringify(block,null,2)).join('\n');
 return JSON.stringify(value,null,2)??'';
}
function parse(value:string):Record<string,any>|undefined{
 try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:undefined;}catch{return undefined;}
}
export function toolPresentation(name:string,content:string):{title:string;detail?:string;command?:string}{
 const args=parse(content),tool=name.replace(/^functions\./,'').split(' · ')[0];
 if(!args)return {title:tool==='Result'?'Tool result':'Tool output',detail:toolResultPreview(content)};
 const path=typeof args.path==='string'?args.path:undefined;
 if(['read','write','edit'].includes(tool))return {title:`${tool==='read'?'Read':tool==='write'?'Write':'Edit'} ${path?.split('/').pop()??'file'}`,detail:path};
 if(tool==='bash'){
  const command=typeof args.command==='string'?args.command.trim():'';
  if(!command)return {title:'Shell output',detail:toolResultPreview(content)};
  const directory=command.match(/^cd\s+("[^"]+"|'[^']+'|[^;&\n]+?)\s*&&\s*/);
  const shown=directory?command.slice(directory[0].length):command;
  const main=shown.split('\n')[0];
  let title='Shell command';
  if(/\b(?:npm|pnpm|yarn)(?:\s+run)?\s+test\b|\bnpx\s+(?:jest|vitest)\b|\bpytest\b/.test(main))title='Run tests';
  else if(/\btsc\b/.test(main))title='Check TypeScript';
  else if(/\bgradlew?\b/.test(main))title='Run Android build checks';
  else if(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/.test(main))title='Build project';
  else if(main){const executable=main.match(/^(?:[A-Za-z_][\w]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*([^\s]+)/)?.[1];if(executable)title=`Run ${executable.split('/').pop()}`;}
  return {title,command:shown,detail:directory?`In ${directory[1]}`:undefined};
 }
 if(tool==='self_update')return {title:`${args.action==='status'?'Check update status':args.action==='rollback'?'Restore previous code':args.action==='build'?'Build':'Update'}${args.action==='status'?'':args.target==='android'?' app':args.target==='backend'?' backend':' app and backend'}`};
 if(tool==='web_search')return {title:'Search the web',detail:typeof args.query==='string'?args.query:undefined};
 if(tool==='browser')return {title:`Browser: ${args.action??'action'}`,detail:typeof args.url==='string'?args.url:typeof args.selector==='string'?args.selector:undefined};
 if(tool==='todos'&&Array.isArray(args.items))return {title:'Update task list',detail:`${args.items.filter((item:any)=>item?.done).length} of ${args.items.length} tasks complete`};
 if(tool==='peer')return {title:`Connected agent: ${args.action??'action'}`,detail:typeof args.query==='string'?args.query:typeof args.conversationId==='number'?`Conversation ${args.conversationId}`:undefined};
 if(tool==='parallel'||tool==='multi_tool_use.parallel')return {title:`Run ${Array.isArray(args.tool_uses)?args.tool_uses.length:'multiple'} tools`,detail:Array.isArray(args.tool_uses)?args.tool_uses.map((item:any)=>item?.recipient_name).filter((value:any)=>typeof value==='string').join(', '):undefined};
 const action=typeof args.action==='string'?args.action:undefined;
 return {title:action?`${tool.replaceAll('_',' ')}: ${action}`:tool.replaceAll('_',' '),detail:typeof args.query==='string'?args.query:typeof args.name==='string'?args.name:undefined};
}
/** A bounded, literal excerpt of recorded output, not an inferred success claim. */
export function toolResultPreview(value:unknown,isError=false):string|undefined{
 const raw=toolText(value).trim();if(!raw)return undefined;
 const object=parse(raw);
 if(object){
  if(typeof object.error==='string')return object.error.slice(0,320);
  if(object.admitted&&typeof object.admitted==='object'&&object.admitted.admission)return `Admission recorded${typeof object.admitted.conversationId==='number'?` for conversation ${object.admitted.conversationId}`:''}. Receipt is not reply completion.`;
  if(typeof object.stage==='string')return object.stage.slice(0,320);
  if(typeof object.status==='string')return `Status: ${object.status}`;
  if(object.apk&&typeof object.apk.versionName==='string')return `Available app: ${object.apk.versionName}`;
 }
 const lines=raw.split('\n').map(line=>line.trim()).filter(line=>line&&!/^<\/?harness>$/.test(line));
 const errors=lines.filter(line=>/\b(?:ENOENT|EACCES|Exception|Error|FAILED|FAIL)\b|error TS\d+|\[error\]|npm error/i.test(line));
 if(isError&&errors.length)return errors.slice(0,2).join('\n').slice(0,320);
 const checks=lines.filter(line=>/^(?:Tests:|Test Suites:|BUILD SUCCESSFUL|BUILD FAILED|PASS |FAIL |# pass |# fail |# tests )/.test(line));
 return (checks.length?checks.slice(0,2):lines.slice(0,2)).join('\n').slice(0,320)||undefined;
}
