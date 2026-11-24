import {createEditSession} from './edit-session.js';
import {validateNote} from './note-model.js';
import {t} from './i18n.js';
import {element, vaultButton} from './vault-view.js';
import {isSecretField, toggleVaultPrimary, MAX_VAULT_BLOCKS, MAX_VAULT_LABEL, MAX_VAULT_VALUE} from './vault-model.js';
import {SECRET_MASK} from './secret-ui.js';
import {renderVaultGenerator} from './vault-generator.js';
import {createVaultHistory} from './vault-history.js';
import {createVaultTemplate} from './vault-templates.js';

function privateInput(tag, label, maxLength) {
  const input = element(tag);
  if (tag === 'input') input.type = 'text';
  input.setAttribute('aria-label', label);
  input.spellcheck = false;
  for (const setting of ['autocomplete', 'autocapitalize', 'autocorrect']) input.setAttribute(setting, 'off');
  input.maxLength = maxLength;
  return input;
}

function newBlock(kind) {
  const base = {id: crypto.randomUUID(), kind};
  if (kind === 'field') return {...base, label:'', value:''};
  if (kind === 'text') return {...base, value:''};
  return base;
}

export function newVaultItem(order,blocks=[newBlock('field')]) {
  const now = Date.now();
  return {
    id:crypto.randomUUID(), type:'vault', title:'', blocks,
    color:'default', pinned:false, labels:[], createdAt:now, updatedAt:now,
    deletedAt:null, archivedAt:null, order,
  };
}

export function renderVaultEditor(modal, item, {signal, isNew, template, onClose, onSave, onDirty, onPin}) {
  let draft = structuredClone(item);
  const history=createVaultHistory(template?{title:'',blocks:createVaultTemplate('blank')}:item);
  if(template)history.record(item);
  signal.addEventListener('abort',history.clear,{once:true});
  const preset = new Map(isNew?item.blocks.map(block=>[block.id,block]):[]);
  const secretCleanups = new Set();
  let openGenerator=null;
  const panel = element('section', 'panel-form vault-editor');
  panel.setAttribute('translate', 'no');
  const header = element('header', 'panel-header');
  const heading = element('h2', 'vault-detail-title', t('vault.edit'));
  heading.id = 'vault-editor-title';
  const close = vaultButton(t('modal.close'), onClose);
  close.id = 'modal-close';
  const body = element('div', 'panel-body form-stack');
  const status = element('p', 'error-text vault-editor-status');
  status.setAttribute('role', 'alert');
  const title = privateInput('input', t('vault.title'), 4096);
  const titleLabel = element('label', 'vault-form-field', t('vault.title'));
  title.dataset.vaultTitle = '';
  title.value = draft.title;
  titleLabel.append(title);
  const blocks = element('div', 'vault-editor-blocks');
  const toolbar = element('div', 'vault-card-actions');
  const addButtons = new Map();
  const undo=vaultButton(t('toast.undo'),()=>applyHistory('undo'));
  undo.dataset.vaultUndo='';
  const redo=vaultButton(t('vault.redo'),()=>applyHistory('redo'));
  redo.dataset.vaultRedo='';

  const capture = () => structuredClone(draft);
  const session = createEditSession({
    capture, onDirty,
    save: async snapshot => {
      if (isNew && !snapshot.title.trim() &&
          !snapshot.blocks.some(block => {
            const initial=preset.get(block.id);
            return (block.value&&block.value!==initial?.value) ||
              (block.label?.trim()&&block.label.trim()!==initial?.label?.trim());
          })) return true;
      const saved = await onSave(snapshot);
      if (saved && !signal.aborted) {
        isNew = false;
        preset.clear();
        syncPin();
      }
      return saved;
    },
  });
  const pin = vaultButton(t('card.pin'), () => onPin(capture()));
  pin.dataset.vaultAction = 'pin';

  function syncPin() {
    pin.disabled = isNew;
    pin.textContent = t(draft.pinned ? 'card.unpin' : 'card.pin');
    pin.setAttribute('aria-pressed', String(draft.pinned));
  }

  function update(change,{typing=false,replaying=false}={}) {
    if (signal.aborted) return false;
    const next = capture();
    change(next);
    try {
      validateNote(next);
    } catch (error) {
      status.textContent = t(error.code === 'note.tooLarge' ? 'note.tooLarge' : 'note.invalid');
      return false;
    }
    if(!typing&&!replaying)history.record(draft);
    draft = next;
    if(!typing&&!replaying)recordHistory();
    status.textContent = '';
    session.schedule();
    return true;
  }

  function syncHistoryButtons() {
    undo.disabled=!history.canUndo();
    redo.disabled=!history.canRedo();
  }

  function recordHistory() {
    if(signal.aborted)return;
    history.record(draft);
    syncHistoryButtons();
  }

  function applyHistory(direction) {
    if(signal.aborted)return;
    recordHistory();
    const state=history[direction]();
    if(state&&update(next=>Object.assign(next,state),{replaying:true})){
      title.value=draft.title;
      drawBlocks();
      syncHistoryButtons();
      if(document.activeElement===undo&&undo.disabled)redo.focus();
      if(document.activeElement===redo&&redo.disabled)undo.focus();
    }
  }

  function scrubSecrets() {
    for (const scrub of secretCleanups) scrub();
  }

  function renderBlock(block, index) {
    const id = block.id;
    const row = element('div', 'vault-block');
    row.dataset.vaultBlock = block.kind;
    const get = () => draft.blocks.find(current => current.id === id);
    const patch = (change,options) => update(next => change(next.blocks.find(current => current.id === id)),options);
    const controls = element('div', 'vault-card-actions');
    const move = (direction, distance) => {
      const button = vaultButton(t('vault.move' + direction), () => {
        if (update(next => {
          const position = next.blocks.findIndex(current => current.id === id);
          [next.blocks[position], next.blocks[position + distance]] = [next.blocks[position + distance], next.blocks[position]];
        })) {
          drawBlocks();
          blocks.children[index + distance]?.querySelector('button')?.focus();
        }
      });
      button.dataset.vaultMove = direction.toLowerCase();
      button.disabled = index + distance < 0 || index + distance >= draft.blocks.length;
      return button;
    };
    const remove = vaultButton(t('vault.removeBlock'), () => {
      if (update(next => { next.blocks = next.blocks.filter(current => current.id !== id); })) {
        drawBlocks();
        (blocks.children[Math.min(index, blocks.children.length - 1)]?.querySelector('button') || addButtons.get(block.kind))?.focus();
      }
    });
    remove.dataset.vaultRemove = '';
    controls.append(move('Up', -1), move('Down', 1), remove);

    if (block.kind === 'divider') {
      row.append(element('hr', 'vault-divider'), controls);
      return row;
    }

    const field = block.kind === 'field';
    const value = privateInput(field && !block.multiline ? 'input' : 'textarea', t(field ? 'vault.value' : 'vault.text'), MAX_VAULT_VALUE);
    value.dataset.vaultValue = '';
    const valueLabel = element('label', 'vault-form-field', t(field ? 'vault.value' : 'vault.text'));
    valueLabel.append(value);
    let revealing = false;
    let reveal;
    let toggleSecret;
    let generate;

    function syncValue() {
      const current = get();
      const secret = isSecretField(current);
      if (!secret) revealing = false;
      const focused = value === document.activeElement && document.visibilityState !== 'hidden';
      value.value = secret && !focused ? '' : current.value;
      value.placeholder = field ? (secret ? SECRET_MASK : '') : t('vault.template.field.notes');
      value.classList.toggle('vault-edit-secret', secret && !revealing);
      if (field) {
        toggleSecret.textContent = (secret ? '🔒 ' : '🔓 ') + t('vault.secret');
        toggleSecret.setAttribute('aria-pressed', String(secret));
        reveal.hidden = !secret;
        generate.hidden = !secret;
        if(!secret&&row.contains(openGenerator))closeGenerator();
        reveal.textContent = t(revealing ? 'vault.hide' : 'vault.reveal');
        reveal.setAttribute('aria-pressed', String(revealing));
      }
    }

    function scrubValue() {
      if (!isSecretField(get() ?? block)) return;
      revealing = false;
      value.value = '';
      value.classList.add('vault-edit-secret');
      reveal.textContent = t('vault.reveal');
      reveal.setAttribute('aria-pressed', 'false');
    }

    if (field) {
      const label = privateInput('input', t('vault.fieldLabel'), MAX_VAULT_LABEL);
      label.dataset.vaultLabel = '';
      label.value = block.label;
      const fieldLabel = element('label', 'vault-form-field', t('vault.fieldLabel'));
      fieldLabel.append(label);
      label.addEventListener('input', () => {
        if (!patch(current => {
          const populatedSecret = current.value !== '' && isSecretField(current);
          current.label = label.value;
          if (populatedSecret && !isSecretField(current)) current.secret = true;
        },{typing:true})) label.value = get().label;
        syncValue();
      });
      label.addEventListener('blur',recordHistory);
      toggleSecret = vaultButton(t('vault.secret'), () => {
        patch(current => { current.secret = !isSecretField(current); });
        syncValue();
      });
      toggleSecret.dataset.vaultToggleSecret = '';
      const multiline = vaultButton(t('vault.multiline'), () => {
        if (patch(current => { current.multiline = !current.multiline; })) {
          drawBlocks();
          blocks.children[index]?.querySelector('[data-vault-multiline]')?.focus();
        }
      });
      multiline.dataset.vaultMultiline = '';
      multiline.setAttribute('aria-pressed', String(!!block.multiline));
      reveal = vaultButton(t('vault.reveal'), () => {
        value.focus();
        revealing = !revealing;
        syncValue();
      });
      reveal.dataset.vaultEditReveal = '';
      reveal.addEventListener('pointerdown', event => {
        if (document.activeElement === value) event.preventDefault();
      });
      const primary=vaultButton(t('vault.primary'),()=>{
        if(update(next=>toggleVaultPrimary(next.blocks,id))){
          drawBlocks();
          blocks.children[index]?.querySelector('[data-vault-primary]')?.focus();
        }
      });
      primary.dataset.vaultPrimary='';
      primary.textContent=block.primary?'★':'☆';
      primary.setAttribute('aria-label',t('vault.primary'));
      primary.setAttribute('aria-pressed',String(!!block.primary));
      generate=vaultButton(t('vault.generate'),()=>{
        closeGenerator();
        const view=renderVaultGenerator({
          signal,
          needsConfirmation:()=>!!get()?.value,
          onFill:generated=>{
            if(!isSecretField(get())||!patch(current=>{current.value=generated;}))return false;
            closeGenerator();
            revealing=false;
            value.focus();
            syncValue();
            return true;
          },
          onCancel:()=>{closeGenerator();generate.focus();},
        });
        openGenerator=view.form;
        row.append(openGenerator);
        view.focus();
      });
      generate.dataset.vaultGenerate='';
      controls.prepend(toggleSecret, multiline, primary, reveal, generate);
      row.append(fieldLabel);
      secretCleanups.add(scrubValue);
      value.addEventListener('focus', syncValue);
      value.addEventListener('blur', scrubValue);
    }
    value.addEventListener('input', () => {
      if (isSecretField(get()) && document.activeElement !== value) {
        scrubValue();
        return;
      }
      if (!patch(current => { current.value = value.value; },{typing:true})) syncValue();
    });
    value.addEventListener('blur',recordHistory);
    syncValue();
    row.append(valueLabel, controls);
    return row;
  }

  function closeGenerator() {
    openGenerator?.remove();
    openGenerator=null;
  }

  function drawBlocks() {
    closeGenerator();
    scrubSecrets();
    secretCleanups.clear();
    blocks.replaceChildren(...draft.blocks.map(renderBlock));
    for (const button of addButtons.values()) button.disabled = draft.blocks.length >= MAX_VAULT_BLOCKS;
  }

  title.addEventListener('input', () => {
    if (!update(next => { next.title = title.value; },{typing:true})) title.value = draft.title;
  });
  title.addEventListener('blur',recordHistory);
  panel.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.altKey||event.target.closest('input,textarea,select,[contenteditable]'))return;
    const key=event.key.toLowerCase();
    if(key!=='z'&&key!=='y')return;
    event.preventDefault();
    applyHistory(key==='y'||event.shiftKey?'redo':'undo');
  },{signal});
  for (const [kind, key] of [['field', 'addField'], ['text', 'addText'], ['divider', 'addDivider']]) {
    const button = vaultButton(t('vault.' + key), () => {
      if (update(next => { next.blocks.push(newBlock(kind)); })) {
        drawBlocks();
        blocks.lastElementChild?.querySelector('input,textarea,button:not(:disabled)')?.focus();
      }
    });
    button.dataset.vaultAdd = kind;
    addButtons.set(kind, button);
    toolbar.append(button);
  }
  toolbar.append(pin,undo,redo);
  body.append(titleLabel, status, blocks, toolbar);
  header.append(heading, close);
  panel.append(header, body);
  modal.replaceChildren(panel);
  syncPin();
  syncHistoryButtons();
  drawBlocks();

  function mask() {
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    scrubSecrets();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mask();
  }, {signal});
  window.addEventListener('blur', mask, {signal});

  return {
    ...session, id:item.id, mask,
    applyFields(fields) { Object.assign(draft, fields); syncPin(); },
    cleanup() {
      history.clear();
      closeGenerator();
      scrubSecrets();
      for (const input of panel.querySelectorAll('input,textarea')) input.value = '';
      preset.clear();
      draft.blocks = [];
      draft.title = '';
      secretCleanups.clear();
    },
  };
}
