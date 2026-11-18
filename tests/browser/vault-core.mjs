import {create,add,unlock,note,PASSWORD} from './harness.mjs';

export function vaultFixture(patch={}) {
  const {content,...base}=note();
  return {
    ...base,type:'vault',title:'Fictitious vault entry',labels:[],
    blocks:[
      {id:crypto.randomUUID(),kind:'field',label:'Host',value:'example.invalid'},
      {id:crypto.randomUUID(),kind:'field',label:'Password',value:'fictional-secret',secret:true},
    ],
    ...patch,
  };
}

async function save(page,item) {
  await page.eval(`await(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
}

export async function run({browser,check,assert}) {
  await check('T4.1 vault records stay out of notes and round-trip in the existing v2 envelope',async()=>{
    const p=await browser.page();
    const q=await browser.page();
    try {
      await create(p);
      await add(p,'A visible note','Fictional note content');
      const archived=vaultFixture({title:'Vault archived marker',archivedAt:1});
      const item=vaultFixture({title:'Vault private marker',labels:['Work']});
      await save(p,note({title:'Visible Work note',labels:['Work']}));
      await save(p,item);
      await save(p,archived);
      await p.reload();
      await unlock(p);
      await p.until("document.querySelectorAll('.note-card').length===2");
      const outside=async()=>assert.equal(await p.eval("document.querySelector('#main-inner').textContent.includes('Vault private marker')||document.querySelector('#main-inner').textContent.includes('Vault archived marker')"),false);
      await outside();
      await p.eval("document.querySelector('[data-view=archive]').click()");
      await outside();
      await p.eval("document.querySelector('[data-view=label][data-label=Work]').click()");
      await p.until("document.querySelector('#main-inner').textContent.includes('Visible Work note')");
      await outside();
      await p.eval("document.querySelector('[data-view=notes]').click(); const f=document.querySelector('#search-input');f.value='private marker';f.dispatchEvent(new Event('input'))");
      await p.until("document.querySelectorAll('.note-card').length===0");
      await outside();
      const bytes=await p.eval(`(async()=>{
        let captured;
        URL.createObjectURL=blob=>{captured=blob;return 'blob:test';};
        URL.revokeObjectURL=()=>{};
        HTMLAnchorElement.prototype.click=()=>{};
        const result=await(await import('./js/backup.js')).exportBackup();
        if(result.unreadableCount!==0) throw Error('Vault item treated as unreadable');
        return Array.from(new Uint8Array(await captured.arrayBuffer()));
      })()`);
      await q.eval(`await(await import('./js/backup.js')).importBackup(new File([new Uint8Array(${JSON.stringify(bytes)})],'fictional.keeplocal'),${JSON.stringify(PASSWORD)})`);
      await q.reload();
      await unlock(q);
      const restored=await q.eval(`(await import('./js/app.js')).getNotes().find(n=>n.id===${JSON.stringify(item.id)})`);
      assert.deepEqual(restored.blocks,item.blocks);
      assert.equal(restored.type,'vault');
      assert.deepEqual([...p.errors,...q.errors],[]);
    } finally {await p.close();await q.close();}
  });
  await check('T4.2 vault list and grid persist and render only safe card content',async()=>{
    const p=await browser.page();
    try {
      await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await create(p);
      const item=vaultFixture({labels:['Fictional label']});
      item.blocks.unshift({id:crypto.randomUUID(),kind:'text',value:'fictional-text-only'});
      await save(p,item);
      assert.equal(await p.eval("!!document.querySelector('[data-view=vault]')"),true);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      assert.equal(await p.eval("document.querySelector('.vault-card-title').textContent"),item.title);
      assert.equal(await p.eval("document.querySelector('.vault-card-subtitle').textContent"),'example.invalid');
      assert.equal(await p.eval("document.querySelector('.vault-card').outerHTML.includes('fictional-secret') || document.querySelector('.vault-card').outerHTML.includes('fictional-text-only')"),false);
      assert.equal(await p.eval("document.documentElement.scrollWidth<=innerWidth"),true);
      assert.equal(await p.eval("document.querySelector('[data-vault-layout=grid]').getAttribute('aria-pressed')"),'true');

      await p.eval("document.querySelector('[data-vault-layout=list]').click()");
      await p.until("document.querySelector('[data-vault-layout=list]').getAttribute('aria-pressed')==='true'");
      assert.equal(await p.eval("await(await import('./js/db.js')).getMeta('vaultLayout')"),'list');
      await p.reload();
      await unlock(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await p.until("document.querySelector('[data-vault-layout=list]').getAttribute('aria-pressed')==='true'");
      await p.eval("document.querySelector('#lock-btn').click()");
      await unlock(p);
      await p.eval("document.querySelector('[data-view=vault]').click()");
      await p.until("document.querySelector('[data-vault-layout=list]').getAttribute('aria-pressed')==='true'");

      await p.eval("document.querySelector('[data-vault-action=pin]').click()");
      await p.until("document.querySelector('[data-vault-action=pin]').getAttribute('aria-pressed')==='true'");
      await p.eval("document.querySelector('[data-vault-action=trash]').click()");
      await p.until("!document.querySelector('.vault-card')");
      await p.eval("document.querySelector('[data-view=trash]').click()");
      await p.until("!!document.querySelector('.vault-card')");
      assert.equal(await p.eval("document.querySelector('.vault-card').outerHTML.includes('fictional-secret')"),false);
      await p.eval("document.querySelector('[data-vault-action=restore]').click()");
      await p.until("!document.querySelector('.vault-card')");
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

  await check('T4.3 vault detail opens in reading mode with a fixed mask and returns focus',async()=>{
    const p=await browser.page();
    try {
      await create(p);
      const item=vaultFixture();
      item.blocks.push(
        {id:crypto.randomUUID(),kind:'divider'},
        {id:crypto.randomUUID(),kind:'text',value:'<strong>Literal text</strong>'},
        {id:crypto.randomUUID(),kind:'field',label:'Public key example',value:'example line 1\nexample line 2',multiline:true,secret:false},
      );
      await save(p,item);
      await p.eval("document.querySelector('[data-view=vault]').click(); const opener=document.querySelector('[data-vault-open]'); opener.focus(); opener.click()");
      await p.until("!!document.querySelector('.vault-detail')");
      const read=await p.eval(`(()=>{
        const panel=document.querySelector('.vault-detail');
        const multi=panel.querySelector('.vault-multiline');
        return {
          inputs:panel.querySelectorAll('input,textarea').length,
          mask:panel.querySelector('.vault-secret-value').textContent,
          hasSecret:panel.outerHTML.includes('fictional-secret'),
          literal:panel.querySelector('.vault-text').textContent,
          strong:!!panel.querySelector('strong'),
          multi:multi.textContent,whiteSpace:getComputedStyle(multi).whiteSpace,
          edit:!!panel.querySelector('[data-vault-edit]'),
        };
      })()`);
      assert.deepEqual(read,{inputs:0,mask:'••••••••',hasSecret:false,literal:'<strong>Literal text</strong>',strong:false,multi:'example line 1\nexample line 2',whiteSpace:'pre-wrap',edit:true});
      await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
      await p.until("!document.querySelector('#modal-overlay').classList.contains('open')");
      assert.equal(await p.eval("document.activeElement.dataset.vaultOpen"),item.id);
      assert.deepEqual(p.errors,[]);
    } finally {await p.close();}
  });

}
