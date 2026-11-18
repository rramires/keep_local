import { vaultTransaction } from './db.js';
export async function requestPersistence() {
  const claimed=await vaultTransaction(({meta},done,fail)=>{
    const request=meta.get('storagePersistRequested');request.onsuccess=()=>{try{
      if(request.result?.value){done(false);return;}
      meta.put({key:'storagePersistRequested',value:true});done(true);
    }catch(error){fail(error);}};
  });
  if(!claimed)return;
  try { await navigator.storage?.persist?.(); } catch {}
}
