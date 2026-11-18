import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoteWriteQueue,editorFields} from '../../js/note-write-queue.js';
import {serialQueue} from '../../js/edit-session.js';
const actions=[n=>n.pinned=!n.pinned,n=>n.color='coral',n=>n.archivedAt=17,n=>n.deletedAt=19,n=>n.labels=n.labels.includes('Work')?[]:['Work']];
const fixture=type=>({id:'fictitious',type,updatedAt:1,title:'before',content:'body',tasks:[{id:'task',text:'before'}],pinned:false,color:'default',archivedAt:null,deletedAt:null,labels:[]});
async function tickUntil(predicate){for(let i=0;i<1000;i++){if(predicate())return;await Promise.resolve();}assert.fail('controlled promise did not reach its barrier');}
function harness(type){let memory=fixture(type),db=structuredClone(memory),clock=1,generation=1;const held=[];let fail=false;
 const write=createNoteWriteQueue({enqueue:serialQueue(),read:()=>memory,version:()=>memory?.updatedAt,session:()=>generation,persist:async next=>{await new Promise(resolve=>held.push(resolve));if(fail)throw Error('injected');next.updatedAt=++clock;db=structuredClone(next);return next;},publish:next=>{memory=next;}});
 return {write,held,get memory(){return memory;},get db(){return db;},fail:()=>fail=true,remote:()=>{memory={...memory,updatedAt:99};db=structuredClone(memory);},end:()=>generation++,release:async()=>{await tickUntil(()=>held.length>0);held.shift()();}};
}
test('T2.20 controlled action/editor orders preserve metadata and owned fields',async()=>{
 for(const action of actions)for(const field of ['title','content','tasks'])for(const first of ['action','editor']){
  const h=harness(field==='tasks'?'todo':'text'),source=structuredClone(h.memory),draft=structuredClone(source);draft[field]=field==='tasks'?[{id:'task',text:'edited'}]:'edited';
  const a=()=>h.write(source,{change:action}),e=()=>h.write(draft,{fields:editorFields(draft)}),pending=first==='action'?[a(),e()]:[e(),a()];
  const expected=structuredClone(source);action(expected);for(const name of editorFields(draft))expected[name]=structuredClone(draft[name]);
  await h.release();await h.release();await Promise.all(pending);expected.updatedAt=h.memory.updatedAt;assert.deepEqual(h.memory,expected);assert.deepEqual(h.memory,h.db);
 }
});
test('T2.20 5000 seeded interleavings keep committed memory and database equal',async()=>{
 let seed=0x4b4c202c;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let run=0;run<5000;run++){
  const h=harness(random()<0.5?'text':'todo'),source=structuredClone(h.memory),expected=structuredClone(source),pending=[];const count=2+Math.floor(random()*5);
  for(let i=0;i<count;i++){
   if(random()<0.5){const action=actions[Math.floor(random()*actions.length)];pending.push(h.write(source,{change:action}));action(expected);}
   else{const draft=structuredClone(source);draft.title='title-'+run+'-'+i;if(draft.type==='text')draft.content='body-'+i;else draft.tasks=[{id:'task',text:'task-'+i}];pending.push(h.write(draft,{fields:editorFields(draft)}));for(const field of editorFields(draft))expected[field]=structuredClone(draft[field]);}
   for(let j=0;j<Math.floor(random()*4);j++)await Promise.resolve();
  }
  for(let i=0;i<count;i++)await h.release();await Promise.all(pending);expected.updatedAt=h.memory.updatedAt;assert.deepEqual(h.memory,expected,'seeded run '+run);assert.deepEqual(h.memory,h.db,'seeded run '+run);
 }
});
test('T2.20 failed persistence never publishes speculative state',async()=>{const h=harness('text'),before=structuredClone(h.memory);h.fail();const promise=h.write(h.memory,{change:actions[0]});const check=assert.rejects(promise,/injected/);await h.release();await check;assert.deepEqual(h.memory,before);assert.deepEqual(h.db,before);});
test('T2.20 remote versions and ended sessions do not rebase as local writes',async()=>{const h=harness('text'),source=structuredClone(h.memory);h.remote();await assert.rejects(h.write(source,{change:actions[0]}),{code:'note.conflict'});const current=structuredClone(h.memory),promise=h.write(current,{change:actions[0]});h.end();await assert.rejects(promise,{code:'session.ended'});assert.deepEqual(h.memory,h.db);});

import {replaceExistingNotes} from '../../js/note-actions.js';
test('T2.23 collective publication rejects missing targets without an array -1 property',()=>{
 const before=[{id:'first',labels:['Work']}],plans=[{next:{id:'missing',labels:[]}}];assert.throws(()=>replaceExistingNotes(before,plans),{code:'note.conflict'});assert.deepEqual(before,[{id:'first',labels:['Work']}]);assert.equal(Object.hasOwn(before,'-1'),false);
 const updated=replaceExistingNotes(before,[{next:{id:'first',labels:[]}}]);assert.deepEqual(updated,[{id:'first',labels:[]}]);assert.deepEqual(before,[{id:'first',labels:['Work']}]);
});
