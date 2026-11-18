import {validatePassword} from './password-policy.js';
import {t} from './i18n.js';

// Presentation only: the submit handler remains the authority for validation.
export function passwordFeedback(root,password,confirmation) {
  const result=validatePassword(password);
  root.querySelector('[data-rule=length]').classList.toggle('valid',result.checks.minLength);
  const common=root.querySelector('[data-rule=common]');common.classList.toggle('valid',result.checks.notCommon);common.textContent=t('validation.'+(result.reason||'common'));
  const strength=root.querySelector('[data-password-strength]');strength.textContent=t('password.strength.'+result.strength);strength.dataset.strength=result.strength;
  root.querySelector('[data-password-match]').textContent=confirmation&&confirmation!==password?t('auth.passwordsNoMatch'):'';
}

export function focusPanel(container,{signal,trigger,titleId,initial}) {
  container.setAttribute('role','dialog');container.setAttribute('aria-modal','true');container.setAttribute('aria-labelledby',titleId);
  const focus=()=>{if(signal?.aborted||!container.isConnected)return;if(getComputedStyle(container).visibility==='hidden'){requestAnimationFrame(focus);return;}container.querySelector(initial)?.focus();};
  requestAnimationFrame(focus);
  signal?.addEventListener('abort',()=>{
    container.removeAttribute('role');container.removeAttribute('aria-modal');container.removeAttribute('aria-labelledby');
    queueMicrotask(()=>{const target=typeof trigger==='function'?trigger():trigger;if(target?.isConnected)target.focus();});
  },{once:true});
}
