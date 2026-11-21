import test from 'node:test';
import assert from 'node:assert/strict';
import * as folderMerge from '../../js/folder-merge.js';
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
const wrap={fromRemote:0,deleted:0,conflicts:0,restored:0};

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
    {name:'remote edit after local deletion',local:[],remote:[newer],localTombstones:[deleted],expected:[newer],stats:{fromRemote:1}},
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

test('H2a.2 seeded fuzz retains edited versions, removes permanent deletions and stays valid',async()=>{
  let seed=0x4b4c2026;
  const random=bound=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return ((seed>>>16)*bound)>>>16;
  };
  for(let round=0;round<5000;round++){
    const original=fixture({updatedAt:NOW-300_000});
    const base={[original.id]:original.updatedAt};
    const commands=['unchanged','edit','trash','delete'];
    const [left,right]=[commands[random(4)],commands[random(4)]];
    const version=(command,side)=>command==='delete'?[]:[{
      ...original,updatedAt:command==='unchanged'?original.updatedAt:NOW-10+side,
      content:command==='edit'?`Changed by PC ${side} in round ${round}`:original.content,
      deletedAt:command==='trash'?NOW-10+side:null,
    }];
    const local=version(left,0),remote=version(right,1);
    const markers=command=>command==='delete'?[tombstone(original,NOW-20)]:[];
    const result=await merge(local,remote,{base,localTombstones:markers(left),remoteTombstones:markers(right)});
    for(const command of ['edit','trash']){
      const versions=[...left===command?local:[],...right===command?remote:[]];
      for(const changed of versions){
        if(command==='trash'&&versions.some(note=>note.updatedAt>changed.updatedAt))continue;
        if(command==='trash'&&[left,right].includes('edit'))continue;
        assert.ok(result.notes.some(note=>note.content===changed.content&&note.deletedAt===changed.deletedAt),
          `${round} ${left}/${right}`);
      }
    }
    if([left,right].includes('delete')&&[left,right].every(action=>['delete','unchanged'].includes(action))){
      assert.equal(result.notes.length,0,`${round} ${left}/${right}`);
    }
    for(const note of result.notes) assert.equal(validateNote(note),note);
  }
});
