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

/* --------------------------- 5000言 / 古文岛 ---------------------------- */

const YAN5000 = 'https://5000yan.com';
const GUSHIWEN = 'https://www.gushiwen.cn';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

async function fetchHtml(url) {
  const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 30000);
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
  return res.text();
}

function cleanText(value) {
  return htmlToText(String(value || '')).replace(/[ \t\u00a0]+/g, ' ').trim();
}

function getAttr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs || '') ||
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs || '');
  return m ? m[1] : '';
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).href; } catch (e) { return ''; }
}

function anchors(html) {
  const list = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    list.push({ attrs: m[1] || '', body: m[2] || '' });
    if (list.length > 1600) break;
  }
  return list;
}

async function search5000yan(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${YAN5000}/search/${encodeURIComponent(q)}/`;
  const html = await fetchHtml(url);
  const results = [];
  const seen = new Set();

  for (const a of anchors(html)) {
    const href = absoluteUrl(getAttr(a.attrs, 'href'), url);
    if (!href || !/^https?:\/\//.test(href) || seen.has(href)) continue;
    // 结果里偶尔混进指向搜索页的“诗句”链接，点开只会回到搜索页。
    if (href.includes('#') || /\/search\//i.test(new URL(href).pathname)) continue;
    // 5000言站群里的字典、对联、导航页不是可读的诗词正文，过滤掉。
    const host = new URL(href).hostname;
    if (/(^|\.)(hanzi|duilian|daohang|zidian|chengyu|qiming|mingzi|zucizaoju)\.5000yan\.com$/i.test(host)) continue;
    if (/(^|\.)5000yan\.com$/i.test(host) && /\/(hanzi|zidian|chengyu|qiming)\//i.test(new URL(href).pathname)) continue;
    const cls = getAttr(a.attrs, 'class');
    const inner = a.body;

    if (/board-card/.test(cls)) {
      const badge = cleanText((/<[^>]*class="[^"]*board-card-badge[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(inner) || [])[1] || '');
      if (badge && !/诗|词|古文|古籍|名句|文言/.test(badge)) continue;
      const title = cleanText((/<[^>]*class="[^"]*board-card-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(inner) || [])[1] || inner).slice(0, 80);
      const meta = cleanText((/<[^>]*class="[^"]*board-card-meta[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(inner) || [])[1] || '');
      if (!title) continue;
      seen.add(href);
      results.push({ source: 'yan5000', id: href, title, author: '5000言', snippet: [badge, meta].filter(Boolean).join(' · ').slice(0, 120) || '诗词 · 古文', url: href });
    } else if (/search-article-link/.test(cls)) {
      const title = cleanText((/<[^>]*class="[^"]*search-article-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(inner) || [])[1] || inner).slice(0, 80);
      if (!title) continue;
      seen.add(href);
      results.push({ source: 'yan5000', id: href, title, author: '5000言', snippet: '诗词 · 古文 · 5000言', url: href });
    }
    if (results.length >= 20) break;
  }
  return results;
}

async function read5000yan(id) {
  const url = absoluteUrl(String(id || ''), YAN5000 + '/');
  if (!url || !/5000yan\.com$/i.test(new URL(url).hostname)) throw new Error('这个 5000言链接看起来不对。');
  const html = await fetchHtml(url);
  const title = cleanText((/<h1[^>]*class="[^"]*title-expand-text[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || '');
  const verseAt = html.search(/<div[^>]*class="[^"]*poem-verse/i);
  const articleAt = html.search(/<article[^>]*class="[^"]*reading-content/i);
  const parts = [];
  if (verseAt >= 0) {
    const end = articleAt > verseAt ? articleAt : Math.min(html.length, verseAt + 10000);
    parts.push(html.slice(verseAt, end));
  }
  if (articleAt >= 0) {
    const end = html.indexOf('</article>', articleAt);
    parts.push(html.slice(articleAt, end > articleAt ? end + 10 : undefined));
  }
  let text = parts.map(cleanText).filter(Boolean).join('\n\n');
  if (text.length < 40) text = cleanText(html);
  // 页面上的“练这一首 / 朗读”按钮文字不属于正文。
  text = text.replace(/练这一首[\s\S]*?(?=【|$)/, '').replace(/^朗读\s*/m, '').trim();
  if (text.length < 40) throw new Error('这一页没有找到可读的正文。');
  return {
    key: `yan5000:${url}`,
    source: 'yan5000',
    id: url,
    title: title || '5000言',
    author: '5000言',
    url,
    text,
    chapters: [],
    truncated: false
  };
}

let gushiwenCatalog = null;
let gushiwenCatalogAt = 0;

async function loadGushiwenCatalog() {
  if (gushiwenCatalog && Date.now() - gushiwenCatalogAt < 30 * 60 * 1000) return gushiwenCatalog;
  const html = await fetchHtml(`${GUSHIWEN}/guwen/`);
  const books = [];
  const seen = new Set();
  for (const a of anchors(html)) {
    const href = absoluteUrl(getAttr(a.attrs, 'href'), GUSHIWEN);
    const m = /\/guwen\/book_([A-Za-z0-9]+)\.aspx/.exec(href);
    if (!m || seen.has(m[1])) continue;
    const title = cleanText(a.body).slice(0, 80);
    if (!title) continue;
    seen.add(m[1]);
    books.push({ id: `book_${m[1]}`, title, url: href });
    if (books.length >= 400) break;
  }
  if (!books.length) throw new Error('古文岛目录暂时读不到，稍后再试。');
  gushiwenCatalog = books;
  gushiwenCatalogAt = Date.now();
  return books;
}

async function searchGushiwen(query) {
  const q = String(query || '').trim();
  const books = await loadGushiwenCatalog();
  const matched = q ? books.filter(b => b.title.includes(q) || b.title.toLowerCase().includes(q.toLowerCase())) : books;
  return matched.slice(0, 20).map(b => ({
    source: 'gushiwen',
    id: b.id,
    title: b.title,
    author: '古文岛',
    snippet: '古籍 · 古文岛',
    url: b.url
  }));
}

function gushiwenChapter(html) {
  const conAt = html.search(/<div[^>]*class="[^"]*contson/i);
  if (conAt < 0) return null;
  const end = html.indexOf('</div>', conAt);
  const body = html.slice(conAt, end > conAt ? end + 6 : conAt + 12000);
  const zAt = html.search(/<div[^>]*id="zhengwen/i);
  let title = '';
  if (zAt >= 0 && zAt < conAt) {
    const head = html.slice(zAt, conAt);
    title = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(head) || [])[1] || '');
  }
  const text = cleanText(body);
  if (text.length < 20) return null;
  return { title, text };
}

async function readGushiwenBook(idOrUrl) {
  const raw = String(idOrUrl || '');
  let url = /^https?:/i.test(raw) ? raw : '';
  let token = '';
  const tm = /(bookv?_[A-Za-z0-9]+)\.aspx/.exec(raw) || /(bookv?_[A-Za-z0-9]+)/.exec(raw);
  if (tm) token = tm[1];
  if (!url && token) url = `${GUSHIWEN}/guwen/${token}.aspx`;
  if (!url) throw new Error('这个古文岛链接看起来不对。');
  if (!/gushiwen\.cn$/i.test(new URL(url).hostname)) throw new Error('这个古文岛链接看起来不对。');

  if (/^bookv_/.test(token)) {
    const html = await fetchHtml(url);
    const chapter = gushiwenChapter(html);
    if (!chapter) throw new Error('这一章没有找到可读的正文。');
    return {
      key: `gushiwen:${url}`,
      source: 'gushiwen',
      id: token,
      title: chapter.title || '古文岛',
      author: '古文岛',
      url,
      text: chapter.text,
      chapters: [],
      truncated: false
    };
  }

  const html = await fetchHtml(url);
  const bookTitle = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || (/\/(book_[A-Za-z0-9]+)\.aspx/.exec(url) || [])[1] || '古文岛');
  const chapters = [];
  const seen = new Set();
  for (const a of anchors(html)) {
    const href = absoluteUrl(getAttr(a.attrs, 'href'), GUSHIWEN);
    const m = /\/guwen\/(bookv_[A-Za-z0-9]+)\.aspx/.exec(href);
    if (!m || seen.has(m[1])) continue;
    const title = cleanText(a.body).slice(0, 80);
    if (!title) continue;
    seen.add(m[1]);
    chapters.push({ id: m[1], title });
    if (chapters.length >= 60) break;
  }

  if (!chapters.length) {
    const text = cleanText(html);
    if (text.length < 40) throw new Error('这一页没有找到可读的正文。');
    return { key: `gushiwen:${url}`, source: 'gushiwen', id: token, title: bookTitle, author: '古文岛', url, text, chapters: [], truncated: false };
  }

  const take = chapters.slice(0, 8);
  const parts = [];
  for (const ch of take) {
    let got = null;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try {
        const chapterHtml = await fetchHtml(`${GUSHIWEN}/guwen/${ch.id}.aspx`);
        const c = gushiwenChapter(chapterHtml);
        if (c) got = { title: c.title || ch.title, text: c.text };
      } catch (e) { /* retry once */ }
      if (!got) await new Promise(r => setTimeout(r, 300));
    }
    if (got) parts.push(got);
  }
  const body = parts.map(c => `【${c.title}】\n${c.text}`).join('\n\n');
  if (!body || body.length < 40) throw new Error('古文岛这本书暂时读不到正文。');
  return {
    key: `gushiwen:${url}`,
    source: 'gushiwen',
    id: token,
    title: bookTitle,
    author: '古文岛',
    url,
    text: body,
    chapters,
    truncated: chapters.length > take.length
  };
}

module.exports = {
  searchWikisource, readWikisource,
  searchGutenberg, readGutenberg,
  search5000yan, read5000yan,
  searchGushiwen, readGushiwenBook,
  readUrl,
  listLocalBooks, readLocalBook, readLocalFile
};
