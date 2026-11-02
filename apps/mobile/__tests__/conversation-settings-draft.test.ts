import {ConversationSettingsDrafts} from '../conversation-settings-draft';
const saved={instructions:'Backend text',cwd:'/backend'};
test('reloads preserve drafts independently per backend and conversation',()=>{
 const drafts=new ConversationSettingsDrafts();
 drafts.edit('a:7','instructions','Unsaved');drafts.edit('a:7','cwd','/draft');
 expect(drafts.view('a:7',saved)).toEqual({instructions:'Unsaved',cwd:'/draft'});
 expect(drafts.view('b:7',saved)).toEqual(saved);expect(drafts.view('a:8',saved)).toEqual(saved);
});
test('acknowledging one save keeps the other field and newer edits',()=>{
 const drafts=new ConversationSettingsDrafts();drafts.edit('a:7','instructions','First');drafts.edit('a:7','cwd','/draft');
 const submitted=drafts.capture('a:7');
 drafts.edit('a:7','instructions','Newer');drafts.acknowledge('a:7','instructions',submitted);
 expect(drafts.view('a:7',saved)).toEqual({instructions:'Newer',cwd:'/draft'});
 drafts.acknowledge('a:7','instructions',drafts.capture('a:7'));
 expect(drafts.view('a:7',saved)).toEqual({instructions:'Backend text',cwd:'/draft'});
 drafts.acknowledge('a:7','cwd',drafts.capture('a:7'));expect(drafts.capture('a:7')).toEqual({});
});
test('explicit blank instructions remain a draft rather than inherited defaults',()=>{
 const drafts=new ConversationSettingsDrafts();drafts.edit('a:7','instructions','');
 expect(drafts.view('a:7',{instructions:null,cwd:'/backend'}).instructions).toBe('');
});
test('a delayed default-save acknowledgement cannot remove a newer edit back to the same string',()=>{
 const drafts=new ConversationSettingsDrafts();drafts.edit('a:7','instructions','A');
 const submitted=drafts.capture('a:7');
 drafts.edit('a:7','instructions','B');drafts.edit('a:7','instructions','A');
 drafts.acknowledge('a:7','instructions',submitted);
 expect(drafts.view('a:7',{instructions:null,cwd:'/backend'}).instructions).toBe('A');
});
