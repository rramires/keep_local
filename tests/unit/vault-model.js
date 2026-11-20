import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNote,MAX_NOTE_BYTES} from '../../js/note-model.js';
import {createNoteWriteQueue,editorFields,metadataFields} from '../../js/note-write-queue.js';
import {isSecretField,secretLabel} from '../../js/vault-model.js';
import {serialQueue} from '../../js/edit-session.js';

const field=(patch={})=>({id:crypto.randomUUID(),kind:'field',label:'Login',value:'fictional',...patch});
const vault=(blocks=[field()])=>({
  id:crypto.randomUUID(),type:'vault',title:'Fixture',blocks,color:'default',
  pinned:false,labels:[],createdAt:1,updatedAt:1,deletedAt:null,archivedAt:null,order:0,
});

test('T4.1 vault validation accepts each block kind at supported limits',()=>{
  const note=vault([
    field({label:'a'.repeat(200),value:'a'.repeat(65536),secret:true,multiline:true,primary:false}),
    {id:crypto.randomUUID(),kind:'text',value:'b'.repeat(65536)},
    ...Array.from({length:198},()=>({id:crypto.randomUUID(),kind:'divider'})),
  ]);
  assert.equal(validateNote(note),note);
});

test('T4.1 vault validation rejects ambiguous shapes, limits and duplicate block IDs',()=>{
  const first=field();
  const invalid=[
    {...vault(),content:''},{...vault(),tasks:[]},{...vault(),blocks:null},
    vault(Array.from({length:201},()=>field())),
    vault([first,{...first}]),vault([field({id:'bad'})]),vault([null]),
    ...[
      {kind:'unknown'},{label:1},{label:'x'.repeat(201)},{value:1},{value:'x'.repeat(65537)},
      {secret:'true'},{multiline:1},{primary:null},{extra:true},
    ].map(patch=>vault([field(patch)])),
    vault([{id:crypto.randomUUID(),kind:'text',value:'x',secret:true}]),
    vault([{id:crypto.randomUUID(),kind:'text',value:'x'.repeat(65537)}]),
    vault([{id:crypto.randomUUID(),kind:'divider',value:''}]),
    vault([{id:crypto.randomUUID(),kind:'divider',label:''}]),
  ];
  for(const note of invalid) assert.throws(()=>validateNote(note),{code:'note.invalid'});
  const oversized=vault(Array.from({length:33},()=>field({value:'x'.repeat(65536)})));
  assert.ok(JSON.stringify(oversized).length>MAX_NOTE_BYTES);
  assert.throws(()=>validateNote(oversized),{code:'note.tooLarge'});
});

test('T4.1 local pin and block edit compose without publishing blocks as metadata',async()=>{
  let live=vault();
  assert.deepEqual(editorFields(live),['title','blocks']);
  assert.equal(Object.hasOwn(metadataFields(live),'blocks'),false);
  const draft=structuredClone(live);
  draft.blocks[0].value='new unsaved fictional value';
  let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const queue=createNoteWriteQueue({
    enqueue:serialQueue(),read:()=>live,version:()=>live.updatedAt,session:()=>1,
    persist:async(next,{known})=>{await barrier;return {...next,updatedAt:known+1};},
    publish:next=>{live=next;},
  });
  const pin=queue(live,{change:next=>{next.pinned=true;}});
  const edit=queue(draft,{fields:editorFields(draft)});
  release();
  await Promise.all([pin,edit]);
  assert.equal(live.pinned,true);
  assert.deepEqual(live.blocks,draft.blocks);
});

test('T4.6 vault search indexes safe fields while excluding secret and free-text values',async()=>{
  const {vaultMatches}=await import('../../js/vault-model.js');
  assert.equal(typeof vaultMatches,'function');
  const item=vault([
    field({value:'example.invalid',label:'Host address'}),
    field({value:'fictional-login',label:'User'}),
    field({value:'FictionalSecretToken',label:'Password',secret:true}),
    field({value:'UnflaggedImportSecret',label:'API key'}),
    {id:crypto.randomUUID(),kind:'text',value:'private scratch text'},
  ]);
  item.labels=['Fixture label'];
  for (const query of ['EXAMPLE.INVALID','Fictional-login','address','fixture label','Password','API key','']) {
    assert.equal(vaultMatches(item,query),true);
  }
  for (const query of ['FictionalSecretToken','SECRETTO','unflaggedimportsecret','private scratch']) {
    assert.equal(vaultMatches(item,query),false);
  }
});

test('D1.1 field privacy defaults to secret and honors explicit overrides',()=>{
  const publicLabels=[
    'host','hostname','servidor','server','url','uri','endpoint','domínio','domain',
    'Usuário','USER','username','login','e-mail','email','porta','port','banco',
    'database','db','bucket','Região','region','ip','conta','account','Server_IP','ID.endpoint',
  ];
  const unknownLabels=['','   ','zip','recipient','portable','βip','ip東京','serverless','Notes'];
  const sensitiveLabels=[
    'Senha do usuário','Host key','Login password','Database password','Access Key ID',
    ...['PIN','pwd','cvv','cvc','otp','totp','2FA','mfa','Seed phrase','mnemonic','recovery',
      'recuperação','credential','credencial','private','privada','auth','cert','pem','ssh','api']
      .map(label=>'Host '+label),
  ];
  assert.deepEqual(publicLabels.filter(label=>isSecretField(field({label}))),[]);
  assert.deepEqual([...unknownLabels,...sensitiveLabels].filter(label=>!isSecretField(field({label}))),[]);
  assert.deepEqual(['skipping host','shipping host','uthor URL','xotp server'].filter(secretLabel),[]);
  assert.equal(isSecretField(field({label:'',secret:false})),false);
  assert.equal(isSecretField(field({label:'Senha',secret:false})),false);
  assert.equal(isSecretField(field({label:'Host',secret:true})),true);
  assert.equal(isSecretField({kind:'text',label:'Senha'}),false);
});

test('E1 vault templates use valid fresh blocks and infer secrecy',async()=>{
  const {createVaultTemplate,VAULT_TEMPLATE_IDS}=await import('../../js/vault-templates.js');
  const {validVaultBlocks,isSecretField}=await import('../../js/vault-model.js');
  const {UUID}=await import('../../js/note-model.js');
  for(const id of VAULT_TEMPLATE_IDS){
    const first=createVaultTemplate(id),second=createVaultTemplate(id);
    assert.ok(validVaultBlocks(first,UUID));
    assert.deepEqual(first.map(({id,...block})=>block),second.map(({id,...block})=>block));
    assert.equal(new Set([...first,...second].map(block=>block.id)).size,first.length+second.length);
    assert.ok(first.every(block=>!Object.hasOwn(block,'secret')));
  }
  assert.equal(createVaultTemplate('ssh').find(block=>block.multiline).label,'Private key');
  assert.ok(isSecretField(createVaultTemplate('ssh').find(block=>block.multiline)));
});
