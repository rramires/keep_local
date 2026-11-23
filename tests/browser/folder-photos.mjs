import {create,launchExtension} from './harness.mjs';
import {folderFixtureSource} from './folder-fixture.mjs';
import {connectedCopyPage} from './folder-copy-view.mjs';
import {waitForFolderLineage} from './folder-merge.mjs';

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
    fixture.events.push({kind:'request'});
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
  FileSystemFileHandle.prototype.getFile=function(...args){
    if(isPhoto(this.name))fixture.events.push({kind:'read',name:this.name});
    return getFile.apply(this,args);
  };
  FileSystemFileHandle.prototype.createWritable=function(...args){
    if(isPhoto(this.name))fixture.writes.push({name:this.name,options:args[0]});
    return createWritable.apply(this,args);
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
