// Use the already bundled Markdown grammar, not substitutions that can change literal mathematics.
// markdown-it is also the parser used by react-native-markdown-display; no HTML execution.
const MarkdownIt = require('markdown-it');
const markdown = new MarkdownIt({html:false,linkify:true,typographer:false});
// CommonMark permits intraword * emphasis, including across repeated numeric
// expressions. Numeric multiplication/exponent operators are literal speech,
// not paired emphasis delimiters. An inline rule leaves code/link parsing intact.
markdown.inline.ruler.before('emphasis','numeric_operator',(state:any,silent:boolean)=>{
 const start=state.pos;
 if(state.src[start]!=='*'||!/[0-9]/.test(state.src[start-1]??''))return false;
 let end=start;while(state.src[end]==='*')end++;
 if(!/[0-9]/.test(state.src[end]??''))return false;
 if(!silent){const token=state.push('text','',0);token.content=state.src.slice(start,end);}
 state.pos=end;return true;
});
type Token={type:string;content:string;children?:Token[];hidden?:boolean};
export function speechText(text:string):string {
 const render=(tokens:Token[]):string=>tokens.map(token=>{
  if(token.type==='fence'||token.type==='code_block')return '\nCode block omitted.\n';
  if(token.type==='inline')return render(token.children??[]);
  if(token.type==='image')return render(token.children??[])||token.content;
  if(['text','code_inline','html_inline'].includes(token.type))return token.content;
  if(token.type==='softbreak'||token.type==='hardbreak')return '\n';
  if(token.type==='hr')return '\n';
  if(token.type==='td_close'||token.type==='th_close')return ' ';
  if(/_(?:open|close)$/.test(token.type))return /^(?:paragraph|heading|blockquote|list_item|bullet_list|ordered_list|tr|table)_close$/.test(token.type)?'\n':'';
  return token.children?render(token.children):'';
 }).join('');
 return render(markdown.parse(text,{})).replace(/\n{3,}/g,'\n\n').trim();
}
