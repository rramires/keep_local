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
