import {createHistory} from './history.js';

const MAX_STEPS=50;
const editable=({title,blocks})=>({title,blocks});

export function createVaultHistory(initial) {
  // The baseline occupies one state in addition to the undo steps.
  const history=createHistory(editable(initial),MAX_STEPS+1);
  return {
    undo:history.undo,redo:history.redo,canUndo:history.canUndo,canRedo:history.canRedo,clear:history.clear,
    record(draft){history.push(editable(draft));},
  };
}
