import {create,note} from './harness.mjs';

export async function run({browser,check,assert}){
  await runP47({browser,check,assert});
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
