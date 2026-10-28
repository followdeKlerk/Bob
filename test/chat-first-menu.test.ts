import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('chat-managed configuration is absent from the burger menu; browsing entries remain',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const navigation=app.match(/navigation=\{\[([\s\S]*?)\]\.map\(item/);
 assert.ok(navigation,'Main sidebar navigation must exist');
 for(const hidden of ['Skills','Todos','MCP Apps'])assert.doesNotMatch(navigation[1],new RegExp(`id:'${hidden}'`));
 for(const kept of ['Notes','Prompts','Modules'])assert.match(navigation[1],new RegExp(`id:'${kept}'`));
});
