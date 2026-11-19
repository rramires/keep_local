// Installed in disposable test pages via CDP before any application script.
function installFolderFixture(name,timeouts) {
  if(timeouts)globalThis.__keepLocalTestFolderTimeouts=timeouts;
  const mode = {mode:'readwrite'};
  const fixture = window.folderTest = {
    name, permission:'prompt', requested:'granted', cancel:false,
    stalls:new Set(), pending:[], folderSignals:[],
    release() {
      const released=this.pending.splice(0);
      for (const {resume} of released)resume();
      return released.map(({kind})=>kind);
    },
    events:[], writes:{}, writeAttempts:0, tamperedReads:0, preservationRemovals:[],
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
  async function stall(kind,force=false){
    if(!force&&!fixture.stalls.has(kind))return false;
    await new Promise(resume=>fixture.pending.push({kind,resume}));
    record('resumed:'+kind);
    return true;
  }
  const addEventListener=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
    if(this===window&&type==='pagehide'&&options?.signal)fixture.folderSignals.push(options.signal);
    return addEventListener.call(this,type,listener,options);
  };
  let compareWithRetiredHandle=false;
  window.showDirectoryPicker = async options => {
    record('picker',options);
    if(fixture.cancel) throw new DOMException('Fictional picker cancellation','AbortError');
    const picked=await fixture.directory(true);
    if(fixture.recoverOnPicker){
      compareWithRetiredHandle=fixture.stalls.has('isSameEntry');
      fixture.stalls.clear();
      fixture.recoverOnPicker=false;
    }
    return picked;
  };
  FileSystemHandle.prototype.queryPermission = async function(options=mode) {
    record('query',options);
    await stall('queryPermission');
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
    return fixture.stalls.has('keys')?stallEntries('keys',keys,this,args):keys.apply(this,args);
  };
  async function* stallEntries(kind,method,handle,args){
    await stall(kind);
    try {yield* method.apply(handle,args);}
    finally {record('settled:'+kind);}
  }
  const entries=FileSystemDirectoryHandle.prototype.entries;
  FileSystemDirectoryHandle.prototype.entries=function(...args){
    return fixture.stalls.has('entries')?stallEntries('entries',entries,this,args):entries.apply(this,args);
  };
  for (const kind of ['deriveBits','deriveKey']) {
    const derive=SubtleCrypto.prototype[kind];
    SubtleCrypto.prototype[kind]=function(...args) {
      if (args[0]?.name==='PBKDF2') record(kind);
      return derive.apply(this,args);
    };
  }
  const getDirectoryHandle=FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  FileSystemDirectoryHandle.prototype.getDirectoryHandle=async function(name,options){
    if(name==='keeplocal-preserved'&&options?.create&&fixture.failPreservation==='directory')
      throw new DOMException('Test preservation directory denied','NotAllowedError');
    return getDirectoryHandle.call(this,name,options);
  };
  const removeEntry=FileSystemDirectoryHandle.prototype.removeEntry;
  FileSystemDirectoryHandle.prototype.removeEntry=async function(name,options){
    if(this.name==='keeplocal-preserved'){
      fixture.preservationRemovals.push(name);
      if(fixture.denyPreservationRemoval)
        throw new DOMException('Test preservation removal denied','NotAllowedError');
    }
    return removeEntry.call(this,name,options);
  };
  const isSameEntry=FileSystemHandle.prototype.isSameEntry;
  FileSystemHandle.prototype.isSameEntry=async function(other){
    if(this.name.startsWith('preserved-')&&fixture.rejectPreservationIdentity)return false;
    const compareWithOld=compareWithRetiredHandle;
    compareWithRetiredHandle=false;
    const delayed=await stall('isSameEntry',compareWithOld);
    const result=await isSameEntry.call(this,other);
    if(delayed)record('settled:isSameEntry');
    return result;
  };
  const createWritable=FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable=async function(...args){
    if(this.name.startsWith('preserved-')){
      if(fixture.failPreservation===true)
        throw new DOMException('Test preservation writer occupied','NoModificationAllowedError');
      const stream=await createWritable.apply(this,args);
      if(fixture.failPreservation==='tamper'){
        const write=stream.write.bind(stream);
        stream.write=data=>{
          const bytes=data.slice();
          bytes[bytes.length-1]^=1;
          return write(bytes);
        };
      }
      return stream;
    }
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
    if(fixture.holdWriteAttempt===fixture.writeAttempts)
      await new Promise(resolve=>{fixture.releaseWrite=resolve;});
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
    const delayed=await stall('getFile');
    const file=await getFile.apply(this,args);
    if(delayed)record('settled:getFile');
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

export function folderFixtureSource(name='KL-TEST-'+crypto.randomUUID().replaceAll('-','').slice(0,12),timeouts) {
  return `(${installFolderFixture})(${JSON.stringify(name)},${JSON.stringify(timeouts)})`;
}
