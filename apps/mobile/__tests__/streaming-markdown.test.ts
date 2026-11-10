import {createStreamingMarkdownParser,arrivingTextStart,proseText} from '../streaming-markdown';

const fixtures=[
 'Intro with **bold**, *italic*, `inline`, ~~removed~~ and a [link](https://example.com).\n\nNext paragraph.',
 '```ts\nconst value = "**not prose**";\n\n| not | a table |\n```\n\nAfter.',
 '~~~\nopen fence\n\n- still code\n~~~\n\nDone',
 '| A | B |\n| :--- | ---: |\n| **one** | two |\n| three | four |\n\nAfter',
 '3. Third\n4. Fourth\n\n   Continuation\n   - Nested\n     more\n\n> quote\n> continued\n\nlazy continuation',
 '[Docs][ref] and [ref][] and [ref].\n\n[ref]: https://example.com/docs "Title"\n\n[ref]: https://other.example',
 'Indented:\n\n    const x = 1;\n    next\n\nEnd\n\nHeading\n=======\n\n---',
 '![alt](https://example.com/image.png)\n\nhttps://example.com/path?q=a&b=c and <https://example.org>',
];
test.each(fixtures)('cached Markdown exactly matches a fresh full parser at every partial append: %s',source=>{
 const cached=createStreamingMarkdownParser();
 for(let length=1;length<=source.length;length++){
  const partial=source.slice(0,length);
  expect(cached.parse(partial)).toEqual(createStreamingMarkdownParser().parse(partial));
 }
 // Replacement, shrinking and completion do not retain stale source tokens.
 for(const replacement of ['Replaced **answer**','[Docs][ref]\n\n[ref]: https://new.example',''])
  expect(cached.parse(replacement)).toEqual(createStreamingMarkdownParser().parse(replacement));
});
test('unchanged inline blocks are cached; changed references invalidate them',()=>{
 const cached=createStreamingMarkdownParser();
 const parse=jest.spyOn(cached.markdownit.inline,'parse');
 cached.parse('**Stable** first\n\nGrowing');expect(parse).toHaveBeenCalledTimes(2);
 parse.mockClear();cached.parse('**Stable** first\n\nGrowing tail');
 expect(parse).toHaveBeenCalledTimes(1);expect(parse.mock.calls[0][0]).toBe('Growing tail');
 cached.parse('[Docs][ref]\n\n[ref]: https://one.example');parse.mockClear();
 const changed=cached.parse('[Docs][ref]\n\n[ref]: https://two.example');
 expect(parse).toHaveBeenCalledTimes(1);expect(JSON.stringify(changed)).toContain('https://two.example');
});
test('only an append of rendered prose is an arrival; syntax rewrites and replacements never replay old text',()=>{
 const parser=createStreamingMarkdownParser();
 const previous={source:'Hello',prose:'Hello',streaming:true};
 expect(arrivingTextStart(previous,'Hello world','Hello world',true)).toBe(5);
 for(const [source,prose,streaming] of [['Hello','Hello',true],['Replacement','Replacement',true],['Hello world','Hello world',false]] as const)
  expect(arrivingTextStart(previous,source,prose,streaming)).toBeNull();
 expect(arrivingTextStart({source:'**Hello',prose:proseText(parser.parse('**Hello')),streaming:true},'**Hello**',proseText(parser.parse('**Hello**')),true)).toBeNull();
 expect(arrivingTextStart(null,'Fresh answer','Fresh answer',true)).toBeNull();
 expect(arrivingTextStart({...previous,streaming:false},'Hello world','Hello world',true)).toBeNull();
});
