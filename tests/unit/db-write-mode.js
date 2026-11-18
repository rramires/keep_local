import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../js/db.js';

test('F2 the write barrier rejects before opening an IndexedDB transaction',async()=>{
  assert.equal(typeof db.setWriteMode,'function');
  let opened=0;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){opened++;throw Error('Unexpected open');}}});
  try {
    db.setWriteMode('readOnly');
    assert.equal(db.isReadOnly(),true);
    await assert.rejects(db.saveMeta('theme','light'),{code:'vault.readOnly'});
    await assert.rejects(db.saveNoteRecord({id:'fictional'}),{code:'vault.readOnly'});
    await assert.rejects(db.vaultTransaction(()=>assert.fail('Unexpected write action')),{code:'vault.readOnly'});
    assert.equal(opened,0);
    db.setWriteMode('readWrite');
    assert.equal(db.isReadOnly(),false);
    await assert.rejects(db.saveMeta('theme','light'),/Unexpected open/);
    assert.equal(opened,1);
  } finally {
    db.setWriteMode('readWrite');
    if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);
    else delete globalThis.indexedDB;
  }
});
