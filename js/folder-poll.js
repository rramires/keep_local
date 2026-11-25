import {folderInventoryStamp,readFolderInventory} from './folder-inventory.js';

export const FOLDER_POLL_MS=60_000;

export function createFolderPoll({handle,signal,canCheck,check}) {
  const override=globalThis.__keepLocalTestFolderPollMs;
  const interval=Number.isSafeInteger(override)&&override>0?override:FOLDER_POLL_MS;
  let remembered;
  let reading=false;
  const canRead=()=>!signal.aborted&&document.visibilityState==='visible'&&document.hasFocus()&&canCheck();

  async function tick() {
    if(reading||!canRead())return;
    reading=true;
    const baseline=remembered;
    try {
      const inventory=await readFolderInventory(handle,canRead);
      if(inventory&&canRead()&&remembered===baseline&&folderInventoryStamp(inventory)!==remembered)
        await check();
    }catch{
      // A metadata probe cannot change the displayed folder state.
    }finally{reading=false;}
  }

  const timer=setInterval(tick,interval);
  signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
  return {
    remember(inventory,replacement){remembered=folderInventoryStamp(inventory,replacement);},
  };
}
