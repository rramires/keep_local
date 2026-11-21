import test from 'node:test';
import assert from 'node:assert/strict';
import * as folderMerge from '../../js/folder-merge.js';
import {translateFor} from '../../js/i18n.js';
import {validateNote, UUID, MAX_NOTE_BYTES} from '../../js/note-model.js';

const NOW=Date.UTC(2026,10,20,12);
const id=number=>`1039c0be-aafd-4a21-8dd8-${String(number).padStart(12,'0')}`;
const fixture=(patch={})=>({
  id:id(1),type:'text',title:'Fictitious',content:'Original',createdAt:NOW-100,
  updatedAt:NOW-50,color:'default',pinned:false,labels:[],deletedAt:null,archivedAt:null,order:8,...patch,
});
const sides=notes=>({notes,records:notes.map(note=>({
  id:note.id,updatedAt:note.updatedAt,iv:'fixture',ciphertext:JSON.stringify(note),
}))});
const merge=(local,remote,options={})=>folderMerge.mergeVaults({
  local:sides(local),remote:sides(remote),now:NOW,...options,
});
const tombstone=(note,deletedAt)=>({id:note.id,deletedAt});
const state=({notes,records,tombstones})=>({notes,records,tombstones});
const wrap={fromRemote:0,deleted:0,conflicts:0,restored:0,keptEdited:0};

test('H2a.2 applies every per-note decision to the records for that ID',async()=>{
  const original=fixture();
  const base={[original.id]:original.updatedAt};
  const newer=fixture({content:'New',updatedAt:NOW-20});
  const older=fixture({content:'Old',updatedAt:NOW-80});
  const pinned=fixture({pinned:true,updatedAt:NOW-17});
  const deleted=tombstone(original,NOW-40);
  const cases=[
    {name:'identical',local:[original],remote:[original],expected:[original],stats:{}},
    {name:'only metadata changed',local:[original],remote:[pinned],expected:[pinned],stats:{fromRemote:1}},
    {name:'remote changed since the base',local:[original],remote:[newer],expected:[newer],stats:{fromRemote:1}},
    {name:'remote predates the base',local:[original],remote:[older],expected:[original],stats:{}},
    {name:'local changed since the base',local:[newer],remote:[original],expected:[newer],stats:{}},
    {name:'the only local note has no deletion marker',local:[original],remote:[],expected:[original],stats:{}},
    {name:'remote deletion of unchanged local',local:[original],remote:[],remoteTombstones:[deleted],expected:[],stats:{deleted:1}},
    {name:'local edit after remote deletion',local:[newer],remote:[],remoteTombstones:[deleted],expected:[newer],stats:{restored:1}},
    {name:'the only remote note has no deletion marker',local:[],remote:[original],expected:[original],stats:{fromRemote:1}},
    {name:'local deletion blocks reintroduction',local:[],remote:[original],localTombstones:[deleted],expected:[],stats:{}},
    {name:'remote edit after local deletion',local:[],remote:[newer],localTombstones:[deleted],expected:[newer],stats:{fromRemote:1,keptEdited:1}},
    {name:'union keeps latest marker per ID and prunes expired ones',local:[],remote:[],
      localTombstones:[tombstone(original,NOW-42),{id:id(8),deletedAt:NOW-366*86400000}],
      remoteTombstones:[deleted],expected:[],markers:[deleted],stats:{}},
  ];
  for(const {name,local,remote,expected,markers,stats,...options} of cases){
    const result=await merge(local,remote,{base,...options});
    assert.deepEqual(result.notes,expected,name);
    assert.deepEqual(result.records,sides(expected).records,name);
    assert.deepEqual(result.stats,{...wrap,...stats},name);
    assert.deepEqual(result.tombstones,markers??options.localTombstones??options.remoteTombstones??[],name);
  }
});

test('H2a.7c kept edits have plural notices in English and Brazilian Portuguese',()=>{
  const messages=folderMerge.folderMergeMessages({...wrap,keptEdited:2});
  assert.ok(messages.includes('2 notes you deleted were kept because they were edited on another computer.'));
  assert.equal(translateFor('pt-BR','folder.mergeKeptEditedPlural',{count:2}),
    '2 notas que você apagou foram mantidas porque foram editadas em outro computador.');
});

test('H2a.7c an unseen edit survives a permanent deletion in either direction',async()=>{
  const original=fixture();
  const edited=fixture({content:'An edit the deleting PC never saw',updatedAt:NOW-20});
  for(const base of [{[original.id]:original.updatedAt},{},undefined]){
    for(const when of [NOW-30,NOW-10]){
      const marker=tombstone(original,when);
      const atEditor=await merge([edited],[],{base,remoteTombstones:[marker]});
      const atDeleter=await merge([],[edited],{base,localTombstones:[marker]});
      assert.deepEqual(atEditor.notes,[edited]);
      assert.deepEqual(state(atEditor),state(atDeleter));
      assert.deepEqual(atEditor.stats,{...wrap,restored:1});
      assert.deepEqual(atDeleter.stats,{...wrap,fromRemote:1,keptEdited:1});
    }
  }
  const base={[original.id]:original.updatedAt};
  for(const unedited of [original,{...original,updatedAt:original.updatedAt-1}]){
    const marker=tombstone(original,NOW-30);
    assert.deepEqual((await merge([unedited],[],{base,remoteTombstones:[marker]})).notes,[]);
    assert.deepEqual((await merge([],[unedited],{base,localTombstones:[marker]})).notes,[]);
  }
});

test('H2a.2 conflict IDs, UTC titles and record reuse are deterministic and idempotent',async()=>{
  const older=fixture({content:'A',updatedAt:NOW-60_000});
  const newer=fixture({content:'B',updatedAt:NOW});
  const second=fixture({id:id(2)});
  for(const base of [undefined,{[older.id]:older.updatedAt-1}]){
    const result=await merge([second,older],[newer,second],{base});
    const copy=result.notes.find(note=>note.id!==id(1)&&note.id!==id(2));
    assert.match(copy.id,UUID);
    assert.equal(copy.title,'Fictitious (conflict 2026-11-20 11:59)');
    assert.equal(copy.content,older.content);
    assert.equal(copy.order,newer.order+1);
    assert.deepEqual(result.stats,{...wrap,fromRemote:1,conflicts:1});
    assert.deepEqual(result.records,sides([newer,second]).records);
    assert.deepEqual(state(await merge([older,second],[second,newer],{base})),state(result));
    assert.deepEqual(state(await merge([second,newer],[older,second],{base})),state(result));
    for(const knownRemote of [older,newer]){
      const repeated=await folderMerge.mergeVaults({
        local:sides(result.notes),remote:sides([knownRemote,second]),base,now:NOW,
      });
      assert.deepEqual(repeated.notes,result.notes);
      assert.deepEqual(repeated.records,sides(result.notes).records);
      assert.deepEqual(repeated.tombstones,result.tombstones);
      assert.equal(repeated.stats.conflicts,0);
    }
    const translated=await merge([older],[newer],{base,language:'pt-BR'});
    assert.equal(translated.notes.find(note=>note.id===copy.id).title,'Fictitious (conflito 2026-11-20 11:59)');
  }
  const sameTime={...newer,content:'Other at the same millisecond'};
  assert.deepEqual(state(await merge([newer],[sameTime])),state(await merge([sameTime],[newer])));
  const first=fixture({title:'x'.repeat(4096),content:'Y'});
  const limit=MAX_NOTE_BYTES-new TextEncoder().encode(JSON.stringify({...first,content:''})).length;
  const maxed={...first,content:'v'.repeat(limit)};
  const result=await merge([maxed],[newer]);
  const copy=result.notes.find(note=>note.id!==newer.id);
  assert.equal(copy.content,maxed.content);
  assert.match(copy.title,/ \(conflict /);
  for(const note of result.notes) assert.equal(validateNote(note),note);
});

test('H2a.7b uses only a common snapshot proven by the folder lineage',async()=>{
  const original=fixture();
  const local=fixture({content:'PC B edit',updatedAt:NOW-40});
  const remote=fixture({content:'PC A edit',updatedAt:NOW-30});
  const commonHash='4'.repeat(64),localHash='b'.repeat(64),remoteHash='a'.repeat(64);
  const commonVersions={[original.id]:original.updatedAt};
  const localVersions={[local.id]:local.updatedAt};
  const meta={folderSyncedHash:localHash,folderSyncedVersions:localVersions,
    folderSyncedBase:{hash:commonHash,versions:commonVersions}};
  assert.equal(folderMerge.baseForFolderHead(meta,{parent:localHash}),localVersions);
  assert.equal(folderMerge.baseForFolderHead(meta,{parent:commonHash}),commonVersions);
  assert.equal(folderMerge.baseForFolderHead(meta,{parent:remoteHash,payload:{ancestors:[remoteHash,localHash,commonHash]}}),localVersions);

  for(const ancestors of [[remoteHash,commonHash],[remoteHash],undefined]){
    const head={parent:remoteHash,payload:{ancestors}};
    const selected=folderMerge.baseForFolderHead(meta,head);
    assert.equal(selected,ancestors?.includes(commonHash)?commonVersions:undefined);
    const result=await merge([local],[remote],{base:selected});
    assert.deepEqual(result.notes.map(note=>note.content).sort(),[local.content,remote.content].sort());
    assert.equal(result.stats.conflicts,1);
  }

  const history=[...Array.from({length:31},(_,i)=>i.toString(16).padStart(64,'0')),localHash,commonHash];
  const {makePayload}=await import('../../js/backup-v2.js');
  const payload=makePayload([],{},35,remoteHash,[],history);
  assert.equal(payload.ancestors.length,32);
  assert.equal(folderMerge.baseForFolderHead(meta,{parent:remoteHash,payload}),undefined);
});

function seededRandom(seed){
  return bound=>{
    seed^=seed<<13;
    seed^=seed>>>17;
    seed^=seed<<5;
    return Math.floor((seed>>>0)*bound/2**32);
  };
}

test('H2a.7d seeded multi-note merges preserve edits and are symmetric and idempotent',async()=>{
  const random=seededRandom(0x4b4c2026);
  const actions=['keep','edit','metadata','trash','delete'];
  const schedules=new Set(),deletionOrders=new Set(),coveredActions=new Set();
  for(let round=0;round<6000;round++){
    const originals=Array.from({length:1+random(6)},(_,i)=>fixture({
      id:id(i+1),createdAt:NOW-2_000_000,updatedAt:NOW-1_000_000+random(1000),
    }));
    const choices=originals.map(note=>[0,1].map(()=>{
      const action=actions[random(actions.length)];
      coveredActions.add(action);
      return [action,action==='keep'?note.updatedAt:note.updatedAt+1+random(500_000)];
    }));
    schedules.add(JSON.stringify(choices));
    const makeSide=side=>{
      const notes=[],tombstones=[];
      for(const [index,original] of originals.entries()){
        const [action,at]=choices[index][side];
        if(action==='delete'){
          tombstones.push(tombstone(original,at));
          continue;
        }
        notes.push({...original,updatedAt:at,
          content:action==='edit'?`PC ${side} revised note ${index}`:original.content,
          pinned:action==='metadata'||original.pinned,
          deletedAt:action==='trash'?at:original.deletedAt});
      }
      return {notes,tombstones};
    };
    const left=makeSide(0),right=makeSide(1);
    const base=Object.fromEntries(originals.map(note=>[note.id,note.updatedAt]));
    const combine=(local,remote)=>merge(local.notes,remote.notes,{
      base,localTombstones:local.tombstones,remoteTombstones:remote.tombstones,
    });
    const context=`round ${round}: ${JSON.stringify(choices)}`;
    const result=await combine(left,right);
    for(const [index,pair] of choices.entries()){
      const edit=pair.find(([action])=>action==='edit');
      const deletion=pair.find(([action])=>action==='delete');
      if(edit&&deletion)deletionOrders.add(Math.sign(deletion[1]-edit[1]));
      for(const [side,[action]] of pair.entries()){
        if(action==='edit'){
          const content=`PC ${side} revised note ${index}`;
          assert.ok(result.notes.some(note=>note.content===content),`${context} lost ${content}`);
        }
      }
      if(deletion&&pair.every(([action])=>action==='delete'||action==='keep')){
        assert.ok(result.notes.every(note=>note.id!==originals[index].id),`${context} kept deleted note`);
      }
    }
    const sameResult=other=>{
      assert.deepEqual(other.notes,result.notes,context);
      assert.deepEqual(other.tombstones,result.tombstones,context);
    };
    sameResult(await combine(right,left));
    sameResult(await combine(result,left));
    sameResult(await combine(result,right));
    for(const note of result.notes)assert.equal(validateNote(note),note,context);
  }
  assert.ok(schedules.size>=5000,`${schedules.size} distinct schedules`);
  assert.ok(deletionOrders.has(-1)&&deletionOrders.has(1));
  assert.deepEqual(coveredActions,new Set(actions));
});

test('H2a.7d seeded folder lineages preserve divergent edits',async()=>{
  const random=seededRandom(0x5eed2026);
  const hash=value=>value.toString(16).padStart(64,'0');
  const seen=new Set();
  for(let round=0;round<512;round++){
    const original=fixture({updatedAt:NOW-2000});
    const local=fixture({content:'Edit on this PC',updatedAt:NOW-1000+random(999)});
    const remote=fixture({content:'Edit on the other PC',updatedAt:NOW-1000+random(999)});
    const commonHash=hash(round*64+33),localHash=hash(round*64+34);
    const commonVersions={[original.id]:original.updatedAt};
    const localVersions={[local.id]:local.updatedAt};
    const meta={folderSyncedHash:localHash,folderSyncedVersions:localVersions,
      folderSyncedBase:{hash:commonHash,versions:commonVersions}};
    const scenario=random(3);
    seen.add(scenario);
    const lineage=Array.from({length:1+random(30)},(_,i)=>hash(round*64+i));
    if(scenario<2)lineage.splice(random(lineage.length+1),0,scenario===0?localHash:commonHash);
    const head={parent:lineage[0],payload:{ancestors:lineage}};
    const base=folderMerge.baseForFolderHead(meta,head);
    assert.equal(base,[localVersions,commonVersions,undefined][scenario],`round ${round}`);
    if(scenario===0){
      const descendant={...remote,updatedAt:local.updatedAt+1};
      const result=await merge([local],[descendant],{base});
      assert.deepEqual(result.notes,[descendant],`round ${round}`);
      assert.equal(result.stats.conflicts,0);
    }else{
      const result=await merge([local],[remote],{base});
      assert.deepEqual(result.notes.map(note=>note.content).sort(),[local.content,remote.content].sort(),`round ${round}`);
      assert.equal(result.stats.conflicts,1);
    }
  }
  assert.deepEqual(seen,new Set([0,1,2]));
});
