import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatFollow} from '../apps/mobile/chat-follow.js';

test('stream growth stays pinned until the reader deliberately scrolls away',()=>{
 const follow=new ChatFollow();
 follow.scroll(0,2000,600);assert.equal(follow.following,true,'programmatic/content changes must not unpin');
 follow.begin();follow.scroll(1000,2000,600);follow.end();
 assert.equal(follow.following,false,'reading older text pauses following');
 follow.scroll(1000,3000,600);assert.equal(follow.following,false);
 follow.begin();follow.scroll(2350,3000,600);follow.end();
 assert.equal(follow.following,false,'scrolling a few lines up must not snap back to the bottom');
 follow.begin();follow.scroll(2395,3000,600);follow.end();
 assert.equal(follow.following,true,'returning to the bottom resumes streaming follow');
 follow.scroll(2395,4000,600);assert.equal(follow.following,true);
});

test('new conversation follow state is independent of parent and child readers',()=>{
 const parent=new ChatFollow(),child=new ChatFollow();
 parent.begin();parent.scroll(0,2000,600);parent.end();
 assert.equal(parent.following,false);assert.equal(child.following,true);
 assert.equal(new ChatFollow().following,true);
});
