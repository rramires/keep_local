// Vault items use the same encrypted note records and byte limit as other notes.
export const MAX_VAULT_BLOCKS = 200;
export const MAX_VAULT_LABEL = 200;
export const MAX_VAULT_VALUE = 65536;

const keysByKind = {
  field: new Set(['id', 'kind', 'label', 'value', 'secret', 'multiline', 'primary']),
  text: new Set(['id', 'kind', 'value']),
  divider: new Set(['id', 'kind']),
};
const flags = ['secret', 'multiline', 'primary'];
const isString = (value, max) => typeof value === 'string' && value.length <= max;

export function validVaultBlocks(blocks, uuid) {
  if (!Array.isArray(blocks) || blocks.length > MAX_VAULT_BLOCKS) return false;
  const seen = new Set();
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
    if (typeof block.kind !== 'string' || !Object.hasOwn(keysByKind, block.kind)) return false;
    if (Object.keys(block).some(key => !keysByKind[block.kind].has(key))) return false;
    if (typeof block.id !== 'string' || !uuid.test(block.id)) return false;
    const id = block.id.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    if (block.kind !== 'divider' && !isString(block.value, MAX_VAULT_VALUE)) return false;
    if (block.kind === 'field') {
      if (!isString(block.label, MAX_VAULT_LABEL)) return false;
      if (flags.some(flag => Object.hasOwn(block, flag) && typeof block[flag] !== 'boolean')) return false;
    }
  }
  return true;
}

function labelWords(terms) {
  return new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}])(?:${terms})(?![\p{L}\p{M}\p{N}])`, 'u');
}

const publicWords = labelWords(
  String.raw`host|hostname|servidor|server|url|uri|endpoint|dominio|domain|usuario|user|username|login|e\s+mail|email|porta|port|banco|database|db|bucket|regiao|region|ip|conta|account`,
);
const shortSecretWords = labelWords('pin|pwd|cvv|cvc|otp|totp|2fa|mfa|seed|auth|cert|pem|ssh|api');
const sensitiveTerms = /senha|secret|token|key|chave|pass|mnemonic|recovery|recuperacao|credential|credencial|private|privada/;

function normalizeLabel(label) {
  return label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-_.]/g, ' ');
}

export function secretLabel(label) {
  const normalized = normalizeLabel(label);
  return sensitiveTerms.test(normalized) || shortSecretWords.test(normalized);
}

function publicLabel(label) {
  return publicWords.test(normalizeLabel(label));
}

function autoSecret(label) {
  return secretLabel(label) || !publicLabel(label);
}

export function isSecretField(block) {
  return block.kind === 'field' && (block.secret ?? autoSecret(block.label));
}

export function vaultSubtitle(item) {
  return item.blocks.find(block => block.kind === 'field' && !isSecretField(block))?.value ?? '';
}

export function vaultMatches(item, query) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const includes = value => value.toLowerCase().includes(term);
  if (includes(item.title) || item.labels.some(includes)) return true;
  return item.blocks.some(block => block.kind === 'field' &&
    (includes(block.label) || (!isSecretField(block) && includes(block.value))));
}
