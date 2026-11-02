'use strict';

/* 写作间通用小工具。挂在 window 上，studio.js 直接用。 */

window.$ = (sel, root = document) => root.querySelector(sel);
window.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

window.KINDS = {
  recommend: '文学推荐',
  story: '短篇',
  essay: '随笔',
  letter: '书信',
  review: '读书感想'
};

window.ERAS = [
  { id: '2020', year: '2020', name: '幻想中的人', quote: '先写一个完美的人，再嫉妒她' },
  { id: '2024', year: '2024', name: '重写与时间', quote: '从旧本子里找回第一个故事' },
  { id: '2025', year: '2025', name: '温柔的现实', quote: '雪、烟花、木屋与墓园' },
  { id: '2026', year: '2026', name: '冷峻与书信', quote: '让信自己说完' }
];

let toastTimer = null;
window.toast = function toast(message, ms = 2600) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
};

window.pad2 = (n) => String(n).padStart(2, '0');

window.fmtTime = function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

window.fmtDate = function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

window.todayLabel = function todayLabel() {
  const d = new Date();
  const week = '日一二三四五六'[d.getDay()];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${week}`;
};

window.countChars = function countChars(text) {
  return String(text || '').replace(/\s/g, '').length;
};

window.debounce = function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
};

window.copyText = async function copyText(text) {
  const value = String(text == null ? '' : text);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
};

window.makeEl = function makeEl(tag, props = {}, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  if (children != null) {
    const list = Array.isArray(children) ? children : [children];
    for (const c of list) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
};
