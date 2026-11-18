const TIMEOUT=5*60*1000;
const keyVaults=new WeakMap();
let activeSignal=null;
let vaultId=null;
let key=null,deadline=0,lastActivity=0,timer=null,controller=null,onExpired=null;
export function storeSessionKey(value,id=keyVaults.get(value)||null){key=value;vaultId=id;if(id)keyVaults.set(value,id);deadline=Date.now()+TIMEOUT;lastActivity=0;}
export async function getSessionKey(){checkDeadline();return key;}
export function clearSession(){activeSignal=null;key=null;vaultId=null;deadline=0;}
export function checkDeadline(){
  if(key&&Date.now()>=deadline){const callback=onExpired;clearSession();stopSessionTimer();callback?.(true);return false;}
  return !!key;
}
export function refreshSession(){
  if(!checkDeadline())return;
  const now=Date.now();if(now-lastActivity<1000)return;
  lastActivity=now;deadline=now+TIMEOUT;
}
export function stopSessionTimer(){clearInterval(timer);controller?.abort();controller=null;onExpired=null;}
export function startSessionTimer(onExpire){
  stopSessionTimer();onExpired=onExpire;controller=new AbortController();
  const options={passive:true,signal:controller.signal};
  for(const event of ['click','keydown','mousemove','touchstart','scroll'])document.addEventListener(event,refreshSession,options);
  document.addEventListener('visibilitychange',checkDeadline,options);
  window.addEventListener('focus',checkDeadline,options);
  timer=setInterval(checkDeadline,1000);
}
export function logout(){const callback=onExpired;clearSession();stopSessionTimer();callback?.(false);}

export const getSessionVaultId=()=>vaultId;
export function setSessionVaultId(id){vaultId=id;}

export const getSessionSignal=()=>activeSignal;
export function setSessionSignal(signal){activeSignal=signal;}
