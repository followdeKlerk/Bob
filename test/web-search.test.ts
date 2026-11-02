import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseDuckDuckGoSearch } from '../packages/web/src/index.js';

test('DuckDuckGo search distinguishes matches, verified no results and failures', () => {
  assert.deepEqual(parseDuckDuckGoSearch(200, '<a class="result__a" href="https://example.com/?a=1&amp;b=2"><b>Example</b></a>'), [{url:'https://example.com/?a=1&b=2',title:'Example'}]);
  assert.deepEqual(parseDuckDuckGoSearch(200, '<div class="result results_links result--no-result"><h1>No results found for query</h1></div>'), []);
  assert.throws(() => parseDuckDuckGoSearch(202, '<html>challenge</html>'), /bot challenge/);
  assert.throws(() => parseDuckDuckGoSearch(200, '<div class="anomaly-modal">challenge</div>'), /bot challenge/);
  assert.throws(() => parseDuckDuckGoSearch(503, 'unavailable'), /HTTP 503/);
  assert.throws(() => parseDuckDuckGoSearch(200, '<html>unexpected layout</html>'), /could not be parsed/);
});
