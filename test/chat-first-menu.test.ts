import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// The mobile compiler exposes the JavaScript parser API; the root native
// compiler does not. Cross-component tests require mobile dependencies installed.
import ts from '../apps/mobile/node_modules/typescript/lib/typescript.js';

function hasJsxProp(source:string,component:string,prop:string):boolean{
 const file=ts.createSourceFile('menu-fixture.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let found=false;
 const visit=(node:ts.Node)=>{
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(file)===component){
   found ||= node.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(file)===prop&&attribute.initializer!==undefined);
  }
  if(!found)ts.forEachChild(node,visit);
 };
 visit(file);return found;
}

test('Bob menu replaces bottom tabs throughout the app; chat-managed configuration stays absent',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const navigation=readFileSync('apps/mobile/components/chat-navigation.tsx','utf8');
 assert.doesNotMatch(app,/label="Open workspaces"/);
 for(const hidden of ['Chat','Skills','Todos','MCP Apps','Prompts'])assert.doesNotMatch(navigation,new RegExp(`id:'${hidden}'`));
 for(const kept of ['Notes','Workstations','Agents','Terminal','Tools','Settings'])assert.match(navigation,new RegExp(`id:'${kept}'`));
 assert.doesNotMatch(navigation,/id:'Sessions'/);
 assert.match(navigation,/label="Back to chat"/);
 assert.match(navigation,/onSelect\('Chat'\)/);
 assert.match(navigation,/label:'Agents and Sessions'/);
 assert.doesNotMatch(app,/(?:label|title)="Advanced modules"/);
 assert.match(app,/<ToolsScreen\b/);
 assert.doesNotMatch(app,/<BottomTabs\b/);
 assert.match(app,/<ChatNavigation\b/);
 assert.match(app,/<SectionBody footer=\{<SectionActions overlay menu=\{sectionMenu\}/);
 assert.doesNotMatch(app,/<SectionHeading[^>]*menu=/);
 for(const section of ['AgentsScreen','NotesScreen','SchedulesScreen','TerminalScreen','SideDrawer'])assert.ok(hasJsxProp(app,section,'menu'),`${section} must receive its own menu prop`);
});

test('menu wiring inspection tolerates multiline JSX without matching another element or source text',()=>{
 for(const source of [
  'const view=<NotesScreen menu={navigation}/>;',
  'const view=<NotesScreen\n request={(path)=>load(path)}\n menu={<ChatNavigation/>}/>;',
  'const view=<NotesScreen\n menu={navigation}\n><Text>Notes</Text></NotesScreen>;',
 ])assert.equal(hasJsxProp(source,'NotesScreen','menu'),true);
 for(const source of [
  'const view=<><NotesScreen/><Other menu={navigation}/></>;',
  'const view=<NotesScreen><Child menu={navigation}/></NotesScreen>;',
  'const view=<NotesScreen label="menu={navigation}"/>;',
  'const text="<NotesScreen menu={navigation}/>";',
  '// <NotesScreen menu={navigation}/>\nconst view=<NotesScreen/>;',
  'const view=<NotesScreen menu/>;',
 ])assert.equal(hasJsxProp(source,'NotesScreen','menu'),false);
});

test('model and thinking lives in the composer plus menu, not conversation settings',()=>{
 const app=readFileSync('apps/mobile/App.tsx','utf8');
 const plus=readFileSync('apps/mobile/components/plus-menu.tsx','utf8');
 assert.doesNotMatch(app,/<SettingsRow[^>]*title="Model & thinking"/);
 assert.match(plus,/label:'Model & thinking'/);
 assert.match(app,/<ConversationSettings/);
});
