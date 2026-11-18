export const editorFields = note => note.type === 'todo' ? ['title', 'tasks'] : ['title', 'content'];
export function metadataFields(note) {
  const owned = new Set(['title', 'content', 'tasks']);
  return Object.fromEntries(Object.entries(note).filter(([name]) => !owned.has(name)));
}
export function createNoteWriteQueue({enqueue, read, version, session, persist, publish}) {
  const parents = new Map();
  let generation = session();
  const ensureSession = () => {
    const current = session();
    if (generation !== current) { parents.clear(); generation = current; }
    return current;
  };
  const descends = (id, current, ancestor) => {
    const history = parents.get(id), visited = new Set();
    while (current !== ancestor) {
      if (visited.has(current) || !history?.has(current)) return false;
      visited.add(current); current = history.get(current);
    }
    return true;
  };
  const recordCommit = (id, current, previous) => {
    ensureSession();
    if (!parents.has(id)) parents.set(id, new Map());
    parents.get(id).set(current, previous);
  };
  const write = (source, {fields = null, change = null, baseVersion = source.updatedAt, committed = () => {}} = {}) => {
    const token = ensureSession(), id = source.id, submitted = version(id), draft = structuredClone(source);
    const stale = submitted !== undefined && baseVersion !== submitted;
    return enqueue(id, async () => {
      if (token !== session()) throw Object.assign(Error('session.ended'), {code: 'session.ended'});
      const known = version(id), current = read(id), partial = fields !== null || change !== null;
      if (stale || (known !== undefined && !current) || (partial ? !descends(id, known, submitted) : known !== undefined && baseVersion !== known)) {
        throw Object.assign(Error('note.conflict'), {code: 'note.conflict', origin: descends(id, known, baseVersion) ? 'local' : 'remote'});
      }
      let next = structuredClone(partial ? current || draft : draft);
      if (change) change(next);
      else if (fields) for (const name of fields) next[name] = structuredClone(draft[name]);
      next = await persist(next, {known, token});
      if (token !== session()) throw Object.assign(Error('session.ended'), {code: 'session.ended'});
      recordCommit(id, next.updatedAt, known);
      publish(next); committed(next);
      return next;
    });
  };
  write.recordCommit = recordCommit;
  return write;
}
