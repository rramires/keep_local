import {create,unlock} from './harness.mjs';
import {fillVaultInput,mockVaultTimers,vaultFixture} from './vault-core.mjs';

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

  await check('E2 quick copy and primary stars preserve secret values outside the card DOM',async()=>{
    const p=await browser.page();
    const publicValue='fictitious-host.invalid', secret='FICTITIOUS-copy-sentinel-4829';
    const blocks=[['Host',publicValue],['User','Fictitious user',true],['Password','Fictitious pass'],['Token',secret,true]]
      .map(([label,value,primary])=>({id:crypto.randomUUID(),kind:'field',label,value,...(primary?{primary}:{})}));
    const item=vaultFixture({blocks});
    try{
      await create(p);
      await p.eval(`await(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
      await openVaultSection(p);
      await mockVaultTimers(p);
      await p.eval(`(()=>{
        window.quickClipboard=[];
        Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>quickClipboard.push(value)}});
        document.hasFocus=()=>true;
      })()`);
      for(const layout of ['grid','list']){
        await p.eval(`document.querySelector('[data-vault-layout=${layout}]').click()`);
        await p.until(`document.querySelector('.vault-cards')?.dataset.layout===${JSON.stringify(layout)}`);
        assert.deepEqual(await p.eval("[...document.querySelectorAll('[data-vault-quick-copy]')].map(button=>button.textContent)"),['Copy User','Copy Token']);
        assert.ok(!(await p.eval("document.querySelector('.vault-card').outerHTML")).includes(secret));
        assert.equal(await p.eval("document.querySelector('.vault-card-subtitle').textContent"),'Fictitious user');
      }
      await p.eval("document.querySelector('[data-vault-quick-copy=public]').click()");
      await p.until("quickClipboard.at(-1)==='Fictitious user'");
      await p.eval("document.querySelector('[data-vault-quick-copy=secret]').click()");
      await p.until(`quickClipboard.at(-1)===${JSON.stringify(secret)}&&vaultTimers.has(20000)`);
      await p.eval("vaultTimers.fire(20000)");
      await p.until("quickClipboard.at(-1)===''");
      assert.ok(!(await p.eval("document.querySelector('#toast-container').textContent")).includes(secret));
      await p.eval("document.querySelector('[data-vault-open]').click()");
      assert.equal(await p.eval("document.querySelectorAll('.vault-detail [data-vault-primary-indicator]').length"),2);
      await p.eval("document.querySelector('[data-vault-edit]').click()");
      await p.until("!!document.querySelector('.vault-editor [data-vault-primary]')");
      await p.eval("document.querySelector('[data-vault-primary]').click()");
      assert.deepEqual(await p.eval("[...document.querySelectorAll('[data-vault-primary]')].map(button=>button.getAttribute('aria-pressed'))"),['true','false','false','true']);
      await p.eval("document.querySelector('[data-vault-toggle-secret]').click();document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      const card=await p.eval("document.querySelector('.vault-card').outerHTML");
      assert.ok(!card.includes(secret)&&!card.includes(publicValue));
      assert.ok(card.includes('Fictitious user'));
      assert.deepEqual(await p.eval("[...document.querySelectorAll('[data-vault-quick-copy]')].map(button=>button.textContent)"),['Copy User','Copy Host']);
      await p.eval("document.querySelector('[data-vault-action=trash]').click()");
      await p.until("!document.querySelector('.vault-card')");
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      assert.equal(await p.eval("document.querySelectorAll('[data-vault-quick-copy]').length"),0);
      assert.deepEqual(p.errors,[]);
    }finally{await p.close();}
  });

  await check('E3 the generator fills a masked field, confirms replacement and keeps options session-local',async()=>{
    const p=await browser.page();
    const value='[data-vault-block=field]:last-child [data-vault-value]';
    const open=async()=>{
      await p.eval("document.querySelector('[data-vault-open]').click();document.querySelector('[data-vault-edit]').click()");
      await p.until("!!document.querySelector('.vault-editor')");
    };
    try{
      await create(p);
      await openVaultSection(p);
      await chooseVaultTemplate(p,'api');
      await fillVaultInput(p,'[data-vault-title]','Fictitious generated credential');
      await p.eval("document.querySelector('[data-vault-block=field]:last-child [data-vault-generate]')?.click()");
      await p.until("!!document.querySelector('[data-vault-generator]')",2500);
      assert.equal(await p.eval("document.querySelector('[data-generator-length]').value"),'24');
      await p.eval("document.querySelector('[data-generator-length]').value='28';document.querySelector('[data-generator-option=avoidSimilar]').checked=true;document.querySelector('[data-generator-submit]').click()");
      await p.until("!document.querySelector('[data-vault-generator]')");
      const generated=await p.eval(`document.querySelector(${JSON.stringify(value)}).value`);
      assert.equal(generated.length,28);
      assert.doesNotMatch(generated,/[0Oo1lI|]/);
      for(const group of [/[A-Z]/,/[a-z]/,/[0-9]/,/[^A-Za-z0-9]/])assert.match(generated,group);
      assert.equal(await p.eval(`document.activeElement===document.querySelector(${JSON.stringify(value)})&&document.activeElement.classList.contains('vault-edit-secret')`),true);
      assert.equal(await p.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(generated)})||document.documentElement.innerText.includes(${JSON.stringify(generated)})`),false);
      await p.eval("document.querySelector('[data-vault-block=field]:last-child [data-vault-generate]').click()");
      assert.equal(await p.eval("document.querySelector('[data-generator-length]').value"),'28');
      await p.eval("document.querySelector('[data-generator-submit]').click()");
      await p.until("!!document.querySelector('.app-dialog [data-dialog-action=cancel]')");
      await p.eval("document.querySelector('.app-dialog [data-dialog-action=cancel]').click();document.querySelector('[data-generator-cancel]').click()");
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      const persisted=await p.eval(`(async()=>{
        const a=await import('./js/app.js'),d=await import('./js/db.js'),f=await import('./js/backup-format.js');
        const {notes,meta}=await d.readVault();
        return {value:(await f.decryptRecords(notes,a.getCryptoKey()))[0].blocks.at(-1).value,meta};
      })()`);
      assert.equal(persisted.value,generated);
      assert.ok(!JSON.stringify(persisted.meta).includes(generated));
      assert.ok(!Object.keys(persisted.meta).some(key=>/generator/i.test(key)));
      await p.eval("document.querySelector('#lock-btn').click()");
      await unlock(p);
      await openVaultSection(p);
      await open();
      await p.eval("document.querySelector('[data-vault-block=field]:last-child [data-vault-generate]').click()");
      assert.equal(await p.eval("document.querySelector('[data-generator-length]').value"),'24');
      assert.deepEqual(p.errors,[]);
    }finally{await p.close();}
  });

  await check('E4 undo restores a deleted secret through the queue and clears history across editors and lock',async()=>{
    const p=await browser.page();
    const secret='FICTITIOUS-history-sentinel-6021';
    const item=vaultFixture({blocks:[{id:crypto.randomUUID(),kind:'field',label:'Password',value:secret}]});
    const edit=async()=>{
      await p.eval("document.querySelector('[data-vault-open]').click();document.querySelector('[data-vault-edit]').click()");
      await p.until("document.activeElement.matches('[data-vault-title]')");
    };
    const undo=()=>p.eval("document.querySelector('[data-vault-undo]').disabled");
    try{
      await create(p);
      await p.eval(`await(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
      await openVaultSection(p);
      await edit();
      await p.until("!!document.querySelector('[data-vault-undo]')",2500);
      assert.equal(await undo(),true);
      await p.eval("document.querySelector('[data-vault-remove]').click()");
      assert.equal(await undo(),false);
      assert.equal(await p.eval("document.querySelectorAll('.vault-block').length"),0);
      await p.eval("document.querySelector('#modal-close').focus()");
      await pressVaultKey(p,'z','KeyZ',90,2);
      await p.until("document.querySelectorAll('.vault-block').length===1");
      assert.equal(await p.eval("document.querySelector('[data-vault-value]').value"),'');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      const stored=await p.eval(`(async()=>{
        const a=await import('./js/app.js'),d=await import('./js/db.js'),f=await import('./js/backup-format.js');
        const {notes,meta}=await d.readVault();
        return {value:(await f.decryptRecords(notes,a.getCryptoKey()))[0].blocks[0].value,storage:JSON.stringify([meta,Object.entries(localStorage),Object.entries(sessionStorage)])};
      })()`);
      assert.equal(stored.value,secret);
      assert.ok(!stored.storage.includes(secret));
      await edit();
      assert.equal(await undo(),true);
      await fillVaultInput(p,'[data-vault-title]','Fictitious typing intermediate');
      await fillVaultInput(p,'[data-vault-title]','Fictitious typing final');
      assert.equal(await undo(),true);
      await p.eval("document.querySelector('#modal-close').focus()");
      assert.equal(await undo(),false);
      await p.eval("document.querySelector('[data-vault-undo]').click()");
      assert.equal(await p.eval("document.querySelector('[data-vault-title]').value"),item.title);
      await pressVaultKey(p,'Y','KeyY',89,2);
      assert.equal(await p.eval("document.querySelector('[data-vault-title]').value"),'Fictitious typing final');
      await p.eval("document.querySelector('#lock-btn').click()");
      await unlock(p);
      await openVaultSection(p);
      await edit();
      assert.equal(await undo(),true);
      assert.equal(await p.eval("document.querySelector('[data-vault-redo]').disabled"),true);
      assert.equal(await p.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(secret)})`),false);
      assert.deepEqual(p.errors,[]);
    }finally{await p.close();}
  });

  await check('E4 applying a preset is one reversible structural change',async()=>{
    const p=await browser.page();
    try{
      await create(p);
      await openVaultSection(p);
      await chooseVaultTemplate(p,'ssh');
      await p.until("!!document.querySelector('[data-vault-undo]')",2500);
      await p.eval("document.querySelector('[data-vault-undo]').click()");
      assert.equal(await p.eval("document.querySelectorAll('[data-vault-block]').length"),1);
      assert.equal(await p.eval("document.querySelector('[data-vault-label]').value"),'');
      await p.eval("document.querySelector('[data-vault-redo]').click()");
      assert.equal(await p.eval("document.querySelectorAll('[data-vault-block]').length"),5);
      assert.equal(await p.eval("document.querySelector('[data-vault-block] textarea')?.tagName"),'TEXTAREA');
      await p.eval("document.querySelector('#modal-close').click()");
      await p.until("!document.querySelector('.vault-editor')");
      assert.equal(await p.eval("(await(await import('./js/db.js')).readVault()).notes.length"),0);
    }finally{await p.close();}
  });
}
