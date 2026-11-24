import {create,note} from './harness.mjs';

export async function run({browser,check,assert}){
  await runP47({browser,check,assert});
  await runP48({browser,check,assert});
}

export async function runP47({browser,check,assert}){
  for(const fail of [false,true]){
    await check(`P4.7 account creation clears both passphrase inputs on ${fail?'failure':'success'}`,async()=>{
      const page=await browser.page();
      try{
        await page.eval(`(()=>{
          window.createInputs=[document.querySelector('#create-password'),document.querySelector('#create-confirm')];
          if(!${fail})return;
          const put=IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put=function(row){
            if(this.name==='meta'&&row.key==='keyCheck')throw Error('Fictional vault write failure');
            return put.call(this,row);
          };
        })()`);
        if(fail){
          await page.eval(`(()=>{
            const [password,confirmation]=window.createInputs;
            password.value=confirmation.value='Fictitious account creation phrase';
            password.dispatchEvent(new Event('input'));
            document.querySelector('#create-form').requestSubmit();
          })()`);
          await page.until("document.querySelector('#create-error').textContent.includes('Fictional vault write failure')");
        }else await create(page);
        assert.deepEqual(await page.eval('window.createInputs.map(input=>input.value)'),['','']);
        if(fail){
          assert.equal(await page.eval("document.querySelector('#create-btn').disabled"),true);
          assert.equal(await page.eval("(await import('./js/db.js')).getMeta('salt')"),null);
        }
        assert.deepEqual(page.errors,[]);
      }finally{await page.close();}
    });
  }
}

export async function runP48({browser,check,assert}){
  await check('P4.8 the first edit of a stored note keeps its leading line breaks',async()=>{
    const page=await browser.page();
    try{
      await create(page);
      const item=note({title:'Fictional note with a leading newline',content:'\n\nFictional <note> & text'});
      await page.eval(`(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
      await page.eval("document.querySelector('#search-clear').click()");
      await page.until("!!document.querySelector('.note-card')");
      await page.eval("document.querySelector('.note-card').click()");
      await page.until("!!document.querySelector('#modal-editor')");
      assert.equal(await page.eval("document.querySelector('#modal-editor').value"),item.content);
      await page.eval(`(()=>{
        const editor=document.querySelector('#modal-editor');
        editor.value+=' edited';
        editor.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#modal-close').click();
      })()`);
      await page.until("!document.querySelector('#modal-overlay').classList.contains('open')");
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].content"),item.content+' edited');
    }finally{await page.close();}
  });

  await check('P4.8 the new-note bar keeps its leading line break when the language rerenders it',async()=>{
    const page=await browser.page();
    const content='\nFictional draft before rerender';
    try{
      await create(page);
      await page.eval(`(()=>{
        document.querySelector('.new-note-collapsed').click();
        const body=document.querySelector('#new-note-body');
        body.value=${JSON.stringify(content)};
        body.dispatchEvent(new Event('input',{bubbles:true}));
        window.beforeLanguageBar=document.querySelector('#new-note-bar');
      })()`);
      const lang=await page.eval('document.documentElement.lang');
      await page.eval("document.querySelector('#lang-toggle').click()");
      await page.until(`document.documentElement.lang!==${JSON.stringify(lang)}&&!window.beforeLanguageBar.isConnected&&!!document.querySelector('#new-note-bar.expanded')`);
      assert.equal(await page.eval("document.querySelector('#new-note-body').value"),content);
      await page.eval("document.querySelector('#new-note-close').click()");
      await page.until("(await import('./js/app.js')).getNotes().length===1");
      assert.equal(await page.eval("(await import('./js/app.js')).getNotes()[0].content"),content);
    }finally{await page.close();}
  });
}
