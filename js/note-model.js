export const MAX_NOTE_BYTES = 2 * 1024 * 1024;
export const COLORS = ['default','coral','peach','sand','mint','sage','fog','storm','dusk','blossom','clay','chalk'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => { throw Object.assign(new Error('note.invalid'), {code:'note.invalid'}); };
const string = (v, max) => typeof v === 'string' && v.length <= max;
const time = v => Number.isSafeInteger(v) && v >= 0;
export function validateNote(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n) || (typeof n.id!=='string'||!UUID.test(n.id)) || !['text','todo'].includes(n.type)) invalid();
  if (!string(n.title,4096) || !COLORS.includes(n.color) || typeof n.pinned !== 'boolean') invalid();
  if (!Array.isArray(n.labels) || n.labels.length > 100 || n.labels.some(l=>!string(l,200))) invalid();
  if (!time(n.createdAt) || !time(n.updatedAt) || !Number.isSafeInteger(n.order)) invalid();
  if (![n.deletedAt,n.archivedAt].every(v=>v===null||time(v))) invalid();
  if (n.type==='text' && !string(n.content,MAX_NOTE_BYTES)) invalid();
  if (n.type==='todo') {
    if (!Array.isArray(n.tasks) || n.tasks.length>10000) invalid();
    const ids=new Set();
    for (const task of n.tasks) {
      if (!task || (typeof task.id!=='string'||!UUID.test(task.id)) || ids.has(task.id) || !string(task.text,65536) || typeof task.done!=='boolean' || !Number.isSafeInteger(task.order) || (task.parentId!==null&&(typeof task.parentId!=='string'||!UUID.test(task.parentId)))) invalid();
      ids.add(task.id);
    }
    for(const task of n.tasks)if(task.parentId && (!ids.has(task.parentId)||task.parentId===task.id||n.tasks.find(t=>t.id===task.parentId)?.parentId))invalid();
  }
  if(new TextEncoder().encode(JSON.stringify(n)).length>MAX_NOTE_BYTES)throw Object.assign(new Error('note.tooLarge'),{code:'note.tooLarge'});
  return n;
}
