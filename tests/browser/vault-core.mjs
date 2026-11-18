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
}
