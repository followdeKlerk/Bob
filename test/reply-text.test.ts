import test from 'node:test';
import assert from 'node:assert/strict';
import {replyText} from '../apps/mobile/reply-text.js';

test('tool-only and whitespace-only messages have no reply copy action',()=>{
 const call={type:'toolCall',name:'bash',arguments:{command:'npm test'}};
 for(const value of [undefined,null,'',' \n\t',[],[call],[{type:'text',text:'\n'},call,{type:'text',text:' '}],[{type:'thinking',thinking:'private'},call],[{type:'image',data:'image bytes'},call]]){
  assert.equal(replyText(value),'');
 }
});
test('real replies retain their original text without tool arguments or hidden reasoning',()=>{
 assert.equal(replyText('**Hello**'),'**Hello**');
 assert.equal(replyText([{type:'text',text:'Checking now.'},{type:'toolCall',name:'bash',arguments:{command:'secret command'}},{type:'thinking',thinking:'hidden'},{type:'text',text:'Done.'}]),'Checking now.\nDone.');
 assert.equal(replyText([{type:'text',text:'  preserved whitespace\n'}]),'  preserved whitespace\n');
});
