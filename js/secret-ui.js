import {t} from './i18n.js';

export const SECRET_MASK = '••••••••';

export function createSecretUI({notify}) {
  const shown = new Map();
  let clipboardTimer, pending = false, waiting = false;
  let copying = false, clearing = false, generation = 0;
  let notice = null;

  function hide(target) {
    shown.get(target)?.();
  }

  function hideAll() {
    for (const erase of shown.values()) erase();
  }

  function toggle(target, button, value, signal, options = {}) {
    if (shown.has(target)) {
      hide(target);
      return;
    }
    if (signal?.aborted || document.visibilityState === 'hidden' || !target.isConnected) return;
    const {property = 'textContent', mask = SECRET_MASK, revealLabel = t('vault.reveal')} = options;
    const erase = () => {
      clearTimeout(timer);
      shown.delete(target);
      signal?.removeEventListener('abort', erase);
      target[property] = mask;
      button.textContent = revealLabel;
      button.setAttribute('aria-pressed', 'false');
    };
    const timer = setTimeout(erase, 15000);
    shown.set(target, erase);
    signal?.addEventListener('abort', erase, {once:true});
    target[property] = value;
    button.textContent = t('vault.hide');
    button.setAttribute('aria-pressed', 'true');
  }

  function removeNotice() {
    notice?.remove();
    notice = null;
  }

  function offerClear() {
    if (!waiting || !document.hasFocus() || notice?.isConnected) return;
    notice = document.createElement('div');
    notice.className = 'vault-clipboard-pending notice notice-warning';
    notice.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = t('vault.clipboardPending');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.textContent = t('vault.clearClipboard');
    button.addEventListener('click', () => void clear());
    notice.append(text, button);
    document.body.append(notice);
  }

  async function clear() {
    if (!pending || copying || clearing) return;
    if (!document.hasFocus()) {
      waiting = true;
      return;
    }
    clearing = true;
    try {
      await navigator.clipboard.writeText('');
      pending = false;
      waiting = false;
      removeNotice();
    } catch {
      waiting = true;
      offerClear();
    } finally {
      clearing = false;
    }
  }

  async function copy(value, signal) {
    if (signal?.aborted || copying || clearing) return;
    const session = generation;
    copying = true;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      if (session === generation && !signal?.aborted) notify(t('vault.copyFailed'));
      return;
    } finally {
      copying = false;
    }
    pending = true;
    waiting = false;
    clearTimeout(clipboardTimer);
    removeNotice();
    if (session !== generation) {
      await clear();
      return;
    }
    if (!signal?.aborted) notify(t('vault.copied'));
    clipboardTimer = setTimeout(() => {
      if (document.hasFocus() && !copying) void clear();
      else {
        waiting = true;
        offerClear();
      }
    }, 20000);
  }

  function dispose() {
    generation++;
    hideAll();
    clearTimeout(clipboardTimer);
    removeNotice();
    if (pending) {
      waiting = true;
      if (document.hasFocus()) void clear();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hideAll();
  });
  window.addEventListener('focus', offerClear);
  return {toggle, hide, copy, dispose};
}
