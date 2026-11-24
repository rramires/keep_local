const TIMEOUT=5*60*1000;
const keyVaults=new WeakMap();
let activeSignal=null;
let vaultId=null;
let key=null,deadline=0,lastActivity=0,idleTimeout=TIMEOUT,timer=null,controller=null,onExpired=null;
let readOnlySession=false;
export function storeSessionKey(value,id=keyVaults.get(value)||null){readOnlySession=false;key=value;vaultId=id;if(id)keyVaults.set(value,id);lastActivity=Date.now();deadline=lastActivity+idleTimeout;}
export function startReadOnlySession(id){key=null;readOnlySession=true;vaultId=id;lastActivity=Date.now();deadline=lastActivity+idleTimeout;}
export async function getSessionKey(){checkDeadline();return key;}
export function clearSession(){activeSignal=null;key=null;readOnlySession=false;vaultId=null;deadline=0;lastActivity=0;idleTimeout=TIMEOUT;}
export function checkDeadline(){
  if((key||readOnlySession)&&Date.now()>=deadline){const callback=onExpired;clearSession();stopSessionTimer();callback?.(true);return false;}
  return !!(key||readOnlySession);
}
export function refreshSession(){
  if(!checkDeadline())return;
  const now=Date.now();if(now-lastActivity<1000)return;
  lastActivity=now;deadline=now+idleTimeout;
}
export function setIdleTimeout(ms=TIMEOUT){
  if(!Number.isFinite(ms)||ms<=0)throw new RangeError('Invalid idle timeout');
  idleTimeout=ms;
  if(key||readOnlySession)deadline=lastActivity+idleTimeout;
}

export function stopSessionTimer(){clearInterval(timer);controller?.abort();controller=null;onExpired=null;}
export function startSessionTimer(onExpire){
  stopSessionTimer();onExpired=onExpire;controller=new AbortController();
  const options={capture:true,passive:true,signal:controller.signal};
  for(const event of ['click','keydown','mousemove','touchstart','wheel'])document.addEventListener(event,refreshSession,options);
  document.addEventListener('visibilitychange',checkDeadline,options);
  window.addEventListener('focus',checkDeadline,options);
  timer=setInterval(checkDeadline,1000);
}
export function logout(){const callback=onExpired;clearSession();stopSessionTimer();callback?.(false);}

export const getSessionVaultId=()=>vaultId;
export function setSessionVaultId(id){vaultId=id;}

export const getSessionSignal=()=>activeSignal;
export function setSessionSignal(signal){activeSignal=signal;}
