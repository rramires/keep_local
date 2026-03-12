// app.js — Bootstrap, SPA router, view switching

import { openDB, isFirstUse } from './db.js';
import { renderAuthView, getSessionKey, startSessionTimer, stopSessionTimer, logout } from './auth.js';
import { initTheme, toggleTheme, getTheme } from './theme.js';
import { initBeforeUnload } from './backup.js';
import { icons } from './icons.js';
import { createHistory } from './history.js';
import { t, tp, getLang, setLang, initI18n } from './i18n.js';

// App state
let todoHistory = null;
let cryptoKey = null;
let currentView = 'notes'; // notes | archive | trash | label
let currentLabel = null;
let sidebarCollapsed = false;
let notes = []; // Decrypted notes in memory

// DOM references
const appContainer = document.getElementById('app-container');

// --- Bootstrap ---

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await initI18n();
  await initTheme();
  initBeforeUnload();
  document.title = t('app.title');

  // Try to restore session
  const sessionKey = await getSessionKey();
  if (sessionKey) {
    cryptoKey = sessionKey;
    await showApp();
  } else {
    showAuth();
  }
});

// --- Auth View ---

function showAuth() {
  stopSessionTimer();
  cryptoKey = null;
  notes = [];
  appContainer.innerHTML = '';
  renderAuthView(appContainer, {
    onAuthenticated: async (key) => {
      cryptoKey = key;
      await showApp();
    }
  });
}

// --- App View ---

async function showApp() {
  startSessionTimer(() => {
    showToast(t('toast.sessionExpired'));
    showAuth();
  });

  renderAppShell();
  await loadNotes();
  renderCurrentView();
}

function renderAppShell() {
  appContainer.innerHTML = `
    <div class="app-view">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          <button class="icon-btn menu-btn" data-tooltip="Menu" id="menu-toggle" aria-label="Menu">
            ${icons.menu}
          </button>
          <div class="app-title">Keep<span>Local</span></div>
        </div>
        <div class="header-search">
          <div class="search-container">
            <span class="search-icon">${icons.search}</span>
            <input type="text" placeholder="${t('header.search')}" id="search-input" autocomplete="off">
            <button class="icon-btn search-clear" id="search-clear" data-tooltip="${t('header.clearSearch')}">
              ${icons.close}
            </button>
          </div>
        </div>
        <div class="header-right">
          <button class="icon-btn" data-tooltip="${t('header.language')}" id="lang-toggle">
            ${icons.language}
          </button>
          <button class="icon-btn" data-tooltip="${t('header.theme')}" id="theme-toggle">
            ${icons.brightness}
          </button>
          <button class="icon-btn" data-tooltip="${t('header.lock')}" id="lock-btn">
            ${icons.lock}
          </button>
        </div>
      </header>

      <!-- Sidebar overlay (mobile) -->
      <div class="sidebar-overlay" id="sidebar-overlay"></div>

      <!-- Sidebar -->
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-nav">
          <div class="sidebar-item active" data-view="notes">
            <span class="sidebar-icon">${icons.lightbulb}</span>
            <span class="sidebar-item-text">${t('sidebar.notes')}</span>
          </div>
          <div class="sidebar-divider"></div>
          <div class="sidebar-section-title" id="labels-section-title">${t('sidebar.labels')}</div>
          <div id="sidebar-labels"></div>
          <div class="sidebar-item" id="edit-labels-btn">
            <span class="sidebar-icon">${icons.edit}</span>
            <span class="sidebar-item-text">${t('sidebar.editLabels')}</span>
          </div>
          <div class="sidebar-divider"></div>
          <div class="sidebar-item" data-view="archive">
            <span class="sidebar-icon">${icons.archive}</span>
            <span class="sidebar-item-text">${t('sidebar.archive')}</span>
          </div>
          <div class="sidebar-item" data-view="trash">
            <span class="sidebar-icon">${icons.delete_icon}</span>
            <span class="sidebar-item-text">${t('sidebar.trash')}</span>
          </div>
          <div class="sidebar-divider"></div>
          <div class="sidebar-item" id="backup-btn">
            <span class="sidebar-icon">${icons.backup}</span>
            <span class="sidebar-item-text">${t('sidebar.backup')}</span>
          </div>
        </div>
      </nav>

      <!-- Main content -->
      <main class="main-content" id="main-content">
        <div id="main-inner"></div>
      </main>

      <!-- Modal overlay -->
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-card" id="modal-card"></div>
      </div>

      <!-- Toast container -->
      <div class="toast-container" id="toast-container"></div>
    </div>
  `;

  initAppListeners();
}

function initAppListeners() {
  // Menu toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('main-content');
    const overlay = document.getElementById('sidebar-overlay');

    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
      overlay.classList.toggle('visible');
    } else {
      sidebarCollapsed = !sidebarCollapsed;
      sidebar.classList.toggle('collapsed', sidebarCollapsed);
      main.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    }
  });

  // Sidebar overlay (mobile close)
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Language toggle
  document.getElementById('lang-toggle').addEventListener('click', async () => {
    const newLang = getLang() === 'pt-BR' ? 'en' : 'pt-BR';
    await setLang(newLang);
    document.title = t('app.title');
    await showApp();
  });

  // Lock
  document.getElementById('lock-btn').addEventListener('click', () => {
    logout();
    showAuth();
  });

  // Sidebar navigation
  document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      currentView = item.dataset.view;
      currentLabel = null;
      updateSidebarActive(item);
      renderCurrentView();
      closeMobileSidebar();
    });
  });

  // Search
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  let searchTimeout;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchClear.classList.toggle('visible', searchInput.value.length > 0);
    searchTimeout = setTimeout(() => renderCurrentView(), 300);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.remove('visible');
    renderCurrentView();
  });

  // Backup
  document.getElementById('backup-btn').addEventListener('click', async () => {
    const { exportBackup } = await import('./backup.js');
    await exportBackup();
    showToast(t('toast.backupExported'));
    closeMobileSidebar();
  });

  // Edit labels
  document.getElementById('edit-labels-btn').addEventListener('click', () => {
    openLabelsManager();
    closeMobileSidebar();
  });

  // Modal overlay click to close
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      closeModal();
    }
  });

  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-overlay');
      if (modal.classList.contains('open')) {
        closeModal();
      }
    }
  });
}

function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

function updateSidebarActive(activeItem) {
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  activeItem.classList.add('active');
}

// --- Notes Management ---

async function loadNotes() {
  const { getAllNoteRecords } = await import('./db.js');
  const { decrypt } = await import('./crypto.js');
  const { base64ToArray, base64ToArrayBuffer } = await import('./crypto.js');

  const records = await getAllNoteRecords();
  notes = [];

  for (const record of records) {
    try {
      const iv = base64ToArray(record.iv);
      const ciphertext = base64ToArrayBuffer(record.ciphertext);
      const json = await decrypt(cryptoKey, iv, ciphertext);
      notes.push(JSON.parse(json));
    } catch (err) {
      console.error('Failed to decrypt note:', record.id, err);
    }
  }
}

export async function saveNote(note) {
  const { encrypt, arrayToBase64, arrayBufferToBase64 } = await import('./crypto.js');
  const { saveNoteRecord } = await import('./db.js');
  const { setUnsaved } = await import('./backup.js');

  note.updatedAt = Date.now();

  const json = JSON.stringify(note);
  const { iv, ciphertext } = await encrypt(cryptoKey, json);

  await saveNoteRecord({
    id: note.id,
    iv: arrayToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
    updatedAt: note.updatedAt,
  });

  // Update in-memory array
  const idx = notes.findIndex(n => n.id === note.id);
  if (idx >= 0) {
    notes[idx] = note;
  } else {
    notes.push(note);
  }

  setUnsaved();
}

export async function permanentDeleteNote(id) {
  const { deleteNoteRecord } = await import('./db.js');
  const { setUnsaved } = await import('./backup.js');

  await deleteNoteRecord(id);
  notes = notes.filter(n => n.id !== id);
  setUnsaved();
}

export function getNotes() {
  return notes;
}

export function getCryptoKey() {
  return cryptoKey;
}

// --- View Rendering ---

function renderCurrentView() {
  const searchQuery = document.getElementById('search-input')?.value?.trim().toLowerCase() || '';

  switch (currentView) {
    case 'notes':
      renderNotesView(searchQuery);
      break;
    case 'archive':
      renderArchiveView(searchQuery);
      break;
    case 'trash':
      renderTrashView(searchQuery);
      break;
    case 'label':
      renderLabelView(currentLabel, searchQuery);
      break;
  }

  updateSidebarLabels();
}

function filterNotes(notesList, searchQuery) {
  if (!searchQuery) return notesList;
  return notesList.filter(n => {
    const titleMatch = n.title?.toLowerCase().includes(searchQuery);
    const contentMatch = n.type === 'text' && n.content?.toLowerCase().includes(searchQuery);
    const taskMatch = n.type === 'todo' && n.tasks?.some(t => t.text?.toLowerCase().includes(searchQuery));
    return titleMatch || contentMatch || taskMatch;
  });
}

function renderNotesView(searchQuery) {
  const active = notes.filter(n => !n.deletedAt && !n.archivedAt);
  const filtered = filterNotes(active, searchQuery);
  const pinned = filtered.filter(n => n.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const unpinned = filtered.filter(n => !n.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const mainInner = document.getElementById('main-inner');
  let html = renderNewNoteBar();

  if (filtered.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.lightbulb}</div>
      <div class="empty-text">${t('notes.empty')}</div>
    </div>`;
  } else {
    if (pinned.length > 0) {
      html += `<div class="section-header">${t('notes.pinned')}</div>`;
      html += `<div class="notes-grid" id="pinned-grid">${pinned.map(renderNoteCard).join('')}</div>`;
    }
    if (pinned.length > 0 && unpinned.length > 0) {
      html += `<div class="section-header">${t('notes.others')}</div>`;
    }
    if (unpinned.length > 0) {
      html += `<div class="notes-grid" id="unpinned-grid">${unpinned.map(renderNoteCard).join('')}</div>`;
    }
  }

  mainInner.innerHTML = html;
  initNewNoteBar();
  initCardListeners();
}

function renderArchiveView(searchQuery) {
  const archived = notes.filter(n => n.archivedAt && !n.deletedAt);
  const filtered = filterNotes(archived, searchQuery);

  const mainInner = document.getElementById('main-inner');
  let html = '';

  if (filtered.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.archive}</div>
      <div class="empty-text">${t('archive.empty')}</div>
    </div>`;
  } else {
    html += `<div class="notes-grid">${filtered.map(n => renderNoteCard(n, true)).join('')}</div>`;
  }

  mainInner.innerHTML = html;
  initCardListeners();
}

function renderTrashView(searchQuery) {
  const trashed = notes.filter(n => n.deletedAt);
  const filtered = filterNotes(trashed, searchQuery);

  // Auto-purge expired (7 days)
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  filtered.forEach(n => {
    if (now - n.deletedAt > sevenDays) {
      permanentDeleteNote(n.id);
    }
  });

  const valid = filtered.filter(n => now - n.deletedAt <= sevenDays);

  const mainInner = document.getElementById('main-inner');
  let html = '';

  if (trashed.length > 0) {
    html += `<div style="padding: 8px 8px 16px; color: var(--text-secondary); font-size: 13px;">
      ${t('trash.autoDelete')}
      <button class="btn-secondary" id="empty-trash-btn" style="margin-left: 8px; padding: 4px 12px; font-size: 13px;">${t('trash.emptyTrash')}</button>
    </div>`;
  }

  if (valid.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.delete_icon}</div>
      <div class="empty-text">${t('trash.empty')}</div>
    </div>`;
  } else {
    html += `<div class="notes-grid">${valid.map(n => renderNoteCard(n, false, true)).join('')}</div>`;
  }

  mainInner.innerHTML = html;
  initCardListeners();

  document.getElementById('empty-trash-btn')?.addEventListener('click', async () => {
    if (await showConfirm(t('trash.confirmEmpty'))) {
      const trashedNotes = notes.filter(n => n.deletedAt);
      for (const n of trashedNotes) {
        await permanentDeleteNote(n.id);
      }
      renderCurrentView();
      showToast(t('trash.emptied'));
    }
  });
}

function renderLabelView(label, searchQuery) {
  const labeled = notes.filter(n => !n.deletedAt && !n.archivedAt && n.labels?.includes(label));
  const filtered = filterNotes(labeled, searchQuery);

  const mainInner = document.getElementById('main-inner');
  let html = `<div class="section-header">${escapeHTMLString(label)}</div>`;

  if (filtered.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">${icons.label}</div>
      <div class="empty-text">${t('labels.empty')}</div>
    </div>`;
  } else {
    html += `<div class="notes-grid">${filtered.map(renderNoteCard).join('')}</div>`;
  }

  mainInner.innerHTML = html;
  initCardListeners();
}

// --- Card Rendering ---

function renderNoteCard(note, isArchiveView = false, isTrashView = false) {
  const colorAttr = note.color && note.color !== 'default' ? `data-color="${note.color}"` : '';
  const pinClass = note.pinned ? 'pinned' : '';

  let contentHtml = '';
  if (note.type === 'text') {
    const preview = (note.content || '').replace(/[#*_`~\[\]]/g, '').slice(0, 200);
    contentHtml = `<div class="card-content">${escapeHTMLString(preview)}</div>`;
  } else if (note.type === 'todo') {
    const tasks = note.tasks || [];
    const pending = tasks.filter(t => !t.done && !t.parentId).slice(0, 5);
    const done = tasks.filter(t => t.done && !t.parentId);
    contentHtml = '<div class="card-tasks">';
    for (const t of pending) {
      contentHtml += `<div class="card-task-item"><span class="task-check"></span><span class="task-text">${escapeHTMLString(t.text)}</span></div>`;
    }
    for (const t of done.slice(0, 3)) {
      contentHtml += `<div class="card-task-item"><span class="task-check checked"></span><span class="task-text done">${escapeHTMLString(t.text)}</span></div>`;
    }
    const remaining = tasks.length - pending.length - Math.min(done.length, 3);
    if (remaining > 0) {
      contentHtml += `<div class="card-tasks-more">${tp('card.itemCount', remaining)}</div>`;
    }
    contentHtml += '</div>';
  }

  const labelsHtml = note.labels?.length
    ? `<div class="card-labels">${note.labels.map(l => `<span class="label-chip">${escapeHTMLString(l)}</span>`).join('')}</div>`
    : '';

  let toolbarHtml = '';
  if (isTrashView) {
    toolbarHtml = `
      <button class="icon-btn card-action" data-action="restore" data-id="${note.id}" data-tooltip="${t('card.restore')}">${icons.restore}</button>
      <button class="icon-btn card-action" data-action="delete-forever" data-id="${note.id}" data-tooltip="${t('card.deletePermanently')}">${icons.delete_forever}</button>
    `;
  } else if (isArchiveView) {
    toolbarHtml = `
      <button class="icon-btn card-action" data-action="unarchive" data-id="${note.id}" data-tooltip="${t('card.unarchive')}">${icons.unarchive}</button>
      <button class="icon-btn card-action" data-action="trash" data-id="${note.id}" data-tooltip="${t('card.delete')}">${icons.delete_icon}</button>
    `;
  } else {
    toolbarHtml = `
      <button class="icon-btn card-action" data-action="color" data-id="${note.id}" data-tooltip="${t('card.color')}">${icons.palette}</button>
      <button class="icon-btn card-action" data-action="archive" data-id="${note.id}" data-tooltip="${t('card.archive')}">${icons.archive}</button>
      <button class="icon-btn card-action" data-action="trash" data-id="${note.id}" data-tooltip="${t('card.delete')}">${icons.delete_icon}</button>
      <button class="icon-btn card-action" data-action="more" data-id="${note.id}" data-tooltip="${t('card.more')}">${icons.more_vert}</button>
    `;
  }

  return `
    <div class="note-card" data-id="${note.id}" ${colorAttr} draggable="true">
      <button class="icon-btn card-pin ${pinClass} card-action" data-action="pin" data-id="${note.id}" data-tooltip="${note.pinned ? t('card.unpin') : t('card.pin')}">
        ${note.pinned ? icons.pin_filled : icons.pin}
      </button>
      <div class="card-inner">
        ${note.title ? `<div class="card-title">${escapeHTMLString(note.title)}</div>` : ''}
        ${contentHtml}
      </div>
      ${labelsHtml}
      <div class="card-footer">
        <div class="card-toolbar">${toolbarHtml}</div>
        <div class="card-timestamp">${formatDateShort(note.updatedAt)}</div>
      </div>
    </div>
  `;
}

function initCardListeners() {
  // Card click to open modal
  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't open if clicking action buttons
      if (e.target.closest('.card-action') || e.target.closest('.card-toolbar')) return;
      const id = card.dataset.id;
      const note = notes.find(n => n.id === id);
      if (note) openNoteModal(note);
    });
  });

  // Card actions
  document.querySelectorAll('.card-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const note = notes.find(n => n.id === id);
      if (!note) return;

      switch (action) {
        case 'pin':
          note.pinned = !note.pinned;
          await saveNote(note);
          renderCurrentView();
          break;
        case 'archive':
          note.archivedAt = Date.now();
          await saveNote(note);
          renderCurrentView();
          showToast(t('toast.noteArchived'), t('toast.undo'), async () => {
            note.archivedAt = null;
            await saveNote(note);
            renderCurrentView();
          });
          break;
        case 'unarchive':
          note.archivedAt = null;
          await saveNote(note);
          renderCurrentView();
          showToast(t('toast.noteUnarchived'));
          break;
        case 'trash':
          note.deletedAt = Date.now();
          await saveNote(note);
          renderCurrentView();
          showToast(t('toast.noteToTrash'), t('toast.undo'), async () => {
            note.deletedAt = null;
            await saveNote(note);
            renderCurrentView();
          });
          break;
        case 'restore':
          note.deletedAt = null;
          note.archivedAt = null;
          await saveNote(note);
          renderCurrentView();
          showToast(t('toast.noteRestored'));
          break;
        case 'delete-forever':
          if (await showConfirm(t('confirm.deletePermanently'))) {
            await permanentDeleteNote(id);
            renderCurrentView();
            showToast(t('toast.noteDeletedForever'));
          }
          break;
        case 'color':
          openColorPicker(btn, note);
          break;
        case 'more':
          openCardMenu(btn, note);
          break;
      }
    });
  });

  initCardDragDrop();
}

// --- New Note Bar ---

function renderNewNoteBar() {
  return `
    <div class="new-note-bar" id="new-note-bar">
      <div class="new-note-collapsed">
        <span class="new-note-placeholder">${t('notes.createNote')}</span>
        <div class="new-note-actions">
          <button class="icon-btn" data-tooltip="${t('notes.newList')}" id="new-todo-btn">${icons.check_list}</button>
        </div>
      </div>
      <div class="new-note-expanded">
        <input class="new-note-title" placeholder="${t('modal.titlePlaceholder')}" id="new-note-title" autocomplete="off">
        <textarea class="new-note-body" placeholder="${t('notes.createNote')}" id="new-note-body" rows="1"></textarea>
        <div class="new-note-toolbar">
          <div class="toolbar-left">
            <button class="icon-btn" data-tooltip="${t('modal.color')}" id="new-note-color-btn">${icons.palette}</button>
            <button class="icon-btn" data-tooltip="${t('modal.labels')}" id="new-note-label-btn">${icons.label}</button>
          </div>
          <div class="toolbar-right">
            <button class="btn-secondary" id="new-note-close">${t('modal.close')}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initNewNoteBar() {
  const bar = document.getElementById('new-note-bar');
  if (!bar) return;

  const collapsed = bar.querySelector('.new-note-collapsed');
  const titleInput = document.getElementById('new-note-title');
  const bodyInput = document.getElementById('new-note-body');
  const closeBtn = document.getElementById('new-note-close');
  const newTodoBtn = document.getElementById('new-todo-btn');

  // Click on collapsed bar → expand for text note
  collapsed.addEventListener('click', (e) => {
    if (e.target.closest('#new-todo-btn')) return;
    bar.classList.add('expanded');
    titleInput.focus();
  });

  // New todo button
  newTodoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    createNewNote('todo');
  });

  // Close new note bar
  closeBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();

    if (title || body) {
      await createNewNote('text', title, body);
    }

    bar.classList.remove('expanded');
    titleInput.value = '';
    bodyInput.value = '';
  });

  // Auto-resize textarea
  bodyInput.addEventListener('input', () => {
    bodyInput.style.height = 'auto';
    bodyInput.style.height = bodyInput.scrollHeight + 'px';
  });

  // Click outside to close
  document.addEventListener('click', async (e) => {
    if (!bar.classList.contains('expanded')) return;
    if (bar.contains(e.target)) return;

    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();

    if (title || body) {
      await createNewNote('text', title, body);
    }

    bar.classList.remove('expanded');
    titleInput.value = '';
    bodyInput.value = '';
  });
}

async function createNewNote(type, title = '', content = '') {
  const { generateUUID } = await import('./utils.js');

  const note = {
    id: generateUUID(),
    type,
    title,
    color: 'default',
    pinned: false,
    labels: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    archivedAt: null,
    order: notes.filter(n => !n.deletedAt && !n.archivedAt).length,
  };

  if (type === 'text') {
    note.content = content;
  } else {
    note.tasks = [];
  }

  await saveNote(note);

  if (type === 'todo') {
    openNoteModal(note);
  } else {
    renderCurrentView();
  }
}

// --- Note Modal ---

function openNoteModal(note) {
  if (note.type === 'text') {
    openTextModal(note);
  } else {
    openTodoModal(note);
  }
}

function openTextModal(note) {
  const modal = document.getElementById('modal-card');
  const colorAttr = note.color && note.color !== 'default' ? `data-color="${note.color}"` : '';

  modal.innerHTML = `
    <div class="modal-header">
      <input class="modal-title-input" placeholder="${t('modal.titlePlaceholder')}" value="${escapeAttr(note.title || '')}" id="modal-title" autocomplete="off">
      <button class="icon-btn modal-pin-btn ${note.pinned ? 'pinned' : ''}" id="modal-pin" data-tooltip="${note.pinned ? t('modal.unpin') : t('modal.pin')}">
        ${note.pinned ? icons.pin_filled : icons.pin}
      </button>
    </div>
    <div class="modal-body">
      <textarea class="note-editor" placeholder="${t('textModal.placeholder')}" id="modal-editor">${escapeHTMLString(note.content || '')}</textarea>
      <div class="note-preview hidden" id="modal-preview"></div>
    </div>
    <div class="modal-footer">
      <div class="modal-toolbar-left">
        <button class="icon-btn" data-tooltip="${t('modal.color')}" id="modal-color-btn">${icons.palette}</button>
        <button class="icon-btn" data-tooltip="${t('modal.labels')}" id="modal-labels-btn">${icons.label}</button>
        <button class="icon-btn" data-tooltip="${t('modal.duplicate')}" id="modal-duplicate-btn">${icons.copy}</button>
        <button class="icon-btn" data-tooltip="${t('modal.archive')}" id="modal-archive-btn">${icons.archive}</button>
        <button class="icon-btn" data-tooltip="${t('modal.delete')}" id="modal-delete-btn">${icons.delete_icon}</button>
        <button class="icon-btn" data-tooltip="${t('modal.undo')}" id="modal-undo-btn">${icons.undo}</button>
        <button class="icon-btn" data-tooltip="${t('modal.redo')}" id="modal-redo-btn">${icons.redo}</button>
        <button class="md-toggle" id="modal-md-toggle" data-tooltip="${t('textModal.markdownToggle')}">
          ${icons.markdown} <span>${t('textModal.preview')}</span>
        </button>
      </div>
      <div class="modal-toolbar-right">
        <span class="modal-timestamp">${t('modal.edited', { time: formatDateShort(note.updatedAt) })}</span>
        <button class="modal-close-btn" id="modal-close">${t('modal.close')}</button>
      </div>
    </div>
  `;

  if (colorAttr) modal.setAttribute('data-color', note.color);
  else modal.removeAttribute('data-color');

  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');

  // --- Undo/Redo ---
  const history = createHistory({ title: note.title || '', content: note.content || '' });
  const undoBtn = document.getElementById('modal-undo-btn');
  const redoBtn = document.getElementById('modal-redo-btn');

  function updateUndoRedoBtns() {
    undoBtn.style.opacity = history.canUndo() ? '1' : '0.3';
    redoBtn.style.opacity = history.canRedo() ? '1' : '0.3';
  }
  updateUndoRedoBtns();

  undoBtn.addEventListener('click', () => {
    const prev = history.undo();
    if (prev) {
      document.getElementById('modal-title').value = prev.title;
      editor.value = prev.content;
      note.title = prev.title;
      note.content = prev.content;
      saveNote(note);
      updateUndoRedoBtns();
    }
  });

  redoBtn.addEventListener('click', () => {
    const next = history.redo();
    if (next) {
      document.getElementById('modal-title').value = next.title;
      editor.value = next.content;
      note.title = next.title;
      note.content = next.content;
      saveNote(note);
      updateUndoRedoBtns();
    }
  });

  // Ctrl+Z / Ctrl+Y
  const keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undoBtn.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      redoBtn.click();
    }
  };
  document.addEventListener('keydown', keyHandler);
  // Store handler ref to remove on close
  modal._keyHandler = keyHandler;

  // --- Text modal listeners ---
  const { debounce } = getUtils();
  const editor = document.getElementById('modal-editor');
  const preview = document.getElementById('modal-preview');
  const mdToggle = document.getElementById('modal-md-toggle');
  let previewMode = false;

  const pushHistory = debounce(() => {
    history.push({ title: document.getElementById('modal-title').value, content: editor.value });
    updateUndoRedoBtns();
  }, 500);

  const autoSave = debounce(async () => {
    note.title = document.getElementById('modal-title').value;
    note.content = editor.value;
    await saveNote(note);
    updateModalTimestamp(note);
  }, 2000);

  editor.addEventListener('input', () => { pushHistory(); autoSave(); });
  document.getElementById('modal-title').addEventListener('input', () => { pushHistory(); autoSave(); });

  editor.addEventListener('blur', async () => {
    note.title = document.getElementById('modal-title').value;
    note.content = editor.value;
    await saveNote(note);
    updateModalTimestamp(note);
  });

  // Markdown toggle
  mdToggle.addEventListener('click', () => {
    previewMode = !previewMode;
    mdToggle.classList.toggle('active', previewMode);

    if (previewMode) {
      let rendered = window.marked ? window.marked.parse(editor.value || '') : escapeHTMLString(editor.value || '');
      if (window.DOMPurify) rendered = window.DOMPurify.sanitize(rendered);
      preview.innerHTML = rendered;
      editor.classList.add('hidden');
      preview.classList.remove('hidden');
    } else {
      editor.classList.remove('hidden');
      preview.classList.add('hidden');
    }
  });

  // Pin
  document.getElementById('modal-pin').addEventListener('click', async () => {
    note.pinned = !note.pinned;
    await saveNote(note);
    document.getElementById('modal-pin').classList.toggle('pinned', note.pinned);
    document.getElementById('modal-pin').innerHTML = note.pinned ? icons.pin_filled : icons.pin;
  });

  // Close
  document.getElementById('modal-close').addEventListener('click', () => closeModal());

  // Archive
  document.getElementById('modal-archive-btn').addEventListener('click', async () => {
    note.archivedAt = Date.now();
    await saveNote(note);
    closeModal();
    renderCurrentView();
    showToast(t('toast.noteArchived'));
  });

  // Delete
  document.getElementById('modal-delete-btn').addEventListener('click', async () => {
    note.deletedAt = Date.now();
    await saveNote(note);
    closeModal();
    renderCurrentView();
    showToast(t('toast.noteToTrash'), t('toast.undo'), async () => {
      note.deletedAt = null;
      await saveNote(note);
      renderCurrentView();
    });
  });

  // Duplicate
  document.getElementById('modal-duplicate-btn').addEventListener('click', async () => {
    const { generateUUID } = await import('./utils.js');
    const { deepClone } = await import('./utils.js');
    const dup = deepClone(note);
    dup.id = generateUUID();
    dup.title = (dup.title || t('todo.noTitle')) + t('todo.copySuffix');
    dup.createdAt = Date.now();
    dup.updatedAt = Date.now();
    dup.pinned = false;
    await saveNote(dup);
    closeModal();
    renderCurrentView();
    showToast(t('toast.noteDuplicated'));
  });

  // Color
  document.getElementById('modal-color-btn').addEventListener('click', () => {
    openColorPickerModal(note);
  });

  // Labels
  document.getElementById('modal-labels-btn').addEventListener('click', () => {
    openLabelsPickerModal(note);
  });
}

function openTodoModal(note) {
  const modal = document.getElementById('modal-card');
  const colorAttr = note.color && note.color !== 'default' ? `data-color="${note.color}"` : '';

  if (colorAttr) modal.setAttribute('data-color', note.color);
  else modal.removeAttribute('data-color');

  // Initialize undo/redo history for todo modal
  const { deepClone } = getUtils();
  todoHistory = createHistory({ title: note.title || '', tasks: deepClone(note.tasks || []) });

  renderTodoModalContent(note);

  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');

  // Ctrl+Z / Ctrl+Y for todo modal
  const keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      document.getElementById('modal-undo-btn')?.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      document.getElementById('modal-redo-btn')?.click();
    }
  };
  document.addEventListener('keydown', keyHandler);
  modal._keyHandler = keyHandler;
}

function renderTodoModalContent(note) {
  const modal = document.getElementById('modal-card');
  const tasks = note.tasks || [];
  const pending = tasks.filter(t => !t.done).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = tasks.filter(t => t.done).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const pendingRoots = pending.filter(t => !t.parentId);
  const doneRoots = done.filter(t => !t.parentId);

  function renderTaskItem(task, isDone) {
    const children = tasks.filter(t => t.parentId === task.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const checkedClass = isDone ? 'checked' : '';
    const textClass = isDone ? 'todo-text-done' : '';

    let html = `
      <div class="todo-item ${isDone ? '' : ''}" data-task-id="${task.id}" draggable="true">
        <span class="drag-handle" title="${t('todo.drag')}">⠿</span>
        <span class="todo-checkbox ${checkedClass}" data-task-id="${task.id}"></span>
        <input class="todo-text ${textClass}" value="${escapeAttr(task.text)}" data-task-id="${task.id}" ${isDone ? 'style="text-decoration:line-through; color:var(--text-disabled)"' : ''}>
        <span class="todo-item-delete" data-task-id="${task.id}" title="${t('todo.deleteTask')}">✕</span>
      </div>
    `;

    for (const child of children) {
      const childChecked = child.done ? 'checked' : '';
      const childTextClass = child.done ? 'todo-text-done' : '';
      html += `
        <div class="todo-item subitem" data-task-id="${child.id}" draggable="true">
          <span class="drag-handle" title="${t('todo.drag')}">⠿</span>
          <span class="todo-checkbox ${childChecked}" data-task-id="${child.id}"></span>
          <input class="todo-text ${childTextClass}" value="${escapeAttr(child.text)}" data-task-id="${child.id}" ${child.done ? 'style="text-decoration:line-through; color:var(--text-disabled)"' : ''}>
          <span class="todo-item-delete" data-task-id="${child.id}" title="${t('todo.deleteTask')}">✕</span>
        </div>
      `;
    }

    return html;
  }

  modal.innerHTML = `
    <div class="modal-header">
      <input class="modal-title-input" placeholder="${t('modal.titlePlaceholder')}" value="${escapeAttr(note.title || '')}" id="modal-title" autocomplete="off">
      <button class="icon-btn modal-pin-btn ${note.pinned ? 'pinned' : ''}" id="modal-pin" data-tooltip="${note.pinned ? t('modal.unpin') : t('modal.pin')}">
        ${note.pinned ? icons.pin_filled : icons.pin}
      </button>
    </div>
    <div class="modal-body">
      <!-- Pending tasks -->
      <div class="todo-section" id="pending-section">
        <div class="todo-section-header">
          <span style="font-size:13px; color: var(--text-secondary);">${tp('todo.pendingCount', pendingRoots.length)}</span>
          <div class="section-actions">
            ${pendingRoots.length > 0 ? `<button class="icon-btn" data-tooltip="${t('todo.checkAll')}" id="check-all-btn">${icons.check_all}</button>` : ''}
          </div>
        </div>
        <div class="todo-items" id="pending-items">
          ${pendingRoots.map(t => renderTaskItem(t, false)).join('')}
        </div>
        <div class="todo-add">
          <span class="add-icon">+</span>
          <input placeholder="${t('todo.addPlaceholder')}" id="add-task-input" autocomplete="off">
        </div>
      </div>

      <!-- Done tasks -->
      ${doneRoots.length > 0 ? `
      <div class="todo-section" id="done-section">
        <div class="todo-section-header">
          <span class="section-toggle" id="done-toggle">
            <span class="toggle-arrow" id="done-arrow">▼</span>
            ${tp('todo.doneCount', doneRoots.length)}
          </span>
          <div class="section-actions">
            <button class="icon-btn" data-tooltip="${t('todo.uncheckAll')}" id="uncheck-all-btn">${icons.uncheck_all}</button>
          </div>
        </div>
        <div class="todo-items" id="done-items">
          ${doneRoots.map(t => renderTaskItem(t, true)).join('')}
        </div>
      </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <div class="modal-toolbar-left">
        <button class="icon-btn" data-tooltip="${t('modal.color')}" id="modal-color-btn">${icons.palette}</button>
        <button class="icon-btn" data-tooltip="${t('modal.labels')}" id="modal-labels-btn">${icons.label}</button>
        <button class="icon-btn" data-tooltip="${t('modal.duplicate')}" id="modal-duplicate-btn">${icons.copy}</button>
        <button class="icon-btn" data-tooltip="${t('modal.archive')}" id="modal-archive-btn">${icons.archive}</button>
        <button class="icon-btn" data-tooltip="${t('modal.delete')}" id="modal-delete-btn">${icons.delete_icon}</button>
        <button class="icon-btn" data-tooltip="${t('modal.undo')}" id="modal-undo-btn">${icons.undo}</button>
        <button class="icon-btn" data-tooltip="${t('modal.redo')}" id="modal-redo-btn">${icons.redo}</button>
      </div>
      <div class="modal-toolbar-right">
        <span class="modal-timestamp">${t('modal.edited', { time: formatDateShort(note.updatedAt) })}</span>
        <button class="modal-close-btn" id="modal-close">${t('modal.close')}</button>
      </div>
    </div>
  `;

  initTodoModalListeners(note);
}

function initTodoModalListeners(note) {
  const { deepClone } = getUtils();

  // --- Undo/Redo ---
  const undoBtn = document.getElementById('modal-undo-btn');
  const redoBtn = document.getElementById('modal-redo-btn');

  function updateUndoRedoBtns() {
    if (undoBtn) undoBtn.style.opacity = todoHistory?.canUndo() ? '1' : '0.3';
    if (redoBtn) redoBtn.style.opacity = todoHistory?.canRedo() ? '1' : '0.3';
  }
  updateUndoRedoBtns();

  function pushTodoHistory() {
    if (todoHistory) {
      todoHistory.push({ title: note.title || '', tasks: deepClone(note.tasks || []) });
      updateUndoRedoBtns();
    }
  }

  undoBtn?.addEventListener('click', async () => {
    const prev = todoHistory?.undo();
    if (prev) {
      note.title = prev.title;
      note.tasks = deepClone(prev.tasks);
      await saveNote(note);
      renderTodoModalContent(note);
    }
  });

  redoBtn?.addEventListener('click', async () => {
    const next = todoHistory?.redo();
    if (next) {
      note.title = next.title;
      note.tasks = deepClone(next.tasks);
      await saveNote(note);
      renderTodoModalContent(note);
    }
  });

  // Title
  const titleInput = document.getElementById('modal-title');
  titleInput.addEventListener('blur', async () => {
    note.title = titleInput.value;
    await saveNote(note);
    updateModalTimestamp(note);
    pushTodoHistory();
  });

  // Add task
  const addInput = document.getElementById('add-task-input');
  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      e.preventDefault();
      const { generateUUID } = await import('./utils.js');
      const tasks = note.tasks || [];
      tasks.push({
        id: generateUUID(),
        text: addInput.value.trim(),
        done: false,
        order: tasks.filter(t => !t.done && !t.parentId).length,
        parentId: null,
      });
      note.tasks = tasks;
      await saveNote(note);
      addInput.value = '';
      pushTodoHistory();
      renderTodoModalContent(note);
      // Focus the add input again
      document.getElementById('add-task-input')?.focus();
    } else if (e.key === 'Tab' && addInput.value.trim()) {
      // Tab to create subitem under last pending root task
      e.preventDefault();
      const { generateUUID } = await import('./utils.js');
      const tasks = note.tasks || [];
      const pendingRoots = tasks.filter(t => !t.done && !t.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const lastRoot = pendingRoots[pendingRoots.length - 1];
      if (lastRoot) {
        tasks.push({
          id: generateUUID(),
          text: addInput.value.trim(),
          done: false,
          order: tasks.filter(t => t.parentId === lastRoot.id).length,
          parentId: lastRoot.id,
        });
        note.tasks = tasks;
        await saveNote(note);
        addInput.value = '';
        pushTodoHistory();
        renderTodoModalContent(note);
        document.getElementById('add-task-input')?.focus();
      }
    }
  });

  // Checkbox toggles
  document.querySelectorAll('#modal-card .todo-checkbox').forEach(cb => {
    cb.addEventListener('click', async () => {
      const taskId = cb.dataset.taskId;
      const task = note.tasks.find(t => t.id === taskId);
      if (!task) return;

      task.done = !task.done;
      // If parent, toggle children too
      note.tasks.filter(t => t.parentId === taskId).forEach(child => {
        child.done = task.done;
      });

      await saveNote(note);
      pushTodoHistory();
      renderTodoModalContent(note);
    });
  });

  // Edit task text
  document.querySelectorAll('#modal-card .todo-text').forEach(input => {
    input.addEventListener('blur', async () => {
      const taskId = input.dataset.taskId;
      const task = note.tasks.find(t => t.id === taskId);
      if (task) {
        task.text = input.value;
        await saveNote(note);
        pushTodoHistory();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });

  // Delete task
  document.querySelectorAll('#modal-card .todo-item-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      note.tasks = note.tasks.filter(t => t.id !== taskId && t.parentId !== taskId);
      await saveNote(note);
      pushTodoHistory();
      renderTodoModalContent(note);
    });
  });

  // Check all
  document.getElementById('check-all-btn')?.addEventListener('click', async () => {
    if (await showConfirm(t('todo.confirmCheckAll'))) {
      note.tasks.forEach(t => { t.done = true; });
      await saveNote(note);
      pushTodoHistory();
      renderTodoModalContent(note);
    }
  });

  // Uncheck all
  document.getElementById('uncheck-all-btn')?.addEventListener('click', async () => {
    if (await showConfirm(t('todo.confirmUncheckAll'))) {
      note.tasks.forEach(t => { t.done = false; });
      await saveNote(note);
      pushTodoHistory();
      renderTodoModalContent(note);
    }
  });

  // Done section toggle
  document.getElementById('done-toggle')?.addEventListener('click', () => {
    const items = document.getElementById('done-items');
    const arrow = document.getElementById('done-arrow');
    if (items) {
      const isHidden = items.style.display === 'none';
      items.style.display = isHidden ? 'flex' : 'none';
      arrow.classList.toggle('collapsed', !isHidden);
    }
  });

  // Pin
  document.getElementById('modal-pin').addEventListener('click', async () => {
    note.pinned = !note.pinned;
    await saveNote(note);
    document.getElementById('modal-pin').classList.toggle('pinned', note.pinned);
    document.getElementById('modal-pin').innerHTML = note.pinned ? icons.pin_filled : icons.pin;
  });

  // Close
  document.getElementById('modal-close').addEventListener('click', () => closeModal());

  // Archive
  document.getElementById('modal-archive-btn').addEventListener('click', async () => {
    note.archivedAt = Date.now();
    await saveNote(note);
    closeModal();
    renderCurrentView();
    showToast(t('toast.noteArchived'));
  });

  // Delete
  document.getElementById('modal-delete-btn').addEventListener('click', async () => {
    note.deletedAt = Date.now();
    await saveNote(note);
    closeModal();
    renderCurrentView();
    showToast(t('toast.noteToTrash'));
  });

  // Duplicate
  document.getElementById('modal-duplicate-btn').addEventListener('click', async () => {
    const { generateUUID, deepClone } = await import('./utils.js');
    const dup = deepClone(note);
    dup.id = generateUUID();
    dup.title = (dup.title || t('todo.noTitle')) + t('todo.copySuffix');
    dup.createdAt = Date.now();
    dup.updatedAt = Date.now();
    dup.pinned = false;
    dup.tasks = dup.tasks.map(t => ({ ...t, id: generateUUID() }));
    // Fix parentId references
    const idMap = {};
    note.tasks.forEach((t, i) => { idMap[t.id] = dup.tasks[i].id; });
    dup.tasks.forEach(t => { if (t.parentId) t.parentId = idMap[t.parentId] || null; });
    await saveNote(dup);
    closeModal();
    renderCurrentView();
    showToast(t('toast.noteDuplicated'));
  });

  // Color
  document.getElementById('modal-color-btn').addEventListener('click', () => {
    openColorPickerModal(note);
  });

  // Labels
  document.getElementById('modal-labels-btn').addEventListener('click', () => {
    openLabelsPickerModal(note);
  });

  // Task drag and drop
  initTaskDragDrop(note);
}

function closeModal() {
  const modal = document.querySelector('.modal-card');
  if (modal && modal._keyHandler) {
    document.removeEventListener('keydown', modal._keyHandler);
  }
  document.getElementById('modal-overlay').classList.remove('open');
  renderCurrentView();
}

function updateModalTimestamp(note) {
  const ts = document.querySelector('.modal-timestamp');
  if (ts) ts.textContent = t('modal.edited', { time: formatDateShort(note.updatedAt) });
}

// --- Color Picker ---

function openColorPicker(anchorBtn, note) {
  // Remove any existing
  document.querySelectorAll('.color-picker-popup').forEach(p => p.remove());

  const colors = ['default', 'coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay', 'chalk'];
  const popup = document.createElement('div');
  popup.className = 'color-picker-popup';
  popup.style.cssText = 'position:absolute; z-index:200; background:var(--bg-elevated); border:1px solid var(--border-color); border-radius:8px; padding:8px; box-shadow:0 2px 10px rgba(0,0,0,0.3);';

  popup.innerHTML = `<div style="display:flex;gap:4px;flex-wrap:wrap;max-width:200px;">
    ${colors.map(c => {
      const selected = (note.color || 'default') === c ? 'selected' : '';
      const style = c === 'default' ? 'background:var(--card-bg);border:2px solid var(--border-color);' : `background:var(--note-${c});border:2px solid transparent;`;
      return `<div class="color-opt ${selected}" data-color="${c}" style="${style}width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;">${selected ? '✓' : ''}</div>`;
    }).join('')}
  </div>`;

  // Position
  const rect = anchorBtn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  popup.style.position = 'fixed';

  document.body.appendChild(popup);

  popup.addEventListener('click', async (e) => {
    const opt = e.target.closest('.color-opt');
    if (opt) {
      note.color = opt.dataset.color;
      const modal = document.getElementById('modal-card');
      if (modal && note.color && note.color !== 'default') {
        modal.setAttribute('data-color', note.color);
      } else if (modal) {
        modal.removeAttribute('data-color');
      }
      await saveNote(note);
      popup.remove();
      renderCurrentView();
    }
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target) && e.target !== anchorBtn) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  });
}

function openColorPickerModal(note) {
  const btn = document.getElementById('modal-color-btn');
  if (btn) openColorPicker(btn, note);
}

// --- Labels Picker ---

function openLabelsPickerModal(note) {
  document.querySelectorAll('.labels-picker-popup').forEach(p => p.remove());

  const allLabels = getAllLabels();
  const popup = document.createElement('div');
  popup.className = 'labels-picker-popup';
  popup.style.cssText = 'position:fixed; z-index:110; background:var(--bg-elevated); border:1px solid var(--border-color); border-radius:8px; padding:12px; box-shadow:0 2px 10px rgba(0,0,0,0.3); min-width:200px;';

  function renderPopup() {
    const labels = getAllLabels();
    popup.innerHTML = `
      <div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px;">Labels</div>
      ${labels.map(l => {
        const checked = note.labels?.includes(l) ? 'checked' : '';
        return `<div class="label-opt" data-label="${escapeAttr(l)}" style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:4px;font-size:13px;">
          <span style="width:16px;height:16px;border:2px solid var(--icon-color);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;${checked ? 'background:var(--accent-color);border-color:var(--accent-color);' : ''}">${checked ? '✓' : ''}</span>
          ${escapeHTMLString(l)}
        </div>`;
      }).join('')}
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:4px;">
        <input placeholder="${t('labels.newLabel')}" id="new-label-input" style="flex:1;border:none;border-bottom:1px solid var(--border-color);background:transparent;padding:4px;font-size:13px;color:var(--text-primary);">
      </div>
    `;
  }

  renderPopup();

  const btn = document.getElementById('modal-labels-btn');
  const rect = btn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(popup);

  popup.addEventListener('click', async (e) => {
    const opt = e.target.closest('.label-opt');
    if (opt) {
      const label = opt.dataset.label;
      if (!note.labels) note.labels = [];
      const idx = note.labels.indexOf(label);
      if (idx >= 0) note.labels.splice(idx, 1);
      else note.labels.push(label);
      await saveNote(note);
      renderPopup();
    }
  });

  popup.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const input = popup.querySelector('#new-label-input');
      if (input && input.value.trim()) {
        if (!note.labels) note.labels = [];
        const newLabel = input.value.trim();
        if (!note.labels.includes(newLabel)) {
          note.labels.push(newLabel);
        }
        await saveNote(note);
        renderPopup();
      }
    }
  });

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target) && e.target !== btn) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  });
}

function getAllLabels() {
  const labelSet = new Set();
  notes.forEach(n => {
    (n.labels || []).forEach(l => labelSet.add(l));
  });
  return Array.from(labelSet).sort();
}

function updateSidebarLabels() {
  const container = document.getElementById('sidebar-labels');
  if (!container) return;
  const labels = getAllLabels();

  container.innerHTML = labels.map(l => `
    <div class="sidebar-item ${currentView === 'label' && currentLabel === l ? 'active' : ''}" data-view="label" data-label="${escapeAttr(l)}">
      <span class="sidebar-icon">${icons.label}</span>
      <span class="sidebar-item-text">${escapeHTMLString(l)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.sidebar-item[data-label]').forEach(item => {
    item.addEventListener('click', () => {
      currentView = 'label';
      currentLabel = item.dataset.label;
      updateSidebarActive(item);
      renderCurrentView();
      closeMobileSidebar();
    });
  });
}

// --- Labels Manager ---

function openLabelsManager() {
  const modal = document.getElementById('modal-card');
  const labels = getAllLabels();

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title-input" style="font-size:16px;font-weight:500;cursor:default;">${t('labels.editLabels')}</span>
    </div>
    <div class="modal-body">
      <div class="labels-manager" id="labels-manager">
        ${labels.map(l => `
          <div class="label-row" data-label="${escapeAttr(l)}">
            <span class="label-icon">${icons.label}</span>
            <input class="label-name-input" value="${escapeAttr(l)}" data-old="${escapeAttr(l)}">
            <button class="icon-btn label-delete-btn" data-tooltip="${t('modal.delete')}" data-label="${escapeAttr(l)}">${icons.delete_icon}</button>
          </div>
        `).join('')}
        <div class="label-add-row" id="add-label-row">
          <span style="font-size:18px;">+</span>
          <input placeholder="${t('labels.newLabel')}" id="add-label-input" style="flex:1;border:none;background:transparent;font-size:14px;padding:4px;color:var(--text-primary);">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <div class="modal-toolbar-left"></div>
      <div class="modal-toolbar-right">
        <button class="modal-close-btn" id="modal-close">${t('modal.close')}</button>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');

  // Rename label
  document.querySelectorAll('.label-name-input').forEach(input => {
    input.addEventListener('blur', async () => {
      const oldName = input.dataset.old;
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        for (const note of notes) {
          if (note.labels?.includes(oldName)) {
            const idx = note.labels.indexOf(oldName);
            note.labels[idx] = newName;
            await saveNote(note);
          }
        }
        input.dataset.old = newName;
      }
    });
  });

  // Delete label
  document.querySelectorAll('.label-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const label = btn.dataset.label;
      for (const note of notes) {
        if (note.labels?.includes(label)) {
          note.labels = note.labels.filter(l => l !== label);
          await saveNote(note);
        }
      }
      btn.closest('.label-row').remove();
      updateSidebarLabels();
    });
  });

  // Add label
  const addLabelInput = document.getElementById('add-label-input');
  addLabelInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && addLabelInput.value.trim()) {
      // Label created — will show up when first assigned to a note
      addLabelInput.value = '';
      showToast(t('labels.assignToast'));
    }
  });

  document.getElementById('modal-close').addEventListener('click', () => closeModal());
}

// --- Card Menu (More) ---

function openCardMenu(anchorBtn, note) {
  document.querySelectorAll('.card-menu-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'card-menu-popup';
  popup.style.cssText = 'position:fixed;z-index:50;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:4px 0;box-shadow:0 2px 10px rgba(0,0,0,0.3);min-width:160px;';

  popup.innerHTML = `
    <div class="menu-item" data-action="duplicate" style="padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
      ${icons.copy} ${t('modal.duplicate')}
    </div>
    <div class="menu-item" data-action="labels" style="padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
      ${icons.label} ${t('modal.labels')}
    </div>
  `;

  const rect = anchorBtn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(popup);

  popup.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover)');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
  });

  popup.addEventListener('click', async (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    popup.remove();

    if (action === 'duplicate') {
      const { generateUUID, deepClone } = await import('./utils.js');
      const dup = deepClone(note);
      dup.id = generateUUID();
      dup.title = (dup.title || t('todo.noTitle')) + t('todo.copySuffix');
      dup.createdAt = Date.now();
      dup.updatedAt = Date.now();
      dup.pinned = false;
      if (dup.tasks) {
        const idMap = {};
        dup.tasks = dup.tasks.map(t => {
          const newId = generateUUID();
          idMap[t.id] = newId;
          return { ...t, id: newId };
        });
        dup.tasks.forEach(t => { if (t.parentId) t.parentId = idMap[t.parentId] || null; });
      }
      await saveNote(dup);
      renderCurrentView();
      showToast(t('toast.noteDuplicated'));
    } else if (action === 'labels') {
      openNoteModal(note);
      setTimeout(() => openLabelsPickerModal(note), 100);
    }
  });

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  });
}

// --- Card Drag & Drop ---

function initCardDragDrop() {
  const grids = document.querySelectorAll('.notes-grid');

  grids.forEach(grid => {
    const cards = grid.querySelectorAll('.note-card');

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        const targetId = card.dataset.id;
        if (draggedId === targetId) return;

        const draggedNote = notes.find(n => n.id === draggedId);
        const targetNote = notes.find(n => n.id === targetId);
        if (!draggedNote || !targetNote) return;

        // Swap order
        const tempOrder = draggedNote.order;
        draggedNote.order = targetNote.order;
        targetNote.order = tempOrder;

        await saveNote(draggedNote);
        await saveNote(targetNote);
        renderCurrentView();
      });
    });
  });
}

// --- Task Drag & Drop ---

function initTaskDragDrop(note) {
  let draggedTaskId = null;

  // Make individual items draggable via handle
  const items = document.querySelectorAll('#modal-card .todo-item');
  items.forEach(item => {
    const handle = item.querySelector('.drag-handle');

    handle.addEventListener('mousedown', () => {
      item.setAttribute('draggable', 'true');
    });

    item.addEventListener('dragstart', (e) => {
      draggedTaskId = item.dataset.taskId;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTaskId);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.drag-over, .drag-over-top, .drag-over-bottom').forEach(i => {
        i.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
      });
      draggedTaskId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item.dataset.taskId === draggedTaskId) return;

      // Determine if dropping above or below based on mouse position
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < midY) {
        item.classList.add('drag-over-top');
      } else {
        item.classList.add('drag-over-bottom');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      const droppedId = e.dataTransfer.getData('text/plain');
      const targetId = item.dataset.taskId;
      if (droppedId === targetId) return;

      const draggedTask = note.tasks.find(t => t.id === droppedId);
      const targetTask = note.tasks.find(t => t.id === targetId);
      if (!draggedTask || !targetTask) return;

      // Determine target section from which container this item is in
      const container = item.closest('.todo-items');
      const isDoneSection = container?.id === 'done-items';
      draggedTask.done = isDoneSection;

      // Also toggle children
      note.tasks.filter(t => t.parentId === draggedTask.id).forEach(child => {
        child.done = isDoneSection;
      });

      // If a root item is dropped on a root item, keep as root
      if (!targetTask.parentId && draggedTask.parentId && !item.classList.contains('subitem')) {
        draggedTask.parentId = null;
      }

      // Calculate insert position: before or after target
      const rect = item.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      // Get ordered list of root tasks in the target section
      const sectionTasks = note.tasks
        .filter(t => t.done === isDoneSection && !t.parentId && t.id !== draggedTask.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const targetIndex = sectionTasks.findIndex(t => t.id === targetId);
      const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

      // Insert dragged task at the correct position
      sectionTasks.splice(insertIndex, 0, draggedTask);

      // Reassign orders
      sectionTasks.forEach((t, i) => { t.order = i; });

      await saveNote(note);
      if (todoHistory) {
        const { deepClone } = getUtils();
        todoHistory.push({ title: note.title || '', tasks: deepClone(note.tasks || []) });
      }
      renderTodoModalContent(note);
    });
  });

  // Allow dropping on empty section containers (for cross-section drag)
  ['pending-items', 'done-items'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const isDoneSection = containerId === 'done-items';

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('drop', async (e) => {
      // Only handle if not already handled by a child item
      if (e.defaultPrevented) return;
      e.preventDefault();
      const droppedId = e.dataTransfer.getData('text/plain');
      const draggedTask = note.tasks.find(t => t.id === droppedId);
      if (!draggedTask) return;

      // Move to this section
      draggedTask.done = isDoneSection;
      note.tasks.filter(t => t.parentId === draggedTask.id).forEach(child => {
        child.done = isDoneSection;
      });

      // Put at the end of this section
      const sectionTasks = note.tasks
        .filter(t => t.done === isDoneSection && !t.parentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      draggedTask.order = sectionTasks.length;

      await saveNote(note);
      if (todoHistory) {
        const { deepClone } = getUtils();
        todoHistory.push({ title: note.title || '', tasks: deepClone(note.tasks || []) });
      }
      renderTodoModalContent(note);
    });
  });
}

// --- Toast ---

function showToast(message, actionText, onAction) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${escapeHTMLString(message)}</span>
    ${actionText ? `<span class="toast-action">${escapeHTMLString(actionText)}</span>` : ''}
  `;

  if (actionText && onAction) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      onAction();
      toast.remove();
    });
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 200);
  }, 5000);
}

// --- Confirm Dialog ---

function showConfirm(message) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div class="confirm-card">
        <div class="confirm-text">${escapeHTMLString(message)}</div>
        <div class="confirm-actions">
          <button class="btn-secondary" id="confirm-cancel">${t('confirm.cancel')}</button>
          <button class="btn-primary" id="confirm-ok">${t('confirm.ok')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.querySelector('#confirm-cancel').addEventListener('click', () => {
      dialog.remove();
      resolve(false);
    });

    dialog.querySelector('#confirm-ok').addEventListener('click', () => {
      dialog.remove();
      resolve(true);
    });
  });
}

// --- Helpers ---

function escapeHTMLString(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + time;
}

function getUtils() {
  // Sync access to utility functions for event handlers
  return {
    debounce: (fn, ms) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
      };
    },
    deepClone: (obj) => JSON.parse(JSON.stringify(obj))
  };
}
