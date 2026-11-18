import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePassword} from '../../js/password-policy.js';
test('T2.17 predictable sequences, keyboard walks, repetitions and prefixes stay weak',()=>{
 for(const pw of ['abcdefghijklmn','nmlkjihgfedcba','0123456789012345','qwertyuiopasdf','asdfghjklqwerty','password1234567','P@ssw0rd1234567!','senha1234567890123','abcabcabcabcabc','🚀🌕🚀🌕🚀🌕🚀🌕🚀🌕🚀🌕🚀🌕','Tr0ub4dor&3xxxxx','a             ','admin1234567890','letmeinletmeinletmein']){
  const result=validatePassword(pw);assert.equal(result.valid,false,pw);assert.equal(result.strength,'weak',pw);
 }
});
test('T2.17 varied long phrases are strong without composition requirements',()=>{
 for(const pw of ['cedro neblina foguete vidro lontra','moss orbit lantern pebble kestrel','🍄 cedro neblina vidro lontra foguete']){const r=validatePassword(pw);assert.equal(r.valid,true,pw);assert.equal(r.strength,'long',pw);}
 for(const pw of ['cafe chuva livro rio','four words enough here'])assert.equal(validatePassword(pw).valid,true,pw);
});

test('T2.23 common first words do not reject varied random phrases',()=>{
 for(const pw of ['family orbit velvet lantern cobalt','master pebble kestrel orbit lantern']){const r=validatePassword(pw);assert.equal(r.valid,true,pw);assert.equal(r.strength,'long',pw);}
 for(const pw of ['abcdefghijklmn','qwertyuiopasdf','password1234567','iloveyou1234567','Welcome2024Welcome2024']){const r=validatePassword(pw);assert.equal(r.valid,false,pw);assert.ok(r.reason,pw);assert.ok(r.errors.length,pw);}
 assert.equal(validatePassword('abcdefghijklmn').reason,'sequence');assert.equal(validatePassword('qwertyuiopasdf').reason,'keyboard');
});
