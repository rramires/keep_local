import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {validateV1} from '../../js/backup-format.js';
const f=JSON.parse(readFileSync(new URL('../fixtures/v1.json',import.meta.url)));
test('legacy backup schema accepts real v1 and rejects missing, duplicate and unknown fields',()=>{assert.ok(validateV1(f.withNotes).salt);for(const name of ['missingId','duplicateIds','unknownVersion'])assert.throws(()=>validateV1(f[name]));const b=structuredClone(f.withNotes);b.meta.push({key:'unknown',value:1});assert.throws(()=>validateV1(b));});
