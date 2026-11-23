import {create,launchExtension,PASSWORD} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {backupFixture} from './backup-fixture.mjs';
import {connectedCopyPage} from './folder-copy-view.mjs';
import {editNote,focus,waitForFolderLineage,waitForRev} from './folder-merge.mjs';
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

async function withPhotosPage(work,{connected=true}={}){
  const browser=await launchExtension();
  try{
    const photoSource=`void (${installPhotoFixture})(${JSON.stringify(photoNames)})`;
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
      assert.match(await status(page),/no photo written yet/i);
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
