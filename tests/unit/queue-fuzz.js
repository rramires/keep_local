import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoteWriteQueue,editorFields} from '../../js/note-write-queue.js';
import {serialQueue} from '../../js/edit-session.js';
// Derived from the independent review's fixed-seed real-queue probe.
// Local seeds: 1,2,3,0xdeadbeef,0x4b4c202c,12345; remote: 7,8,9,0xfeedface.
test('T2.27 40000 seeded schedules release writes during submission and guard remote interleavings',async()=>{
const started=performance.now();
const actions=[n=>{n.pinned=!n.pinned},n=>{n.color=n.color==='coral'?'mint':'coral'},n=>{n.archivedAt=n.archivedAt?null:17},n=>{n.deletedAt=n.deletedAt?null:19},n=>{n.labels=n.labels.includes('Work')?[]:['Work']}];
const fixture=type=>({id:'x',type,updatedAt:1,title:'t0',content:'c0',tasks:[{id:'k',text:'k0'}],pinned:false,color:'default',archivedAt:null,deletedAt:null,labels:[]});
// Fixtures contain scalars, string labels and flat task objects. Clone that shape
// explicitly here; the real writer still executes its own structuredClone calls.
const cloneNote=n=>({...n,labels:[...n.labels],tasks:n.tasks.map(task=>({...task}))});
const rng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const flush=async(n)=>{for(let i=0;i<n;i++)await Promise.resolve();};
function make(type,withGuard){
  let memory=fixture(type),db=cloneNote(memory),clock=1,gen=1;const held=[],enqueue=serialQueue();
  const write=createNoteWriteQueue({enqueue,read:()=>memory,version:()=>memory?.updatedAt,session:()=>gen,
    persist:async(next,{known})=>{await new Promise(r=>held.push(r));
      if(withGuard&&db.updatedAt!==known)throw Object.assign(Error('db conflict'),{code:'note.conflict'});
      next.updatedAt=++clock;db=cloneNote(next);return next;},
    publish:n=>{memory=n;}});
  return {write,held,get memory(){return memory;},get db(){return db;},
    remote(patch){clock+=1000;memory={...memory,...patch,updatedAt:++clock};db=cloneNote(memory);return memory.updatedAt;},
    refresh(){if(db.updatedAt>memory.updatedAt)memory=cloneNote(db);},
    async releaseOne(){for(let i=0;i<50&&!held.length&&enqueue.has('x');i++)await Promise.resolve();if(held.length)held.shift()();}};
}
// ---- (A) local only, releases between submissions ----
let failA=0;
for(const seed of [1,2,3,0xdeadbeef,0x4b4c202c,12345]){
  const r=rng(seed);
  for(let run=0;run<4000;run++){
    const h=make(r()<.5?'text':'todo',false),expected=cloneNote(h.memory),pend=[];const count=2+Math.floor(r()*6);let unexpected=0;
    for(let i=0;i<count;i++){
      if(r()<.5){const a=actions[Math.floor(r()*actions.length)];pend.push(h.write(cloneNote(h.memory),{change:a}).catch(()=>{unexpected++}));a(expected);}
      else{const d=cloneNote(h.memory);d.title='T'+run+'-'+i; if(d.type==='text')d.content='C'+i;else d.tasks=[{id:'k',text:'K'+i}];
        // Capture the draft at submission; it may lag behind pending local writes.
        pend.push(h.write(d,{fields:editorFields(d)}).catch(()=>{unexpected++}));for(const f of editorFields(d))expected[f]=f==='tasks'?d.tasks.map(task=>({...task})):d[f];}
      await flush(Math.floor(r()*4)); if(r()<.4)await h.releaseOne();
    }
    let completed=0;const waiting=pend.map(p=>p.finally(()=>completed++));for(let k=0;k<200&&completed<pend.length;k++){await h.releaseOne();await flush(2);}assert.equal(completed,pend.length,'all local writes settle');
    await Promise.all(waiting);expected.updatedAt=h.memory.updatedAt;
    if(unexpected||JSON.stringify(h.memory)!==JSON.stringify(expected)||JSON.stringify(h.memory)!==JSON.stringify(h.db)){failA++;if(failA<3)console.log('FAIL A',{seed,run,memory:h.memory,expected});}
  }
}
assert.equal(failA,0,'24,000 local schedules: memory = database = sequential fold');
// ---- (B) random remote changes with a simulated database guard ----
let failB=0,conflicts=0,commitsAfterRemoteFromBefore=0;
for(const seed of [7,8,9,0xfeedface]){
  const r=rng(seed);
  for(let run=0;run<4000;run++){
    const h=make('text',true);const results=[];let remoteV=null;let idx=0;const count=3+Math.floor(r()*5);const remoteAt=Math.floor(r()*count);
    const pend=[];
    for(let i=0;i<count;i++){
      if(i===remoteAt)remoteV=h.remote({title:'REMOTE',color:'mint',pinned:true});
      const mine=idx++;
      const a=actions[Math.floor(r()*actions.length)];
      const base=cloneNote(h.memory);
      const p=(r()<.5?h.write(base,{change:a}):h.write(Object.assign(cloneNote(base),{title:'E'+mine}),{fields:editorFields(base)}))
        .then(n=>results.push({mine,ok:true,v:n.updatedAt,before:i<remoteAt}),e=>{conflicts++;results.push({mine,ok:false,code:e.code,before:i<remoteAt});});
      pend.push(p);await flush(Math.floor(r()*3));if(r()<.4)await h.releaseOne();
    }
    let completed=0;const waiting=pend.map(p=>p.finally(()=>completed++));for(let k=0;k<200&&completed<pend.length;k++){await h.releaseOne();await flush(2);}assert.equal(completed,pend.length,'all remote writes settle');
    await Promise.all(waiting);
    // A pre-remote submission must never commit with a post-remote version.
    h.refresh();const bad=results.filter(x=>x.before&&x.ok&&x.v>remoteV);
    commitsAfterRemoteFromBefore+=bad.length;
    if(bad.length||h.db.updatedAt<remoteV||JSON.stringify(h.memory)!==JSON.stringify(h.db)){failB++;if(failB<3)console.log('FAIL B',{seed,run,bad,memory:h.memory,db:h.db});}
  }
}
assert.equal(failB,0,'16,000 remote schedules preserve the remote version and refresh parity');assert.equal(commitsAfterRemoteFromBefore,0,'pre-remote submissions never commit on top of a remote version');
assert.ok(conflicts>0);const elapsed=performance.now()-started;console.log(JSON.stringify({local:24000,remote:16000,failA,failB,conflicts,commitsAfterRemoteFromBefore,elapsedMs:Math.round(elapsed)}));assert.ok(elapsed<10000,'queue fuzz completes in less than ten seconds');

});
