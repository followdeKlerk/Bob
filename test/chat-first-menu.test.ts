import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('five bottom destinations replace the burger; chat-managed configuration stays absent',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const tabs=readFileSync('apps/mobile/components/bottom-tabs.tsx','utf8');
 assert.doesNotMatch(app,/label="Open workspaces"/);
 for(const hidden of ['Skills','Todos','MCP Apps','Prompts'])assert.doesNotMatch(tabs,new RegExp(`id:'${hidden}'`));
 for(const kept of ['Notes','Workstations','Chat','Sessions','Settings'])assert.match(tabs,new RegExp(`id:'${kept}'`));
 assert.match(app,/(?:label|title)="Advanced modules"/);
 assert.match(app,/keyboardInset<=0&&<BottomTabs/);
});

test('model and thinking selection belongs only in the composer plus menu',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const plus=readFileSync('apps/mobile/components/plus-menu.tsx','utf8');
 assert.doesNotMatch(app,/<SettingsRow[^>]*title="Model & thinking"/);
 assert.match(plus,/label:'Model & thinking'/);
 assert.match(app,/<ConversationSettings/);
});
