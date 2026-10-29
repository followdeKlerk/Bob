import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationTitle,isPlaceholderTitle} from '../src/conversation-title.js';
test('default titles are replaceable, custom titles are not',()=>{
 for(const title of [undefined,'','New chat','New conversation','Untitled','Conversation'])assert.equal(isPlaceholderTitle(title),true);
 for(const title of ['My router','Notes on New chat','Project plan'])assert.equal(isPlaceholderTitle(title),false);
});
test('titles extract the opening subject without extra inference',()=>{
 assert.equal(conversationTitle('Could you please fix the OPNsense firewall rules?'),'Fix the OPNsense firewall rules?');
 assert.equal(conversationTitle('# Notes autosave\nThe back button should save.'),'Notes autosave');
 assert.equal(conversationTitle('User attachment available at /private/photo.jpg\n\nFix the notes page'),'Fix the notes page');
 assert.equal(conversationTitle('  '),undefined);
 assert.ok(Array.from(conversationTitle('a'.repeat(300))!).length<=73);
});
