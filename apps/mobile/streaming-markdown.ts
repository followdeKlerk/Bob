import {MarkdownIt,parser as displayParser,type ASTNode} from 'react-native-markdown-display';

// The display package mutates tokens while normalizing them. Keep cached tokens
// pristine (including Token's attrIndex/attrGet prototype methods).
function cloneTokens(tokens:any[]):any[] {
 return tokens.map(token=>Object.assign(Object.create(Object.getPrototypeOf(token)),token,{
  attrs:token.attrs?.map((pair:string[])=>[...pair]),
  children:token.children?cloneTokens(token.children):token.children,
 }));
}

/** Per-message inline cache, NOT a Markdown source splitter. The complete block
 * grammar still runs on every change. References invalidate every inline entry;
 * partial fences, tables, nested lists and lazy continuations stay parser-owned.
 * Only entries in the current document survive; no accumulating stream history.
 */
export function createStreamingMarkdownParser() {
 const markdownit=new MarkdownIt({html:false,linkify:true,typographer:false});
 let cache=new Map<string,any[]>(),references='';
 markdownit.core.ruler.at('inline',(state:any)=>{
  const signature=JSON.stringify(state.env.references??{});
  if(signature!==references){cache.clear();references=signature;}
  const next=new Map<string,any[]>();
  for(const token of state.tokens){
   if(token.type!=='inline')continue;
   const cached=cache.get(token.content)??next.get(token.content);
   if(cached)token.children=cloneTokens(cached);
   else {
    state.md.inline.parse(token.content,state.md,state.env,token.children);
    // Bound per-message retention even for generated documents with many cells.
   }
   if(next.size<512)next.set(token.content,cached??cloneTokens(token.children));
  }
  cache=next;
 });
 return {markdownit,parse(text:string):ASTNode[]{
  let nodes:ASTNode[]=[];
  displayParser(text,((value:ASTNode[])=>{nodes=value;return null;}) as any,markdownit);
  const keys=(children:ASTNode[],prefix:string)=>children.forEach((node,index)=>{
   node.key=`${prefix}-${index}-${node.type}`;
   keys(node.children,node.key);
  });
  keys(nodes,'md');
  return nodes;
 }};
}
