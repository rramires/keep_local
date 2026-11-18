import test from 'node:test';import assert from 'node:assert/strict';
import {storeSessionKey,getSessionKey,getSessionVaultId,clearSession} from '../../js/session.js';
test('accepting a key again preserves its verified vault binding',async()=>{const key={};storeSessionKey(key,'fictitious-vault');storeSessionKey(key);assert.equal(getSessionVaultId(),'fictitious-vault');assert.equal(await getSessionKey(),key);clearSession();assert.equal(await getSessionKey(),null);assert.equal(getSessionVaultId(),null);});
