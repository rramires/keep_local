import {create,launch,launchExtension,note,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {connectedCopyPage,folderCopyEvidence,openCopyList,openSelectedCopy} from './folder-copy-view.mjs';
import {submitExtensionLogin} from './extension.mjs';
import {editNote,focus,ready,waitForFolderLineage,waitForNotes,waitForRev} from './folder-merge.mjs';
import {readFolderFixture,writeFolderFixture} from './folder-transfer.mjs';
import {decodeV2,encodeV2,payloadHash} from '../../js/backup-v2.js';
import {buildPhoto,photoParts} from '../../js/photo-trailer.js';

const CHOOSE_PHOTOS='[data-photo-action=choose]';
const PHOTOS='[data-photo-settings]';
const photoNames=Array.from({length:7},(_,index)=>`fictional-${index+1}.${index%2?'PNG':'jpg'}`);

async function installPhotoFixture(names){
  const extensionPicker=window.showDirectoryPicker;
  const getDirectory=FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  const getFileHandle=FileSystemDirectoryHandle.prototype.getFileHandle;
  const getFile=FileSystemFileHandle.prototype.getFile;
  const createWritable=FileSystemFileHandle.prototype.createWritable;
  const keys=FileSystemDirectoryHandle.prototype.keys;
  const entries=FileSystemDirectoryHandle.prototype.entries;
  const query=FileSystemHandle.prototype.queryPermission;
  const request=FileSystemHandle.prototype.requestPermission;
  const root=(await navigator.storage.getDirectory());
  const fixture=window.photoTest={
    names,folderName:'KL-TEST-DEDICATED-PHOTOS',permission:'granted',requested:'granted',
    events:[],writes:[],
    async directory(create=false){
      return getDirectory.call(root,this.folderName,{create});
    },
    async entry(name,create=false){
      return getFileHandle.call(await this.directory(create),name,{create});
    },
    async seed(name,bytes){
      const file=await this.entry(name,true);
      const stream=await createWritable.call(file,{mode:'exclusive'});
      await stream.write(bytes);
      await stream.close();
    },
    async image(index){
      const canvas=new OffscreenCanvas(12,8),ctx=canvas.getContext('2d');
      ctx.fillStyle=`rgb(${index*27%255}, 144, 188)`;
      ctx.fillRect(0,0,12,8);
      ctx.fillStyle='#752e44';
      ctx.fillRect(1,1,(index%6)+1,4);
      const type=index%2?'image/png':'image/jpeg';
      return new Uint8Array(await (await canvas.convertToBlob({type})).arrayBuffer());
    },
    async fill(count=7){
      for(let i=0;i<count;i++)await this.seed(names[i]??'fictional-8.png',await this.image(i));
    },
    async bytes(name){
      return new Uint8Array(await (await getFile.call(await this.entry(name))).arrayBuffer()).toBase64();
    },
    clear(){this.events=[];this.writes=[];folderTest.clear();},
  };
  const isPhoto=name=>/^fictional-.*\.(?:jpe?g|png)$/i.test(name);
  window.showDirectoryPicker=async options=>{
    if(options.id!=='keeplocal-photos')return extensionPicker(options);
    fixture.events.push({kind:'picker',options});
    if(fixture.selection==='vault')return folderTest.directory();
    if(fixture.selection)return getDirectory.call(await folderTest.directory(),fixture.selection,{create:true});
    return fixture.directory();
  };
  FileSystemHandle.prototype.queryPermission=function(...args){
    if(this.name!==fixture.folderName)return query.apply(this,args);
    fixture.events.push({kind:'query'});
    return Promise.resolve(fixture.permission);
  };
  FileSystemHandle.prototype.requestPermission=function(...args){
    if(this.name!==fixture.folderName)return request.apply(this,args);
    fixture.events.push({kind:'request',active:navigator.userActivation.isActive});
    return Promise.resolve(fixture.permission=fixture.requested);
  };
  FileSystemDirectoryHandle.prototype.entries=function(...args){
    if(this.name!==fixture.folderName)return entries.apply(this,args);
    fixture.events.push({kind:'list'});
    return entries.apply(this,args);
  };
  FileSystemDirectoryHandle.prototype.keys=function(...args){
    if(this.name!==fixture.folderName)return keys.apply(this,args);
    fixture.events.push({kind:'keys'});
    return keys.apply(this,args);
  };
  FileSystemDirectoryHandle.prototype.getFileHandle=function(name,...args){
    if(this.name===fixture.folderName)fixture.events.push({kind:'fileHandle',name,create:!!args[0]?.create});
    return getFileHandle.call(this,name,...args);
  };
  FileSystemFileHandle.prototype.getFile=async function(...args){
    if(!isPhoto(this.name))return getFile.apply(this,args);
    fixture.events.push({kind:'read',name:this.name});
    if(fixture.holdRead){
      fixture.holdRead=false;
      await new Promise(resolve=>{fixture.releaseRead=resolve;});
    }
    const file=await getFile.apply(this,args);
    if(fixture.badRead===this.name){
      fixture.badRead=null;
      const bytes=new Uint8Array(await file.arrayBuffer());
      bytes[bytes.length-1]^=1;
      return new File([bytes],file.name);
    }
    return file;
  };
  FileSystemFileHandle.prototype.createWritable=async function(...args){
    if(isPhoto(this.name))fixture.writes.push({name:this.name,options:args[0]});
    const stream=await createWritable.apply(this,args);
    if(isPhoto(this.name)&&fixture.tamperReadback){
      const close=stream.close.bind(stream);
      stream.close=async()=>{
        await close();
        fixture.badRead=this.name;
      };
    }
    return stream;
  };
}

async function withPhotosPage(work,{connected=true,source=''}={}){
  const browser=await launchExtension();
  try{
    const photoSource=`void (async()=>{await (${installPhotoFixture})(${JSON.stringify(photoNames)});${source};})()`;
    const page=await browser.page(undefined,folderFixtureSource('KL-TEST-VAULT-PHOTOS',{metadata:2000,file:1500})+';'+photoSource);
    await page.until("!!window.photoTest");
    if(connected){
      await connectedCopyPage(browser,page);
      await waitForFolderLineage(page);
    }else await create(page);
    await work(page,browser);
  }finally{await browser.close();}
}

async function openPhotoSettings(page,assert,action='change'){
  await page.eval("document.querySelector('#folder-settings-btn').click()");
  await page.until(`!!document.querySelector('.folder-settings [data-folder-action=${action}]')`);
  if(action==='change')assert.ok(await page.eval(`!!document.querySelector('${PHOTOS}')`),'Photos settings must be available for a connected vault');
}
async function closeSettings(page){
  await page.eval("document.querySelector('#modal-close').click()");
  await page.until("!document.querySelector('.folder-settings')");
}
function startPhotoChoice(page){
  return page.eval(`document.querySelector('${CHOOSE_PHOTOS}').click()`);
}
async function finishPhotoChoice(page,action='confirm'){
  await page.until("!!document.querySelector('.app-dialog')");
  await page.eval(`document.querySelector('[data-dialog-action=${action}]').click()`);
  await page.until("!document.querySelector('.app-dialog')&&!document.querySelector('[data-photo-action=choose]')?.disabled");
}
const photoMeta=page=>page.eval(`(async()=>{
  const db=await import('./js/db.js');
  const rows=(await db.getAllMetaRecords()).filter(row=>row.key.startsWith('photo'));
  return Object.fromEntries(rows.map(({key,value})=>[key,key==='photoFolder'?value.name:value]));
})()`);
const status=page=>page.eval("document.querySelector('[data-photo-status]')?.textContent||''");
const clearPhotoSpies=page=>page.eval('photoTest.clear()');
async function assertNoPhotoWrites(page,assert){
  assert.deepEqual(await page.eval('photoTest.writes'),[]);
  assert.deepEqual(await page.eval('folderTest.writes'),{});
}

export async function runPhotoSettings({check,assert}){
  await check('P2.1 photo settings accept seven dedicated JPEG and PNG files in weekday order',async()=>{
    await withPhotosPage(async page=>{
      await page.eval("await photoTest.fill();await photoTest.seed('desktop.ini',Uint8Array.of(1));await (await photoTest.directory()).getDirectoryHandle('ignored.PNG',{create:true})");
      await openPhotoSettings(page,assert);
      assert.equal(await status(page),'Photos: no folder chosen');
      await clearPhotoSpies(page);
      await startPhotoChoice(page);
      await page.until("!!document.querySelector('.app-dialog')");
      const prompt=await page.eval("document.querySelector('.app-dialog').textContent");
      for(const [index,name] of photoNames.entries()){
        const weekday=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index];
        assert.ok(prompt.includes(`${weekday}: ${name}`),prompt);
      }
      assert.match(prompt,/dedicated copies/i);
      assert.deepEqual(await photoMeta(page),{});
      await assertNoPhotoWrites(page,assert);
      await finishPhotoChoice(page,'cancel');
      assert.deepEqual(await photoMeta(page),{});
      await assertNoPhotoWrites(page,assert);

      await startPhotoChoice(page);
      await finishPhotoChoice(page);
      assert.deepEqual(await photoMeta(page),{photoFolder:'KL-TEST-DEDICATED-PHOTOS',photoNames});
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.deepEqual(await page.eval("photoTest.events.find(event=>event.kind==='picker').options"),
        {id:'keeplocal-photos',mode:'readwrite'});
    });
  });

  await check('P2.1 unsafe photo selections report their reason and preserve folder and metadata',async()=>{
    await withPhotosPage(async page=>{
      let scenario=0;
      for(const [work,message] of [
        ['await photoTest.fill(6)',/found 6/i],
        ['await photoTest.fill(8)',/found 8/i],
        ["await photoTest.fill();await photoTest.seed(photoTest.names[0],Uint8Array.of(0xff,0xd8,0xff,0))",/fictional-1\.jpg/i],
        ["photoTest.selection='vault'",/vault folder/i],
        ["photoTest.selection='keeplocal-history'",/history and preserved/i],
        ["photoTest.selection='keeplocal-preserved'",/history and preserved/i],
      ]){
        await page.eval(`photoTest.folderName='KL-TEST-REJECT-${++scenario}';${work}`);
        await openPhotoSettings(page,assert);
        await clearPhotoSpies(page);
        await startPhotoChoice(page);
        await page.until("!document.querySelector('[data-photo-action=choose]')?.disabled");
        assert.match(await page.eval("document.querySelector('#toast-container .toast:last-child')?.textContent||''"),message);
        assert.equal(await page.eval("!!document.querySelector('.app-dialog')"),false);
        assert.deepEqual(await photoMeta(page),{});
        await assertNoPhotoWrites(page,assert);
        await closeSettings(page);
      }
    });
  });

  await check('P2.1 photo access is requested by the settings control and disconnect clears only its receipt',async()=>{
    await withPhotosPage(async page=>{
      await page.eval('await photoTest.fill()');
      await openPhotoSettings(page,assert);
      await startPhotoChoice(page);
      await finishPhotoChoice(page);
      await closeSettings(page);
      await page.eval("photoTest.permission='denied';photoTest.requested='granted'");
      await openPhotoSettings(page,assert);
      await page.until("!!document.querySelector('[data-photo-action=allow]')");
      await clearPhotoSpies(page);
      await page.eval("document.querySelector('[data-photo-action=allow]').click()");
      await page.until("!document.querySelector('[data-photo-action=allow]')");
      assert.equal(await page.eval("photoTest.events[0]?.kind"),'request');
      await assertNoPhotoWrites(page,assert);

      await page.eval("document.querySelector('[data-photo-action=disconnect]').click()");
      await page.until("!document.querySelector('[data-photo-action=disconnect]')");
      assert.deepEqual(await photoMeta(page),{});
      assert.ok(await page.eval("(await import('./js/db.js')).getMeta('syncFolder')"));
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
    });
  });

  await check('P2.1 settings hide the photos group while the vault folder is disconnected',async()=>{
    await withPhotosPage(async page=>{
      await openPhotoSettings(page,assert,'choose');
      assert.equal(await page.eval(`!!document.querySelector('${PHOTOS}')`),false);
      assert.deepEqual(await photoMeta(page),{});
    },{connected:false});
  });

  await check('P2.1 photo settings are cleared with the vault connection and when replacing the local vault',async()=>{
    await withPhotosPage(async page=>{
      await page.eval("await photoTest.fill()");
      const seed=()=>page.eval(`(async()=>{
        const db=await import('./js/db.js');
        await db.saveMeta('photoFolder',await photoTest.directory());
        await db.saveMeta('photoNames',photoTest.names);
        await db.saveMeta('photoWrittenDay','2026-01-12');
        await db.saveMeta('photoWrittenAt',123456);
      })()`);
      await seed();
      await page.eval(`(async()=>{
        const db=await import('./js/db.js');
        const {meta}=await db.readVault();
        await db.storeFolderConnection(null,meta,meta.vaultId);
      })()`);
      assert.deepEqual(await photoMeta(page),{});
      await seed();
      await page.eval(`(async()=>{
        const db=await import('./js/db.js');
        const {notes,meta}=await db.readVault();
        await db.replaceVault({notes,meta:{...meta,vaultId:crypto.randomUUID()}},meta);
      })()`);
      assert.deepEqual(await photoMeta(page),{});
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
    });
  });
}

async function configurePhotos(page,assert){
  await page.eval('photoTest.fill()');
  await openPhotoSettings(page,assert);
  await startPhotoChoice(page);
  await finishPhotoChoice(page);
  await closeSettings(page);
}
async function setPhotoTime(page,localTime){
  await page.send('Emulation.setTimezoneOverride',{timezoneId:'America/Sao_Paulo'});
  await page.eval(`(async()=>{
    const session=await import('./js/session.js');
    const key=await session.getSessionKey(),id=session.getSessionVaultId();
    if(!photoTest.clock){
      const NativeDate=Date;
      photoTest.clock=true;
      window.Date=class extends NativeDate {
        constructor(...args){super(...(args.length?args:[photoTest.time]));}
        static now(){return photoTest.time;}
      };
    }
    photoTest.time=Date.parse(${JSON.stringify(localTime)});
    session.storeSessionKey(key,id);
  })()`);
}
const readPhoto=(page,name)=>page.eval(`photoTest.bytes(${JSON.stringify(name)})`);
const writePhoto=(page,name,bytes)=>page.eval(`photoTest.seed(${JSON.stringify(name)},Uint8Array.fromBase64(${JSON.stringify(Buffer.from(bytes).toString('base64'))}))`);
const MAIN='keeplocal-vault.keeplocal';
const principal=page=>readFolderFixture(page,MAIN);
async function autoWrite(page,revision){
  const id=await page.eval("(await import('./js/app.js')).getNotes()[0].id");
  await editNote(page,id,{content:`Fictional photo revision ${revision}`});
  await focus(page);
  await waitForRev(page,revision);
  await waitForFolderLineage(page);
  await page.until("!!document.querySelector('[data-folder-state=saved]')");
  return principal(page);
}
async function assertPhoto(page,assert,{name,image,main}){
  const raw=Buffer.from(await readPhoto(page,name),'base64');
  const {image:prefix,copy}=photoParts(raw)??{};
  assert.deepEqual(prefix,Buffer.from(image,'base64'));
  assert.ok(copy?.length,'today’s photo must contain the principal');
  assert.deepEqual(copy,Buffer.from(main,'base64'));
  assert.equal(raw.length,prefix.length+copy.length+4);
  assert.deepEqual(await page.eval(`(async()=>{
    const bitmap=await createImageBitmap(new Blob([Uint8Array.fromBase64(${JSON.stringify(raw.toString('base64'))})]));
    const size=[bitmap.width,bitmap.height];bitmap.close();return size;
  })()`),[12,8]);
}
async function assertPhotoStatus(page,assert,pattern){
  await openPhotoSettings(page,assert);
  await page.until(`new RegExp(${JSON.stringify(pattern.source)},${JSON.stringify(pattern.flags)}).test(document.querySelector('[data-photo-status]')?.textContent||'')`);
  assert.match(await status(page),pattern);
  await closeSettings(page);
}

export async function runAutomaticPhotos({check,assert}){
  await check('P2.2 writes exact principal bytes in the daily JPEG or PNG only when the local hour or day changes',async()=>{
    await withPhotosPage(async page=>{
      const monday=photoNames[0],tuesday=photoNames[1];
      await setPhotoTime(page,'2026-01-12T22:30:00');
      await configurePhotos(page,assert);
      const mondayImage=await readPhoto(page,monday),tuesdayImage=await readPhoto(page,tuesday);
      await clearPhotoSpies(page);
      await assertPhoto(page,assert,{name:monday,image:mondayImage,main:await autoWrite(page,2)});
      const accesses=await page.eval("photoTest.events.filter(({kind})=>kind==='read').map(({name})=>name)");
      assert.deepEqual([...new Set(accesses)],[monday]);
      const initialReceipt=await photoMeta(page);
      assert.equal(initialReceipt.photoWrittenDay,'2026-01-12');
      assert.equal(initialReceipt.photoWrittenAt,Date.parse('2026-01-13T01:30:00Z'));
      await assertPhotoStatus(page,assert,/Photos: written.*fictional-1\.jpg/i);

      await setPhotoTime(page,'2026-01-12T23:00:00');
      await clearPhotoSpies(page);
      await autoWrite(page,3);
      assert.deepEqual(await page.eval('photoTest.events'),[]);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.deepEqual(await photoMeta(page),initialReceipt);

      await setPhotoTime(page,'2026-01-12T23:30:00');
      await assertPhoto(page,assert,{name:monday,image:mondayImage,main:await autoWrite(page,4)});
      const oldMonday=await readPhoto(page,monday);
      await setPhotoTime(page,'2026-01-13T00:00:00');
      await assertPhoto(page,assert,{name:tuesday,image:tuesdayImage,main:await autoWrite(page,5)});
      assert.equal(await readPhoto(page,monday),oldMonday);
      assert.equal((await photoMeta(page)).photoWrittenDay,'2026-01-13');
    });
  });

  await check('P2.2 a normal merge which retains the local vault writes its verified principal to the daily photo',async()=>{
    await withPhotosPage(async page=>{
      await setPhotoTime(page,'2026-01-12T15:00:00');
      await configurePhotos(page,assert);
      const name=photoNames[0],image=await readPhoto(page,name);
      const {key,salt,payload,payloadText}=await decodeV2(Buffer.from(await principal(page),'base64'),PASSWORD);
      const incoming=await encodeV2(key,salt,{...payload,rev:2,parent:await payloadHash(payloadText),
        preferences:{...payload.preferences,theme:'light'}});
      await writeFolderFixture(page,MAIN,Buffer.from(incoming).toString('base64'));
      await page.eval("(await import('./js/db.js')).saveMeta('theme','dark')");
      await focus(page);
      await waitForRev(page,3);
      await waitForFolderLineage(page);
      await assertPhoto(page,assert,{name,image,main:await principal(page)});
      assert.equal((await photoMeta(page)).photoWrittenDay,'2026-01-12');
    });
  });

  await check('P2.2 preserves exact newer and unopenable trailers before replacing the daily photo',async()=>{
    await withPhotosPage(async page=>{
      await setPhotoTime(page,'2026-01-12T15:00:00');
      await configurePhotos(page,assert);
      const name=photoNames[0],image=await readPhoto(page,name);
      const {key,salt,payload}=await decodeV2(Buffer.from(await principal(page),'base64'),PASSWORD);
      const newer=await encodeV2(key,salt,{...payload,rev:100});
      const opaque=new Uint8Array(71).fill(0x4a);
      for(const [index,oldCopy] of [newer,opaque].entries()){
        await setPhotoTime(page,`2026-01-12T${15+index}:00:00`);
        await writePhoto(page,name,buildPhoto(Buffer.from(image,'base64'),oldCopy));
        await assertPhoto(page,assert,{name,image,main:await autoWrite(page,index+2)});
        const copies=await page.eval(`(async()=>{
          const folder=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
          const bytes=[];
          for await(const entry of folder.values()){
            bytes.push(new Uint8Array(await (await entry.getFile()).arrayBuffer()).toBase64());
          }
          return bytes;
        })()`);
        assert.ok(copies.includes(Buffer.from(oldCopy).toString('base64')));
      }
    });
  });

  await check('P2.2 leaves an unknown image boundary intact and accepts a clean replacement at the same name',async()=>{
    await withPhotosPage(async page=>{
      await setPhotoTime(page,'2026-01-12T14:00:00');
      await configurePhotos(page,assert);
      const name=photoNames[0],image=await readPhoto(page,name);
      const unknown=Buffer.concat([Buffer.from(image,'base64'),Buffer.of(0,1,2,3,4)]);
      await writePhoto(page,name,unknown);
      await clearPhotoSpies(page);
      const main=await autoWrite(page,2);
      assert.equal(await readPhoto(page,name),unknown.toString('base64'));
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.equal((await photoMeta(page)).photoWrittenAt,undefined);
      await assertPhotoStatus(page,assert,/image end in fictional-1\.jpg could not be recognized/i);
      assert.equal(await principal(page),main);
      await writePhoto(page,name,Buffer.from(image,'base64'));
      await assertPhoto(page,assert,{name,image,main:await autoWrite(page,3)});
    });
  });

  await check('P2.2 failed live photo checks leave the normal primary receipt and keep the photo receipt pending',async()=>{
    await withPhotosPage(async page=>{
      await setPhotoTime(page,'2026-01-12T13:00:00');
      await configurePhotos(page,assert);
      const name=photoNames[0],image=await readPhoto(page,name);
      await page.eval("photoTest.permission='denied'");
      await clearPhotoSpies(page);
      const denied=await autoWrite(page,2);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.equal(await readPhoto(page,name),image);
      assert.equal((await photoMeta(page)).photoWrittenAt,undefined);
      await assertPhotoStatus(page,assert,/permission to write photos was not granted/i);
      assert.equal(await principal(page),denied);
      assert.equal(await page.eval("photoTest.events.filter(({kind})=>kind==='request').length"),0);

      await page.eval("photoTest.permission='granted';await photoTest.seed('fictional-extra.png',await photoTest.image(7))");
      await clearPhotoSpies(page);
      const changed=await autoWrite(page,3);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.equal(await readPhoto(page,name),image);
      assert.equal((await photoMeta(page)).photoWrittenAt,undefined);
      await assertPhotoStatus(page,assert,/photos folder changed.*choose it again/i);
      assert.equal(await principal(page),changed);

      await page.eval("await (await photoTest.directory()).removeEntry('fictional-extra.png');photoTest.holdRead=true");
      await clearPhotoSpies(page);
      const timeout=await autoWrite(page,4);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.equal(await readPhoto(page,name),image);
      await page.eval('photoTest.releaseRead?.()');
      assert.equal((await photoMeta(page)).photoWrittenAt,undefined);
      await assertPhotoStatus(page,assert,/photos folder did not respond/i);
      assert.equal(await principal(page),timeout);

      await page.eval('photoTest.tamperReadback=true');
      const unread=await autoWrite(page,5);
      assert.equal((await photoMeta(page)).photoWrittenAt,undefined);
      await assertPhotoStatus(page,assert,/could not verify the written photo/i);
      assert.equal(await principal(page),unread);
    });
  });
}

const WRITE_NOW='#write-now-btn';

async function newBarDraft(page,title){
  await page.eval(`document.querySelector('.new-note-collapsed').click();
    const input=document.querySelector('#new-note-title');
    input.value=${JSON.stringify(title)};
    input.dispatchEvent(new Event('input',{bubbles:true}));`);
}

async function waitWriteNowToast(page,pattern){
  await page.until(`[...document.querySelectorAll('#toast-container .toast')].some(toast=>
    new RegExp(${JSON.stringify(pattern.source)},${JSON.stringify(pattern.flags)}).test(toast.textContent))`);
}

export async function runWriteNow({check,assert}){
  await check('P2.3 Write now saves the new note bar and writes and verifies the principal without photos',async()=>{
    await withPhotosPage(async page=>{
      await page.until(`!!document.querySelector('${WRITE_NOW}')`,7000);
      assert.equal(await page.eval(`document.querySelector('${WRITE_NOW}').previousElementSibling.id`),'backup-btn');
      await newBarDraft(page,'Fictional manual folder draft');
      await page.eval(`document.querySelector('${WRITE_NOW}').click()`);
      await waitWriteNowToast(page,/written to the folder file at \d{2}:\d{2}/i);
      const {payload}=await decodeV2(Buffer.from(await principal(page),'base64'),PASSWORD);
      assert.equal(payload.notes.length,2);
      assert.deepEqual(await page.eval('photoTest.events'),[]);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
    });
  });

  await check('P2.3 Write now requests photo access first and forces one photo write within the hour',async()=>{
    await withPhotosPage(async page=>{
      await page.until(`!!document.querySelector('${WRITE_NOW}')`,7000);
      await configurePhotos(page,assert);
      const name=photoNames[0],image=await readPhoto(page,name);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      const before=await autoWrite(page,2);
      const previous=await photoMeta(page);
      await setPhotoTime(page,'2026-08-17T10:15:00');
      await page.eval(`photoTest.clear();photoTest.permission='prompt';photoTest.holdRead=true;
        document.querySelector('${WRITE_NOW}').click()`);
      await page.until('!!photoTest.releaseRead');
      assert.deepEqual(await page.eval('photoTest.events[0]'),{kind:'request',active:true});
      assert.equal(await page.eval(`document.querySelector('${WRITE_NOW}').disabled`),true);
      await page.eval(`document.querySelector('${WRITE_NOW}').click();photoTest.releaseRead()`);
      await waitWriteNowToast(page,/and in today.s photo \(fictional-1\.jpg\)/);
      assert.equal(await page.eval('photoTest.writes.length'),1);
      assert.equal(await page.eval("photoTest.events.filter(event=>event.kind==='request').length"),1);
      assert.equal(await page.eval(`document.querySelector('${WRITE_NOW}').disabled`),false);
      assert.ok((await photoMeta(page)).photoWrittenAt>previous.photoWrittenAt);
      assert.equal(await principal(page),before);
      await assertPhoto(page,assert,{name,image,main:before});
    });
  });

  await check('P2.3 Write now reports a verified principal even when the photo fails',async()=>{
    await withPhotosPage(async page=>{
      await page.until(`!!document.querySelector('${WRITE_NOW}')`,7000);
      await configurePhotos(page,assert);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      await newBarDraft(page,'Fictional draft with unavailable photo access');
      await page.eval(`photoTest.clear();photoTest.permission='prompt';photoTest.requested='denied';
        document.querySelector('${WRITE_NOW}').click()`);
      await waitWriteNowToast(page,/written to the folder file at .*photo.*permission/is);
      const {payload}=await decodeV2(Buffer.from(await principal(page),'base64'),PASSWORD);
      assert.equal(payload.notes.length,2);
      assert.equal(await page.eval('photoTest.writes.length'),0);
    });
  });

  await check('P2.3 Write now reports the folder failure and leaves the draft saved in this browser',async()=>{
    await withPhotosPage(async page=>{
      await page.until(`!!document.querySelector('${WRITE_NOW}')`,7000);
      await newBarDraft(page,'Fictional draft in this browser');
      await page.eval(`folderTest.removeBeforeWrite=true;document.querySelector('${WRITE_NOW}').click()`);
      await waitWriteNowToast(page,/not written to the folder file:.*folder not found.*saved in this browser/is);
      assert.equal(await page.eval(`!!document.querySelector('${WRITE_NOW}')`),false);
      assert.ok(await page.eval("(await import('./js/app.js')).getNotes().some(note=>note.title==='Fictional draft in this browser')"));
    });
  });
  await check('P2.3 Write now leaves an unfamiliar primary intact and opens the usual review',async()=>{
    await withPhotosPage(async page=>{
      await page.until(`!!document.querySelector('${WRITE_NOW}')`,7000);
      await configurePhotos(page,assert);
      const foreign=Buffer.alloc(64,23).toString('base64');
      await writeFolderFixture(page,MAIN,foreign);
      await page.eval(`photoTest.clear();document.querySelector('${WRITE_NOW}').click()`);
      await page.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await waitWriteNowToast(page,/resolve the folder review/i);
      assert.equal(await principal(page),foreign);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
    });
  });
}

async function importPhoto(page,name,encoded){
  await page.eval("document.querySelector('#folder-settings-btn').click()");
  await page.until("!!document.querySelector('[data-folder-action=importBackup]')");
  await page.eval("document.querySelector('[data-folder-action=importBackup]').click()");
  await page.until("!!document.querySelector('#import-btn')");
  await page.eval(`(()=>{
    const file=new File([Uint8Array.fromBase64(${JSON.stringify(encoded)})],${JSON.stringify(name)});
    const data=new DataTransfer();
    data.items.add(file);
    const input=document.querySelector('#import-file');
    input.files=data.files;
    input.dispatchEvent(new Event('change'));
    const password=document.querySelector('#import-password');
    password.value=${JSON.stringify(PASSWORD)};
    password.dispatchEvent(new Event('input'));
    document.querySelector('#import-btn').click();
  })()`);
}

export async function runPhotoImport({check,assert}){
  await check('P2.4 Import backup restores the daily photo and preserves the connected browser’s newer edit',async()=>{
    await withPhotosPage(async page=>{
      await configurePhotos(page,assert);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      const main=await autoWrite(page,2),name=photoNames[0];
      const {copy}=photoParts(Buffer.from(await readPhoto(page,name),'base64'));
      assert.equal(copy.toString('base64'),main);
      await setPhotoTime(page,'2026-08-17T10:10:00');
      const changed=await autoWrite(page,3);
      await clearPhotoSpies(page);
      await importPhoto(page,name,await readPhoto(page,name));
      await page.until("!!document.querySelector('.app-dialog')||!!document.querySelector('#import-error')?.textContent");
      assert.ok(await page.eval("!!document.querySelector('.app-dialog')"),
        await page.eval("document.querySelector('#import-error')?.textContent"));
      assert.match(await page.eval("document.querySelector('.app-dialog').textContent"),
        /will preserve your current vault in keeplocal-preserved\//i);
      assert.match(await page.eval("document.querySelector('#import-file').accept"),/\.jpg/);
      await page.eval("document.querySelector('[data-dialog-action=confirm]').click()");
      await page.until("!document.querySelector('#import-form')&&!document.querySelector('.app-dialog')&&(await import('./js/app.js')).getNotes()[0]?.content==='Fictional photo revision 2'");
      assert.deepEqual(await photoMeta(page),{});
      assert.equal(await principal(page),changed);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      const preserved=await page.eval(`(async()=>{
        const dir=await (await folderTest.directory()).getDirectoryHandle('keeplocal-preserved');
        const copies=[];
        for await(const entry of dir.values())copies.push(new Uint8Array(await (await entry.getFile()).arrayBuffer()).toBase64());
        return copies;
      })()`);
      assert.equal(preserved.length,1);
      const {decryptRecords}=await import('../../js/backup-format.js');
      const {key,payload}=await decodeV2(Buffer.from(preserved[0],'base64'),PASSWORD);
      assert.equal((await decryptRecords(payload.notes,key))[0].content,'Fictional photo revision 3');
    });
  });

  await check('P2.4 Import backup reports a clean image without offering to replace the vault',async()=>{
    await withPhotosPage(async page=>{
      await page.eval('photoTest.fill()');
      const before=await principal(page);
      await clearPhotoSpies(page);
      await importPhoto(page,'fictional-vault.keeplocal',await readPhoto(page,photoNames[1]));
      await page.until("!!document.querySelector('#import-error')?.textContent");
      assert.match(await page.eval("document.querySelector('#import-error').textContent"),/this photo does not contain a vault copy/i);
      assert.equal(await page.eval("!!document.querySelector('.app-dialog')"),false);
      assert.equal(await principal(page),before);
      await assertNoPhotoWrites(page,assert);
    });
  });
  await check('P2.4 a raw profile 2 backup whose salt starts with a JPEG signature still imports',async()=>{
    const salt=Uint8Array.from([0xff,0xd8,0xff,1,2,3,4,5,6,7,8,9,10,11,12,13]);
    const fixture=await backupFixture(undefined,PASSWORD,salt);
    const browser=await launchExtension();
    try{
      const page=await browser.page();
      const imported=await page.eval(`(async()=>{
        const {importBackup}=await import('./js/backup.js');
        const bytes=Uint8Array.fromBase64(${JSON.stringify(fixture.base64)});
        await importBackup(new File([bytes],'fictional-raw.keeplocal'),${JSON.stringify(PASSWORD)});
        return (await (await import('./js/db.js')).getAllNoteRecords()).length;
      })()`);
      assert.equal(imported,fixture.records.length);
    }finally{await browser.close();}
  });
}

export async function runPhotoLimits({check,assert}){
  await check('P2.6 the HTTP app and the extension without a vault folder omit Write now',async()=>{
    const browser=await launch();
    try{
      const page=await browser.page();
      await create(page);
      assert.equal(await page.eval(`!!document.querySelector('${WRITE_NOW}')`),false);
    }finally{await browser.close();}
    await withPhotosPage(async page=>{
      assert.equal(await page.eval(`!!document.querySelector('${WRITE_NOW}')`),false);
    },{connected:false});
  });

  await check('P2.6 login, read-only and copy view make no photo reads or writes',async()=>{
    await withPhotosPage(async page=>{
      await configurePhotos(page,assert);
      await page.eval("document.querySelector('#lock-btn').click()");
      await page.until("!!document.querySelector('#login-password')");
      await page.eval("photoTest.clear();photoTest.permission='prompt';folderTest.permission='denied'");
      await submitExtensionLogin(page);
      await page.until("!!document.querySelector('[data-folder-action=openReadOnly]')");
      assert.equal(await page.eval(`!!document.querySelector('${WRITE_NOW}')`),false);
      await page.eval("document.querySelector('[data-folder-action=openReadOnly]').click()");
      await page.until("!!document.querySelector('[data-vault-read-only] .note-card')");
      assert.equal(await page.eval(`!!document.querySelector('${WRITE_NOW}')`),false);
      await focus(page);
      await waitForFolderLineage(page);
      assert.deepEqual(await page.eval('photoTest.events'),[]);
      await assertNoPhotoWrites(page,assert);

      await page.reload();
      await page.until("!!window.photoTest&&!!document.querySelector('#login-password')");
      await page.eval("photoTest.permission='prompt';folderTest.permission='granted'");
      await submitExtensionLogin(page);
      await page.until(`!!document.querySelector('${WRITE_NOW}')&&!!document.querySelector('.note-card')`);
      await waitForFolderLineage(page);
      assert.deepEqual(await page.eval('photoTest.events'),[]);
      await openCopyList(page,assert);
      await openSelectedCopy(page);
      assert.equal(await page.eval(`!!document.querySelector('${WRITE_NOW}')`),false);
      await focus(page);
      await waitForFolderLineage(page);
      assert.deepEqual(await page.eval("photoTest.events.filter(({kind})=>kind!=='query')"),[]);
      await assertNoPhotoWrites(page,assert);
    });
  });

  await check('P2-B1 an explicit other-passphrase replacement keeps photos until the vault folder changes',async()=>{
    await withPhotosPage(async page=>{
      await configurePhotos(page,assert);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      await autoWrite(page,2);
      const name=photoNames[0],before=await readPhoto(page,name);
      const configured=await photoMeta(page);
      const foreign=Buffer.alloc(64,31).toString('base64');
      await writeFolderFixture(page,MAIN,foreign);
      await clearPhotoSpies(page);
      await focus(page);
      await page.until("!!document.querySelector('[data-folder-status=otherSalt]')");
      await page.eval("document.querySelector('[data-folder-action=useLocal]').click()");
      await page.until("!!document.querySelector('.app-dialog input')");
      await page.eval(`(async()=>{
        const input=document.querySelector('.app-dialog input');
        input.value=(await import('./js/i18n.js')).t('folder.replaceWord');
        input.dispatchEvent(new Event('input'));
        input.closest('form').requestSubmit();
      })()`);
      await waitForRev(page,3);
      await page.until(`!!document.querySelector('${WRITE_NOW}')`);
      await waitForFolderLineage(page);
      assert.deepEqual(await photoMeta(page),configured);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.equal(await readPhoto(page,name),before);

      await openPhotoSettings(page,assert);
      assert.match(await status(page),/photos: written on/i);
      await page.eval("folderTest.name='KL-TEST-NEW-VAULT-PHOTOS';photoTest.clear();document.querySelector('[data-folder-action=change]').click()");
      await page.until("(await import('./js/db.js')).getMeta('syncFolder').then(folder=>folder?.name==='KL-TEST-NEW-VAULT-PHOTOS')");
      await waitForFolderLineage(page);
      assert.deepEqual(await photoMeta(page),{});
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      assert.equal(await readPhoto(page,name),before);
    });
  });

  await check('P2.6 Write now flushes an open editor into the photo; Backup still only exports',async()=>{
    await withPhotosPage(async page=>{
      await configurePhotos(page,assert);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      const name=photoNames[0],image=await readPhoto(page,name);
      await page.eval("document.querySelector('.note-card').click()");
      await page.until("!!document.querySelector('#modal-editor')");
      await page.eval(`const editor=document.querySelector('#modal-editor');
        editor.value='Fictional open editor text for today';
        editor.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('${WRITE_NOW}').click();`);
      await waitWriteNowToast(page,/and in today.s photo/);
      const main=await principal(page);
      const {decryptRecords}=await import('../../js/backup-format.js');
      const {key,payload}=await decodeV2(Buffer.from(main,'base64'),PASSWORD);
      assert.equal((await decryptRecords(payload.notes,key))[0].content,'Fictional open editor text for today');
      await assertPhoto(page,assert,{name,image,main});
      const before=await photoMeta(page);
      await page.eval(`photoTest.clear();window.testBackup=null;
        URL.createObjectURL=blob=>{window.testBackup=blob;return 'blob:fixture';};
        URL.revokeObjectURL=()=>{};
        HTMLAnchorElement.prototype.click=()=>{};
        document.querySelector('#backup-btn').click();`);
      await page.until('!!testBackup');
      await waitForFolderLineage(page);
      assert.equal(await principal(page),main);
      assert.deepEqual(await photoMeta(page),before);
      assert.deepEqual(await page.eval('photoTest.events'),[]);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
    });
  });
  await check('P2.6 moved photo files and a missing photos folder leave each primary write verified',async()=>{
    await withPhotosPage(async page=>{
      await configurePhotos(page,assert);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      const untouched=await readPhoto(page,photoNames[1]);
      await page.eval(`const folder=await photoTest.directory();
        await photoTest.seed('fictional-new.png',await photoTest.image(7));
        await folder.removeEntry(photoTest.names[0]);`);
      await clearPhotoSpies(page);
      const renamed=await autoWrite(page,2);
      await assertPhotoStatus(page,assert,/photos folder changed/i);
      assert.equal(await readPhoto(page,photoNames[1]),untouched);
      assert.equal(await principal(page),renamed);

      await page.eval("await (await photoTest.directory()).removeEntry('fictional-new.png')");
      const tooFew=await autoWrite(page,3);
      await assertPhotoStatus(page,assert,/photos folder changed/i);
      assert.equal(await readPhoto(page,photoNames[1]),untouched);
      assert.equal(await principal(page),tooFew);

      await page.eval("await (await navigator.storage.getDirectory()).removeEntry(photoTest.folderName,{recursive:true})");
      const missing=await autoWrite(page,4);
      await assertPhotoStatus(page,assert,/photos folder could not be accessed/i);
      assert.equal(await principal(page),missing);
      assert.equal((await photoMeta(page)).photoWrittenAt,undefined);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
    });
  });
  await check('P2.6 confirmation and write receipt show literal photo filenames',async()=>{
    await withPhotosPage(async page=>{
      const name='fictional-$&.jpg';
      await page.eval(`await photoTest.fill();
        await photoTest.seed(${JSON.stringify(name)},await photoTest.image(0));
        await (await photoTest.directory()).removeEntry(photoTest.names[0]);`);
      await openPhotoSettings(page,assert);
      await startPhotoChoice(page);
      await page.until("!!document.querySelector('.app-dialog')");
      assert.ok(await page.eval(`document.querySelector('.app-dialog').textContent.includes(${JSON.stringify('Mon: '+name)})`));
      await finishPhotoChoice(page);
      await closeSettings(page);
      await setPhotoTime(page,'2026-08-17T10:00:00');
      await page.eval(`document.querySelector('${WRITE_NOW}').click()`);
      await waitWriteNowToast(page,/fictional-\$&\.jpg/i);
    });
  });
}

const connectionId=page=>page.eval("(await import('./js/db.js')).getMeta('folderConnectionId')");

async function photoReceipt(page,assert){
  await setPhotoTime(page,'2026-01-12T15:00:00');
  await configurePhotos(page,assert);
  const name=photoNames[0],image=await readPhoto(page,name);
  await assertPhoto(page,assert,{name,image,main:await autoWrite(page,2)});
  return {name,image,configured:await photoMeta(page),connection:await connectionId(page)};
}

async function receivePhotoRevision(page,{merge=false}={}){
  const {key,salt,payload,payloadText}=await decodeV2(Buffer.from(await principal(page),'base64'),PASSWORD);
  const parent=await payloadHash(payloadText);
  const remoteTitle='Fictional note from the other PC';
  const notes=merge?[...payload.notes,...(await backupFixture([note({title:remoteTitle})],PASSWORD,salt)).records]:payload.notes;
  const revision=payload.rev+1;
  const incoming=await encodeV2(key,salt,{...payload,rev:revision,parent,
    ancestors:[parent,...payload.ancestors].slice(0,32),
    clock:{...payload.clock,'00000000-0000-4000-8000-0000000000b2':1},
    preferences:{...payload.preferences,theme:'light'},notes,manifest:{count:notes.length,ids:notes.map(n=>n.id)}});
  await page.eval("window.previousPhotoShell=document.querySelector('.app-view');photoTest.clear()");
  await writeFolderFixture(page,MAIN,Buffer.from(incoming).toString('base64'));
  if(merge){
    const id=await page.eval("(await import('./js/app.js')).getNotes()[0].id");
    await editNote(page,id,{content:'Fictional edit before the merge'});
  }
  await focus(page);
  await waitForRev(page,merge?revision+1:revision);
  await page.until("!!document.querySelector('#write-now-btn')&&document.querySelector('.app-view')!==previousPhotoShell");
  await ready(page);
  if(merge)await waitForNotes(page,[true,true],list=>[
    list.some(note=>note.title==='Fictional note from the other PC'),
    list.some(note=>note.content==='Fictional edit before the merge'),
  ]);
  await waitForFolderLineage(page);
}

async function confirmPhotoReview(page,action,wordKey='folder.replaceWord'){
  await page.eval(`document.querySelector('[data-folder-action=${action}]').click()`);
  await page.until("!!document.querySelector('.app-dialog input')");
  await page.eval(`(async()=>{
    const input=document.querySelector('.app-dialog input');
    input.value=(await import('./js/i18n.js')).t(${JSON.stringify(wordKey)});
    input.dispatchEvent(new Event('input'));
    input.closest('form').requestSubmit();
  })()`);
}

export async function runPhotoConnection({check,assert}){
  for(const merge of [false,true]){
    await check(`P2-B1 ${merge?'a merge that applies local data':'a pull from another PC'} keeps the photo receipt and the next eligible write updates it`,async()=>{
      await withPhotosPage(async page=>{
        const {name,image,configured,connection}=await photoReceipt(page,assert);
        await setPhotoTime(page,'2026-01-12T15:10:00');
        await receivePhotoRevision(page,{merge});
        assert.equal(await connectionId(page),connection);
        assert.deepEqual(await photoMeta(page),configured);
        assert.deepEqual(await page.eval('photoTest.events'),[]);
        assert.deepEqual(await page.eval('photoTest.writes'),[]);
        await setPhotoTime(page,'2026-01-12T17:00:00');
        const main=await autoWrite(page,merge?5:4);
        await assertPhoto(page,assert,{name,image,main});
        assert.ok((await photoMeta(page)).photoWrittenAt>configured.photoWrittenAt);
      });
    });
  }

  await check('P2-B1 Write now immediately after a pull can request permission and force the photo',async()=>{
    await withPhotosPage(async page=>{
      const {name,image,configured}=await photoReceipt(page,assert);
      await setPhotoTime(page,'2026-01-12T15:10:00');
      await receivePhotoRevision(page);
      const main=await principal(page);
      await page.eval(`photoTest.clear();photoTest.permission='prompt';document.querySelector('${WRITE_NOW}').click()`);
      await page.until("!!document.querySelector('#toast-container .toast:last-child')?.textContent");
      assert.deepEqual(await page.eval('photoTest.events[0]'),{kind:'request',active:true});
      await waitWriteNowToast(page,/and in today.s photo/i);
      await assertPhoto(page,assert,{name,image,main});
      assert.ok((await photoMeta(page)).photoWrittenAt>configured.photoWrittenAt);
      assert.equal(await principal(page),main);
    });
  });

  for(const action of ['useFolder','useLocal']){
    await check(`P2-B1 the explicit ${action} review choice keeps the receipt without a photo write`,async()=>{
      await withPhotosPage(async page=>{
        const older=await principal(page);
        const {name,image,configured,connection}=await photoReceipt(page,assert);
        await setPhotoTime(page,'2026-01-12T15:10:00');
        await clearPhotoSpies(page);
        await writeFolderFixture(page,MAIN,older);
        await focus(page);
        await page.until("!!document.querySelector('[data-folder-status=rollback]')");
        await confirmPhotoReview(page,action);
        await page.until("!!document.querySelector('#write-now-btn')&&!document.querySelector('.app-dialog')");
        await ready(page);
        await waitForFolderLineage(page);
        assert.equal(await connectionId(page),connection);
        assert.deepEqual(await photoMeta(page),configured);
        assert.deepEqual(await page.eval('photoTest.writes'),[]);
        await setPhotoTime(page,'2026-01-12T17:00:00');
        await assertPhoto(page,assert,{name,image,main:await autoWrite(page,action==='useLocal'?4:3)});
      });
    });
  }

  await check('P2-B1 folder replacement retains only the current transaction photo metadata of the same connection',async()=>{
    await withPhotosPage(async page=>{
      await photoReceipt(page,assert);
      const apply=connection=>page.eval(`(async()=>{
        const db=await import('./js/db.js');
        const {readFolderCandidate}=await import('./js/folder-vault.js');
        const {notes,meta}=await db.readVault();
        const handle=await folderTest.directory();
        const key=(await import('./js/app.js')).getCryptoKey();
        const head=await readFolderCandidate(await handle.getFileHandle('${MAIN}'),key,meta.salt);
        await db.saveMeta('photoWrittenAt',5678);
        await db.saveMeta('photoWrittenDay','2026-01-13');
        await db.replaceVaultFromFolder({notes,meta:{...meta,
          folderConnectionId:${connection?JSON.stringify(connection):'meta.folderConnectionId'},
          photoFolder:handle,photoNames:['untrusted.jpg'],photoWrittenAt:1,photoWrittenDay:'2000-01-01',
        }},meta,{head});
      })()`);
      const configured=await photoMeta(page);
      await apply();
      assert.deepEqual(await photoMeta(page),{...configured,photoWrittenAt:5678,photoWrittenDay:'2026-01-13'});
      await apply('fictional-new-connection');
      assert.deepEqual(await photoMeta(page),{});
    });
  });

  await check('P2-B1 a typed reset clears the photos and keeps the files',async()=>{
    await withPhotosPage(async page=>{
      const {name}=await photoReceipt(page,assert);
      const main=await principal(page),photo=await readPhoto(page,name);
      await page.eval("document.querySelector('#lock-btn').click()");
      await page.until("!!document.querySelector('#reset-vault')");
      await page.eval("document.querySelector('#reset-vault').click()");
      await page.until("!!document.querySelector('.app-dialog input')");
      await page.eval(`(async()=>{
        const input=document.querySelector('.app-dialog input');
        input.value=(await import('./js/i18n.js')).t('account.resetWord');
        input.dispatchEvent(new Event('input'));
        input.closest('form').requestSubmit();
      })()`);
      await page.until("!(await (await import('./js/db.js')).getMeta('syncFolder'))");
      assert.deepEqual(await photoMeta(page),{});
      assert.equal(await principal(page),main);
      assert.equal(await readPhoto(page,name),photo);
    });
  });
}

export async function runPhotoEmptyStatus({check,assert}){
  for(const [lang,noFolder,noWrite] of [
    ['en','Photos: no folder chosen','Photos: no photo written yet'],
    ['pt-BR','Fotos: nenhuma pasta escolhida','Fotos: nenhuma foto gravada ainda'],
  ]){
    await check(`P2-N1 ${lang} distinguishes an unchosen photos folder from a folder with no receipt`,async()=>{
      await withPhotosPage(async page=>{
        if(lang==='pt-BR'){
          const revision=await page.eval("(await import('./js/db.js')).getMeta('folderSeenRev')");
          await page.eval("document.querySelector('#lang-toggle').click()");
          await page.until("document.documentElement.lang==='pt-BR'&&!!document.querySelector('#folder-settings-btn')");
          await focus(page);
          await waitForRev(page,revision+1);
          await waitForFolderLineage(page);
        }
        await page.eval('photoTest.fill()');
        await openPhotoSettings(page,assert);
        assert.equal(await status(page),noFolder);
        await startPhotoChoice(page);
        await finishPhotoChoice(page);
        assert.equal(await status(page),noWrite);
        await page.eval("document.querySelector('[data-photo-action=disconnect]').click()");
        await page.until("!document.querySelector('[data-photo-action=disconnect]')");
        assert.equal(await status(page),noFolder);
      });
    });
  }
}

// A newly picked handle remains readable. IndexedDB clones of the retired
// handle stall even after reload, but still compare equal to that same entry.
function installRetiredFolderFixture(){
  const retirement='fictional-retired-vault-handle';
  const retired=new WeakSet();
  const originalKeys=FileSystemDirectoryHandle.prototype.keys;
  const same=FileSystemHandle.prototype.isSameEntry;
  const put=IDBObjectStore.prototype.put;
  window.retireFolderHandle=()=>sessionStorage.setItem(retirement,'yes');
  window.folderHandleIsRetired=()=>sessionStorage.getItem(retirement)!==null;
  folderTest.handleWrites=0;
  for(const method of ['get','getAll']){
    const read=IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method]=function(...args){
      const request=read.apply(this,args);
      if(this.name==='meta'&&folderHandleIsRetired())request.addEventListener('success',()=>{
        const rows=Array.isArray(request.result)?request.result:[request.result];
        for(const row of rows)if(row?.key==='syncFolder')retired.add(row.value);
      },{once:true});
      return request;
    };
  }
  IDBObjectStore.prototype.put=function(row,...args){
    const request=put.call(this,row,...args);
    if(this.name==='meta'&&row.key==='syncFolder'&&folderHandleIsRetired()){
      this.transaction.addEventListener('complete',()=>{
        folderTest.handleWrites++;
        sessionStorage.removeItem(retirement);
      },{once:true});
    }
    return request;
  };
  FileSystemDirectoryHandle.prototype.keys=async function*(...args){
    if(retired.has(this))await new Promise(()=>{});
    yield* originalKeys.apply(this,args);
  };
  FileSystemHandle.prototype.isSameEntry=async function(other){
    if(retired.has(other)&&folderTest.beforeSameEntry)await folderTest.beforeSameEntry();
    return same.call(this,other);
  };
}
const retiredSource=`(${installRetiredFolderFixture})()`;

async function connectionMetadata(page){
  return page.eval(`(async()=>{
    const rows=await (await import('./js/db.js')).getAllMetaRecords();
    return Object.fromEntries(rows.filter(({key})=>/^(folder|writer|photo)/.test(key))
      .map(({key,value})=>[key,key==='photoFolder'?value.name:value]));
  })()`);
}

export async function runFolderHandleRefresh({check,assert}){
  await check('P3.0 S4b a same-folder picker replaces the retired handle across sign-ins',async()=>{
    await withPhotosPage(async page=>{
      const {name,image}=await photoReceipt(page,assert);
      const before=await connectionMetadata(page);
      const bytes=(await folderCopyEvidence(page)).files;
      await page.eval('retireFolderHandle()');
      await page.reload();
      await page.eval("folderTest.permission='granted'");
      await submitExtensionLogin(page);
      await page.until("!!document.querySelector('[data-folder-status=unresponsive]')");
      await page.eval("document.querySelector('[data-folder-action=chooseAnother]').click()");
      await page.until("!!document.querySelector('.app-view .note-card')&&!document.querySelector('.folder-banner')");
      await waitForFolderLineage(page);
      assert.deepEqual(await connectionMetadata(page),before);
      assert.deepEqual((await folderCopyEvidence(page)).files,bytes);
      assert.equal(await page.eval('folderTest.writeAttempts'),0);
      const refreshes=await page.eval('folderTest.handleWrites');

      await page.reload();
      await page.eval("folderTest.permission='granted'");
      await submitExtensionLogin(page);
      await page.until("!!document.querySelector('.app-view .note-card,[data-folder-status=unresponsive]')");
      assert.equal(await page.eval("document.querySelector('[data-folder-status]')?.dataset.folderStatus??null"),null);
      assert.equal(refreshes,1);
      assert.deepEqual(await connectionMetadata(page),before);
      await setPhotoTime(page,'2026-01-19T17:00:00');
      const main=await autoWrite(page,3);
      await assertPhoto(page,assert,{name,image,main});
      const history=await page.eval(`(async()=>{
        const {HISTORY_DIR,historySlots}=await import('./js/folder-history.js');
        const dir=await (await folderTest.directory()).getDirectoryHandle(HISTORY_DIR);
        return Promise.all(Object.values(historySlots(new Date())).map(async({name})=>
          new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()).toBase64()));
      })()`);
      assert.deepEqual(history,[main,main]);
    },{source:retiredSource});
  });

  await check('P3.0 a same folder with another passphrase refreshes just the handle before review',async()=>{
    await withPhotosPage(async page=>{
      await photoReceipt(page,assert);
      const foreign='Fictional alternate folder phrase 42!';
      const fixture=await backupFixture([note({title:'Fictional earlier copy'})],foreign);
      await writeFolderFixture(page,MAIN,await fixture.seal({...fixture.payload,rev:1}));
      const before=await connectionMetadata(page);
      const files=(await folderCopyEvidence(page)).files;
      await page.eval('retireFolderHandle();folderTest.writeAttempts=0');
      await openPhotoSettings(page,assert);
      await page.eval("document.querySelector('[data-folder-action=change]').click()");
      await page.until("!!document.querySelector('.app-dialog input[type=password]')");
      await page.eval(`const input=document.querySelector('.app-dialog input[type=password]');
        input.value=${JSON.stringify(foreign)};input.dispatchEvent(new Event('input',{bubbles:true}));
        input.closest('form').requestSubmit();`);
      await page.until("!!document.querySelector('[data-folder-status=rollback]')");
      assert.equal(await page.eval('folderTest.handleWrites'),1);
      assert.deepEqual(await connectionMetadata(page),before);
      assert.deepEqual((await folderCopyEvidence(page)).files,files);
      assert.equal(await page.eval('folderTest.writeAttempts'),0);
    },{source:retiredSource});
  });

  await check('P3.0 replacing a vault during the same-folder comparison refuses the new handle',async()=>{
    await withPhotosPage(async page=>{
      await photoReceipt(page,assert);
      const before=await connectionMetadata(page);
      const files=(await folderCopyEvidence(page)).files;
      await page.eval(`(async()=>{
        const db=await import('./js/db.js');
        retireFolderHandle();
        folderTest.beforeSameEntry=()=>db.saveMeta('vaultId','fictional-vault-in-another-tab');
        folderTest.writeAttempts=0;
      })()`);
      const code=await page.eval(`(async()=>{
        const {chooseSyncFolder}=await import('./js/folder-store.js');
        const key=(await import('./js/app.js')).getCryptoKey();
        try {return (await chooseSyncFolder({key,hold:true})).status;}
        catch(error){return error.code;}
      })()`);
      assert.equal(code,'vault.changed');
      assert.equal(await page.eval('folderTest.handleWrites'),0);
      assert.deepEqual(await connectionMetadata(page),before);
      assert.deepEqual((await folderCopyEvidence(page)).files,files);
      assert.equal(await page.eval('folderTest.writeAttempts'),0);
    },{source:retiredSource});
  });
}

export async function runP36({check,assert}){
  await check('P3.6 an automatic photo failure survives a pull and clears after the next successful photo',async()=>{
    await withPhotosPage(async page=>{
      const {name,image,configured}=await photoReceipt(page,assert);
      await setPhotoTime(page,'2026-01-12T17:00:00');
      await page.eval("photoTest.permission='denied'");
      await autoWrite(page,3);
      await assertPhotoStatus(page,assert,/photos: not written.*permission/i);
      await page.eval("photoTest.permission='granted'");
      await setPhotoTime(page,'2026-01-12T17:10:00');
      await receivePhotoRevision(page);
      assert.deepEqual(await photoMeta(page),configured);
      assert.deepEqual(await page.eval('photoTest.writes'),[]);
      await assertPhotoStatus(page,assert,/photos: not written.*permission/i);
      const main=await autoWrite(page,5);
      await assertPhoto(page,assert,{name,image,main});
      await assertPhotoStatus(page,assert,/photos: written on/i);
    });
  });
}
