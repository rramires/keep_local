// theme.js — Light/dark toggle, persist preference

import { saveMeta, getMeta } from './db.js';

let currentTheme = 'dark';

export async function initTheme() {
  const saved = await getMeta('theme');
  currentTheme = saved || 'dark';
  applyTheme(currentTheme);
}

export async function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  await saveMeta('theme', currentTheme);
}

export function getTheme() {
  return currentTheme;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
