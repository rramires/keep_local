// i18n.js — Internationalization module (EN / PT-BR)

import { saveMeta, getMeta } from './db.js';

let currentLang = 'en';

const en = {
  // App
  'app.title': 'KeepLocal — Secure Offline Notes',

  // Header
  'header.search': 'Search',
  'header.clearSearch': 'Clear',
  'header.theme': 'Theme',
  'header.lock': 'Lock',
  'header.language': 'Language',

  // Sidebar
  'sidebar.notes': 'Notes',
  'sidebar.labels': 'Labels',
  'sidebar.editLabels': 'Edit labels',
  'sidebar.archive': 'Archive',
  'sidebar.trash': 'Trash',
  'sidebar.backup': 'Backup',

  // Notes view
  'notes.empty': 'Your notes appear here',
  'notes.pinned': 'Pinned',
  'notes.others': 'Others',
  'notes.createNote': 'Take a note...',
  'notes.newList': 'New list',

  // Archive view
  'archive.empty': 'Archived notes appear here',

  // Trash view
  'trash.empty': 'Trash is empty',
  'trash.autoDelete': 'Notes in trash are automatically deleted after 7 days.',
  'trash.emptyTrash': 'Empty trash',
  'trash.confirmEmpty': 'Permanently delete all notes in trash?',
  'trash.emptied': 'Trash emptied.',

  // Labels view
  'labels.empty': 'No notes with this label',
  'labels.editLabels': 'Edit labels',
  'labels.newLabel': 'New label',
  'labels.assignToast': 'Label will be added when assigned to a note',

  // Card actions
  'card.restore': 'Restore',
  'card.deletePermanently': 'Delete permanently',
  'card.unarchive': 'Unarchive',
  'card.delete': 'Delete',
  'card.color': 'Color',
  'card.archive': 'Archive',
  'card.more': 'More',
  'card.unpin': 'Unpin',
  'card.pin': 'Pin',
  'card.itemCount': '{count} more item',
  'card.itemCountPlural': '{count} more items',

  // Modal (shared)
  'modal.titlePlaceholder': 'Title',
  'modal.close': 'Close',
  'modal.color': 'Color',
  'modal.labels': 'Labels',
  'modal.duplicate': 'Duplicate',
  'modal.archive': 'Archive',
  'modal.delete': 'Delete',
  'modal.undo': 'Undo',
  'modal.redo': 'Redo',
  'modal.edited': 'Edited {time}',
  'modal.unpin': 'Unpin',
  'modal.pin': 'Pin',

  // Text modal
  'textModal.placeholder': 'Take a note...',
  'textModal.markdownToggle': 'Toggle Markdown',
  'textModal.preview': 'Preview',

  // Todo modal
  'todo.pendingCount': '{count} pending task',
  'todo.pendingCountPlural': '{count} pending tasks',
  'todo.doneCount': '{count} completed item',
  'todo.doneCountPlural': '{count} completed items',
  'todo.checkAll': 'Complete all',
  'todo.uncheckAll': 'Reopen all',
  'todo.addPlaceholder': 'List item',
  'todo.drag': 'Drag',
  'todo.deleteTask': 'Delete',
  'todo.confirmCheckAll': 'Complete all pending tasks?',
  'todo.confirmUncheckAll': 'Reopen all completed tasks?',
  'todo.noTitle': 'Untitled',
  'todo.copySuffix': ' (copy)',

  // Toasts
  'toast.sessionExpired': 'Session expired. Please log in again.',
  'toast.backupExported': 'Backup exported successfully!',
  'toast.noteArchived': 'Note archived',
  'toast.noteUnarchived': 'Note unarchived',
  'toast.noteToTrash': 'Note moved to trash',
  'toast.noteRestored': 'Note restored',
  'toast.noteDeletedForever': 'Note permanently deleted',
  'toast.noteDuplicated': 'Note duplicated',
  'toast.undo': 'Undo',

  // Confirm dialog
  'confirm.cancel': 'Cancel',
  'confirm.ok': 'Confirm',
  'confirm.deletePermanently': 'Permanently delete this note?',

  // Auth
  'auth.subtitle': 'Your notes — secure, offline and encrypted',
  'auth.createTab': 'Create Password',
  'auth.loginTab': 'Login',
  'auth.importTab': 'Import',
  'auth.newPassword': 'New Password',
  'auth.passwordPlaceholder': 'Enter your password',
  'auth.confirmPassword': 'Confirm Password',
  'auth.confirmPlaceholder': 'Confirm your password',
  'auth.minLength': 'Minimum 8 characters',
  'auth.hasUppercase': 'At least 1 uppercase letter',
  'auth.hasSpecial': 'At least 1 special character',
  'auth.passwordsNoMatch': 'Passwords do not match',
  'auth.memorizeWarning': 'Memorize your password! There is no recovery.',
  'auth.createAccount': 'Create Account',
  'auth.password': 'Password',
  'auth.login': 'Login',

  // Import
  'import.dropzoneText': 'Drag the backup file or click to select',
  'import.backupPassword': 'Backup Password',
  'import.backupPlaceholder': 'Enter the password used in the backup',
  'import.importButton': 'Import Backup',
  'import.importError': 'Error importing backup.',

  // Backup errors
  'backup.invalidFile': 'Invalid backup file.',
  'backup.unrecognizedFormat': 'Unrecognized backup format.',
  'backup.corruptedSalt': 'Corrupted backup: salt not found.',
  'backup.wrongPassword': 'Incorrect password.',
  'backup.wrongPasswordOrCorrupted': 'Incorrect password or corrupted backup.',

  // Validation errors (auth.js validatePassword)
  'validation.minLength': 'Minimum 8 characters',
  'validation.hasUppercase': 'At least 1 uppercase letter',
  'validation.hasSpecial': 'At least 1 special character',

  // Login errors
  'login.noAccount': 'No account found. Create a new password or import a backup.',
  'login.wrongPassword': 'Incorrect password.',
};

const ptBR = {
  // App
  'app.title': 'KeepLocal — Notas Seguras Offline',

  // Header
  'header.search': 'Pesquisar',
  'header.clearSearch': 'Limpar',
  'header.theme': 'Tema',
  'header.lock': 'Bloquear',
  'header.language': 'Idioma',

  // Sidebar
  'sidebar.notes': 'Notas',
  'sidebar.labels': 'Labels',
  'sidebar.editLabels': 'Editar labels',
  'sidebar.archive': 'Arquivo',
  'sidebar.trash': 'Lixeira',
  'sidebar.backup': 'Backup',

  // Notes view
  'notes.empty': 'Suas notas aparecem aqui',
  'notes.pinned': 'Fixadas',
  'notes.others': 'Outras',
  'notes.createNote': 'Criar uma nota...',
  'notes.newList': 'Nova lista',

  // Archive view
  'archive.empty': 'As notas arquivadas aparecem aqui',

  // Trash view
  'trash.empty': 'A lixeira está vazia',
  'trash.autoDelete': 'As notas na lixeira são excluídas automaticamente após 7 dias.',
  'trash.emptyTrash': 'Esvaziar lixeira',
  'trash.confirmEmpty': 'Excluir permanentemente todas as notas da lixeira?',
  'trash.emptied': 'Lixeira esvaziada.',

  // Labels view
  'labels.empty': 'Nenhuma nota com esta label',
  'labels.editLabels': 'Editar labels',
  'labels.newLabel': 'Nova label',
  'labels.assignToast': 'Label será adicionada ao atribuir a uma nota',

  // Card actions
  'card.restore': 'Restaurar',
  'card.deletePermanently': 'Excluir permanentemente',
  'card.unarchive': 'Desarquivar',
  'card.delete': 'Excluir',
  'card.color': 'Cor',
  'card.archive': 'Arquivar',
  'card.more': 'Mais',
  'card.unpin': 'Desafixar',
  'card.pin': 'Fixar',
  'card.itemCount': '+ {count} item',
  'card.itemCountPlural': '+ {count} itens',

  // Modal (shared)
  'modal.titlePlaceholder': 'Título',
  'modal.close': 'Fechar',
  'modal.color': 'Cor',
  'modal.labels': 'Labels',
  'modal.duplicate': 'Duplicar',
  'modal.archive': 'Arquivar',
  'modal.delete': 'Excluir',
  'modal.undo': 'Desfazer',
  'modal.redo': 'Refazer',
  'modal.edited': 'Editada {time}',
  'modal.unpin': 'Desafixar',
  'modal.pin': 'Fixar',

  // Text modal
  'textModal.placeholder': 'Criar uma nota...',
  'textModal.markdownToggle': 'Alternar Markdown',
  'textModal.preview': 'Preview',

  // Todo modal
  'todo.pendingCount': '{count} tarefa pendente',
  'todo.pendingCountPlural': '{count} tarefas pendentes',
  'todo.doneCount': '{count} item concluído',
  'todo.doneCountPlural': '{count} itens concluídos',
  'todo.checkAll': 'Concluir todas',
  'todo.uncheckAll': 'Reabrir todas',
  'todo.addPlaceholder': 'Item da lista',
  'todo.drag': 'Arrastar',
  'todo.deleteTask': 'Excluir',
  'todo.confirmCheckAll': 'Concluir todas as tarefas pendentes?',
  'todo.confirmUncheckAll': 'Reabrir todas as tarefas concluídas?',
  'todo.noTitle': 'Sem título',
  'todo.copySuffix': ' (cópia)',

  // Toasts
  'toast.sessionExpired': 'Sessão expirada. Faça login novamente.',
  'toast.backupExported': 'Backup exportado com sucesso!',
  'toast.noteArchived': 'Nota arquivada',
  'toast.noteUnarchived': 'Nota desarquivada',
  'toast.noteToTrash': 'Nota movida para a lixeira',
  'toast.noteRestored': 'Nota restaurada',
  'toast.noteDeletedForever': 'Nota excluída permanentemente',
  'toast.noteDuplicated': 'Nota duplicada',
  'toast.undo': 'Desfazer',

  // Confirm dialog
  'confirm.cancel': 'Cancelar',
  'confirm.ok': 'Confirmar',
  'confirm.deletePermanently': 'Excluir esta nota permanentemente?',

  // Auth
  'auth.subtitle': 'Suas notas seguras, offline e criptografadas',
  'auth.createTab': 'Criar Senha',
  'auth.loginTab': 'Entrar',
  'auth.importTab': 'Importar',
  'auth.newPassword': 'Nova Senha',
  'auth.passwordPlaceholder': 'Digite sua senha',
  'auth.confirmPassword': 'Confirmar Senha',
  'auth.confirmPlaceholder': 'Confirme sua senha',
  'auth.minLength': 'Mínimo de 8 caracteres',
  'auth.hasUppercase': 'Pelo menos 1 letra maiúscula',
  'auth.hasSpecial': 'Pelo menos 1 caractere especial',
  'auth.passwordsNoMatch': 'As senhas não coincidem',
  'auth.memorizeWarning': 'Memorize sua senha! Não há recuperação.',
  'auth.createAccount': 'Criar Conta',
  'auth.password': 'Senha',
  'auth.login': 'Entrar',

  // Import
  'import.dropzoneText': 'Arraste o arquivo de backup ou clique para selecionar',
  'import.backupPassword': 'Senha do Backup',
  'import.backupPlaceholder': 'Digite a senha usada no backup',
  'import.importButton': 'Importar Backup',
  'import.importError': 'Erro ao importar backup.',

  // Backup errors
  'backup.invalidFile': 'Arquivo de backup inválido.',
  'backup.unrecognizedFormat': 'Formato de backup não reconhecido.',
  'backup.corruptedSalt': 'Backup corrompido: salt não encontrado.',
  'backup.wrongPassword': 'Senha incorreta.',
  'backup.wrongPasswordOrCorrupted': 'Senha incorreta ou backup corrompido.',

  // Validation errors
  'validation.minLength': 'Mínimo de 8 caracteres',
  'validation.hasUppercase': 'Pelo menos 1 letra maiúscula',
  'validation.hasSpecial': 'Pelo menos 1 caractere especial',

  // Login errors
  'login.noAccount': 'Nenhuma conta encontrada. Crie uma nova senha ou importe um backup.',
  'login.wrongPassword': 'Senha incorreta.',
};

const dictionaries = { en, 'pt-BR': ptBR };

/**
 * Translate a key, with optional parameter interpolation.
 * t('todo.pendingCount', { count: 3 }) → "3 pending tasks"
 * For plurals, append 'Plural' to the key when count !== 1.
 */
export function t(key, params) {
  const dict = dictionaries[currentLang] || en;
  let str = dict[key] ?? en[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }

  return str;
}

/**
 * Translate with automatic plural selection.
 * tp('card.itemCount', count) picks 'card.itemCount' or 'card.itemCountPlural'
 */
export function tp(key, count, params = {}) {
  const pluralKey = count === 1 ? key : key + 'Plural';
  return t(pluralKey, { count, ...params });
}

export function getLang() {
  return currentLang;
}

export async function setLang(lang) {
  if (!dictionaries[lang]) return;
  currentLang = lang;
  await saveMeta('lang', lang);
  document.documentElement.lang = lang === 'pt-BR' ? 'pt-BR' : 'en';
}

export async function initI18n() {
  const saved = await getMeta('lang');
  if (saved && dictionaries[saved]) {
    currentLang = saved;
  } else {
    currentLang = navigator.language?.startsWith('pt') ? 'pt-BR' : 'en';
    await saveMeta('lang', currentLang);
  }
  document.documentElement.lang = currentLang === 'pt-BR' ? 'pt-BR' : 'en';
}
