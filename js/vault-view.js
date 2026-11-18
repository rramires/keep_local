import {SECRET_MASK} from './secret-ui.js';
import {t, tp} from './i18n.js';
import {COLORS} from './note-model.js';
import {isSecretField, vaultSubtitle} from './vault-model.js';

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function vaultButton(text, onClick, className = 'btn-secondary') {
  const button = element('button', className, text);
  button.type = 'button';
  button.disabled = !onClick;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function cardColor(item, change) {
  const picker = element('details', 'vault-card-options');
  picker.append(element('summary', '', t('modal.color')));
  const palette = element('div', 'vault-palette');
  for (const color of COLORS) {
    const choice = vaultButton('', () => change(item, next => { next.color = color; }), 'vault-swatch');
    choice.dataset.color = color;
    choice.setAttribute('aria-label', t('vault.color.' + color));
    choice.setAttribute('aria-pressed', String(item.color === color));
    palette.append(choice);
  }
  picker.append(palette);
  return picker;
}

function cardLabels(item, change) {
  const panel = element('details', 'vault-card-options');
  panel.append(element('summary', '', t('modal.labels')));
  const form = element('form', 'vault-label-form');
  const input = element('input');
  input.placeholder = t('labels.newLabel');
  input.setAttribute('aria-label', t('labels.newLabel'));
  input.maxLength = 200;
  input.spellcheck = false;
  for (const setting of ['autocomplete', 'autocapitalize', 'autocorrect']) input.setAttribute(setting, 'off');
  const add = element('button', 'btn-secondary', t('vault.addLabel'));
  add.type = 'submit';
  form.append(input, add);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const label = input.value.trim();
    if (label) void change(item, next => {
      if (!next.labels.includes(label)) next.labels.push(label);
    });
  });
  panel.append(form);
  return panel;
}

export function renderVaultCard(item, {open, change, remove, trash = false}) {
  const card = element('article', 'vault-card');
  card.dataset.color = item.color;
  card.setAttribute('translate', 'no');
  const title = item.title.trim() || t('vault.untitled');
  const label = element('h2', 'vault-card-title', title);
  const opener = vaultButton('', () => open(item), 'vault-card-open');
  opener.dataset.vaultOpen = item.id;
  opener.append(label);
  const subtitle = vaultSubtitle(item);
  if (subtitle) opener.append(element('span', 'vault-card-subtitle', subtitle));
  card.append(opener);

  const info = element('div', 'vault-card-meta');
  if (item.pinned) info.append(element('span', 'vault-chip', t('notes.pinned')));
  info.append(element('span', '', tp('vault.fields', item.blocks.filter(block => block.kind === 'field').length)));
  for (const label of item.labels) info.append(element('span', 'vault-chip', label));
  card.append(info);

  const actions = element('div', 'vault-card-actions');
  if (trash) {
    const restore = vaultButton(t('card.restore'), () => change(item, next => {
      next.deletedAt = null;
      next.archivedAt = null;
    }));
    restore.dataset.vaultAction = 'restore';
    const discard = vaultButton(t('card.deletePermanently'), () => remove(item));
    discard.dataset.vaultAction = 'delete-forever';
    actions.append(restore, discard);
  } else {
    const pin = vaultButton(t(item.pinned ? 'card.unpin' : 'card.pin'), () => change(item, next => {
      next.pinned = !next.pinned;
    }));
    pin.dataset.vaultAction = 'pin';
    pin.setAttribute('aria-pressed', String(item.pinned));
    const trash = vaultButton(t('card.delete'), () => change(item, next => { next.deletedAt = Date.now(); }));
    trash.dataset.vaultAction = 'trash';
    actions.append(pin, cardColor(item, change), cardLabels(item, change), trash);
  }
  card.append(actions);
  return card;
}

export function renderVaultSection(root, {items, layout, onLayout, onNew, onDismissWarning, ...cardActions}) {
  const section = element('section', 'vault-section');
  section.setAttribute('translate', 'no');
  const toolbar = element('header', 'vault-toolbar');
  toolbar.append(element('h1', '', t('vault.section')));
  const controls = element('div', 'vault-toolbar-actions');
  const add = vaultButton(t('vault.new'), onNew, 'btn-primary');
  add.id = 'vault-new-item';
  controls.append(add);
  for (const mode of ['list', 'grid']) {
    const button = vaultButton(t('vault.' + mode), () => onLayout(mode));
    button.dataset.vaultLayout = mode;
    button.setAttribute('aria-pressed', String(layout === mode));
    controls.append(button);
  }
  toolbar.append(controls);
  section.append(toolbar);
  if (onDismissWarning) {
    const tip = element('div', 'vault-clipboard-tip notice notice-warning');
    tip.append(element('span', '', t('vault.clipboardWarning')), vaultButton(t('vault.dismissWarning'), onDismissWarning));
    section.append(tip);
  }
  if (items.length) {
    const cards = element('div', 'vault-cards');
    cards.dataset.layout = layout;
    const sorted = items.toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
    for (const item of sorted) cards.append(renderVaultCard(item, cardActions));
    section.append(cards);
  } else {
    section.append(element('p', 'vault-empty', t('vault.empty')));
  }
  root.replaceChildren(section);
}



function readingBlock(block, {controls, signal}) {
  if (block.kind === 'divider') return element('hr', 'vault-divider');
  if (block.kind === 'text') return element('p', 'vault-text', block.value);
  const secret = isSecretField(block);
  const row = element('div', 'vault-read-field');
  row.append(element('span', 'vault-field-label', block.label || t('vault.field')));
  const style = block.multiline ? ' vault-multiline' : '';
  const value = element('span', 'vault-read-value' + style + (secret ? ' vault-secret-value' : ''), secret ? SECRET_MASK : block.value);
  row.append(value);
  const actions = element('div', 'vault-card-actions');
  if (secret) {
    const reveal = vaultButton(t('vault.reveal'), controls && (() => controls.toggle(value, reveal, block.value, signal)));
    reveal.dataset.vaultReveal = '';
    reveal.setAttribute('aria-pressed', 'false');
    actions.append(reveal);
  }
  const copy = vaultButton(t('vault.copy'), controls && (() => controls.copy(block.value, signal)));
  copy.dataset.vaultCopy = '';
  actions.append(copy);
  row.append(actions);
  return row;
}

export function renderVaultDetail(modal, item, {onClose, onEdit, controls, signal}) {
  const section = element('section', 'panel-form vault-detail');
  section.setAttribute('translate', 'no');
  const header = element('header', 'panel-header');
  const title = element('h2', 'vault-detail-title', item.title.trim() || t('vault.untitled'));
  title.id = 'vault-detail-title';
  const close = vaultButton(t('modal.close'), onClose);
  close.id = 'modal-close';
  header.append(title, close);
  const body = element('div', 'panel-body form-stack');
  for (const block of item.blocks) body.append(readingBlock(block, {controls, signal}));
  if (!item.deletedAt) {
    const edit = vaultButton(t('vault.edit'), onEdit, 'btn-primary');
    edit.dataset.vaultEdit = '';
    body.append(edit);
  }
  section.append(header, body);
  modal.replaceChildren(section);
}
