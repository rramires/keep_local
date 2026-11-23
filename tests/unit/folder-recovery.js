import test from 'node:test';
import assert from 'node:assert/strict';
import * as versions from '../../js/folder-merge.js';
import {folderWriterState,descends} from '../../js/folder-clock.js';
import {decideFolderAction} from '../../js/folder-reconcile.js';
import {makePayload} from '../../js/backup-v2.js';

const NOW=Date.UTC(2026,10,21,12);
const uuid=index=>`f0190000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const records=notes=>notes.map(note=>({id:note.id,updatedAt:note.updatedAt,iv:'fixture',ciphertext:JSON.stringify(note)}));
const side=notes=>({notes,records:records(notes)});
const folder=head=>({head,candidates:[],divergent:false,otherSalt:[],unreadable:[],tooLarge:[]});

function scenario() {
  let sequence=1;
  const hash=()=>String(sequence++).padStart(64,'0');
  const root=count=>{
    const notes=Array.from({length:count},(_,index)=>({id:uuid(index+100),type:'text',title:`Fictitious ${index}`,
      content:'Original',createdAt:NOW-1000,updatedAt:NOW-1000,color:'default',pinned:false,labels:[],deletedAt:null,archivedAt:null,order:index}));
    return {hash:hash(),parent:null,rev:1,notes,payload:makePayload(records(notes),{},1,null,[],[],{[uuid(9)]:1})};
  };
  const pc=(index,file)=>({notes:structuredClone(file.notes),meta:{writerId:uuid(index),writerCount:0,
    revision:1,folderSyncedRevision:1,exportRev:file.rev,exportParent:file.hash,exportAncestors:file.payload.ancestors,
    exportClock:file.payload.clock,folderSyncedHash:file.hash,folderSyncedClock:file.payload.clock,
    folderSyncedVersions:versions.recordVersions(file.payload.notes),folderSeenRev:file.rev}});
  const edit=(pc,index,content)=>{
    pc.notes=pc.notes.map(note=>note.id===uuid(index+100)?{...note,content,updatedAt:NOW+sequence++}:note);
    pc.meta.revision++;
  };
  function commit(pc,file,mergedHeads=[]) {
    const state=versions.folderVersionState(pc.meta,file,{mergedHeads});
    pc.notes=structuredClone(file.notes);
    pc.meta={...pc.meta,...state,...folderWriterState(pc.meta,file.payload),exportRev:Math.max(pc.meta.exportRev,file.rev),
      exportParent:file.hash,exportAncestors:file.payload.ancestors,exportClock:file.payload.clock,
      folderSyncedHash:file.hash,folderSyncedClock:file.payload.clock,folderSyncedRevision:pc.meta.revision,
      folderSeenRev:Math.max(pc.meta.folderSeenRev,file.rev)};
    delete pc.meta.folderPendingWrite;
  }
  function write(pc,notes,head,replace) {
    const sources=head?[head]:[];
    const reservation=versions.reserveFolderVersion(pc.meta,records(pc.notes),sources,{replace});
    const clock=reservation.folderPendingWrite.clock;
    Object.assign(pc.meta,reservation);
    const parent=replace?head.hash:pc.meta.exportParent;
    const ancestors=replace?head.payload.ancestors:pc.meta.exportAncestors;
    const rev=Math.max(pc.meta.exportRev,pc.meta.folderSeenRev,head?.rev??0)+1;
    return {hash:hash(),parent,rev,notes:structuredClone(notes),payload:makePayload(records(notes),{},rev,parent,[],ancestors,clock)};
  }
  async function sync(pc,head,{close=false}={}) {
    const decision=decideFolderAction({notes:records(pc.notes),meta:pc.meta},folder(head));
    if(decision==='saved')return {file:head,decision,conflicts:0};
    if(decision==='pull'){
      if(!close)commit(pc,head);
      return {file:head,decision,conflicts:0};
    }
    if(decision==='push'){
      const file=write(pc,pc.notes,head,false);
      if(!close)commit(pc,file);
      return {file,decision,conflicts:0};
    }
    if(decision!=='merge')return {file:head,decision,conflicts:0};
    const merged=await versions.mergeVaults({local:side(pc.notes),remote:side(head.notes),
      base:versions.baseForFolderHead(pc.meta,head),now:NOW});
    const file=write(pc,merged.notes,head,true);
    if(!close)commit(pc,file,[head]);
    return {file,decision,conflicts:merged.stats.conflicts};
  }
  return {root,pc,edit,sync};
}

test('H2a.9a C1 pending local versions avoid a false copy after an interrupted unsaved merge',async()=>{
  const model=scenario(),root=model.root(2),a=model.pc(1,root),b=model.pc(2,root);
  model.edit(a,1,'A edited Y');
  const head=(await model.sync(a,root)).file;
  model.edit(b,0,'B first edit');
  const merged=(await model.sync(b,head,{close:true})).file;
  model.edit(b,0,'B second edit');
  const result=await model.sync(b,merged);
  assert.equal(result.conflicts,0);
  assert.deepEqual(b.notes.map(note=>note.content).sort(),['A edited Y','B second edit']);
});

for(const variant of ['C3a','C3b']){
  test(`H2a.9a ${variant} reserves unique writer counts and retains all three PCs' edits`,async()=>{
    const model=scenario(),root=model.root(3),a=model.pc(1,root),b=model.pc(2,root),c=model.pc(3,root);
    model.edit(b,0,'B x1');
    const first=(await model.sync(b,root,{close:true})).file;
    await model.sync(a,first);
    model.edit(c,1,'C z1');
    const other=(await model.sync(c,root)).file;
    model.edit(b,0,'B x2 after reopening');
    const second=(await model.sync(b,other)).file;
    if(variant==='C3a')model.edit(a,0,'A concurrent x');
    let head=(await model.sync(a,other)).file;
    if(variant==='C3b'){
      model.edit(a,2,'A another note');
      head=(await model.sync(a,head)).file;
    }
    const result=await model.sync(b,head);
    assert.ok(b.notes.some(note=>note.content==='B x2 after reopening'));
    assert.ok(b.notes.some(note=>note.content==='C z1'));
    assert.ok(second.payload.clock[uuid(2)]>first.payload.clock[uuid(2)]);
    assert.equal(descends(head,{hash:second.hash,clock:second.payload.clock}),false);
    if(variant==='C3a'){
      assert.ok(b.notes.some(note=>note.content==='A concurrent x'));
      assert.equal(result.conflicts,1);
    }else{
      assert.ok(b.notes.some(note=>note.content==='A another note'));
      assert.ok(result.conflicts<=1);
    }
  });
}

test('H2a.9b receipts retain joined heads before pending and older bases and reset explicit choices',()=>{
  const model=scenario(),root=model.root(2);
  const old={hash:'older',clock:{[uuid(1)]:1},versions:{old:1}};
  const pending={clock:{[uuid(1)]:2},versions:{pending:2}};
  const pc=model.pc(1,root);
  pc.meta.folderPendingWrite=pending;
  pc.meta.folderSyncedBase=old;
  const joined={...root,hash:'joined',payload:{...root.payload,clock:{[uuid(2)]:2}}};
  const file={...root,hash:'written'};
  const state=versions.folderVersionState(pc.meta,file,{mergedHeads:[joined,joined]});
  assert.deepEqual(state.folderSyncedBases,[
    {hash:file.hash,clock:file.payload.clock,versions:versions.recordVersions(file.payload.notes)},
    {hash:joined.hash,clock:joined.payload.clock,versions:versions.recordVersions(joined.payload.notes)},
    pending,{hash:root.hash,clock:root.payload.clock,versions:pc.meta.folderSyncedVersions},
  ]);
  assert.equal(Object.hasOwn(state,'folderSyncedBase'),false);
  const replaced=versions.folderVersionState(pc.meta,file,{resetBases:true});
  assert.deepEqual(replaced.folderSyncedBases,[
    {hash:file.hash,clock:file.payload.clock,versions:versions.recordVersions(file.payload.notes)},
  ]);
  const clock={clock:{[uuid(2)]:1,[uuid(1)]:1},versions:{first:1}};
  const duplicate={clock:{[uuid(1)]:1,[uuid(2)]:1},versions:{other:2}};
  assert.deepEqual(versions.retainFolderBases([clock,duplicate,old,pending,old,old,old,old]),[clock,old,pending]);
  assert.equal(versions.retainFolderBases(Array.from({length:8},(_,i)=>({hash:String(i),versions:{}}))).length,4);
});

test('H2a.9b an archived pending B2 precedes the older B1 receipt when current B3 is unproven',async()=>{
  const model=scenario(),root=model.root(1),item=root.notes[0];
  const local={...item,updatedAt:NOW+3,content:'B latest edit'};
  const remote={...item,updatedAt:NOW+2,content:'B intermediate edit'};
  const archived={clock:{[uuid(2)]:2},versions:{[item.id]:remote.updatedAt}};
  const meta={folderSyncedHash:'receipt',folderSyncedClock:{[uuid(2)]:1},
    folderSyncedVersions:{[item.id]:NOW+1},folderSyncedBases:[archived],
    folderPendingWrite:{clock:{[uuid(2)]:3},versions:{[item.id]:local.updatedAt}}};
  const head={...root,hash:'head',payload:{...root.payload,clock:archived.clock,notes:records([remote])}};
  const base=versions.baseForFolderHead(meta,head);
  assert.equal(base,archived.versions);
  const merged=await versions.mergeVaults({local:side([local]),remote:side([remote]),base,now:NOW});
  assert.equal(merged.stats.conflicts,0);
  assert.deepEqual(merged.notes.map(note=>note.content),['B latest edit']);
});

test('P1.0 four normal writes retain four distinct hashed receipts',async()=>{
  const model=scenario();
  let head=model.root(1);
  const pc=model.pc(1,head),hashes=[];
  for(let write=0;write<4;write++){
    model.edit(pc,0,`Fictional edit ${write}`);
    const result=await model.sync(pc,head);
    assert.equal(result.decision,'push');
    head=result.file;
    hashes.unshift(head.hash);
  }
  assert.deepEqual(pc.meta.folderSyncedBases.map(base=>base.hash),hashes);
});

test('P1.0 matching nonempty clocks remove an archived pending base in either order',()=>{
  const receipt={hash:'receipt',clock:{[uuid(1)]:3,[uuid(2)]:2},versions:{a:2}};
  const pending={clock:{[uuid(2)]:2,[uuid(1)]:3},versions:{a:1}};
  const unmatched={clock:{[uuid(1)]:4},versions:{a:3}};
  const legacy={hash:'legacy',clock:{},versions:{a:0}};
  for(const pair of [[pending,receipt],[receipt,pending]]){
    assert.deepEqual(versions.retainFolderBases([...pair,unmatched,legacy]),[receipt,unmatched,legacy]);
  }
  const head={hash:'head',payload:{clock:receipt.clock}};
  assert.equal(versions.baseForFolderHead({folderPendingWrite:pending,folderSyncedBases:[receipt]},head),pending.versions);
});

test('P1-N1 four hashless bases with no clock cannot displace a hashed receipt',()=>{
  const empty=Array.from({length:4},(_,index)=>({clock:{},versions:{[uuid(index)]:index}}));
  const receipt={hash:'legacy-receipt',clock:{},versions:{[uuid(4)]:4}};
  assert.deepEqual(versions.retainFolderBases([...empty,receipt]),[receipt]);
});

for(const closes of [false,true]){
  test(`H2a.9b C5 600 disjoint schedules retain every edit without copies ${closes?'with':'without'} interrupted writes`,async t=>{
    let seed=0x0c10c4a8+Number(closes);
    const random=limit=>{
      seed=(Math.imul(seed,1103515245)+12345)>>>0;
      return (seed>>>8)%limit;
    };
    const totals={sequences:600,steps:40,closes:0,drops:0,merges:0,pulls:0,reviews:0,conflicts:0,copies:0,losses:0};
    for(let sequence=0;sequence<totals.sequences;sequence++){
      const model=scenario(),count=2+random(2),root=model.root(count);
      const computers=Array.from({length:count},(_,index)=>model.pc(index+1,root));
      const latest=new Map();
      let published=root;
      async function cycle(index,head,mayClose=true) {
        const close=mayClose&&closes&&random(6)===0;
        const result=await model.sync(computers[index],head,{close});
        totals.conflicts+=result.conflicts;
        if(close)totals.closes++;
        if(result.decision==='merge')totals.merges++;
        if(result.decision==='pull')totals.pulls++;
        if(['rollback','conflict'].includes(result.decision))totals.reviews++;
        return result.file===head?null:result.file;
      }
      for(let step=0;step<totals.steps;step++){
        const operation=random(10);
        if(operation<4){
          const index=random(count),content=`PC ${index} step ${step}`;
          model.edit(computers[index],index,content);
          latest.set(index,content);
        }else if(operation<8){
          published=await cycle(random(count),published)??published;
        }else{
          const first=random(count),second=(first+1+random(count-1))%count;
          const shared=published;
          const writes=[await cycle(first,shared),await cycle(second,shared)].filter(Boolean);
          if(writes.length===2)totals.drops++;
          if(writes.length)published=writes[random(writes.length)];
        }
      }
      for(let round=0;round<6;round++){
        for(let index=0;index<count;index++)published=await cycle(index,published,false)??published;
      }
      for(const computer of computers){
        totals.copies+=Math.max(0,computer.notes.length-count);
        for(const [index,content] of latest){
          if(!computer.notes.some(note=>note.id===uuid(index+100)&&note.content===content))totals.losses++;
        }
      }
    }
    t.diagnostic(JSON.stringify(totals));
    assert.equal(totals.losses,0);
    assert.equal(totals.copies,0);
    assert.equal(totals.conflicts,0);
    assert.ok(totals.drops>0&&totals.merges>0&&totals.pulls>0);
    if(closes)assert.ok(totals.closes>0);
  });
}
