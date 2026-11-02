'use strict';

const fs = require('fs');
const path = require('path');

function decodeEntities(input) {
  if (!input) return '';
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
    mdash: '—', ndash: '–', middot: '·', times: '×', copy: '©'
  };
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (named[n] != null ? named[n] : m));
}

function safeFromCode(code) {
  try { return String.fromCodePoint(code); } catch (e) { return ''; }
}

/**
 * Convert article HTML to readable plain text.
 * Deliberately conservative: no dependencies, keeps paragraph breaks.
 */
function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|math)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|h[1-6]|li|blockquote|tr|table|dd|dt|pre)>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '· ');
  s = s.replace(/<td\b[^>]*>|<th\b[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t\f\v\u00a0]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function stripHtmlTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return m ? decodeEntities(m[1]).trim() : '';
}

/** Remove Project Gutenberg's boilerplate header/footer when present. */
function stripGutenbergBoilerplate(text) {
  if (!text) return '';
  let s = text;
  const start = s.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  if (start >= 0) {
    const after = s.indexOf('***', start + 3);
    if (after > 0) s = s.slice(s.indexOf('\n', after) + 1);
  }
  const end = s.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end > 0) s = s.slice(0, end);
  return s.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

async function fetchWithTimeout(url, options = {}, ms = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'User-Agent': 'LivenDesktopPet/1.0 (personal reading companion; local use)',
        'Accept': '*/*',
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeFilename(name, fallback = '未命名') {
  let s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').slice(0, 80);
  return s || fallback;
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowStamp(d = new Date()) {
  return `${todayStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function countWords(text) {
  if (!text) return 0;
  const s = String(text).replace(/\s+/g, '');
  return s.length;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function deepMerge(base, extra) {
  if (extra == null) return base;
  if (base == null) base = {};
  if (Array.isArray(base) || Array.isArray(extra)) return extra;
  if (typeof base !== 'object' || typeof extra !== 'object') return extra;
  const out = { ...base };
  for (const k of Object.keys(extra)) {
    out[k] = deepMerge(base[k], extra[k]);
  }
  return out;
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function pick(arr, rand = Math.random) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

/** Parse a generated work that uses TITLE/BODY/AFTER/TAGS markers. */
function parseMarkedWork(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  const out = { title: '', body: '', after: '', tags: [] };
  const grab = (label, nextLabels) => {
    const re = new RegExp(`(?:^|\\n)\\s*(?:【${label}】|${label}\\s*[:：])\\s*\\n?`, 'i');
    const m = re.exec(text);
    if (!m) return '';
    const start = m.index + m[0].length;
    let end = text.length;
    for (const nl of nextLabels) {
      const re2 = new RegExp(`\\n\\s*(?:【${nl}】|${nl}\\s*[:：])\\s*\\n?`, 'i');
      const m2 = re2.exec(text.slice(start));
      if (m2) { end = Math.min(end, start + m2.index); }
    }
    return text.slice(start, end).trim();
  };
  out.title = grab('标题', ['正文', 'BODY']).replace(/^[《「“"]|[》」”"]$/g, '').trim();
  out.body = grab('正文', ['写在最后', 'AFTER', '标签', 'TAGS']);
  out.after = grab('写在最后', ['标签', 'TAGS']).replace(/^【?写在最后】?\s*/i, '').trim();
  const tags = grab('标签', []);
  out.tags = tags.split(/[，,、\s#]+/).map(t => t.trim()).filter(Boolean).slice(0, 8);
  if (!out.body) {
    // Model ignored the markers: fall back to treating everything after the title as body.
    out.body = text.replace(/^[\s\S]{0,80}?标题\s*[:：][^\n]*\n?/i, '').trim();
  }
  return out;
}

module.exports = {
  decodeEntities, htmlToText, stripHtmlTitle, stripGutenbergBoilerplate,
  fetchWithTimeout, sanitizeFilename, todayStr, nowStamp, countWords,
  readJson, writeJsonAtomic, deepMerge, clamp, pick, parseMarkedWork
};
