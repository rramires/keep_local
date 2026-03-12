// history.js — Undo/redo stack per note (per session)

import { deepClone } from './utils.js';

const MAX_HISTORY = 50;

export function createHistory(initialState) {
  const states = [deepClone(initialState)];
  let pointer = 0;

  return {
    push(state) {
      // Remove any redo states beyond current pointer
      states.splice(pointer + 1);
      states.push(deepClone(state));
      if (states.length > MAX_HISTORY) states.shift();
      else pointer++;
    },

    undo() {
      if (pointer <= 0) return null;
      pointer--;
      return deepClone(states[pointer]);
    },

    redo() {
      if (pointer >= states.length - 1) return null;
      pointer++;
      return deepClone(states[pointer]);
    },

    canUndo() {
      return pointer > 0;
    },

    canRedo() {
      return pointer < states.length - 1;
    },

    current() {
      return deepClone(states[pointer]);
    },
  };
}
