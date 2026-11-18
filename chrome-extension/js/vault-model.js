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
