// Installed in disposable test pages via CDP before any application script.
function installFolderFixture(name) {
  const mode = {mode:'readwrite'};
  const fixture = window.folderTest = {
    name, permission:'prompt', requested:'granted', cancel:false,
    events:[], writes:{}, writeAttempts:0, tamperedReads:0,
    clear() { this.events.length=0; this.writes={}; },
    async directory(create=false) {
      return (await navigator.storage.getDirectory()).getDirectoryHandle(this.name,{create});
    },
    async remove() {
      await (await navigator.storage.getDirectory()).removeEntry(this.name,{recursive:true});
    },
    async entries() {
      const names=[];
      for await (const name of (await this.directory()).keys()) names.push(name);
      return names.sort();
    },
  };
  const record = (kind,options) => fixture.events.push({
    kind, options, active:navigator.userActivation.isActive,
  });
  window.showDirectoryPicker = async options => {
    record('picker',options);
    if(fixture.cancel) throw new DOMException('Fictional picker cancellation','AbortError');
    return fixture.directory(true);
  };
  FileSystemHandle.prototype.queryPermission = async function(options=mode) {
    record('query',options);
    return fixture.permission;
  };
  FileSystemHandle.prototype.requestPermission = async function(options=mode) {
    record('request',options);
    if(fixture.requested==='error') throw new DOMException('Fictional denial','NotAllowedError');
    return fixture.permission=fixture.requested;
  };
  const keys = FileSystemDirectoryHandle.prototype.keys;
  FileSystemDirectoryHandle.prototype.keys = function(...args) {
    record('list');
    return keys.apply(this,args);
  };
  for (const kind of ['deriveBits','deriveKey']) {
    const derive=SubtleCrypto.prototype[kind];
    SubtleCrypto.prototype[kind]=function(...args) {
      if (args[0]?.name==='PBKDF2') record(kind);
      return derive.apply(this,args);
    };
  }
  const createWritable=FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable=async function(...args){
    if(this.name!=='keeplocal-vault.keeplocal')return createWritable.apply(this,args);
    fixture.writeAttempts++;
    if(fixture.removeBeforeWrite){
      await fixture.remove();
      throw new DOMException('Test directory removed','NotFoundError');
    }
    if(fixture.failWrites>0){
      fixture.failWrites--;
      throw new DOMException('Test writer occupied','NoModificationAllowedError');
    }
    const stream=await createWritable.apply(this,args);
    if(fixture.badReadback){
      const close=stream.close.bind(stream);
      stream.close=async()=>{
        await close();
        fixture.corruptNextRead=true;
      };
    }
    return stream;
  };
  const getFile=FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile=async function(...args){
    const file=await getFile.apply(this,args);
    if(this.name!=='keeplocal-vault.keeplocal'||!fixture.corruptNextRead)return file;
    fixture.corruptNextRead=false;
    fixture.tamperedReads++;
    const bytes=new Uint8Array(await file.arrayBuffer());
    bytes[bytes.length-1]^=1;
    return new File([bytes],file.name);
  };
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode,...args) {
    if (mode==='readwrite') {
      for (const store of typeof stores==='string'?[stores]:stores) {
        fixture.writes[store]=(fixture.writes[store]||0)+1;
      }
    }
    return transaction.call(this,stores,mode,...args);
  };
}

export function folderFixtureSource(name='KL-TEST-'+crypto.randomUUID().replaceAll('-','').slice(0,12)) {
  return `(${installFolderFixture})(${JSON.stringify(name)})`;
}
