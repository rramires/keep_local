import {create} from './harness.mjs';
import {fillVaultInput} from './vault-core.mjs';

export async function pressVaultKey(page,key,code,number,modifiers=0) {
  const event={key,code,windowsVirtualKeyCode:number,modifiers};
  await page.send('Input.dispatchKeyEvent',{...event,type:'keyDown'});
  await page.send('Input.dispatchKeyEvent',{...event,type:'keyUp'});
}

export async function openVaultSection(page) {
  await page.eval("document.querySelector('[data-view=vault]').click()");
  await page.until("!!document.querySelector('.vault-section')");
}

export async function chooseVaultTemplate(page,id) {
  await page.eval("document.querySelector('#vault-new-item').click()");
  await page.until("!!document.querySelector('[data-dialog-choice]')");
  await page.eval(`document.querySelector('[data-dialog-choice=${id}]').click()`);
  await page.until("!!document.querySelector('.vault-editor')");
}

export async function run({browser,check,assert}) {
  await check('E0 clipboard warning names cross-device sync in English and Portuguese',async()=>{
    const page=await browser.page();
    try {
      await create(page);
      await page.eval("document.querySelector('[data-view=vault]').click()");
      const read=()=>page.eval("document.querySelector('.vault-clipboard-tip span').textContent");
      const english=await read();
      await page.eval("document.querySelector('#lang-toggle').click()");
      await page.until("document.documentElement.lang==='pt-BR'&&document.querySelector('.vault-clipboard-tip span')?.textContent.includes('histórico')");
      assert.deepEqual([english,await read()],[
        'Windows clipboard history (Win+V) and sync across devices can retain copied values after KeepLocal clears the clipboard.',
        'O histórico da área de transferência do Windows (Win+V) e a sincronização entre dispositivos podem conservar valores copiados mesmo após a limpeza pelo KeepLocal.',
      ]);
    }finally{await page.close();}
  });

  await check('E1 template choice uses focused Enter, Esc, and leaves unused presets unsaved',async()=>{
    const p=await browser.page();
    try{
      await create(p);
      await openVaultSection(p);
      await p.eval("const add=document.querySelector('#vault-new-item');add.focus();add.click()");
      await p.until("document.activeElement.dataset.dialogChoice==='blank'",2500);
      await pressVaultKey(p,'Escape','Escape',27);
      assert.equal(await p.eval("document.activeElement.id"),'vault-new-item');
      assert.equal(await p.eval("!!document.querySelector('.vault-editor')"),false);
      await p.eval("document.querySelector('#vault-new-item').click()");
      await p.until("!!document.querySelector('[data-dialog-choice=server]')");
      await p.eval("document.querySelector('[data-dialog-choice=server]').focus()");
      await pressVaultKey(p,'Enter','Enter',13);
      await p.until("!!document.querySelector('.vault-editor')");
      assert.deepEqual(await p.eval("[...document.querySelectorAll('[data-vault-label]')].map(input=>input.value)"),['Host','Port','User','Password']);
      assert.equal(await p.eval("document.querySelector('[data-vault-block=text] textarea').value"),'Notes');
      await p.eval("document.querySelector('[data-vault-add=divider]').click();document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      assert.equal(await p.eval("(await(await import('./js/db.js')).readVault()).notes.length"),0);
      await chooseVaultTemplate(p,'ssh');
      await fillVaultInput(p,'[data-vault-title]','Fictitious SSH entry');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!!document.querySelector('.vault-card')");
      const item=await p.eval("(await import('./js/app.js')).getNotes()[0]");
      assert.equal(item.blocks.find(block=>block.multiline).label,'Private key');
      assert.ok(item.blocks.every(block=>!Object.hasOwn(block,'secret')));
    }finally{await p.close();}
  });

  await check('E1 each template translates labels and infers the same secrecy in both languages',async()=>{
    const p=await browser.page();
    const expected=[
      [['',true]],
      [['Host',false],['Port',false],['User',false],['Password',true]],
      [['Host',false],['Port',false],['Database',false],['User',false],['Password',true]],
      [['URL',false],['Key ID',true],['Token',true]],
      [['Host',false],['Port',false],['User',false],['Private key',true],['Passphrase',true]],
      [['URL',false],['User / email',false],['Password',true]],
      [['Account ID',false],['Endpoint',false],['Bucket',false],['Region',false],['Access Key ID',true],['Secret Access Key',true],['Token',true]],
    ];
    const translations={Port:'Porta',User:'Usuário',Password:'Senha',Database:'Banco','Private key':'Chave privada','User / email':'Usuário / e-mail',Region:'Região'};
    try{
      await create(p);
      for(const lang of ['en','pt-BR']){
        const result=await p.eval(`(async()=>{
          const {setLang}=await import('./js/i18n.js'),{createVaultTemplate,VAULT_TEMPLATE_IDS}=await import('./js/vault-templates.js');
          const {isSecretField}=await import('./js/vault-model.js');
          await setLang(${JSON.stringify(lang)});
          return VAULT_TEMPLATE_IDS.map(id=>createVaultTemplate(id).filter(block=>block.kind==='field').map(block=>[block.label,isSecretField(block)]));
        })()`);
        assert.deepEqual(result,lang==='en'?expected:expected.map(fields=>fields.map(([label,secret])=>[translations[label]??label,secret])));
      }
    }finally{await p.close();}
  });
}
