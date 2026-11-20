import test from 'node:test';import assert from 'node:assert/strict';
import {storeSessionKey,getSessionKey,getSessionVaultId,clearSession} from '../../js/session.js';
test('accepting a key again preserves its verified vault binding',async()=>{const key={};storeSessionKey(key,'fictitious-vault');storeSessionKey(key);assert.equal(getSessionVaultId(),'fictitious-vault');assert.equal(await getSessionKey(),key);clearSession();assert.equal(await getSessionKey(),null);assert.equal(getSessionVaultId(),null);});

test('E5 changing the idle period uses the last activity and resets on lock',async context=>{
  const {setIdleTimeout,refreshSession}=await import('../../js/session.js');
  let now=10_000;
  context.mock.method(Date,'now',()=>now);
  const key={};
  try{
    storeSessionKey(key,'fictitious-vault');
    now+=10_000;
    setIdleTimeout(60_000);
    now+=49_999;
    assert.equal(await getSessionKey(),key);
    now++;
    assert.equal(await getSessionKey(),null);

    storeSessionKey(key);
    now+=70_000;
    assert.equal(await getSessionKey(),key);
    refreshSession();
    setIdleTimeout(120_000);
    now+=100_000;
    setIdleTimeout();
    now+=100_000;
    assert.equal(await getSessionKey(),key);
    now+=100_000;
    assert.equal(await getSessionKey(),null);
  }finally{clearSession();}
});
