import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Bob menu replaces bottom tabs throughout the app; chat-managed configuration stays absent',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const navigation=readFileSync('apps/mobile/components/chat-navigation.tsx','utf8');
 assert.doesNotMatch(app,/label="Open workspaces"/);
 for(const hidden of ['Skills','Todos','MCP Apps','Prompts'])assert.doesNotMatch(navigation,new RegExp(`id:'${hidden}'`));
 for(const kept of ['Notes','Workstations','Chat','Agents','Terminal','Settings'])assert.match(navigation,new RegExp(`id:'${kept}'`));
 assert.doesNotMatch(navigation,/id:'Sessions'/);
 assert.match(navigation,/label:'Agents and Sessions'/);
 assert.match(app,/(?:label|title)="Advanced modules"/);
 assert.doesNotMatch(app,/<BottomTabs\b/);
 assert.match(app,/<ChatNavigation\b/);
 assert.match(app,/<SectionBody footer=\{<SectionActions overlay menu=\{sectionMenu\}/);
 assert.doesNotMatch(app,/<SectionHeading[^>]*menu=/);
 for(const section of ['AgentsScreen','NotesScreen','SchedulesScreen','TerminalScreen','SideDrawer'])assert.match(app,new RegExp(`<${section}\\b[^\\n]*\\bmenu=`));
});

test('model and thinking lives in the composer plus menu, not conversation settings',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const plus=readFileSync('apps/mobile/components/plus-menu.tsx','utf8');
 assert.doesNotMatch(app,/<SettingsRow[^>]*title="Model & thinking"/);
 assert.match(plus,/label:'Model & thinking'/);
 assert.match(app,/<ConversationSettings/);
});
