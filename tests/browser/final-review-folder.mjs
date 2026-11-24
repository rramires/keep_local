import {launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {connectedCopyPage} from './folder-copy-view.mjs';
import {connectBoth,editNote,focus,relogin,waitForFolderLineage,waitForRev,withTwoProfiles} from './folder-merge.mjs';
import {copyFolderFiles,readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {decodeV2} from '../../js/backup-v2.js';
import {decryptRecords} from '../../js/backup-format.js';

const MAIN='keeplocal-vault.keeplocal';
const SIDE='keeplocal-vault (1).keeplocal';

async function checkedWrite(page,rev){
  await focus(page);
  await waitForRev(page,rev);
  await waitForFolderLineage(page);
  return readFolderFixture(page,MAIN);
}

async function editAndWrite(page,id,content,rev){
  await editNote(page,id,{content});
  return checkedWrite(page,rev);
}

const putNote=(page,item)=>page.eval(`(await import('./js/app.js')).saveNote(${JSON.stringify(item)})`);
const seen=page=>page.eval("(await import('./js/db.js')).getMeta('folderSeenRev')");

function preservedCopies(page){
  return page.eval(`(async()=>{
    const root=await folderTest.directory(),copies=[];
    try {
      const dir=await root.getDirectoryHandle('keeplocal-preserved');
      for await(const file of dir.values()){
        if(file.kind==='file')copies.push(new Uint8Array(await (await file.getFile()).arrayBuffer()).toBase64());
      }
    }catch(error){if(error.name!=='NotFoundError')throw error;}
    return copies;
  })()`);
}

async function displacedMain(page,head,main){
  await writeFolderFixture(page,SIDE,head);
  await writeFolderFixture(page,MAIN,main);
}

async function decode(bytes){
  const {key,payload}=await decodeV2(Buffer.from(bytes,'base64'),PASSWORD);
  return {rev:payload.rev,notes:await decryptRecords(payload.notes,key),tombstones:payload.tombstones??[]};
}

export async function runP42({check,assert}){
  await check('P4.2 a displaced principal is preserved exactly and the late PC can return its edit',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const shared=note({title:'Fictional shared note',content:'A0'});
      const late=note({title:'Fictional note from the late PC',content:'Y'});
      await connectBoth(a,b,[shared]);
      await editAndWrite(a,shared.id,'A1',2);
      const head=await editAndWrite(a,shared.id,'A2',3);
      await putNote(b,late);
      const lateMain=await checkedWrite(b,2);
      await displacedMain(a,head,lateMain);
      const current=await editAndWrite(a,shared.id,'A3',4);

      const copies=await preservedCopies(a);
      assert.deepEqual(copies,[lateMain]);
      const preserved=await decode(copies[0]);
      assert.equal(preserved.rev,2);
      assert.equal(preserved.notes.find(item=>item.id===late.id)?.content,'Y');
      assert.equal((await decode(current)).notes.find(item=>item.id===shared.id)?.content,'A3');
      assert.equal(await readFolderFixture(a,SIDE),head);

      await copyFolderFiles(a,b);
      const merged=await checkedWrite(b,5);
      assert.deepEqual((await decode(merged)).notes.map(item=>item.content).sort(),['A3','Y']);
      await copyFolderFiles(b,a);
      await focus(a);
      await waitForRev(a,5);
      await a.until(`(await import('./js/app.js')).getNotes().some(item=>item.id===${JSON.stringify(late.id)}&&item.content==='Y')`);
    });
  });

  await check('P4.2 failed preservation readback stops the replacement of a displaced principal',async()=>{
    const browser=await launchExtension();
    try{
      const page=await browser.page(undefined,folderFixtureSource());
      await connectedCopyPage(browser,page);
      await waitForRev(page,1);
      await waitForFolderLineage(page);
      const [item]=await page.eval("(await import('./js/app.js')).getNotes()");
      await editAndWrite(page,item.id,'A1',2);
      const head=await editAndWrite(page,item.id,'A2',3);
      const salt=Buffer.from(head,'base64').subarray(0,16);
      const fixture=await backupFixture([note({content:'Y'})],PASSWORD,salt);
      const lateMain=await fixture.seal({...fixture.payload,rev:2});
      await displacedMain(page,head,lateMain);

      const attempts=await page.eval('folderTest.writeAttempts');
      await page.eval("folderTest.failPreservation='tamper'");
      await editNote(page,item.id,{content:'A3'});
      await focus(page);
      await page.until("(await (await import('./js/db.js')).getMeta('folderSeenRev'))>3||!!document.querySelector('[data-folder-state=error]')");
      await waitForFolderLineage(page);
      assert.equal(await readFolderFixture(page,MAIN),lateMain);
      assert.equal(await readFolderFixture(page,SIDE),head);
      assert.equal(await page.eval('folderTest.writeAttempts'),attempts);
      assert.equal(await seen(page),3);
      assert.deepEqual(await preservedCopies(page),[]);

      await page.eval('folderTest.failPreservation=null');
      const current=await checkedWrite(page,4);
      assert.equal((await decode(current)).notes[0].content,'A3');
      assert.deepEqual(await preservedCopies(page),[lateMain]);
    }finally{await browser.close();}
  });
}

export async function runP43({check,assert}){
  await check('P4.3 discarding local corruption lets a clean second PC return the readable note',async()=>{
    await withTwoProfiles(async(a,b)=>{
      const good=note({title:'Fictional note with a readable copy',content:'The readable text'});
      const control=note({title:'Fictional control note',content:'Keep this too'});
      await connectBoth(a,b,[good,control]);
      await a.eval(`(async()=>{
        const db=await import('./js/db.js');
        const record=await db.getNoteRecord(${JSON.stringify(good.id)});
        await db.saveNoteRecord({...record,ciphertext:'damaged'});
      })()`);
      await relogin(a);
      await a.until("!!document.querySelector('.unreadable-warning')");
      await a.eval("HTMLAnchorElement.prototype.click=()=>{};document.querySelector('#recover-notes-btn').click()");
      await a.until("!!document.querySelector('.recovery-record')");
      await a.eval("document.querySelector('.recovery-record').click();document.querySelector('#recovery-export').click()");
      await a.until("document.querySelector('#recovery-status').textContent.includes('Download')");
      await a.eval(`(async()=>{
        const {t}=await import('./js/i18n.js');
        const check=document.querySelector('#recovery-saved');
        check.checked=true;
        check.dispatchEvent(new Event('change'));
        const word=document.querySelector('#recovery-confirmation');
        word.value=t('recovery.discardWord');
        word.dispatchEvent(new Event('input'));
      })()`);
      await a.until("!document.querySelector('#recovery-discard').disabled");
      await a.eval("document.querySelector('#recovery-discard').click()");
      await a.until("!document.querySelector('.unreadable-warning')");
      await focus(a);
      await a.until("(await (await import('./js/db.js')).getMeta('folderSeenRev'))>1");
      await waitForFolderLineage(a);
      const withoutDamaged=await decode(await readFolderFixture(a,MAIN));
      assert.deepEqual(withoutDamaged.notes.map(item=>item.id),[control.id]);
      assert.equal(withoutDamaged.tombstones.some(marker=>marker.id===good.id),false);
      assert.equal(await a.eval(`!!await (await import('./js/db.js')).getNoteRecord(${JSON.stringify(good.id)})`),false);

      await copyFolderFiles(a,b);
      await focus(b);
      const restored=await checkedWrite(b,withoutDamaged.rev+1);
      assert.deepEqual((await decode(restored)).notes.map(item=>item.content).sort(),['Keep this too','The readable text']);
      await copyFolderFiles(b,a);
      await focus(a);
      await waitForRev(a,withoutDamaged.rev+1);
      await a.until(`(await import('./js/app.js')).getNotes().some(item=>item.id===${JSON.stringify(good.id)}&&item.content===${JSON.stringify(good.content)})`);
      assert.deepEqual(a.errors,[]);
      assert.deepEqual(b.errors,[]);
    });
  });
}
