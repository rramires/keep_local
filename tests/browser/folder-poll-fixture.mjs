export function installPollFixture(manual,interval) {
  window.__keepLocalTestFolderPollMs=interval;
  const state=window.pollTest={visible:true,focused:true,lists:0,metadata:0,reads:0,ticks:0,completed:0};
  Object.defineProperty(document,'visibilityState',{get:()=>state.visible?'visible':'hidden'});
  document.hasFocus=()=>state.focused;
  const set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
  window.setInterval=(action,delay,...args)=>{
    if(delay!==interval)return set(action,delay,...args);
    if(!manual)return set(async()=>{
      state.ticks++;
      const once=state.onlyNext&&state.focused&&state.visible;
      if(once)state.onlyNext=false;
      await action();
      state.completed++;
      if(once)state.focused=false;
    },delay);
    state.tick=()=>{state.ticks++;return action();};
    return -538;
  };
  window.clearInterval=id=>{
    if(id===-538){delete state.tick;return;}
    clear(id);
  };
  const entries=FileSystemDirectoryHandle.prototype.entries;
  FileSystemDirectoryHandle.prototype.entries=function(...args){
    if(this.name===folderTest.name)state.lists++;
    return entries.apply(this,args);
  };
  const getFile=FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile=function(...args){
    if(/\.keeplocal$/i.test(this.name))state.metadata++;
    return getFile.apply(this,args);
  };
  const read=File.prototype.arrayBuffer;
  File.prototype.arrayBuffer=function(...args){
    if(/\.keeplocal$/i.test(this.name))state.reads++;
    return read.apply(this,args);
  };
}

export const pollFixture=(source,{manual=true,interval=713}={})=>
  source+';('+installPollFixture+')('+manual+','+interval+')';
