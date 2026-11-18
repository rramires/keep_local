// i18n.js — Internationalization module (EN / PT-BR)

import { saveMeta, getMeta } from './db.js';

let currentLang = 'en';

const en = {
  'account.resetHint': 'Only start again if you no longer need the local notes. Erasing is permanent.',
  'recovery.exportStep': '1. Export a preserved copy',
  'recovery.discardStep': '2. Discard this record',
  'validation.repeated': 'Avoid repeated characters or short repeated patterns.',
  'validation.sequence': 'Avoid alphabetical or numerical sequences.',
  'validation.keyboard': 'Avoid predictable keyboard runs.',
  'validation.commonPrefix': 'Avoid a common word followed by a short or predictable suffix. Choose 5 or more random words.',
  'recovery.changed': 'The vault or record changed. Nothing was discarded. Close and reopen Recovery, review the record and export again.',
  'recovery.exportedPlural': 'Download started with {count} unreadable records. No record was discarded. Verify that the file was saved before confirming below.',
  'recovery.exported': 'Download started with {count} unreadable record. No record was discarded. Verify that the file was saved before confirming below.',
  'recovery.confirmSavedRequired': 'Confirm that you verified the saved file before discarding.',
  'recovery.confirmSaved': 'I confirmed that the file was saved',
  'recovery.exportNow': 'Export now',
  'recovery.exportWarning': 'This export preserves unreadable records and cannot be restored in full until they are repaired or discarded. Exporting alone never discards records.',
  'note.actionLocalConflict': 'Another action in this tab changed the note. Review its current state and try again; this action was not applied.',
  'note.actionFailed': 'Could not apply this action. The stored note and its displayed state were preserved; retry.',
  'note.actionConflict': 'Another tab changed this note. This action was not applied; review the current version.',
  'recovery.copy': 'Create note with this content',
  'recovery.newTitle': 'Recovered content',
  'recovery.copyTooLarge': 'Too large to create a note. Read and copy the text manually to a safe place.',
  'recovery.copied': 'A valid note was created. The original record is still preserved.',
  'recovery.discard': 'Discard record',
  'recovery.discardWord': 'DISCARD',
  'recovery.discardPrompt': 'After verifying the exported file, confirm it was saved and type {word} to discard this record permanently.',
  'recovery.confirmRequired': 'Type the confirmation word exactly; the record was preserved.',
  'recovery.failed': 'Recovery action failed or the vault changed. The stored records were preserved; reopen Recovery before retrying.',
  'backup.unreadableConfirm': '{count} unreadable records will be preserved in this export. This file cannot be restored in full until they are repaired or discarded. Start the download anyway?',
  'backup.unreadableExported': 'Download started with unreadable records; full restoration is unavailable. Verify that the file was saved.',
  'backup.unreadableRecords': 'This backup contains unreadable records. Recover or discard them in the source vault before a full import. Your local vault was preserved.',
  'account.unreadable': 'Unreadable records prevent changing the password. Open Recovery to copy recoverable content and discard invalid records first.',
  'account.failed': 'Could not change the password. Your vault was preserved. Retry after unlocking the current vault.',
  "recovery.open": "Recovery",
  "recovery.title": "Preserved records",
  'recovery.help': 'Read preserved data or create a valid copy. To discard: first export this snapshot, verify the saved file, then confirm and type the discard word. Changes to the vault require a new export.',
  "recovery.record": "Record {number}",
  "recovery.reason.decrypt": "Cannot decrypt this record. Keep an encrypted backup for recovery.",
  "recovery.reason.json": "Decryption succeeded, but the text is not valid note JSON.",
  "recovery.reason.model": "Decryption succeeded, but the data does not meet the note model or field limits.",
  "recovery.reason.limit": "Decryption succeeded, but this legacy note exceeds the editing size limit.",
  "recovery.content": "Decrypted data for recovery, read-only",
  "session.exportCancelled": "Export cancelled because the session ended or changed.",
  "session.discardAndLock": "Some edits could not be saved. Cancel to retry or use Save as a new note. OK discards the unsaved drafts and locks; stored notes are preserved.",

  'note.deleteFailed': 'Could not delete the note. Its stored version was preserved; review it before retrying.',
  'backup.failed': 'Backup could not be exported. Your changes remain pending; try again.',
  "vault.changed": "The vault changed in another tab. Unlock the current vault before editing.",
  "note.conflict": "Another tab saved a newer version. Your draft is still open.",
  "note.saveAsNew": "Save as a new note",
  "account.change": "Change master password",
  "account.current": "Current password",
  "account.new": "New passphrase",
  "account.rotateWarning": "After changing your passphrase, export a new backup. Existing backups still use your previous passphrase.",
  "account.reset": "Erase everything and start again",
  "account.resetWord": "ERASE",
  "account.resetPrompt": "Export and safely store a backup before erasing. This permanently removes all local notes. Type ERASE to start again.",
  "account.resetCancelled": "Reset cancelled; the vault was preserved.",

  'backup.legacyWarning': 'Legacy backup imported. Export a new v2 backup now; v1 cannot detect missing records.',
  'markdown.unavailable': 'Safe Markdown preview is unavailable. Showing plain text.',
  "validation.common": "Avoid common passwords, sequences, keyboard runs and repeated patterns.",
  "auth.passphraseHint": "Use 5 or more randomly chosen words. Uppercase letters and symbols are optional.",
  "password.strength.weak": "Too short or predictable",
  "password.strength.adequate": "Meets the minimum; a longer random phrase is better",
  "password.strength.long": "Long and varied; strength depends on randomly chosen words",

  'note.saveFailed': 'Could not save locally. Your draft is still open. Retry before closing.',
  "backup.tooLarge": "Backup exceeds the 64 MiB limit.",
  "backup.replaceConfirm": "Replace {local} local notes with {incoming} backup notes? Export the current vault first if you need to keep it.",
  "backup.cancelled": "Import cancelled. Your vault was preserved.",

  'notes.unreadablePlural': '{count} notes could not be opened for editing. Their encrypted records have been preserved and will remain in backups. Keep a backup before attempting recovery.',
  'notes.unreadable': '{count} note could not be opened for editing. Its encrypted record has been preserved and will remain in backups. Keep a backup before attempting recovery.',
  'note.invalid': 'Invalid note data. The record was not changed.',
  'note.tooLarge': 'This note exceeds the 2 MiB limit. Shorten it before saving.',
  'account.exists': 'A vault already exists. Unlock it or explicitly reset it; creating another account cannot replace it.',
  'security.trashOnly': 'Only notes already in Trash can be permanently deleted.',
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
  'toast.backupExported': 'Download started. Verify that the file was saved; KeepLocal cannot confirm it.',
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
  'auth.confirmPassword': 'Confirm passphrase',
  'auth.confirmPlaceholder': 'Confirm your password',
  'auth.minLength': 'Minimum 14 characters',
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
  'validation.minLength': 'Minimum 14 characters',
  'validation.hasUppercase': 'At least 1 uppercase letter',
  'validation.hasSpecial': 'At least 1 special character',

  // Login errors
  'login.noAccount': 'No account found. Create a new password or import a backup.',
  'login.wrongPassword': 'Incorrect password.',
};

const ptBR = {
  'account.resetHint': 'Recomece apenas se não precisar mais das notas locais. A exclusão é permanente.',
  'recovery.exportStep': '1. Exportar uma cópia preservada',
  'recovery.discardStep': '2. Descartar este registro',
  'validation.repeated': 'Evite caracteres repetidos ou padrões curtos repetidos.',
  'validation.sequence': 'Evite sequências alfabéticas ou numéricas.',
  'validation.keyboard': 'Evite corridas previsíveis de teclado.',
  'validation.commonPrefix': 'Evite palavra comum seguida de trecho curto ou previsível. Escolha 5 ou mais palavras sorteadas.',
  'recovery.changed': 'O cofre ou o registro mudou. Nada foi descartado. Feche e reabra a Recuperação, confira o registro e exporte novamente.',
  'recovery.exportedPlural': 'Download iniciado com {count} registros ilegíveis. Nenhum registro foi descartado. Confira se o arquivo foi salvo antes de confirmar abaixo.',
  'recovery.exported': 'Download iniciado com {count} registro ilegível. Nenhum registro foi descartado. Confira se o arquivo foi salvo antes de confirmar abaixo.',
  'recovery.confirmSavedRequired': 'Confirme que conferiu o arquivo salvo antes de descartar.',
  'recovery.confirmSaved': 'Confirmei que o arquivo foi salvo',
  'recovery.exportNow': 'Exportar agora',
  'recovery.exportWarning': 'Este export preserva registros ilegíveis e não pode ser restaurado integralmente até serem reparados ou descartados. Exportar sozinho nunca descarta registros.',
  'note.actionLocalConflict': 'Outra ação desta aba alterou a nota. Confira o estado atual e tente novamente; esta ação não foi aplicada.',
  'note.actionFailed': 'Não foi possível aplicar esta ação. A nota armazenada e seu estado exibido foram preservados; tente novamente.',
  'note.actionConflict': 'Outra aba alterou esta nota. A ação não foi aplicada; confira a versão atual.',
  'recovery.copy': 'Criar nota com este conteúdo',
  'recovery.newTitle': 'Conteúdo recuperado',
  'recovery.copyTooLarge': 'Conteúdo grande demais para criar uma nota. Leia e copie o texto manualmente para um local seguro.',
  'recovery.copied': 'Uma nota válida foi criada. O registro original continua preservado.',
  'recovery.discard': 'Descartar registro',
  'recovery.discardWord': 'DESCARTAR',
  'recovery.discardPrompt': 'Depois de conferir o arquivo exportado, confirme que foi salvo e digite {word} para descartar permanentemente este registro.',
  'recovery.confirmRequired': 'Digite a palavra de confirmação exatamente; o registro foi preservado.',
  'recovery.failed': 'A ação falhou ou o cofre mudou. Os registros armazenados foram preservados; reabra a Recuperação antes de tentar novamente.',
  'backup.unreadableConfirm': '{count} registros ilegíveis serão preservados neste export. Este arquivo não poderá ser restaurado integralmente até que sejam reparados ou descartados. Iniciar o download mesmo assim?',
  'backup.unreadableExported': 'Download iniciado com registros ilegíveis; a restauração integral está indisponível. Confira se o arquivo foi salvo.',
  'backup.unreadableRecords': 'Este backup contém registros ilegíveis. Recupere ou descarte-os no cofre de origem antes de importar integralmente. Seu cofre local foi preservado.',
  'account.unreadable': 'Registros ilegíveis impedem a troca da senha. Abra a Recuperação para copiar o conteúdo recuperável e descartar os registros inválidos primeiro.',
  'account.failed': 'Não foi possível trocar a senha. Seu cofre foi preservado. Tente novamente após desbloquear o cofre atual.',
  "recovery.open": "Recuperação",
  "recovery.title": "Registros preservados",
  'recovery.help': 'Leia os dados preservados ou crie uma cópia válida. Para descartar: primeiro exporte este snapshot, confira o arquivo salvo, depois confirme e digite a palavra. Alterações no cofre exigem novo export.',
  "recovery.record": "Registro {number}",
  "recovery.reason.decrypt": "Não foi possível decifrar este registro. Guarde um backup cifrado para recuperação.",
  "recovery.reason.json": "A decifragem funcionou, mas o texto não é um JSON de nota válido.",
  "recovery.reason.model": "A decifragem funcionou, mas os dados não atendem ao modelo ou aos limites dos campos.",
  "recovery.reason.limit": "A decifragem funcionou, mas esta nota antiga excede o limite de tamanho para edição.",
  "recovery.content": "Dados decifrados para recuperação, somente leitura",
  "session.exportCancelled": "Exportação cancelada porque a sessão terminou ou mudou.",
  "session.discardAndLock": "Algumas alterações não foram salvas. Cancele para tentar novamente ou salvar como nova nota. OK descarta os rascunhos não salvos e bloqueia; as notas gravadas são preservadas.",

  'note.deleteFailed': 'Não foi possível excluir a nota. A versão gravada foi preservada; confira antes de tentar novamente.',
  'backup.failed': 'Não foi possível exportar o backup. Suas alterações continuam pendentes; tente novamente.',
  "vault.changed": "O cofre foi alterado em outra aba. Desbloqueie o cofre atual antes de editar.",
  "note.conflict": "Outra aba salvou uma versão mais nova. Seu rascunho continua aberto.",
  "note.saveAsNew": "Salvar como nova nota",
  "account.change": "Trocar senha mestra",
  "account.current": "Senha atual",
  "account.new": "Nova frase-senha",
  "account.rotateWarning": "Após trocar a frase-senha, exporte um novo backup. As cópias anteriores continuam usando a frase-senha antiga.",
  "account.reset": "Apagar tudo e recomeçar",
  "account.resetWord": "APAGAR",
  "account.resetPrompt": "Exporte e guarde um backup seguro antes de apagar. Todas as notas locais serão removidas definitivamente. Digite APAGAR para recomeçar.",
  "account.resetCancelled": "Redefinição cancelada; o cofre foi preservado.",

  'backup.legacyWarning': 'Backup antigo importado. Exporte um novo backup v2 agora; o v1 não detecta registros removidos.',
  'markdown.unavailable': 'A prévia segura de Markdown está indisponível. Exibindo texto simples.',
  "validation.common": "Evite senhas comuns, sequências, corridas de teclado e padrões repetidos.",
  "auth.passphraseHint": "Use 5 ou mais palavras sorteadas. Maiúsculas e símbolos são opcionais.",
  "password.strength.weak": "Muito curta ou previsível",
  "password.strength.adequate": "Atende ao mínimo; prefira uma frase aleatória mais longa",
  "password.strength.long": "Longa e variada; a força depende de palavras sorteadas",

  'note.saveFailed': 'Não foi possível salvar localmente. Seu rascunho continua aberto. Tente novamente antes de fechar.',
  "backup.tooLarge": "O backup excede o limite de 64 MiB.",
  "backup.replaceConfirm": "Substituir {local} notas locais por {incoming} notas do backup? Exporte o cofre atual antes se precisar preservá-lo.",
  "backup.cancelled": "Importação cancelada. Seu cofre foi preservado.",

  'notes.unreadablePlural': '{count} notas não puderam ser abertas para edição. Os registros cifrados foram preservados e continuam nos backups. Guarde uma cópia antes de tentar recuperar.',
  'notes.unreadable': '{count} nota não pôde ser aberta para edição. O registro cifrado foi preservado e continua nos backups. Guarde uma cópia antes de tentar recuperar.',
  'note.invalid': 'Dados da nota inválidos. O registro não foi alterado.',
  'note.tooLarge': 'Esta nota ultrapassa o limite de 2 MiB. Reduza o conteúdo antes de salvar.',
  'account.exists': 'Já existe um cofre. Entre nele ou recomece explicitamente; criar outra conta não pode substituí-lo.',
  'security.trashOnly': 'Só notas que já estão na Lixeira podem ser excluídas definitivamente.',
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
  'toast.backupExported': 'Download iniciado. Confira se o arquivo foi salvo; o KeepLocal não consegue confirmar.',
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
  'auth.confirmPassword': 'Confirmar frase-senha',
  'auth.confirmPlaceholder': 'Confirme sua senha',
  'auth.minLength': 'Mínimo de 14 caracteres',
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
  'validation.minLength': 'Mínimo de 14 caracteres',
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
