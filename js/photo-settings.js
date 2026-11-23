import {t} from './i18n.js';
import {confirmDialog} from './dialogs.js';
import {choosePhotoFolder,disconnectPhotoFolder,folderMetadata,photoErrorDetails,queryPhotoPermission,requestPhotoPermission} from './photo-folder.js';

export function createPhotoSettings(initial,{key,signal,notify}) {
  const group=document.createElement('section');
  group.className='form-stack';
  group.dataset.photoSettings='';
  const heading=document.createElement('h3');
  heading.textContent=t('photo.settings');
  const status=document.createElement('p');
  status.className='help-text';
  status.dataset.photoStatus='';
  const controls=document.createElement('div');
  controls.className='folder-actions';
  group.append(heading,status,controls);
  let meta=initial,permission=null,busy=false;

  function button(action,label,work) {
    const element=document.createElement('button');
    element.type='button';
    element.dataset.photoAction=action;
    element.className='btn-secondary';
    element.textContent=t(label);
    element.disabled=busy;
    element.addEventListener('click',()=>void run(work));
    return element;
  }

  function confirmPhotos(names) {
    const weekdays=new Intl.DateTimeFormat(document.documentElement.lang,{weekday:'short',timeZone:'UTC'});
    const rows=names.map((name,index)=>t('photo.confirmLine',{
      day:weekdays.format(new Date(Date.UTC(2024,0,index+1))),name,
    }));
    return confirmDialog([t('photo.confirm'),...rows].join('\n'),{title:t('photo.settings'),signal});
  }

  function render() {
    const handle=meta.photoFolder;
    const choose=button('choose',handle?'photo.change':'photo.choose',
      ()=>choosePhotoFolder({key,signal,confirm:confirmPhotos}));
    controls.replaceChildren(choose);
    status.textContent=t('photo.notWritten');
    if(!handle)return;
    if(permission&&permission!=='granted'){
      status.textContent=t('photo.notSaved',{reason:t(permission)});
      controls.append(button('allow','photo.allow',async()=>{
        if(await requestPhotoPermission(handle)!=='granted')notify(t('photo.permission'));
      }));
    }
    controls.append(button('disconnect','photo.disconnect',()=>disconnectPhotoFolder({key,signal})));
  }

  async function updatePermission() {
    const handle=meta.photoFolder;
    if(!handle)return;
    let next;
    try{next=await queryPhotoPermission(handle)==='granted'?'granted':'photo.permission';}
    catch(error){next=photoErrorDetails(error).code;}
    if(signal.aborted||handle!==meta.photoFolder)return;
    permission=next;
    render();
  }

  async function run(work) {
    if(busy||signal.aborted)return;
    busy=true;
    for(const control of controls.children)control.disabled=true;
    try{
      await work();
      if(signal.aborted)return;
      meta=await folderMetadata();
      permission=null;
      await updatePermission();
    }catch(error){
      if(!signal.aborted&&error.name!=='AbortError'){
        const {code,params}=photoErrorDetails(error);
        notify(t(code,params));
      }
    }finally{
      busy=false;
      if(!signal.aborted)render();
    }
  }

  render();
  void updatePermission();
  return group;
}
