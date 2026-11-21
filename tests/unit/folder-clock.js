import test from 'node:test';
import assert from 'node:assert/strict';
import * as clock from '../../js/folder-clock.js';
import {baseForFolderHead,folderVersionState,mergeVaults,recordVersions} from '../../js/folder-merge.js';
import {decideFolderAction} from '../../js/folder-reconcile.js';
import {makePayload} from '../../js/backup-v2.js';
import {validateNote} from '../../js/note-model.js';

const writer=index=>`f01d0000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const hash=index=>index.toString(16).padStart(64,'0');
const a=writer(1),b=writer(2),c=writer(3);
const head=(value={})=>({hash:hash(10),parent:null,payload:{notes:[],ancestors:[],clock:{},...value}});
const folderState=head=>({head,candidates:[],divergent:false,otherSalt:[],unreadable:[],tooLarge:[]});

test('H2a.8c descent requires a hash link or a nonempty clock dominated in every entry',()=>{
  const current=head({clock:{[a]:5,[b]:2}});
  assert.equal(clock.descends(current,{hash:current.hash}),true);
  assert.equal(clock.descends(current,{clock:{[a]:5,[b]:2}}),true);
  assert.equal(clock.descends(current,{clock:{[a]:4,[b]:1}}),true);
  assert.equal(clock.descends(current,{clock:{[a]:6}}),false);
  assert.equal(clock.descends(current,{clock:{[c]:1}}),false);
  assert.equal(clock.descends(current,{clock:{}}),false);
  assert.equal(clock.descends(current,{hash:hash(1)}),false);
  assert.equal(clock.descends(head(),{clock:{[a]:1}}),false);
  assert.equal(clock.descends({...head(),parent:hash(1)},{hash:hash(1)}),true);
  assert.equal(clock.descends(head({ancestors:[hash(1)]}),{hash:hash(1)}),true);
});

test('H2a.8c clocks choose the newest proven base and gate direct pulls',()=>{
  const current={...head({clock:{[a]:100,[b]:4}}),rev:102};
  const versions={[writer(10)]:10};
  const base={hash:hash(2),clock:{[a]:1},versions:{[writer(10)]:1}};
  const meta={revision:7,folderSyncedRevision:7,folderSeenRev:3,folderSyncedHash:hash(3),
    folderSyncedVersions:versions,folderSyncedClock:{[a]:2,[b]:4},folderSyncedBase:base};
  assert.equal(baseForFolderHead(meta,current),versions);
  assert.deepEqual(folderVersionState(meta,current).folderSyncedBases[1],
    {hash:meta.folderSyncedHash,clock:meta.folderSyncedClock,versions});
  const state=folderState(current),snapshot={notes:[],meta};
  assert.equal(decideFolderAction(snapshot,state),'pull');
  assert.equal(decideFolderAction({...snapshot,meta:{...meta,revision:8}},state),'merge');
  assert.equal(decideFolderAction(snapshot,{...state,divergent:true}),'merge');
  assert.equal(decideFolderAction({...snapshot,meta:{...meta,folderSeenRev:103}},state),'rollback');
  const branch={...current,payload:{...current.payload,clock:{[a]:100}}};
  assert.equal(baseForFolderHead(meta,branch),base.versions);
  assert.equal(decideFolderAction(snapshot,folderState(branch)),'merge');
  const unknown={...current,payload:{...current.payload,clock:{[c]:2}}};
  assert.equal(baseForFolderHead(meta,unknown),undefined);
  assert.equal(baseForFolderHead({...meta,folderSyncedClock:{},folderSyncedBase:null},current),undefined);
});

test('H2a.8c counters resume from every observed source and never overflow or mutate inputs',()=>{
  const meta={writerId:a,writerCount:7,exportClock:{[a]:4,[b]:2}};
  const heads=[head({clock:{[a]:10,[c]:3}}),head({clock:{[a]:9,[b]:8}})];
  const before=JSON.stringify([meta,heads]);
  assert.deepEqual(clock.nextFolderClock(meta,heads),{[a]:11,[b]:2});
  assert.deepEqual(clock.nextFolderClock(meta,heads,{replace:true}),{[a]:11,[b]:8,[c]:3});
  assert.deepEqual(clock.nextFolderClock({...meta,writerCount:15},heads),{[a]:16,[b]:2});
  assert.deepEqual(clock.folderWriterState(meta,head({clock:{[a]:10}}).payload),{writerCount:10});
  assert.deepEqual(clock.folderWriterState(meta,head().payload),{writerCount:7});
  assert.equal(JSON.stringify([meta,heads]),before);
  assert.throws(()=>clock.nextFolderClock({...meta,writerCount:Number.MAX_SAFE_INTEGER}),/backup.invalidFile/);
  const full=Object.fromEntries(Array.from({length:64},(_,i)=>[writer(100+i),1]));
  assert.throws(()=>clock.nextFolderClock({writerId:a,exportClock:full}),/backup.invalidFile/);
});

function randomSource(seed) {
  return bound=>{
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    return Math.floor((seed>>>0)*bound/2**32);
  };
}

const NOW=Date.UTC(2026,10,21,12);
const fixture=index=>({id:writer(index+20),type:'text',title:`Fictitious ${index}`,content:'Original',
  createdAt:NOW-100000,updatedAt:NOW-100000,color:'default',pinned:false,labels:[],deletedAt:null,archivedAt:null,order:index});
const side=notes=>({notes,records:notes.map(note=>({id:note.id,updatedAt:note.updatedAt,iv:'fixture',ciphertext:JSON.stringify(note)}))});

test('H2a.8c seeded sequences retain edits across dropped writes, pulls, merges and long gaps',async()=>{
  const random=randomSource(0x4b4c2028);
  const evidence={pulls:0,merges:0,dropped:0,twoPCs:0,threePCs:0,longest:0};
  let serial=100;
  for(let sequence=0;sequence<240;sequence++){
    const count=2+random(2),overlap=sequence%2===1;
    evidence[count===2?'twoPCs':'threePCs']++;
    const originals=Array.from({length:count},(_,i)=>fixture(i));
    const root={hash:hash(serial++),parent:null,rev:1,
      payload:makePayload(side(originals).records,{},1,null,[],[],{[a]:1}),notes:originals};
    const nodes=Array.from({length:count},(_,index)=>({notes:structuredClone(originals),meta:{
      writerId:writer(index+1),writerCount:index===0?1:0,revision:1,folderSyncedRevision:1,
      exportRev:1,exportParent:root.hash,exportAncestors:root.payload.ancestors,exportClock:root.payload.clock,
      folderSyncedHash:root.hash,folderSyncedClock:root.payload.clock,folderSyncedVersions:recordVersions(root.payload.notes),
      folderSyncedBase:null,folderSeenRev:1,
    },folder:root}));
    let published=root;
    const commit=(node,file)=>{
      const versionState=folderVersionState(node.meta,file);
      node.notes=structuredClone(file.notes);
      node.folder=file;
      node.meta={...node.meta,...versionState,...clock.folderWriterState(node.meta,file.payload),
        exportRev:Math.max(node.meta.exportRev,file.rev),exportParent:file.hash,exportAncestors:file.payload.ancestors,
        exportClock:file.payload.clock,folderSyncedHash:file.hash,folderSyncedClock:file.payload.clock,
        folderSyncedRevision:node.meta.revision,folderSeenRev:Math.max(node.meta.folderSeenRev,file.rev)};
    };
    const write=(node,notes,{replace=false,sources=[node.folder]}={})=>{
      const next=clock.nextFolderClock(node.meta,sources,{replace});
      const parent=replace?sources[0]:{hash:node.meta.exportParent,payload:{ancestors:node.meta.exportAncestors}};
      const rev=Math.max(node.meta.exportRev,...sources.map(file=>file.rev))+1;
      const payload=makePayload(side(notes).records,{},rev,parent.hash,[],parent.payload.ancestors,next);
      const file={hash:hash(serial++),rev,parent:parent.hash,payload,notes};
      commit(node,file);
      return file;
    };
    const edit=(node,index,text)=>{
      const item=node.notes.find(note=>note.id===originals[index].id);
      node.notes=node.notes.map(note=>note===item?{...note,content:text,updatedAt:NOW+serial++}:note);
      node.meta.revision++;
    };
    const reconcile=async(node,file)=>{
      node.folder=file;
      const snapshot={notes:side(node.notes).records,meta:node.meta};
      const decision=decideFolderAction(snapshot,folderState(file));
      if(decision==='saved')return file;
      if(decision==='pull'){
        evidence.pulls++;
        commit(node,file);
        return file;
      }
      evidence.merges++;
      const merged=await mergeVaults({local:side(node.notes),remote:side(file.notes),
        base:baseForFolderHead(node.meta,file),now:NOW+serial});
      if(!overlap)assert.equal(merged.stats.conflicts,0,`false conflict in sequence ${sequence}`);
      if(JSON.stringify(merged.notes)===JSON.stringify(file.notes)){
        commit(node,file);
        return file;
      }
      return write(node,merged.notes,{replace:true,sources:[file]});
    };

    const burst=34+random(68);
    evidence.longest=Math.max(evidence.longest,burst);
    for(let index=0;index<burst;index++){
      edit(nodes[0],0,`PC 0 burst ${index}`);
      published=write(nodes[0],nodes[0].notes);
    }
    // These PCs were closed throughout the burst and have no competing edit.
    for(const node of nodes.slice(1)){
      const decision=decideFolderAction({notes:side(node.notes).records,meta:node.meta},folderState(published));
      assert.equal(decision,'pull',`long-gap sequence ${sequence}`);
      published=await reconcile(node,published);
    }
    const expected=new Set();
    for(const [index,node] of nodes.entries()){
      const target=overlap?0:index;
      const text=`PC ${index} final edit in sequence ${sequence}`;
      expected.add(text);
      edit(node,target,text);
      const file=write(node,node.notes);
      if(random(2))published=file;
      else evidence.dropped++;
    }
    // Explicit review is simulated when the delivered head is an older revision.
    for(let pass=0;pass<3;pass++){
      for(const node of nodes)published=await reconcile(node,published);
    }
    for(const node of nodes){
      for(const text of expected)assert.ok(node.notes.some(note=>note.content===text),`lost ${text}`);
      if(!overlap)assert.equal(node.notes.length,originals.length,`false copy in sequence ${sequence}`);
      for(const note of node.notes)assert.equal(validateNote(note),note);
    }
  }
  assert.ok(evidence.pulls>0&&evidence.merges>0&&evidence.dropped>0);
  assert.ok(evidence.twoPCs>0&&evidence.threePCs>0&&evidence.longest>=100);
});
