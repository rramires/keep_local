import {confirmDialog} from './dialogs.js';
import {t} from './i18n.js';
import {generatePassword,PASSWORD_DEFAULTS} from './password-generator.js';
import {getSessionSignal} from './session.js';
import {element,vaultButton} from './vault-view.js';

const sessionOptions=new WeakMap();

export function renderVaultGenerator({signal,needsConfirmation,onFill,onCancel}) {
  const session=getSessionSignal();
  const options=(session&&sessionOptions.get(session))||PASSWORD_DEFAULTS;
  const form=element('form','vault-generator form-stack');
  form.dataset.vaultGenerator='';
  form.setAttribute('aria-label',t('vault.generator'));
  const lengthField=element('label','vault-form-field',t('vault.generatorLength'));
  const length=element('input');
  length.type='number';length.min='8';length.max='128';length.step='1';length.required=true;
  length.value=options.length;length.dataset.generatorLength='';
  lengthField.append(length);
  form.append(lengthField);
  const flags=element('div','vault-generator-options');
  const inputs=new Map();
  for(const key of ['upper','lower','digits','symbols','avoidSimilar']){
    const label=element('label','vault-generator-option');
    const input=element('input');input.type='checkbox';input.checked=options[key];
    input.dataset.generatorOption=key;
    inputs.set(key,input);
    label.append(input,element('span','',t('vault.generator.'+key)));
    flags.append(label);
  }
  const error=element('p','form-error');
  error.setAttribute('role','alert');
  const actions=element('div','vault-card-actions');
  const apply=element('button','btn-primary',t('vault.generatorSubmit'));
  apply.type='submit';apply.dataset.generatorSubmit='';
  const cancel=vaultButton(t('confirm.cancel'),onCancel);
  cancel.dataset.generatorCancel='';
  actions.append(apply,cancel);
  form.append(flags,error,actions);
  form.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(signal.aborted||apply.disabled||!form.reportValidity())return;
    const next={length:length.valueAsNumber,...Object.fromEntries([...inputs].map(([key,input])=>[key,input.checked]))};
    if(!next.upper&&!next.lower&&!next.digits&&!next.symbols){
      error.textContent=t('vault.generatorClasses');
      return;
    }
    apply.disabled=true;
    try{
      if(needsConfirmation()&&!await confirmDialog(t('vault.generatorReplace'),{signal}))return;
      if(signal.aborted||!form.isConnected)return;
      if(onFill(generatePassword(next))&&session&&!session.aborted)sessionOptions.set(session,next);
    }finally{apply.disabled=false;}
  });
  return {form,focus:()=>length.focus()};
}
