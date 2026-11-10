import {createStreamingMarkdownParser} from '../streaming-markdown';
import {markdownLinks,safeHttpDestination} from '../markdown-links';
const links=(source:string)=>markdownLinks(createStreamingMarkdownParser().parse(source));

test('real Markdown labels, references, autolinks and bare HTTP links are found outside code',()=>{
 const source='[**Docs** and `API`](https://example.com/docs) [Reference][ref] [ref][] [ref]\n\nhttps://bare.example/path?q=a&b=c. <https://auto.example>\n\n[ref]: https://reference.example/guide "Title"\n\n`https://inline.example`\n\n```md\n[private](https://code.example)\n```\n\n    https://indented.example\n\n![image](https://image.example/pixel)';
 expect(links(source).map(({label,domain})=>({label,domain}))).toEqual([
  {label:'Docs and API',domain:'example.com'},
  {label:'Reference',domain:'reference.example'},
  {label:'https://bare.example/path?q=a&b=c',domain:'bare.example'},
  {label:'https://auto.example',domain:'auto.example'},
 ]);
});
test('dedupe canonicalizes only scheme, host, default port and empty root; query/path/fragment distinctions survive',()=>{
 const source='[First](HTTPS://EXAMPLE.COM:443) [Repeat](https://example.com/) [Query](https://example.com/?x=1) [Other query](https://example.com/?x=2) [Fragment](https://example.com/#anchor) [Path](https://example.com/Path) [Other path](https://example.com/path)';
 const found=links(source);expect(found).toHaveLength(6);expect(found[0].label).toBe('First');
 expect(found[0].domain).toBe('example.com');
});
test.each([
 'javascript:alert(1)','data:text/plain,hello','file:///private','mailto:a@example.com','//example.com/path',
 'https://user:password@example.com/path','https://user@example.com','https://example.com@evil.example',
 'https://exa%6dple.com','https://example.com\\@evil.example','https://example.com/%5cpath',
 'https://example.com/\npath','https://example.com/%0apath','https://example.com/%00',
 'https://example.com/\u202Efile','https://example.com/%E2%80%AEfile','https://example.com/%',
 'https://example.com:99999','https://example.com:0','https://-example.com','https://example..com','https:///path',
])('rejects unsafe or ambiguous destinations: %s',value=>expect(safeHttpDestination(value)).toBeNull());
test.each(['https://example.com/a%20b?q=x#section','http://localhost:8080/test','https://[::1]:443/'])('accepts unambiguous http(s): %s',value=>expect(safeHttpDestination(value)?.url).toBe(value));
test('partial links/references stay absent until actual Markdown resolves them, and code examples stay absent',()=>{
 expect(links('[Docs](https://')).toEqual([]);
 // A complete bare URL can be linkified before its Markdown wrapper closes.
 expect(links('[Docs](https://example.com')[0].label).toBe('https://example.com');
 expect(links('[Docs](https://example.com)')[0].label).toBe('Docs');
 expect(links('[Docs][ref]')).toEqual([]);
 expect(links('[Docs][ref]\n\n[ref]: https://example.com')).toHaveLength(1);
 expect(links('```\nhttps://code.example')).toEqual([]);
 expect(links('[Login](https://me:secret@example.com) [Local](file:///x)')).toEqual([]);
});
