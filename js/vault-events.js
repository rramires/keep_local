const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('keeplocal-vault'):null;
const listeners=new Set();
if(channel){channel.onmessage=e=>{for(const listener of listeners)listener(e.data);};channel.unref?.();}
export function publishVaultEvent(type,details={}){channel?.postMessage({type,...details});}
export function watchVaultEvents(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
