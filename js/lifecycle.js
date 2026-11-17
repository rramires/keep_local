export function createScope() {
  const controller=new AbortController(),timers=new Set(),keyed=new Map();
  return {
    signal:controller.signal,
    listen(type,handler,key){
      if(controller.signal.aborted)return;
      if(key&&keyed.has(key))document.removeEventListener(type,keyed.get(key));
      if(key)keyed.set(key,handler);
      document.addEventListener(type,handler,{signal:controller.signal});
    },
    later(handler,ms=0){
      if(controller.signal.aborted)return;
      const timer=setTimeout(()=>{timers.delete(timer);if(!controller.signal.aborted)handler();},ms);timers.add(timer);return timer;
    },
    dispose(){controller.abort();for(const timer of timers)clearTimeout(timer);timers.clear();keyed.clear();}
  };
}
