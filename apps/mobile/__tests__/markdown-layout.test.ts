import {markdownCodeLanguage,markdownTableWidths,type TableNode} from '../markdown-layout';
const cell=(content:string):TableNode=>({type:'td',content,children:[]});
const table=(rows:string[][]):TableNode=>({type:'table',children:[{type:'tbody',children:rows.map(cells=>({type:'tr',children:cells.map(cell)}))}]});
test('column widths use all rows, keep short tables within their parent and let wide tables scroll',()=>{
 const short=markdownTableWidths(table([['A','B'],['1','2']]),263);
 expect(short).toEqual([131.5,131.5]);
 const wide=markdownTableWidths(table([['A','B','C','D'],['long content '.repeat(80),'2','3','4']]),263);
 expect(wide).toHaveLength(4);expect(wide.reduce((a,b)=>a+b,0)).toBeGreaterThan(263);
 expect(wide.every(width=>Number.isFinite(width)&&width>=108&&width<=280)).toBe(true);
});
test('empty, Unicode, missing cells, narrow parents and large fonts have finite non-shrinking widths',()=>{
 expect(markdownTableWidths(table([]),263)).toEqual([]);
 const value=table([['🔧修復','A moderately long value'],['only one cell']]);
 const normal=markdownTableWidths(value,263),large=markdownTableWidths(value,263,2);
 expect(large[1]).toBeGreaterThanOrEqual(normal[1]);
 for(const width of markdownTableWidths(value,0))expect(Number.isFinite(width)&&width>=108).toBe(true);
});
test('code language metadata is a short display label, not HTML or an executable instruction',()=>{
 expect(markdownCodeLanguage('typescript title="file.ts"')).toBe('typescript');
 expect(markdownCodeLanguage('c++')).toBe('c++');expect(markdownCodeLanguage('c#')).toBe('c#');
 for(const info of [undefined,'','<img src=x>','x'.repeat(100)])expect(markdownCodeLanguage(info)).toBe('Code');
});
