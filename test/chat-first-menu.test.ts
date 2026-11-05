import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Bob menu replaces bottom tabs throughout the app; chat-managed configuration stays absent',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const navigation=readFileSync('apps/mobile/components/chat-navigation.tsx','utf8');
 assert.doesNotMatch(app,/label="Open workspaces"/);
 for(const hidden of ['Skills','Todos','MCP Apps','Prompts'])assert.doesNotMatch(navigation,new RegExp(`id:'${hidden}'`));
 for(const kept of ['Notes','Workstations','Chat','Agents','Sessions','Settings'])assert.match(navigation,new RegExp(`id:'${kept}'`));
 assert.match(app,/(?:label|title)="Advanced modules"/);
 assert.doesNotMatch(app,/<BottomTabs\b/);
 assert.match(app,/<ChatNavigation\b/);
 assert.match(app,/<SectionBody footer=\{<SectionActions overlay menu=\{sectionMenu\}/);
 assert.doesNotMatch(app,/<SectionHeading[^>]*menu=/);
 for(const section of ['AgentsScreen','NotesScreen','SchedulesScreen','SideDrawer'])assert.match(app,new RegExp(`<${section} menu=`));
});

test('model and thinking has a conversation-settings shortcut and preserves the composer quick route',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const plus=readFileSync('apps/mobile/components/plus-menu.tsx','utf8');
 assert.match(app,/<SettingsRow[^>]*title="Model & thinking"/);
 assert.match(plus,/label:'Model & thinking'/);
 assert.match(app,/<ConversationSettings/);
});
