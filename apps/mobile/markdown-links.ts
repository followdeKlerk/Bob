import type {ASTNode} from 'react-native-markdown-display';

export type MarkdownLink={url:string;domain:string;key:string;label:string};
const unsafe=/[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\]/;
/** Deliberately independent of RN's incomplete URL implementation. Reject
 * ambiguous authorities instead of handing platform-specific parsing a guess. */
export function safeHttpDestination(value:unknown):Omit<MarkdownLink,'label'>|null {
 if(typeof value!=='string'||unsafe.test(value))return null;
 let decoded:string;
 try{decoded=decodeURIComponent(value);}catch{return null;}
 if(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\]/.test(decoded))return null;
 const match=/^(https?):\/\/([^/?#]+)([^#]*)(#.*)?$/i.exec(value);
 if(!match)return null;
 const [,scheme,authority,pathAndQuery,fragment='']=match;
 if(/[@%]/.test(authority))return null;
 const hostPort=/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(authority);
 if(!hostPort)return null;
 const host=hostPort[1].toLowerCase(),port=hostPort[2];
 if(!host.startsWith('[')&&(!host.split('.').every(label=>label.length>0&&label.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))||host.length>253))return null;
 if(port&&(Number(port)<1||Number(port)>65535))return null;
 const protocol=scheme.toLowerCase();
 const normalizedPort=port&&Number(port)!==(protocol==='https'?443:80)?`:${Number(port)}`:'';
 const path=pathAndQuery.startsWith('/')?pathAndQuery:`/${pathAndQuery}`;
 return {url:value,domain:host,key:`${protocol}://${host}${normalizedPort}${path}${fragment}`};
}
function labelText(nodes:ASTNode[]):string {
 return nodes.map(node=>node.type==='image'?'':node.children.length?labelText(node.children):node.content).join('');
}
/** Uses the actual Markdown AST: references and bare HTTP links work, code,
 * image destinations and unresolved references are not treated as links. */
export function markdownLinks(nodes:ASTNode[]):MarkdownLink[] {
 const links:MarkdownLink[]=[],seen=new Set<string>();
 const visit=(children:ASTNode[])=>children.forEach(node=>{
  if(['fence','code_block','code_inline','image'].includes(node.type))return;
  if(node.type==='link'||node.type==='blocklink'){
   const destination=safeHttpDestination(node.attributes.href);
   if(destination&&!seen.has(destination.key)){
    seen.add(destination.key);
    const label=labelText(node.children).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
    links.push({...destination,label:label||destination.domain});
   }
   return;
  }
  visit(node.children);
 });
 visit(nodes);
 return links;
}
