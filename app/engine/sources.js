'use strict';

const {
  htmlToText, stripHtmlTitle, stripGutenbergBoilerplate,
  fetchWithTimeout, decodeEntities, stripHtmlTitle: _t
} = require('./util');

const WIKISOURCE_API = 'https://zh.wikisource.org/w/api.php';
const GUTENDEX = 'https://gutendex.com/books';

function normalizeTitle(t) {
  return decodeEntities(String(t || '')).replace(/\s+/g, ' ').trim();
}

async function getJson(url) {
  const res = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } }, 30000);
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
  return res.json();
}

/* ------------------------------- Wikisource ------------------------------ */

async function searchWikisource(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${WIKISOURCE_API}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=0&srlimit=20&format=json&formatversion=2&utf8=1`;
  const data = await getJson(url);
  const list = data?.query?.search || [];
  return list.map(item => ({
    source: 'wikisource',
    id: normalizeTitle(item.title),
    title: normalizeTitle(item.title),
    author: '维基文库',
    snippet: htmlToText(item.snippet || '').slice(0, 160),
    url: `https://zh.wikisource.org/wiki/${encodeURIComponent(item.title)}`
  }));
}

function extractChapters(html, baseTitle) {
  const ids = [];
  const seen = new Set();
  const re = /href="\/wiki\/([^"#?]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    let id = m[1];
    try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
    id = normalizeTitle(id.replace(/_/g, ' '));
    if (!id || seen.has(id)) continue;
    const isSub = id.startsWith(baseTitle + '/') || id.startsWith(baseTitle + '／');
    const isChapter = /第[0-9零〇一二三四五六七八九十百千]+[章回节卷篇]/.test(id);
    if ((isSub || isChapter) && !id.includes(':')) {
      seen.add(id);
      ids.push({ id, title: id });
    }
    if (ids.length >= 200) break;
  }
  return ids;
}

async function readWikisource(title) {
  const cleanTitle = normalizeTitle(title);
  const build = (withVariant) => {
    let u = `${WIKISOURCE_API}?action=parse&page=${encodeURIComponent(cleanTitle)}&prop=text|displaytitle&format=json&formatversion=2&redirects=1&disableeditsection=1&disabletoc=1`;
    if (withVariant) u += '&variant=zh-cn';
    return u;
  };
  let data;
  try {
    data = await getJson(build(true));
  } catch (e) {
    data = await getJson(build(false));
  }
  const parse = data?.parse;
  if (!parse || !parse.text) throw new Error('这一页没有可读的正文，可能是一个目录页或消歧义页。');
  const html = parse.text;
  const display = normalizeTitle(String(parse.displaytitle || cleanTitle).replace(/<[^>]+>/g, ''));
  const text = htmlToText(html);
  if (text.length < 40) throw new Error('这一页的正文太短，换一个结果试试。');
  const chapters = extractChapters(html, cleanTitle);
  return {
    key: `wikisource:${cleanTitle}`,
    source: 'wikisource',
    id: cleanTitle,
    title: display || cleanTitle,
    author: '维基文库',
    url: `https://zh.wikisource.org/wiki/${encodeURIComponent(cleanTitle)}`,
    text,
    chapters,
    truncated: false
  };
}

/* ------------------------------- Gutenberg ------------------------------- */

function pickTextFormat(formats) {
  if (!formats) return '';
  const entries = Object.entries(formats);
  const score = ([mime, url]) => {
    if (!url || /\.zip$/i.test(url)) return -1;
    if (/^text\/plain/i.test(mime) && /utf-8/i.test(mime)) return 100;
    if (/^text\/plain/i.test(mime)) return 80;
    if (/^text\/html/i.test(mime) && /utf-8/i.test(mime)) return 60;
    if (/^text\/html/i.test(mime)) return 50;
    return -1;
  };
  const best = entries
    .map(([mime, url]) => ({ mime, url, s: score([mime, url]) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)[0];
  return best ? best.url : '';
}

async function searchGutenberg(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = await getJson(`${GUTENDEX}?search=${encodeURIComponent(q)}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, 20).map(b => ({
    source: 'gutenberg',
    id: String(b.id),
    title: normalizeTitle(b.title),
    author: (b.authors || []).map(a => a.name).join('、') || '佚名',
    snippet: [
      (b.languages || []).includes('zh') ? '中文' : (b.languages || []).join('/'),
      b.download_count ? `下载 ${b.download_count}` : ''
    ].filter(Boolean).join(' · '),
    url: `https://www.gutenberg.org/ebooks/${b.id}`
  }));
}

async function readGutenberg(id) {
  const meta = await getJson(`${GUTENDEX}?ids=${encodeURIComponent(id)}`);
  const book = (meta?.results || [])[0];
  if (!book) throw new Error('找不到这本书的元数据。');
  const url = pickTextFormat(book.formats);
  if (!url) throw new Error('这本书没有可直接读取的纯文本版本。');
  const res = await fetchWithTimeout(url, {}, 45000);
  if (!res.ok) throw new Error(`下载正文失败（HTTP ${res.status}）。`);
  const ctype = res.headers.get('content-type') || '';
  let raw = await res.text();
  let text;
  if (/html/i.test(ctype) || /^\s*<!doctype html/i.test(raw)) {
    text = htmlToText(raw);
  } else {
    text = stripGutenbergBoilerplate(raw);
  }
  const MAX = 600000;
  const truncated = text.length > MAX;
  if (truncated) text = text.slice(0, MAX);
  return {
    key: `gutenberg:${id}`,
    source: 'gutenberg',
    id: String(id),
    title: normalizeTitle(book.title),
    author: (book.authors || []).map(a => a.name).join('、') || '佚名',
    url: `https://www.gutenberg.org/ebooks/${id}`,
    text,
    chapters: [],
    truncated
  };
}

/* -------------------------------- Custom -------------------------------- */

async function readUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) throw new Error('请输入链接。');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const res = await fetchWithTimeout(url, {}, 40000);
  if (!res.ok) throw new Error(`访问失败（HTTP ${res.status}）。`);
  const ctype = res.headers.get('content-type') || '';
  const raw = await res.text();
  if (!/html|text/i.test(ctype)) throw new Error('这个链接不是可读的网页或文本。');
  const text = /html/i.test(ctype) ? htmlToText(raw) : raw;
  const title = (/html/i.test(ctype) ? (stripHtmlTitle(raw) || url) : url).slice(0, 120);
  return {
    key: `web:${url}`,
    source: 'web',
    id: url,
    title: normalizeTitle(title),
    author: '网页',
    url,
    text,
    chapters: [],
    truncated: false
  };
}

/* ------------------------------ Local corpus ----------------------------- */

const fs = require('fs');
const path = require('path');
const { extractDocx } = require('./docx');

function titleFromFile(file) {
  const base = String(file || '').replace(/\.(txt|md|docx)$/i, '');
  const parts = base.split('__');
  const title = (parts.length > 1 ? parts.slice(1).join('__') : base).replace(/_/g, ' ').trim();
  return title || base;
}

function bookChars(file) {
  try {
    if (/\.docx$/i.test(file)) return extractDocx(file).replace(/\s+/g, '').length;
    return fs.readFileSync(file, 'utf8').replace(/\s+/g, '').length;
  } catch (e) {
    return 0;
  }
}

function listLocalBooks(dir, query) {
  const q = String(query || '').trim().toLowerCase();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => /\.(txt|md|docx)$/i.test(f));
  } catch (e) {
    return [];
  }
  return files.map(f => {
    const chars = bookChars(path.join(dir, f));
    const folder = f.split('__')[0] || '本地';
    return {
      source: 'local',
      id: f,
      title: titleFromFile(f),
      author: 'Liven 的创作者',
      snippet: `${chars} 字 · ${folder}`,
      chars,
      url: ''
    };
  }).filter(b => !q || b.title.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
}

function readLocalBook(dir, id) {
  const safe = path.basename(String(id || ''));
  const full = path.join(dir, safe);
  if (!full.startsWith(path.resolve(dir))) throw new Error('这个路径不在书库里。');
  let text;
  try {
    text = /\.docx$/i.test(full) ? extractDocx(full) : fs.readFileSync(full, 'utf8');
    text = String(text).replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  } catch (e) {
    throw new Error('读不到这篇文本，可能已经被移动了。');
  }
  return {
    key: `local:${safe}`,
    source: 'local',
    id: safe,
    title: titleFromFile(safe),
    author: '董培钧',
    url: '',
    text,
    chapters: [],
    truncated: false
  };
}

function readLocalFile(fullPath) {
  const full = path.resolve(String(fullPath || ''));
  const ext = path.extname(full).toLowerCase();
  let text;
  try {
    if (ext === '.docx') text = extractDocx(full);
    else if (ext === '.doc') throw new Error('旧版 .doc 读不了，请用 Word 另存为 .docx 再打开。');
    else text = fs.readFileSync(full, 'utf8');
  } catch (e) {
    if (e && /\.doc 读不了/.test(e.message)) throw e;
    throw new Error('读不到这个文件，或者它不是可读的文本。');
  }
  const name = path.basename(full);
  return {
    key: `file:${full}`,
    source: 'file',
    id: full,
    path: full,
    title: path.basename(name, path.extname(name)),
    author: '本地文件',
    url: '',
    text,
    chapters: [],
    truncated: false
  };
}

module.exports = {
  searchWikisource, readWikisource,
  searchGutenberg, readGutenberg,
  readUrl,
  listLocalBooks, readLocalBook, readLocalFile
};
