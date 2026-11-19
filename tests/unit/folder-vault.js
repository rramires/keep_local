import test from 'node:test';
import assert from 'node:assert/strict';
import * as vault from '../../js/folder-vault.js';
import {deriveKey,generateSalt,arrayToBase64} from '../../js/crypto.js';
import {encodeV2,makePayload} from '../../js/backup-v2.js';
import {MAX_BACKUP_BYTES} from '../../js/backup-format.js';

const dir=files=>({
  async *entries(){for(const [name,file] of Object.entries(files))yield [name,{kind:'file',getFile:async()=>file}];},
});

test('G1 strict session-key decoding preserves profile 2 and caps candidate reads',async()=>{
  const salt=generateSalt(),key=await deriveKey('fictional test vault phrase',salt);
  const bytes=await encodeV2(key,salt,makePayload([],{},11));
  const own=arrayToBase64(salt);
  const good=await vault.decodeV2WithKey(bytes,key,own);
  assert.equal(good.status,'valid');
  assert.equal(good.rev,11);
  assert.equal(good.payload.profile,2);
  assert.equal((await vault.decodeV2WithKey(bytes,key,arrayToBase64(generateSalt()))).status,'otherSalt');
  const bad=await encodeV2(key,salt,makePayload([{id:'invalid',iv:'',ciphertext:'',updatedAt:0}],{},12));
  assert.equal((await vault.decodeV2WithKey(bad,key,own)).status,'unreadable');
  const oversized={size:MAX_BACKUP_BYTES+1,arrayBuffer(){assert.fail('oversized file read');}};
  const file=new Blob([bytes]);
  const state=await vault.readFolderState(dir({['desktop.ini']:oversized,['big.keeplocal']:oversized,['head.keeplocal']:file}),key,own);
  assert.deepEqual(state.tooLarge,['big.keeplocal']);
  assert.equal(state.head.hash,good.hash);
  const extra=await vault.listCandidates(dir(Object.fromEntries(Array.from({length:33},(_,i)=>[i+'.keeplocal',file]))));
  assert.equal(extra.entries.length,32);
  assert.equal(extra.limitExceeded,true);
});

test('G3 reconciliation distinguishes dirty data, previous revisions and foreign copies',async()=>{
  const {decideFolderAction}=await import('../../js/folder-reconcile.js');
  const one={id:'one',iv:'iv',ciphertext:'cipher',updatedAt:42};
  const two={...one,id:'two'};
  const head={hash:'head',rev:3,payload:{notes:[one,two]}};
  const state={head,candidates:[{name:'keeplocal-vault.keeplocal',status:'valid'}],divergent:false,otherSalt:[],unreadable:[],tooLarge:[]};
  const clean={notes:[{}],meta:{revision:4,folderSyncedRevision:4,folderSeenRev:2,folderSyncedHash:'prior'}};
  assert.equal(decideFolderAction(clean,state),'pull');
  assert.equal(decideFolderAction({...clean,meta:{...clean.meta,revision:5}},state),'conflict');
  assert.equal(decideFolderAction({...clean,meta:{...clean.meta,folderSeenRev:4}},state),'rollback');
  assert.equal(decideFolderAction(clean,{...state,divergent:true}),'conflict');
  assert.equal(decideFolderAction({notes:[],meta:{}},state),'pull');
  assert.equal(decideFolderAction({notes:[two,one],meta:{}},state),'adopt');
  for(const field of ['id','iv','ciphertext','updatedAt']){
    assert.equal(decideFolderAction({notes:[two,{...one,[field]:'different'}],meta:{}},state),'conflict');
  }
  assert.equal(decideFolderAction({notes:[{}],meta:{}},state),'conflict');
  assert.equal(decideFolderAction(clean,{...state,head:null,candidates:[]}), 'push');
  assert.equal(decideFolderAction(clean,{...state,candidates:[{name:'keeplocal-vault.keeplocal',status:'otherSalt'}],otherSalt:['keeplocal-vault.keeplocal']}),'otherSalt');
});

test('G1.1 an occupied preservation name gets a suffix without overwriting',async()=>{
  const {preserveFolderChoice}=await import('../../js/folder-preserve.js');
  const salt=generateSalt(),encodedSalt=arrayToBase64(salt);
  const key=await deriveKey('fictional test vault phrase',salt);
  const bytes=await encodeV2(key,salt,makePayload([],{},5));
  const source=new Blob([bytes]);
  const candidate={name:vault.MAIN_FILE,...await vault.decodeV2WithKey(bytes,key,encodedSalt)};
  const marker=new Blob(['existing preservation']);
  const files=new Map();
  const directory={
    async getFileHandle(name,{create=false}={}){
      // Occupy every unsuffixed name, independent of the wall-clock second.
      if(!name.endsWith('-2.keeplocal'))files.set(name,marker);
      if(!files.has(name)&&!create)throw new DOMException('Missing','NotFoundError');
      if(!files.has(name))files.set(name,new Blob());
      return {
        name,
        getFile:async()=>files.get(name),
        async createWritable(){
          let pending;
          return {
            async write(data){pending=new Blob([data]);},
            async close(){files.set(name,pending);},
          };
        },
      };
    },
  };
  const handle={
    getFileHandle:async()=>({getFile:async()=>source}),
    async getDirectoryHandle(name,options){
      assert.equal(name,'keeplocal-preserved');
      assert.deepEqual(options,{create:true});
      return directory;
    },
  };
  const [name]=await preserveFolderChoice(handle,[candidate],key,encodedSalt,new AbortController().signal);
  assert.match(name,/^preserved-\d{8}T\d{6}Z-folder-r5-[a-f0-9]{8}-2\.keeplocal$/);
  assert.equal(files.get(name.replace('-2.keeplocal','.keeplocal')),marker);
  assert.deepEqual(new Uint8Array(await files.get(name).arrayBuffer()),bytes);
});

test('G1.5 an unreadable local snapshot stops before creating a preservation file',async()=>{
  const {preserveLocalChoice}=await import('../../js/folder-preserve.js');
  const salt=generateSalt(),key=await deriveKey('fictional test vault phrase',salt);
  const snapshot={
    meta:{salt:arrayToBase64(salt)},
    notes:[{
      id:crypto.randomUUID(),updatedAt:Date.now(),
      iv:arrayToBase64(new Uint8Array(12)),
      ciphertext:arrayToBase64(new Uint8Array(16)),
    }],
  };
  let creates=0;
  const handle={async getDirectoryHandle(){creates++;throw Error('Directory creation attempted');}};
  await assert.rejects(preserveLocalChoice(handle,snapshot,key,new AbortController().signal),{code:'folder.preserveFailed'});
  assert.equal(creates,0);
});
