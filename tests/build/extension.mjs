import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,createPublicKey} from 'node:crypto';
const manifest=JSON.parse(readFileSync('chrome-extension/manifest.json','utf8'));
assert.match(manifest.key ?? '',/^[A-Za-z0-9+/]+={0,2}$/,'The manifest needs a stable public key');
const der=Buffer.from(manifest.key,'base64');
const publicKey=createPublicKey({key:der,type:'spki',format:'der'});
assert.equal(publicKey.asymmetricKeyType,'rsa');
assert.equal(publicKey.asymmetricKeyDetails.modulusLength,2048);
const hex=createHash('sha256').update(der).digest('hex').slice(0,32);
const extensionId=hex.replace(/./g,digit=>String.fromCharCode(97+parseInt(digit,16)));
for(const file of ['README.md','README.pt-BR.md']) {
  assert.equal(readFileSync(file,'utf8').match(/`([a-p]{32})`/)?.[1],extensionId,file);
}
const zip=`dist/keep_local_extension_v${manifest.version}.zip`;
const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
for(const excluded of ['lib/VENDOR.md','lib/SHA256SUMS'])assert.equal(names.includes(excluded),false,excluded+' must stay out of the package');
for(const required of ['manifest.json','index.html','js/app.js','js/recovery-actions.js','lib/purify.min.js','lib/marked.min.js'])assert.equal(names.includes(required),true,required);
assert.equal(names.some(n=>n.startsWith('tests/')),false);
assert.equal(names.some(name=>/\.pem$/i.test(name)),false);
assert.deepEqual(JSON.parse(execFileSync('unzip',['-p',zip,'manifest.json'],{encoding:'utf8'})),manifest);

assert.equal(manifest.version,'1.0.0');assert.deepEqual(manifest.permissions,[]);
console.log('PASS T2.18 extension archive contains runtime assets and excludes vendor support files');
