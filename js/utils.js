// utils.js — UUID, debounce, helpers

export function generateUUID() {
  return crypto.randomUUID();
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + time;
}

export function deepClone(obj) {
  return structuredClone(obj);
}
