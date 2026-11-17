export const TRASH_RETENTION_MS=7*24*60*60*1000;
export async function purgeTrash(notes,remove,now=Date.now()) {
  for(const note of notes.filter(n=>n.deletedAt!==null&&now-n.deletedAt>TRASH_RETENTION_MS))await remove(note.id);
}
